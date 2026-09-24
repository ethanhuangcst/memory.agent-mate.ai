/**
 * `3.18` 探针（**研究类，不入制品**）：为 `PORTAL_RESPONSE_MAX_BYTES`（`web-design.md` §12.9
 * 登记为「单响应上限（背压保护）」，`4.1` 如实降级为「**本轮未实现**」）测出**敞口量级**。
 *
 * ## 为什么必须实测
 *
 * §12.5 的设计承诺是「stdio 管道与 HTTP 流**按 stream 处理、不整包缓冲**；对超大响应设
 * **门户级上限**并**明确报错**」—— 「设上限」那一半**未实现** ⇒ 门户今天对响应体量**没有上限**。
 * 而「门户无上限」是否构成**真实敞口**，取决于**上游能产出多大的响应**：既有登记只说明
 * `[limits].max_page_size` 是 **HTTP 面专属**、stdio **不经过** ⇒ 上游在 stdio 面上**不兜底**
 * （`mcp-test.md` §4-D TC-LIMIT-02 已证）⇒ 供给侧量级只能实测。
 *
 * ## 前四版实测踩到的三个坑（决定了本版怎么写）
 *
 * ① **回包形态**：`memory_list` / `memory_recall` / `memory_search` 是**紧凑索引行**
 *   （`id|title|tier|namespace|priority|score|tags|agent_id`，**不含正文**）⇒ 判据对它们按**标题**判；
 *   正文只在 `memory_get`（单条）与 `memory_smart_load`（`memories[].content`）里出现。
 * ② **语义近重复会被拒写**：`CONFLICT: memory near-duplicates ...` —— 用同一段填充文本造数时，
 *   16 KiB 档被 4 KiB 档"吃掉"、40 条小记忆只剩 1 条（**探针自身的造数缺陷**，不是上游限制）。
 *   ⇒ 造数必须**语义互异**（本版用「主体 × 属性 × 动词」组合句，每条的语义都不同）。
 * ③ **输出必须同步落盘 + 调用要兜住断连**：会话断开时若 stdout 还压在管道缓冲里，**整轮日志会丢**；
 *   上游**子进程**退出（容器本身正常）时要不崩、记为证据、重开会话继续。
 *
 * ## 六个可证伪问题
 *
 *   Q1 8 个工具的**必填项与可量控参数**；全量 schema 落 `out/schemas.json`。
 *   Q2 **单条驱动（阶梯）**：语义互异的 4 / 16 / 32 KiB（`PROBE_LADDER`）逐档写入 —— 哪档被拒
 *      **或让会话断开**（⇒ 单条上限）、成功档的 `memory_get` 回包多大、是否**完整**。
 *   Q3 **条数驱动（索引类）**：N 条语义互异的小记忆（`PROBE_SMALL_N`）一次列出/检索，回包多大。
 *   Q4 **批量读（正文类）**：`memory_smart_load {intent, k}` 命中后回包**含正文** —— 这才是
 *      「多条 × 正文」的体量来源（`memory_load_family` 的 `family` 是**工具族**、不是用户数据）。
 *   Q5 **反向对照**：不存在的 id 取回 ⇒ 回包**不含**标记（证明 Q2 的「完整」不是空转）。
 *
 * ## 判据纪律
 *
 * 一律按「回包文本里有没有那个标题/标记」判，**禁止按 `count` 判**（`3.14` 实测陷阱）；
 * 每条断言都要能说出「什么条件下会失败」（`3.6` 复盘立的规则）。
 *
 * 用法（自包含：本目录自带 `node_modules`）：
 *   cd memory.agent-mate.ai/probes/response-size-probe
 *   npm install && node probe.mjs
 *   退出码：0 全部断言通过 · 10 前置不足 · 30 断言失败
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CONTAINER = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';
const HANDLE = process.env.PROBE_HANDLE ?? 'probe318';
const BIN = process.env.PROBE_BIN ?? '/usr/local/bin/ai-memory';
const DB = `/data/users/${HANDLE}/ai-memory.db`;
const LADDER = (process.env.PROBE_LADDER ?? '4,16,32')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);
const SMALL_N = Number(process.env.PROBE_SMALL_N ?? 40);

const OUT = path.join(import.meta.dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const CORE_TOOLS = [
  'memory_store',
  'memory_recall',
  'memory_list',
  'memory_get',
  'memory_search',
  'memory_load_family',
  'memory_smart_load',
];

/** 造数用词表：「主体 × 属性 × 动词」组合 ⇒ 每条记忆的**语义**都不同（躲开上游近重复拒写）。 */
const SUBJ = ['潮汐电站', '盐湖提锂', '榫卯结构', '乳酪熟成', '低轨卫星', '陶窑温度', '苔藓群落', '船闸调度', '蚕丝蛋白', '糖化酶'];
const OBJ = ['应力分布的迁移', '孔隙率的衰减曲线', '声学反射的相位差', '产率的边际收益', '裂纹扩展的门槛值', '热传导的滞后窗口'];
const VERB = ['在低温条件下呈现', '随季节变化影响', '与基底材料共同决定', '经长期观测显示', '在高湿环境中改变'];
/** 第 i 条独有的语义句（组合数 300 ⇒ 40 条互不重复）。 */
const sentence = (i) => `${SUBJ[i % 10]}的${OBJ[(i * 3) % 6]}会因${VERB[(i * 7) % 5]}而不同（观测号 ${i}）`;
/** 第 k 档阶梯的填充句（**各档不同主题** ⇒ 档与档之间也不会被判近重复）。 */
const fillerFor = (k) => `${SUBJ[(k * 3) % 10]}的${OBJ[(k * 5) % 6]}${VERB[(k * 2) % 5]}：`;

