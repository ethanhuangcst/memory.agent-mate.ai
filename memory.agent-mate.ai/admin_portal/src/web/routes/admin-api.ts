/**
 * 管理面 API —— `/admin/api/*`（§12.3 的「管理面 API」行）。
 *
 * 同一个端点服务两种客户端：
 *  - **HTML 表单**（无 JS 可用）：失败直接重渲染带错误条的页面；成功按 PRG 303 回跳，
 *    唯独「签发 / 轮换」不回跳 —— 明文只允许出现在本次响应里（AC2.1）；
 *  - **JSON 客户端**：统一的错误体 `{ error, messageKey }`，明文只在签发响应里出现。
 *
 * 所有写操作都经服务层（单事务 + fail-closed 审计），本层只做参数校验、状态码映射与渲染。
 */

import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createUser, restoreUser } from '../services/users';
import { deactivateUser, issueKey, revokeKey, rotateKey } from '../services/keys';
import { requestedLocale, type PageDeps } from '../pages';
import { detailPath, renderUserDetail } from './admin-user-detail';
import { renderUserList, USERS_PATH } from './admin-users';
import { serializeCookie } from '../../shared/cookies';
import { ISSUED_COOKIE, put as stashIssued } from '../issued-stash';

const CreateUserBody = z.object({
  handle: z.string(),
  displayName: z.string().min(1).optional(),
});

const TokenActionBody = z.object({
  action: z.enum(['issue', 'rotate', 'revoke']),
  label: z.string().optional(),
  prefix: z.string().optional(),
});

const DeactivateBody = z.object({ confirm: z.string().optional() });

/** 表单请求判据：URL 编码体，或显式带 `returnTo=html`。 */
function wantsHtml(request: FastifyRequest): boolean {
  const contentType = String(request.headers['content-type'] ?? '');
  if (contentType.includes('application/x-www-form-urlencoded')) return true;
  const body = request.body as Record<string, unknown> | undefined;
  return body?.returnTo === 'html';
}

function actorOf(request: FastifyRequest): string {
  const identity = request.adminIdentity;
  if (!identity) {
    // 守卫保证管理面路径必有身份；这里再 fail-closed 一次，绝不回落到「无 actor 写审计」
    throw new Error('缺少管理面身份（守卫未生效）');
  }
  return identity.email;
}

/** 失败原因 → HTTP 状态码（「找不到」与「参数/状态不允许」分开）。 */
function statusFor(reason: string): number {
  if (reason === 'user-not-found' || reason === 'key-not-found') return 404;
  return 400;
}

function serviceDeps(deps: PageDeps, request: FastifyRequest) {
  return {
    db: deps.db,
    usersRoot: deps.cfg.usersRoot,
    actor: actorOf(request),
    sourceIp: request.ip,
    logger: request.log,
  };
}

