/**
 * 会话注册表与生命周期 —— 桥模块**唯一的会话状态持有者**。
 *
 * 依据：`specs/web-portal/web-design.md` §12.5（会话注册表字段）· `mcp-design.md` §5.6.2。
 *
 * ## 归属说明
 *
 * - **`3.1`**：登记 / 注销 / 关闭顺序 / 「客户端断开与流结束 ⇒ 回收」的骨架。
 * - **`3.4`（本批）**：**到期判定与回收**（`reap`，吃 `now` 的纯方法）+ 会话记录字段
 *   `childPid` / `dbPath`。定时器与三类触发（空闲 / 最长时长 / 吊销）的**接线在 `route.ts`**
 *   —— 本层只做判定，不自己读时钟、不起 timer（判据要能确定性复现，见 `reap` 的注释）。
 * - **`4.1`（后续）**：并发上限与超时的**取值**。本层**只接受读入的限额**，
 *   **未提供 = 不启用该触发**（不写死默认值；键名已登记于 `web-design.md` §12.9）。
 *
 * 当前为**单实例部署**（`web-design.md` §12.1），注册表只需进程内结构、无需持久化。
 */

import type { BridgeTransport } from './transport';
import type { UpstreamSession } from './spawn';

export interface BridgeSession {
  /**
   * 门户侧会话 id（与 HTTP 层 `Mcp-Session-Id` 同源）。
   *
   * **可变**：SDK 在 `initialize` 处理完成后才给传输层赋值，创建时只能先占位空串，
   * 转发成功后由 `route.ts` 回填并登记（见 `relay()`）。
   */
  id: string;
  /** 用户句柄（来自门户数据库，非请求）。 */
  readonly handle: string;
  readonly userId: number;
  /** 建立该会话时通过校验的令牌 id —— 用于「同一令牌才能继续使用本会话」的判定。 */
  readonly keyId: number;
  readonly transport: BridgeTransport;
  readonly upstream: UpstreamSession;
  readonly startedAt: number;
  lastActivityAt: number;
  /**
   * **门户侧**被 spawn 的那个进程的 pid（`3.4`；取自 `StdioClientTransport.pid`）。
   *
   * **语义边界（`3.13` 探针实测）**：本机借壳（`PORTAL_LAUNCH_OVERRIDE` 走 `docker exec`）下
   * 它指向**宿主上的 `docker` 客户端**，**不是**容器里的上游进程；生产 β′（门户容器内直接
   * spawn）下它才是上游进程。⇒ 「子进程归零」的**权威判据仍走容器内观测**（`web-design.md`
   * §12.5），本字段用于**宿主侧对照**与排障。`null` = SDK 未报告（例如未连接成功时）。
   */
  readonly childPid: number | null;
  /**
   * 该会话**解析后的**库路径（`3.4`；模板渲染结果，非请求输入）。
   *
   * 用途有二：① `AC4.3` 的「会话建立」审计行只在这一处取值；② 排障时不必再去反推模板。
   * **不含机密**（是路径，不是 env 值）。
   */
  readonly dbPath: string;
}

/**
 * 到期判定的两个限额（`3.4`）。
 *
 * **未提供 = 不启用该触发** —— 取值归 `4.1`，本层不写死默认值（与 `McpBridgeDeps` 的两个
 * 超时字段同一纪律：生产从 `config.ts` 读、测试才注入短值）。
 */
export interface ReapLimits {
  /** 空闲超时（毫秒）：`now - lastActivityAt >= idleMs` 即到期。 */
  readonly idleMs?: number | undefined;
  /** 单会话最长时长（毫秒）：`now - startedAt >= maxMs` 即到期。 */
  readonly maxMs?: number | undefined;
}

export class SessionRegistry {
  private readonly byId = new Map<string, BridgeSession>();

  add(session: BridgeSession): void {
    this.byId.set(session.id, session);
  }

  get(id: string): BridgeSession | undefined {
    return this.byId.get(id);
  }

  /**
   * `4.1`：当前**在册会话数**（全局并发上限的判据）。
   *
   * **现算、不维护第二套计数器**：本注册表已是「在册会话」的唯一真相源（`3.3` / `3.4` 保证登记与
   * 回收都只经它）⇒ 计数不会因为「某条回收路径忘了减一」而永久漂移。
   */
  countAll(): number {
    return this.byId.size;
  }

