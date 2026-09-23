/**
 * 内建启动模板的单元测试（Sprint 4 `3.1`）。
 *
 * 覆盖三类可测业务逻辑（计划里点名的）：
 *  1. **模板与契约真源逐字一致**（`TC-M-L0-01`）：argv / env 的每一项都与
 *     `specs/mcp/mcp-design.md` §5.6.4 的登记值相同 —— 多键、改键、漏键都要失败。
 *  2. **占位符替换**：`{handle}` 全量替换；命令覆盖只覆盖「二进制那一段」。
 *  3. **开发期命令覆盖键的门控**：仅 development 可用；production 出现即拒绝启动。
 */

import { describe, expect, it } from 'vitest';
import {
  HANDLE_PLACEHOLDER,
  LAUNCH_ARGS,
  LAUNCH_BINARY,
  LAUNCH_ENV_TEMPLATE,
  LAUNCH_HOME,
  renderLaunch,
  substituteHandle,
} from '../../src/bridge/launch-template';
import { loadConfig, type PortalConfig } from '../../src/config';

const BASE_ENV = {
  PORTAL_ADMIN_HOST: 'localhost',
  PORTAL_MCP_HOST: 'mcp.localhost',
  PORTAL_DB_PATH: '/tmp/portal-test.db',
};

function cfg(extra: Record<string, string> = {}): PortalConfig {
  return loadConfig({ ...BASE_ENV, ...extra } as NodeJS.ProcessEnv);
}

describe('启动模板与契约真源逐字一致（mcp-design.md §5.6.4）', () => {
  it('argv：二进制与子命令、档位逐字一致', () => {
    expect(LAUNCH_BINARY).toBe('/usr/local/bin/ai-memory');
    expect([...LAUNCH_ARGS]).toEqual(['mcp', '--tier', 'smart', '--profile', 'core']);
  });

  it('env：四项键与模板值逐字一致（多键 / 改键 / 漏键都会失败）', () => {
    expect({ ...LAUNCH_ENV_TEMPLATE }).toEqual({
      AI_MEMORY_DB: '/data/users/{handle}/ai-memory.db',
      AI_MEMORY_AGENT_ID: 'human:{handle}',
      AI_MEMORY_KEY_DIR: '/data/users/{handle}/keys',
      AI_MEMORY_REQUIRE_AGENT_ATTESTATION: '0',
    });
    expect(Object.keys(LAUNCH_ENV_TEMPLATE)).toHaveLength(4);
  });

  it('家目录统一为 /data（所有用户共用一份 config.toml）', () => {
    expect(LAUNCH_HOME).toBe('/data');
  });

  it('attestation 口径为 "0"（make attestation-paths 断言 C 的对照项）', () => {
    expect(LAUNCH_ENV_TEMPLATE.AI_MEMORY_REQUIRE_AGENT_ATTESTATION).toBe('0');
  });
});

describe('占位符替换', () => {
  it('把 {handle} 全量替换（同一字符串出现多次也全部替换）', () => {
    expect(substituteHandle('/data/users/{handle}/keys/{handle}', 'alice')).toBe(
      '/data/users/alice/keys/alice',
    );
  });

  it('无占位符时原样返回', () => {
    expect(substituteHandle('plain', 'alice')).toBe('plain');
  });

  it('渲染后 env 的每一处占位符都已替换，且身份由 handle 派生', () => {
    const rendered = renderLaunch('alice');
    expect(rendered.env.AI_MEMORY_DB).toBe('/data/users/alice/ai-memory.db');
    expect(rendered.env.AI_MEMORY_AGENT_ID).toBe('human:alice');
    expect(rendered.env.AI_MEMORY_KEY_DIR).toBe('/data/users/alice/keys');
    const joined = Object.values(rendered.env).join('|');
    expect(joined).not.toContain(HANDLE_PLACEHOLDER);
  });

  it('渲染结果不含 HOME（由 spawn 层统一注入，避免两处各写一次）', () => {
    const rendered = renderLaunch('alice');
    expect(rendered.env).not.toHaveProperty('HOME');
  });
});

describe('开发期命令覆盖（PORTAL_LAUNCH_OVERRIDE）', () => {
  it('不覆盖时：命令即内建二进制，参数为模板 argv 的其余部分', () => {
    const rendered = renderLaunch('alice');
    expect(rendered.command).toBe(LAUNCH_BINARY);
    expect([...rendered.args]).toEqual([...LAUNCH_ARGS]);
  });

  it('覆盖时：覆盖「二进制那一段」，模板参数照旧接在其后', () => {
    const rendered = renderLaunch(
      'alice',
      'docker exec -i ai-memory-mcp /usr/local/bin/ai-memory',
    );
    expect(rendered.command).toBe('docker');
    expect([...rendered.args]).toEqual([
      'exec',
      '-i',
      'ai-memory-mcp',
      '/usr/local/bin/ai-memory',
      ...LAUNCH_ARGS,
    ]);
  });

  it('覆盖为空白 ⇒ 渲染即失败（不静默退回内建二进制）', () => {
    expect(() => renderLaunch('alice', '   ')).toThrow(/命令前缀为空/);
  });

  it('development 下允许配置覆盖键，并原样给出', () => {
    const config = cfg({ PORTAL_ENV: 'development', PORTAL_LAUNCH_OVERRIDE: 'docker exec -i c b' });
    expect(config.launchOverride).toBe('docker exec -i c b');
  });

  it('production 下出现覆盖键 ⇒ 拒绝启动（与自签 JWT / 开发登录入口同构）', () => {
    expect(() =>
      cfg({
        PORTAL_ENV: 'production',
        PORTAL_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
        PORTAL_ACCESS_AUD: 'aud-tag',
        PORTAL_LAUNCH_OVERRIDE: 'docker exec -i c b',
      }),
    ).toThrow(/production 环境禁止 PORTAL_LAUNCH_OVERRIDE/);
  });

  it('覆盖键为空白字符串 ⇒ 拒绝（避免「看似配了、实际没生效」）', () => {
    expect(() => cfg({ PORTAL_ENV: 'development', PORTAL_LAUNCH_OVERRIDE: '   ' })).toThrow(
      /不能为空白字符串/,
    );
  });

  it('不设覆盖键时默认为 null（按内建模板执行）', () => {
    expect(cfg().launchOverride).toBeNull();
  });
});

describe('上游 key 的注入口径', () => {
  it('未配置时为 null（缺 key 会让上游静默降级 ⇒ 由启动自检暴露，不在此处假装成功）', () => {
    expect(cfg().upstreamApiKey).toBeNull();
  });

  it('配置后原样给出（spawn 时注入子进程）', () => {
    expect(cfg({ DASHSCOPE_API_KEY: 'sk-test' }).upstreamApiKey).toBe('sk-test');
  });
});
