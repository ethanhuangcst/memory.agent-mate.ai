#!/usr/bin/env node
/**
 * Sprint 4 `3.5`「mcp:桥可行性探针」—— 产物可丢弃，只回答一个可证伪问题：
 *
 *   门户侧能否用官方 MCP SDK 的 Streamable HTTP server transport，
 *   把一次 MCP 请求经 stdio client transport 转发给**已启动的上游子进程**，
 *   并取回完整回包？（下限：initialize → tools/list → memory_store → memory_recall）
 *
 * 拓扑（本机模拟门户）：
 *
 *   [探针客户端 SDK] --HTTP(Streamable)--> [本进程: HTTP server + 桥] --stdio--> [docker exec 上游 mcp]
 *        StreamableHTTPClientTransport        StreamableHTTPServerTransport          StdioClientTransport
 *
 * 为什么 stdio 端走 `docker exec` 而不是直接 spawn 二进制：
 *   本机是 macOS，镜像内是 linux/amd64 二进制，**无法在宿主机执行**。
 *   「容器内 spawn 二进制」这一半已由 Sprint 2 的 β′ 探针单独证过
 *   （`../../specs/knowledge/web-portal/portal-launch-mechanism.md` E1–E7）；
 *   本探针只负责**协议桥那一半**，两者互补、不重叠。
 *
 * 退出码契约（与仓内 `scripts/*-probe.sh` 同范式）：
 *   0  双向往返跑通（四项断言全过）
 *   10 HTTP 服务起不来 / 上游连接失败
 *   20 initialize 或 tools/list 失败
 *   30 工具调用（memory_store / memory_recall）失败
 *   40 收尾失败（子进程未回收）
 *
 * 用法：
 *   node probe.mjs                    # 默认端口 8799、容器 ai-memory-mcp、库 /tmp/probe/ai-memory.db
 *   PROBE_PORT=8798 node probe.mjs
 *   PROBE_CONTAINER=xxx PROBE_HANDLE=mike node probe.mjs
 *
 * 原始输出落 `out/probe-<ts>.log`（本探针的结论证据），关键结论回写
 * `../../specs/mcp/mcp-design.md` §5.6.2。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PORT = Number(process.env.PROBE_PORT ?? 8799);
const CONTAINER = process.env.PROBE_CONTAINER ?? 'ai-memory-mcp';
const BIN = process.env.PROBE_BIN ?? '/usr/local/bin/ai-memory';
const HANDLE = process.env.PROBE_HANDLE ?? 'probe';
const DB_DIR = process.env.PROBE_DB_DIR ?? `/tmp/probe-${Date.now()}`; // 每次跑用新库：同库重跑会被上游近重复保护拦下（CONFLICT）
const DB = process.env.PROBE_DB ?? `${DB_DIR}/ai-memory.db`;
const MARKER = process.env.PROBE_MARKER ?? `PROBE-MARKER-${Date.now()}`;

const OUT_DIR = path.resolve(import.meta.dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });
const LOG = path.join(OUT_DIR, `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
const raw = [];
const log = (...a) => {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2))).join(' ');
  raw.push(line);
  console.log(line);
};
const fail = (code, msg) => {
  log(`\n[FAIL] ${msg}`);
  log(`[FAIL] 退出码 ${code}`);
  fs.writeFileSync(LOG, raw.join('\n'));
  log(`[i] 原始输出：${LOG}`);
  process.exit(code);
};

const t = () => Number(process.hrtime.bigint() / 1000n) / 1000; // ms
const marks = {};

// ---------------------------------------------------------------- 0. 前置

const stdioArgs = [
  'exec', '-i',
  '-e', `AI_MEMORY_DB=${DB}`,
  '-e', `AI_MEMORY_AGENT_ID=human:${HANDLE}`,
  '-e', 'HOME=/data',
  '-e', 'AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0',
  CONTAINER, BIN, 'mcp', '--tier', 'smart', '--profile', 'core',
];

log('=== 3.5 探针：HTTP(Streamable) ⇄ stdio 双向往返 ===');
log(`[i] SDK        : @modelcontextprotocol/sdk ${JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')).version}`);
log(`[i] node       : ${process.version}`);
log(`[i] stdio 端   : docker ${stdioArgs.join(' ')}`);
log(`[i] 探针标记   : ${MARKER}`);

const up = (await import('node:child_process')).execFileSync;
// 在容器内数「真进程」：以 /proc/<pid>/exe 指向的二进制为准。
// 不用 /proc/*/cmdline —— 它会把 `sh -c '...ai-memory...'` 这条检测命令自己也数进去（首跑实测基线 6 而非 2）。
const countUpstreamProcs = () => {
  try {
    // 两个坑都踩过了：
    // ① 容器是 debian-slim，**没有 ps**；
    // ② 本机跑的是 x86_64 镜像 + Rosetta ⇒ 所有 /proc/<pid>/exe 都指向 /mnt/lima-rosetta/rosetta，
    //    「按 exe 判二进制」不成立。
    // 因此按 **cmdline 精确前缀**判定，且必须带 `--profile core` —— 否则会把别处遗留的
    // `ai-memory mcp --tier smart`（无 profile）也算进来（本机实测确有 3 个这样的孤儿）。
    return up('docker', ['exec', CONTAINER, 'sh', '-c',
      `for f in /proc/[0-9]*/cmdline; do tr '\\0' ' ' < "$f" 2>/dev/null; echo; done | grep -c '^/usr/local/bin/ai-memory mcp --tier smart --profile core' || true`]).toString().trim();
  } catch { return '未知'; }
};
try {
  up('docker', ['exec', CONTAINER, 'mkdir', '-p', DB_DIR]);
  log(`[i] 已确保容器内目录存在：${DB_DIR}（上游不创建库文件的父目录 —— 预检时实测到的一次失败）`);
} catch (e) {
  fail(10, `无法在容器 ${CONTAINER} 内建目录：${e.message}`);
}

