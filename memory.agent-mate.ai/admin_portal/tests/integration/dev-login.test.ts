/**
 * 开发登录入口（A）的集成测试 —— 把 [`issues-log.md`] Issue 6 [FATAL] 固化为回归防护。
 *
 * 三条验收（对应 `specs/web-portal/web-login-plan.md` §3）：
 *  1. **不预注入 cookie**：GET 登录页 → POST 登录 → 用**服务端下发的** cookie 访问 `/admin/users` ⇒ 200；
 *  2. production 配置下该路由**不存在**（`printRoutes()` 里没有它；未认证访问仍是 401，与所有管理路径一致 ——
 *     既有安全模型是「身份先于路由」，未认证者探测不到管理路径是否存在，故不能断言 404）；
 *  3. 非回环 Host ⇒ **403**（面隔离先拒）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { loadConfig, type PortalConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { listAudit } from '../../src/web/db/repo/audit';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';

const ISS = 'https://test.cloudflareaccess.test';
const AUD = 'test-audience-tag';
const ADMIN = 'admin@example.com';
/** 开发登录必须使用**配置提供的真实邮箱**，不得写死测试值（G1/G2）。 */
const CONFIGURED_EMAIL = 'owner@agent-mate.ai';
const DEV_LOGIN = '/admin/dev-login';

let tmpRoot: string;
let jwksJson: string;
let token: string;

let devApp: Awaited<ReturnType<typeof buildServer>>;
let devDb: Database.Database;
let prodApp: Awaited<ReturnType<typeof buildServer>>;
let prodDb: Database.Database;

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  jwksJson = JSON.stringify({
    keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'test-key-1', use: 'sig' }],
  });
  token = await new SignJWT({ email: CONFIGURED_EMAIL })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-dev-login-'));
  fs.mkdirSync(path.join(tmpRoot, 'users'), { recursive: true });
  // 令牌文件位置与 dev-login 的推导一致：JWKS 为内联 JSON 时回退到 `<dbPath 目录>/dev/token`
  fs.mkdirSync(path.join(tmpRoot, 'dev'), { recursive: true });
  fs.writeFileSync(path.join(tmpRoot, 'dev', 'token'), `${token}\n`, 'utf8');

  const common = {
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: path.join(tmpRoot, 'users'),
  } as const;

  const devCfg: PortalConfig = loadConfig({
    ...common,
    PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
    PORTAL_MCP_HOST: 'mcp.localhost',
    PORTAL_TEST_JWT_ENABLED: '1',
    PORTAL_TEST_JWT_JWKS: jwksJson,
    PORTAL_TEST_JWT_ISS: ISS,
    PORTAL_TEST_JWT_AUD: AUD,
    PORTAL_TEST_JWT_EMAIL: CONFIGURED_EMAIL,
  });
  devDb = openMemoryDatabase();
  migrate(devDb);
  devApp = await buildServer(devCfg, { db: devDb });

  // production：自签通道必须关闭；真身份配置（团队域 + AUD）仅用于让配置本身合法
  const prodCfg: PortalConfig = loadConfig({
    ...common,
    PORTAL_ADMIN_HOST: 'admin.example.test',
    PORTAL_MCP_HOST: 'mcp.example.test',
    PORTAL_ENV: 'production',
    PORTAL_TEST_JWT_ENABLED: '0',
    PORTAL_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    PORTAL_ACCESS_AUD: AUD,
  });
  prodDb = openMemoryDatabase();
  migrate(prodDb);
  prodApp = await buildServer(prodCfg, { db: prodDb });
});

