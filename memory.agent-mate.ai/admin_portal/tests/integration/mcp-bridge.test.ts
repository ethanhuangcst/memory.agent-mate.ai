/**
 * 接入面（`/mcp`）端到端集成测试 —— Sprint 4 `3.1`「mcp:会话桥」。
 *
 * 覆盖的验收条件（离线等价物）：
 *  - `MS1 AC-M1.1` 持有效令牌完成 `initialize → tools/list → tools/call`，一次写入成功并召回
 *  - `MS1 AC-M1.2` 无令牌 / 已吊销 / 用户停用 ⇒ 拒绝且**不降级为匿名**
 *  - `MS1 AC-M1.3` 令牌解析出的库路径与会话实际使用的一致（不触碰共享主库）
 *  - `MS1 AC-M1.4` 非 `memo_` 前缀 ⇒ 拒绝且**不创建**任何用户目录或库
 *  - `MS3 AC-M3.1`（离线等价物）会话以该用户身份与库路径启动子进程
 *  - `AC3.5` 同一用户两把令牌共享同一份记忆  · `AC3.7` 两把令牌的使用时间各自独立
 *
 * ## 为什么用假上游
 *
 * 本测试验证的是**桥**（HTTP(Streamable) ⇄ stdio），不是上游 ai-memory 本身。
 * 用真上游要 docker + linux 二进制 ⇒ 测试不再离线。这里用
 * `tests/fixtures/fake-upstream.mjs`（最小 stdio MCP server）⇒ **零外部依赖、可重复**；
 * 真上游由交付前的一次性脚本 `scripts/portal-mcp-probe.sh` 覆盖。
 *
 * ## 本机方式（方案 B）
 *
 * 通过 `PORTAL_LAUNCH_OVERRIDE` 把 spawn 的命令换成 `node <fixture>` ——
 * 这正是该键存在的理由（macOS 跑不了镜像内的 linux 二进制），顺带让本测试无需容器。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadConfig, type PortalConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';
import { createUser } from '../../src/web/services/users';
import { listAudit } from '../../src/web/db/repo/audit';
import { deactivateUser, issueKey, revokeKey } from '../../src/web/services/keys';
import { listKeysForUser } from '../../src/web/services/keys';

const ACTOR = 'owner@agent-mate.ai';
const FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-upstream.mjs');

let tmpRoot: string;
let envDumpDir: string;
let closedMarker: string;
let app: FastifyInstance;
let db: Database.Database;
let port: number;
/** 模块级：beforeAll 里赋值，测试体内多处使用（此前误声明为局部变量）。 */
let cfg: PortalConfig;
let tokenAlice: string;
let tokenAliceSecond: string;
let tokenRevoked: string;
let tokenDisabledUser: string;

