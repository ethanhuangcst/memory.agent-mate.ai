/**
 * 内建启动模板（`launch`）—— 门户对上游 ai-memory 的**唯一知识**。
 *
 * 契约真源：`specs/mcp/mcp-design.md` §5.6.4（**逐字对照**；`TC-M-L0-01` 要求二者一致，
 * `tests/unit/launch-template.test.ts` 把这句话变成可执行断言）。
 *
 * 载体（2026-09-23 定档）：**内建常量，不通过环境变量注入** —— 模板是「门户对上游的唯一知识」，
 * 改动它等于升级适配，应与代码同版本控制；启动自检断言其与真源一致
 * （`selfcheck.ts` 的 `launch_template_assertions`）。
 *
 * 门户只做**占位符替换**（`{handle}`），**不解析语义** —— 这就是「0 耦合」的确切含义。
 *
 * ## 强制不变量（源 §5.6.4；各自归属见括号）
 *
 * 1. `handle` **只**来自门户数据库，绝不取自请求 —— 由调用方（`route.ts`）保证（`3.1`）。
 * 2. 替换后断言 `AI_MEMORY_DB` 非空 / 以 `/data/users/` 开头 / 含该 `handle`
 *    —— **归 `3.2`（`mcp:spawn 前置断言`）**，本批**只预留位置**（见 `spawn.ts` 的 `TODO(3.2)`）。
 * 3. `AI_MEMORY_AGENT_ID` 必须由 `handle` 派生，不接受客户端传入值（`3.1`，见下）。
 * 4. 子进程**不得跨用户复用**（禁止会话池）（`3.1` 结构保证：一会话一子进程；判据归 `3.3`）。
 *
 * ## 改模板必须复跑的门禁
 *
 * `make attestation-paths` 的**断言 C** 核对 `mcp-design.md` §5.6.4 含
 * `AI_MEMORY_REQUIRE_AGENT_ATTESTATION: "0"`。改本文件的 env 项时，**必须**同步真源并复跑该门禁。
 */

/** 上游二进制路径（制品契约之一，见 `mcp-design.md` §5.6.3）。 */
export const LAUNCH_BINARY = '/usr/local/bin/ai-memory';

/** 子命令与档位（`--profile core` = 对外 8 工具；`mcp-design.md` §8.3 已定档）。 */
export const LAUNCH_ARGS: readonly string[] = ['mcp', '--tier', 'smart', '--profile', 'core'];

/**
 * 环境变量模板（占位符 `{handle}`）。
 *
 * **身份必须经此注入**：`--agent-id` 虽在 clap 上带 `env = "AI_MEMORY_AGENT_ID"`，
 * 但**传 flag 不会写回 env**，上游 `resolve_read_visibility_caller()` 只读环境变量 ⇒
 * 用 flag 会造成「写入标记看似正常、读路径 trust-all」，即**隔离根本没开**（`mcp-design.md` §5.6.1）。
 */
export const LAUNCH_ENV_TEMPLATE = {
  AI_MEMORY_DB: '/data/users/{handle}/ai-memory.db',
  AI_MEMORY_AGENT_ID: 'human:{handle}',
  AI_MEMORY_KEY_DIR: '/data/users/{handle}/keys',
  AI_MEMORY_REQUIRE_AGENT_ATTESTATION: '0',
} as const;

/** 统一的家目录 ⇒ 所有用户共用一份 `config.toml`（tier / LLM 设置）。 */
export const LAUNCH_HOME = '/data';

/** 占位符（当前只有一种，集中在此便于将来扩展时一处改）。 */
export const HANDLE_PLACEHOLDER = '{handle}';

/** 把模板里的 `{handle}` 全部替换为给定句柄。 */
export function substituteHandle(text: string, handle: string): string {
  return text.split(HANDLE_PLACEHOLDER).join(handle);
}

export interface RenderedLaunch {
  /** 实际可执行文件（或开发期覆盖后的命令首段）。 */
  readonly command: string;
  /** 完整参数列表（含覆盖前缀的剩余部分）。 */
  readonly args: readonly string[];
  /** 已替换占位符的环境变量（**不含** `HOME`，由 `spawn.ts` 统一注入）。 */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * 渲染模板：产出实际要 spawn 的命令行与环境变量。
 *
 * @param handle 用户句柄 —— **必须来自门户数据库**（不变量 1）。
 * @param overrideCommand 开发期命令覆盖（`PORTAL_LAUNCH_OVERRIDE`）。
 *   语义：覆盖**二进制那一段**（可给多段，如 `docker exec -i <container> <binary>`），
 *   `LAUNCH_ARGS` 照旧接在其后。理由见 `web-design.md` §12.9：本机是 macOS，
 *   执行不了镜像内的 linux 二进制，只能用 `docker exec` 借壳。
 *   **仅 `PORTAL_ENV=development` 生效**（`config.ts` 已保证生产出现即拒绝启动）。
 */
export function renderLaunch(handle: string, overrideCommand?: string | null): RenderedLaunch {
  const prefix = overrideCommand
    ? overrideCommand.trim().split(/\s+/).filter((token) => token.length > 0)
    : [LAUNCH_BINARY];

  if (prefix.length === 0) {
    throw new Error('launch 模板渲染失败：命令前缀为空（PORTAL_LAUNCH_OVERRIDE 不能为空白）');
  }

  const env: Record<string, string> = {};
  for (const [key, template] of Object.entries(LAUNCH_ENV_TEMPLATE)) {
    env[key] = substituteHandle(template, handle);
  }

  const [command, ...rest] = prefix;
  return {
    command: command as string,
    args: [...rest, ...LAUNCH_ARGS],
    env,
  };
}
