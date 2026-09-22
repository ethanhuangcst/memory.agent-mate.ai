/**
 * 管理面身份守卫（Fastify 插件）。
 *
 * 与面隔离的关系：面隔离（`shared/host-split.ts`）**先**判定 Host，本守卫**后**判定身份 ——
 * 跨面请求在面隔离处即被拒，不会进入验签逻辑；管理面路径（`/admin*`）必须先有有效身份。
 * 公开面（`/` 说明页）与静态资源不需要身份（§12.3 认证列）。
 *
 * 失败即 401：渲染一页说明「本门户没有密码、登录由 Cloudflare Access 完成」，
 * **不暴露失败原因**（原因只进结构化日志），避免把「断言过期 / 受众不符 / 断言缺失」
 * 变成可枚举的探针。渲染失败时回落纯文本，绝不让「认证失败」变成 500。
 */

import type { FastifyInstance } from 'fastify';
import { decodeJwt, decodeProtectedHeader } from 'jose';
import { createIdentityResolver, extractAssertion, type AdminIdentity } from '../shared/auth';
import { redactText } from '../shared/redact';
import type { PageDeps } from './pages';
import { publicContext, requestedLocale, sendHtml } from './pages';
import { DEV_LOGIN_PATH, resolveTokenFile } from './routes/dev-login';

declare module 'fastify' {
  interface FastifyRequest {
    /** 已认证的管理面身份（仅由本守卫写入）。 */
    adminIdentity?: AdminIdentity;
  }
}

export function isAdminPath(pathname: string): boolean {
  return pathname === '/admin' || pathname.startsWith('/admin/');
}

/**
 * 生产身份来源白名单（用户决定：**生产环境出现非 Cloudflare 身份即失败**）。
 *
 * 口径是**通道**，不是「有没有 email」：Service Token 由 Cloudflare 签发（Access 为它注入断言，
 * 只是没有 email、只有 `common_name`，来源记 `service-token`）⇒ **必须允许**，否则会误伤自动化路径。
 *
 * 配置层已强制 production 下自签通道关闭；这里是**身份层的第二道锁**：
 * 即使将来新增通道或配置漂移，非 Cloudflare 来源也无法在生产通过。
 */
export function isIdentitySourceAllowed(
  isProduction: boolean,
  source: 'access-jwt' | 'service-token' | 'test-jwt',
): boolean {
  if (!isProduction) return true;
  return source === 'access-jwt' || source === 'service-token';
}

/**
 * 逐字符比对「我们期望的 issuer」与「断言里的 iss」。
 *
 * 为什么需要：jose 对 `iss` 是**严格字符串比较**（见其 jwt_claims_set 的 `[issuer].includes(payload.iss)`），
 * 而分类结果只有 `wrong-issuer`。当两侧**肉眼看不出差别**时（不可见字符、异体连字符、尾随空白等），
 * 只有长度与首个差异位的码点能指出真相。
 */
function compareIssuer(expected: string, observed: string): {
  readonly equal: boolean;
  readonly expectedLength: number;
  readonly observedLength: number;
  readonly firstDiff: number;
  readonly expectedCodePoint: number | null;
  readonly observedCodePoint: number | null;
} {
  const left = [...expected];
  const right = [...observed];
  let firstDiff = -1;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) {
      firstDiff = index;
      break;
    }
  }
  return {
    equal: expected === observed,
    expectedLength: left.length,
    observedLength: right.length,
    firstDiff,
    expectedCodePoint: firstDiff === -1 ? null : (left[firstDiff]?.codePointAt(0) ?? null),
    observedCodePoint: firstDiff === -1 ? null : (right[firstDiff]?.codePointAt(0) ?? null),
  };
}

/**
 * 只读地解出断言的 `iss` / `aud` / `kid`（**不验签**，仅供日志诊断；解不出返回 undefined）。
 *
 * 为什么需要：Cloudflare Access 的 `iss` 取值随组织（团队域）而变，与文档默认写法不一致时，
 * 日志里只有 `wrong-issuer` 无法定位真值 —— 这三个 claim 足够判定「该改配置」还是「该改期望」。
 * 只记这三个非机密标识，**不记令牌本体、不记邮箱**。
 */
