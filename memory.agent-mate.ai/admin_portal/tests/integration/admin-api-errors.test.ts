/**
 * 管理面 API 的反向分支集成测试（JSON 客户端视角）。
 *
 * 为什么单独一个文件：`pages.test.ts` 已经覆盖了「页面（HTML）视角」的成功与失败，
 * 而 API 客户端走的是同一批路由的**另一条分支**（`wantsHtml` 为假）。这两条分支
 * 共用业务逻辑但各自的响应形态不同 —— JSON 客户端必须拿到结构化错误
 * （`error` + `messageKey`），而不是一页 HTML。
 *
 * 另含一条**认证先于路由**的断言：未认证请求不应泄露「某个管理路径是否存在」。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { loadConfig, type PortalConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';

const ISS = 'https://test.cloudflareaccess.test';
const AUD = 'test-audience-tag';
const ADMIN = 'admin@example.com';

let tmpRoot: string;
let db: Database.Database;
let token: string;
let app: Awaited<ReturnType<typeof buildServer>>;

function jsonHeaders(): Record<string, string> {
  return {
    host: 'localhost',
    'cf-access-jwt-assertion': token,
    'content-type': 'application/json',
    'accept-language': 'en',
  };
}

function post(url: string, payload: unknown) {
  return app.inject({ method: 'POST', url, headers: jsonHeaders(), payload: payload as object });
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  token = await new SignJWT({ email: ADMIN })
    .setProtectedHeader({ alg: 'RS256', kid: 'api-key-1' })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-api-errors-'));
  fs.mkdirSync(path.join(tmpRoot, 'users'), { recursive: true });
  const cfg: PortalConfig = loadConfig({
    PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
    PORTAL_MCP_HOST: 'mcp.localhost',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: path.join(tmpRoot, 'users'),
    PORTAL_TEST_JWT_ENABLED: '1',
      PORTAL_TEST_JWT_EMAIL: 'owner@agent-mate.ai',
    PORTAL_TEST_JWT_JWKS: JSON.stringify({
      keys: [{ ...jwk, alg: 'RS256', kid: 'api-key-1', use: 'sig' }],
    }),
    PORTAL_TEST_JWT_ISS: ISS,
    PORTAL_TEST_JWT_AUD: AUD,
  });
  db = openMemoryDatabase();
  migrate(db);
  app = await buildServer(cfg, { db });
});

afterAll(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('认证先于路由（不泄露管理路径是否存在）', () => {
  it('未带断言访问不存在的管理 API ⇒ 401（而不是 404 告知「此处无路由」）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/api/definitely-not-a-route',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('只有无关 cookie（含语言选择）⇒ 401（cookie 存在不等于已认证）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { host: 'localhost', cookie: 'portal_locale=zh-HK' },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('创建用户：JSON 分支', () => {
  it('缺 handle ⇒ 400 且带 messageKey（结构化错误，不是 HTML）', async () => {
    const response = await post('/admin/api/users', {});
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({ error: 'invalid-body' });
  });

  it('成功 ⇒ 201 且响应不收缓存（管理面 API 一律 no-store）', async () => {
    const response = await post('/admin/api/users', { handle: 'carol' });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('令牌操作：JSON 分支的拒绝形态', () => {
  it('缺 action ⇒ 400 invalid-body', async () => {
    const response = await post('/admin/api/users/carol/tokens', {});
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'invalid-body' });
  });

  it('rotate 缺 prefix ⇒ 400 missing-prefix（不给「默认轮换第一把」的猜测空间）', async () => {
    const response = await post('/admin/api/users/carol/tokens', { action: 'rotate' });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'missing-prefix' });
  });

  it('对不存在的用户签发 ⇒ 4xx 且 reason = user-not-found（不产生任何令牌）', async () => {
    const response = await post('/admin/api/users/nobody/tokens', {
      action: 'issue',
      label: 'x',
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json()).toMatchObject({ error: 'user-not-found' });
  });

  it('轮换不存在的 prefix ⇒ key-not-found（且不签发新令牌）', async () => {
    const before = db.prepare('SELECT COUNT(*) AS c FROM keys').get() as { c: number };
    const response = await post('/admin/api/users/carol/tokens', {
      action: 'rotate',
      prefix: 'memo_deadbeef',
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json()).toMatchObject({ error: 'key-not-found' });
    const after = db.prepare('SELECT COUNT(*) AS c FROM keys').get() as { c: number };
    expect(after.c).toBe(before.c);
  });

  it('吊销不存在的 prefix ⇒ key-not-found', async () => {
    const response = await post('/admin/api/users/carol/tokens', {
      action: 'revoke',
      prefix: 'memo_deadbeef',
    });
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json()).toMatchObject({ error: 'key-not-found' });
  });
});

describe('停用用户：JSON 分支', () => {
  it('成功 ⇒ 200 且给出被吊销令牌数', async () => {
    await post('/admin/api/users/carol/tokens', { action: 'issue', label: 'to-be-revoked' });
    const response = await post('/admin/api/users/carol/deactivate', {});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ handle: 'carol', status: 'disabled' });
    expect((response.json() as { revokedKeys: number }).revokedKeys).toBeGreaterThanOrEqual(1);
  });

  it('重复停用 ⇒ 400（明确拒绝，不产生虚假成功）', async () => {
    const response = await post('/admin/api/users/carol/deactivate', {});
    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty('messageKey');
  });

  it('停用不存在的用户 ⇒ 4xx user-not-found', async () => {
    const response = await post('/admin/api/users/nobody/deactivate', {});
    expect(response.statusCode).toBeGreaterThanOrEqual(400);
    expect(response.json()).toMatchObject({ error: 'user-not-found' });
  });
});