// --------------------------------------------------- 1. 上游：stdio client

log('\n--- 1. 连接上游（stdio client transport → docker exec）---');
const procsBefore = countUpstreamProcs();
log(`[i] 连接前容器内上游进程数（基线）：${procsBefore}`);
marks.upstreamBefore = t();
const upstream = new Client({ name: 'probe-bridge', version: '0.0.0' }, { capabilities: {} });
const stdio = new StdioClientTransport({ command: 'docker', args: stdioArgs, stderr: 'pipe' });
let upstreamStderr = '';
stdio.stderr?.on('data', (b) => { upstreamStderr += b.toString(); });
try {
  await upstream.connect(stdio);
} catch (e) {
  fail(10, `上游 stdio 连接失败：${e.message}`);
}
marks.upstreamAfter = t();
log(`[OK] 上游已连接（耗时 ${(marks.upstreamAfter - marks.upstreamBefore).toFixed(0)}ms）`);

// ------------------------------------------- 2. 门户侧：Streamable HTTP

log('\n--- 2. 起门户侧 HTTP server（Streamable HTTP server transport）+ 桥 ---');
const server = new Server(
  { name: 'probe-gateway', version: '0.0.0' },
  { capabilities: { tools: {} } },
);
// 桥的全部职责：把 HTTP 侧的请求原样转给上游 client。不解析语义、不缓存。
server.setRequestHandler(ListToolsRequestSchema, async (req) => upstream.listTools(req.params));
server.setRequestHandler(CallToolRequestSchema, async (req) => upstream.callTool(req.params));

