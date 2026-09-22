/**
 * 面隔离（Host 判定）—— 单点实现，纯函数、无 IO。
 *
 * 依据：specs/web-portal/web-design.md §12.3（路由表与按 Host 分面）
 *  ① 在 `<MCP_HOST>` 上命中任何管理路径或公开页 → 拒绝（AC10.2）
 *  ② 在 `<ADMIN_HOST>` 上命中 `/mcp` → 拒绝（AC10.3）
 *  ③ 两个域名分离、不靠 path 区分；判据是 **Host 头**，只比对主机名（忽略端口）
 *  ④ 未知 Host 一律拒绝（fail-closed）
 *
 * 本模块不依赖 Fastify、不读写文件，故可被离线测试与后续批次（bridge）直接复用。
 */

export type Face = 'manage' | 'mcp' | 'unknown';

export interface HostSplitConfig {
  readonly adminHosts: readonly string[];
  readonly mcpHosts: readonly string[];
}

export type FaceDecisionReason =
  | 'ok'
  | 'unknown-host'
  | 'admin-face-mcp-path'
  | 'mcp-face-admin-path'
  | 'mcp-face-path-not-allowed';

export interface FaceDecision {
  readonly allow: boolean;
  readonly face: Face;
  readonly reason: FaceDecisionReason;
}

/** 探活端点：不承载机密，任何面都放行（容器 healthcheck 直连 localhost 时 Host 非公开域名）。 */
export const HEALTH_PATH = '/healthz';

/**
 * 去掉端口与 IPv6 方括号，转小写。空值返回空串。
 *
 * 端口只在「恰好一个冒号」时剥离：多个冒号说明是**无方括号的 IPv6 字面量**（如 `::1`），
 * 若按首个冒号截断会把主机名切成空串。带端口的 IPv6 一律是 `[::1]:8788` 形式（走方括号分支）。
 */
export function normalizeHost(rawHost: string | undefined | null): string {
  if (!rawHost) return '';
  let host = rawHost.trim().toLowerCase();
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    host = end === -1 ? host.slice(1) : host.slice(1, end);
  } else {
    const firstColon = host.indexOf(':');
    if (firstColon !== -1 && firstColon === host.lastIndexOf(':')) {
      host = host.slice(0, firstColon);
    }
  }
  return host;
}

/** 逗号分隔的 Host 列表 → 规范化去重数组（本机开发可列 `localhost,127.0.0.1`）。 */
export function normalizeHostList(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const host = normalizeHost(part);
    if (host) seen.add(host);
  }
  return [...seen];
}

/** 回环地址判定（用于「非 Access 身份来源不得用于非本机」的自检）。 */
export function isLoopbackHost(host: string): boolean {
  const h = normalizeHost(host);
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.localhost');
}

/** 按 Host 归类面；未登记的主机归 unknown（fail-closed）。 */
export function classifyHost(rawHost: string | undefined, cfg: HostSplitConfig): Face {
  const host = normalizeHost(rawHost);
  if (!host) return 'unknown';
  if (cfg.adminHosts.includes(host)) return 'manage';
  if (cfg.mcpHosts.includes(host)) return 'mcp';
  return 'unknown';
}

function isPathWithin(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/**
 * 判定单个请求是否允许进入路由层。
 * 只做面判定，不做身份认证（认证在其后按面执行）。
 */
export function decideRequest(
  rawHost: string | undefined,
  pathname: string,
  cfg: HostSplitConfig,
): FaceDecision {
  const face = classifyHost(rawHost, cfg);
  const path = pathname || '/';

  if (path === HEALTH_PATH) return { allow: true, face, reason: 'ok' };

  if (face === 'unknown') return { allow: false, face, reason: 'unknown-host' };

  if (face === 'manage') {
    if (isPathWithin(path, '/mcp')) {
      return { allow: false, face, reason: 'admin-face-mcp-path' };
    }
    return { allow: true, face, reason: 'ok' };
  }

  // face === 'mcp'：只放行 MCP 端点本身
  if (isPathWithin(path, '/admin')) {
    return { allow: false, face, reason: 'mcp-face-admin-path' };
  }
  if (path !== '/mcp') {
    return { allow: false, face, reason: 'mcp-face-path-not-allowed' };
  }
  return { allow: true, face, reason: 'ok' };
}
