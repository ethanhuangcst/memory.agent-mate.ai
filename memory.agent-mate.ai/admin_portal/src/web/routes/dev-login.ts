/**
 * 开发登录入口（**仅本机开发**）—— 把一个**可点击的登录动作**交给开发路径。
 *
 * 为什么需要（Issue 6 [FATAL]）：此前本机开发要求人**手工往浏览器注入** `CF_Authorization` cookie。
 * 那个动作不在产品里（无入口、无按钮、无反馈）、依赖浏览器与工具链细节（cookie 按**主机**隔离、
 * DevTools 入口、浏览器是否拒绝 cookie、长串复制是否被截断），失败时又与「未登录」**完全同形**
 * ⇒ 不可诊断。本入口把那一步交给服务端完成。
 *
 * 三条边界（**都不是新旁路**）：
 *  1. **仅在 `cfg.testJwt.enabled` 时注册路由**。配置层已保证：启用自签通道 ⇒ 必须 development 且两个面
 *     都是回环 Host，且 production 启用会被**启动期拒绝** ⇒ 生产环境该路由**不存在**（是「没有」，不是
 *     「存在但拒绝」）。
 *  2. **不新增签发代码、不把私钥引入应用进程**：直接读取 `--dev-login` **已产出**的令牌文件
 *     （与 JWKS 同目录，见 `resolveTokenFile`）。
 *  3. cookie 属性与生产一致：`HttpOnly; SameSite=Lax; Path=/`，HTTPS 时带 `Secure`。
 */

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { serializeCookie } from '../../shared/cookies';
import { publicContext, requestedLocale, sendHtml, type PageDeps } from '../pages';

/** 开发登录入口路径（守卫需据此做前置放行，故导出）。 */
export const DEV_LOGIN_PATH = '/admin/dev-login';

/** 与 `admin-guard` 中读取的是同一个凭据名。 */
const AUTH_COOKIE = 'CF_Authorization';

/**
 * 令牌与 JWKS **同目录**：`--dev-login` 把两者一起写在 `.portal-data/dev/` 下。
 *
 * 注意：测试里 `PORTAL_TEST_JWT_JWKS` 常是**内联 JSON**（不是路径），此时目录推导没有意义，
 * 回退到 `PORTAL_DB_PATH` 同级的 `.portal-data/dev/token`（可预测，且不会推出奇怪路径）。
 */
export function resolveTokenFile(deps: PageDeps): string {
  const jwks = deps.cfg.testJwt.jwks;
  const looksLikePath = jwks.length > 0 && !jwks.trimStart().startsWith('{');
  const dir = looksLikePath ? path.dirname(jwks) : path.join(path.dirname(deps.cfg.dbPath), 'dev');
  return path.join(dir, 'token');
}

/** 读取令牌；缺失/为空返回 undefined（由调用方决定如何呈现，不抛异常）。 */
function readToken(deps: PageDeps): string | undefined {
  try {
    const raw = fs.readFileSync(resolveTokenFile(deps), 'utf8').trim();
    return raw.length > 0 ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function registerDevLoginRoutes(app: FastifyInstance, deps: PageDeps): void {
  app.get(DEV_LOGIN_PATH, async (request, reply) => {
    const locale = requestedLocale(deps, request);
    return sendHtml(reply, deps, 'dev-login.njk', {
      ...publicContext(deps, locale, 'devLogin.title'),
      hasToken: readToken(deps) !== undefined,
      tokenFile: resolveTokenFile(deps),
    });
  });

  app.post(DEV_LOGIN_PATH, async (request, reply) => {
    const token = readToken(deps);
    if (!token) {
      // 没有令牌 ⇒ 明确告知「重新运行 --dev-login」，而不是给一个无法解释的失败（可诊断原则）
      const locale = requestedLocale(deps, request);
      reply.code(409);
      return sendHtml(reply, deps, 'dev-login.njk', {
        ...publicContext(deps, locale, 'devLogin.title'),
        hasToken: false,
        tokenFile: resolveTokenFile(deps),
      });
    }

    request.log.warn(
      { event: 'dev_login_used', mode: 'self-signed-test-jwt', host: request.headers.host },
      'dev_login_used',
    );
    reply.header(
      'set-cookie',
      serializeCookie(AUTH_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
        maxAge: 12 * 60 * 60,
        secure: request.protocol === 'https',
      }),
    );
    return reply.redirect('/admin/users', 303);
  });
}
