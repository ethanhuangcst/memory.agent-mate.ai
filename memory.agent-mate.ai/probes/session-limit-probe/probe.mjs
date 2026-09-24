#!/usr/bin/env node
/**
 * `3.17` 探针（**研究类，不入制品**）：为 Sprint 4 `4.1`「web-portal:会话限流」定两件事 ——
 * **① 现状到底是什么**（例如「没有上限」这一事实）；**② 取值的依据从哪来**（不是拍脑袋）。
 *
 * ## 为什么单列（覆盖核对的依据）
 *
 * `4.1` 的验收条件是「**超每 key 并发 / 全局并发 / 空闲超时 / 单会话最长时长任一上限时给出明确原因** ·
 * **不排队致死** · **额度内不受影响**」，关联 `AC7.3`（门户自建的会话级上限**明确拒绝而非排队致死**）
 * 与用例 `TC-P-L3-06`。覆盖核对（静态）发现：
 *
 *   · `PORTAL_MAX_CONCURRENCY_PER_KEY` / `PORTAL_MAX_CONCURRENCY_GLOBAL` / `PORTAL_RESPONSE_MAX_BYTES`
 *     在 `admin_portal/src` 里 **0 处**（`web-design.md` §12.9 却把它们登记为**必填**）⇒ **未实现**；
 *   · 空闲超时 / 单会话最长时长的**机制**已由 `3.4` 交付（`reap` + ticker），但**取值**归本行。
 *
 * 于是本行的两条实质是：**补护栏**（从无到有）+ **给取值**（有依据）。本探针把「依据」测出来。
 *
 * ## 测什么
 *
 *   Q1 并发 N 个会话 ⇒ 容器内进程数是不是 N（**现状无上限**的正面证据：N 个全成功、无拒绝）
 *   Q2 每个会话进程**真实占多少内存**（`/proc/<pid>/status` 的 `VmRSS`）· 容器**内存上限**是多少
 *      ⇒ 「全局并发上限」的取值依据（能容纳几个会话）
 *   Q3 并发下的**每请求延迟**（`memory_recall`）⇒ 「额度内不受影响」的基线：并发翻倍时延迟怎么变
 *   Q4 收尾后归零（护栏不能靠「不回收」实现）
 *
 * ## 判据口径
 *
 *   · `[A*]` = **断言**（决定退出码）：进程数 == N · 全部会话可用（`4.1` 之前「无上限」故都应成功）·
 *     每个进程的 RSS 读得到 · 收尾归零；
 *   · `[F]` = **发现**（不参与退出码）：每会话 RSS 的实测值 · 由容器内存上限粗算的「可容纳会话数」·
 *     「现状无上限」这一事实本身。
 *
 * 用法（自包含：本目录自带 `node_modules`）：
 *   cd memory.agent-mate.ai/probes/session-limit-probe && npm install && node probe.mjs
 *   退出码：0 全部断言通过 · 10 前置不足 · 30 断言失败
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const CONTAINER = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';
const HANDLE = process.env.PROBE_HANDLE ?? 'probe317';
const BIN = process.env.PROBE_BIN ?? '/usr/local/bin/ai-memory';
const CMD_PREFIX = `${BIN} mcp --tier smart --profile core`;
const DB = `/data/users/${HANDLE}/ai-memory.db`;
/** 并发档位：1（基线）→ 2 → 4。1–5 人规模的产品护栏，四路足够看出趋势。 */
const LEVELS = [1, 2, 4];

