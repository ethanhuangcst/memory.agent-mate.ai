/**
 * 「会话隔离」真上游端到端的断言体 —— Sprint 4 `3.3`「mcp:一会话一子进程」，被
 * `scripts/portal-mcp-session-probe.sh` 调用（`make portal-mcp-session-probe`）。
 *
 * 与 `tests/integration/mcp-bridge-session-isolation.test.ts` 的分工：
 *  - 集成测试用**假上游** ⇒ 完全离线、可重复，验的是**桥的归属校验与 spawn 计数**；
 *  - 本执行体用**真上游**（容器里的 ai-memory）⇒ 验的是 `AC4.5` / `AC4.6` 那两条
 *    **指向容器内**的判据：**一个会话一个真进程**，以及**别人的库/临时文件不出现**。
 *
 * 判据形状由 `3.12` 探针（`probes/session-isolation-probe/`）实测钉死，含两处反直觉点：
 *  ① `/proc/<pid>/environ` **同 uid 读得到、`-u 0` 读不到** ⇒ 判据不借 root；
 *  ② 用户目录之外**必然**有变化（上游**共享** forensic 审计日志）⇒ 判据只能豁免它，
 *     不能写「`/data` 零变化」。
 *
 * 观测被参数化为「**容器名 + cmdline 前缀**」⇒ 本机借壳（门户在宿主 + `docker exec`）与
 * 生产 β′（门户在容器内直接 spawn）共用同一套判据。
 *
 * 所需环境（由主脚本注入）：`PROBE_PORTAL_ROOT` / `PROBE_PORTAL_DB` / `PROBE_PORTAL_PORT` /
 * `PROBE_CONTAINER` / `PROBE_USERS_ROOT` / `PROBE_HANDLE_A` / `PROBE_HANDLE_B`
 * /（可选）`PROBE_BYSTANDER`。
 *
 * **实现注意**：全程不用 `process.exit()`，只设 `process.exitCode`（stdout 是管道时 Node
 * 异步刷盘，强制退出会把最后输出整段丢掉 —— 与 `probe-runner.mts` 同因）。
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
const port = Number(process.env.PROBE_PORTAL_PORT ?? '8799');
const container = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';
const HANDLE_A = process.env.PROBE_HANDLE_A ?? 'probe33a';
const HANDLE_B = process.env.PROBE_HANDLE_B ?? 'probe33b';
const ACTIVE = [HANDLE_A, HANDLE_B] as const;
/**
 * 旁观者：**本次不碰**的既有用户（其库必须零变化）。
 * 可选 —— 容器里没有该用户时跳过该项并如实说明（不伪装通过）。
 */
const BYSTANDER = process.env.PROBE_BYSTANDER ?? 'iso-alice';
/** 上游 argv（`launch-template.ts` 的 `LAUNCH_ARGS` 原样）—— 数进程的**精确前缀**。 */
const CMD_PREFIX = '/usr/local/bin/ai-memory mcp --tier smart --profile core';
/** 上游**共享**的 forensic 审计日志目录（实测：会话真写一次必然更新它 ⇒ 判据豁免它）。 */
const SHARED_AUDIT_PREFIX = '/data/.local/state/ai-memory/audit/';

const pass: string[] = [];
const fail: string[] = [];
const check = (id: string, ok: boolean, label: string, detail = ''): void => {
  (ok ? pass : fail).push(id);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  [${id}] ${label}${detail ? ` — ${detail}` : ''}`);
};
const info = (msg: string): void => console.log(`  [i] ${msg}`);

const dexec = (cmd: string, asRoot = false): string =>
  execFileSync('docker', ['exec', ...(asRoot ? ['-u', '0'] : []), container, 'sh', '-c', cmd], {
    encoding: 'utf8',
  }).toString();

/** 容器内「真上游进程」清单（**无 `ps`**；Rosetta 下 `/proc/<pid>/exe` 不可用 ⇒ 按 cmdline）。 */
const upstreamProcs = (): { pid: string; cmdline: string }[] => {
  const cmd =
    `for f in /proc/[0-9]*/cmdline; do p=\${f#/proc/}; p=\${p%/cmdline}; ` +
    `c=$(tr '\\0' ' ' < "$f" 2>/dev/null); ` +
    `case "$c" in "${CMD_PREFIX}"*) echo "$p|$c";; esac; done`;
  return dexec(cmd)
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const parts = line.split('|');
      return { pid: parts[0] ?? '?', cmdline: parts.slice(1).join('|').trim() };
    });
};
const countProcs = (): number => upstreamProcs().length;

