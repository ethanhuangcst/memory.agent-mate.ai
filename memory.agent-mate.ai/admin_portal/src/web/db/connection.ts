/**
 * 门户库连接：打开 SQLite 并设置运行期 PRAGMA。
 *
 * 依据 web-design.md §12.0（SQLite 单文件、独立卷）与 §12.6（迁移前向-only）。
 * 连接与会话级设置集中在此，仓储层只接收已打开的 db 实例（便于测试注入内存库）。
 */

import Database from 'better-sqlite3';

/** 打开门户库（不存在则创建文件；WAL 便于读写并发与崩溃恢复）。 */
export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  // 内存库不支持 WAL，pragma 会返回 'memory'，无需特判即可继续
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  return db;
}

/** 打开仅存在于内存的门户库（离线测试用；行为与文件库一致，除 WAL）。 */
export function openMemoryDatabase(): Database.Database {
  return openDatabase(':memory:');
}
