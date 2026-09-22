import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type PortalConfig } from '../../src/config';
import { createIdentityResolver, resolveIdentity } from '../../src/shared/auth';
import { registerAdminGuard } from '../../src/web/admin-guard';
import { createI18n } from '../../src/web/i18n';
import { createRenderEnv } from '../../src/web/render';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';

const ISS = 'https://test.cloudflareaccess.test';
const AUD = 'test-audience-tag';
const KID = 'test-key-1';
/** 模拟 Cloudflare 团队域：iss 形如 `https://<team>.cloudflareaccess.com`（§6.1）。 */
const TEAM_DOMAIN = 'team.cloudflareaccess.test';
const ACCESS_ISS = `https://${TEAM_DOMAIN}`;

type SignOptions = { iss?: string; aud?: string; exp?: string; kid?: string };

let signToken: (claims: Record<string, unknown>, options?: SignOptions) => Promise<string>;
let signWithForeignKey: (claims: Record<string, unknown>) => Promise<string>;
/** 按「真 Access 通道」的 iss 签发（用于验证 service-token 识别路径）。 */
let signAccessToken: (claims: Record<string, unknown>) => Promise<string>;
let jwksJson: string;
let jwks: { keys: Record<string, unknown>[] };
let tmpRoot: string;
let cfg: PortalConfig;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const foreign = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwks = { keys: [{ ...jwk, alg: 'RS256', kid: KID, use: 'sig' }] };
  jwksJson = JSON.stringify(jwks);

  signAccessToken = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ACCESS_ISS)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  signToken = (claims, options = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? KID })
      .setIssuer(options.iss ?? ISS)
      .setAudience(options.aud ?? AUD)
      .setIssuedAt()
      .setExpirationTime(options.exp ?? '5m')
      .sign(privateKey);

  signWithForeignKey = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuer(ISS)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(foreign.privateKey);

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-auth-'));
  cfg = loadConfig({
    PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
    PORTAL_MCP_HOST: 'mcp.localhost',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: fs.mkdirSync(path.join(tmpRoot, 'users'), { recursive: true }),
    PORTAL_TEST_JWT_ENABLED: '1',
      PORTAL_TEST_JWT_EMAIL: 'owner@agent-mate.ai',
    PORTAL_TEST_JWT_JWKS: jwksJson,
    PORTAL_TEST_JWT_ISS: ISS,
    PORTAL_TEST_JWT_AUD: AUD,
  });
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function optionsFor(config: PortalConfig) {
  return { access: config.access, testJwt: config.testJwt };
}

