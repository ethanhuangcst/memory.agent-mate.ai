/**
 * 令牌生命周期服务 —— `S2`（`AC2.1`–`AC2.9`）与 `D13` 的用户停用。
 *
 * 三条不变量（都在**单事务**内满足；审计与业务写同事务，见 shared/audit.ts）：
 *  1. **明文只出现一次**：只有 `issueKey` / `rotateKey` 的返回值携带明文，任何列出/查询都不返回；
 *  2. **吊销即失效**：`revoked_at` 一落库，`verifyToken` 立刻判否，且**没有任何路径能让它复活**
 *     （轮换/吊销只写 `revoked_at`，全库没有清空该字段的语句）；
 *  3. **失败不留痕**：对不存在的令牌执行轮换/吊销 ⇒ 明确拒绝、不签发新令牌、不写审计（`AC2.9`）。
 *
 * 失败只回 **i18n 键**与结构化上下文，不产出用户可见文案（§12.4 纪律）。
 */

import type Database from 'better-sqlite3';
import { withAudit } from '../../shared/audit';
import { ensureUserDirectory, userDirectory } from '../../shared/handle';
import {
  hashesEqual,
  hashToken,
  isWellFormedToken,
  mintToken,
  type MintedToken,
} from '../../shared/tokens';
import {
  countActiveKeysForUser,
  findKeyByHash,
  findKeyByPrefix,
  insertKey,
  listKeysByUser,
  revokeActiveKeysForUser,
  revokeKeyById,
  type KeyRow,
} from '../db/repo/keys';
import {
  disableUser,
  findUserByHandle,
  getUserById,
  type UserRow,
} from '../db/repo/users';

export interface KeyServiceDeps {
  readonly db: Database.Database;
  readonly usersRoot: string;
  /** 审计 actor：Cloudflare Access 断言中的邮箱。 */
  readonly actor: string;
  readonly sourceIp?: string | null;
  readonly logger?: { error(obj: Record<string, unknown>, msg: string): void };
}

export type KeyFailure =
  | 'user-not-found'
  | 'user-disabled'
  | 'key-not-found'
  | 'key-not-active'
  | 'directory-failed'
  | 'already-disabled';

/** 失败结果：只回键与上下文，用户可见文案由模板从四语言词表取。 */
export interface KeyFailureResult {
  readonly ok: false;
  readonly reason: KeyFailure;
  readonly messageKey: string;
  readonly context?: Record<string, unknown>;
}

export type IssueKeyResult =
  | { readonly ok: true; readonly user: UserRow; readonly key: KeyRow; readonly plaintext: string }
  | KeyFailureResult;

export type KeyActionResult =
  | { readonly ok: true; readonly user: UserRow; readonly key: KeyRow }
  | KeyFailureResult;

export type RotateKeyResult =
  | {
      readonly ok: true;
      readonly user: UserRow;
      readonly revokedKey: KeyRow;
      readonly key: KeyRow;
      readonly plaintext: string;
    }
  | KeyFailureResult;

export type DeactivateResult =
  | { readonly ok: true; readonly user: UserRow; readonly revokedKeyCount: number }
  | KeyFailureResult;

const FAILURE_MESSAGE_KEY: Record<KeyFailure, string> = {
  'user-not-found': 'detail.error.userNotFound',
  'user-disabled': 'detail.error.userDisabled',
  'key-not-found': 'detail.error.keyNotFound',
  'key-not-active': 'detail.error.keyNotActive',
  'directory-failed': 'detail.error.directory',
  'already-disabled': 'detail.error.alreadyDisabled',
};

function fail(reason: KeyFailure, context?: Record<string, unknown>): KeyFailureResult {
  const base = { ok: false as const, reason, messageKey: FAILURE_MESSAGE_KEY[reason] };
  return context ? { ...base, context } : base;
}

/** 列出某用户的令牌元信息（**不含明文**，AC2.4）。 */
export function listKeysForUser(db: Database.Database, handle: string): KeyRow[] | undefined {
  const user = findUserByHandle(db, handle);
  if (!user) return undefined;
  return listKeysByUser(db, user.id);
}

