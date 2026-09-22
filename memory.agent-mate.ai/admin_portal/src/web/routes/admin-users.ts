/**
 * 用户列表页 —— `/admin/users`（`S1` 的管理面入口）。
 *
 * 渲染函数导出给 `admin-api` 复用：表单 POST 失败时**直接重渲染本页并带错误条**，
 * 而不是 303 回跳（避免把错误信息塞进 URL，也避免「回跳后错误消失」）。
 */

import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { formatTimestamp } from '../../shared/format';
import { countUsers, listUsers } from '../db/repo/users';
import { adminShell, requestedLocale, rememberLocale, sendHtml, type PageDeps } from '../pages';

export const PAGE_SIZE = 20;
export const USERS_PATH = '/admin/users';

export interface UserListOptions {
  readonly errorKey?: string | null;
  readonly handleValue?: string;
  readonly handleInvalid?: boolean;
  readonly dialogOpen?: boolean;
}

export async function renderUserList(
  deps: PageDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  options: UserListOptions = {},
): Promise<FastifyReply> {
  const locale = requestedLocale(deps, request);
  rememberLocale(reply, request, locale);

  const query = (request.query ?? {}) as Record<string, unknown>;
  const requested =
    typeof query.page === 'string' && /^\d+$/.test(query.page) ? Number.parseInt(query.page, 10) : 1;

  const total = countUsers(deps.db);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, requested), pageCount);
  const offset = (page - 1) * PAGE_SIZE;

  const users = listUsers(deps.db, { limit: PAGE_SIZE, offset }).map((row) => ({
    handle: row.handle,
    dbPath: path.join(deps.cfg.usersRoot, row.handle, 'ai-memory.db'),
    tokenCount: row.key_count,
    createdAt: formatTimestamp(row.created_at),
    active: row.status === 'active',
  }));

  const dialogOpen = options.dialogOpen ?? query.new === '1';
  const shell = adminShell(deps, {
    request,
    locale,
    titleKey: 'users.title',
    active: 'users',
    query: {
      page: page > 1 ? String(page) : undefined,
      new: dialogOpen ? '1' : undefined,
    },
  });

  return sendHtml(reply, deps, 'admin-users.njk', {
    ...shell,
    basePath: USERS_PATH,
    usersRoot: deps.cfg.usersRoot,
    // 弹窗里只显示可读尾段（`…/users/<用户名>/`），完整绝对路径放进 `title` —— Issue 3 的显示口径修法
    usersRootTail: path.basename(deps.cfg.usersRoot),
    users,
    total,
    page,
    from: total === 0 ? 0 : offset + 1,
    to: Math.min(offset + PAGE_SIZE, total),
    prevHref: page > 1 ? `${USERS_PATH}?page=${page - 1}` : null,
    nextHref: page < pageCount ? `${USERS_PATH}?page=${page + 1}` : null,
    errorKey: options.errorKey ?? null,
    dialogOpen,
    handleValue: options.handleValue ?? '',
    handleInvalid: options.handleInvalid ?? false,
  });
}

export async function registerAdminUserRoutes(app: FastifyInstance, deps: PageDeps): Promise<void> {
  app.get(USERS_PATH, async (request, reply) => renderUserList(deps, request, reply));
}
