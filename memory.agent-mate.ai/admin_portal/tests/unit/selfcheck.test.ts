/**
 * 启动自检（fail-closed）单元测试 —— 覆盖 `src/selfcheck.ts` 全部判定分支。
 *
 * 为什么值得单独测：这是「带着半套配置就拒绝启动」的那道闸门。它的每一类 fail
 * 都对应一种**必须被挡住**的部署错误（用户目录不可写、门户库混进 /data、
 * 测试通道流向真实域名、模板/静态根缺失）。判错方向（该挡没挡）比页面出错更危险，
 * 所以这里逐条断言「结论 + 名字 + 是否阻断」。
 *
 * 说明：`dbPath` 在 /data 下这类构造**故意绕过 loadConfig**（它已 fail-loud 拦下），
 * 目的是断言自检自己也会再拦一次 —— 纵深防御的第二道。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type PortalConfig } from '../../src/config';
import {
  hasBlockingFailure,
  runSelfCheck,
  summarizeSelfCheck,
  type SelfCheckResult,
} from '../../src/selfcheck';

let root: string;
let usersRoot: string;
let viewsRoot: string;
let staticRoot: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-selfcheck-'));
  usersRoot = path.join(root, 'users');
  viewsRoot = path.join(root, 'views');
  staticRoot = path.join(root, 'assets');
  for (const dir of [usersRoot, viewsRoot, staticRoot]) fs.mkdirSync(dir, { recursive: true });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 基线配置：自签通道 + 全回环 + 可写的用户目录（即「一切正常」的那份）。 */
function baseEnv(): Record<string, string> {
  return {
    PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
    PORTAL_MCP_HOST: 'mcp.localhost',
    PORTAL_DB_PATH: path.join(root, 'portal.db'),
    PORTAL_USERS_ROOT: usersRoot,
    PORTAL_VIEWS_ROOT: viewsRoot,
    PORTAL_STATIC_ROOT: staticRoot,
    PORTAL_TEST_JWT_ENABLED: '1',
      PORTAL_TEST_JWT_EMAIL: 'owner@agent-mate.ai',
    PORTAL_TEST_JWT_JWKS: '{"keys":[]}',
    PORTAL_TEST_JWT_ISS: 'https://portal-dev.test',
    PORTAL_TEST_JWT_AUD: 'portal-dev-aud',
  };
}

function load(over: Record<string, string> = {}): PortalConfig {
  return loadConfig({ ...baseEnv(), ...over });
}

function pick(results: readonly SelfCheckResult[], name: string): SelfCheckResult {
  const found = results.find((item) => item.name === name);
  if (!found) throw new Error(`自检结果缺项：${name}`);
  return found;
}

/** 生产姿态配置：去掉自签通道的五个键（生产下启用即拒绝启动），补 Access 两键。 */
function prodEnv(over: Record<string, string> = {}): Record<string, string> {
  const env = baseEnv();
  for (const key of [
    'PORTAL_TEST_JWT_ENABLED',
    'PORTAL_TEST_JWT_EMAIL',
    'PORTAL_TEST_JWT_JWKS',
    'PORTAL_TEST_JWT_ISS',
    'PORTAL_TEST_JWT_AUD',
  ]) {
    delete env[key];
  }
  return {
    ...env,
    PORTAL_ENV: 'production',
    PORTAL_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    PORTAL_ACCESS_AUD: 'aud-tag',
    ...over,
  };
}

