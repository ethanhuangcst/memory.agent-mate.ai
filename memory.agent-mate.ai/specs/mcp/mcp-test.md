# mcp-test — MCP 测试策略 · 测试计划 · 测试用例（Spec）

> **定位**：本文件是 MCP 相关测试的**测试策略 + 测试计划 + 测试用例**的唯一 spec。所有 MCP 层验收探针（本地基线、档位核对、隔离探针、生产冒烟、客户端接入）在此登记与演进；与 [`../sprint-plan.md`](../sprint-plan.md)（执行状态）、[`../deployment.md`](../deployment.md)（部署动作）、[`./mcp-design.md`](./mcp-design.md)（隔离与能力设计）互链不重复。
> **状态**：v1.2 · as_of 2026-09-21

---

## §0 传输形态核实（2026-09-20，源码级）

**结论：生产调用方式是 stdio-over-SSH，不是 `http url + API key`。**

| # | 事实 | 证据 |
|---|---|---|
| 1 | 上游**未实现** `/mcp`、`/sse` HTTP 端点；正式路由仅 `/api/v1/*` + `/metrics` | `src/handlers/routes.rs:14-95`；`server.json` 只声明 `"type":"stdio"` |
| 2 | `stdout` 被 JSON-RPC 独占，日志走 stderr | `src/mcp/mod.rs:3301,3329-3348` |
| 3 | `serve` 的 9077 仅绑容器内回环、无 api_key、不对外；MCP 客户端不消费它 | [`../deployment.md`](../deployment.md) §3 |
| 4 | **当前生产调用**：`ssh ai-memory`（forced command `docker exec -i ai-memory-mcp ai-memory mcp --tier smart`） | 同上 §4.3 |
| 5 | 若**未来**开放 HTTP 入口：届时才需域名 / NPM / TLS，且 config 顶层必须设 `api_key` + `AI_MEMORY_REQUIRE_API_KEY=1`；本 spec 届时增补「远程接入用例」（§4-C） | 契约面 H2/H4 |

---

## §1 测试策略

分层递进，每层通过才进下一层：

| 层 | 名称 | 手段 | 防的失败模式 |
|---|---|---|---|
| L0 | 前置健康 | `docker exec ai-memory-mcp ai-memory doctor`（LLM/Embeddings 双 200、1024-dim、tier 生效）+ curator `--once --dry-run --json` | 三个**静默失败点**：embedder 降级 keyword / curator `tagged=0` / config 挂载错位退 semantic |
| L1 | 协议冒烟 | [`../../scripts/mcp-smoke.sh`](../../scripts/mcp-smoke.sh)（stdio JSON-RPC：握手 / 工具断言 / 写入 / 召回） | MCP 协议通路本身（initialize → tools/list → tools/call） |
| L1.5 | 隔离探针 | [`../../scripts/iso-probe.sh`](../../scripts/iso-probe.sh)（A/B/C 组，P1a–P6） | **R1 / D5**：漏设 `AI_MEMORY_DB` 必须 fail-loud、解析目标非共享主库且共享主库不变；显式用户库双向隔离（[`./mcp-design.md`](./mcp-design.md) §6） |
| L1.6 | 多语言探针 | [`../../scripts/i18n-probe.sh`](../../scripts/i18n-probe.sh)（三语言写入 → 关键词 12 组对照 → 语义召回 + 按 id 直取 → 结论矩阵；退出码 0/10/20/30/40/50，`I18N_PROBE_STRICT=1` 把语言边界当断言） | 对 CJK 记忆**误用关键词通路** → 静默 count=0 假象「记忆丢了」（结论矩阵与用例见 §4-E） |
| L1.7 | 配额探针 | [`../../scripts/limits-probe.sh`](../../scripts/limits-probe.sh)（一次性库 `/data/users/limits-probe/` + 每轮全新身份 + **仅 env 注入**小阈值；退出码 0/10/20/30/40/50/60/70，`--self-test` 负向自测） | 上游 `[limits]` **改配置不等于行为生效**：配额逐 `(agent_id, namespace)` 盖章、且 **CLI 一次性写入不计费**，用错验证方式会得出「配额失效」的假结论（用例见 §4-D TC-LIMIT） |
| L1.8 | 每库维护探针 | [`../../scripts/gc-probe.sh`](../../scripts/gc-probe.sh)（独立一次性库 + 静态审计维护脚本 + `--self-test`；退出码 0/10/20/30/40/50/60/70） | 上游维护覆盖面判错：**TTL 驱逐不只由 `gc` 触发**（`store`/`list`/`recall`/`import` 都会惰性清扫）⇒ 误把 `gc` 计数当「过期总量」；漏传 `--db` ⇒ 静默新建相对路径库或误操作主库；v0.11 attestation 缺省翻转后维护任务升级即失效（用例见 §4-C TC-GC） |
| L2 | 客户端接入 | Cursor 加载（§3 配置），人肉核对工具清单与一次问答 | 真实客户端环境差异（env / 传输 / 重连） |
| L3 | 生产通道 | 同 L1 模式，传输换成 `ssh ai-memory`（Sprint 5） | SSH forced command / `no-pty` / 密钥边界 |

