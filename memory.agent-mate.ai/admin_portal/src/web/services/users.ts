/**
 * 建用户服务 —— `S1`（`AC1.1`–`AC1.7`）。
 *
 * 顺序刻意如此：
 *   校验 handle → 查重 → **一个事务内**（建目录 → 插用户 → 写审计）。
 * 目录操作放在事务内不是「事务能回滚文件系统」，而是保证**任何失败都不留下可用用户**：
 * 目录建失败 ⇒ 事务抛错回滚（无用户行、无成功审计）；插用户失败 ⇒ **仅当目录由本次创建**时
 * 才清理，否则并发失败方会删掉对手刚建好的目录。
 *
 * 失败一律**不写审计**（`AC1.6` / `AC2.9`：失败不得产生虚假的成功记录）。
 * 失败只回 **i18n 键**，不产出用户可见文案（文案真源在四语言词表，§12.4 纪律）。
 */

import type Database from 'better-sqlite3';
import { withAudit } from '../../shared/audit';
import {
  ensureUserDirectory,
  inspectUserDirectory,
  removeDirectoryIfEmpty,
  userDirectory,
  validateHandle,
  type HandleInvalidReason,
} from '../../shared/handle';
import {
  activateUser,
  findUserByHandle,
  getUserById,
  insertUser,
  type UserRow,
} from '../db/repo/users';

export type CreateUserFailureReason =
  | 'invalid-handle'
  | 'handle-exists'
  | 'directory-failed'
  | 'store-failed';

export interface CreateUserFailure {
  readonly ok: false;
  readonly reason: CreateUserFailureReason;
  /** i18n 键（四语言词表在 `src/web/i18n/*.json`）。 */
  readonly messageKey: string;
  /** 仅供日志与调试的结构化上下文（**不得直接渲染**）。 */
  readonly context?: Record<string, unknown>;
}

export type CreateUserResult =
  | { readonly ok: true; readonly user: UserRow; readonly directory: string }
  | CreateUserFailure;

export interface CreateUserDeps {
  readonly db: Database.Database;
  readonly usersRoot: string;
  /** 触发者身份（审计 actor）：Cloudflare Access 断言中的邮箱。 */
  readonly actor: string;
  readonly sourceIp?: string | null;
  readonly logger?: { error(obj: Record<string, unknown>, msg: string): void };
}

export interface CreateUserInput {
  readonly handle: string;
  readonly displayName?: string | null;
}

const HANDLE_MESSAGE_KEY: Record<HandleInvalidReason, string> = {
  empty: 'users.error.handle.empty',
  traversal: 'users.error.handle.traversal',
  'too-long': 'users.error.handle.tooLong',
  pattern: 'users.error.handle.pattern',
};

export function createUser(deps: CreateUserDeps, input: CreateUserInput): CreateUserResult {
  const { db, usersRoot, actor, sourceIp, logger } = deps;

  const validation = validateHandle(input.handle);
  if (!validation.ok) {
    return {
      ok: false,
      reason: 'invalid-handle',
      messageKey: HANDLE_MESSAGE_KEY[validation.reason],
      context: { handle: input.handle, handleReason: validation.reason },
    };
  }
  const handle = validation.handle;

  if (findUserByHandle(db, handle)) {
    return {
      ok: false,
      reason: 'handle-exists',
      messageKey: 'users.error.handleExists',
      context: { handle },
    };
  }

  const directory = userDirectory(usersRoot, handle);
  // 关键：区分「本次创建」与「本来就在」—— 并发失败方不得删除对方刚建好的目录
  const existedBefore = inspectUserDirectory(directory).exists;
  let directoryCreated = false;

  try {
    const user = withAudit(
      db,
      { actor, action: 'create_user', target: handle, detail: { handle }, sourceIp: sourceIp ?? null },
      () => {
        // 目录先建：库路径的父目录必须存在（SQLite 不创建父目录，§4.2）
        ensureUserDirectory(directory);
        directoryCreated = true;
        return insertUser(db, {
          handle,
          displayName: input.displayName ?? null,
        });
      },
    );
    return { ok: true, user, directory };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (directoryCreated && !existedBefore) removeDirectoryIfEmpty(directory);
    logger?.error(
      { event: 'create_user_failed', handle, actor, existedBefore, reason: message },
      'create_user_failed',
    );
    const isStore = /UNIQUE|constraint/i.test(message);
    return {
      ok: false,
      reason: isStore ? 'handle-exists' : 'directory-failed',
      messageKey: isStore ? 'users.error.handleExists' : 'users.error.directory',
      context: { handle, existedBefore },
    };
  }
}

export type RestoreUserResult =
  | { readonly ok: true; readonly user: UserRow }
  | { readonly ok: false; readonly reason: 'user-not-found' | 'store-failed'; readonly messageKey: string };

/**
 * 恢复访问（`D13` 的可逆侧）：把停用用户带回 active 并清掉 `revoked_at`。
 *
 * 为什么是**独立动作**、而不是「签发令牌顺带恢复」：签发按钮的语义是「给这个用户发一把新钥匙」，
 * 不该隐含改变账号状态 —— 服务端行为与 UI 文案脱节时，用户看到的就是「停用了还能签发」这种反直觉结果
 * （2026-09-22 用户决定）。恢复**不签发**任何令牌：恢复之后由管理员正常签发，审计也分两条记，便于追溯。
 *
 * 幂等：对已 active 的用户调用视为成功（双击/重复提交不构成错误）。
 */
export function restoreUser(deps: CreateUserDeps, input: { handle: string }): RestoreUserResult {
  const { db, actor, sourceIp, logger } = deps;
  const user = findUserByHandle(db, input.handle);
  if (!user) {
    return { ok: false, reason: 'user-not-found', messageKey: 'detail.error.userNotFound' };
  }
  if (user.status === 'active') return { ok: true, user };

  try {
    const restored = withAudit(
      db,
      {
        actor,
        action: 'restore_user',
        target: user.handle,
        detail: { handle: user.handle },
        sourceIp: sourceIp ?? null,
      },
      () => {
        activateUser(db, user.handle);
        return getUserById(db, user.id) as UserRow;
      },
    );
    return { ok: true, user: restored };
  } catch (error) {
    logger?.error(
      {
        event: 'restore_user_failed',
        handle: user.handle,
        actor,
        reason: error instanceof Error ? error.message : String(error),
      },
      'restore_user_failed',
    );
    return { ok: false, reason: 'store-failed', messageKey: 'detail.error.directory' };
  }
}
