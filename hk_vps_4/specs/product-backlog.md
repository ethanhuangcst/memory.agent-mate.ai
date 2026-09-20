# 产品概述

> **用途**：记录 memory.agent-mate.ai（上游 ai-memory-mcp 的下游私有化部署）的**产品需求** —— 要什么、边界在哪、验收是什么。
> **状态**：v1.0 · as_of 2026-09-20
> **上游基准**：`v0.10.0`（版本坐标唯一真相源 [`../upstream.lock`](../upstream.lock)）
> **关联**：[`deployment_strategy.md`](./deployment_strategy.md)（决议）· [`admin_portal_design.md`](./admin_portal_design.md)（门户设计）· [`multiuser_isolation.md`](./multiuser_isolation.md)（多用户隔离）· [`mcp_tool_inventory.md`](./mcp_tool_inventory.md)（工具清单）· [`sprint_plan.md`](./sprint_plan.md)（排期与状态）
> **排期**：文末 Backlog 表的 `Sprint` 列是 [`sprint_plan.md`](./sprint_plan.md) 排期的**投影** —— 排期变更以该文件为准；本表只登记 `Sprint` 编号，`描述` / `验收条件` / `状态` 由本表自主维护。
> **实测数据的取法**：本文档中的上游能力数字取自本地 clone（`main` @ `96b8c694`，2026-09-20 实测）—— 工具族与档位来自 `src/profile.rs` 的 `Family::tool_names()` 与 `Family::expected_tool_count()`；`[limits]` 相关来自 `src/config.rs:3703-3760`。上游发新版后需复核。