  /** `4.1`：当前**该令牌**在册会话数（每 key 并发上限的判据）。口径同 `countAll()`。 */
  countByKey(keyId: number): number {
    let n = 0;
    for (const session of this.byId.values()) {
      if (session.keyId === keyId) n += 1;
    }
    return n;
  }

  /**
   * `4.1`：**剔除「传输已关闭」的会话**（它们该走了、只是条目还没摘）并返回剔除个数。
   *
   * **为什么需要它**：条目只在三种时机被摘 —— `reap`（空闲/最长时长到期）· 该会话**自己的**下一次
   * 请求（「自己的终态」那一支）· 登记失败。客户端 `DELETE` 之后到上述任一时机之间，条目仍算「在册」；
   * 对**并发上限**而言，那就是一份**容量泄漏**：用户会被自己的旧会话挡住，直到空闲回收才放行。
   *
   * 故在建会话**之前**先做一次懒清理：**确定性**（不依赖后台定时器是否会跑）· **幂等**（`close()` 对
   * 已关闭会话是安全的：先删条目、再尽力关传输与上游）· **不引入第二套生命周期**（仍只经 `close()`）。
   */
  async pruneClosed(): Promise<number> {
    const closed = [...this.byId.values()].filter((session) => session.transport.isClosed());
    for (const session of closed) await this.close(session);
    return closed.length;
  }

  /** 注销并**不**负责关闭上游（关闭由调用方在拿到对象后执行，便于记录失败）。 */
  remove(id: string): BridgeSession | undefined {
    const session = this.byId.get(id);
    if (session) this.byId.delete(id);
    return session;
  }

  get size(): number {
    return this.byId.size;
  }

  /** 当前活跃会话的句柄列表（供日志 / 排障；**不含**任何机密）。 */
  handles(): string[] {
    return [...this.byId.values()].map((session) => session.handle);
  }

  /**
   * 关闭一个会话：先关 HTTP 传输侧，再关上游；注册表条目最后移除。
   * 任一步失败都不抛出（回收路径必须尽力而为），失败只体现在返回值里。
   */
  async close(session: BridgeSession): Promise<void> {
    this.byId.delete(session.id);
    try {
      await session.transport.close();
    } catch {
      /* 尽力而为 */
    }
    try {
      await session.upstream.close();
    } catch {
      /* 尽力而为 */
    }
  }

  /**
   * 回收**已到期**的会话，返回被回收的 id 列表（顺序 = 回收顺序，便于断言与排障）。
   *
   * ## 为什么吃 `now` 而不是自己读时钟 / 不起 timer
   *
   * 判据要能**确定性复现**。若把到期判定埋进 `setTimeout` 回调，测试就只能 `sleep` 撞时间
   * （本仓已定档过「只断状态码会漏掉『超时没生效』」的教训，见 `TC-M-L1-19`）。抽成吃 `now`
   * 的纯方法后：单测**直接喂时间戳**（不睡）、集成层再用注入的短值跑端到端；定时器留在装配层
   * （`route.ts` 起**单一** `setInterval(...).unref()`）。
   *
   * ## 口径
   *
   * - **空闲到期**：`now - lastActivityAt >= idleMs`（复用支已在刷新 `lastActivityAt`）
   * - **超最长时长**：`now - startedAt >= maxMs` —— 与空闲**独立判定**（刚活动过也可能到期）
   * - 未配置的限额 ⇒ 该触发**不启用**（两者都未配置时直接返回，不做任何事）
   * - 回收走既有 `close()`：幂等、不抛出（已经不在表里的会话不会被重复回收）
   */
  async reap(now: number, limits: ReapLimits): Promise<string[]> {
    const { idleMs, maxMs } = limits;
    if (idleMs === undefined && maxMs === undefined) return [];

    // 先取快照再逐个回收：`close()` 会改 `byId`，边遍历边删不可靠。
    const expired = [...this.byId.values()].filter((session) => {
      const idleExpired = idleMs !== undefined && now - session.lastActivityAt >= idleMs;
      const tooLongExpired = maxMs !== undefined && now - session.startedAt >= maxMs;
      return idleExpired || tooLongExpired;
    });

    const reaped: string[] = [];
    for (const session of expired) {
      reaped.push(session.id);
      await this.close(session);
    }
    return reaped;
  }

  /** 关闭全部会话（进程退出 / `onClose` 钩子用）。 */
  async closeAll(): Promise<void> {
    const all = [...this.byId.values()];
    for (const session of all) {
      await this.close(session);
    }
  }
}
