/**
 * `memo_` 令牌原语（纯逻辑 + 加密原语）。
 *
 * 依据 specs/web-portal/web-design.md §4.1 与 web-stories `AC2.1`/`AC2.2`：
 *  - 格式：`memo_` + 32 字节 CSPRNG → base64url **无填充**，含前缀共 **43 字符**
 *  - 存储：**只存** `sha256(token)` 与 `key_prefix`（`memo_` + 后随 8 字符），**无明文列**
 *  - 比较：**常时比较**（`timingSafeEqual`）；认证判定**只看摘要**，
 *    `key_prefix` 仅用于展示与对账 ⇒ 天然不存在「按前缀提前返回」的时序旁路
 *  - 明文只在本模块产生与校验，其余模块只能拿到摘要与前缀
 */

import crypto from 'node:crypto';
import { keyPrefixOf, TOKEN_PREFIX } from './redact';

export const TOKEN_BYTES = 32;
/**
 * 32 字节 → base64url 无填充 = **43 字符**（§4.1 的「43 字符」指编码部分，不含 `memo_`）。
 * 明文总长 = 前缀 5 + 43 = **48**。
 */
export const TOKEN_BODY_LENGTH = 43;
export const TOKEN_LENGTH = TOKEN_PREFIX.length + TOKEN_BODY_LENGTH;
export const TOKEN_HASH_BYTES = 32;

export interface MintedToken {
  /** 明文 —— **只在签发响应中出现一次**（AC2.1）。 */
  readonly plaintext: string;
  readonly keyPrefix: string;
  readonly keyHash: Buffer;
}

export function hashToken(token: string): Buffer {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

/** 生成一把新令牌（权限位、展示前缀、摘要一次性产出）。 */
export function mintToken(randomBytes: typeof crypto.randomBytes = crypto.randomBytes): MintedToken {
  const plaintext = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
  return {
    plaintext,
    keyPrefix: keyPrefixOf(plaintext),
    keyHash: hashToken(plaintext),
  };
}

/** 形状校验：`memo_` + 43 字符 base64url（共 48 字符）。 */
export function isWellFormedToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === TOKEN_LENGTH &&
    value.startsWith(TOKEN_PREFIX) &&
    /^[A-Za-z0-9_-]{43}$/.test(value.slice(TOKEN_PREFIX.length))
  );
}

/** 常时比较两个摘要（长度不符直接判否，长度本身不是秘密）。 */
export function hashesEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 从 `Authorization` 头解析 Bearer 令牌；不规范返回 undefined。 */
export function parseBearerToken(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  return match?.[1];
}