afterAll(async () => {
  await devApp.close();
  await prodApp.close();
  devDb.close();
  prodDb.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('开发登录入口（仅在自签通道启用时存在）', () => {
  it('不预注入 cookie：登录页 → POST → 用服务端下发的 cookie 访问管理面 ⇒ 200', async () => {
    const page = await devApp.inject({ method: 'GET', url: DEV_LOGIN, headers: { host: 'localhost' } });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('data-dev-login');
    expect(page.body).toContain(`action="${DEV_LOGIN}"`);
    // 登录页是**独立文档**：没有任何身份相关 cookie 被预先写入
    expect(page.headers['set-cookie']).toBeUndefined();

    const login = await devApp.inject({
      method: 'POST',
      url: DEV_LOGIN,
      headers: { host: 'localhost' },
    });
    expect(login.statusCode).toBe(303);
    expect(login.headers.location).toBe('/admin/users');
    const setCookie = String(login.headers['set-cookie']);
    expect(setCookie).toContain('CF_Authorization=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    // 关键一步：只用**服务端下发的**那份 cookie 访问管理面（模拟真浏览器导航）
    const cookie = setCookie.split(';')[0] ?? '';
    const users = await devApp.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'localhost', cookie },
    });
    expect(users.statusCode).toBe(200);
    expect(users.body).toContain('data-users-empty');
  });

  it('令牌文件缺失时：GET 明确提示（不是无法解释的失败），POST ⇒ 409', async () => {
    const tokenFile = path.join(tmpRoot, 'dev', 'token');
    const saved = fs.readFileSync(tokenFile, 'utf8');
    fs.rmSync(tokenFile);

    try {
      const page = await devApp.inject({ method: 'GET', url: DEV_LOGIN, headers: { host: 'localhost' } });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('data-dev-login-missing');

      const login = await devApp.inject({
        method: 'POST',
        url: DEV_LOGIN,
        headers: { host: 'localhost' },
      });
      expect(login.statusCode).toBe(409);
    } finally {
      fs.writeFileSync(tokenFile, saved, 'utf8');
    }
  });

  it('production 配置下该路由**不存在**；未认证访问仍是 401（与所有管理路径一致）', async () => {
    // 注意：printRoutes() 输出的是**按段缩进的树**（不会有 `/admin/dev-login` 这一整串），
    // 因此按**段名**断言（`dev-login` 是这条路由独有的段）。
    expect(prodApp.printRoutes()).not.toContain('dev-login');
    expect(devApp.printRoutes()).toContain('dev-login');

    const response = await prodApp.inject({
      method: 'GET',
      url: DEV_LOGIN,
      headers: { host: 'admin.example.test' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('非回环 Host ⇒ 403（面隔离先于身份与路由）', async () => {
    const response = await devApp.inject({
      method: 'GET',
      url: DEV_LOGIN,
      headers: { host: 'evil.example.com' },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('401 页自诊断（B）', () => {
  it('开发实例：401 页给出 Host / 通道状态 / 令牌文件 / 登录入口', async () => {
    const response = await devApp.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).toContain('data-dev-diagnostics');
    expect(response.body).toContain(DEV_LOGIN);
  });

  it('生产实例：401 页**不含**任何自诊断（与既有行为一致，不新增暴露面）', async () => {
    const response = await prodApp.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'admin.example.test' },
    });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('data-dev-diagnostics');
    expect(response.body).not.toContain(DEV_LOGIN);
  });
});

// ---- G1/G2/G4：真实邮箱身份（TDD 阶段 0，**先红**）----

describe('真实邮箱身份（G1/G2/G4）', () => {
  /**
   * 关于 G1「开发登录身份 = 真实邮箱」的**覆盖边界**（诚实登记，不假装测试覆盖了它）：
   *
   * - 门户侧的契约由 **T2**（缺邮箱即拒绝启动）与下面的 **T4**（身份→审计）覆盖；
   * - 「`--dev-login` 脚本真的用配置邮箱签发」是 **shell 行为**，vitest 覆盖不到 ⇒
   *   按流程条款第 3 条，交由**人手验收**：跑一次 `--dev-login`，核对启动横幅打印的身份
   *   与登录后页面身份块一致。
   *
   * 这里**刻意不写**一个「用测试夹具自签令牌、再断言夹具里的 email」的用例 —— 那只会是绿的，
   * 却给人「真实邮箱身份已验证」的错觉。
   */

  it('T4 用真实邮箱登录后，审计 actor 等于该邮箱', async () => {
    const login = await devApp.inject({
      method: 'POST',
      url: DEV_LOGIN,
      headers: { host: 'localhost' },
    });
    const cookie = String(login.headers['set-cookie']).split(';')[0] ?? '';

    const created = await devApp.inject({
      method: 'POST',
      url: '/admin/api/users',
      headers: { host: 'localhost', cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ handle: 'auditprobe' }),
    });
    expect(created.statusCode).toBeLessThan(400);

    const rows = listAudit(devDb, { limit: 5, offset: 0 });
    expect(rows.some((row) => row.actor === CONFIGURED_EMAIL)).toBe(true);
  });
});

describe('未配置真实邮箱即拒绝（G2）', () => {
  it('T2 启用自签通道但缺少邮箱 ⇒ loadConfig 抛错（绝不回落到测试邮箱）', () => {
    expect(() =>
      loadConfig({
        PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
        PORTAL_MCP_HOST: 'mcp.localhost',
        PORTAL_DB_PATH: path.join(tmpRoot, 'probe.db'),
        PORTAL_TEST_JWT_ENABLED: '1',
        PORTAL_TEST_JWT_JWKS: jwksJson,
        PORTAL_TEST_JWT_ISS: ISS,
        PORTAL_TEST_JWT_AUD: AUD,
        // 故意不提供 PORTAL_TEST_JWT_EMAIL
      }),
    ).toThrow(/PORTAL_TEST_JWT_EMAIL/);
  });
});
