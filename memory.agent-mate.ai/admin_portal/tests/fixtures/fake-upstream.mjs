#!/usr/bin/env node
/**
 * **假上游**：一个最小的 stdio MCP server，供集成测试当「上游」用。
 *
 * 为什么需要它：集成测试要验证的是**桥**（HTTP(Streamable) ⇄ stdio 的部分），
 * 而不是上游 ai-memory 本身。用真上游需要 docker + linux 二进制 ⇒ 测试不再离线、
 * 且依赖本机是否装着容器。假上游让桥的测试**完全离线、可重复**；
 * 「真上游」由交付前的一次性端到端脚本（`scripts/probes/portal-mcp-probe.sh`）负责。
 *
 * 它同时把桥注入的环境变量写进 stderr 与一份 JSON 文件，供测试断言
 * 「身份与库路径确实按用户注入」（这是 `MS1 AC-M1.3` 的离线等价物）。
 *
 * 约定：
 * - 工具名与真上游 core 档一致（8 项），使 `tools/list` 的数量断言有意义；
 * - 收到 stdin EOF（即桥关闭了会话）时写一个 `closed` 标记文件再退出 ——
 *   让「会话回收」可被断言，而不是靠猜。
 */

import fs from 'node:fs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CancelledNotificationSchema,
  CompleteRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

/** core 档 8 项（与 `mcp-design.md` §8.3 一致）。 */
const TOOL_NAMES = [
  'memory_store',
  'memory_recall',
  'memory_search',
  'memory_list',
  'memory_load_family',
  'memory_smart_load',
  'memory_get',
  'memory_capabilities',
];

/**
 * 观测参数走 **argv** 而不是 env。
 *
 * 原因：桥注入子进程的环境变量是**白名单**（只给上游真正需要的键 + 家目录），
 * 不会继承门户进程的环境 —— 这是有意的安全取舍（不把门户机密扩散到每个用户会话）。
 * 因此测试夹具不能在 env 里「夹带」自己的观测开关，改为参数传入。
 */
