/**
 * 四语言词表运行时单元测试（§12.4）。
 *
 * 三件事必须钉死：
 *  ① 语言解析优先级：`?lang=` → 记住的选择（cookie）→ `Accept-Language` → 默认；
 *  ② 回落链：当前语言 → `en` → 键名本身；开发期**缺键 fail-loud**（打错的键名当场炸），
 *     生产期保留回落（不因一个键让整页不可用）；
 *  ③ 词表键集合四语言一致，启动期不一致即拒绝启动（否则页面会悄悄退化成英文）。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOCALES, loadConfig, type PortalConfig } from '../../src/config';
import {
  HTML_LANG,
  LOCALE_LABEL,
  createI18n,
  mapTagToLocale,
  pickFromAcceptLanguage,
} from '../../src/web/i18n/index';

let root: string;
let devCfg: PortalConfig;
let prodCfg: PortalConfig;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-i18n-'));
  devCfg = loadConfig({
    PORTAL_ADMIN_HOST: 'localhost',
    PORTAL_MCP_HOST: 'mcp.localhost',
    PORTAL_DB_PATH: path.join(root, 'portal.db'),
  });
  prodCfg = loadConfig({
    PORTAL_ADMIN_HOST: 'memories.example.com',
    PORTAL_MCP_HOST: 'mcp.example.com',
    PORTAL_DB_PATH: '/srv/portal/portal.db',
    PORTAL_ENV: 'production',
    PORTAL_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    PORTAL_ACCESS_AUD: 'aud-tag',
  });
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('mapTagToLocale', () => {
  it('英文族（含地区变体）⇒ en', () => {
    expect(mapTagToLocale('en')).toBe('en');
    expect(mapTagToLocale('en-US')).toBe('en');
    expect(mapTagToLocale('  EN-gb  ')).toBe('en');
  });

  it('香港 / 澳门 与 Hant-HK ⇒ zh-HK', () => {
    expect(mapTagToLocale('zh-HK')).toBe('zh-HK');
    expect(mapTagToLocale('zh-MO')).toBe('zh-HK');
    expect(mapTagToLocale('zh-Hant-HK')).toBe('zh-HK');
  });

  it('台湾 / 泛 Hant ⇒ zh-TW', () => {
    expect(mapTagToLocale('zh-TW')).toBe('zh-TW');
    expect(mapTagToLocale('zh-Hant')).toBe('zh-TW');
    expect(mapTagToLocale('zh-Hant-TW')).toBe('zh-TW');
  });

  it('简体族（zh / zh-SG / Hans）⇒ zh-CN', () => {
    expect(mapTagToLocale('zh')).toBe('zh-CN');
    expect(mapTagToLocale('zh-CN')).toBe('zh-CN');
    expect(mapTagToLocale('zh-SG')).toBe('zh-CN');
    expect(mapTagToLocale('zh-Hans')).toBe('zh-CN');
  });

  it('空串与不支持的语言 ⇒ undefined（不猜、不回落默认）', () => {
    expect(mapTagToLocale('')).toBeUndefined();
    expect(mapTagToLocale('   ')).toBeUndefined();
    expect(mapTagToLocale('fr')).toBeUndefined();
    expect(mapTagToLocale('ja-JP')).toBeUndefined();
  });
});

describe('pickFromAcceptLanguage', () => {
  it('缺少头 ⇒ undefined', () => {
    expect(pickFromAcceptLanguage(undefined)).toBeUndefined();
    expect(pickFromAcceptLanguage('')).toBeUndefined();
  });

  it('按出现顺序取第一个支持的变体（忽略权重与 q 值）', () => {
    expect(pickFromAcceptLanguage('fr-FR;q=1.0,zh-HK;q=0.9,en;q=0.8')).toBe('zh-HK');
    expect(pickFromAcceptLanguage('en-US,en;q=0.9')).toBe('en');
  });

  it('全是不支持的语言 ⇒ undefined（交由默认语言兜底，而不是硬塞 zh-CN）', () => {
    expect(pickFromAcceptLanguage('fr-FR,de-DE;q=0.7')).toBeUndefined();
  });
});

describe('createI18n：词表与回落链', () => {
  it('四语言标签与 html lang 映射齐备', () => {
    const i18n = createI18n(devCfg);
    expect(i18n.locales).toEqual(LOCALES);
    expect(i18n.labels).toEqual(LOCALE_LABEL);
    for (const locale of LOCALES) {
      expect(i18n.htmlLang(locale)).toBe(HTML_LANG[locale]);
    }
  });

  it('开发期缺键 ⇒ 抛错（键名打错在当次请求就炸，不悄悄渲染键名）', () => {
    const i18n = createI18n(devCfg);
    expect(() => i18n.t('en', 'definitely.missing.key')).toThrow(/definitely\.missing\.key/);
  });

  it('生产期缺键 ⇒ 回落为键名本身（不因单个键让整页不可用）', () => {
    const i18n = createI18n(prodCfg);
    expect(i18n.t('en', 'definitely.missing.key')).toBe('definitely.missing.key');
  });

  it('四语言键集合一致 ⇒ 任一语言都能取到同一批键（不出现某语言缺键）', () => {
    const i18n = createI18n(devCfg);
    const fromEn = i18n.t('en', 'brand');
    expect(typeof fromEn).toBe('string');
    for (const locale of LOCALES) {
      expect(i18n.t(locale, 'brand'), locale).toBe(fromEn);
    }
  });

  it('插值：替换已有占位符，缺失的占位符原样保留（不渲染成 undefined）', () => {
    const i18n = createI18n(devCfg);
    const replaced = i18n.t('en', 'pager.showing', { from: 1, to: 20, total: 22 });
    expect(replaced).toContain('1');
    expect(replaced).toContain('20');
    expect(replaced).toContain('22');

    const partially = i18n.t('en', 'pager.showing', { from: 1 });
    expect(partially).toContain('1');
    expect(partially).toMatch(/\{(to|total)\}/);
  });

  it('插值：未传 vars 时模板原样返回', () => {
    const i18n = createI18n(devCfg);
    expect(i18n.t('en', 'pager.showing')).toMatch(/\{from\}/);
  });
});

describe('createI18n：启动期键集合一致性（fail-loud）', () => {
  it('四语言键集合不一致 ⇒ 拒绝启动，并在错误里点明缺/多', () => {
    const dir = path.join(root, 'broken-tables');
    fs.mkdirSync(dir, { recursive: true });
    for (const locale of LOCALES) {
      const table: Record<string, string> = { brand: 'x' };
      if (locale === 'zh-TW') table.extra = 'y'; // 多一个键
      if (locale === 'zh-HK') delete table.brand; // 少一个键
      fs.writeFileSync(path.join(dir, `${locale}.json`), JSON.stringify(table));
    }
    expect(() => createI18n(devCfg, dir)).toThrow(/词表键集合不一致/);
  });

  it('词表文件缺失 ⇒ 启动期直接抛错（不静默用空表）', () => {
    const dir = path.join(root, 'empty-tables');
    fs.mkdirSync(dir, { recursive: true });
    expect(() => createI18n(devCfg, dir)).toThrow();
  });
});

describe('resolve：解析优先级', () => {
  it('query 优先于 cookie、Accept-Language 与默认', () => {
    const i18n = createI18n(devCfg);
    expect(
      i18n.resolve({ query: 'zh-TW', cookie: 'zh-HK', acceptLanguage: 'en-US' }),
    ).toBe('zh-TW');
  });

  it('cookie（用户显式选择）优先于 Accept-Language', () => {
    const i18n = createI18n(devCfg);
    expect(i18n.resolve({ cookie: 'zh-HK', acceptLanguage: 'en-US' })).toBe('zh-HK');
  });

  it('Accept-Language 优先于默认语言', () => {
    const i18n = createI18n(devCfg);
    expect(i18n.resolve({ acceptLanguage: 'en-US' })).toBe('en');
  });

  it('无法识别或全部缺失 ⇒ 回落配置的默认语言', () => {
    const i18n = createI18n(devCfg);
    expect(i18n.resolve({ query: 'fr', cookie: 'de', acceptLanguage: 'ja-JP' })).toBe(
      devCfg.defaultLocale,
    );
    expect(i18n.resolve({})).toBe(devCfg.defaultLocale);
    expect(i18n.resolve({ query: '   ' })).toBe(devCfg.defaultLocale);
  });
});
