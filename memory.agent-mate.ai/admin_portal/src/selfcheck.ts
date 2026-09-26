/**
 * 启动自检（fail-closed）—— 依据 specs/web-portal/web-design.md §3.4。
 *
 * §3.4 列四项断言（用户目录可写 · embeddings 可达且 1024 维 · **上游二进制**版本 == 锁文件 ·
 * `handle` 白名单与**模板断言**在位）。
 *
 * **2026-09-27（Sprint 5 `#17`）：三项 `deferred` 已全部转正** —— `embeddings_reachable_1024` /
 * `binary_version_matches_lock` / `launch_template_assertions`。姿态规则（沿用仓内既有分工：
 * 开发姿态放宽的那部分必须**如实登记**、不得伪装通过）：
 *   · **生产**：任一项不过 ⇒ `fail` ⇒ 进程**不调用 `listen`**、退出码非 0（fail-closed）；
 *   · **开发**（`PORTAL_ENV=development`）：缺配置 / 不通 / 维度不符 / 无上游二进制 ⇒ `deferred`，
 *     并**明写**「开发姿态 + 原因」（日志与摘要面都能一眼看出是「未判」而不是「通过」）。
 * **`deferred` 永远不算 `pass`**（不阻断，但 `summarizeSelfCheck` 逐项列出 ⇒ 运维可辨）。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type { PortalConfig } from './config';
import { isLoopbackHost } from './shared/host-split';
import {
  DEFAULT_EMBEDDING_DIM,
  probeEmbeddingDimension,
  type EmbeddingProbeOptions,
  type EmbeddingProbeResult,
} from './shared/embeddings';
import { LAUNCH_ARGS, LAUNCH_BINARY, LAUNCH_ENV_TEMPLATE, LAUNCH_HOME } from './bridge/launch-template';

export type SelfCheckStatus = 'pass' | 'fail' | 'deferred';

export interface SelfCheckResult {
  readonly name: string;
  readonly status: SelfCheckStatus;
  readonly detail: string;
}

/**
 * 版本锁在**容器内**的落点 —— **写死**（不是配置键）：它由 compose 的只读挂载给出
 * （`./upstream.lock:/app/upstream.lock:ro`），落点属于**编排契约**的一部分，多一个键只会多一处
 * 可以对不上。**测试缝**：路径经 `runSelfCheck` 的 `deps.lockPath` 注入，便于用临时文件覆盖全部分支。
 */
export const LOCK_PATH = '/app/upstream.lock';

export interface SelfCheckDeps {
  /** 覆盖版本锁路径（仅测试用；生产恒为 {@link LOCK_PATH}）。 */
  readonly lockPath?: string;
  /** 覆盖 embeddings 探测实现（仅测试用）。 */
  readonly embeddingProbe?: (options: EmbeddingProbeOptions) => Promise<EmbeddingProbeResult>;
  /** 覆盖「执行上游 `--version`」（仅测试用）；默认 `execFileSync(LAUNCH_BINARY, ['--version'])`。 */
  readonly binaryVersionRunner?: () => string;
}

/**
 * 逐项检查，返回全部结论（调用方据 fail 项决定是否拒绝启动）。
 *
 * **自 `#17` 起是 `async`** —— 第 7 项要发一次真实 HTTP（embeddings 探测）；调用方必须 `await` 后
 * 再决定是否 `listen`（顺序不可颠倒：**自检不过就不 listen**）。
 */