describe('runSelfCheck：门户自身版本 vs 版本锁（Sprint 5 `#2`）', () => {
  const LOCK_OK = 'LOCK_SCHEMA="1"\nIMAGE_TAG="0.10.0"\nUPSTREAM_RELEASE_TAG="v0.10.0"\n';
  function writeLock(content: string, name = 'upstream.lock'): string {
    const file = path.join(root, name);
    fs.writeFileSync(file, content);
    return file;
  }
  function verdict(cfg: PortalConfig, lockPath: string): SelfCheckResult {
    return pick(runSelfCheck(cfg, { lockPath }), 'own_version_matches_lock');
  }

  it('生产 + 锁可读 + 两侧一致 ⇒ pass（detail 带两侧取值）', () => {
    const result = verdict(loadConfig(prodEnv({ PORTAL_IMAGE_TAG: '0.10.0' })), writeLock(LOCK_OK));
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('0.10.0');
  });

  it('开发 + 锁可读 + 两侧一致 ⇒ pass（同一判据，不因姿态放宽）', () => {
    const result = verdict(load({ PORTAL_IMAGE_TAG: '0.10.0' }), writeLock(LOCK_OK));
    expect(result.status).toBe('pass');
  });

  it('生产 + 锁读不到 ⇒ fail 且阻断启动（不伪装通过）', () => {
    const result = verdict(loadConfig(prodEnv({ PORTAL_IMAGE_TAG: '0.10.0' })), path.join(root, 'nope.lock'));
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('production');
    expect(hasBlockingFailure([result])).toBe(true);
  });

  it('开发 + 锁读不到 ⇒ deferred（如实登记「未判」，且不阻断）', () => {
    const result = verdict(load(), path.join(root, 'nope.lock'));
    expect(result.status).toBe('deferred');
    expect(hasBlockingFailure([result])).toBe(false);
  });

  it('挂载点被建成了目录（Docker 在源文件缺失时的真实表现）⇒ fail', () => {
    const dir = path.join(root, 'lock-is-dir');
    fs.mkdirSync(dir, { recursive: true });
    const result = verdict(load({ PORTAL_IMAGE_TAG: '0.10.0' }), dir);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('不是文件');
  });

  it('两侧不一致 ⇒ fail，且 detail 把两个值都写出来', () => {
    const result = verdict(load({ PORTAL_IMAGE_TAG: '0.9.9' }), writeLock(LOCK_OK));
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('0.9.9');
    expect(result.detail).toContain('0.10.0');
  });

  it('镜像未烘入自身版本（PORTAL_IMAGE_TAG 为空）⇒ fail（提示用构建脚本）', () => {
    const result = verdict(load(), writeLock(LOCK_OK));
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('build-portal-image.sh');
  });

  it('锁缺 IMAGE_TAG 行 ⇒ fail（锁被改坏也要挡住）', () => {
    const result = verdict(load({ PORTAL_IMAGE_TAG: '0.10.0' }), writeLock('LOCK_SCHEMA="1"\n'));
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('IMAGE_TAG');
  });
});

describe('runSelfCheck：本批可验的项', () => {
  it('基线配置：全部可验项通过，未启用项显式登记为 deferred（不伪装通过）', () => {
    const results = runSelfCheck(load());

    expect(pick(results, 'users_root_writable').status).toBe('pass');
    expect(pick(results, 'portal_db_outside_data').status).toBe('pass');
    expect(pick(results, 'required_env_keys').status).toBe('pass');
    expect(pick(results, 'auth_posture').status).toBe('pass');
    expect(pick(results, 'views_root').status).toBe('pass');
    expect(pick(results, 'static_root').status).toBe('pass');

    // §3.4 其余三项归属 §4.3「web-portal:启动自检」：必须是 deferred，绝不能被当成 pass
    // （接入批次 `3.1` 交付后这三项仍 deferred —— 归属行未变，故断言随之改指 `4.3`，避免文案指回已交付批次）
    for (const name of [
      'embeddings_reachable_1024',
      'binary_version_matches_lock',
      'launch_template_assertions',
    ]) {
      expect(pick(results, name).status).toBe('deferred');
      expect(pick(results, name).detail).toContain('4.3');
    }

    expect(hasBlockingFailure(results)).toBe(false);
  });

  it('用户目录不存在 ⇒ fail（detail 带路径，便于一眼定位）', () => {
    const missing = path.join(root, 'nope');
    const result = pick(runSelfCheck(load({ PORTAL_USERS_ROOT: missing })), 'users_root_writable');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain(missing);
    expect(hasBlockingFailure([result])).toBe(true);
  });

  it('用户目录是文件而非目录 ⇒ fail（不把「存在」当成「可用」）', () => {
    const file = path.join(root, 'not-a-dir');
    fs.writeFileSync(file, 'x');
    const result = pick(runSelfCheck(load({ PORTAL_USERS_ROOT: file })), 'users_root_writable');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('不是目录');
  });

  it('模板/静态根缺失 ⇒ fail（模板缺失会让所有页面 500，应在启动期就炸）', () => {
    const cfg = {
      ...load(),
      viewsRoot: path.join(root, 'missing-views'),
      staticRoot: path.join(root, 'missing-assets'),
    };
    const results = runSelfCheck(cfg);
    expect(pick(results, 'views_root').status).toBe('fail');
    expect(pick(results, 'static_root').status).toBe('fail');
    expect(hasBlockingFailure(results)).toBe(true);
  });

  it('模板根是文件而非目录 ⇒ fail', () => {
    const file = path.join(root, 'views-file');
    fs.writeFileSync(file, 'x');
    const results = runSelfCheck({ ...load(), viewsRoot: file });
    expect(pick(results, 'views_root').status).toBe('fail');
    expect(pick(results, 'views_root').detail).toContain('不是目录');
  });

  it('门户库落在 /data 下 ⇒ fail（第二道闸；loadConfig 已是第一道）', () => {
    for (const dbPath of ['/data', '/data/portal.db']) {
      const result = pick(runSelfCheck({ ...load(), dbPath }), 'portal_db_outside_data');
      expect(result.status, dbPath).toBe('fail');
      expect(result.detail).toContain('/data');
    }
  });
});

