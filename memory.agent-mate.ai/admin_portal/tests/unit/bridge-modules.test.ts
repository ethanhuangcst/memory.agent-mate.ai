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

/**
 * 造一个可观测的会话替身：记录 transport / upstream 各被关闭几次。
 *
 * `3.4` 起可指定 `startedAt` / `lastActivityAt` / `keyId` / `childPid` / `dbPath`
 * —— 到期判定（`reap`）是**吃 `now` 的纯方法**，用例直接喂时间戳，不 sleep。
 */
function fakeSession(
  id: string,
  handle = 'alice',
  opts: {
    transportCloseThrows?: boolean;
    upstreamCloseThrows?: boolean;
    startedAt?: number;
    lastActivityAt?: number;
    keyId?: number;
    childPid?: number | null;
  } = {},
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
      keyId: opts.keyId ?? 1,
      transport,
      upstream,
      startedAt: opts.startedAt ?? 0,
      lastActivityAt: opts.lastActivityAt ?? 0,
      childPid: opts.childPid ?? null,
      dbPath: `/data/users/${handle}/ai-memory.db`,
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

describe('SessionRegistry.reap（到期回收，3.4）', () => {
  it('未配置任何限额 ⇒ 不回收（取值归 4.1，本行不写死默认值）', async () => {
    const registry = new SessionRegistry();
    const { session, counters } = fakeSession('s1', 'alice', { startedAt: 0, lastActivityAt: 0 });
    registry.add(session);

    expect(await registry.reap(10_000_000, {})).toEqual([]);
    expect(registry.size).toBe(1);
    expect(counters.upstream).toBe(0);
  });

  it('空闲未到期 ⇒ 不回收', async () => {
    const registry = new SessionRegistry();
    registry.add(fakeSession('s1', 'alice', { startedAt: 0, lastActivityAt: 0 }).session);

    expect(await registry.reap(999, { idleMs: 1000 })).toEqual([]);
    expect(registry.size).toBe(1);
  });

  it('空闲到期 ⇒ 回收（返回被回收的 id，关传输与上游、注销条目）', async () => {
    const registry = new SessionRegistry();
    const { session, counters } = fakeSession('s1', 'alice', { startedAt: 0, lastActivityAt: 0 });
    registry.add(session);

    expect(await registry.reap(1000, { idleMs: 1000 })).toEqual(['s1']);
    expect(registry.size).toBe(0);
    expect(counters.transport).toBe(1);
    expect(counters.upstream).toBe(1);
  });

  it('超最长时长 ⇒ 回收（**即使刚活动过** —— 两者独立判定）', async () => {
    const registry = new SessionRegistry();
    registry.add(
      fakeSession('s1', 'alice', { startedAt: 0, lastActivityAt: 999 }).session,
    );

    expect(await registry.reap(1000, { maxMs: 1000 })).toEqual(['s1']);
  });

  it('两个限额同时到期 ⇒ 只回收一次（不重复 close）', async () => {
    const registry = new SessionRegistry();
    const { session, counters } = fakeSession('s1', 'alice', { startedAt: 0, lastActivityAt: 0 });
    registry.add(session);

    expect(await registry.reap(5000, { idleMs: 1000, maxMs: 2000 })).toEqual(['s1']);
    expect(counters.transport).toBe(1);
    expect(counters.upstream).toBe(1);
  });

  it('只回收到期者，未到期的会话留存且不受影响', async () => {
    const registry = new SessionRegistry();
    const fresh = fakeSession('fresh', 'alice', { startedAt: 1000, lastActivityAt: 1000 });
    const stale = fakeSession('stale', 'bob', { startedAt: 0, lastActivityAt: 0 });
    registry.add(fresh.session);
    registry.add(stale.session);

    expect(await registry.reap(1500, { idleMs: 1000 })).toEqual(['stale']);
    expect(registry.size).toBe(1);
    expect(registry.get('fresh')).toBe(fresh.session);
    expect(fresh.counters.upstream).toBe(0);
    expect(stale.counters.upstream).toBe(1);
  });

  it('到期与「已关闭」不重复回收：先被关掉的会话不会出现在返回列表里', async () => {
    const registry = new SessionRegistry();
    const { session } = fakeSession('s1', 'alice', { startedAt: 0, lastActivityAt: 0 });
    registry.add(session);

    await registry.close(session); // 例如客户端先断开

    expect(await registry.reap(10_000, { idleMs: 1000 })).toEqual([]);
  });

  it('关闭失败不抛出（回收路径必须尽力而为）', async () => {
    const registry = new SessionRegistry();
    const { session } = fakeSession('s1', 'alice', {
      startedAt: 0,
      lastActivityAt: 0,
      transportCloseThrows: true,
      upstreamCloseThrows: true,
    });
    registry.add(session);

    await expect(registry.reap(1000, { idleMs: 1000 })).resolves.toEqual(['s1']);
    expect(registry.size).toBe(0);
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
