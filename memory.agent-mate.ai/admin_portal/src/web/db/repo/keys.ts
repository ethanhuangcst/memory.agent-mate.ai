/**
 * 令牌仓储（`keys` 表）。
 *
 * 纪律（§4.1 / §12.6）：本表**只存摘要与展示前缀**，没有明文列 ——
 * 明文只在签发响应中出现一次（AC2.1 / AC2.2 / TC-P-L0-04）。
 */

import type Database from 'better-sqlite3';

export interface KeyRow {
  readonly id: number;
  readonly user_id: number;
  readonly key_hash: Buffer;
  readonly key_prefix: string;
  readonly label: string | null;
  readonly created_at: string;
  readonly last_used_at: string | null;
  readonly revoked_at: string | null;
}

export interface NewKey {
  readonly userId: number;
  readonly keyHash: Buffer;
  readonly keyPrefix: string;
  readonly label?: string | null;
  readonly createdAt?: string;
}

export function insertKey(db: Database.Database, input: NewKey): KeyRow {
  const info = db
    .prepare(
      `INSERT INTO keys (user_id, key_hash, key_prefix, label, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId,
      input.keyHash,
      input.keyPrefix,
      input.label ?? null,
      input.createdAt ?? new Date().toISOString(),
    );
  return getKeyById(db, Number(info.lastInsertRowid)) as KeyRow;
}

export function getKeyById(db: Database.Database, id: number): KeyRow | undefined {
  return db.prepare('SELECT * FROM keys WHERE id = ?').get(id) as KeyRow | undefined;
}

/** 认证热路径：唯一索引一次命中（§12.6）。 */
export function findKeyByHash(db: Database.Database, keyHash: Buffer): KeyRow | undefined {
  return db.prepare('SELECT * FROM keys WHERE key_hash = ?').get(keyHash) as KeyRow | undefined;
}

/** 按展示前缀定位（轮换 / 吊销的 UI 目标）；限定在该用户内，避免跨用户歧义。 */
export function findKeyByPrefix(
  db: Database.Database,
  userId: number,
  keyPrefix: string,
): KeyRow | undefined {
  return db.prepare('SELECT * FROM keys WHERE user_id = ? AND key_prefix = ?').get(
    userId,
    keyPrefix,
  ) as KeyRow | undefined;
}

export function listKeysByUser(db: Database.Database, userId: number): KeyRow[] {
  return db
    .prepare('SELECT * FROM keys WHERE user_id = ? ORDER BY created_at DESC, id DESC')
    .all(userId) as KeyRow[];
}

export function countActiveKeysForUser(db: Database.Database, userId: number): number {
  const row = db
    .prepare('SELECT COUNT(*) AS c FROM keys WHERE user_id = ? AND revoked_at IS NULL')
    .get(userId) as { c: number } | undefined;
  return row?.c ?? 0;
}

/** 吊销一把（软吊销，AC2.6）；仅未吊销者会变更。 */
export function revokeKeyById(db: Database.Database, id: number, at: string): boolean {
  const info = db
    .prepare('UPDATE keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL')
    .run(at, id);
  return info.changes > 0;
}

/** 记下最近一次使用时间（认证成功后由接入批次调用；W1 只提供原语）。 */
export function touchKeyLastUsed(db: Database.Database, id: number, at?: string): boolean {
  const info = db
    .prepare('UPDATE keys SET last_used_at = ? WHERE id = ?')
    .run(at ?? new Date().toISOString(), id);
  return info.changes > 0;
}

/** 一次性吊销该用户全部未吊销令牌（停用用户，D13）；返回受影响行数。 */
export function revokeActiveKeysForUser(db: Database.Database, userId: number, at: string): number {
  const info = db
    .prepare('UPDATE keys SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(at, userId);
  return info.changes;
}
