/**
 * 启动自检（fail-closed）—— 依据 specs/web-portal/web-design.md §3.4。
 *
 * §3.4 原列四项断言（用户目录可写 · embeddings 可达且 1024 维 · 自身二进制版本 == 锁文件 ·
 * handle 白名单与模板断言在位）。其中三项属 **PSP-W2 接入批次**（本批不 spawn 上游子进程，
 * 无 embeddings / 无二进制版本 / 无 launch 模板）。本模块**不伪装通过**它们：
 * 以 `deferred` 状态显式登记「随接入批次启用」，其余项真实执行、失败即拒绝启动。
 */

import fs from 'node:fs';
import type { PortalConfig } from './config';
import { isLoopbackHost } from './shared/host-split';

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
}

/** 逐项检查，返回全部结论（调用方据 fail 项决定是否拒绝启动）。 */
export function runSelfCheck(cfg: PortalConfig, deps: SelfCheckDeps = {}): SelfCheckResult[] {
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

  // 7-9. §3.4 的其余三项 —— 归属 Sprint 4 `4.3`「web-portal:启动自检」（实现轮按用户指示落为本 Sprint `#17`）。
  //      接入批次（`3.1`）只保证「起得来上游子进程」，不替自检定判据 ⇒ 仍显式登记为未启用（不伪装通过）。
  const selfcheckBatch =
    '待 §4.3「web-portal:启动自检」落地（`3.1` 已能 spawn 上游，三项自检的判据与镜像侧验收属 `4.3`）';
  results.push({ name: 'embeddings_reachable_1024', status: 'deferred', detail: selfcheckBatch });
  results.push({ name: 'binary_version_matches_lock', status: 'deferred', detail: selfcheckBatch });
  results.push({ name: 'launch_template_assertions', status: 'deferred', detail: selfcheckBatch });

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
