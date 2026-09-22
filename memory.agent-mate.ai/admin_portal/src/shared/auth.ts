/**
 * 管理面身份解析 —— Cloudflare Access 断言验签（`S10` / `AC10.1` / `AC10.5` / `AC1.4`）。
 *
 * 设计要点（对应用户决议 2026-09-22）：
 *  1. **身份只来自签名断言**：`Cf-Access-Jwt-Assertion` 头（回落到 `CF_Authorization` cookie），
 *     经 JWKS 验签 + `iss` + `aud` + `exp`（含时钟偏移）。
 *  2. **`CF-Access-Authenticated-User-Email` 只作交叉校验**：它可被伪造，绝不单独采信；
 *     与断言中的 `email` 不一致即判否。
 *  3. **Access Service Token 不需要专门代码**：Service Token 由 Cloudflare 在边缘校验，
 *     通过后同样注入签名断言（此时断言只有 `common_name`、没有 `email`）⇒ 本函数据 `common_name`
 *     识别为 `service-token` 来源，签名强度与其他 Access 身份相同。
 *  4. **自签 JWT 是测试通道**：仅在 `PORTAL_TEST_JWT_ENABLED=1` 且两个面都是回环地址时可用
 *     （由 config 强约束；production 下启用即拒绝启动）⇒ 与真 Access 共用同一套验签逻辑，
 *     差别只是「用配置里的本地 JWKS」而不是「远程 JWKS」。
 *  5. **绝不回落到「无身份放行」**：任何解析失败都返回 not-ok，由调用方转 401。
 *
 * 本模块不依赖 Fastify 与模板，便于离线测试与后续批次复用。
 */

import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AccessAuthConfig, TestJwtConfig } from '../config';

export interface AdminIdentity {
  /** 审计 actor：断言中的邮箱；服务令牌则是其 `common_name`。 */
  readonly email: string;
  readonly source: 'access-jwt' | 'service-token' | 'test-jwt';
  readonly issuedAt: number | null;
}

export type IdentityFailure =
  | 'missing'
  | 'invalid'
  | 'expired'
  | 'wrong-audience'
  | 'wrong-issuer'
  | 'header-mismatch';

export type IdentityResult =
  | { readonly ok: true; readonly identity: AdminIdentity }
  | { readonly ok: false; readonly reason: IdentityFailure };

export interface IdentityRequest {
  readonly headers: Record<string, string | string[] | undefined>;
}

export interface ResolveOptions {
  readonly access: AccessAuthConfig;
  readonly testJwt: TestJwtConfig;
  /** 注入用：替换 Access 侧取键器（离线测试传本地 JWKS，避免任何网络依赖）。 */
  readonly getKey?: JWTVerifyGetKey;
  /** 注入用：替换自签测试通道的取键器。 */
  readonly testGetKey?: JWTVerifyGetKey;
  /**
   * 验签失败回调（可观测性用）：把**具体失败原因**（jose 的 code / message）交给调用方记录。
   *
   * 为什么需要：`IdentityFailure` 是收敛后的分类（missing / expired / wrong-issuer / …），
   * 只能说明「哪一步没过」。当分类正确但真值未知时（典型：`iss` 与配置不符），
   * 只有原始 code / message 能指出该改配置还是该改期望。回调只用于记录，不得改变控制流；
   * 调用方**不得**把令牌本体透传给日志。
   */
  readonly onVerifyFailure?: (info: {
    readonly mode: 'test' | 'access';
    readonly error: unknown;
  }) => void;
}

/** 取键器缓存：远程 JWKS 必须**复用同一实例**，否则每个请求都要重新出网取键。 */
interface BuiltResolvers {
  access?: JWTVerifyGetKey;
  test?: JWTVerifyGetKey;
}

const ASSERTION_HEADER = 'cf-access-jwt-assertion';
const EMAIL_HEADER = 'cf-access-authenticated-user-email';
const AUTH_COOKIE = 'CF_Authorization';
const CLOCK_TOLERANCE = '30s';

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

