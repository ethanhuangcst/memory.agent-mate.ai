# sprint-backlog — memory.agent-mate.ai 产品化

> **用途**：本仓的短周期执行清单 —— 做什么、卡在哪、验收是什么。
> **排期与状态的唯一真相源**：本文件。`product-backlog.md` 的 `Sprint` 列是本文件排期的**投影**（只回填编号，不改该表的 `描述` / `验收条件` / `状态` 语义）。
> **真相源**：[`architecture.md`](./architecture.md) §2（决议单点）· [`deployment.md`](./deployment.md)（部署与升级计划）· [`../upstream.lock`](../upstream.lock)（版本坐标）
> **编号口径**：文中 `#N` 指**所在 Sprint** 的条目编号（例：「Sprint 2 #1」= Sprint 2 的第 1 条）。**引用其它文档的条目时优先写条目名，不要写编号** —— 编号会随重排失效。
> **体例**：RID Registry、Sprint Backlog 与 Product Backlog 的列定义、状态语义和引用边界见 [`sdd-scrum-practices.md`](./sdd-scrum-practices.md)。
> **as_of**：2026-09-23

---

## RID Registry（Risks / Impediments / Dependencies）

> 本节只登记风险、阻碍与依赖，不属于任何 Sprint，RID 不随 Sprint 结束而消失。详细机制见 [`architecture.md`](./architecture.md) §6、[`mcp/mcp-design.md`](./mcp/mcp-design.md) §6 与 [`web-portal/web-design.md`](./web-portal/web-design.md) §3。