原则（承自项目探针惯例）：

- **脚本化可重复**：断言进脚本，退出码语义化，不靠人眼看输出。
- **唯一标记**：每次写入带 `mcp-smoke-<epoch>-<pid>`，断言只匹配当次标记，历史数据不干扰。
- **不泄密**：脚本不读 env、不打印容器环境；key 只存在于容器侧。
- **近重复容忍**：上游 near-duplicate 去重会让重复写入返回 CONFLICT —— 改验既有标记（通路验证目的一致）。
- **检索工具分工**：`memory_search` 关键词通路按 FTS5 默认分词器（`unicode61`，无 `tokenize=`）以**完整词元** AND 匹配——英文词元 = 单词；中文词元 = 标点/空白界定的**整段**，词元内子串与**简繁交叉**一律不命中（精确边界与实测矩阵见 §4-E，源码依据 [`./mcp-design.md`](./mcp-design.md) §9 J4）；**中文/语义查询必须走 `memory_recall`**。
- **capabilities 优先，但认准口径**：`memory_capabilities`（core 档亦常驻）返回家族清单 / 装载状态 / features / models / 工具总数，是档位与能力核对的**首选探针**。注意其 `summary`「7 of 100」是**族计数口径**；实际 `tools/list` 注册数 core=**8**，源码 `registry::ALL`=**101**。**一切断言以 `tools/list` 实测为准**。
- **档位只能启动时定**：客户端 harness（Cursor）回报 `deferred_registration: false` → `memory_load_family` **不会**把新家族注册进 harness；要用 core 之外的家族，必须在客户端 args 里写 `--profile <family>`（`--tier` 是搜索档，二者独立）。

---

## §2 测试计划（阶段映射）

| 阶段 | 内容 | 状态 |
|---|---|---|
| Sprint 2 #4 | 本地基线：local-up 常驻 + L0 + L1（证据：8 工具断言、`mode:hybrid` 语义召回命中） | 已完成 2026-09-20 |
| L2 客户端接入（即时） | Cursor 加载 `ai-memory-local`（8 工具 + 2 prompts）+ agent 直调（§4-B2） | 已完成 2026-09-20 |
| Sprint 2 #5 | L1.5 隔离探针：本地预实证 A/B/C 三组全绿（P1a 静默证据 → D1/D2 的存在理由） | 已完成 2026-09-20 |
| Sprint 2 #8 | L1.6 多语言探针：三语言 × 三通路结论矩阵（部分支持，§4-E）+ 客户端通路交叉复现一致 | 已完成 2026-09-21 |
| 档位核对（原计划项，已提前完成） | TC-TIER：**双探针** `memory_capabilities` + `tools/list` 计数（core=8 / graph=20 / admin=22 / power=57 / full=101） | 已完成 2026-09-21（定档 + 模板四处已写 `--profile`；各档计数实测 7 档全绿，证据见 §4-C） |
| Sprint 3 #2–#3「D2 + 隔离本地负向回归」 | TC-ISO：移除共享 DB fallback 后重跑 V1，断言 fail-loud、目标非共享主库且主库不变 | 已完成本地验收 2026-09-21（`iso-probe.sh` 退出码 0；生产复验待 Sprint 5） |
| Sprint 3 #4「上游 `[limits]` 配置与行为验证」 | TC-LIMIT：三类配额 `QUOTA_EXCEEDED` + `quota-status` 交叉核对 + 向量触顶拒绝 + HTTP 专属项对 stdio 无副作用 | 已完成本地验收 2026-09-21（`limits-probe.sh` 退出码 0；HTTP 面超限与生产通道复验待 Sprint 5） |
| Sprint 3 #5「每用户库维护行为定档」 | TC-GC：`gc` / TTL 驱逐（含读路径惰性清扫）/ WAL 回收 / `curator --once` 的覆盖面对账 + 维护脚本静态审计 | 已完成本地验收 2026-09-21（`gc-probe.sh` 退出码 0，7 项断言；生产定时器与告警待 Sprint 5） |
| 已取消（只影响已排除方案②） | TC-LEAK：去重/合成是否回显他人私有内容 | 已取消 2026-09-21 |
| Sprint 4 | 门户 / 公网入口若引入：先回到 §0 #5 增补远程接入用例（TC-HTTP） | 待做 |
| Sprint 5 | 服务器冒烟 L3（ssh 通道跑同构 jsonl）+ 生产 doctor 三静默失败点；备份（TC-BAK）/ 恢复（TC-REV）/ 吊销（TC-SSH-03） | 待做 |
| 回归触发 | 每次改动 config（含 `[limits]`）/ 镜像 tag / 档位 / forced command、**任一 attestation 模板**或**每库维护脚本**后重跑 L0 + L1 + L1.5（含 TC-ATT-01）+ L1.7（TC-LIMIT）+ L1.8（TC-GC），并跑静态 `make attestation-paths`（TC-ATT-02，已含第五条路径） | 持续 |

