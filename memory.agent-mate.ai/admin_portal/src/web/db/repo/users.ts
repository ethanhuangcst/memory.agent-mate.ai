/**
 * 用户仓储（`users` 表）。
 *
 * 设计要点：列表页的「令牌数」用**一条聚合查询**算出（LEFT JOIN + GROUP BY），
 * 不在行循环里逐用户再查 —— 否则页大小一涨就是 N+1。
 */

import type Database from 'better-sqlite3';

export type UserStatus = 'active' | 'disabled';

export interface UserRow {
  readonly id: number;
  readonly handle: string;
  readonly display_name: string | null;
  readonly status: UserStatus;
  readonly created_at: string;
  readonly revoked_at: string | null;
}

export interface UserWithKeyCount extends UserRow {
  /** 全部令牌数（含已吊销）。 */
  readonly key_count: number;
  /** 未吊销令牌数（详情页与停用确认框展示「将被吊销的令牌数」）。 */
  readonly active_key_count: number;
}

export interface NewUser {
  readonly handle: string;
  readonly displayName?: string | null;
  readonly createdAt?: string;
}

export function insertUser(db: Database.Database, input: NewUser): UserRow {
  const info = db
    .prepare('INSERT INTO users (handle, display_name, status, created_at) VALUES (?, ?, ?, ?)')
    .run(input.handle, input.displayName ?? null, 'active', input.createdAt ?? new Date().toISOString());
  return getUserById(db, Number(info.lastInsertRowid)) as UserRow;
}

export function getUserById(db: Database.Database, id: number): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function findUserByHandle(db: Database.Database, handle: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE handle = ?').get(handle) as UserRow | undefined;
}

/** 分页列表（含令牌数聚合；单条查询，无 N+1）。 */
export function listUsers(
  db: Database.Database,
  options: { limit: number; offset: number },
): UserWithKeyCount[] {
  return db
    .prepare(
      `SELECT u.*,
              COUNT(k.id)                                        AS key_count,
              COUNT(CASE WHEN k.revoked_at IS NULL THEN k.id END) AS active_key_count
         FROM users u
         LEFT JOIN keys k ON k.user_id = u.id
        GROUP BY u.id
        ORDER BY u.handle ASC
        LIMIT ? OFFSET ?`,
    )
    .all(options.limit, options.offset) as UserWithKeyCount[];
}

export function countUsers(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number } | undefined;
  return row?.c ?? 0;
}

/** 停用（可逆软操作，D13）：置 status=disabled + revoked_at；库文件保留。 */
export function disableUser(db: Database.Database, handle: string, at: string): boolean {
  const info = db
    .prepare("UPDATE users SET status = 'disabled', revoked_at = ? WHERE handle = ? AND status = 'active'")
    .run(at, handle);
  return info.changes > 0;
}

/** 恢复：签发新令牌时把用户带回 active（D13「恢复 = 签发新令牌」）。 */
export function activateUser(db: Database.Database, handle: string): boolean {
  const info = db
    .prepare("UPDATE users SET status = 'active', revoked_at = NULL WHERE handle = ? AND status = 'disabled'")
    .run(handle);
  return info.changes > 0;
}
