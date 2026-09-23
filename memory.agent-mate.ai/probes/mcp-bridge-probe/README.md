# `3.5` mcp:桥可行性探针

> **性质**：探针（按 [`ADR-017`](../../specs/adr/ADR-017-complexity-probe-before-real-build.md)）—— **产物可丢弃**，只回答一个可证伪问题，结论落档即可。
> **排期落点**：Sprint 4 `3.5`（`sprint-backlog.md`），是 Sprint 4 的**第一行**（执行顺序第一）。
> **不属制品**：本目录（含 `node_modules/`、`out/`）不进部署制品，也不被 `admin_portal` 依赖。

## 要回答的四个问题

| # | 问题 | 本探针如何回答 |
|---|---|---|
| 1 | 官方 SDK 的 **Streamable HTTP server transport** 能否在 Node 下与 **stdio client transport** 直连，把一次 MCP 请求转发给**已启动的上游子进程**并取回**完整回包**？ | 四项断言：`tools/list` 经桥可达 · `memory_store` 经桥成功 · `memory_recall` 回读到刚写入的标记 · 会话断开后子进程回收 |
| 2 | 该 SDK 的**当前版本与签名**是什么？（§12.5 要求「按官方文档核对当前签名，不得照抄历史片段」） | 钉版 `@modelcontextprotocol/sdk@1.30.0`，并在 `probe.mjs` 顶部注明实际使用的构造与字段 |
| 3 | SDK 自带的 **`Mcp-Session-Id` / SSE / GET** 语义是什么？ | 运行日志打印 HTTP 层会话 id 与传输形态，结论回写 `mcp-design.md` §5.6.2 |
| 4 | 子进程 spawn 的**可用形状**：cwd / env 继承 / stdio 缓冲 / stderr 去向？ | `StdioClientTransport` 的 `command/args/env/cwd/stderr` 实证 + 上游 stderr 被本进程收集 |

## 已知的边界（不要误读结论）

- **本机是 macOS，镜像内是 linux/amd64 二进制 ⇒ 无法在宿主机直接 spawn 上游二进制。** 因此本探针的 stdio 端用
  `docker exec -i <container> /usr/local/bin/ai-memory mcp …` 模拟「stdin/stdout 接一个上游子进程」。
- **「容器内 spawn 二进制」这一半不归本探针**：它已由 Sprint 2 的 β′ 探针单独证过，见
  [`../../specs/knowledge/web-portal/portal-launch-mechanism.md`](../../specs/knowledge/web-portal/portal-launch-mechanism.md) E1–E7。
  两者互补、不重叠：**β′ 证「怎么起」，本探针证「起了之后怎么转」**。
- 探针**不做认证**（不校验 `memo_` 令牌）—— 令牌接入是 `3.1` 的实现内容，不在本探针的可证伪问题里。

## 运行

```bash
cd memory.agent-mate.ai/probes/mcp-bridge-probe
npm install          # 装 @modelcontextprotocol/sdk@1.30.0
node probe.mjs       # 默认端口 8799 · 容器 ai-memory-mcp · 库 /tmp/probe/ai-memory.db
```

可用环境变量覆盖：`PROBE_PORT` · `PROBE_CONTAINER` · `PROBE_BIN` · `PROBE_HANDLE` · `PROBE_DB_DIR` · `PROBE_DB`。

退出码：`0` 跑通 · `10` 起不来 / 上游连不上 · `20` 握手或 `tools/list` 失败 · `30` 工具调用失败 · `40` 收尾失败。

原始输出落 `out/probe-<ts>.log`（本探针的证据），**结论回写**：

- `specs/mcp/mcp-design.md` **§5.6.2**（桥的传输形态与 Session 语义）
- 若发现规格缺口（如失败面状态码、子进程 cwd/env 口径），同批补进 `mcp-design.md` §5.6.4 / `web-portal/web-design.md` §12.5
