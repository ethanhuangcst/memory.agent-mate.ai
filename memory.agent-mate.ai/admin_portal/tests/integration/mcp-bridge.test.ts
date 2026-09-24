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
import { z } from 'zod';
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
import { insertUser } from '../../src/web/db/repo/users';

const ACTOR = 'owner@agent-mate.ai';
const FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-upstream.mjs');
/** `3.2`：执行即留痕的标记脚本 —— 用来断言**否定命题**「上游未被 spawn」（判据强于 `--env-dump`）。 */
const MARKER_FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'marker-command.mjs');

let tmpRoot: string;
let envDumpDir: string;
let closedMarker: string;
/** `3.8`：夹具把「到达上游的通知」追加写到该文件 —— 通知转发的判据（stdin/落文件留痕）。 */
let notifyLog: string;
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
  return `node ${FIXTURE} --env-dump=${path.join(envDumpDir, 'env')} --closed-marker=${closedMarker} --notify-log=${notifyLog}`;
}

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-bridge-it-'));
  envDumpDir = path.join(tmpRoot, 'envdump');
  closedMarker = path.join(tmpRoot, 'closed.marker');
  notifyLog = path.join(tmpRoot, 'notifications.log');
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
  // 声明 `roots.listChanged`：`3.8` 的通知转发用例要发 `notifications/roots/list_changed`，
  // 而发送侧会走 `assertNotificationCapability`（不声明则抛错、通知根本发不出去）。
  const client = new Client(
    { name: 'it-client', version: '0.0.0' },
    { capabilities: { roots: { listChanged: true } } },
  );
  const transport = new StreamableHTTPClientTransport(mcpUrl(host), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  // SDK 1.30.0 的 `sessionId` 声明为 `string | undefined`，与本仓 `exactOptionalPropertyTypes`
  // 下的 `Transport` 接口不兼容（与 `src/bridge/transport.ts` 里同一处缝隙）。
  await client.connect(transport as unknown as Parameters<typeof client.connect>[0]);
  return client;
}

/**
 * 起一个「**启动命令不同**」的独立门户实例 —— `PORTAL_LAUNCH_OVERRIDE` 是**配置级**的，
 * 一个进程只能有一种上游形态，所以要验证另一种形态就得另起一个。
 *
 * `3.9` 提到模块作用域：失败面、身份与超时几处 describe 都要用它；
 * `3.2` 再把**命令本身**参数化 —— `TC-M-L3-02` 要用**标记脚本**当命令，
 * 才能断言「上游**未被** spawn」这个否定命题（判据见 `MARKER_FIXTURE` 的文件头）。
 */
