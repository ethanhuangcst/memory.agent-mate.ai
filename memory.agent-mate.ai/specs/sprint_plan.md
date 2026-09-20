# sprint_plan — memory.agent-mate.ai 产品化

> **用途**：本仓的短周期执行清单 —— 做什么、卡在哪、验收是什么。
> **排期与状态的唯一真相源**：本文件。`product-backlog.md` 的 `Sprint` 列是本文件排期的**投影**（只回填编号，不改该表的 `描述` / `验收条件` / `状态` 语义）。
> **真相源**：`deployment_strategy.md`（决议）· `dev-plan.md`（部署与升级计划）· [`../upstream.lock`](../upstream.lock)（版本坐标）
> **编号口径**：文中 `#N` 指**所在 Sprint** 的条目编号（例：「Sprint 2 #1」= Sprint 2 的第 1 条）。**引用其它文档的条目时优先写条目名，不要写编号** —— 编号会随重排失效。
> **as_of**：2026-09-20

---

## 阻断级风险（门户上线前必须关闭）

> 本节是**独立风险登记**，不属于任何 Sprint —— 风险不随 Sprint 结束而消失。详细设计见 [`admin_portal_design.md`](./admin_portal_design.md) §9 与 §4.3。

| # | 风险 | 机制（已核实的源码依据） | 影响 | 级别 |
| --- | --- | --- | --- | --- |
| **R1** | **多用户隔离可能静默失效 —— 所有用户共用同一个库文件** | 库路径解析存在**优先级陷阱**：`AppConfig::effective_db()` 只在「CLI/env 的库路径**恰为默认值** `ai-memory.db`」时才**改用 config 的 `db`**（`src/config.rs:7506-7516`；默认值 `src/daemon_runtime.rs:88`）。而本部署的 `config.toml` 写死 `db = "/data/ai-memory.db"`（`deploy/config.toml.tmpl:13`）。⇒ 任何一条会话**漏设或写错** `AI_MEMORY_DB`，它就会落到**共享的主库**上 | 隔离**读写双向**彻底失效 —— 用户看到并写入的是**别人的记忆**；且 `daemon_runtime.rs:980` 是全子命令唯一解析点，**无报错、无告警、无日志** | 🔴 **严重** |
| **R2** | **隔离完全依赖门户一处正确性，无纵深** | 上游不提供任何多租户授权边界：**写路径无可见性过滤**（`store`/`atomise`/`promote` 命中 0）；macaroon 能力令牌 **additive-only**（只放宽、不收紧） | 门户任一缺陷（跨用户复用子进程、会话池化、缓存命错用户）即造成串号，同样无感知 | 🟠 高 |
| **R3** | **SSH 手工 forced command 的同类风险** | `authorized_keys` 里每用户是一条**很长的单行命令**（含 `-e AI_MEMORY_DB=…`，手工拼写）；比门户的配置模板更易写漏（`multiuser_isolation.md` §5.2） | 与 R1 同源同后果；且长单行**难以审计**（逐行生效，权限错一次会连带废掉整文件所有密钥） | 🟠 高 |

**为什么定级「严重」**：多数故障会报错、能被发现；R1 **不会** —— 它表现为「功能正常」，只是所有用户共享同一份记忆。等到有人发现「我读到了别人的记忆」时，数据已经串了很久。

### 必须落地的防线

| # | 防线 | 说明 | 状态 |
| --- | --- | --- | --- |
| **D1** | **fail-closed 不变量** | 门户 spawn 前断言 `AI_MEMORY_DB` 非空 + 以 `/data/users/` 开头 + 含该 `handle`；不满足则**拒绝启动会话** | 设计已定（`admin_portal_design.md` §4.3），未落地 |
| **D2** | **移除 `config.toml.tmpl` 的 `db` 键** | 直接**消除 R1 的落点**：该键一旦不存在，「默认值 → config」这条路径就无路可走，漏设 env 只会退化为相对路径 → **报错（fail-loud）**，而不是静默共用主库。已核实本部署**所有**调用点都显式传库路径（compose 的 `AI_MEMORY_DB`、forced command 的 `-e`、cron 的 `--db`、门户模板），该键冗余 | ☐ **未落地**（Sprint 3「多用户数据隔离实施」） |
| **D3** | **一会话一子进程，禁止跨用户复用/池化** | 消除 R2 的主要触发面 | ☐ 未落地（Sprint 3 实施、Sprint 4 会话桥固化） |
| **D4** | **会话审计含解析出的库路径** | 事后可对账「这次会话落在哪个库」 | ☐ 未落地（Sprint 3 实施、Sprint 4 审计视图） |
| **D5** | **上线前负向验收** | 未通过 V1（负向）就不算通过 | ☐ 未落地（见 **Sprint 3「多用户隔离端到端验证」**；不过则阻断 Sprint 5 上线） |

### 验证方法（可执行）