const results = [];
const sizes = [];
const sessionDeaths = [];
const out = (msg) => fs.writeSync(1, `${msg}\n`); // 同步落盘：崩溃时不丢日志
const assert = (id, ok, label, detail = '') => {
  results.push({ id, ok });
  out(`[${id}] ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const info = (msg) => out(`[i] ${msg}`);
const bytes = (s) => Buffer.byteLength(s, 'utf8');
const kib = (n) => `${(n / 1024).toFixed(1)} KiB`;
const textOf = (res) => JSON.stringify(res.content ?? '');
const payloadOf = (res) => (res.content ?? []).map((part) => part.text ?? '').join('');
const rnd = (n = 8) => crypto.randomBytes(16).toString('hex').slice(0, n);

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8' }).toString();
const dexec = (cmd) => docker(['exec', CONTAINER, 'sh', '-c', cmd]);
const dexecRoot = (cmd) => docker(['exec', '-u', '0', CONTAINER, 'sh', '-c', cmd]);

let session;
let apiKey;
let endpoint;

async function openSession() {
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
      '-e', `DASHSCOPE_API_KEY=${apiKey}`,
      CONTAINER, BIN, 'mcp', '--tier', 'smart', '--profile', 'core',
    ],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'probe318', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport, pid: transport.pid };
}

async function closeGraceful(target) {
  try {
    await target.transport.terminateSession();
  } catch {
    /* 尽力而为 */
  }
  await target.client.close();
}

/** 调用包装：会话断开（上游**子进程**退出，容器本身正常）时**不崩**，记为证据并重开会话。 */
async function call(request) {
  try {
    return await session.client.callTool(request);
  } catch (error) {
    const msg = String(error?.message ?? error);
    sessionDeaths.push(`${request.name} ${JSON.stringify(request.arguments).slice(0, 80)} ⇒ ${msg}`);
    info(`  ⚠ 会话在 \`${request.name}\` 上断开（${msg}）—— 记为证据，重开会话继续`);
    try {
      await closeGraceful(session);
    } catch {
      /* 已断开则忽略 */
    }
    session = await openSession();
    info(`  已重开会话 pid=${String(session.pid)}`);
    return { isError: true, content: [{ type: 'text', text: `SESSION CLOSED: ${msg}` }] };
  }
}

function idOf(res) {
  try {
    return JSON.parse(payloadOf(res)).id ?? '';
  } catch {
    return '';
  }
}

function record(label, note, res, hits = null) {
  const text = textOf(res);
  const payload = payloadOf(res);
  const hitCount = hits ? hits.filter((m) => payload.includes(m)).length : null;
  sizes.push({
    call: label,
    note,
    n: bytes(text),
    error: !!res.isError,
    hits: hitCount,
    total: hits?.length ?? null,
  });
  info(
    `  ${label}: isError=${String(!!res.isError)} · 回包 ${kib(bytes(text))}` +
      (hitCount === null ? '' : ` · 命中 ${hitCount}/${hits.length}`),
  );
  info(`    切片：${payload.slice(0, 200).replace(/\s+/g, ' ')}`);
  return { text, payload };
}

