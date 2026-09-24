/**
 * `3.15` 探针的断言体 —— Sprint 4 `3.7`「mcp:跨用户隔离」的开工前置（**研究类，不入制品**），
 * 由 `probes/cross-user-probe/probe.sh` 调用。
 *
 * **为什么在门户树里**（与 `probe-runner.mts` / `session-isolation-probe.mts` 同因）：要复用门户的
 * 依赖解析与 `better-sqlite3` 的原生编译 —— 放在 `probes/` 下会 `ERR_MODULE_NOT_FOUND`（实测踩过）。
 * `tests/` 不进制品。
 *
 * **要回答的问题**（`3.7` 的验收条件：「用户 A 写入的记忆，用户 B **经同一门户实例**检索不可见」+
 * 「两侧均记录**解析后的库路径**」）：
 *
 *   X1 A 经门户写入成功（回包给出该记忆 id —— X5 要用）
 *   X2 **B 经同一门户实例召回 A 的标记 ⇒ 回包不含该标记**（本探针的主判据）
 *   X3 **灵敏度对照**：B 能召回**自己**写的（否则 X2 可能只是「B 的检索根本不可用」造成的假通过 ——
 *      这是 `3.14` 的教训：每条否定型判据都必须配一条**必须为正向**的对照）
 *   X4 反向：A 召回 B 的标记 ⇒ 不含（**双向**，`TC-M-L1-03`）
 *   X5 **按 id 直取**：B 用 A 的记忆 id 调 `memory_get` ⇒ 回包不含 A 的内容（`TC-M-L1-04`）
 *   X6 **端到端取证**：门户库的 `mcp_session_opened` 审计行**两侧各一行**，各自 `detail_json.dbPath`
 *      指向**自己**的库且两者不同（`AC4.3` 的机制由 `3.4` 交付，这里判它在**跨用户**场景下成立）
 *
 * 所需环境（由主脚本注入）：`PROBE_PORTAL_ROOT` / `PROBE_PORTAL_DB` / `PROBE_PORTAL_PORT` /
 * `PROBE_USERS_ROOT` / `PROBE_CONTAINER` / `PROBE_HANDLE_A` / `PROBE_HANDLE_B`。
 *
 * **实现注意**：全程不用 `process.exit()`，只设 `process.exitCode`（stdout 是管道时 Node 异步刷盘，
 * 强制退出会把最后输出整段丢掉 —— 与 `probe-runner.mts` 同因）。
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const portalRoot = process.env.PROBE_PORTAL_ROOT as string;
const portalDb = process.env.PROBE_PORTAL_DB as string;
const usersRoot = process.env.PROBE_USERS_ROOT as string;
const port = Number(process.env.PROBE_PORTAL_PORT ?? '8801');
const container = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';
const HANDLE_A = process.env.PROBE_HANDLE_A ?? 'probe37a';
const HANDLE_B = process.env.PROBE_HANDLE_B ?? 'probe37b';

const pass: string[] = [];
const fail: string[] = [];
const check = (id: string, ok: boolean, label: string, detail = ''): void => {
  (ok ? pass : fail).push(id);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${id}] ${label}${detail ? ` — ${detail}` : ''}`);
};
const info = (msg: string): void => console.log(`  [i] ${msg}`);

/** 上游的库路径（`3.4` 的审计行与文件面都用它）—— 判「解析后」是否落在**自己**的目录里。 */
const dbPathOf = (handle: string): string => `/data/users/${handle}/ai-memory.db`;

/** 容器内该用户的库是否存在（同 uid；建/删用户目录才需要 root）。 */
const dexec = (cmd: string, asRoot = false): string =>
  execFileSync('docker', ['exec', ...(asRoot ? ['-u', '0'] : []), container, 'sh', '-c', cmd], {
    encoding: 'utf8',
  }).toString();

interface Session {
  handle: string;
  client: Client;
  transport: StreamableHTTPClientTransport;
  token: string;
  tools: string[];
}

