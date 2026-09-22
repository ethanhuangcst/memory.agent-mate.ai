/**
 * 词表护栏：模板里写死的键必须真的存在。
 *
 * 为什么需要它：`i18n.js` 的 220 键沿袭原型命名（例如侧栏第三项键名是 `nav.guide`
 * 而不是 `nav.mcp`），打错一个键在页面上表现为**原样显示键名**，很容易被当成「文案待补」
 * 而漏掉。这里把「模板里出现的键」逐条与词表对照，让这类缺陷在离线测试里就暴露。
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_PORTAL_ROOT, LOCALES } from '../../src/config';
import { NAV_ITEMS } from '../../src/web/shell';

const VIEWS_DIR = path.join(ADMIN_PORTAL_ROOT, 'src', 'web', 'views');
const I18N_DIR = path.join(ADMIN_PORTAL_ROOT, 'src', 'web', 'i18n');

function readTables(): Record<string, Record<string, string>> {
  const tables: Record<string, Record<string, string>> = {};
  for (const locale of LOCALES) {
    tables[locale] = JSON.parse(
      fs.readFileSync(path.join(I18N_DIR, `${locale}.json`), 'utf8'),
    ) as Record<string, string>;
  }
  return tables;
}

function collectTemplateFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.njk')) out.push(full);
    }
  };
  walk(VIEWS_DIR);
  return out;
}

describe('词表键护栏', () => {
  it('四语言键集合完全一致（启动期校验的离线复现）', () => {
    const tables = readTables();
    const reference = Object.keys(tables.en as Record<string, string>).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(tables[locale] as Record<string, string>).sort(), locale).toEqual(reference);
    }
    expect(reference.length).toBeGreaterThan(220);
  });

  it('模板里 `t(\'…\')` 写死的键全部存在', () => {
    const table = readTables().en as Record<string, string>;
    const missing: string[] = [];
    for (const file of collectTemplateFiles()) {
      const source = fs.readFileSync(file, 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) {
        const key = match[1] as string;
        if (!(key in table)) missing.push(`${path.basename(file)}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('侧栏导航的键都能解析出真实文案（不是键名本身）', () => {
    const table = readTables().en as Record<string, string>;
    for (const item of NAV_ITEMS) {
      expect(table[item.key], item.key).toBeTruthy();
      expect(table[item.key], item.key).not.toBe(item.key);
    }
  });

  it('route 侧引用的占位页与错误键存在（跨模块契约）', () => {
    const table = readTables().en as Record<string, string>;
    const referenced = [
      'placeholder.audit.title',
      'placeholder.audit.body',
      'placeholder.capacity.title',
      'placeholder.capacity.body',
      'placeholder.mcp.title',
      'placeholder.mcp.body',
      'placeholder.instructions.title',
      'placeholder.instructions.body',
      'placeholder.batchNote',
      'admin.unauthorized.title',
      'admin.unauthorized.body',
      'users.error.handle.empty',
      'users.error.handle.traversal',
      'users.error.handle.tooLong',
      'users.error.handle.pattern',
      'users.error.handleExists',
      'users.error.directory',
      'detail.error.userNotFound',
      'detail.error.keyNotFound',
      'detail.error.keyNotActive',
      'detail.error.directory',
      'detail.error.alreadyDisabled',
      'detail.issued.title',
      'detail.issued.body',
      'detail.issued.hint',
      'detail.diag.deferred',
      'detail.diag.w1',
    ];
    for (const key of referenced) {
      expect(table[key], key).toBeTruthy();
    }
  });

  it('品牌串与版权四语言同值（不翻译）', () => {
    const tables = readTables();
    for (const locale of LOCALES) {
      const table = tables[locale] as Record<string, string>;
      expect(table.brand).toBe('memory.agent-mate.ai - AI Memory MCP');
      expect(table.copyright).toContain('Ethan Huang');
    }
  });

  it('中文变体里 Token 一律不译（口径统一）', () => {
    const tables = readTables();
    for (const locale of ['zh-CN', 'zh-HK', 'zh-TW'] as const) {
      const values = Object.values(tables[locale] as Record<string, string>).join('\n');
      expect(values, locale).not.toContain('令牌');
      expect(values, locale).not.toContain('權杖');
    }
  });
});
