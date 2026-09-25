#!/usr/bin/env node
/**
 * Sprint 4 `3.9`「mcp:上游能力透传与超时分层」**开工前置探针** —— 产物可丢弃，只回答两个可证伪问题：
 *
 *   1. 把 `initialize` 回包的 `serverInfo` / `capabilities` / `instructions` 改成**取自上游**之后，
 *      桥还能不能维持 `3.8` 定下的「原样转发、门户语义知识 = 0」？会不会踩到 SDK 的
 *      **注册期能力断言**或**内置 handler 遮蔽**？
 *   2. 「握手超时」与「上游请求超时」能不能真正分层（两个值互不牵连）？
 *
 * 拓扑（**全进程内**）：
 *
 *   [探针客户端] --InMemory--> [桥 Server] --InMemory--> [假上游 Server]
 *                                   ↑ 记录器挂在「桥 → 上游」这一跳的 send 上
 *
 * **为什么用进程内传输而不是 HTTP + stdio**：本探针要证的是**装配层语义** —— 构造参数会不会被
 * 回吐、能力断言在**什么时点**触发、SDK 内置 handler 会不会遮蔽 fallback、两个 `timeout` 各管哪一段。
 * 这些与传输无关。传输层（`Streamable HTTP ⇄ stdio` 双向转发）已由 `3.5` 与 `3.10` 两个探针实证，
 * 再搭一遍只会把「HTTP 起不来 / 子进程连不上」这类**与本问题无关**的失败面引进来，降低结论可信度。
 *
 * **为什么上游是进程内假上游而不是 `docker exec ai-memory`**：本探针要**精确控制**上游声明的身份、
 * 能力（含 SDK 不认识的键）与工具耗时。真上游那一半（连得上、能双向转发、`memory_store` 往返）
 * 已由 `probes/mcp-bridge-probe/`（`3.5`）与 `scripts/probes/portal-mcp-probe.sh`（`3.1`）覆盖。
 *
 * 退出码契约（与仓内 `probes/` 同范式）：
 *   0   七项断言全过
 *   10  桥 / 上游起不来
 *   20  断言 1 失败（身份或指令未透传）
 *   25  断言 2 失败（能力归一化口径与预期不符）
 *   30  断言 3 失败（注册期能力断言未按预期触发）
 *   35  断言 4 失败（`logging/setLevel` 的本地吞并未复现，或拽回 fallback 后仍未转发）
 *   40  断言 5 失败（全 fallback 下 `tools/call` 往返失败）
 *   45  断言 6 失败（请求级超时未生效，或超时错误码未原样透传）
 *   50  断言 7 失败（两个超时未真正独立）
 *
 * 用法：
 *   cd memory.agent-mate.ai/probes/bridge-identity-probe
 *   npm install && node probe.mjs
 *
 * 原始输出落 `out/probe-<ts>.log`（本探针的证据），关键结论回写
 * `../../specs/mcp/mcp-design.md` §5.6.2 与 `../../specs/web-portal/web-design.md` §12.5。
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const OUT_DIR = path.resolve(import.meta.dirname, 'out');
fs.mkdirSync(OUT_DIR, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOG = path.join(OUT_DIR, `probe-${STAMP}.log`);

const raw = [];
const log = (...a) => {
  const line = a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
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
/** 单条断言：失败即按契约退出（「验证器自己会骗你」—— 断言要带**实得值**，不能只说结论）。 */
const assert = (n, ok, detail, code) => {
  log(`[断言 ${n}] ${ok ? 'PASS' : 'FAIL'}  ${detail}`);
  if (!ok) fail(code, `断言 ${n} 未通过`);
};

const SDK_VERSION = JSON.parse(
  fs.readFileSync(
    path.resolve(import.meta.dirname, 'node_modules/@modelcontextprotocol/sdk/package.json'),
    'utf8',
  ),
).version;

log('=== 3.9 探针：上游身份 / 能力透传 + 超时分层 ===');
log(`[i] SDK  : @modelcontextprotocol/sdk ${SDK_VERSION}`);
log(`[i] node : ${process.version}`);

// ---------------------------------------------------------------- 0. 上游身份与能力

