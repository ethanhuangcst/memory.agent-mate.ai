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
import { getKeyById, touchKeyLastUsed } from '../web/db/repo/keys';
import { getUserById } from '../web/db/repo/users';
import { verifyToken } from '../web/services/keys';
import type { PortalConfig } from '../config';
import { SessionRegistry, type BridgeSession, type ReapLimits } from './session';
import { decideSessionLimit } from './limits';
import { spawnUpstream } from './spawn';
import { capResponseBytes, type ResponseCapInfo } from './response-cap';
import { createBridgeTransport } from './transport';
// 断言失败的原因枚举与客户端文案都由 `user-db-path.ts` 持有（该模块拥有「断言」这件事的全部词汇），
// 本模块只负责把它写成一个 500 响应 + 一行审计。
import { SPAWN_ASSERTION_MESSAGE } from './user-db-path';

export const MCP_PATH = '/mcp';

/**
 * 桥 → 上游**握手**超时（保守值，不会误伤正常工具调用）。
 *
 * **管哪一段**：`spawn.ts` 的 `client.connect(transport, { timeout })` —— 覆盖「上游起得来但
 * 不响应」。失败形态：握手期挂起 ⇒ **503 `upstream_unavailable`**（此时响应头未发出，可以用
 * 状态码表达，见 `web-design.md` §12.5 的超时三分支）。
 *
 * **取值归属**：Sprint 4 `4.1`「web-portal:会话限流」。本批（`3.9`）**只把两类超时分层**、
 * 不定义取值 —— 两个默认值都与分层前保持一致（`ADR-016` 的颗粒度纪律）。
 */
const HANDSHAKE_TIMEOUT_MS = 30_000;

/**
 * 桥 → 上游**每一个请求**的超时（`RequestOptions.timeout`）。
 *
 * **管哪一段**：`transport.ts` 里每条上游调用附带的 `{ timeout }` —— 覆盖「某个具体调用太慢」。
 * 失败形态：转发期 ⇒ **MCP 层错误 `-32001`**（SSE 响应头已先于上游结果发出，状态码改不动）。
 *
 * 与 `HANDSHAKE_TIMEOUT_MS` 是**两个独立常量**：实测把两者反着设（短握手 / 长请求）时，耗时
 * 超过握手超时的调用仍能成功（[`probes/bridge-identity-probe/`](../../probes/bridge-identity-probe/)
 * 断言 7）。**取值归属**：同上，归 `4.1`。
 */
const UPSTREAM_REQUEST_TIMEOUT_MS = 30_000;

/**
 * 到期扫描的**频率**（毫秒，`3.4`）。
 *
 * **它不是业务取值**：不决定「多久算到期」，只决定「最多晚多久发现到期」（最坏情况下会话多活
 * 一个扫描周期）。因此**不**登记为环境键 —— `web-design.md` §12.9 的两把键是**超时值**
 * （取值归 `4.1`）；本常量只影响回收的**及时性**，测试可注入更短的 `reapIntervalMs`。
 */
const REAP_INTERVAL_MS = 15_000;

/** 统一 401 的文案：**不区分**「未携带 / 无效 / 已吊销 / 用户停用 / 非 `memo_` 前缀」。 */
const UNAUTHORIZED_MESSAGE =
  'Authentication required: a valid bearer token is needed to open an MCP session.';

/** 失败面错误码 —— `web-design.md` §12.5 映射表在代码里的投影。 */
/**
 * `4.1`：门户**自建**会话限流的对外文案。
 *
 * **为什么复用 `429` 却另给 `error` 串**：`429` 在 §12.5 里已给了「**上游配额超限**」
 * （`QUOTA_EXCEEDED`，**透传上游客口**）。门户自建限流复用**同一状态码**（HTTP 语义一致：
 * too many requests），但用**不同的 `error` 串**（`SESSION_LIMIT_EXCEEDED`）标明**来源是门户** ——
 * 客户端不必靠状态码猜「这次撞的是上游配额还是门户护栏」。
 */
const SESSION_LIMIT_MESSAGE =
  '会话数已达上限（门户自建的并发护栏）：请先结束其它会话或稍后重试。';

const RESPONSE_TOO_LARGE_MESSAGE =
  '单条响应超过门户上限（背压护栏）：请缩小请求范围（减少条数或缩短内容）后重试。';