| # | 验证 | 判定 |
| --- | --- | --- |
| **V1** | **负向**：故意注入「漏设 `AI_MEMORY_DB`」的模板启动会话 | 会话**必须失败**；**不得**落到 `/data/ai-memory.db`（验证 D1 + D2 生效） |
| **V2** | 正向：会话结束后比对文件时间戳 | `/data/users/<u>/ai-memory.db` 的 mtime **变化**，且共享主库 `/data/ai-memory.db` **未变化** |
| **V3** | 交叉：A 的 key 写入后，用 B 的 key 检索 | B **命中不到**；B 显式 `memory_get <A 的记忆 id>` **不可见** |
| **V4** | 解析链自检：用**与模板完全相同的 env/argv** 跑 `ai-memory doctor --json` | 其 `source` 字段（= 实际解析出的库路径，`src/cli/doctor.rs:117-119`、`:591`）**等于**该用户库路径 |

---

## Sprint 1

Sprint Goal: 制定产品化计划

**状态：✅ 已结束**（全部条目完成）

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 版本契约层（单一真相源 + 耦合面清单 + 预检脚本 + 跟踪 Action + 2 份 ADR） | 任务 | 治理 | `upstream.lock` 为唯一版本坐标；8 类契约点带源码依据；`make preflight-test` 离线自测全绿；每日跟踪 Action 落地；决策有 ADR | [`../upstream.lock`](../upstream.lock) · [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) · [`../scripts/upstream-preflight.sh`](../scripts/upstream-preflight.sh) · `.github/workflows/upstream-track.yml` · `adr/` | ✅已完成 |
| 2 | 制品改钉 `0.9.0` → `0.10.0` | 任务 | 部署 | 4 处坐标同步且全仓无残留矛盾（`deploy/.env.prod.example`、`deployment_strategy.md` §0、`deploy/deployment-plan.md`、`dev-plan.md`）；理由留痕（0.9.0 的 attestation 缺陷） | [`../upstream.lock`](../upstream.lock) · `deployment_strategy.md` §0 | ✅已完成 |
| 3 | 升级治理方案（准入判据 + 回滚语义） | 任务 | 治理 | `dev-plan.md` §5 七步链路；判据分层 H1–H5 硬阻断 / W1–W6 人工确认；回滚强制快照覆盖（因上游不拒绝更新的库） | `dev-plan.md` §5 · `adr/ADR-005-upgrade-admission-gate-layering.md` | ✅已完成 |
| 4 | 上游事实与坑知识沉淀 | 研究 | 治理 | 三条实测结论（历史被重写 / schema 阶梯 78→80→81 / 回滚静默危险）与上游文档缺陷清单落盘 | `knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md` | ✅已完成 |
| 5 | 多用户隔离方案 | 研究 | MCP | 四档方案对比（含 11 条源码依据）；单账号 N 密钥澄清；5 个坑；档位定为「一用户一 DB」 | [`multiuser_isolation.md`](./multiuser_isolation.md) | ✅已完成 |
| 6 | admin portal 设计方案 | 任务 | Web App | 两 stack 职责与数据流、密钥模型、CF Access 边界、耦合面 C1–C8、静默失败点 S4、威胁模型 T1–T10 全部成文 | [`admin_portal_design.md`](./admin_portal_design.md) | ✅已完成 |
| 7 | 完善并评审 `product-backlog.md` | 任务 | 产品 | 占位符全部填实；评审改进点逐条确认；**已定稿**（三层结构 + 26 条 Backlog + 工具清单 [`mcp_tool_inventory.md`](./mcp_tool_inventory.md)） | [`product-backlog.md`](./product-backlog.md) | ✅已完成 |

---

## Sprint 2

Sprint Goal: 本地启动 + 探针明确方案

### ToDo

