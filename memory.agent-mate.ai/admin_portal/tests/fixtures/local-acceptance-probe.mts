/**
 * `3.19` 探针的断言体（**研究类，不入制品**）：为 Sprint 4 `#8`「deploy:本地完整集成验收」定档
 * **哪几条 L3 判据能提升到「经门户的真上游」**。
 *
 * ## 为什么单列（覆盖核对结论）
 *
 * `#8` 的验收条件是「**L2** 真实客户端跑通」+「**L3 本地版全绿**：跨用户隔离 · 面隔离双向拒绝 ·
 * 吊销即时生效 · 并发与配额生效 · 单响应背压生效」。复核既有取证面：
 *   · **L2 已覆**（`make portal-mcp-probe`，`3.1`：真客户端 + `memo_` 令牌 + initialize/tools/list/实调用）；
 *   · **跨用户隔离已覆**（`make portal-mcp-session-probe`，`3.7`：经门户双向不可见 / 按 id 直取 / 两侧审计行）；
 *   · **其余四条只有「离线（假上游）」判据**（面隔离 = 离线集成 + 公开路径用例 · 吊销 = 离线用例 ·
 *     并发 = `4.1` 离线用例 · 背压 = `4.5` 离线用例）⇒ **能不能在真上游上判、判据怎么写，全仓没有实测**。
 * 本探针就回答这四条（**这是 `#8` 技术设计的输入**）。
 *
 * ## 四个场景与判据形状
 *
 *   S1 **面隔离**：本机两个「面」只是两个 `Host`（`PORTAL_ADMIN_HOST=localhost` /
 *      `PORTAL_MCP_HOST=127.0.0.1`）⇒ 用**构造的 Host 头**发请求即可测；必须带**灵敏度对照**
 *      （同一路径在**正确**的 Host 上行为不同 —— 否则「怎么都被拒」无法区分「面隔离生效」与
 *      「端点本来就不存在」）。
 *   S2 **并发上限（真上游）**：`PORTAL_MAX_CONCURRENCY_PER_KEY=1` ⇒ **同一令牌**第二路会话必须
 *      `429` + `SESSION_LIMIT_EXCEEDED`，且**不新增子进程**（计数基线对照）。
 *   S3 **吊销即时生效（真上游）**：吊销该令牌后，带「该会话自己的 `sessionId`」的请求必须 `401`
 *      **且该会话的子进程消失** —— 机制是 `route.ts:248` 的**请求驱动**回收（`isSessionKeyUsable`
 *      判否 ⇒ `registry.close`）。必须**前后各数一次**子进程（「吊销前它在」是这条判据的灵敏度对照）。
 *   S4 **背压（真上游）**：`PORTAL_RESPONSE_MAX_BYTES=32768`（大于建立期响应、小于 48 KiB 的
 *      `memory_get`）⇒ 大 `memory_get` 必须**不把完整内容送回**，并在门户库留一行
 *      `mcp_response_capped`。
 *
 * ## 判据纪律（沿用本仓既有教训）
 *
 * ① 一律按「回包文本里有没有那个标记」判，**禁止按 `count` 判**（`3.14`）；② 每条**否定型**判据
 * 都配**灵敏度对照**（`3.15`）；③ 判据只能落在**判据能控**的量上（`3.18`：不可控的量如实登记）。
 *
 * 所需环境（由 `probe.sh` 注入）：`PROBE_PORTAL_ROOT` / `PROBE_PORTAL_DB` / `PROBE_PORTAL_PORT` /
 * `PROBE_CONTAINER` / `PROBE_USERS_ROOT` / `PROBE_HANDLE_A` / `PROBE_HANDLE_B`。
 */
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const portalRoot = process.env.PROBE_PORTAL_ROOT as string;
const portalDbPath = process.env.PROBE_PORTAL_DB as string;
const usersRoot = process.env.PROBE_USERS_ROOT as string;
const port = Number(process.env.PROBE_PORTAL_PORT ?? '8802');
const container = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';
const HANDLE_A = process.env.PROBE_HANDLE_A ?? 'probe319a';
const HANDLE_B = process.env.PROBE_HANDLE_B ?? 'probe319b';
const ACTOR = 'probe-319@local';
/** 「面」在本机 = 两个 Host（见文件头 S1）。 */
const MCP_FACE_HOST = '127.0.0.1';
const ADMIN_FACE_HOST = 'localhost';

