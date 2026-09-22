# sprint-plan — memory.agent-mate.ai 产品化

> **用途**：本仓的短周期执行清单 —— 做什么、卡在哪、验收是什么。
> **排期与状态的唯一真相源**：本文件。`product-backlog.md` 的 `Sprint` 列是本文件排期的**投影**（只回填编号，不改该表的 `描述` / `验收条件` / `状态` 语义）。
> **真相源**：[`architecture.md`](./architecture.md) §2（决议单点）· [`deployment.md`](./deployment.md)（部署与升级计划）· [`../upstream.lock`](../upstream.lock)（版本坐标）
> **编号口径**：文中 `#N` 指**所在 Sprint** 的条目编号（例：「Sprint 2 #1」= Sprint 2 的第 1 条）。**引用其它文档的条目时优先写条目名，不要写编号** —— 编号会随重排失效。
> **体例**：RID Registry、Sprint Backlog 与 Product Backlog 的列定义、状态语义和引用边界见 [`sdd-scrum-practices.md`](./sdd-scrum-practices.md)。
> **as_of**：2026-09-21

---

## RID Registry（Risks / Impediments / Dependencies）

> 本节只登记风险、阻碍与依赖，不属于任何 Sprint，RID 不随 Sprint 结束而消失。详细机制见 [`architecture.md`](./architecture.md) §6、[`mcp/mcp-design.md`](./mcp/mcp-design.md) §6 与 [`web-portal/web-design.md`](./web-portal/web-design.md) §3。

