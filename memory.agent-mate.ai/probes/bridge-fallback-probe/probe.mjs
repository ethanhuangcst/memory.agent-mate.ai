#!/usr/bin/env node
/**
 * Sprint 4 `3.10`「mcp:桥透传与错误传播探针」—— 产物可丢弃，只回答一个可证伪问题：
 *
 *   桥装上 `fallbackRequestHandler` + `fallbackNotificationHandler` 后，能否把**未显式注册的请求**
 *   与**通知**原样交给上游，并让**结果与错误都保持上游的形状**（而不是由桥/SDK 合成）？
 *
 * 拓扑（本机模拟门户，两组并排对照，共享同一个上游）：
 *
 *   [探针客户端 A] --HTTP /mcp-a--> [Server A：**不装** fallback] --+
 *                                                                +--stdio--> [fake-upstream.mjs]
 *   [探针客户端 B] --HTTP /mcp-b--> [Server B：**装** fallback]   --+
 *
 * 为什么两组并排：单组跑「未注册方法能转发」不足以证明是 fallback 的功劳 ——
 * 可能是 SDK 恰好支持。A 组给出**反证**（同环境下未注册方法必须回 SDK 合成的 `Method not found`）。
 *
 * 为什么上游用假上游而不是 `docker exec ai-memory`：本探针要证的是**桥的转发语义**，需要精确控制
 * 「上游支持哪些方法 / 返回什么形状 / 错误文案是什么」。真上游那一半（连得上、能双向转发）已由
 * `3.5` 的 `probes/mcp-bridge-probe/` 证过，两者互补不重叠。
 *
 * 退出码契约（与仓内 `probes/` / `scripts/*-probe.sh` 同范式）：
 *   0  四项断言全过
 *   10 HTTP 服务起不来 / 上游连接失败
 *   20 断言 1 失败（未注册的请求未被转发到上游）
 *   25 断言 2 失败（反证不成立：A 组也拿到了上游结果 ⇒ 本探针结论无效）
 *   30 断言 3 失败（错误来源不是上游，或上游错误码未被保留）
 *   40 断言 4 失败（通知未被转发）
 *
 * 用法：
 *   cd memory.agent-mate.ai/probes/bridge-fallback-probe
 *   npm install && node probe.mjs          # 默认端口 8801
 *   PROBE_PORT=8802 node probe.mjs
 *
 * 原始输出落 `out/probe-<ts>.log`（本探针的证据），关键结论回写
 * `../../specs/mcp/mcp-design.md` §5.6.2 与 `../../specs/web-portal/web-design.md` §12.5。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CancelledNotificationSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const PORT = Number(process.env.PROBE_PORT ?? 8801);
const FAKE_UPSTREAM = path.resolve(import.meta.dirname, 'fake-upstream.mjs');

const OUT_DIR = path.resolve(import.meta.dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG = path.join(OUT_DIR, `probe-${STAMP}.log`);
const NOTIFY_FILE = path.join(OUT_DIR, `notifications-${STAMP}.log`);
fs.writeFileSync(NOTIFY_FILE, ''); // 观测点前置清空

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

// ------------------------------------------------------------------ 0. 前置

log('=== 3.10 探针：未注册方法与通知的透传 + 错误传播 ===');
log(`[i] SDK        : @modelcontextprotocol/sdk ${JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'node_modules/@modelcontextprotocol/sdk/package.json'), 'utf8')).version}`);
log(`[i] zod        : ${JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'node_modules/zod/package.json'), 'utf8')).version}`);
log(`[i] node       : ${process.version}`);
log(`[i] 假上游     : ${FAKE_UPSTREAM}`);
log(`[i] 通知留痕   : ${NOTIFY_FILE}`);

// --------------------------------------------------- 1. 上游：stdio client

log('\n--- 1. 连接假上游（stdio client transport → node fake-upstream.mjs）---');
// **能力声明不是可选项**：`Client.notification()` 会走 `assertNotificationCapability`，
// 对 `notifications/roots/list_changed` 要求 `capabilities.roots.listChanged`，
// 否则抛错 —— 而该错会被 `_onnotification` 的 `.catch(...)` 交给 `onerror` **静默吞掉**
//（首轮实测：桥收到了通知、转发却无声失败）。这条对实现同样成立：桥的上游 client
// 必须声明「它打算转发的通知」所需的能力，否则转不动且看不见。
const upstream = new Client(
  { name: 'probe-bridge', version: '0.0.0' },
  { capabilities: { roots: { listChanged: true } } },
);
// 让被吞掉的错误显形（上面那条踩坑就是靠这个定位的）。
upstream.onerror = (e) => log(`[!] 上游 client onerror：${e.message}`);
const stdio = new StdioClientTransport({
  // 用 process.execPath 而非 'node'：StdioClientTransport 显式传 env 时**完全替换**环境，
  // 不合并 process.env ⇒ PATH 不保证在，靠 PATH 解析命令会踩空（实测口径）。
  command: process.execPath,
  args: [FAKE_UPSTREAM],
  env: { FAKE_UPSTREAM_NOTIFY_FILE: NOTIFY_FILE },
  stderr: 'pipe',
});
let upstreamStderr = '';
stdio.stderr?.on('data', (b) => {
  upstreamStderr += b.toString();
});
try {
  await upstream.connect(stdio);
} catch (e) {
  fail(10, `假上游连接失败：${e.message}`);
}
log('[OK] 假上游已连接');

// ------------------------------------------- 2. 两组 Server（对照）+ 桥

log('\n--- 2. 起两组 Server：A（不装 fallback，反证）· B（装 fallback，被测）---');

/**
 * A 组（反证组）：把两个 fallback 按**类型定义**的方式传成**构造参数**。
 *
 * 类型上完全合法 —— `ServerOptions = ProtocolOptions & {…}`，而 `ProtocolOptions` 声明了这两个字段。
 * **实测：两个都不会生效**。根因在 `shared/protocol.js:14`：
 *
 *     constructor(_options) { this._options = _options; … }
 *
 * 构造函数只把 options 存进 `_options`，**从不**把两个 fallback 提升为实例属性；
 * 而 `_onrequest` / `_onnotification` 读的是 `this.fallbackRequestHandler` / `this.fallbackNotificationHandler`
 * ⇒ 恒为 `undefined` ⇒ 请求侧合成 `Method not found`、通知侧**静默 `return`**（连错误都不报）。
 *
 * ⇒ 对 `3.8` 的实现约束：**必须构造后赋值实例属性**，照类型提示写会静默失效。
 */