export const BRIDGE_ERROR_CODES = {
  unauthorized: 'unauthorized',
  wrongFace: 'wrong_face',
  spawnAssertionFailed: 'spawn_assertion_failed',
  upstreamUnavailable: 'upstream_unavailable',
  upstreamTimeout: 'upstream_timeout',
  /** 转发阶段的其他异常（SDK / 桥的内部状态错误）—— `3.8` 新增，见 §12.5。 */
  upstreamError: 'upstream_error',
  quotaExceeded: 'QUOTA_EXCEEDED',
  /** `4.1`：**门户自建**的会话并发上限被撞到（与上一条的「上游配额」用**不同 `error` 串**区分）。 */
  sessionLimitExceeded: 'SESSION_LIMIT_EXCEEDED',
  /**
   * `4.5`：**门户自建**的单响应字节上限被撞到（背压护栏 —— `web-design.md` §12.5「背压」的第②半；
   * 与上一条同构：都是门户策略，故用大写串与上游配额区分）。
   */
  responseTooLarge: 'RESPONSE_TOO_LARGE',
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
  /**
   * `4.1` 新增（**可选**，向后兼容）：附带的**结构化字段**（如限流的 `scope` / `limit` / `current`）。
   * 只允许数字与字符串 —— 本函数是**对外**出口，不能把内部对象（令牌、库路径）带出去。
   */
  extra?: Record<string, string | number>,
): FastifyReply {
  return reply
    .code(status)
    .type('application/json; charset=utf-8')
    .send({ error: code, message, ...extra });
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
   * 桥 → 上游**握手**超时（毫秒），默认 `HANDSHAKE_TIMEOUT_MS`。
   *
   * **仅供测试注入短值**（否则「上游挂起 ⇒ 503」这条路径在测试里要等满默认值）。
   * 生产**不**通过环境变量配置它 —— 取值归属 `4.1`，见 `HANDSHAKE_TIMEOUT_MS` 的说明。
   */
  readonly handshakeTimeoutMs?: number;
  /**
   * 桥 → 上游**每请求**超时（毫秒），默认 `UPSTREAM_REQUEST_TIMEOUT_MS`。
   *
   * 同上：**仅供测试注入短值**（否则「上游太慢 ⇒ MCP 层超时错误」在测试里要等满默认值）；
   * 生产不通过环境变量配置 —— 取值归属 `4.1`，见 `UPSTREAM_REQUEST_TIMEOUT_MS` 的说明。
   */
  readonly upstreamRequestTimeoutMs?: number;
  /**
   * 会话**空闲超时**（毫秒）；不传则用 `cfg.sessionIdleTimeoutMs`（未配置 ⇒ **该触发不启用**）。
   *
   * **仅供测试注入短值**（否则「空闲到期 ⇒ 回收」这条路径在测试里要等满真实值）；生产从
   * `PORTAL_SESSION_IDLE_TIMEOUT` 读 —— 取值归属 `4.1`，本层不写死默认值。
   */
  readonly sessionIdleTimeoutMs?: number;
  /** 会话**最长时长**（毫秒）；口径同 `sessionIdleTimeoutMs`（`PORTAL_SESSION_MAX_DURATION`）。 */
  readonly sessionMaxDurationMs?: number;
  /**
   * 到期扫描的**频率**（毫秒），默认 `REAP_INTERVAL_MS`。
   *
   * **仅供测试注入更短的扫描间隔**（否则「到期 ⇒ 回收」在测试里最坏要等满一个周期）。
   */
  readonly reapIntervalMs?: number;
}

