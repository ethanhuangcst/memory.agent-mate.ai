/**
 * `4.5`「web-portal:响应背压上限」的集成用例（**假上游**，完全离线）。
 *
 * 判据形状由 `3.18` 探针（`probes/response-size-probe/`）导出：上游在 **stdio** 面上**不兜底**
 * （`[limits].max_page_size` 是 HTTP 面专属；单条内容上限 `65536` 字节）⇒ 「门户级上限 + 明确报错」
 * 这半条只能自己实现，且**必须带灵敏度对照**。
 *
 * 两条判据：
 *   ① **超限 ⇒ 不把超限数据转发出去**：并留一行审计（`action='mcp_response_capped'`、
 *      `detail_json.reason='response_too_large'`）。两种**合法**收尾（实现口径见
 *      `src/bridge/response-cap.ts`，单测逐支覆盖）：
 *      · 头**未**发出 ⇒ `502` + `RESPONSE_TOO_LARGE`；
 *      · 头**已**发出（SSE 中途）⇒ **截断**（客户端拿到 0 字节或半截流）。
 *   ② **灵敏度对照**：同一条请求在**未配置上限**时必须**完整**返回 ⇒ 证明 ① 不是
 *      「环境本来就不通」造成的**假绿**（`3.15` 的教训：否定型判据必须配「必须为正向」的对照）。
 *
 * 两条工程细节（都是实测换来的）：
 *   · 请求必须是**合法的 `initialize`**（缺 `clientInfo` / `capabilities` 会被 SDK 判 `400` ——
 *     那样「超限没转发」与「请求本来就不合法」就分不开）；
 *   · 本文件用**裸 `fetch`**建会话，**必须显式 `DELETE` 收尾** —— 否则 `app.close()` 会一直
 *     等这条连接（首版实测：用例挂住、无输出）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { loadConfig } from '../../src/config';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { buildServer } from '../../src/server';
import { createUser } from '../../src/web/services/users';
import { issueKey } from '../../src/web/services/keys';

const ACTOR = 'it-response-cap@local';
const FIXTURE = path.resolve(import.meta.dirname, '..', 'fixtures', 'fake-upstream.mjs');
const PROTOCOL = '2025-06-18';
/** 上限取 128 字节 —— 小于 `initialize` 回包 ⇒ **第一片**就超限（判据与数据量无关）。 */
const CAP_BYTES = 128;

let tmpRoot: string;
let usersRoot: string;
let db: Database.Database;
let token: string;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-response-cap-'));
  usersRoot = path.join(tmpRoot, 'users');
  fs.mkdirSync(usersRoot, { recursive: true });
  db = openMemoryDatabase();
  migrate(db);
  const deps = { db, usersRoot, actor: ACTOR };
  const created = createUser(deps, { handle: 'alice' });
  if (!created.ok) throw new Error('建房户失败（alice）');
  const issued = issueKey(deps, { handle: 'alice' });
  if (!issued.ok) throw new Error('签发测试令牌失败');
  token = issued.plaintext;
});