const serverA = new Server(
  { name: 'probe-gateway-options-only', version: '0.0.0' },
  {
    capabilities: { tools: {} },
    fallbackRequestHandler: async (request) => upstream.request(request, z.unknown()),
    fallbackNotificationHandler: async (notification) => upstream.notification(notification),
  },
);
serverA.setRequestHandler(ListToolsRequestSchema, async (req) => upstream.listTools(req.params));

/** B 组：在 A 的基础上装两个 fallback —— 本探针的被测对象。 */
const serverB = new Server(
  { name: 'probe-gateway-with-fallback', version: '0.0.0' },
  { capabilities: { tools: {}, resources: {} } },
);
serverB.setRequestHandler(ListToolsRequestSchema, async (req) => upstream.listTools(req.params));
// 桥的全部职责：把 HTTP 侧收到的请求**原样**交给上游，不解析语义、不校验形状。
// 关键：`Protocol.request` 的 schema 形参是 `AnySchema`（不是 `AnyObjectSchema`）
// ⇒ `z.unknown()` 可用，等于「不校验上游结果的形状」（这正是「原样转发」在类型上的表达）。
serverB.fallbackRequestHandler = async (request) => upstream.request(request, z.unknown());
// 通知同理：未注册的通知原样转给上游（取消通知不转发 ⇒ 客户端取消形同无效）。
// 观测点（诊断用）：打印「桥是否收到通知」，用于把「客户端没发」与「桥没转」分开。
serverB.fallbackNotificationHandler = async (notification) => {
  log(`[i] 桥 B 收到通知：${notification.method} · params=${JSON.stringify(notification.params)}`);
  await upstream.notification(notification);
};

const transportA = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
const transportB = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
await serverA.connect(transportA);
await serverB.connect(transportB);

