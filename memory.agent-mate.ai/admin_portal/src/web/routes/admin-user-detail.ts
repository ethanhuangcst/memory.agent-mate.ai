/**
 * 用户详情页 —— `/admin/users/:handle`（`S2` 的操作面）。
 *
 * 两个刻意的设计：
 *  1. **明文只在本次响应里出现一次**：签发/轮换成功后直接渲染本页并带上 `issuedToken`，
 *     不 303 回跳（否则要么明文进 URL/历史，要么再取一次明文 —— 两者都违反 AC2.1）；
 *  2. **对话框由查询参数驱动**（`?dialog=issue|rotate|revoke|deactivate&prefix=…`），
 *     因此无 JS 也能完成全部动作，且「二次确认复述目标」的语义由服务端渲染保证。
 */

import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatTimestamp, memoryIdentityOf } from '../../shared/format';
import { countActiveKeysForUser, listKeysByUser, type KeyRow } from '../db/repo/keys';
import { findUserByHandle } from '../db/repo/users';
import {
  adminShell,
  requestedLocale,
  rememberLocale,
  sendHtml,
  type PageDeps,
} from '../pages';

export type DetailDialog = 'issue' | 'rotate' | 'revoke' | 'deactivate' | 'restore';

export interface UserDetailOptions {
  readonly errorKey?: string | null;
  readonly issuedToken?: string | null;
  readonly dialog?: DetailDialog | null;
  readonly dialogPrefix?: string | null;
}

export function detailPath(handle: string): string {
  return `/admin/users/${encodeURIComponent(handle)}`;
}

async function renderNotFound(
  deps: PageDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<FastifyReply> {
  const locale = requestedLocale(deps, request);
  rememberLocale(reply, request, locale);
  const shell = adminShell(deps, {
    request,
    locale,
    titleKey: 'detail.error.userNotFound',
    active: 'users',
  });
  reply.code(404);
  return sendHtml(reply, deps, 'placeholder.njk', {
    ...shell,
    pageTitleKey: 'detail.error.userNotFound',
    pageBodyKey: 'detail.error.userNotFound',
  });
}

export async function renderUserDetail(
  deps: PageDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  handle: string,
  options: UserDetailOptions = {},
): Promise<FastifyReply> {
  const user = findUserByHandle(deps.db, handle);
  if (!user) return renderNotFound(deps, request, reply);

  const locale = requestedLocale(deps, request);
  rememberLocale(reply, request, locale);

  const query = (request.query ?? {}) as Record<string, unknown>;
  const dialog =
    options.dialog !== undefined
      ? options.dialog
      : typeof query.dialog === 'string' &&
          ['issue', 'rotate', 'revoke', 'deactivate', 'restore'].includes(query.dialog)
        ? (query.dialog as DetailDialog)
        : null;
  const dialogPrefix =
    options.dialogPrefix ??
    (typeof query.prefix === 'string' && /^memo_[A-Za-z0-9_-]{8}$/.test(query.prefix) ? query.prefix : null);

  const keyDirectory = path.join(deps.cfg.usersRoot, user.handle, 'keys');
  const tokens = listKeysByUser(deps.db, user.id).map((row: KeyRow) => ({
    prefix: row.key_prefix,
    label: row.label ?? '—',
    createdAt: formatTimestamp(row.created_at),
    lastUsedAt: formatTimestamp(row.last_used_at),
    active: row.revoked_at === null,
  }));

  const shell = adminShell(deps, {
    request,
    locale,
    titleKey: 'detail.eyebrow',
    active: 'users',
    query: dialog
      ? { dialog, prefix: dialogPrefix ?? undefined }
      : {},
  });

  return sendHtml(reply, deps, 'admin-user-detail.njk', {
    ...shell,
    detailPath: detailPath(user.handle),
    user: {
      handle: user.handle,
      dbPath: path.join(deps.cfg.usersRoot, user.handle, 'ai-memory.db'),
      keyDir: keyDirectory,
      identity: memoryIdentityOf(user.handle),
      createdAt: formatTimestamp(user.created_at),
      active: user.status === 'active',
      activeTokenCount: countActiveKeysForUser(deps.db, user.id),
    },
    tokens,
    errorKey: options.errorKey ?? null,
    issuedToken: options.issuedToken ?? null,
    dialog,
    dialogPrefix,
    dialogLabel: '',
  });
}

export async function registerAdminUserDetailRoutes(
  app: FastifyInstance,
  deps: PageDeps,
): Promise<void> {
  app.get('/admin/users/:handle', async (request, reply) => {
    const { handle } = request.params as { handle: string };
    return renderUserDetail(deps, request, reply, handle);
  });
}