async function main(): Promise<number> {
  if (!portalRoot || !portalDb) {
    console.error('cross-user-probe: 缺少 PROBE_PORTAL_ROOT / PROBE_PORTAL_DB');
    return 10;
  }
  const mod = async <T>(rel: string): Promise<T> =>
    (await import(pathToFileURL(path.join(portalRoot, rel)).href)) as T;
  const { createUser } = await mod<typeof import('../../src/web/services/users')>(
    'src/web/services/users.ts',
  );
  const { issueKey } = await mod<typeof import('../../src/web/services/keys')>(
    'src/web/services/keys.ts',
  );

  // ---- 1. 两个用户 + 两条令牌：**同一个门户实例**（本探针的关键前提）----
  const db = new Database(portalDb);
  const deps = { db, usersRoot, actor: 'probe315@local' };
  for (const handle of [HANDLE_A, HANDLE_B]) {
    const created = createUser(deps, { handle });
    if (!created.ok) {
      console.error(`  建房户失败（${handle}）：${JSON.stringify(created)}`);
      db.close();
      return 10;
    }
  }
  info(`两个用户：${HANDLE_A}（A）· ${HANDLE_B}（B）—— 同一门户实例、不同令牌`);

  const open = async (handle: string): Promise<Session> => {
    const issued = issueKey(deps, { handle });
    if (!issued.ok) throw new Error(`签发令牌失败（${handle}）`);
    const client = new Client({ name: 'cross-user-probe', version: '0.1.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${issued.plaintext}` } },
    });
    await client.connect(transport as never);
    const tools = await client.listTools();
    return {
      handle,
      client,
      transport,
      token: issued.plaintext,
      tools: tools.tools.map((t) => t.name),
    };
  };
  const close = async (s: Session): Promise<void> => {
    try {
      await s.transport.terminateSession();
    } catch {
      /* 尽力而为 */
    }
    await s.client.close();
  };
  /** 召回：**回包文本**（判据只看它里有没有那个标记 —— 不看 `count`，见文件头）。 */
  const recall = async (s: Session, marker: string): Promise<string> => {
    const res = await s.client.callTool({ name: 'memory_recall', arguments: { context: marker } });
    return JSON.stringify(res.content ?? '');
  };
  const store = async (s: Session, marker: string): Promise<{ text: string; id: string }> => {
    const res = await s.client.callTool({
      name: 'memory_store',
      arguments: { title: `${s.handle} ${marker}`, content: `${marker} 由 ${s.handle} 经门户写入` },
    });
    const text = JSON.stringify(res.content ?? '');
    let id = '';
    try {
      const raw = (res.content as { type: string; text?: string }[] | undefined)?.[0]?.text ?? '';
      id = (JSON.parse(raw) as { id?: string }).id ?? '';
    } catch {
      id = '';
    }
    return { text, id };
  };

  const stamp = Date.now();
  const markerA = `XU-A-${stamp}`;
  const markerB = `XU-B-${stamp}`;
  const a = await open(HANDLE_A);
  const b = await open(HANDLE_B);
  info(`A 工具数=${a.tools.length} · B 工具数=${b.tools.length} · 工具名=${a.tools.join(',')}`);

  // ---- X1：A 经门户写入 ----
  const storedA = await store(a, markerA);
  check('X1', storedA.text.includes(markerA), 'A 经门户写入成功（回包含该标记）', storedA.text.slice(0, 80));

  // ---- X2（主判据）：B 经**同一门户实例**召回 A 的标记 ⇒ 不含 ----
  const bRecallA = await recall(b, markerA);
  check(
    'X2',
    !bRecallA.includes(markerA),
    `B（${HANDLE_B}）经**同一门户实例**召回 A 的标记 ⇒ 回包**不含** ⇒ A/B 互不可见（正向）`,
    bRecallA.slice(0, 90),
  );

  // ---- X3（灵敏度对照）：B 必须能召回**自己**写的 ----
  const storedB = await store(b, markerB);
  const bRecallOwn = await recall(b, markerB);
  check(
    'X3',
    bRecallOwn.includes(markerB),
    '对照：B 能召回**自己**写的（证明 X2 不是「B 检索不可用」造成的假通过）',
    `${storedB.text.slice(0, 40)} | ${bRecallOwn.slice(0, 50)}`,
  );

  // ---- X4：反向（A 召回 B 的）⇒ 不含；且 A 仍能召回自己的 ----
  const aRecallB = await recall(a, markerB);
  const aRecallOwn = await recall(a, markerA);
  check(
    'X4',
    !aRecallB.includes(markerB) && aRecallOwn.includes(markerA),
    '反向亦然（A 召回 B 的 ⇒ 不含；A 召回自己的 ⇒ 含）⇒ **双向**互不可见',
    aRecallB.slice(0, 70),
  );

  // ---- X5：按 id 直取他人记忆 ----
  const getter = a.tools.find((n) => n === 'memory_get' || n === 'memory_read' || n.endsWith('_get'));
  if (!getter) {
    info(`未提供「按 id 直取」的工具（工具名：${a.tools.join(',')}）⇒ X5 如实登记为**未覆盖**`);
  } else if (!storedA.id) {
    info(`A 的写入回包未给出记忆 id ⇒ X5 无法判（如实登记，不伪装通过）`);
  } else {
    const got = await b.client.callTool({ name: getter, arguments: { id: storedA.id } });
    const gotText = JSON.stringify(got.content ?? '');
    check(
      'X5',
      !gotText.includes(markerA),
      `B 用 A 的记忆 id 调 \`${getter}\` ⇒ 回包**不含** A 的内容（按 id 直取不可见）`,
      `id=${storedA.id.slice(0, 12)}… | ${gotText.slice(0, 70)}`,
    );
  }

  // ---- X6：端到端取证 —— 门户库的 mcp_session_opened 两侧各一行，dbPath 各自正确且不同 ----
  const rows = db
    .prepare(
      `SELECT target, detail_json FROM audit WHERE action = 'mcp_session_opened' ORDER BY id DESC LIMIT 20`,
    )
    .all() as { target: string; detail_json: string }[];
  const dbPathOfRow = (handle: string): string => {
    const row = rows.find((r) => r.target === handle);
    if (!row) return '';
    try {
      return (JSON.parse(row.detail_json) as { dbPath?: string }).dbPath ?? '';
    } catch {
      return '';
    }
  };
  const pathA = dbPathOfRow(HANDLE_A);
  const pathB = dbPathOfRow(HANDLE_B);
  check(
    'X6',
    rows.length >= 2 && pathA === dbPathOf(HANDLE_A) && pathB === dbPathOf(HANDLE_B) && pathA !== pathB,
    '门户审计行（`mcp_session_opened`）两侧各一行、各自记着**自己的**解析后库路径且两者不同',
    `A=${pathA || '(缺)'} · B=${pathB || '(缺)'} · 命中行数=${rows.length}`,
  );

  // ---- 文件面：两侧的库都真实存在（同 uid 可读）----
  const both = dexec(`test -f ${dbPathOf(HANDLE_A)} && test -f ${dbPathOf(HANDLE_B)} && echo yes || echo no`).trim();
  check('X7', both === 'yes', '两侧的库文件都真实存在于容器内（同 uid 可读）', `${dbPathOf(HANDLE_A)} · ${dbPathOf(HANDLE_B)}`);

  await close(a);
  await close(b);
  db.close();
  console.log(`\n  通过 ${pass.length} 项 · 失败 ${fail.length} 项`);
  return fail.length === 0 ? 0 : 30;
}

process.exitCode = await main();
