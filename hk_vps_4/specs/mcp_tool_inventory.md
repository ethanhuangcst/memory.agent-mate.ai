# mcp_tool_inventory — 上游 ai-memory-mcp MCP 工具清单

> **用途**：列出上游产品**当前实际提供**的 MCP 工具全集，以及每项在哪个 `--profile` 档位下可见 —— 供「对外提供的能力」选档与对外公布。
> **状态**：v1.0 · as_of 2026-09-20
> **上游基准**：`v0.10.0`（版本坐标唯一真相源 [`../upstream.lock`](../upstream.lock)）
> **关联**：[`product-backlog.md`](./product-backlog.md)（需求与 Backlog）· [`upstream_coupling_surface.md`](./upstream_coupling_surface.md)（契约面）· [`admin_portal_design.md`](./admin_portal_design.md)（会话模板）

---

## 1. 取数与复核方法

本清单的数字与名称**不是抄文档**，而是从源码派生（上游文档在该处存在滞后）：

| 项 | 来源 |
| --- | --- |
| 工具名的**拼写** | `src/mcp/registry.rs` 的 `tool_names::MEMORY_*` 常量（单一真相源，全仓不可漂移） |
| 工具名的**全集** | 同上文件的 `tool_names::ALL`（`src/mcp/registry.rs:177` 起） |
| **族（family）归属** | `src/profile.rs` 的 `Family::tool_names()`（`src/profile.rs:391` 起） |
| **档位（profile）** | `src/profile.rs` 的 `Profile::{core,graph,admin,power,full}()`（`:647`–`:697`）—— 档位 = 族的并集 |
| **各档工具数** | `Profile::expected_tool_count()` = 所含族的工具数之和（`src/profile.rs:714`） |

**复核日期**：2026-09-20 · **依据 ref**：本地 clone `main` @ `96b8c694`
**上游发新版后必须复核**：族与档位会随版本变化（该文件是快照，不是真相源）。

---

## 2. 档位（profile）与工具数

| 档位 | 组成 | 工具数 | 说明 |
| --- | --- | --- | --- |
| `core` | `Core` | **7** | 上游 `mcp --profile` 的**默认值** —— 不写 `--profile` 就只有这一档 |
| `graph` | `Core` + `Graph` | **19** | |
| `admin` | `Core` + `Lifecycle` + `Governance` | **21** | |
| `power` | `Core` + `Power` | **56** | |
| `full` | 全部族 | **101** | |

> 上游另支持**自定义档位**：`--profile` 接受逗号分隔的族列表（如 `core,graph,archive`）。
> 解析优先级：`--profile` 参数 > `AI_MEMORY_PROFILE` 环境变量 > `config.toml` 的 `[mcp].profile` > `core`（`src/daemon_runtime.rs:179-183`）。

### ⚠️ 两个容易算错的点

| # | 事实 | 后果 |
| --- | --- | --- |
| 1 | `memory_capabilities` 属 `Meta` 族，但被列为 **`ALWAYS_ON_TOOLS`**（`src/profile.rs:130`），在**所有档位**下都会加载 | 上表的「工具数」= 族的工具数之和；**实际注册数**在 `core`/`graph`/`admin`/`power` 上要 **+1** = 8 / 20 / 22 / 57。`full` 已把 `Meta` 计入 101，**不额外 +1** |
| 2 | 默认档位是 `core`，**不是** `full` | 若部署模板不显式写 `--profile full`，对外只会暴露 `core` 档 + `memory_capabilities` —— 表现为「上游明明有 101 项，用户只看到 8 项」，且**不报错** |

---

## 3. 工具清单（按族）

> 每族标注其**可见档位**。族名即 `--profile` 自定义列表里可用的标识符。
> 本清单只给**名称**（权威）；每项的功能描述以运行时 `memory_capabilities` 的自述为准，不在此处转述（避免与上游漂移）。

### Core（7 项 · **所有档位**可见）

`memory_store` · `memory_recall` · `memory_list` · `memory_get` · `memory_search` · `memory_load_family` · `memory_smart_load`

### Lifecycle（6 项 · `admin` / `full` 可见）

`memory_update` · `memory_delete` · `memory_forget` · `memory_gc` · `memory_promote` · `memory_capture_turn`

### Graph（12 项 · `graph` / `full` 可见）

`memory_kg_query` · `memory_kg_timeline` · `memory_kg_invalidate` · `memory_link` · `memory_get_links` · `memory_entity_register` · `memory_entity_get_by_alias` · `memory_get_taxonomy` · `memory_replay` · `memory_verify` · `memory_find_paths` · `memory_lineage`

### Governance（8 项 · `admin` / `full` 可见）