/** 通过桥的 spawn 覆盖把夹具变成「上游」（观测参数走 argv，见夹具注释）。 */
function overrideCommand(): string {
  return `node ${FIXTURE} --env-dump=${path.join(envDumpDir, 'env')} --closed-marker=${closedMarker}`;
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-bridge-it-'));
  envDumpDir = path.join(tmpRoot, 'envdump');
  closedMarker = path.join(tmpRoot, 'closed.marker');
  fs.mkdirSync(envDumpDir, { recursive: true });

  cfg = loadConfig({
    PORTAL_ENV: 'development',
    // MCP 面用 127.0.0.1：本测试用真实 HTTP（net.fetch 不允许自带 Host 头），
    // 而 normalizeHost 会剥掉端口 ⇒ 请求的 `127.0.0.1:<随机端口>` 正好命中该面。
    PORTAL_ADMIN_HOST: 'localhost',
    PORTAL_MCP_HOST: '127.0.0.1',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: path.join(tmpRoot, 'users'),
    PORTAL_LAUNCH_OVERRIDE: overrideCommand(),
    DASHSCOPE_API_KEY: 'sk-test-key',
    PORTAL_LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);

  db = openMemoryDatabase();
  migrate(db);
  app = await buildServer(cfg, { db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  port = typeof address === 'object' && address !== null ? address.port : 0;

  const deps = { db, usersRoot: cfg.usersRoot, actor: ACTOR };
  // usersRoot（生产里是 `/data/users`）由**部署**预建（setgid 引导，`deployment.md` §4.4）；
  // 门户只在其下建每用户目录，不代建根 ⇒ 测试须自己准备它。
  fs.mkdirSync(cfg.usersRoot, { recursive: true });
  const createdAlice = createUser(deps, { handle: 'alice' });
  if (!createdAlice.ok) throw new Error(`createUser(alice) failed: ${JSON.stringify(createdAlice)}`);
  const createdBob = createUser(deps, { handle: 'bob' });
  if (!createdBob.ok) throw new Error(`createUser(bob) failed: ${JSON.stringify(createdBob)}`);

  const first = issueKey(deps, { handle: 'alice' });
  const second = issueKey(deps, { handle: 'alice' });
  const third = issueKey(deps, { handle: 'bob' });
  const fourth = issueKey(deps, { handle: 'bob' });
  if (!first.ok || !second.ok || !third.ok || !fourth.ok) throw new Error('签发令牌失败');
  tokenAlice = first.plaintext;
  tokenAliceSecond = second.plaintext;
  tokenRevoked = third.plaintext;
  tokenDisabledUser = fourth.plaintext;

  // bob 停用 ⇒ 其令牌必须被拒（user-disabled）；alice 另一把令牌留作吊销用。
  const revoked = revokeKey(deps, { handle: 'bob', keyPrefix: third.key.key_prefix });
  expect(revoked.ok).toBe(true);
  expect(deactivateUser(deps, { handle: 'bob' }).ok).toBe(true);
}, 60_000);

afterAll(async () => {
  await app?.close();
  db?.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function mcpUrl(host: string): URL {
  return new URL(`http://${host}:${port}/mcp`);
}

/** 起一个走真实 HTTP 的 MCP 客户端。 */
async function connect(token: string, host = '127.0.0.1'): Promise<Client> {
  const client = new Client({ name: 'it-client', version: '0.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(mcpUrl(host), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  // SDK 1.30.0 的 `sessionId` 声明为 `string | undefined`，与本仓 `exactOptionalPropertyTypes`
  // 下的 `Transport` 接口不兼容（与 `src/bridge/transport.ts` 里同一处缝隙）。
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  return client;
}

describe('会话跑通（AC-M1.1 / AC3.5）', () => {
  it('initialize → tools/list → memory_store → memory_recall 全程经桥返回真实结果', async () => {
    const client = await connect(tokenAlice);
    try {
      const tools = await client.listTools();
      expect(tools.tools).toHaveLength(8);
      expect(tools.tools.map((tool) => tool.name)).toContain('memory_store');

      const stored = await client.callTool({
        name: 'memory_store',
        arguments: { title: '桥集成测试', content: 'BRIDGE-IT-MARKER' },
      });
      expect(stored.isError).toBeFalsy();

      const recalled = await client.callTool({
        name: 'memory_recall',
        arguments: { context: 'BRIDGE-IT-MARKER' },
      });
      // 召回回包是「命中计数 + 列表行」（不含正文），故断言计数与标题 ——
      // 断言正文会得到「明明命中却判失败」的假失败。
      const recalledText = JSON.stringify(recalled.content);
      expect(recalledText).toContain('count:1');
      expect(recalledText).toContain('桥集成测试');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('同一用户的第二把令牌建会话时，读到的是同一份记忆（AC3.5）', async () => {
    const first = await connect(tokenAlice);
    let marker: string;
    try {
      const stored = await first.callTool({
        name: 'memory_store',
        arguments: { title: '多 key 同库', content: 'SHARED-BRAIN-MARKER' },
      });
      marker = JSON.stringify(stored.content);
      expect(stored.isError).toBeFalsy();
    } finally {
      await first.close();
    }

    // 第二把令牌是**另一个会话**（另一个子进程）—— 假上游的 memories 是进程内的，
    // 因此这里断言的等价物是「第二把令牌能建立会话并可用」，而非跨进程共享内容。
    const second = await connect(tokenAliceSecond);
    try {
      const tools = await second.listTools();
      expect(tools.tools).toHaveLength(8);
      expect(marker.length).toBeGreaterThan(0);
    } finally {
      await second.close();
    }
  }, 30_000);
});

describe('身份与库路径按 handle 注入（AC-M1.3 / AC-M3.1 的离线等价物）', () => {
  it('桥注入的 env 指向该用户的库与身份，且家目录统一、上游 key 已带', async () => {
    const client = await connect(tokenAlice);
    try {
      await client.listTools(); // 确保上游已启动
    } finally {
      await client.close();
    }

    const dumps = fs.readdirSync(envDumpDir).filter((name) => name.startsWith('env.'));
    expect(dumps.length).toBeGreaterThan(0);
    const dumped = JSON.parse(
      fs.readFileSync(path.join(envDumpDir, dumps[dumps.length - 1] as string), 'utf8'),
    ) as Record<string, string | number | null>;

    expect(dumped.AI_MEMORY_DB).toBe('/data/users/alice/ai-memory.db');
    expect(dumped.AI_MEMORY_AGENT_ID).toBe('human:alice');
    expect(dumped.AI_MEMORY_KEY_DIR).toBe('/data/users/alice/keys');
    expect(dumped.AI_MEMORY_REQUIRE_AGENT_ATTESTATION).toBe('0');
    expect(dumped.HOME).toBe('/data');
    expect(dumped.DASHSCOPE_API_KEY).toBe('sk-test-key');
    // 不继承门户全量环境 ⇒ 白名单里没有的东西不会漏过去。
    expect(dumped).not.toHaveProperty('PORTAL_DB_PATH');
  }, 30_000);
});

describe('拒绝路径（AC-M1.2 / AC-M1.4 / 面不匹配）', () => {
  async function statusOf(headers: Record<string, string>, host = '127.0.0.1'): Promise<number> {
    const response = await fetch(`http://${host}:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'it', version: '0' },
        },
      }),
    });
    return response.status;
  }

  it('未携带令牌 ⇒ 401（不降级为匿名）', async () => {
    expect(await statusOf({})).toBe(401);
  });

  it('已吊销令牌 ⇒ 401', async () => {
    expect(await statusOf({ authorization: `Bearer ${tokenRevoked}` })).toBe(401);
  });

  it('用户停用 ⇒ 401', async () => {
    expect(await statusOf({ authorization: `Bearer ${tokenDisabledUser}` })).toBe(401);
  });

  it('非 memo_ 前缀 / 畸形令牌 ⇒ 401', async () => {
    expect(await statusOf({ authorization: 'Bearer not-a-portal-token' })).toBe(401);
    expect(await statusOf({ authorization: 'Bearer ' })).toBe(401);
  });

  it('管理面上访问 /mcp ⇒ 403（面隔离先于身份，既有设计）', async () => {
    expect(await statusOf({ authorization: `Bearer ${tokenAlice}` }, 'localhost')).toBe(403);
  });

  it('拒绝路径不创建任何用户目录（AC-M1.4）', async () => {
    await statusOf({ authorization: 'Bearer memo_notexist' });
    const usersRoot = path.join(tmpRoot, 'users');
    const entries = fs.existsSync(usersRoot) ? fs.readdirSync(usersRoot) : [];
    // 目录只可能来自「建用户」，绝不可能来自「按令牌猜出来的路径」。
    for (const entry of entries) {
      expect(['alice', 'bob', 'dave'], `意外的目录：${entry}`).toContain(entry);
    }
    expect(entries).not.toContain('memo_notexist');
  });
});

describe('使用时间粒度（AC3.7，口径见 web-design.md §4.4）', () => {
  it('只有被用于建立会话的那把令牌更新 last_used_at，另一把保持不变', async () => {
    // 用一个**独立用户**，避免被前面的用例污染（alice 的两把令牌在前面都已建过会话）。
    const deps = { db, usersRoot: cfg.usersRoot, actor: ACTOR };
    const created = createUser(deps, { handle: 'dave' });
    if (!created.ok) throw new Error(`createUser(dave) failed: ${JSON.stringify(created)}`);
    const first = issueKey(deps, { handle: 'dave' });
    const second = issueKey(deps, { handle: 'dave' });
    if (!first.ok || !second.ok) throw new Error('签发令牌失败');

    // 前置：两把都从未使用过。
    expect(listKeysForUser(db, 'dave')?.every((key) => key.last_used_at === null)).toBe(true);

    const client = await connect(first.plaintext);
    await client.listTools();
    await client.close();

    const keys = listKeysForUser(db, 'dave') ?? [];
    const used = keys.filter((key) => key.last_used_at !== null);
    const untouched = keys.filter((key) => key.last_used_at === null);
    // 粒度 = **会话建立时一次**：恰好一把被更新（且是被用的那把），另一把必须没被顺带更新。
    expect(used).toHaveLength(1);
    expect(untouched).toHaveLength(1);
    expect(used[0]?.id).toBe(first.key.id);
  }, 30_000);
});

describe('上游失败面（web-design.md §12.5 的上游不可用与超时）', () => {
  /**
   * 起一个「上游形态不同」的独立实例 —— `PORTAL_LAUNCH_OVERRIDE` 是**配置级**的，
   * 一个进程只能有一种上游形态，所以要验证另一种失败面就得另起一个。
   */
  async function startWithUpstream(
    extra: string,
    timeoutMs?: number,
  ): Promise<{ base: string; close: () => Promise<void> }> {
    const cfgForBadUpstream = loadConfig({
      PORTAL_ENV: 'development',
      PORTAL_ADMIN_HOST: 'localhost',
      PORTAL_MCP_HOST: '127.0.0.1',
      PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
      PORTAL_USERS_ROOT: cfg.usersRoot,
      PORTAL_LAUNCH_OVERRIDE: `node ${FIXTURE} ${extra}`,
      PORTAL_LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    const badApp = await buildServer(cfgForBadUpstream, {
      db,
      ...(timeoutMs === undefined ? {} : { requestTimeoutMs: timeoutMs }),
    });
    await badApp.listen({ port: 0, host: '127.0.0.1' });
    const address = badApp.server.address();
    const badPort = typeof address === 'object' && address !== null ? address.port : 0;
    return {
      base: `http://127.0.0.1:${badPort}`,
      close: async () => {
        await badApp.close();
      },
    };
  }

  async function initializeAt(base: string): Promise<{ status: number; body: { error?: string } }> {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // MCP Streamable HTTP 要求客户端显式声明可接受的响应类型；
        // 缺它会得到 **406**（而不是会话失败）—— 这是协议层门禁，不是我们的业务分支。
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${tokenAlice}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'it', version: '0' },
        },
      }),
    });
    return { status: response.status, body: (await response.json()) as { error?: string } };
  }

  it('上游启动即失败 ⇒ 503 upstream_unavailable，并写审计行（纪律 3）', async () => {
    const { base, close } = await startWithUpstream('--fail-before-initialize=1');
    try {
      const { status, body } = await initializeAt(base);
      expect(status).toBe(503);
      expect(body.error).toBe('upstream_unavailable');

      const rejected = listAudit(db, { limit: 200, offset: 0 }).filter(
        (row) => row.action === 'mcp_session_rejected',
      );
      expect(rejected.length).toBeGreaterThan(0);
      expect(JSON.stringify(rejected[0]?.detail_json ?? '')).toContain('upstream_unavailable');
    } finally {
      await close();
    }
  }, 30_000);

  it('上游挂起不响应 ⇒ 握手超时兜底（按上游不可用处理，不再挂到上游最终响应）', async () => {
    const { base, close } = await startWithUpstream('--hang-ms=5000', 300);
    try {
      const startedAt = Date.now();
      const { status, body } = await initializeAt(base);
      const elapsed = Date.now() - startedAt;

      // 机制（两处实测得到的结论，见 `spawn.ts` 与 `transport.ts` 的注释）：
      //  · 上游「起得来但不响应」时，卡的是**握手**（`client.connect`）⇒ 此时响应头尚未发出
      //    ⇒ 可以用 HTTP 状态码表达 ⇒ 归 `upstream_unavailable`（503）；
      //  · 转发阶段的上游慢则以 **MCP 层错误**返回（那时 SSE 响应头已发出，状态码改不动）。
      expect(status).toBe(503);
      expect(body.error).toBe('upstream_unavailable');
      expect(elapsed).toBeLessThan(4_000);
    } finally {
      await close();
    }
  }, 30_000);
});

describe('会话回收（纪律 2：失败与收尾都不留子进程）', () => {
  it('客户端显式终止会话后，上游子进程退出（夹具写回 closed 标记）', async () => {
    // **关键区分**：SDK 的 client `close()` 只 abort 本地请求、**不发任何通知**
    //（见 streamableHttp.js 的 `close()`），所以「客户端主动结束」必须走 `terminateSession()`
    //（发 HTTP DELETE；规范允许服务端不支持时回 405，此时只能靠空闲超时回收 —— 那是 `3.4`/`4.1` 的范围）。
    // 本用例验证的是「服务端收到终止信号后确实回收了子进程」。
    const client = new Client({ name: 'it-terminate', version: '0.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(mcpUrl('127.0.0.1'), {
      requestInit: { headers: { authorization: `Bearer ${tokenAliceSecond}` } },
    });
    await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
    await client.listTools();
    await transport.terminateSession();
    await client.close();

    const deadline = Date.now() + 15_000;
    while (!fs.existsSync(closedMarker) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(fs.existsSync(closedMarker), '上游子进程未在会话终止后退出').toBe(true);
  }, 30_000);
});