const httpServer = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const target = url.pathname === '/mcp-b' ? transportB : transportA;
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', async () => {
    let parsed;
    try {
      parsed = body ? JSON.parse(body) : undefined;
    } catch {
      parsed = undefined;
    }
    try {
      await target.handleRequest(req, res, parsed);
    } catch (e) {
      log(`[!] handleRequest 抛错（${req.method} ${url.pathname}）：${e.message}`);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'probe_bridge_error', detail: e.message }));
    }
  });
});
try {
  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(PORT, '127.0.0.1', resolve);
  });
} catch (e) {
  fail(10, `HTTP 服务起不来：${e.message}`);
}
log(`[OK] 已监听 http://127.0.0.1:${PORT}/mcp-a（无 fallback） · /mcp-b（有 fallback）`);

// ------------------------------------------------ 3. 两个客户端

// 与 clientB 声明**一致**的能力：反证组若发不出通知，「A 组通知未到达」就不能归因于 fallback 写法。
const clientA = new Client(
  { name: 'probe-client-a', version: '0.0.0' },
  { capabilities: { roots: { listChanged: true } } },
);
// clientB 声明 roots.listChanged：`notifications/roots/list_changed` 是「服务端无内置 handler」的
// 标准通知，用作「fallback 通道本身是否可用」的探针信号（发送侧要求声明该能力）。
const clientB = new Client(
  { name: 'probe-client-b', version: '0.0.0' },
  { capabilities: { roots: { listChanged: true } } },
);
try {
  await clientA.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp-a`)));
  await clientB.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp-b`)));
} catch (e) {
  fail(10, `客户端握手失败：${e.message}`);
}
log('[OK] 两个客户端均已握手');

/** 抓一次调用的结果或错误（探针自带，避免依赖具体 method 的 schema）。 */
const attempt = async (client, request) => {
  try {
    return { ok: true, result: await client.request(request, z.unknown()) };
  } catch (e) {
    return { ok: false, code: e.code, message: e.message };
  }
};

// -------------------------------------------------- 4. 四项断言

// 断言 1：B 组调「上游支持但桥未注册」的方法 ⇒ 应拿到上游的**原样结果**（含非标准形状）
log('\n--- 断言 1：未注册的 `resources/list` 经 fallback 转发到上游 ---');
const r1 = await attempt(clientB, { method: 'resources/list', params: {} });
log(`[i] B 组应答：${JSON.stringify(r1)}`);
const forwarded = r1.ok && r1.result?._upstream === 'fake-upstream';
log(`[断言 1] 结果来自上游：${forwarded ? 'PASS' : 'FAIL'}（标记字段 _upstream=${r1.ok ? r1.result?._upstream : '（无，收到错误）'}）`);
const looseShape = r1.ok && r1.result?.resources === 'NOT-AN-STANDARD-SHAPE';
log(`[i] 宽松 schema 边界：非标准形状穿过 = ${looseShape ? '是（不校验）' : '否（被拦下或未到达）'}`);
if (!forwarded) fail(20, '未注册方法未被转发到上游（fallback 未生效）');

// 断言 2：A 组同一调用 ⇒ **反证**：必须回 SDK 合成的 `Method not found`
log('\n--- 断言 2（反证）：同一调用打到 A 组 —— 它名义上「装了 fallback」，只是用构造参数传的 ---');
const r2 = await attempt(clientA, { method: 'resources/list', params: {} });
log(`[i] A 组应答：${JSON.stringify(r2)}`);
const synthesized = !r2.ok && r2.code === -32601 && /Method not found/i.test(String(r2.message));
log(`[断言 2] A 组仍被 SDK 合成 Method not found ⇒ 两件事同时成立：${synthesized ? 'PASS' : 'FAIL'}`);
log(`          · 差异确实来自 fallback（B 组拿到上游结果，A 组没有）；`);
log(`          · **构造参数形式的 fallbackRequestHandler 不生效** —— 类型定义允许，运行时被忽略。`);
if (!synthesized) fail(25, `A 组应答不符合预期（code=${r2.code} message=${r2.message}）⇒ 本探针的对照失效`);

