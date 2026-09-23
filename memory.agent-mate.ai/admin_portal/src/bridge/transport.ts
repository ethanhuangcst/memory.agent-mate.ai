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
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  CancelledNotificationSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
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
   * 上游请求的超时（毫秒）。
   *
   * **为什么放在上游调用上、而不是 HTTP 层**：Streamable HTTP 的响应是流式，
   * **响应头先于上游结果发出** ⇒ HTTP 状态码在那一刻就已确定，「上游太慢」无法再用
   * `504` 表达。把它加在上游 client 的请求上，超时会以 **MCP 层错误**返回给客户端 ——
   * 这是唯一在协议上说得通的位置。（集成测试实测：在 HTTP 层包超时完全无效，
   * SDK 的 `handleRequest` 对 `initialize` 是立即返回、把响应交给异步流。）
   */
  readonly requestTimeoutMs?: number;
}

/**
 * 为一个上游会话建立传输桥。
 *
 * @param upstream 已连接的上游会话（`spawnUpstream` 的产物）。
 */
export async function createBridgeTransport(
  upstream: UpstreamSession,
  options: BridgeTransportOptions = {},
): Promise<BridgeTransport> {
  const requestOptions =
    options.requestTimeoutMs === undefined ? {} : { timeout: options.requestTimeoutMs };

  const server = new Server(
    { name: 'portal-bridge', version: '0.1.0' },
    { capabilities: { tools: {}, prompts: {} } },
  );

  // 桥的全部职责：把 HTTP 侧收到的请求**原样**转给上游 client。
  // 不解析语义、不做业务判断 —— 门户对 ai-memory 的语义知识保持为 0。
  server.setRequestHandler(ListToolsRequestSchema, async (req) =>
    upstream.client.listTools(req.params, requestOptions),
  );
  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    upstream.client.callTool(req.params, undefined, requestOptions),
  );
  server.setRequestHandler(ListPromptsRequestSchema, async (req) =>
    upstream.client.listPrompts(req.params, requestOptions),
  );
  server.setRequestHandler(GetPromptRequestSchema, async (req) =>
    upstream.client.getPrompt(req.params, requestOptions),
  );

  // ---- 未显式注册的请求与通知：原样转发给上游（`3.8` 的「整行转发」）----
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
    upstream.client.request(request, z.unknown(), requestOptions) as never;

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