---

## §3 客户端接入配置（Cursor）

### 本地基线（容器常驻后）

`~/.cursor/mcp.json` 的 `mcpServers` 内追加（**放全局，不放项目级** `.cursor/mcp.json` —— 后者会入库）：

```json
"ai-memory-local": {
  "type": "stdio",
  "command": "docker",
  "args": ["exec", "-i", "ai-memory-mcp", "ai-memory", "mcp", "--tier", "smart", "--profile", "core"]
}
```

- `--profile core`（8 项）= **对外正式口径**（2026-09-21 定稿，与 SSH 用户行、门户模板一致；管理员入口为 `admin`，见 [`../deployment.md`](../deployment.md) §4.3 与 [`./mcp-design.md`](./mcp-design.md) §8.3）；写出来的理由是「不传时默认也是 core 且**不报错**」，显式声明可防静默漂移。

- **只加 `-i`，绝不加 `-t`**：pty 会破坏 stdio 帧（与生产 forced command `no-pty` 同因）。
- **无需 `env` 字段**：`docker exec` 继承容器环境，qwen key 不进 Cursor 配置、不进仓。
- 前置：`bash memory.agent-mate.ai/scripts/local-up.sh` 已常驻；容器重启后在 Cursor MCP 面板 reconnect。
- 生效核对：Settings → MCP 出现 `ai-memory-local` 且可见 8 个 `memory_*` 工具。
- **改档位**：在 `args` 里加 `--profile <family>`（如 `--profile core,graph`）；改完**必须重启该 MCP 条目 / reconnect**（harness 不支持延迟注册）。

### 生产（Sprint 5 上线后，与本地条目并存）

```json
"ai-memory": { "command": "ssh", "args": ["ai-memory"] }
```

`~/.ssh/config` 与 forced command 见 [`../deployment.md`](../deployment.md) §4.3 / §6.1；`agent_id` 无法在 `mcp.json` 配置（由服务端 forced command 钉死）。

---

## §4 测试用例

### A. 现役：协议冒烟 `mcp-smoke.sh`（L1，本地基线）

| ID | 用例 | 断言 | 退出码 |
|---|---|---|---|
| TC-ENV-01 | 前置：容器 `ai-memory-mcp` 常驻运行 | `docker ps` 可见 | 10 |
| TC-HS-01 | initialize 握手（protocolVersion 2024-11-05） | 回包 `serverInfo.name == "ai-memory"` | 20 |
| TC-HS-02 | tools/list 工具清单 | **恰 8 个**（core 7 + always-on `memory_capabilities`），含 store/search/recall/capabilities | 20 |
| TC-W-01 | `memory_store` 写入含唯一标记的自然语句 | 成功；CONFLICT 时改验既有标记可提取 | 30 |
| TC-R-01 | **新进程** `memory_recall`，查询词描述主题但**不含标记字面量** | 结果含生效标记 → 语义检索工作（embedder 未降级） | 40 |
| TC-R-02 | **新进程** `memory_search`，用标记字面量查询 | 命中 → 跨进程持久化 + 检索通路 | 40 |

> TC-W/R 分两个 `docker exec` 进程 = 同时证明「协议通路」与「卷持久化」。全通过退出码 0。

### B. 现役：doctor 三静默失败点（L0）

| ID | 用例 | 断言 |
|---|---|---|
| TC-DOC-01 | `ai-memory doctor` | LLM Reachability 200；Embeddings Reachability 200 且 dim=1024；tier=smart |
| TC-DOC-02 | `ai-memory curator --once --dry-run --json` | `tagged > 0` |

> 镜像内无 curl/wget → **不用**容器内 HTTP 探测；就绪判据用 serve 日志 `ai-memory listening on` + `doctor`（[`../deployment.md`](../deployment.md) §7.1）。