/**
 * 上游**声明的**身份。故意带上 `title` / `websiteUrl` / `description` 三个可选字段：
 * 透传若丢字段，客户端就无法据此判断镜像漂移。
 */
const UPSTREAM_INFO = {
  name: 'ai-memory-probe',
  version: '9.9.9',
  title: 'Probe Upstream',
  websiteUrl: 'https://probe.invalid',
  description: 'probe upstream（身份字段必须原样到达客户端）',
};
const UPSTREAM_INSTRUCTIONS = 'probe: instructions 必须原样到达客户端';

/**
 * 上游**声明的**能力。含两个「SDK 不认识的形状」：
 * - `experimental` 是 `ServerCapabilitiesSchema` 的已知键（`z.record(...)`）⇒ 预期**保留**；
 * - `vendor/custom` 不是任何已知键 ⇒ 预期被 schema **丢弃**（zod object 默认剥未知键）。
 * 这一对是本探针的核心：它决定「透传」这个词在契约里该怎么写。
 */
const UPSTREAM_CAPS = {
  tools: {},
  prompts: {},
  resources: { subscribe: false },
  logging: {},
  experimental: { 'probe/experimental': {} },
  'vendor/custom': {},
};

const SLOW_MS = 1500;
const SHORT_TIMEOUT_MS = 300;

// ---------------------------------------------------------------- 1. 假上游（进程内）

/**
 * 假上游：声明上面那套身份与能力，暴露两个工具 —— `probe_echo`（立即回）与 `probe_slow`（挂 `SLOW_MS`）。
 *
 * 工具结果**只回一个文本块**（不塞非标准字段）：非标准形状的穿透力已由 `3.10` 探针用
 * `resources/list` 证过，这里若再塞一次，反而会与客户端侧的结果 schema 解析混在一起，
 * 让「桥有没有改写」这个判据不再干净。
 */
async function startUpstream() {
  const server = new Server(UPSTREAM_INFO, {
    capabilities: UPSTREAM_CAPS,
    instructions: UPSTREAM_INSTRUCTIONS,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'probe_echo', description: '立即返回', inputSchema: { type: 'object', properties: {} } },
      {
        name: 'probe_slow',
        description: `挂 ${SLOW_MS}ms 后返回`,
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    if (req.params.name === 'probe_slow') {
      await new Promise((resolve) => setTimeout(resolve, SLOW_MS));
    }
    return { content: [{ type: 'text', text: 'UPSTREAM-RAW-PAYLOAD' }] };
  });
  return { server };
}

// ---------------------------------------------------------------- 2. 桥（可选装法）

/**
 * 起一座桥，装法按参数切换。
 *
 * **身份与能力全部取自上游**（`Client.getServerVersion()` / `getServerCapabilities()` /
 * `getInstructions()`）—— 这三个取值点在上游 client 连接完成后即可用，故**不需要**
 * `Server.registerCapabilities()`（后者在 transport 已连接时会抛错，是条时序死路）。
 *
 * @param pullSetLevel 是否把 SDK 为 `capabilities.logging` **自动注册**的 `logging/setLevel`
 *   handler 移除（移除后该请求落回 fallback ⇒ 才会被转发到上游）。`false` 即现状对照。
 * @param handshakeTimeoutMs 桥→上游**握手**超时（`client.connect`）。
 * @param requestTimeoutMs 桥→上游**每请求**超时（`request(..., { timeout })`）。
 */
