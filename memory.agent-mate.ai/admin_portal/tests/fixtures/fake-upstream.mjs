#!/usr/bin/env node
/**
 * **假上游**：一个最小的 stdio MCP server，供集成测试当「上游」用。
 *
 * 为什么需要它：集成测试要验证的是**桥**（HTTP(Streamable) ⇄ stdio 的部分），
 * 而不是上游 ai-memory 本身。用真上游需要 docker + linux 二进制 ⇒ 测试不再离线、
 * 且依赖本机是否装着容器。假上游让桥的测试**完全离线、可重复**；
 * 「真上游」由交付前的一次性端到端脚本（`scripts/portal-mcp-probe.sh`）负责。
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
  ListToolsRequestSchema,
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
  { name: 'fake-upstream', version: '0.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOL_NAMES.map((name) => ({
    name,
    description: `fake ${name}`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: true },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

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
      fs.writeFileSync(closedMarkerPath, String(process.pid));
    } catch {
      /* 同上 */
    }
  }
  process.exit(0);
});

await server.connect(new StdioServerTransport());
