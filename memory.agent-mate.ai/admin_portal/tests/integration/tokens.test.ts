import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openMemoryDatabase } from '../../src/web/db/connection';
import { migrate } from '../../src/web/db/migrate';
import { countAudit, listAudit } from '../../src/web/db/repo/audit';
import { countActiveKeysForUser, findKeyByHash, touchKeyLastUsed } from '../../src/web/db/repo/keys';
import { findUserByHandle } from '../../src/web/db/repo/users';
import { createUser, restoreUser } from '../../src/web/services/users';
import {
  deactivateUser,
  issueKey,
  listKeysForUser,
  revokeKey,
  rotateKey,
  verifyToken,
} from '../../src/web/services/keys';
import { hashToken, TOKEN_LENGTH } from '../../src/shared/tokens';

const ACTOR = 'admin@example.com';

let db: Database.Database;
let root: string;

function deps() {
  return { db, usersRoot: root, actor: ACTOR };
}

beforeEach(() => {
  db = openMemoryDatabase();
  migrate(db);
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-keys-'));
  const created = createUser(deps(), { handle: 'alice' });
  expect(created.ok).toBe(true);
});

afterEach(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('AC2.1 / AC2.2 — 签发与「明文只出现一次」', () => {
  it('签发返回 memo_ 明文，库内只存摘要与前缀，明文不可取回', () => {
    const issued = issueKey(deps(), { handle: 'alice', label: 'MacBook' });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    expect(issued.plaintext).toHaveLength(TOKEN_LENGTH);
    expect(issued.plaintext.startsWith('memo_')).toBe(true);
    expect(issued.key.key_prefix).toBe(issued.plaintext.slice(0, 13));

    // 库内：只有 sha256 与前缀
    const raw = db.prepare('SELECT * FROM keys').all();
    expect(raw).toHaveLength(1);
    const serialized = JSON.stringify(raw);
    expect(serialized).not.toContain(issued.plaintext);
    expect(serialized).not.toContain(issued.plaintext.slice(5));
    expect(findKeyByHash(db, hashToken(issued.plaintext))).toBeDefined();

    // 列出不返回明文
    const listed = listKeysForUser(db, 'alice');
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(issued.plaintext);
  });

  it('校验走摘要比对：前缀相同但正文不同的令牌判否（不存在按前缀提前返回的旁路）', () => {
    const issued = issueKey(deps(), { handle: 'alice' });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    expect(verifyToken(db, issued.plaintext).ok).toBe(true);

    const samePrefix = `${issued.plaintext.slice(0, 13)}${'Z'.repeat(TOKEN_LENGTH - 13)}`;
    expect(samePrefix).toHaveLength(TOKEN_LENGTH);
    expect(verifyToken(db, samePrefix)).toEqual({ ok: false, reason: 'unknown' });
  });

  it('形状不符的令牌在形状校验即判否', () => {
    expect(verifyToken(db, undefined)).toEqual({ ok: false, reason: 'missing' });
    expect(verifyToken(db, '')).toEqual({ ok: false, reason: 'missing' });
    expect(verifyToken(db, 'not-a-token')).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken(db, `memo_${'a'.repeat(30)}`)).toEqual({ ok: false, reason: 'malformed' });
  });
});