| # | 级别 | 类型 | 标题 | 说明 | 影响 | 解决方案（→ product-backlog） | 关联文档 | 处理说明 | 状态 | 更新日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **R1** | **致命** | 风险 | 多用户隔离可能静默失效 | 库路径解析存在优先级陷阱；旧版配置曾把 `db` 写死为共享主库。模板已移除该键，但有效的错误库路径仍须在 spawn 前拦截。 | 隔离可能读写双向失效，且发现时数据已经串号。 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) · [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 3「隔离本地负向回归」](#s3-isolation-negative-regression) · [Sprint 4「门户 ↔ MCP 会话桥」](#s4-mcp-session-bridge) · [Sprint 5「上线验收」](#s5-production-acceptance) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | D2 与本地 V1–V4 已完成；D1 随 Sprint 4「门户 ↔ MCP 会话桥」落地，生产复验随 Sprint 5「上线验收」。 | Open | 2026-09-21 |
| **R2** | **严重** | 风险 | 隔离完全依赖门户一处正确性，无纵深 | 上游没有多租户授权边界，写路径无可见性过滤，能力令牌只放宽、不收紧。 | 门户跨用户复用子进程、会话池化或缓存命错用户时会无感知串号。 | [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) · [#5 审计视图](./product-backlog.md#pb-5) | [Sprint 4「门户 ↔ MCP 会话桥」](#s4-mcp-session-bridge) · [Sprint 4「审计视图」](#s4-audit-view) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | D1、D3 随 Sprint 4「门户 ↔ MCP 会话桥」落地；D4 随 Sprint 4「审计视图」落地。 | Open | 2026-09-21 |
| **R3** | **严重** | 风险 | SSH forced command 手工配置易失准 | `authorized_keys` 的每用户命令较长，手工拼写 env 与路径，比模板更易写漏且难以审计。 | 与 R1 同源同后果；任一行失准都可能串号或让整份密钥文件失效。 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) · [#14 定制 — 接入面](./product-backlog.md#pb-14) | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 5「接入面」](#s5-access-surfaces) · [Sprint 5「上线验收」](#s5-production-acceptance) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2 / §6.2 | D2 与本地验证已完成，现有模板有静态一致性护栏；生产 forced-command 路径随 Sprint 5「上线验收」复验。 | Open | 2026-09-21 |
| **D1** | **阻塞** | 依赖 | fail-closed spawn 前置断言 | 断言库路径非空、位于 `/data/users/` 且与当前 handle 绑定；不满足即拒绝启动会话。 | 缺少该断言时，有效但错误的他用户库路径不会被服务端发现。 | [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) | [Sprint 4「门户 ↔ MCP 会话桥」](#s4-mcp-session-bridge) · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | 设计已定；实现与测试落在 Sprint 4「门户 ↔ MCP 会话桥」。 | Pending | 2026-09-21 |
| **D2** | **阻塞** | 依赖 | 移除配置模板的共享库键 | 消除漏设 env 时回落共享主库的路径；本地派生也会剥离私有配置遗留键。 | 不移除则漏设 env 可能静默落入共享主库。 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 5「上线验收」](#s5-production-acceptance) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.5 | 本地实施与负向探针已通过；生产复验登记在 Sprint 5「上线验收」。 | Implemented | 2026-09-21 |
| **D3** | **严重** | 依赖 | 一会话一子进程，禁止跨用户复用或池化 | 会话生命周期与当前用户的独立 MCP 子进程绑定。 | 复用进程会把单库隔离边界交还给门户，错误不会被上游感知。 | [#14 定制 — 接入面](./product-backlog.md#pb-14) | [Sprint 4「门户 ↔ MCP 会话桥」](#s4-mcp-session-bridge) · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | 实现与测试落在 Sprint 4「门户 ↔ MCP 会话桥」。 | Pending | 2026-09-21 |
| **D4** | **中** | 依赖 | 会话审计记录解析后的库路径 | 每次会话开始时记录最终解析的用户库路径。 | 缺失时无法事后界定串号范围与追责。 | [#5 审计视图](./product-backlog.md#pb-5) | [Sprint 4「审计视图」](#s4-audit-view) · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S5 · [`web-portal/web-test.md`](./web-portal/web-test.md) §2 | 实现与测试落在 Sprint 4「审计视图」。 | Pending | 2026-09-21 |
| **D5** | **阻塞** | 依赖 | 上线前负向验收门禁 | 生产模板未通过 V1 负向验证时阻断上线。 | 缺失时上线流程可能把静默共享主库误判为成功。 | [#26 部署 · 验证 · 文档化](./product-backlog.md#pb-26) | [Sprint 3「隔离本地负向回归」](#s3-isolation-negative-regression) · [Sprint 5「上线验收」](#s5-production-acceptance) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | 本地门禁已在 Sprint 3「多用户隔离负向回归」定型；生产执行留在 Sprint 5「上线验收」。 | Implemented | 2026-09-21 |

> **级别口径**：**致命** = 不报错且造成跨用户数据串号；**阻塞** = 不解决则不得上线；**严重** = 单点失效即串号或安全边界失效；**中** = 影响可审计性或可观测性。
> **类型口径**：风险 = 可能发生的失效；阻碍 = 已发生或正在发生的阻塞；依赖 = 关闭风险所依赖的落地项。当前没有阻碍类条目。
> **追踪归属**：验证方法是对应 Product Backlog 条目的「验收条件」；V1–V4 判据定义见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 与 [Product Backlog「定制 — 多用户数据隔离」](./product-backlog.md#pb-11)。每条 RID 均以链接串联 Product Backlog 解决方案、Sprint Backlog 执行条目及设计/测试依据，不复制各处正文。

### RID 覆盖对照

| RID | 解决方案（Backlog 条目） | 验收条件与设计/测试落点 | Sprint 落点 |
|---|---|---|---|
| R1 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) · [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) | [#11 V1–V4](./product-backlog.md#pb-11) · [#4 spawn 前置断言](./product-backlog.md#pb-4) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 3「隔离本地负向回归」](#s3-isolation-negative-regression) · [Sprint 4「门户 ↔ MCP 会话桥」](#s4-mcp-session-bridge) · [Sprint 5「上线验收」](#s5-production-acceptance) |
| R2 | [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) · [#5 审计视图](./product-backlog.md#pb-5) | [#4](./product-backlog.md#pb-4)、[#5](./product-backlog.md#pb-5) 验收条件 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 · [`web-portal/web-test.md`](./web-portal/web-test.md) §2 | [Sprint 4「门户 ↔ MCP 会话桥」](#s4-mcp-session-bridge) · [Sprint 4「审计视图」](#s4-audit-view) |
| R3 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) · [#14 定制 — 接入面](./product-backlog.md#pb-14) | [#11](./product-backlog.md#pb-11)、[#14](./product-backlog.md#pb-14) 验收条件 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2 / §6.2 | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 5「接入面」](#s5-access-surfaces) · [Sprint 5「上线验收」](#s5-production-acceptance) |
| D1 | [#4 记忆身份与数据隔离](./product-backlog.md#pb-4) | [#4 spawn 前置断言](./product-backlog.md#pb-4) · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | [Sprint 4「门户 ↔ MCP 会话桥」](#s4-mcp-session-bridge) |
| D2 | [#11 定制 — 多用户数据隔离](./product-backlog.md#pb-11) | [#11 V1、V4](./product-backlog.md#pb-11) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.5 | [Sprint 3「移除共享 DB fallback」](#s3-remove-shared-db-fallback) · [Sprint 5「上线验收」](#s5-production-acceptance) |
| D3 | [#14 定制 — 接入面](./product-backlog.md#pb-14) | [#14 一会话一子进程](./product-backlog.md#pb-14) · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | [Sprint 4「门户 ↔ MCP 会话桥」](#s4-mcp-session-bridge) |
| D4 | [#5 审计视图](./product-backlog.md#pb-5) | [#5 解析后库路径](./product-backlog.md#pb-5) · [`web-portal/web-test.md`](./web-portal/web-test.md) §2 | [Sprint 4「审计视图」](#s4-audit-view) |
| D5 | [#26 部署 · 验证 · 文档化](./product-backlog.md#pb-26) | [#26 上线负向门禁](./product-backlog.md#pb-26) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | [Sprint 3「隔离本地负向回归」](#s3-isolation-negative-regression) · [Sprint 5「上线验收」](#s5-production-acceptance) |

---

## Sprint 1

Sprint Goal: 制定产品化计划

**状态：已结束**（全部条目完成）

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
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

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
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
- `link-check.allow` 的**整文件豁免只是过渡态**：每次条目收口都检查能否缩小（本轮把 `sprint-plan.md` / `product-backlog.md` 移出豁免，4 → 2）。

---

## Sprint 3

Sprint Goal: MCP 本地安全边界与运维行为定档

**状态：已结束**（全部条目完成，2026-09-22）

### ToDo

> **范围校准（2026-09-21）**：LLM 选择与工具档位已在 Sprint 2 完成本地落地，生产复核留 Sprint 5；D1 / D3 / D4 依赖门户代码，分别并入 Sprint 4 #7 / #4；原「写路径泄露探针」仅影响已排除的单库方案 ②，取消；实测结论回写改为每项 DoD，不再单列。
>
> **执行顺序**：#1 可独立执行且已完成；硬依赖仅为 **#2 → #3**。#4（`[limits]`）与 #5（每库维护）可独立开展；#6 必须在运行与部署项中最后执行，统一收口文档、事实文件与重排编号传播；#7 是独立的过程治理项，已完成。
>
> **收口说明（2026-09-22）**：#1–#7 全部 `Done`。四条（#2–#5）按用户口径置 `Done`（本地验收闭环），其**生产复验**已作为已登记条目移交 **Sprint 5「上线验收」**，不在本 Sprint 范围内。

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 定制 — **agent attestation 现存路径收口** | 配置 | 配置 | `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 在现存三条启动路径（compose 两处 / SSH forced command / 门户启动模板）口径一致；补齐 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5 模板；开关以**正负对照**验证：`=0` 写入成功（无 `isError`）、`=1` 同一写入被拒。**验收口径更正**：`attest_level=claimed` 是上游文档与启动告警的措辞，v0.10.0 的 MCP 面（响应 / `memory_get` / `export` / `memories` 表）**不暴露**该字段，故不作断言。每用户维护命令已随 #5 验收（并纳入 `make attestation-paths` 第五条路径断言），门户运行时代码随 Sprint 4 #7 验收 | `product-backlog.md` #15 · [`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5 · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-D TC-ATT-01 · [`../scripts/mcp-smoke.sh`](../scripts/mcp-smoke.sh) | attestation 四处模板已统一，并以 `=0` / `=1` 正负对照验证；门户运行时代码另归 Sprint 4「门户 ↔ MCP 会话桥」。 | Done |
| <a id="s3-remove-shared-db-fallback"></a>2 | 定制 — **D2：移除共享 DB fallback + 现存路径调用点审计** | 安全 | 安全 | 从 tracked 的 [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) 移除顶层 `db`；[`../scripts/local-up.sh`](../scripts/local-up.sh) 从 gitignored 的 `deploy/config.local.toml` 派生 `deploy/config.toml` 时**机械剥离顶层 `db` 并 fail-closed 断言结果无该键**，不依赖人工改私有文件；审计**现存**库路径调用点（compose ×2 / SSH 管理员行 / SSH 用户行 / 门户模板），逐条确认显式指定目标 DB，结论登记为可复核证据；`serve` / curator / forced command 本地基线不退化。**边界**：每库维护命令已随 #5 产出并完成调用点审计（显式 `--db` + attestation，见 `make attestation-paths` 第五条路径），不计入本条 | `product-backlog.md` #11 · 本文件 RID Registry D2 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.5 / §7 | 共享 DB fallback 已移除，本地派生和现存调用点审计通过；生产复验归 Sprint 5「上线验收」。 | Done |
| <a id="s3-isolation-negative-regression"></a>3 | **隔离本地负向回归（D5 门禁定型）** | 任务 | 安全 | #2 完成后扩展并重跑 [`../scripts/iso-probe.sh`](../scripts/iso-probe.sh) 的 **V1**：漏设 `AI_MEMORY_DB` 必须 fail-loud；`doctor --json.source` 必须是本次失败实际解析到的**绝对路径**且不得为 `/data/ai-memory.db`；失败原因必须来自存储路径解析；探针前后共享主库计数不变。回归 V2–V4，确认目标库写入、A/B 互不可见及显式 env 的 `source` 正确。**边界**：`AI_MEMORY_DB` 错设为“存在且可写的其他用户库”由 Sprint 4 #7 的 D1 门户 spawn 前置断言覆盖；生产 V1 在 Sprint 5 #8 执行 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 的 V1–V4 判据 · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-C | V1–V4 本地负向回归已通过并形成上线门禁；生产模板复验归 Sprint 5「上线验收」。 | Done |
| 4 | 定制 — **上游 `[limits]` 配置与行为验证** | 配置 | 配置 | 在模板补 `[limits]`（**显式写全 7 键并等于 v0.10.0 编译默认**，防升级时默认值静默漂移），生产默认值与测试阈值严格分离；测试**只经环境变量注入小阈值**，禁止改写或污染生产默认值；验证写入量、存储、链接、向量索引容量超限时明确拒绝；通过 `ai-memory quota-status` CLI 交叉核对配额；不扩大公开 `core` / `admin` 档位；实测 `max_page_size` 与 `max_inflight_requests` 对 stdio 的作用并回写唯一真源 | `product-backlog.md` #17 · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.4 / §9 L · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-D TC-LIMIT | `[limits]` 七键和本地行为探针已落地，2026-09-21 用户确认可用；HTTP 面及生产通道验证仍待 Sprint 5，详见 `change-log.md` 2026-09-21。 | Done |
| 5 | 定制 — **每用户库维护行为定档** | 研究 | 部署 | 对独立测试库实测 `gc`、TTL 遗忘、WAL checkpoint 与 `curator --once` 的实际覆盖；确定逐库命令、失败退出与调度选择（主机 cron 或门户）；命令显式传 `--db` 与 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 并形成可重复测试，后者用于**防止 v0.11 默认翻转为全 surface required 后维护任务升级即失败**。生产定时器安装、日志与告警留 Sprint 5 | `product-backlog.md` #13 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.3 · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-C TC-GC | **调度定档 = 宿主机 cron**；入口 [`../scripts/maintain-user-dbs.sh`](../scripts/maintain-user-dbs.sh)（逐库显式 `--db` + attestation=0；单库失败不中断但非零退出）。探针 [`../scripts/gc-probe.sh`](../scripts/gc-probe.sh) 退出码 0（7 项断言）实测覆盖：TTL 驱逐由 `gc` 负责、**读/写路径亦惰性清扫**（`gc` 计数 ≠ 过期总量）、**WAL checkpoint 已被 `gc` 覆盖**、`curator --once` 可用。护栏 `make attestation-paths` 扩至**五路径**；2026-09-21 用户确认可用。生产定时器与告警留 Sprint 5，详见 `change-log.md` 2026-09-21。 | Done |
| 6 | **部署文档与事实文件一致性收口** | 任务 | 文档 | 校正 [`deployment.md`](./deployment.md) 与实际 `docker-compose.prod.yml` / `config.toml.tmpl` 的配置挂载、curator 命令、LLM / embedding 字段、环境变量名、部署目录与事实文件数量；#1–#5 的结论分别回写对应唯一真源与必要变更记录；机械扫描现行设计、测试、ADR 与门户文档中的 `Sprint 3 #N`，修正重排后失效引用或改用稳定条目名（**历史变更日志与当时叙述保留原编号**）；`make doc-links` / `make secret-check` 通过 | [`deployment.md`](./deployment.md) §3 / §5 / §7 · [`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) | 与部署制品逐字段收敛完成：§5.1 契约表改正 2 处实质失准（配置挂载 / curator 命令）并补 5 类缺行；§5.3 按模板逐键重写（删去上游不存在的 5 个键、更正 `[embeddings]` 后端与模型）；§1 事实文件数量、§2/§5.4 `.env` 键、部署目录口径、ADR-009「未核实」表述与 `Sprint 3 #N` 失准引用均收敛；#1–#5 结论落点逐条核实。`make doc-links` / `make secret-check` 通过，过程证据见 `change-log.md` 2026-09-22。 | Done |
| 7 | **SDD/Scrum 解决方案追踪与回顾规则收口** | 任务 | 文档 | RID 的 8 个条目均可沿稳定链接追踪到 Product Backlog 解决方案、Sprint Backlog 执行条目及 design/test 依据；Product 条目可回链具体 Sprint 条目；[`sdd-scrum-practices.md`](./sdd-scrum-practices.md) 明确该链路与 retrospective 必须写入实际交付 Sprint 的规则；用户级 `retrospective` 技能同步更新；`make doc-links` 与表格列数检查通过 | [`sdd-scrum-practices.md`](./sdd-scrum-practices.md) §1.3 / §2.3 / §3.1 · [`product-backlog.md`](./product-backlog.md) · 本文件 RID Registry / Sprint 3 Retrospective · [`change-log.md`](./change-log.md) 2026-09-21 | 5 个 Product 条目与 6 个 Sprint 条目已建立稳定锚点；RID 覆盖矩阵 8 行无空项；33 个 Markdown 文件、627 个相对链接验证无悬空。 | Done |

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

**下轮改进**
- 新增 RID 解决方案时，同批建立 Product 条目锚点、Sprint 执行锚点和 design/test 链接，并在覆盖矩阵逐项核对。
- 断言凡涉及「与另一个活进程共享的资源」，先做**静默/静止等待**再断言终态，避免把调度抖动当成功能缺陷。
- 新增任何「批处理入口」时，**同一次改动**就要把它的路径约束（显式 `--db`）加进 `make attestation-paths` 的断言面；#5 已按此把护栏扩到五路径，后续沿用。
- 配置类文档的「关键字段」表应加机械约束：**表中每个键都必须能在模板或上游 schema 找到出处** —— 可用一条简单断言落地（模板键集合 ⊇ 文档键集合），把「凭印象列举」变成可检出缺陷。
- 数量与路径类声明（文件数 / 目录 / 端口）收口时，同批用 `git ls-files` 与全仓检索取证，并把该事实的**全部出现位置**列进变更记录，避免下一轮又从另一处发现第二套口径。

---

## Sprint 4

Sprint Goal: 门户开发并与 MCP 集成

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | web-portal 设计 | 任务 | Web App | 用户批准验收 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) · [`web-portal/web-design.md`](./web-portal/web-design.md) · [`web-portal/web-test.md`](./web-portal/web-test.md) · `mockups/` | 首个增量已落盘：故事与 AC（13 个故事 / 71 条 Given-When-Then）、AC ↔ 用例映射、跨文档故事号引用收口；待用户整体批准。 | ToDo |
| 1 | admin portal — **登录与访问控制** | 功能 | Web App | 仅持有效 Cloudflare Access 身份者可访问管理域名；在 MCP 域名上请求管理 API 被**拒绝** | `product-backlog.md` #2 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S10 · [`web-portal/web-design.md`](./web-portal/web-design.md) §6 | — | ToDo |
| 2 | admin portal — **key 生命周期** | 功能 | Web App | 签发 / 列出元信息 / 修改 / 轮换 / 删除五个操作均可用；明文仅在创建响应中出现一次；吊销后新建会话被拒、既有会话被终止 | `product-backlog.md` #3 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S2 | — | ToDo |
| 3 | admin portal — **记忆身份与数据隔离（门户侧）** | 功能 | Web App | 每用户独立身份与独立库，建用户即就绪；跨用户检索命中不到；库文件属主为 `aimem` | `product-backlog.md` #4 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S1 / S4 | — | ToDo |
| <a id="s4-audit-view"></a>4 | admin portal — **审计视图** | 功能 | Web App | 建用户 / 签发 / 轮换 / 吊销 / 每次会话开始（含解析出的库路径）均可查询；日志中不出现令牌明文 | `product-backlog.md` #5 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S5 · [`web-portal/web-test.md`](./web-portal/web-test.md) §2 | — | ToDo |
| 5 | admin portal — **容量、配额与限流（门户侧）** | 功能 | Web App | 上游已支持项（配额 / 页大小）以配置纳管而非自建；门户自建的**会话级**并发上限、空闲超时、单会话最长时长在超限时**明确拒绝**；FS 级磁盘配额方案定稿 | `product-backlog.md` #6 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S7 · `src/config.rs:3703-3760` | — | ToDo |
| 6 | **Integration Instructions 页面** | 功能 | Web App | 新用户按页面指引 ≤ 3 步完成客户端接入并成功调用一次工具；至少支持中 / 英双语切换 | `product-backlog.md` #7 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S6 · [`web-portal/web-design.md`](./web-portal/web-design.md) §2 | — | ToDo |
| <a id="s4-mcp-session-bridge"></a>7 | **门户 ↔ MCP 会话桥**（HTTP MCP ↔ 子进程 stdio） | 功能 | Web App | 客户端以 `memo_` 令牌经 `<MCP_HOST>/mcp` 建立会话并完成一次写入 + 召回；**一会话一子进程、禁止跨用户复用/池化**（D3）；会话结束子进程被回收 | `product-backlog.md` #14 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S3 / S4 / S13 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | — | ToDo |
| 8 | 定制 — **公网入口与认证边界**落地 | 功能 | 部署 | 两个域名分流正确（管理面 CF Access / MCP 面令牌）；跨面调用被拒；新增公网入口的决议已同步到 `architecture.md` §2 | `product-backlog.md` #16 · [`web-portal/web-design.md`](./web-portal/web-design.md) §6 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S10 / S13 | — | ToDo |
| 9 | 定制 — **升级治理：门户镜像随上游重建** | 功能 | 治理 | 门户镜像的构建从 [`../upstream.lock`](../upstream.lock) 注入 tag；升级清单含「重建门户镜像」一步并被演练过，避免门户与部署制品版本漂移 | `product-backlog.md` #18 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S11 / S12 · [`web-portal/web-design.md`](./web-portal/web-design.md) §11 | — | ToDo |

### Retrospective

**本轮做得好**
- `web-portal/web-stories.md` 按 ATDD 重写（13 个故事 / 71 条 Given-When-Then AC）后**没有停在「本文件自洽」**：同批把外部引用面（`product-backlog.md` / `sprint-plan.md` / 证据页）一次扫到零残留，并让故事索引成为跨文档故事号的**唯一对照表**（含 `AC` 与 `测试用例` 两列）。
- 落盘顺序是「**先在 `web-test.md` 登记用例号，再回填索引**」，避免写出指向尚不存在用例号的索引。
- 用只读评审把「单向引用」逐条挖出（S1 / S8 / S9 / S12 / S13 的 Sprint 落点未回链）并在**同轮**修完，而不是留到下轮。

**本轮学到**
- **编号空间会撞名**：故事号 S1–S13 与既有的「静默失败点 S1–S4」（`deployment.md` §7.2 / `web-design.md` §5）和 `i18n-probe.sh` 的测试标签 `S1–S12` 同形；`grep` 清扫会同时命中三者，既可能误改也可能因噪声漏判 —— 本轮 5 个条目的错指正是这样被掩盖的。见 [`knowledge/docs/spec-doc-conventions.md`](./knowledge/docs/spec-doc-conventions.md) 第 10 条。
- **「双向可查」不会自动成立**：索引里声明 `Sprint 5 #7` 这类落点，被指的那一行不会自己长出回链；声明双向等于承诺同批回填（同上第 11 条）。
- **同一事实两处写法会立刻分叉**：S12 的用例集合在故事索引与「已知限制」表各写一遍，第一次就漏了 `TC-P-L1-09`。

**下轮改进**
- 新增或重写一份 spec 的编号体系时，同批产出「编号 → 引用方」对照表并逐处回填；只改权威文档不算完成。
- 造编号前先全仓扫同形编号，并在变更记录的**边界**段登记「同名不同义清单」（本轮已登记：`deployment.md` §7.2 S1–S3 · `web-design.md` §5 S4 · `web-test.md` / `sprint-plan.md` 中沿用该编号的行 · `i18n-probe.sh` 标签 S1–S12）。
- 故事号的 Backlog / Sprint 归属以**引用方的实际回链**为准，不凭语义相近推断（本轮据此把 S3 的 Backlog 归属由 `#3 / #14` 校正为 `#14 / #28`）。

---

## Sprint 5

Sprint Goal: 生产上线与备份闭环

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | SSH 密钥对（调用者 ↔ 野草云4） | 阻塞 | 安全 | 无 passphrase + forced command；`ssh ai-memory` 可完成 MCP 握手 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5 | 待生成 SSH 密钥并在生产 forced-command 通道完成握手。 | ToDo |
| 2 | OSS 私有桶（香港 region + SSE）+ RAM 子账号 AK | 阻塞 | 安全 | 桶为私有 + SSE 已开；AK 仅存服务器侧，不入仓 | [`deployment.md`](./deployment.md) §8（备份与恢复）· 云资源准备清单见 [`../deploy/README.md`](../deploy/README.md)（原需求规格 `mcp_oss_bak_com_requirements.md` 已移出本仓） | 待提供 OSS 私有桶及最小权限 RAM 凭证。 | ToDo |
| 3 | **编写 `memory.agent-mate.ai/backup/` 备份脚本** | 任务 | 部署 | `backup-and-push.sh`（快照 → sha256 → ossutil 上传 → **回读比对** → 失败非零退出）与 `restore-drill.sh`（拉最新 → 校验 → restore → `doctor` 通过）可重复执行；`make backup` / `make restore-drill` 可用；**遍历 `/data/users/*`** | `product-backlog.md` #9 · `deployment.md` §8 | — | ToDo |
| 4 | **部署执行（ai-memory）** | 任务 | 部署 | `deployment.md` §3 八步落地 + §7.3 冒烟全绿 | `deployment.md` §3 · [`../deploy/README.md`](../deploy/README.md) | — | ToDo |
| 5 | **admin portal 部署 + 多用户隔离落地** | 功能 | 部署 | 走通「签发 key → 建立会话 → 隔离生效」；通过 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 与 [`web-portal/web-test.md`](./web-portal/web-test.md) §3；**且必须先通过 Sprint 3 的隔离本地负向回归（含 V1）** | `product-backlog.md` #4 / #26 · 本文件 Sprint 3 #3 | — | ToDo |
| <a id="s5-access-surfaces"></a>6 | 定制 — **接入面**落地（HTTP MCP + SSH stdio） | 功能 | 部署 | 两条路径都能完成 MCP 握手并成功读写；**停掉门户后 SSH 路径仍可用**（降级不失效） | `product-backlog.md` #14 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S3 / S8 · [`web-portal/web-design.md`](./web-portal/web-design.md) §2 | — | ToDo |
| 7 | 定制 — **备份与恢复**落地（含门户自身库）+ 首次外迁 + 恢复演练 | 功能 | 部署 | 每用户库逐一快照 + manifest；**门户自身库**（与用户记忆库分离存放）纳入同一外迁流程；按 RPO ≤ 24h / RTO ≤ 2h / 日备 30 代 + 月备 12 代 落地；恢复演练可重复执行且通过 | `product-backlog.md` #9 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S9 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.4 | — | ToDo |
| <a id="s5-production-acceptance"></a>8 | **上线验收** | 任务 | 部署 | 三份验收清单全部通过：`deployment.md` §7.3 冒烟 + [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 + [`web-portal/web-test.md`](./web-portal/web-test.md) §3；**另用 `initialize` 回包核对对外模板实际暴露的工具数**（用户 `core` = 8 / 管理员 `admin` = 22）—— 承接 **Sprint 2 #10** 的唯一剩余项；同时作为 **D5 / V1** 的执行点 | `product-backlog.md` #26 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S7 | — | ToDo |

> **执行本 Sprint 时须核对的静默失败点**：`deployment.md` §7.2 的三个（embedder 降级、curator fail-open `tagged=0`、config 挂载路径错误导致 tier 退回 semantic）+ 本文件 RID Registry 的 **R1**。**上线前 D5 必须关闭**：Sprint 3 的负向验证未通过则不得上线。

### Retrospective

**本轮学到**
- 待填（本 Sprint 结束时补）。

**下轮改进**
- 待填。

---

## Sprint 6

Sprint Goal: 升级治理闭环

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 说明 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 上游升级**邮件**提醒 | 功能 | 治理 | 检测到「适合升级」的上游版本时发出邮件（现状只有 GitHub issue，不满足需求） | `product-backlog.md` #21 · `deployment.md` §9.1 | — | ToDo |
| 2 | **历次版本升级跟踪与记录**（过程资产） | 功能 | 治理 | 每次升级留痕：版本 / 日期 / 判据结论 / 详细步骤 / 验证结果 / 回滚点 | `product-backlog.md` #22 · `deployment.md` §9 | — | ToDo |
| 3 | **最低耦合、尽量自动化的升级方案** | 功能 | 治理 | 一次升级可在「改 [`../upstream.lock`](../upstream.lock) → 跑预检 → 重建/重启」内完成，无需手工比对版本号；门户镜像重建纳入同一条链路 | `product-backlog.md` #23 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S12 · `adr/ADR-004-version-contract-single-source-of-truth.md` | — | ToDo |
| 4 | **制定部署/升级方案与脚本** | 任务 | 治理 | 相关脚本落地且可重复执行 | `product-backlog.md` #24 · `deployment.md` §9 | — | ToDo |
| 5 | **升级方案端到端验证并文档化** | 任务 | 治理 | 完整演练一次升级（预检 → 部署 → 验收 → **回滚演练**）并留痕。**注意**：回滚**必须**用快照覆盖 —— 上游不拒绝「比自身更新的库」（旧二进制会静默读写不认识的 schema） | `product-backlog.md` #25 · `knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md` | — | ToDo |

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