async function main() {
  try {
    docker(['inspect', CONTAINER]);
    endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
    apiKey = dexec('printenv DASHSCOPE_API_KEY').trim();
  } catch {
    console.error(`[10] 前置不足：容器 ${CONTAINER} 未运行（bash memory.agent-mate.ai/scripts/local-up.sh）`);
    return 10;
  }
  if (!endpoint || !apiKey) {
    console.error('[10] 前置不足：取不到 docker endpoint 或上游 key（写入要真 embedding）');
    return 10;
  }
  dexecRoot(`mkdir -p /data/users/${HANDLE} && chown aimem:aimem /data/users/${HANDLE}`);
  dexecRoot(`rm -f /data/users/${HANDLE}/ai-memory.db*`);

  session = await openSession();
  const run = rnd(6);
  info(`会话 pid=${String(session.pid)} · 库=${DB} · 阶梯 ${LADDER.join('/')} KiB · 索引类 ${SMALL_N} 条`);

  // ---------------------------------------------------------------- Q1：必填项与可量控参数
  const listed = await session.client.listTools();
  const names = listed.tools.map((tool) => tool.name);
  const missing = CORE_TOOLS.filter((name) => !names.includes(name));
  assert(
    'Q1a',
    missing.length === 0,
    `core 档含全部 7 个 core 工具（共 ${names.length} 个）`,
    missing.length ? `缺 ${missing.join(', ')}` : names.join(' '),
  );
  fs.writeFileSync(path.join(OUT, 'schemas.json'), JSON.stringify(listed.tools, null, 2));
  for (const tool of listed.tools) {
    const props = Object.keys(tool.inputSchema?.properties ?? {});
    const required = tool.inputSchema?.required ?? [];
    info(`  ${tool.name}: 必填 [${required.join(', ') || '无'}] · 参数 ${props.length}: ${props.join(' ')}`);
  }

  // ---------------------------------------------------------------- Q2：单条驱动（阶梯）
  const ladderMarkers = LADDER.map((sizeKib) => `RSZ-${sizeKib}K-${run}`);
  let ladderPassed = 0;
  for (const [index, sizeKib] of LADDER.entries()) {
    const marker = ladderMarkers[index];
    let body = `${marker} `;
    while (bytes(body) < sizeKib * 1024) body += sentence(index * 7 + 1);
    const stored = await call({
      name: 'memory_store',
      arguments: { title: `RSZ 阶梯 ${sizeKib} KiB ${run}`, content: body },
    });
    if (stored.isError) {
      const dead = payloadOf(stored).includes('SESSION CLOSED');
      info(
        `  ${sizeKib} KiB 档：${dead ? '**会话断开**（上游子进程退出 ⇒ 单条上限的直接证据）' : `**被拒**：${payloadOf(stored).slice(0, 120).replace(/\s+/g, ' ')}`}`,
      );
      continue;
    }
    const id = idOf(stored);
    const got = await call({ name: 'memory_get', arguments: { id } });
    const { text } = record(`memory_get（内容 ${sizeKib} KiB）`, `id=${id.slice(0, 8)}`, got, [marker]);
    const complete = !got.isError && text.includes(marker);
    if (complete) ladderPassed += 1;
    assert(
      `Q2·${sizeKib}K`,
      complete,
      `\`memory_get\` 回包**完整**含 ${sizeKib} KiB 档的标记（无截断、无报错）`,
      `回包 ${kib(bytes(text))}`,
    );
  }
  info(`  阶梯小结：${LADDER.length} 档中 ${ladderPassed} 档成功且回包完整`);

  // ---------------------------------------------------------------- Q3：条数驱动（索引类）
  const smallMarkers = Array.from({ length: SMALL_N }, (_, i) => `RSZ-S${i}-${run}`);
  const smallTitles = Array.from({ length: SMALL_N }, (_, i) => `RSZ 索引 ${i} ${run}`);
  let stored = 0;
  const storeErrors = [];
  for (let i = 0; i < SMALL_N; i += 1) {
    // **语义互异**：每条组合句不同 ⇒ 不会被上游按近重复拒写。
    const res = await call({
      name: 'memory_store',
      arguments: { title: smallTitles[i], content: `${smallMarkers[i]} ${sentence(i)}（流水 ${rnd(10)}）` },
    });
    if (res.isError) storeErrors.push(`#${i}: ${payloadOf(res).slice(0, 110).replace(/\s+/g, ' ')}`);
    else stored += 1;
  }
  // **不设硬断言**：上游对**语义近重复**内容会拒写（`CONFLICT: near-duplicates`）—— 这是**上游行为**，
  // 不是判据能控的量（v2/v4/v5 分别测到 13/39/24 条被拒，即使用「主体×属性×动词」组合句也一样）。
  // ⇒ 造数成功率只作**观察项**登记；下面「条数驱动」的断言按**实际写成功的条数**判（标题命中 > 0）。
  info(`  造数：${stored}/${SMALL_N} 条写入成功；被拒 ${storeErrors.length} 条（上游近重复门限）`);
  for (const err of storeErrors.slice(0, 2)) info(`  写入失败样本 ${err}`);

  for (const args of [{}, { limit: SMALL_N }, { limit: 1000 }]) {
    const res = await call({ name: 'memory_list', arguments: args });
    record(`memory_list ${JSON.stringify(args)}`, '索引类（无正文）', res, smallTitles);
  }
  for (const [name, args] of [
    ['memory_recall', { context: `RSZ 索引 ${run}`, limit: SMALL_N }],
    ['memory_search', { query: `RSZ 索引 ${run}`, limit: SMALL_N }],
  ]) {
    const res = await call({ name, arguments: args });
    const { payload } = record(`${name} limit=${SMALL_N}`, '索引类（无正文）', res, smallTitles);
    assert(
      `Q3·${name}`,
      !res.isError && smallTitles.some((t) => payload.includes(t)),
      `\`${name}\` 回包含本库条目的**标题**（⇒ 判据非空转）`,
      `命中 ${smallTitles.filter((t) => payload.includes(t)).length}/${SMALL_N}`,
    );
  }

  // ---------------------------------------------------------------- Q4：批量读（正文类）
  for (const [name, args, note] of [
    ['memory_smart_load', { intent: smallTitles[0], k: SMALL_N }, `intent=标题原文+k=${SMALL_N}`],
    ['memory_load_family', { family: 'lifecycle', k: SMALL_N }, 'family=lifecycle（**工具族**）'],
    ['memory_load_family', { family: `rsz-family-${run}` }, 'family=自造名（应被拒）'],
  ]) {
    const res = await call({ name, arguments: args });
    const { payload } = record(`${name} ${note}`, '批量读', res, smallMarkers);
    if (name === 'memory_smart_load') {
      // **不设硬断言**：本次造数下它回 `count:0`（`chosen_family` 由 embedder 选出、与所写条目的
      // tier/kind 不匹配）⇒ 「多条 × 正文」的体量**未能实测**，如实登记为**未测**，不猜。
      info(
        `  memory_smart_load 是否带回正文：${payload.includes('"content"') ? '是' : '否'}` +
          `（命中 ${smallMarkers.filter((m) => payload.includes(m)).length}/${SMALL_N}）`,
      );
    }
  }

  // ---------------------------------------------------------------- Q5：反向对照
  const ghost = await call({
    name: 'memory_get',
    arguments: { id: '00000000-0000-4000-8000-000000000000' },
  });
  const ghostText = textOf(ghost);
  assert(
    'Q5',
    !ghostText.includes(ladderMarkers[0]),
    '**反向对照**：不存在的 id 取回**不含**任何阶梯标记（Q2 的「完整」不是空转）',
    ghostText.slice(0, 60),
  );

  // ---------------------------------------------------------------- 汇总
  out('\n=== 单响应体量实测（按字节降序）===');
  for (const row of sizes.slice().sort((a, b) => b.n - a.n)) {
    out(
      `  ${kib(row.n).padStart(9)}  ${row.call.padEnd(40)}（${row.note}${row.error ? ' · isError' : ''}${
        row.hits === null ? '' : ` · 命中 ${row.hits}/${row.total}`
      }）`,
    );
  }
  const best = sizes.filter((row) => !row.error).sort((a, b) => b.n - a.n)[0];
  if (best) out(`  ⇒ 本次观测到的**最大成功单响应** = ${kib(best.n)}（${best.call}）`);
  if (sessionDeaths.length) {
    out(`  ⇒ 会话断开 ${sessionDeaths.length} 次（上游子进程退出）：`);
    for (const death of sessionDeaths) out(`      ${death}`);
  }

  await closeGraceful(session);
  dexecRoot(`rm -rf /data/users/${HANDLE}`);
  info('收尾：会话关闭、探针用户目录已清');

  const failed = results.filter((r) => !r.ok);
  out(`\n通过 ${results.length - failed.length} 项 · 失败 ${failed.length} 项`);
  return failed.length ? 30 : 0;
}

process.exit(await main());