// 断言 3：B 组调「上游不支持」的方法 ⇒ 错误应来自**上游**且 code 保留
log('\n--- 断言 3：上游的错误经 fallback 原样回到客户端（来源 + 错误码保留）---');
const r3 = await attempt(clientB, { method: 'completion/complete', params: { ref: { type: 'ref/prompt', name: 'x' }, argument: { name: 'a', value: 'b' } } });
log(`[i] B 组应答：${JSON.stringify(r3)}`);
// message 用**包含**判定而非相等：实测发现 SDK 客户端每把一次 error response 转成 McpError，
// 就加一层 `MCP error <code>: ` 前缀 ⇒ 跳数越多、前缀越多（本拓扑实测 3 层：假上游 1 + 桥 1 + 探针客户端 1）。
// 这是「原样透传」的真实边界：**code 是原样的，message 会被逐层加前缀**。
const fromUpstream = !r3.ok && String(r3.message).includes('FROM_FAKE_UPSTREAM');
const codeKept = !r3.ok && r3.code === -32601;
const prefixLayers = (String(r3.message).match(/MCP error -?\d+:/g) ?? []).length;
log(`[断言 3] 上游原文出现在 message 中（透传到位）：${fromUpstream ? 'PASS' : 'FAIL'}`);
log(`[断言 3] 上游错误码 -32601 被保留（客户端可据此分类）：${codeKept ? 'PASS' : 'FAIL'}`);
log(`[i] message 前缀层数：${prefixLayers} —— SDK 客户端每转换一次 error response 就加一层「MCP error <code>: 」`);
log(`        实现含义：code 已是原样、不必重建；要 message 也干净则必须在 fallback 里重建错误体。`);
if (!fromUpstream || !codeKept) {
  fail(30, `错误未按上游原样透传（message=${r3.message} code=${r3.code}）`);
}

// 断言 4：通知转发的**实际通道**（三组对照）
//   首轮实测发现的**结构性事实**：SDK 在 `Protocol` 的构造函数里就内置注册了两个通知 handler
//   （`shared/protocol.js:27` cancelled → `_oncancel` · `:30` progress → `_onprogress`）
//   ⇒ 它们**永远落不到** `fallbackNotificationHandler`。
//   所以「取消通知能否转给上游」不是 fallback 能不能用的问题，而要看**显式注册**能否覆盖内置。
log('\n--- 断言 4：通知转发的实际通道（内置消费 vs fallback vs 显式注册）---');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readSeen = () => fs.readFileSync(NOTIFY_FILE, 'utf8').trim();

// 4a：服务端无内置 handler 的标准通知 ⇒ 应经 fallback 到达上游（证明 fallback 通道本身可用）
try {
  await clientB.notification({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' });
} catch (e) {
  fail(40, `发送 roots/list_changed 失败：${e.message}`);
}
await sleep(400);
const sawRoots = readSeen().includes('roots/list_changed');
log(`[断言 4a] 无内置 handler 的通知经 fallback 到达上游：${sawRoots ? 'PASS' : 'FAIL'}`);

// 4b：`notifications/cancelled` ⇒ 被 SDK 内置消费（abort 本地 handler），fallback 收不到
try {
  await clientB.notification({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: 1, reason: 'VIA-FALLBACK-ONLY' },
  });
} catch (e) {
  fail(40, `发送 cancelled 失败：${e.message}`);
}
await sleep(400);
const sawCancelledViaFallback = readSeen().includes('VIA-FALLBACK-ONLY');
log(`[断言 4b] cancelled **不**经 fallback 到达（已被内置消费）：${sawCancelledViaFallback ? 'FAIL（竟到达）' : 'PASS'}`);

// 4c：显式注册 cancelled 的 handler ⇒ 覆盖内置 ⇒ 到达上游（这是实现「取消即时生效」的唯一写法）
// 让 Server 侧被吞掉的错误显形（`_onnotification` 的 catch 把 handler 异常交给 onerror）
serverB.onerror = (e) => log(`[!] 桥 B onerror：${e.message}`);
serverA.onerror = (e) => log(`[!] 桥 A onerror：${e.message}`);

serverB.setNotificationHandler(CancelledNotificationSchema, async (notification) => {
  log(`[i] 桥 B 的显式 cancelled handler 被调用（覆盖内置）：${JSON.stringify(notification.params)}`);
  await upstream.notification(notification);
});
try {
  await clientB.notification({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: 2, reason: 'VIA-EXPLICIT-HANDLER' },
  });
} catch (e) {
  fail(40, `发送 cancelled（显式注册后）失败：${e.message}`);
}
await sleep(400);
// 判据用**上游进程的 stdin 留痕**、而不是「上游是否落文件」：
// `cancelled` 在**每一跳**都被 SDK 内置消费（桥那一跳刚证过，上游那一跳同理）
// ⇒ 它会抵达进程，却不会被上游的 fallback 记录。用落文件判会得出假阴性。
const sawCancelledViaExplicit = upstreamStderr.includes('VIA-EXPLICIT-HANDLER');
log(`[断言 4c] 显式注册后 cancelled 抵达上游进程（按 stdin 留痕判）：${sawCancelledViaExplicit ? 'PASS' : 'FAIL'}`);
log(`          注意：它不会被上游的 fallback 记录 —— 上游的 SDK 同样内置消费 cancelled。`);