describe('runSelfCheck：身份来源安全姿态', () => {
  it('自签通道 + 全回环 ⇒ pass', () => {
    const result = pick(runSelfCheck(load()), 'auth_posture');
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('仅绑定回环');
  });

  it('自签通道 + 非回环 Host ⇒ fail（测试后门不得流向真实域名）', () => {
    const cfg = { ...load(), adminHosts: ['memories.example.com'] };
    const result = pick(runSelfCheck(cfg), 'auth_posture');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('memories.example.com');
  });

  it('production 下启用自签通道 ⇒ fail（最高危组合）', () => {
    const cfg = { ...load(), isProduction: true };
    const result = pick(runSelfCheck(cfg), 'auth_posture');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('production');
  });

  it('既无自签通道也无 Access 配置 ⇒ fail（无身份来源）', () => {
    const cfg = {
      ...load(),
      testJwt: { enabled: false, jwks: '', iss: '', aud: '' },
      access: { teamDomain: '', aud: '', jwksUrl: '' },
    };
    const result = pick(runSelfCheck(cfg), 'auth_posture');
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('PORTAL_ACCESS_TEAM_DOMAIN');
  });

  it('Access 配置齐备 ⇒ pass，且 detail 写明团队域与 JWKS 地址', () => {
    const cfg = {
      ...load(),
      testJwt: { enabled: false, jwks: '', iss: '', aud: '' },
      access: {
        teamDomain: 'team.cloudflareaccess.com',
        aud: 'aud-tag',
        jwksUrl: 'https://team.cloudflareaccess.com/cdn-cgi/access/certs',
      },
    };
    const result = pick(runSelfCheck(cfg), 'auth_posture');
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('team.cloudflareaccess.com');
    expect(result.detail).toContain('/cdn-cgi/access/certs');
  });
});

describe('摘要与阻断判定', () => {
  it('summarizeSelfCheck 逐项列出 name=status（deferred 也列出，避免被当成已通过）', () => {
    const summary = summarizeSelfCheck(runSelfCheck(load()));
    expect(summary).toContain('users_root_writable=pass');
    expect(summary).toContain('embeddings_reachable_1024=deferred');
    expect(summary.split(' ').length).toBe(runSelfCheck(load()).length);
  });

  it('hasBlockingFailure 只认 fail：deferred 不阻断，fail 阻断', () => {
    const pass: SelfCheckResult = { name: 'a', status: 'pass', detail: '' };
    const deferred: SelfCheckResult = { name: 'b', status: 'deferred', detail: '' };
    const fail: SelfCheckResult = { name: 'c', status: 'fail', detail: '' };
    expect(hasBlockingFailure([pass, deferred])).toBe(false);
    expect(hasBlockingFailure([pass, deferred, fail])).toBe(true);
    expect(hasBlockingFailure([])).toBe(false);
  });
});
