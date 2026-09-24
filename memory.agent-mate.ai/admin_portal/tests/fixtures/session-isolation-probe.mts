/**
 * `3.12` 探针的断言体（被 `probes/session-isolation-probe/probe.sh` 调用；**研究类，不入制品**）。
 *
 * **为什么在门户树里**（与 `probe-runner.mts` 同因）：要复用门户的依赖解析与 `better-sqlite3`
 * 的原生编译 —— 放在 `probes/` 下会 `ERR_MODULE_NOT_FOUND`（实测踩过）。`tests/` 不进制品。
 *
 * 三件事的**判据形状**只有实测才能定：
 *   ① `AC4.6`「两个会话对应两个独立子进程」—— 怎么数、数得到什么；
 *   ② `AC4.5`「会话前后不出现其他用户的库或临时文件」—— **哪些变化必须豁免**（实测发现上游会写共享审计日志）；
 *   ③ 「禁止跨用户复用」的**反方向**：被拒的接管会不会伤到**受害者**。
 *
 * ## 输出约定
 *   - `[An] PASS/FAIL …` = **判据成立性断言**，决定退出码（有 FAIL ⇒ `30`）。
 *   - `[F] 发现：…`      = 实测到的事实/缺陷，**不参与**退出码 —— 探针的职责是把事实钉死，
 *                          不是替实现判对错；缺陷的修正归 `3.3`（见 README 的「实测缺陷」）。
 *
 * **实现注意（踩过的坑）**：全程不用 `process.exit()`，只设 `process.exitCode` ——
 * stdout 是管道时 Node 异步刷盘，强制退出会把最后的输出整段丢掉（`probe-runner.mts` 同因）。
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
const port = Number(process.env.PROBE_PORTAL_PORT ?? '8798');
const container = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';
const A = 'p33a';
const B = 'p33b';
const ACTIVE = [A, B];
/** 旁观者：**本次不碰**的既有用户库（判「不出现其他用户的库文件」必须有这条基准）。 */
const BYSTANDER = 'iso-alice';
/** 上游的 argv 模板（`launch-template.ts` 的 `LAUNCH_ARGS` 原样）—— 数进程的**精确前缀**。 */
const CMD_PREFIX = '/usr/local/bin/ai-memory mcp --tier smart --profile core';
/** 上游的**共享**审计日志目录（实测：会话真写一次时会落这里 ⇒ 必须豁免）。 */
const SHARED_AUDIT_PREFIX = '/data/.local/state/ai-memory/audit/';

const results: { n: number; ok: boolean; msg: string; info: string }[] = [];
const assert = (n: number, ok: boolean, msg: string, info = ''): void => {
  results.push({ n, ok, msg, info });
  console.log(`[A${n}] ${ok ? 'PASS' : 'FAIL'}  ${msg}${info ? ` — ${info}` : ''}`);
};
const finding = (msg: string, info = ''): void => {
  console.log(`[F] 发现：${msg}${info ? ` — ${info}` : ''}`);
};
const info = (msg: string): void => console.log(`[i] ${msg}`);

const dexec = (cmd: string, asRoot = false): string =>
  execFileSync('docker', ['exec', ...(asRoot ? ['-u', '0'] : []), container, 'sh', '-c', cmd], {
    encoding: 'utf8',
  }).toString();

/**
 * 容器内的「真上游进程」清单。
 *
 * 两个坑都已实测（与 `3.5` 探针同一手法）：① 容器是 debian-slim，**没有 `ps`**；
 * ② 本机跑 x86_64 镜像经 **Rosetta** ⇒ 所有 `/proc/<pid>/exe` 都指向 rosetta，
 * 「按 exe 判」不成立 ⇒ 只能按 **cmdline 精确前缀**，且前缀必须带 `--profile core`
 * （否则会把别处遗留的同形孤儿一起数进来）。
 */
const upstreamProcs = (): { pid: string; cmdline: string }[] => {
  const cmd =
    `for f in /proc/[0-9]*/cmdline; do p=\${f#/proc/}; p=\${p%/cmdline}; ` +
    `c=$(tr '\\0' ' ' < "$f" 2>/dev/null); ` +
    `case "$c" in "${CMD_PREFIX}"*) echo "$p|$c";; esac; done`;
  return dexec(cmd)
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      const parts = l.split('|');
      return { pid: parts[0] ?? '?', cmdline: parts.slice(1).join('|').trim() };
    });
};
const countProcs = (): number => upstreamProcs().length;

/** 轮询等待进程数落到期望值（会话回收是异步的，固定 `sleep` 会写出偶发失败的判据）。 */
const waitProcs = async (n: number, timeoutMs = 8000): Promise<number> => {
  const deadline = Date.now() + timeoutMs;
  let last = countProcs();
  while (last !== n && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    last = countProcs();
  }
  return last;
};

