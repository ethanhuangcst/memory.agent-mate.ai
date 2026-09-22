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

/** 逐项检查，返回全部结论（调用方据 fail 项决定是否拒绝启动）。 */
export function runSelfCheck(cfg: PortalConfig): SelfCheckResult[] {
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

  // 6-8. §3.4 的其余三项 —— 属 PSP-W2 接入批次，显式登记为未启用（不伪装通过）
  const bridgeBatch = '随 PSP-W2「端到端接入」启用（本批不 spawn 上游子进程）';
  results.push({ name: 'embeddings_reachable_1024', status: 'deferred', detail: bridgeBatch });
  results.push({ name: 'binary_version_matches_lock', status: 'deferred', detail: bridgeBatch });
  results.push({ name: 'launch_template_assertions', status: 'deferred', detail: bridgeBatch });

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