const pass: string[] = [];
const fail: string[] = [];
const check = (id: string, ok: boolean, label: string, detail = ''): void => {
  (ok ? pass : fail).push(id);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${id}] ${label}${detail ? ` — ${detail}` : ''}`);
};
const info = (msg: string): void => console.log(`  [i] ${msg}`);

const docker = (args: string[]): string => execFileSync('docker', args, { encoding: 'utf8' });

/** 容器内「借壳」上游进程数（**无 `ps`**；按 cmdline 计数 —— 同 `3.12`/`3.13` 的口径）。 */
const upstreamProcCount = (): number => {
  const out = docker([
    'exec', container, 'sh', '-c',
    "n=0; for f in /proc/[0-9]*/cmdline; do c=$(tr '\\0' ' ' < \"$f\" 2>/dev/null); case \"$c\" in */ai-memory*) n=$((n+1));; esac; done; echo $n",
  ]);
  return Number(out.trim());
};

/** 一次带**构造 Host 头**的请求（本机两个「面」= 两个 Host）。 */
function requestWithHost(
  hostHeader: string,
  method: string,
  reqPath: string,
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path: reqPath, headers: { Host: hostHeader, ...headers } },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text }));
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function openSession(token: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client({ name: 'probe319', version: '0.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  await client.connect(transport as never);
  return { client, transport };
}

async function main(): Promise<number> {
  const db = new Database(portalDbPath);
  const mod = async <T>(rel: string): Promise<T> =>
    (await import(pathToFileURL(path.join(portalRoot, rel)).href)) as T;
  const { createUser } = await mod<typeof import('../../src/web/services/users')>('src/web/services/users.ts');
  const { issueKey, revokeKey, listKeysForUser } = await mod<
    typeof import('../../src/web/services/keys')
  >(
    'src/web/services/keys.ts',
  );

  const deps = { db, usersRoot, actor: ACTOR };
  for (const handle of [HANDLE_A, HANDLE_B]) {
    const created = createUser(deps, { handle });
    if (!created.ok) throw new Error(`建房户失败（${handle}）`);
  }
  const issuedA = issueKey(deps, { handle: HANDLE_A });
  const issuedB = issueKey(deps, { handle: HANDLE_B });
  if (!issuedA.ok || !issuedB.ok) throw new Error('签发测试令牌失败');
  info(`两个测试用户已建：${HANDLE_A} / ${HANDLE_B} · 端口 ${port}`);

  // ---------------------------------------------------------------- S1 面隔离（Host 构造）
  //
  // 灵敏度对照必须同批：同一条 `/mcp` 请求在**对的** Host 上不能被判「面不匹配」。
  const mcpOnMcpFace = await requestWithHost(MCP_FACE_HOST, 'POST', '/mcp', {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
  const mcpOnAdminFace = await requestWithHost(ADMIN_FACE_HOST, 'POST', '/mcp', {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  }, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }));
  const adminOnMcpFace = await requestWithHost(MCP_FACE_HOST, 'GET', '/admin/users');
  const adminOnAdminFace = await requestWithHost(ADMIN_FACE_HOST, 'GET', '/admin/users');

  info(`S1 观测：/mcp@MCP面=${mcpOnMcpFace.status} · /mcp@管理面=${mcpOnAdminFace.status} · /admin/users@MCP面=${adminOnMcpFace.status} · /admin/users@管理面=${adminOnAdminFace.status}`);
  // 判据：两个**反向**请求都拿不到「成功」；两个正向请求至少有一个能前进（证明确实是按 Host 分的面）。
  check(
    'S1a',
    adminOnMcpFace.status !== adminOnAdminFace.status ||
      (adminOnMcpFace.body !== adminOnAdminFace.body && adminOnMcpFace.status !== 200),
    'MCP 面上的管理 API 与「管理面」上的行为**不同**（面隔离按 Host 生效 ⇒ 本机可判）',
    `MCP面=${adminOnMcpFace.status} 管理面=${adminOnAdminFace.status}`,
  );
  check(
    'S1b',
    mcpOnAdminFace.status !== 200 || mcpOnAdminFace.body.includes('wrong_face'),
    '管理面上请求 `/mcp` **不成功**（未建立 MCP 会话）',
    `status=${mcpOnAdminFace.status} · ${mcpOnAdminFace.body.slice(0, 70).replace(/\s+/g, ' ')}`,
  );
  check(
    'S1c',
    mcpOnMcpFace.status !== mcpOnAdminFace.status,
    '**灵敏度对照**：同一条 `/mcp` 请求在对的 Host 上行为不同 ⇒ S1a/S1b 不是「端点本来就不存在」',
    `MCP面=${mcpOnMcpFace.status} vs 管理面=${mcpOnAdminFace.status}`,
  );

  // ---------------------------------------------------------------- S2 并发上限（真上游）
  const baseProcs = upstreamProcCount();
  const a = await openSession(issuedA.plaintext);
  await a.client.listTools();
  const procsAfterA = upstreamProcCount();
  check(
    'S2a',
    procsAfterA === baseProcs + 1,
    `同一令牌第一路会话建立了**一个**真上游子进程（基线 ${baseProcs} ⇒ ${procsAfterA}）`,
  );
  const second = await requestWithHost(MCP_FACE_HOST, 'POST', '/mcp', {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${issuedA.plaintext}`,
  }, JSON.stringify({
    jsonrpc: '2.0', id: 3, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'p319', version: '0' } },
  }));
  const procsAfterSecond = upstreamProcCount();
  check(
    'S2b',
    second.status === 429 && second.body.includes('SESSION_LIMIT_EXCEEDED') && procsAfterSecond === procsAfterA,
    '同一令牌第二路会话 **429 + SESSION_LIMIT_EXCEEDED** 且**不新增子进程**（真上游版可判）',
    `status=${second.status} · 进程 ${procsAfterA}→${procsAfterSecond}`,
  );

  // ---------------------------------------------------------------- S3 吊销即时生效（真上游）
  const sessionIdA = a.transport.sessionId ?? '';
  // keyPrefix 只能从库里取：issueKey 的返回值里没有它（首版据此直接调用 ⇒ key-not-found，实测）。
  const prefixA =
    (listKeysForUser(db, HANDLE_A) ?? []).find((row) => row.revoked_at === null)?.key_prefix ?? '';
  const revoked = revokeKey(deps, { handle: HANDLE_A, keyPrefix: prefixA });
  const procsAfterRevoke = upstreamProcCount();
  info(`S3 观测：会话 ${sessionIdA.slice(0, 8)}… 的令牌已吊销 · 进程 ${procsAfterSecond}→${procsAfterRevoke}`);
  check(
    'S3a',
    procsAfterRevoke === procsAfterSecond,
    '**吊销本身不主动杀进程**（机制是**请求驱动**的惰性回收 —— 这条是 S3b 的前提）',
    `进程 ${procsAfterSecond}⇒${procsAfterRevoke}`,
  );
  const afterRevoke = await requestWithHost(MCP_FACE_HOST, 'POST', '/mcp', {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${issuedA.plaintext}`,
    'mcp-session-id': sessionIdA,
  }, JSON.stringify({
    jsonrpc: '2.0', id: 4, method: 'tools/list',
    params: {},
  }));
  const procsFinally = upstreamProcCount();
  check(
    'S3b',
    afterRevoke.status === 401 && procsFinally === procsAfterRevoke - 1,
    '带「该会话自己的 `sessionId`」的请求 **401** 且**该会话的子进程被回收**（吊销即时生效 = 真上游可判）',
    `status=${afterRevoke.status} · 进程 ${procsAfterRevoke}⇒${procsFinally}`,
  );
  info(`S3 断言：revokeKey() 返回 ${JSON.stringify(revoked).slice(0, 80)}`);
  try {
    await a.client.close();
  } catch {
    /* 已被门户回收 */
  }

  // ---------------------------------------------------------------- S4 背压（真上游）
  const b = await openSession(issuedB.plaintext);
  await b.client.listTools();
  const marker = `LA319-${Date.now()}`;
  // 内容量必须落在**两个上限之间**：大于 PORTAL_RESPONSE_MAX_BYTES（32 KiB，才触发背压），
  // 小于门户的请求体上限（src/server.ts:75 bodyLimit = 64 KiB —— 首版用 ~86 KiB 被
  // 413 FST_ERR_CTP_BODY_TOO_LARGE 拦在门外，实测）。
  const fill = '背压探针填充内容，用于把单条响应推到上限之上。';
  let body = marker + ' ';
  while (Buffer.byteLength(body, 'utf8') < 40 * 1024) body += fill;
  const stored = await b.client.callTool({
    name: 'memory_store',
    arguments: { title: `3.19 大条 ${marker}`, content: body },
  });
  check('S4a', !stored.isError, `真上游接受 ~48 KiB 内容（${(Buffer.byteLength(body) / 1024).toFixed(0)} KiB）`);
  let getText = '';
  let getFailed = false;
  try {
    const got = await b.client.callTool({ name: 'memory_get', arguments: { id: JSON.parse(String((stored.content as { text?: string }[])[0]?.text ?? '{}')).id } });
    getText = JSON.stringify(got.content ?? '');
    getFailed = !!got.isError;
  } catch (error) {
    getFailed = true;
    getText = String(error);
  }
  const cappedRows = db
    .prepare(`SELECT detail_json FROM audit WHERE action = 'mcp_response_capped'`)
    .all() as { detail_json: string }[];
  check(
    'S4b',
    (getFailed || !getText.includes(marker)) && cappedRows.some((r) => r.detail_json.includes('response_too_large')),
    '大 `memory_get` **没有把完整内容送回**，且门户库留了 `mcp_response_capped` 审计（背压真上游可判）',
    `失败=${getFailed} · 回包 ${(Buffer.byteLength(getText) / 1024).toFixed(1)} KiB · 审计 ${cappedRows.length} 行`,
  );
  try {
    await b.client.close();
  } catch {
    /* 尽力而为 */
  }

  db.close();
  console.log(`\n  通过 ${pass.length} 项 · 失败 ${fail.length} 项`);
  return fail.length ? 30 : 0;
}

process.exit(await main());
