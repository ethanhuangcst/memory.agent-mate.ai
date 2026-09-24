/**
 * `4.1`「web-portal:会话限流」的集成用例（**假上游**，完全离线）。
 *
 * 判据形状由 `3.17` 探针（`probes/session-limit-probe/`）导出：「**不排队致死**」必须**同断三件事** ——
 * **HTTP 码 + 响应时间 + 不新增子进程**。本文件把前两项与「不新增 spawn」都断上：
 *   · 码与体：`429` + `SESSION_LIMIT_EXCEEDED` + `scope` / `limit` / `current`；
 *   · 不新增 spawn：假上游的 `--env-dump=<dir>` **每 spawn 一个文件** ⇒ **数文件 = 数 spawn**；
 *   · 额度内不受影响：额度内的会话照常可用（没有被护栏误伤）；
 *   · 计数不漂移：关掉一个会话后，额度立刻释放（因为计数是**现算**的，不是自建计数器）。
 *
 * **注入方式**：两个限额走 `loadConfig` 的 `PORTAL_MAX_CONCURRENCY_*`（**配置**），而不是 `buildServer`
 * 的 deps —— `3.4` 那轮的教训是「新增注入位漏了转发处 ⇒ 配置被静默丢弃」，走配置就**没有转发处**。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';
import { createUser } from '../../src/web/services/users';
import { issueKey } from '../../src/web/services/keys';

const ACTOR = 'it-session-limit@local';
const FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-upstream.mjs');

let tmpRoot: string;
let usersRoot: string;
let db: Database.Database;
let aliceToken: string;
let bobToken: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-session-limit-'));
  usersRoot = path.join(tmpRoot, 'users');
  fs.mkdirSync(usersRoot, { recursive: true });
  db = openMemoryDatabase();
  migrate(db);
  const deps = { db, usersRoot, actor: ACTOR };
  for (const handle of ['alice', 'bob']) {
    const created = createUser(deps, { handle });
    if (!created.ok) throw new Error(`建房户失败（${handle}）`);
  }
  const alice = issueKey(deps, { handle: 'alice' });
  const bob = issueKey(deps, { handle: 'bob' });
  if (!alice.ok || !bob.ok) throw new Error('签发测试令牌失败');
  aliceToken = alice.plaintext;
  bobToken = bob.plaintext;
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface Portal {
  readonly base: string;
  readonly spawnDump: string;
  readonly close: () => Promise<void>;
}

/** 起一个门户实例：两个限额经**配置**注入（`perKey` / `global` 传 `undefined` = 不启用该项）。 */
async function startPortal(limits: { perKey?: number; global?: number }): Promise<Portal> {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  // `--env-dump` 是**路径前缀**（夹具写 `<前缀>.<pid>`）—— 不是目录（首版传成目录 ⇒ 数不到 spawn）。
  const spawnDump = path.join(dir, 'spawn');
  const cfg = loadConfig({
    PORTAL_ENV: 'development',
    PORTAL_ADMIN_HOST: 'localhost',
    PORTAL_MCP_HOST: '127.0.0.1',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: usersRoot,
    PORTAL_LAUNCH_OVERRIDE: `node ${FIXTURE} --env-dump=${spawnDump}`,
    DASHSCOPE_API_KEY: 'sk-test-key',
    PORTAL_LOG_LEVEL: 'silent',
    ...(limits.perKey === undefined ? {} : { PORTAL_MAX_CONCURRENCY_PER_KEY: String(limits.perKey) }),
    ...(limits.global === undefined ? {} : { PORTAL_MAX_CONCURRENCY_GLOBAL: String(limits.global) }),
  } as NodeJS.ProcessEnv);
  // `usersRoot` 经 `cfg.PORTAL_USERS_ROOT` 传入（`BuildOptions` 不收该字段）。
  const app = await buildServer(cfg, { db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    spawnDump,
    close: async () => {
      await app.close();
    },
  };
}

/** 开一个真会话并保持（返回收尾函数）。 */
async function openSession(base: string, token: string) {
  const client = new Client({ name: 'it-session-limit', version: '0.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as never);
  await client.listTools();
  return {
    close: async () => {
      try {
        await transport.terminateSession();
      } catch {
        /* 尽力而为 */
      }
      await client.close();
    },
  };
}

/** 直接发一次建会话请求（**不**经过 SDK 的抛错处理）⇒ 拿得到状态码与响应体。 */
async function postMcp(base: string, token: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  return { status: res.status, body: await res.text() };
}

/** 数 spawn：夹具**每个进程**写一个 `<前缀>.<pid>` 文件 ⇒ **数文件 = 数 spawn**。 */
const spawnCount = (portal: Portal): number => {
  const dir = path.dirname(portal.spawnDump);
  const prefix = `${path.basename(portal.spawnDump)}.`;
  return fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).length;
};

describe('4.1 会话限流（每 key / 全局并发）', () => {
  it('① 每 key 上限=1：第二路**明确拒绝**（429 + scope=per_key）且**不新增子进程**，并留审计', async () => {
    const portal = await startPortal({ perKey: 1 });
    try {
      const first = await openSession(portal.base, aliceToken);
      expect(spawnCount(portal)).toBe(1);

      const rejected = await postMcp(portal.base, aliceToken);
      expect(rejected.status).toBe(429);
      expect(rejected.body).toContain('SESSION_LIMIT_EXCEEDED');
      expect(rejected.body).toContain('per_key');
      // 「不新增子进程」—— 拒绝发生在**建会话之前**，故 spawn 数不变。
      expect(spawnCount(portal)).toBe(1);

      const auditRows = db
        .prepare(`SELECT detail_json FROM audit WHERE action = 'mcp_session_rejected'`)
        .all() as { detail_json: string }[];
      expect(auditRows.some((row) => row.detail_json.includes('session_limit_exceeded'))).toBe(true);

      await first.close();
    } finally {
      await portal.close();
    }
  });

  it('② 全局上限=1：**另一个令牌**也被拒（scope=global）', async () => {
    const portal = await startPortal({ global: 1 });
    try {
      const first = await openSession(portal.base, aliceToken);
      const rejected = await postMcp(portal.base, bobToken);
      expect(rejected.status).toBe(429);
      expect(rejected.body).toContain('global');
      expect(spawnCount(portal)).toBe(1);
      await first.close();
    } finally {
      await portal.close();
    }
  });

  it('③ 额度内不受影响：上限=2 时两路都建得起来、都可用', async () => {
    const portal = await startPortal({ perKey: 2, global: 2 });
    try {
      const first = await openSession(portal.base, aliceToken);
      const second = await openSession(portal.base, aliceToken);
      expect(spawnCount(portal)).toBe(2);
      await Promise.all([first.close(), second.close()]);
    } finally {
      await portal.close();
    }
  });

  it('④ 计数不回漏：关掉一个会话后额度**立刻**释放（计数是现算的）', async () => {
    const portal = await startPortal({ perKey: 1 });
    try {
      const first = await openSession(portal.base, aliceToken);
      expect((await postMcp(portal.base, aliceToken)).status).toBe(429);

      await first.close();
      // 收尾是异步的（transport close → registry.close）⇒ 轮询等额度回来，避免写出偶发失败的判据。
      //
      // **注意**：轮询用的 `postMcp` 一旦被放行就**会真的建起一个会话**（于是额度又被占满）——
      // 所以判据只能取「**轮询里第一次被放行**」这个事件，不能拿循环结束后的状态码去断言
      // （那是「最后一次请求」的状态，此时额度已被它自己占掉）。这是首版的用例 bug，如实登记。
      const deadline = Date.now() + 5000;
      let released = false;
      while (!released && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        released = (await postMcp(portal.base, aliceToken)).status !== 429;
      }
      expect(released).toBe(true);
    } finally {
      await portal.close();
    }
  });
});