/**
 * 读进程环境（判「以**谁的**库路径与身份启动」）。
 *
 * **实测反直觉**：`docker exec` **默认用户（同 uid）读得到**，而 `-u 0`（root）**读不到**
 * （`Permission denied`）⇒ 判据用同 uid，**不要**借 root。返回原文以便登记证据。
 */
const environOf = (pid: string, asRoot: boolean): string => {
  try {
    return dexec(
      `tr '\\0' '\\n' < /proc/${pid}/environ 2>/dev/null | grep -E '^(AI_MEMORY_DB|AI_MEMORY_AGENT_ID)=' | tr '\\n' ' ' || true`,
      asRoot,
    ).trim();
  } catch {
    return '';
  }
};

/** 文件足迹快照：`路径 → mtime/size`，覆盖 `/data` 与 `/tmp`（`-printf` 在镜像内可用，实测）。 */
const snapshot = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of dexec(
    `find /data /tmp -type f -printf '%p|%T@|%s\\n' 2>/dev/null | sort`,
  ).split('\n')) {
    if (!line.trim()) continue;
    const p = line.split('|');
    out.set(p[0] ?? '?', `mtime=${p[1]} size=${p[2]}`);
  }
  return out;
};
const diffOf = (a: Map<string, string>, b: Map<string, string>) => ({
  added: [...b.keys()].filter((k) => !a.has(k)).sort(),
  changed: [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k)).sort(),
});
/** 「活跃用户自己的目录」——判「他人痕迹」时要排除的正面清单。 */
const ownDir = (k: string): boolean => ACTIVE.some((h) => k.startsWith(`/data/users/${h}/`));