- ai-memory-mcp (https://github.com/alphaonedev/ai-memory-mcp.git) 是上游开源产品
- **上游基准版本**：`v0.10.0` —— 版本坐标唯一真相源 [`../upstream.lock`](../upstream.lock)；镜像 `ghcr.io/alphaonedev/ai-memory:0.10.0`
- memory.agent-mate.ai 是将上游产品 ai-memory-mcp 私有化部署后的定制 mcp 服务
- hk_vps_4 是部署 memory.agent-mate.ai MCP 的服务器
- memory.agent-mate.ai MCP 部署不是简单的一件镜像部署，需要根据 hk_vps_4 和 memory.agent-mate.ai 的需求做部署定制
- 原则是尽可能少二次开发、少耦合、升级部署方便

---------
## 需求边界

### 「定制」的口径
- **定制 = 配置 + 外围组件**（门户 / 反向代理 / 备份脚本），**不改上游源码** —— 与开篇原则「尽可能少二次开发」一致
- 若确需改上游源码：须**先专门决议**并在此登记为例外，否则不得开工
- 验收条件：部署制品中不含对上游源码的补丁；上游升级无需 rebase 任何自有补丁

### 明确不做（out of scope）
- ❌ **自助注册** —— 用户由管理员邀请制创建（见「用户模型」）
- ❌ **对外收费 / 计费** —— 无支付、无套餐、无账单
- ❌ **非 MCP 客户端接入** —— 不提供 REST / Web SDK / OpenAI 兼容等其它接入面
- ❌ **多租户 SaaS 形态** —— 不自建对外运营的账号体系
- ❌ **上游能力之外的二次开发** —— 门户是唯一自有产品面
- 验收条件：上述条目在后续评审中保持不变；任何突破须在本节登记为「例外 + 决议 + 日期」

---------
## 用户模型（邀请制）和鉴权
### 用户模型
- 用户来源：**管理员在门户建用户**（邀请制），不开放自助注册
- 用户与设备：同一用户可持**多把 key**（多设备 / 多工具），共享**同一份记忆**（同一库）
- 审批：无审批流（邀请即生效）
- 规模：用户数上限待定（受「容量与配额」约束，见 admin portal 一节）
- 验收条件：管理员可建用户并签发 key；非管理员无法创建任何用户或 key；同一用户的两把 key 读到同一份记忆
### 鉴权
按「面」划分 —— 每一面的主体、凭据与边界都不同：

| 面 | 访问主体 | 凭据 | 边界 |
| --- | --- | --- | --- |
| **管理面**（门户 UI / API） | 管理员 | **Cloudflare Access**（浏览器 SSO）+ 门户会话 | 仅管理域名；在 MCP 域名上请求管理 API 一律**拒绝** |
| **MCP 面**（`<MCP_HOST>/mcp`） | 用户及其客户端 | **`memo_` 令牌**（`Authorization: Bearer`） | 库内只存 `sha256(token)`；可吊销、可轮换；明文仅签发时显示一次 |
| **SSH 面**（保底路径） | 主人 / 运维 | **SSH 密钥 + forced command** | 单 OS 账号 `aimem-ssh` + N 把密钥 + N 条记录；身份与库路径由**服务端钉死** |
| **上游 HTTP 面**（`serve` 的 9077） | **不对外开放** | — | 绑 `127.0.0.1`、**不映射主机端口**；不启用顶层 `api_key` / `AI_MEMORY_REQUIRE_API_KEY` |

身份与被授权对象的关系：

- 门户用户 = 一个 `handle`；其**记忆身份** = `AI_MEMORY_AGENT_ID=human:<handle>`；其**数据边界** = 独立库 `/data/users/<handle>/ai-memory.db`
- 同一用户的多把 key 都解析到**同一个 `handle`**（多设备共享同一份记忆）
- **不做**：服务器 OS 账号同步；上游多租户机制（上游不存在）；用能力令牌做隔离（macaroon 是 **additive-only**，只放宽不收紧）

验收条件：

- 未经 Cloudflare Access 认证无法访问管理域名；在 MCP 域名上访问管理 API 被拒绝
- 无 `memo_` 令牌、或令牌已吊销，均无法建立 MCP 会话
- 上游 9077 端口对外**不可达**；不启用 `AI_MEMORY_REQUIRE_API_KEY` 的硬性要求（因无公网 HTTP 面）
- 令牌明文不落库、不进日志

---------
# 需求

> **分层规则**：本节保留「要什么」（需求陈述）；**可执行细节、验收条件、关联文档与状态**见文末「Product Backlog」。
> 每项前的 `[类型]` 即 Backlog 表中的「分类」。

---------
## [本地启动] 本地启动产品
- 在本机以**默认配置**启动 ai-memory-mcp，作为后续方案验证的对照基线。

---------
## [产品化-web] web portal
### admin portal
- **登录与访问控制**：Cloudflare Access 仅保护管理域名；MCP 域名须显式绕过。
- **key 生命周期**：签发 / 列出元信息 / 修改 / 轮换 / 删除。
- **记忆身份与数据隔离**：每用户独立身份与独立库，建用户即就绪。
- **审计视图**：覆盖 建用户 / 签发 / 轮换 / 吊销 / 每次会话开始。
- **容量、配额与限流**：**先复用上游能力**（配额与页大小上限走上游 `[limits]`，门户只做纳管与展示）；**仅门户自建**会话级并发、空闲超时与单会话时长。
### Integration Instructions 页面
- **接入说明页**：Home（接入步骤）+ Admin 入口。
- **i18n**：范围限定为门户 UI 与接入说明页。

---------
## [产品化-MCP] mcp
### 根据 memory.agent-mate.ai 的需求，对上游产品能力进行定制
> 「定制」的口径见「需求边界」—— **配置 + 外围组件，不改上游源码**。
- **LLM 选择**：`smart` 档，qwen 系列。
- **备份与恢复**：OSS 私有桶外迁 + 量化指标 + 门户自身库纳入。
- **记忆内容的多语言支持**：待探针确认。
- **多用户数据隔离**：一用户一库 + 每用户身份。
- **工具档位**：对外暴露上游 MCP 工具档位之一（档位待决策）。
- **每用户库的后台维护**：TTL 遗忘 / GC / curator 的归属（常驻 curator 只服务默认库）。
- **接入面**：HTTP MCP（门户）+ SSH stdio（保底）。
- **可用性前提**：`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`（否则无签名写入 403）。
- **公网入口与认证边界**：管理面 CF Access / MCP 面 `memo_` 令牌。
- **审计与限流**：平台侧配额与准入控制走上游 `[limits]`；会话级限流见门户侧。
- **升级治理**：版本契约 + 准入判据 + 门户镜像随上游重建。
### 对外提供的能力
- 对外提供上游 MCP 工具清单中的选定档位。**清单见** [`mcp_tool_inventory.md`](./mcp_tool_inventory.md)（101 项 / 8 族 / 5 档）；具体档位待决策。

---------
## [升级] 上游更新与升级
### 明确资产隔离策略
- 上游代码获取 + 下游最小耦合选版部署 + 工作目录与远端仓库关联。
### 上游产品资产更新
- 升级准入判据 + 自动化提醒（邮件）。
- 历次版本升级跟踪与过程资产。
- 最低耦合、尽量自动化的升级方案。
### 制定部署/升级方案
- 制定升级方案及相关脚本。
- 验证并文档化升级方案。

---------
## [上线] 上线生产环境
- 覆盖 ai-memory 与 web portal 的**部署 / 验证 / 文档化**三件事。

---------

# Product Backlog

| # | 分类 | 父项 | 标题 | 描述 | 验收条件 | 关联 | Sprint | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [本地启动] | 本地启动产品 | 开发环境默认启动 | 按默认配置在本机启动 ai-memory-mcp，作为后续方案验证的对照基线。 | 本机启动成功，并通过 MCP 完成一次写入 + 召回。 | `dev-plan.md` §3 · `deploy/README.md` | Sprint 2 | ToDo |
| 2 | [产品化-web] | web portal | admin portal — 登录与访问控制 | 管理面走 **Cloudflare Access**（浏览器 SSO）；**仅管理域名**受保护，MCP 域名须**显式绕过**（命令行客户端无法完成 SSO 重定向，否则表现为「连不上」）。 | 仅持有效 CF Access 身份者可访问管理域名；在 MCP 域名上请求管理 API 被**拒绝**。 | [`admin_portal_design.md`](./admin_portal_design.md) §7 | Sprint 4 | ToDo |
| 3 | [产品化-web] | web portal | admin portal — key 生命周期 | 操作 = 签发 / 列出元信息 / 修改 / 轮换 / 删除。「列出元信息」= 前缀 + 标签 + 创建时间 + 最后使用时间（**明文不可取回**，库内只存 `sha256(token)`）；「轮换」= **吊销旧 + 签发新**（旧 key 不可复活）；「删除」= **软吊销**（置 `revoked_at`，立即失效但保留审计链条，**不做**物理删除）。格式 = `memo_` + 32 字节 CSPRNG（base64url 无填充）；请求头 `Authorization: Bearer memo_…`；明文**仅创建时显示一次**。 | 5 个操作均可用；明文仅在创建响应中出现一次；吊销后新建会话被拒、既有会话被终止。 | [`admin_portal_design.md`](./admin_portal_design.md) §5.1 | Sprint 4 | ToDo |
| 4 | [产品化-web] | web portal | admin portal — 记忆身份与数据隔离 | 每用户 `AI_MEMORY_AGENT_ID=human:<handle>` + 独立库 `/data/users/<handle>/ai-memory.db`（**一用户一库**，读写双向物理隔离）。**不做**服务器 OS 账号同步（单账号 `aimem-ssh` + N 把密钥 + N 条 forced command）。建用户时创建其库目录（属主对齐容器内 `aimem`）；签发 key 时**幂等确保**目录存在；**库文件由 ai-memory 首次使用时自动创建**。 | 跨用户检索**命中不到**；`memory_get` 他用户记忆返回不可见；每个库文件属主为 `aimem`。 | [`multiuser_isolation.md`](./multiuser_isolation.md) §5 · [`admin_portal_design.md`](./admin_portal_design.md) §5.2 | Sprint 4 | ToDo |
| 5 | [产品化-web] | web portal | admin portal — 审计视图 | 覆盖事件：建用户 / 签发 / 轮换 / 吊销 / 每次会话开始（**含解析出的库路径**，便于事后对账「这次会话落在哪个库」）。 | 上述事件均可查询；日志中**不出现**令牌明文。 | [`admin_portal_design.md`](./admin_portal_design.md) §6 | Sprint 4 | ToDo |
| 6 | [产品化-web] | web portal | admin portal — 容量、配额与限流 | **评估结论：大部分可由上游实现，门户不自建计数器。** ✅ **上游原生支持**：写入量配额 `[limits].max_memories_per_day`、存储上限 `max_storage_bytes`、链接配额 `max_links_per_day`（均 **per-(agent, namespace)**；我们「一用户一库 + 一 agent」⇒ 天然等价于 **per-用户配额**）、页大小上限 `max_page_size`（**每请求内存上限，不是限流**）；查询有 `memory_quota_status` 工具与 `ai-memory quota-status` CLI。⚠️ **仅 HTTP 面**：`[limits].max_inflight_requests` 是「全局 **HTTP** 准入控制并发上限」，超出返 **503**（`src/config.rs:3745-3749`）—— 多用户走 **stdio MCP**，该层**很可能不生效**，需实测。❌ **门户必须自建**：**会话级**并发上限（每 key / 全局）、空闲超时、单会话最长时长（上游没有「会话」概念，stdio 进程由 spawner 管）。❌ **另需方案**：文件系统级磁盘配额 —— `max_storage_bytes` 是**库内计数**，不覆盖 WAL 与临时文件。 | 上游已支持项**以配置实现并核验生效**（改 `[limits]` 后超限写入被拒）；`max_inflight_requests` 对 stdio 是否生效**已实测给出结论**；门户自建项在超限时**明确拒绝**（而非排队致死）；FS 级磁盘配额方案定稿。 | `src/config.rs:3703-3760` · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl)（**`[limits]` 段待补**） | Sprint 4 | ToDo |
| 7 | [产品化-web] | web portal | Integration Instructions 页面 | Home 页面（Instructions）：接入步骤 = 获取 key → 配置客户端 → 验证；含 Admin 入口。i18n **限定为门户 UI 与接入说明页**（MCP 服务本身不做 i18n）。 | 新用户按页面指引可在 ≤ 3 步内完成客户端接入并成功调用一次工具；至少支持中 / 英双语切换，新增语言不改动业务逻辑。 | [`admin_portal_design.md`](./admin_portal_design.md) §3.1 | Sprint 4 | ToDo |
| 8 | [产品化-MCP] | mcp | 定制 — LLM 选择 | `tier = "smart"`；`[llm]` = `qwen` / `qwen-plus`；`[llm.auto_tag]` **只写** `model = "qwen-turbo"`（省略 backend，逐字段继承 `[llm]`）；`[embeddings]` = `qwen` + **model 与 dim 待回填**（`dim = 0` 不可上线）。 | `ai-memory doctor` 通过；Embeddings Reachability 显示 `qwen:<model>` 且维度一致。 | [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) F1–F3 | Sprint 3 | WIP |
| 9 | [产品化-MCP] | mcp | 定制 — 备份与恢复 | OSS 私有桶（香港 region + SSE）+ RAM 子账号 AK；每用户库**逐一**快照 + sha256 manifest + **回读比对**。量化指标（建议值，部署阶段可调）：**RPO ≤ 24h**、**RTO ≤ 2h**、频率 = 每日 1 次、保留 = 日备 30 代 + 月备 12 代、**异地** = OSS 香港（与 4 号机不同故障域）。**门户自身库**（与用户记忆库分离存放）同样纳入备份与外迁。 | 恢复演练可重复执行且通过；任一代快照可完整恢复并通过校验。 | `dev-plan.md` §4.3 · [`multiuser_isolation.md`](./multiuser_isolation.md) §5.4 | Sprint 5 | ToDo |
| 10 | [产品化-MCP] | mcp | 定制 — 记忆内容的多语言支持 | **待探针确认**：上游在保存 / 检索 memory 时是否支持多语言（有无相关配置项、有无已知限制）。 | 给出明确结论（支持 / 不支持 / 部分支持）并回写本行描述。 | `sprint_plan.md`「探针：上游保存 memory 时是否支持多语言」 · 上游源码 | Sprint 2 | ToDo |
| 11 | [产品化-MCP] | mcp | 定制 — 多用户数据隔离 | 一用户一库 + 每用户身份，**读写双向物理隔离**；不依赖上游多租户机制（上游不存在），也不依赖能力令牌（macaroon 是 **additive-only**，只放宽不收紧）。**关键风险**：隔离依赖会话启动时注入 env，存在**静默失效**路径 —— 漏设 / 写错 `AI_MEMORY_DB` 会落到 config 的**共享主库**且**不报错**（详见 [`sprint_plan.md`](./sprint_plan.md)「阻断级风险」R1）。 | 通过 V1–V4 验证，**含负向**：漏设 `AI_MEMORY_DB` 的会话**必须失败**（不得落到 `/data/ai-memory.db`）；跨用户检索命中不到、`memory_get` 他用户记忆不可见。 | [`multiuser_isolation.md`](./multiuser_isolation.md) §5–§7 · [`sprint_plan.md`](./sprint_plan.md)（阻断级风险）· [`admin_portal_design.md`](./admin_portal_design.md) §9 | Sprint 3 | ToDo |
| 12 | [产品化-MCP] | mcp | 定制 — 工具档位 | 决定对上游暴露**哪一档**：`core` 7 / `graph` 19 / `admin` 21 / `power` 56 / `full` 101（`memory_capabilities` 在**所有档位** always-on，故前四档实际注册数 +1 = 8 / 20 / 22 / 57）。上游 `mcp --profile` **默认 `core`** —— 不写就只暴露 `core` 档。另需**统一门户模板与 SSH 模板**的档位，避免同一用户两条路径看到的能力不同。 | 档位决议落入门户模板、SSH 模板与对外文档；与 #19 的清单一致。 | [`mcp_tool_inventory.md`](./mcp_tool_inventory.md) §2 / §5 · `sprint_plan.md`「--profile 定档」 | Sprint 3 | WIP |
| 13 | [产品化-MCP] | mcp | 定制 — 每用户库的后台维护 | 每用户库的 TTL 遗忘 / 压缩 / GC / curator **由谁跑** —— 既有常驻 `curator` **只服务默认库**。需定：门户调度 or 主机 cron；并核实 `gc` 是否覆盖每库的 TTL 遗忘与 WAL checkpoint（该点在方案文档中标为**待核实**，不可照抄假定）。 | 调度落地并留日志；逐库 `ai-memory --db <each> gc` 与 `curator --once` 执行成功；TTL 遗忘与 checkpoint 覆盖**已实测核实**。 | [`multiuser_isolation.md`](./multiuser_isolation.md) §5.3 | Sprint 3 | ToDo |
| 14 | [产品化-MCP] | mcp | 定制 — 接入面 | HTTP MCP（门户，**新增**）+ SSH stdio（主人自用，门户故障时的**保底**）。保留 SSH 路径的目的是**降级不失效**：门户挂掉时主人仍能读写自己的记忆。 | 两条路径都能完成 MCP 握手并成功读写；停掉门户后 SSH 路径仍可用。 | [`admin_portal_design.md`](./admin_portal_design.md) §3.1 · [`multiuser_isolation.md`](./multiuser_isolation.md) §5.1 | Sprint 5 | ToDo |
| 15 | [产品化-MCP] | mcp | 定制 — 可用性前提（agent attestation） | `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` —— 不设则无签名写入 **403**（v0.9 的 require-everywhere 缺陷；v0.10 已改为 surface-scoped）。**所有** spawn 路径（门户模板、SSH forced command、compose、cron）都必须带上。 | 各路径均设置该 env；漏设时能**显式报错**而非静默失败。 | `deploy/docker-compose.prod.yml` · [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) | Sprint 3 | WIP |
| 16 | [产品化-MCP] | mcp | 定制 — 公网入口与认证边界 | 管理面走 **Cloudflare Access**、MCP 面走 **`memo_` 令牌**；门户按 **Host 头**做面隔离（在 MCP 域名上拒绝管理 API）。新增公网入口是对既有「零公网入口」架构的**变更**，需同步修订 `deployment_strategy.md` §0 与 [`admin_portal_design.md`](./admin_portal_design.md) §12。 | 两个域名分流正确；跨面调用被拒；相关决议文档已同步。 | [`admin_portal_design.md`](./admin_portal_design.md) §7 / §12 | Sprint 4 | ToDo |
| 17 | [产品化-MCP] | mcp | 定制 — 审计与限流（上游 `[limits]`） | 平台侧配额与准入控制**全部走上游 `[limits]` 段**：`max_memories_per_day` / `max_storage_bytes` / `max_links_per_day` / `max_page_size` / `max_inflight_requests` / `vector_index_capacity` / `vector_index_hard_fail_at_cap`；环境变量 `AI_MEMORY_MAX_*` 可覆盖（优先级高于配置文件）。**`config.toml.tmpl` 当前没有 `[limits]` 段，待补**。会话级限流见 #6。 | `[limits]` 段落地；改配置后超限写入被拒且报错可读；`memory_quota_status` 可读到配额与用量。 | `src/config.rs:3703-3760` · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) | Sprint 3 | ToDo |
| 18 | [产品化-MCP] | mcp | 定制 — 升级治理 | 版本契约（[`../upstream.lock`](../upstream.lock)）+ 准入判据 + **门户镜像随上游重建**：门户镜像 `COPY` 上游官方镜像里的二进制，故上游升级必须**重建门户镜像**，否则门户与部署制品版本漂移，而漂移是静默的。 | 升级清单含「重建门户镜像」一步，且已被演练过。 | [`admin_portal_design.md`](./admin_portal_design.md) §4.2 / §12 #7 | Sprint 4 | ToDo |
| 19 | [产品化-MCP] | mcp | 对外提供的能力 — 工具清单与档位定档 | 工具清单**已产出** → [`mcp_tool_inventory.md`](./mcp_tool_inventory.md)（101 项 / 8 族 / 5 档；含两个易算错点：`memory_capabilities` 全档位 always-on、默认档位是 `core` 而非 `full`）。**待决策**：对外暴露哪一档；选档后需对外公布并落地到模板（见 #12）。 | 清单与部署模板**实际**暴露的工具数一致（用 MCP `initialize` 回包核对）。 | [`mcp_tool_inventory.md`](./mcp_tool_inventory.md) · `sprint_plan.md`「--profile 定档」 | Sprint 2 | WIP |
| 20 | [升级] | 上游更新与升级 | 明确资产隔离策略 | 上游代码从 GitHub 获取；下游用**最小耦合**策略选版、按需配置后部署到 hk_vps_4；工作目录与远端仓库已关联（`ethanhuangcst/memory.agent-mate.ai`）。 | 全仓可判定每个文件属**上游**（`ai-memory-mcp/`）或属**本项目**（`hk_vps_4/`、`admin_portal/`）；上游 clone 保持只读。 | [`asset_isolation_plan.md`](./asset_isolation_plan.md) | Sprint 1 | Done |
| 21 | [升级] | 上游更新与升级 | 上游产品资产更新 — 准入判据与邮件提醒 | 判据已分层落地（**H1–H5 硬性阻断** / **W1–W6 人工确认**）；自动化**仅做到**每日比对 + 开 GitHub issue，**邮件提醒尚未实现**。 | 收到一封真实邮件（含版本号、判据结论、CHANGELOG 摘要）。 | `dev-plan.md` §5 · `adr/ADR-005-upgrade-admission-gate-layering.md` | Sprint 6 | WIP |
| 22 | [升级] | 上游更新与升级 | 历次版本升级跟踪与过程资产 | `upstream.lock` 已记录当前坐标与校验日期；**尚无历次升级的过程记录**。 | 每次升级留下一条记录（版本 / 日期 / 判据结论 / 步骤 / 验证 / 回滚点）。 | [`../upstream.lock`](../upstream.lock) | Sprint 6 | ToDo |
| 23 | [升级] | 上游更新与升级 | 最低耦合、尽量自动化的升级方案 | 已落地版本契约层（[`../upstream.lock`](../upstream.lock) + [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) + [`../scripts/upstream-preflight.sh`](../scripts/upstream-preflight.sh) + 每日跟踪 Action）；**部署侧自动化待门户阶段补齐**。 | 一次升级可在「改 `upstream.lock` → 跑预检 → 重建/重启」内完成，无需手工比对版本号。 | `adr/ADR-004-version-contract-single-source-of-truth.md` | Sprint 6 | WIP |
| 24 | [升级] | 上游更新与升级 | 制定部署/升级方案 — 制定方案与脚本 | `dev-plan.md` §5 七步链路已定；**相关脚本待补**。 | 相关脚本落地且可重复执行。 | `dev-plan.md` §5 | Sprint 6 | WIP |
| 25 | [升级] | 上游更新与升级 | 制定部署/升级方案 — 验证并文档化 | 需完整演练一次升级并留痕。**注意**：回滚**必须**用快照覆盖 —— 上游**不拒绝**「比自身更新的库」（旧二进制会静默读写不认识的 schema）。 | 完整演练一次升级（预检 → 部署 → 验收 → **回滚演练**）并留痕。 | `knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md` | Sprint 6 | ToDo |
| 26 | [上线] | 上线生产环境 | 部署 · 验证 · 文档化 | **部署方案** = `dev-plan.md` §3（ai-memory）+ [`admin_portal_design.md`](./admin_portal_design.md) §11（门户，含新增公网入口、反代与域名）；**验证方案** = `dev-plan.md` §3.3 冒烟 + [`multiuser_isolation.md`](./multiuser_isolation.md) §7 + [`admin_portal_design.md`](./admin_portal_design.md) §13；**文档化** = 本仓 `hk_vps_4/specs/`。 | 部署后上述三份验收清单全部通过。 | `dev-plan.md` §3 · [`admin_portal_design.md`](./admin_portal_design.md) §11 / §13 | Sprint 5 | ToDo |

---------

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-20 | 按 Product Backlog 格式落地：补标准头、新增「鉴权」节、把需求细节移入 Backlog 表（26 条 × 9 列） |
| 2026-09-20 | 处理 `[ToDo1–4]`：补容量/配额/限流的评估结论（大部分可由上游 `[limits]` 实现）、「其他」逐项拆分、引用 [`mcp_tool_inventory.md`](./mcp_tool_inventory.md)、Backlog 与需求同步 |
| 2026-09-20 | `sprint_plan.md` 重排为 6 个 Sprint：Backlog 表 `Sprint` 列由 `TBD` 回填为 `Sprint 1..6`（`描述` / `验收条件` / `状态` **未改动**）；跨文档引用改为按**条目名**指向（避免重排后失效）；新增「排期」说明 —— 本表 `Sprint` 列是 `sprint_plan.md` 排期的**投影** |
