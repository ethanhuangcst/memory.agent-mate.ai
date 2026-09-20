# mcp-test — MCP 测试策略 · 测试计划 · 测试用例（Spec）

> **定位**：本文件是未来 MCP 相关测试的**测试策略 + 测试计划 + 测试用例**的唯一 spec。
> 所有 MCP 层面的验收探针（本地基线、档位核对、生产冒烟、客户端接入）在此登记与演进；
> 与 [`sprint_plan.md`](./sprint_plan.md)（执行状态）、[`deployment_strategy.md`](./deployment_strategy.md)（部署真相源）互链不重复。

## §0 传输形态核实（2026-09-20，源码级）

**结论：本项目生产调用方式是 stdio-over-SSH，不是 `http url + API key`。**

| # | 事实 | 证据 |
|---|---|---|
| 1 | 上游**未实现** `/mcp`、`/sse` HTTP 端点；正式路由仅 `/api/v1/*` | 上游 `src/` 全量 grep 无 `"/sse"` / `"/mcp"`（排除 tests）；`docs/INSTALL.md` / `USER_GUIDE.md` 的远程直连描述与实现不符（误判分析见 `deployment_strategy.md` §7） |
| 2 | 官方注册清单只声明 stdio 传输 | 上游 `server.json`：`"type": "stdio"`（另有 `--tier` 参数声明） |
| 3 | `serve` 的 9077 仅绑**容器内回环**，无 api_key，不对外；MCP 客户端不消费它 | `deployment_strategy.md` §3（compose `--host 127.0.0.1`，注释「MCP 走 docker exec，不是 HTTP」） |
| 4 | **当前生产调用方式**：`ssh ai-memory`（forced command `docker exec -i ai-memory-mcp ai-memory mcp --tier smart`） | `deployment_strategy.md` §0 决议 6/7/8；`../deploy/README.md` §首次部署 §调用者侧 |
| 5 | 若**未来**开放 HTTP 入口（`deployment_strategy.md` §8 待办）：届时才需要域名 / NPM / TLS，且 config 顶层必须设 `api_key` + 环境变量 `AI_MEMORY_REQUIRE_API_KEY=1`；本 spec 届时增补「远程接入用例」（§4-C） | `deployment_strategy.md` §3.2 注释、§8 |

## §1 测试策略

分层递进，每层通过才进下一层：

| 层 | 名称 | 手段 | 防的失败模式 |
|---|---|---|---|
| L0 | 前置健康 | `docker exec ai-memory-mcp ai-memory doctor`（LLM/Embeddings 双 200、1024-dim、tier 生效） | 三个**静默失败点**：embedder 降级 keyword / curator `tagged=0` / config 挂载错位退 semantic |
| L1 | 协议冒烟 | [`../scripts/mcp-smoke.sh`](../scripts/mcp-smoke.sh)（stdio JSON-RPC：握手 / 工具断言 / 写入 / 召回） | MCP 协议通路本身（initialize → tools/list → tools/call） |
| L2 | 客户端接入 | Cursor 加载（§3 配置），人肉核对工具清单与一次问答 | 真实客户端环境差异（env / 传输 / 重连） |
| L3 | 生产通道 | 同 L1 模式，传输换成 `ssh ai-memory`（Sprint 5） | SSH forced command / no-pty / 密钥边界 |

原则（承自项目探针惯例）：

- **脚本化可重复**：断言进脚本，退出码语义化，不靠人眼看输出。
- **唯一标记**：每次写入带 `mcp-smoke-<epoch>-<pid>`，断言只匹配当次标记，历史数据不干扰。
- **不泄密**：脚本不读 env、不打印容器环境；key 只存在于容器侧。
- **近重复容忍**：上游 near-duplicate 去重会让重复写入返回 CONFLICT——改验既有标记（通路验证目的一致）。
- **检索工具分工**：`memory_search` 是 ASCII 子串精确匹配——FTS 分词对 CJK 查询**不命中**（2026-09-20 实测：content 连续子串「三层全绿」count=0，ASCII 标记同库 count=2）；**中文/语义查询必须走 `memory_recall`**，冒烟断言用标记字面量走 search 的设计正确。
- **capabilities 优先，但认准口径**：`memory_capabilities`（core 档亦常驻）返回家族清单 / 装载状态 / features / models / 工具总数，是**档位与能力核对的首选探针**（Sprint 3 #2）。注意其 `summary` 的「7 of 100」是**族计数口径**：实际 `tools/list` 注册数 core=**8**，源码 `registry::ALL`=**101**（v0.10.0 与 main 实测皆为 101；manifest 自称 100 的上游口径差未定因）。**一切断言以 `tools/list` 实测为准**。
- **档位只能启动时定**：客户端 harness（Cursor）回报 `your_harness_supports_deferred_registration: false` → `memory_load_family` **不会**把新家族工具注册进 harness；要用 core 之外的家族，必须在客户端 args 里写 `--profile <family>`（与 `--tier` 是两回事，见 §3）。

