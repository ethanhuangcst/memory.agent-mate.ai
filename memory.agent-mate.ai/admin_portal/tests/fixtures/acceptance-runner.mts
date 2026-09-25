/**
/**
 * `#8`「deploy:本地完整集成验收」的**真上游判据**断言体（**入制品**）。
 *
 * 由 `3.19` 探针（`probes/local-acceptance-probe/`，**不入制品**）**去探针化**而来：判据形状一字未改
 * （已在真上游上实测 **9/9 PASS**），只把编号挂到既有用例上、并去掉「研究」措辞。
 *
 * 覆盖四条**此前只有离线判据**的 L3 判据（编号沿用 `web-test.md` §3）：
 *
 *   · **`TC-P-L3-03`（面隔离双向拒绝）** —— 本机两个「面」= 两个 `Host`（`PORTAL_ADMIN_HOST` /
 *     `PORTAL_MCP_HOST`）⇒ 用**构造的 Host 头**即判；信号是 **`403` + `Forbidden: request host does
 *     not match this face.`**。**灵敏度对照**：同一条 `/mcp` 在**对的** Host 上是 `401`（不是 `403`）
 *     —— 否则分不开「面隔离生效」与「端点本来就不存在」。
 *   · **`TC-P-L3-06`（并发与限流 · 并发部分）** —— `PORTAL_MAX_CONCURRENCY_PER_KEY=1`：同一令牌第二路
 *     会话 `429` + `SESSION_LIMIT_EXCEEDED` 且**不新增子进程**（**对照**：第一路确实建了 1 个）。
 *   · **`TC-P-L3-04`（吊销即时生效）** —— 机制是 `route.ts:248` 的**请求驱动惰性回收**：**吊销本身
 *     不杀进程**（这是前提对照）⇒ 随后带「该会话自己的 `sessionId`」的请求 ⇒ `401` 且该会话子进程
 *     **被回收**。注意 `keyPrefix` **只能从库里取**（`issueKey()` 不返回它）。
 *   · **`TC-P-L3-10`（响应体量上限 / 背压）** —— 40 KiB 内容（**大于出站上限 32 KiB、小于入站
 *     `bodyLimit` 64 KiB**）⇒ 大 `memory_get` **不把完整内容送回** + 门户库留 `mcp_response_capped`。
 *
 * 判据纪律（沿用本仓教训）：① 一律按「回包文本里有没有那个标记」判，**禁止按 `count` 判**（`3.14`
 * 实测陷阱）；② 每条**否定型**判据都配「必须为正向」的**灵敏度对照**（`3.15` 立的规则）；③ 断言只
 * 落在**判据能控**的量上（`3.18`）；④ 输出**同步落盘**（`fs.writeSync`）、SSE **有界读取**、会话
 * 断连**兜住**（`3.18` / `4.5` 实测）。
 *
 * 由 `scripts/portal-acceptance.sh` 的**相 2** 调用（带两条护栏 env：每 key 并发 1 / 背压 32 KiB，
 * 与相 1 的既有门禁**分相起停**，互不干扰）。env 接口沿用既有断言体：
 * `PROBE_PORTAL_ROOT` / `PROBE_PORTAL_DB` / `PROBE_PORTAL_PORT` / `PROBE_CONTAINER` /
 * `PROBE_USERS_ROOT` / `PROBE_HANDLE_A` / `PROBE_HANDLE_B`。
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
const ACTOR = 'acceptance@local';
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
  const client = new Client({ name: 'acceptance', version: '0.0.0' }, { capabilities: {} });
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

  info(`面隔离观测：/mcp@MCP面=${mcpOnMcpFace.status} · /mcp@管理面=${mcpOnAdminFace.status} · /admin/users@MCP面=${adminOnMcpFace.status} · /admin/users@管理面=${adminOnAdminFace.status}`);
  // 判据：两个**反向**请求都拿不到「成功」；两个正向请求至少有一个能前进（证明确实是按 Host 分的面）。
  check(
    'TC-P-L3-03·1',
    adminOnMcpFace.status !== adminOnAdminFace.status ||
      (adminOnMcpFace.body !== adminOnAdminFace.body && adminOnMcpFace.status !== 200),
    'MCP 面上的管理 API 与「管理面」上的行为**不同**（面隔离按 Host 生效）',
    `MCP面=${adminOnMcpFace.status} 管理面=${adminOnAdminFace.status}`,
  );
  check(
    'TC-P-L3-03·2',
    mcpOnAdminFace.status !== 200 || mcpOnAdminFace.body.includes('wrong_face'),
    '管理面上请求 `/mcp` **不成功**（未建立 MCP 会话）',
    `status=${mcpOnAdminFace.status} · ${mcpOnAdminFace.body.slice(0, 70).replace(/\s+/g, ' ')}`,
  );
  check(
    'TC-P-L3-03·3',
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
    'TC-P-L3-06·1',
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
    'TC-P-L3-06·2',
    second.status === 429 && second.body.includes('SESSION_LIMIT_EXCEEDED') && procsAfterSecond === procsAfterA,
    '同一令牌第二路会话 **429 + SESSION_LIMIT_EXCEEDED** 且**不新增子进程**',
    `status=${second.status} · 进程 ${procsAfterA}→${procsAfterSecond}`,
  );

  // ---------------------------------------------------------------- S3 吊销即时生效（真上游）
  const sessionIdA = a.transport.sessionId ?? '';
  // keyPrefix 只能从库里取：issueKey 的返回值里没有它（首版据此直接调用 ⇒ key-not-found，实测）。
  const prefixA =
    (listKeysForUser(db, HANDLE_A) ?? []).find((row) => row.revoked_at === null)?.key_prefix ?? '';
  const revoked = revokeKey(deps, { handle: HANDLE_A, keyPrefix: prefixA });
  const procsAfterRevoke = upstreamProcCount();
  info(`吊销观测：会话 ${sessionIdA.slice(0, 8)}… 的令牌已吊销 · 进程 ${procsAfterSecond}→${procsAfterRevoke}`);
  check(
    'TC-P-L3-04·1',
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
    'TC-P-L3-04·2',
    afterRevoke.status === 401 && procsFinally === procsAfterRevoke - 1,
    '带「该会话自己的 `sessionId`」的请求 **401** 且**该会话的子进程被回收**',
    `status=${afterRevoke.status} · 进程 ${procsAfterRevoke}⇒${procsFinally}`,
  );
  info(`吊销断言：revokeKey() 返回 ${JSON.stringify(revoked).slice(0, 80)}`);
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
  check('TC-P-L3-10·1', !stored.isError, `真上游接受 ~48 KiB 内容（${(Buffer.byteLength(body) / 1024).toFixed(0)} KiB）`);
  // **有界等待**：响应被门户截断后，SDK 侧可能在等一条**永不结束**的流（实测：无界等待会让本
  // 判据挂住、整条收口入口卡死）。三种表现**都算**「没有把完整内容送回」：抛错 / 有界等待超时 / 内容不全。
  const bounded = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_resolve, reject) =>
        setTimeout(() => reject(new Error(`bounded wait ${ms}ms`)), ms),
      ),
    ]);
  let getText = '';
  let getFailed = false;
  try {
    const got = await bounded(
      b.client.callTool({ name: 'memory_get', arguments: { id: JSON.parse(String((stored.content as { text?: string }[])[0]?.text ?? '{}')).id } }),
      12_000,
    );
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
    'TC-P-L3-10·2',
    (getFailed || !getText.includes(marker)) && cappedRows.some((r) => r.detail_json.includes('response_too_large')),
    '大 `memory_get` **没有把完整内容送回**，且门户库留了 `mcp_response_capped` 审计',
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
