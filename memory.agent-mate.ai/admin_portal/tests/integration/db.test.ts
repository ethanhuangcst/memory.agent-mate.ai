import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { currentVersion, migrate, MIGRATIONS, pendingVersions } from '../../src/web/db/migrate';
import {
  countUsers,
  disableUser,
  findUserByHandle,
  insertUser,
  listUsers,
} from '../../src/web/db/repo/users';
import {
  countActiveKeysForUser,
  findKeyByHash,
  findKeyByPrefix,
  insertKey,
  listKeysByUser,
  revokeActiveKeysForUser,
  revokeKeyById,
} from '../../src/web/db/repo/keys';

let db: Database.Database;

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
});

afterEach(() => {
  db.close();
});

function columnNames(table: string): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.map((row) => row.name);
}

describe('迁移（前向-only，schema_version 驱动）', () => {
  it('首次迁移后版本为最新且记录了名称', () => {
    expect(currentVersion(db)).toBe(MIGRATIONS.length);
    const rows = db.prepare('SELECT version, name FROM schema_version ORDER BY version').all() as {
      version: number;
      name: string;
    }[];
    expect(rows).toEqual([{ version: 1, name: 'initial' }]);
  });

  it('重复迁移幂等（不重复建表、不重复记账）', () => {
    const result = migrate(db);
    expect(result.from).toBe(1);
    expect(result.to).toBe(1);
    expect(result.applied).toEqual([]);
    expect(pendingVersions(db)).toEqual([]);
  });

  it('建出三张业务表', () => {
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(tables).toContain('users');
    expect(tables).toContain('keys');
    expect(tables).toContain('audit');
  });
});

describe('schema 纪律（可机械核对）', () => {
  it('keys 表没有任何明文列（AC2.2 / TC-P-L0-04）', () => {
    const columns = columnNames('keys');
    expect(columns).toContain('key_hash');
    expect(columns).toContain('key_prefix');
    for (const column of columns) {
      expect(column).not.toMatch(/plain|token|secret|raw/i);
    }
  });

  it('按 §12.6 建出规定索引（认证热路径唯一索引在内）', () => {
    const indexes = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as { name: string }[]
    ).map((row) => row.name);
    expect(indexes).toEqual(
      expect.arrayContaining(['idx_keys_key_hash', 'idx_keys_user_id', 'idx_audit_ts', 'idx_audit_actor']),
    );
  });

  it('key_hash 唯一约束生效（同一摘要不能落两行）', () => {
    const user = insertUser(db, { handle: 'alice' });
    const hash = Buffer.from('a'.repeat(32));
    insertKey(db, { userId: user.id, keyHash: hash, keyPrefix: 'memo_a1b2c3d4' });
    expect(() =>
      insertKey(db, { userId: user.id, keyHash: hash, keyPrefix: 'memo_a1b2c3d4' }),
    ).toThrow(/UNIQUE/i);
  });

  it('handle 唯一约束生效', () => {
    insertUser(db, { handle: 'alice' });
    expect(() => insertUser(db, { handle: 'alice' })).toThrow(/UNIQUE/i);
  });
});

describe('用户仓储', () => {
  it('创建后可按键与 handle 取回，状态为 active', () => {
    const created = insertUser(db, { handle: 'alice', displayName: 'Alice' });
    expect(created.status).toBe('active');
    expect(created.revoked_at).toBeNull();
    expect(findUserByHandle(db, 'alice')?.id).toBe(created.id);
    expect(findUserByHandle(db, 'bob')).toBeUndefined();
  });

  it('列表的令牌数聚合正确，且无令牌用户为 0（LEFT JOIN 不产生幽灵计数）', () => {
    const alice = insertUser(db, { handle: 'alice' });
    insertUser(db, { handle: 'bob' });
    insertKey(db, { userId: alice.id, keyHash: Buffer.from('1'.repeat(32)), keyPrefix: 'memo_11111111' });
    const revoked = insertKey(db, {
      userId: alice.id,
      keyHash: Buffer.from('2'.repeat(32)),
      keyPrefix: 'memo_22222222',
    });
    revokeKeyById(db, revoked.id, '2026-09-22T00:00:00.000Z');

    const rows = listUsers(db, { limit: 10, offset: 0 });
    expect(rows.map((row) => row.handle)).toEqual(['alice', 'bob']);
    const aliceRow = rows.find((row) => row.handle === 'alice');
    const bobRow = rows.find((row) => row.handle === 'bob');
    expect(aliceRow?.key_count).toBe(2);
    expect(aliceRow?.active_key_count).toBe(1);
    expect(bobRow?.key_count).toBe(0);
    expect(bobRow?.active_key_count).toBe(0);
    expect(countUsers(db)).toBe(2);
  });

  it('分页按 handle 升序且遵守 limit/offset', () => {
    for (const handle of ['alice', 'bob', 'carol']) insertUser(db, { handle });
    expect(listUsers(db, { limit: 2, offset: 0 }).map((row) => row.handle)).toEqual(['alice', 'bob']);
    expect(listUsers(db, { limit: 2, offset: 2 }).map((row) => row.handle)).toEqual(['carol']);
  });

  it('停用可逆：置 disabled + revoked_at，重复停用不再生效（D13）', () => {
    insertUser(db, { handle: 'alice' });
    expect(disableUser(db, 'alice', '2026-09-22T00:00:00.000Z')).toBe(true);
    expect(disableUser(db, 'alice', '2026-09-22T00:01:00.000Z')).toBe(false);
    const user = findUserByHandle(db, 'alice');
    expect(user?.status).toBe('disabled');
    expect(user?.revoked_at).toBe('2026-09-22T00:00:00.000Z');
  });
});