async function main(): Promise<number> {
  const mod = async <T>(rel: string): Promise<T> =>
    (await import(pathToFileURL(path.join(portalRoot, rel)).href)) as T;
  // 类型位置只在编译期用（`tsx` 会剥掉）；运行期靠 `mod()` 按门户根解析。
  const { createUser } = await mod<typeof import('../../src/web/services/users')>(
    'src/web/services/users.ts',
  );
  const { issueKey } = await mod<typeof import('../../src/web/services/keys')>(
    'src/web/services/keys.ts',
  );

  const db = new Database(portalDb);
  const deps = { db, usersRoot, actor: 'probe312@local' };
  for (const h of ACTIVE) createUser(deps, { handle: h });
  const keyOf = (handle: string): string => {
    const issued = issueKey(deps, { handle });
    if (!issued.ok) throw new Error(`签令牌失败 ${handle}`);
    return issued.plaintext;
  };

  const open = async (handle: string) => {
    const client = new Client({ name: 'probe-312', version: '0.0.0' }, { capabilities: {} });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${keyOf(handle)}` } },
    });
    await client.connect(transport as never);
    await client.listTools();
    const sid = (transport as unknown as { sessionId?: string }).sessionId ?? '(无)';
    return { handle, client, transport, sid };
  };
  const closeSession = async (s: {
    client: Client;
    transport: StreamableHTTPClientTransport;
  }): Promise<void> => {
    try {
      await s.transport.terminateSession();
    } catch {
      /* 尽力而为 */
    }
    try {
      await s.client.close();
    } catch {
      /* 尽力而为 */
    }
  };

  const snap0 = snapshot();
  const base = countProcs();

  console.log('\n=== 阶段 1：两个并发会话 ===');
  const a = await open(A);
  const b = await open(B);
  info(`${A} sid=${a.sid} · ${B} sid=${b.sid}`);
  const procs1 = upstreamProcs();
  info(`进程：${procs1.map((p) => p.pid).join(', ') || '(无)'}`);

  assert(
    1,
    procs1.length - base === 2 && new Set(procs1.map((p) => p.pid)).size === procs1.length,
    '两个并发会话 ⇒ 容器内上游进程 **+2** 且 PID 互不相同',
    `基线 ${base} ⇒ 并发 ${procs1.length}`,
  );

  const envA = procs1.map((p) => environOf(p.pid, false)).find((e) => e.includes(`/data/users/${A}/`));
  const envB = procs1.map((p) => environOf(p.pid, false)).find((e) => e.includes(`/data/users/${B}/`));
  assert(
    2,
    Boolean(envA?.includes(`AI_MEMORY_AGENT_ID=human:${A}`)) &&
      Boolean(envB?.includes(`AI_MEMORY_AGENT_ID=human:${B}`)),
    '两个进程各自带着**自己用户的**库路径与身份（判据：同 uid 读 `/proc/<pid>/environ`）',
    `同 uid 读得到；root 读不到`,
  );
  info(`root 读取对照（不参与断言）：${environOf(procs1[0]?.pid ?? '0', true) || '(空 / Permission denied)'}`);

  console.log('\n=== 阶段 2：两会话各**真写一次**（走真 embedding）===');
  for (const s of [a, b]) {
    const marker = `PROBE312-${s.handle}-${Date.now()}`;
    const stored = await s.client.callTool({
      name: 'memory_store',
      arguments: { title: `3.12 探针 ${marker}`, content: `${marker} 由会话隔离探针写入` },
    });
    info(`${s.handle} memory_store isError=${String(stored.isError)}`);
  }
  const snap2 = snapshot();
  const d2 = diffOf(snap0, snap2);
  const outsideAdded = d2.added.filter((k) => !ownDir(k));
  const outsideChanged = d2.changed.filter((k) => !ownDir(k));
  const changedNotAudit = outsideChanged.filter((k) => !k.startsWith(SHARED_AUDIT_PREFIX));

  assert(
    3,
    outsideAdded.length === 0 && changedNotAudit.length === 0,
    '会话真写之后，用户目录**之外零新增**、且变化**只**落在共享审计日志之下',
    `新增(外)=${outsideAdded.length} 变化(外)=${outsideChanged.length}（其中共享审计 ${outsideChanged.length - changedNotAudit.length}）`,
  );
  for (const k of outsideChanged) info(`  共享/外部变化：${k}`);
  for (const k of outsideAdded) info(`  ⚠ 外部新增：${k}`);

  assert(
    4,
    diffOf(snap0, snap2).added.filter((k) => k.startsWith(`/data/users/${BYSTANDER}/`)).length === 0 &&
      diffOf(snap0, snap2).changed.filter((k) => k.startsWith(`/data/users/${BYSTANDER}/`)).length === 0,
    `旁观者用户 ${BYSTANDER} 的库**零变化**`,
    '「不出现其他用户的库文件」的基准',
  );

  console.log('\n=== 阶段 3：正常收尾 ⇒ 归零 ===');
  await closeSession(a);
  await closeSession(b);
  assert(5, (await waitProcs(base)) === base, '两会话正常收尾后进程数回落到基线', `基线 ${base}`);

  console.log('\n=== 阶段 4：同用户**重开**会话（禁池化）===');
  const a2 = await open(A);
  const procsReopen = upstreamProcs();
  const oldPids = new Set(procs1.map((p) => p.pid));
  assert(
    6,
    procsReopen.length === base + 1 && procsReopen.every((p) => !oldPids.has(p.pid)),
    '重开会话**不复用**旧进程（新 PID），且只起一个',
    `新 pid=${procsReopen.map((p) => p.pid).join(', ')} · 旧 pid=${[...oldPids].join(', ')}`,
  );
  await closeSession(a2);
  assert(7, (await waitProcs(base)) === base, '重开的会话收尾后同样归零');

  console.log('\n=== 阶段 5：跨用户接管（甲的令牌 + 乙的 sessionId）===');
  const a3 = await open(A);
  const b3 = await open(B);
  const beforeAttempt = countProcs();
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${keyOf(A)}`,
      'mcp-session-id': b3.sid,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  await new Promise((r) => setTimeout(r, 500));
  assert(
    8,
    res.status === 401 && countProcs() === beforeAttempt,
    '接管被拒（**401**）且**不新增**子进程',
    `HTTP ${res.status} · 进程 ${beforeAttempt} → ${countProcs()}`,
  );

  // 下面两条**条件输出**：缺陷存在时打 `[F] 发现`，修好之后打 `[i]` 的正面结论 ——
  // 这样同一个探针在 `3.3` 修正落地后**直接当回归判据**用（而不是继续喊一句已经不成立的话）。
  let victimOk = true;
  try {
    await b3.client.listTools();
  } catch {
    victimOk = false;
  }
  if (victimOk) {
    info(`接管被拒之后，受害者（${B}）仍可用**自己的**令牌续用会话 ⇒ 「不可侵扰」成立`);
  } else {
    finding(
      `接管被拒**之后**，受害者（${B}）用**自己的**令牌 + 原 sessionId 已**失效**（401）`,
      '`route.ts` 在「会话不属于本令牌」分支上 `registry.remove()` ⇒ 把**第三方**的会话从注册表里摘掉了',
    );
  }

  await closeSession(a3);
  await closeSession(b3);
  await new Promise((r) => setTimeout(r, 2500));
  const leftover = upstreamProcs();
  const orphan = leftover.length - base;
  if (orphan > 0) {
    finding(
      `受害者被摘掉后，其子进程不被任何引用关闭 ⇒ 收尾后**残留孤儿**`,
      `残留 ${orphan} 个：${leftover.map((p) => p.pid).join(', ')}（门户进程退出时才随之消失）`,
    );
  } else {
    info('收尾后无孤儿进程 ⇒ 注册表与会话回收一致（修正后应恒为此）');
  }

  console.log('\n=== 汇总 ===');
  const failed = results.filter((r) => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? '✓' : '✗'} A${r.n} ${r.msg}`);
  console.log(`  ${results.length - failed.length}/${results.length} 项 PASS`);
  db.close();
  return failed.length === 0 ? 0 : 30;
}

process.exitCode = await main();
