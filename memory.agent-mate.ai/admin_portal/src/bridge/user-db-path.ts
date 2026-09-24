/**
 * spawn 前置的 **fail-closed 路径断言** —— 模板不变量 1 / 2 的落地（Sprint 4 `3.2`）。
 *
 * 契约真源：`specs/mcp/mcp-design.md` §5.6.4 的「强制不变量」·
 * `specs/web-portal/web-design.md` §12.5 的「spawn 前断言失败 → **500** `spawn_assertion_failed`」行。
 *
 * ## 为什么判定抽成**纯函数**
 *
 * 五支判定里有两支**在集成层不可达**：`empty`（模板是内建常量，渲染不出空路径）与
 * `invalid_handle`（不合规 handle 在签发链路就被 `userDirectory()` 拦下）。判定若埋在
 * `spawnUpstream` 内部，这两支永远测不到 ⇒ 抽出来后五支全部可由单测直接命中。
 * 这与 `route.ts` 的 `classifyRelayFailure` 是同一个手法（可测性来自「接缝」）。
 *
 * ## 为什么必须**归一化之后**判定
 *
 * `AI_MEMORY_DB` 的渲染只是**字符串替换**（`launch-template.ts` 的 `substituteHandle`），
 * 于是「含该 handle」这句话在未归一化的路径上几乎恒真。实测（§5.6.4 的附表）：
 *
 * | `handle` | 渲染出的路径 | 字面三项 | 归一化后 |
 * |---|---|---|---|
 * | `alice/../bob` | `/data/users/alice/../bob/ai-memory.db` | **三过** | `/data/users/bob/ai-memory.db`（**他人库**） |
 * | `../bob` | `/data/users/../bob/ai-memory.db` | **三过** | `/data/bob/ai-memory.db`（越界） |
 * | `../../x` | `/data/users/../../x/ai-memory.db` | **三过** | `/x/ai-memory.db`（越界） |
 *
 * ⇒ 判定写在归一化之前**等于没判**：`alice/../bob` 那条会**静默串到他人库**，正是 `AC4.7` 要拦的形态。
 *
 * ## 为什么不单独断言 `AI_MEMORY_KEY_DIR`
 *
 * 它与 `AI_MEMORY_DB` **同源同 handle**（模板里同一处 `{handle}` 替换）⇒ DB 三项一过，
 * KEY_DIR 必然也在该用户目录下；且它的字面值已被三处测试锁住
 * （`tests/unit/launch-template.test.ts` 的「四项键逐字一致 + 长度为 4」· 同文件的渲染断言 ·
 * `tests/integration/mcp-bridge.test.ts` 的 env dump 断言）⇒ 单独再断言一遍没有信息增量。
 */

import path from 'node:path';
import { validateHandle } from '../shared/handle';

/** 用户库路径的前缀（模板里 `AI_MEMORY_DB` 的固定前缀，见 §5.6.4）。 */
const USERS_ROOT_PREFIX = '/data/users/';

/**
 * 断言失败的原因枚举 —— 同时是审计 `detail.reason` 的**取值域**。
 *
 * **不含路径**：路径里可能含**他人 handle**，把路径写进本用户的审计行等于把他人身份
 * 落进可检索的审计面（`web-design.md` §12.5 的 `3.2` 定档）。
 */
export type UserDbPathFailure =
  /** `AI_MEMORY_DB` 为空（含缺键）。 */
  | 'empty'
  /** 归一化后不以 `/data/users/` 开头（越出 users 根）。 */
  | 'outside_users_root'
  /** 归一化后不含该 handle —— 含「指向**他人**库」这一情形。 */
  | 'handle_mismatch'
  /** `handle` 本身不合法（不变量 1 的 spawn 侧复述）。 */
  | 'invalid_handle';

export type UserDbPathCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: UserDbPathFailure };

/**
 * 判定 `AI_MEMORY_DB` 是否**确实是该 `handle` 的**库路径。
 *
 * 顺序固定：**先校验 `handle`**（不变量 1，复用真源 `validateHandle`），**再**在
 * `path.posix.normalize` 之后判不变量 2 的三项（非空 · 以 `/data/users/` 开头 · 含该 handle）。
 *
 * **用 `path.posix.normalize` 而不是 `path.resolve` 或 `path.normalize`**：目标是**容器内**的
 * 绝对 posix 路径，`resolve` 会把本机 cwd 掺进来（门户跑在 macOS 上），而 posix 变体与运行平台无关。
 */
export function checkUserDbPath(dbPath: string | undefined, handle: string): UserDbPathCheck {
  // 不变量 1 的 spawn 侧复述：**复用真源**，不在这里重写 `HANDLE_PATTERN` 之类的规则。
  // 理由（§5.6.4）：`users` 表的 INSERT 只有一条路径（repo 的 `insertUser`，不做校验），
  // `validateHandle` 只在服务层 `createUser` 里被调用 ⇒ 绕过服务层的写入会留下不合规 handle；
  // 而 `handle=''` 一旦到 spawn，库会落到 `/data/users/ai-memory.db`（users 根下的**共享库**）。
  if (!validateHandle(handle).ok) return { ok: false, reason: 'invalid_handle' };

  // 「空」必须在归一化**之前**判：`path.posix.normalize('')` 是 `'.'`，归一化后判会误报成越界。
  if (dbPath === undefined || dbPath.length === 0) return { ok: false, reason: 'empty' };

  const normalized = path.posix.normalize(dbPath);
  if (!normalized.startsWith(USERS_ROOT_PREFIX)) {
    return { ok: false, reason: 'outside_users_root' };
  }
  if (!normalized.includes(handle)) return { ok: false, reason: 'handle_mismatch' };
  return { ok: true };
}

/**
 * 把 `reason` 挂到**裸 `Error`** 上（本仓既有的错误风格：零错误子类、零 `catch` 内
 * `instanceof` 分流 ⇒ 与 `route.ts` 读 `error.code` 的既有先例同构），供 `route.ts` 在**同一个**
 * `catch` 里把「断言失败（500）」与「上游起不来（503）」分开。
 *
 * 消息里**只出现原因枚举**，不出现任何路径 —— 调用方可能会把它写进日志，
 * 而日志同样不该落下他人 handle（§12.5 定档）。
 */
export function spawnAssertionError(reason: UserDbPathFailure): Error {
  return Object.assign(new Error(`spawn 前置断言失败：${reason}`), { reason });
}

/**
 * 断言失败时**对客户端**的可读说明（唯一出口，见 §12.5 的「客户端文案用同一句」定档）。
 *
 * **一句覆盖两种负向 AC**：`AC4.4` 只要求「拒绝并告警」、`AC4.7` 要求「理由指出与 handle 不匹配」
 * ⇒ 说明里同时提「缺失」与「不匹配」即可同时满足，且**不需要**用路径去解释（路径不对外）。
 */
export const SPAWN_ASSERTION_MESSAGE =
  "The session was refused before the upstream process was started: the launch template's database path is missing or does not match the authenticated handle.";
