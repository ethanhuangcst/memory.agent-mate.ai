/**
 * 门户库迁移：`schema_version` 表驱动的**前向-only** 迁移（web-design.md §12.6）。
 *
 * 为什么前向-only：门户库没有外部依赖、也没有跨版本回滚的业务需求；允许回滚会诱使
 * 「线上降级」这种把数据置于未知 schema 的操作（与 §3.4「版本断言」的拒绝启动同源）。
 * 升级前先备份由部署流程负责（§9）。
 *
 * 用法：
 *   - 库内调用 `migrate(db)`（幂等：已应用的版本跳过）
 *   - 命令行 `npm run migrate`（读 PORTAL_DB_PATH，打印从哪个版本升到哪个版本）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { loadConfig } from '../../config';
import { openDatabase } from './connection';

const DB_DIR = path.dirname(fileURLToPath(import.meta.url));

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

function readSchemaSql(): string {
  return fs.readFileSync(path.join(DB_DIR, 'schema.sql'), 'utf8');
}

/** 迁移清单：只追加、不改写已发布的版本（与 AC 编号「只追加不重排」同纪律）。 */
export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial', sql: readSchemaSql() },
];

export interface MigrateResult {
  readonly from: number;
  readonly to: number;
  readonly applied: readonly string[];
}

function ensureVersionTable(db: Database.Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_version (
       version    INTEGER PRIMARY KEY,
       name       TEXT NOT NULL,
       applied_at TEXT NOT NULL
     )`,
  );
}

export function currentVersion(db: Database.Database): number {
  ensureVersionTable(db);
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

/**
 * 应用所有未执行的迁移。每个迁移在**单事务**内执行：要么整体生效，要么整体不生效
 * （避免「表建了一半」这种需要人工介入的中间态）。
 */
export function migrate(db: Database.Database): MigrateResult {
  const from = currentVersion(db);
  const applied: string[] = [];

  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue;
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
    });
    run();
    applied.push(`${migration.version}:${migration.name}`);
  }

  return { from, to: currentVersion(db), applied };
}

/** 需要迁移但尚未应用的版本列表（供「库里 schema 比本进程新/旧」的判断）。 */
export function pendingVersions(db: Database.Database): number[] {
  const from = currentVersion(db);
  return MIGRATIONS.filter((migration) => migration.version > from).map((m) => m.version);
}

/* v8 ignore start —— CLI 引导块，测试进程内不可执行：
   它从真实 process.env 读配置、把 JSON 写到 process.stdout/stderr、并置 process.exitCode；
   其真正的迁移逻辑（migrate / pendingVersions / 版本表读写）已被集成测试覆盖，
   此处只是「读环境 → 建库 → 调 migrate → 打印结果」的编排。
   因此显式豁免（非静默排除）：豁免范围到此块结束。 */
function main(): void {
  const cfg = loadConfig();
  const dir = path.dirname(cfg.dbPath);
  if (!fs.existsSync(dir)) {
    process.stderr.write(
      `${JSON.stringify({ event: 'migrate_failed', reason: `门户库目录不存在：${dir}` })}\n`,
    );
    process.exitCode = 1;
    return;
  }

  const db = openDatabase(cfg.dbPath);
  try {
    const result = migrate(db);
    process.stdout.write(
      `${JSON.stringify({
        event: 'migrate_done',
        dbPath: cfg.dbPath,
        from: result.from,
        to: result.to,
        applied: result.applied,
      })}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ event: 'migrate_failed', message })}\n`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

const entry = process.argv[1];
if (entry && path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url))) {
  main();
}
/* v8 ignore stop */
