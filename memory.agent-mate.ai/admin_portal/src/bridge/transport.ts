/**
 * 传输桥：`HTTP(Streamable) ⇄ stdio` 的装配与**双向转发**。
 *
 * 依据（契约真源）：`specs/mcp/mcp-design.md` §5.6.2 第 3 步 · `specs/web-portal/web-design.md` §12.5。
 *
 * ## 设计取舍
 *
 * - **不手写帧解析**：服务端用官方 SDK 的 `StreamableHTTPServerTransport`，上游用
 *   `StdioClientTransport`（在 `spawn.ts` 里装配），两者由本模块的 `Server` 实例**直连转发**。
 *   已由 `probes/mcp-bridge-probe/`（Sprint 4 `3.5`）在同仓库实证跑通（SDK `1.30.0`）。
 * - **不缓存跨会话响应**（模板不变量 4 的推论）：每个 `BridgeTransport` 只服务一个会话，
 *   转发是「请求 → 上游 → 回包」的直通，没有跨会话共享缓冲（判据归 `3.3`）。
 * - **一会话一 transport 实例**：`StreamableHTTPServerTransport` 用 `sessionIdGenerator`
 *   生成 HTTP 层会话 id（实测形如 `7677a16a-…`），与「一会话一子进程」一一对应。
 * - **代上游自报家门**：`initialize` 回包的 `serverInfo` / `capabilities` / `instructions`
 *   全部**取自上游**，桥不声明自己的身份（`3.9`；契约见 `web-design.md` §12.5 的
 *   「桥对客户端的身份与能力」，三条硬约束由 `probes/bridge-identity-probe/` 实证）。
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Implementation } from '@modelcontextprotocol/sdk/types.js';
import { CancelledNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import type { UpstreamSession } from './spawn';

export interface BridgeTransport {
  /** HTTP 层会话 id（`initialize` 响应发出后由 SDK 赋值）。 */
  readonly sessionId: string | undefined;
  /** HTTP 层会话是否已关闭（客户端主动结束 / 流结束）。 */
  isClosed(): boolean;
  /** 把一个 HTTP 请求交给桥（`parsedBody` 为已解析的 JSON 体）。 */
  handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    parsedBody?: unknown,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface BridgeTransportOptions {
  /**
   * **上游每一个请求**的超时（毫秒）—— 与「握手超时」是两件事，两者的常量都在 `route.ts`。
   *
   * **为什么放在上游调用上、而不是 HTTP 层**：Streamable HTTP 的响应是流式，
   * **响应头先于上游结果发出** ⇒ HTTP 状态码在那一刻就已确定，「上游太慢」无法再用
   * `504` 表达。把它加在上游 client 的请求上，超时会以 **MCP 层错误**返回给客户端 ——
   * 这是唯一在协议上说得通的位置。（集成测试实测：在 HTTP 层包超时完全无效，
   * SDK 的 `handleRequest` 对 `initialize` 是立即返回、把响应交给异步流。）
   */
  readonly upstreamRequestTimeoutMs?: number;
}

/**
 * 为一个上游会话建立传输桥。
 *
 * @param upstream 已连接的上游会话（`spawnUpstream` 的产物）—— 身份 / 能力 / 指令都从它读。
 */