async function makeBridge({ pullSetLevel, handshakeTimeoutMs, requestTimeoutMs }) {
  const upstream = await startUpstream();

  const [bridgeSide, upstreamSide] = InMemoryTransport.createLinkedPair();
  await upstream.server.connect(upstreamSide);

  const bridgeClient = new Client(
    { name: 'portal-bridge-probe', version: '0.0.0' },
    // 与产品代码一致：桥要替客户端转发那些通知，就得先声明对应能力（`3.8` / `3.10`）。
    { capabilities: { roots: { listChanged: true } } },
  );
  bridgeClient.onerror = (e) => log(`[!] 桥上游 client onerror：${e.message}`);

  // 观测点：记录「桥 → 上游」实际发出的消息（用来判「某个请求到底有没有被转发」）。
  const seenByUpstream = [];
  const origSend = bridgeSide.send.bind(bridgeSide);
  bridgeSide.send = (msg, opts) => {
    seenByUpstream.push(msg);
    return origSend(msg, opts);
  };

  try {
    await bridgeClient.connect(
      bridgeSide,
      handshakeTimeoutMs === undefined ? undefined : { timeout: handshakeTimeoutMs },
    );
  } catch (e) {
    fail(10, `桥→上游握手失败：${e.message}`);
  }
  seenByUpstream.length = 0; // 只关心握手之后的请求

  const serverInfo = bridgeClient.getServerVersion();
  const capabilities = bridgeClient.getServerCapabilities() ?? {};
  const instructions = bridgeClient.getInstructions();

  const server = new Server(serverInfo, {
    capabilities,
    ...(instructions === undefined ? {} : { instructions }),
  });

  if (pullSetLevel) server.removeRequestHandler('logging/setLevel');

  // `3.8` 定下的写法：**构造后赋值实例属性**（传构造参数会静默失效，见 `3.10` 探针）。
  server.fallbackRequestHandler = async (request) =>
    bridgeClient.request(request, z.unknown(), { timeout: requestTimeoutMs });

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);

  const outer = new Client({ name: 'probe-client', version: '0' }, { capabilities: {} });
  outer.onerror = (e) => log(`[!] 探针客户端 onerror：${e.message}`);
  await outer.connect(clientSide);

  return { outer, server, bridgeClient, seenByUpstream };
}

log('\n--- 1. 起两座桥：对照（不拽回 setLevel）· 被测（拽回 setLevel，请求超时 300ms）---');
const control = await makeBridge({ pullSetLevel: false, requestTimeoutMs: 30_000 });
const target = await makeBridge({
  pullSetLevel: true,
  requestTimeoutMs: SHORT_TIMEOUT_MS,
  handshakeTimeoutMs: 30_000,
});
log('[OK] 两座桥已就绪（身份与能力均取自上游）');

// ---------------------------------------------------------------- 断言 1：身份与指令透传

/**
 * 规范化比较：zod 解析会**重建**对象，键序可能变 ⇒ 用「键排序后的 JSON」判**字段与取值**，
 * 而不是判字符串。首版探针按字符串比，就因为这个假失败退了一次码 —— 判据必须比「语义」。
 */
const canon = (o) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    ),
  );

const gotInfo = target.outer.getServerVersion();
const gotInstructions = target.outer.getInstructions();
const infoSame = canon(gotInfo) === canon(UPSTREAM_INFO);
const orderKept = JSON.stringify(gotInfo) === JSON.stringify(UPSTREAM_INFO);
assert(
  1,
  infoSame && gotInstructions === UPSTREAM_INSTRUCTIONS,
  `serverInfo 字段与取值全部保留（键序${orderKept ? '也一致' : '**被 schema 解析重建**'}）· instructions 原样 —— 实得 ${JSON.stringify(gotInfo)} + ${JSON.stringify(gotInstructions)}`,
  20,
);

// ---------------------------------------------------------------- 断言 2：能力的归一化口径

const gotCaps = target.outer.getServerCapabilities() ?? {};
const knownKept = ['tools', 'prompts', 'resources', 'logging', 'experimental'].every(
  (k) => k in gotCaps,
);
const unknownDropped = !('vendor/custom' in gotCaps);
assert(
  2,
  knownKept && unknownDropped,
  `能力经 SDK schema 归一化后透传 —— 已知键 ${knownKept ? '保留' : '缺失'} · 未知键 ${unknownDropped ? '被丢弃' : '被保留'} · 实得 ${JSON.stringify(gotCaps)}`,
  25,
);

// ------------------------------------------- 断言 3：能力断言发生在**注册期**（硬约束）