const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
const httpServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    let parsed;
    try { parsed = body ? JSON.parse(body) : undefined; } catch { parsed = undefined; }
    try {
      await transport.handleRequest(req, res, parsed);
    } catch (e) {
      log(`[!] handleRequest 抛错（${req.method} ${req.url}）：${e.message}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bridge_error', detail: e.message }));
    }
  });
});
await server.connect(transport);
await new Promise((resolve, reject) => {
  httpServer.once('error', reject);
  httpServer.listen(PORT, '127.0.0.1', resolve);
});
log(`[OK] Streamable HTTP 已监听 http://127.0.0.1:${PORT}/mcp`);
log(`[i] 会话 id 生成：每会话一个（sessionIdGenerator）`);

// ------------------------------------------- 3. 客户端：走 HTTP 那一侧

log('\n--- 3. 客户端经 HTTP(Streamable) 连接（不是直连子进程）---');
const client = new Client({ name: 'probe-client', version: '0.0.0' }, { capabilities: {} });
const ctransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`));
marks.handshakeBefore = t();
try {
  await client.connect(ctransport);
} catch (e) {
  fail(20, `HTTP 侧握手失败：${e.message}`);
}
marks.handshakeAfter = t();
log(`[OK] initialize 完成（HTTP 握手 + 上游握手，耗时 ${(marks.handshakeAfter - marks.handshakeBefore).toFixed(0)}ms）`);
log(`[i] 会话 id（HTTP 层）：${ctransport.sessionId ?? '（未暴露）'}`);

// --------------------------------------------------------- 4. 四项断言

const result = { tools: 0, stored: false, recalled: false };

// 断言 1：tools/list 经桥返回上游工具
try {
  const tools = await client.listTools();
  result.tools = tools.tools.length;
  log(`\n[断言 1] tools/list 经桥可达 → ${result.tools} 个工具`);
  log(`         ${tools.tools.map((x) => x.name).join(', ')}`);
  if (result.tools !== 8) log(`[!] 期望 8（core 档），实得 ${result.tools}`);
  // 会话存续期采样：必须恰好 1 个 —— 否则「前 0 后 0」也可能意味着「根本没起过子进程」。
  marks.procsDuring = countUpstreamProcs();
  log(`[i] 会话存续期间容器内上游子进程数：${marks.procsDuring}（期望 1）`);
} catch (e) {
  fail(20, `tools/list 失败：${e.message}`);
}

// 断言 2：写入经桥落到上游库
try {
  const w = await client.callTool({
    name: 'memory_store',
    arguments: { title: `桥探针 ${MARKER}`, content: `${MARKER} 桥探针写入：HTTP(Streamable) → stdio → 上游库` },
  });
  result.stored = !w.isError;
  log(`\n[断言 2] memory_store 经桥成功 → isError=${w.isError}`);
  log(`         ${JSON.stringify(w.content).slice(0, 200)}`);
  if (w.isError) fail(30, 'memory_store 返回 isError');
} catch (e) {
  fail(30, `memory_store 失败：${e.message}`);
}

// 断言 3：召回经桥返回刚才写的内容（真回环）
try {
  const r = await client.callTool({
    name: 'memory_recall',
    arguments: { context: `${MARKER} 桥探针写入` },
  });
  const text = JSON.stringify(r.content ?? '');
  result.recalled = text.includes(MARKER);
  log(`\n[断言 3] memory_recall 经桥回读到刚写入的内容 → ${result.recalled ? '命中标记' : '未命中标记'}`);
  log(`         ${text.slice(0, 300)}`);
  if (!result.recalled) log('[!] 未命中标记：可能是召回通路（语义/关键词）或 embedding 未生效，需人工判读');
} catch (e) {
  fail(30, `memory_recall 失败：${e.message}`);
}

// 断言 4：会话断开 → 子进程回收（父死子死）
log('\n--- 4. 收尾：关闭会话并确认上游子进程回收 ---');
try {
  await client.close();
  await transport.close();
  await server.close();
  await httpServer.close();
  // **关键**：上游 stdio client 必须显式关闭，否则它 spawn 的 `docker exec` 与容器内子进程会残留
  //（首版漏了这一步，实测容器里留下了孤儿进程）。
  await upstream.close();
} catch (e) {
  log(`[!] 收尾时有异常（不判定为失败）：${e.message}`);
}
marks.closeAfter = t();
await new Promise((r) => setTimeout(r, 800));

const psOut = countUpstreamProcs();
log(`[断言 4] 上游子进程数 连接前 ${procsBefore} → 会话中 ${marks.procsDuring} → 收尾后 ${psOut}（期望 0 → 1 → 0：起得来、也收得干净）`);
const alive = String(procsBefore) === '0' && String(marks.procsDuring) === '1' && String(psOut) === '0';
if (!alive) log('[!] 仍有残留子进程 —— 会话回收需在 3.4 里落实');

// ------------------------------------------------------------------ 汇总

log('\n==== 汇总 ====');
log(`  断言 1 tools/list 经桥可达 : ${result.tools === 8 ? 'PASS' : `CHECK（${result.tools} 个）`}`);
log(`  断言 2 memory_store 经桥    : ${result.stored ? 'PASS' : 'FAIL'}`);
log(`  断言 3 memory_recall 回读   : ${result.recalled ? 'PASS' : 'CHECK'}`);
log(`  断言 4 子进程回收           : ${alive ? 'PASS' : 'CHECK'}`);
log(`  计时                        : 上游连接 ${(marks.upstreamAfter - marks.upstreamBefore).toFixed(0)}ms · HTTP 握手 ${(marks.handshakeAfter - marks.handshakeBefore).toFixed(0)}ms`);
log('\n[上游 stderr 尾部 12 行]');
log(upstreamStderr.split('\n').slice(-12).join('\n'));
log(`\n[i] 原始输出：${LOG}`);

fs.writeFileSync(LOG, raw.join('\n'));
process.exit(result.stored && result.tools === 8 ? 0 : 30);
