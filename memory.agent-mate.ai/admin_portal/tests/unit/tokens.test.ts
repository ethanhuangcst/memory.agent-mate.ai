import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashesEqual,
  hashToken,
  isWellFormedToken,
  mintToken,
  parseBearerToken,
  TOKEN_BODY_LENGTH,
  TOKEN_BYTES,
  TOKEN_HASH_BYTES,
  TOKEN_LENGTH,
} from '../../src/shared/tokens';
import { keyPrefixOf } from '../../src/shared/redact';

describe('mintToken — 格式与摘要（AC2.1 / §4.1）', () => {
  it('明文为 memo_ + 32 字节 CSPRNG 的 base64url 无填充（编码部分 43 字符，总计 48）', () => {
    const { plaintext } = mintToken();
    expect(TOKEN_BODY_LENGTH).toBe(43);
    expect(TOKEN_LENGTH).toBe(48);
    expect(plaintext).toHaveLength(TOKEN_LENGTH);
    expect(plaintext.startsWith('memo_')).toBe(true);
    expect(plaintext.slice(5)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(plaintext).not.toContain('=');
    // 43 字符 base64url 还原为 32 字节
    expect(Buffer.from(plaintext.slice(5), 'base64url')).toHaveLength(TOKEN_BYTES);
  });

  it('摘要为 sha256(明文)，长度 32 字节', () => {
    const minted = mintToken();
    expect(minted.keyHash).toHaveLength(TOKEN_HASH_BYTES);
    expect(minted.keyHash.equals(hashToken(minted.plaintext))).toBe(true);
    expect(minted.keyHash.equals(crypto.createHash('sha256').update(minted.plaintext).digest())).toBe(
      true,
    );
  });

  it('展示前缀为 memo_ + 后随 8 字符（可用于对账，不足以还原明文）', () => {
    const minted = mintToken();
    expect(minted.keyPrefix).toBe(keyPrefixOf(minted.plaintext));
    expect(minted.keyPrefix).toHaveLength(13);
    expect(minted.plaintext.startsWith(minted.keyPrefix)).toBe(true);
  });

  it('每次生成互不相同（CSPRNG）', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => mintToken().plaintext));
    expect(tokens.size).toBe(200);
  });
});

describe('hashToken — 确定性', () => {
  it('同一输入得到同一摘要，不同输入得到不同摘要', () => {
    const token = mintToken().plaintext;
    expect(hashToken(token).equals(hashToken(token))).toBe(true);
    expect(hashToken(token).equals(hashToken(`${token}x`))).toBe(false);
  });
});

describe('isWellFormedToken — 形状校验', () => {
  it('接受合法令牌', () => {
    expect(isWellFormedToken(mintToken().plaintext)).toBe(true);
  });

  it('拒绝长度不符、前缀不符、含非法字符与非字符串', () => {
    const valid = mintToken().plaintext;
    expect(isWellFormedToken(valid.slice(0, -1))).toBe(false);
    expect(isWellFormedToken(`${valid}x`)).toBe(false);
    expect(isWellFormedToken(valid.replace('memo_', 'meMo_'))).toBe(false);
    expect(isWellFormedToken(`memo_${'a'.repeat(43)}!`)).toBe(false);
    expect(isWellFormedToken('memo_short')).toBe(false);
    expect(isWellFormedToken(undefined)).toBe(false);
    expect(isWellFormedToken(12345)).toBe(false);
  });
});

describe('hashesEqual — 常时比较', () => {
  it('相等与不等都能正确判定', () => {
    const a = Buffer.from('a'.repeat(32));
    expect(hashesEqual(a, Buffer.from('a'.repeat(32)))).toBe(true);
    expect(hashesEqual(a, Buffer.from('b'.repeat(32)))).toBe(false);
  });

  it('长度不同直接判否（长度不是秘密，可在比较前判断）', () => {
    expect(hashesEqual(Buffer.from('a'.repeat(32)), Buffer.from('a'.repeat(31)))).toBe(false);
  });
});

describe('parseBearerToken', () => {
  it('解析标准 Bearer 头（大小写不敏感）', () => {
    expect(parseBearerToken('Bearer memo_abc')).toBe('memo_abc');
    expect(parseBearerToken('bearer memo_abc')).toBe('memo_abc');
  });

  it('缺失或不规范返回 undefined（不回落到其它头）', () => {
    expect(parseBearerToken(undefined)).toBeUndefined();
    expect(parseBearerToken('')).toBeUndefined();
    expect(parseBearerToken('memo_abc')).toBeUndefined();
    expect(parseBearerToken('Basic abc')).toBeUndefined();
    expect(parseBearerToken(['Bearer a', 'Bearer b'])).toBeUndefined();
  });
});
