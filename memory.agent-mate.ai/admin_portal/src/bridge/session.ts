/**
 * 会话注册表与生命周期 —— 桥模块**唯一的会话状态持有者**。
 *
 * 依据：`specs/web-portal/web-design.md` §12.5（会话注册表字段）· `mcp-design.md` §5.6.2。
 *
 * ## 归属说明
 *
 * - **`3.1`（本批）**：登记 / 注销 / 关闭顺序 / 「客户端断开与流结束 ⇒ 回收」的骨架。
 * - **`3.4`（后续）**：回收的**验收判据**（子进程归零、路径留痕审计）与空闲超时 / 单会话最长时长。
 * - **`4.1`（后续）**：并发上限与超时的**取值**。本批只留读取位，**不写死默认值**
 *   （键名已在 `web-design.md` §12.9 登记为 `PORTAL_SESSION_IDLE_TIMEOUT` 等）。
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
}

export class SessionRegistry {
  private readonly byId = new Map<string, BridgeSession>();

  add(session: BridgeSession): void {
    this.byId.set(session.id, session);
  }

  get(id: string): BridgeSession | undefined {
    return this.byId.get(id);
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

  /** 关闭全部会话（进程退出 / `onClose` 钩子用）。 */
  async closeAll(): Promise<void> {
    const all = [...this.byId.values()];
    for (const session of all) {
      await this.close(session);
    }
  }
}
