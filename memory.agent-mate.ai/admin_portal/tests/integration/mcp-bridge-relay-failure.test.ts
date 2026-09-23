/**
 * `3.8`「失败可诊断」的端到端验证：**转发阶段的异常**按来源分类、并留日志与审计。
 *
 * ## 为什么单独一个文件、并注入假传输
 *
 * 「`relay` 的 `catch` 被触发」这条路径**很难从外部稳定触发**：SDK 的 5 个 `throw` 点
 * （`Transport already started` · `Stateless transport cannot be reused across requests` ·
 * `Cannot send a response on a standalone SSE stream` · `No connection established for request ID`）
 * 全是「不该发生」的内部状态错误，正常的协议输入会被 SDK 优雅处理掉
 * （实测：发一个无 `method` 的响应消息，SDK 回 **202** 而不是抛错）。
 *
 * 因此这里用 `vi.mock` 把 `createBridgeTransport` 换成一个**可控的假传输**：
 * 它的 `handleRequest` 抛指定错误、并可选择「先发响应头再抛」。
 * 这样两条分支（响应头未发 ⇒ 用状态码表达；已发 ⇒ 只能结束流）都能被**确定地**覆盖，
 * 分类结果也第一次得到端到端断言（而不只是单测 `classifyRelayFailure`）。
 *
 * 判据真源：[`web-design.md`](../../../specs/web-portal/web-design.md) §12.5 的
 * 「转发阶段失败的分类定档」与纪律 ④。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { loadConfig, type PortalConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';
import { createUser } from '../../src/web/services/users';
import { issueKey } from '../../src/web/services/keys';
import { listAudit } from '../../src/web/db/repo/audit';

/** 假传输的行为开关（可在每条用例里改）。 */
const control = vi.hoisted(() => ({
  /** 是否在抛错**之前**先发响应头（模拟「SSE 已开始」）。 */
  headersSentFirst: false,
  /** 抛出的错误码；`undefined` 表示普通 Error（无 code）。 */
  code: undefined as number | undefined,
}));

vi.mock('../../src/bridge/spawn', () => ({
  spawnUpstream: async () => ({
    client: {},
    commandLine: 'mock-upstream',
    stderrTail: () => '',
    close: async () => {},
  }),
}));

vi.mock('../../src/bridge/transport', () => ({
  createBridgeTransport: async () => ({
    sessionId: 'mock-session',
    isClosed: () => false,
    handleRequest: async (_req: unknown, res: { writeHead: (code: number) => void }) => {
      if (control.headersSentFirst) res.writeHead(200);
      const error = new Error('mock relay failure');
      if (control.code !== undefined) {
        (error as { code?: number }).code = control.code;
      }
      throw error;
    },
    close: async () => {},
  }),
}));

const ACTOR = 'owner@agent-mate.ai';

let tmpRoot: string;
let app: FastifyInstance;
let db: Database.Database;
let cfg: PortalConfig;
let port: number;
let token: string;

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-relay-failure-'));
  cfg = loadConfig({
    PORTAL_ENV: 'development',
    PORTAL_ADMIN_HOST: 'localhost',
    PORTAL_MCP_HOST: '127.0.0.1',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: path.join(tmpRoot, 'users'),
    DASHSCOPE_API_KEY: 'sk-test-key',
    PORTAL_LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);

  db = openMemoryDatabase();
  migrate(db);
  app = await buildServer(cfg, { db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;

  fs.mkdirSync(cfg.usersRoot, { recursive: true });
  const deps = { db, usersRoot: cfg.usersRoot, actor: ACTOR };
  const created = createUser(deps, { handle: 'alice' });
  if (!created.ok) throw new Error(`createUser failed: ${JSON.stringify(created)}`);
  const issued = issueKey(deps, { handle: 'alice' });
  if (!issued.ok) throw new Error('issueKey failed');
  token = issued.plaintext;
}, 60_000);

afterAll(async () => {
  await app?.close();
  db?.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/** 发一次「会走到 `relay`」的请求（无 `Mcp-Session-Id` ⇒ 走新建会话路径）。 */
async function sendInitialize(): Promise<Response> {
  return fetch(new URL(`http://127.0.0.1:${port}/mcp`), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'relay-failure-it', version: '0.0.0' },
      },
    }),
  });
}

describe('转发阶段失败：分类 + 留痕（`3.8` / TC-M-L1-17）', () => {
  it('请求超时（-32001）⇒ 504 upstream_timeout，并写一行审计 mcp_upstream_error', async () => {
    control.headersSentFirst = false;
    control.code = -32001;
    const before = listAudit(db, { limit: 1000, offset: 0 }).length;

    const response = await sendInitialize();

    expect(response.status, '分类失效（应归 504）').toBe(504);
    await expect(response.json()).resolves.toMatchObject({
      error: 'upstream_timeout',
      message: 'Upstream MCP server did not respond in time.',
    });

    const rows = listAudit(db, { limit: 1000, offset: 0 });
    expect(rows.length, '转发失败未写审计行').toBeGreaterThan(before);
    expect(rows[0]?.action, '审计动作用错（应与「会话被拒」分开）').toBe('mcp_upstream_error');
  }, 30_000);

  it('内部状态错误（无 code）⇒ 502 upstream_error —— 不再伪装成「上游超时」', async () => {
    control.headersSentFirst = false;
    control.code = undefined;

    const response = await sendInitialize();

    expect(response.status, '内部错误被误报成「上游超时」').toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: 'upstream_error' });
  }, 30_000);

  it('上游连接已断（-32000）⇒ 503 upstream_unavailable（与 spawn 失败同形）', async () => {
    control.headersSentFirst = false;
    control.code = -32000;

    const response = await sendInitialize();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ error: 'upstream_unavailable' });
  }, 30_000);

  it('响应头已发出 ⇒ 状态码改不动，只能显式结束流（否则客户端会挂到上游最终响应）', async () => {
    control.headersSentFirst = true;
    control.code = undefined;

    const response = await sendInitialize();

    // SDK 在转发阶段已把响应头写出（`200`/`202`）⇒ 状态码无法再改写（§12.5 的实测结论）。
    expect([200, 202], `实际 ${response.status}`).toContain(response.status);
    await expect(response.text(), '流未被结束 ⇒ 超时兜底形同不存在').resolves.toBe('');
  }, 30_000);
});