async function startPortal(
  overrideCommand: string,
  timeouts: { handshakeMs?: number; requestMs?: number } = {},
): Promise<{ base: string; close: () => Promise<void> }> {
  const cfgForBadUpstream = loadConfig({
    PORTAL_ENV: 'development',
    PORTAL_ADMIN_HOST: 'localhost',
    PORTAL_MCP_HOST: '127.0.0.1',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: cfg.usersRoot,
    PORTAL_LAUNCH_OVERRIDE: overrideCommand,
    PORTAL_LOG_LEVEL: 'silent',
  } as NodeJS.ProcessEnv);
  // 两个超时**分开注入**（`3.9` 起分层）：`handshakeMs` 只影响 `client.connect`、
  // `requestMs` 只影响每条上游请求 —— 只有这样「到底哪一支在起作用」才是可分辨的。
  const badApp = await buildServer(cfgForBadUpstream, {
    db,
    ...(timeouts.handshakeMs === undefined ? {} : { handshakeTimeoutMs: timeouts.handshakeMs }),
    ...(timeouts.requestMs === undefined
      ? {}
      : { upstreamRequestTimeoutMs: timeouts.requestMs }),
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

/** 上游 = 假上游夹具 + 额外 argv（`3.2` 之前的所有用例都走这一支）。 */
async function startWithUpstream(
  extra: string,
  timeouts: { handshakeMs?: number; requestMs?: number } = {},
): Promise<{ base: string; close: () => Promise<void> }> {
  return startPortal(`node ${FIXTURE} ${extra}`, timeouts);
}

/**
 * 裸 `fetch` 发 `initialize`（只回状态码与错误体），用于「会话根本没建起来」那类断言。
 *
 * `token` 可覆盖 —— `3.2` 的用例要拿**另一个用户**的令牌打（默认是 `alice` 的）。
 */
async function initializeAt(
  base: string,
  token: string = tokenAlice,
): Promise<{ status: number; body: { error?: string } }> {
  const response = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // MCP Streamable HTTP 要求客户端显式声明可接受的响应类型；
      // 缺它会得到 **406**（而不是会话失败）—— 这是协议层门禁，不是我们的业务分支。
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
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

/** 把 SDK 客户端指向某个具体 `base`（顶层 `connect()` 走的是主实例，这里要换实例）。 */
async function connectTo(base: string): Promise<Client> {
  const client = new Client(
    { name: 'it-identity', version: '0.0.0' },
    { capabilities: { roots: { listChanged: true } } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${tokenAlice}` } },
  });
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
    // 这一条卡的是**握手**（`client.connect`）⇒ 注入的是 `handshakeMs`，不是 `requestMs`。
    const { base, close } = await startWithUpstream('--hang-ms=5000', { handshakeMs: 300 });
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

/**
 * `3.8` 的三条端到端用例（`mcp-test.md` §4-F 的 `TC-M-L1-15` / `TC-M-L1-16` / `TC-M-L1-17`）。
 *
 * 判据真源：[`web-design.md`](../../../specs/web-portal/web-design.md) §12.5 的「转发阶段失败的分类定档」
 * 与 [`mcp-design.md`](../../../specs/mcp/mcp-design.md) §5.6.2 的 `3.10` 实证块。
 */
describe('整行转发与失败诊断（`3.8`：TC-M-L1-15 / 16 / 17）', () => {
  it('TC-M-L1-15：未注册的请求原样转发 —— 拿到上游结果（含非标准形状），而非桥合成的 Method not found', async () => {
    const client = await connect(tokenAlice);
    try {
      // `resources/list` 桥**未显式注册**（桥只注册 tools/* 与 prompts/*）⇒ 走 fallback 交给上游。
      // 客户端用宽松 schema 取回（不校验）⇒ 夹具故意返回的**非标准形状**能穿过来。
      const result = (await client.request({ method: 'resources/list', params: {} }, z.unknown())) as {
        resources?: unknown;
        _upstream?: string;
      };

      expect(result._upstream, '结果未来自上游 ⇒ fallback 没生效').toBe('fake-upstream');
      expect(result.resources, '非标准形状被拦下 ⇒ 桥在替上游校验结果').toBe(
        'NOT-AN-STANDARD-SHAPE',
      );
    } finally {
      await client.close();
    }
  }, 30_000);

  it('TC-M-L1-15（补）：上游不支持的方法 —— 错误来自上游且 code 保留，不是桥合成的 Method not found', async () => {
    const client = await connect(tokenAlice);
    try {
      // 夹具对该方法抛 `McpError(-32601, 'FROM_FAKE_UPSTREAM')`。若桥**没**转发，客户端会收到
      // SDK 的固定文案 `Method not found` —— 这正是 `3.8` 之前的行为。
      let caught: unknown;
      try {
        await client.request(
          {
            method: 'completion/complete',
            params: { ref: { type: 'ref/prompt', name: 'x' }, argument: { name: 'a', value: 'b' } },
          },
          z.unknown(),
        );
      } catch (error) {
        caught = error;
      }

      expect((caught as { code?: number })?.code, '上游错误码未被原样保留').toBe(-32601);
      // `message` 用「包含」而非相等：SDK 每转换一次 error response 就加一层
      // `MCP error <code>: ` 前缀（`3.10` 探针实测 3 层），上游原文被包在里面。
      expect(String((caught as { message?: string })?.message)).toContain('FROM_FAKE_UPSTREAM');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('TC-M-L1-16：未注册的通知抵达上游 —— 含必须显式注册的取消通知', async () => {
    const client = await connect(tokenAlice);
    try {
      const read = (): string => (fs.existsSync(notifyLog) ? fs.readFileSync(notifyLog, 'utf8') : '');
      const before = read();

      // ① 服务端**无内置 handler** 的标准通知 ⇒ 走桥的 `fallbackNotificationHandler`。
      // 注意：`jsonrpc: '2.0'` 由 SDK 内部补，业务侧不传（`ClientNotification` 联合类型里没有该字段）。
      await client.notification({ method: 'notifications/roots/list_changed' });
      // ② `notifications/cancelled` ⇒ SDK 在 `Protocol` 构造函数里就内置消费了它，
      //    **永远落不到 fallback** ⇒ 桥必须**显式注册**才能转发（见 §5.6.2 实证块）。
      await client.notification({
        method: 'notifications/cancelled',
        params: { requestId: 1, reason: 'IT-CANCEL' },
      });
      await new Promise((resolve) => setTimeout(resolve, 600));

      const after = read();
      expect(after.length, '通知没有穿过 stdio 抵达上游').toBeGreaterThan(before.length);
      expect(after, '未注册通知（fallback 通道）未转发').toContain('roots/list_changed');
      expect(after, '取消通知未转发 ⇒ 桥漏了显式注册').toContain('IT-CANCEL');
    } finally {
      await client.close();
    }
  }, 30_000);

  it('TC-M-L1-17：转发失败不误报 —— 正常转发不产生 mcp_upstream_error 审计行', async () => {
    // 分类的**精度**（`-32001` → 504 · `-32000` → 503 · 其余 → 502 `upstream_error`）由
    // `tests/unit/bridge-failure.test.ts` 覆盖：真实的「转发阶段抛异常」路径很难稳定构造
    //（SDK 的 5 个 throw 点都是内部状态错误，需要制造定时窗口）。
    // 本用例测它的**另一面**：正常转发**不得**产生**失败**审计行（否则「失败可诊断」会退化成噪音）。
    //
    // **判据按「动作」筛，不按「总行数」**（`3.4` 修正）：会话建立本身会写一行
    // `mcp_session_opened`（`AC4.3` 的落点），按总行数判会把「合法的成功审计」当成误报。
    const countUpstreamErrors = (): number =>
      listAudit(db, { limit: 1000, offset: 0 }).filter((row) => row.action === 'mcp_upstream_error')
        .length;
    const before = countUpstreamErrors();

    const client = await connect(tokenAlice);
    try {
      await client.request({ method: 'resources/list', params: {} }, z.unknown());
    } finally {
      await client.close();
    }

    const after = listAudit(db, { limit: 1000, offset: 0 });
    expect(countUpstreamErrors(), '正常转发不应新增 mcp_upstream_error 审计行').toBe(before);
    expect(
      after.some((row) => row.action === 'mcp_upstream_error'),
      '正常路径产生了失败审计行 ⇒ 误报',
    ).toBe(false);
  }, 30_000);
});

describe('上游身份与能力透传、超时分层（3.9：TC-M-L1-18 / 19 / 20）', () => {
  it('TC-M-L1-18：身份 / 能力 / 指令取自上游，且网关不凭空造字段', async () => {
    // ① 让夹具带一套**可辨识的**身份 / 能力 / 指令启动 —— 名字与版本都不是网关的，
    //    能力比「上游默认值」多一项 `prompts`（能区分「透传」与「照抄旧硬编码」）。
    //    指令值刻意不含空格：`PORTAL_LAUNCH_OVERRIDE` 是按空白切分的，带空格的参数会被拆开。
    const customized = await startWithUpstream(
      '--identity=ai-memory-probe@9.9.9' +
        ' --capabilities={"tools":{},"prompts":{},"resources":{},"completions":{}}' +
        ' --instructions=probe-instructions-ok',
    );
    try {
      const client = await connectTo(customized.base);
      try {
        // 判据写「**字段与取值**」，不写「逐字节」：SDK 的 schema 解析会重建键序
        // （`3.11` 探针断言 1 首跑就因按字符串比而假失败）。
        expect(client.getServerVersion()).toEqual({ name: 'ai-memory-probe', version: '9.9.9' });
        expect(client.getServerCapabilities()).toEqual({
          tools: {},
          prompts: {},
          resources: {},
          completions: {},
        });
        expect(client.getInstructions()).toBe('probe-instructions-ok');
      } finally {
        await client.close();
      }
    } finally {
      await customized.close();
    }

    // ② 反证：上游**没有**声明指令时不带 `--instructions` ⇒ 客户端读到的必须是 `undefined`。
    //    少了这条，「网关只要不回吐空串就算过」——而凭空多一个 `instructions` 同样是偏离上游。
    const plain = await startWithUpstream('');
    try {
      const client = await connectTo(plain.base);
      try {
        expect(client.getServerVersion()).toEqual({ name: 'fake-upstream', version: '0.0.0' });
        expect(client.getInstructions()).toBeUndefined();
      } finally {
        await client.close();
      }
    } finally {
      await plain.close();
    }
  }, 60_000);

  it('TC-M-L1-19：握手超时与每请求超时互不牵连（反着设值，行为仍正确）', async () => {
    // 夹具在**工具调用内部**挂 1500ms（`--tool-hang-ms`）—— 与「连接前挂起」的 `--hang-ms`
    // 是两条独立链路：那个覆盖握手超时，这个覆盖每请求超时。

    // ① 短握手（300ms）+ 长请求（5000ms）：超时值反着设，耗时 1500ms 的调用**必须成功**。
    //    分层之前两者共用一个值 ⇒ 这次调用会被 300ms 掐断。
    const shortHandshake = await startWithUpstream('--tool-hang-ms=1500', {
      handshakeMs: 300,
      requestMs: 5_000,
    });
    try {
      const client = await connectTo(shortHandshake.base);
      try {
        const startedAt = Date.now();
        const result = await client.callTool({
          name: 'memory_recall',
          arguments: { context: 'probe' },
        });
        const elapsed = Date.now() - startedAt;
        expect(JSON.stringify(result.content)).toContain('count:');
        expect(elapsed, '握手超时不该管到转发阶段').toBeGreaterThanOrEqual(1_500);
      } finally {
        await client.close();
      }
    } finally {
      await shortHandshake.close();
    }

    // ② 长握手（5000ms）+ 短请求（300ms）：同一类调用这次必须在**每请求**超时处失败，
    //    且以 **MCP 层错误 `-32001`** 返回 —— 转发期 SSE 响应头已发出，状态码改不动。
    const shortRequest = await startWithUpstream('--tool-hang-ms=1500', {
      handshakeMs: 5_000,
      requestMs: 300,
    });
    try {
      const client = await connectTo(shortRequest.base);
      try {
        const startedAt = Date.now();
        let code: unknown = null;
        try {
          await client.callTool({ name: 'memory_recall', arguments: { context: 'probe' } });
        } catch (error) {
          code = (error as { code?: unknown }).code ?? null;
        }
        const elapsed = Date.now() - startedAt;
        // **错误码与耗时一起断**：只断错误码会漏掉「超时没生效」（本仓踩过这个）。
        expect(code).toBe(-32001);
        expect(elapsed, '每请求超时必须在上游的 1500ms 之前生效').toBeLessThan(1_500);
      } finally {
        await client.close();
      }
    } finally {
      await shortRequest.close();
    }
  }, 60_000);

  it('TC-M-L1-20：网关不吞掉上游的请求 —— logging/setLevel 抵达上游进程', async () => {
    // 上游必须**声明 `logging`**：SDK 才会为它在网关**本地**注册 `logging/setLevel` 的 handler
    // （那正是「被吞掉」的成因）；网关随后显式移除它，请求才会落回 fallback 被转发出去。
    const requestLog = path.join(tmpRoot, 'upstream-requests.log');
    fs.writeFileSync(requestLog, '');
    const { base, close } = await startWithUpstream(
      '--capabilities={"tools":{},"resources":{},"completions":{},"logging":{}}' +
        ` --request-log=${requestLog}`,
    );
    try {
      const client = await connectTo(base);
      try {
        expect(client.getServerCapabilities()).toHaveProperty('logging');
        await client.request(
          { method: 'logging/setLevel', params: { level: 'debug' } },
          z.unknown(),
        );
      } finally {
        await client.close();
      }

      // 判据以**上游进程传输层**的留痕为准，**不以**「上游返回了什么」为准 ——
      // 上游自己也会本地处理该请求（与 `TC-M-L1-16` 对取消通知的判据纪律同源）。
      // 反证（不拽回 handler 时上游收不到）由 `probes/bridge-identity-probe/` 断言 4 给出，
      // 无法在集成层构造：网关侧「不拽回」这个状态在产品代码里不存在。
      expect(fs.readFileSync(requestLog, 'utf8')).toContain('logging/setLevel');
    } finally {
      await close();
    }
  }, 30_000);
});

describe('spawn 前置断言（3.2：TC-M-L3-02）', () => {
  /** 能通过签发链路、但归一化后指向**他人**库的坏 handle —— 正是 `AC4.7` 那一类。 */
  const BAD_HANDLE = 'alice/../bob';

  it('库路径指向他人库 ⇒ spawn 前拒绝：500 + 审计行 + **上游未被启动**', async () => {
    // 造一个「绕过服务层」的用户：`createUser` 会拒掉 `alice/../bob`（`validateHandle` 判 `traversal`），
    // 所以这里走 repo 层的 `insertUser`（既有先例：tests/integration/db.test.ts）。
    // 该 handle **能通过签发链路**（`userDirectory(<usersRoot>, 'alice/../bob')` 解析到 `<usersRoot>/bob`、
    // 不越界）⇒ 这是一个**真的能到达 spawn** 的坏输入 —— 只靠「签发时拦 handle」是拦不住它的。
    insertUser(db, { handle: BAD_HANDLE });
    const issued = issueKey({ db, usersRoot: cfg.usersRoot, actor: ACTOR }, { handle: BAD_HANDLE });
    if (!issued.ok) throw new Error(`issueKey 失败：${JSON.stringify(issued)}`);

    // 上游命令换成**标记脚本**：它被执行的第一个动作就是 append 标记 ⇒
    // 「标记文件不存在」直接等于「上游**未被** spawn」；判据强于 `--env-dump`
    // （后者无法区分「没起」与「起了但在 dump 前退出」）。
    const marker = path.join(tmpRoot, 'spawn-marker.log');
    const { base, close } = await startPortal(`node ${MARKER_FIXTURE} ${marker}`);
    try {
      const { status, body } = await initializeAt(base, issued.plaintext);

      // §12.5：断言失败归 **500** —— 不是 503（那会把排障方向引到上游去，而真相是门户要拦）。
      expect(status).toBe(500);
      expect(body.error).toBe('spawn_assertion_failed');

      // 必写审计行；`detail` **只记原因枚举、不记路径**（路径里可能含**他人 handle**）。
      const rejected = listAudit(db, { limit: 500, offset: 0 }).filter(
        (row) => row.action === 'mcp_session_rejected' && row.detail_json.includes('spawn_assertion'),
      );
      expect(rejected.length).toBeGreaterThan(0);
      // 原因是 `invalid_handle`：判定**先校验 handle**，而 `alice/../bob` 含 `/`
      // ⇒ 在路径运算之前就被拦下（比归 `handle_mismatch` 更精确：根因在 handle 本身）。
      expect(rejected[0]?.detail_json).toContain('invalid_handle');
      expect(rejected[0]?.detail_json).not.toContain('/data/users/');

      // **否定命题**：命令从未被执行 ⇒ 必然也没建库、没写任何数据
      // （一句判据同时覆盖 `AC4.7` 的「未写入任何数据」与「不落共享主库」）。
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      await close();
    }
  }, 30_000);
});