/**
 * 签发令牌（AC2.1 / AC2.3）。
 * 目录**幂等确保存在**（`AC2.3`），但**不创建库文件**（库由首次会话创建，§4.2）。
 *
 * **停用用户不得签发**（2026-09-22 用户决定）：停用的语义是「拒绝新会话」；
 * 若签发顺带把状态改回 active，等于把「签发按钮」变成隐式恢复入口 ——
 * 按钮文案与副作用脱节，用户无从预期（实测就是这个表现）。
 * 恢复改走**独立动作** `restoreUser`，D13 的「可逆」仍然成立。
 */
export function issueKey(
  deps: KeyServiceDeps,
  input: { handle: string; label?: string | null },
): IssueKeyResult {
  const { db, usersRoot, actor, sourceIp, logger } = deps;
  const user = findUserByHandle(db, input.handle);
  if (!user) return fail('user-not-found', { handle: input.handle });
  if (user.status === 'disabled') return fail('user-disabled', { handle: user.handle });

  const directory = userDirectory(usersRoot, user.handle);
  const minted: MintedToken = mintToken();

  try {
    const key = withAudit(
      db,
      {
        actor,
        action: 'issue_key',
        target: `${user.handle}:${minted.keyPrefix}`,
        detail: {
          handle: user.handle,
          key_prefix: minted.keyPrefix,
          label: input.label ?? null,
        },
        sourceIp: sourceIp ?? null,
      },
      () => {
        ensureUserDirectory(directory, { idempotent: true });
        return insertKey(db, {
          userId: user.id,
          keyHash: minted.keyHash,
          keyPrefix: minted.keyPrefix,
          label: input.label ?? null,
        });
      },
    );
    return {
      ok: true,
      user: getUserById(db, user.id) as UserRow,
      key,
      plaintext: minted.plaintext,
    };
  } catch (error) {
    logger?.error(
      {
        event: 'issue_key_failed',
        handle: user.handle,
        actor,
        reason: error instanceof Error ? error.message : String(error),
      },
      'issue_key_failed',
    );
    return fail('directory-failed', { handle: user.handle });
  }
}

/** 轮换：吊销旧 + 签发新；旧令牌不可复活（AC2.5）。 */
export function rotateKey(
  deps: KeyServiceDeps,
  input: { handle: string; keyPrefix: string; label?: string | null },
): RotateKeyResult {
  const { db, usersRoot, actor, sourceIp, logger } = deps;
  const user = findUserByHandle(db, input.handle);
  if (!user) return fail('user-not-found', { handle: input.handle });

  const oldKey = findKeyByPrefix(db, user.id, input.keyPrefix);
  if (!oldKey) return fail('key-not-found', { keyPrefix: input.keyPrefix });
  if (oldKey.revoked_at !== null) return fail('key-not-active', { keyPrefix: input.keyPrefix });

  const directory = userDirectory(usersRoot, user.handle);
  const minted = mintToken();
  const at = new Date().toISOString();

  try {
    const newKey = withAudit(
      db,
      {
        actor,
        action: 'rotate_key',
        target: `${user.handle}:${oldKey.key_prefix}`,
        detail: { handle: user.handle, old_prefix: oldKey.key_prefix, new_prefix: minted.keyPrefix },
        sourceIp: sourceIp ?? null,
      },
      () => {
        ensureUserDirectory(directory, { idempotent: true });
        if (!revokeKeyById(db, oldKey.id, at)) throw new Error('旧令牌吊销失败');
        return insertKey(db, {
          userId: user.id,
          keyHash: minted.keyHash,
          keyPrefix: minted.keyPrefix,
          label: input.label ?? oldKey.label,
          createdAt: at,
        });
      },
    );

    return {
      ok: true,
      user,
      revokedKey: { ...oldKey, revoked_at: at },
      key: newKey,
      plaintext: minted.plaintext,
    };
  } catch (error) {
    logger?.error(
      {
        event: 'rotate_key_failed',
        handle: user.handle,
        actor,
        keyPrefix: oldKey.key_prefix,
        reason: error instanceof Error ? error.message : String(error),
      },
      'rotate_key_failed',
    );
    return fail('directory-failed', { handle: user.handle, keyPrefix: oldKey.key_prefix });
  }
}

