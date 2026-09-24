/**
 * `3.13` 探针（**研究类，不入制品**）：为 Sprint 4 `3.4`「mcp:会话回收」定档**判据**。
 *
 * 回答四个可证伪问题（问不出结论就不该写进 spec）：
 *   Q1 `StdioClientTransport.pid` 在**本机借壳**（`docker exec`）下指向**谁**？能不能当「上游进程 pid」用？
 *      生产 β′（门户容器内直接 spawn）下又是什么？
 *   Q2 「会话结束后**子进程归零、不残留僵尸进程或占用中的库文件句柄**」（`AC3.4`）能不能**判死**？
 *      —— 即：容器内能否读到「**谁**持有该用户库的句柄」、有没有**僵尸**？
 *   Q3 `pid` 的生命周期：连接前 / 连接后 / `close()` 后各是什么？
 *   Q4 真写一次（`memory_store`）会不会改变上面两个观测面的形态（判据要不要在真写之后取）？
 *
 * 拓扑：本探针**不经门户**，直接起一个 stdio 会话（`docker exec` 借壳）—— 因为要测的是
 * SDK 与容器的观测语义，与门户无关；`3.4` 的真上游 e2e 会把这套判据挂到门户链路上。
 *
 * 用法（自包含：本目录自带 `node_modules`）：
 *   cd memory.agent-mate.ai/probes/session-reclaim-probe
 *   npm install && node probe.mjs
 *   退出码：0 全部断言通过 · 10 前置不足 · 30 断言失败
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CONTAINER = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';
const HANDLE = process.env.PROBE_HANDLE ?? 'probe313';
const BIN = process.env.PROBE_BIN ?? '/usr/local/bin/ai-memory';
/** 容器内库路径（与 `launch-template.ts` 的模板同形）。 */
const DB = `/data/users/${HANDLE}/ai-memory.db`;
const CMD_PREFIX = `${BIN} mcp --tier smart --profile core`;

