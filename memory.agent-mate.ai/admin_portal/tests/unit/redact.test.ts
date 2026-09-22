import { describe, expect, it } from 'vitest';
import { keyPrefixOf, redactDeep, redactHeaders, redactText } from '../../src/shared/redact';

const FULL_TOKEN = `memo_${'A1b2C3d4'.repeat(4)}EfGhIj`; // memo_ + 38 字符（32 字节 base64url）

describe('keyPrefixOf', () => {
  it('取 memo_ + 后随前 8 字符（与原型展示口径一致）', () => {
    expect(keyPrefixOf('memo_a1b2c3d4e5f6g7h8')).toBe('memo_a1b2c3d4');
  });

  it('短输入不越界', () => {
    expect(keyPrefixOf('memo_x')).toBe('memo_x');
    expect(keyPrefixOf('')).toBe('memo_');
  });
});

describe('redactText', () => {
  it('抹除完整明文令牌，但保留可对账的前缀', () => {
    const output = redactText(`issued ${FULL_TOKEN} for alice`);
    expect(output).not.toContain(FULL_TOKEN);
    expect(output).toContain(`${keyPrefixOf(FULL_TOKEN)}***`);
  });

  it('长于前缀的碎片也要抹除（防截断日志泄漏）', () => {
    const fragment = `memo_${'Zz9'.repeat(8)}`; // 24 字符后随部分
    expect(redactText(`partial ${fragment}`)).not.toContain(fragment);
  });

  it('不误伤合法的前缀展示形态', () => {
    const prefix = 'memo_a1b2c3d4';
    expect(redactText(`prefix=${prefix}`)).toBe(`prefix=${prefix}`);
  });

  it('无令牌文本原样返回', () => {
    expect(redactText('no secrets here')).toBe('no secrets here');
  });

  it('一次调用抹除多处明文', () => {
    const output = redactText(`${FULL_TOKEN} and ${FULL_TOKEN}`);
    expect(output.match(/memo_[A-Za-z0-9_-]{20,}/g)).toBeNull();
  });
});

describe('redactDeep', () => {
  it('递归处理对象、数组与嵌套错误信息', () => {
    const input = {
      token: FULL_TOKEN,
      nested: { list: [FULL_TOKEN, 'safe'] },
      count: 3,
      flag: true,
    };
    const output = redactDeep(input);
    expect(output.token).not.toContain(FULL_TOKEN);
    expect(output.nested.list[0]).not.toContain(FULL_TOKEN);
    expect(output.nested.list[1]).toBe('safe');
    expect(output.count).toBe(3);
    expect(output.flag).toBe(true);
  });

  it('敏感请求头整值抹除', () => {
    const output = redactDeep({ authorization: `Bearer ${FULL_TOKEN}` });
    expect(output.authorization).toBe('[redacted]');
  });
});

describe('redactHeaders', () => {
  it('敏感头整值抹除，其余做明文扫描', () => {
    const output = redactHeaders({
      authorization: `Bearer ${FULL_TOKEN}`,
      'cf-access-client-secret': 'topsecret',
      'x-note': `carries ${FULL_TOKEN}`,
      'x-count': 2,
    });
    expect(output.authorization).toBe('[redacted]');
    expect(output['cf-access-client-secret']).toBe('[redacted]');
    expect(String(output['x-note'])).not.toContain(FULL_TOKEN);
    expect(output['x-count']).toBe(2);
  });
});
