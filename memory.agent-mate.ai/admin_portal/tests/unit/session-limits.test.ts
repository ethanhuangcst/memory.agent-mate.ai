/**
 * `4.1`「web-portal:会话限流」的**纯判定**与**计数来源**单测。
 *
 * 为什么单测能覆盖得住：判定被刻意做成**纯函数**（吃计数与限额、返回决定）⇒ 五个分支直接喂数即可，
 * 不依赖起会话、不依赖时序（与 `3.4` 的 `SessionRegistry.reap(now, …)` 同一手法）。
 */
import { describe, expect, it } from 'vitest';
import { decideSessionLimit } from '../../src/bridge/limits';
import { SessionRegistry, type BridgeSession } from '../../src/bridge/session';

describe('decideSessionLimit（4.1 的纯判定）', () => {
  it('两个限额都未配置 ⇒ 恒放行（未配置即不启用，与 3.4 的两个会话超时同口径）', () => {
    expect(decideSessionLimit(999, 999, {})).toBeNull();
  });

  it('每 key 额度未满 ⇒ 放行', () => {
    expect(decideSessionLimit(3, 0, { perKey: 1, global: 8 })).toBeNull();
  });

  it('每 key 额度已满 ⇒ 报 per_key 与**被撞到的那个**上限', () => {
    expect(decideSessionLimit(1, 1, { perKey: 1 })).toEqual({ scope: 'per_key', limit: 1 });
  });

  it('每 key 未满但全局已满 ⇒ 报 global', () => {
    expect(decideSessionLimit(4, 1, { perKey: 5, global: 4 })).toEqual({
      scope: 'global',
      limit: 4,
    });
  });

  it('两者同时满 ⇒ **先报 per_key**（那是该用户自己能看懂、可操作的那条）', () => {
    expect(decideSessionLimit(4, 2, { perKey: 2, global: 4 })).toEqual({
      scope: 'per_key',
      limit: 2,
    });
  });
});

describe('SessionRegistry 的两个计数（4.1 判据的计数来源）', () => {
  /** 计数只关心 `id` / `keyId`；懒清理还要 `transport.isClosed()` ⇒ 最小替身（避免造真传输）。 */
  const session = (id: string, keyId: number, closed = false): BridgeSession =>
    ({ id, keyId, transport: { isClosed: () => closed } }) as unknown as BridgeSession;

  it('countAll 数全部、countByKey 只数该令牌（非同令牌的会话不计入）', () => {
    const registry = new SessionRegistry();
    registry.add(session('s1', 1));
    registry.add(session('s2', 1));
    registry.add(session('s3', 2));
    expect(registry.countAll()).toBe(3);
    expect(registry.countByKey(1)).toBe(2);
    expect(registry.countByKey(2)).toBe(1);
    expect(registry.countByKey(9)).toBe(0);
  });

  it('空注册表 ⇒ 两个计数都是 0（「未配置即放行」之外的另一个零值边界）', () => {
    const registry = new SessionRegistry();
    expect(registry.countAll()).toBe(0);
    expect(registry.countByKey(1)).toBe(0);
  });

  it('计数**现算**：摘掉一个会话后立刻反映出来（不依赖任何缓存/计数器）', () => {
    const registry = new SessionRegistry();
    registry.add(session('s1', 1));
    registry.add(session('s2', 1));
    registry.remove('s1');
    expect(registry.countAll()).toBe(1);
    expect(registry.countByKey(1)).toBe(1);
  });

  it('懒清理只剔「传输已关闭」的会话（活着的会话与计数都不受影响）', async () => {
    const registry = new SessionRegistry();
    registry.add(session('live', 1, false));
    registry.add(session('dead-1', 1, true));
    registry.add(session('dead-2', 2, true));

    const pruned = await registry.pruneClosed();

    expect(pruned).toBe(2);
    expect(registry.countAll()).toBe(1);
    expect(registry.countByKey(1)).toBe(1);
    expect(registry.countByKey(2)).toBe(0);
  });

  it('懒清理对「没有已关闭会话」的表是零副作用（可反复调用）', async () => {
    const registry = new SessionRegistry();
    registry.add(session('live', 1, false));
    expect(await registry.pruneClosed()).toBe(0);
    expect(await registry.pruneClosed()).toBe(0);
    expect(registry.countAll()).toBe(1);
  });
});
