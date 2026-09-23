/**
 * 接入面路由：接管 `/mcp` —— 面隔离 → 令牌校验 → 会话建立/复用 → 双向转发。
 *
 * 依据：
 * - 契约真源 `specs/mcp/mcp-design.md` §5.6.2（路径表与桥契约四步）。
 * - 失败面真源 `specs/web-portal/web-design.md` **§12.5**（逐场景状态码与错误体映射表）。
 * - 路由表 `specs/web-portal/web-design.md` §12.3（MCP 面只接受 `<MCP_HOST>` 的 `/mcp`）。
 *
 * **面不匹配（403 `wrong_face`）不在此处产生**：它由 `server.ts` 的 `onRequest` 面隔离钩子
 * 先行拦下（`decideRequest`），请求根本到不了本模块 —— 这是「面隔离先于身份」的既有设计。
 *
 * ## 三条统一纪律（§12.5）
 *
 * 1. 错误体一律 `{"error":"<code>","message":"<可读说明>"}`，**不含**内部路径 / 堆栈 / 上游 stderr 原文；
 * 2. 任何失败路径都**不得留下未回收的子进程**；
 * 3. `spawn_assertion_failed` 与 `upstream_unavailable` **必写审计行**。
 */

import type Database from 'better-sqlite3';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { parseBearerToken } from '../shared/tokens';
import { insertAudit } from '../web/db/repo/audit';
import { touchKeyLastUsed } from '../web/db/repo/keys';
import { verifyToken } from '../web/services/keys';
import type { PortalConfig } from '../config';
import { SessionRegistry, type BridgeSession } from './session';
import { spawnUpstream } from './spawn';
import { createBridgeTransport } from './transport';

export const MCP_PATH = '/mcp';

/**
 * 请求级转发超时上限（保守值，不会误伤正常工具调用）。
 *
 * **取值归属**：Sprint 4 `4.1`「web-portal:会话限流」—— 本批（`3.1`）不写死业务参数，
 * 只给一个兜底上限（`ADR-016` 的颗粒度纪律）。
 */
const REQUEST_TIMEOUT_MS = 30_000;

/** 统一 401 的文案：**不区分**「未携带 / 无效 / 已吊销 / 用户停用 / 非 `memo_` 前缀」。 */
const UNAUTHORIZED_MESSAGE =
  'Authentication required: a valid bearer token is needed to open an MCP session.';

/** 失败面错误码 —— `web-design.md` §12.5 映射表在代码里的投影。 */
export const BRIDGE_ERROR_CODES = {
  unauthorized: 'unauthorized',
  wrongFace: 'wrong_face',
  spawnAssertionFailed: 'spawn_assertion_failed',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
  quotaExceeded: 'QUOTA_EXCEEDED',
} as const;

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[keyof typeof BRIDGE_ERROR_CODES];

/** 统一错误应答（纪律 1：只给错误码与可读说明）。 */
export function sendBridgeError(
  reply: FastifyReply,
  status: number,
  code: BridgeErrorCode,
  message: string,
): FastifyReply {
  return reply.code(status).type('application/json; charset=utf-8').send({ error: code, message });
}

export interface McpBridgeDeps {
  readonly cfg: PortalConfig;
  readonly db: Database.Database;
  /**
   * 请求级转发的超时（毫秒），默认 `REQUEST_TIMEOUT_MS`。
   *
   * **仅供测试注入短超时**（否则「上游挂起 ⇒ 504」这条路径在测试里要等 30 秒）。
   * 生产**不**通过环境变量配置它 —— 取值归属 `4.1`，见 `REQUEST_TIMEOUT_MS` 的说明。
   */
  readonly requestTimeoutMs?: number;
}

