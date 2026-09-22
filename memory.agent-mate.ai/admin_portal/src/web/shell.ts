/**
 * 页面外壳上下文：把「四语言 + 导航 + 当前身份」组装成模板可直接使用的数据。
 *
 * 设计取舍（与原型对齐）：语言切换与导航都是**真实链接/表单**，不依赖 JS ——
 * 语言组必须保留 `<button>`（样式按 `.locale-switch button` 命中），故用一个 GET 表单
 * 包住整组，每个按钮以 `name="lang"` 提交自己的值 ⇒ 布局与样式都不变，且无 JS 可用。
 *
 * 语言选择落 cookie（服务端设置），因此后续点击任何链接都保持语言，无需在 URL 上挂 `lang`。
 */

import type { Locale } from '../config';
import type { I18n } from './i18n';

export type NavId = 'users' | 'audit' | 'capacity' | 'mcp';

export interface NavItem {
  readonly href: string;
  /** 词表键（`nav.*`）。 */
  readonly key: string;
  readonly active: boolean;
}

export interface LocaleOption {
  readonly code: Locale;
  readonly label: string;
}

export interface ShellContext {
  readonly locale: Locale;
  readonly htmlLang: string;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
  readonly titleKey: string;
  readonly adminEmail: string;
  readonly navItems: readonly NavItem[];
  readonly localeOptions: readonly LocaleOption[];
  /** 需要在语言切换表单里保留的查询参数（不含 `lang` 本身）。 */
  readonly preservedQuery: readonly { key: string; value: string }[];
  /** 语言切换表单的 action（只含路径，参数走隐藏域）。 */
  readonly formAction: string;
}

export const NAV_ITEMS: readonly { id: NavId; href: string; key: string }[] = [
  { id: 'users', href: '/admin/users', key: 'nav.users' },
  { id: 'audit', href: '/admin/audit', key: 'nav.audit' },
  { id: 'capacity', href: '/admin/capacity', key: 'nav.capacity' },
  // 词表里这一项的键是 `nav.guide`（沿袭原型），不是 `nav.mcp`
  { id: 'mcp', href: '/admin/mcp', key: 'nav.guide' },
];

export interface ShellInput {
  readonly locale: Locale;
  readonly titleKey: string;
  readonly pathname: string;
  readonly adminEmail: string;
  readonly active: NavId | 'none';
  /** 除 `lang` 外要保留的查询参数（如 `page` / `dialog` / `prefix`）。 */
  readonly query?: Record<string, string | undefined>;
}

export function buildShell(i18n: I18n, input: ShellInput): ShellContext {
  const t = (key: string, vars?: Record<string, string | number>): string =>
    i18n.t(input.locale, key, vars);

  const preservedQuery = Object.entries(input.query ?? {})
    .filter(([key, value]) => key !== 'lang' && value !== undefined && value !== '')
    .map(([key, value]) => ({ key, value: String(value) }));

  return {
    locale: input.locale,
    htmlLang: i18n.htmlLang(input.locale),
    t,
    titleKey: input.titleKey,
    adminEmail: input.adminEmail,
    navItems: NAV_ITEMS.map((item) => ({
      href: item.href,
      key: item.key,
      active: input.active === item.id,
    })),
    localeOptions: i18n.locales.map((code) => ({ code, label: i18n.labels[code] })),
    preservedQuery,
    formAction: input.pathname,
  };
}
