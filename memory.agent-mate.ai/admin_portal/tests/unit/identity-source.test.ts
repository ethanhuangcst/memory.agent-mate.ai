/**
 * 生产身份来源护栏（G3）—— TDD 阶段 0：**先红**。
 *
 * 口径（用户决定）：**生产环境出现非 Cloudflare 身份即失败**。
 * 关键细节：Service Token **本身是 Cloudflare 签发的身份**（Access 为它注入断言，只是没有 email、
 * 只有 `common_name`）⇒ 护栏必须**允许 `service-token`**，否则会误伤自动化路径。
 * 因此护栏针对的是**通道**：生产只接受 `access-jwt` 与 `service-token`，拒绝 `test-jwt`。
 */

import { describe, expect, it } from 'vitest';
import { isIdentitySourceAllowed } from '../../src/web/admin-guard';

describe('生产身份来源护栏（G3）', () => {
  it('T3a 生产环境：只允许 Cloudflare 通道（access-jwt / service-token），拒绝自签来源', () => {
    expect(isIdentitySourceAllowed(true, 'access-jwt')).toBe(true);
    expect(isIdentitySourceAllowed(true, 'service-token')).toBe(true);
    expect(isIdentitySourceAllowed(true, 'test-jwt')).toBe(false);
  });

  it('T3b 开发环境：允许自签来源（本机开发必须不依赖 Cloudflare 也能登录）', () => {
    expect(isIdentitySourceAllowed(false, 'access-jwt')).toBe(true);
    expect(isIdentitySourceAllowed(false, 'service-token')).toBe(true);
    expect(isIdentitySourceAllowed(false, 'test-jwt')).toBe(true);
  });
});