export async function runSelfCheck(
  cfg: PortalConfig,
  deps: SelfCheckDeps = {},
): Promise<SelfCheckResult[]> {
  const results: SelfCheckResult[] = [];

  // 1. 用户目录可写（§3.4 前置 1 的消费侧断言）
  results.push(checkUsersRootWritable(cfg.usersRoot));

  // 2. 门户库路径不在 /data 下（AC9.4 / TC-P-L3-08；loadConfig 已拦，启动时再断言一次）
  const underData = cfg.dbPath === '/data' || cfg.dbPath.startsWith('/data/');
  results.push({
    name: 'portal_db_outside_data',
    status: underData ? 'fail' : 'pass',
    detail: underData
      ? `门户库落在 /data 下：${cfg.dbPath}`
      : `门户库路径合规：${cfg.dbPath}`,
  });

  // 3. 必需环境键在位（loadConfig 已 fail-loud，此处登记结论）
  results.push({
    name: 'required_env_keys',
    status: 'pass',
    detail: `面隔离 Host（管理面 ${cfg.adminHosts.join('|')} / MCP 面 ${cfg.mcpHosts.join('|')}）与门户库路径均已配置`,
  });

  // 4. 身份来源安全姿态：非 Access 来源不得用于非本机、不得用于生产
  results.push(checkAuthPosture(cfg));

  // 5. 模板与静态资源根可读（模板缺失会让所有页面 500，属启动期就该炸掉的那类）
  results.push(checkDirReadable('views_root', cfg.viewsRoot));
  results.push(checkDirReadable('static_root', cfg.staticRoot));

  // 6. **门户自身版本 == 挂载的版本锁**（§3.4 ② 表第 3 行的「版本断言」）
  //    归属 = Sprint 5 `#2`（2026-09-26 拍板：版本断言整体归 `#2`；`#17` 只收口下面三项 `deferred`）。
  //    与第 7 项的 `binary_version_matches_lock` **不是同一件事**：那项判**上游二进制**的版本，
  //    本项判**镜像自身**的版本（陈旧门户镜像操作未知 schema 的形态）。
  results.push(checkOwnVersionMatchesLock(cfg, deps.lockPath ?? LOCK_PATH));

  // 7-9. §3.4 的其余三项 —— **Sprint 5 `#17` 已全部转正**（不再是 `deferred`；姿态规则见文件头）。
  results.push(await checkEmbeddingsReachable1024(cfg, deps));
  results.push(checkBinaryVersionMatchesLock(cfg, deps));
  results.push(checkLaunchTemplateAssertions());

  return results;
}

function checkUsersRootWritable(usersRoot: string): SelfCheckResult {
  try {
    const stat = fs.statSync(usersRoot);
    if (!stat.isDirectory()) {
      return { name: 'users_root_writable', status: 'fail', detail: `不是目录：${usersRoot}` };
    }
    fs.accessSync(usersRoot, fs.constants.W_OK);
    return {
      name: 'users_root_writable',
      status: 'pass',
      detail: `用户目录可写：${usersRoot}（mode ${(stat.mode & 0o7777).toString(8)}）`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      name: 'users_root_writable',
      status: 'fail',
      detail: `用户目录不可写或不存在：${usersRoot}（${reason}）`,
    };
  }
}

function checkDirReadable(name: string, dir: string): SelfCheckResult {
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      return { name, status: 'fail', detail: `不是目录：${dir}` };
    }
    fs.accessSync(dir, fs.constants.R_OK);
    return { name, status: 'pass', detail: `${dir} 可读` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { name, status: 'fail', detail: `${dir} 不可读（${reason}）` };
  }
}

/**
 * 门户**自身**版本 vs 挂载的版本锁 —— §3.4 ② 表第 3 行「版本断言」（归属 Sprint 5 `#2`）。
 *
 * **为什么必须 fail-closed**：陈旧门户镜像在用户库被前向迁移后会**静默**操作未知 schema ——
 * 那是「不报错但结果错」的一类，只能靠启动期炸掉。
 *
 * **姿态规则**（沿用仓内既有分工：开发姿态放宽的那部分必须**如实登记**，不得伪装通过）：
 * - 锁**读不到**：生产 = `fail`（无法确认镜像与上游坐标一致）；开发 = `deferred`（本机不挂锁，
 *   记「未判」而不是记通过）。
 * - 锁**读到了**：两侧都必须是**明确值**且**相等**，否则一律 `fail`（含：`PORTAL_IMAGE_TAG` 为空
 *   —— 说明镜像不是用 `scripts/build-portal-image.sh` 构建的；锁缺 `IMAGE_TAG` 行；挂载点被
 *   Docker 建成了**目录** —— 源文件缺失时的真实表现）。
 */
