import { describe, expect, it } from 'vitest';
import {
  classifyHost,
  decideRequest,
  HEALTH_PATH,
  isLoopbackHost,
  normalizeHost,
  normalizeHostList,
} from '../../src/shared/host-split';

const cfg = {
  adminHosts: ['admin.example.com', 'localhost', '127.0.0.1'],
  mcpHosts: ['mcp.example.com'],
};

describe('normalizeHost', () => {
  it('去掉端口、统一小写（面判据按主机名比对）', () => {
    expect(normalizeHost('Admin.Example.COM:8443')).toBe('admin.example.com');
  });

  it('处理 IPv6 方括号与端口', () => {
    expect(normalizeHost('[::1]:8788')).toBe('::1');
    expect(normalizeHost('[::1]')).toBe('::1');
  });

  it('空值返回空串（不抛异常，交由上层 fail-closed）', () => {
    expect(normalizeHost(undefined)).toBe('');
    expect(normalizeHost('')).toBe('');
    expect(normalizeHost('   ')).toBe('');
  });

  it('IPv4 主机的端口同样被剥离', () => {
    expect(normalizeHost('127.0.0.1:8788')).toBe('127.0.0.1');
  });
});

describe('normalizeHostList', () => {
  it('支持逗号分隔、去重、忽略空白项', () => {
    expect(normalizeHostList(' localhost, 127.0.0.1 ,localhost, ')).toEqual([
      'localhost',
      '127.0.0.1',
    ]);
  });

  it('端口被规范化（同一主机不同端口视为同一面）', () => {
    expect(normalizeHostList('a.example.com:443,a.example.com')).toEqual(['a.example.com']);
  });
});

describe('isLoopbackHost', () => {
  it('识别回环与 .localhost 子域', () => {
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('127.0.0.1:8788')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('portal.localhost')).toBe(true);
  });

  it('真实域名不是回环', () => {
    expect(isLoopbackHost('admin.example.com')).toBe(false);
  });
});

describe('classifyHost', () => {
  it('按列表归类面', () => {
    expect(classifyHost('admin.example.com:443', cfg)).toBe('manage');
    expect(classifyHost('mcp.example.com', cfg)).toBe('mcp');
  });

  it('未登记的主机归 unknown（fail-closed 的前提）', () => {
    expect(classifyHost('evil.example.com', cfg)).toBe('unknown');
    expect(classifyHost(undefined, cfg)).toBe('unknown');
  });
});

describe('decideRequest — 面隔离双向拒绝（AC10.2 / AC10.3）', () => {
  it('在 MCP 域名上请求管理接口 → 拒绝', () => {
    for (const path of ['/admin/users', '/admin/api/users', '/admin']) {
      const decision = decideRequest('mcp.example.com', path, cfg);
      expect(decision.allow).toBe(false);
      expect(decision.reason).toBe('mcp-face-admin-path');
    }
  });

  it('在 MCP 域名上请求公开页与静态资源 → 拒绝', () => {
    expect(decideRequest('mcp.example.com', '/', cfg).allow).toBe(false);
    expect(decideRequest('mcp.example.com', '/assets/portal.css', cfg).reason).toBe(
      'mcp-face-path-not-allowed',
    );
  });

  it('在管理域名上请求 /mcp 端点 → 拒绝（含子路径）', () => {
    expect(decideRequest('admin.example.com', '/mcp', cfg).reason).toBe('admin-face-mcp-path');
    expect(decideRequest('admin.example.com', '/mcp/session', cfg).reason).toBe(
      'admin-face-mcp-path',
    );
  });

  it('管理域名上的正常路径放行', () => {
    expect(decideRequest('admin.example.com', '/', cfg)).toMatchObject({
      allow: true,
      face: 'manage',
    });
    expect(decideRequest('admin.example.com', '/admin/users', cfg).allow).toBe(true);
    expect(decideRequest('localhost:8788', '/admin/users', cfg).allow).toBe(true);
  });

  it('MCP 域名上的 /mcp 放行（端点本身属该面）', () => {
    expect(decideRequest('mcp.example.com', '/mcp', cfg)).toMatchObject({
      allow: true,
      face: 'mcp',
    });
  });

  it('未登记 Host 一律拒绝', () => {
    expect(decideRequest('evil.example.com', '/', cfg)).toMatchObject({
      allow: false,
      face: 'unknown',
      reason: 'unknown-host',
    });
  });

  it('探活端点在任何面放行（容器 healthcheck 直连回环）', () => {
    expect(decideRequest(undefined, HEALTH_PATH, cfg).allow).toBe(true);
    expect(decideRequest('mcp.example.com', HEALTH_PATH, cfg).allow).toBe(true);
  });

  it('近似路径不被误判为管理面（前缀匹配按段边界）', () => {
    expect(decideRequest('admin.example.com', '/mcpx', cfg).allow).toBe(true);
    expect(decideRequest('mcp.example.com', '/administrator', cfg).reason).toBe(
      'mcp-face-path-not-allowed',
    );
  });
});
