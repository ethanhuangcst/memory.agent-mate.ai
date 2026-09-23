/**
 * 桥模块的单元测试（Sprint 4 `3.1`）—— 会话注册表与进程装配层的**纯逻辑**部分。
 *
 * 端到端行为在 `tests/integration/mcp-bridge.test.ts`；这里覆盖那些
 * 「只有直接调用才会走到」的分支：注册表 API、关闭顺序、spawn 失败路径。
 */

import { describe, expect, it, vi } from 'vitest';
import { SessionRegistry, type BridgeSession } from '../../src/bridge/session';
import { spawnUpstream } from '../../src/bridge/spawn';
import type { UpstreamSession } from '../../src/bridge/spawn';
import type { BridgeTransport } from '../../src/bridge/transport';

/** 造一个可观测的会话替身：记录 transport / upstream 各被关闭几次。 */
function fakeSession(
  id: string,
  handle = 'alice',
  opts: { transportCloseThrows?: boolean; upstreamCloseThrows?: boolean } = {},
): { session: BridgeSession; counters: { transport: number; upstream: number } } {
  const counters = { transport: 0, upstream: 0 };
  const transport: BridgeTransport = {
    sessionId: id,
    isClosed: () => false,
    handleRequest: async () => undefined,
    async close() {
      counters.transport += 1;
      if (opts.transportCloseThrows) throw new Error('transport close boom');
    },
  };
  const upstream = {
    client: {},
    commandLine: 'fake',
    stderrTail: () => '',
    async close() {
      counters.upstream += 1;
      if (opts.upstreamCloseThrows) throw new Error('upstream close boom');
    },
  } as unknown as UpstreamSession;

  return {
    session: {
      id,
      handle,
      userId: 1,
      keyId: 1,
      transport,
      upstream,
      startedAt: 0,
      lastActivityAt: 0,
    },
    counters,
  };
}

describe('SessionRegistry（会话注册表）', () => {
  it('登记 / 查询 / 移除 / 计数 / 句柄列表', () => {
    const registry = new SessionRegistry();
    const { session } = fakeSession('s1', 'alice');

    expect(registry.size).toBe(0);
    expect(registry.get('s1')).toBeUndefined();

    registry.add(session);
    expect(registry.size).toBe(1);
    expect(registry.get('s1')).toBe(session);
    expect(registry.handles()).toEqual(['alice']);

    expect(registry.remove('s1')).toBe(session);
    expect(registry.size).toBe(0);
    // 再移除同一个 id ⇒ undefined（幂等，不抛）
    expect(registry.remove('s1')).toBeUndefined();
  });

  it('close：先关传输侧、再关上游，并移除条目', async () => {
    const registry = new SessionRegistry();
    const { session, counters } = fakeSession('s1');
    registry.add(session);

    await registry.close(session);

    expect(counters.transport).toBe(1);
    expect(counters.upstream).toBe(1);
    expect(registry.size).toBe(0);
  });

  it('close：关闭失败不抛出（回收路径必须尽力而为）', async () => {
    const registry = new SessionRegistry();
    const { session, counters } = fakeSession('s1', 'alice', {
      transportCloseThrows: true,
      upstreamCloseThrows: true,
    });
    registry.add(session);

    await expect(registry.close(session)).resolves.toBeUndefined();
    // 两次关闭都被尝试过（前一步失败不阻断后一步）。
    expect(counters.transport).toBe(1);
    expect(counters.upstream).toBe(1);
    expect(registry.size).toBe(0);
  });

  it('closeAll：关闭全部并清空', async () => {
    const registry = new SessionRegistry();
    const a = fakeSession('s1', 'alice');
    const b = fakeSession('s2', 'bob');
    registry.add(a.session);
    registry.add(b.session);

    await registry.closeAll();

    expect(registry.size).toBe(0);
    expect(a.counters.upstream).toBe(1);
    expect(b.counters.upstream).toBe(1);
  });
});

describe('spawnUpstream（进程装配层）的失败路径', () => {
  it('命令不存在 ⇒ 抛错，且不留下半成品（上游不可用 ⇒ 调用方回 503）', async () => {
    const logger = { error: vi.fn() };
    await expect(
      spawnUpstream({
        handle: 'alice',
        launchOverride: 'definitely-not-a-real-command-xyz',
        logger,
      }),
    ).rejects.toThrow();
    // 失败要留痕（service 侧据此写审计行）。
    expect(logger.error).toHaveBeenCalled();
  }, 20_000);

  it('命令前缀为空白 ⇒ 渲染阶段即拒绝（不静默退回内建二进制）', async () => {
    await expect(
      spawnUpstream({ handle: 'alice', launchOverride: '   ' }),
    ).rejects.toThrow(/命令前缀为空/);
  });
});
