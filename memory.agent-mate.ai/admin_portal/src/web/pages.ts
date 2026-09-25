/**
 * 页面渲染共用件：语言解析与 cookie、管理面外壳上下文、HTML 发送。
 *
 * 语言解析顺序：`?lang=` → 记住的选择（cookie）→ `Accept-Language` → 默认语言。
 * 只要请求带了 `?lang=`，就把它写回 cookie，这样后续点任何链接都保持语言，
 * 不必在 URL 上挂 `lang`（也避免每页都要拼参数）。
 */

import type Database from 'better-sqlite3';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { PortalConfig } from '../config';
import { parseCookies, serializeCookie } from '../shared/cookies';
import type { I18n, Vars } from './i18n';
import { LOCALE_COOKIE } from './i18n';
import { renderPage, type RenderEnv } from './render';
import { buildShell, type NavId, type ShellContext } from './shell';

export interface PageDeps {
  readonly cfg: PortalConfig;
  readonly i18n: I18n;
  readonly env: RenderEnv;
  /** 门户库（写操作经服务层，读操作由路由直接查询）。 */
  readonly db: Database.Database;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function requestedLocale(deps: PageDeps, request: FastifyRequest): ReturnType<I18n['resolve']> {
  const query = request.query as Record<string, unknown> | undefined;
  const rawLang = typeof query?.lang === 'string' ? query.lang : undefined;
  const cookies = parseCookies(request.headers.cookie);
  return deps.i18n.resolve({
    query: rawLang,
    cookie: cookies[LOCALE_COOKIE],
    acceptLanguage: request.headers['accept-language'],
  });
}

/** 若本次请求显式带了 `?lang=`，把选择记进 cookie（AC6.3「刷新后保持」）。 */
export function rememberLocale(
  reply: FastifyReply,
  request: FastifyRequest,
  locale: string,
): void {
  const query = request.query as Record<string, unknown> | undefined;
  if (typeof query?.lang !== 'string') return;
  reply.header(
    'set-cookie',
    serializeCookie(LOCALE_COOKIE, locale, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: ONE_YEAR_SECONDS,
      secure: isSecureRequest(request),
    }),
  );
}

/** 生产环境（HTTPS 终止于 Cloudflare）下 cookie 必须带 Secure。 */
function isSecureRequest(request: FastifyRequest): boolean {
  return request.protocol === 'https';
}

export interface AdminPageInput {
  readonly request: FastifyRequest;
  readonly locale: ReturnType<I18n['resolve']>;
  readonly titleKey: string;
  readonly active: NavId | 'none';
  readonly query?: Record<string, string | undefined>;
}

/** 管理面页面上下文（含身份；身份由 admin-guard 保证存在）。 */
export function adminShell(deps: PageDeps, input: AdminPageInput): ShellContext {
  const pathname = (input.request.url.split('?')[0] ?? '/') as string;
  return buildShell(deps.i18n, {
    locale: input.locale,
    titleKey: input.titleKey,
    pathname,
    adminEmail: input.request.adminIdentity?.email ?? '',
    active: input.active,
    ...(input.query ? { query: input.query } : {}),
  });
}

/** 无身份的页面上下文（公开说明页、401 页）。 */
export function publicContext(
  deps: PageDeps,
  locale: ReturnType<I18n['resolve']>,
  titleKey: string,
): {
  locale: ReturnType<I18n['resolve']>;
  htmlLang: string;
  titleKey: string;
  t: (key: string, vars?: Vars) => string;
} {
  return {
    locale,
    htmlLang: deps.i18n.htmlLang(locale),
    titleKey,
    t: (key, vars) => deps.i18n.t(locale, key, vars),
  };
}

/**
 * 公开面页面上下文（**无身份**，但**有语言组**）。
 *
 * 与 `publicContext` 的差别：公开说明页带语言切换表单（`AC6.3`），因此需要
 * `localeOptions` / `preservedQuery` / `formAction` 三个字段。这里直接复用 `buildShell`
 * 的既有构造 —— 语言组的实现只有一处，不另写一份；`active: 'none'` 表示不派生管理面
 * 导航语义（公开页不渲染侧栏）。`adminEmail` 在公开页承载的是「联系管理员」的地址。
 */
export function publicShell(
  deps: PageDeps,
  locale: ReturnType<I18n['resolve']>,
  contactEmail: string,
  query?: Record<string, string | undefined>,
): ShellContext {
  return buildShell(deps.i18n, {
    locale,
    titleKey: 'brand',
    pathname: '/',
    adminEmail: contactEmail,
    active: 'none',
    ...(query ? { query } : {}),
  });
}

/** 渲染并发送 HTML（错误交由 onError 钩子，不向客户端回传内部细节）。 */
export async function sendHtml(
  reply: FastifyReply,
  deps: PageDeps,
  template: string,
  context: object,
): Promise<FastifyReply> {
  const html = await renderPage(deps.env, template, context);
  return reply.type('text/html; charset=utf-8').send(html);
}