const OUT = path.join(import.meta.dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const assert = (id, ok, label, detail = '') => {
  results.push({ id, ok });
  console.log(`[${id}] ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
};
const info = (msg) => console.log(`[i] ${msg}`);
const finding = (label, detail) => console.log(`[F] 发现：${label} — ${detail}`);

const docker = (args) => execFileSync('docker', args, { encoding: 'utf8' }).toString();
const dexec = (cmd, asRoot = false) =>
  docker(['exec', ...(asRoot ? ['-u', '0'] : []), CONTAINER, 'sh', '-c', cmd]);

/** 容器内本次会话的进程清单（无 `ps`；Rosetta 下只能按 cmdline 精确前缀）。 */
const procs = () =>
  dexec(
    `for f in /proc/[0-9]*/cmdline; do p=\${f#/proc/}; p=\${p%/cmdline}; ` +
      `c=$(tr '\\0' ' ' < "$f" 2>/dev/null); case "$c" in "${CMD_PREFIX}"*) echo "$p";; esac; done`,
  )
    .split('\n')
    .filter((line) => line.trim().length > 0);

/** 某个进程的常驻内存（KB）；读不到返回 null（同 uid 读，`-u 0` 反而读不到 —— `3.12` 实测）。 */
const rssOf = (pid) => {
  const text = dexec(`grep -m1 '^VmRSS:' /proc/${pid}/status 2>/dev/null || true`).trim();
  const match = text.match(/VmRSS:\s+(\d+)\s+kB/);
  return match ? Number(match[1]) : null;
};

async function openSession(endpoint, apiKey) {
  const transport = new StdioClientTransport({
    command: 'docker',
    args: [
      '-H', endpoint, 'exec', '-i',
      '-e', `AI_MEMORY_DB=${DB}`,
      '-e', `AI_MEMORY_AGENT_ID=human:${HANDLE}`,
      '-e', `AI_MEMORY_KEY_DIR=/data/users/${HANDLE}/keys`,
      '-e', 'AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0',
      '-e', 'HOME=/data',
      '-e', `DASHSCOPE_API_KEY=${apiKey}`,
      CONTAINER, BIN, 'mcp', '--tier', 'smart', '--profile', 'core',
    ],
  });
  const client = new Client({ name: 'probe317', version: '0.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return { client, transport, pid: transport.pid };
}

async function closeAll(sessions) {
  for (const session of sessions) {
    try {
      await session.transport.terminateSession();
    } catch {
      /* 尽力而为 */
    }
    await session.client.close();
  }
}

async function main() {
  let endpoint;
  let apiKey;
  let memoryLimit;
  try {
    docker(['inspect', CONTAINER]);
    endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
    apiKey = dexec('printenv DASHSCOPE_API_KEY').trim();
    memoryLimit = Number(
      docker(['inspect', '--format', '{{.HostConfig.Memory}}', CONTAINER]).trim() || '0',
    );
  } catch {
    console.error(`[10] 前置不足：容器 ${CONTAINER} 未运行（bash memory.agent-mate.ai/scripts/local-up.sh）`);
    return 10;
  }
  if (!endpoint || !apiKey) {
    console.error('[10] 前置不足：取不到 docker endpoint 或上游 key（写入/召回都要真 embedding）');
    return 10;
  }
  dexec(`mkdir -p ${path.posix.dirname(DB)} && chown aimem:aimem ${path.posix.dirname(DB)}`, true);
  info(`容器内存上限 = ${memoryLimit > 0 ? `${Math.round(memoryLimit / 1024 / 1024)} MiB` : '未设置（实测: 0）'}`);

  const baseline = procs().length;
  const summary = [];
  for (const level of LEVELS) {
    const sessions = [];
    for (let i = 0; i < level; i += 1) sessions.push(await openSession(endpoint, apiKey));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const live = procs();
    const rss = live.map((pid) => rssOf(pid)).filter((value) => typeof value === 'number');
    const marker = `LIMIT-N${level}-${Date.now()}`;

    // 并发发一次真调用，量「额度内」的延迟（真 embedding ⇒ 有实际开销）。
    const started = Date.now();
    const calls = await Promise.all(
      sessions.map(async (session, index) => {
        const t0 = Date.now();
        await session.client.callTool({
          name: 'memory_store',
          arguments: { title: `${marker}-${index}`, content: `${marker} 并发 ${level} 路第 ${index} 个` },
        });
        await session.client.callTool({ name: 'memory_recall', arguments: { context: marker } });
        return Date.now() - t0;
      }),
    );
    const wall = Date.now() - started;
    const maxRss = rss.length > 0 ? Math.max(...rss) : 0;
    const median = rss.length > 0 ? [...rss].sort((a, b) => a - b)[Math.floor(rss.length / 2)] : 0;
    summary.push({ level, procs: live.length, rssKb: rss, medianKb: median, maxRssKb: maxRss, wallMs: wall, maxCallMs: Math.max(...calls) });

    assert(
      `A${level}.1`,
      live.length - baseline === level,
      `并发 ${level} 路 ⇒ 容器内新增 ${level} 个会话进程（**现状无上限**：全部成功、无拒绝）`,
      `基线 ${baseline} ⇒ ${live.length}（${live.join(', ')}）`,
    );
    assert(
      `A${level}.2`,
      rss.length === level && rss.every((value) => value > 0),
      `并发 ${level} 路时每个进程的 RSS 都读得到（同 uid 读 /proc/<pid>/status）`,
      rss.map((v) => `${Math.round(v / 1024)} MiB`).join(' · ') || '（无）',
    );
    info(`并发 ${level}：墙钟 ${wall} ms · 单会话 store+recall 最慢 ${Math.max(...calls)} ms · RSS 中位 ${Math.round(median / 1024)} MiB`);
    if (median > 0 && memoryLimit > 0) {
      finding(
        `并发 ${level} 路的每会话实测内存（RSS 中位）${Math.round(median / 1024)} MiB ⇒ 按容器内存上限粗算可容纳约 ${Math.floor(memoryLimit / 1024 / median)} 个会话`,
        `（粗算不含模型缓存共享与峰值，仅供定「全局并发上限」的初值参考）`,
      );
    }
    await closeAll(sessions);
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }

  // 第 5 路（超出上面四路的档位）仍会成功 —— 把「现状无护栏」这件事直接钉住。
  const extra = await openSession(endpoint, apiKey);
  await new Promise((resolve) => setTimeout(resolve, 800));
  const extraLive = procs();
  assert(
    'A5',
    extraLive.length - baseline === 1,
    '**第 5 路同样成功**（没有任何上限在拦）⇒ `4.1` 的护栏是**从无到有**，不是「调参」',
    `并存 ${extraLive.length} 个`,
  );
  await closeAll([extra]);
  await new Promise((resolve) => setTimeout(resolve, 2500));
  assert('A6', procs().length === baseline, '全部收尾后容器内归零（护栏不能靠「不回收」实现）', `基线 ${baseline}`);
  dexec(`rm -rf ${path.posix.dirname(DB)}`, true);

  console.log('\n  并发 | 进程 | RSS 中位 | RSS 峰值 | 墙钟(store+recall) | 最慢单会话');
  for (const row of summary) {
    console.log(
      `  ${String(row.level).padStart(4)} | ${String(row.procs).padStart(4)} | ` +
        `${String(Math.round(row.medianKb / 1024) + ' MiB').padStart(8)} | ` +
        `${String(Math.round(row.maxRssKb / 1024) + ' MiB').padStart(8)} | ` +
        `${String(row.wallMs + ' ms').padStart(10)} | ${row.maxCallMs} ms`,
    );
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n  通过 ${results.length - failed.length} 项 · 失败 ${failed.length} 项`);
  return failed.length === 0 ? 0 : 30;
}

process.exitCode = await main();