`memory_pending_list` · `memory_pending_approve` · `memory_pending_reject` · `memory_namespace_set_standard` · `memory_namespace_get_standard` · `memory_namespace_clear_standard` · `memory_subscribe` · `memory_unsubscribe`

### Power（49 项 · `power` / `full` 可见）

`memory_consolidate` · `memory_detect_contradiction` · `memory_check_duplicate` · `memory_auto_tag` · `memory_expand_query` · `memory_inbox` · `memory_subscription_replay` · `memory_subscription_dlq_list` · `memory_quota_status` · `memory_reflect` · `memory_reflection_origin` · `memory_dependents_of_invalidated` · `memory_check_agent_action` · `memory_rule_list` · `memory_export_reflection` · `memory_offload` · `memory_deref` · `memory_atomise` · `memory_persona` · `memory_persona_generate` · `memory_ingest_multistep` · `memory_calibrate_confidence` · `memory_share` · `memory_action_create` · `memory_action_get` · `memory_action_transition` · `memory_action_list` · `memory_action_add_edge` · `memory_action_edges` · `memory_action_frontier` · `memory_action_next` · `memory_lease_acquire` · `memory_lease_renew` · `memory_lease_release` · `memory_lease_get` · `memory_signal_send` · `memory_signal_read` · `memory_signal_inbox` · `memory_signal_thread` · `memory_signal_ack` · `memory_checkpoint_create` · `memory_checkpoint_resolve` · `memory_checkpoint_query` · `memory_checkpoint_verify` · `memory_routine_create` · `memory_routine_freeze` · `memory_routine_run` · `memory_routine_status` · `memory_routine_list`

### Meta（6 项 · 仅 `full` 可见；其中 1 项全档位 always-on）

`memory_capabilities`（**例外：所有档位 always-on**） · `memory_agent_register` · `memory_agent_list` · `memory_session_start` · `memory_stats` · `memory_recall_observations`

### Archive（4 项 · 仅 `full` 可见）

`memory_archive_list` · `memory_archive_purge` · `memory_archive_restore` · `memory_archive_stats`

### Other（9 项 · 仅 `full` 可见）

`memory_list_subscriptions` · `memory_notify` · `memory_skill_register` · `memory_skill_list` · `memory_skill_get` · `memory_skill_resource` · `memory_skill_export` · `memory_skill_promote_from_reflection` · `memory_skill_compositional_context`

---

## 4. 计数核对表

| 族 | 工具数 | 属 `core`? | 属 `graph`? | 属 `admin`? | 属 `power`? | 属 `full`? |
| --- | --- | --- | --- | --- | --- | --- |
| Core | 7 | ✅ | ✅ | ✅ | ✅ | ✅ |
| Lifecycle | 6 | — | — | ✅ | — | ✅ |
| Graph | 12 | — | ✅ | — | — | ✅ |
| Governance | 8 | — | — | ✅ | — | ✅ |
| Power | 49 | — | — | — | ✅ | ✅ |
| Meta | 6 | — | — | — | — | ✅ |
| Archive | 4 | — | — | — | — | ✅ |
| Other | 9 | — | — | — | — | ✅ |
| **合计（=`full`）** | **101** | **7** | **19** | **21** | **56** | **101** |

> `ALWAYS_ON_TOOLS`（`memory_capabilities`）另计 +1：`core`=8、`graph`=20、`admin`=22、`power`=57（`full`=101 不变）。

---

## 5. 待决策（与 [`product-backlog.md`](./product-backlog.md) 同步）

| # | 决策 | 现状 | 影响 |
| --- | --- | --- | --- |
| 1 | 对 memory.agent-mate.ai 用户**暴露哪一档** | **未定**。现有 SSH 模板写的是 `ai-memory mcp --tier smart`，**没有 `--profile`** ⇒ 实际只暴露 `core` 档（+ `memory_capabilities`） | 决定用户实际能用到多少能力；若选 `full` 需同时评估工具面变大后的提示词开销与误用面 |
| 2 | 门户模板与 SSH 模板是否**统一档位** | 两条接入路径会给到同一用户，应一致 | 否则「用 SSH 能看到、用门户看不到」类困惑 |
| 3 | 选档后如何**验收** | 未定 | 用 MCP `initialize` 回包的工具数核对（见 Backlog「对外提供的能力」行的验收条件） |

---

## 6. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-20 | 初版：按族列出 101 项工具的完整清单与档位可见性；补两个易算错点（`memory_capabilities` always-on、默认档位为 `core`）；补取数与复核方法 |
| 2026-09-20 | 本次复核（`sprint_plan.md` 重排为 6 个 Sprint）：§5「待决策」三项与 Sprint 2 的「`--profile` 定档」「MCP 对外能力清单定稿」、Sprint 3 的「工具档位落地」一致，**无编号失配、无需改动** |