log(`[i] 上游收到的通知全量：\n${readSeen() || '（空）'}`);
log(`[i] 假上游 stderr（应出现 GOT-NOTIFICATION）:\n${upstreamStderr.trim() || '（空）'}`);
// 断言 5（反证）：A 组的通知 fallback 也是**构造参数** ⇒ 通知同样到不了上游
log('\n--- 断言 5（反证）：构造参数形式的 fallbackNotificationHandler ---');
const countRoots = () => readSeen().split('\n').filter((l) => l.includes('roots/list_changed')).length;
const before5 = countRoots();
try {
  await clientA.notification({ jsonrpc: '2.0', method: 'notifications/roots/list_changed' });
} catch (e) {
  fail(45, `发送 roots/list_changed（A 组）失败：${e.message}`);
}
await sleep(400);
const after5 = countRoots();
log(`[断言 5] A 组（构造参数）的通知到达上游的条数：${before5} → ${after5}（应**无变化**）`);
log(`          不变 = 构造参数形式的 fallbackNotificationHandler 不生效：${after5 === before5 ? 'PASS' : 'FAIL'}`);
if (after5 !== before5) {
  fail(45, '构造参数形式的 fallbackNotificationHandler 竟生效了 ⇒ 与结论不符，需重新判读');
}

if (!sawRoots || sawCancelledViaFallback || !sawCancelledViaExplicit) {
  fail(40, `通知通道结论不符合预期（roots=${sawRoots} viaFallback=${sawCancelledViaFallback} viaExplicit=${sawCancelledViaExplicit}）`);
}

// ------------------------------------------------------------- 5. 收尾与汇总

log('\n--- 5. 收尾 ---');
try {
  await clientA.close();
  await clientB.close();
  await transportA.close();
  await transportB.close();
  await serverA.close();
  await serverB.close();
  await httpServer.close();
  await upstream.close();
} catch (e) {
  log(`[!] 收尾时有异常（不判定为失败）：${e.message}`);
}

log('\n==== 汇总 ====');
log(`  断言 1 未注册请求转发到上游        : PASS`);
log(`  断言 2 反证：A 组（构造参数）仍被 SDK 合成 Method not found: PASS`);
log(`  断言 3 错误来源与错误码保留        : PASS`);
log(`  断言 4a 无内置 handler 的通知经 fallback 到达上游  : PASS`);
log(`  断言 4b cancelled 被 SDK 内置消费（fallback 收不到）: PASS`);
log(`  断言 4c 显式注册 cancelled 可覆盖内置并到达上游    : PASS`);
log(`  断言 5 反证：A 组（构造参数）的通知未到达上游: PASS`);
log(`  [i] 宽松 schema 非标准形状穿过     : ${looseShape ? '是' : '否（需在实现里换更宽的 schema 或去掉校验）'}`);
log(`  [i] 硬约束：两个 fallback **必须构造后赋值实例属性** —— 构造参数形式静默不生效`);
if (upstreamStderr.trim()) {
  log('\n[假上游 stderr 尾部 8 行]');
  log(upstreamStderr.split('\n').slice(-8).join('\n'));
}
log(`\n[i] 原始输出：${LOG}`);

fs.writeFileSync(LOG, raw.join('\n'));
process.exit(0);
