# ADR-008: 本地基线复用生产同一份 compose 常驻，MCP 验收分层脚本化

## Status
Accepted

## Context

Sprint 2 #4 需要一条**本地对照基线**：本机跑起 ai-memory-mcp，并**经 MCP 协议**（而非仅 CLI）完成一次写入 + 一次召回，供后续方案（隔离、门户）验证对照；Sprint 3 档位核对、Sprint 5 生产冒烟还要复用同一套判据。

三个约束压在一起：

1. **基线的价值在于与生产同构**。直觉做法是「给本地单独写一份简化 compose 或一次性 `docker run` 容器」——那样卷名、config 挂载点、serve 参数、是否带 curator 都会与生产漂移，测过的结论无法推到生产，基线等于白建。
2. **MCP 客户端（Cursor）接不进一次性容器**。客户端侧是 `docker exec -i <container> ai-memory mcp --tier smart`（与生产 SSH forced command 同构）：容器退出就消失，客户端每次都要重建连接且拿不到稳定容器名 → 基线必须**常驻**。
3. **协议验收此前从未走过**。此前只做过 CLI 级验证（doctor / store / recall / curator）；`initialize → tools/list → tools/call` 通路与「默认档位到底暴露几个工具」都没有实测证据。

## Decision

1. **本地基线不新增专用 compose**：`memory.agent-mate.ai/scripts/local-up.sh` 直接拉起**生产同一份** `memory.agent-mate.ai/deploy/docker-compose.prod.yml`（serve + curator 两个服务）；差异只体现在 gitignored 的 `.env.local` / `config.local.toml` 派生出的 `deploy/.env` / `deploy/config.toml`（compose 固定引用这两个文件名）。
2. **常驻而非一次性**：容器保持 `Up`，供 `docker exec -i` 的 stdio 接入复用于任何时候的客户端验证；停止保留卷用 `docker-compose -f memory.agent-mate.ai/deploy/docker-compose.prod.yml down`。
3. **协议验收脚本化**：新增 `memory.agent-mate.ai/scripts/mcp-smoke.sh`——握手 → 工具数断言 → 唯一标记写入 → **跨进程**语义召回，退出码语义化（10 环境 / 20 握手或工具数 / 30 写入 / 40 召回）。
4. **工具数断言写死 `core = 8`**（core 7 + always-on `memory_capabilities`）：把「默认档位是 core 不是 full」这个静默漂移点变成显式断言。
5. **所有 MCP 测试集中登记于 `memory.agent-mate.ai/specs/mcp/mcp-test.md`**（测试策略 + 计划 + 用例的唯一 spec），分层 L0 前置健康 / L1 协议冒烟 / L1.5 隔离探针 / L2 客户端接入 / L3 生产 SSH 通道；不新增第二处测试清单。

## Rationale

- 同构优先：本地跑的就是生产那份编排，档位、挂载、卷、curator 行为全部一致，基线的结论才能外推。
- 常驻是客户端接入的前提：`docker exec` 挂不到已停容器，且 MCP 客户端不提供「按需拉起」。
- 脚本化而非一次性命令：基线要**可重复**；且 `initialize` 回包核对工具数这一模式正是 Sprint 3 #2 与 Sprint 5 冒烟的判据，符合项目「探针脚本化」惯例（对照 `qwen-verify.sh` / `secret-check.sh`）。
- 唯一标记 + 跨进程召回：写入与召回分两个 `docker exec` 进程，一次运行同时证明「协议通路」与「卷持久化」；召回用语义查询词而不含标记字面量，顺带证明 embedder 未降级为 keyword（静默失败点 #1 的行为级证据）。
- 集中 spec：探针与用例若散落在多个文档，改动 config / 镜像 tag / 档位时无法知道该重跑哪些；集中在 `specs/mcp/mcp-test.md` 可给出单一回归清单。

## Consequences

- 本地会常驻两个容器（serve + curator），占用资源；不再需要时显式 `down`（卷保留）。
- 每次运行冒烟会在本地库留 1 条记忆；上游 near-duplicate 去重会让重复写入返回 CONFLICT —— 脚本按「改验既有标记」容忍，不视为失败。
- 回归触发条件明确：改动 config / 镜像 tag / 档位后重跑 L0 + L1；客户端环境变化（重连 / 换机器）后重跑 L2。
- **`docker-compose.prod.yml` 是生产资产**：本地不得为图方便直接改它，任何改动同时作用于生产。
- L2（真实客户端接入）依赖 `~/.cursor/mcp.json` 用户级条目 `ai-memory-local`；容器重启后需在 MCP 面板 reconnect。
- 生产传输形态为 **stdio-over-SSH**（非 `http url + API key`），源码级核实结论见 `memory.agent-mate.ai/specs/mcp/mcp-test.md` §0；若将来开放 HTTP 入口，须回该 spec 增补远程接入用例。

## Date
2026-09-20

> 2026-09-20：本文档的**路径与指向**随目录改名（`hk_vps_4/` → `memory.agent-mate.ai/`）及 specs 整合同步；决议文字与理由一字未改。
