# 3.11 mcp:上游身份透传与超时分层探针（Sprint 4 `3.9` 的开工前置）

> **性质**：Sprint 4 `3.9`「mcp:上游能力透传与超时分层」的**开工前置探针**（按 [`ADR-017`](../../specs/adr/ADR-017-complexity-probe-before-real-build.md)：桥的装配是跨进程协议的首个实现，改动前先用可丢弃探针把「不做就会踩」的事实钉死）。
> **排期落点**：`3.9`（Sprint 4 本表行序紧接 `3.8`）。
> **不属制品**：`probes/` 下全部内容不入运行时，不被 CI 与 `Makefile` 引用（与 `mcp-bridge-probe` / `bridge-fallback-probe` 同）。
> **为什么先于 `3.9`**：`3.9` 要把 `initialize` 回包的**身份与能力**改成取自上游 —— 这会把桥从「自报家门」变成「代上游自报家门」，而 SDK 对这两件事的处理方式**写在构造函数里**（不是文档里）。不先跑一遍，就可能写出「上游缺某项能力 ⇒ 桥直接起不来」这类只在特定上游上暴露的缺陷。

## 要回答的问题（一句话）

把 `initialize` 回包的 `serverInfo` / `capabilities` / `instructions` 改成**取自上游**之后，桥还能不能维持 `3.8` 定下的「原样转发、门户语义知识 = 0」；以及「握手超时」与「上游请求超时」能不能真正分层？

## 结论（2026-09-24，七项断言全 PASS、退出码 `0`、两次复跑一致）

| # | 结论 | 证据（实测） |
|---|---|---|
| 1 | **身份与指令可透传，但「逐字节」是错觉** | `serverInfo` 的 `name` / `title` / `version` / `websiteUrl` / `description` **字段与取值全保留**，`instructions` 原样到达；但**键序被 schema 解析重建**（首版探针按字符串比，就因为这个假失败退了一次码 20）⇒ 契约只能写「字段与取值保留」，不能写「逐字节」 |
| 2 | **能力是「归一化后透传」** | `ServerCapabilitiesSchema` 是普通 `z.object` ⇒ 已知键（`tools` / `prompts` / `resources` / `logging` / `experimental` …）保留，**未知键被丢弃**（探针声明的 `vendor/custom` 实测消失，实得 `{"experimental":…,"logging":{},"prompts":{},"resources":{…},"tools":{}}`） |
| 3 | **能力断言在「注册期」，不在「分派期」** | `assertRequestHandlerCapability` **只**从 `setRequestHandler` 调用（`shared/protocol.js:888`），请求分派路径（`protocol.js:284` 起）**不查能力**。实测：`capabilities` 缺 `prompts` 时 `setRequestHandler(ListPromptsRequestSchema, …)` **抛错**（`Server does not support prompts (required for prompts/list)`）；补齐后不抛 |
| 4 | **`capabilities.logging` 会让 SDK 在桥本地吞掉 `logging/setLevel`** | `Server` 构造期即注册该 handler（`server/index.js:54-64`），**本地处理并返回 `{}`**。实测：未处理时上游**收不到**；`removeRequestHandler('logging/setLevel')` 之后上游**收到** |
| 5 | **全 fallback（不注册任何业务 handler）下 `tools/call` 往返正常** | 结果逐字保留（`[{"type":"text","text":"UPSTREAM-RAW-PAYLOAD"}]`）⇒ 「删掉 `3.1` 那 4 个显式 handler」是**可选项** |
| 6 | **请求级超时加在上游请求上生效** | `request(…, {timeout: 300})` + 上游工具挂 `1500ms` ⇒ 客户端 **`303ms`** 收到 `code=-32001`（`RequestTimeout`），与 [`§12.5`](../../specs/web-portal/web-design.md) 的既有口径一致 |
| 7 | **两项超时真正独立** | 握手超时 `300ms`、请求超时 `5000ms` 的桥上，耗时 `1502ms` 的调用**成功** ⇒ 握手超时值**不参与**请求路径 |

## 三条硬约束（`3.9` 实现时必须按此装配）

### ① 身份与能力必须在 `new Server(...)` **之前**取到 —— 且不要用 `registerCapabilities()`

`Client.getServerVersion()` / `getServerCapabilities()` / `getInstructions()` 在上游 client **连接完成后**即可用；而 `Server.registerCapabilities()` 在 `transport` 已连接时**会抛错**（`server/index.js:86-90`）⇒ 那是条时序死路。装配顺序固定为：**先 `spawnUpstream` 完成握手 → 取上游身份/能力/指令 → 再 `new Server(上游身份, { capabilities: 上游能力, instructions: 上游指令 })`**。