function checkOwnVersionMatchesLock(cfg: PortalConfig, lockPath: string): SelfCheckResult {
  const name = 'own_version_matches_lock';
  let raw: string;
  try {
    const stat = fs.statSync(lockPath);
    if (!stat.isFile()) {
      return {
        name,
        status: 'fail',
        detail: `${lockPath} 不是文件（Docker 在源文件缺失时会给挂载点建**目录**）⇒ 把 upstream.lock 与门户 compose 放在同目录`,
      };
    }
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (cfg.isProduction) {
      return {
        name,
        status: 'fail',
        detail: `production 读不到版本锁 ${lockPath}（${reason}）⇒ 无法确认镜像与上游坐标一致`,
      };
    }
    return {
      name,
      status: 'deferred',
      detail: `开发姿态未挂版本锁 ${lockPath}（${reason}）⇒ 本项未判（生产必须可读）`,
    };
  }

  const lockTag = /^IMAGE_TAG="([^"]+)"$/m.exec(raw)?.[1] ?? '';
  if (!lockTag) return { name, status: 'fail', detail: `版本锁缺 IMAGE_TAG 行：${lockPath}` };
  if (!cfg.ownImageTag) {
    return {
      name,
      status: 'fail',
      detail: '镜像未烘入自身版本（PORTAL_IMAGE_TAG 为空）⇒ 请用 scripts/build-portal-image.sh 构建镜像',
    };
  }
  if (cfg.ownImageTag !== lockTag) {
    return {
      name,
      status: 'fail',
      detail: `镜像自身版本 ${cfg.ownImageTag} ≠ 锁 IMAGE_TAG ${lockTag}（陈旧镜像操作未知 schema 的形态）`,
    };
  }
  return {
    name,
    status: 'pass',
    detail: `镜像自身版本 ${cfg.ownImageTag} == 锁 IMAGE_TAG ${lockTag}（${lockPath}）`,
  };
}

function checkAuthPosture(cfg: PortalConfig): SelfCheckResult {
  if (cfg.isProduction && cfg.testJwt.enabled) {
    return {
      name: 'auth_posture',
      status: 'fail',
      detail: 'production 环境启用了自签 JWT 测试通道',
    };
  }
  if (cfg.testJwt.enabled) {
    const nonLoopback = [...cfg.adminHosts, ...cfg.mcpHosts].filter((h) => !isLoopbackHost(h));
    if (nonLoopback.length > 0) {
      return {
        name: 'auth_posture',
        status: 'fail',
        detail: `自签 JWT 已启用但 Host 非回环：${nonLoopback.join(', ')}`,
      };
    }
    return {
      name: 'auth_posture',
      status: 'pass',
      detail: '自签 JWT（测试通道）已启用，仅绑定回环 Host',
    };
  }
  if (!cfg.access.teamDomain || !cfg.access.aud) {
    return {
      name: 'auth_posture',
      status: 'fail',
      detail: '未配置 Cloudflare Access（PORTAL_ACCESS_TEAM_DOMAIN / PORTAL_ACCESS_AUD）',
    };
  }
  return {
    name: 'auth_posture',
    status: 'pass',
    detail: `身份来源 = Cloudflare Access（团队域 ${cfg.access.teamDomain}，JWKS ${cfg.access.jwksUrl}）`,
  };
}

