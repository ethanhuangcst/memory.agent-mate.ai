/**
 * 转发阶段失败分类的单元测试（`3.8`）。
 *
 * 依据 `web-design.md` §12.5 的「转发阶段失败的分类定档」：`-32001` → **504** ·
 * `-32000` → **503** · 其余 → **502 `upstream_error`**。
 *
 * 三支都要覆盖，且刻意连「非 Error 值」也测 —— `catch` 里什么都可能被抛出来，
 * 而本仓的 `statements` 覆盖率余量只有 0.08（`vitest.config.ts` 阈值 92）。
 */

import { describe, expect, it } from 'vitest';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { BRIDGE_ERROR_CODES, classifyRelayFailure } from '../../src/bridge/route';

describe('转发阶段失败分类（§12.5 的三层口径）', () => {
  it('上游请求超时（-32001）⇒ 504 upstream_timeout', () => {
    const failure = classifyRelayFailure(new McpError(ErrorCode.RequestTimeout, 'timed out'));

    expect(failure).toEqual({ status: 504, code: BRIDGE_ERROR_CODES.upstreamTimeout });
  });

  it('上游连接已断（-32000）⇒ 503 upstream_unavailable（与 spawn 失败同形）', () => {
    const failure = classifyRelayFailure(new McpError(ErrorCode.ConnectionClosed, 'closed'));

    expect(failure).toEqual({ status: 503, code: BRIDGE_ERROR_CODES.upstreamUnavailable });
  });

  it('SDK / 桥的内部状态错误 ⇒ 502 upstream_error（不再伪装成「上游超时」）', () => {
    // 这是「3.8 之前」的误报形态：转发阶段的内部状态错误曾一律被报成 504 upstream_timeout，
    // 把排障引向「上游太慢」，而真相是桥自己出了状态错。
    const failure = classifyRelayFailure(new Error('Transport already started'));

    expect(failure).toEqual({ status: 502, code: BRIDGE_ERROR_CODES.upstreamError });
  });

  it('非 Error 值与畸形 code 都不炸：一律归 502', () => {
    expect(classifyRelayFailure(undefined)).toEqual({
      status: 502,
      code: BRIDGE_ERROR_CODES.upstreamError,
    });
    expect(classifyRelayFailure({ code: 'not-a-number' })).toEqual({
      status: 502,
      code: BRIDGE_ERROR_CODES.upstreamError,
    });
  });
});