describe('令牌仓储', () => {
  it('按摘要与前缀定位；前缀查找限定在用户内', () => {
    const alice = insertUser(db, { handle: 'alice' });
    const bob = insertUser(db, { handle: 'bob' });
    const hash = Buffer.from('3'.repeat(32));
    insertKey(db, { userId: alice.id, keyHash: hash, keyPrefix: 'memo_33333333', label: 'MacBook' });

    expect(findKeyByHash(db, hash)?.label).toBe('MacBook');
    expect(findKeyByHash(db, Buffer.from('4'.repeat(32)))).toBeUndefined();
    expect(findKeyByPrefix(db, alice.id, 'memo_33333333')?.user_id).toBe(alice.id);
    expect(findKeyByPrefix(db, bob.id, 'memo_33333333')).toBeUndefined();
  });

  it('列表按创建时间倒序', () => {
    const alice = insertUser(db, { handle: 'alice' });
    insertKey(db, {
      userId: alice.id,
      keyHash: Buffer.from('5'.repeat(32)),
      keyPrefix: 'memo_55555555',
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    insertKey(db, {
      userId: alice.id,
      keyHash: Buffer.from('6'.repeat(32)),
      keyPrefix: 'memo_66666666',
      createdAt: '2026-09-10T00:00:00.000Z',
    });
    expect(listKeysByUser(db, alice.id).map((row) => row.key_prefix)).toEqual([
      'memo_66666666',
      'memo_55555555',
    ]);
  });

  it('吊销是软吊销：行保留、revoked_at 落下、重复吊销不再生效（AC2.6）', () => {
    const alice = insertUser(db, { handle: 'alice' });
    const key = insertKey(db, {
      userId: alice.id,
      keyHash: Buffer.from('7'.repeat(32)),
      keyPrefix: 'memo_77777777',
    });
    expect(revokeKeyById(db, key.id, '2026-09-22T00:00:00.000Z')).toBe(true);
    expect(revokeKeyById(db, key.id, '2026-09-22T00:01:00.000Z')).toBe(false);
    const rows = listKeysByUser(db, alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revoked_at).toBe('2026-09-22T00:00:00.000Z');
    expect(countActiveKeysForUser(db, alice.id)).toBe(0);
  });

  it('批量吊销返回受影响行数且只动未吊销者（停用用户）', () => {
    const alice = insertUser(db, { handle: 'alice' });
    for (const [index, prefix] of ['8', '9', 'a'].entries()) {
      insertKey(db, {
        userId: alice.id,
        keyHash: Buffer.from(prefix.repeat(32)),
        keyPrefix: `memo_${prefix.repeat(8)}`,
        createdAt: `2026-09-0${index + 1}T00:00:00.000Z`,
      });
    }
    const first = listKeysByUser(db, alice.id)[0];
    revokeKeyById(db, first!.id, '2026-09-21T00:00:00.000Z');

    expect(revokeActiveKeysForUser(db, alice.id, '2026-09-22T00:00:00.000Z')).toBe(2);
    expect(countActiveKeysForUser(db, alice.id)).toBe(0);
  });

  it('删除用户级联删除其令牌（外键开启）', () => {
    const alice = insertUser(db, { handle: 'alice' });
    insertKey(db, { userId: alice.id, keyHash: Buffer.from('b'.repeat(32)), keyPrefix: 'memo_bbbbbbbb' });
    db.prepare('DELETE FROM users WHERE id = ?').run(alice.id);
    expect(listKeysByUser(db, alice.id)).toHaveLength(0);
  });
});