/** 姿态包装：**生产 = `fail`**（fail-closed，不带病服务）；**开发 = `deferred`**（**明写**原因）。 */
function posture(cfg: PortalConfig, name: string, reason: string): SelfCheckResult {
  return cfg.isProduction
    ? { name, status: 'fail', detail: reason }
    : { name, status: 'deferred', detail: `开发姿态：${reason}（生产必须通过）` };
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 自检项 7：**embeddings 可达且向量长度 == `1024`**（AC11.2 / §3.4 ①）。
 *
 * **判据**：一次最小调用后「**非 401/403 且长度 == 1024**」—— **不得**以「env 非空」或「调用成功」
 * 代替（坏 key 下上游只出「线性扫描 / 无 embeddings」告警，而 `tools/call` **仍然返回响应** ⇒
 * 静默降级真实存在；`3.21` 实证）。
 * **姿态**：生产 —— 缺配置 / 401-403 / 维度不符 / 网络不通 **一律 `fail`**；开发 —— 如实登记 `deferred`。
 */
async function checkEmbeddingsReachable1024(
  cfg: PortalConfig,
  deps: SelfCheckDeps,
): Promise<SelfCheckResult> {
  const name = 'embeddings_reachable_1024';
  const missing = [
    cfg.embeddingsBaseUrl ? '' : 'PORTAL_EMBEDDINGS_BASE_URL',
    cfg.embeddingsModel ? '' : 'PORTAL_EMBEDDINGS_MODEL',
    cfg.upstreamApiKey ? '' : 'DASHSCOPE_API_KEY',
  ].filter((item) => item.length > 0);
  if (missing.length > 0) {
    return posture(cfg, name, `未配置 ${missing.join(' / ')} ⇒ 无法判定 embeddings 可达性与维度`);
  }

  const probe = deps.embeddingProbe ?? probeEmbeddingDimension;
  const result = await probe({
    baseUrl: cfg.embeddingsBaseUrl as string,
    apiKey: cfg.upstreamApiKey,
    model: cfg.embeddingsModel as string,
    expectedDim: DEFAULT_EMBEDDING_DIM,
  });
  if (result.ok) {
    return {
      name,
      status: 'pass',
      detail: `embeddings 可达且向量长度 == ${result.dim}（模型 ${cfg.embeddingsModel}）`,
    };
  }
  return posture(cfg, name, `embeddings 判据未过（${result.kind}）：${result.detail}`);
}

/**
 * 自检项 8：**上游二进制**版本 == 版本锁（AC11.3）。
 *
 * 与第 6 项（`own_version_matches_lock` 判**门户自身**镜像版本）**不是同一件事**：本项判镜像内
 * `/usr/local/bin/ai-memory --version` 的**末位 semver** ⇄ 锁的 `UPSTREAM_RELEASE_TAG` **去 `v`**。
 * **两侧必须用同一个提取函数**（{@link lastSemver}）—— 否则 `v0.10.0` 与 `0.10.0` 会因写法差异**假红**。
 * **姿态**：锁读不到 / 二进制跑不起来（开发机上是常态）⇒ 生产 `fail`、开发 `deferred`。
 */
function checkBinaryVersionMatchesLock(cfg: PortalConfig, deps: SelfCheckDeps): SelfCheckResult {
  const name = 'binary_version_matches_lock';
  const lockPath = deps.lockPath ?? LOCK_PATH;

  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, 'utf8');
  } catch (error) {
    return posture(cfg, name, `读不到版本锁 ${lockPath}（${reasonOf(error)}）⇒ 无法确认上游二进制坐标`);
  }
  const lockTag = /^UPSTREAM_RELEASE_TAG="([^"]+)"$/m.exec(raw)?.[1] ?? '';
  if (!lockTag) {
    return { name, status: 'fail', detail: `版本锁缺 UPSTREAM_RELEASE_TAG 行：${lockPath}` };
  }

  let output: string;
  try {
    output =
      deps.binaryVersionRunner?.() ??
      execFileSync(LAUNCH_BINARY, ['--version'], { encoding: 'utf8', timeout: 10_000 });
  } catch (error) {
    return posture(cfg, name, `执行 ${LAUNCH_BINARY} --version 失败（${reasonOf(error)}）`);
  }

  const actual = lastSemver(output);
  const expected = lastSemver(lockTag);
  if (actual.length === 0) {
    return {
      name,
      status: 'fail',
      detail: `${LAUNCH_BINARY} --version 输出里找不到 semver：${output.trim().slice(0, 120)}`,
    };
  }
  if (actual !== expected) {
    return {
      name,
      status: 'fail',
      detail: `上游二进制版本 ${actual} ≠ 锁 UPSTREAM_RELEASE_TAG ${lockTag}（**版本漂移**：镜像与上游坐标不一致）`,
    };
  }
  return {
    name,
    status: 'pass',
    detail: `上游二进制版本 ${actual} == 锁 UPSTREAM_RELEASE_TAG ${lockTag}（${lockPath}）`,
  };
}

