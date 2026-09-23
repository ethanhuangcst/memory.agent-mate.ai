/**
 * 会话建立时的上游进程装配：**占位符替换 → 组装环境变量 → spawn → 建立 MCP 客户端连接**。
 *
 * 本模块是「门户对上游的语义知识 = 0」的落点：它只知道把 `{handle}` 套进
 * `launch-template.ts` 的常量，**不解析** argv / env 的含义（`mcp-design.md` §5.6.4）。
 *
 * ## 安全取舍：**最小 env 白名单**，不继承门户进程环境
 *
 * 门户进程持有自己的机密（`DASHSCOPE_API_KEY` 等）。若把 `process.env` 全量传给子进程，
 * 等于把这些机密扩散到每个用户会话的子进程里；且上游只需要「自己的库 + 身份 + 家目录 + key」。
 * 因此这里**显式列举**要传的变量，其余一律不传。
 *
 * ## 归属说明（避免颗粒度混淆）
 *
 * - **不变量 2（fail-closed 路径断言）归 `3.2`**：本文件在 `spawnUpstream` 里**预留**了
 *   断言位置（见 `TODO(3.2)`），本批（`3.1`）**不实现**该断言 ——
 *   依据 [`ADR-016`](../../../specs/adr/ADR-016-sbi-delivery-granularity.md)「一个 SBI 一件事」。
 * - **会话回收的验收归 `3.4`**：本模块只保证「能起的起来、也能被关掉」。
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  LAUNCH_HOME,
  renderLaunch,
} from './launch-template';

/** 注入子进程的环境变量**白名单**（键名即上游契约的一部分，改动须对照 §5.6.4）。 */
const ENV_ALLOWLIST = ['PATH'] as const;

/** 上游 LLM / embedding 所需的 MaaS key 变量名（`web-design.md` §12.9 登记的 `DASHSCOPE_API_KEY`）。 */
export const UPSTREAM_KEY_ENV = 'DASHSCOPE_API_KEY';

export interface SpawnUpstreamOptions {
  /** 用户句柄 —— **必须来自门户数据库**（模板不变量 1）。 */
  readonly handle: string;
  /** 开发期命令覆盖（`cfg.launchOverride`）；生产恒为 `null`。 */
  readonly launchOverride: string | null;
  /** 门户专用的 MaaS key；缺省则不注入（由启动自检负责暴露「无 key ⇒ 静默降级」）。 */
  readonly upstreamApiKey?: string | null;
  /**
   * 与上游握手（`initialize`）的超时（毫秒）。
   *
   * 覆盖「上游起得来但不响应」：`StdioClientTransport` 能成功 spawn 进程，但 `client.connect`
   * 会一直等上游回 `initialize`。超时后本函数抛错 ⇒ 调用方按**上游不可用（503）**处理，
   * 而不是让请求挂到上游最终响应（实测过：不设它，客户端会等满上游的全部延迟）。
   */
  readonly requestTimeoutMs?: number;
  readonly logger?: {
    error: (obj: unknown, msg?: string) => void;
  };
}

export interface UpstreamSession {
  readonly client: Client;
  /** 实际命令行（**只含 argv**，不含 env 值）—— 供日志与排障，绝不含机密。 */
  readonly commandLine: string;
  /** 上游 stderr 的最近若干行（用于失败诊断，**不回传客户端**）。 */
  stderrTail(): string;
  /** 关闭上游：先关客户端再关传输，任一失败不抛出（回收路径必须尽力而为）。 */
  close(): Promise<void>;
}

/**
 * 启动一个上游会话（**一会话一子进程**，不池化、不跨用户复用 —— 模板不变量 4）。
 *
 * 调用方负责在会话结束时调用 `close()`；否则会留下孤儿进程。
 */
