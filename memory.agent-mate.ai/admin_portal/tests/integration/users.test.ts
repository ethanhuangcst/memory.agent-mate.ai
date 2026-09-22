import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { countAudit, listAudit } from '../../src/web/db/repo/audit';
import { countUsers, findUserByHandle } from '../../src/web/db/repo/users';
import { createUser } from '../../src/web/services/users';

const ACTOR = 'admin@example.com';

let db: Database.Database;
let root: string;

function deps(usersRoot: string = root) {
  return { db, usersRoot, actor: ACTOR };
}

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-users-'));
});

afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('AC1.1 — 管理员创建合法 handle 的用户', () => {
  it('用户落库、目录存在且为 0700、属主与门户进程一致、审计出现 create_user', () => {
    const result = createUser(deps(), { handle: 'alice' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.user).toMatchObject({ handle: 'alice', status: 'active' });
    expect(result.directory).toBe(path.join(root, 'alice'));

    const stat = fs.statSync(result.directory);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.mode & 0o7777).toBe(0o700);
    expect(stat.uid).toBe(process.geteuid?.());

    const audit = listAudit(db, { limit: 10, offset: 0 });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: ACTOR, action: 'create_user', target: 'alice' });
  });

  it('display_name 可空、可填', () => {
    const withName = createUser(deps(), { handle: 'alice', displayName: 'Alice' });
    const withoutName = createUser(deps(), { handle: 'bob' });
    expect(withName.ok && withName.user.display_name).toBe('Alice');
    expect(withoutName.ok && withoutName.user.display_name).toBeNull();
  });

  it('创建用户不会创建库文件（库由首次会话创建，§4.2）', () => {
    const result = createUser(deps(), { handle: 'alice' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fs.readdirSync(result.directory)).toEqual([]);
  });
});

describe('AC1.2 / AC1.3 — 非法 handle 一律拒绝且不留痕', () => {
  it('不合命名规范：拒绝并给出原因，不建用户、不建目录、不写审计（AC1.2）', () => {
    const result = createUser(deps(), { handle: 'Alice!' });
    expect(result).toMatchObject({
      ok: false,
      reason: 'invalid-handle',
      messageKey: 'users.error.handle.pattern',
    });
    if (result.ok) return;
    expect(countUsers(db)).toBe(0);
    expect(fs.readdirSync(root)).toEqual([]);
    expect(countAudit(db, {})).toBe(0);
  });

  it('路径穿越：拒绝且不产生预期外目录，既有用户不受影响（AC1.3 / TC-P-L3-02）', () => {
    const alice = createUser(deps(), { handle: 'alice' });
    expect(alice.ok).toBe(true);

    const escape = createUser(deps(), { handle: '../bob' });
    expect(escape).toMatchObject({
      ok: false,
      reason: 'invalid-handle',
      messageKey: 'users.error.handle.traversal',
    });

    expect(countUsers(db)).toBe(1);
    expect(fs.readdirSync(root)).toEqual(['alice']);
    expect(fs.existsSync(path.join(path.dirname(root), 'bob'))).toBe(false);
    expect(countAudit(db, {})).toBe(1);
  });

  it('空值与超长同样被拒', () => {
    expect(createUser(deps(), { handle: '' })).toMatchObject({ ok: false, reason: 'invalid-handle' });
    expect(createUser(deps(), { handle: 'a'.repeat(33) })).toMatchObject({
      ok: false,
      reason: 'invalid-handle',
    });
    expect(countUsers(db)).toBe(0);
  });
});