/** 轮询等待进程数落到期望值（回收是异步的，固定 `sleep` 会写出偶发失败的判据）。 */
const waitProcs = async (n: number, timeoutMs = 10_000): Promise<number> => {
  const deadline = Date.now() + timeoutMs;
  let last = countProcs();
  while (last !== n && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    last = countProcs();
  }
  return last;
};

/** 同 uid 读进程环境（`-u 0` 读不到，实测）—— 判「这个进程是**谁的**」。 */
const environOf = (pid: string): string => {
  try {
    return dexec(
      `tr '\\0' '\\n' < /proc/${pid}/environ 2>/dev/null | grep -E '^(AI_MEMORY_DB|AI_MEMORY_AGENT_ID)=' | tr '\\n' ' ' || true`,
    ).trim();
  } catch {
    return '';
  }
};

/** `/data` + `/tmp` 的文件足迹快照（`路径 → mtime/size`），用于前后差分。 */
const snapshot = (): Map<string, string> => {
  const out = new Map<string, string>();
  for (const line of dexec(
    `find /data /tmp -type f -printf '%p|%T@|%s\\n' 2>/dev/null | sort`,
  ).split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    out.set(parts[0] ?? '?', `mtime=${parts[1]} size=${parts[2]}`);
  }
  return out;
};
const ownDir = (key: string): boolean => ACTIVE.some((handle) => key.startsWith(`/data/users/${handle}/`));

/**
 * 收尾后「**谁还持有**这两个用户的库句柄」—— `AC3.4`「不残留**占用中的库文件句柄**」的直接判据。
 *
 * 实测（`3.13` 探针）：会话**中**该会话进程持有 **4** 个 fd（`db` / `-shm` / `-wal` /
 * `.deferred-audit.journal`），**收尾后 0 个** ⇒ 判据**双向都实测过**，不是「无则通过」型。
 * 扫 `/proc/<pid>/fd` 的符号链接即可；**同 uid** 可读（`-u 0` 反而 `Permission denied`）。
 */
const dbHolders = (): string[] => {
  const patterns = ACTIVE.map((handle) => `/data/users/${handle}/ai-memory.db`).join(' ');
  return dexec(
    `for d in /proc/[0-9]*/fd; do p=\${d#/proc/}; p=\${p%/fd}; ` +
      `for f in "$d"/*; do l=$(readlink "$f" 2>/dev/null) || continue; ` +
      `for pat in ${patterns}; do case "$l" in "$pat"*) echo "$p:$l";; esac; done; done; done | sort -u`,
  )
    .split('\n')
    .filter((line) => line.trim().length > 0);
};

/**
 * 容器内的**僵尸**进程（`state = Z`）。
 *
 * **实测教训（`3.13` 探针）**：僵尸的 `/proc/<pid>/cmdline` **是空的** ⇒ 按 cmdline 前缀计数
 * **永远抓不到它**；只能读 `stat` 的 `state`，并按 `comm`（第 2 字段 —— 可能含空格，
 * 故先剥到最后一个 `)` 再取字段）认名。
 */
const zombies = (): string[] =>
  dexec(
    `for f in /proc/[0-9]*/stat; do p=\${f#/proc/}; p=\${p%/stat}; ` +
      `st=$(sed 's/^[^)]*)//' "$f" | awk '{print $1}'); comm=$(sed 's/^[^(]*(//; s/).*//' "$f"); ` +
      `[ "$st" = "Z" ] && echo "$p:$comm"; done | sort -u`,
  )
    .split('\n')
    .filter((line) => line.trim().length > 0);

