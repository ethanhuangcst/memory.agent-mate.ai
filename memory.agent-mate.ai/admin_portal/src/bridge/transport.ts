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
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
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