## §2 测试计划（阶段映射）

| 阶段 | 内容 | 状态 |
|---|---|---|
| Sprint 2 #4 | 本地基线：local-up 常驻 + L0 + L1（mcp-smoke.sh 全通过，证据：8 工具断言、`mode:hybrid` 语义召回命中） | ✅ 2026-09-20 |
| L2 客户端接入（即时） | Cursor 加载 `ai-memory-local`（8 工具 + 2 prompts）+ agent 直调 store/recall/search（§4-B2） | ✅ 2026-09-20 |
| Sprint 3 #2 | 档位核对：**双探针** —— `memory_capabilities`（家族/装载/features/models 全貌）+ `tools/list` 计数（core=8；graph=20 / admin=22 / power=57 / full=101，族口径见 `mcp_tool_inventory.md`）；客户端侧改档须改 mcp.json 的 `--profile` 并重连（harness 不支持延迟注册） | 待做 |
| Sprint 4 | 门户 / 公网入口若引入：先回到 §0 #5 增补远程接入用例 | 待做 |
| Sprint 5 | 服务器冒烟：L3（ssh 通道跑同构 jsonl 会话）+ 生产 doctor 三静默失败点 | 待做 |
| 回归触发 | 每次改动 config / 镜像 tag / 档位后：重跑 L0 + L1（`../deploy/README.md` §冒烟与验收） | 持续 |

## §3 客户端接入配置（Cursor）

### 本地基线（容器常驻后）

`~/.cursor/mcp.json` 的 `mcpServers` 内追加（**放全局，不放项目级** `.cursor/mcp.json`——后者会入库）：

```json
"ai-memory-local": {
  "type": "stdio",
  "command": "docker",
  "args": ["exec", "-i", "ai-memory-mcp", "ai-memory", "mcp", "--tier", "smart"]
}
```

- **只加 `-i`，绝不加 `-t`**：pty 会破坏 stdio 帧（与生产 forced command `no-pty` 同因）。
- **无需 `env` 字段**：`docker exec` 继承容器环境，qwen key 不进 Cursor 配置、不进仓。
- 前置：`bash memory.agent-mate.ai/scripts/local-up.sh` 已常驻；容器被 down / 重启后在 Cursor MCP 面板 reconnect。
- 生效核对：Settings → MCP 出现 `ai-memory-local` 且可见 8 个 `memory_*` 工具。
- **改档位**（要用 lifecycle / graph / power 等家族）：在 `args` 里加 `--profile <family>`（如 `--profile core,graph`）；`--tier` 是**搜索档**（semantic/smart），`--profile` 是**工具档**，二者独立。**Cursor 不支持运行中动态注册**（`memory_load_family` 对 harness 无效），改完必须重启该 MCP 条目 / reconnect。

### 生产（Sprint 5 上线后，与本地条目并存）

```json
"ai-memory": {
  "command": "ssh",
  "args": ["ai-memory"]
}
```

`~/.ssh/config` 与 forced command 见 [`../deploy/README.md`](../deploy/README.md) §首次部署 §调用者侧。agent_id 无法在 mcp.json 配置（forced command 限制，见 `deployment_strategy.md` §5 注）。

## §4 测试用例

### A. 现役：`mcp-smoke.sh`（L1，本地基线）

| ID | 用例 | 断言 | 失败退出码 |
|---|---|---|---|
| TC-ENV-01 | 前置：容器 `ai-memory-mcp` 常驻运行 | `docker ps` 可见 | 10 |
| TC-HS-01 | initialize 握手（protocolVersion 2024-11-05） | 回包 `serverInfo.name == "ai-memory"` | 20 |
| TC-HS-02 | tools/list 工具清单 | **恰 8 个**（core 7 + always-on `memory_capabilities`），且含 store/search/recall/capabilities | 20 |
| TC-W-01 | `memory_store` 写入含唯一标记的自然语句 | 成功；CONFLICT 时改验既有标记可提取 | 30 |
| TC-R-01 | **新进程** `memory_recall`，查询词描述主题但**不含标记字面量** | 结果含生效标记 → 语义检索工作（embedder 未降级） | 40 |
| TC-R-02 | **新进程** `memory_search`，用标记字面量查询 | 命中 → 跨进程持久化 + 检索通路 | 40 |