const OUT = path.join(import.meta.dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const assert = (id, ok, label, detail = '') => {
  results.push({ id, ok });
  console.log(`[${id}] ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const info = (msg) => console.log(`[i] ${msg}`);

const docker = (args, opts = {}) =>
  execFileSync('docker', args, { encoding: 'utf8', ...opts }).toString();
const dexec = (cmd) => docker(['exec', CONTAINER, 'sh', '-c', cmd]);
/**
 * 借 root 跑一条容器命令 —— **只用于**预建/清理测试用户目录：`/data/users` 属主是 `root`。
 * 生产不依赖 root（用户目录由部署期 setgid 引导建立，见 `deployment.md` §4.4）；
 * 但**读 `/proc/<pid>/environ`、`/proc/<pid>/fd` 一律用同 uid**（`-u 0` 实测反而读不到）。
 */
const dexecRoot = (cmd) => docker(['exec', '-u', '0', CONTAINER, 'sh', '-c', cmd]);

/** 容器内「真上游进程」（**无 `ps`**；Rosetta 下 `/proc/<pid>/exe` 不可用 ⇒ 按 cmdline 前缀）。 */
const upstreamProcs = () =>
  dexec(
    `for f in /proc/[0-9]*/cmdline; do p=\${f#/proc/}; p=\${p%/cmdline}; ` +
      `c=$(tr '\\0' ' ' < "$f" 2>/dev/null); ` +
      `case "$c" in "${CMD_PREFIX}"*) echo "$p|$c";; esac; done`,
  )
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split('|')[0]);

/**
 * 容器内「谁持有该用户库的句柄」（扫 `/proc/<pid>/fd` 的符号链接）。
 *
 * 这是 `AC3.4`「不残留**占用中的库文件句柄**」的直接判据 —— 与「数进程」不同，
 * 它还能抓到「进程还在、但它已不再持有库」这一中间态。
 */
const dbHolders = () =>
  dexec(
    `for d in /proc/[0-9]*/fd; do p=\${d#/proc/}; p=\${p%/fd}; ` +
      `for f in "$d"/*; do l=$(readlink "$f" 2>/dev/null) || continue; ` +
      `case "$l" in ${DB}*) echo "$p:$l";; esac; done; done | sort -u`,
  )
    .split('\n')
    .filter((line) => line.trim().length > 0);

/**
 * 容器内的**僵尸**进程（`state = Z`）。
 *
 * 注意：僵尸的 `/proc/<pid>/cmdline` **是空的** ⇒ 只能按 `stat` 的 `comm`（第 2 字段）
 * 认名字；而 `stat` 的第 2 字段可能含空格与括号，故先剥掉到最后一个 `)` 再取字段。
 */
const zombies = () =>
  dexec(
    `for f in /proc/[0-9]*/stat; do p=\${f#/proc/}; p=\${p%/stat}; ` +
      `st=$(sed 's/^[^)]*)//' "$f" | awk '{print $1}'); comm=$(sed 's/^[^(]*(//; s/).*//' "$f"); ` +
      `[ "$st" = "Z" ] && echo "$p:$comm"; done | sort -u`,
  )
    .split('\n')
    .filter((line) => line.trim().length > 0);

const waitUntil = async (cond, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!(await cond()) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return cond();
};

async function main() {
  // ---------------------------------------------------------------- 前置
  let endpoint;
  try {
    docker(['inspect', CONTAINER]);
    endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
  } catch {
    console.error(`[10] 前置不足：容器 ${CONTAINER} 未运行（bash memory.agent-mate.ai/scripts/local-up.sh）`);
    return 10;
  }
  if (!endpoint) {
    console.error('[10] 前置不足：取不到 docker endpoint');
    return 10;
  }
  const upstreamKey = (() => {
    try {
      return dexec('printenv DASHSCOPE_API_KEY').trim();
    } catch {
      return '';
    }
  })();
  info(`docker endpoint = ${endpoint}`);
  info(`上游 key = ${upstreamKey ? '（容器自带，已取到）' : '（缺！真写步骤会失败）'}`);
  dexecRoot(`mkdir -p /data/users/${HANDLE} && chown aimem:aimem /data/users/${HANDLE}`);

  const basePids = upstreamProcs();
  const base = basePids.length;
  info(`基线：容器内上游进程 ${base} 个 · 该库句柄持有者 ${dbHolders().length} 个 · 僵尸 ${zombies().length} 个`);

  // ---------------------------------------------------------------- Q3：连接前
  const transport = new StdioClientTransport({
    command: 'docker',
    args: [
      '-H', endpoint,
      'exec', '-i',
      '-e', `AI_MEMORY_DB=${DB}`,
      '-e', `AI_MEMORY_AGENT_ID=human:${HANDLE}`,
      '-e', `AI_MEMORY_KEY_DIR=/data/users/${HANDLE}/keys`,
      '-e', 'AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0',
      '-e', 'HOME=/data',
      ...(upstreamKey ? ['-e', `DASHSCOPE_API_KEY=${upstreamKey}`] : []),
      CONTAINER, BIN, 'mcp', '--tier', 'smart', '--profile', 'core',
    ],
    stderr: 'pipe',
  });
  assert('P1', transport.pid === null, '`transport.pid` 在**连接前**为 `null`', `实得 ${String(transport.pid)}`);

  const client = new Client({ name: 'probe313', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  const tools = await client.listTools();

  // ---------------------------------------------------------------- Q1：pid 指向谁
  const sdkPid = transport.pid;
  assert('P2', typeof sdkPid === 'number' && sdkPid > 0, '`transport.pid` 在**连接后**可用', `实得 ${String(sdkPid)}`);
  let hostCmdline = '(读不到)';
  try {
    hostCmdline = execFileSync('ps', ['-o', 'pid,ppid,command', '-p', String(sdkPid)], { encoding: 'utf8' })
      .split('\n')[1]
      ?.trim() ?? '(空)';
  } catch {
    /* 读不到就留占位 */
  }
  info(`宿主上 pid=${sdkPid} 的命令行：${hostCmdline.slice(0, 110)}`);

  const inContainer = upstreamProcs();
  assert(
    'P3',
    inContainer.length === base + 1 && !inContainer.includes(String(sdkPid)),
    '借壳下 `transport.pid` **不是**容器内上游进程的 pid（它是宿主上的 `docker` 客户端）',
    `容器内=${inContainer.join(',') || '无'} · sdk pid=${String(sdkPid)}`,
  );

  // ---------------------------------------------------------------- Q4：真写一次
  const marker = `PROBE313-${Date.now()}`;
  let storeErr = '未执行';
  try {
    const stored = await client.callTool({
      name: 'memory_store',
      arguments: { title: `3.13 探针 ${marker}`, content: `${marker} 由会话回收探针写入` },
    });
    storeErr = String(stored.isError);
  } catch (error) {
    storeErr = `抛错：${error.message.slice(0, 60)}`;
  }
  info(`memory_store isError=${storeErr}（工具数 ${tools.tools.length}）`);

  // ---------------------------------------------------------------- Q2：会话中的观测面
  const holdersDuring = dbHolders();
  const sessionPid = upstreamProcs().find((pid) => !basePids.includes(pid));
  const sessionHolders = holdersDuring.filter((line) => line.startsWith(`${sessionPid}:`));
  info(`会话中：库句柄持有者 = ${holdersDuring.join(' | ') || '（无）'}`);
  assert(
    'P4',
    sessionHolders.length > 0,
    '库句柄判据**指向正确**：会话**中**确实是该会话的进程持有该库的句柄',
    `会话进程 pid=${String(sessionPid)} 持有 ${sessionHolders.length} 个 fd`,
  );

  // ---------------------------------------------------------------- Q3：close 后
  await client.close();
  const gone = await waitUntil(async () => upstreamProcs().length === base);
  const holdersAfter = dbHolders();
  const zombiesAfter = zombies();
  assert('P5', gone, '`close()` 后容器内上游进程回落到基线（子进程归零）', `基线 ${base}`);
  assert(
    'P6',
    holdersAfter.length === 0,
    '收尾后**没有任何进程持有该用户库的句柄**（`AC3.4` 的「不残留占用中的库文件句柄」判据可用）',
    holdersAfter.join(' | ') || '（无）',
  );
  assert(
    'P7',
    zombiesAfter.length === 0,
    '收尾后**无僵尸进程**（`state=Z` 扫描可用；僵尸 cmdline 为空 ⇒ 判据必须按 `stat` 的 comm 认名）',
    zombiesAfter.join(' | ') || '（无）',
  );
  assert(
    'P8',
    transport.pid === null,
    '`close()` 后 `transport.pid` 回到 `null`（SDK 语义：进程句柄随 close 清空）',
    `实得 ${String(transport.pid)}`,
  );

  // ---------------------------------------------------------------- 收尾
  dexecRoot(`rm -rf /data/users/${HANDLE}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n  通过 ${results.length - failed.length} 项 · 失败 ${failed.length} 项`);
  return failed.length === 0 ? 0 : 30;
}

process.exitCode = await main();