export async function createBridgeTransport(
  upstream: UpstreamSession,
  options: BridgeTransportOptions = {},
): Promise<BridgeTransport> {
  const upstreamRequestOptions =
    options.upstreamRequestTimeoutMs === undefined
      ? {}
      : { timeout: options.upstreamRequestTimeoutMs };

  // ---- 身份与能力：**代上游自报家门**（`3.9`；契约见 `web-design.md` §12.5）----
  //
  // 取值必须在这里、也就是 `new Server(...)` **之前**：上游 client 已在 `spawnUpstream` 里
  // 完成握手，三个取值点此刻即可用；而 `Server.registerCapabilities()` 在 transport 已连接时
  // **会抛错**（`server/index.js`）⇒ 那是条时序死路，**不要**改用它。
  //
  // 透传的准确含义是「**经协议 schema 归一化后**的透传」（`3.11` 探针实测）：`serverInfo` 的
  // 字段与取值保留、但键序会被 schema 解析重建；`capabilities` 的已知键保留、未知键被丢弃。
  // ⇒ 验收断言写「字段与取值等于上游」，**不写**「逐字节」。
  // `Client.getServerVersion()` 类型上带 `| undefined`，但**上游握手一旦完成它必然存在** ——
  // `InitializeResultSchema` 把 `serverInfo` 定为**必填**（`types.js`），SDK 也只是把回包原样存下。
  // `| undefined` 只对「尚未连接」有意义，而本函数的前置条件就是已连接（`spawnUpstream` 的产物）。
  // ⇒ 此处收窄断言并留注，不静默兜底出一个假身份（那会直接违背本行的契约）。
  const serverInfo = upstream.client.getServerVersion() as Implementation;
  const capabilities = upstream.client.getServerCapabilities() ?? {};
  const instructions = upstream.client.getInstructions();

  const server = new Server(serverInfo, {
    capabilities,
    // **条件展开**：SDK 只在真值时回吐该字段（`server/index.js` 的 `_oninitialize`），
    // 无条件写成 `instructions` 会把上游的「无指令」变成桥的「空指令」，
    // 破坏「字段与取值等于上游」这条契约（真上游 core 档正是「无指令」）。
    ...(instructions === undefined ? {} : { instructions }),
  });

  // ---- 不注册任何业务 handler：全部经 fallback 整行转发 ----
  //
  // **这不是风格选择，而是能力断言的强制后果**（`3.11` 探针断言 3 实测）：SDK 的能力断言
  // 发生在 `setRequestHandler`（**注册期**，`shared/protocol.js`），不在请求分派期。一旦能力
  // 取自上游而桥仍无条件注册 `prompts/*`，**上游未声明 `prompts` 时桥会在构造期抛错**
  // （实测文案 `Server does not support prompts (required for prompts/list)`）⇒ 会话直接
  // 起不来（503）。
  //
  // 删掉 `3.1` 遗留的这 4 个 handler 另有两处收益：入参不再由桥校验、上游结果不再由桥用
  // **具名 schema** 解析 ⇒ 「原样转发、门户语义知识 = 0」字面成立。两条路径的能力断言本来
  // 就完全相同 —— `Client.listTools / callTool / listPrompts` 只是 `Client.request` 的薄包装
  // （`client/index.js`），而能力断言由 `Client.request` 完成（`shared/protocol.js`）。
  //
  // **`capabilities.logging` 会被 SDK 在桥本地吞掉**（同探针断言 4）：`Server` 构造期即为该
  // 能力注册 `logging/setLevel` 的 handler，**本地处理并返回 `{}`、不转发** ⇒ 客户端以为
  // 设置了级别、上游从未收到。显式移除，让它落回 fallback 走转发。
  // 上游未声明 `logging` 时这是**空操作**（该 handler 本就不存在）—— 真上游 core 档即此情形。
  server.removeRequestHandler('logging/setLevel');

  // ---- 请求与通知：全部原样转发给上游（`3.8` 的「整行转发」；`3.9` 起**没有任何业务方法
  //      被显式注册**，能到这里的只剩 SDK 未内置消费的那些）----
  //
  // **为什么是「赋值」而不是「构造参数」**（`3.10` 探针实测，结论见 `mcp-design.md` §5.6.2 实证块）：
  // `Protocol` 的构造函数只把 options 存进 `this._options`，**从不**把 fallback 提升为实例属性，
  // 而 `_onrequest` / `_onnotification` 读的正是实例属性 ⇒ 写成 `new Server(info, { fallbackRequestHandler })`
  // 会**静默失效**：请求侧被 SDK 合成 `Method not found`、通知侧直接 `return`（连错误都不报）。
  //
  // **为什么要过一层断言**：SDK 只在 `ProtocolOptions` 里声明了这两个字段，`Protocol` 类**没有**
  // 对应属性声明（类型与运行时不一致）⇒ 直赋无法通过类型检查。此处收窄断言并留注，不静默忽略。
  const bridge = server as unknown as {
    fallbackRequestHandler?: (request: never) => Promise<never>;
    fallbackNotificationHandler?: (notification: never) => Promise<void>;
  };

  // 未注册的**请求**：交给上游，结果与错误都保持上游的形状。
  // 宽松 schema `z.unknown()` 是「不校验」在类型上的表达（`Protocol.request` 的 schema 形参是
  // `AnySchema` 而非 `AnyObjectSchema`）—— 上游结果的形状由上游决定，桥不替它把关。
  bridge.fallbackRequestHandler = async (request) =>
    upstream.client.request(request, z.unknown(), upstreamRequestOptions) as never;

  // 未注册的**通知**：`cancelled` 必须**显式注册**才能转发 —— SDK 在 `Protocol` 构造函数里就内置
  // 注册了 `cancelled` → `_oncancel` 与 `progress` → `_onprogress`，它们**永远落不到** fallback。
  // 不覆盖它，客户端取消后上游会继续跑完（「取消」形同无效）。
  server.setNotificationHandler(CancelledNotificationSchema, async (notification) => {
    await upstream.client.notification(notification);
  });
  bridge.fallbackNotificationHandler = async (notification) => {
    await upstream.client.notification(notification);
  };

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  let closed = false;
  // **客户端主动结束会话**（HTTP 层关闭 / SSE 流结束）⇒ 立刻回收上游子进程。
  // 这是「纪律 2：任何失败与收尾都不留未回收子进程」的一半；另一半是 `close()` 里的显式关闭。
  // 少了这一步，客户端 `close()` 之后子进程会一直挂着 —— 集成测试正是这样抓到它的。
  const previousOnClose = transport.onclose;
  transport.onclose = () => {
    closed = true;
    previousOnClose?.();
    void upstream.close();
  };
  // SDK `1.30.0` 的 `onclose` 声明为 `(() => void) | undefined`，与本仓开启的
  // `exactOptionalPropertyTypes` 不兼容（`Transport` 接口要求 `() => void`）。
  // 这是类型层面的缝隙，不影响运行时 —— 此处收窄断言并留注，**不是**静默忽略错误。
  await server.connect(transport as unknown as Parameters<typeof server.connect>[0]);

  return {
    get sessionId(): string | undefined {
      return transport.sessionId;
    },
    isClosed: () => closed,
    handleRequest: (req, res, parsedBody) => transport.handleRequest(req, res, parsedBody),
    async close(): Promise<void> {
      closed = true;
      // 顺序：先关 HTTP 侧传输，再关 Server（Server 关闭会级联到已连接的 transport）。
      try {
        await transport.close();
      } catch {
        /* 已关闭或连接已断，忽略 —— 回收路径必须尽力而为 */
      }
      try {
        await server.close();
      } catch {
        /* 同上 */
      }
    },
  };
}