function describeAssertion(
  headers: Record<string, string | string[] | undefined>,
): { iss?: unknown; aud?: unknown; kid?: string | undefined } | undefined {
  const token = extractAssertion(headers);
  if (!token) return undefined;
  try {
    const { iss, aud } = decodeJwt(token);
    return { iss, aud, kid: decodeProtectedHeader(token).kid };
  } catch {
    return undefined;
  }
}

export function registerAdminGuard(app: FastifyInstance, deps: PageDeps): void {
  const resolve = createIdentityResolver({
    access: deps.cfg.access,
    testJwt: deps.cfg.testJwt,
    // 把**具体**失败原因记进结构化日志：分类（missing / expired / wrong-issuer…）只说明「哪一步没过」，
    // 排查配置偏差（如 iss 与配置不符）时还需要 jose 的原始 code / message；消息经脱敏并截断，
    // 绝不记录令牌本体。
    onVerifyFailure: ({ mode, error }) => {
      app.log.warn(
        {
          event: 'assertion_verify_failed',
          mode,
          code: (error as { code?: string }).code ?? '',
          message: redactText(error instanceof Error ? error.message : String(error)).slice(0, 240),
        },
        'assertion_verify_failed',
      );
    },
  });

  app.addHook('onRequest', async (request, reply) => {
    const pathname = request.url.split('?')[0] ?? '/';
    if (!isAdminPath(pathname)) return;

    // 开发登录入口**自身**必须先放行，否则守卫会把「用来获得身份的页面」也拦成 401（死锁）。
    // 放行条件收敛为单一判据 `cfg.testJwt.enabled`：配置层已强制「启用自签通道 ⇒ 两个面都必须是回环 Host」，
    // 且 production 下启用该通道会被启动期拒绝 ⇒ 该判据同时蕴含 development 与回环两条约束，无需新增不变量。
    if (deps.cfg.testJwt.enabled && pathname === DEV_LOGIN_PATH) return;

    const result = await resolve({ headers: request.headers });
    if (!result.ok) {
      const claims = describeAssertion(request.headers);
      const expectedIssuer = `https://${deps.cfg.access.teamDomain}`;
      request.log.warn(
        {
          event: 'admin_unauthenticated',
          path: pathname,
          reason: result.reason,
          assertionClaims: claims,
          expectedIssuer,
          issuerCompare: compareIssuer(
            expectedIssuer,
            typeof claims?.iss === 'string' ? claims.iss : '',
          ),
        },
        'admin_unauthenticated',
      );
      reply.code(401).header('cache-control', 'no-store');
      const locale = requestedLocale(deps, request);
      try {
        return await sendHtml(reply, deps, 'unauthorized.njk', {
          ...publicContext(deps, locale, 'admin.unauthorized.title'),
          // 自诊断（**仅非生产**）：把「未登录」与「Host 不对」这两类同形症状分开 ——
          // 本次 Issue 6 排查中，这两种原因都只表现为一行 "Sign in required"，无法定位。
          // 生产环境**不传**该字段 ⇒ 401 页与既有行为完全一致（不新增任何暴露面）；
          // 且此处只呈现**结构性事实**（你来的 Host、通道是否启用、令牌文件路径），
          // 仍然**不暴露验签失败原因**（原因只进结构化日志）。
          devDiagnostics: deps.cfg.isProduction
            ? undefined
            : {
                host: request.headers.host ?? '',
                testJwtEnabled: deps.cfg.testJwt.enabled,
                tokenFile: resolveTokenFile(deps),
                devLoginPath: DEV_LOGIN_PATH,
              },
        });
      } catch {
        return reply.type('text/plain; charset=utf-8').send('Unauthorized\n');
      }
    }

    // 身份层护栏：生产只接受 Cloudflare 来源（见 isIdentitySourceAllowed）。
    if (!isIdentitySourceAllowed(deps.cfg.isProduction, result.identity.source)) {
      request.log.warn(
        { event: 'identity_source_rejected', source: result.identity.source, path: pathname },
        'identity_source_rejected',
      );
      reply.code(401).header('cache-control', 'no-store');
      return reply.type('text/plain; charset=utf-8').send('Unauthorized\n');
    }

    request.adminIdentity = result.identity;
    // 管理面响应一律不缓存（含页面与接口）
    reply.header('cache-control', 'no-store');
    return undefined;
  });
}
