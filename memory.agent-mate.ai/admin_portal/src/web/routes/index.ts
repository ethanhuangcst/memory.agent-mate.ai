/**
 * 公开面路由 —— `/`（接入说明首页）与 `/instructions` → `/` 的 301。
 *
 * 路由表真源：specs/web-portal/web-design.md §12.3。
 * 页面内容真源：`specs/web-portal/mockups/01-instructions.html`（结构与类名逐字对齐）+
 * 四语言词表 `src/web/i18n/*.json`（文案唯一出处）。
 */

import type { FastifyInstance } from 'fastify';
import { publicShell, requestedLocale, rememberLocale, sendHtml, type PageDeps } from '../pages';

/**
 * 「联系管理员」邮箱（`AC6.8`：第 1 步可就地联系管理员）。
 * 设计真源 = 原型 `01-instructions.html` 的 `mailto:`；它是一个**值**（不是可翻译文案），
 * 因此不进词表；目前无配置键承载它，如需按部署改地址，再加 `PORTAL_CONTACT_EMAIL` 并同步
 * `deployment.md` 的配置契约表（见本轮 change-log 的「待配置化」登记）。
 */
const CONTACT_EMAIL = 'me@ethanhuang.com';

/**
 * 第 2 步的客户端配置示例（`AC6.5`：示例一律占位符）。
 * 主机名用 `{MCP_HOST}`、令牌用掩码形态 —— **不读**真实配置（§12.3「公开页不含机密」）。
 * 与模板里的 `#step2-config` 是同一份内容（复制按钮按选择器取它）。
 */
const MCP_CONFIG_EXAMPLE = JSON.stringify(
  {
    mcpServers: {
      'ai-memory': {
        type: 'http',
        url: 'https://{MCP_HOST}/mcp',
        headers: { Authorization: 'Bearer memo_…' },
      },
    },
  },
  null,
  2,
);

export async function registerPublicRoutes(app: FastifyInstance, deps: PageDeps): Promise<void> {
  app.get('/', async (request, reply) => {
    const locale = requestedLocale(deps, request);
    rememberLocale(reply, request, locale);
    return sendHtml(reply, deps, 'instructions.njk', {
      ...publicShell(deps, locale, CONTACT_EMAIL, request.query as Record<string, string | undefined>),
      configJson: MCP_CONFIG_EXAMPLE,
    });
  });

  // §12.3：旧路径兼容
  app.get('/instructions', async (_request, reply) => reply.redirect('/', 301));
}
