# `3.10` mcp:桥透传与错误传播探针

> **性质**：探针（按 [`ADR-017`](../../specs/adr/ADR-017-complexity-probe-before-real-build.md)）—— **产物可丢弃**，只回答一个可证伪问题，结论落档即可。
> **排期落点**：Sprint 4 `3.10`（`sprint-backlog.md`），位于 `3.1` 与 `3.8` 之间（**行序 = 执行顺序**，故表序在 `3.8` 之前）。
> **不属制品**：本目录（含 `node_modules/`、`out/`）不进部署制品，也不被 `admin_portal` 依赖。
> **为什么先于 `3.8`**：`3.8` 的判据（「未注册的请求与通知原样转发」「错误按类型区分」）全部依赖 SDK 的**实际**转发与错误传播形状，而这些形状在本仓从未被用过 ⇒ 先交付本探针。

## 要回答的问题（一句话）

桥装上 `fallbackRequestHandler` + `fallbackNotificationHandler` 后，能否把**未显式注册的请求**与**通知**原样交给上游，并让**结果与错误都保持上游的形状**（而不是由桥/SDK 合成）？

## 结论（2026-09-23 实测，命令两次复跑退出码均为 `0`）

| # | 结论 | 证据 |
|---|---|---|
| 1 | **未注册的请求能原样转发**：上游支持而桥未注册的方法（`resources/list`）由**上游**应答，结果**逐字保留**（连非标准形状都穿过 ⇒ 宽松 schema 不校验） | 断言 1：客户端收到 `{"resources":"NOT-AN-STANDARD-SHAPE","_upstream":"fake-upstream"}` |
| 2 | **反证成立**：同一调用打到只把 fallback 写成**构造参数**的 A 组，仍被 SDK 合成 `Method not found` ⇒ 差异确实来自 fallback，且**构造参数形式不生效** | 断言 2：`{"code":-32601,"message":"MCP error -32601: Method not found"}` |
| 3 | **上游错误码原样保留**（客户端可据此分类），但 **message 被逐层加 `MCP error <code>: ` 前缀**（本拓扑 **3 层**） | 断言 3：`code=-32601` 保留；`message="MCP error -32601: MCP error -32601: MCP error -32601: FROM_FAKE_UPSTREAM"` |
| 4 | **`cancelled` 与 `progress` 在每一跳都被 SDK 内置消费，永远落不到 fallback**；要转发取消**必须显式注册**该通知的 handler（实测覆盖后能抵达上游进程） | 断言 4a/4b/4c：4a（无内置 handler 的通知）到上游 ✓；4b（`cancelled`）**不**到 fallback ✓；4c（显式注册后）抵达上游 stdin ✓ |
| 5 | **反证**：通知 fallback 写成构造参数时，通知**不会**到达上游（条数 `1 → 1` 无变化） | 断言 5 |

## 两条硬约束（比「要用 fallback」本身更重要）

### ① 两个 fallback **必须构造后赋值实例属性**，构造参数形式**静默失效**

类型上是合法的 —— `ServerOptions = ProtocolOptions & {…}`，而 `ProtocolOptions` 声明了这两个字段。但运行时：

```
shared/protocol.js:14   constructor(_options) { this._options = _options; … }
```

构造函数**只把 options 存进 `_options`**，从不把两个 fallback 提升为实例属性；而 `_onrequest` / `_onnotification` 读的是 `this.fallbackRequestHandler` / `this.fallbackNotificationHandler` ⇒ 恒为 `undefined`。后果：

- 请求侧：合成 `Method not found`（**至少看得见**）
- 通知侧：`handler === undefined` ⇒ **直接 `return`**（连错误都没有）

⇒ **`3.8` 必须写 `server.fallbackRequestHandler = …` 与 `server.fallbackNotificationHandler = …`**，照类型提示写构造参数会静默失效。本探针的 A 组就是这个反例。

### ② 转发通知的 client 必须声明对应能力，否则**抛错并被 `onerror` 吞掉**

`Client.notification()` 会走 `assertNotificationCapability`：`notifications/roots/list_changed` 要求 `capabilities.roots.listChanged`。首轮实测时桥收到了通知、`upstream.notification()` 却无声失败 —— 错误被 `_onnotification` 的 `.catch(e => this._onerror(e))` 交给 `onerror`，而默认无人监听。

⇒ **`3.8` 的上游 client 须声明「它打算转发的通知」所需的能力**；`cancelled` 与 `progress` 是 `always allowed`（不受此限）。

## 运行

```bash
cd memory.agent-mate.ai/probes/bridge-fallback-probe
npm install          # @modelcontextprotocol/sdk@1.30.0 + zod（与门户同版）
node probe.mjs       # 默认端口 8801
```

可用环境变量覆盖：`PROBE_PORT`。**不依赖 docker**：上游是 `fake-upstream.mjs`（本目录内的假上游，本机 `node` 直接跑）。

退出码契约（与仓内 `probes/` 同范式）：`0` 五项断言全过 · `10` 起不来/上游连不上 · `20` 断言 1 失败 · `25` 断言 2 失败 · `30` 断言 3 失败 · `40` 断言 4 失败 · `45` 断言 5 失败。

原始输出落 `out/probe-<ts>.log`，通知留痕落 `out/notifications-<ts>.log`（本探针的证据）。

## 已知边界（不要误读结论）

- **上游是假上游，不是 `docker exec ai-memory`**：本探针要证的是**桥的转发语义**，需要精确控制「上游支持哪些方法 / 返回什么形状 / 错误文案是什么」。**「能不能连上真上游」那一半**已由 `3.5`（[`../mcp-bridge-probe/`](../mcp-bridge-probe/)）单独证过，两者互补不重叠。
- **`cancelled` 的判据是「抵达上游进程」（stdin 留痕），不是「上游记录了它」**：因为 `cancelled` 在每一跳都被 SDK 内置消费 —— 用落文件判会得到假阴性（本探针 4c 首跑正是如此）。
- **探针不做认证、不碰库路径**：那属 `3.1` / `3.2`。

## 结论回写

- [`mcp/mcp-design.md`](../../specs/mcp/mcp-design.md) **§5.6.2**（桥的转发语义与两条硬约束）
- [`web-portal/web-design.md`](../../specs/web-portal/web-design.md) **§12.5**（转发阶段失败的分类口径）
- 用例登记：[`mcp/mcp-test.md`](../../specs/mcp/mcp-test.md) §4-F（`TC-M-L1-15` / `TC-M-L1-16` / `TC-M-L1-17`）