let threwWhenMissing = null;
try {
  const s = new Server(UPSTREAM_INFO, { capabilities: { tools: {} } });
  s.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
} catch (e) {
  threwWhenMissing = e;
}
let threwWhenPresent = null;
try {
  const s = new Server(UPSTREAM_INFO, { capabilities: { tools: {}, prompts: {} } });
  s.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [] }));
} catch (e) {
  threwWhenPresent = e;
}
assert(
  3,
  threwWhenMissing !== null && threwWhenPresent === null,
  `能力断言在 setRequestHandler（**注册期**）而非请求分派期 —— 上游缺 prompts 时注册 prompts handler ${threwWhenMissing ? `抛错（${threwWhenMissing.message}）` : '未抛错'}；上游有 prompts 时 ${threwWhenPresent ? `仍抛错（${threwWhenPresent.message}）` : '不抛错'}`,
  30,
);

// ------------------------------------- 断言 4：capabilities.logging 的本地遮蔽与解法

await control.outer.request({ method: 'logging/setLevel', params: { level: 'debug' } }, z.unknown());
const controlSaw = control.seenByUpstream.some((m) => m.method === 'logging/setLevel');
await target.outer.request({ method: 'logging/setLevel', params: { level: 'debug' } }, z.unknown());
const targetSaw = target.seenByUpstream.some((m) => m.method === 'logging/setLevel');
assert(
  4,
  controlSaw === false && targetSaw === true,
  `capabilities.logging 会让 SDK 在**桥本地**吞掉 logging/setLevel —— 未拽回时上游${controlSaw ? '收到' : '收不到'}；removeRequestHandler('logging/setLevel') 之后上游${targetSaw ? '收到' : '收不到'}`,
  35,
);

// ------------------------------------------- 断言 5：全 fallback 下 tools/call 往返

const echo = await target.outer.callTool({ name: 'probe_echo', arguments: {} });
const echoText = echo.content?.[0]?.text;
assert(
  5,
  echoText === 'UPSTREAM-RAW-PAYLOAD',
  `不注册任何业务 handler、全走 fallback 时 tools/call 往返成功且结果逐字保留 —— 实得 ${JSON.stringify(echo.content)}`,
  40,
);

// ---------------------------------------------------------------- 断言 6：请求级超时

const t0 = Date.now();
let slowCode = null;
try {
  await target.outer.callTool({ name: 'probe_slow', arguments: {} });
} catch (e) {
  slowCode = e?.code ?? null;
}
const slowElapsed = Date.now() - t0;
assert(
  6,
  slowCode === ErrorCode.RequestTimeout && slowElapsed < SLOW_MS,
  `请求级超时（${SHORT_TIMEOUT_MS}ms）加在**上游请求**上生效 —— 耗时 ${slowElapsed}ms（上游需 ${SLOW_MS}ms）· 客户端收到 code=${slowCode}（期望 ${ErrorCode.RequestTimeout} = RequestTimeout）`,
  45,
);

// ---------------------------------------------------------------- 断言 7：两项超时独立

log('\n--- 2. 断言 7 用桥：握手超时 300ms、请求超时 5000ms（两个值故意反着设）---');
const independent = await makeBridge({
  pullSetLevel: true,
  handshakeTimeoutMs: SHORT_TIMEOUT_MS,
  requestTimeoutMs: 5_000,
});
const t1 = Date.now();
let longText = null;
try {
  const r = await independent.outer.callTool({ name: 'probe_slow', arguments: {} });
  longText = r.content?.[0]?.text;
} catch (e) {
  longText = `ERR:${e?.message ?? e}`;
}
const longElapsed = Date.now() - t1;
assert(
  7,
  longText === 'UPSTREAM-RAW-PAYLOAD' && longElapsed >= SLOW_MS,
  `握手超时（${SHORT_TIMEOUT_MS}ms）不参与请求路径 —— 同一桥上耗时 ${longElapsed}ms（> ${SLOW_MS}ms，远超握手超时）的调用成功，只有请求超时（5000ms）管这一段`,
  50,
);

// ---------------------------------------------------------------- 收尾

for (const b of [control, target, independent]) {
  try {
    await b.outer.close();
  } catch {
    /* 收尾尽力而为 */
  }
  try {
    await b.server.close();
  } catch {
    /* 同上 */
  }
  try {
    await b.bridgeClient.close();
  } catch {
    /* 同上 */
  }
}

log('\n[OK] 七项断言全过（退出码 0）');
fs.writeFileSync(LOG, raw.join('\n'));
log(`[i] 原始输出：${LOG}`);
process.exit(0);
