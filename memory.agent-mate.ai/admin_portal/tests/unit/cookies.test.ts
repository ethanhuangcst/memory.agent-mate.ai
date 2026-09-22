/**
 * Cookie 解析与序列化单元测试（零依赖手写实现的边界）。
 *
 * 为什么手写也要测：这条代码路径直接处理**攻击者可控的请求头**（`Cookie`），
 * 解析上的宽松或截断错误会影响身份落点判断；序列化的属性漏写（如 HttpOnly）
 * 则是可被利用的降级。故边界逐个钉死。
 */

import { describe, expect, it } from 'vitest';
import { parseCookies, serializeCookie } from '../../src/shared/cookies';

describe('parseCookies', () => {
  it('空头 ⇒ 空对象（不抛错）', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('')).toEqual({});
  });

  it('常规多 cookie：按第一个 = 切分，值内再出现 = 不会被截断', () => {
    const parsed = parseCookies('a=1; portal_locale=zh-TW; CF_Authorization=eyJx=.sig');
    expect(parsed.a).toBe('1');
    expect(parsed.portal_locale).toBe('zh-TW');
    expect(parsed.CF_Authorization).toBe('eyJx=.sig');
  });

  it('忽略无 = 的片段与空名片段（不猜、不塞默认值）', () => {
    const parsed = parseCookies('lonely; =noname; ok=1; ; =');
    expect(parsed).toEqual({ ok: '1' });
  });

  it('去除名字与值两侧空白；空值保留为空串（与「缺键」区分开）', () => {
    const parsed = parseCookies('  spaced  =  v  ; empty=');
    expect(parsed.spaced).toBe('v');
    expect(parsed.empty).toBe('');
  });

  it('重名 cookie：后出现者覆盖（浏览器不会这样发，但解析需确定性）', () => {
    expect(parseCookies('a=1; a=2').a).toBe('2');
  });
});

describe('serializeCookie', () => {
  it('默认：Path=/、SameSite=Lax、带 HttpOnly', () => {
    expect(serializeCookie('portal_locale', 'zh-TW')).toBe(
      'portal_locale=zh-TW; Path=/; SameSite=Lax; HttpOnly',
    );
  });

  it('可覆盖 Path 与 SameSite，并在给定 maxAge / secure 时补齐属性', () => {
    const header = serializeCookie('k', 'v', {
      path: '/admin',
      maxAge: 3600,
      sameSite: 'Strict',
      secure: true,
    });
    expect(header).toBe('k=v; Path=/admin; Max-Age=3600; SameSite=Strict; HttpOnly; Secure');
  });

  it('httpOnly: false 时**不写** HttpOnly（语言等非凭据 cookie 供前端读取）', () => {
    expect(serializeCookie('portal_locale', 'en', { httpOnly: false })).not.toContain('HttpOnly');
  });

  it('maxAge=0 也写出（表示立刻过期，不能被当成「未设置」）', () => {
    expect(serializeCookie('k', 'v', { maxAge: 0 })).toContain('Max-Age=0');
  });

  it('SameSite=None 原样输出（大小写与拼写不被改写）', () => {
    expect(serializeCookie('k', 'v', { sameSite: 'None' })).toContain('SameSite=None');
  });
});