afterAll(() => {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

interface Portal {
  readonly base: string;
  readonly close: () => Promise<void>;
}

/** 起一个门户实例；`responseMaxBytes` 传 `undefined` = **不启用**该护栏（对照用）。 */
async function startPortal(responseMaxBytes?: number): Promise<Portal> {
  const cfg = loadConfig({
    PORTAL_ENV: 'development',
    PORTAL_ADMIN_HOST: 'localhost',
    PORTAL_MCP_HOST: '127.0.0.1',
    PORTAL_DB_PATH: path.join(tmpRoot, 'portal.db'),
    PORTAL_USERS_ROOT: usersRoot,
    PORTAL_LAUNCH_OVERRIDE: `node ${FIXTURE}`,
    DASHSCOPE_API_KEY: 'sk-test-key',
    PORTAL_LOG_LEVEL: 'silent',
    ...(responseMaxBytes === undefined
      ? {}
      : { PORTAL_RESPONSE_MAX_BYTES: String(responseMaxBytes) }),
  } as NodeJS.ProcessEnv);
  const app = await buildServer(cfg, { db });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return { base: `http://127.0.0.1:${port}`, close: async () => app.close() };
}

/**
 * **有界**读一段响应体（最多 `ms` 毫秒 / 4 KiB）。
 *
 * 为什么不能直接 `await res.text()`：成功的 `initialize` 走 **SSE**，服务端**不会主动结束**这条流
 * （SSE 要保持打开以推通知）⇒ `text()` 会一直挂（首版实测：用例无输出地挂住）。拿到足够内容后
 * `cancel()` 读端即可。
 */
async function readSome(res: Response, ms = 400): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const leftover = Math.max(1, deadline - Date.now());
      const read = await Promise.race([
        reader.read(),
        new Promise<{ done: true }>((resolve) => setTimeout(() => resolve({ done: true }), leftover)),
      ]);
      if (read.done) break;
      const value = (read as { value?: Uint8Array }).value;
      if (value) text += decoder.decode(value, { stream: true });
      if (text.length >= 4096) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

/** 直接发一次**合法**的 `initialize`（**不**经过 SDK 的抛错处理）⇒ 拿得到状态码与响应体。 */
async function postInitialize(base: string): Promise<{ status: number; body: string; sessionId: string }> {
  const res = await fetch(`${base}/mcp`, {
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
      params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'it-response-cap', version: '0.0.0' } },
    }),
  });
  return {
    status: res.status,
    body: await readSome(res),
    sessionId: res.headers.get('mcp-session-id') ?? '',
  };
}

/** 显式结束会话（本文件不经 SDK 的 `terminateSession`，不收尾 `app.close()` 会等连接）。 */
async function endSession(base: string, sessionId: string): Promise<void> {
  if (!sessionId) return;
  await fetch(`${base}/mcp`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${token}`,
      'mcp-session-id': sessionId,
      'mcp-protocol-version': PROTOCOL,
    },
  }).catch(() => undefined);
}

/** 已落盘的超限审计行数（**只数这一类** ⇒ 两个用例之间不互相污染）。 */
const cappedAuditCount = (): number =>
  (
    db
      .prepare(`SELECT COUNT(*) AS n FROM audit WHERE action = 'mcp_response_capped'`)
      .get() as { n: number }
  ).n;

describe('4.5 响应背压上限（门户自建）', () => {
  it('① 上限 128 字节 ⇒ 超限内容**没有被转发**，并留一行 `mcp_response_capped` 审计', async () => {
    const portal = await startPortal(CAP_BYTES);
    try {
      const before = cappedAuditCount();
      const { status, body, sessionId } = await postInitialize(portal.base);
      await endSession(portal.base, sessionId);

      // 两种**合法**收尾：头未发出 ⇒ 502 + 错误码；头已发出 ⇒ 截断（0 字节）。
      const legal = (status === 502 && body.includes('RESPONSE_TOO_LARGE')) || body.length === 0;
      expect(legal).toBe(true);
      expect(body).not.toContain('serverInfo'); // 无论如何，**没有**把完整回包送出去
      expect(cappedAuditCount()).toBeGreaterThan(before);

      const rows = db
        .prepare(`SELECT detail_json FROM audit WHERE action = 'mcp_response_capped'`)
        .all() as { detail_json: string }[];
      expect(rows.some((row) => row.detail_json.includes('response_too_large'))).toBe(true);
    } finally {
      await portal.close();
    }
  });

  it('② 灵敏度对照：未配置上限 ⇒ 同一条请求**完整**返回，且不产生超限审计', async () => {
    const portal = await startPortal(undefined);
    try {
      const before = cappedAuditCount();
      const { status, body, sessionId } = await postInitialize(portal.base);
      await endSession(portal.base, sessionId);

      expect(status).toBe(200);
      expect(body).toContain('serverInfo'); // 完整回包 ⇒ ① 的「没有送出去」不是环境问题
      expect(body.length).toBeGreaterThan(CAP_BYTES);
      expect(cappedAuditCount()).toBe(before);
    } finally {
      await portal.close();
    }
  });
});
