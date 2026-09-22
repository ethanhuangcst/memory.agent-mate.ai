import { describe, expect, it } from 'vitest';
import { deriveJwksUrl, isUnderDataDir, loadConfig } from '../../src/config';

const baseEnv = {
  PORTAL_ADMIN_HOST: 'admin.example.com',
  PORTAL_MCP_HOST: 'mcp.example.com',
  PORTAL_DB_PATH: '/srv/portal/portal.db',
} satisfies NodeJS.ProcessEnv;

describe('loadConfig — 必需键', () => {
  it('缺必需键即 fail-loud（不回落默认值掩盖配置缺失）', () => {
    expect(() => loadConfig({ PORTAL_ADMIN_HOST: 'admin.example.com' })).toThrow(
      /PORTAL_MCP_HOST|PORTAL_DB_PATH/,
    );
  });

  it('解析出规范化后的 Host 列表与默认值', () => {
    const cfg = loadConfig({ ...baseEnv, PORTAL_ADMIN_HOST: 'Admin.Example.com:8443' });
    expect(cfg.adminHosts).toEqual(['admin.example.com']);
    expect(cfg.mcpHosts).toEqual(['mcp.example.com']);
    expect(cfg.env).toBe('development');
    expect(cfg.port).toBe(8788);
    expect(cfg.defaultLocale).toBe('zh-CN');
    expect(cfg.isProduction).toBe(false);
  });

  it('默认语言只接受四语言之一', () => {
    expect(() => loadConfig({ ...baseEnv, PORTAL_I18N_DEFAULT: 'fr' })).toThrow(
      /PORTAL_I18N_DEFAULT/,
    );
  });

  it('端口必须是合法数字', () => {
    expect(() => loadConfig({ ...baseEnv, PORTAL_PORT: '0' })).toThrow(/PORTAL_PORT/);
    expect(loadConfig({ ...baseEnv, PORTAL_PORT: '9001' }).port).toBe(9001);
  });
});

describe('loadConfig — 语义校验', () => {
  it('门户库不得落在 /data 下（AC9.4 / TC-P-L3-08）', () => {
    expect(() => loadConfig({ ...baseEnv, PORTAL_DB_PATH: '/data/portal.db' })).toThrow(/\/data/);
    expect(() => loadConfig({ ...baseEnv, PORTAL_DB_PATH: '/data' })).toThrow(/\/data/);
    expect(loadConfig({ ...baseEnv, PORTAL_DB_PATH: '/srv/portal/portal.db' }).dbPath).toBe(
      '/srv/portal/portal.db',
    );
  });

  it('两个面的 Host 集合不得相交（否则面隔离失效）', () => {
    expect(() =>
      loadConfig({ ...baseEnv, PORTAL_MCP_HOST: 'admin.example.com' }),
    ).toThrow(/不得相同/);
  });

  it('production 必须配置 Cloudflare Access', () => {
    expect(() => loadConfig({ ...baseEnv, PORTAL_ENV: 'production' })).toThrow(
      /PORTAL_ACCESS_TEAM_DOMAIN/,
    );
    const cfg = loadConfig({
      ...baseEnv,
      PORTAL_ENV: 'production',
      PORTAL_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
      PORTAL_ACCESS_AUD: 'aud-tag',
    });
    expect(cfg.isProduction).toBe(true);
    expect(cfg.access.jwksUrl).toBe('https://team.cloudflareaccess.com/cdn-cgi/access/certs');
  });

  it('production 禁止启用自签 JWT 测试通道', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        PORTAL_ENV: 'production',
        PORTAL_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
        PORTAL_ACCESS_AUD: 'aud-tag',
        PORTAL_TEST_JWT_ENABLED: '1',
      PORTAL_TEST_JWT_EMAIL: 'owner@agent-mate.ai',
        PORTAL_TEST_JWT_JWKS: '{"keys":[]}',
        PORTAL_TEST_JWT_ISS: 'https://test.local',
        PORTAL_TEST_JWT_AUD: 'test-aud',
      }),
    ).toThrow(/自签 JWT/);
  });

  it('启用自签 JWT 时缺配套键即拒绝', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        PORTAL_ADMIN_HOST: 'localhost',
        PORTAL_MCP_HOST: 'mcp.localhost',
        PORTAL_TEST_JWT_ENABLED: '1',
      PORTAL_TEST_JWT_EMAIL: 'owner@agent-mate.ai',
      }),
    ).toThrow(/PORTAL_TEST_JWT_JWKS/);
  });

  it('自签 JWT 只允许绑定回环 Host（防测试后门带到真实域名）', () => {
    expect(() =>
      loadConfig({
        ...baseEnv,
        PORTAL_TEST_JWT_ENABLED: '1',
      PORTAL_TEST_JWT_EMAIL: 'owner@agent-mate.ai',
        PORTAL_TEST_JWT_JWKS: '{"keys":[]}',
        PORTAL_TEST_JWT_ISS: 'https://test.local',
        PORTAL_TEST_JWT_AUD: 'test-aud',
      }),
    ).toThrow(/回环/);

    const cfg = loadConfig({
      ...baseEnv,
      PORTAL_ADMIN_HOST: 'localhost,127.0.0.1',
      PORTAL_MCP_HOST: 'mcp.localhost',
      PORTAL_TEST_JWT_ENABLED: '1',
      PORTAL_TEST_JWT_EMAIL: 'owner@agent-mate.ai',
      PORTAL_TEST_JWT_JWKS: '{"keys":[]}',
      PORTAL_TEST_JWT_ISS: 'https://test.local',
      PORTAL_TEST_JWT_AUD: 'test-aud',
    });
    expect(cfg.testJwt.enabled).toBe(true);
    expect(cfg.adminHosts).toEqual(['localhost', '127.0.0.1']);
  });
});

describe('deriveJwksUrl / isUnderDataDir', () => {
  it('团队域可带协议前缀或尾斜杠', () => {
    expect(deriveJwksUrl('https://team.cloudflareaccess.com/')).toBe(
      'https://team.cloudflareaccess.com/cdn-cgi/access/certs',
    );
  });

  it('/data 判定按路径边界，不误伤 /database', () => {
    expect(isUnderDataDir('/data/users/alice')).toBe(true);
    expect(isUnderDataDir('/data')).toBe(true);
    expect(isUnderDataDir('/srv/portal')).toBe(false);
    expect(isUnderDataDir('/database/portal.db')).toBe(false);
  });
});