### B2. 现役：L2 客户端接入（Cursor `ai-memory-local`）

| ID | 用例 | 断言 |
|---|---|---|
| TC-L2-01 | Cursor MCP 面板加载 `ai-memory-local` | 8 个 `memory_*` 工具 + 2 prompts，无启动报错 |
| TC-L2-02 | agent 直调 `memory_store`，content 含唯一标记 `l2-client-<date>` | 返回 id；**负例**：非法枚举参数（如 `source`）被服务端拒绝并列出合法值，无静默吞错 |
| TC-L2-03 | `memory_recall`，查询词描述主题但**不含标记字面量** | 新记忆以最高分命中（语义通路，embedder 未降级） |
| TC-L2-04 | `memory_search`，用标记字面量查询 | 恰命中该 id（count=1） |

> 首次执行（2026-09-20）：全通过。标记 `l2-client-20260920` → id `55d04c8c-1910-4d04-a8b7-5c41dced492d`；recall `mode:hybrid` score 0.887 居首；search count=1；`source:"codebuddy"` 被拒后改 `user` 成功。
> 第二次执行（同日，**另一客户端交叉验证**）：另一 Cursor agent（`ai:cursor-vscode@974b303dab0e`，同一容器）向 `places-workspace` 写入 3 条 long-tier 记忆 —— 其中一条首轮因 `source:"conversation"` 被拒（TC-L2-02 负例**独立再现**），修正为 `user` 后 3/3 落库；随后由本客户端按语义召回交叉命中（score 0.899 / 0.781）。⇒ **跨客户端写入 + 跨客户端召回**可作为 L2 加强判据。注意：被拒与成功轮次并存时客户端叙述可能只报结果，核验一律以 `memory_list` / `memory_get` 为准。

### C. 隔离与档位（L1.5 / Sprint 3）