export function registerMcpBridgeRoutes(app: FastifyInstance, deps: McpBridgeDeps): void {
  const { cfg, db } = deps;
  const handshakeTimeoutMs = deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS;
  // 两条超时链的起点：握手那一支交给 `spawnUpstream`、每请求那一支交给 `createBridgeTransport`。
  // 两个值在类型层面就是两个名字 —— 分层之前它们共用一个 `timeoutMs`，语义被混为一谈（`3.1` 遗留）。
  const upstreamRequestTimeoutMs =
    deps.upstreamRequestTimeoutMs ?? UPSTREAM_REQUEST_TIMEOUT_MS;
  const registry = new SessionRegistry();

  // ---- `3.4`：会话到期的两个**限额**与**单一**扫描定时器 ----
  //
  // 注入值优先（测试注短值），否则读配置；**两者都未配置 ⇒ 连定时器都不起**（`4.1` 的取值纪律：
  // 本层不写死默认值 —— 有默认值就等于替 `4.1` 定了值）。
  const reapLimits: ReapLimits = {
    idleMs: deps.sessionIdleTimeoutMs ?? cfg.sessionIdleTimeoutMs,
    maxMs: deps.sessionMaxDurationMs ?? cfg.sessionMaxDurationMs,
  };
  const reapTimer =
    reapLimits.idleMs === undefined && reapLimits.maxMs === undefined
      ? undefined
      : setInterval(() => {
          // 判定在 `SessionRegistry.reap`（吃 `now` 的纯方法，可单测）；这里只负责到点调它。
          // **单一** ticker：N 个会话不产生 N 个 timer，回收顺序与「注册表状态」保持单一真相。
          void registry.reap(Date.now(), reapLimits);
        }, deps.reapIntervalMs ?? REAP_INTERVAL_MS);
  // `unref()`：定时器**不得**拖住进程退出（否则测试与优雅关闭都会被它吊住）。
  reapTimer?.unref();

  // 进程收尾：先停扫描，再关闭全部会话（HTTP 传输侧 → 上游 → 注册表条目），避免孤儿进程。
  app.addHook('onClose', async () => {
    if (reapTimer !== undefined) clearInterval(reapTimer);
    await registry.closeAll();
  });

  app.all(MCP_PATH, async (request: FastifyRequest, reply: FastifyReply) => {
    // ---- 第 1 步：令牌校验（统一 401；理由不外泄，否则原因会变成枚举探针）----
    const verified = verifyToken(db, parseBearerToken(request.headers.authorization));
    if (!verified.ok) {
      // ---- `3.4`：**吊销事件 ⇒ 回收**（§12.5「回收触发」的第三类）----
      //
      // 判据取**该会话自己的** `keyId` / `userId`，**不是**请求里的令牌 ⇒ 回收的是「该会话自己的
      // 终态」，与 `3.3` 立下的「拒绝越权不得伤到第三方」同源：请求本身无权，但只要它指向的
      // 会话**自己的**令牌已不可用，那个会话就该被收掉（否则它会一直挂到空闲超时）。
      // 对外响应**不变**（仍是同形 401），不给探测者区分信号。
      const incomingSessionId = headerSessionId(request);
      if (incomingSessionId !== undefined) {
        const existing = registry.get(incomingSessionId);
        if (existing !== undefined && !isSessionKeyUsable(db, existing.keyId, existing.userId)) {
          await registry.close(existing);
        }
      }
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
    //
    // **两支必须分开**（`3.3` 修正；契约见 `web-design.md` §12.5「会话归属校验的不可侵扰」）：
    // `3.12` 探针在真上游上实测过合并成一支的后果 —— 客户端带**甲的令牌** + **乙的 `sessionId`**
    // 发一次请求时，`registry.remove()` 会把**乙**的会话从注册表里摘掉 ⇒ ① 乙随后用**自己的**
    // 令牌 + 原 `sessionId` **立刻 401**；② 乙的上游子进程**失去唯一引用**、没有任何路径去
    // `close()` 它 ⇒ **孤儿**（门户进程退出才消失）。⇒ 「本请求无权」与「那个会话该不该回收」
    // 是两件事：**拒绝越权，不得顺手伤到第三方**。
  /**
   * `4.5`：响应超限时的留痕（**审计**）—— 与 `onRelayFailure` 同因：`relay` 不碰 `db`，
   * 报错应答与截断由 `relay` 里的背压包装负责。
   */
  const onResponseCapped = ({ sentBytes, headersSent, maxBytes }: ResponseCapInfo): void => {
    insertAudit(db, {
      actor: `token:${key.key_prefix}`,
      action: 'mcp_response_capped',
      target: user.handle,
      detail: { reason: 'response_too_large', sentBytes, maxBytes, headersSent },
      sourceIp: request.ip,
    });
  };

    const incomingSessionId = headerSessionId(request);
    if (incomingSessionId) {
      const existing = registry.get(incomingSessionId);

      // 支 1：该会话不存在，或**不属于本令牌** ⇒ **只拒不动**（既不 `remove` 也不 `close`）。
      // 与「令牌不存在」同形处理：不泄露会话是否存在（不给探测者区分信号）。
      if (!existing || existing.keyId !== key.id || existing.handle !== user.handle) {
        sendBridgeError(reply, 401, BRIDGE_ERROR_CODES.unauthorized, UNAUTHORIZED_MESSAGE);
        return;
      }

      // 支 2：是**该会话自己的**终态（客户端结束过会话 ⇒ 传输已关闭）⇒ 幂等回收后仍回 401。
      // 这里必须用 `close()` 而不是 `remove()`：`SessionRegistry.close()` 会依序关传输与上游
      // （两步都不抛出；底层传输的 `close()` 实测幂等），而 `remove()` 只摘条目、**留下没人收的
      // 子进程**（正是上面实测到的孤儿）。
      if (existing.transport.isClosed()) {
        await registry.close(existing);
        sendBridgeError(reply, 401, BRIDGE_ERROR_CODES.unauthorized, UNAUTHORIZED_MESSAGE);
        return;
      }

      existing.lastActivityAt = Date.now();
      await relay(existing, request, reply, registry, {
        onRelayFailure,
        responseMaxBytes: cfg.responseMaxBytes,
        onResponseCapped,
      });
      return;
    }

    // ---- `4.1`：门户自建的**并发护栏** —— **先判后起**（超限时**不 spawn**）----
    //
    // 计数由 `registry` **现算**（不维护第二套计数器 ⇒ 不会漏释放）；判定在 `limits.ts` 的**纯函数**里
    // （多分支不进装配层，理由见该文件头）。两个限额都未配置 ⇒ 恒放行（未配置即不启用）。
    //
    // **判据口径（`3.17` 探针导出）**：「**不排队致死**」= **HTTP 码 + 响应时间 + 不新增子进程**三项同断 ——
    // 本处**在建会话之前**拒绝，故响应里既没有排队等待，也没有新起的上游进程。
    {
      // 先剔掉「传输已关闭、条目还在」的会话：客户端 `DELETE` 到下一次 reap 之间，它们仍会被算进
      // 在册数（那是**容量泄漏**，会把用户挡在自己的旧会话上）。这一步是**懒清理**，确定性且幂等。
      await registry.pruneClosed();
      const current = registry.countAll();
      const decision = decideSessionLimit(current, registry.countByKey(key.id), {
        perKey: cfg.maxConcurrencyPerKey,
        global: cfg.maxConcurrencyGlobal,
      });
      if (decision) {
        insertAudit(db, {
          actor: `token:${key.key_prefix}`,
          action: 'mcp_session_rejected',
          target: user.handle,
          detail: {
            reason: 'session_limit_exceeded',
            scope: decision.scope,
            limit: decision.limit,
            current,
          },
          sourceIp: request.ip,
        });
        sendBridgeError(reply, 429, BRIDGE_ERROR_CODES.sessionLimitExceeded, SESSION_LIMIT_MESSAGE, {
          scope: decision.scope,
          limit: decision.limit,
          current,
        });
        return;
      }
    }

    // ---- 第 3 步：新建会话：spawn 上游 → 建传输桥 → 转发（转发后才登记）----
    let upstream;
    try {
      upstream = await spawnUpstream({
        handle: user.handle,
        launchOverride: cfg.launchOverride,
        upstreamApiKey: cfg.upstreamApiKey,
        handshakeTimeoutMs,
        logger: request.log,
      });
    } catch (error) {
      // ---- `3.2`：**spawn 前置断言失败**与「上游起不来」是两类故障，必须分开 ----
      //
      // 分流依据是错误上挂的 `reason`：本仓**没有错误子类**、也**不在 `catch` 里用 `instanceof`**
      // （与 `classifyRelayFailure` 读 `error.code` 同构）。若不分开，一条「库路径不可信」会被报成
      // 「上游不可用」——把排障方向直接引到上游去，而真相是门户自己要拦。
      const assertReason = (error as { reason?: unknown } | null | undefined)?.reason;
      if (typeof assertReason === 'string') {
        // §12.5：断言失败归 **500** + 必写审计行；`detail` **只记原因枚举**、**不记路径**
        // （路径里可能含**他人 handle**）。日志同一口径 —— 排障要的是「哪一条断言」，不是路径。
        request.log.error(
          { event: 'mcp_spawn_assertion_failed', reason: assertReason, handle: user.handle },
          'mcp_spawn_assertion_failed',
        );
        auditRejected(assertReason, { stage: 'spawn_assertion' });
        sendBridgeError(reply, 500, BRIDGE_ERROR_CODES.spawnAssertionFailed, SPAWN_ASSERTION_MESSAGE);
        return;
      }

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
      transport = await createBridgeTransport(upstream, { upstreamRequestTimeoutMs });
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
      // `3.4`：门户侧子进程 pid（宿主侧对照与排障用；「子进程归零」的权威判据在容器内）
      // 与**解析后的**库路径（`AC4.3` 的审计行只在这一处取值）。
      childPid: upstream.pid,
      dbPath: upstream.dbPath,
    };

    await relay(session, request, reply, registry, {
      register: true,
      onRelayFailure,
      responseMaxBytes: cfg.responseMaxBytes,
      onResponseCapped,
    });

    // ---- `3.4`：`AC4.3`「每次会话断言并记录实际使用的库路径」----
    //
    // **为什么在这里判「已建立」**：`relay` 只在拿到 `sessionId` 时才登记（拿不到就关掉会话），
    // 故 `session.id` 非空 ⇔ 会话已建立。审计只记**解析后的库路径**与会话 id；
    // 不含令牌明文，也不含记忆正文（`detail_json` 纪律）。
    if (session.id !== '') {
      insertAudit(db, {
        actor: `token:${key.key_prefix}`,
        action: 'mcp_session_opened',
        target: user.handle,
        detail: { sessionId: session.id, dbPath: session.dbPath },
        sourceIp: request.ip,
      });
    }
  });
}

/**
 * 该会话**自己的**令牌是否仍可用（`3.4` 的「吊销事件 ⇒ 回收」用）。
 *
 * 判据取**会话记录里的** `keyId` / `userId`，**不是**请求里的令牌 —— 这样回收的才是「该会话
 * 自己的终态」，第三方无法借此影响别人的会话（`3.3` 的不可侵扰纪律）。
 * 「可用」= 令牌未被吊销 **且** 其用户处于 `active`。
 */
function isSessionKeyUsable(db: Database.Database, keyId: number, userId: number): boolean {
  const key = getKeyById(db, keyId);
  if (key === undefined || key.revoked_at !== null) return false;
  const user = getUserById(db, userId);
  return user !== undefined && user.status === 'active';
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
 *
 * **本函数刻意没有「转发超时」参数**（`3.9` 删掉了 `3.1` 遗留的 `opts.timeoutMs` 死参）：
 * 转发阶段的超时加在**上游请求**上（由 `createBridgeTransport` 的 `upstreamRequestTimeoutMs`
 * 落到每条 `client.request`），本层包不出来 —— 它在下方 `handleRequest` 前用 `Promise.race`
 * 是无效的。留一个用不上的参数只会让后来者以为这里还有一层兜底。
 */
async function relay(
  session: BridgeSession,
  request: FastifyRequest,
  reply: FastifyReply,
  registry: SessionRegistry,
  opts: {
    readonly register?: boolean;
    /**
     * 转发阶段失败时的回调 —— 由调用方决定怎么记（本仓：一行日志 + 一行审计）。
     * `relay` 只负责**分类**与**写响应**；它拿不到 `auditRejected` 那个闭包，故不在此处碰 `db`。
     */
    readonly onRelayFailure?: (failure: { status: number; code: RelayFailureCode }) => void;
    /** `4.5`：**单响应字节上限**（背压护栏）；`undefined` = 不启用（见 `response-cap.ts`）。 */
    readonly responseMaxBytes?: number | undefined;
    /** `4.5`：响应超限时的回调（本仓：一行审计）—— 同 `onRelayFailure`：`relay` 不碰 `db`。 */
    readonly onResponseCapped?: (info: ResponseCapInfo) => void;
  } = {},
): Promise<void> {
  reply.hijack(); // 交给 SDK 直接写 Node 的 ServerResponse（SSE 等流式响应需要）

  /**
   * `4.5` 背压包装：边转发边计字节 —— 超限即**停止转发**；头**未**发出时回 `502` +
   * `RESPONSE_TOO_LARGE`，头**已**发出（SSE 中途）时只能**截断**流（由包装自己结束）。
   */
  const capped = capResponseBytes(reply.raw, opts.responseMaxBytes, (info) => {
    opts.onResponseCapped?.(info);
    if (!info.headersSent) {
      reply.raw.statusCode = 502;
      reply.raw.setHeader('content-type', 'application/json; charset=utf-8');
      reply.raw.end(
        JSON.stringify({
          error: BRIDGE_ERROR_CODES.responseTooLarge,
          message: RESPONSE_TOO_LARGE_MESSAGE,
          limit: info.maxBytes,
          sent: info.sentBytes,
        }),
      );
    }
  });

  try {
    // 注意：**不在此处包超时**。`StreamableHTTPServerTransport.handleRequest` 把响应交给
    // 异步流后立即返回 ⇒ 用 `Promise.race` 包它做超时是无效的（实测：客户端仍会等到上游响应）。
    // 上游超时由 `createBridgeTransport` 的 `upstreamRequestTimeoutMs` 加在**上游请求**上，
    // 以 MCP 层错误返回（见 `transport.ts` 的说明）。
    await session.transport.handleRequest(request.raw, capped, request.body);
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