describe('resolveIdentity — 断言验签（AC10.5 / AC1.4）', () => {
  it('有效断言 → 身份为断言中的邮箱', async () => {
    const token = await signToken({ email: 'admin@example.com' });
    const result = await resolveIdentity(
      { headers: { 'cf-access-jwt-assertion': token } },
      optionsFor(cfg),
    );
    expect(result).toMatchObject({
      ok: true,
      identity: { email: 'admin@example.com', source: 'test-jwt' },
    });
  });

  it('缺断言 → missing（绝不回落为匿名放行）', async () => {
    expect(await resolveIdentity({ headers: {} }, optionsFor(cfg))).toEqual({
      ok: false,
      reason: 'missing',
    });
    expect(await resolveIdentity({ headers: { authorization: 'Bearer x' } }, optionsFor(cfg))).toEqual(
      { ok: false, reason: 'missing' },
    );
  });

  it('过期断言 → expired', async () => {
    const token = await signToken({ email: 'admin@example.com' }, { exp: '-1m' });
    expect(
      await resolveIdentity({ headers: { 'cf-access-jwt-assertion': token } }, optionsFor(cfg)),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('受众不符 → wrong-audience；签发者不符 → wrong-issuer', async () => {
    const wrongAud = await signToken({ email: 'admin@example.com' }, { aud: 'other' });
    expect(
      await resolveIdentity({ headers: { 'cf-access-jwt-assertion': wrongAud } }, optionsFor(cfg)),
    ).toEqual({ ok: false, reason: 'wrong-audience' });

    const wrongIss = await signToken(
      { email: 'admin@example.com' },
      { iss: 'https://evil.cloudflareaccess.test' },
    );
    expect(
      await resolveIdentity({ headers: { 'cf-access-jwt-assertion': wrongIss } }, optionsFor(cfg)),
    ).toEqual({ ok: false, reason: 'wrong-issuer' });
  });

  it('非受信密钥签出的断言 → invalid', async () => {
    const forged = await signWithForeignKey({ email: 'attacker@example.com' });
    expect(
      await resolveIdentity({ headers: { 'cf-access-jwt-assertion': forged } }, optionsFor(cfg)),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('篡改载荷（改邮箱）→ invalid（签名不再匹配）', async () => {
    const token = await signToken({ email: 'admin@example.com' });
    const [header, payload, signature] = token.split('.') as [string, string, string];
    const tampered = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    tampered.email = 'attacker@example.com';
    const forgedPayload = Buffer.from(JSON.stringify(tampered)).toString('base64url');
    const forged = `${header}.${forgedPayload}.${signature}`;

    expect(
      await resolveIdentity({ headers: { 'cf-access-jwt-assertion': forged } }, optionsFor(cfg)),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('邮箱头与断言不一致 → header-mismatch（头不单独采信，不一致即判否）', async () => {
    const token = await signToken({ email: 'admin@example.com' });
    expect(
      await resolveIdentity(
        {
          headers: {
            'cf-access-jwt-assertion': token,
            'cf-access-authenticated-user-email': 'other@example.com',
          },
        },
        optionsFor(cfg),
      ),
    ).toEqual({ ok: false, reason: 'header-mismatch' });
  });

  it('邮箱头与断言一致 → 通过（交叉校验不误杀）', async () => {
    const token = await signToken({ email: 'admin@example.com' });
    const result = await resolveIdentity(
      {
        headers: {
          'cf-access-jwt-assertion': token,
          'cf-access-authenticated-user-email': 'admin@example.com',
        },
      },
      optionsFor(cfg),
    );
    expect(result.ok).toBe(true);
  });

  it('Access 通道的服务令牌形态（只有 common_name）→ 来源记为 service-token', async () => {
    // Service Token 由 Cloudflare 在边缘校验后注入签名断言（只有 common_name、无 email）⇒
    // 门户侧无需专门代码，但要把来源区分出来，便于审计与排障。
    const token = await signAccessToken({ common_name: 'service-token-client-id' });
    const result = await resolveIdentity(
      { headers: { 'cf-access-jwt-assertion': token } },
      {
        access: { teamDomain: TEAM_DOMAIN, aud: AUD, jwksUrl: `https://${TEAM_DOMAIN}/cdn-cgi/access/certs` },
        testJwt: { enabled: false, jwks: '', iss: '', aud: '' },
        getKey: createLocalJWKSet(jwks),
      },
    );
    expect(result).toMatchObject({
      ok: true,
      identity: { email: 'service-token-client-id', source: 'service-token' },
    });
  });

  it('Access 通道的浏览器身份（有 email）→ 来源记为 access-jwt', async () => {
    const token = await signAccessToken({ email: 'admin@example.com', sub: 'abc' });
    const result = await resolveIdentity(
      { headers: { 'cf-access-jwt-assertion': token } },
      {
        access: { teamDomain: TEAM_DOMAIN, aud: AUD, jwksUrl: `https://${TEAM_DOMAIN}/cdn-cgi/access/certs` },
        testJwt: { enabled: false, jwks: '', iss: '', aud: '' },
        getKey: createLocalJWKSet(jwks),
      },
    );
    expect(result).toMatchObject({
      ok: true,
      identity: { email: 'admin@example.com', source: 'access-jwt' },
    });
  });

  it('断言缺失时回落 CF_Authorization cookie（浏览器导航路径）', async () => {
    const token = await signToken({ email: 'admin@example.com' });
    const result = await resolveIdentity(
      { headers: { cookie: `theme=light; CF_Authorization=${token}; other=1` } },
      optionsFor(cfg),
    );
    expect(result).toMatchObject({ ok: true, identity: { email: 'admin@example.com' } });
  });

  it('断言形状非法 → invalid', async () => {
    expect(
      await resolveIdentity({ headers: { 'cf-access-jwt-assertion': 'not.a.jwt' } }, optionsFor(cfg)),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('既无自签通道也无 Access 配置 → invalid（绝不因未配置而放行）', async () => {
    const bare = { access: { teamDomain: '', aud: '', jwksUrl: '' }, testJwt: { enabled: false, jwks: '', iss: '', aud: '' } };
    const token = await signToken({ email: 'admin@example.com' });
    expect(
      await resolveIdentity({ headers: { 'cf-access-jwt-assertion': token } }, bare),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('取键器在解析器内只建一次（热路径不重复建 JWKS 实例）', async () => {
    let calls = 0;
    const resolver = createIdentityResolver({
      ...optionsFor(cfg),
      testGetKey: (() => {
        calls += 1;
        return Promise.resolve(undefined as never);
      }) as never,
    });
    const token = await signToken({ email: 'admin@example.com' });
    await resolver({ headers: { 'cf-access-jwt-assertion': token } });
    await resolver({ headers: { 'cf-access-jwt-assertion': token } });
    expect(calls).toBeGreaterThan(0);
  });
});

describe('registerAdminGuard — 管理面路径必须带身份', () => {
  function stubApp(config: PortalConfig) {
    const db = openMemoryDatabase();
    migrate(db);
    const app = Fastify();
    registerAdminGuard(app, {
      cfg: config,
      i18n: createI18n(config),
      env: createRenderEnv(config),
      db,
    });
    app.get('/admin/users', async (request) => ({ admin: request.adminIdentity?.email ?? null }));
    app.get('/', async () => ({ public: true }));
    return app;
  }

  it('管理面路径无断言 → 401，且响应体不暴露失败原因', async () => {
    const app = stubApp(cfg);
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(/missing|expired|audience|issuer|invalid/i);
    await app.close();
  });

  it('管理面路径带有效断言 → 放行并把身份交给路由', async () => {
    const app = stubApp(cfg);
    const token = await signToken({ email: 'admin@example.com' });
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'localhost', 'cf-access-jwt-assertion': token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ admin: 'admin@example.com' });
    expect(response.headers['cache-control']).toBe('no-store');
    await app.close();
  });

  it('公开路径不需要身份', async () => {
    const app = stubApp(cfg);
    const response = await app.inject({ method: 'GET', url: '/', headers: { host: 'localhost' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ public: true });
    await app.close();
  });
});

describe('buildServer — 认证先于路由（不泄露「哪些路由存在」）', () => {
  it('无断言访问 /admin/users → 401（而不是 404）', async () => {
    const app = await buildServer(cfg);
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('带有效断言访问管理页 → 200 且渲染真实页面（顶栏显示身份）', async () => {
    const app = await buildServer(cfg);
    const token = await signToken({ email: 'admin@example.com' });
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'localhost', 'cf-access-jwt-assertion': token },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('admin@example.com');
    await app.close();
  });

  it('未认证访问管理页 → 401 且渲染说明页（不含失败原因）', async () => {
    const app = await buildServer(cfg);
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('Cloudflare Access');
    expect(response.body).not.toMatch(/missing|expired|audience|issuer/i);
    await app.close();
  });

  it('MCP 域名下即使带有效断言也不能访问管理面（面隔离先于身份）', async () => {
    const app = await buildServer(cfg);
    const token = await signToken({ email: 'admin@example.com' });
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'mcp.localhost', 'cf-access-jwt-assertion': token },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });
});