export async function registerAdminApiRoutes(app: FastifyInstance, deps: PageDeps): Promise<void> {
  // ---- 建用户 ----
  app.post('/admin/api/users', async (request, reply) => {
    const html = wantsHtml(request);
    const parsed = CreateUserBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      if (html) {
        reply.code(400);
        return renderUserList(deps, request, reply, {
          errorKey: 'users.error.handle.pattern',
          dialogOpen: true,
        });
      }
      return reply.code(400).send({ error: 'invalid-body', messageKey: 'users.error.handle.pattern' });
    }

    const result = createUser(serviceDeps(deps, request), {
      handle: parsed.data.handle,
      displayName: parsed.data.displayName ?? null,
    });

    if (!result.ok) {
      request.log.warn(
        { event: 'create_user_rejected', reason: result.reason, context: result.context },
        'create_user_rejected',
      );
      if (html) {
        reply.code(statusFor(result.reason));
        return renderUserList(deps, request, reply, {
          errorKey: result.messageKey,
          handleValue: parsed.data.handle,
          dialogOpen: true,
        });
      }
      return reply.code(statusFor(result.reason)).send({
        error: result.reason,
        messageKey: result.messageKey,
      });
    }

    // PRG：建完跳该用户详情页，列表里立刻能看到新行
    if (html) return reply.redirect(detailPath(result.user.handle), 303);
    return reply.code(201).send({
      handle: result.user.handle,
      status: result.user.status,
      createdAt: result.user.created_at,
    });
  });

  // ---- 令牌：签发 / 轮换 / 吊销 ----
  app.post('/admin/api/users/:handle/tokens', async (request, reply) => {
    const html = wantsHtml(request);
    const { handle } = request.params as { handle: string };
    const parsed = TokenActionBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      if (html) {
        reply.code(400);
        return renderUserDetail(deps, request, reply, handle, {
          errorKey: 'detail.error.keyNotFound',
        });
      }
      return reply.code(400).send({ error: 'invalid-body', messageKey: 'detail.error.keyNotFound' });
    }

    const { action, label, prefix } = parsed.data;
    if (action !== 'issue' && !prefix) {
      if (html) {
        reply.code(400);
        return renderUserDetail(deps, request, reply, handle, {
          errorKey: 'detail.error.keyNotFound',
        });
      }
      return reply.code(400).send({ error: 'missing-prefix', messageKey: 'detail.error.keyNotFound' });
    }

    const service = serviceDeps(deps, request);

    if (action === 'issue') {
      const result = issueKey(service, { handle, label: label ?? null });
      if (!result.ok) {
        if (html) {
          reply.code(statusFor(result.reason));
          return renderUserDetail(deps, request, reply, handle, { errorKey: result.messageKey });
        }
        return reply
          .code(statusFor(result.reason))
          .send({ error: result.reason, messageKey: result.messageKey });
      }
      if (html) {
        // 方案 D（Issue 4 根治）：明文**不留在本次响应**里，而是短期暂存（60 秒、一次性），
        // 用 cookie 带一个引用 **303 跳回详情页**渲染 —— 地址栏干净，刷新拿不到第二次。
        // 明文仍不写日志、不入库；JSON 客户端分支保持不变（自动化不受影响）。
        const issuedId = stashIssued(result.plaintext);
        reply.header(
          'set-cookie',
          serializeCookie(ISSUED_COOKIE, issuedId, {
            path: detailPath(handle),
            httpOnly: true,
            sameSite: 'Lax',
            maxAge: 60,
            secure: request.protocol === 'https',
          }),
        );
        return reply.redirect(detailPath(handle), 303);
      }
      return reply.code(201).send({
        prefix: result.key.key_prefix,
        label: result.key.label,
        createdAt: result.key.created_at,
        plaintext: result.plaintext,
      });
    }

    if (action === 'rotate') {
      const result = rotateKey(service, { handle, keyPrefix: prefix as string, label: label ?? null });
      if (!result.ok) {
        if (html) {
          reply.code(statusFor(result.reason));
          return renderUserDetail(deps, request, reply, handle, { errorKey: result.messageKey });
        }
        return reply
          .code(statusFor(result.reason))
          .send({ error: result.reason, messageKey: result.messageKey });
      }
      if (html) {
        // 方案 D（Issue 4 根治）：明文**不留在本次响应**里，而是短期暂存（60 秒、一次性），
        // 用 cookie 带一个引用 **303 跳回详情页**渲染 —— 地址栏干净，刷新拿不到第二次。
        // 明文仍不写日志、不入库；JSON 客户端分支保持不变（自动化不受影响）。
        const issuedId = stashIssued(result.plaintext);
        reply.header(
          'set-cookie',
          serializeCookie(ISSUED_COOKIE, issuedId, {
            path: detailPath(handle),
            httpOnly: true,
            sameSite: 'Lax',
            maxAge: 60,
            secure: request.protocol === 'https',
          }),
        );
        return reply.redirect(detailPath(handle), 303);
      }
      return reply.code(201).send({
        prefix: result.key.key_prefix,
        revokedPrefix: result.revokedKey.key_prefix,
        createdAt: result.key.created_at,
        plaintext: result.plaintext,
      });
    }

    const result = revokeKey(service, { handle, keyPrefix: prefix as string });
    if (!result.ok) {
      if (html) {
        reply.code(statusFor(result.reason));
        return renderUserDetail(deps, request, reply, handle, { errorKey: result.messageKey });
      }
      return reply
        .code(statusFor(result.reason))
        .send({ error: result.reason, messageKey: result.messageKey });
    }
    if (html) return reply.redirect(detailPath(handle), 303);
    return reply.code(200).send({ prefix: result.key.key_prefix, revoked: true });
  });

  // ---- 恢复访问（停用是软操作，D13 的可逆侧）----
  // 独立动作而不是「签发顺带恢复」：签发按钮不得隐含改变账号状态（2026-09-22 用户决定）。
  app.post('/admin/api/users/:handle/restore', async (request, reply) => {
    const html = wantsHtml(request);
    const { handle } = request.params as { handle: string };

    const result = restoreUser(serviceDeps(deps, request), { handle });
    if (!result.ok) {
      if (html) {
        reply.code(statusFor(result.reason));
        return renderUserDetail(deps, request, reply, handle, { errorKey: result.messageKey });
      }
      return reply
        .code(statusFor(result.reason))
        .send({ error: result.reason, messageKey: result.messageKey });
    }
    if (html) return reply.redirect(detailPath(handle), 303);
    return reply.code(200).send({ handle, status: 'active' });
  });

  // ---- 停用用户（可逆软操作，D13）----
  app.post('/admin/api/users/:handle/deactivate', async (request, reply) => {
    const html = wantsHtml(request);
    const { handle } = request.params as { handle: string };
    const parsed = DeactivateBody.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid-body', messageKey: 'detail.error.userNotFound' });
    }

    const result = deactivateUser(serviceDeps(deps, request), { handle });
    if (!result.ok) {
      if (html) {
        reply.code(statusFor(result.reason));
        return renderUserDetail(deps, request, reply, handle, { errorKey: result.messageKey });
      }
      return reply
        .code(statusFor(result.reason))
        .send({ error: result.reason, messageKey: result.messageKey });
    }
    if (html) return reply.redirect(detailPath(handle), 303);
    return reply.code(200).send({ handle, revokedKeys: result.revokedKeyCount, status: 'disabled' });
  });

  // 管理面 API 一律不缓存（守卫已设，这里对 JSON 响应再确认一次）
  app.addHook('onSend', async (request, reply, payload) => {
    if ((request.url.split('?')[0] ?? '').startsWith('/admin/api/')) {
      reply.header('cache-control', 'no-store');
    }
    return payload;
  });
}