> **执行顺序**：按本表**编号顺序**执行 —— 先做仓库治理与环境配置（#1–#3），再做本地启动（#4），随后逐项收敛方案（#5–#11）。

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **仓库 IP 脱敏 + 防复发护栏**（保持公开仓） | 任务 | 安全 | 4 个真实公网 IP 从文档迁出到 gitignored 的 `memory.agent-mate.ai/secrets.local.hk_vps_4.md`，文档改用具名占位符（`<VPS4_IP>` / `<VPS3_IP>` / `<PG_HOST>` / `<MYSQL_HOST>`）；`secret-check.sh` + pre-commit 钩子（`make hooks-install`）就位，`make secret-check` 可跑且干净仓零命中 | [`asset_isolation_plan.md`](./asset_isolation_plan.md) §10 · [`../scripts/secret-check.sh`](../scripts/secret-check.sh) | ✅已完成 |
| 2 | qwen API key —— **用户已备好** | 阻塞 | 配置 | `.env` 中 `DASHSCOPE_API_KEY` 非空且可调通 | [`../deploy/.env.prod.example`](../deploy/.env.prod.example) · [`../deploy/.env.local`](../deploy/.env.local)（本地，gitignored） | ✅已完成（2026-09-20：secrets 的 `QWEN_API_KEY` 已回填本地 `.env.local`；`scripts/qwen-verify.sh` 与 `ai-memory doctor` 均实测调通） |
| 3 | qwen embedding 的 **model + dim**（**针对本地部署**写入环境配置；并在**部署文档**中说明未来生产环境的配置） | 阻塞 | 配置 | ① 本地环境配置的 `[embeddings]` 填真实值（**不可留 `dim = 0`**）并本地调通 —— `ai-memory doctor` 的 Embeddings Reachability 显示 `qwen:<model>` 且维度一致 ② **部署文档已说明未来生产环境**（服务器 `/opt/ai-memory-mcp`）的对应配置与差异 | [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`../deploy/config.local.toml`](../deploy/config.local.toml)（本地，gitignored）· [`../deploy/README.md`](../deploy/README.md) · [`../deploy/deployment-plan.md`](../deploy/deployment-plan.md) · [`../scripts/qwen-verify.sh`](../scripts/qwen-verify.sh) · [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) F1–F3 | ✅已完成（2026-09-20：`qwen3.7-text-embedding` / `dim = 1024`；doctor 显示 1024-dim，写入 + 召回 + curator `auto_tagged = 1` 端到端通过；生产侧 `config.toml.tmpl` 同结构，端点用 `<QWEN_BASE_URL>` 占位符） |
| 4 | **本地启动 ai-memory-mcp（按默认配置）** | 任务 | 开发环境 | 本机按默认配置启动成功，并通过 MCP 完成一次写入 + 召回，作为后续方案对照的基线 | `product-backlog.md` #1 · `dev-plan.md` §3 | ✅已完成（2026-09-20：`local-up.sh` 以生产同款 compose 常驻启动 serve+curator；`mcp-smoke.sh` 断言握手 / core 档 8 工具 / 写入 / 跨进程**语义召回** + 关键词检索，×2 运行幂等通过；三静默失败点均有行为级反证） |
| 5 | **给出「多用户隔离是否可实现」的明确结论** | 研究 | 功能 | 结论落盘（可实现 / 不可实现 / 有条件可实现），并指明所依赖的防线（D1–D5）与验证项（V1–V4）、以及未决前提 | [`multiuser_isolation.md`](./multiuser_isolation.md) · 本文件「阻断级风险」 | ✅已完成（2026-09-20：**结论 = 有条件可实现**——"机制可行"由探针 A/B/C 组实测闭环（探针脚本 [`../scripts/iso-probe.sh`](../scripts/iso-probe.sh) 退出码 0）；"可信"依赖 **D1+D2 硬前提**，因 R1 已获**行为级证据**（漏设 `AI_MEMORY_DB` → `rc=0` 且静默落 `/data/ai-memory.db`；对照：错设到不可打开路径 → `overall=critical`、rc=2 fail-loud）。冻结机制（`/data/users/<handle>/` + `keys/` + 三件套 env + forced command 模板 + 每库维护）、D1–D5 条件矩阵、V1–V4 映射（V1 预实证"当前会静默成功"、V2/V3/V4 本地版通过）与 6 项未决前提全部落盘 [`multiuser_isolation.md`](./multiuser_isolation.md) §0） |
| 6 | **D1 确认**：门户启动机制 **β′**（镜像内带二进制 + 子进程）vs **α**（`docker exec` + docker socket） | 任务 | Web App | 决议写入 `deployment_strategy.md` §0；若选 α 须书面接受「公网门户持 root 等价权限」并补 socket 加固 | [`admin_portal_design.md`](./admin_portal_design.md) §4 与附录 A | ⏸待决策 |
| 7 | **`tmp_user_key_option1.md` 处置**（移入 `specs/` 或加 `.gitignore`） | 任务 | 安全 | 仓根目录不再有未跟踪的留档文件 | [`asset_isolation_plan.md`](./asset_isolation_plan.md) §10 | ✅已完成（2026-09-20：三选一由用户拍板为**直接删除**，文件已从仓根移除；内容不含真实密钥，无需留档） |
| 8 | **探针：上游保存 memory 时是否支持多语言** | 研究 | MCP | 给出明确结论（是否支持多语言存储 / 检索、有无相关配置项、有无已知限制）；结论回写 `product-backlog.md` 的「记忆内容的多语言支持」条目 | `product-backlog.md` #10 · 上游源码 | ☐未开始 |
| 9 | **`--profile` 定档**：对外暴露哪一档；SSH / 门户模板是否补写 `--profile` | 研究 | MCP | 实测 `v0.10.0` 各档工具数（本地 clone 实测：core 7 / graph 19 / admin 21 / power 56 / **full 101**；`memory_capabilities` 所有档位 always-on，故实际注册数 +1）；决议写入门户模板、SSH 模板与公开文档 | [`mcp_tool_inventory.md`](./mcp_tool_inventory.md) §5 · `product-backlog.md` #12 | ⏸待决策 |
| 10 | **MCP 对外能力清单定稿**（档位 / i18n 范围 / LLM 与备份选择的最终决议） | 任务 | MCP | 清单定稿并落入公开文档；档位与 **#9** 的决议一致 | [`mcp_tool_inventory.md`](./mcp_tool_inventory.md) · `product-backlog.md` #19 | ☐未开始 |
| 11 | **更新 `memory.agent-mate.ai/specs/` 相关技术方案（明确方案部分）** | 任务 | 文档 | 受本次重排影响的技术 spec 全部同步（编号引用去耦合、排期指向正确）；各文件追加变更记录 | `memory.agent-mate.ai/specs/` 全目录 | ☐未开始 |
| 12 | **目录改名收口 + specs 整合**（`hk_vps_4/` → `memory.agent-mate.ai/`；16 份 spec 合并为 8 份） | 任务 | 文档 | ① git 以 rename（R100）记录且全仓路径引用同步（Makefile / `.gitignore` / CI / 脚本 / specs / adr / knowledge）；② 含密与派生文件仍被忽略（`git check-ignore` 逐条断言 + `make secret-check` 干净）；③ `make doc-links` / `make preflight-test` / `iso-probe.sh` 全绿；④ specs 唯一真源 = `memory.agent-mate.ai/specs/`（产品级 2 + `mcp/` 2 + `web-portal/` 3） | [`architecture.md`](./architecture.md) · [`deployment.md`](./deployment.md) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) · [`web-portal/web-design.md`](./web-portal/web-design.md) · [`../scripts/link-check.sh`](../scripts/link-check.sh) | ✅已完成（2026-09-20：41 个 R100 rename；新增 `make doc-links` 防「删文档留悬空引用」复发） |

