/**
 * 管理面页面级集成测试 —— 走真实 HTTP 注入（`app.inject`），用自签 JWT 提供身份。
 *
 * 覆盖本批判据的**用户可见**部分：列表 → 建用户 → 签发（明文一次）→ 列出元信息 →
 * 轮换 → 吊销 → 停用，以及四语言、空态、错误条、分页与「明文不再出现」。
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
const TOKEN_PATTERN = /memo_[A-Za-z0-9_-]{43}/g;

let cfg: PortalConfig;
let db: Database.Database;
let tmpRoot: string;
let token: string;
let app: Awaited<ReturnType<typeof buildServer>>;

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  // 默认用 Accept-Language: en 断言英文文案（另有专门用例验证语言解析与记忆）
  return {
    host: 'localhost',
    'cf-access-jwt-assertion': token,
    'accept-language': 'en',
    ...extra,
  };
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  token = await new SignJWT({ email: ADMIN })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-pages-'));
  fs.mkdirSync(path.join(tmpRoot, 'users'), { recursive: true });
  cfg = loadConfig({
    PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
    PORTAL_MCP_HOST: 'mcp.localhost',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: path.join(tmpRoot, 'users'),
    PORTAL_TEST_JWT_ENABLED: '1',
      PORTAL_TEST_JWT_EMAIL: 'owner@agent-mate.ai',
    PORTAL_TEST_JWT_JWKS: JSON.stringify({ keys: [{ ...jwk, alg: 'RS256', kid: 'test-key-1', use: 'sig' }] }),
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

function form(pathname: string, fields: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: pathname,
    headers: authHeaders({ 'content-type': 'application/x-www-form-urlencoded' }),
    payload: new URLSearchParams(fields).toString(),
  });
}

describe('用户列表页', () => {
  it('无用户时渲染空态与建用户入口（导航四项齐全，当前页高亮）', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin/users', headers: authHeaders() });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('No users yet');
    expect(response.body).toContain('data-users-empty');
    expect(response.body).toContain('/admin/audit');
    expect(response.body).toContain('/admin/capacity');
    expect(response.body).toContain('/admin/mcp');
    expect(response.body).toMatch(/<a href="\/admin\/users" class="active">/);
  });

  it('创建成功后列表出现该行（含库路径、令牌数、创建时间与状态）', async () => {
    const created = await form('/admin/api/users', { handle: 'alice', returnTo: 'html' });
    expect(created.statusCode).toBe(303);
    expect(created.headers.location).toBe('/admin/users/alice');

    const response = await app.inject({ method: 'GET', url: '/admin/users', headers: authHeaders() });
    expect(response.body).toContain('>alice<');
    expect(response.body).toContain(path.join(tmpRoot, 'users', 'alice', 'ai-memory.db'));
    expect(response.body).toContain('Showing 1–1 of 1');
    expect(response.body).toContain('Active');
  });

  it('非法 handle：400 且带字段级错误条（不跳转、不丢输入）', async () => {
    const response = await form('/admin/api/users', { handle: 'Alice!', returnTo: 'html' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('lowercase letters, digits, underscore and hyphen');
    expect(response.body).toContain('value="Alice!"');
  });

  it('重复 handle：400 且给出「已占用」', async () => {
    const response = await form('/admin/api/users', { handle: 'alice', returnTo: 'html' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('already taken');
  });

  it('JSON 客户端：创建返回 201，重复返回 400 且带 messageKey', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/api/users',
      headers: authHeaders({ 'content-type': 'application/json' }),
      payload: { handle: 'bob' },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ handle: 'bob', status: 'active' });

    const duplicate = await app.inject({
      method: 'POST',
      url: '/admin/api/users',
      headers: authHeaders({ 'content-type': 'application/json' }),
      payload: { handle: 'bob' },
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json()).toMatchObject({ error: 'handle-exists', messageKey: 'users.error.handleExists' });
  });

  it('分页：超过一页时给出下一页链接', async () => {
    for (let index = 0; index < 20; index += 1) {
      const handle = `u${String(index).padStart(2, '0')}`;
      await form('/admin/api/users', { handle, returnTo: 'html' });
    }
    const response = await app.inject({ method: 'GET', url: '/admin/users', headers: authHeaders() });
    expect(response.body).toContain('Showing 1–20 of 22');
    expect(response.body).toContain('href="/admin/users?page=2"');
  });
});

describe('令牌生命周期（页面）', () => {
  it('签发：303 回详情页 + 明文只显示一次（方案 D）', async () => {
    const issued = await form('/admin/api/users/alice/tokens', { action: 'issue', label: 'MacBook' });
    // 方案 D：不再在 API 地址上渲染明文，而是 303 回详情页 + 一次性引用 cookie
    expect(issued.statusCode).toBe(303);
    expect(issued.headers.location).toBe('/admin/users/alice');
    expect(issued.body.match(TOKEN_PATTERN)).toBeNull();
    const cookie = String(issued.headers['set-cookie']).split(';')[0] ?? '';
    expect(cookie).toContain('portal_issued=');

    const page = await app.inject({
      method: 'GET',
      url: '/admin/users/alice',
      headers: authHeaders({ cookie }),
    });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Copy this token now');
    const plaintexts = page.body.match(TOKEN_PATTERN) ?? [];
    expect(plaintexts).toHaveLength(1);
    const plaintext = plaintexts[0] as string;

    // 第二次请求（模拟刷新）不得再次出现明文
    const again = await app.inject({
      method: 'GET',
      url: '/admin/users/alice',
      headers: authHeaders({ cookie }),
    });
    expect(again.body.match(TOKEN_PATTERN)).toBeNull();

    const detail = await app.inject({ method: 'GET', url: '/admin/users/alice', headers: authHeaders() });
    expect(detail.statusCode).toBe(200);
    expect(detail.body).toContain(plaintext.slice(0, 13));
    expect(detail.body).not.toContain(plaintext);
    expect(detail.body).toContain('MacBook');
  });

  it('轮换：旧前缀变为已吊销，新明文只显示一次（方案 D）', async () => {
    const detail = await app.inject({ method: 'GET', url: '/admin/users/alice', headers: authHeaders() });
    const prefix = (detail.body.match(/memo_[A-Za-z0-9_-]{8}/) ?? [])[0] as string;

    const rotated = await form('/admin/api/users/alice/tokens', {
      action: 'rotate',
      prefix,
      returnTo: 'html',
    });
    expect(rotated.statusCode).toBe(303);
    expect(rotated.headers.location).toBe('/admin/users/alice');
    const cookie = String(rotated.headers['set-cookie']).split(';')[0] ?? '';

    const page = await app.inject({
      method: 'GET',
      url: '/admin/users/alice',
      headers: authHeaders({ cookie }),
    });
    const plaintexts = page.body.match(TOKEN_PATTERN) ?? [];
    expect(plaintexts).toHaveLength(1);
    expect(plaintexts[0]).not.toBe(prefix);
    expect(page.body).toContain('Revoked');
  });

  it('吊销：303 回跳，行保留且动作入口消失', async () => {
    const detail = await app.inject({ method: 'GET', url: '/admin/users/alice', headers: authHeaders() });
    // 只认「有 rotate 对话框且带 prefix」，**不锁定链接是相对还是绝对** ——
    // 旧版正则写死了 `href="?dialog=…"`，于是把「相对链接」这个缺陷当成预期，
    // 反而在修好绝对地址后误报（P0 回归教训）。
    const activePrefix = (
      detail.body.match(new RegExp(`href="[^"]*\\?dialog=rotate&amp;prefix=memo_[A-Za-z0-9_-]{8}"`, 'g')) ?? []
    )[0];
    const prefix = (activePrefix?.match(/memo_[A-Za-z0-9_-]{8}/) ?? [])[0] as string;

    const revoked = await form('/admin/api/users/alice/tokens', {
      action: 'revoke',
      prefix,
      returnTo: 'html',
    });
    expect(revoked.statusCode).toBe(303);

    const after = await app.inject({ method: 'GET', url: '/admin/users/alice', headers: authHeaders() });
    expect(after.body).toContain(prefix);
    expect(after.body).not.toContain(`dialog=rotate&amp;prefix=${prefix}`);
  });

  it('对不存在的令牌操作：404 且页面给出「找不到该前缀」', async () => {
    const response = await form('/admin/api/users/alice/tokens', {
      action: 'revoke',
      prefix: 'memo_deadbeef',
      returnTo: 'html',
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('No token has that prefix');
  });

  it('JSON 客户端签发：明文在响应体里出现一次，且不落审计', async () => {
    const issued = await app.inject({
      method: 'POST',
      url: '/admin/api/users/bob/tokens',
      headers: authHeaders({ 'content-type': 'application/json' }),
      payload: { action: 'issue', label: 'Desktop' },
    });
    expect(issued.statusCode).toBe(201);
    const body = issued.json() as { plaintext: string; prefix: string };
    expect(body.plaintext).toMatch(/^memo_[A-Za-z0-9_-]{43}$/);
    expect(body.prefix).toBe(body.plaintext.slice(0, 13));

    const audits = db.prepare('SELECT detail_json FROM audit').all() as { detail_json: string }[];
    expect(JSON.stringify(audits)).not.toContain(body.plaintext);
  });
});

describe('用户停用（可逆软操作）', () => {
  it('停用：确认框列出待吊销令牌数；停用后状态变化且危险入口消失', async () => {
    const dialog = await app.inject({
      method: 'GET',
      url: '/admin/users/bob?dialog=deactivate',
      headers: authHeaders(),
    });
    expect(dialog.statusCode).toBe(200);
    expect(dialog.body).toContain('Active tokens');
    expect(dialog.body).toContain('dialog-deactivate');

    const deactivated = await form('/admin/api/users/bob/deactivate', { returnTo: 'html' });
    expect(deactivated.statusCode).toBe(303);

    const after = await app.inject({ method: 'GET', url: '/admin/users/bob', headers: authHeaders() });
    expect(after.body).toContain('Revoked');
    expect(after.body).not.toContain('dialog=deactivate');
  });

  it('再次停用：404/400 明确拒绝（不产生虚假成功）', async () => {
    const response = await form('/admin/api/users/bob/deactivate', { returnTo: 'html' });
    expect(response.statusCode).toBe(400);
    expect(response.body).toContain('already deactivated');
  });

  it('未知用户：404 页面', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users/nobody',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(404);
    expect(response.body).toContain('no longer exists');
  });
});

describe('四语言与占位页', () => {
  it('?lang=TW 立即生效，并把选择记进 cookie（刷新后保持）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users?lang=zh-TW',
      headers: authHeaders(),
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('使用者');
    expect(String(response.headers['set-cookie'])).toContain('portal_locale=zh-TW');

    const persisted = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: authHeaders({ cookie: 'portal_locale=zh-TW' }),
    });
    expect(persisted.body).toContain('使用者');
  });

  it('语言切换表单保留当前查询参数（分页不丢）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/admin/users?page=2&lang=zh-CN',
      headers: authHeaders(),
    });
    expect(response.body).toContain('name="page" value="2"');
  });

  it('未交付页面：导航可达并显式说明交付批次', async () => {
    // 三页共用同一句「随运维批次交付」表述，故用共有短语断言（避免绑死单复数词形）
    for (const pathname of ['/admin/audit', '/admin/capacity', '/admin/mcp'] as const) {
      const response = await app.inject({ method: 'GET', url: pathname, headers: authHeaders() });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body, response.body).toContain('NOT DELIVERED YET');
      expect(response.body, response.body).toContain('the operations batch');
    }
  });
});
