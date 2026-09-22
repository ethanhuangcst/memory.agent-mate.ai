/**
 * 一次性明文暂存（TTL 60 秒）—— 方案 D 的落地件（Issue 4 根治）。
 *
 * 解决什么：签发/轮换的明文此前只在**那一次 POST 响应**里出现，地址栏还停在 API 路由上，
 * 刷新即丢、也无法用「提交→跳转→展示结果」的标准姿势。做法是把明文短期留在**服务端内存**，
 * 用 cookie 带一个**一次性引用**回到详情页渲染 —— 明文不写日志、不入库，这条不变量不变。
 *
 * 三条性质，缺一不可：
 *  1. **单次取用**：`take()` 命中即删 —— 刷新（第二次 GET）拿不到任何东西。
 *  2. **短命**：TTL 60 秒；`put`/`take` 都会顺带清理过期项（无需定时器）。
 *  3. **有上限**：最多 32 条，超出丢最旧 —— 防止被反复签发撑爆进程内存。
 *
 * 已知边界（如实登记）：这是**进程内存** ⇒ 多实例部署时可能落到别的实例上而取不到。
 * 本机单进程无影响；改用共享存储不在本批范围内。
 */

import { randomBytes } from 'node:crypto';

/** cookie 名与暂存引用一一对应；`admin-api` 设置它、`admin-user-detail` 取用并清除它。 */
export const ISSUED_COOKIE = 'portal_issued';

const TTL_MS = 60_000;
const MAX_ENTRIES = 32;

interface Entry {
  readonly plaintext: string;
  readonly expiresAt: number;
}

const entries = new Map<string, Entry>();

/** 存入明文，返回一次性引用 id。 */
export function put(plaintext: string, now: number = Date.now()): string {
  sweep(now);
  const id = randomBytes(24).toString('base64url');
  entries.set(id, { plaintext, expiresAt: now + TTL_MS });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return id;
}

/** 取用明文：**命中即删**；过期同样删除并返回 undefined（引用不可复用）。 */
export function take(id: string, now: number = Date.now()): string | undefined {
  const hit = entries.get(id);
  if (hit === undefined) return undefined;
  entries.delete(id);
  return hit.expiresAt > now ? hit.plaintext : undefined;
}

/** 仅测试使用：清空，避免用例之间互相影响。 */
export function clearIssuedStash(): void {
  entries.clear();
}

function sweep(now: number): void {
  for (const [id, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(id);
  }
}
