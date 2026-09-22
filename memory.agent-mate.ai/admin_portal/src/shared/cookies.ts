/**
 * Cookie 解析与序列化（零依赖）。
 *
 * 为什么不装 `@fastify/cookie`：门户只需要读两个 cookie（Access 的 `CF_Authorization`
 * 与语言选择）并写一个语言 cookie，没必要为此引入插件与额外解析路径。手写实现有测试覆盖。
 */

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    out[name] = part.slice(index + 1).trim();
  }
  return out;
}

export interface CookieOptions {
  readonly path?: string;
  readonly maxAge?: number;
  readonly httpOnly?: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
  readonly secure?: boolean;
}

export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${value}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
