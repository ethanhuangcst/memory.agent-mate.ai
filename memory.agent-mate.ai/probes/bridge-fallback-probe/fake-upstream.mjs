#!/usr/bin/env node
/**
 * 假上游 —— 本探针的**观测器**，不是被测对象。
 *
 * 为什么不用真上游（`docker exec ai-memory`）：本探针要证的是**桥的转发语义**，需要精确控制
 * 「上游支持哪些方法」「返回什么形状」「错误文案是什么」三件事；真上游无法为这些条件配合。
 * 「能不能连上真上游」这一半已由 Sprint 4 `3.5`（`probes/mcp-bridge-probe/`）单独证过，两者互补不重叠。
 *
 * 三个观测点：
 *   1. `resources/list` —— 上游「支持」，但**故意返回非标准形状**并带标记字段。
 *      客户端若原样收到 ⇒ 桥既转发了、也没有用严格 schema 校验（宽松透传成立）。
 *   2. `completion/complete` —— 上游「不支持」，用**自定义 message** 抛 `-32601`。
 *      客户端收到 `FROM_FAKE_UPSTREAM` ⇒ 错误来自上游（经桥转发）；
 *      收到 SDK 固定文案 `Method not found` ⇒ 错误由桥/SDK 合成（未转发）。
 *   3. `fallbackNotificationHandler` —— 任何到达本进程的 notification 落文件。
 *      探针据此判「桥有没有把通知转下来」（取消通知不转发，客户端的取消就形同无效）。
 *
 * 落文件路径取 `$FAKE_UPSTREAM_NOTIFY_FILE`（由 `probe.mjs` 注入）。
 */

import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CompleteRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

const NOTIFY_FILE = process.env.FAKE_UPSTREAM_NOTIFY_FILE;

const server = new Server(
  { name: 'fake-upstream', version: '0.0.0' },
  {
    // 字段名是 **`completions`**（复数）—— 写错成 `completion` 时，`setRequestHandler` 的
    // 能力断言会当场抛出「Server does not support completions」（本探针首跑实测踩到）。
    capabilities: { resources: {}, completions: {} },
  },
);

// 观测点 3：到达本进程的任意 notification 都留痕（文件 + stderr 双份，
// stderr 那份由探针收集 ⇒ 即使文件写入有问题也能定位断在哪一环）。
//
// **实测踩坑（决定了 `3.8` 的写法）**：把它作为**构造参数**传（`ServerOptions.fallbackNotificationHandler`）
// 时**不生效** —— 通知照旧从 stdin 抵达本进程（RAW-STDIN 可见），却**静默丢弃**，因为
// `_onnotification` 取到的是 `undefined` 便直接 `return`。改为**构造后赋值实例属性**即生效。
// 对照：请求侧的 fallback（`serverB.fallbackRequestHandler = …`）从一开始就是赋值写法，一直正常。
server.fallbackNotificationHandler = async (notification) => {
  process.stderr.write(`GOT-NOTIFICATION ${JSON.stringify(notification)}\n`);
  if (NOTIFY_FILE) {
    fs.appendFileSync(NOTIFY_FILE, `${JSON.stringify(notification)}\n`);
  }
};

// 观测点 1：上游「支持」的未注册方法（桥只显式注册了 tools/* 与 prompts/*）。
// 返回**非标准形状**（`resources` 不是数组）并附标记字段 —— 两层信息一次拿到：
//   `_upstream` 在 ⇒ 结果确实来自上游；非标准形状能穿过 ⇒ 桥用的是宽松 schema（不校验）。
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: 'NOT-AN-STANDARD-SHAPE',
  _upstream: 'fake-upstream',
}));

// 观测点 2：上游「不支持」的方法 —— 用自定义 message 抛 -32601，用于区分错误来源。
server.setRequestHandler(CompleteRequestSchema, async () => {
  throw new McpError(ErrorCode.MethodNotFound, 'FROM_FAKE_UPSTREAM');
});

// 诊断观测点（本探针专用，不属于被测对象）：
//   ① 把 stdin 上的**原始字节**留痕 —— 直接回答「通知到底有没有穿过 stdio 到达本进程」；
//   ② 挂 onerror —— `_onnotification` 判定失败时会以 `Unknown message type` 走 `_onerror`，
//      默认**静默**（首轮实测正是这样丢掉的）。
process.stdin.on('data', (chunk) => {
  process.stderr.write(`RAW-STDIN ${chunk.toString().replace(/\n/g, '\\n').slice(0, 200)}\n`);
});
server.onerror = (e) => process.stderr.write(`FAKE-UPSTREAM-ONERROR ${e.message}\n`);

await server.connect(new StdioServerTransport());
