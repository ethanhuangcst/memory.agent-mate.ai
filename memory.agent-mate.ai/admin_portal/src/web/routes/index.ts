/**
 * 公开面路由 —— `/`（接入说明首页）与 `/instructions` → `/` 的 301。
 *
 * 本批（PSP-W1）只交付管理面的账号与凭证；公开首页的真实内容属 `PSP-W3`，
 * 故渲染占位页并显式说明交付批次（不伪装成已交付）。
 * 路由表真源：specs/web-portal/web-design.md §12.3。
 */

import type { FastifyInstance } from 'fastify';
import { publicContext, requestedLocale, rememberLocale, sendHtml, type PageDeps } from '../pages';

export async function registerPublicRoutes(app: FastifyInstance, deps: PageDeps): Promise<void> {
  app.get('/', async (request, reply) => {
    const locale = requestedLocale(deps, request);
    rememberLocale(reply, request, locale);
    return sendHtml(reply, deps, 'instructions.njk', {
      ...publicContext(deps, locale, 'placeholder.instructions.title'),
    });
  });

  // §12.3：旧路径兼容
  app.get('/instructions', async (_request, reply) => reply.redirect('/', 301));
}
