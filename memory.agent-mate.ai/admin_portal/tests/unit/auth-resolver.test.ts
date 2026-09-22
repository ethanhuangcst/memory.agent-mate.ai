/**
 * 身份解析器的反向分支单元测试（`src/shared/auth.ts`）。
 *
 * 断言的是**「拒绝」的姿态**，不是「通过」：
 *  - 没有任何断言来源 ⇒ `missing`（绝不回落成「无身份放行」）；
 *  - 有别的 cookie 但没有 Access 的那个 ⇒ 也必须是 `missing`（不能把任意 cookie 当凭据）；
 *  - 形状非法的断言 ⇒ `invalid`，且**在外泄细节之前就失败**（无需出网取键）；
 *  - 断言合法但 `nbf` 未生效 ⇒ `invalid`；已过期 ⇒ `expired`（判因可分，便于运维）。
 *
 * 三条**实测得到的实现语义**（本文件据实断言，不按猜想写）：
 *  1. 通道顺序是「自签测试通道优先，失败再按真 Access 断言验签」⇒ 返回的 reason/source
 *     反映**最终生效的那条通道**；
 *  2. Access 路径要求 `iss = https://<团队域>`（团队域直接充当 issuer）；
 *  3. 邮箱头与断言里的 email 做**逐字比较**（大小写不同即判否 —— 取更严的一侧；
 *     Cloudflare 注入的就是同一串，故不影响真链路）。
 *
 * 全部用例**零网络**：要么在解码阶段就失败，要么注入本地取键器。
 */

import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { AccessAuthConfig, TestJwtConfig } from '../../src/config';
import { createIdentityResolver, extractAssertion } from '../../src/shared/auth';

const NO_ACCESS: AccessAuthConfig = { teamDomain: '', aud: '', jwksUrl: '' };
const NO_TEST: TestJwtConfig = { enabled: false, jwks: '', iss: '', aud: '' };

const TEAM = 'team.cloudflareaccess.com';
const ACCESS_URL = `https://${TEAM}/cdn-cgi/access/certs`;
const ACCESS_ISS = `https://${TEAM}`;
const ACCESS_AUD = 'unit-aud';
const ACCESS: AccessAuthConfig = { teamDomain: TEAM, aud: ACCESS_AUD, jwksUrl: ACCESS_URL };

async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const jwks = JSON.stringify({ keys: [{ ...jwk, alg: 'RS256', kid: 'unit-key', use: 'sig' }] });
  return { publicKey, privateKey, jwks };
}

/** 公钥类型由 jose 推导（tsconfig 无 DOM lib，不直接用 CryptoKey 全局名）。 */
type VerifyKey = Awaited<ReturnType<typeof generateKeyPair>>['publicKey'];

/** 只开 Access 通道（= 生产路径），注入本地取键器 ⇒ 不出网。 */
function accessOnly(publicKey: VerifyKey) {
  return createIdentityResolver({
    access: ACCESS,
    testJwt: NO_TEST,
    getKey: async () => publicKey,
  });
}

describe('extractAssertion', () => {
  it('优先取头部；头部是数组时取首值（多值头不放大攻击面）', () => {
    expect(extractAssertion({ 'cf-access-jwt-assertion': 'a.b.c' })).toBe('a.b.c');
    expect(extractAssertion({ 'cf-access-jwt-assertion': ['first', 'second'] })).toBe('first');
  });

  it('无头部时回落 CF_Authorization cookie；同名 cookie 值内出现 = 不被截断', () => {
    expect(extractAssertion({ cookie: 'a=1; CF_Authorization=x.y=z' })).toBe('x.y=z');
  });

  it('既无头部也无该 cookie ⇒ undefined（不误取其它 cookie）', () => {
    expect(extractAssertion({ cookie: 'portal_locale=zh-HK' })).toBeUndefined();
    expect(extractAssertion({})).toBeUndefined();
    expect(extractAssertion({ cookie: undefined })).toBeUndefined();
  });
});

