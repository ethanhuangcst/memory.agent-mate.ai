import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureUserDirectory,
  HANDLE_PATTERN,
  inspectUserDirectory,
  removeDirectoryIfEmpty,
  USER_DIR_MODE,
  userDirectory,
  validateHandle,
} from '../../src/shared/handle';

describe('validateHandle — 命名规范（TC-P-L0-01）', () => {
  it('接受小写字母、数字、下划线、连字符，长度 1–32', () => {
    for (const handle of ['a', 'alice', 'a_b', 'a-b', 'u_01-2', 'a'.repeat(32)]) {
      expect(validateHandle(handle)).toEqual({ ok: true, handle });
    }
  });

  it('拒绝空值与非字符串', () => {
    expect(validateHandle('')).toEqual({ ok: false, reason: 'empty' });
    expect(validateHandle(undefined)).toEqual({ ok: false, reason: 'empty' });
    expect(validateHandle(42)).toEqual({ ok: false, reason: 'empty' });
  });

  it('拒绝大写、点号、空格、中文等不合法字符（不做静默 trim）', () => {
    for (const handle of ['Alice', 'Alice!', 'alice.', ' alice ', 'alice ', '中文', 'al ice', '@alice']) {
      expect(validateHandle(handle).ok).toBe(false);
    }
    expect(validateHandle(' alice ')).toEqual({ ok: false, reason: 'pattern' });
  });

  it('拒绝超长（> 32）', () => {
    expect(validateHandle('a'.repeat(33))).toEqual({ ok: false, reason: 'too-long' });
  });

  it('路径穿越单独给原因（AC1.3）', () => {
    for (const handle of ['../bob', 'a/b', 'a\\b', '..', '.hidden/../x']) {
      expect(validateHandle(handle)).toEqual({ ok: false, reason: 'traversal' });
    }
  });

  it('正则与导出常量一致（供前端复用同一判据）', () => {
    expect(HANDLE_PATTERN.source).toBe('^[a-z0-9_-]{1,32}$');
  });
});

describe('userDirectory — 派生与越界防护', () => {
  it('派生为 usersRoot/<handle>', () => {
    expect(userDirectory('/data/users', 'alice')).toBe('/data/users/alice');
  });

  it('即使绕过校验，越界 handle 也会抛错（纵深防御）', () => {
    expect(() => userDirectory('/data/users', '../bob')).toThrow(/越出/);
    expect(() => userDirectory('/data/users', 'nested/alice')).toThrow(/越出/);
  });

  it('尾随斜杠的 usersRoot 归一化', () => {
    expect(userDirectory('/data/users/', 'alice')).toBe('/data/users/alice');
  });
});

describe('ensureUserDirectory — 0700、属主、非递归', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-handle-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('创建后 mode 为 0700（不受 umask 影响）', () => {
    const dir = path.join(root, 'alice');
    const info = ensureUserDirectory(dir);
    expect(info.exists).toBe(true);
    expect(info.mode).toBe(USER_DIR_MODE);
    expect(fs.statSync(dir).mode & 0o7777).toBe(0o700);
  });

  it('属主为门户进程的有效 UID（容器内即 aimem）', () => {
    const dir = path.join(root, 'alice');
    const info = ensureUserDirectory(dir);
    expect(info.uid).toBe(process.geteuid?.());
  });

  it('父目录不存在时抛 ENOENT（AC1.7 的场景，不静默创建）', () => {
    const dir = path.join(root, 'missing', 'alice');
    expect(() => ensureUserDirectory(dir)).toThrow(/ENOENT/);
    expect(fs.existsSync(path.join(root, 'missing'))).toBe(false);
  });

  it('已存在的目录会被纠正回 0700（幂等路径）', () => {
    const dir = path.join(root, 'alice');
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    const info = ensureUserDirectory(dir, { idempotent: true });
    expect(info.mode).toBe(0o700);
  });

  it('属主不符时抛错（防把目录建在错误身份下）', () => {
    const dir = path.join(root, 'alice');
    expect(() => ensureUserDirectory(dir, { expectedUid: (process.geteuid?.() ?? 0) + 1 })).toThrow(
      /属主/,
    );
  });

  it('inspect 对不存在的路径返回 exists=false，不抛异常', () => {
    expect(inspectUserDirectory(path.join(root, 'nobody'))).toEqual({
      exists: false,
      mode: null,
      uid: null,
      gid: null,
    });
  });

  it('removeDirectoryIfEmpty 只删空目录', () => {
    const empty = path.join(root, 'empty');
    fs.mkdirSync(empty);
    expect(removeDirectoryIfEmpty(empty)).toBe(true);

    const occupied = path.join(root, 'occupied');
    fs.mkdirSync(occupied);
    fs.writeFileSync(path.join(occupied, 'ai-memory.db'), 'x');
    expect(removeDirectoryIfEmpty(occupied)).toBe(false);
    expect(fs.existsSync(occupied)).toBe(true);
  });
});
