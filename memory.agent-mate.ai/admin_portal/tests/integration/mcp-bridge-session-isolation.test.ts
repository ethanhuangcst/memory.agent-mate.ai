/**
 * 会话隔离的**机制层**集成测试 —— Sprint 4 `3.3`「mcp:一会话一子进程」。
 *
 * 覆盖的验收条件与用例：
 *  - `AC4.6`（`web-stories.md` §S4）两个并发会话对应**两个独立子进程**、且**禁止复用**
 *    → `TC-M-L1-21`（本文件 ①②）
 *  - `AC4.6` 的**反方向**：不存在「把同一子进程复用给不同用户」的路径，**且第三方不得
 *    通过一次请求影响别人的会话** → `TC-M-L3-05`（本文件 ③）
 *
 * ## 为什么只到「机制层」
 *
 * `AC4.6` / `AC4.5` 的另一些判据**天然需要真上游**（容器内**进程数**与**文件足迹**）——
 * 假上游既不是一个 `ai-memory` 进程，也没有用户的库文件。那一层由真上游端到端覆盖
 * （`make portal-mcp-session-probe`，跑法与判据见 `specs/mcp/mcp-test.md` §4-G；
 * 判据形状由 `3.12` 探针 `probes/session-isolation-probe/` 实测钉死）。
 * 本文件的职责只是**离线、可重复**地钉住「桥自己的归属校验与 spawn 计数」。
 *
 * ## 判据手法（不造产品侧缝隙）
 *
 * 复用假上游的既有观测位：`--env-dump` **逐进程**落盘（文件名 `<path>.<pid>`）⇒
 * **数文件 = 数 spawn**、文件里的 `AI_MEMORY_DB` / `AI_MEMORY_AGENT_ID` = 「这个进程是谁的」；
 * `--closed-marker` 写进**退出进程的 pid** ⇒ 判「某个会话的子进程确实退出了」。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';
import { createUser } from '../../src/web/services/users';
import { issueKey } from '../../src/web/services/keys';

const ACTOR = 'owner@agent-mate.ai';
const FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-upstream.mjs');

let tmpRoot: string;
let usersRoot: string;
let db: Database.Database;
let tokenAlice: string;
let tokenBob: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-session-isolation-it-'));
  usersRoot = path.join(tmpRoot, 'users');
  // usersRoot 由**部署**预建（`deployment.md` §4.4），门户只在其下建每用户目录。
  fs.mkdirSync(usersRoot, { recursive: true });

  db = openMemoryDatabase();
  migrate(db);

  const deps = { db, usersRoot, actor: ACTOR };
  for (const handle of ['alice', 'bob']) {
    const created = createUser(deps, { handle });
    if (!created.ok) throw new Error(`createUser(${handle}) failed: ${JSON.stringify(created)}`);
  }
  const aliceKey = issueKey(deps, { handle: 'alice' });
  const bobKey = issueKey(deps, { handle: 'bob' });
  if (!aliceKey.ok || !bobKey.ok) throw new Error('签发令牌失败');
  tokenAlice = aliceKey.plaintext;
  tokenBob = bobKey.plaintext;
});

afterAll(() => {
  db?.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface IsolatedPortal {
  readonly base: string;
  /** 本实例专属的观测位（每个用例一个临时目录 ⇒ 计数不被其它用例污染）。 */
  readonly envDump: string;
  readonly closedMarker: string;
  readonly close: () => Promise<void>;
}

/**
 * 起一个**观测位独立**的门户实例。
 *
 * 每个用例一份临时目录：`--env-dump` / `--closed-marker` 都是**追加或覆盖型**文件，
 * 共用一份会让「数 spawn」与「谁的进程退了」两个判据互相污染（同文件用例会彼此干扰）。
 */
async function startIsolatedPortal(): Promise<IsolatedPortal> {
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
  const app = await buildServer(cfg, { db });
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

/** 建一个走真实 HTTP 的 MCP 会话，并取出它的 `mcp-session-id`（判会话归属要用它）。 */
async function openSession(base: string, token: string): Promise<Session> {
  const client = new Client(
    { name: 'it-session-isolation', version: '0.0.0' },
    { capabilities: { roots: { listChanged: true } } },
  );
  const options: StreamableHTTPClientTransportOptions = {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  };
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), options);
  // SDK 1.30.0 的 `sessionId` 声明为可空，与本仓 `exactOptionalPropertyTypes` 下的
  // `Transport` 接口不兼容（与 `src/bridge/transport.ts` 同一处缝隙）。
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  await client.listTools(); // 确保上游已起来（会话建立后才 spawn）
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

/**
 * 本实例已 spawn 过的上游进程（`env.<pid>` 文件名后缀即 pid）。
 *
 * **注意守卫检查的是目录**：夹具写的是 `<envDump>.<pid>`，`envDump` 本身**从不作为文件存在**
 * —— 早先写成 `fs.existsSync(portal.envDump)` 会让本函数恒返回空数组、把三条用例全判成
 * 「没有 spawn」（实测踩过）。
 */
function spawnedPids(portal: IsolatedPortal): string[] {
  const dir = path.dirname(portal.envDump);
  if (!fs.existsSync(dir)) return [];
  const prefix = `${path.basename(portal.envDump)}.`;
  return fs
    .readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .map((name) => name.slice(prefix.length))
    .sort();
}

/** 读某个已 spawn 进程的 env 快照（判「这个进程是谁的」）。 */
function envOf(portal: IsolatedPortal, pid: string): Record<string, unknown> {
  const raw = fs.readFileSync(`${portal.envDump}.${pid}`, 'utf8');
  return JSON.parse(raw) as Record<string, unknown>;
}