> TC-W/R 分两个 `docker exec` 进程 = 同时证明「协议通路」与「卷持久化」。全通过退出码 0。

### B. 现役：doctor 三静默失败点（L0）

| ID | 用例 | 断言 |
|---|---|---|
| TC-DOC-01 | `ai-memory doctor` | LLM Reachability 200；Embeddings Reachability 200 且 dim=1024；tier=smart |
| TC-DOC-02 | `ai-memory curator --once --dry-run --json` | `tagged > 0` |

### B2. 现役：L2 客户端接入（Cursor `ai-memory-local`）

| ID | 用例 | 断言 |
|---|---|---|
| TC-L2-01 | Cursor MCP 面板加载 `ai-memory-local` | 8 个 `memory_*` 工具 + 2 prompts，无启动报错 |
| TC-L2-02 | agent 直调 `memory_store`，content 含唯一标记 `l2-client-<date>` | 返回 id；**负例**：非法枚举参数（如 `source`）被服务端拒绝并列出合法值，无静默吞错 |
| TC-L2-03 | `memory_recall`，查询词描述主题但**不含标记字面量** | 新记忆以最高分命中（语义通路，embedder 未降级） |
| TC-L2-04 | `memory_search`，用标记字面量查询 | 恰命中该 id（count=1） |

> 首次执行（2026-09-20）：全部通过。标记 `l2-client-20260920` → id `55d04c8c-1910-4d04-a8b7-5c41dced492d`；recall `mode:hybrid` score 0.887 排第一；search count=1；`source:"codebuddy"` 被拒后改 `user` 成功。
>
> 补充实测（同日，对话记忆召回）：总结记忆 `bbd29a16` recall 语义命中 score **0.893** 居首；同时发现 `memory_search` 中文查询一律 count=0（对照：ASCII 标记 `l2-client-20260920` 同库 count=2）——检索分工结论见 §1 原则。
>
> 第二次执行（同日，**另一客户端交叉验证**）：另一个 Cursor agent（`ai:cursor-vscode@974b303dab0e`，同一容器）向 `places-workspace` 命名空间写入 3 条 long-tier 记忆——其中一条首轮因 `source:"conversation"` 被拒（TC-L2-02 负例**独立再现**），修正为 `user` 后 **3/3 落库**；随后由本客户端按语义召回**交叉命中**（score 0.899 / 0.781）。结论：**跨客户端写入 + 跨客户端召回**可作为 L2 加强判据（证明库/通路与具体客户端无关）；另注意被拒轮次与成功轮次并存时，客户端叙述可能只报结果（"已写入 3 条"）——核验一律以 `memory_list`/`memory_get` 为准。

### C. 占位（随阶段增补）

| ID | 用例 | 触发阶段 |
|---|---|---|
| TC-TIER-xx | 各档位 initialize+tools/list 工具数断言（core=8 已锚定；full/minimal 待核） | Sprint 3 #2 |
| TC-SSH-xx | `ssh ai-memory` 通道跑 §4-A 同构 jsonl；`no-pty` / 误加 `-t` 帧损坏负例 | Sprint 5 |
| TC-HTTP-xx | （仅当开放 HTTP 入口）url+api_key 接入、未带 key 401、§0 #5 前置配置生效 | Sprint 4 或 §8 待办落地时 |

## §5 版本记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | 初版：定位声明（MCP 测试策略+计划+用例的 spec）；传输形态核实（stdio-over-SSH，非 http url+API key，源码级证据）；固化 mcp-smoke.sh 6 用例与 doctor 2 用例；登记本地/生产 Cursor 接入配置；占位 Sprint 3/4/5 用例 |
| 2026-09-20 | 增补 §4-B2 L2 客户端接入用例（TC-L2-01..04）并记录首次执行全通过；§2 登记 L2 ✅（用户配置 Cursor 后 8 工具 + 2 prompts 加载确认） |
| 2026-09-20 | 增补 §1 原则两条（capabilities 探针与计数口径：manifest 族口径 100/core 7 vs `tools/list` core=8 vs 源码 `ALL`=101；**档位只能启动时定**——harness 不支持延迟注册）与 §3 改档说明；§2 Sprint 3 #2 改双探针；§4-B2 记录第二客户端交叉验证（`places-workspace` 3 条，`source` 负例独立再现并自愈） |
