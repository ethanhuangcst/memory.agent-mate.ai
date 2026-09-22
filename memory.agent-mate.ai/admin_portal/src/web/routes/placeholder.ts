/**
 * 占位页路由 —— `/admin/audit` · `/admin/capacity` · `/admin/mcp`（属 PSP-W3）。
 *
 * 按用户决策 2：导航齐全（与原型一致），页面显式说明交付批次，**不伪装成已交付**。
 * 三页都在管理面内，故由 admin-guard 先保证身份（`AC10.5`）。
 */

import type { FastifyInstance } from 'fastify';
import { adminShell, requestedLocale, rememberLocale, sendHtml, type PageDeps } from '../pages';

const PLACEHOLDERS = [
  { path: '/admin/audit', titleKey: 'placeholder.audit.title', bodyKey: 'placeholder.audit.body' },
  {
    path: '/admin/capacity',
    titleKey: 'placeholder.capacity.title',
    bodyKey: 'placeholder.capacity.body',
  },
  { path: '/admin/mcp', titleKey: 'placeholder.mcp.title', bodyKey: 'placeholder.mcp.body' },
] as const;

export async function registerPlaceholderRoutes(
  app: FastifyInstance,
  deps: PageDeps,
): Promise<void> {
  for (const item of PLACEHOLDERS) {
    app.get(item.path, async (request, reply) => {
      const locale = requestedLocale(deps, request);
      rememberLocale(reply, request, locale);
      const shell = adminShell(deps, {
        request,
        locale,
        titleKey: item.titleKey,
        active: item.path.replace('/admin/', '') as 'audit' | 'capacity' | 'mcp',
      });
      return sendHtml(reply, deps, 'placeholder.njk', {
        ...shell,
        pageTitleKey: item.titleKey,
        pageBodyKey: item.bodyKey,
      });
    });
  }
}