> **执行本 Sprint 时须核对的静默失败点**：`dev-plan.md` §3.4 的三个（embedder 降级、curator fail-open `tagged=0`、config 挂载路径错误导致 tier 退回 semantic）+ 本文件「**阻断级风险**」的 **R1**（会话漏设/写错 `AI_MEMORY_DB` → 所有用户静默共用同一库）。**R1 是其中唯一不报错、且后果是数据串号的一项。**

---

## Sprint 3

Sprint Goal: MCP 本地实现并验证

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 定制 — **LLM 选择**落地 | 配置 | 配置 | `tier = "smart"`、`[llm]` qwen/qwen-plus、`[llm.auto_tag]` 只写 model；`ai-memory doctor` 通过；Embeddings Reachability 显示 `qwen:qwen3.7-text-embedding` 且维度为 **1024**；端点为私有 MaaS（`base_url` 显式覆盖，公开仓写 `<QWEN_BASE_URL>`） | `product-backlog.md` #8 · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`../scripts/qwen-verify.sh`](../scripts/qwen-verify.sh) | ☐未开始（模型与维度已定并本地验证，待生产侧落地复核） |
| 2 | 定制 — **工具档位**落地 | 配置 | MCP | 按 Sprint 2 的定档决议，把 `--profile` 写入门户模板与 SSH 模板；用 `initialize` 回包核对实际暴露的工具数与清单一致 | `product-backlog.md` #12 · [`mcp_tool_inventory.md`](./mcp_tool_inventory.md) | ☐未开始 |
| 3 | 定制 — **可用性前提（agent attestation）** | 配置 | 配置 | `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 落到**所有** spawn 路径（门户模板 / forced command / compose / cron）；漏设时显式报错而非静默失败 | `product-backlog.md` #15 · [`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) | ☐未开始 |
| 4 | 定制 — **审计与限流（上游 `[limits]`）** | 配置 | 配置 | `[limits]` 段落地（`max_memories_per_day` / `max_storage_bytes` / `max_links_per_day` / `max_page_size` / `max_inflight_requests` 等）；改配置后超限写入被拒且报错可读；`memory_quota_status` 可读到配额与用量；**实测给出 `max_inflight_requests` 对 stdio 会话是否生效的结论** | `product-backlog.md` #17 · `src/config.rs:3703-3760` | ☐未开始 |
| 5 | 定制 — **多用户数据隔离实施**（防线 D1–D5；含**移除 `config.toml.tmpl` 的 `db` 键**） | 安全 | 安全 | ① 移除 `db` 键并注明理由（D2；须实测确认移除后 `serve`/`curator`/forced command 均不受影响）② fail-closed 断言落地（D1）③ 一会话一子进程、禁池化（D3）④ 审计含库路径（D4）⑤ `admin_portal_design.md` §9 的 S4 由「静默失败点」升级为**阻断级风险**；`multiuser_isolation.md` §6 增加**坑 #6**「漏设 `AI_MEMORY_DB` → 静默共用主库」 | `product-backlog.md` #11 · 本文件「阻断级风险」· [`multiuser_isolation.md`](./multiuser_isolation.md) §6 | ☐未开始 |
| 6 | **多用户隔离端到端验证（含负向）** | 任务 | 安全 | **V1 负向**：漏设 `AI_MEMORY_DB` 的会话**必须失败**（不得落到 `/data/ai-memory.db`）；**V2 正向**：目标库 mtime 变化且共享主库未变化；**V3 交叉**：A/B 互不可见；**V4 自检**：相同 env/argv 跑 `doctor --json`，断言 `source` == 目标库路径。**任一不过 → 阻断后续上线** | 本文件「阻断级风险」V1–V4 · [`multiuser_isolation.md`](./multiuser_isolation.md) §7 | ☐未开始 |
| 7 | 定制 — **每用户库的后台维护** | 部署 | 部署 | 定调「门户调度 or 主机 cron」并对每库执行 `gc` / `curator --once`；**实测核实** `gc` 是否覆盖每库的 TTL 遗忘与 WAL checkpoint（原方案标为待核实，不得照抄假定） | `product-backlog.md` #13 · [`multiuser_isolation.md`](./multiuser_isolation.md) §5.3 | ☐未开始 |
| 8 | **写路径泄露探针**（去重/合成是否回显他人私有内容） | 研究 | 安全 | 给出明确结论「会」或「不会」；若会则方案 ② 在多用户场景禁用 | [`multiuser_isolation.md`](./multiuser_isolation.md) §8 #1 | ☐未开始 |
| 9 | **同步既有文档 9 处矛盾** | 任务 | 文档 | [`admin_portal_design.md`](./admin_portal_design.md) §12 的 9 项全部修订；重点三条不再自相矛盾：`multiuser_isolation.md` §8 #2（「本仓不承载门户」）、`deployment_strategy.md` §0（「无公网入口」）、`asset_isolation_plan.md` §2（自有资产根只有 1 个） | [`admin_portal_design.md`](./admin_portal_design.md) §12 | ☐未开始 |
| 10 | **本地验证结论回写 `memory.agent-mate.ai/specs/` 技术方案** | 任务 | 文档 | 本 Sprint 的实测结论（`[limits]` 对 stdio 是否生效、`gc` 覆盖范围、写路径泄露结论、隔离验证结果、档位实际暴露数）全部回写到对应 spec；各文件追加变更记录 | `memory.agent-mate.ai/specs/` 全目录 | ☐未开始 |