describe('AC1.6 — handle 已存在时拒绝且不覆盖', () => {
  it('第二次创建被拒，既有用户与目录未被改动，且不产生第二条审计', () => {
    const first = createUser(deps(), { handle: 'alice' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const again = createUser(deps(), { handle: 'alice' });
    expect(again).toMatchObject({
      ok: false,
      reason: 'handle-exists',
      messageKey: 'users.error.handleExists',
    });

    expect(countUsers(db)).toBe(1);
    expect(findUserByHandle(db, 'alice')?.id).toBe(first.user.id);
    expect(fs.statSync(first.directory).mode & 0o7777).toBe(0o700);
    expect(countAudit(db, { action: 'create_user' })).toBe(1);
  });
});

describe('AC1.7 — 目录创建失败不产生半成品用户', () => {
  it('usersRoot 不存在：失败、无用户、无成功审计、不留目录', () => {
    const missingRoot = path.join(root, 'missing', 'users');
    const result = createUser(deps(missingRoot), { handle: 'alice' });

    expect(result).toMatchObject({
      ok: false,
      reason: 'directory-failed',
      messageKey: 'users.error.directory',
    });

    expect(countUsers(db)).toBe(0);
    expect(countAudit(db, {})).toBe(0);
    expect(fs.existsSync(missingRoot)).toBe(false);
  });

  it('usersRoot 是只读目录时同样失败且不留痕', () => {
    fs.chmodSync(root, 0o500);
    try {
      const result = createUser(deps(), { handle: 'alice' });
      expect(result).toMatchObject({ ok: false, reason: 'directory-failed' });
      expect(countUsers(db)).toBe(0);
      expect(countAudit(db, {})).toBe(0);
    } finally {
      fs.chmodSync(root, 0o700);
    }
  });

  it('失败时记录结构化日志（含 handle 与原因，不含任何机密）', () => {
    const events: Record<string, unknown>[] = [];
    createUser(
      {
        ...deps(path.join(root, 'missing', 'users')),
        logger: { error: (obj) => { events.push(obj); } },
      },
      { handle: 'alice' },
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'create_user_failed', handle: 'alice', actor: ACTOR });
  });
});

describe('AC1.5 — 创建动作留下可追责审计', () => {
  it('审计含用户与创建者身份，且不含令牌明文', () => {
    const result = createUser({ ...deps(), sourceIp: '203.0.113.7' }, { handle: 'alice' });
    expect(result.ok).toBe(true);

    const [row] = listAudit(db, { limit: 1, offset: 0 });
    expect(row).toMatchObject({ actor: ACTOR, action: 'create_user', target: 'alice' });
    expect(row?.source_ip).toBe('203.0.113.7');
    expect(row?.detail_json).not.toMatch(/memo_/);
  });
});

describe('并发安全（评审修复回归）', () => {
  it('插用户失败且目录本来就存在时，不得删除该目录（并发失败方不破坏对手成果）', () => {
    const first = createUser(deps(), { handle: 'alice' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // 造出「目录在、行不在」的窗口：删除用户行，并往目录里放真实数据
    db.prepare('DELETE FROM users WHERE handle = ?').run('alice');
    const dataFile = path.join(first.directory, 'ai-memory.db');
    fs.writeFileSync(dataFile, 'existing-data');

    const failing = createUser(
      { ...deps(), db: dbFailingUserInsert(db) },
      { handle: 'alice' },
    );

    expect(failing).toMatchObject({ ok: false, reason: 'handle-exists' });
    expect(fs.existsSync(first.directory)).toBe(true);
    expect(fs.readFileSync(dataFile, 'utf8')).toBe('existing-data');
    expect(countAudit(db, { action: 'create_user' })).toBe(1);
  });

  it('本次创建失败时清理刚建出的空目录（不留半成品）', () => {
    const directory = path.join(root, 'alice');
    const failing = createUser({ ...deps(), db: dbFailingUserInsert(db) }, { handle: 'alice' });

    expect(failing).toMatchObject({ ok: false, reason: 'handle-exists' });
    expect(fs.existsSync(directory)).toBe(false);
    expect(countUsers(db)).toBe(0);
    expect(countAudit(db, {})).toBe(0);
  });

  it('失败结果只暴露 i18n 键与结构化上下文（不产出用户可见文案）', () => {
    const result = createUser(deps(), { handle: 'Alice!' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.messageKey).toMatch(/^users\.error\./);
    expect(result.context).toMatchObject({ handle: 'Alice!', handleReason: 'pattern' });
    expect(Object.keys(result)).not.toContain('detail');
  });
});

/** 测试替身：让 `INSERT INTO users` 抛出 UNIQUE 失败，复现「预检通过但插入失败」的竞态窗口。 */
function dbFailingUserInsert(real: Database.Database): Database.Database {
  return new Proxy(real, {
    get(target, property, receiver) {
      if (property === 'prepare') {
        return (sql: string) => {
          if (/INSERT\s+INTO\s+users/i.test(sql)) {
            throw new Error('UNIQUE constraint failed: users.handle');
          }
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === 'function'
        ? (value as (...args: unknown[]) => unknown).bind(target)
        : value;
    },
  }) as Database.Database;
}
