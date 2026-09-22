/**
 * 方案 D 验收（Issue 4 根治）：签发/轮换 → **303 回详情页** → 明文**只显示一次**。
 *
 * 四条护栏（对应 `specs/web-portal/portal-identity-plan.md` §7 的冻结规格）：
 *  T1 响应 303 且 Location 是详情页，**响应体里不再有明文**；
 *  T2 明文只出现一次：第一次 GET 有、第二次（模拟刷新）没有且给出「已过期」提示；
 *  T3 暂存语义：单次取用即删、过期取不到、有条数上限；
 *  T4 明文**不入日志、不入库**（审计 JSON 里不得出现明文）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { loadConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { listAudit } from '../../src/web/db/repo/audit';
import { buildServer } from '../../src/server';
import { clearIssuedStash, put, take } from '../../src/web/issued-stash';

const ISS = 'https://test.cloudflareaccess.test';
const AUD = 'test-audience-tag';
const EMAIL = 'owner@agent-mate.ai';
const TOKEN_PATTERN = /memo_[A-Za-z0-9_-]{20,}/;

let tmpRoot: string;
let token: string;
let db: Database.Database;
let app: Awaited<ReturnType<typeof buildServer>>;

function h(extra: Record<string, string> = {}): Record<string, string> {
  return {
    host: 'localhost',
    'cf-access-jwt-assertion': token,
    'accept-language': 'en',
    ...extra,
  };
}

async function issueOnce(label: string) {
  return app.inject({
    method: 'POST',
    url: '/admin/api/users/once/tokens',
    headers: h({ 'content-type': 'application/x-www-form-urlencoded' }),
    payload: new URLSearchParams({ action: 'issue', label, returnTo: 'html' }).toString(),
  });
}

beforeAll(async () => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  token = await new SignJWT({ email: EMAIL })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
    .setIssuer(ISS)
    .setAudience(AUD)
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);

  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-issued-'));
  fs.mkdirSync(path.join(tmpRoot, 'users'), { recursive: true });
  const cfg = loadConfig({
    PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
    PORTAL_MCP_HOST: 'mcp.localhost',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: path.join(tmpRoot, 'users'),
    PORTAL_TEST_JWT_ENABLED: '1',
    PORTAL_TEST_JWT_JWKS: JSON.stringify({
      keys: [{ ...jwk, alg: 'RS256', kid: 'test-key-1', use: 'sig' }],
    }),
    PORTAL_TEST_JWT_ISS: ISS,
    PORTAL_TEST_JWT_AUD: AUD,
    PORTAL_TEST_JWT_EMAIL: EMAIL,
  });
  db = openMemoryDatabase();
  migrate(db);
  app = await buildServer(cfg, { db });
  await app.inject({
    method: 'POST',
    url: '/admin/api/users',
    headers: h({ 'content-type': 'application/json' }),
    payload: JSON.stringify({ handle: 'once' }),
  });
});

afterEach(() => clearIssuedStash());

afterAll(async () => {
  await app.close();
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('方案 D：明文只显示一次（PRG + 服务端暂存）', () => {
  it('T1 签发后为 303 且 Location 是详情页；响应体里不再出现明文', async () => {
    const response = await issueOnce('d1');
    expect(response.statusCode).toBe(303);
    expect(response.headers.location).toBe('/admin/users/once');
    expect(response.body).not.toMatch(TOKEN_PATTERN);
    expect(String(response.headers['set-cookie'])).toContain('portal_issued=');
  });

  it('T2 明文只出现一次：第二次请求（模拟刷新）拿不到，并显示「已过期」提示', async () => {
    const issued = await issueOnce('d2');
    const cookie = String(issued.headers['set-cookie']).split(';')[0] ?? '';

    const first = await app.inject({
      method: 'GET',
      url: '/admin/users/once',
      headers: h({ cookie }),
    });
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatch(TOKEN_PATTERN);

    const second = await app.inject({
      method: 'GET',
      url: '/admin/users/once',
      headers: h({ cookie }),
    });
    expect(second.body).not.toMatch(TOKEN_PATTERN);
    expect(second.body).toContain('data-issued-expired');
  });

  it('T3 暂存语义：单次取用即删、过期取不到、有条数上限', () => {
    const now = 1_000_000;
    const id = put('memo_probe', now);
    expect(take(id, now + 1)).toBe('memo_probe');
    expect(take(id, now + 1)).toBeUndefined();

    const expired = put('memo_expired', now);
    expect(take(expired, now + 61_000)).toBeUndefined();

    const marker = put('memo_marker', now);
    for (let index = 0; index < 40; index += 1) put(`memo_fill_${index}`, now);
    expect(take(marker, now)).toBeUndefined();
  });

  it('T4 明文不入库（审计 JSON 中不得出现明文）', async () => {
    const issued = await issueOnce('d4');
    const cookie = String(issued.headers['set-cookie']).split(';')[0] ?? '';
    const page = await app.inject({
      method: 'GET',
      url: '/admin/users/once',
      headers: h({ cookie }),
    });
    const plaintext = (page.body.match(TOKEN_PATTERN) ?? [''])[0];
    expect(plaintext).not.toBe('');
    expect(JSON.stringify(listAudit(db, { limit: 50, offset: 0 }))).not.toContain(plaintext);
  });
});
