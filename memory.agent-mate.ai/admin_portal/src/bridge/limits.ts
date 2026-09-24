/**
 * 门户自建的**会话上限**判定（Sprint 4 `4.1`「web-portal:会话限流」）。
 *
 * ## 为什么单独一层（而不是写在 `route.ts` 里）
 *
 * 两个理由，都是本仓的既有纪律：
 *  1. **可确定性复现**：判定做成**纯函数**（吃当前计数与限额，返回决定）⇒ 单测直接喂数，
 *     不依赖起会话、不依赖时序（与 `3.4` 的 `SessionRegistry.reap(now, …)` 同一手法）。
 *  2. **覆盖率预算**：`route.ts` 的 statements 余量**极薄**（本仓注释明写「仅剩 0.08 余量」）
 *     ⇒ 把多分支的判定搬出装配层，`route.ts` 只留**一个** `if`，两条臂都由集成用例覆盖。
 *
 * ## 计数从哪来（本层**不持有状态**）
 *
 * 当前计数一律由 `SessionRegistry` 现算（它已是「在册会话」的**唯一真相源** —— `3.3` / `3.4`
 * 保证登记与回收都只经它）⇒ **不需要第二套计数器**，也就**不会漏释放**（这是本设计相对
 * 「自建计数 + 挂钩释放」的关键取舍：后者一旦漏挂一条回收路径，计数就永久漂移）。
 *
 * ## 优先级（超限时报告哪一个）
 *
 * **先报每 key、再报全局** —— 每 key 是**该用户自己能看懂**的那条（更可操作），全局是兜底。
 * 两个都超时不改变结果（都拒绝），只改变 `scope` 的取值，故这一选择**只影响文案与审计**。
 */

/** 会话上限（`undefined` = 该项**不启用**；`4.1` 的取值由配置给出，不在代码里写死默认值）。 */
export interface SessionLimits {
  /** 每令牌（每 key）并发会话上限。 */
  readonly perKey?: number | undefined;
  /** 全局并发会话上限（该门户实例内所有令牌合计）。 */
  readonly global?: number | undefined;
}

/** 拒绝的归属：`per_key` = 该令牌自己的额度用满；`global` = 实例总额度用满。 */
export type LimitScope = 'per_key' | 'global';

/** 判定结果：`null` = 放行；否则给出归属与**被撞到的那个上限**（文案与审计都不必再猜）。 */
export interface LimitDecision {
  readonly scope: LimitScope;
  readonly limit: number;
}

/**
 * 判定这次「新建会话」是否超限。
 *
 * `current` = 当前**全部**在册会话数 · `currentForKey` = 当前**该令牌**在册会话数
 * （两者都由调用方现算 ⇒ 本函数无副作用、可反复调用）。
 *
 * 两个限额都未配置 ⇒ 恒放行（**未配置即不启用**，与 `3.4` 的两个会话超时同一口径）。
 */
export function decideSessionLimit(
  current: number,
  currentForKey: number,
  limits: SessionLimits,
): LimitDecision | null {
  const perKey = limits.perKey;
  if (perKey !== undefined && currentForKey >= perKey) return { scope: 'per_key', limit: perKey };
  const global = limits.global;
  if (global !== undefined && current >= global) return { scope: 'global', limit: global };
  return null;
}
