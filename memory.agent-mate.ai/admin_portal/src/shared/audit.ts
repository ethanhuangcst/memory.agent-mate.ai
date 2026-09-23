/**
 * 审计事务（fail-closed）—— 「无审计不动作」。
 *
 * 依据：用户决议（2026-09-22）落定 `web-design.md` §12.6 原「待决议」项 ——
 *   审计写不进去时**整个操作失败**：用户/令牌不落库，也不产生半成品。
 * 实现方式：业务写与审计写放在**同一个 SQLite 事务**内（better-sqlite3 事务），
 *   任一步抛错即整体回滚。因为二者同库同事务，无需补偿逻辑即可保证。
 *
 * 审计写入**在业务写之后**：这样 detail 能带上已产出的事实（如 `key_prefix`），
 * 而又不改变 fail-closed 语义（仍在同一事务内）。
 */

import type Database from 'better-sqlite3';
import { insertAudit } from '../web/db/repo/audit';

export const AUDIT_ACTIONS = [
  'create_user',
  'issue_key',
  'rotate_key',
  'revoke_key',
  'deactivate_user',
  // 恢复访问（D13 的可逆侧）。与 issue_key 分开记：恢复账号状态与签发新钥匙是两件事，
  // 合成一条会让审计无法回答「这个用户是被谁、在什么时候恢复的」。
  'restore_user',
  // 接入面（PSP-W2 起）：**会话被拒绝**。只记失败面 —— 依据 web-design.md §12.5 的纪律 3
  // 「spawn 断言失败与上游不可用必写审计行」。
  // 注意：「会话开始」的审计行（含解析出的库路径）属审计视图批次（RID D4 / Sprint 6），
  // 不在本批范围，故此处**只登记拒绝类**，避免与本批之外的动作语义混淆。
  'mcp_session_rejected',
  /**
   * 转发阶段失败（`3.8` 新增）—— 与「会话被拒」**分开**记：
   * 「上游起不来」与「转发阶段出错」是两类故障，混在一个动作里排障时无从下手
   * （见 `web-design.md` §12.5 的纪律 ④）。
   */
  'mcp_upstream_error',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEntry {
  /** 触发者身份（Cloudflare Access 断言中的邮箱或服务令牌标识）。 */
  readonly actor: string;
  readonly action: AuditAction;
  /** 作用对象（用户 handle 或 `handle:key_prefix`）。 */
  readonly target?: string | null;
  readonly detail?: Record<string, unknown>;
  readonly sourceIp?: string | null;
  readonly ts?: string;
}

/**
 * 在单事务内执行 `work` 并写审计行。
 *
 * - `work` 抛错 ⇒ 整体回滚，且**不写审计**（失败的动作不留痕，成功才有痕）；
 * - 审计写失败 ⇒ 整体回滚，业务写一并撤销（fail-closed 的落点）；
 * - 嵌套调用安全（better-sqlite3 用 SAVEPOINT）。
 */
export function withAudit<T>(
  db: Database.Database,
  entries: AuditEntry | readonly AuditEntry[],
  work: () => T,
): T {
  const list = Array.isArray(entries) ? entries : [entries];
  const run = db.transaction((items: readonly AuditEntry[]) => {
    const result = work();
    for (const item of items) insertAudit(db, item);
    return result;
  });
  return run(list);
}
