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
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js';
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
  /** 转发阶段的其他异常（SDK / 桥的内部状态错误）—— `3.8` 新增，见 §12.5。 */
  upstreamError: 'upstream_error',
  quotaExceeded: 'QUOTA_EXCEEDED',
} as const;

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[keyof typeof BRIDGE_ERROR_CODES];

/**
 * 转发阶段失败可能落到的三个码 —— `classifyRelayFailure` 的值域。
 *
 * 刻意收窄为三值（而不是整个 `BridgeErrorCode`）：文案表因此能写成**完整**映射、取用时无需
 * 兜底分支 —— 那种「不会发生但必须写」的分支，正是覆盖率最容易掉的地方（本仓 `statements`
 * 仅剩 0.08 余量）。
 */
export type RelayFailureCode =
  (typeof BRIDGE_ERROR_CODES)['upstreamTimeout' | 'upstreamUnavailable' | 'upstreamError'];

/**
 * 转发阶段失败的对外文案（按分类给可读说明）。
 *
 * 纪律 1 的落地：只给「场景名 + 可读说明」，**不含**内部路径 / 堆栈 / 上游 stderr 原文。
 */
const RELAY_FAILURE_MESSAGES: Record<RelayFailureCode, string> = {
  [BRIDGE_ERROR_CODES.upstreamTimeout]: 'Upstream MCP server did not respond in time.',
  [BRIDGE_ERROR_CODES.upstreamUnavailable]:
    'Upstream MCP server is unavailable; the session was closed.',
  [BRIDGE_ERROR_CODES.upstreamError]:
    'The bridge failed while relaying the request to the upstream server.',
};

/** 统一错误应答（纪律 1：只给错误码与可读说明）。 */
export function sendBridgeError(
  reply: FastifyReply,
  status: number,
  code: BridgeErrorCode,
  message: string,
): FastifyReply {
  return reply.code(status).type('application/json; charset=utf-8').send({ error: code, message });
}

/**
 * 转发阶段异常的分类 —— `web-design.md` §12.5 的「转发阶段失败的分类定档」在代码里的投影。
 *
 * **依据（`3.10` 探针实测）**：本函数**能拿到**的异常全是**传输层的内部状态错误**
 * （`webStandardStreamableHttp.js` 的 5 个 `throw` 点：`Transport already started` ·
 * `Stateless transport cannot be reused across requests` · `Cannot send a response on a
 * standalone SSE stream` · `No connection established for request ID`），**没有一个是上游业务错误** ——
 * 上游业务错误的 `code` / `message` / `data` 由 SDK 自动透传回客户端（`shared/protocol.js`
 * 的 `_onrequest` 兜底分支），根本不会进 `relay` 的 `catch`。
 *
 * 因此这里只做三分类，且**不再**把任何异常伪装成 `upstream_timeout` —— 那会把排障引向
 * 「上游太慢」，而真相往往是「桥自己出了状态错」。
 */
export function classifyRelayFailure(error: unknown): { status: number; code: RelayFailureCode } {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (code === ErrorCode.RequestTimeout) {
    return { status: 504, code: BRIDGE_ERROR_CODES.upstreamTimeout };
  }
  if (code === ErrorCode.ConnectionClosed) {
    return { status: 503, code: BRIDGE_ERROR_CODES.upstreamUnavailable };
  }
  return { status: 502, code: BRIDGE_ERROR_CODES.upstreamError };
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

    /** 桥的失败审计出口（纪律 ③ 与 ④ 共用一个出口；`detail` 只放归因信息，不含机密）。 */
    const auditFailure = (
      action: 'mcp_session_rejected' | 'mcp_upstream_error',
      reason: string,
      extra: Record<string, unknown> = {},
    ): void => {
      insertAudit(db, {
        actor: `token:${key.key_prefix}`,
        action,
        target: user.handle,
        detail: { reason, ...extra },
        sourceIp: request.ip,
      });
    };
    const auditRejected = (reason: string, extra: Record<string, unknown> = {}): void =>
      auditFailure('mcp_session_rejected', reason, extra);

    /**
     * 转发阶段失败：**一行日志 + 一行审计**（§12.5 纪律 ④，`3.8` 新增）。
     *
     * `3.8` 之前这里是空的 `catch {}` —— 线上真出现转发异常时**没有任何线索**。
     * 动作名与「会话被拒」分开（`mcp_upstream_error`）：「上游起不来」与「转发阶段出错」
     * 是两类故障，混在一起会让排障无从下手。
     */
    const onRelayFailure = (failure: { status: number; code: RelayFailureCode }): void => {
      request.log.error(
        {
          event: 'mcp_relay_failed',
          code: failure.code,
          status: failure.status,
          handle: user.handle,
        },
        'mcp_relay_failed',
      );
      auditFailure('mcp_upstream_error', failure.code, {
        stage: 'relay',
        status: failure.status,
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
      await relay(existing, request, reply, registry, { timeoutMs, onRelayFailure });
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

    await relay(session, request, reply, registry, {
      register: true,
      timeoutMs,
      onRelayFailure,
    });
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
  opts: {
    readonly register?: boolean;
    readonly timeoutMs?: number;
    /**
     * 转发阶段失败时的回调 —— 由调用方决定怎么记（本仓：一行日志 + 一行审计）。
     * `relay` 只负责**分类**与**写响应**；它拿不到 `auditRejected` 那个闭包，故不在此处碰 `db`。
     */
    readonly onRelayFailure?: (failure: { status: number; code: RelayFailureCode }) => void;
  } = {},
): Promise<void> {
  reply.hijack(); // 交给 SDK 直接写 Node 的 ServerResponse（SSE 等流式响应需要）

  try {
    // 注意：**不在此处包超时**。`StreamableHTTPServerTransport.handleRequest` 把响应交给
    // 异步流后立即返回 ⇒ 用 `Promise.race` 包它做超时是无效的（实测：客户端仍会等到上游响应）。
    // 上游超时由 `createBridgeTransport` 的 `requestTimeoutMs` 加在**上游请求**上，
    // 以 MCP 层错误返回（见 `transport.ts` 的说明）。
    await session.transport.handleRequest(request.raw, reply.raw, request.body);
  } catch (error) {
    // 转发阶段的异常：销毁会话（含上游），避免半死连接继续占用子进程（纪律 2）。
    await registry.close(session);

    // `3.8` 的「失败可诊断」：按来源分类（§12.5 的三层口径），不再一律报 `upstream_timeout`
    // —— 那会把「桥自己出了状态错」误导成「上游太慢」。
    const failure = classifyRelayFailure(error);
    opts.onRelayFailure?.(failure);

    if (!reply.raw.headersSent) {
      // 响应头**未**发出 ⇒ 可以用状态码表达（分类见 §12.5）。
      reply.raw.writeHead(failure.status, { 'content-type': 'application/json; charset=utf-8' });
      reply.raw.end(
        JSON.stringify({
          error: failure.code,
          message: RELAY_FAILURE_MESSAGES[failure.code],
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