/** 取**末位** semver（两侧同用 —— 见 {@link checkBinaryVersionMatchesLock} 的注释）。 */
function lastSemver(text: string): string {
  const matches = text.match(/\d+\.\d+\.\d+/g);
  return matches && matches.length > 0 ? (matches[matches.length - 1] as string) : '';
}

/**
 * 自检项 9：**启动模板断言**（AC11.4）—— 模板常量与真源逐字一致。
 *
 * **运行期能做什么、不能做什么（如实登记）**：镜像里**没有** `specs/`（构建上下文只有
 * `admin_portal/`）⇒ 运行期**无法**读真源文件做逐字比对。本项因此断言「**常量 vs 自检内转录的真源值**」
 * —— 期望值是从 [`mcp-design.md` §5.6.4] **逐字转录**到这里的**第二处独立副本**（与
 * `tests/unit/launch-template.test.ts` 同一组字面量），所以**改 `launch-template.ts` 而不同步真源会在启动期炸**。
 * **真源文件本身**的逐字一致性（`TC-M-L0-01`）由测试与 CI 把住（那里能读到 `specs/`）。
 */
function checkLaunchTemplateAssertions(): SelfCheckResult {
  const name = 'launch_template_assertions';
  const expectedArgs = ['mcp', '--tier', 'smart', '--profile', 'core'];
  const expectedEnv: Record<string, string> = {
    AI_MEMORY_DB: '/data/users/{handle}/ai-memory.db',
    AI_MEMORY_AGENT_ID: 'human:{handle}',
    AI_MEMORY_KEY_DIR: '/data/users/{handle}/keys',
    AI_MEMORY_REQUIRE_AGENT_ATTESTATION: '0',
  };

  const diffs: string[] = [];
  if (LAUNCH_BINARY !== '/usr/local/bin/ai-memory') {
    diffs.push(`二进制 ${LAUNCH_BINARY}`);
  }
  if (JSON.stringify([...LAUNCH_ARGS]) !== JSON.stringify(expectedArgs)) {
    diffs.push(`argv ${JSON.stringify([...LAUNCH_ARGS])}`);
  }
  if (LAUNCH_HOME !== '/data') {
    diffs.push(`HOME ${LAUNCH_HOME}`);
  }
  for (const [key, value] of Object.entries(expectedEnv)) {
    const actual = (LAUNCH_ENV_TEMPLATE as Record<string, string>)[key];
    if (actual !== value) {
      diffs.push(`env ${key}=${String(actual)}`);
    }
  }
  const actualKeys = Object.keys(LAUNCH_ENV_TEMPLATE).length;
  if (actualKeys !== Object.keys(expectedEnv).length) {
    diffs.push(`env 键数 ${actualKeys} ≠ ${Object.keys(expectedEnv).length}`);
  }

  if (diffs.length > 0) {
    return { name, status: 'fail', detail: `启动模板与真源不一致：${diffs.join(' · ')}` };
  }
  return {
    name,
    status: 'pass',
    detail: '启动模板与真源逐字一致（argv / env 四键 / HOME）',
  };
}

/** 是否有阻断启动的失败项。 */
export function hasBlockingFailure(results: readonly SelfCheckResult[]): boolean {
  return results.some((item) => item.status === 'fail');
}

/** 供日志输出的一行式摘要（deferred 项一并列出，避免被当作已通过）。 */
export function summarizeSelfCheck(results: readonly SelfCheckResult[]): string {
  return results
    .map((item) => `${item.name}=${item.status}`)
    .join(' ');
}