| # | 级别 | 类型 | 标题 | 说明 | 影响 | 解决方案（→ product-backlog） | 关联文档 | 处理说明 | 状态 | 更新日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **R1** | **致命** | 风险 | 多用户隔离可能静默失效 | 库路径解析存在优先级陷阱；旧版配置曾把 `db` 写死为共享主库。模板已移除该键，但有效的错误库路径仍须在 spawn 前拦截。 | 隔离可能读写双向失效，且发现时数据已经串号。 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) · [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 3「隔离本地负向回归」](#s3-isolation-negative-regression) · [Sprint 4「接入链路与端到端取证」](#s4-mcp-session-bridge) · [Sprint 5「上线验收」](#s5-production-acceptance) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | D2 与本地 V1–V4 已完成；D1 随 Sprint 4「接入链路与端到端取证」落地，生产复验随 Sprint 5「上线验收」。 | Open | 2026-09-23 |
| **R2** | **严重** | 风险 | 隔离完全依赖门户一处正确性，无纵深 | 上游没有多租户授权边界，写路径无可见性过滤，能力令牌只放宽、不收紧。 | 门户跨用户复用子进程、会话池化或缓存命错用户时会无感知串号。 | [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) · [#5 审计视图](./product-backlog.md#pb-5) | [Sprint 4「接入链路与端到端取证」](#s4-mcp-session-bridge) · [Sprint 6「审计功能」](#s4-audit-view) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | D1、D3 随 Sprint 4「接入链路与端到端取证」落地；D4 随 Sprint 6「审计功能」落地。 | Open | 2026-09-23 |
| **R3** | **严重** | 风险 | SSH forced command 手工配置易失准 | `authorized_keys` 的每用户命令较长，手工拼写 env 与路径，比模板更易写漏且难以审计。 | 与 R1 同源同后果；任一行失准都可能串号或让整份密钥文件失效。 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) · [#14 定制 — 接入面](./product-backlog.md#pb-14) | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 5「接入面落地」](#s5-access-surfaces) · [Sprint 5「上线验收」](#s5-production-acceptance) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2 / §6.2 | D2 与本地验证已完成，现有模板有静态一致性护栏；生产 forced-command 路径随 Sprint 5「上线验收」复验。 | Open | 2026-09-23 |
| **D1** | **阻塞** | 依赖 | fail-closed spawn 前置断言 | 断言库路径非空、位于 `/data/users/` 且与当前 handle 绑定；不满足即拒绝启动会话。 | 缺少该断言时，有效但错误的他用户库路径不会被服务端发现。 | [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) | [Sprint 4 `3.2`](#s4-mcp-session-bridge) · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | 设计已定；实现与测试落在 Sprint 4「接入链路与端到端取证」`3.2`。 | Pending | 2026-09-23 |
| **D2** | **阻塞** | 依赖 | 移除配置模板的共享库键 | 消除漏设 env 时回落共享主库的路径；本地派生也会剥离私有配置遗留键。 | 不移除则漏设 env 可能静默落入共享主库。 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 5「上线验收」](#s5-production-acceptance) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.5 | 本地实施与负向探针已通过；生产复验登记在 Sprint 5「上线验收」。 | Implemented | 2026-09-23 |
| **D3** | **严重** | 依赖 | 一会话一子进程，禁止跨用户复用或池化 | 会话生命周期与当前用户的独立 MCP 子进程绑定。 | 复用进程会把单库隔离边界交还给门户，错误不会被上游感知。 | [#14 定制 — 接入面](./product-backlog.md#pb-14) | [Sprint 4 `3.3`](#s4-mcp-session-bridge) · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | 实现与测试落在 Sprint 4「接入链路与端到端取证」`3.3`。 | Pending | 2026-09-23 |
| **D4** | **中** | 依赖 | 会话审计记录解析后的库路径 | 每次会话开始时记录最终解析的用户库路径。 | 缺失时无法事后界定串号范围与追责。 | [#5 审计视图](./product-backlog.md#pb-5) | [Sprint 6「审计功能」](#s4-audit-view) · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S5 · [`web-portal/web-test.md`](./web-portal/web-test.md) §2 | 实现与测试落在 Sprint 6「审计功能」（重排 2026-09-23：由原 Sprint 4 PSP-W3 移入，属运营面）。 | Pending | 2026-09-23 |
| **D5** | **阻塞** | 依赖 | 上线前负向验收门禁 | 生产模板未通过 V1 负向验证时阻断上线。 | 缺失时上线流程可能把静默共享主库误判为成功。 | [#26 部署 · 验证 · 文档化](./product-backlog.md#pb-26) | [Sprint 3「隔离本地负向回归」](#s3-isolation-negative-regression) · [Sprint 5「上线验收」](#s5-production-acceptance) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | 本地门禁已在 Sprint 3「多用户隔离负向回归」定型；生产执行留在 Sprint 5「上线验收」。 | Implemented | 2026-09-23 |
| **D6** | **阻塞** | 依赖 | 公网真身份链路的上线验收（人工 SSO + 自动化 Service Token） | 门户身份由 Cloudflare Access 认定，而**凭据与策略分置两侧**（门户侧只认签名断言，策略在 CF 控制台）。本机已验证「未认证被拦（302）」与「Service Token 直达（200）」；但**在线套件真链路未跑**（缺 `PORTAL_E2E_ONLINE_BASE_URL` 与 Access Service Token），人工 SSO 也尚未在**生产配置**下复核。 | 两处易失准，且**失败与正常拒绝同形**：① Service Token 未加入该 Access 应用策略 ⇒ 302（与「用户未授权」无法区分）；② 门户后端配置与公网 Host 不匹配（如用回环配置的对端接公网 Host）⇒ 已认证后仍 403，表现为「认证成功却进不去管理面」。 | [#26 部署 · 验证 · 文档化](./product-backlog.md#pb-26) | [Sprint 5「上线验收」](#s5-production-acceptance) · [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8（`SBI-V1` / `SBI-V2P` / `SBI-V2`） · [`web-portal/web-login-plan.md`](./web-portal/web-login-plan.md) §2 | 本机链路已验证（302 拦截 / Service Token 200）；**上线时**在生产配置下复跑在线套件（退出码须为 **0**，不得以 40 跳过）并留人工 SSO 截图。凭据排查先取判据 `service_token_status`（团队不一致与策略未配症状相同）。 | Pending | 2026-09-23 |

> **级别口径**：**致命** = 不报错且造成跨用户数据串号；**阻塞** = 不解决则不得上线；**严重** = 单点失效即串号或安全边界失效；**中** = 影响可审计性或可观测性。
> **类型口径**：风险 = 可能发生的失效；阻碍 = 已发生或正在发生的阻塞；依赖 = 关闭风险所依赖的落地项。当前没有阻碍类条目。
> **追踪归属**：验证方法是对应 Product Backlog 条目的「验收条件」；V1–V4 判据定义见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 与 [Product Backlog「定制 — 多用户数据隔离」](./product-backlog.md#pb-11)。每条 RID 均以链接串联 Product Backlog 解决方案、Sprint Backlog 执行条目及设计/测试依据，不复制各处正文。

### RID 覆盖对照

| RID | 解决方案（Backlog 条目） | 验收条件与设计/测试落点 | Sprint 落点 |
|---|---|---|---|
| R1 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) · [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) | [#11 V1–V4](./product-backlog.md#pb-11) · [#4 spawn 前置断言](./product-backlog.md#pb-4) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 3「隔离本地负向回归」](#s3-isolation-negative-regression) · [Sprint 4「接入链路与端到端取证」](#s4-mcp-session-bridge) · [Sprint 5「上线验收」](#s5-production-acceptance) |
| R2 | [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) · [#5 审计视图](./product-backlog.md#pb-5) | [#4](./product-backlog.md#pb-4)、[#5](./product-backlog.md#pb-5) 验收条件 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 · [`web-portal/web-test.md`](./web-portal/web-test.md) §2 | [Sprint 4「接入链路与端到端取证」](#s4-mcp-session-bridge) · [Sprint 6「审计功能」](#s4-audit-view) |
| R3 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) · [#14 定制 — 接入面](./product-backlog.md#pb-14) | [#11](./product-backlog.md#pb-11)、[#14](./product-backlog.md#pb-14) 验收条件 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2 / §6.2 | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 5「接入面落地」](#s5-access-surfaces) · [Sprint 5「上线验收」](#s5-production-acceptance) |
| D1 | [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) | [#4 spawn 前置断言](./product-backlog.md#pb-4) · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | [Sprint 4 `3.2`](#s4-mcp-session-bridge) |
| D2 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) | [#11 V1、V4](./product-backlog.md#pb-11) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.5 | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 5「上线验收」](#s5-production-acceptance) |
| D3 | [#14 定制 — 接入面](./product-backlog.md#pb-14) | [#14 一会话一子进程](./product-backlog.md#pb-14) · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | [Sprint 4 `3.3`](#s4-mcp-session-bridge) |
| D4 | [#5 审计视图](./product-backlog.md#pb-5) | [#5 解析后库路径](./product-backlog.md#pb-5) · [`web-portal/web-test.md`](./web-portal/web-test.md) §2 | [Sprint 6「审计功能」](#s4-audit-view) |
| D5 | [#26 部署 · 验证 · 文档化](./product-backlog.md#pb-26) | [#26 上线负向门禁](./product-backlog.md#pb-26) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | [Sprint 3「隔离本地负向回归」](#s3-isolation-negative-regression) · [Sprint 5「上线验收」](#s5-production-acceptance) |
| D6 | [#26 部署 · 验证 · 文档化](./product-backlog.md#pb-26) | [#26](./product-backlog.md#pb-26) 验收条件 · [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8（`SBI-V1` / `SBI-V2P` / `SBI-V2`） · [`web-portal/web-login-plan.md`](./web-portal/web-login-plan.md) §2 | [Sprint 5「上线验收」](#s5-production-acceptance) |

---

## Sprint 1

Sprint Goal: 制定产品化计划

**状态：已结束**（全部条目完成）

### ToDo

| # | Increment | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 版本契约层（单一真相源 + 耦合面清单 + 预检脚本 + 跟踪 Action + 2 份 ADR） | 任务 | 治理 | `upstream.lock` 为唯一版本坐标；8 类契约点带源码依据；`make preflight-test` 离线自测全绿；每日跟踪 Action 落地；决策有 ADR | [`../upstream.lock`](../upstream.lock) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §9 · [`../scripts/upstream-preflight.sh`](../scripts/upstream-preflight.sh) · `.github/workflows/upstream-track.yml` · `adr/` | 版本坐标、契约面、预检与跟踪机制均已落地。 | Done |
| 2 | 制品改钉 `0.9.0` → `0.10.0` | 任务 | 部署 | 4 处坐标同步且全仓无残留矛盾（`deploy/.env.prod.example`、`architecture.md` §2、`deployment.md` §3 / §9）；理由留痕（0.9.0 的 attestation 缺陷） | [`../upstream.lock`](../upstream.lock) · `architecture.md` §2 | 制品已统一钉住 `0.10.0`，版本坐标由 `upstream.lock` 管理。 | Done |
| 3 | 升级治理方案（准入判据 + 回滚语义） | 任务 | 治理 | `deployment.md` §9 七步链路；判据分层 H1–H5 硬阻断 / W1–W6 人工确认；回滚强制快照覆盖（因上游不拒绝更新的库） | `deployment.md` §9 · `adr/ADR-005-upgrade-admission-gate-layering.md` | 升级准入、七步流程和强制快照回滚语义已定稿。 | Done |
| 4 | 上游事实与坑知识沉淀 | 研究 | 治理 | 三条实测结论（历史被重写 / schema 阶梯 78→80→81 / 回滚静默危险）与上游文档缺陷清单落盘 | `knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md` | 上游历史、schema 阶梯及旧二进制静默读取新库等事实已归档。 | Done |
| 5 | 多用户隔离方案 | 研究 | MCP | 四档方案对比（含 11 条源码依据）；单账号 N 密钥澄清；5 个坑；档位定为「一用户一 DB」 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) | 隔离方案已选「一用户一 DB」，方案比较、限制与验证矩阵均已成文。 | Done |
| 6 | admin portal 设计方案 | 任务 | Web App | 两 stack 职责与数据流、密钥模型、CF Access 边界、耦合面 C1–C8、静默失败点 S4、威胁模型 T1–T10 全部成文 | [`web-portal/web-design.md`](./web-portal/web-design.md) | 门户职责、会话流、访问边界、威胁模型及耦合面已完成设计。 | Done |
| 7 | 完善并评审 `product-backlog.md` | 任务 | 产品 | 占位符全部填实；评审改进点逐条确认；**已定稿**（三层结构 + 26 条 Backlog + 工具清单 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8） | [`product-backlog.md`](./product-backlog.md) | Product Backlog 已定稿并完成覆盖审计；当前已扩展为 31 条。 | Done |

### Retrospective

**本轮学到**

- 先立「版本坐标 + 契约点」再谈功能：上游发版会重写历史、改 schema、且不拒绝更新的库，没有 [`../upstream.lock`](../upstream.lock) 与 `make preflight-test` 做护栏，后面每条结论都会漂移。决策见 [`ADR-004`](./adr/ADR-004-version-contract-single-source-of-truth.md) 与 [`ADR-005`](./adr/ADR-005-upgrade-admission-gate-layering.md)，实证归档见 [`上游事实与坑`](./knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)。
- 研究类条目必须留下**可复跑的证据**（探针脚本 + 源码锚点），否则下一轮无法复核，只能重新讨论一遍；上游版本拓扑、schema 与回滚语义的证据整理见 [`上游事实与坑`](./knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)。
- 方案对比要写在文档里（隔离四档对比 + 11 条源码依据），不写就会在下游以「口头结论」的形式被反复推翻；最终隔离选择及取舍见 [`ADR-009`](./adr/ADR-009-per-user-db-isolation-over-single-db-agent-id.md)。
- 决议只留**一个单点**：同一事实写在多处，改一处漏一处就是隐性矛盾；spec 单一真源与链接纪律见 [`ADR-010`](./adr/ADR-010-specs-single-source-and-doc-structure.md)。

**下轮改进**

- 每条结论标注「实证 / 推断」，推断项单独列成待验清单，不混在结论里。
- 文档改名 / 合并必须配防复发护栏（本仓后续补了 `make doc-links`）。

---

## Sprint 2

Sprint Goal: 本地启动 + 探针明确方案

**状态：已结束**（全部条目完成）

### ToDo

> **执行顺序**：按本表**编号顺序**执行 —— 先做仓库治理与环境配置（#1–#3），再做本地启动（#4），随后逐项收敛方案（#5–#11），最后做文档收口（#12–#14）。

| # | Increment | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **仓库 IP 脱敏 + 防复发护栏**（保持公开仓） | 任务 | 安全 | 4 个真实公网 IP 从文档迁出到 gitignored 的 `memory.agent-mate.ai/secrets.local.hk_vps_4.md`，文档改用具名占位符（`<VPS4_IP>` / `<VPS3_IP>` / `<PG_HOST>` / `<MYSQL_HOST>`）；`secret-check.sh` + pre-commit 钩子（`make hooks-install`）就位，`make secret-check` 可跑且干净仓零命中 | [`architecture.md`](./architecture.md) §5.4 · [`../scripts/secret-check.sh`](../scripts/secret-check.sh) | 公网 IP 已占位符化，密钥扫描与提交钩子已落地。 | Done |
| 2 | qwen API key —— **用户已备好** | 阻塞 | 配置 | `.env` 中 `DASHSCOPE_API_KEY` 非空且可调通 | [`../deploy/.env.prod.example`](../deploy/.env.prod.example) · [`../deploy/.env.local`](../deploy/.env.local)（本地，gitignored） | 本地 Qwen key 已配置并通过 `qwen-verify.sh` 与 `ai-memory doctor` 验证；过程证据见文末 2026-09-20 变更记录。 | Done |
| 3 | qwen embedding 的 **model + dim**（**针对本地部署**写入环境配置；并在**部署文档**中说明未来生产环境的配置） | 阻塞 | 配置 | ① 本地环境配置的 `[embeddings]` 填真实值（**不可留 `dim = 0`**）并本地调通 —— `ai-memory doctor` 的 Embeddings Reachability 显示 `qwen:<model>` 且维度一致 ② **部署文档已说明未来生产环境**（服务器 `/opt/ai-memory/`）的对应配置与差异 | [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`../deploy/config.local.toml`](../deploy/config.local.toml)（本地，gitignored）· [`../deploy/README.md`](../deploy/README.md) · [`deployment.md`](./deployment.md) · [`../scripts/qwen-verify.sh`](../scripts/qwen-verify.sh) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §9 F1–F3 | embedding 定为 `qwen3.7-text-embedding`、1024 维；本地链路已验证，生产模板已同步。 | Done |
| 4 | **本地启动 ai-memory-mcp（按默认配置）** | 任务 | 开发环境 | 本机按默认配置启动成功，并通过 MCP 完成一次写入 + 召回，作为后续方案对照的基线 | `product-backlog.md` #1 · `deployment.md` §3 | 本地生产同构基线已跑通，握手、写入、跨进程召回及静默失败检查通过。 | Done |
| 5 | **给出「多用户隔离是否可实现」的明确结论** | 研究 | 功能 | 结论落盘（可实现 / 不可实现 / 有条件可实现），并指明所依赖的防线（D1–D5）与验证项（V1–V4）、以及未决前提 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) · 本文件 RID Registry | 结论为「有条件可实现」：一用户一库机制成立，可信性依赖 D1/D2，验证按 V1–V4 执行；详见 `mcp-design.md` §0、§6。 | Done |
| 6 | **D1 确认**：门户启动机制 **β′**（镜像内带二进制 + 子进程）vs **α**（`docker exec` + docker socket） | 任务 | Web App | 决议写入决议单点（现 [`architecture.md`](./architecture.md) §2）；若选 α 须书面接受「公网门户持 root 等价权限」并补 socket 加固 | [`web-portal/web-design.md`](./web-portal/web-design.md) §3 与 §9 附录 · [`knowledge/web-portal/portal-launch-mechanism.md`](./knowledge/web-portal/portal-launch-mechanism.md) | 门户启动机制已选 β′，镜像契约、权限前置和 MaaS key 注入均已验证；证据见 `portal-launch-mechanism.md` E1–E7。 | Done |
| 7 | **`tmp_user_key_option1.md` 处置**（移入 `specs/` 或加 `.gitignore`） | 任务 | 安全 | 仓根目录不再有未跟踪的留档文件 | [`architecture.md`](./architecture.md) §5.4 | 临时文件已按用户决定直接删除，确认不含真实密钥且无需归档；过程证据见文末 2026-09-20 变更记录。 | Done |
| 8 | **探针：上游保存 memory 时是否支持多语言** | 研究 | MCP | 给出明确结论（是否支持多语言存储 / 检索、有无相关配置项、有无已知限制）；结论回写 `product-backlog.md` 的「记忆内容的多语言支持」条目 | `product-backlog.md` #10 · 上游源码 | 多语言结论为部分支持：存储、语义召回和按 ID 读取可用，关键词检索受 FTS5 词元限制；证据见 `mcp-test.md` §4-E。 | Done |
| 9 | **`--profile` 定档**：对外暴露哪一档；SSH / 门户模板是否补写 `--profile` | 研究 | MCP | 实测 `v0.10.0` 各档工具数（本地 clone 实测：core 7 / graph 19 / admin 21 / power 56 / **full 101**；`memory_capabilities` 所有档位 always-on，故实际注册数 +1）；决议写入门户模板、SSH 模板与公开文档 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8 · `product-backlog.md` #12 | 对外统一 `core` 8 项，管理员入口为 `admin` 22 项；模板和用户文档均已同步，生产工具数复核归 Sprint 5「上线验收」。 | Done |
| 10 | **MCP 对外能力清单定稿**（档位 / i18n 范围 / LLM 与备份选择的最终决议） | 任务 | MCP | 清单定稿并落入公开文档；档位与 **#9** 的决议一致 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8 · `product-backlog.md` #19 | 档位、i18n、LLM 和备份四项决议均已定稿并写入能力文档；生产回包复核已独立移交 Sprint 5「上线验收」。 | Done |
| 11 | **更新 `memory.agent-mate.ai/specs/` 相关技术方案（明确方案部分）** ② [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md) 结构重构（§1+§2 合并并补 `mcp.json` 示例；工具说明改为**按档位**逐档一张表，新增「示例」列） ③ 本文件体例改造（阻断级风险三表合并为单表；每个 Sprint 后新增 `Retrospective` 章节） | 任务 | 文档 | ① 受本次重排影响的技术 spec 全部同步（编号引用去耦合、排期指向正确），各文件追加变更记录 ② 能力文档按档位矩阵化：6 张档位表（core 8 / admin 22 / graph 20 / power 57 / full 101 / `core,lifecycle` 14）逐项含「做什么 / 什么时候用 / 示例」，工具数与 [`../scripts/profile-probe.sh`](../scripts/profile-probe.sh) 实测一致 ③ 风险单表化（R/D/V 全部成行、保留编号锚点）+ 每个 Sprint 有 Retrospective 章节；**无 emoji、相对链接可解析、对外示例一律占位符** | `memory.agent-mate.ai/specs/` 全目录 · [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md) · 本文件 | 技术 spec、能力文档体例、风险表和引用已完成收口，旧引用清零；过程见 `change-log.md` 2026-09-21。 | Done |
| 12 | **目录改名收口 + specs 整合**（`hk_vps_4/` → `memory.agent-mate.ai/`；16 份 spec 合并为 8 份） | 任务 | 文档 | ① git 以 rename（R100）记录且全仓路径引用同步（Makefile / `.gitignore` / CI / 脚本 / specs / adr / knowledge）；② 含密与派生文件仍被忽略（`git check-ignore` 逐条断言 + `make secret-check` 干净）；③ `make doc-links` / `make preflight-test` / `iso-probe.sh` 全绿；④ specs 唯一真源 = `memory.agent-mate.ai/specs/`（产品级 2 + `mcp/` 2 + `web-portal/` 3） | [`architecture.md`](./architecture.md) · [`deployment.md`](./deployment.md) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) · [`web-portal/web-design.md`](./web-portal/web-design.md) · [`../scripts/link-check.sh`](../scripts/link-check.sh) | 目录改名与 specs 整合已完成，链接、密钥及预检护栏通过。 | Done |
| 13 | **需求覆盖审计 + 回溯引用**（产品概述 / 需求层 → Backlog） | 任务 | 产品 | ① `# 需求` 节 26 条与 Backlog #1–#26 **逐条对应、无遗漏** ② 「产品概述」层（需求边界 / 用户模型 / 鉴权）带验收条件却原无条目的 5 项补入 **#27–#31**，Backlog 由 26 条扩为 **31 条** ③ 第一部分每项需求后追加 `→ [Backlog #N 名称](#product-backlog)`，共 **44 处**（表格行的链接落在**末列单元格内**，不破坏表格）④ 新增「覆盖要求 / 回溯引用」约定：**条目名为主、编号为辅**（编号会随重排失效） | [`product-backlog.md`](./product-backlog.md) | 需求层与 Backlog 已完成覆盖审计，补录 5 条并建立 44 处回溯引用。 | Done |
| 14 | **文档风格收口：自有文档去 emoji / 图标** | 任务 | 文档 | 全仓自有 spec + `.codebuddy/plans/` 共 **14 个文件、180 处** emoji / 图标改为**文字承载**（状态 → 已完成 / 进行中 / 待决策 / 待提供 / 未开始；是否 → `是` / `否`，后接文字已自解释则直接删；告警 → `注意：`；级别 → 阻断 / 高危 / warn / info）；`ai-memory-mcp/`（上游 vendored、自带 `.git`）**未改**；`make doc-links` / `make secret-check` 全绿 | [`change-log.md`](./change-log.md) `## 2026-09-21` | 自有文档的状态与告警图标已改为文字表达；程序输出原文例外记录在 `change-log.md` 2026-09-21。 | Done |

> **执行本 Sprint 时须核对的静默失败点**：`deployment.md` §7.2 的三个（embedder 降级、curator fail-open `tagged=0`、config 挂载路径错误导致 tier 退回 semantic）+ 本文件 RID Registry 的 **R1**（会话漏设/写错 `AI_MEMORY_DB` → 所有用户静默共用同一库）。**R1 是其中唯一不报错、且后果是数据串号的一项。**

### Retrospective

> 定稿（2026-09-21）：Sprint 2 全部 14 条条目完成，含收尾的 #10（对外能力清单定稿）与 #11（技术方案更新：能力文档体例收口 + 引用清理）。

**本轮学到**

- **上游 `tools/list` 的 `description` 是被截断的短描述**（≤ 50 cl100k token，实测 `memory_recall` 只有 "Recall memories relevant to a"）。写对外说明必须改走 `memory_capabilities` 的 verbose drilldown（`family` + `include_schema` + `verbose`）取完整 `docs` —— 照抄短描述会写出残缺句子。实证归档见 [`上游事实与坑`](./knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)。
- **本地基线应复用生产 compose**：这样本地 MCP 冒烟验证的是同一套镜像、挂载和启动契约，减少“本地能跑、生产不同构”的漂移；决策见 [`ADR-008`](./adr/ADR-008-local-baseline-reuses-production-compose.md)，环境踩坑见 [`本地运行踩坑`](./knowledge/local-dev/ai-memory-local-run-gotchas.md)。
- **`--profile` 不传时默认就是 `core` 且完全不报错** ⇒ 模板必须**显式写档位**（用户行 `core`、管理员行 `admin`），否则「看起来对了」其实随时可能静默漂移；同一口径要在 SSH / 门户 / 客户端 / 对外文档**四处一致**。
- **先想「要做哪些事」再选档**：管理员入口先定 `full`（101）后收敛到 `admin`（22）—— Meta / Archive 这类只读统计不该随管理员入口整体开放。
- **研究类条目以「只读探针 + 退出码契约化」为默认起点**（i18n / profile / iso 三支探针同构、只读、可复跑），结论才能被复核，而不是靠一次性手工观察。
- **隔离的失效模式是「静默」**：R1 不报错、不告警、无日志，只能靠**负向验证 V1**（漏设 env 必须失败）+ **D2 移除 config 的 `db` 键**来消除落点；正向用例证明不了它。隔离边界的选择与取舍见 [`ADR-009`](./adr/ADR-009-per-user-db-isolation-over-single-db-agent-id.md)。
- **门户不应通过 Docker socket 启动 MCP**：socket 代理无法按容器与命令收窄权限，最终选择镜像内带二进制并按会话启动子进程；决策见 [`ADR-012`](./adr/ADR-012-portal-launch-mechanism-no-docker-socket.md)，实测证据见 [`门户启动机制实证`](./knowledge/web-portal/portal-launch-mechanism.md)。
- **档位文档的体例 = 每档只列本档新增 + 全档连续编号**：6 张档位表若各自重复上一档，读者看不出「这一档比上一档多了什么」；编号 1–101 连续（`core` 1–8 / `admin` 9–22 / `graph` 23–34 / `power` 35–83 / `full` 84–101）后，任何一处增删都能被一眼定位。约定见 [`spec 文档体例与引用治理约定`](./knowledge/docs/spec-doc-conventions.md)。
- **能力说明必须与探针实测逐项对齐**：手工补录曾写入上游**不存在**的工具（`memory_gc_hard` / `memory_demote`），只有拿 `profile-probe.sh` 的 `full` 全集做集合比对（编号连续 + 集合相等，脚本化断言）才拦得住；验证约定见 [`spec 文档体例与引用治理约定`](./knowledge/docs/spec-doc-conventions.md)。
- **被引文档改版会让引用方的转述静默过时**：能力文档由「按 8 组 + 一个端到端例子」改为「6 张档位表」后，`change-log.md`、`web-stories.md` AC6.4、`mcp-design.md` 三处转述立即失真 —— 体例变更必须连带扫引用方。治理原则见 [`ADR-010`](./adr/ADR-010-specs-single-source-and-doc-structure.md) 与 [`spec 文档体例与引用治理约定`](./knowledge/docs/spec-doc-conventions.md)。

**下轮改进**

- 决议回写时同步检查「是否存在第二处口径」，避免同一事实在多份文档里各写一份（档位数字、工具数一律指向探针实测）。
- **只有生产环境才成立的验证**（如 `initialize` 回包核对）单独登记到上线验收，不要挂在执行条目里当「未完成」，否则会长期假性阻塞。
- 对外文档（用户可阅读的部分）示例一律占位符化，不出现真实地址 / 端口 / 密钥。
- 变更体例或内容后，除更新被引文档，同时 **grep 引用方的转述句**（分组数 / 例子数 / 章节号），把「描述同步」当成变更的一部分。
- `link-check.allow` 的**整文件豁免只是过渡态**：每次条目收口都检查能否缩小（本轮把 `sprint-backlog.md` / `product-backlog.md` 移出豁免，4 → 2）。

---

## Sprint 3

Sprint Goal: MCP 本地安全边界与运维行为定档

**状态：已结束**（全部条目完成，2026-09-22）

### ToDo

> **范围校准（2026-09-21）**：LLM 选择与工具档位已在 Sprint 2 完成本地落地，生产复核留 Sprint 6；D1 / D3 / D4 依赖门户代码，分别并入 Sprint 4 PSP-W2 / PSP-W3；原「写路径泄露探针」仅影响已排除的单库方案 ②，取消；实测结论回写改为每项 DoD，不再单列。
>
> **执行顺序**：#1 可独立执行且已完成；硬依赖仅为 **#2 → #3**。#4（`[limits]`）与 #5（每库维护）可独立开展；#6 必须在运行与部署项中最后执行，统一收口文档、事实文件与重排编号传播；#7 与 #8 是独立的过程治理项，均已完成。
>
> **收口说明（2026-09-22）**：#1–#8 全部 `Done`。四条（#2–#5）按用户口径置 `Done`（本地验收闭环），其**生产复验**已作为已登记条目移交 **Sprint 6「上线验收」**，不在本 Sprint 范围内。

| # | Increment | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 定制 — **agent attestation 现存路径收口** | 配置 | 配置 | `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 在现存三条启动路径（compose 两处 / SSH forced command / 门户启动模板）口径一致；补齐 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5 模板；开关以**正负对照**验证：`=0` 写入成功（无 `isError`）、`=1` 同一写入被拒。**验收口径更正**：`attest_level=claimed` 是上游文档与启动告警的措辞，v0.10.0 的 MCP 面（响应 / `memory_get` / `export` / `memories` 表）**不暴露**该字段，故不作断言。每用户维护命令已随 #5 验收（并纳入 `make attestation-paths` 第五条路径断言），门户运行时代码随 Sprint 4 验收 | `product-backlog.md` #15 · [`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5 · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-D TC-ATT-01 · [`../scripts/mcp-smoke.sh`](../scripts/mcp-smoke.sh) | attestation 四处模板已统一，并以 `=0` / `=1` 正负对照验证；门户运行时代码另归 Sprint 4「接入链路与端到端取证」。 | Done |
| <a id="s3-remove-shared-db-fallback"></a>2 | 定制 — **D2：移除共享 DB fallback + 现存路径调用点审计** | 安全 | 安全 | 从 tracked 的 [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) 移除顶层 `db`；[`../scripts/local-up.sh`](../scripts/local-up.sh) 从 gitignored 的 `deploy/config.local.toml` 派生 `deploy/config.toml` 时**机械剥离顶层 `db` 并 fail-closed 断言结果无该键**，不依赖人工改私有文件；审计**现存**库路径调用点（compose ×2 / SSH 管理员行 / SSH 用户行 / 门户模板），逐条确认显式指定目标 DB，结论登记为可复核证据；`serve` / curator / forced command 本地基线不退化。**边界**：每库维护命令已随 #5 产出并完成调用点审计（显式 `--db` + attestation，见 `make attestation-paths` 第五条路径），不计入本条 | `product-backlog.md` #11 · 本文件 RID Registry D2 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.5 / §7 | 共享 DB fallback 已移除，本地派生和现存调用点审计通过；生产复验归 Sprint 5「上线验收」。 | Done |
| <a id="s3-isolation-negative-regression"></a>3 | **隔离本地负向回归（D5 门禁定型）** | 任务 | 安全 | #2 完成后扩展并重跑 [`../scripts/iso-probe.sh`](../scripts/iso-probe.sh) 的 **V1**：漏设 `AI_MEMORY_DB` 必须 fail-loud；`doctor --json.source` 必须是本次失败实际解析到的**绝对路径**且不得为 `/data/ai-memory.db`；失败原因必须来自存储路径解析；探针前后共享主库计数不变。回归 V2–V4，确认目标库写入、A/B 互不可见及显式 env 的 `source` 正确。**边界**：`AI_MEMORY_DB` 错设为“存在且可写的其他用户库”由 Sprint 4 的 spawn 前置断言覆盖；生产 V1 在 Sprint 5「上线验收」执行 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 的 V1–V4 判据 · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-C | V1–V4 本地负向回归已通过并形成上线门禁；生产模板复验归 Sprint 5「上线验收」。 | Done |
| 4 | 定制 — **上游 `[limits]` 配置与行为验证** | 配置 | 配置 | 在模板补 `[limits]`（**显式写全 7 键并等于 v0.10.0 编译默认**，防升级时默认值静默漂移），生产默认值与测试阈值严格分离；测试**只经环境变量注入小阈值**，禁止改写或污染生产默认值；验证写入量、存储、链接、向量索引容量超限时明确拒绝；通过 `ai-memory quota-status` CLI 交叉核对配额；不扩大公开 `core` / `admin` 档位；实测 `max_page_size` 与 `max_inflight_requests` 对 stdio 的作用并回写唯一真源 | `product-backlog.md` #17 · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.4 / §9 L · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-D TC-LIMIT | `[limits]` 七键和本地行为探针已落地，2026-09-21 用户确认可用；HTTP 面及生产通道验证仍待 Sprint 5，详见 `change-log.md` 2026-09-21。 | Done |
| 5 | 定制 — **每用户库维护行为定档** | 研究 | 部署 | 对独立测试库实测 `gc`、TTL 遗忘、WAL checkpoint 与 `curator --once` 的实际覆盖；确定逐库命令、失败退出与调度选择（主机 cron 或门户）；命令显式传 `--db` 与 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 并形成可重复测试，后者用于**防止 v0.11 默认翻转为全 surface required 后维护任务升级即失败**。生产定时器安装、日志与告警留 Sprint 5 | `product-backlog.md` #13 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.3 · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-C TC-GC | **调度定档 = 宿主机 cron**；入口 [`../scripts/maintain-user-dbs.sh`](../scripts/maintain-user-dbs.sh)（逐库显式 `--db` + attestation=0；单库失败不中断但非零退出）。探针 [`../scripts/gc-probe.sh`](../scripts/gc-probe.sh) 退出码 0（7 项断言）实测覆盖：TTL 驱逐由 `gc` 负责、**读/写路径亦惰性清扫**（`gc` 计数 ≠ 过期总量）、**WAL checkpoint 已被 `gc` 覆盖**、`curator --once` 可用。护栏 `make attestation-paths` 扩至**五路径**；2026-09-21 用户确认可用。生产定时器与告警留 Sprint 5，详见 `change-log.md` 2026-09-21。 | Done |
| 6 | **部署文档与事实文件一致性收口** | 任务 | 文档 | 校正 [`deployment.md`](./deployment.md) 与实际 `docker-compose.prod.yml` / `config.toml.tmpl` 的配置挂载、curator 命令、LLM / embedding 字段、环境变量名、部署目录与事实文件数量；#1–#5 的结论分别回写对应唯一真源与必要变更记录；机械扫描现行设计、测试、ADR 与门户文档中的 `Sprint 3 #N`，修正重排后失效引用或改用稳定条目名（**历史变更日志与当时叙述保留原编号**）；`make doc-links` / `make secret-check` 通过 | [`deployment.md`](./deployment.md) §3 / §5 / §7 · [`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) | 与部署制品逐字段收敛完成：§5.1 契约表改正 2 处实质失准（配置挂载 / curator 命令）并补 5 类缺行；§5.3 按模板逐键重写（删去上游不存在的 5 个键、更正 `[embeddings]` 后端与模型）；§1 事实文件数量、§2/§5.4 `.env` 键、部署目录口径、ADR-009「未核实」表述与 `Sprint 3 #N` 失准引用均收敛；#1–#5 结论落点逐条核实。`make doc-links` / `make secret-check` 通过，过程证据见 `change-log.md` 2026-09-22。 | Done |
| 7 | **SDD/Scrum 解决方案追踪与回顾规则收口** | 任务 | 文档 | RID 的 8 个条目均可沿稳定链接追踪到 Product Backlog 解决方案、Sprint Backlog 执行条目及 design/test 依据；Product 条目可回链具体 Sprint 条目；[`sdd-scrum-practices.md`](./sdd-scrum-practices.md) 明确该链路与 retrospective 必须写入实际交付 Sprint 的规则；用户级 `retrospective` 技能同步更新；`make doc-links` 与表格列数检查通过 | [`sdd-scrum-practices.md`](./sdd-scrum-practices.md) §1.3 / §2.3 / §3.1 · [`product-backlog.md`](./product-backlog.md) · 本文件 RID Registry / Sprint 3 Retrospective · [`change-log.md`](./change-log.md) 2026-09-21 | 5 个 Product 条目与 6 个 Sprint 条目已建立稳定锚点；RID 覆盖矩阵 8 行无空项；33 个 Markdown 文件、627 个相对链接验证无悬空。 | Done |
| 8 | **Replan — Sprint 4–7 重排为「设计包 + PSP 批次」** | 任务 | 文档 | Sprint 4 / 5 的目标与 ToDo 改为「**1 个设计包 + 3 批可交付批次（PSP）**」；原 Sprint 6 与 7 **合并**为「本地集成验收、生产上线与备份闭环」，升级治理下移为 Sprint 7（总数 8 → 7）；[`product-backlog.md`](./product-backlog.md) 的 `Sprint` 投影 **31 条**同步重算且逐条一致；**6 个对外锚点 id 保留**、跨文档链接零断裂；PSP 体例与「功能分解而非任务分解」判据写入 [`sdd-scrum-practices.md`](./sdd-scrum-practices.md) §2.4；`make doc-links` / `make secret-check` / `make attestation-paths` / `git diff --check` 通过 | [`sdd-scrum-practices.md`](./sdd-scrum-practices.md) §2.4 · 本文件 Sprint 4–7 与文末变更记录 · [`product-backlog.md`](./product-backlog.md) · [`change-log.md`](./change-log.md) 2026-09-22 · Sprint 4 `Retrospective` | 独立过程治理项（同 #7）：把「按任务排期」改为「按功能批次交付」。过程证据见 `change-log.md` 2026-09-22；可复用教训按「写入**实际交付该工作的 Sprint**」落在 **Sprint 4 `Retrospective`**（本次重排服务于 Sprint 4 的门户设计包批次）。 | Done |

> **执行本 Sprint 时须核对的静默失败点**：[`deployment.md`](./deployment.md) §7.2 的三个 + 本文件 RID Registry 的 **R1**。凡涉及「会话落库路径」的验证，一律以 **V1（负向）** 为准入门槛。

### Retrospective

**本轮做得好**
- RID 解决方案已用稳定锚点串联 Product Backlog、Sprint Backlog 与 design/test 依据；RID 表、Sprint ToDo 表与 Product Backlog 的状态同批改齐，不再出现「同文件自相矛盾」。
- 研究类条目的交付物落成「脚本 + 退出码契约」：#4 与 #5 的结论分别落在可复跑探针与 [`../scripts/maintain-user-dbs.sh`](../scripts/maintain-user-dbs.sh)（cron 入口），而不是文档里的一段内联命令。
- 「删文档 / 改名后留悬空引用」变成了可检出缺陷：`make doc-links` 是本次收口的判定依据，而不是靠人工 grep 记得住。
- #6 用**字段对照矩阵**而非通读比对：六个维度每个都指到「文档行号 ↔ 制品行号」两侧证据，于是除了显眼的两处失准，还揪出 §5.3 里**上游根本不存在的 5 个配置键**与 `[embeddings]` 后端/模型名不符 —— 后者若照抄会把 1024 维绑到错的模型上。

**本轮学到**
- 单一真源约束的是事实与状态不重复，不排斥双向导航；只链接文件顶部或只写 Sprint 名称，不足以构成可核对的 traceability。
- **「配置生效」不等于「行为生效」**：`[limits]`（#4）与维护覆盖面（#5）都只能靠**可观测产物**断言，不能靠日志措辞 —— #4 的向量触顶日志 target 不被默认过滤器覆盖，曾因此假失败。
- **「谁负责哪一段」必须读源码，不能照抄方案文档**：#5 实测推翻了 `mcp-design.md` §5.3「`gc` 对 TTL/WAL 覆盖面未验」的悬置 —— `gc` 属 CLI 写命令，post-run `wal_checkpoint(TRUNCATE)` **已覆盖 WAL**；但 **TTL 驱逐并非 `gc` 独有**，`store`/`list`/`recall`/`import` 与 MCP `memory_recall` 都会经 `db::gc_if_needed` 惰性清扫 ⇒ **`gc` 计数 ≠ 过期总量**，维护作业不能靠业务查询代劳。
- **与活进程共享资源的断言默认是竞态**：WAL 归零断言首版未等写入方静默，因 `memory_store` 之后的 deferred-audit 追加而残留 107152 字节；改为「连续 5 次采样无变化」后才确定性归零。
- **副作用会推翻绝对计数断言**：非干跑 `curator` 会写入**自报告记忆** ⇒ 多库维护断言必须用相对口径（计数不下降 + 存活 id 可读 + 无跨库串号）。
- Retrospective 的最低持久化落点应是**实际交付该工作的 Sprint**；ADR 与 `specs/knowledge/` 是按持久价值追加的产物，不能替代 Sprint 回顾。
- **「文档写的」不等于「制品有的」**：`deployment.md` §5.3 曾登记 5 个上游 `src/config.rs` 里**不存在**的键（`max_tokens` / `temperature` / `[storage.sqlite].pool_size` / `[memory].max_age_days` / `[context_optimizer].max_results`），而 `[storage].embedding_dim` 实为**运行时结构体字段**而非配置节 ⇒ 配置文档必须以模板 / 上游 schema 为基准**逐键镜像**，不能凭印象列举。
- **「数量」类声明要用机械口径**：`deploy/` 工作区可见 9 个条目，但 `git ls-files` 只有 **5 个入仓**、另 4 个是 gitignored 派生文件 ⇒ 原「三个事实文件」既少于 `README.md` 列的四个模板、也少于实际入仓数；数量类表述须以 `git ls-files` / `check-ignore` 取证。
- **同一事实会分叉出第二套口径**：部署目录在 `deployment.md` 与门户样例里是 `/opt/ai-memory/`，但 `.env.prod.example` 与 Sprint 2 条目写的是 `/opt/ai-memory-mcp/` —— 收口时要**先枚举该事实的全部出现位置**再判定真源，而不是见到一处改一处。
- **Sprint 收口要同时核两件事**：条目是否全 `Done`，以及 Sprint 级结束标记 / 回顾是否同体例定稿 —— #1–#7 全 `Done` 时标题区仍缺 `**状态：已结束**`（Sprint 1 / 2 均有）。

> **沉淀**：本 Sprint 的可复用结论已落到 [`knowledge/docs/spec-doc-conventions.md`](./knowledge/docs/spec-doc-conventions.md)（证据第 12–14 条 + 6 条 guidance）与 [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](./knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)（教训 20 / 21）。**无新增 ADR** —— 全部是既有决议的执行与文档一致性维护，未引入新的架构或流程取舍。

**下轮改进**
- 新增 RID 解决方案时，同批建立 Product 条目锚点、Sprint 执行锚点和 design/test 链接，并在覆盖矩阵逐项核对。
- 断言凡涉及「与另一个活进程共享的资源」，先做**静默/静止等待**再断言终态，避免把调度抖动当成功能缺陷。
- 新增任何「批处理入口」时，**同一次改动**就要把它的路径约束（显式 `--db`）加进 `make attestation-paths` 的断言面；#5 已按此把护栏扩到五路径，后续沿用。
- 配置类文档的「关键字段」表应加机械约束：**表中每个键都必须能在模板或上游 schema 找到出处** —— 可用一条简单断言落地（模板键集合 ⊇ 文档键集合），把「凭印象列举」变成可检出缺陷。
- 数量与路径类声明（文件数 / 目录 / 端口）收口时，同批用 `git ls-files` 与全仓检索取证，并把该事实的**全部出现位置**列进变更记录，避免下一轮又从另一处发现第二套口径。

---

## Sprint 4

Sprint Goal: 交付可上线的全套产品最小 MVP（接入链路跑通 + 隔离取证）

> **重排（2026-09-23，用户定稿）**：本 Sprint 目标由「完成 web-portal 本地开发」改为「**交付可上线的产物**」—— 完整接入链路的构建与端到端取证在本 Sprint 内闭环，**生产上线移入 Sprint 5**，使上线不再隔着多个 Sprint 等待（重排前上线在 Sprint 6，且桥、合跑、上线被切成三段跨三个 Sprint ⇒ 4 跳依赖链）。**合并与移入**：原 Sprint 5 的「全链路联通」「跨用户隔离」与本 Sprint 的桥合并（同一件事不再切两段）；原 Sprint 6 的「本地完整集成验收」前移承接。**编号基准**：本 Sprint 的 `#N` 与 `N.M` 一律指**重排后**的编号；`#1` / `#2` / `#5` / `#6` 是已交付历史行，按 [`ADR-016`](./adr/ADR-016-sbi-delivery-granularity.md)「既有批次不重排（历史不改）」保留原名、不随重排改号；`#7` / `#8` 为**重排后新分配**，与重排前同号的文档收口行**不是同一条**（后者已移入 Sprint 6）。移出项与落点见本 Sprint 末「移出登记」。
>
> **当前状态（2026-09-22，重排前的进展）**：`#1` 设计包 **Done**（①–⑤ 逐项核对定稿，证据见该行「说明」；唯一移出的是把「非英文输入复现矩阵」的**产出**归 [`mcp/mcp-stories.md`](./mcp/mcp-stories.md) 所述 Sprint 5 `4.1`，本项只固定判据）；`#5` UI 迭代与设计系统收口 **Done**、`#6` specs 一致性审计与界面收口 **Done**（原型 `134/134` 断言全绿，四条门禁全绿）；`#2` `PSP-W1「账号与凭证」` **Done**（离线 **247 项** + **覆盖率门禁达标** + 端到端通过；在线 Access 链路待隧道与 Service Token —— 且本机网络实测解析不到 Cloudflare 域名，需换网络或配代理），原 `#3` / `#4` 两批已按 §2.1 拆为 `3.x`（6 行）/ `4.x`（10 行）Increment，**均未开始**。界面经**三轮用户反馈 + 一轮跨文档审计**收口（决议 `D10`–`D14`，页面集 7 → **6**，逐页映射见 [`web-portal/web-design.md`](./web-portal/web-design.md) §14）。
>
> **卡点已清零（2026-09-22 逐项定夺）**：① **logo 语义重复** → **保留**（`AC6.11` 要求顶栏出现完整品牌串、`AC14.12` 要求公开页 hero 与管理面顶栏各有一处 logo ⇒ 重复是两条 AC 的**结构性结果**）；② **品牌色孤岛 `#F6EC34`**（占徽标不透明像素 **2.1%**）→ **保留**（`AC14.1` 的扫描面是元素**计算色值**，图像像素不在内 ⇒ 不立强调色令牌、不灰阶化，口径收敛为「UI 无品牌色；品牌资产图像自带色」）。两项已回填 [`web-portal/web-design.md`](./web-portal/web-design.md) §13 开头 / §15 资产表与 [`change-log.md`](./change-log.md)。③ **用例索引缺口已修**：`S4` 行的 4 处简写已展开为全量，3 条 AC 已迁出的孤儿用例（`TC-P-L1-03` / `TC-P-L2-01` / `TC-P-L2-02`）已挂到 [`mcp/mcp-stories.md`](./mcp/mcp-stories.md) `MS1` 的「测试用例」列 ⇒ 索引引用与用例定义集合**双向一致（0 悬空 / 0 孤儿）**。**修正**：此前记为「5 条未被显式引用」不准确，实为「**4 条简写漏判 + 3 条结构性孤儿**」。

### ToDo

> **批次口径（2026-09-23 起按 Increment）**：本 Sprint 的**未交付项**已按 [`sdd-scrum-practices.md`](./sdd-scrum-practices.md) §2.1 的 Increment 语法拆行 —— 每行是一个**可交付的增量**（`范围:名词`），验收条件为**二值判定**（「条件名称 + 判定依据」）；§2.4 的 PSP 四条判据与 SBI 四条细化**全部保留**。
> **编号口径（重排后）**：`3.x` = 由原 `#3`（`PSP-W2「端到端接入」`）拆出的子项 —— 本 Sprint 保留桥的构建**与端到端取证**（`3.6` / `3.7` 自原 Sprint 5 前移并入）；`4.x` = 由原 `#4`（`PSP-W3「可运维、可发布」`）拆出的子项 —— 本 Sprint 只保留**上线的本地产物**（制品与镜像相关项移入 Sprint 5）。`#1` / `#2` / `#5` / `#6` 是已交付历史行，按 [`ADR-016`](./adr/ADR-016-sbi-delivery-granularity.md)「既有批次不重排（历史不改）」保留原批次名。
> **执行顺序**：`#1` 设计包先行；**`3.5` 探针最先**（按 [`ADR-017`](./adr/ADR-017-complexity-probe-before-real-build.md)，桥属「首次引入跨进程协议」的高复杂度项，先交付只回答一个可证伪问题的探针）；然后 `3.1` → `3.2` → `3.3` → `3.4` 是桥的构建顺序；`3.6` / `3.7` 依赖 `3.1`–`3.4`；`4.x` 各项相互独立；`#8` 集成验收在 `3.7` 之后。

| # | Increment | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **web-portal 设计包** | 任务 | Web App | 五份交付物定稿：① story-mapping（故事 `S1`–`S14` 与三批 PSP 的归属表）② 技术设计（门户技术栈、HTTP MCP ⇄ stdio 会话桥实现方案、门户数据模型）③ UI 设计（6 页原型与 `mockups/`，设计系统与逐页映射见 [`web-portal/web-design.md`](./web-portal/web-design.md) §13–§15）④ 测试方案（[`web-portal/web-test.md`](./web-portal/web-test.md) L0–L3 与 AC 的落地映射）⑤ 部署方案（compose / 挂载 / env / 启动自检）。**另含判据固定**：客户端中文 vs 英文提问 × 对外 8 项工具 —— 本项只**固定判据与测量口径**；**复现矩阵的产出归 Sprint 5 `#4 PSP-M3`**（[`mcp/mcp-stories.md`](./mcp/mcp-stories.md) 已知限制「`MS6 AC-M6.2` 的复现矩阵」行已明写） | [`web-portal/web-stories.md`](./web-portal/web-stories.md) · [`web-portal/web-design.md`](./web-portal/web-design.md) · [`web-portal/web-test.md`](./web-portal/web-test.md) · [`product-backlog.md`](./product-backlog.md) | ①–⑤ **全部定稿**（逐项证据见下）。**① story-mapping**：[`web-portal/web-stories.md`](./web-portal/web-stories.md) 14 个故事（`S1`–`S14`）+「故事索引」14 行且**每行含 Sprint 落点**。**② 技术设计**：[`web-portal/web-design.md`](./web-portal/web-design.md) §12.0 技术栈定档（关闭 §10 #2）· §2 门户侧会话编排（跨进程契约真源 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.6）· §4.4 数据模型。**③ UI 设计**：`mockups/` 6 页 + §13–§15（含 `S14`）。**④ 测试方案**：[`web-portal/web-test.md`](./web-portal/web-test.md) §0 L0–L3 分层 · §2 46 条用例 · §3 验收清单，且 AC↔TC **双向一致（0 悬空 / 0 孤儿）**。**⑤ 部署方案**：§3 容器与启动（β′ + 三条硬前置 + 四项 fail-closed 自检）· §11 部署九步（含挂载与 env）· [`../deploy/portal.env.example`](../deploy/portal.env.example)。**假设（可推翻）**：门户 stack 的 compose **制品**（对照 [`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) 的契约级文件，目前不存在）**不属设计包**，归 `#2 PSP-W1` 实现期产出 —— 设计包只给契约点（挂载 / env / 自检）。 | Done |
| 2 | **PSP-W1「账号与凭证」** | 功能 | Web App | **交付判据**：本地可完成「管理员建用户 → 签发令牌 → 列出元信息 → 轮换 → 吊销即时失效」闭环，且非管理员无法创建用户或令牌。覆盖 `S1` · `S2` · `S10`。**边界**：判据不含「用令牌建立会话」——那是 PSP-W2（接入批次）的产物，本批不得依赖它才能验收 | `product-backlog.md` #27 / #3 / #2 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S1 / S2 / S10 | 交付给：**管理员**。**本批证据（2026-09-22）**：`admin_portal/` 实现落地（Node 22 + TS + Fastify + Nunjucks + `better-sqlite3` + Zod，依赖按核定版本钉死）；闭环「建用户 → 签发（明文只出现一次）→ 列出元信息 → 轮换 → 吊销即时失效」由 **247 项离线测试**（`tests/unit` + `tests/integration`；**覆盖率门禁**实测 语句 94.87% / 分支 88.25% / 函数 98.77% / 行 96.39%，阈值 92/85/96/93 低于即失败）与 **Python Playwright 端到端**（`make portal-e2e`）覆盖；「非管理员无法创建用户或令牌」由 `AC1.4` + 身份守卫覆盖，面隔离双向拒绝由 `TC-P-L3-03` 覆盖。**如实登记的边界**：真 Cloudflare Access 链路的端到端验收需隧道 + Access Service Token（`make portal-e2e ARGS=--online`），缺前置时以**退出码 40 明确跳过**（不伪装通过）。 | Done |
| <a id="s4-mcp-session-bridge"></a>3.1 | **mcp:会话桥** | 功能 | MCP | **单次会话跑通**：持 `memo_…` 令牌经 `/mcp` 完成一次写入并召回，返回真实结果 · **令牌使用时间各自更新**：同一用户的多把令牌 `last_used_at` 独立更新 | `product-backlog.md` #14 / #28 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S3 `AC3.3` / `AC3.5` / `AC3.7` · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.6.2 | 交付给：**用户**。本行是**首个对外可用**的增量。 | ToDo |
| 3.2 | **mcp:spawn 前置断言** | 功能 | MCP | **断言拒绝**：库路径为空 / 不在 `/data/users/` 内 / 与 handle 不匹配时拒绝建立会话，且不 spawn 子进程 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S4 `AC4.4` / `AC4.7` · [RID `D1`](#rid-registry) | 交付给：**运维与审计**。`D1` 的落地行。 | ToDo |
| 3.3 | **mcp:一会话一子进程** | 功能 | MCP | **无跨用户复用**：两个并发会话对应两个独立子进程 · **无他人痕迹**：会话前后不出现其他用户的库或临时文件 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S4 `AC4.5` / `AC4.6` | 交付给：**用户**。`D3` 的落地行（禁止池化）。 | ToDo |
| 3.4 | **mcp:会话回收** | 功能 | MCP | **子进程归零**：会话结束后子进程退出且无残留 · **路径留痕**：每次会话记录解析后的库路径 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S3 `AC3.4` · S4 `AC4.3` | 交付给：**运维**。`D4` 的落地行。 | ToDo |
| 3.5 | **mcp:桥可行性探针** | 研究 | MCP | **双向往返跑通**：门户侧以 `HTTP(Streamable)` 收到一次 MCP 请求，经已启动的上游子进程 `stdio` 转发并取回响应，HTTP 侧收到完整回包 · **结论可复跑**：探针脚本与原始输出落档，命令可重复执行 | `adr/ADR-017-complexity-probe-before-real-build.md` · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.6.2 | 交付给：本 Sprint `3.1`。按 [`ADR-017`](./adr/ADR-017-complexity-probe-before-real-build.md)，桥是本 Sprint 内**唯一首次引入的跨进程协议**，故先交付只回答一个可证伪问题的探针；产物可丢弃。 | ToDo |
| 3.6 | **mcp:全链路联通** | 功能 | MCP | **一次写入召回跑通**：门户 → HTTP MCP → 子进程 stdio → 用户库 全程贯通并返回真实结果 · **拒绝路径按预期失败**：无令牌与越权库路径均被拒绝 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | 交付给：本 Sprint `#8` 本地完整集成验收（作为其输入）。自原 Sprint 5 前移并入（重排 2026-09-23）。 | ToDo |
| 3.7 | **mcp:跨用户隔离** | 功能 | MCP | **A/B 互不可见**：用户 A 写入的记忆，用户 B 经同一门户实例检索不可见 · **端到端取证**：两侧均记录解析后的库路径 | `product-backlog.md` #4 / #11 · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §2 | 交付给：本 Sprint `#8` 本地完整集成验收。RID `R1` / `R2` 的端到端取证行。自原 Sprint 5 前移并入（重排 2026-09-23）。 | ToDo |
| 4.1 | **web-portal:会话限流** | 功能 | Web App | **超限明确拒绝**：超每 key 并发 / 全局并发 / 空闲超时 / 单会话最长时长任一上限时给出明确原因 · **不排队致死**：不出现无限排队导致全部会话不可用 · **额度内不受影响**：额度内用户读写无额外等待或拒绝 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S7 `AC7.3` / `AC7.6` · [`web-portal/web-design.md`](./web-portal/web-design.md) §7 | 交付给：**管理员与受邀用户（1–5 人规模的基本护栏）**。上游无「会话」概念 ⇒ 本项限流全部由门户自建。原 `3.5`（重排 2026-09-23 并入上线产物批次）。 | ToDo |
| 4.2 | **web-portal:接入说明** | 功能 | Web App | **接入步数达标**：新用户按页面指引 ≤ 3 步完成接入 · **占位符合规**：示例一律使用占位符、不出现真实值 · **四语言键集合一致** | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S6 `AC6.1`–`AC6.11` | 交付给：**受邀用户**（上线闭环内被使用：用户拿到令牌后须能自助接入）。 | ToDo |
| 4.3 | **web-portal:启动自检** | 功能 | Web App | **任一缺失即拒绝启动**：用户目录不可写 / 向量服务不可用或维度不符 / 二进制版本与版本锁不一致 / 关键校验缺失 · **通过后才对外服务** | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S11 `AC11.1`–`AC11.5` · [`web-portal/web-design.md`](./web-portal/web-design.md) §3.4 | 交付给：**运维**。上线产物的一部分：自检的判据在本 Sprint 固定，镜像侧落地见 Sprint 5。 | ToDo |
| 4.4 | **deploy:上线配置指南** | 任务 | 部署 | **三段指南齐备**：Cloudflare Access（应用与策略配置）· SSH 密钥对与 forced command · 对象存储私有桶与子账号，每段含逐步操作与**每步验证点** · **可照做**：不依赖读者已有背景，照做即可得到可验证结果 | [`deployment.md`](./deployment.md) §12.4 · [`deployment.md`](./deployment.md) §8 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2 · [`../deploy/README.md`](../deploy/README.md) | 交付给：**资源持有者（运维）**。用户口径（2026-09-23）：三项外部前置「我都有，但需要详细的指南如何配置」⇒ 本行产出指南，Sprint 5 执行配置与凭据落地。 | ToDo |
| 7 | **deploy:真身份口径核对** | 任务 | 文档 | **逐项留结论**：[`deployment.md`](./deployment.md) 真身份与隧道章节 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) 主机名与 Bypass 口径**各自给出「已更新」或「已核对、无需改」** | [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8 `SBI-D5` | 交付给：**运维**。原 `11`（重排后编号）；口径是 Sprint 5 部署动作与本 Sprint `4.4` 配置指南的输入，故留在本 Sprint。 | ToDo |
| 8 | **deploy:本地完整集成验收** | 任务 | 部署 | **L2 真实客户端跑通**：以 `memo_` 令牌指向本地 MCP 面，完成 `initialize` → `tools/list` → 实调用 · **L3 本地版全绿**：跨用户隔离、面隔离双向拒绝、吊销即时生效、并发与配额生效 | [`web-portal/web-test.md`](./web-portal/web-test.md) §2 / §3 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | 交付给：**用户与上线准入**。自原 Sprint 6 前移（重排 2026-09-23）：它是本 Sprint 全部产物的收口判据，也是 Sprint 5 上线动作的准入条件。 | ToDo |

| 5 | **UI 迭代与设计系统收口** | 任务 | Web App | **交付判据**：原型 6 页可评审且经一次性验收脚本 **134 项断言全绿** —— 单色令牌（除危险红与错误浅底外无彩色）、首页三步纵向与 Contact Admin 悬浮窗（微信码 + 邮箱）、能力表三列同屏不裁切、路径与时间戳不被逐字符折断、同一行控件等高同字号、冻结顶栏与页脚（滚动后仍贴边）、分页组件、可逆停用、四语言词表键集合一致、`admin_portal/assets/` 与原型 sha256 一致。承载 `S14`（`AC14.1`–`AC14.12`）· `S6 AC6.7`–`AC6.11` · `S10 AC10.6`–`AC10.10` · `S1 AC1.8` | [`web-portal/web-design.md`](./web-portal/web-design.md) §13–§15 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S14 · [`web-portal/mockups/`](./web-portal/mockups/) | 交付给：**运维与评审**（设计包的可评审面）。三轮用户反馈驱动（色系 / 版式 / 外框）已闭环；验收证据：`134/134` + 四语言 `220 键 ×4` + 交付副本逐文件 sha256 一致。**原型与 `.verify/` 不入制品**。 | Done |
| 6 | **specs 一致性审计与界面收口** | 任务 | 文档 / Web App | **交付判据**：`web-portal/*.md` ↔ `mockups/` ↔ 其他 specs 彼此一致且**可机器核对** —— 页面集与命名、语言数、认证模型、`AC`↔`TC` 映射均无冲突；AC 编号连续（`AC1.1`–`AC14.12`，缺口仅为已迁出者）；索引引用的 `TC-P-*` **无悬空**；四条门禁全绿 | [`web-portal/web-design.md`](./web-portal/web-design.md) §14 / §15 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) · [`web-portal/web-test.md`](./web-portal/web-test.md) · [`deployment.md`](./deployment.md) §12.4 · [`product-backlog.md`](./product-backlog.md) #7 · [`architecture.md`](./architecture.md) §1.1 | 交付给：**运维、评审与实现期**（把「原型 ↔ 实现」变成可机械核对的对照表）。审计出并修掉 **7 处不一致 + 1 处悬空链接**；最实质的是 [`deployment.md`](./deployment.md) **缺根凭证要求**（`AC10.8` 原本无法验收）⇒ 新增 §12.4 与 §13 验收项。 | Done |

> **移出登记（2026-09-23 重排）**：以下原属本 Sprint 的行已移出，本 Sprint 不再追踪（移出依据：不阻塞「交付可上线产物」这一闭环）。锚点 id 随行迁移、保留不改名。
>
> | 移出行 | 移入 | 移出理由 |
> |---|---|---|
> | 审计功能（锚点 `s4-audit-view`） | **Sprint 6** | 运营可见性，不阻塞接入 |
> | 配额透传 | **Sprint 6** | 与配额 / 容量同族，属运营面 |
> | 制品契约 · 门户库边界 · 容器攻击面 | **Sprint 5** | 判据依赖镜像与卷，须与镜像制品同时落地 |
> | 磁盘配额方案 · 用户规模上限 · 限流结论 | **Sprint 6** | 1–5 人规模下非阻塞（用户口径 2026-09-23）；容量研究可后移 |
> | UI 设计系统 | **Sprint 6** | 设计系统一致性维护，非上线阻塞项 |
> | 身份口径 AC（锚点 `s4-identity-docs`）· 认证模型口径 · 身份用例登记 · 排期回填 | **Sprint 6** | 文档收口类，与本 Sprint 的产物交付无依赖 |
> | 界面修正同步 · 版式同步 | **Sprint 6** | 原型侧同步（实现侧修正已在 `#2` PSP-W1 期交付） |

### Retrospective

**本轮做得好**
- `web-portal/web-stories.md` 按 ATDD 重写（13 个故事 / 71 条 Given-When-Then AC）后**没有停在「本文件自洽」**：同批把外部引用面（`product-backlog.md` / `sprint-backlog.md` / 证据页）一次扫到零残留，并让故事索引成为跨文档故事号的**唯一对照表**（含 `AC` 与 `测试用例` 两列）。
- 落盘顺序是「**先在 `web-test.md` 登记用例号，再回填索引**」，避免写出指向尚不存在用例号的索引。
- 用只读评审把「单向引用」逐条挖出（S1 / S8 / S9 / S12 / S13 的 Sprint 落点未回链）并在**同轮**修完，而不是留到下轮。
- **Replan 同样没有停在「改 sprint-backlog」**：Sprint 4–7 重排后，同批把 `product-backlog.md` 的 **31 条投影**逐条重算、**6 个对外锚点**保留并指向新位置、跨 8 份文档的**约 46 处**编号引用改指，并把新体例（§2.4 PSP）与 8 份变更记录一次落齐。
- 交付粒度改按**功能批次（PSP）**表达：Sprint 4/5 的 ToDo 收敛为「1 行设计包 + 3 行批次」，每行「验收条件」是可执行的**交付判据**（引用故事号 / AC 号）而非任务描述。
- **「先写断言、看它失败，再修，再看它通过」在布局类问题上首次真正生效**：Issue 8（长 Token 前缀撑出弹窗边框）先落 E2E 护栏 —— 修复前实测 `.key-meta-value` `scrollWidth=123 / clientWidth=94`（内容宽于容器 29px），修复后值列 94→322px 且 `scroll == client`。此前两次「CSS 已收口」都被肉眼推翻，根因是「读规则」不等于「量结果」（见 [`ADR-018`](./adr/ADR-018-mockup-as-clickable-simulation.md) 第 5 条）。
- **本轮把「状态回填」当成交付的一部分**：`portal-identity-plan.md` 写着「未动代码」实际阶段 0/1 已交付、`issues-log.md` 两条写着「未做」实际已完成 —— 一并核实并回填，而不是继续按旧状态汇报（细节见对应文件 2026-09-23 行）。
- **把「计划读不懂」当成缺陷处理**：用户三次表达「现在的计划看不懂」后，先改**表述体例**（`Increment` 命名语法 + 二值验收条件），再按新体例拆批次 —— 而不是边拆边解释。体例先行的代价是多一轮澄清，收益是之后所有行都有统一判据可核。

**本轮学到**
- **编号空间会撞名**：故事号 S1–S13 与既有的「静默失败点 S1–S4」（`deployment.md` §7.2 / `web-design.md` §5）和 `i18n-probe.sh` 的测试标签 `S1–S12` 同形；`grep` 清扫会同时命中三者，既可能误改也可能因噪声漏判 —— 5 个条目的错指正是这样被掩盖的。见 [`knowledge/docs/spec-doc-conventions.md`](./knowledge/docs/spec-doc-conventions.md) 第 10 条。
- **「双向可查」不会自动成立**：索引里声明落点，被指的那一行不会自己长出回链；声明双向等于承诺同批回填（同上第 11 条）。
- **同一事实两处写法会立刻分叉**：S12 的用例集合在故事索引与「已知限制」表各写一遍，第一次就漏了 `TC-P-L1-09`。
- **体例一旦写下，实例立刻受它约束**：新写的 §2.4 判据点名禁用「联调」这类动作词，而同一批给 Sprint 5 起的批次名恰好就叫「本地联调」；判据「有角色」也与「交付给开发者自测」互斥。**体例与实例必须在同一次落盘里互相回代校对**。
- **「零残留」的声明必须写明扫描面**：文档扫干净后，`scripts/limits-probe.sh` 的输出串与 `scripts/maintain-user-dbs.sh` 的注释仍在引用旧编号 —— 验证声明若不含脚本与制品，就是自证不实。
- **同一编号在三套基准下必然互相矛盾**：重排时「原 Sprint N」在「重排前 / 用户提案 / 落定」三种编号下含义不同，不显式写「编号基准」就一定会自相矛盾。
- **锚点 id 会与序号脱钩**：条目从 Sprint 5 移到 Sprint 6，锚点仍叫 `s5-*`；不声明「id 前缀 ≠ 当前序号」，后来者就会按前缀反推并改错。
- **文件改名的同步面不能靠直觉，先找仓内同类先例**：最初按「编号改义」的惯例判断「变更记录里的历史叙述应保留旧名」，但仓内对**文件改名**的既有口径相反 —— **全量同步 + 旧名残留 0 处，只在改名记录里保留旧→新映射**（见本文件与 `sdd-scrum-practices.md` 各自 2026-09-21 的改名行）。差别在于：旧**编号**指向不同语义，旧**文件名**指向同一份文件。两条看起来同类的规则可能方向相反，动手前先在历史记录里找同类先例。
- **门禁自己也会坏，而且坏了与「没问题」同形**：官方 E2E 入口 `scripts/portal-e2e.sh` 长期**起不来**（启用自签通道时缺必需配置键 `PORTAL_TEST_JWT_EMAIL`，`config.ts` 校验不过），且**会静默把测试跑在别人的实例上**（无端口预检，就绪探测打到占用该端口的既有实例）⇒ **唯一能自动发现布局类问题的入口等于不存在**，这才是 Issue 8 这类缺陷只能靠肉眼发现的机制性原因。修缺陷时必须一并问「产生它的门禁是否可信」。
- **`make` 会把脚本退出码压平为 2**：`portal-e2e.sh` 的契约是 `0/40/41/30`，但经 `make portal-e2e` 调用后「40 明确跳过」与「41 失败」**不可区分** ⇒ 凡以退出码为契约的入口，机器调用方（CI / 脚本）必须直接调脚本；make 目标只面向人（已写入脚本头注释）。
- **「用测试身份验过」不等于「用真实身份验过」**：2026-09-22 的人手验收用的是 `admin@example.test`，而身份口径随后改为真实邮箱 ⇒ 那次证据失效、必须重做 —— 这正是 `SBI-V1` 一直挂着的真实原因，不是「忘了做」。
- **同一动作在两侧意义不同，混用会得到同形失败**：`make up` 走 `.env.local`（回环 Host + 自签通道），`make portal-dev` 走 `.env`（真身份 + 公网 Host），两者互斥且同占端口；混用时「已认证后仍 403」与「未授权」在页面上同形（本轮实测：公网 302 拦截正常，但后端若为回环配置则认证后 403）。
- **术语必须先定义再使用**：「桥」（会话桥）是设计文档里的既定语汇，但对话中连续使用三轮后用户才明确说「看不懂」⇒ 自造或沿用的**领域词**在首次出现处必须给出通俗解释与真源位置，否则「用户看不懂」会被误判为「用户不理解方案」。
- **重排的同步面比直觉大**：一次批次拆分牵动 `web-stories.md` 故事索引（14 行落点）、`product-backlog.md` 关联列、`web-test.md` 的 D1 落点、`issues-log.md` 批次标题、以及**四个被外部引用的锚点** —— 与「上一轮 Retrospective 写的『重排要重算投影』」是同一件事的具体清单。同时要区分**历史叙述**（ADR、change-log 流水、回顾正文：**不改**）与**活跃引用**（计划/索引/台账：**必改**）。

**下轮改进**
- 新增或重写一份 spec 的编号体系时，同批产出「编号 → 引用方」对照表并逐处回填；只改权威文档不算完成。
- 造编号前先全仓扫同形编号，并在变更记录的**边界**段登记「同名不同义清单」（已登记：`deployment.md` §7.2 S1–S3 · `web-design.md` §5 S4 · `web-test.md` / `sprint-backlog.md` 中沿用该编号的行 · `i18n-probe.sh` 标签 S1–S12）。
- 故事号的 Backlog / Sprint 归属以**引用方的实际回链**为准，不凭语义相近推断（据此把 S3 的 Backlog 归属由 `#3 / #14` 校正为 `#14 / #28`）。
- **立体例判据前先拿已落盘的实例回代**：新判据写完后，逐条检查现有条目是否违反（本轮据此把 `PSP-M2` 改名、给 `PSP-W1` 的判据去掉后一批才交付的动作）。
- **「零残留」「已扫齐」类声明要写明扫描面**（文档 / 脚本 / 制品 / 配置）并真扫到；重排类改动一律在变更记录顶部给「**编号基准**」说明。
- 覆盖率门禁加**边距告警**：实测语句 **92.78** / 阈值 92（边距仅 **0.78pt**）—— 新增代码不同步补测就会踩线；低于「阈值 + 1pt」时应显式提示补测。薄弱点：`admin-api.ts` 语句 78.07% · `dev-login.ts` 分支 75%。
- 原型**入口清单纳入断言**：本轮 `index.html` 漏了 09-dev-login 卡片（静态断言未抓住 ⇒ `ADR-018` 的「每个入口都能点到」形同未验）⇒ 已补卡片与失败态变体，并把「入口清单 ↔ 页面文件」的对账写成断言。
- **状态回填与交付同批完成**：文档里的「未动代码 / 未做」若不随交付一并更新，下一个读文档的人（包括我自己）会按过期状态汇报 —— 本轮已把四处逐条核实回填。
- **新体例落地后同批回代存量行**：`sdd-scrum-practices.md` §2.1 新增 `范围:名词` 与二值判据后，必须逐条检查已落盘行是否违反（本轮已回代 Sprint 4/5 的拆分行；Sprint 6/7 按 §2.4 第 117 行属非开发 Sprint，保留任务行）。

**UI 迭代轮补充（2026-09-22 同日）**

**本轮做得好**
- 把「UI 难看 / 布局不合理 / 太密」这类主观反馈**先转成可复现的数字**再动手：自建度量脚本（裁切 · 列宽 · 控件高度 · 折行 · 布局几何）与计算样式探针，于是「EN 8 个工具缺示例」被定位为**渲染被裁切**（表 1180px > 容器 952px）而非数据缺失，「控件高度不一致」被定位为三种高度并存（`47 / 36 / 19px`，其中 `select` 根本没有规则）。
- 判定「复制按钮没用参考稿样式」时**不靠读 CSS**：把参考稿真渲染出来、裁同一组件并排比对，才查出真因是上一轮把 `.codeblock` 的 8px 圆角误压平（两处 CSS 逐字相同，只读代码必然误判）。
- 每轮修完**把新断言写回验收脚本**：新增的 4 条断言当场抓出我自己修得不彻底的两处（表格仍溢出、居中导致窄屏撑破）。

**本轮学到**
- **「类名在原型里用了、CSS 里没有规则」是本轮最多缺陷的共同形态**：`.dialog-actions` / `.dialog-target` / `.btn-danger` / `.section` / `select` 五处皆如此，分别表现为「贴死 / 无区别 / 破坏性按钮与主按钮同形 / 标题贴上文 / 下拉框原生 19px」。造组件后必须回扫「类名 ↔ 规则」对账。
- **布局类断言用 `is_visible()` 会给出假绿** —— 溢出容器内的元素仍算「可见」，所以「第三列被推出视口」能长期漏检 ⇒ 必须断言 `scrollWidth <= clientWidth` **且**元素右缘在视口内。
- **网格项上的 `margin-inline: auto` 会取消 stretch**：元素转为 `fit-content` 定宽 —— 居中反而被用户感知为「内容变窄」，且窄屏下 min-content 会撑破视口（实测 390px 视口下 `.content` 变 696px）。
- **`rem` 基准是 17px 而非 16px**：按 16px 估算会系统性偏小（本轮在验收阈值上踩过一次，已写入 `web-design.md` §13.1 的易错点）。

**下轮改进**
- 新增 CSS 组件时，除规则本身外必须登记**「缺失时的表现」**（本轮 §13.9 已按此体例补记）；布局类断言统一采用「容器不溢出 + 元素在视口内」双条件。
- 交付前把「一次性验收脚本」与「本地参考素材」显式列入**不入库清单**，避免公开仓误带他方品牌资产。

**PSP-W1 实现轮补充（2026-09-22 同日）**

**本轮做得好**
- 把「设计包落成代码」当成**逐条对照规范**的活：路由表（§12.3）、数据模型（§4.4）、目录布局（§12.2）、令牌规范（§4.1）全按既定文本落，每个 AC 都能指到一条测试 —— 没有一处「顺手重新设计」。
- 防线按**顺序**实现并**用实测验证顺序**：未认证访问 `/admin/*` 返回 **401 而非 404**（身份先于路由）、MCP 域名带有效断言仍 **403**（面隔离先于身份）。这两条只能实测，读代码看不出来。
- 安全关键处主动找反证：代码评审构造「并发重复建用户」窗口，抓到**「失败方删掉对手刚建好的目录」**这一安全级缺陷，并留下回归测试（区分「本来就在」与「本次创建」）。
- 一次性机密（令牌明文）的实现形态由约束反推：**不能走 PRG 回跳**，只能「在产生它的那次响应里展示」；E2E 专门断言「刷新后明文不再出现」。
- 本批成立不了的前置检查（embeddings / 二进制版本 / 模板断言）在启动自检里显式登记为 `deferred`，**不伪装通过**；在线套件缺前置时同样以退出码 40 显式跳过。

**本轮学到**
- **同一件事在文档与实现里各写一次，就一定会分叉**：词表键名、`43 字符` 的口径、`:root` 令牌清单、环境键清单本轮各出过一次偏差。收口办法不是「下次注意」，而是**加可机械核对的护栏**（模板字面量键存在性 · 四语言键集合一致 · `:root` 变量数 == 文档总表 · 中文变体不出现「令牌/權杖」）。
- **缺键/缺配置必须 fail-loud**：静默回落会把「键名打错」伪装成「文案待补」（`nav.mcp` 就这样躲过了类型检查，最后靠视觉自检才发现）。
- **E2E 的环境是隐式输入**：无头浏览器不发 `Accept-Language` ⇒ 门户回落默认语言 ⇒ 英文断言全挂（页面本身没错）；跨步骤写入的 cookie 也会污染后续断言。E2E 必须显式固定语言与状态。
- 「整页截图里粘性页脚压在内容上」「`rem` 按 16px 折算偏小」这类**看起来像缺陷的正常现象**，要先测量/截图排除，再决定改不改。

**下轮改进**
- 新增任何「文档列清单、代码也列清单」的东西（环境键 / 字段 / 词表 / 令牌变量）时，**同批产出护栏断言**，并在变更记录里写明「护栏在哪」。
- E2E 与集成测试的断言**默认语言无关或显式固定语言**；跨步骤共享 cookie 的用例逐步显式声明前置状态。
- 交付前逐项确认「本批成立不了的前置检查」已登记在**产品文档**（不只写在代码注释或自检输出里）。
- 在线验收（隧道 + Service Token）应在**具备前置的机器**上跑一次并留存证据；本机未装 `cloudflared` ⇒ 该项以退出码 40 跳过，**登记为待办而非「已验」**。
- 可复用教训已沉淀至 [`knowledge/web-portal/portal-implementation-notes.md`](./knowledge/web-portal/portal-implementation-notes.md)，身份口径决议见 [`ADR-014`](./adr/ADR-014-portal-admin-identity-verified-assertion-only.md)。

**SBI 颗粒度复盘（2026-09-23，用户提出并定稿）**

**本轮学到**
- **批次的实际装载量与它写下的交付判据会严重脱节**：`PSP-W1` 的判据是一行五步闭环（建用户 → 签发 → 列出 → 轮换 → 吊销即失效），但同一批实际还装了两条本机测试路径、cloudflared 隧道与 Cloudflare Access 真身份、开发登录入口、401 自诊断、覆盖率门禁、UI 迭代三轮、身份收口（真实邮箱 + 生产护栏）、弹窗版式与布局护栏 —— **至少 9 个本可独立交付的增量挤在一批里，判据一行没改**（清单与代价见 [`ADR-016`](./adr/ADR-016-sbi-delivery-granularity.md)）。
- **装载量失控的痕迹本就在回顾里**：本 Sprint 出现三轮「**同日补充**」（UI 迭代轮 / `PSP-W1` 实现轮 / 身份收口）—— 每出现一次，就是一批在收口期又吸收了新工作，而判据与证据没有同步重述。
- **代价最终落在最基础的增量上**：`Issue 6 [FATAL] 无法登录` 直到批次中段才暴露 —— 因为「**人能不能登录**」这个最该先交付的增量排在一堆别的增量之后；而当时的「已验」建立在 curl（请求头）与 Playwright（程序化 cookie）上，**两者都绕过了人手**。
- 用户结论（定稿口径）：**颗粒度太大，导致增量交付遇到很多问题** —— 批次里既有技术复杂度高的功能，也包含了太多功能；再来一次应**分解到颗粒度更细的 SBI**。

**下轮改进**
- 后续 Sprint 的 ToDo 行**按 SBI 拆分**：保留 PSP 的「有接收方 + 端到端判据」形式，把范围收到一件事；判据见 [`sdd-scrum-practices.md`](./sdd-scrum-practices.md) §2.4 与 [`ADR-016`](./adr/ADR-016-sbi-delivery-granularity.md)。
- **技术复杂度隔离**：一个 SBI 最多首次引入一项技术 / 外部系统 —— 隧道与真身份接入、跨进程桥、并发与安全各自单独成批。
- 收口期内新发现的工作**不得**并入正在收口的批次（禁止「同日补充」），必须登记为新 SBI。
- 既有 `PSP-*` 批次**不重排**（历史不改），且已按本规则重排的在飞计划见 [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) 的阶段 2/3。
- **高复杂度先开探针 SBI**：标记为「技术复杂度高」的工作（首次引入外部系统 / 跨进程跨网络 / 并发与安全 / 依赖本机环境状态），先交付一个**只回答一个可证伪问题、产物可丢弃、结论落档（命令 + 输出）**的探针，探针结论为「通」才开真实开发 SBI —— 见 [`ADR-017`](./adr/ADR-017-complexity-probe-before-real-build.md)（实证即本轮那次「网络不通」误判：结论本可用几条命令证伪）。

**UI 质量复盘（2026-09-23，用户提出并定稿）**

**本轮学到**
- **UI 在交付后被动了三轮**：Sprint 4 `#5` 的闭环证据写的就是「三轮用户反馈驱动（色系 / 版式 / 外框）」—— 这本身是「**UI 没有增量确认**」的代价；且每轮输入都是笼统的「太难看 / 太密」，最后靠**自建度量脚本**（裁切 / 列宽 / 控件高度 / 折行 / 几何）把主观反馈转成数字才收敛。
- **原型是「可看」的，不是「可走」的**：134 项断言全是**渲染结果**，不含「点第二次 / 提交后落点 / 错误落在哪里 / 刷新后状态」⇒ 交互类缺陷只能等真实实现才暴露：相对链接点第二次 404（Issue 5）· 重名报错被弹窗遮罩盖住 · 长值撑出边框（Issue 8）· 宽弹窗里目标块留白难看（评审）—— **全是这一类**。
- **「遗漏细节后补」的形态很集中**：原型侧一轮审计抓出 **5 处**「类名在原型里用了、CSS 里没有规则」（`.dialog-actions` / `.dialog-target` / `.btn-danger` / `.section` / `select`），每处都是可见版面缺陷。
- 用户结论（定稿口径）：**UI 也是增量式确认**；**把 mockup 变成真实可点击、覆盖全路径的仿真**，早发现问题。

**下轮改进**
- 原型按 [`ADR-018`](./adr/ADR-018-mockup-as-clickable-simulation.md) 升级为**可点击的全路径仿真**（成功 / 失败 / 刷新 / 返回 / **同一入口的第二次操作**），断言从静态渲染扩展到交互路径。
- UI 相关的每个 SBI 交付后**当批确认**（给可点的原型 + 截图），不得累积到批次末或交付后。
- 新组件必须同时登记「缺失规则时的表现」；两份 `portal.css` 保持 sha256 一致（沿用既有纪律）。
- **原型仿真不替代实现侧护栏**：原型断言全绿的同时实现侧仍可能溢出（Issue 8 实测）⇒ 两侧断言都要在。

**缺陷逃逸复盘（2026-09-23，用户提出并定稿）**

**本轮学到**
- **逃逸的都是低级缺陷，共同根因是「那条约束没人写」**：重名建用户看不到报错（错误渲染在弹窗**外**，被遮罩盖住）· 「停用用户还能签发」被判定为缺陷（`D13` 只写了「停用可逆」，没写**停用期间允许哪些动作** ⇒ 两种理解都能自圆其说）· 长值撑出边框 · 弹窗点第二次到 API 地址 —— 分别对应「冲突/重复如何处理」「错误提示出现在哪里」「状态前置条件」「二次操作落点」，**四类都没在 spec 里写明**，实现只能自行假定。
- **「没有在开发中被捕获」有结构性原因，不只是不够细心**：当时唯一能自动发现布局类问题的端到端入口（`scripts/portal-e2e.sh`）**起不来**（缺必需配置键 `PORTAL_TEST_JWT_EMAIL`），且会**静默把测试跑在别人的实例上**（本机 8788 长期被一个 `--dev-login` 实例占用）—— **门禁带病运行，等于门禁不存在**。
- **覆盖率绿灯 ≠ 覆盖到缺陷面**：门禁当时已达标（语句 92.78 / 分支 85.90 / 函数 97.76 / 行 94.26），但布局、交互、二次操作这类缺陷**不在 vitest 的覆盖范围内** —— 它们只有端到端才会暴露。
- 用户结论（定稿口径）：**尽可能在 mockup 阶段就发现问题**；**提高 e2e 测试覆盖率**；**在设计 spec 中写明白 common sense 可以写出的基本设计约束**（如 CRUD 重复 ID 如何处理、错误提示如何处理）。

**下轮改进**
- 设计 spec 按 [`ADR-019`](./adr/ADR-019-spec-basic-constraints-and-executable-uptake.md) 补齐**四类基本约束**（重复/冲突 · 不存在 · 非法输入 · 并发与二次操作）与**状态前置条件**，错误呈现写明位置与口径。
- **每条约束配一条可执行承接**：用户可见者必须是**真实浏览器端到端**用例 —— 以「按约束补 E2E」代替笼统追覆盖率数字。
- **门禁本身纳入养护**：端到端入口必须「起得来、不静默测错实例」（已由 `portal-e2e.sh` 的 fail-loud 修复落地，退出码 30）。
- 实现中若必须假定未写明的行为 ⇒ **先回写 spec 再实现**。

**Replan 复盘（2026-09-23，用户提出并定稿）**

**本轮学到**
- **「一个 Sprint 一个闭环」与「Sprint 内颗粒度」是两个正交判据，只看一个必然切错**：把「上线」整体压进 Sprint 4 确实消除了跨 Sprint 依赖，却让该 Sprint **首次引入 3 项新技术**（跨进程桥 · 容器镜像构建 · Cloudflare Access 真身份），直接违反 [`ADR-016`](./adr/ADR-016-sbi-delivery-granularity.md) 的「一个 SBI 最多首次引入一项技术」。最终采用的切法是：**Sprint 4 = 可上线的产物（首次引入 1 项：桥）· Sprint 5 = 上线（镜像与真身份）· Sprint 6 = 运营与口径**。
- **依赖链的长度由「同一件事被切成几段」决定，而不是由「上线排在第几个 Sprint」决定**：本次诊断的关键一步不是问「上线为什么在 Sprint 6」，而是问「**为什么桥在 Sprint 4、合跑在 Sprint 5**」—— 桥与合跑本是同一件事（让链路通），被切成两段才是 4 跳链的真正成因。合并后依赖链自然从 4 跳降为直线。
- **同一件事的「判据面」与「实测面」会分置两个 Sprint 而无人察觉**：`deploy:用户规模上限`（原 Sprint 4 `4.8`）与 `用户规模上限定值`（原 Sprint 6 `#10`）是同一件事，本次重排时才发现并**合并为一行**。这类重复只在把两条并排时暴露，靠逐条阅读永远看不出来。
- **重排的扫描面必须包含脚本与注释**：上一轮 Replan 就漏过 [`../scripts/limits-probe.sh`](../scripts/limits-probe.sh) 的输出串与 [`../scripts/maintain-user-dbs.sh`](../scripts/maintain-user-dbs.sh) 的注释（当时已作为教训写入回顾），本轮把它们纳入扫描面并修掉 —— **教训写下来不等于下次会自动执行**。
- **门禁会在新写的记录里反过来抓错**：本轮新写的变更记录里带了一处通配符链接（`adr/ADR-008-*.md`），被 `make doc-links` 当场拦下。这说明「变更记录」本身也是被门禁覆盖的对象，不能当作纯文本草稿写。

**下轮改进**
- 重排前**先画依赖链并数跳数**；跳数 > 1 时先检查「是不是同一件事被切成了多段」，再决定是否合并，而不是直接调整 Sprint 顺序。
- 新批次的「首次引入技术」逐项数清并登记在批次行内：**超过一项就必须拆批**（[`ADR-016`](./adr/ADR-016-sbi-delivery-granularity.md) 已有规则，本次是执行侧的漏检）。
- 重排的扫描面固定包含四类：文档 · 脚本（注释与输出串）· ADR 内的**现行引用**· 制品/配置；并区分「历史叙述不改」与「活跃引用必改」。
- 新增一项机械检查：**同一名词出现在多个 Sprint 时，逐对核对是否为同一件事**（本次据此合并了「用户规模上限」的重复行）。

---

## Sprint 5

Sprint Goal: 全套产品最小 MVP 上线野草云4（生产部署 · 上线验收 · 备份恢复）

> **重排（2026-09-23，用户定稿）**：本 Sprint 目标由「完成 MCP 本地收尾，并与 web-portal 本地联调通过」改为「**生产上线闭环**」—— 原 Sprint 6 承担的部署执行、接入面落地、上线验收与备份闭环**整体前移**至此，与 Sprint 4 交付的产物直接衔接，中途不再隔着别的 Sprint。闭环口径：**受邀用户（1–5 人）可在客户端接入并读写记忆；门户与上游在生产可用；数据可备份、可恢复**。
> **边界（2026-09-23）**：Sprint 4 交付**可上线的产物**（桥本身、合跑与跨用户隔离取证、本地集成验收、上线配置指南）；本 Sprint 只做**把它放到生产上并在生产上验收**（镜像与编排、配置落地、部署执行、上线验收、备份与恢复）。原「本地联调」判据与 Sprint 4 `3.x` 的重叠由本次合并消除。
> **编号口径（重排后）**：本 Sprint 的行一律用 `#N`（`#N` 指**本 Sprint** 的条目编号）。原 `2.x` / `3.x` / `4.1` 三组拆分已解体 —— `3.x` 归入 Sprint 4，`2.2` / `4.1` / `#1` 归入 Sprint 6；`2.1`（上游 HTTP 面封闭）因判据是「部署制品不含端口映射」而留在本 Sprint。
> **执行顺序**：`#1`–`#5` 是**制品准备**（含原 Sprint 4 移入的三项部署判据）；`#6` 探针须在**实际配置**（`#7` / `#8`）之前跑（按 [`ADR-017`](./adr/ADR-017-complexity-probe-before-real-build.md)，真身份链路是本 Sprint 首次引入的外部系统）；`#9`–`#14` 是部署与验收的直线顺序（`#14` 上线验收最后，且为 RID `D5` / `V1` 的执行点）；`#15` / `#16` 是上线后的收尾闭环。

| # | Increment | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **门户镜像与编排制品** | 功能 | 部署 | **镜像契约齐备**：门户镜像以官方上游镜像为底座并 `COPY` 其二进制（`/usr/local/bin/ai-memory`）· 底座为 `bookworm` 系且含 `ca-certificates` · 容器用户 `aimem` 的 UID/GID **与上游镜像对齐** · 不继承上游 `ENTRYPOINT` / `CMD` / `ENV` · **编排可自检**：门户 stack 的 compose 与上游**同网络**（`external: portainer_network`）、**共享 `/data` 卷**、门户库落独立卷且不在 `/data` 下；`docker compose config` 通过 | [`web-portal/web-design.md`](./web-portal/web-design.md) §3 / §11 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.6.3 · [`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) · [`../deploy/portal.env.example`](../deploy/portal.env.example) | 交付给：**运维**。**本行是重排后新识别的最关键缺口** —— 全仓此前**不存在**门户镜像与门户编排制品（Sprint 4 `#1` 已登记「该制品不属设计包」的假设，此后一直未产出）；β′ 启动机制（镜像内带上游二进制）的载体。 | ToDo |
| 2 | **deploy:制品契约** | 功能 | 部署 | **版本号由锁注入**：镜像 tag 取自 [`../upstream.lock`](../upstream.lock)，不继承上游默认值 · **不一致拒绝启动** · **用户标识对齐**：门户与上游镜像 uid/gid 一致 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S12 `AC12.1`–`AC12.3` | 交付给：**运维**。原 Sprint 4 `4.4`（重排 2026-09-23 移入：判据依赖镜像本体）。 | ToDo |
| 3 | **deploy:门户库边界** | 功能 | 部署 | **库位置合规**：门户库位于独立卷且不在 `/data` 下 · **误放被阻断**：门户库被放进用户数据目录时启动失败 · **备份不含它**：遍历用户库的备份不包含门户库 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S9 `AC9.1`–`AC9.4` | 交付给：**运维**。原 Sprint 4 `4.5`（重排移入：与卷和备份同批验收）。 | ToDo |
| 4 | **deploy:容器攻击面** | 功能 | 部署 | **三项零出现**：无 docker socket · 以非特权用户运行 · 按最小依赖与资源限额运行 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S13 `AC13.1`–`AC13.3` | 交付给：**运维**。原 Sprint 4 `4.6`（重排移入）。`AC13.1` 由原 `#3` 移入，使本功能的三条 AC 落在同一行。 | ToDo |
| 5 | **mcp:上游 HTTP 面封闭** | 功能 | MCP | **对外不可达**：上游自身 HTTP 面（`serve` 的 9077）从公网不可达 · **制品无映射**：部署制品不包含该端口的映射 | [`deployment.md`](./deployment.md) §3 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §1 | 交付给：**运维**。原 `2.1`（重排后编号）；因判据落在部署制品上而留在本 Sprint。 | ToDo |
| 6 | **deploy:在线链路探针** | 研究 | 部署 | **一条命令给出判定**：隧道地址可达 **且** Service Token 已加入该 Access 应用策略 · **命令与原始输出落档**（漏配策略的典型表现是 302 而非 200） | [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8 `SBI-V2P` · [`adr/ADR-017`](./adr/ADR-017-complexity-probe-before-real-build.md) | 交付给：本表 `#13`。按 [`ADR-017`](./adr/ADR-017-complexity-probe-before-real-build.md) 先于真实配置：真身份链路是本 Sprint 首次引入的外部系统。 | ToDo |
| 7 | **SSH 密钥对（调用者 ↔ 野草云4）** | 阻塞 | 安全 | **可握手**：无 passphrase + forced command；`ssh ai-memory` 可完成 MCP 握手 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2 · Sprint 4 `4.4`（配置指南） | 交付给：本表 `#12`。用户口径（2026-09-23）「我都有」⇒ 按 Sprint 4 `4.4` 的指南配置后即可就绪；本行作为**阻塞类**显式跟踪。 | ToDo |
| 8 | **OSS 私有桶（香港 region + SSE）+ RAM 子账号 AK** | 阻塞 | 安全 | **桶为私有 + SSE 已开**；AK 仅存服务器侧，不入仓 | [`deployment.md`](./deployment.md) §8 · 云资源准备清单见 [`../deploy/README.md`](../deploy/README.md) | 交付给：本表 `#15` / `#16`。用户口径（2026-09-23）「我都有」⇒ 按 Sprint 4 `4.4` 的指南配置后即可就绪。 | ToDo |
| 9 | **deploy:上线准备包** | 任务 | 部署 | **预演通过**：生产模板按 [`deployment.md`](./deployment.md) §12.2 预演通过（挂载 / env / 启动自检）· **清单列出**：三份验收清单的待执行项已列清 · **回滚成文**：回滚点与回滚步骤已成文（回滚**必须**用快照覆盖） | [`deployment.md`](./deployment.md) §9 / §12.2 | 上线动作的输入物；与 `#14` 配对使用。原 Sprint 6 `#2`（重排 2026-09-23 前移）。 | ToDo |
| 10 | **deploy:部署执行（ai-memory）** | 任务 | 部署 | **八步落地**：[`deployment.md`](./deployment.md) §3 八步落地 · **冒烟全绿**：§7.3 冒烟全绿 | [`deployment.md`](./deployment.md) §3 · [`../deploy/README.md`](../deploy/README.md) | 原 Sprint 6 `#6`（重排前移）。 | ToDo |
| 11 | **deploy:admin portal 部署 + 多用户隔离落地** | 功能 | 部署 | **闭环走通**：走通「签发 key → 建立会话 → 隔离生效」· **验收通过**：通过 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 与 [`web-portal/web-test.md`](./web-portal/web-test.md) §3 | `product-backlog.md` #4 / #26 | 原 Sprint 6 `#7`（重排前移）。隔离的本地负向回归（V1）已在 Sprint 3 定型，本行在生产卷上复验。 | ToDo |
| 12 | <a id="s5-access-surfaces"></a>**deploy:接入面落地（HTTP MCP + SSH stdio）** | 功能 | 部署 | **两条路径均可用**：都能完成 MCP 握手并成功读写 · **降级不失效**：停掉门户后 SSH 路径仍可用 | `product-backlog.md` #14 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S3 / S8 · [`web-portal/web-design.md`](./web-portal/web-design.md) §2 | 原 Sprint 6 `#8`（重排前移）。交付给：**受邀用户**。 | ToDo |
| 13 | **deploy:在线链路验收** | 功能 | 部署 | **退出码为 0**：[`../scripts/portal-e2e.sh`](../scripts/portal-e2e.sh) `--online` 全部通过（不得以 40 跳过） · **人工 SSO 留证**：用真实邮箱走一次公网登录并留截图 | [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8 `SBI-V2` · [RID `D6`](#rid-registry) | 交付给：**上线验收**（与 RID `D6` 同一落点）。依赖本表 `#6`。 | ToDo |
| 14 | <a id="s5-production-acceptance"></a>**deploy:上线验收** | 任务 | 部署 | **三份清单全通过**：[`deployment.md`](./deployment.md) §7.3 冒烟 + [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 + [`web-portal/web-test.md`](./web-portal/web-test.md) §3 · **工具数核对**：用 `initialize` 回包核对对外模板实际暴露的工具数（用户 `core` = 8 / 管理员 `admin` = 22）· **同时作为 `D5` / `V1` 的执行点** | `product-backlog.md` #26 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S7 | 原 Sprint 6 `#11`（重排前移）。承接 Sprint 2「对外能力清单定稿」在生产侧的唯一剩余项。 | ToDo |
| 15 | **backup:备份脚本** | 任务 | 部署 | **两脚本可重复执行**：`backup-and-push.sh`（快照 → sha256 → ossutil 上传 → **回读比对** → 失败非零退出）与 `restore-drill.sh`（拉最新 → 校验 → restore → `doctor` 通过）· **入口可用**：`make backup` / `make restore-drill` · **遍历范围**：遍历 `/data/users/*` | `product-backlog.md` #9 · [`deployment.md`](./deployment.md) §8 | 原 Sprint 6 `#5`（重排前移）。 | ToDo |
| 16 | **backup:备份与恢复落地（含首次外迁与恢复演练）** | 功能 | 部署 | **逐库快照 + manifest**；**门户自身库**（与用户记忆库分离存放）纳入同一外迁流程 · **量化指标落地**：RPO ≤ 24h / RTO ≤ 2h / 日备 30 代 + 月备 12 代 · **演练可重复且通过** | `product-backlog.md` #9 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S9 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.4 | 原 Sprint 6 `#9`（重排前移）。交付给：**运维**。上线闭环的收尾行。 | ToDo |

> **执行本 Sprint 时须核对的静默失败点**：`deployment.md` §7.2 的三个（embedder 降级、curator fail-open `tagged=0`、config 挂载路径错误导致 tier 退回 semantic）+ 本文件 RID Registry 的 **R1**。**上线前 D5 必须关闭**：本地负向验证未通过则不得上线。本段随上线内容自原 Sprint 6 前移（重排 2026-09-23）。

### Retrospective

**本轮学到**
- 待填（本 Sprint 结束时补）。

**下轮改进**
- 待填。

---

## Sprint 6

Sprint Goal: 门户运营闭环与对外口径定稿

### ToDo

> **重排（2026-09-23，用户定稿）**：本 Sprint 目标由「本地集成验收、生产上线与备份闭环」改为「**门户运营闭环与对外口径定稿**」—— 上线与备份内容**整体前移至 Sprint 5**（与 Sprint 4 的产物直接衔接），本 Sprint 只保留**不阻塞上线**的运营、容量、界面与文档收口项，并承接原 Sprint 5 的 MCP 侧收尾。闭环口径：**运营可见可控（审计 · 容量 · 限额）＋ 对外口径与承诺全部定稿（零悬空）**。
> **边界（2026-09-23）**：本 Sprint **不依赖 Sprint 5 的产出即可开工**（唯一例外是 `#1` 的「会话行」部分需要线上会话数据，见该行说明）—— 它是「把已上线的产品运营好、把口径写准」，不是继续加功能。
> **编号口径（重排后）**：本 Sprint 的行一律用 `#N`。原 Sprint 6 的 `#1`–`#11` 已按性质拆分 —— 上线相关者（`#1` 集成验收 → Sprint 4；`#2` 准备包 / `#3` `#4` 阻塞 / `#5` `#9` 备份 / `#6`–`#8` 部署 / `#11` 上线验收 → Sprint 5）全部前移，**仅 `#10`（用户规模上限定值）留在本 Sprint**，并与原 Sprint 4 的 `4.8` 合并为一行（见该行说明）。
> **执行顺序**：`#1`–`#5`（运营与容量）· `#6`–`#8`（界面收口）· `#9`–`#11`（MCP 侧收尾）· `#12`–`#15`（身份与排期文档）四组**互不依赖**，可任意顺序；`#15` 排期回填应在其余行落定后执行（它核对的正是本文件与 [`product-backlog.md`](./product-backlog.md) 的投影一致性）。

| # | Increment | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | <a id="s4-audit-view"></a>**web-portal:审计功能** | 功能 | Web App | **四类事件可查**：建用户 / 签发 / 轮换 / 吊销均可查，每条含时间、操作者、目标 · **敏感内容零出现**：审计记录与运行日志不含令牌明文与记忆正文，令牌仅以 `key_prefix` 出现 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S5 `AC5.1` / `AC5.3` · [`web-portal/web-test.md`](./web-portal/web-test.md) `TC-P-L0-05` | 交付给：**管理员**。原 Sprint 4 `4.1`（重排 2026-09-23 移入：运营可见性，不阻塞接入）。**会话行**（`AC5.2`，含解析出的库路径）依赖 Sprint 4 `3.x` 交付的 `mcp:会话桥` ⇒ 前置已具备。 | ToDo |
| 2 | **mcp:配额透传** | 功能 | MCP | **上游拒绝可见**：上游配额超限时写入被拒并返回可读的配额错误 · **门户不自建计数器**：该拒绝不依赖门户自建的重复计数器 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S7 `AC7.1` | 交付给：**用户**。原 Sprint 4 `3.6`（重排移入：与配额 / 容量同族）。 | ToDo |
| 3 | **deploy:磁盘配额方案** | 研究 | 部署 | **方案定稿并登记**：存在覆盖 WAL 与临时文件的文件系统级配额方案且已落文档 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S7 `AC7.4` | 交付给：**运维**。原 Sprint 4 `4.7`（重排移入：1–5 人规模下非阻塞）。 | ToDo |
| 4 | **deploy:用户规模上限** | 研究 | 容量 | **上限有实测依据**：给出单库体积 / WAL 增长 / 并发会话内存占用的实测数据 · **超限被拒**：创建用户达上限时拒绝并给出原因 · **定值已回填**：本行描述与 [`web-portal/web-design.md`](./web-portal/web-design.md) §7 同步为定值 | `product-backlog.md` #29 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S7 `AC7.5` · [`web-portal/web-design.md`](./web-portal/web-design.md) §7 | 交付给：**运维**。**由原 Sprint 4 `4.8` 与原 Sprint 6 `#10` 合并为一行**（重排 2026-09-23：两者是同一件事的「判据面」与「实测面」，此前分置两处，属同一事实两处写法）。 | ToDo |
| 5 | **mcp:限流结论** | 研究 | MCP | **结论已登记**：明确上游全局准入并发上限对 stdio 是否生效 · **可复跑**：结论附命令与出处 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S7 `AC7.2` · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-D | 交付给：**运维**。原 Sprint 4 `4.9`（重排移入）。 | ToDo |
| 6 | **web-portal:UI 设计系统** | 功能 | Web App | **断言全绿**：原型断言通过 · **两份 CSS 逐文件一致**：sha256 相同 · **版式项通过**：`AC14.1`–`AC14.12` 对应断言全部通过 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S14 · [`web-portal/web-design.md`](./web-portal/web-design.md) §13–§15 | 交付给：**评审**。原 Sprint 4 `4.10`（重排移入：设计系统一致性维护，非上线阻塞项）。 | ToDo |
| 7 | **web-portal:界面修正同步** | 任务 | Web App | **两份 CSS 逐文件一致**：sha256 相同 · **Issue 1–5 的界面修正已在原型体现**：停用用户无签发入口且有「恢复访问」· 弹窗内显示失败原因 · 长文本折行 · **原型断言通过** | [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8 `SBI-P2` | 交付给：**评审**。原 Sprint 4 `12`（重排移入：原型侧同步；实现侧修正已在 `#2` PSP-W1 期交付）。 | ToDo |
| 8 | **web-portal:版式同步** | 任务 | Web App | **原型断言全绿**：复跑通过 · **目标块渲染一致**：实现与原型均为「同列即同一字段」 | [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8 `SBI-P3` | 交付给：**评审**。原 Sprint 4 `13`（重排移入）。依赖本表 `#7`。 | ToDo |
| 9 | **MCP 侧设计包定稿** | 任务 | MCP | **四份交付物定稿**：① MCP 侧 story-mapping（剩余条目与批次归属表，正文落 [`mcp/mcp-stories.md`](./mcp/mcp-stories.md)）② 技术设计 ③ 测试方案 ④ 部署方案 | [`mcp/mcp-stories.md`](./mcp/mcp-stories.md) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) · [`mcp/mcp-test.md`](./mcp/mcp-test.md) | 交付给：**评审与实现期**。原 Sprint 5 `#1`（重排移入：与 Sprint 4 `#1` 同判据 —— 四份正文均已在位，本轮只需**逐项核对并给出「定稿」结论**）。 | ToDo |
| 10 | **deploy:定制口径门禁** | 功能 | 部署 | **门禁可执行**：工作树只读干净 / 升级预检通过 / 例外均有登记 · **文档与制品一致**：[`deployment.md`](./deployment.md) 与部署制品逐字段一致 | `product-backlog.md` #30 / #31 · [`deployment.md`](./deployment.md) §5 / §7 | 交付给：**运维**。原 Sprint 5 `2.2`（重排移入）。 | ToDo |
| 11 | **mcp:工具可达性矩阵** | 研究 | MCP | **矩阵完整**：「中文 vs 英文提问 × 对外 8 项工具」每格均有结论 · **落地指向已登记**：指向客户端指引则回填门户接入说明页；指向协议层改写则先立 ADR 再实现 | [`mcp/mcp-stories.md`](./mcp/mcp-stories.md) `MS6 AC-M6.2` · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8 | 交付给：**非英文用户**。原 Sprint 5 `4.1`（重排移入）。结论决定是否需要新 ADR。 | ToDo |
| 12 | <a id="s4-identity-docs"></a>**web-portal:身份口径 AC** | 任务 | 文档 | **AC 编号连续**：新增 AC 无编号缺口 · **用例零悬空**：每个新 AC 在 [`web-portal/web-test.md`](./web-portal/web-test.md) 有对应用例号 · **四类约束覆盖**：重复冲突 / 不存在 / 非法输入 / 并发与二次操作均有 AC | [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8 `SBI-D1` · [`adr/ADR-019`](./adr/ADR-019-spec-basic-constraints-and-executable-uptake.md) | 交付给：**评审与实现期**。原 Sprint 4 `7`（重排 2026-09-23 移入：文档收口类）。 | ToDo |
| 13 | **web-portal:认证模型口径** | 任务 | 文档 | **三处口径与实现一致**：开发登录入口边界 / `PORTAL_TEST_JWT_EMAIL` / 身份来源护栏 · **互链有效**：[`web-portal/web-design.md`](./web-portal/web-design.md) §6 与 [`adr/ADR-015`](./adr/ADR-015-dev-login-entry-config-gated-registration.md) 互相链接 | [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8 `SBI-D2` | 交付给：**评审**。原 Sprint 4 `8`（重排移入）。 | ToDo |
| 14 | **web-portal:身份用例登记** | 任务 | 文档 | **用例名可指认**：真实邮箱 / 缺配置拒绝 / 生产来源拒绝 / 审计 actor 四条各指向 `admin_portal/tests` 中的实际用例名 | [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8 `SBI-D3` | 交付给：**实现期与验收**。原 Sprint 4 `9`（重排移入）。 | ToDo |
| 15 | **web-portal:排期回填** | 任务 | 文档 | **两文件投影一致**：本文件与 [`product-backlog.md`](./product-backlog.md) 的排期投影一致 · **判据含身份要点**：Sprint 4 `#2` 行含「真实邮箱 + 生产护栏」判据要点 | [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) §8 `SBI-D4` | 交付给：**排期**。原 Sprint 4 `10`（重排移入）；其判据原文写「本 Sprint `#2` 行」，重排后该行位于 Sprint 4 ⇒ 措辞已随本轮重排订正。 | ToDo |

### Retrospective

**本轮学到**
- 待填（本 Sprint 结束时补）。

**下轮改进**
- 待填。

---

## Sprint 7

Sprint Goal: 升级治理闭环

### ToDo

> **执行顺序**：#1 / #2 可独立；#3 是本 Sprint 的骨架；#4 / #5 依赖 #3；#6 的产物是升级链路的输入，随 #3 一起验收。每次升级时按 `product-backlog.md` #31 的口径门禁执行一次。

| # | Increment | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 上游升级**邮件**提醒 | 功能 | 治理 | 检测到「适合升级」的上游版本时发出邮件（现状只有 GitHub issue，不满足需求） | `product-backlog.md` #21 · `deployment.md` §9.1 | — | ToDo |
| 2 | **历次版本升级跟踪与记录**（过程资产） | 功能 | 治理 | 每次升级留痕：版本 / 日期 / 判据结论 / 详细步骤 / 验证结果 / 回滚点 | `product-backlog.md` #22 · `deployment.md` §9 | — | ToDo |
| 3 | **最低耦合、尽量自动化的升级方案** | 功能 | 治理 | 一次升级可在「改 [`../upstream.lock`](../upstream.lock) → 跑预检 → 重建/重启」内完成，无需手工比对版本号；门户镜像重建纳入同一条链路 | `product-backlog.md` #23 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S12 · `adr/ADR-004-version-contract-single-source-of-truth.md` | — | ToDo |
| 4 | **制定部署/升级方案与脚本** | 任务 | 治理 | 相关脚本落地且可重复执行 | `product-backlog.md` #24 · `deployment.md` §9 | — | ToDo |
| 5 | **升级方案端到端验证并文档化** | 任务 | 治理 | 完整演练一次升级（预检 → 部署 → 验收 → **回滚演练**）并留痕。**注意**：回滚**必须**用快照覆盖 —— 上游不拒绝「比自身更新的库」（旧二进制会静默读写不认识的 schema） | `product-backlog.md` #25 · `knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md` | — | ToDo |
| 6 | **升级治理：门户镜像随上游重建** | 功能 | 治理 | 门户镜像的构建从 [`../upstream.lock`](../upstream.lock) 注入 tag；升级清单含「重建门户镜像」一步并被演练过，避免门户与部署制品版本漂移 | `product-backlog.md` #18 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S11 / S12 · [`web-portal/web-design.md`](./web-portal/web-design.md) §11 | 由原 Sprint 4 下移；其产物是升级链路的输入。 | ToDo |

### Retrospective

**本轮学到**
- 待填（本 Sprint 结束时补）。

**下轮改进**
- 待填。

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
| 2026-09-20 | **`mcp_oss_bak_com_requirements.md` 从本仓移除（用户确认）**：该需求规格已随 mcp.oss-bak.com 项目移交移出本仓；同步清理引用 —— `deployment_strategy.md`（决议表 §0 与 2 条变更记录）、`dev-plan.md`（范围变更声明 + 变更记录）、`asset_isolation_plan.md`（目录树 + 迁移清单）、[`deploy/README.md`](../deploy/README.md)、本文件 Sprint 5 #2 的「关联文档」列（改为指向 `dev-plan.md` §4 与 `deploy/README.md` 云资源清单）。历史记录保留原文并标注「已移出本仓」，不改写历史 |
| 2026-09-20 | **Sprint 2 #5 完成（多用户隔离可行性结论）**：结论 = **有条件可实现**，落盘 `multiuser_isolation.md` §0（冻结机制 / D1–D5 条件矩阵 / V1–V4 映射 / 6 项未决前提 / 探针证据）。新增探针 [`../scripts/iso-probe.sh`](../scripts/iso-probe.sh)（与 `mcp-smoke.sh` 同构；A 组负向解析链、B 组方案③双用户物理隔离、C 组方案②对照；退出码 10/20/30/40/50），首次运行全绿。**R1 由「源码推断」升级为「行为级已证」**：漏设 `AI_MEMORY_DB` 时 `doctor --json` 的 `source` 仍为 `/data/ai-memory.db` 且 **rc=0、无任何告警**；反之错设到父目录不存在的路径为 fail-loud（`Storage=critical / failed to open database`，rc=2）——即 **D2（移除 config 的 db 键）是唯一能覆盖"漏设"这一支的手段**。另实测：一用户一 DB 双向检索/get 互不可见且主库计数不变（V2/V3 本地版）、`doctor --json` 的 `source` 可作解析链自证（V4 本地版）、`ai-memory --db <user> stats` 维护通路可用；方案②写路径**可伪造**（bob 以 `agent_id=human:iso-alice` 写入成功并回显身份，alice 随后检索到被注入内容）→ 进一步支撑"必须③而非②"。连带：`multiuser_isolation.md` 升 v1.1（§5.2 冻结口径 / §5.3 维护通路已验 / §7 四项本地预实证 / §8 #1 部分实证） |
| 2026-09-21 | **Sprint 2 新增 #13 / #14 并标记完成**：#13 **需求覆盖审计 + 回溯引用** —— `# 需求` 节 26 条与 Backlog #1–#26 逐条核对无遗漏，「产品概述」层（需求边界 / 用户模型 / 鉴权）带验收条件却原无条目的 5 项补入 **#27–#31**（Backlog 26 → 31 条），第一部分每项需求追加 `→ [Backlog #N 名称](#product-backlog)` 共 **44 处**，并写入「覆盖要求 / 回溯引用」约定（条目名为主、编号为辅）；#14 **文档风格收口** —— 自有 spec + `.codebuddy/plans/` 共 14 文件 **180 处** emoji / 图标改为文字承载（规则表、范围与 1 处显式例外登记在 [`change-log.md`](./change-log.md) `## 2026-09-21`）；执行顺序说明同步改为「…收敛方案（#5–#11），最后做文档收口（#12–#14）」 |
| 2026-09-21 | **Sprint 2 #6 完成（D1 = β′，用户确认）**：决议落 [`architecture.md`](./architecture.md) §2.1 #8（定稿）+ §2.2（排除 α 与「α + 受限代理」）+ §2.3（**三条落地前置**：`/data/users` setgid 引导 / 门户持独立 MaaS key / 版本断言）；[`adr/ADR-012`](./adr/ADR-012-portal-launch-mechanism-no-docker-socket.md) 转 Accepted。研究证据与探针配方落 [`knowledge/web-portal/portal-launch-mechanism.md`](./knowledge/web-portal/portal-launch-mechanism.md)（E1–E7）：镜像契约实测、β′ 端到端跑通、两个缺口、α 代理收窄不可行。连带同步：[`deployment.md`](./deployment.md) §4.4（setgid 引导**替代**原 `NOPASSWD: docker exec -u 0` root 规则）· §7.2（门户侧 embedder 静默降级的新触发路径）· [`web-portal/web-design.md`](./web-portal/web-design.md) §3.2/§3.4/§9 附录 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) AC1.1 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §0.1 |
| 2026-09-20 | **目录改名收口 + specs 整合（对应 Sprint 2 #12）**：自有资产目录 `hk_vps_4/` → `memory.agent-mate.ai/`（41 个 rename；`.gitignore` 的含密/派生规则改为路径无关 `**/deploy/…`；Makefile / CI / 渲染脚本 / scripts / specs 引用全量同步）。specs 由 16 份合并为 8 份 —— `deployment_strategy` + `asset_isolation_plan` + `upstream_coupling_surface`（A–K 契约面）+ `dev-plan`（部分）→ [`architecture.md`](./architecture.md) / [`deployment.md`](./deployment.md)；`multiuser_isolation` + `mcp_tool_inventory` + 契约面全量 → [`mcp/mcp-design.md`](./mcp/mcp-design.md)；`mcp-test.md` → [`mcp/mcp-test.md`](./mcp/mcp-test.md)；`admin_portal_design` → [`web-portal/web-stories.md`](./web-portal/web-stories.md) / [`web-design.md`](./web-portal/web-design.md) / [`web-test.md`](./web-portal/web-test.md)；`deploy/deployment-plan.md` → `deployment.md`，`deploy/README.md` 降为 stub。新增防复发护栏 `make doc-links`（[`../scripts/link-check.sh`](../scripts/link-check.sh) + 允许清单）。**已知遗留**：本文件与 `product-backlog.md`（用户指定零改动）内部仍指向旧文件名，已在允许清单显式登记 |
| 2026-09-21 | **Sprint 2 #8 完成（多语言探针结论）+ #6 key 收尾**：#8 结论 = **部分支持**（存储 / 语义召回 / 按 id 直取三语言全可用；关键词通路按 FTS5 `unicode61` 只认完整词元，词元内子串与简繁交叉不命中；无配置项），可复跑探针 [`../scripts/i18n-probe.sh`](../scripts/i18n-probe.sh) 三次运行全绿（含 STRICT 边界断言与 CONFLICT 幂等），客户端通路交叉复现一致；回写 [`product-backlog.md`](./product-backlog.md) #10（ToDo → Done，授权来源 = 该行 AC「结论回写本行描述」）· [`mcp/mcp-test.md`](./mcp/mcp-test.md) §1 L1.6 + §4-E（TC-I18N-01..06）· [`mcp/mcp-design.md`](./mcp/mcp-design.md) §2 + §9 J4 · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](./knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 多语言专表 · [`architecture.md`](./architecture.md) §4.1。#6 门户专用 key 已填入并双重实测（`qwen-verify.sh --key` → 1024 维同模型；`-e DASHSCOPE_API_KEY` 覆盖注入隔离会话 → 写入 + `mode=hybrid` 召回，无鉴权失败） |
| 2026-09-21 | **Sprint 2 #9 完成（`--profile` 定档）**：决议 = **对外（SSH / 门户统一）`core`（8 项）；管理员另设 `full`（101 项）入口，两条模板分离**。新增只读探针 [`../scripts/profile-probe.sh`](../scripts/profile-probe.sh)（7 档独立进程，只发 `initialize` + `tools/list` + `memory_capabilities`）：实测 core=8 / graph=20 / admin=22 / power=57 / full=101 / `core,lifecycle`=14 / 默认档（不传 `--profile`）= 8 **且不报错**；`--profile` 与 `--tier smart` 并存生效（CLI flag，无需 env 回退）。决议落 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8.1（实测引文）+ §8.3（#1 / #2 由待决策转为已定、#3 验收方式落到 profile-probe、新增 #4 已知限制：core 档不含 `memory_delete` / `memory_forget` / `memory_gc`，日后开放删除的最小增量档是 `core,lifecycle`（14）而非 admin / full）；[`change-log.md`](./change-log.md) 2026-09-21 小节。**AC 的另一半「决议写入门户 / SSH 模板」按用户「只完成 #9、范围最小化」口径移交 Sprint 3 #2（Backlog #12）**，届时一并回写 `product-backlog.md` #12 / #19 描述列（本行未授权改 backlog，故不动） |
| 2026-09-21 | **Sprint 2 #9 收尾（模板定档落盘 + 用户版能力文档）**：管理员入口档位由 `full`（101）改定 **`admin`（22）**（理由：覆盖删除 / 遗忘 / 清理 / 审批即可，Meta / Archive 只读统计类不随管理员入口开放）；`--profile` 已写入四处模板 —— [`deployment.md`](./deployment.md) §4.3、[`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.1–§5.2、[`web-portal/web-design.md`](./web-portal/web-design.md) §3.3、[`mcp/mcp-test.md`](./mcp/mcp-test.md) §3；Sprint 3 #2 标记**提前完成**；新增 [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md)（面向最终用户：档位 + 全量 101 项工具说明 + 例子，门户接入指引页唯一内容源）；`product-backlog.md` #12 → Done、#19 描述补决议（本轮授权改 backlog）；[`change-log.md`](./change-log.md) 2026-09-21 新小节 |
| 2026-09-21 | **Sprint 2 #10 定稿核查 + 两处文档体例改造（#11 扩展）**：① **#10 判定已完成** —— 四项最终决议（档位 `core`（8）/ `admin`（22）、i18n 部分支持、LLM `qwen-plus` + `dim 1024`、备份 OSS 私有桶 + 每日外迁）**均已定稿且有落点**，清单已落入 [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md)；`product-backlog.md` #19 → Done；唯一剩余「生产环境 `initialize` 回包核对」并入 **Sprint 5 #8 上线验收** ② 「阻断级风险」三表（风险 / 防线 / 验证）合并为**单表 11 列**（编号 / 级别 / 类型 / 标题 / 说明 / 影响 / 解决方案 / 验证方法 / 关联文档 / 状态 / 更新日期），R1–R3 + D1–D5 + V1–V4 **全部成行并保留编号**（维持 Sprint 2 #5、Sprint 3 #5/#6、Sprint 5 #5/#8 的引用锚点）；级别由原「严重 / 高」换算为 **致命 / 阻塞 / 严重 / 中**，口径写在表下 ③ **Sprint 1–6 各新增 `Retrospective` 章节**（Sprint 1 / 2 写实际内容，3–6 留占位待填）④ **#11 事项扩展**为含上述 ②③ 与能力文档重构，状态置「进行中」 |
| 2026-09-21 | **Sprint 3 #1 完成（agent attestation 现存路径收口）**：① **口径核对** —— 现存路径全部一致：compose 两处（`ai-memory` / `curator`）、[`deployment.md`](./deployment.md) §4.3 用户行、[`web-portal/web-design.md`](./web-portal/web-design.md) §3.3 门户模板；补 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2 模板的 `-e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`（与 `deployment.md` 用户行**逐字一致**），并在 §5.1 注明单人行**依赖容器级**变量（与管理员行口径一致）② **实测更正两处失准表述** —— `mcp-design.md` §9 B3 原写「不设 → 写入 `403 ATTESTATION_FAILED`」，实测 v0.10.0 为 **surface-scoped**：MCP / CLI 缺省**宽松**（写入成功、不报错）、HTTP direct-write 缺省要求签名、`=1` 为全局严格（拒无签名写入）；v0.11 起缺省才翻转为全 surface required。`mcp-test.md` §4-D **TC-ATT-01** 的判据由「写入返回 `attest_level=claimed`」改为**正负对照**（`=0` 成功 / `=1` 被拒）③ **`attest_level=claimed` 不可观测** —— 该措辞出自上游文档与 daemon 启动告警（仅绑非回环且宽松时打印）；v0.10.0 的 MCP 响应 / `memory_get` / `export` / `memories` 表均无此字段（库内带 `attest_level` 的只有 `memory_links` / `governance_rules` / `signed_events` 等表，且为空或 `unsigned`）④ **护栏落地** —— [`../scripts/mcp-smoke.sh`](../scripts/mcp-smoke.sh) 新增**会话 C**（attestation 正负对照，失败退出码 50）；实跑全绿、退出码 0 ⑤ 结论回写 [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](./knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 与 [`change-log.md`](./change-log.md)，`product-backlog.md` #15 说明按实测更正 |
| 2026-09-21 | **SDD/Scrum 体例收口**：新增 [`sdd-scrum-practices.md`](./sdd-scrum-practices.md) 与 [`ADR-013`](./adr/ADR-013-sdd-scrum-process-doc-boundaries.md)；RID Registry 只保留 R/I/D，解决方案下沉 Product Backlog，V1–V4 归入验收条件；新增 8 条覆盖对照；Sprint 1–6 ToDo 表新增「说明」列，状态列统一为四态枚举 |
| 2026-09-21 | **门户故事号引用订正与补全**：Sprint 4 #6 由 `S3` 改为 `S6`（接入说明页与 i18n）· #8 由 `S9` 改为 `S10 / S13`（面隔离 + 攻击面）；#1 补 `S10` · #5 补 `S7` · #7 补 `S3 / S4` · #9 补 `S11 / S12`。原因：`web-stories.md` 按 ATDD 重写并新增 S10–S13 后，旧号指向的语义已变（转述静默过时）。各条目的「事项 / 验收条件 / 状态」未改 |
| 2026-09-21 | **本文件改名**：`sprint_plan.md` → `sprint-plan.md`，按仓内既有改名口径全量同步引用（16 个文件，含 4 份 ADR 与 3 个脚本）；旧名残留 0 处，只在改名记录里保留旧→新映射 |
| 2026-09-21 | **Sprint 回顾体例与归属校正**：① Sprint 3 回顾由「主块 + 两个补记」合并为**单一聚合**结构（做得好 / 学到 / 下轮改进）；② 门户故事引用收口的回顾按「写入实际交付该工作的 Sprint」由 Sprint 3 迁至 **Sprint 4**；③ Sprint 4 #0「web-portal 设计」的关联文档由纯文本清单改为可点击链接，并补「首个增量已落盘、待整体批准」的说明（状态仍 `ToDo`）。体例见 [`sdd-scrum-practices.md`](./sdd-scrum-practices.md) §2.3 |
| 2026-09-21 | **Sprint 2 #11 收口并关闭（引用治理 + 能力文档体例定稿）**：① **引用治理** —— 本文件与 `product-backlog.md` 中指向已合并旧 spec 的 **85 处**引用全部改指合并后文档（`mcp/mcp-design.md` §5 / §6.2 / §6.4 / §7 / §8 / §9 · `architecture.md` §2 / §5 / §6 · `deployment.md` §3 / §7.2 / §7.3 / §8 / §9 · `web-portal/web-design.md` §2 / §3 / §6 / §11 · `web-portal/web-stories.md` S1–S9 · `web-portal/web-test.md` §2 / §3），历史叙述行只把链接降级为纯文本；`link-check.allow` 的两份整文件豁免随之删除，`make doc-links` = 30 文件 / 491 链接 / **0 悬空**（豁免 4 → 2；落盘回顾文档后复跑 31 文件 / 498 链接仍 0 悬空）② **能力文档体例定稿** —— 6 张档位表、每张只列本档新增、编号全档连续 1–101、示例入表；同步 `change-log.md` / `web-portal/web-stories.md` AC6.4 / `mcp/mcp-design.md` §8 三处转述 ③ **Sprint 2 状态置「已结束」**，本 Sprint「Retrospective」由阶段性回顾改为定稿 |
| 2026-09-22 | **Replan：Sprint 4–7 重排（总数 8 → 7）**：① Sprint 4 改为「完成 web-portal 本地开发」，ToDo 收敛为 `#1` 设计包 + `#2` `PSP-W1「账号与凭证」` / `#3` `PSP-W2「端到端接入」` / `#4` `PSP-W3「可运维、可发布」`（旧 `#0`–`#9` 按功能拆入，编号重排）② Sprint 5 改为「完成 MCP 本地收尾并与 web-portal 本地联调通过」，ToDo 为 `#1` MCP 侧设计包 + `#2` `PSP-M1「接入面与口径定档」` / `#3` `PSP-M2「本地联调」` / `#4` `PSP-M3「工具可达性」` ③ 原 Sprint 6 与 7 **合并**为「本地集成验收、生产上线与备份闭环」（外部前置作为「阻塞」行显式跟踪，并新增本地集成验收、上线准备包、用户规模上限定值）④ 升级治理下移为 Sprint 7。RID Registry 与覆盖对照表的 Sprint 落点同批改指（6 个对外锚点 id 全部保留）；Sprint 3 已由用户于同日提前收口，本次未涉及其条目。体例见 [`sdd-scrum-practices.md`](./sdd-scrum-practices.md) §2.4 |
| 2026-09-22 | **Replan 登记为 Sprint 3 #8（`Done`）**：作为独立过程治理项（同 #7）追溯；Sprint 3 收口说明同步为「#1–#8 全部 `Done`」。回顾落点仍为 Sprint 4 `Retrospective`（见 `sdd-scrum-practices.md` §2.3「写入实际交付该工作的 Sprint」） |
| 2026-09-22 | **specs 一致性审计轮（Sprint 4 `#6`，`Done`）+ 界面上线前收口**：① **跨文档审计** `web-portal/*.md` ↔ `mockups/` ↔ 其他 specs，修掉 **7 处不一致 + 1 处悬空链接** —— 最实质的是 [`deployment.md`](./deployment.md) **缺根凭证要求**（[`web-portal/web-design.md`](./web-portal/web-design.md) §6.1 单方面声明「须落 `deployment.md`」而部署文档没有 ⇒ `AC10.8` 无法验收），故新增 **§12.4 管理面认证（Cloudflare Access）的运维要求**（Access 应用与多邮箱冗余 / 登录方式 / 会话时长档位与「不得把目标当既有能力」/ 增删管理员步骤 / 根凭证离线保存与三层恢复链 / MCP 面必须绕过）与 §13 验收项；另修 §13 的 `logo.png` 例外说明（已随新 logo 失效）、§6.1「门户侧唯一新增」仍写一页只读管理员页（与 `D12` 矛盾）、`product-backlog` #7 仍写「中/英双语」（应为四语言）、故事索引 `TC` 列的串位与漏项（**补 `TC-P-L2-13`**（logo 分档）、`TC-P-L2-11` 挂 `S2`、`S14` 行补齐 8 项、`S6` 行收窄）、`S1`–`S13` → **`S1`–`S14`**。② **机器核对（客观项）**：AC 编号 `AC1.1`–`AC14.12` 连续（缺口仅为已迁出的 `AC3.1/3.2/3.6`、`AC4.1/4.2`）；索引引用的 `TC-P-*` **零悬空**。③ **界面上线前收口**：用户提供的**透明底品牌徽标**同步三处（sha256 一致，原「白底 + 投影」已知项关闭），并修掉它引起的**窄屏顶栏溢出 26px**（新款 aspect `1.246 → 1.93`，`≤720px` 时加 `max-width` 锁回原 footprint）；登记两个**待用户定夺**项（logo 语义重复、品牌色孤岛）。④ 四条门禁与原型验收全绿（`134/134`）；本文件 `as_of` 更新为 2026-09-22 |
| 2026-09-22 | **三处卡点逐项定夺并收口（`#6` 延伸）**：① **logo 语义重复** → **保留**（`AC6.11` 明文要求顶栏出现完整品牌串、`AC14.12` 要求公开页 hero 与管理面顶栏各有一处 logo ⇒ 重复是两条 AC 的**结构性结果**，不是版式写错）；② **品牌色孤岛 `#F6EC34`**（实测占徽标不透明像素 **2.1%**）→ **保留**（`AC14.1` 的 `When` 限定为「扫描所有元素的**计算色值**」，图像像素不在扫描面内 ⇒ 不立强调色令牌、不灰阶化，口径收敛为「UI 无品牌色；品牌资产图像自带色」）；两项已回填 [`web-portal/web-design.md`](./web-portal/web-design.md) §13 开头 / §15 资产表与 [`change-log.md`](./change-log.md)。③ **用例索引缺口修完**：`web-stories` `S4` 行 4 处简写展开为全量（**不改映射**）；3 条 AC 已迁出的孤儿用例（`TC-P-L1-03` / `TC-P-L2-01` / `TC-P-L2-02`）挂到 [`mcp/mcp-stories.md`](./mcp/mcp-stories.md) `MS1` 的「测试用例」列 ⇒ 索引引用与用例定义集合**双向一致（0 悬空 / 0 孤儿）**。**修正三处自述误差**：ⅰ「5 条既有用例未被显式引用」不准确 —— 实为「**4 条简写漏判 + 3 条结构性孤儿**」；ⅱ hero logo 实高 **112px**（本轮口述的 104px 有误，§15 原本记录正确）；ⅲ 本轮 `#6` 的判据由此补齐为「引用与定义**双向一致**」而不仅是「无悬空」 |
| 2026-09-22 | **Sprint 4 `#1` 设计包逐项核对并收口（`Done`）**：① **逐项核对**（证据写进该行「说明」）—— ①story-mapping：`web-stories.md` 14 个故事（`S1`–`S14`）+ 索引 14 行**每行含 Sprint 落点**；②技术设计：§12.0 技术栈定档（关闭 §10 #2）· §2 门户侧会话编排 + [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.6 跨进程契约 · §4.4 数据模型；③UI 设计：`mockups/` 6 页 + §13–§15；④测试方案：§0 L0–L3 · §2 46 条用例 · §3 验收清单，AC↔TC **双向一致**；⑤部署方案：§3 容器与启动（β′ + 三项硬前置 + 四项 fail-closed 自检）· §11 部署九步（含挂载与 env）· [`../deploy/portal.env.example`](../deploy/portal.env.example) —— **五份全部定稿**。② **修正「一个产物两个主人」**：`#1` 的验收条件原写「另含实测项：……**产出**复现矩阵」，与 Sprint 5 `#4 PSP-M3` 的「**产出**矩阵」重复声明同一产物；据 [`mcp/mcp-stories.md`](./mcp/mcp-stories.md) 已知限制第 3 条（「完整矩阵归 Sprint 5 `PSP-M3`；本文件只固定判据」）收敛为 —— `#1` **固定判据与测量口径**、`PSP-M3` **产出矩阵**；Sprint 5 的「执行顺序」与 `#4` 判据同批改指。③ **登记一处假设（可推翻）**：门户 stack 的 compose **制品**（对照 [`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) 的契约级文件，全仓当前不存在）**不属设计包**，归 `#2 PSP-W1` 实现期产出 —— 设计包只给契约点（挂载 / env / 自检） |
| 2026-09-22 | **本文件改名**：`sprint-plan.md` → `sprint-backlog.md`（文件名与仓内「Sprint Backlog」口径对齐）。按仓内既有改名口径全量同步引用（**17 个文件**，含 4 份 ADR 与 3 个脚本）；旧名只在两次改名记录里保留旧→新映射。决议与验证见 [`change-log.md`](./change-log.md) 2026-09-22 同名小节 |
| 2026-09-22 | **Sprint 4 `#2` `PSP-W1「账号与凭证」` 完成（`Done`）**：① **实现落地** —— `admin_portal/` 由「只有 UI 资产」变为可运行门户（Node 22 + TS + Fastify 5 + Nunjucks + `better-sqlite3` + Zod + `jose`，版本按核定钉死；`tsconfig` strict + `exactOptionalPropertyTypes`）；分层为 `shared`（纯逻辑：分面 / 身份 / handle / 令牌 / 审计 / 脱敏）· `web`（routes / views / i18n / db）· `selfcheck`。② **判据逐项达成** —— 闭环「建用户 → 签发（明文只出现一次）→ 列出元信息 → 轮换 → 吊销即时失效」由 **163 项离线测试**与 **Python Playwright 端到端**覆盖；面隔离**先于身份**（403 / 401 顺序已实测）、认证**先于路由**（未认证 `/admin/*` 返回 401 而非 404）；handle 非法与路径穿越被拒且不留痕（`AC1.2`/`AC1.3`）。③ **四项决策落地** —— 本地认证走**命名隧道 + 真 Access 身份**、测试**双层**（离线自签 JWT / 在线 Service Token）、吊销验收走**校验层 + 集成测试**（`/mcp` 路由留 `PSP-W2`）、审计 **fail-closed**（业务写与审计写同事务）。④ **在线边界如实登记** —— 真 Access 链路的端到端需隧道与 Service Token；缺前置时 `make portal-e2e ARGS=--online` 以**退出码 40 明确跳过**，`web-test.md` 同步登记「离线不覆盖真 Access 链路」。⑤ **文档同步** —— `web-design.md` §12.6 审计策略定档 / §12.0 库驱动定档 / §12.9 后新增本地认证口径 / §13.1 令牌收口落地；`web-test.md` 新增 `TC-P-L1-14` 并修 `S10` 索引用例归属；`admin_portal/README.md` 补应用结构、运行方式与本地认证 runbook |
| 2026-09-23 | **Replan：Sprint 4–6 重写为「上线产物 / 生产上线 / 运营与口径」（Sprint 总数不变）**：① **Sprint 4** 目标由「完成 web-portal 本地开发」改为「**交付可上线的全套产品最小 MVP（接入链路跑通 + 隔离取证）**」—— 原 Sprint 5 的「全链路联通」「跨用户隔离」并入（`3.6` / `3.7`），原 Sprint 6 的「本地完整集成验收」前移（`#8`），新增 `3.5` 桥可行性探针（按 [`ADR-017`](./adr/ADR-017-complexity-probe-before-real-build.md)）与 `4.4` 上线配置指南（用户口径：三项外部前置「我都有，但需要详细的指南如何配置」）；移出 12 行，落点见该 Sprint 末「移出登记」。② **Sprint 5** 目标由「完成 MCP 本地收尾并与 web-portal 本地联调通过」改为「**全套产品最小 MVP 上线野草云4（生产部署 · 上线验收 · 备份恢复）**」—— 承接原 Sprint 6 的 `#1`（集成验收，移入 Sprint 4）/ `#2`–`#9` / `#11`，并新增「门户镜像与编排制品」（全仓此前不存在该制品，是重排后新识别的最关键缺口）；原 `2.1`（上游 HTTP 面封闭）与新 `#6`（在线链路探针）留于本 Sprint，共 16 行。③ **Sprint 6** 目标由「本地集成验收、生产上线与备份闭环」改为「**门户运营闭环与对外口径定稿**」—— 承接原 Sprint 4 移出的 12 行与 Sprint 5 的 `#1` / `2.2` / `4.1`，其中原 Sprint 4 `4.8` 与原 Sprint 6 `#10`（同一件事的判据面与实测面）**合并为一行**，共 15 行。④ **Sprint 7 不变**（升级治理）。**依赖结构变化**：重排前「桥（S4）→ 合跑（S5）→ 集成验收（S6）→ 上线（S6）」是 **4 跳链、横跨三个 Sprint**；重排后为 **Sprint 4（可上线产物）→ Sprint 5（上线）→ Sprint 6（运营与口径）** 的直线，且 **Sprint 5 与 Sprint 6 互不依赖**。**编号基准**：本 Sprint（Sprint 4）的 `#7` / `#8` 系**重排后新分配**，与重排前同号行（原 `#7`–`#13` 文档收口行，已移入 Sprint 6）**不是同一条**。**锚点**：5 个稳定锚点 id（`s4-mcp-session-bridge` / `s4-audit-view` / `s4-identity-docs` / `s5-access-surfaces` / `s5-production-acceptance`）**全部保留、只随目标行迁移**；`s4-audit-view` 与 `s4-identity-docs` 现分别落在 Sprint 6 `#1` / `#12`，`s5-*` 两者仍落在 Sprint 5（`#12` / `#14`）—— **id 前缀不等于当前 Sprint 号**。**同批同步面**：RID Registry 与覆盖对照表（R1–R3 / D1–D6 逐行改指）· [`product-backlog.md`](./product-backlog.md) 的 31 条 `Sprint` 投影与 5 处关联列链接文字 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) 故事索引 14 行 · [`mcp/mcp-stories.md`](./mcp/mcp-stories.md) 索引与 3 处前瞻 · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §2 / §4-D / §4-F 的落点列 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.1 / §6.3 / §6.4 · [`deployment.md`](./deployment.md) 4 处 · [`architecture.md`](./architecture.md) 2 处 · [`web-portal/web-design.md`](./web-portal/web-design.md) 1 处 · [`web-portal/web-test.md`](./web-portal/web-test.md) 2 处 · [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) 3 处 · [`web-portal/issues-log.md`](./web-portal/issues-log.md) 1 处 · [`adr/ADR-009`](./adr/ADR-009-per-user-db-isolation-over-single-db-agent-id.md) 2 处 · `adr/ADR-008` 2 处 · [`../scripts/limits-probe.sh`](../scripts/limits-probe.sh) 与 [`../scripts/maintain-user-dbs.sh`](../scripts/maintain-user-dbs.sh) 各 1 处注释。**历史叙述不改**：Sprint 1–3 的回顾正文、各文档变更记录流水、`knowledge/*` 证据、`sdd-scrum-practices.md` 的体例举例均按原样保留 |
| 2026-09-22 | **`PSP-W1` 延伸：本机可测化与覆盖率门禁**：① **两条本机测试路径** —— 快速路径（回环 + **既有**自签通道，`make portal-dev ARGS="--env-file .env.local --dev-login"`，打印可粘贴的浏览器 cookie；**不新增认证旁路**，非回环直接拒绝、生产启用即拒绝启动）与真身份路径（隧道 + Access SSO）；② **`tunnel-dev.sh` 升级为逐步骤引导 + 每步自检**（`--login`/`--create`/`--route`/`--check`/`--verify`/`--start`，②③ 幂等；`--verify` 断言未认证被 Access 拦截，并当场指出「Service Token 未加入应用策略」这一最常见漏配）；③ **覆盖率收口** —— 新增 `make portal-coverage` 与 [`web-portal/web-test.md`](./web-portal/web-test.md) §1.1 口径，实测 **语句 94.87% · 分支 88.25% · 函数 98.77% · 行 96.39%**，阈值 92/85/96/93 低于即失败（**双向验证**：抬到 99 时 rc=1），离线测试 163 → **247 项**；④ **受阻项如实登记** —— 真 Access 链路的端到端需能解析 `cloudflareaccess.com` 的网络与隧道客户端，本机当前 DNS 仅放行国内镜像 ⇒ 该项维持「待外部前置」，`make portal-e2e ARGS=--online` 保持退出码 40 跳过语义（不伪装通过）|