> **执行本 Sprint 时须核对的静默失败点**：`dev-plan.md` §3.4 的三个 + 本文件「**阻断级风险**」的 **R1**。凡涉及「会话落库路径」的验证，一律以 **V1（负向）** 为准入门槛。

---

## Sprint 4

Sprint Goal: 门户开发并与 MCP 集成

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | admin portal — **登录与访问控制** | 功能 | Web App | 仅持有效 Cloudflare Access 身份者可访问管理域名；在 MCP 域名上请求管理 API 被**拒绝** | `product-backlog.md` #2 · [`admin_portal_design.md`](./admin_portal_design.md) §7 | ☐未开始 |
| 2 | admin portal — **key 生命周期** | 功能 | Web App | 签发 / 列出元信息 / 修改 / 轮换 / 删除五个操作均可用；明文仅在创建响应中出现一次；吊销后新建会话被拒、既有会话被终止 | `product-backlog.md` #3 · [`admin_portal_design.md`](./admin_portal_design.md) §5.1 | ☐未开始 |
| 3 | admin portal — **记忆身份与数据隔离（门户侧）** | 功能 | Web App | 每用户独立身份与独立库，建用户即就绪；跨用户检索命中不到；库文件属主为 `aimem` | `product-backlog.md` #4 · [`admin_portal_design.md`](./admin_portal_design.md) §5.2 | ☐未开始 |
| 4 | admin portal — **审计视图** | 功能 | Web App | 建用户 / 签发 / 轮换 / 吊销 / 每次会话开始（含解析出的库路径）均可查询；日志中不出现令牌明文 | `product-backlog.md` #5 · [`admin_portal_design.md`](./admin_portal_design.md) §6 | ☐未开始 |
| 5 | admin portal — **容量、配额与限流（门户侧）** | 功能 | Web App | 上游已支持项（配额 / 页大小）以配置纳管而非自建；门户自建的**会话级**并发上限、空闲超时、单会话最长时长在超限时**明确拒绝**；FS 级磁盘配额方案定稿 | `product-backlog.md` #6 · `src/config.rs:3703-3760` | ☐未开始 |
| 6 | **Integration Instructions 页面** | 功能 | Web App | 新用户按页面指引 ≤ 3 步完成客户端接入并成功调用一次工具；至少支持中 / 英双语切换 | `product-backlog.md` #7 · [`admin_portal_design.md`](./admin_portal_design.md) §3.1 | ☐未开始 |
| 7 | **门户 ↔ MCP 会话桥**（HTTP MCP ↔ 子进程 stdio） | 功能 | Web App | 客户端以 `memo_` 令牌经 `<MCP_HOST>/mcp` 建立会话并完成一次写入 + 召回；**一会话一子进程、禁止跨用户复用/池化**（D3）；会话结束子进程被回收 | `product-backlog.md` #14 · [`admin_portal_design.md`](./admin_portal_design.md) §3.2 / §4.3 | ☐未开始 |
| 8 | 定制 — **公网入口与认证边界**落地 | 功能 | 部署 | 两个域名分流正确（管理面 CF Access / MCP 面令牌）；跨面调用被拒；新增公网入口的决议已同步到 `deployment_strategy.md` §0 | `product-backlog.md` #16 · [`admin_portal_design.md`](./admin_portal_design.md) §7 / §12 | ☐未开始 |
| 9 | 定制 — **升级治理：门户镜像随上游重建** | 功能 | 治理 | 门户镜像的构建从 [`../upstream.lock`](../upstream.lock) 注入 tag；升级清单含「重建门户镜像」一步并被演练过，避免门户与部署制品版本漂移 | `product-backlog.md` #18 · [`admin_portal_design.md`](./admin_portal_design.md) §4.2 | ☐未开始 |