export async function spawnUpstream(options: SpawnUpstreamOptions): Promise<UpstreamSession> {
  const { handle, launchOverride, upstreamApiKey, requestTimeoutMs, logger } = options;

  const rendered = renderLaunch(handle, launchOverride);

  // TODO(3.2): 在此处插入 fail-closed 路径断言 —— 断言 rendered.env.AI_MEMORY_DB
  //   非空 · 以 `/data/users/` 开头 · 含当前 handle，不满足即拒绝启动会话且不 spawn。
  //   归属：Sprint 4 `3.2`「mcp:spawn 前置断言」（模板不变量 2 / RID D1 / 判据 V1）。

  // 最小 env 白名单 + 模板 env + 统一 HOME。**不传 process.env 全量**（见文件头说明）。
  const env: Record<string, string> = {};
  for (const name of ENV_ALLOWLIST) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  Object.assign(env, rendered.env);
  env.HOME = LAUNCH_HOME;
  if (upstreamApiKey) env[UPSTREAM_KEY_ENV] = upstreamApiKey;

  const transport = new StdioClientTransport({
    command: rendered.command,
    args: [...rendered.args],
    env,
    stderr: 'pipe',
  });

  // 上游 stderr：收集尾部若干行用于诊断，**不外传**（错误体纪律见 `web-design.md` §12.5）。
  let stderrBuffer = '';
  transport.stderr?.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    const lines = stderrBuffer.split('\n');
    stderrBuffer = lines.slice(-40).join('\n');
  });

  // **能力声明不是可选项**（`3.10` 探针实测，见 §5.6.2 实证块）：`Client.notification()` 会走
  // `assertNotificationCapability` —— 桥要替客户端转发 `notifications/roots/list_changed`，
  // 上游 client 就必须声明 `capabilities.roots.listChanged`，否则**抛错**、且该错会被
  // `_onnotification` 的 `.catch(...)` 交给 `onerror` **静默吞掉**（症状是「通知没被转发」）。
  // `cancelled` / `progress` 属 `always allowed`，不受此限 ⇒ 本批只需声明 roots 这一项。
  const client = new Client(
    { name: 'portal-bridge', version: '0.1.0' },
    { capabilities: { roots: { listChanged: true } } },
  );

  try {
    await client.connect(
      transport,
      requestTimeoutMs === undefined ? undefined : { timeout: requestTimeoutMs },
    );
  } catch (error) {
    // 起不来时不能让半成品留下（调用方据此回 503）。
    // **`3.8` 的「回收对齐」**：`client` 与 `transport` **两者**都要关 —— 只关 transport 会留下
    // client 侧已注册的处理器与连接状态。顺序与成功路径的 `close()` 保持一致：先关客户端
    // （含 stdio 传输）再关传输本身；两步都尽力而为，任一失败都不掩盖原始错误。
    try {
      await client.close();
    } catch {
      /* 回收失败不掩盖原始错误 */
    }
    try {
      await transport.close();
    } catch {
      /* 回收失败不掩盖原始错误 */
    }
    logger?.error(
      {
        event: 'bridge_spawn_failed',
        handle,
        command: rendered.command,
        // 记错误消息与退出码/信号，否则日志里只有「失败了」三个字，定位要重跑很多次（踩过）。
        // **不记 env 值**（含机密）；stderr 只留最后一行摘要。
        message: error instanceof Error ? error.message : String(error),
        ...(typeof (error as { code?: unknown }).code === 'number'
          ? { code: (error as { code: number }).code }
          : {}),
        stderrTail: stderrBuffer.trim().split('\n').slice(-1)[0] ?? '',
      },
      'bridge_spawn_failed',
    );
    throw error instanceof Error ? error : new Error(String(error));
  }

  return {
    client,
    commandLine: [rendered.command, ...rendered.args].join(' '),
    stderrTail: () => stderrBuffer.trim(),
    async close(): Promise<void> {
      // 顺序：先关客户端（含 stdio 传输）再关传输本身；两步都尽力而为。
      try {
        await client.close();
      } catch {
        /* 已关闭或连接已断，忽略 */
      }
      try {
        await transport.close();
      } catch {
        /* 同上 */
      }
    },
  };
}
