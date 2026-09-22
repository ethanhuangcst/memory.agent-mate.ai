/** 展示用格式化（纯函数）。 */

/**
 * ISO 8601 UTC → `YYYY-MM-DD HH:MM`（与原型展示一致）。
 * 不做时区换算：门户展示的是**服务端 UTC 时间**，避免同一份审计在不同浏览器显示不同时刻。
 */
export function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}`;
}

/** 记忆身份：`human:<handle>`（与上游 `[identity]` 约定一致）。 */
export function memoryIdentityOf(handle: string): string {
  return `human:${handle}`;
}