/** 轮询小工具（既有文件用内联 while；这里抽出来免得三处重复）。 */
async function waitFor(cond: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!cond() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return cond();
}

/** 裸 `fetch` 带一个**别人的** `mcp-session-id` —— 「跨用户接管」的形态。 */
async function requestWithSessionId(
  base: string,
  token: string,
  sessionId: string,
): Promise<{ status: number; error?: string | undefined }> {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // MCP Streamable HTTP 要求显式声明可接受的响应类型；缺它是协议层 406，不是业务分支。
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return { status: response.status, error: body.error };
}

describe('会话隔离（3.3：TC-M-L1-21 / TC-M-L3-05）', () => {
  it('① 两个并发会话各自 spawn 一个上游进程，两个 pid 互不相同且各带自己的库与身份', async () => {
    const portal = await startIsolatedPortal();
    try {
      const alice = await openSession(portal.base, tokenAlice);
      const bob = await openSession(portal.base, tokenBob);
      try {
        // 两个会话是两个不同的 HTTP 会话 id（`sessionIdGenerator: () => randomUUID()`）。
        expect(alice.sessionId).not.toBe('');
        expect(bob.sessionId).not.toBe('');
        expect(alice.sessionId).not.toBe(bob.sessionId);

        // **一个会话一个子进程**：两个并发会话 ⇒ 两个进程，pid 互不相同。
        const pids = spawnedPids(portal);
        expect(pids).toHaveLength(2);
        expect(new Set(pids).size).toBe(2);

        // 每个进程带着**自己用户的**库路径与身份（`launch-template` 按 handle 注入）。
        const dumps = pids.map((pid) => envOf(portal, pid));
        const dbs = dumps.map((dump) => dump.AI_MEMORY_DB).sort();
        expect(dbs).toEqual(['/data/users/alice/ai-memory.db', '/data/users/bob/ai-memory.db']);
        const agentIds = dumps.map((dump) => dump.AI_MEMORY_AGENT_ID).sort();
        expect(agentIds).toEqual(['human:alice', 'human:bob']);
      } finally {
        await closeSession(alice);
        await closeSession(bob);
      }
    } finally {
      await portal.close();
    }
  }, 60_000);

  it('② 同一用户重开会话**不复用**旧进程（禁池化），且旧进程确实已退出', async () => {
    const portal = await startIsolatedPortal();
    try {
      const first = await openSession(portal.base, tokenAlice);
      const firstPid = spawnedPids(portal)[0] as string;
      await closeSession(first);
      // 会话结束 ⇒ 桥显式关上游 ⇒ 子进程在 stdin EOF 处留痕（判据：pid 相等）。
      expect(await waitFor(() => fs.existsSync(portal.closedMarker))).toBe(true);
      expect(fs.readFileSync(portal.closedMarker, 'utf8')).toBe(firstPid);

      const second = await openSession(portal.base, tokenAlice);
      try {
        const pids = spawnedPids(portal);
        expect(pids).toHaveLength(2);
        const secondPid = pids.find((pid) => pid !== firstPid);
        // **同用户**重开也是**新进程**（禁止池化 / 复用），不是把旧进程还给新会话。
        expect(secondPid).toBeDefined();
        expect(second.sessionId).not.toBe(first.sessionId);
      } finally {
        await closeSession(second);
      }
    } finally {
      await portal.close();
    }
  }, 60_000);

  it('③ 跨用户接管被拒（401）且**不伤及**受害者：不新增进程、受害者仍可用、其子进程仍受管', async () => {
    const portal = await startIsolatedPortal();
    try {
      const alice = await openSession(portal.base, tokenAlice);
      const bob = await openSession(portal.base, tokenBob);
      try {
        const pidsBefore = spawnedPids(portal);
        expect(pidsBefore).toHaveLength(2);
        const bobPid = pidsBefore.find(
          (pid) => envOf(portal, pid).AI_MEMORY_AGENT_ID === 'human:bob',
        );
        expect(bobPid).toBeDefined();

        // 甲（alice）拿**乙（bob）的** `mcp-session-id` 发一次请求。
        const takeover = await requestWithSessionId(portal.base, tokenAlice, bob.sessionId);
        expect(takeover.status).toBe(401);
        expect(takeover.error).toBe('unauthorized');

        // ① **不新增**进程（拒绝路径不该 spawn）。
        expect(spawnedPids(portal)).toHaveLength(2);

        // ② **受害者仍可用** —— 这是本用例的核心：修正前桥会把 bob 的会话从注册表摘掉，
        //    于是 bob 用**自己的**令牌 + 原 sessionId 会立刻 401（`3.12` 探针在真上游实测过）。
        const tools = await bob.client.listTools();
        expect(tools.tools).toHaveLength(8);

        // ③ 受害者的子进程**没被牵连关掉**（`--closed-marker` 只在子进程真的退出时才落）。
        expect(fs.existsSync(portal.closedMarker)).toBe(false);

        // ④ 收尾：受害者自己正常结束会话 ⇒ 其子进程才退出，且正是它的 pid（说明它**始终
        //    在受管范围内**，没有被谁顺手摘掉后变成没人收的孤儿）。
        await closeSession(bob);
        expect(await waitFor(() => fs.existsSync(portal.closedMarker))).toBe(true);
        expect(fs.readFileSync(portal.closedMarker, 'utf8')).toBe(bobPid);
      } finally {
        await closeSession(alice);
      }
    } finally {
      await portal.close();
    }
  }, 60_000);
});