---

## Sprint 5

Sprint Goal: 生产上线与备份闭环

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | SSH 密钥对（调用者 ↔ 野草云4） | 阻塞 | 安全 | 无 passphrase + forced command；`ssh ai-memory` 可完成 MCP 握手 | [`multiuser_isolation.md`](./multiuser_isolation.md) §5 | ⛔待生成 |
| 2 | OSS 私有桶（香港 region + SSE）+ RAM 子账号 AK | 阻塞 | 安全 | 桶为私有 + SSE 已开；AK 仅存服务器侧，不入仓 | [`dev-plan.md`](./dev-plan.md) §4（备份方案）· 云资源准备清单见 [`../deploy/README.md`](../deploy/README.md)（原需求规格 `mcp_oss_bak_com_requirements.md` 已移出本仓） | ⛔待提供 |
| 3 | **编写 `memory.agent-mate.ai/backup/` 备份脚本** | 任务 | 部署 | `backup-and-push.sh`（快照 → sha256 → ossutil 上传 → **回读比对** → 失败非零退出）与 `restore-drill.sh`（拉最新 → 校验 → restore → `doctor` 通过）可重复执行；`make backup` / `make restore-drill` 可用；**遍历 `/data/users/*`** | `product-backlog.md` #9 · `dev-plan.md` §4.3 | ☐未开始 |
| 4 | **部署执行（ai-memory）** | 任务 | 部署 | `dev-plan.md` §3.2 八步落地 + §3.3 冒烟全绿 | `dev-plan.md` §3 · [`../deploy/README.md`](../deploy/README.md) | ☐未开始 |
| 5 | **admin portal 部署 + 多用户隔离落地** | 功能 | 部署 | 走通「签发 key → 建立会话 → 隔离生效」；通过 [`multiuser_isolation.md`](./multiuser_isolation.md) §7 与 [`admin_portal_design.md`](./admin_portal_design.md) §13；**且必须先通过 Sprint 3 的隔离端到端验证（含负向 V1）** | `product-backlog.md` #4 / #26 · 本文件 Sprint 3 #6 | ☐未开始 |
| 6 | 定制 — **接入面**落地（HTTP MCP + SSH stdio） | 功能 | 部署 | 两条路径都能完成 MCP 握手并成功读写；**停掉门户后 SSH 路径仍可用**（降级不失效） | `product-backlog.md` #14 · [`admin_portal_design.md`](./admin_portal_design.md) §3.1 | ☐未开始 |
| 7 | 定制 — **备份与恢复**落地（含门户自身库）+ 首次外迁 + 恢复演练 | 功能 | 部署 | 每用户库逐一快照 + manifest；**门户自身库**（与用户记忆库分离存放）纳入同一外迁流程；按 RPO ≤ 24h / RTO ≤ 2h / 日备 30 代 + 月备 12 代 落地；恢复演练可重复执行且通过 | `product-backlog.md` #9 · [`multiuser_isolation.md`](./multiuser_isolation.md) §5.4 | ☐未开始 |
| 8 | **上线验收** | 任务 | 部署 | 三份验收清单全部通过：`dev-plan.md` §3.3 冒烟 + [`multiuser_isolation.md`](./multiuser_isolation.md) §7 + [`admin_portal_design.md`](./admin_portal_design.md) §13 | `product-backlog.md` #26 | ☐未开始 |

> **执行本 Sprint 时须核对的静默失败点**：`dev-plan.md` §3.4 的三个（embedder 降级、curator fail-open `tagged=0`、config 挂载路径错误导致 tier 退回 semantic）+ 本文件「**阻断级风险**」的 **R1**。**上线前 D5 必须关闭**：Sprint 3 的负向验证未通过则不得上线。

---

## Sprint 6

Sprint Goal: 升级治理闭环

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 上游升级**邮件**提醒 | 功能 | 治理 | 检测到「适合升级」的上游版本时发出邮件（现状只有 GitHub issue，不满足需求） | `product-backlog.md` #21 · `dev-plan.md` §5.1 | ☐未开始 |
| 2 | **历次版本升级跟踪与记录**（过程资产） | 功能 | 治理 | 每次升级留痕：版本 / 日期 / 判据结论 / 详细步骤 / 验证结果 / 回滚点 | `product-backlog.md` #22 · `dev-plan.md` §5 | ☐未开始 |
| 3 | **最低耦合、尽量自动化的升级方案** | 功能 | 治理 | 一次升级可在「改 [`../upstream.lock`](../upstream.lock) → 跑预检 → 重建/重启」内完成，无需手工比对版本号；门户镜像重建纳入同一条链路 | `product-backlog.md` #23 · `adr/ADR-004-version-contract-single-source-of-truth.md` | ☐未开始 |
| 4 | **制定部署/升级方案与脚本** | 任务 | 治理 | 相关脚本落地且可重复执行 | `product-backlog.md` #24 · `dev-plan.md` §5 | ☐未开始 |
| 5 | **升级方案端到端验证并文档化** | 任务 | 治理 | 完整演练一次升级（预检 → 部署 → 验收 → **回滚演练**）并留痕。**注意**：回滚**必须**用快照覆盖 —— 上游不拒绝「比自身更新的库」（旧二进制会静默读写不认识的 schema） | `product-backlog.md` #25 · `knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md` | ☐未开始 |

