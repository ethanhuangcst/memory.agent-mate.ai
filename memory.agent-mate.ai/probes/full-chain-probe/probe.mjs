/**
 * `3.14` 探针（**研究类，不入制品**）：为 Sprint 4 `3.6`「mcp:全链路联通」定档
 * 「**写入 → 用户库 → 召回**」这条链的判决据形状。
 *
 * ## 为什么要单独测这件事
 *
 * `3.6` 的验收条件之一是「**一次写入召回跑通**：门户 → HTTP MCP → 子进程 stdio → **用户库**
 * 全程贯通并返回真实结果」。已有的真上游门禁（`make portal-mcp-probe`，`3.1` 交付）断言的是
 * **同一个会话内**的「写入成功 + 召回命中 + 库文件落在该用户目录」—— 但**同会话的召回可能是
 * 该进程内存里的索引**给的，不能证明「写入真的落进了用户库、且能被**另一个进程**读回」。
 * 全仓此前**没有任何地方**验过「换一个会话 / 新进程仍能召回」（已 grep 确认）。
 *
 * ## 四个可证伪问题
 *
 *   Q1 会话 A（进程 1）写入 → **正常收尾** → 会话 B（进程 2）能否召回？
 *      —— 这是 `3.6` 判决据的核心；**不能**召回则「落库」不成立（或需要额外条件）。
 *   Q2 会话 B 拿到的是**自己的库**吗（`AI_MEMORY_DB` 与 A 相同）？—— 同用户同库的前提。
 *   Q3 **不正常收尾**（直接 `close()`，不 terminate）后，新会话还能召回吗？
 *      —— 决定判决据要不要要求「先正常收尾」这一前置（否则 e2e 会偶发假失败）。
 *   Q4 **反向对照**：新会话召回一个**从未写入**的标记 ⇒ 必须**不命中**。
 *      —— 防止 Q1 的判据是空转（「怎么都能命中」的假阳性）。
 *
 * ## 为什么不经门户
 *
 * 要测的是**持久性**这一件事：门户链路（令牌 → handle → 库路径）已由 `make portal-mcp-probe`
 * 证过（断言「库文件落在该用户目录」）。这里直接起 stdio 会话，把变量压到最少
 * （同一份库路径、两个不同进程），结论才唯一归因。`3.6` **交付时**会把同一判据挂到门户链路上。
 *
 * 用法（自包含：本目录自带 `node_modules`）：
 *   cd memory.agent-mate.ai/probes/full-chain-probe
 *   npm install && node probe.mjs
 *   退出码：0 全部断言通过 · 10 前置不足 · 30 断言失败
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CONTAINER = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';
const HANDLE = process.env.PROBE_HANDLE ?? 'probe314';
const BIN = process.env.PROBE_BIN ?? '/usr/local/bin/ai-memory';
const DB = `/data/users/${HANDLE}/ai-memory.db`;

const OUT = path.join(import.meta.dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const assert = (id, ok, label, detail = '') => {
  results.push({ id, ok });
  console.log(`[${id}] ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const info = (msg) => console.log(`[i] ${msg}`);

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8' }).toString();
const dexec = (cmd) => docker(['exec', CONTAINER, 'sh', '-c', cmd]);
const dexecRoot = (cmd) => docker(['exec', '-u', '0', CONTAINER, 'sh', '-c', cmd]);

/** 起一个 stdio 会话（借壳 docker exec），返回 { client, transport }。 */
async function openSession(apiKey, endpoint) {
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
      ...(apiKey ? ['-e', `DASHSCOPE_API_KEY=${apiKey}`] : []),
      CONTAINER, BIN, 'mcp', '--tier', 'smart', '--profile', 'core',
    ],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'probe314', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport, pid: transport.pid };
}

/** 召回一个标记，返回上游回包的文本（判据只在这里取）。 */
async function recall(client, marker) {
  const res = await client.callTool({ name: 'memory_recall', arguments: { context: marker } });
  return JSON.stringify(res.content ?? '');
}

async function closeGraceful(session) {
  try {
    await session.transport.terminateSession();
  } catch {
    /* 尽力而为 */
  }
  await session.client.close();
}