### ② 桥的业务 handler 注册必须与「桥声明的能力」自洽

`3.1` 的桥显式注册了 4 个业务 handler，同时把能力**硬编码**为 `{tools, prompts}` —— 这两件事今天恰好自洽。一旦能力改为**取自上游**，就出现耦合：**上游没声明 `prompts` 时，注册 `prompts/*` handler 会在构造期抛错 ⇒ 桥连不上（503）**。

两条出路（`3.9` 采用后者）：
- 按上游能力**条件注册** —— 可行但把 `3.1` 的注册逻辑变成「取决于上游」的分支；
- **删掉 4 个显式业务 handler，只留 fallback** —— 断言 5 已证 `tools/call` 往返正常，且这同时消解约束 ③、并把 `3.8` 的「原样转发」推到字面成立。

### ③ 透传 `logging` 后必须把 `logging/setLevel` **拽回 fallback**

否则客户端调 `setLevel` 会被桥**在本地吞掉**：上游永远不知道级别变了，而客户端以为设置成功（断言 4 的对照支就是这个偏差）。一行 `removeRequestHandler('logging/setLevel')` 即可（该方法是公开 API，`shared/protocol.d.ts:393`）。

> **SDK 无条件内置注册、任何装法都遮蔽 fallback 的三项**：`ping`（`protocol.js:33`，本地自动 pong）、`initialize`（`server/index.js:52`）、`initialized` 通知（`:53`）。这三项**本来就不该转发**，`3.9` 不改变其行为 —— 但要写进契约，免得被当成「透传不彻底」。

## 运行

```bash
cd memory.agent-mate.ai/probes/bridge-identity-probe
npm install
node probe.mjs          # 退出码 0 = 七项断言全过
```

原始输出（本探针的证据）落 `out/probe-<ts>.log`。

| 退出码 | 含义 |
|---|---|
| `0` | 七项断言全过 |
| `10` | 桥 / 上游起不来 |
| `20` | 断言 1 失败（身份或指令未透传） |
| `25` | 断言 2 失败（能力归一化口径与预期不符） |
| `30` | 断言 3 失败（注册期能力断言未按预期触发） |
| `35` | 断言 4 失败（`setLevel` 的本地遮蔽未复现，或拽回后仍未转发） |
| `40` | 断言 5 失败（全 fallback 下 `tools/call` 往返失败） |
| `45` | 断言 6 失败（请求级超时未生效，或超时错误码未原样透传） |
| `50` | 断言 7 失败（两个超时未真正独立） |

## 已知边界（不要误读结论）

- **全进程内（`InMemoryTransport`），不覆盖传输层**：本探针证的是**装配层语义**（构造参数会不会被回吐、能力断言在什么时点触发、SDK 内置 handler 会不会遮蔽 fallback、两个 `timeout` 各管哪一段），这些与传输无关。`Streamable HTTP ⇄ stdio` 双向转发已由 `3.5` / `3.10` 两个探针实证。
- **不覆盖「上游 → 客户端」方向的主动通知与 server→client 请求**：桥目前只做「客户端 → 上游」（`3.8` 的 fallback 也只在收到请求时触发）。**这是既有边界**，不在 `3.9` 范围 —— 但它意味着「原样转发」在**反方向**仍不成立。
- **断言 7 的「独立」是行为层面的**（两个值故意反着设、结果仍正确），不是「两个常量在代码里互不相干」的静态证明。
- **不验真上游**：`ai-memory` 实际声明的能力与版本需另由 `scripts/portal-mcp-probe.sh`（`make portal-mcp-probe`）确认；本探针用的是**能精确控制**的假上游。
- **不验覆盖键门控与生产禁用**：`3.9` 若引入新的超时常量，其「是否可通过环境变量配置」归 `4.1` 的取值批次，本探针不涉及。

## 结论回写

- [`../../specs/mcp/mcp-design.md`](../../specs/mcp/mcp-design.md) §5.6.2 —— `3.9` 探针实证块与桥身份/能力契约。
- [`../../specs/web-portal/web-design.md`](../../specs/web-portal/web-design.md) §12.5 —— 「桥对客户端的身份与能力」定档与超时分层表。
- [`../../specs/mcp/mcp-test.md`](../../specs/mcp/mcp-test.md) §4-F —— `TC-M-L1-18` / `TC-M-L1-19` / `TC-M-L1-20`。