describe('createIdentityResolver：拒绝姿态', () => {
  it('完全没有断言 ⇒ missing', async () => {
    const resolve = createIdentityResolver({ access: NO_ACCESS, testJwt: NO_TEST });
    await expect(resolve({ headers: {} })).resolves.toEqual({ ok: false, reason: 'missing' });
  });

  it('只有无关 cookie ⇒ missing（cookie 解析不会退化成「有 cookie 就认」）', async () => {
    const resolve = createIdentityResolver({ access: NO_ACCESS, testJwt: NO_TEST });
    await expect(resolve({ headers: { cookie: 'portal_locale=zh-HK; other=1' } })).resolves.toEqual({
      ok: false,
      reason: 'missing',
    });
  });

  it('配置了 Access 且未注入取键器 ⇒ 现场构造远程取键器，形状非法的断言直接 invalid（解码阶段即失败，不出网）', async () => {
    const resolve = createIdentityResolver({ access: ACCESS, testJwt: NO_TEST });
    await expect(
      resolve({ headers: { 'cf-access-jwt-assertion': 'not-a-jwt' } }),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('断言合法但 nbf 未生效 ⇒ invalid（claim 校验失败不只有 aud/iss 两类）', async () => {
    const { publicKey, privateKey } = await makeKeys();
    const token = await new SignJWT({ email: 'admin@example.test' })
      .setProtectedHeader({ alg: 'RS256', kid: 'unit-key' })
      .setIssuer(ACCESS_ISS)
      .setAudience(ACCESS_AUD)
      .setIssuedAt()
      .setNotBefore(Math.floor(Date.now() / 1000) + 3600)
      .setExpirationTime('2h')
      .sign(privateKey);

    await expect(
      accessOnly(publicKey)({ headers: { 'cf-access-jwt-assertion': token } }),
    ).resolves.toEqual({ ok: false, reason: 'invalid' });
  });

  it('已过期断言 ⇒ expired（与 invalid 区分开，便于运维判因）', async () => {
    const { publicKey, privateKey } = await makeKeys();
    const token = await new SignJWT({ email: 'admin@example.test' })
      .setProtectedHeader({ alg: 'RS256', kid: 'unit-key' })
      .setIssuer(ACCESS_ISS)
      .setAudience(ACCESS_AUD)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);

    await expect(
      accessOnly(publicKey)({ headers: { 'cf-access-jwt-assertion': token } }),
    ).resolves.toEqual({ ok: false, reason: 'expired' });
  });

  it('aud 不符 ⇒ wrong-audience', async () => {
    const { publicKey, privateKey } = await makeKeys();
    const token = await new SignJWT({ email: 'admin@example.test' })
      .setProtectedHeader({ alg: 'RS256', kid: 'unit-key' })
      .setIssuer(ACCESS_ISS)
      .setAudience('some-other-aud')
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    await expect(
      accessOnly(publicKey)({ headers: { 'cf-access-jwt-assertion': token } }),
    ).resolves.toEqual({ ok: false, reason: 'wrong-audience' });
  });

  it('服务令牌（无 email、只有 common_name）走 Access 路径 ⇒ 来源记为 service-token', async () => {
    const { publicKey, privateKey } = await makeKeys();
    const token = await new SignJWT({ common_name: 'ci-service-token' })
      .setProtectedHeader({ alg: 'RS256', kid: 'unit-key' })
      .setIssuer(ACCESS_ISS)
      .setAudience(ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    const result = await accessOnly(publicKey)({
      headers: { 'cf-access-jwt-assertion': token },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.identity.source).toBe('service-token');
      expect(result.identity.email).toBe('ci-service-token');
    }
  });

  it('自签通道优先：测试通道可用时来源记为 test-jwt（Access 侧不参与）', async () => {
    const { publicKey, privateKey, jwks } = await makeKeys();
    const token = await new SignJWT({ email: 'admin@example.test' })
      .setProtectedHeader({ alg: 'RS256', kid: 'unit-key' })
      .setIssuer('https://unit.test')
      .setAudience(ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    const resolve = createIdentityResolver({
      access: ACCESS,
      testJwt: { enabled: true, jwks, iss: 'https://unit.test', aud: ACCESS_AUD },
      getKey: async () => publicKey,
    });

    const result = await resolve({ headers: { 'cf-access-jwt-assertion': token } });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.source).toBe('test-jwt');
  });

  it('交叉校验：邮箱头与断言不一致（含仅大小写不同）⇒ header-mismatch', async () => {
    const { publicKey, privateKey } = await makeKeys();
    const token = await new SignJWT({ email: 'admin@example.test' })
      .setProtectedHeader({ alg: 'RS256', kid: 'unit-key' })
      .setIssuer(ACCESS_ISS)
      .setAudience(ACCESS_AUD)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);

    const resolve = accessOnly(publicKey);

    const forged = await resolve({
      headers: {
        'cf-access-jwt-assertion': token,
        'cf-access-authenticated-user-email': 'attacker@example.com',
      },
    });
    expect(forged).toEqual({ ok: false, reason: 'header-mismatch' });

    // 逐字比较：大小写不同也判否（取更严的一侧）
    const caseDiffers = await resolve({
      headers: {
        'cf-access-jwt-assertion': token,
        'cf-access-authenticated-user-email': 'ADMIN@example.test',
      },
    });
    expect(caseDiffers).toEqual({ ok: false, reason: 'header-mismatch' });

    // 逐字一致 ⇒ 通过（真 Access 注入的就是同一串）
    const consistent = await resolve({
      headers: {
        'cf-access-jwt-assertion': token,
        'cf-access-authenticated-user-email': 'admin@example.test',
      },
    });
    expect(consistent.ok).toBe(true);
    if (consistent.ok) expect(consistent.identity.source).toBe('access-jwt');
  });
});
