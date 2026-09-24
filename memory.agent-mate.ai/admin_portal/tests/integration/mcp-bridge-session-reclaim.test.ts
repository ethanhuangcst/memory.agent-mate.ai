/**
 * 会话**回收**的集成测试 —— Sprint 4 `3.4`「mcp:会话回收」。
 *
 * 覆盖的验收条件与用例：
 *  - `AC3.4`（`web-stories.md` §S3）会话结束后子进程被回收 → `TC-P-L1-04`
 *  - `TC-P-L3-04` 吊销即时生效（既有会话被终止）→ 本文件 ③
 *  - `TC-P-L3-06` 的后半：空闲超时与单会话时长生效 → 本文件 ①②
 *
 * ## 为什么用「注入短值 + 观察子进程退出」
 *
 * 到期判定本身是 `SessionRegistry.reap` 的**纯方法**（吃 `now`），已在
 * `tests/unit/bridge-modules.test.ts` 里**不睡觉**地覆盖了各支判定；这里要证的是**接线**
 *（`route.ts` 的单一 ticker 有没有真的按注入值去调它、以及回收有没有真的落到子进程上）。
 * 因此用「注入短限额 + 夹具写 `--closed-marker`」这套既有观测位，而不是去断言内部状态。
 *
 * ## ③ 里为什么**不**注入任何限额
 *
 * 吊销那条路径若同时开着空闲/最长时长，就无法区分「是吊销回收的」还是「是 ticker 回收的」
 * ⇒ ③ **刻意只留吊销这一条触发**，让结论唯一归因。
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
import { issueKey, revokeKey } from '../../src/web/services/keys';
import { listAudit } from '../../src/web/db/repo/audit';

const ACTOR = 'owner@agent-mate.ai';
const FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-upstream.mjs');

let tmpRoot: string;
let usersRoot: string;
let db: Database.Database;
let tokenAlice: string;
let aliceKeyPrefix: string;
let tokenBob: string;
/**
 * 第三个用户**专供 `AC4.3` 那条用例**：用例 ③ 会**吊销 alice 的令牌**，而同一文件里的用例共享
 * 同一个门户库 ⇒ 复用 alice 的令牌会让 ④ 直接 401（实测踩过）。**用例之间不得靠顺序互相让路**。
 */
let tokenCarol: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-session-reclaim-it-'));
  usersRoot = path.join(tmpRoot, 'users');
  fs.mkdirSync(usersRoot, { recursive: true });

  db = openMemoryDatabase();
  migrate(db);

  const deps = { db, usersRoot, actor: ACTOR };
  for (const handle of ['alice', 'bob', 'carol']) {
    const created = createUser(deps, { handle });
    if (!created.ok) throw new Error(`createUser(${handle}) failed`);
  }
  const aliceKey = issueKey(deps, { handle: 'alice' });
  const bobKey = issueKey(deps, { handle: 'bob' });
  const carolKey = issueKey(deps, { handle: 'carol' });
  if (!aliceKey.ok || !bobKey.ok || !carolKey.ok) throw new Error('签发令牌失败');
  tokenAlice = aliceKey.plaintext;
  aliceKeyPrefix = aliceKey.key.key_prefix;
  tokenBob = bobKey.plaintext;
  tokenCarol = carolKey.plaintext;
});

