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
- 验收条件：部署制品中不含对上游源码的补丁；上游升级无需 rebase 任何自有补丁 → [Backlog #31 定制口径门禁（不改上游源码 + 例外登记）](#product-backlog)

### 明确不做（out of scope）
- **自助注册** —— 用户由管理员邀请制创建（见「用户模型」）
- **对外收费 / 计费** —— 无支付、无套餐、无账单
- **非 MCP 客户端接入** —— 不提供 REST / Web SDK / OpenAI 兼容等其它接入面
- **多租户 SaaS 形态** —— 不自建对外运营的账号体系
- **上游能力之外的二次开发** —— 门户是唯一自有产品面
- 验收条件：上述条目在后续评审中保持不变；任何突破须在本节登记为「例外 + 决议 + 日期」 → [Backlog #31 定制口径门禁（不改上游源码 + 例外登记）](#product-backlog)

---------
## 用户模型（邀请制）和鉴权
### 用户模型
- 用户来源：**管理员在门户建用户**（邀请制），不开放自助注册 → [Backlog #27 管理员建用户（邀请制，无自助注册）](#product-backlog)
- 用户与设备：同一用户可持**多把 key**（多设备 / 多工具），共享**同一份记忆**（同一库） → [Backlog #28 一用户多 key 共享同一份记忆](#product-backlog)
- 审批：无审批流（邀请即生效） → [Backlog #27 管理员建用户（邀请制，无自助注册）](#product-backlog)
- 规模：用户数上限待定（受「容量与配额」约束，见 admin portal 一节） → [Backlog #29 用户规模上限（待定 → 定值）](#product-backlog)
- 验收条件：管理员可建用户并签发 key；非管理员无法创建任何用户或 key；同一用户的两把 key 读到同一份记忆 → [Backlog #27 管理员建用户（邀请制，无自助注册）](#product-backlog) · [Backlog #28 一用户多 key 共享同一份记忆](#product-backlog)
### 鉴权
按「面」划分 —— 每一面的主体、凭据与边界都不同：

| 面 | 访问主体 | 凭据 | 边界 |
| --- | --- | --- | --- |
| **管理面**（门户 UI / API） | 管理员 | **Cloudflare Access**（浏览器 SSO）+ 门户会话 | 仅管理域名；在 MCP 域名上请求管理 API 一律**拒绝** → [Backlog #2 登录与访问控制](#product-backlog) |
| **MCP 面**（`<MCP_HOST>/mcp`） | 用户及其客户端 | **`memo_` 令牌**（`Authorization: Bearer`） | 库内只存 `sha256(token)`；可吊销、可轮换；明文仅签发时显示一次 → [Backlog #3 key 生命周期](#product-backlog) |
| **SSH 面**（保底路径） | 主人 / 运维 | **SSH 密钥 + forced command** | 单 OS 账号 `aimem-ssh` + N 把密钥 + N 条记录；身份与库路径由**服务端钉死** → [Backlog #14 接入面](#product-backlog) |
| **上游 HTTP 面**（`serve` 的 9077） | **不对外开放** | — | 绑 `127.0.0.1`、**不映射主机端口**；不启用顶层 `api_key` / `AI_MEMORY_REQUIRE_API_KEY` → [Backlog #30 上游 HTTP 面（`serve` 9077）不对外](#product-backlog) |

身份与被授权对象的关系：

- 门户用户 = 一个 `handle`；其**记忆身份** = `AI_MEMORY_AGENT_ID=human:<handle>`；其**数据边界** = 独立库 `/data/users/<handle>/ai-memory.db` → [Backlog #4 记忆身份与数据隔离](#product-backlog)
- 同一用户的多把 key 都解析到**同一个 `handle`**（多设备共享同一份记忆） → [Backlog #28 一用户多 key 共享同一份记忆](#product-backlog)
- **不做**：服务器 OS 账号同步；上游多租户机制（上游不存在）；用能力令牌做隔离（macaroon 是 **additive-only**，只放宽不收紧）

验收条件：

- 未经 Cloudflare Access 认证无法访问管理域名；在 MCP 域名上访问管理 API 被拒绝 → [Backlog #2 登录与访问控制](#product-backlog)
- 无 `memo_` 令牌、或令牌已吊销，均无法建立 MCP 会话 → [Backlog #3 key 生命周期](#product-backlog)
- 上游 9077 端口对外**不可达**；不启用 `AI_MEMORY_REQUIRE_API_KEY` 的硬性要求（因无公网 HTTP 面） → [Backlog #30 上游 HTTP 面（`serve` 9077）不对外](#product-backlog)
- 令牌明文不落库、不进日志 → [Backlog #3 key 生命周期](#product-backlog) · [Backlog #5 审计视图](#product-backlog)

---------
# 需求

> **分层规则**：本节保留「要什么」（需求陈述）；**可执行细节、验收条件、关联文档与状态**见文末「Product Backlog」。
> 每项前的 `[类型]` 即 Backlog 表中的「分类」。
> **覆盖要求**：本文档第一部分（「产品概述」的需求边界 / 用户模型 / 鉴权，以及本节）**每条需求都必须在文末 Backlog 有对应条目** —— 要么 1:1 一条，要么由某条的「描述 + 验收条件」显式覆盖（覆盖关系写在「关联」列）。新增或修改第一部分的需求时须同步检查第二部分。
> **回溯引用**：第一部分每项需求后的 `→ [Backlog #N 名称](#product-backlog)` 指向文末对应条目 —— **以条目名为主、编号为辅**（编号会随重排失效）；表格行无锚点，故链接只到 `#product-backlog` 节，条目由链接文字定位。

---------
## [本地启动] 本地启动产品
- 在本机以**默认配置**启动 ai-memory-mcp，作为后续方案验证的对照基线。 → [Backlog #1 开发环境默认启动](#product-backlog)

---------
## [产品化-web] web portal
### admin portal
- **登录与访问控制**：Cloudflare Access 仅保护管理域名；MCP 域名须显式绕过。 → [Backlog #2 登录与访问控制](#product-backlog)
- **key 生命周期**：签发 / 列出元信息 / 修改 / 轮换 / 删除。 → [Backlog #3 key 生命周期](#product-backlog)
- **记忆身份与数据隔离**：每用户独立身份与独立库，建用户即就绪。 → [Backlog #4 记忆身份与数据隔离](#product-backlog)
- **审计视图**：覆盖 建用户 / 签发 / 轮换 / 吊销 / 每次会话开始。 → [Backlog #5 审计视图](#product-backlog)
- **容量、配额与限流**：**先复用上游能力**（配额与页大小上限走上游 `[limits]`，门户只做纳管与展示）；**仅门户自建**会话级并发、空闲超时与单会话时长。 → [Backlog #6 容量、配额与限流](#product-backlog)
### Integration Instructions 页面
- **接入说明页**：Home（接入步骤）+ Admin 入口。 → [Backlog #7 Integration Instructions 页面](#product-backlog)
- **i18n**：范围限定为门户 UI 与接入说明页。 → [Backlog #7 Integration Instructions 页面](#product-backlog)

---------
## [产品化-MCP] mcp
### 根据 memory.agent-mate.ai 的需求，对上游产品能力进行定制
> 「定制」的口径见「需求边界」—— **配置 + 外围组件，不改上游源码**。
- **LLM 选择**：`smart` 档，qwen 系列。 → [Backlog #8 LLM 选择](#product-backlog)
- **备份与恢复**：OSS 私有桶外迁 + 量化指标 + 门户自身库纳入。 → [Backlog #9 备份与恢复](#product-backlog)
- **记忆内容的多语言支持**：**部分支持**（2026-09-21 探针实测）——存储 / 语义召回 / 按 id 直取不限语言；关键词检索受 FTS5 默认分词器限制只认完整词元（中文需标点界定整段、简繁不互通），无相关配置项。 → [Backlog #10 记忆内容的多语言支持](#product-backlog)
- **多用户数据隔离**：一用户一库 + 每用户身份。 → [Backlog #11 多用户数据隔离](#product-backlog)
- **工具档位**：对外暴露上游 MCP 工具档位之一（档位待决策）。 → [Backlog #12 工具档位](#product-backlog)
- **每用户库的后台维护**：TTL 遗忘 / GC / curator 的归属（常驻 curator 只服务默认库）。 → [Backlog #13 每用户库的后台维护](#product-backlog)
- **接入面**：HTTP MCP（门户）+ SSH stdio（保底）。 → [Backlog #14 接入面](#product-backlog)
- **可用性前提**：`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`（否则无签名写入 403）。 → [Backlog #15 可用性前提（agent attestation）](#product-backlog)
- **公网入口与认证边界**：管理面 CF Access / MCP 面 `memo_` 令牌。 → [Backlog #16 公网入口与认证边界](#product-backlog)
- **审计与限流**：平台侧配额与准入控制走上游 `[limits]`；会话级限流见门户侧。 → [Backlog #17 审计与限流（上游 `[limits]`）](#product-backlog)
- **升级治理**：版本契约 + 准入判据 + 门户镜像随上游重建。 → [Backlog #18 升级治理](#product-backlog)
### 对外提供的能力
- 对外提供上游 MCP 工具清单中的选定档位。**清单见** [`mcp_tool_inventory.md`](./mcp_tool_inventory.md)（101 项 / 8 族 / 5 档）；具体档位待决策。 → [Backlog #19 对外提供的能力 — 工具清单与档位定档](#product-backlog)

---------
## [升级] 上游更新与升级
### 明确资产隔离策略
- 上游代码获取 + 下游最小耦合选版部署 + 工作目录与远端仓库关联。 → [Backlog #20 明确资产隔离策略](#product-backlog)
### 上游产品资产更新
- 升级准入判据 + 自动化提醒（邮件）。 → [Backlog #21 上游产品资产更新 — 准入判据与邮件提醒](#product-backlog)
- 历次版本升级跟踪与过程资产。 → [Backlog #22 历次版本升级跟踪与过程资产](#product-backlog)
- 最低耦合、尽量自动化的升级方案。 → [Backlog #23 最低耦合、尽量自动化的升级方案](#product-backlog)
### 制定部署/升级方案
- 制定升级方案及相关脚本。 → [Backlog #24 制定部署/升级方案 — 制定方案与脚本](#product-backlog)
- 验证并文档化升级方案。 → [Backlog #25 制定部署/升级方案 — 验证并文档化](#product-backlog)

---------
## [上线] 上线生产环境
- 覆盖 ai-memory 与 web portal 的**部署 / 验证 / 文档化**三件事。 → [Backlog #26 部署 · 验证 · 文档化](#product-backlog)

---------

# Product Backlog

| # | 分类 | 父项 | 标题 | 描述 | 验收条件 | 关联 | Sprint | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | [本地启动] | 本地启动产品 | 开发环境默认启动 | 按默认配置在本机启动 ai-memory-mcp，作为后续方案验证的对照基线。 | 本机启动成功，并通过 MCP 完成一次写入 + 召回。 | `dev-plan.md` §3 · `deploy/README.md` | Sprint 2 | Done |
| 2 | [产品化-web] | web portal | admin portal — 登录与访问控制 | 管理面走 **Cloudflare Access**（浏览器 SSO）；**仅管理域名**受保护，MCP 域名须**显式绕过**（命令行客户端无法完成 SSO 重定向，否则表现为「连不上」）。 | 仅持有效 CF Access 身份者可访问管理域名；在 MCP 域名上请求管理 API 被**拒绝**。 | [`admin_portal_design.md`](./admin_portal_design.md) §7 | Sprint 4 | ToDo |
| 3 | [产品化-web] | web portal | admin portal — key 生命周期 | 操作 = 签发 / 列出元信息 / 修改 / 轮换 / 删除。「列出元信息」= 前缀 + 标签 + 创建时间 + 最后使用时间（**明文不可取回**，库内只存 `sha256(token)`）；「轮换」= **吊销旧 + 签发新**（旧 key 不可复活）；「删除」= **软吊销**（置 `revoked_at`，立即失效但保留审计链条，**不做**物理删除）。格式 = `memo_` + 32 字节 CSPRNG（base64url 无填充）；请求头 `Authorization: Bearer memo_…`；明文**仅创建时显示一次**。 | 5 个操作均可用；明文仅在创建响应中出现一次；吊销后新建会话被拒、既有会话被终止。 | [`admin_portal_design.md`](./admin_portal_design.md) §5.1 | Sprint 4 | ToDo |
| 4 | [产品化-web] | web portal | admin portal — 记忆身份与数据隔离 | 每用户 `AI_MEMORY_AGENT_ID=human:<handle>` + 独立库 `/data/users/<handle>/ai-memory.db`（**一用户一库**，读写双向物理隔离）。**不做**服务器 OS 账号同步（单账号 `aimem-ssh` + N 把密钥 + N 条 forced command）。建用户时创建其库目录（属主对齐容器内 `aimem`）；签发 key 时**幂等确保**目录存在；**库文件由 ai-memory 首次使用时自动创建**。 | 跨用户检索**命中不到**；`memory_get` 他用户记忆返回不可见；每个库文件属主为 `aimem`。 | [`multiuser_isolation.md`](./multiuser_isolation.md) §5 · [`admin_portal_design.md`](./admin_portal_design.md) §5.2 | Sprint 4 | ToDo |
| 5 | [产品化-web] | web portal | admin portal — 审计视图 | 覆盖事件：建用户 / 签发 / 轮换 / 吊销 / 每次会话开始（**含解析出的库路径**，便于事后对账「这次会话落在哪个库」）。 | 上述事件均可查询；日志中**不出现**令牌明文。 | [`admin_portal_design.md`](./admin_portal_design.md) §6 | Sprint 4 | ToDo |
| 6 | [产品化-web] | web portal | admin portal — 容量、配额与限流 | **评估结论：大部分可由上游实现，门户不自建计数器**。**上游原生支持**：写入量配额 `[limits].max_memories_per_day`、存储上限 `max_storage_bytes`、链接配额 `max_links_per_day`（均 **per-(agent, namespace)**；我们「一用户一库 + 一 agent」⇒ 天然等价于 **per-用户配额**）、页大小上限 `max_page_size`（**每请求内存上限，不是限流**）；查询有 `memory_quota_status` 工具与 `ai-memory quota-status` CLI。注意：**仅 HTTP 面**：`[limits].max_inflight_requests` 是「全局 **HTTP** 准入控制并发上限」，超出返 **503**（`src/config.rs:3745-3749`）—— 多用户走 **stdio MCP**，该层**很可能不生效**，需实测。**门户必须自建**：**会话级**并发上限（每 key / 全局）、空闲超时、单会话最长时长（上游没有「会话」概念，stdio 进程由 spawner 管）。**另需方案**：文件系统级磁盘配额 —— `max_storage_bytes` 是**库内计数**，不覆盖 WAL 与临时文件。 | 上游已支持项**以配置实现并核验生效**（改 `[limits]` 后超限写入被拒）；`max_inflight_requests` 对 stdio 是否生效**已实测给出结论**；门户自建项在超限时**明确拒绝**（而非排队致死）；FS 级磁盘配额方案定稿。 | `src/config.rs:3703-3760` · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl)（**`[limits]` 段待补**） | Sprint 4 | ToDo |
| 7 | [产品化-web] | web portal | Integration Instructions 页面 | Home 页面（Instructions）：接入步骤 = 获取 key → 配置客户端 → 验证；含 Admin 入口。i18n **限定为门户 UI 与接入说明页**（MCP 服务本身不做 i18n）。 | 新用户按页面指引可在 ≤ 3 步内完成客户端接入并成功调用一次工具；至少支持中 / 英双语切换，新增语言不改动业务逻辑。 | [`admin_portal_design.md`](./admin_portal_design.md) §3.1 | Sprint 4 | ToDo |
| 8 | [产品化-MCP] | mcp | 定制 — LLM 选择 | `tier = "smart"`；`[llm]` = `qwen` / `qwen-plus`；`[llm.auto_tag]` **只写** `model = "qwen-turbo"`（省略 backend，逐字段继承 `[llm]`）；`[embeddings]` = `qwen` + `qwen3.7-text-embedding` + **`dim = 1024`**（2026-09-20 实测；`base_url` 指向私有 MaaS workspace，公开仓写占位符 `<QWEN_BASE_URL>`）。 | `ai-memory doctor` 通过；Embeddings Reachability 显示 `qwen:<model>` 且维度一致。 | [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) F1–F3 | Sprint 3 | WIP |
| 9 | [产品化-MCP] | mcp | 定制 — 备份与恢复 | OSS 私有桶（香港 region + SSE）+ RAM 子账号 AK；每用户库**逐一**快照 + sha256 manifest + **回读比对**。量化指标（建议值，部署阶段可调）：**RPO ≤ 24h**、**RTO ≤ 2h**、频率 = 每日 1 次、保留 = 日备 30 代 + 月备 12 代、**异地** = OSS 香港（与 4 号机不同故障域）。**门户自身库**（与用户记忆库分离存放）同样纳入备份与外迁。 | 恢复演练可重复执行且通过；任一代快照可完整恢复并通过校验。 | `dev-plan.md` §4.3 · [`multiuser_isolation.md`](./multiuser_isolation.md) §5.4 | Sprint 5 | ToDo |
| 10 | [产品化-MCP] | mcp | 定制 — 记忆内容的多语言支持 | **结论 = 部分支持**（2026-09-21 探针实测，`v0.10.0`；可复跑探针 [`../scripts/i18n-probe.sh`](../scripts/i18n-probe.sh)）：① **存储**：简中 / 繁中 / 英文写入均成功（`memory_store` 与语言无关）；② **语义召回与按 id 直取**：三语言一律可用（`memory_recall` `mode=hybrid` 命中、`memory_get` 语言无关）；③ **关键词检索（`memory_search`）**：受 FTS5 默认分词器限制——建表 `USING fts5(title, content, tags, …)` 未指定 `tokenize=` 即 `unicode61`，只按**完整词元**匹配（英文 = 单词、中文 = 标点/空白界定的整段），词元内子串不命中，**简繁字形不做归一**（交叉检索双向不命中）；查询串经 `sanitize_fts_query` 剥除全部 FTS5 特殊字符（**无通配**）、隐式 AND。④ **配置项**：**无**任何语言 / 分词 / 检索相关配置键（`[mcp]` 段仅 profile / allowlist / profile_hint_in_errors）。**工程口径**：中文检索一律走 `memory_recall`；关键词通路只用于 ASCII 标记与中文整段引用。 | 已满足：结论（部分支持 + 精确边界 + 无配置项）已回写本行描述；用例与证据登记 [`mcp/mcp-test.md`](./mcp/mcp-test.md) §1 L1.6 / §4-E。 | [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-E · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](./knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) · [`../scripts/i18n-probe.sh`](../scripts/i18n-probe.sh) | Sprint 2 | Done |
| 11 | [产品化-MCP] | mcp | 定制 — 多用户数据隔离 | 一用户一库 + 每用户身份，**读写双向物理隔离**；不依赖上游多租户机制（上游不存在），也不依赖能力令牌（macaroon 是 **additive-only**，只放宽不收紧）。**关键风险**：隔离依赖会话启动时注入 env，存在**静默失效**路径 —— 漏设 / 写错 `AI_MEMORY_DB` 会落到 config 的**共享主库**且**不报错**（详见 [`sprint_plan.md`](./sprint_plan.md)「阻断级风险」R1）。 | 通过 V1–V4 验证，**含负向**：漏设 `AI_MEMORY_DB` 的会话**必须失败**（不得落到 `/data/ai-memory.db`）；跨用户检索命中不到、`memory_get` 他用户记忆不可见。 | [`multiuser_isolation.md`](./multiuser_isolation.md) §5–§7 · [`sprint_plan.md`](./sprint_plan.md)（阻断级风险）· [`admin_portal_design.md`](./admin_portal_design.md) §9 | Sprint 3 | ToDo |
| 12 | [产品化-MCP] | mcp | 定制 — 工具档位 | 决定对上游暴露**哪一档**：`core` 7 / `graph` 19 / `admin` 21 / `power` 56 / `full` 101（`memory_capabilities` 在**所有档位** always-on，故前四档实际注册数 +1 = 8 / 20 / 22 / 57）。上游 `mcp --profile` **默认 `core`** —— 不写就只暴露 `core` 档。另需**统一门户模板与 SSH 模板**的档位，避免同一用户两条路径看到的能力不同。**决议（2026-09-21）**：对外（SSH 用户行 + 门户）**统一 `core`（8 项）**；管理员入口 = **`admin`（22 项）**，两条模板分离。已落盘四处：[`deployment.md`](./deployment.md) §4.3 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.1–§5.2 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3.3 · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §3；实测依据 [`../scripts/profile-probe.sh`](../scripts/profile-probe.sh)（core=8 / graph=20 / admin=22 / power=57 / full=101 / `core,lifecycle`=14 / 默认档=8 且不报错）。 | 档位决议落入门户模板、SSH 模板与对外文档；与 #19 的清单一致。 | [`mcp_tool_inventory.md`](./mcp_tool_inventory.md) §2 / §5 · `sprint_plan.md`「--profile 定档」 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8.3 | Sprint 3 | **Done（2026-09-21）** |
| 13 | [产品化-MCP] | mcp | 定制 — 每用户库的后台维护 | 每用户库的 TTL 遗忘 / 压缩 / GC / curator **由谁跑** —— 既有常驻 `curator` **只服务默认库**。需定：门户调度 or 主机 cron；并核实 `gc` 是否覆盖每库的 TTL 遗忘与 WAL checkpoint（该点在方案文档中标为**待核实**，不可照抄假定）。 | 调度落地并留日志；逐库 `ai-memory --db <each> gc` 与 `curator --once` 执行成功；TTL 遗忘与 checkpoint 覆盖**已实测核实**。 | [`multiuser_isolation.md`](./multiuser_isolation.md) §5.3 | Sprint 3 | ToDo |
| 14 | [产品化-MCP] | mcp | 定制 — 接入面 | HTTP MCP（门户，**新增**）+ SSH stdio（主人自用，门户故障时的**保底**）。保留 SSH 路径的目的是**降级不失效**：门户挂掉时主人仍能读写自己的记忆。 | 两条路径都能完成 MCP 握手并成功读写；停掉门户后 SSH 路径仍可用。 | [`admin_portal_design.md`](./admin_portal_design.md) §3.1 · [`multiuser_isolation.md`](./multiuser_isolation.md) §5.1 | Sprint 5 | ToDo |
| 15 | [产品化-MCP] | mcp | 定制 — 可用性前提（agent attestation） | `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` —— 不设则无签名写入 **403**（v0.9 的 require-everywhere 缺陷；v0.10 已改为 surface-scoped）。**所有** spawn 路径（门户模板、SSH forced command、compose、cron）都必须带上。 | 各路径均设置该 env；漏设时能**显式报错**而非静默失败。 | `deploy/docker-compose.prod.yml` · [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) | Sprint 3 | WIP |
| 16 | [产品化-MCP] | mcp | 定制 — 公网入口与认证边界 | 管理面走 **Cloudflare Access**、MCP 面走 **`memo_` 令牌**；门户按 **Host 头**做面隔离（在 MCP 域名上拒绝管理 API）。新增公网入口是对既有「零公网入口」架构的**变更**，需同步修订 `deployment_strategy.md` §0 与 [`admin_portal_design.md`](./admin_portal_design.md) §12。 | 两个域名分流正确；跨面调用被拒；相关决议文档已同步。 | [`admin_portal_design.md`](./admin_portal_design.md) §7 / §12 | Sprint 4 | ToDo |
| 17 | [产品化-MCP] | mcp | 定制 — 审计与限流（上游 `[limits]`） | 平台侧配额与准入控制**全部走上游 `[limits]` 段**：`max_memories_per_day` / `max_storage_bytes` / `max_links_per_day` / `max_page_size` / `max_inflight_requests` / `vector_index_capacity` / `vector_index_hard_fail_at_cap`；环境变量 `AI_MEMORY_MAX_*` 可覆盖（优先级高于配置文件）。**`config.toml.tmpl` 当前没有 `[limits]` 段，待补**。会话级限流见 #6。 | `[limits]` 段落地；改配置后超限写入被拒且报错可读；`memory_quota_status` 可读到配额与用量。 | `src/config.rs:3703-3760` · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) | Sprint 3 | ToDo |
| 18 | [产品化-MCP] | mcp | 定制 — 升级治理 | 版本契约（[`../upstream.lock`](../upstream.lock)）+ 准入判据 + **门户镜像随上游重建**：门户镜像 `COPY` 上游官方镜像里的二进制，故上游升级必须**重建门户镜像**，否则门户与部署制品版本漂移，而漂移是静默的。 | 升级清单含「重建门户镜像」一步，且已被演练过。 | [`admin_portal_design.md`](./admin_portal_design.md) §4.2 / §12 #7 | Sprint 4 | ToDo |
| 19 | [产品化-MCP] | mcp | 对外提供的能力 — 工具清单与档位定档 | 工具清单**已产出** → [`mcp_tool_inventory.md`](./mcp_tool_inventory.md)（101 项 / 8 族 / 5 档；含两个易算错点：`memory_capabilities` 全档位 always-on、默认档位是 `core` 而非 `full`）。**已定（2026-09-21）**：对外 = **`core`（8 项）**，管理员入口 = **`admin`（22 项）**（见 #12）；模板已落盘；各档实测（探针 [`../scripts/profile-probe.sh`](../scripts/profile-probe.sh)，7 档全绿）：core=8 / graph=20 / admin=22 / power=57 / full=101 / `core,lifecycle`=14 / 默认档（不传 `--profile`）=8 且不报错；对外用户版说明 [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md)。 | 清单与部署模板**实际**暴露的工具数一致（用 MCP `initialize` 回包核对）—— 本地侧已核对（同上实测）；**生产侧核对移交 Sprint 5「上线验收」**（随上线执行，不阻断本条）。 | [`mcp_tool_inventory.md`](./mcp_tool_inventory.md) · `sprint_plan.md`「--profile 定档」 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8 | Sprint 2 | **Done（2026-09-21）** |
| 20 | [升级] | 上游更新与升级 | 明确资产隔离策略 | 上游代码从 GitHub 获取；下游用**最小耦合**策略选版、按需配置后部署到 hk_vps_4；工作目录与远端仓库已关联（`ethanhuangcst/memory.agent-mate.ai`）。 | 全仓可判定每个文件属**上游**（`ai-memory-mcp/`）或属**本项目**（`memory.agent-mate.ai/`、`admin_portal/`）；上游 clone 保持只读。 | [`asset_isolation_plan.md`](./asset_isolation_plan.md) | Sprint 1 | Done |
| 21 | [升级] | 上游更新与升级 | 上游产品资产更新 — 准入判据与邮件提醒 | 判据已分层落地（**H1–H5 硬性阻断** / **W1–W6 人工确认**）；自动化**仅做到**每日比对 + 开 GitHub issue，**邮件提醒尚未实现**。 | 收到一封真实邮件（含版本号、判据结论、CHANGELOG 摘要）。 | `dev-plan.md` §5 · `adr/ADR-005-upgrade-admission-gate-layering.md` | Sprint 6 | WIP |
| 22 | [升级] | 上游更新与升级 | 历次版本升级跟踪与过程资产 | `upstream.lock` 已记录当前坐标与校验日期；**尚无历次升级的过程记录**。 | 每次升级留下一条记录（版本 / 日期 / 判据结论 / 步骤 / 验证 / 回滚点）。 | [`../upstream.lock`](../upstream.lock) | Sprint 6 | ToDo |
| 23 | [升级] | 上游更新与升级 | 最低耦合、尽量自动化的升级方案 | 已落地版本契约层（[`../upstream.lock`](../upstream.lock) + [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) + [`../scripts/upstream-preflight.sh`](../scripts/upstream-preflight.sh) + 每日跟踪 Action）；**部署侧自动化待门户阶段补齐**。 | 一次升级可在「改 `upstream.lock` → 跑预检 → 重建/重启」内完成，无需手工比对版本号。 | `adr/ADR-004-version-contract-single-source-of-truth.md` | Sprint 6 | WIP |
| 24 | [升级] | 上游更新与升级 | 制定部署/升级方案 — 制定方案与脚本 | `dev-plan.md` §5 七步链路已定；**相关脚本待补**。 | 相关脚本落地且可重复执行。 | `dev-plan.md` §5 | Sprint 6 | WIP |
| 25 | [升级] | 上游更新与升级 | 制定部署/升级方案 — 验证并文档化 | 需完整演练一次升级并留痕。**注意**：回滚**必须**用快照覆盖 —— 上游**不拒绝**「比自身更新的库」（旧二进制会静默读写不认识的 schema）。 | 完整演练一次升级（预检 → 部署 → 验收 → **回滚演练**）并留痕。 | `knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md` | Sprint 6 | ToDo |
| 26 | [上线] | 上线生产环境 | 部署 · 验证 · 文档化 | **部署方案** = `dev-plan.md` §3（ai-memory）+ [`admin_portal_design.md`](./admin_portal_design.md) §11（门户，含新增公网入口、反代与域名）；**验证方案** = `dev-plan.md` §3.3 冒烟 + [`multiuser_isolation.md`](./multiuser_isolation.md) §7 + [`admin_portal_design.md`](./admin_portal_design.md) §13；**文档化** = 本仓 `memory.agent-mate.ai/specs/`。 | 部署后上述三份验收清单全部通过。 | `dev-plan.md` §3 · [`admin_portal_design.md`](./admin_portal_design.md) §11 / §13 | Sprint 5 | ToDo |
| 27 | [产品化-web] | 用户模型（邀请制） | admin portal — 管理员建用户（邀请制，无自助注册） | 用户**只能**由管理员在门户创建（邀请制、无审批流、创建即生效）；门户**不提供**任何自助注册入口。创建时校验 handle（`^[a-z0-9_-]{1,32}$`、不重复、拦截路径穿越），并**同时创建** `/data/users/<handle>/`（mode `0700`、属主对齐容器内 `aimem`）。**待关闭**：handle 命名规范与 sudoers 无通配符 argv 匹配的实测（见 `mcp/mcp-design.md` §6.4）。 | 管理员可建用户并签发 key；**非管理员**（无 CF Access 身份 / 在 MCP 域名请求管理 API）**无法**创建任何用户或 key；门户无注册入口；非法或含 `../` 的 handle 被拒且**不产生**预期外目录。 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S1 · [`web-portal/web-design.md`](./web-portal/web-design.md) §4.2 | Sprint 4 | ToDo |
| 28 | [产品化-web] | 用户模型（邀请制） | admin portal — 一用户多 key 共享同一份记忆 | 同一 handle 可持**多把** key（多设备 / 多工具），全部解析到同一 handle ⇒ 同一 `human:<handle>` 身份与**同一库**；因此「多设备」**不是**多份记忆 —— 任一 key 写入，其余 key 立即可读；轮换 / 吊销单把 key **不影响**其余 key 的会话与数据。 | 设备 A（key₁）写入的记忆，设备 B（key₂）**能召回同一份**；吊销 key₁ 后 key₂ 仍可建会话并读到同一记忆；两把 key 的 `last_used_at` 各自独立更新。 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S3 AC3.5 · [`web-portal/web-design.md`](./web-portal/web-design.md) §4.1 | Sprint 4 | ToDo |
| 29 | [产品化-web] | 容量与配额 | 用户规模上限（待定 → 定值） | 用户数上限**暂不硬编码**：先用上游 `[limits]` 的 per-用户配额纳管（见 #6 / #17），同时实测单库体积与 WAL 增长、并发会话内存占用，据此定「单主机可承载用户数」与主机规格；上限定值后写入门户校验（**超限拒绝建用户**，不静默接受）。 | 给出上限取值的**实测依据**；上限落地为门户校验并有「超限拒绝」的用例；本行描述与 `web-portal/web-design.md` §7 同步为定值。 | [`web-portal/web-design.md`](./web-portal/web-design.md) §7 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.4 | Sprint 5 | ToDo |
| 30 | [产品化-MCP] | 鉴权 | 上游 HTTP 面（`serve` 9077）不对外 | 鉴权模型的第四面：`serve` 的 9077 **只绑容器回环**、**不映射主机端口**、**不启用**顶层 `api_key` / `AI_MEMORY_REQUIRE_API_KEY`（本部署无公网 HTTP 面）；门户**不代理**该面。对外只有管理面（CF Access）与 MCP 面（`memo_` 令牌）。 | 主机外扫描 9077 **不可达**；部署制品（compose + 反向代理配置）无 9077 端口映射与代理规则；`config.toml` 未启用顶层 `api_key` 系列键。 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §1 · [`deployment.md`](./deployment.md) §3 | Sprint 3 | ToDo |
| 31 | [产品化-MCP] | 需求边界 | 定制口径门禁（不改上游源码 + 例外登记） | 把「定制 = 配置 + 外围组件（门户 / 反向代理 / 备份脚本），**不改上游源码**」固化为**可检查的门禁**：部署制品不含对上游源码的补丁、升级**无需 rebase** 自有补丁、`ai-memory-mcp/` 工作树保持只读干净。确需改上游源码时**先**立 ADR 决议并在「需求边界」登记为例外，否则不得开工；「明确不做」各条若被突破，同样以「例外 + 决议 + 日期」登记。 | 升级前后 `git -C ai-memory-mcp status --porcelain` 为空；`upstream-preflight.sh` 通过；仓库内无指向上游源码的补丁文件；例外条目（若有）在「需求边界」有登记且带 ADR 编号与日期。 | [`architecture.md`](./architecture.md) §5 · [`deployment.md`](./deployment.md) §9 | Sprint 6 | ToDo |

---------

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-20 | 按 Product Backlog 格式落地：补标准头、新增「鉴权」节、把需求细节移入 Backlog 表（26 条 × 9 列） |
| 2026-09-20 | 处理 `[ToDo1–4]`：补容量/配额/限流的评估结论（大部分可由上游 `[limits]` 实现）、「其他」逐项拆分、引用 [`mcp_tool_inventory.md`](./mcp_tool_inventory.md)、Backlog 与需求同步 |
| 2026-09-20 | `sprint_plan.md` 重排为 6 个 Sprint：Backlog 表 `Sprint` 列由 `TBD` 回填为 `Sprint 1..6`（`描述` / `验收条件` / `状态` **未改动**）；跨文档引用改为按**条目名**指向（避免重排后失效）；新增「排期」说明 —— 本表 `Sprint` 列是 `sprint_plan.md` 排期的**投影** |
| 2026-09-21 | **第一部分每项需求追加回溯引用**：`→ [Backlog #N 名称](#product-backlog)` —— 需求节 27 项 + 产品概述层（需求边界 / 用户模型 / 鉴权）17 项 = **44 处**；鉴权表 4 行的链接落在**末列单元格内**（不破坏表格）；新增「回溯引用」约定说明：以**条目名为主、编号为辅**（编号会随重排失效），表格行无锚点故链接只到 `#product-backlog` 节 |
| 2026-09-21 | **需求覆盖审计（第一部分 → 第二部分）**。① `# 需求` 节 26 条与 Backlog #1–#26 **逐条对应、无遗漏**（含「升级准入判据 + 自动化提醒（邮件）」→ #21）；② 「产品概述」层（**需求边界 / 用户模型 / 鉴权**）中带验收条件却**原先无对应条目**的 5 项补入：#27 管理员建用户（邀请制，无自助注册）· #28 一用户多 key 共享同一份记忆 · #29 用户规模上限（待定 → 定值）· #30 上游 HTTP 面（9077）不对外 · #31 定制口径门禁（不改上游源码 + 例外登记）；③ 新增「**覆盖要求**」规则（第一部分每条需求必须在第二部分有落点，含概述层）。**#1–#26 的 `描述` / `验收条件` / `状态` / `Sprint` 一律未改动**（保持 `sprint_plan.md` 内 `product-backlog.md` #N 引用兼容） |
| 2026-09-21 | **#10「记忆内容的多语言支持」由「待探针确认」改写为结论（部分支持）并标 Done**：需求层同步句与本行描述 / 验收条件 / 关联 / 状态改写。**授权来源**：本行验收条件原文「给出明确结论（支持 / 不支持 / 部分支持）并回写本行描述」—— 即本文件此前「零改动」约定的显式例外；其余条目未动。证据：探针 [`../scripts/i18n-probe.sh`](../scripts/i18n-probe.sh)（Sprint 2 #8，2026-09-21 三次运行全绿，含 STRICT 边界断言） |