/** 吊销：软吊销（置 `revoked_at`，行与审计链保留，AC2.6）。 */
export function revokeKey(
  deps: KeyServiceDeps,
  input: { handle: string; keyPrefix: string },
): KeyActionResult {
  const { db, actor, sourceIp } = deps;
  const user = findUserByHandle(db, input.handle);
  if (!user) return fail('user-not-found', { handle: input.handle });

  const key = findKeyByPrefix(db, user.id, input.keyPrefix);
  if (!key) return fail('key-not-found', { keyPrefix: input.keyPrefix });
  if (key.revoked_at !== null) return fail('key-not-active', { keyPrefix: input.keyPrefix });

  const at = new Date().toISOString();
  withAudit(
    db,
    {
      actor,
      action: 'revoke_key',
      target: `${user.handle}:${key.key_prefix}`,
      detail: { handle: user.handle, key_prefix: key.key_prefix },
      sourceIp: sourceIp ?? null,
    },
    () => {
      if (!revokeKeyById(db, key.id, at)) throw new Error('令牌吊销失败');
      return undefined;
    },
  );

  return { ok: true, user, key: { ...key, revoked_at: at } };
}

/** 停用用户：一次性吊销全部令牌 + 置 disabled；**库文件保留**（D13 / TC-P-L2-11）。 */
export function deactivateUser(deps: KeyServiceDeps, input: { handle: string }): DeactivateResult {
  const { db, actor, sourceIp } = deps;
  const user = findUserByHandle(db, input.handle);
  if (!user) return fail('user-not-found', { handle: input.handle });
  if (user.status === 'disabled') return fail('already-disabled', { handle: input.handle });

  const at = new Date().toISOString();
  const revokedKeyCount = withAudit(
    db,
    {
      actor,
      action: 'deactivate_user',
      target: user.handle,
      detail: { handle: user.handle, revoked_keys: countActiveKeysForUser(db, user.id) },
      sourceIp: sourceIp ?? null,
    },
    () => {
      const count = revokeActiveKeysForUser(db, user.id, at);
      if (!disableUser(db, user.handle, at)) throw new Error('用户停用失败');
      return count;
    },
  );

  return { ok: true, user: getUserById(db, user.id) as UserRow, revokedKeyCount };
}

export type TokenVerifyReason =
  | 'missing'
  | 'malformed'
  | 'unknown'
  | 'revoked'
  | 'user-disabled'
  | 'unknown-user';

export type TokenVerifyResult =
  | { readonly ok: true; readonly user: UserRow; readonly key: KeyRow }
  | { readonly ok: false; readonly reason: TokenVerifyReason };

/**
 * 令牌校验（`AC2.2` / `AC2.7`）—— 接入批次（PSP-W2）在 `/mcp` 上消费同一个函数。
 *
 * 顺序：形状 → sha256 → **唯一索引一次命中** → 常时比较摘要 → 状态判定。
 * 认证判定完全不看 `key_prefix`（它只用于展示），故不存在「前缀不匹配提前返回」的时序旁路。
 * 注意：对客户端的应答必须与具体原因解耦（统一 401），否则原因会变成枚举探针（W2 落实）。
 */
export function verifyToken(db: Database.Database, bearer: unknown): TokenVerifyResult {
  if (typeof bearer !== 'string' || bearer.length === 0) return { ok: false, reason: 'missing' };
  if (!isWellFormedToken(bearer)) return { ok: false, reason: 'malformed' };

  const digest = hashToken(bearer);
  const key = findKeyByHash(db, digest);
  if (!key) return { ok: false, reason: 'unknown' };
  if (!hashesEqual(key.key_hash, digest)) return { ok: false, reason: 'unknown' };

  const user = getUserById(db, key.user_id);
  if (!user) return { ok: false, reason: 'unknown-user' };
  if (key.revoked_at !== null) return { ok: false, reason: 'revoked' };
  if (user.status === 'disabled') return { ok: false, reason: 'user-disabled' };

  return { ok: true, user, key };
}
