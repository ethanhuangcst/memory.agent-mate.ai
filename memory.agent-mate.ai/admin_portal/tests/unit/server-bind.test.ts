/**
 * 监听地址解析单元测试。
 *
 * 为什么单独一条：这是「本机开发只绑回环、生产才绑全网卡」的开关所在。
 * 判错方向（开发绑了 0.0.0.0）等于把带自签测试通道的进程暴露到局域网，
 * 属安全姿势问题，不能只靠人工 review。
 */

import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';
import { resolveBindHost } from '../../src/server';

const dev = loadConfig({
  PORTAL_ADMIN_HOST: 'localhost',
  PORTAL_MCP_HOST: 'mcp.localhost',
  PORTAL_DB_PATH: '/srv/portal/portal.db',
});

const prod = loadConfig({
  PORTAL_ADMIN_HOST: 'memories.example.com',
  PORTAL_MCP_HOST: 'mcp.example.com',
  PORTAL_DB_PATH: '/srv/portal/portal.db',
  PORTAL_ENV: 'production',
  PORTAL_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  PORTAL_ACCESS_AUD: 'aud-tag',
});

describe('resolveBindHost', () => {
  it('开发环境只绑回环（不暴露到局域网）', () => {
    expect(resolveBindHost(dev)).toBe('127.0.0.1');
  });

  it('生产环境绑全网卡（由前置反代/隧道终止 TLS）', () => {
    expect(resolveBindHost(prod)).toBe('0.0.0.0');
  });
});
