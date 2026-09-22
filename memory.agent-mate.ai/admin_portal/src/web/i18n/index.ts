/**
 * 四语言词表运行时（§12.4）。
 *
 * 纪律：
 *  - 界面文案**一律取自词表**，模板里不得出现硬编码可读文案；
 *  - 协议名、工具名、标识符（`handle` / `Token` / `memo_` / `MEMORY MCP`）**不翻译**；
 *  - 键集合必须四语言一致，**启动时 fail-loud**（缺键不能让页面悄悄退化成英文）；
 *  - 运行时回落链：当前语言 → `en` → 键名本身（便于一眼看出漏配）。
 *
 * 语言解析顺序：`?lang=` → 记住的选择（cookie）→ `Accept-Language` → 默认语言。
 * 记住的选择排在 `Accept-Language` 之前，因为它是用户的**显式**动作（AC6.3「刷新后保持」）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCALES, type Locale, type PortalConfig } from '../../config';

const I18N_DIR = path.dirname(fileURLToPath(import.meta.url));

export const LOCALE_COOKIE = 'portal_locale';

/** 语言切换按钮的显示标签（与原型一致：EN / 简 / 港 / 台）。 */
export const LOCALE_LABEL: Record<Locale, string> = {
  en: 'EN',
  'zh-CN': '简',
  'zh-HK': '港',
  'zh-TW': '台',
};

export const HTML_LANG: Record<Locale, string> = {
  en: 'en',
  'zh-CN': 'zh-Hans',
  'zh-HK': 'zh-Hant-HK',
  'zh-TW': 'zh-Hant-TW',
};

export type Vars = Record<string, string | number>;

export interface I18n {
  readonly locales: readonly Locale[];
  readonly defaultLocale: Locale;
  readonly labels: Record<Locale, string>;
  resolve(input: {
    query?: string | undefined;
    cookie?: string | undefined;
    acceptLanguage?: string | undefined;
  }): Locale;
  t(locale: Locale, key: string, vars?: Vars): string;
  htmlLang(locale: Locale): string;
}

/** 把 BCP-47 语言标签映射到本门户的四种变体；不支持则返回 undefined。 */
export function mapTagToLocale(tag: string): Locale | undefined {
  const normalized = tag.trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'zh-hk' || normalized === 'zh-mo' || normalized.includes('hant-hk')) return 'zh-HK';
  if (
    normalized === 'zh-tw' ||
    normalized === 'zh-hant' ||
    normalized.includes('hant-tw') ||
    normalized.includes('hant')
  ) {
    return 'zh-TW';
  }
  if (normalized === 'zh' || normalized.includes('hans') || normalized === 'zh-cn' || normalized === 'zh-sg') {
    return 'zh-CN';
  }
  return undefined;
}

/** 解析 `Accept-Language`（忽略权重，按出现顺序取第一个支持的变体）。 */
export function pickFromAcceptLanguage(header: string | undefined): Locale | undefined {
  if (!header) return undefined;
  for (const part of header.split(',')) {
    const tag = part.split(';')[0] ?? '';
    const locale = mapTagToLocale(tag);
    if (locale) return locale;
  }
  return undefined;
}

function loadTable(locale: Locale, dir: string): Record<string, string> {
  const file = path.join(dir, `${locale}.json`);
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

export function createI18n(cfg: PortalConfig, dir: string = I18N_DIR): I18n {
  const tables = new Map<Locale, Record<string, string>>();
  for (const locale of LOCALES) {
    tables.set(locale, loadTable(locale, dir));
  }

  // 启动期 fail-loud：四语言键集合必须与默认语言完全一致
  const reference = tables.get('en') as Record<string, string>;
  const referenceKeys = Object.keys(reference);
  for (const locale of LOCALES) {
    const keys = Object.keys(tables.get(locale) as Record<string, string>);
    const missing = referenceKeys.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !referenceKeys.includes(key));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(
        `词表键集合不一致（${locale}）：缺 ${JSON.stringify(missing)} 多 ${JSON.stringify(extra)}`,
      );
    }
  }

  const isLocale = (value: string | undefined): value is Locale =>
    value !== undefined && (LOCALES as readonly string[]).includes(value);

  return {
    locales: LOCALES,
    defaultLocale: cfg.defaultLocale,
    labels: LOCALE_LABEL,

    resolve(input) {
      const fromQuery = input.query?.trim();
      if (isLocale(fromQuery)) return fromQuery;

      const fromCookie = input.cookie?.trim();
      if (isLocale(fromCookie)) return fromCookie;

      const fromHeader = pickFromAcceptLanguage(input.acceptLanguage);
      if (fromHeader) return fromHeader;

      return cfg.defaultLocale;
    },

    t(locale, key, vars) {
      const table = tables.get(locale);
      const value = table?.[key] ?? reference[key];
      if (value === undefined) {
        // 开发/测试期 fail-loud（§12.4）：让「键名打错」在当次请求里就炸掉，
        // 而不是悄悄把 `nav.mcp` 这种字面量渲染到页面上；生产保留回落以免整页不可用。
        if (!cfg.isProduction) {
          throw new Error(`词表缺键：${key}（来自 ${locale}）`);
        }
        return key;
      }
      return interpolate(value, vars);
    },

    htmlLang(locale) {
      return HTML_LANG[locale];
    },
  };
}