function argValue(name) {
  const hit = process.argv.find((token) => token.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : undefined;
}

const envDumpPath = argValue('--env-dump');
const closedMarkerPath = argValue('--closed-marker');
/** `--notify-log=PATH`：把到达本进程的通知追加写到该文件（`3.8` 的通知转发观测点）。 */
const notifyLogPath = argValue('--notify-log');

/**
 * `3.9` 新增的四个观测位（同样走 argv）。**默认值全部保持原有的硬编码值** ⇒ 既有用例零回归，
 * 只有显式传入时才改变上游对外声明的身份 / 能力 / 指令。
 *
 * - `--identity=NAME@VERSION`：改 `initialize` 回包的 `serverInfo`（默认 `fake-upstream@0.0.0`）；
 * - `--capabilities=<json>`：改 `capabilities`（默认 `{tools, resources, completions}` —— 那三项不能删，
 *   见下方 `new Server` 的注释）。**收窄**它会触发 `setRequestHandler` 的**注册期**能力断言 ⇒
 *   正是给「上游缺某能力时网关还能不能起来」那类用例准备的；
 * - `--instructions=<text>`：加 `instructions`（默认**不写**该键 —— 保持「上游无指令」的语义，
 *   好让「网关不凭空造字段」这条判据可被证伪）；
 * - `--tool-hang-ms=N`：在**工具调用内部**挂起 N 毫秒。与 `--hang-ms` 是两条独立链路：
 *   那个挂在 `server.connect()` **之前**（覆盖**握手**超时），这个挂在**转发期**（覆盖**每请求**超时）。
 */
const identityArg = argValue('--identity');
const identityParts = identityArg === undefined ? [] : identityArg.split('@');
const identityName = identityParts[0] ?? 'fake-upstream';
const identityVersion = identityParts[1] ?? '0.0.0';
const capabilitiesArg = argValue('--capabilities');
const capabilities = capabilitiesArg
  ? JSON.parse(capabilitiesArg)
  : { tools: {}, resources: {}, completions: {} };
const instructions = argValue('--instructions');
const toolHangMs = Number(argValue('--tool-hang-ms') ?? '0');

/**
 * `--request-log=PATH`：把**到达本进程的请求**按 JSON 行追加到该文件（`3.9` 的 `TC-M-L1-20` 观测点）。
 *
 * **为什么要在传输层记、而不是用一个 handler 记**：本夹具一旦声明 `logging`，它自己的 SDK
 * 也会在构造期注册 `logging/setLevel` 的**本地** handler ⇒ 用 handler 观测会与「网关有没有转发」
 * 混为一谈（两边都会被本地拦下）。记在传输层读到的就是**进程真正收到的东西** ——
 * 与 `TC-M-L1-16` 对通知「以上游进程的 stdin 留痕为准」是同一条判据纪律。
 */
const requestLogPath = argValue('--request-log');

/**
 * `--fail-before-initialize`：启动即退出。
 *
 * 用来覆盖「上游在 `initialize` 阶段就断了」这条**失败面**（`web-design.md` §12.5 的
 * 上游不可用/超时分支）—— 否则该分支在测试里不可达，覆盖率与「失败面被验证过」两件事都落空。
 */
if (argValue('--fail-before-initialize') !== undefined) {
  process.stderr.write('fake-upstream: failing before initialize (requested)\n');
  process.exit(3);
}

/**
 * `--hang-ms=N`：在接入 transport **之前**挂起 N 毫秒（期间不响应任何请求）。
 *
 * 用来覆盖「上游无响应 ⇒ 网关按请求级超时回 504」这条失败面。
 * 挂在 `server.connect()` 之前，是因为 `initialize` 由 SDK 内部处理、业务代码拦不到。
 */
const hangMs = Number(argValue('--hang-ms') ?? '0');
if (Number.isFinite(hangMs) && hangMs > 0) {
  process.stderr.write(`fake-upstream: hanging for ${hangMs}ms before serving\n`);
  await new Promise((resolve) => setTimeout(resolve, hangMs));
}

// 桥注入的环境（用于断言「身份与库路径按用户注入」）。
const injected = {
  AI_MEMORY_DB: process.env.AI_MEMORY_DB ?? null,
  AI_MEMORY_AGENT_ID: process.env.AI_MEMORY_AGENT_ID ?? null,
  AI_MEMORY_KEY_DIR: process.env.AI_MEMORY_KEY_DIR ?? null,
  AI_MEMORY_REQUIRE_AGENT_ATTESTATION: process.env.AI_MEMORY_REQUIRE_AGENT_ATTESTATION ?? null,
  HOME: process.env.HOME ?? null,
  DASHSCOPE_API_KEY: process.env.DASHSCOPE_API_KEY ?? null,
  /** 记下 PID，便于测试确认进程确已退出。 */
  pid: process.pid,
};
process.stderr.write(`fake-upstream: ${JSON.stringify(injected)}\n`);
if (envDumpPath) {
  try {
    fs.writeFileSync(`${envDumpPath}.${process.pid}`, JSON.stringify(injected));
  } catch {
    /* 测试可观测性失败不影响协议行为 */
  }
}

const memories = [];

const server = new Server(
  { name: identityName, version: identityVersion },
  {
    // 能力默认含 `resources` / `completions`：**不能删** —— 下面两个 handler 的注册会被
    // `setRequestHandler` 的能力断言检查，字段名写错（如把 `completions` 写成 `completion`）
    // 会当场抛「Server does not support completions」（`3.10` 探针首跑就踩过这个）。
    // `3.9` 起可由 `--capabilities` 覆盖（收窄即触发同一断言，正是那类用例要验的）。
    capabilities,
    // `instructions` **条件展开**：默认**不写**该键 —— 保持「上游无指令」的语义，
    // 好让「网关不凭空造出这个字段」这条判据可被证伪（真上游 core 档正是无指令）。
    ...(instructions === undefined ? {} : { instructions }),
  },
);

/**
 * 观测点（`3.8` 新增）：到达本进程的**未注册通知**留痕。
 *
 * **必须用赋值、不能用构造参数**（`3.10` 探针实测）：`Protocol` 的构造函数只把 options 存进
 * `this._options`、从不把 fallback 提升为实例属性 ⇒ 传构造参数会**静默丢弃**通知（连错误都不报，
 * 测试只会看到「上游没收到」）。落文件路径走 argv（本夹具的观测体例）。
 */
/** 把到达本进程的通知追加写进 `--notify-log` 指定的文件（`3.8` 的通知转发观测点）。 */
function recordNotification(notification) {
  if (!notifyLogPath) return;
  try {
    fs.appendFileSync(notifyLogPath, `${JSON.stringify(notification)}\n`);
  } catch {
    /* 测试可观测性失败不影响协议行为 */
  }
}

server.fallbackNotificationHandler = async (notification) => {
  recordNotification(notification);
};

// **上游侧同样要「显式注册」才能看到取消通知**：SDK 在 `Protocol` 构造函数里内置消费了
// `cancelled` / `progress`，它们**永远落不到** fallback —— 这条结论在**每一跳**都成立，
// 上游也不例外（`3.10` 探针实测）。集成测试首版用「落文件」判 `cancelled` 是否到达，
// 就因为这个得到**假阴性**（桥确实转发成功，只是上游没记录）。
server.setNotificationHandler(CancelledNotificationSchema, async (notification) => {
  recordNotification(notification);
});

/**
 * 观测点（`3.8` 新增）：「**上游支持、但桥未显式注册**」的请求。
 *
 * 返回**非标准形状**（`resources` 不是数组）并附标记字段，两层信息一次拿到：
 * `_upstream` 在 ⇒ 结果确实来自上游；非标准形状能穿过 ⇒ 桥用的是宽松 schema（不校验）。
 * 桥只显式注册了 `tools/*` 与 `prompts/*`，故这条走的是桥的 fallback。
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: 'NOT-AN-STANDARD-SHAPE',
  _upstream: 'fake-upstream',
}));

/**
 * 观测点（`3.8` 新增）：「**上游不支持**」的方法 —— 用**自定义 message** 抛 `-32601`。
 *
 * 客户端收到 `FROM_FAKE_UPSTREAM` ⇒ 这个错误**来自上游**（经桥转发）；
 * 收到 SDK 的固定文案 `Method not found` ⇒ 错误由桥 / SDK 合成（即桥没转发）。
 */
server.setRequestHandler(CompleteRequestSchema, async () => {
  throw new McpError(ErrorCode.MethodNotFound, 'FROM_FAKE_UPSTREAM');
});

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_NAMES.map((name) => ({
    name,
    description: `fake ${name}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // `--tool-hang-ms=N`：**转发期**挂起（与 `--hang-ms` 的连接前挂起是两条独立链路）——
  // 覆盖「上游每个请求太慢」这条失败面（`TC-M-L1-19`）。挂在参数解构之后、业务分支之前，
  // 这样任何工具调用都能被它拖住。
  if (Number.isFinite(toolHangMs) && toolHangMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, toolHangMs));
  }

  if (name === 'memory_store') {
    const content = String((args?.content ?? ''));
    // 与真上游一致的必填校验：故意在缺 title 时返回错误，用于验证错误透传。
    if (!args?.title) {
      return { content: [{ type: 'text', text: 'title is required' }], isError: true };
    }
    const id = `fake-${memories.length + 1}`;
    memories.push({ id, title: String(args.title), content });
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            id,
            agent_id: injected.AI_MEMORY_AGENT_ID,
            title: args.title,
            tier: 'mid',
            namespace: 'global',
          }),
        },
      ],
    };
  }

  if (name === 'memory_recall') {
    const context = String(args?.context ?? '');
    const hits = memories.filter((m) => m.content.includes(context) || m.title.includes(context));
    return {
      content: [
        {
          type: 'text',
          text: `count:${hits.length}|mode:hybrid|tokens_used:21\n${hits
            .map((m) => `${m.id}|${m.title}|mid|global|5|0.93||${injected.AI_MEMORY_AGENT_ID}`)
            .join('\n')}`,
        },
      ],
    };
  }

  return { content: [{ type: 'text', text: `unsupported tool: ${name}` }], isError: true };
});

// stdin EOF ⇒ 桥已关闭会话 ⇒ 落标记文件再退出（供「回收」断言）。
process.stdin.on('end', () => {
  if (closedMarkerPath) {
    try {
      // **原子落盘**（先写临时文件再 `rename`）：直接 `writeFileSync` 会先创建/截断文件再写内容，
      // 读者可能看到「文件已存在但内容还是空的」⇒ 断言读到 `''`（`#8` 收口入口首跑实测的偶发：
      // `mcp-bridge-session-isolation` ③ 的 `childPid` 读到空串）。测试侧 5 处「先等存在再读」
      // 的调用点因此都不再需要改造。
      const pendingMarker = `${closedMarkerPath}.${process.pid}.tmp`;
      fs.writeFileSync(pendingMarker, String(process.pid));
      fs.renameSync(pendingMarker, closedMarkerPath);
    } catch {
      /* 同上 */
    }
  }
  process.exit(0);
});

const serverTransport = new StdioServerTransport();
await server.connect(serverTransport);

// `--request-log=PATH`：在**传输层**记下到达本进程的请求（`3.9` 的 `TC-M-L1-20`）。
//
// **必须挂在 `server.connect()` 之后**：`Protocol.connect` 会先给 `transport.onmessage` 赋值，
// 提前挂会被它覆盖、观测定不到东西。判据以这里为准 —— 「网关有没有把请求转出来」与
// 「上游自己怎么处理它」是两件事（后者会被上游的本地 handler 消费掉）。
if (requestLogPath) {
  const protocolOnMessage = serverTransport.onmessage;
  serverTransport.onmessage = (message) => {
    try {
      if (typeof message?.method === 'string') {
        fs.appendFileSync(requestLogPath, `${JSON.stringify(message)}\n`);
      }
    } catch {
      /* 观测失败不影响协议行为 */
    }
    return protocolOnMessage?.(message);
  };
}