describe('AC2.3 — 签发时幂等确保用户目录存在且不建库文件', () => {
  it('目录被删后签发会重建，且目录内不出现库文件', () => {
    const dir = path.join(root, 'alice');
    fs.rmSync(dir, { recursive: true, force: true });
    expect(fs.existsSync(dir)).toBe(false);

    const issued = issueKey(deps(), { handle: 'alice' });
    expect(issued.ok).toBe(true);

    expect(fs.statSync(dir).mode & 0o7777).toBe(0o700);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('AC2.4 — 列出元信息（无明文、无取回操作）', () => {
  it('列出前缀、标签、创建时间与最后使用时间', () => {
    const issued = issueKey(deps(), { handle: 'alice', label: 'MacBook' });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const before = listKeysForUser(db, 'alice');
    expect(before?.[0]).toMatchObject({
      key_prefix: issued.plaintext.slice(0, 13),
      label: 'MacBook',
      last_used_at: null,
    });
    expect(before?.[0]?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    touchKeyLastUsed(db, issued.key.id, '2026-09-22T10:00:00.000Z');
    expect(listKeysForUser(db, 'alice')?.[0]?.last_used_at).toBe('2026-09-22T10:00:00.000Z');
  });

  it('未知用户返回 undefined（由路由转 404）', () => {
    expect(listKeysForUser(db, 'nobody')).toBeUndefined();
  });
});

describe('AC2.5 / AC2.6 — 轮换不可复活、吊销为软吊销', () => {
  it('轮换：旧令牌立即失效，新令牌可用，且旧令牌无法复活', () => {
    const first = issueKey(deps(), { handle: 'alice' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const rotated = rotateKey(deps(), { handle: 'alice', keyPrefix: first.key.key_prefix });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;

    expect(rotated.plaintext).not.toBe(first.plaintext);
    expect(verifyToken(db, first.plaintext)).toEqual({ ok: false, reason: 'revoked' });
    expect(verifyToken(db, rotated.plaintext).ok).toBe(true);

    // 再对旧令牌做任何操作都拒绝（没有复活路径）
    expect(rotateKey(deps(), { handle: 'alice', keyPrefix: first.key.key_prefix })).toMatchObject({
      ok: false,
      reason: 'key-not-active',
    });
    expect(revokeKey(deps(), { handle: 'alice', keyPrefix: first.key.key_prefix })).toMatchObject({
      ok: false,
      reason: 'key-not-active',
    });
    expect(countActiveKeysForUser(db, first.key.user_id)).toBe(1);
  });

  it('吊销：行与审计保留、立即失效、重复吊销不再生效（AC2.6 / AC2.7）', () => {
    const issued = issueKey(deps(), { handle: 'alice' });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;

    const revoked = revokeKey(deps(), { handle: 'alice', keyPrefix: issued.key.key_prefix });
    expect(revoked.ok).toBe(true);

    expect(verifyToken(db, issued.plaintext)).toEqual({ ok: false, reason: 'revoked' });
    const rows = listKeysForUser(db, 'alice');
    expect(rows).toHaveLength(1);
    expect(rows?.[0]?.revoked_at).not.toBeNull();
    expect(countAudit(db, { action: 'issue_key' })).toBe(1);

    expect(revokeKey(deps(), { handle: 'alice', keyPrefix: issued.key.key_prefix })).toMatchObject({
      ok: false,
      reason: 'key-not-active',
    });
  });

  it('多把令牌各自独立：吊销一把不影响另一把', () => {
    const a = issueKey(deps(), { handle: 'alice', label: 'MacBook' });
    const b = issueKey(deps(), { handle: 'alice', label: 'Desktop' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    revokeKey(deps(), { handle: 'alice', keyPrefix: a.key.key_prefix });
    expect(verifyToken(db, a.plaintext).ok).toBe(false);
    expect(verifyToken(db, b.plaintext).ok).toBe(true);
    expect(listKeysForUser(db, 'alice')).toHaveLength(2);
  });
});

describe('AC2.9 — 对不存在的令牌操作：拒绝且不产生虚假成功', () => {
  it('轮换不存在的令牌：拒绝、不签发新令牌、不写审计', () => {
    const before = countAudit(db, {});
    const result = rotateKey(deps(), { handle: 'alice', keyPrefix: 'memo_deadbeef' });

    expect(result).toMatchObject({
      ok: false,
      reason: 'key-not-found',
      messageKey: 'detail.error.keyNotFound',
    });
    if (result.ok) return;
    expect(Object.keys(result)).not.toContain('detail');
    expect(listKeysForUser(db, 'alice')).toHaveLength(0);
    expect(countAudit(db, {})).toBe(before);
  });

  it('吊销不存在的令牌：同上', () => {
    const before = countAudit(db, {});
    expect(revokeKey(deps(), { handle: 'alice', keyPrefix: 'memo_deadbeef' })).toMatchObject({
      ok: false,
      reason: 'key-not-found',
      messageKey: 'detail.error.keyNotFound',
    });
    expect(countAudit(db, {})).toBe(before);
  });

  it('对不存在的用户操作：拒绝', () => {
    expect(issueKey(deps(), { handle: 'nobody' })).toMatchObject({ ok: false, reason: 'user-not-found' });
    expect(deactivateUser(deps(), { handle: 'nobody' })).toMatchObject({
      ok: false,
      reason: 'user-not-found',
    });
  });
});

describe('AC2.8 — 审计留痕且不含明文', () => {
  it('签发/轮换/吊销各留一条，target 与 detail 只含前缀', () => {
    const first = issueKey(deps(), { handle: 'alice', label: 'MacBook' });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const rotated = rotateKey(deps(), { handle: 'alice', keyPrefix: first.key.key_prefix });
    expect(rotated.ok).toBe(true);
    if (!rotated.ok) return;
    revokeKey(deps(), { handle: 'alice', keyPrefix: rotated.key.key_prefix });

    const audit = listAudit(db, { limit: 20, offset: 0 });
    // beforeEach 已建用户（create_user），此处只看三类令牌事件及其倒序
    expect(audit.filter((row) => row.action !== 'create_user').map((row) => row.action)).toEqual([
      'revoke_key',
      'rotate_key',
      'issue_key',
    ]);

    const dump = JSON.stringify(audit);
    expect(dump).not.toContain(first.plaintext);
    expect(dump).not.toContain(rotated.plaintext);
    expect(dump).toContain(first.key.key_prefix);
    expect(dump).toContain(rotated.key.key_prefix);
    for (const row of audit) expect(row.actor).toBe(ACTOR);
  });
});

describe('D13 / TC-P-L2-11 — 停用可逆（一次性吊销全部令牌，库文件保留）', () => {
  it('停用后全部令牌失效、用户禁用、目录与库文件保留；再签发即恢复', () => {
    const a = issueKey(deps(), { handle: 'alice', label: 'MacBook' });
    const b = issueKey(deps(), { handle: 'alice', label: 'Desktop' });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;

    // 模拟已有库文件（停用不得删库）
    const dbFile = path.join(root, 'alice', 'ai-memory.db');
    fs.writeFileSync(dbFile, 'sqlite-placeholder');

    const deactivated = deactivateUser(deps(), { handle: 'alice' });
    expect(deactivated).toMatchObject({ ok: true, revokedKeyCount: 2 });
    if (!deactivated.ok) return;
    expect(deactivated.user.status).toBe('disabled');

    expect(verifyToken(db, a.plaintext)).toEqual({ ok: false, reason: 'revoked' });
    expect(verifyToken(db, b.plaintext)).toEqual({ ok: false, reason: 'revoked' });
    expect(fs.existsSync(dbFile)).toBe(true);

    expect(deactivateUser(deps(), { handle: 'alice' })).toMatchObject({
      ok: false,
      reason: 'already-disabled',
    });

    // 停用用户**不得签发**（2026-09-22 用户决定）：签发按钮不再隐含恢复账号状态，
    // 否则「停用了还能签发」会直接反直觉地出现（实测 Issue）。
    const refused = issueKey(deps(), { handle: 'alice', label: 'New laptop' });
    expect(refused).toMatchObject({ ok: false, reason: 'user-disabled' });
    // 拒绝必须「什么都没发生」：状态仍停用、目录与库文件仍在
    expect(findUserByHandle(db, 'alice')?.status).toBe('disabled');
    expect(fs.existsSync(dbFile)).toBe(true);

    // 恢复走**独立动作**（D13 的可逆侧仍成立），恢复之后再签发
    const restored = restoreUser(deps(), { handle: 'alice' });
    expect(restored.ok).toBe(true);
    expect(findUserByHandle(db, 'alice')?.status).toBe('active');
    expect(findUserByHandle(db, 'alice')?.revoked_at).toBeNull();

    const reissued = issueKey(deps(), { handle: 'alice', label: 'New laptop' });
    expect(reissued.ok).toBe(true);
    if (!reissued.ok) return;
    expect(verifyToken(db, reissued.plaintext).ok).toBe(true);

    const audit = listAudit(db, { limit: 20, offset: 0 });
    expect(audit.map((row) => row.action)).toContain('deactivate_user');
    expect(audit.map((row) => row.action)).toContain('restore_user');
    expect(JSON.stringify(audit)).not.toContain(a.plaintext);
  });
});
