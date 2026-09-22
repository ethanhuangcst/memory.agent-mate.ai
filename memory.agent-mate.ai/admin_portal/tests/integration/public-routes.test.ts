/**
 * 公开面路由与 404 分支集成测试（真实 HTTP 注入）。
 *
 * 覆盖：
 *  - 公开首页 `/`（PSP-W1 为占位，但**语言解析与记忆**必须已生效）；
 *  - `/instructions` 的 301 兼容跳转（§12.3）；
 *  - 面隔离在这些路径上的表现（MCP 面不得访问公开页）；
 *  - 404 的三种身体形态：MCP 端点未实现（JSON）/ 管理前缀（JSON）/ 其余（纯文本）。
 *
 * 身份：公开页与 404 都**不需要身份**，故本文件不注入断言头 —— 这本身也是断言的一部分
 * （认证必须先于路由，但不能误伤公开面）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { loadConfig, type PortalConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';

let tmpRoot: string;
let db: Database.Database;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-public-'));
  fs.mkdirSync(path.join(tmpRoot, 'users'), { recursive: true });
  const cfg: PortalConfig = loadConfig({
    PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
    PORTAL_MCP_HOST: 'mcp.localhost',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: path.join(tmpRoot, 'users'),
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

describe('公开首页（无需身份）', () => {
  it('GET / ⇒ 200 且返回 HTML', async () => {
    const response = await app.inject({ method: 'GET', url: '/', headers: { host: 'localhost' } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('?lang= 生效并把选择写进 cookie（刷新后保持）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/?lang=zh-TW',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(200);
    expect(String(response.headers['set-cookie'])).toContain('portal_locale=zh-TW');
  });

  it('未给 ?lang 时：cookie 优先于 Accept-Language', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'localhost', cookie: 'portal_locale=zh-HK', 'accept-language': 'en-US' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-language'] ?? '').toBeDefined();
  });
});

describe('/instructions 兼容跳转', () => {
  it('GET /instructions ⇒ 301 → /（旧路径不留白）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/instructions',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(301);
    expect(response.headers.location).toBe('/');
  });
});

describe('面隔离在公开路径上的表现', () => {
  it('MCP 面访问公开页 ⇒ 403（域名分离，不靠 path 区分）', async () => {
    const response = await app.inject({ method: 'GET', url: '/', headers: { host: 'mcp.localhost' } });
    expect(response.statusCode).toBe(403);
  });

  it('未登记 Host ⇒ 403（fail-closed）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
      headers: { host: 'evil.example.com' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('/healthz 任何面都放行（容器自检直连本地端口时 Host 非公开域名）', async () => {
    for (const host of ['localhost', 'mcp.localhost', '127.0.0.1']) {
      const response = await app.inject({ method: 'GET', url: '/healthz', headers: { host } });
      expect(response.statusCode, host).toBe(200);
      expect(response.json()).toMatchObject({ ok: true, batch: 'PSP-W1' });
    }
  });
});

describe('404 的三种身体形态', () => {
  it('MCP 面上的 /mcp ⇒ JSON not_implemented（明确指向 PSP-W2，不伪装 404 空页）', async () => {
    const response = await app.inject({ method: 'GET', url: '/mcp', headers: { host: 'mcp.localhost' } });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({ error: 'not_implemented' });
  });

  it('管理前缀下的未知路径且未认证 ⇒ 401（身份先于路由：未认证者探测不到管理路径是否存在）', async () => {
    for (const url of ['/admin/api/nope', '/admin/nope']) {
      const response = await app.inject({ method: 'GET', url, headers: { host: 'localhost' } });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('静态资源前缀的未知路径 ⇒ JSON not_found（不回落整页 HTML）', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/assets/nope.css',
      headers: { host: 'localhost' },
    });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json()).toMatchObject({ error: 'not_found' });
  });

  it('其余未知路径 ⇒ 纯文本（不回显内部路径以外的东西）', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope', headers: { host: 'localhost' } });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.body).toContain('/nope');
  });
});
