/**
 * spawn 前置断言的单元测试（Sprint 4 `3.2`）。
 *
 * 依据 `mcp-design.md` §5.6.4 的不变量 1 / 2 与 `web-design.md` §12.5 的「spawn 前断言失败」行。
 *
 * **为什么这些判据必须在单测里覆盖**：五支判定中有两支**在集成层不可达** ——
 * `empty`（`AI_MEMORY_DB` 由内建模板渲染，不可能为空）与 `invalid_handle`
 * （不合规 handle 在签发链路就被 `userDirectory()` 拦下、令牌签不出来）。
 * 这正是「判定必须抽成导出的纯函数」的理由本身（对照 `route.ts` 的 `classifyRelayFailure`）。
 *
 * 判据表来自本行开工前置的实测：**三项字面断言会放过全部已知坏输入**，
 * 必须在 `path.posix.normalize` 之后判定。
 */

import { describe, expect, it } from 'vitest';
import { checkUserDbPath, spawnAssertionError } from '../../src/bridge/user-db-path';

describe('AI_MEMORY_DB 的 fail-closed 断言（3.2）', () => {
  it('正向：该 handle 的库路径通过', () => {
    expect(checkUserDbPath('/data/users/alice/ai-memory.db', 'alice')).toEqual({ ok: true });
  });

  it('handle 非法 ⇒ invalid_handle（不变量 1 的 spawn 侧复述；集成层不可达）', () => {
    // 空 handle 这条尤其要测：它一旦到了 spawn，库会落到 `/data/users/ai-memory.db`
    // —— users 根下的**共享库**（隔离静默失效，正是 RID `D1` 要拦的形态）。
    expect(checkUserDbPath('/data/users//ai-memory.db', '')).toEqual({
      ok: false,
      reason: 'invalid_handle',
    });
    expect(checkUserDbPath('/data/users/Alice!/ai-memory.db', 'Alice!')).toEqual({
      ok: false,
      reason: 'invalid_handle',
    });
    const tooLong = 'a'.repeat(33);
    expect(checkUserDbPath(`/data/users/${tooLong}/ai-memory.db`, tooLong)).toEqual({
      ok: false,
      reason: 'invalid_handle',
    });
    expect(checkUserDbPath('/data/users/../bob/ai-memory.db', '../bob')).toEqual({
      ok: false,
      reason: 'invalid_handle',
    });
  });

  it('库路径为空 ⇒ empty（模板是内建常量 ⇒ 集成层不可达，只能在这里覆盖）', () => {
    expect(checkUserDbPath('', 'alice')).toEqual({ ok: false, reason: 'empty' });
    // 缺键（undefined）与空串同归一支 —— 两者对「路径不可信」是同一件事。
    expect(checkUserDbPath(undefined, 'alice')).toEqual({ ok: false, reason: 'empty' });
  });

  it('归一化后越出 /data/users/ ⇒ outside_users_root（字面判定会放过）', () => {
    // 前两条的字面路径**都以 `/data/users/` 开头** ⇒ 不归一化就判不出来。
    expect(checkUserDbPath('/data/users/../bob/ai-memory.db', 'bob')).toEqual({
      ok: false,
      reason: 'outside_users_root',
    });
    expect(checkUserDbPath('/data/users/../../x/ai-memory.db', 'x')).toEqual({
      ok: false,
      reason: 'outside_users_root',
    });
    expect(checkUserDbPath('/tmp/alice/ai-memory.db', 'alice')).toEqual({
      ok: false,
      reason: 'outside_users_root',
    });
  });

  it('归一化后指向**他人**库 ⇒ handle_mismatch（AC4.7 的判据核心）', () => {
    // 判定顺序是**先 handle、后路径**（见实现注释）：含 `/` 的输入会先被 `validateHandle`
    // 拦下、归 `invalid_handle` —— 那是**更精确的根因**（问题出在 handle 本身）。
    // `handle_mismatch` 留给「handle 合法、而路径指向别人」这一支（模板被改错时的形态）。
    expect(checkUserDbPath('/data/users/bob/ai-memory.db', 'alice')).toEqual({
      ok: false,
      reason: 'handle_mismatch',
    });

    // 同一输入在**字面判定**下三项全过（`/data/users/alice/../bob/ai-memory.db` 确实以
    // `/data/users/` 开头、也确实含 `alice/../bob`）——归一化之后才暴露成 `/data/users/bob/…`。
    // 它归 `invalid_handle`（handle 先被拦），但**拦得住**才是这条用例真正要证的事。
    expect(checkUserDbPath('/data/users/alice/../bob/ai-memory.db', 'alice/../bob')).toEqual({
      ok: false,
      reason: 'invalid_handle',
    });
  });

  it('抛出的错误上挂着 reason（route.ts 靠它把 500 与 503 分开），且消息里不带路径', () => {
    const error = spawnAssertionError('handle_mismatch');

    expect(error).toBeInstanceOf(Error);
    expect((error as { reason?: unknown }).reason).toBe('handle_mismatch');
    // 消息可能被调用方写进日志 ⇒ 同样不得落下路径（§12.5 的「审计不记路径」定档，同一口径）。
    expect(error.message).not.toContain('/data/users/');
  });
});
