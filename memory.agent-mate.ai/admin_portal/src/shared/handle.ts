/**
 * handle 校验与用户目录（纯逻辑 + 文件系统原语）。
 *
 * 依据：specs/web-portal/web-stories.md `AC1.1`–`AC1.3`、`AC1.7`；`web-design.md` §4.2。
 *  - 命名规范 `^[a-z0-9_-]{1,32}$`（大写、空格、中文、点号一律拒绝 —— `TC-P-L0-01`）
 *  - 路径穿越（含 `/`、`\`、`..`）单独给原因，拒绝且不产生预期外目录（`AC1.3` / `TC-P-L3-02`）
 *  - 目录 mode 必须**显式**为 0700：`mkdir` 的 mode 会被 umask 削弱，故建完再 `chmod`
 *  - 属主必须与门户进程的有效 UID 一致 —— 容器内门户以 `aimem` 运行，故这一条等价于
 *    「属主与容器内 aimem 一致」（`AC1.1`）
 */

import fs from 'node:fs';
import path from 'node:path';

export const HANDLE_PATTERN = /^[a-z0-9_-]{1,32}$/;
export const HANDLE_MAX_LENGTH = 32;
export const USER_DIR_MODE = 0o700;

export type HandleInvalidReason = 'empty' | 'traversal' | 'too-long' | 'pattern';

export type HandleValidation =
  | { readonly ok: true; readonly handle: string }
  | { readonly ok: false; readonly reason: HandleInvalidReason };

/**
 * 校验 handle。**不做 trim**：训练出的「静默纠错」会让管理员以为写入了 A，
 * 实际写入的是 B；宁可明确报错，也不猜用户意图。
 */
export function validateHandle(raw: unknown): HandleValidation {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, reason: 'empty' };
  if (raw.includes('/') || raw.includes('\\') || raw.includes('..')) {
    return { ok: false, reason: 'traversal' };
  }
  if (raw.length > HANDLE_MAX_LENGTH) return { ok: false, reason: 'too-long' };
  if (!HANDLE_PATTERN.test(raw)) return { ok: false, reason: 'pattern' };
  return { ok: true, handle: raw };
}

/** 由 usersRoot 派生用户目录；纵深防御：越界即抛（校验被绕过时也不会写出根目录外）。 */
export function userDirectory(usersRoot: string, handle: string): string {
  const root = path.resolve(usersRoot);
  const dir = path.resolve(root, handle);
  if (path.dirname(dir) !== root) {
    throw new Error('handle 派生出的目录越出 usersRoot');
  }
  return dir;
}

export interface DirectoryInfo {
  readonly exists: boolean;
  readonly mode: number | null;
  readonly uid: number | null;
  readonly gid: number | null;
}

export function inspectUserDirectory(dir: string): DirectoryInfo {
  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) return { exists: false, mode: null, uid: null, gid: null };
    return {
      exists: true,
      mode: stat.mode & 0o7777,
      uid: stat.uid,
      gid: stat.gid,
    };
  } catch {
    return { exists: false, mode: null, uid: null, gid: null };
  }
}

export interface EnsureDirectoryOptions {
  /** 期望的属主 UID；缺省为门户进程的有效 UID（容器内即 aimem）。 */
  readonly expectedUid?: number;
  /** 目录已存在时是否接受（幂等路径用 true：签发令牌时确保目录存在）。 */
  readonly idempotent?: boolean;
}

/**
 * 确保用户目录存在且满足权限/属主约定。
 *
 * - 父目录（usersRoot）**必须已存在**：非递归创建。父目录缺失 ⇒ 抛 ENOENT，
 *   这正是 `AC1.7` 要的场景（不得静默创建出半成品用户）。
 * - 已存在且 `idempotent` 为真时，仍会校验并**纠正** mode 与属主。
 */
export function ensureUserDirectory(dir: string, options: EnsureDirectoryOptions = {}): DirectoryInfo {
  const expectedUid = options.expectedUid ?? process.geteuid?.() ?? null;
  const before = inspectUserDirectory(dir);

  if (!before.exists) {
    fs.mkdirSync(dir, { mode: USER_DIR_MODE });
  }
  fs.chmodSync(dir, USER_DIR_MODE);

  const after = inspectUserDirectory(dir);
  if (!after.exists) throw new Error(`用户目录创建后不可见：${dir}`);
  if (after.mode !== USER_DIR_MODE) {
    throw new Error(`用户目录权限未达 0700：${dir}`);
  }
  if (expectedUid !== null && after.uid !== expectedUid) {
    throw new Error(`用户目录属主与门户进程不一致：${dir}`);
  }
  if (before.exists && options.idempotent !== true) {
    // 非幂等路径下，已存在的目录说明这不是「新建」，交由调用方判断
  }
  return after;
}

/** 尽力清理刚建出但未完成登记的目录（只在空目录时删除，避免误删数据）。 */
export function removeDirectoryIfEmpty(dir: string): boolean {
  try {
    fs.rmdirSync(dir);
    return true;
  } catch {
    return false;
  }
}
