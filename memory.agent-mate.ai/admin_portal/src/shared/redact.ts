/**
 * 脱敏唯一出口 —— 日志与审计共用，避免两处规则漂移（web-design.md §12.8 / T8）。
 *
 * 纪律：
 *  - **只记 `key_prefix`**（`memo_` + 后随 8 字符，共 13 字符），从不记明文；
 *  - 明文令牌（共 43 字符）与「长于前缀的碎片」都应被抹除；
 *  - 请求头、错误信息、审计 detail 一律经此文件。
 */

export const TOKEN_PREFIX = 'memo_';
const PREFIX_BODY_LENGTH = 8;
/** 完整明文 = `memo_` + 38 字符（32 字节 base64url 无填充）。阈值取 20 以免把 `key_prefix` 也抹掉。 */
const SECRET_PATTERN = new RegExp(`${TOKEN_PREFIX}[A-Za-z0-9_-]{20,}`, 'g');

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'cf-access-client-secret',
  'cf-access-jwt-assertion',
]);

/** 取展示用前缀：`memo_` + 后随前 8 字符（§4.1）。输入非令牌时按原样截断为前缀形态。 */
export function keyPrefixOf(token: string): string {
  return `${TOKEN_PREFIX}${token.slice(TOKEN_PREFIX.length, TOKEN_PREFIX.length + PREFIX_BODY_LENGTH)}`;
}

/** 抹除文本中的令牌明文（保留 `key_prefix` 形态，便于对账）。 */
export function redactText(input: string): string {
  return input.replace(SECRET_PATTERN, (match) => `${keyPrefixOf(match)}***`);
}

/** 抹除对象中所有字符串值的令牌明文（含错误对象的消息）。 */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as unknown as T;
  // Date / Buffer 不能按普通对象展开（否则会变成 {} 或数字键对象），原样返回
  if (value instanceof Date || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? '[redacted]' : redactDeep(item);
    }
    return out as unknown as T;
  }
  return value;
}

/** 请求头脱敏：敏感头整值抹除，其余值做明文扫描。 */
export function redactHeaders(headers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase())
      ? '[redacted]'
      : typeof value === 'string'
        ? redactText(value)
        : value;
  }
  return out;
}