function main(): Promise<number> {
  return (async () => {
    const mod = async <T>(rel: string): Promise<T> =>
      (await import(pathToFileURL(path.join(portalRoot, rel)).href)) as T;
    const { createUser } = await mod<typeof import('../../src/web/services/users')>(
      'src/web/services/users.ts',
    );
    const { issueKey } = await mod<typeof import('../../src/web/services/keys')>(
      'src/web/services/keys.ts',
    );

    const db = new Database(portalDb);
    const deps = { db, usersRoot, actor: 'probe33@local' };
    for (const handle of ACTIVE) {
      const created = createUser(deps, { handle });
      if (!created.ok) {
        console.error(`  建房户失败（${handle}）：${JSON.stringify(created)}`);
        db.close();
        return 10;
      }
    }

    const open = async (handle: string) => {
      const issued = issueKey(deps, { handle });
      if (!issued.ok) throw new Error(`签发令牌失败（${handle}）`);
      const client = new Client({ name: 'session-probe', version: '0.1.0' }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${issued.plaintext}` } },
      });
      await client.connect(transport as never);
      const tools = await client.listTools();
      return {
        handle,
        client,
        transport,
        /** 该会话的令牌明文 —— 「跨用户接管」用例要拿**甲**的令牌去打**乙**的会话。 */
        token: issued.plaintext,
        sessionId: (transport as unknown as { sessionId?: string }).sessionId ?? '',
        toolCount: tools.tools.length,
      };
    };
    const closeSession = async (session: {
      client: Client;
      transport: StreamableHTTPClientTransport;
    }): Promise<void> => {
      try {
        await session.transport.terminateSession();
      } catch {
        /* 尽力而为 */
      }
      try {
        await session.client.close();
      } catch {
        /* 尽力而为 */
      }
    };

    const base = countProcs();
    const snap0 = snapshot();
    info(`基线：容器内上游进程 ${base} 个 · /data+/tmp 文件 ${snap0.size} 个`);

    // ---------------------------------------------------------------- ① 两会话两进程
    const a = await open(HANDLE_A);
    const b = await open(HANDLE_B);
    info(`${HANDLE_A} sid=${a.sessionId} · ${HANDLE_B} sid=${b.sessionId}`);
    const procs2 = upstreamProcs();
    const pids2 = procs2.map((proc) => proc.pid);
    check(
      'TC-M-L1-21·1',
      procs2.length - base === 2 && new Set(pids2).size === pids2.length,
      '两个并发会话 ⇒ 容器内上游进程 **+2** 且 PID 互不相同',
      `基线 ${base} ⇒ 并发 ${procs2.length}（${pids2.join(', ') || '无'}）`,
    );

    const envs = pids2.map((pid) => environOf(pid));
    const envA = envs.find((env) => env.includes(`/data/users/${HANDLE_A}/`)) ?? '';
    const envB = envs.find((env) => env.includes(`/data/users/${HANDLE_B}/`)) ?? '';
    check(
      'TC-M-L1-21·2',
      envA.includes(`AI_MEMORY_AGENT_ID=human:${HANDLE_A}`) &&
        envB.includes(`AI_MEMORY_AGENT_ID=human:${HANDLE_B}`),
      '两个进程各带**自己用户的**库路径与身份（同 uid 读 `/proc/<pid>/environ`）',
      `${HANDLE_A}: ${envA || '(空)'} | ${HANDLE_B}: ${envB || '(空)'}`,
    );

    // ---------------------------------------------------------------- ② 无他人痕迹
    for (const session of [a, b]) {
      const marker = `SESSION-PROBE-${session.handle}-${Date.now()}`;
      const stored = await session.client.callTool({
        name: 'memory_store',
        arguments: { title: `会话隔离探针 ${marker}`, content: `${marker} 经门户 /mcp 写入真上游` },
      });
      if (stored.isError) info(`${session.handle} memory_store isError=true（继续判文件足迹）`);
    }
    const snap1 = snapshot();
    const added = [...snap1.keys()].filter((key) => !snap0.has(key)).sort();
    const changed = [...snap1.keys()].filter(
      (key) => snap0.has(key) && snap0.get(key) !== snap1.get(key),
    );
    const outsideAdded = added.filter((key) => !ownDir(key));
    const outsideChanged = changed.filter((key) => !ownDir(key));
    const changedNotShared = outsideChanged.filter((key) => !key.startsWith(SHARED_AUDIT_PREFIX));
    check(
      'TC-M-L1-22·1',
      outsideAdded.length === 0 && changedNotShared.length === 0,
      '会话真写之后，用户目录**之外零新增**、变化**只**落在上游共享审计日志之下',
      `新增(外)=${outsideAdded.length} 变化(外)=${outsideChanged.length}`,
    );
    for (const key of outsideChanged) info(`  共享/外部变化：${key}`);
    for (const key of outsideAdded) info(`  ⚠ 外部新增：${key}`);

    const bystanderDir = `/data/users/${BYSTANDER}`;
    const bystanderExists = dexec(`test -d ${bystanderDir} && echo yes || echo no`).trim() === 'yes';
    if (bystanderExists) {
      const bystanderTouched = [...added, ...changed].filter((key) => key.startsWith(`${bystanderDir}/`));
      check(
        'TC-M-L1-22·2',
        bystanderTouched.length === 0,
        `旁观者用户 ${BYSTANDER} 的库**零变化**`,
        bystanderTouched.length === 0 ? '正面对照成立' : bystanderTouched.join(', '),
      );
    } else {
      info(`跳过旁观者对照：容器内没有 ${bystanderDir}（该断言的基准不存在，如实登记而非伪装通过）`);
    }

    // ---------------------------------------------------------------- ③ 收尾与禁池化
    await closeSession(a);
    await closeSession(b);
    check('TC-M-L1-21·3', (await waitProcs(base)) === base, '两会话正常收尾后进程数回落到基线', `基线 ${base}`);

    const a2 = await open(HANDLE_A);
    const reopened = upstreamProcs();
    const oldPids = new Set(pids2);
    check(
      'TC-M-L1-21·4',
      reopened.length === base + 1 && reopened.every((proc) => !oldPids.has(proc.pid)),
      '同用户重开会话**不复用**旧进程（新 PID）且只起一个（禁池化）',
      `新 pid=${reopened.map((proc) => proc.pid).join(', ')} · 旧 pid=${pids2.join(', ')}`,
    );

    // ---------------------------------------------------------------- ④ 跨用户接管
    const b2 = await open(HANDLE_B);
    const beforeTakeover = countProcs();
    const takeover = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        // **甲的令牌**打**乙的** `sessionId` —— 归属校验必须拒绝，且不得伤到乙。
        authorization: `Bearer ${a2.token}`,
        'mcp-session-id': b2.sessionId,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    check(
      'TC-M-L3-05·1',
      takeover.status === 401 && countProcs() === beforeTakeover,
      '跨用户接管被拒（**401**）且**不新增**子进程',
      `HTTP ${takeover.status} · 进程 ${beforeTakeover} → ${countProcs()}`,
    );

    let victimUsable = true;
    try {
      await b2.client.listTools();
    } catch {
      victimUsable = false;
    }
    check(
      'TC-M-L3-05·2',
      victimUsable,
      '受害者用**自己的**令牌 + 原 sessionId **仍可用**（接管不得伤及第三方会话）',
      victimUsable ? '不可侵扰成立' : '会话被摘掉了（修正回退了）',
    );

    await closeSession(a2);
    await closeSession(b2);
    const afterAll = await waitProcs(base);
    check(
      'TC-M-L3-05·3',
      afterAll === base,
      '全部收尾后无孤儿进程（受害者的子进程始终在受管范围内）',
      `进程数 ${afterAll}（基线 ${base}）`,
    );

    // ---- `AC3.4` 的两条「不残留」判据（判据形状由 `3.13` 探针实测钉死）----
    const holders = dbHolders();
    check(
      'TC-P-L1-04·1',
      holders.length === 0,
      '收尾后**没有任何进程持有**这两个用户的库句柄（`AC3.4` 的「不残留占用中的库文件句柄」）',
      holders.join(' | ') || '（无）',
    );
    const zombieList = zombies();
    check(
      'TC-P-L1-04·2',
      zombieList.length === 0,
      '收尾后**无僵尸进程**（按 `stat` 的 `comm` 认名 —— 僵尸的 `cmdline` 是空的）',
      zombieList.join(' | ') || '（无）',
    );

    db.close();
    console.log(`\n  通过 ${pass.length} 项 · 失败 ${fail.length} 项`);
    return fail.length === 0 ? 0 : 30;
  })();
}

process.exitCode = await main();