afterAll(() => {
  db?.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface Portal {
  readonly base: string;
  readonly envDump: string;
  readonly closedMarker: string;
  readonly close: () => Promise<void>;
}

/** 限额只在这里注入（生产从 `config.ts` 的两把键读；未提供 = 该触发不启用）。 */
async function startPortal(limits: {
  idleMs?: number;
  maxMs?: number;
  reapIntervalMs?: number;
}): Promise<Portal> {
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'case-'));
  const envDump = path.join(dir, 'env');
  const closedMarker = path.join(dir, 'closed.marker');
  const cfg = loadConfig({
    PORTAL_ENV: 'development',
    PORTAL_ADMIN_HOST: 'localhost',
    PORTAL_MCP_HOST: '127.0.0.1',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: usersRoot,
    PORTAL_LAUNCH_OVERRIDE: `node ${FIXTURE} --env-dump=${envDump} --closed-marker=${closedMarker}`,
    DASHSCOPE_API_KEY: 'sk-test-key',
    PORTAL_LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);
  const app = await buildServer(cfg, {
    db,
    ...(limits.idleMs === undefined ? {} : { sessionIdleTimeoutMs: limits.idleMs }),
    ...(limits.maxMs === undefined ? {} : { sessionMaxDurationMs: limits.maxMs }),
    ...(limits.reapIntervalMs === undefined ? {} : { reapIntervalMs: limits.reapIntervalMs }),
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    envDump,
    closedMarker,
    close: async () => {
      await app.close();
    },
  };
}

interface Session {
  readonly client: Client;
  readonly transport: StreamableHTTPClientTransport;
  readonly sessionId: string;
}

async function openSession(base: string, token: string): Promise<Session> {
  const client = new Client(
    { name: 'it-session-reclaim', version: '0.0.0' },
    { capabilities: { roots: { listChanged: true } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  await client.listTools();
  const sessionId = (transport as unknown as { sessionId?: string }).sessionId ?? '';
  return { client, transport, sessionId };
}

async function closeSession(session: Session): Promise<void> {
  try {
    await session.transport.terminateSession();
  } catch {
    /* 尽力而为 */
  }
  await session.client.close();
}

/** 本实例已 spawn 过的上游进程 pid（夹具逐进程落盘 `env.<pid>`）。 */
function spawnedPids(portal: Portal): string[] {
  const dir = path.dirname(portal.envDump);
  if (!fs.existsSync(dir)) return [];
  const prefix = `${path.basename(portal.envDump)}.`;
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .sort();
}

/** 某个用户的会话对应的上游进程 pid（按夹具写下的 `AI_MEMORY_AGENT_ID` 认）。 */
function pidOfAgent(portal: Portal, handle: string): string {
  const pid = spawnedPids(portal).find((candidate) => {
    const dump = JSON.parse(
      fs.readFileSync(`${portal.envDump}.${candidate}`, 'utf8'),
    ) as Record<string, unknown>;
    return dump.AI_MEMORY_AGENT_ID === `human:${handle}`;
  });
  if (pid === undefined) throw new Error(`找不到 ${handle} 的上游进程 dump`);
  return pid;
}

async function waitFor(cond: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return cond();
}

/** 裸 `fetch` 带指定令牌与会话 id —— 用来打「已经不该能用的会话」。 */
async function requestWithSession(
  base: string,
  token: string,
  sessionId: string,
): Promise<number> {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  return response.status;
}

describe('会话回收与路径留痕（3.4：TC-P-L1-04 / TC-P-L3-04 / TC-P-L3-06 · AC4.3）', () => {
  it('① 空闲到期 ⇒ 回收：上游子进程退出，且一个「新会话」仍能建立（桥本身没坏）', async () => {
    const portal = await startPortal({ idleMs: 300, reapIntervalMs: 50 });
    try {
      const idle = await openSession(portal.base, tokenAlice);
      const idlePid = pidOfAgent(portal, 'alice');

      // 什么都不做 ⇒ 空闲到期 ⇒ 子进程在 stdin EOF 处留痕（夹具写的是**退出进程的 pid**）。
      expect(await waitFor(() => fs.existsSync(portal.closedMarker))).toBe(true);
      expect(fs.readFileSync(portal.closedMarker, 'utf8')).toBe(idlePid);

      // 该会话已不在注册表里（不是「还在表里但关了」）：拿原 id 再打 ⇒ 401。
      expect(await requestWithSession(portal.base, tokenAlice, idle.sessionId)).toBe(401);

      // 回收没有把桥弄坏：新会话照常可用。
      const fresh = await openSession(portal.base, tokenAlice);
      await closeSession(fresh);
    } finally {
      await portal.close();
    }
  }, 60_000);

  it('② 超最长时长 ⇒ 回收：**持续活动**的会话也会到期（与空闲独立）', async () => {
    // 只开最长时长（不开空闲）⇒ 结论唯一归因：是 maxMs 生效，不是空闲。
    const portal = await startPortal({ maxMs: 400, reapIntervalMs: 50 });
    try {
      const session = await openSession(portal.base, tokenAlice);

      // 在到期前继续活动（刷新 lastActivityAt）：若判定误用「空闲」口径，这条会话就不会被回收。
      await new Promise((resolve) => setTimeout(resolve, 150));
      const stillAlive = await session.client.listTools();
      expect(stillAlive.tools.length).toBeGreaterThan(0);

      expect(await waitFor(() => fs.existsSync(portal.closedMarker))).toBe(true);
    } finally {
      await portal.close();
    }
  }, 60_000);

  it('③ 吊销 ⇒ 回收**该会话**；且**不得**回收别人的会话（3.3 的不可侵扰纪律回归）', async () => {
    // **刻意不注入任何限额** ⇒ 若这两个会话被回收，只可能是吊销那条路径干的。
    const portal = await startPortal({});
    try {
      const alice = await openSession(portal.base, tokenAlice);
      const bob = await openSession(portal.base, tokenBob);
      const alicePid = pidOfAgent(portal, 'alice');
      const bobPid = pidOfAgent(portal, 'bob');

      // 吊销 alice 的令牌（她**已建立**的会话仍在）。
      const revoked = revokeKey({ db, usersRoot, actor: ACTOR }, {
        handle: 'alice',
        keyPrefix: aliceKeyPrefix,
      });
      expect(revoked.ok).toBe(true);

      // 1) **先打别人的会话**：用 alice 的（已吊销）令牌 + bob 的 sessionId ⇒ 401，
      //    但 **bob 必须毫发无损**（他的令牌有效 ⇒ 这条请求碰不到他的会话）。
      expect(await requestWithSession(portal.base, tokenAlice, bob.sessionId)).toBe(401);
      const bobTools = await bob.client.listTools();
      expect(bobTools.tools.length).toBeGreaterThan(0);
      expect(fs.existsSync(portal.closedMarker), '不得回收别人的会话').toBe(false);

      // 2) 打**她自己的**会话 ⇒ 她的令牌已不可用 ⇒ 该会话被回收（子进程退出）。
      expect(await requestWithSession(portal.base, tokenAlice, alice.sessionId)).toBe(401);
      expect(await waitFor(() => fs.existsSync(portal.closedMarker))).toBe(true);
      // 标记里必须是 **alice 的** pid —— 若 bob 也被误收，这里会变成 bobPid（判据同时覆盖两件事）。
      expect(fs.readFileSync(portal.closedMarker, 'utf8')).toBe(alicePid);
      expect(pidOfAgent(portal, 'bob')).toBe(bobPid);

      await closeSession(bob);
    } finally {
      await portal.close();
    }
  }, 60_000);

  it('④ 会话建立即留痕：审计行含**解析后的**库路径（`AC4.3`）', async () => {
    // 不启用任何限额 ⇒ 会话不会自己到期；本条只看「建立时写了什么」。
    const portal = await startPortal({});
    try {
      const session = await openSession(portal.base, tokenCarol);
      try {
        const rows = listAudit(db, { action: 'mcp_session_opened', limit: 50, offset: 0 });
        const mine = rows.find(
          (row) =>
            (JSON.parse(row.detail_json) as { sessionId?: string }).sessionId === session.sessionId,
        );
        expect(mine, '未找到该会话的 mcp_session_opened 审计行').toBeDefined();

        const detail = JSON.parse(mine?.detail_json ?? '{}') as { dbPath?: string };
        // 判据是**解析后的**库路径（模板渲染出的实际使用值），不是请求里的任何输入。
        expect(detail.dbPath).toBe('/data/users/carol/ai-memory.db');
        // `detail_json` 纪律：不含令牌明文（路径与会话 id 允许出现）。
        expect(mine?.detail_json ?? '').not.toContain('memo_');
      } finally {
        await closeSession(session);
      }
    } finally {
      await portal.close();
    }
  }, 60_000);
});