---

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-20 | 初版：登记 4 项 ToDo 与 4 项待提供输入 |
| 2026-09-20 | 新增 ToDo（写路径泄露探针、多用户隔离落地，档位定为一用户一 DB）；同步 `multiuser_isolation.md` |
| 2026-09-20 | 改写为 Sprint 结构：按「Sprint Goal + 类别/模块/验收条件/状态」重排；「待提供输入」4 项合并为阻塞条目；已完成工作并入 Sprint 1；新增 3 项待决策（D1、`--profile` 定档、临时文件处置）与文档一致性修订项 —— **注：此行为重排前的结构，Sprint 编号与归属已变** |
| 2026-09-20 | 新增「多语言探针」（源自 `product-backlog.md` i18n 评审）与「本仓转私有」；「仓库真实 IP 脱敏」标注优先级变化（**重排前编号**：Sprint 1 #14 / #15、Sprint 2 #1） |
| 2026-09-20 | 新增「**阻断级风险**」独立登记节：R1（漏设/写错 `AI_MEMORY_DB` → 所有用户静默共用同一库，含 `effective_db()` 优先级陷阱的源码依据）、R2（隔离无纵深）、R3（SSH forced command 同类风险）；补防线 D1–D5 与验证方法 V1–V4；新增「固化失败模式与防线」（含移除 `config.toml.tmpl` 的 `db` 键）与「多用户隔离端到端验证（含负向，不过即阻断后续上线）」两项；「admin portal 部署 + 多用户隔离落地」增加前置依赖（**重排前编号**：Sprint 1 #16、Sprint 2 #14、Sprint 2 #10） |
| 2026-09-20 | **重排为 6 个 Sprint**：Sprint 1 定稿为已完成（Goal 改为「制定产品化计划」，7 项全标完成）；Sprint 2「本地启动 + 探针明确方案」与 Sprint 3「MCP 本地实现并验证」承接原 Sprint 1 的 #8–#16 与隔离验证、技术方案更新；Sprint 4「门户开发并与 MCP 集成」、Sprint 5「生产上线与备份闭环」、Sprint 6「升级治理闭环」承接 `product-backlog.md` 的 26 条待办。新增**编号口径**说明（`#N` = 所在 Sprint 的条目编号）；跨文档 Sprint 编号引用改为按条目名称指向，避免重排后失效 |
| 2026-09-20 | **Sprint 2 顺序调整并重编号（1–11）**：私有化 → DashScope key → embedding model+dim → 本地启动 → 隔离可行性结论 → D1 确认 → 临时文件处置 → 多语言探针 → `--profile` 定档 → 对外能力清单定稿 → 技术方案更新。其中 **#3 补充约束**：embedding 配置**针对本地部署写入环境配置**，并在**部署文档中说明未来生产环境的配置**。移除原「本地启动 = 本 Sprint 首先做」标注，改为表头声明「按编号顺序执行」 |
| 2026-09-20 | **决议反转：取消「本仓转私有」，保持公开仓**。Sprint 2 #1 由「把本仓改为私有」改写为「仓库 IP 脱敏 + 防复发护栏」（真实值迁入 gitignored 的 `memory.agent-mate.ai/secrets.local.hk_vps_4.md`，文档用具名占位符 `<VPS4_IP>` / `<VPS3_IP>` / `<PG_HOST>` / `<MYSQL_HOST>`）；Sprint 5 #8「仓库真实 IP 脱敏」删除（已前移并入 Sprint 2 #1 并标记完成），原 #9「上线验收」重编号为 #8；Sprint 5 现 #1–#8。理由：野草云4 IP 已由公开 DNS 解析，重写历史零收益且需 force push |
| 2026-09-20 | **Sprint 2 #2 / #3 完成（qwen 模型确定并实测可用）**：#2 key 已回填本地 `.env.local`（gitignored）并调通；#3 嵌入模型定为 `qwen3.7-text-embedding` / `dim = 1024`，由新增的 [`../scripts/qwen-verify.sh`](../scripts/qwen-verify.sh) 在私有 MaaS 端点实测取得（`/models` 探测 + 真实 embeddings 调用取向量长度），本地 `config.local.toml` 与生产 `config.toml.tmpl` 同步。端到端证据：doctor 显示 1024-dim、写入 + 召回成功、curator `auto_tagged = 1`。连带订正：`[llm.auto_tag]` 由「不声明该段」改为「只写 model」（与 §0 决议一致且已实测）；`secret-check.sh` 扩为同时拦截 `*.maas.aliyuncs.com`；新增占位符 `<QWEN_BASE_URL>`（`deployment_strategy.md` / `asset_isolation_plan.md` / `product-backlog.md` / `upstream_coupling_surface.md` 同步） |
| 2026-09-20 | **Sprint 2 #7 完成**：`tmp_user_key_option1.md` 经用户拍板**直接删除**（备选的归档 / gitignore 均不采用）；仓根不再有未跟踪的留档文件 |
| 2026-09-20 | **Sprint 2 #4 完成（本地启动 + MCP 通路基线）**：新增 [`local-up.sh`](../scripts/local-up.sh)（本机以生产同一份 compose 常驻启动 serve+curator；就绪探测走监听日志——**镜像内无 curl/wget**，README 冒烟节的 curl 健康检查系文档 bug，已订正为 doctor）与 [`mcp-smoke.sh`](../scripts/mcp-smoke.sh)（`docker exec -i` 与生产 forced command 逐字同构；断言 core 档 8 工具；跨进程语义召回 + 关键词检索双断言；含 near-duplicate CONFLICT 幂等分支——core 档无删除工具）。**实证修正**：`memory_recall` = 语义召回（required `context`）、`memory_search` = 关键词/全文检索（上游文档未区分，v0.10.0 实测）。三静默失败点行为级反证：语义召回命中（查询词不含标记字面量）/ curator `auto_tagged = 1` / boot 日志 `tier = smart` + `1024-dim`。连带：`.gitignore` 增补 `deploy/.env` 与 `deploy/config.toml`（local-up 派生文件，compose 固定引用该文件名） |
| 2026-09-20 | **`mcp_oss_bak_com_requirements.md` 从本仓移除（用户确认）**：该需求规格已随 mcp.oss-bak.com 项目移交移出本仓；同步清理引用 —— [`deployment_strategy.md`](./deployment_strategy.md)（决议表 §0 与 2 条变更记录）、[`dev-plan.md`](./dev-plan.md)（范围变更声明 + 变更记录）、[`asset_isolation_plan.md`](./asset_isolation_plan.md)（目录树 + 迁移清单）、[`deploy/README.md`](../deploy/README.md)、本文件 Sprint 5 #2 的「关联文档」列（改为指向 `dev-plan.md` §4 与 `deploy/README.md` 云资源清单）。历史记录保留原文并标注「已移出本仓」，不改写历史 |
| 2026-09-20 | **Sprint 2 #5 完成（多用户隔离可行性结论）**：结论 = **有条件可实现**，落盘 [`multiuser_isolation.md`](./multiuser_isolation.md) §0（冻结机制 / D1–D5 条件矩阵 / V1–V4 映射 / 6 项未决前提 / 探针证据）。新增探针 [`../scripts/iso-probe.sh`](../scripts/iso-probe.sh)（与 `mcp-smoke.sh` 同构；A 组负向解析链、B 组方案③双用户物理隔离、C 组方案②对照；退出码 10/20/30/40/50），首次运行全绿。**R1 由「源码推断」升级为「行为级已证」**：漏设 `AI_MEMORY_DB` 时 `doctor --json` 的 `source` 仍为 `/data/ai-memory.db` 且 **rc=0、无任何告警**；反之错设到父目录不存在的路径为 fail-loud（`Storage=critical / failed to open database`，rc=2）——即 **D2（移除 config 的 db 键）是唯一能覆盖"漏设"这一支的手段**。另实测：一用户一 DB 双向检索/get 互不可见且主库计数不变（V2/V3 本地版）、`doctor --json` 的 `source` 可作解析链自证（V4 本地版）、`ai-memory --db <user> stats` 维护通路可用；方案②写路径**可伪造**（bob 以 `agent_id=human:iso-alice` 写入成功并回显身份，alice 随后检索到被注入内容）→ 进一步支撑"必须③而非②"。连带：`multiuser_isolation.md` 升 v1.1（§5.2 冻结口径 / §5.3 维护通路已验 / §7 四项本地预实证 / §8 #1 部分实证） |
| 2026-09-20 | **目录改名收口 + specs 整合（对应 Sprint 2 #12）**：自有资产目录 `hk_vps_4/` → `memory.agent-mate.ai/`（41 个 rename；`.gitignore` 的含密/派生规则改为路径无关 `**/deploy/…`；Makefile / CI / 渲染脚本 / scripts / specs 引用全量同步）。specs 由 16 份合并为 8 份 —— `deployment_strategy` + `asset_isolation_plan` + `upstream_coupling_surface`（A–K 契约面）+ `dev-plan`（部分）→ [`architecture.md`](./architecture.md) / [`deployment.md`](./deployment.md)；`multiuser_isolation` + `mcp_tool_inventory` + 契约面全量 → [`mcp/mcp-design.md`](./mcp/mcp-design.md)；`mcp-test.md` → [`mcp/mcp-test.md`](./mcp/mcp-test.md)；`admin_portal_design` → [`web-portal/web-stories.md`](./web-portal/web-stories.md) / [`web-design.md`](./web-portal/web-design.md) / [`web-test.md`](./web-portal/web-test.md)；`deploy/deployment-plan.md` → `deployment.md`，`deploy/README.md` 降为 stub。新增防复发护栏 `make doc-links`（[`../scripts/link-check.sh`](../scripts/link-check.sh) + 允许清单）。**已知遗留**：本文件与 `product-backlog.md`（用户指定零改动）内部仍指向旧文件名，已在允许清单显式登记 |