/** 从请求中取出断言：优先头部（所有经 Access 的请求都有），回落浏览器 cookie。 */
export function extractAssertion(headers: Record<string, string | string[] | undefined>):
  | string
  | undefined {
  return headerValue(headers, ASSERTION_HEADER) ?? cookieValue(headerValue(headers, 'cookie'), AUTH_COOKIE);
}

function createKeyResolver(
  options: ResolveOptions,
  mode: 'access' | 'test',
  built: BuiltResolvers,
): JWTVerifyGetKey {
  if (mode === 'access') {
    if (options.getKey) return options.getKey;
    built.access ??= createRemoteJWKSet(new URL(options.access.jwksUrl));
    return built.access;
  }
  if (options.testGetKey) return options.testGetKey;
  // 配置里是 JWKS JSON（测试密钥对，绝不能是真实密钥）
  built.test ??= createLocalJWKSet(
    JSON.parse(options.testJwt.jwks) as { keys: Record<string, unknown>[] },
  );
  return built.test;
}

function mapFailure(error: unknown): IdentityFailure {
  const code = (error as { code?: string }).code ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (code === 'ERR_JWT_EXPIRED' || /exp/i.test(code)) return 'expired';
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED') {
    if (/aud/i.test(message)) return 'wrong-audience';
    if (/iss/i.test(message)) return 'wrong-issuer';
    return 'invalid';
  }
  return 'invalid';
}

/**
 * 生成身份解析器（**生产路径**）：取键器只建一次并复用，避免每请求出网取 JWKS。
 * 自签通道若启用，先试本地 JWKS，失败再按真 Access 断言验签。
 */
export function createIdentityResolver(
  options: ResolveOptions,
): (request: IdentityRequest) => Promise<IdentityResult> {
  const built: BuiltResolvers = {};
  return (request) => resolveWith(request, options, built);
}

/** 便捷入口（测试与一次性调用）：每次调用重建取键器，不适用于热路径。 */
export async function resolveIdentity(
  request: IdentityRequest,
  options: ResolveOptions,
): Promise<IdentityResult> {
  return resolveWith(request, options, {});
}

async function resolveWith(
  request: IdentityRequest,
  options: ResolveOptions,
  built: BuiltResolvers,
): Promise<IdentityResult> {
  const token = extractAssertion(request.headers);
  if (!token) return { ok: false, reason: 'missing' };

  const attempts: Array<{ mode: 'test' | 'access'; issuer: string; audience: string }> = [];
  if (options.testJwt.enabled) {
    attempts.push({ mode: 'test', issuer: options.testJwt.iss, audience: options.testJwt.aud });
  }
  if (options.access.teamDomain && options.access.aud) {
    attempts.push({
      mode: 'access',
      issuer: `https://${options.access.teamDomain}`,
      audience: options.access.aud,
    });
  }
  if (attempts.length === 0) return { ok: false, reason: 'invalid' };

  let lastFailure: IdentityFailure = 'invalid';
  for (const attempt of attempts) {
    try {
      const { payload } = await jwtVerify(token, createKeyResolver(options, attempt.mode, built), {
        issuer: attempt.issuer,
        audience: attempt.audience,
        clockTolerance: CLOCK_TOLERANCE,
      });

      const email = typeof payload.email === 'string' ? payload.email : undefined;
      const commonName = typeof payload.common_name === 'string' ? payload.common_name : undefined;
      const subject = email ?? commonName ?? (typeof payload.sub === 'string' ? payload.sub : undefined);
      if (!subject) return { ok: false, reason: 'invalid' };

      // 交叉校验（头可伪造，只用于发现不一致）
      const headerEmail = headerValue(request.headers, EMAIL_HEADER);
      if (headerEmail && email && headerEmail !== email) {
        return { ok: false, reason: 'header-mismatch' };
      }

      return {
        ok: true,
        identity: {
          email: subject,
          source: attempt.mode === 'test' ? 'test-jwt' : commonName && !email ? 'service-token' : 'access-jwt',
          issuedAt: typeof payload.iat === 'number' ? payload.iat : null,
        },
      };
    } catch (error) {
      lastFailure = mapFailure(error);
      options.onVerifyFailure?.({ mode: attempt.mode, error });
    }
  }

  return { ok: false, reason: lastFailure };
}
