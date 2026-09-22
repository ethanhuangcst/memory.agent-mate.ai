/**
 * 审计仓储（`audit` 表）。
 *
 * 纪律（§12.6 / T8）：`detail_json` **不得**含令牌明文或记忆正文 —— 写入前一律经
 * `shared/redact.ts` 兜底，避免调用方漏脱敏。
 */

import type Database from 'better-sqlite3';
import { redactDeep } from '../../../shared/redact';
import type { AuditEntry } from '../../../shared/audit';

export interface AuditRow {
  readonly id: number;
  readonly ts: string;
  readonly actor: string;
  readonly action: string;
  readonly target: string | null;
  readonly detail_json: string;
  readonly source_ip: string | null;
}

export interface AuditQuery {
  readonly actor?: string;
  readonly action?: string;
  readonly limit: number;
  readonly offset: number;
}

export function insertAudit(db: Database.Database, entry: AuditEntry): number {
  const detail = JSON.stringify(redactDeep(entry.detail ?? {}));
  const info = db
    .prepare(
      `INSERT INTO audit (ts, actor, action, target, detail_json, source_ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      entry.ts ?? new Date().toISOString(),
      entry.actor,
      entry.action,
      entry.target ?? null,
      detail,
      entry.sourceIp ?? null,
    );
  return Number(info.lastInsertRowid);
}

function whereClause(query: Pick<AuditQuery, 'actor' | 'action'>): {
  sql: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (query.actor) {
    clauses.push('actor = ?');
    params.push(query.actor);
  }
  if (query.action) {
    clauses.push('action = ?');
    params.push(query.action);
  }
  return { sql: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

export function listAudit(db: Database.Database, query: AuditQuery): AuditRow[] {
  const { sql, params } = whereClause(query);
  return db
    .prepare(`SELECT * FROM audit${sql} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset) as AuditRow[];
}

export function countAudit(
  db: Database.Database,
  query: Pick<AuditQuery, 'actor' | 'action'>,
): number {
  const { sql, params } = whereClause(query);
  const row = db.prepare(`SELECT COUNT(*) AS c FROM audit${sql}`).get(...params) as
    | { c: number }
    | undefined;
  return row?.c ?? 0;
}