| ID | 用例 | 断言 | 阶段 |
|---|---|---|---|
| TC-ISO-01 | **负向**：会话不设 `AI_MEMORY_DB` | `doctor` 非零；同一次响应的 `source` 解析为绝对路径且不等于 `/data/ai-memory.db`；失败原因属于存储路径；共享主库记忆计数不变 | Sprint 3 #3「隔离本地负向回归」 |
| TC-ISO-02 | 正向：alice 会话 `doctor --json` | `source == /data/users/alice/ai-memory.db` | Sprint 3 #3「隔离本地负向回归」 |
| TC-ISO-03 | 交叉：alice 写入后 bob 检索 | 双向未命中；bob `memory_get <alice id>` → `memory not found` | Sprint 3 #3「隔离本地负向回归」 |
| TC-ISO-04 | 维护通路：各库 `--db stats` | 计数独立（alice / bob 非零，主库不变） | Sprint 3 #3「隔离本地负向回归」 |
| TC-GC-01 | **TTL 驱逐（显式 `gc` 路径）** | 独立一次性库播 1 条存活 + 1 条 `--ttl-secs 2`；过期后 `get` 仍返回 rc=0（`cmd_get` 不过滤 `expires_at` 也不触发清扫）；`gc --json` 的 `expired_deleted == 1`；gc 后该 id 取不到且 stderr 为 `not found`；存活行仍可读；`archive list` 含该 id 且 `archive_reason == ttl_expired`；二次 `gc` 报 0；`stats.total == 1` | **已完成本地验收 2026-09-21**（`gc-probe.sh` 退出码 0） |
| TC-GC-02 | **TTL 驱逐（读路径惰性清扫）** | 独立一次性库播 1 条存活 + 1 条过期；仅调用 `list --json` 后：`list.count == 1`（过滤过期）**且**过期行已在 `archived_memories`（`ttl_expired`），随后 `gc --json` 报 0；存活行仍可读 | **已完成本地验收 2026-09-21**。该行为来自 `db::gc_if_needed` 被 `store`/`list`/`recall`/`import` 与 MCP `memory_recall` fire-and-forget 调用 ⇒ **`gc` 计数不等于过期总量** |
| TC-GC-03 | **WAL 回收（`gc` 的 post-run checkpoint 覆盖面）** | 长活 MCP 会话写入 3 条后 `-wal` 增长（实测 1499712 字节）；**等其连续 5 次采样无变化**再对同库执行 `gc --json`；`-wal` 必须归零；会话退出后仍为 0 | **已完成本地验收 2026-09-21**。注意：**不等写入方静默会把断言打成竞态**（`memory_store` 之后 deferred-audit 仍在追加，实测曾残留 107152 字节）；依据是 `gc` 属 CLI 写命令 ⇒ 分发器 post-run `wal_checkpoint(TRUNCATE)` |
| TC-GC-04 | **`curator --once` + 失败语义 + 静态审计 + 多库独立性** | ① `curator --once --dry-run --json` 与 `curator --once --max-ops 1 --json` 均 rc=0，报告可解析、`memories_scanned >= 1`、`errors` 不含 LLM 静默失败；② 维护脚本对「1 个损坏库 + 1 个健康库」的根目录：**非零退出**但同轮健康库仍完成 gc + curator（不中断）；③ 静态断言每条 `ai-memory` 调用显式 `--db` 且带 attestation、`curator` 带 `--once/--max-ops`；④ 四个库各自维护后**计数不下降**、播种的存活行仍可按 id 读回、库 A 的记忆在库 B 中取不到；⑤ **共享主库计数不变**；⑥ 退出码契约：非法 `--max-ops` → rc=2 且说明可定位，空根目录 → rc=0 但**有显式说明**（不得静默成功）；容器未运行时以 rc=3 失败（设计约束，不静默成功） | **已完成本地验收 2026-09-21**。注：非干跑 `curator` 会写入**自报告记忆** ⇒ 断言用相对口径，不用绝对计数 |
| TC-LEAK-01 | 写路径泄露：方案②下 A 写入后检查是否回显 B 的私有内容 | **已取消**：仅影响已排除的单库方案②；方案③物理分离无跨库路径 | 已取消 2026-09-21 |
| TC-TIER-01 | `initialize` + `tools/list` 计核，逐档核对 | core=8 / graph=20 / admin=22 / power=57 / full=101 | **已完成 2026-09-21**（探针 [`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh)：7 档独立进程 + 默认档对照 + `core,lifecycle`=14，退出码 0；四处模板均已写 `--profile`，用户 `core` / 管理员 `admin`） |
| TC-TIER-02 | `memory_capabilities` 家族与装载状态 | 与 `tools/list` 一致（族计数口径差异已注明） | **已完成 2026-09-21**（同探针，软断言族装载状态；另以 verbose drilldown 取回 101 项完整 `docs`，作为 [`./mcp-capabilities.md`](./mcp-capabilities.md) 的撰写底稿） |
| TC-TIER-03 | 对外模板实际档位核对 | 门户 `launch.argv` = `core`；SSH 用户行 = `core`、主人行 = `admin` | **已完成 2026-09-21**（文档级：四处模板逐处核对；生产上线后用 `initialize` 回包复核一次） |
| TC-TIER-04 | **能力文档 ↔ 实测全集一致性**（[`./mcp-capabilities.md`](./mcp-capabilities.md)） | 6 张档位表登记的工具集合与探针 `full`（101 项）**完全相等**；编号 1–101 连续、每个编号唯一对应一个工具；每张表只列本档新增（与上一档无重复行） | **已完成 2026-09-21**（脚本化断言：从文档提取「编号 + 工具名」与 `tools/list` 实测全集做集合比对 —— 该断言拦住了手工补录引入的、上游**并不存在**的 `memory_gc_hard` / `memory_demote`） |

> 现役探针：[`../../scripts/iso-probe.sh`](../../scripts/iso-probe.sh)（退出码 0 全通过 / 10 前置 / 20 解析链 / 30 隔离 / 40 维护 / 50 方案②会话），组 A=P1a/P1b/P4，组 B=P2/P3/P5，组 C=P6。可重复性已验证：第二次起必然命中 near-duplicate 去重，探针**分会话**处理（写入会话先取「生效标记」再另开会话检索），故重复运行稳定。

### D. 生产通道与运维（Sprint 4–5 占位）

| ID | 用例 | 断言 | 阶段 |
|---|---|---|---|
| TC-SSH-01 | `ssh ai-memory` 跑 §4-A 同构 jsonl 会话 | 与 L1 结果一致（握手 + 8 工具 + 写入 + 跨进程召回） | Sprint 5 |
| TC-SSH-02 | `no-pty` / 误加 `-t` 负例 | 加 `-t` 时 stdio 帧损坏 → 客户端报错（证明 `no-pty` 必要） | Sprint 5 |
| TC-SSH-03 | 吊销：删除该用户 `authorized_keys` 行 | 该密钥 SSH **立即失败** | Sprint 5 #5 |
| TC-BAK-01 | 备份脚本遍历全部库产出快照 + manifest | `sha256sum` 与 manifest 一致；外迁后回读比对通过 | Sprint 5 #3/#7 |
| TC-REV-01 | 恢复演练（在**临时库**上） | 恢复后原库被 rename 为 `pre-restore-*`（in-place 行为，契约面 I5） | Sprint 5 |
| TC-LIMIT-01 | **`[limits]` 三类配额行为**（本地基线，Sprint 3 #4） | 探针 [`../../scripts/limits-probe.sh`](../../scripts/limits-probe.sh) 在**独立一次性库 + 每轮全新身份**上只经 env 注入小阈值（模板零污染）：① `AI_MEMORY_MAX_MEMORIES_PER_DAY=1` → 第 2 次 `memory_store` 返回 `QUOTA_EXCEEDED`；② `AI_MEMORY_MAX_STORAGE_BYTES=1` → 首次写入即 `QUOTA_EXCEEDED`；③ `AI_MEMORY_MAX_LINKS_PER_DAY=1`（会话内 `--profile graph`）→ 第 1 条 `memory_link` 成功、第 2 条被拒；④ 三类均以 `ai-memory quota-status --namespace global --json`（**刻意去掉注入 env**，namespace 与 `memory_store` 默认值一致）交叉核对配额行**仍等于注入值** —— 证明配额行在首次写入时已被盖章，而非重读 env；若查错 namespace，会读到现场新建行的默认值而误报「注入没生效」 | **已完成本地验收 2026-09-21**（退出码 0；`--self-test` 负向自测通过）。生产 SSH 通道复核留 Sprint 5 |
| TC-LIMIT-02 | **向量索引容量 + HTTP 专属项对 stdio 的非生效对照** | ① `AI_MEMORY_VECTOR_INDEX_CAPACITY=1` + `AI_MEMORY_VECTOR_INDEX_HARD_FAIL=true`：跨进程预热 ≥1 条后，插入被上游拒绝（stderr 出现 `hnsw.eviction` 的 `vector index at capacity: rejecting insert (hard-fail-at-cap mode)` ERROR），且记忆行仍落库（上游 `insert` 返回 `void`，不回滚写入）。**注意**：该 target 不在默认 `ai_memory=info` 过滤器内，探针须显式放宽 `RUST_LOG` 才能观测，且须先断言阻塞预热已落地；② `AI_MEMORY_MAX_PAGE_SIZE=1` / `AI_MEMORY_MAX_INFLIGHT_REQUESTS=1` 下 stdio 会话的 `memory_store` 与 `memory_list` **均正常** | **已完成本地验收 2026-09-21**；HTTP 面超限行为本地**无法触发**（容器不发布端口、镜像无 curl/wget）→ 留 Sprint 5 |
| TC-I18N-01 | 多语言检索（占位 → 已由 §4-E 六用例扩展替代） | 见 §4-E（TC-I18N-01..06，2026-09-21 全通过） | 已完成 2026-09-21 |
| TC-ATT-01 | `AI_MEMORY_REQUIRE_AGENT_ATTESTATION` 开关生效（**正负对照**，不断言字段） | `=0`：`memory_store` 成功（无 `isError`，行落库）；`=1`：同一写入被拒（`isError=true` + `agent attestation failed: … this write is unsigned`）。**`attest_level=claimed` 不可直接断言**：v0.10.0 的 MCP 响应 / `memory_get` / `export` / `memories` 表都不暴露该值 —— 它是上游**文档与启动告警的措辞**（仅在 daemon 绑非回环且宽松时打印） | **已完成 2026-09-21**（本地基线，探针 [`../../scripts/mcp-smoke.sh`](../../scripts/mcp-smoke.sh) 会话 C；生产 SSH 通道复核留 Sprint 5） |
| TC-ATT-02 | **attestation 四路径口径静态一致**（无 Docker、无网络） | compose `ai-memory` / `curator` 各一处 `"0"`（恰好 2）；`deployment.md` 用户行与 `mcp-design.md` §5.2 模板的 `-e` 子句**逐字一致**且含该 env；门户 `web-design.md` §3.3 launch 模板含该 env；现行文档无已证伪口径回流 —— **禁用字面模式清单见脚本内 `STALE_PATTERNS`**，本表不复述，以免扫描器扫中自身 | **已完成 2026-09-21**（探针 [`../../scripts/attestation-paths-check.sh`](../../scripts/attestation-paths-check.sh)，`make attestation-paths`；退出码 0/10/20，五类负向注入自测通过） |
| TC-HTTP-01 | （仅当开放 HTTP 入口）url + api_key 接入；未带 key → 401；`X-API-Key` 头生效 | §0 #5 前置配置已落地 | Sprint 4 或 §0 #5 落地时 |

### E. 多语言（L1.6 / Sprint 2 #8，2026-09-21 实测全通过）

现役探针：[`../../scripts/i18n-probe.sh`](../../scripts/i18n-probe.sh)（无参数；隔离库 `/data/users/i18n-probe/`，不碰主库与 iso 库；`I18N_PROBE_STRICT=1` 把语言边界按本表登记值断言，防上游行为漂移；退出码 0/10/20/30/40/50）。源码依据与契约面：[`./mcp-design.md`](./mcp-design.md) §2「记忆内容多语言」/ §9 J4。

| ID | 用例 | 期望 | 实测（2026-09-21） |
|---|---|---|---|
| TC-I18N-01 | 英文关键词命中 | ASCII 标记与英文**单词**（如 boundary）`memory_search` 命中；词元内子串（bound 查 boundary）**不命中** | 通过（标记与单词命中；子串 count=0） |
| TC-I18N-02 | 简中关键词边界 | **标点/空白界定的整段**连续中文命中；词元内**子串**不命中 | 通过（整段命中；子串 count=0） |
| TC-I18N-03 | 繁中关键词边界 + 简繁交叉 | 繁中整段命中；**简→繁 / 繁→简交叉一律不命中**（`unicode61` 不做简繁归一） | 通过（繁中整段命中；交叉双向 count=0） |
| TC-I18N-04 | 简中语义召回 | 查询词不含标记字面量，`memory_recall` 命中且 `mode=hybrid` | 通过（score 约 0.83 居首） |
| TC-I18N-05 | 繁中 / 英文语义召回 | 同上，三语言语义通路一律可用 | 通过（繁中 / 英文均 `mode=hybrid` 命中） |
| TC-I18N-06 | 按标识直取 | `memory_get` 按 id 取回，与语言无关 | 通过（三语言 id 全命中） |

> 首跑证据（标记前缀 `1789958920-48352`）：三语言写入 rc=0；关键词 12 组对照中硬断言 6 组全部一致，语言边界 6 组与登记值一致；结论矩阵 = 存储**支持**（三语言）/ 关键词**部分支持**（仅完整词元；词元内子串与简繁交叉**不支持**）/ 语义召回**支持** / 按 id 直取**支持**。默认复跑（`1789959024-49737`）与 STRICT 复跑（`1789959038-49972`）全绿（CONFLICT 幂等分支验证）。
> 客户端通路交叉复现（排除 `docker exec` 假象）：Cursor `ai-memory-local` 直调，简中关键词 count=0 + 简中语义召回命中（主库标记 `i18n-cross-20260921`，id `de386c65-eb9d-4af2-8fef-6001b7115680`）—— 与探针通路结论**一致**。

---

## §5 版本记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | 初版：定位声明；传输形态核实（stdio-over-SSH，源码级证据）；固化 mcp-smoke.sh 6 用例与 doctor 2 用例；登记本地/生产 Cursor 接入配置 |
| 2026-09-20 | 增补 §4-B2 L2 客户端用例（TC-L2-01..04），首次执行全通过；§2 登记 L2 |
| 2026-09-20 | 增补 §1 原则两条（capabilities 计数口径；档位只能启动时定）与 §3 改档说明；§2 Sprint 3 #2 改双探针；§4-B2 记录第二客户端交叉验证 |
| 2026-09-20 | **specs 整合**：迁入 `specs/mcp/`（原 `specs/mcp-test.md`）；新增 **L1.5 隔离探针层**与 §4-C（TC-ISO / TC-GC / TC-LEAK / TC-TIER）、§4-D（TC-SSH / TC-BAK / TC-REV / TC-LIMIT / TC-I18N / TC-ATT / TC-HTTP）用例位；L0 补「镜像无 curl，改用 serve 日志 + doctor」 |
| 2026-09-21 | **新增 L1.6 多语言探针层与 §4-E 用例（TC-I18N-01..06，Sprint 2 #8）**：三语言 × 三通路结论矩阵实测全通过（存储 / 语义召回 / 按 id 直取支持；关键词仅完整词元、词元内子串与简繁交叉不命中）；§1「检索工具分工」原则升级为精确边界；§2 登记 Sprint 2 #8 完成；§4-D TC-I18N-01 占位归并至 §4-E。探针 [`../../scripts/i18n-probe.sh`](../../scripts/i18n-probe.sh)，结论回写 [`../product-backlog.md`](../product-backlog.md) #10 |
| 2026-09-21 | **档位定档 + 模板落盘（Sprint 2 #9 收尾）**：§2 Sprint 3 #2 提前完成；§3 本地基线 `args` 显式 `--profile core`（生产条不写 —— 由服务端 forced command 决定），并注明「不传时默认也是 core 且**不报错**」；§4-C TC-TIER-01/02 标为已完成（探针 [`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh)：7 档独立进程 + 默认档对照 + `core,lifecycle`=14，退出码 0），新增 TC-TIER-03（对外模板档位核对：门户 `core` / SSH 用户行 `core` / 主人行 `admin`）；新增面向最终用户的能力文档 [`./mcp-capabilities.md`](./mcp-capabilities.md)（工具功能说明的底稿取自 `memory_capabilities` verbose drilldown） |
| 2026-09-21 | **能力文档体例定稿 + 与实测逐项对齐（Sprint 2 #11）**：`./mcp-capabilities.md` 体例定为「**6 张档位表 + 每张只列本档新增 + 编号全档连续 1–101 + 示例列**」；新增 **§4-C TC-TIER-04**（能力文档 ↔ 实测 `full` 101 项集合相等 + 编号连续唯一），该断言拦住了手工补录写入的不存在工具（`memory_gc_hard` / `memory_demote`）。同步：`../change-log.md`「Sprint 2 #11 收口」小节 · [`../web-portal/web-stories.md`](../web-portal/web-stories.md) AC6.4 · [`./mcp-design.md`](./mcp-design.md) §8 顶部引文 |
| 2026-09-21 | **新增 TC-ATT-02 静态护栏（Sprint 3 #1 完成质量修复）**：新增探针 [`../../scripts/attestation-paths-check.sh`](../../scripts/attestation-paths-check.sh)（`make attestation-paths`，只读 / 无 Docker / 无网络，退出码 0/10/20）—— 断言四路径模板 attestation 口径一致（compose ×2 恰好两处、`deployment.md` 用户行与 `mcp-design.md` §5.2 的 `-e` 子句逐字一致、门户 launch 模板含该 env）并阻断已证伪口径回流；§2 回归触发条件纳入该静态门禁；§4-C TC-ISO-01 与 §4-D TC-ATT-01 的判据同步为探针实际断言 |
| 2026-09-21 | **Sprint 3 #4：`[limits]` 容量与配额落盘 + 行为探针**：`../deploy/config.toml.tmpl` 补 `[limits]` 七键（**显式等于 v0.10.0 编译默认**，防升级静默漂移）；新增探针 [`../../scripts/limits-probe.sh`](../../scripts/limits-probe.sh)（**独立一次性库 + 每轮全新身份 + 仅 env 注入**小阈值，退出码 0）实测 ① 写入量 / 存储字节 / 链接三类返回 `QUOTA_EXCEEDED` 且 `quota-status` 配额行等于注入值；② 向量 `capacity=1` + `hard_fail=true` 触发上游 `hnsw.eviction` 拒绝日志而**记忆行仍落库**；③ `max_page_size` / `max_inflight_requests` 对 stdio **无副作用**（HTTP 面专属）。§4-D `TC-LIMIT-01` 具体化 + 新增 `TC-LIMIT-02`。同步：`./mcp-design.md` §5.4 / §9 L · `../deployment.md` §5.3 · `../product-backlog.md` #17 · [`../knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](../knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 实测表 + 教训 20 |
| 2026-09-21 | **Sprint 3 #5：每用户库维护行为定档（新增 L1.8 + TC-GC-01..04）**：① 新增探针 [`../../scripts/gc-probe.sh`](../../scripts/gc-probe.sh)（独立一次性库 + 静态审计 + `--self-test`，退出码 0/10/20/30/40/50/60/70，实跑退出码 0、7 项断言）② 新增维护入口 [`../../scripts/maintain-user-dbs.sh`](../../scripts/maintain-user-dbs.sh)（宿主机 cron 入口；逐库显式 `--db` + `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`；单库失败不中断但非零退出）+ `make maintain-user-dbs` 目标 ③ **实测覆盖面三项结论** —— TTL 驱逐由 `gc` 负责但**读/写路径也会惰性清扫**（`db::gc_if_needed` 被 `store`/`list`/`recall`/`import` 与 MCP `memory_recall` 调用 ⇒ `gc` 计数 ≠ 过期总量）；WAL 回收**已被 `gc` 覆盖**（写命令 post-run `wal_checkpoint(TRUNCATE)`，实测 1499712 → 0 字节）；`curator --once` rc=0 且确实读到目标库 ④ §1 新增 **L1.8 每库维护探针层**；§2 登记完成态并把 L1.8 纳入回归触发 ⑤ `make attestation-paths` 扩到**五路径**（新增每库维护命令断言 + 负向自测）⑥ 同步 `./mcp-design.md` §5.3 · `../deployment.md` §5.3 · `../product-backlog.md` #13 · `../sprint-plan.md` #5 · [`../knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](../knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 实测表 + 教训 21 |