export function registerMcpBridgeRoutes(app: FastifyInstance, deps: McpBridgeDeps): void {
  const { cfg, db } = deps;
  const timeoutMs = deps.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const registry = new SessionRegistry();

  // 进程收尾：关闭全部会话（HTTP 传输侧 → 上游 → 注册表条目），避免孤儿进程。
  app.addHook('onClose', async () => {
    await registry.closeAll();
  });

  app.all(MCP_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
    // ---- 第 1 步：令牌校验（统一 401；理由不外泄，否则原因会变成枚举探针）----
    const verified = verifyToken(db, parseBearerToken(request.headers.authorization));
    if (!verified.ok) {
      sendBridgeError(reply, 401, BRIDGE_ERROR_CODES.unauthorized, UNAUTHORIZED_MESSAGE);
      return;
    }
    const { user, key } = verified;

    const auditRejected = (reason: string, extra: Record<string, unknown> = {}): void => {
      insertAudit(db, {
        actor: `token:${key.key_prefix}`,
        action: 'mcp_session_rejected',
        target: user.handle,
        detail: { reason, ...extra },
        sourceIp: request.ip,
      });
    };

    // ---- 第 2 步：复用已有会话（要求同一把令牌，防止跨用户接管会话）----
    const incomingSessionId = headerSessionId(request);
    if (incomingSessionId) {
      const existing = registry.get(incomingSessionId);
      if (
        !existing ||
        existing.keyId !== key.id ||
        existing.handle !== user.handle ||
        // 传输层已关闭（客户端结束过会话）⇒ 该 sessionId 已失效，顺手清掉注册表条目。
        existing.transport.isClosed()
      ) {
        if (existing) registry.remove(existing.id);
        // 与「令牌不存在」同形处理：不泄露会话是否存在。
        sendBridgeError(reply, 401, BRIDGE_ERROR_CODES.unauthorized, UNAUTHORIZED_MESSAGE);
        return;
      }
      existing.lastActivityAt = Date.now();
      await relay(existing, request, reply, registry, { timeoutMs });
      return;
    }

    // ---- 第 3 步：新建会话：spawn 上游 → 建传输桥 → 转发（转发后才登记）----
    let upstream;
    try {
      upstream = await spawnUpstream({
        handle: user.handle,
        launchOverride: cfg.launchOverride,
        upstreamApiKey: cfg.upstreamApiKey,
        requestTimeoutMs: timeoutMs,
        logger: request.log,
      });
    } catch (error) {
      // 纪律 3：上游不可用必写审计行（detail 只留消息，不含 env 值 / 上游 stderr 原文）。
      auditRejected('upstream_unavailable', {
        stage: 'spawn',
        message: error instanceof Error ? error.message : String(error),
      });
      sendBridgeError(
        reply,
        503,
        BRIDGE_ERROR_CODES.upstreamUnavailable,
        'Upstream MCP server is unavailable; the session could not be opened.',
      );
      return;
    }

    let transport;
    try {
      transport = await createBridgeTransport(upstream, { requestTimeoutMs: timeoutMs });
    } catch {
      // 建桥失败：先把刚起的子进程收掉（纪律 2），再回 503。
      await upstream.close();
      auditRejected('upstream_unavailable', { stage: 'transport' });
      sendBridgeError(
        reply,
        503,
        BRIDGE_ERROR_CODES.upstreamUnavailable,
        'Upstream MCP server is unavailable; the session could not be opened.',
      );
      return;
    }

    // 使用时间粒度（web-design.md §4.4）：**会话建立时更新一次**，非每请求。
    touchKeyLastUsed(db, key.id);

    const session: BridgeSession = {
      id: '',
      handle: user.handle,
      userId: user.id,
      keyId: key.id,
      transport,
      upstream,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };

    await relay(session, request, reply, registry, { register: true, timeoutMs });
  });
}

/** 读取 HTTP 层会话 id（SDK 用该头在请求间关联同一会话）。 */
function headerSessionId(request: FastifyRequest): string | undefined {
  const raw = request.headers['mcp-session-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * 把请求交给桥。
 *
 * @param opts.register 新建会话路径：SDK 在 `initialize` 处理完成后才给 `sessionId` 赋值，
 *   因此必须**转发之后**才能登记；拿不到 id 说明这一轮不是 `initialize` ⇒ 立即关掉，不留孤儿。
 */
async function relay(
  session: BridgeSession,
  request: FastifyRequest,
  reply: FastifyReply,
  registry: SessionRegistry,
  opts: { readonly register?: boolean; readonly timeoutMs?: number } = {},
): Promise<void> {
  reply.hijack(); // 交给 SDK 直接写 Node 的 ServerResponse（SSE 等流式响应需要）

  try {
    // 注意：**不在此处包超时**。`StreamableHTTPServerTransport.handleRequest` 把响应交给
    // 异步流后立即返回 ⇒ 用 `Promise.race` 包它做超时是无效的（实测：客户端仍会等到上游响应）。
    // 上游超时由 `createBridgeTransport` 的 `requestTimeoutMs` 加在**上游请求**上，
    // 以 MCP 层错误返回（见 `transport.ts` 的说明）。
    await session.transport.handleRequest(request.raw, reply.raw, request.body);
  } catch {
    // 转发阶段的同步异常：销毁会话（含上游），避免半死连接继续占用子进程（纪律 2）。
    await registry.close(session);
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(504, { 'content-type': 'application/json; charset=utf-8' });
      reply.raw.end(
        JSON.stringify({
          error: BRIDGE_ERROR_CODES.upstreamTimeout,
          message: 'Upstream MCP server did not respond in time.',
        }),
      );
    } else if (!reply.raw.writableEnded) {
      // **SSE 响应已经开始**（转发的响应是流式的，headers 先于上游结果发出）⇒ 状态码无法再改写，
      // 只能**显式结束流**。少了这一步，客户端会一直挂到上游最终响应为止 ——
      // 超时兜底就形同不存在（集成测试正是这样抓到它的：等了 5.1s 而不是 0.3s）。
      reply.raw.end();
    }
    return;
  }

  if (opts.register) {
    const id = session.transport.sessionId;
    if (id) {
      session.id = id;
      registry.add(session);
    } else {
      await registry.close(session);
    }
  }
}


