import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { countAudit, insertAudit, listAudit } from '../../src/web/db/repo/audit';
import { countUsers, findUserByHandle, insertUser } from '../../src/web/db/repo/users';
import { withAudit } from '../../src/shared/audit';

let db: Database.Database;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
});

afterEach(() => {
  db.close();
});

const FULL_TOKEN = `memo_${'Ab3'.repeat(12)}CdEf`; // memo_ + 38 字符

describe('withAudit — 业务写与审计写同事务', () => {
  it('成功路径：业务写与审计行一并提交', () => {
    const id = withAudit(
      db,
      { actor: 'admin@example.com', action: 'create_user', target: 'alice' },
      () => insertUser(db, { handle: 'alice' }).id,
    );

    expect(findUserByHandle(db, 'alice')?.id).toBe(id);
    const rows = listAudit(db, { limit: 10, offset: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'admin@example.com', action: 'create_user', target: 'alice' });
  });

  it('业务写抛错 ⇒ 整体回滚且不留审计（失败的动作不留痕）', () => {
    expect(() =>
      withAudit(db, { actor: 'admin@example.com', action: 'create_user', target: 'alice' }, () => {
        insertUser(db, { handle: 'alice' });
        throw new Error('目录创建失败');
      }),
    ).toThrow('目录创建失败');

    expect(findUserByHandle(db, 'alice')).toBeUndefined();
    expect(countAudit(db, {})).toBe(0);
  });

  it('审计写失败 ⇒ 业务写一并回滚（fail-closed：无审计不动作）', () => {
    expect(() =>
      withAudit(
        db,
        // actor 为 NULL 会触发 NOT NULL 约束失败 —— 模拟审计写不进去
        { actor: null as unknown as string, action: 'create_user', target: 'alice' },
        () => insertUser(db, { handle: 'alice' }),
      ),
    ).toThrow(/NOT NULL/i);

    expect(countUsers(db)).toBe(0);
    expect(countAudit(db, {})).toBe(0);
  });

  it('一个动作可写多条审计（例如轮换 = 吊销旧 + 签发新）', () => {
    const alice = insertUser(db, { handle: 'alice' });
    withAudit(
      db,
      [
        { actor: 'admin@example.com', action: 'issue_key', target: 'alice:memo_11111111' },
        { actor: 'admin@example.com', action: 'revoke_key', target: 'alice:memo_22222222' },
      ],
      () => alice.id,
    );
    expect(countAudit(db, {})).toBe(2);
    expect(listAudit(db, { action: 'issue_key', limit: 10, offset: 0 })).toHaveLength(1);
  });

  it('detail 一律脱敏：令牌明文不落审计（T8 / AC2.8）', () => {
    withAudit(
      db,
      {
        actor: 'admin@example.com',
        action: 'issue_key',
        target: 'alice',
        detail: { key_prefix: 'memo_a1b2c3d4', copied: FULL_TOKEN },
      },
      () => undefined,
    );

    const [row] = listAudit(db, { limit: 1, offset: 0 });
    expect(row).toBeDefined();
    expect(row?.detail_json).not.toContain(FULL_TOKEN);
    expect(row?.detail_json).toContain('memo_a1b2c3d4');
  });

  it('写出包含内部细节的 detail 也不会泄漏明文（防调用方漏脱敏）', () => {
    insertAudit(db, {
      actor: 'admin@example.com',
      action: 'issue_key',
      target: 'alice',
      detail: { error: `failed to store ${FULL_TOKEN}` },
    });
    const [row] = listAudit(db, { limit: 1, offset: 0 });
    expect(row?.detail_json).not.toContain(FULL_TOKEN);
  });
});

describe('审计检索', () => {
  it('按 actor / action 过滤，并按时间倒序分页', () => {
    insertAudit(db, { actor: 'a@example.com', action: 'create_user', target: 'alice', ts: '2026-09-20T00:00:00.000Z' });
    insertAudit(db, { actor: 'a@example.com', action: 'issue_key', target: 'alice', ts: '2026-09-21T00:00:00.000Z' });
    insertAudit(db, { actor: 'b@example.com', action: 'create_user', target: 'bob', ts: '2026-09-22T00:00:00.000Z' });

    expect(countAudit(db, {})).toBe(3);
    expect(countAudit(db, { actor: 'a@example.com' })).toBe(2);
    expect(countAudit(db, { action: 'create_user' })).toBe(2);

    const firstPage = listAudit(db, { limit: 2, offset: 0 });
    expect(firstPage.map((row) => row.ts)).toEqual([
      '2026-09-22T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
    ]);
    const secondPage = listAudit(db, { limit: 2, offset: 2 });
    expect(secondPage.map((row) => row.ts)).toEqual(['2026-09-20T00:00:00.000Z']);
  });

  it('审计行保留 target 与 source_ip（可追责）', () => {
    insertAudit(db, {
      actor: 'admin@example.com',
      action: 'revoke_key',
      target: 'alice:memo_a1b2c3d4',
      sourceIp: '203.0.113.7',
    });
    const [row] = listAudit(db, { limit: 1, offset: 0 });
    expect(row?.target).toBe('alice:memo_a1b2c3d4');
    expect(row?.source_ip).toBe('203.0.113.7');
    expect(row?.detail_json).toBe('{}');
  });
});