async function main() {
  let endpoint;
  let apiKey;
  try {
    docker(['inspect', CONTAINER]);
    endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
    apiKey = dexec('printenv DASHSCOPE_API_KEY').trim();
  } catch {
    console.error(`[10] 前置不足：容器 ${CONTAINER} 未运行（bash memory.agent-mate.ai/scripts/local-up.sh）`);
    return 10;
  }
  if (!endpoint || !apiKey) {
    console.error('[10] 前置不足：取不到 docker endpoint 或上游 key（写入与召回都要真 embedding）');
    return 10;
  }
  dexecRoot(`mkdir -p /data/users/${HANDLE} && chown aimem:aimem /data/users/${HANDLE}`);
  // 从零开始：清掉上一次遗留的库，避免「上一轮的写入」污染 Q1/Q4 的判据。
  dexecRoot(`rm -f /data/users/${HANDLE}/ai-memory.db*`);

  const stamp = Date.now();
  const markerA = `CHAIN-A-${stamp}`;
  const markerNever = `CHAIN-NEVER-${stamp}`;

  // ---------------------------------------------------------------- Q1：新进程能否召回
  const a = await openSession(apiKey, endpoint);
  info(`会话 A pid=${String(a.pid)} · 库=${DB}`);
  const st = await a.client.callTool({
    name: 'memory_store',
    arguments: { title: `3.14 写入 ${markerA}`, content: `${markerA} 由会话 A 写入，判据在会话 B 取` },
  });
  assert('Q1a', !st.isError, '会话 A `memory_store` 成功', JSON.stringify(st.content).slice(0, 60));
  await closeGraceful(a);

  const b = await openSession(apiKey, endpoint);
  info(`会话 B pid=${String(b.pid)}（与 A 不同进程）`);
  assert(
    'Q1b',
    b.pid !== a.pid && typeof b.pid === 'number',
    '会话 B 是**另一个进程**（判据：两个 pid 不同）',
    `A=${String(a.pid)} B=${String(b.pid)}`,
  );
  const recalledB = await recall(b.client, markerA);
  assert(
    'Q1c',
    recalledB.includes(markerA),
    '**新进程**能召回上一个会话写入的记忆 ⇒ 「写入落进用户库」成立',
    recalledB.slice(0, 110),
  );
  // ---------------------------------------------------------------- Q4：反向对照（防空转）
  //
  // **判据只能按「回包文本里有没有那个标记」判，不能按 `count` 判** —— 这是本探针实测到的
  // 陷阱：`memory_recall` 是**语义混合检索**，「从未写入的标记」照样会返回若干条**相关**记忆
  // （`count` = 返回条数，不是精确命中数）⇒ 写成 `count:0` 会**必然假失败**；反过来，
  // 库里多一条记忆时 `count:1` 会变 `count:2` ⇒ 按 `count` 写的断言也会**假失败**。
  const recalledNever = await recall(b.client, markerNever);
  assert(
    'Q4',
    !recalledNever.includes(markerNever) && recalledB.includes(markerA),
    '**反向对照**：从未写入的标记**不出现在**回包里，而已写入的标记在 ⇒ 「按标记判」既准又稳',
    recalledNever.slice(0, 90),
  );
  // ---------------------------------------------------------------- Q2：库文件确实存在
  const landed = dexec(`test -f ${DB} && echo yes || echo no`).trim() === 'yes';
  assert('Q2', landed, '库文件在容器内该用户目录（同一用户两会话共用它）', DB);

  // ---------------------------------------------------------------- Q3：不优雅收尾也成立吗
  await closeGraceful(b);
  const markerC = `CHAIN-C-${stamp}`;
  const c = await openSession(apiKey, endpoint);
  await c.client.callTool({
    name: 'memory_store',
    arguments: { title: `3.14 写入 ${markerC}`, content: `${markerC} 写入后**不** terminate，直接 close` },
  });
  // 不调 terminateSession：模拟客户端侧直接断（服务端只看到传输关闭）。
  await c.client.close();
  await new Promise((r) => setTimeout(r, 1500));

  const d = await openSession(apiKey, endpoint);
  const recalledC = await recall(d.client, markerC);
  assert(
    'Q3',
    recalledC.includes(markerC),
    '**不优雅收尾**（直接 `close()`）后，新会话**仍能**召回 ⇒ 判决据**不**依赖「先 terminate」',
    recalledC.slice(0, 100),
  );
  await closeGraceful(d);

  // ---------------------------------------------------------------- 收尾
  const leftover = dexec(
    `n=0; for f in /proc/[0-9]*/cmdline; do c=$(tr '\\0' ' ' < "$f" 2>/dev/null); ` +
      `case "$c" in "${BIN} mcp --tier smart --profile core"*) n=$((n+1));; esac; done; echo "$n"`,
  ).trim();
  assert('Q5', leftover === '0', '四个会话全部收尾后容器内无同形进程', `实得 ${leftover}`);

  dexecRoot(`rm -rf /data/users/${HANDLE}`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n  通过 ${results.length - failed.length} 项 · 失败 ${failed.length} 项`);
  return failed.length === 0 ? 0 : 30;
}

process.exitCode = await main();
