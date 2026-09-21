# sprint_plan — memory.agent-mate.ai 产品化

> **用途**：本仓的短周期执行清单 —— 做什么、卡在哪、验收是什么。
> **排期与状态的唯一真相源**：本文件。`product-backlog.md` 的 `Sprint` 列是本文件排期的**投影**（只回填编号，不改该表的 `描述` / `验收条件` / `状态` 语义）。
> **真相源**：[`architecture.md`](./architecture.md) §2（决议单点）· [`deployment.md`](./deployment.md)（部署与升级计划）· [`../upstream.lock`](../upstream.lock)（版本坐标）
> **编号口径**：文中 `#N` 指**所在 Sprint** 的条目编号（例：「Sprint 2 #1」= Sprint 2 的第 1 条）。**引用其它文档的条目时优先写条目名，不要写编号** —— 编号会随重排失效。
> **as_of**：2026-09-21

---

## 阻断级风险（门户上线前必须关闭）

> 本节是**独立风险登记**，不属于任何 Sprint —— 风险不随 Sprint 结束而消失。详细设计见 [`architecture.md`](./architecture.md) §6 与 [`web-portal/web-design.md`](./web-portal/web-design.md) §3。

| # | 级别 | 类型 | 标题 | 说明 | 影响 | 解决方案 | 验证方法 | 关联文档 | 状态 | 更新日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **R1** | **致命** | 风险 | 多用户隔离可能静默失效 —— 所有用户共用同一个库文件 | 库路径解析存在**优先级陷阱**：`AppConfig::effective_db()` 只在「CLI/env 的库路径**恰为默认值** `ai-memory.db`」时才**改用 config 的 `db`**（`src/config.rs:7506-7516`；默认值 `src/daemon_runtime.rs:88`）。而本部署的 `config.toml` 写死 `db = "/data/ai-memory.db"`（`deploy/config.toml.tmpl:13`）。⇒ 任何一条会话**漏设或写错** `AI_MEMORY_DB`，它就会落到**共享的主库**上 | 隔离**读写双向**彻底失效 —— 用户看到并写入的是**别人的记忆**；且 `daemon_runtime.rs:980` 是全子命令唯一解析点，**无报错、无告警、无日志** | **D1 + D2** | **V1 + V4** | [`architecture.md`](./architecture.md) §6 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §7 | 未关闭（待 Sprint 3 #5 / #6） | 2026-09-20（2026-09-21 重整） |
| **R2** | **严重** | 风险 | 隔离完全依赖门户一处正确性，无纵深 | 上游不提供任何多租户授权边界：**写路径无可见性过滤**（`store` / `atomise` / `promote` 命中 0）；macaroon 能力令牌 **additive-only**（只放宽、不收紧） | 门户任一缺陷（跨用户复用子进程、会话池化、缓存命错用户）即造成串号，同样无感知 | **D1 + D3 + D4** | **V3 + V4** | [`architecture.md`](./architecture.md) §6 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §7 | 未关闭（待 Sprint 3 #5、Sprint 4 #7） | 2026-09-20（2026-09-21 重整） |
| **R3** | **严重** | 风险 | SSH 手工 forced command 的同类风险 | `authorized_keys` 里每用户是一条**很长的单行命令**（含 `-e AI_MEMORY_DB=…`，手工拼写）；比门户的配置模板更易写漏 | 与 R1 同源同后果；且长单行**难以审计**（逐行生效，权限错一次会连带废掉整文件所有密钥） | **D1 + D2 + D4** | **V1 + V4** | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2 | 未关闭（待 Sprint 3 #5） | 2026-09-20（2026-09-21 重整） |
| **D1** | **阻塞** | 依赖 | **fail-closed 不变量**（门户 spawn 前断言） | 断言 `AI_MEMORY_DB` 非空 + 以 `/data/users/` 开头 + 含该 `handle`；不满足则**拒绝启动会话** | 不做则「落错库」无从拦截，R1 / R2 没有兜底 | 设计已定（`web-portal/web-design.md` §3）；**实施**落 Sprint 3 #5 | **V1** | [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | 设计已定，**未落地** | 2026-09-20（2026-09-21 重整） |
| **D2** | **阻塞** | 依赖 | **移除 `config.toml.tmpl` 的 `db` 键** | 直接**消除 R1 的落点**：该键一旦不存在，「默认值 → config」这条路径就无路可走，漏设 env 只会退化为相对路径 → **报错（fail-loud）**，而不是静默共用主库。已核实本部署**所有**调用点都显式传库路径（compose 的 `AI_MEMORY_DB`、forced command 的 `-e`、cron 的 `--db`、门户模板），该键冗余 | 不移除则「漏设」这一支**无法**被任何断言覆盖 —— 移除是唯一能覆盖它的手段 | **实施**落 Sprint 3 #5（须实测 `serve` / `curator` / forced command 不受影响） | **V1 + V4** | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §7（五个坑） | 未开始（Sprint 3 #5） | 2026-09-20（2026-09-21 重整） |
| **D3** | **严重** | 依赖 | **一会话一子进程，禁止跨用户复用 / 池化** | 消除 R2 的主要触发面（跨用户复用子进程、会话池化） | 复用即串号，且无感知 | **实施**落 Sprint 3 #5，**固化**在 Sprint 4 #7（会话桥） | **V3** | [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | 未落地（Sprint 3 #5 / Sprint 4 #7） | 2026-09-20（2026-09-21 重整） |
| **D4** | **中** | 依赖 | **会话审计含解析出的库路径** | 事后可对账「这次会话落在哪个库」 | 缺则事后无法定位串号范围与追责 | **实施**落 Sprint 3 #5，**视图**落 Sprint 4 #4（审计视图） | **V4** | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S5 · [`web-portal/web-test.md`](./web-portal/web-test.md) §2 | 未落地（Sprint 3 #5 / Sprint 4 #4） | 2026-09-20（2026-09-21 重整） |
| **D5** | **阻塞** | 依赖 | **上线前负向验收门禁** | 未通过 V1（负向）就不算通过；不过则阻断 Sprint 5 上线 | 缺则「看起来通过」的上线可能带着 R1 | 门禁落 Sprint 3 #6，**执行**在 Sprint 5 #8 | **V1** | 本文件 Sprint 3 #6 / Sprint 5 #8 | 未落地（Sprint 3 #6） | 2026-09-20（2026-09-21 重整） |
| **V1** | **阻塞** | 其他 | **负向验证**：漏设 `AI_MEMORY_DB` 的会话必须失败 | 故意注入「漏设 `AI_MEMORY_DB`」的模板启动会话 | 上线**准入门槛**（D5）：不过则不得上线 | 判定：会话**必须失败**；**不得**落到 `/data/ai-memory.db` | 本项即验证方法，不适用 | 本文件 Sprint 3 #6 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | 本地预实证：当前会**静默成功**（待 D1 / D2 落地后转失败） | 2026-09-20（2026-09-21 重整） |
| **V2** | **中** | 其他 | **正向验证**：文件时间戳比对 | 会话结束后比对 mtime | 证明写入落在自己的库（而非共享主库） | 判定：`/data/users/<u>/ai-memory.db` 的 mtime **变化**，且共享主库 `/data/ai-memory.db` **未变化** | 本项即验证方法，不适用 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | 本地版已通过（Sprint 2 #5），生产待执行 | 2026-09-20（2026-09-21 重整） |
| **V3** | **中** | 其他 | **交叉验证**：A 写入后用 B 检索 | A 的 key 写入后，用 B 的 key 检索 | 证明跨用户不可见 | 判定：B **命中不到**；B 显式 `memory_get <A 的记忆 id>` **不可见** | 本项即验证方法，不适用 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | 本地版已通过（Sprint 2 #5），生产待执行 | 2026-09-20（2026-09-21 重整） |
| **V4** | **中** | 其他 | **解析链自检**：`doctor --json` 的 `source` 字段 | 用**与模板完全相同的 env/argv** 跑 `ai-memory doctor --json` | 证明模板实际解析出的库路径正确 | 判定：其 `source` 字段（`src/cli/doctor.rs:117-119`、`:591`）**等于**该用户库路径 | 本项即验证方法，不适用 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | 本地版已通过（Sprint 2 #5），生产待执行 | 2026-09-20（2026-09-21 重整） |

> **级别口径**（2026-09-21 由原「严重 / 高」换算，变更记录留痕）：**致命** = 不报错 + 后果为跨用户数据串号（发现时已污染）；**阻塞** = 不解决则不得上线；**严重** = 单点失效即串号或安全边界失效；**中** = 影响可审计性 / 可观测性。
> **类型口径**：风险 = 可能发生的失效；依赖 = 关闭风险所依赖的落地项；其他 = 验证方法（可执行判据）。风险行 R 的「解决方案」指向防线行 D、「验证方法」指向验证行 V；**R / D / V 编号沿用原登记**，以便 Sprint 2 #5、Sprint 3 #5 / #6、Sprint 5 #5 / #8 按编号引用。

---

## Sprint 1

Sprint Goal: 制定产品化计划

**状态：已结束**（全部条目完成）

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 版本契约层（单一真相源 + 耦合面清单 + 预检脚本 + 跟踪 Action + 2 份 ADR） | 任务 | 治理 | `upstream.lock` 为唯一版本坐标；8 类契约点带源码依据；`make preflight-test` 离线自测全绿；每日跟踪 Action 落地；决策有 ADR | [`../upstream.lock`](../upstream.lock) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §9 · [`../scripts/upstream-preflight.sh`](../scripts/upstream-preflight.sh) · `.github/workflows/upstream-track.yml` · `adr/` | 已完成 |
| 2 | 制品改钉 `0.9.0` → `0.10.0` | 任务 | 部署 | 4 处坐标同步且全仓无残留矛盾（`deploy/.env.prod.example`、`architecture.md` §2、`deployment.md` §3 / §9）；理由留痕（0.9.0 的 attestation 缺陷） | [`../upstream.lock`](../upstream.lock) · `architecture.md` §2 | 已完成 |
| 3 | 升级治理方案（准入判据 + 回滚语义） | 任务 | 治理 | `deployment.md` §9 七步链路；判据分层 H1–H5 硬阻断 / W1–W6 人工确认；回滚强制快照覆盖（因上游不拒绝更新的库） | `deployment.md` §9 · `adr/ADR-005-upgrade-admission-gate-layering.md` | 已完成 |
| 4 | 上游事实与坑知识沉淀 | 研究 | 治理 | 三条实测结论（历史被重写 / schema 阶梯 78→80→81 / 回滚静默危险）与上游文档缺陷清单落盘 | `knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md` | 已完成 |
| 5 | 多用户隔离方案 | 研究 | MCP | 四档方案对比（含 11 条源码依据）；单账号 N 密钥澄清；5 个坑；档位定为「一用户一 DB」 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) | 已完成 |
| 6 | admin portal 设计方案 | 任务 | Web App | 两 stack 职责与数据流、密钥模型、CF Access 边界、耦合面 C1–C8、静默失败点 S4、威胁模型 T1–T10 全部成文 | [`web-portal/web-design.md`](./web-portal/web-design.md) | 已完成 |
| 7 | 完善并评审 `product-backlog.md` | 任务 | 产品 | 占位符全部填实；评审改进点逐条确认；**已定稿**（三层结构 + 26 条 Backlog + 工具清单 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8） | [`product-backlog.md`](./product-backlog.md) | 已完成 |

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

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **仓库 IP 脱敏 + 防复发护栏**（保持公开仓） | 任务 | 安全 | 4 个真实公网 IP 从文档迁出到 gitignored 的 `memory.agent-mate.ai/secrets.local.hk_vps_4.md`，文档改用具名占位符（`<VPS4_IP>` / `<VPS3_IP>` / `<PG_HOST>` / `<MYSQL_HOST>`）；`secret-check.sh` + pre-commit 钩子（`make hooks-install`）就位，`make secret-check` 可跑且干净仓零命中 | [`architecture.md`](./architecture.md) §5.4 · [`../scripts/secret-check.sh`](../scripts/secret-check.sh) | 已完成 |
| 2 | qwen API key —— **用户已备好** | 阻塞 | 配置 | `.env` 中 `DASHSCOPE_API_KEY` 非空且可调通 | [`../deploy/.env.prod.example`](../deploy/.env.prod.example) · [`../deploy/.env.local`](../deploy/.env.local)（本地，gitignored） | 已完成（2026-09-20：secrets 的 `QWEN_API_KEY` 已回填本地 `.env.local`；`scripts/qwen-verify.sh` 与 `ai-memory doctor` 均实测调通） |
| 3 | qwen embedding 的 **model + dim**（**针对本地部署**写入环境配置；并在**部署文档**中说明未来生产环境的配置） | 阻塞 | 配置 | ① 本地环境配置的 `[embeddings]` 填真实值（**不可留 `dim = 0`**）并本地调通 —— `ai-memory doctor` 的 Embeddings Reachability 显示 `qwen:<model>` 且维度一致 ② **部署文档已说明未来生产环境**（服务器 `/opt/ai-memory-mcp`）的对应配置与差异 | [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`../deploy/config.local.toml`](../deploy/config.local.toml)（本地，gitignored）· [`../deploy/README.md`](../deploy/README.md) · [`deployment.md`](./deployment.md) · [`../scripts/qwen-verify.sh`](../scripts/qwen-verify.sh) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §9 F1–F3 | 已完成（2026-09-20：`qwen3.7-text-embedding` / `dim = 1024`；doctor 显示 1024-dim，写入 + 召回 + curator `auto_tagged = 1` 端到端通过；生产侧 `config.toml.tmpl` 同结构，端点用 `<QWEN_BASE_URL>` 占位符） |
| 4 | **本地启动 ai-memory-mcp（按默认配置）** | 任务 | 开发环境 | 本机按默认配置启动成功，并通过 MCP 完成一次写入 + 召回，作为后续方案对照的基线 | `product-backlog.md` #1 · `deployment.md` §3 | 已完成（2026-09-20：`local-up.sh` 以生产同款 compose 常驻启动 serve+curator；`mcp-smoke.sh` 断言握手 / core 档 8 工具 / 写入 / 跨进程**语义召回** + 关键词检索，×2 运行幂等通过；三静默失败点均有行为级反证） |
| 5 | **给出「多用户隔离是否可实现」的明确结论** | 研究 | 功能 | 结论落盘（可实现 / 不可实现 / 有条件可实现），并指明所依赖的防线（D1–D5）与验证项（V1–V4）、以及未决前提 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) · 本文件「阻断级风险」 | 已完成（2026-09-20：**结论 = 有条件可实现**——"机制可行"由探针 A/B/C 组实测闭环（探针脚本 [`../scripts/iso-probe.sh`](../scripts/iso-probe.sh) 退出码 0）；"可信"依赖 **D1+D2 硬前提**，因 R1 已获**行为级证据**（漏设 `AI_MEMORY_DB` → `rc=0` 且静默落 `/data/ai-memory.db`；对照：错设到不可打开路径 → `overall=critical`、rc=2 fail-loud）。冻结机制（`/data/users/<handle>/` + `keys/` + 三件套 env + forced command 模板 + 每库维护）、D1–D5 条件矩阵、V1–V4 映射（V1 预实证"当前会静默成功"、V2/V3/V4 本地版通过）与 6 项未决前提全部落盘 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §0） |
| 6 | **D1 确认**：门户启动机制 **β′**（镜像内带二进制 + 子进程）vs **α**（`docker exec` + docker socket） | 任务 | Web App | 决议写入决议单点（现 [`architecture.md`](./architecture.md) §2）；若选 α 须书面接受「公网门户持 root 等价权限」并补 socket 加固 | [`web-portal/web-design.md`](./web-portal/web-design.md) §3 与 §9 附录 · [`knowledge/web-portal/portal-launch-mechanism.md`](./knowledge/web-portal/portal-launch-mechanism.md) | 已完成（2026-09-21：**用户确认 β′**；决议落 [`architecture.md`](./architecture.md) §2.1 #8 + §2.2 排除 α（含「代理无法收窄」依据）+ §2.3 三条落地前置；`ADR-012` 转 Accepted。研究证据：`E1–E7` —— 镜像契约实测（amd64 单平台 / uid:gid 999 / bookworm / `ldd` 通过）+ **β′ 端到端探针跑通**（外来 bookworm 底座 + COPY 二进制 ⇒ 8 工具 / 写入 / 用户库自动创建 / 跨进程 `mode:hybrid` 召回，共享主库未触碰）+ 两个缺口（`/data/users` 属主 root ⇒ setgid 引导；门户须持 MaaS key 否则静默降级）+ 否定性结论（主流 socket 代理不支持按容器/命令过滤 ⇒ α 实质 = 裸 socket）。备选 α 未采纳，故无「书面接受 root 等价」一项；同日确认可增签门户专用 key ⇒ §2.3 #2 **首选生效**，落地位置 `portal.env`（模板 [`deploy/portal.env.example`](../deploy/portal.env.example)）；**门户专用 key 已填入并实测**（2026-09-21：`qwen-verify.sh --key` → `embed_model=qwen3.7-text-embedding-flash`、`dim=1024`、同工作空间；另以 `-e DASHSCOPE_API_KEY` 覆盖注入隔离会话复核——写入成功 + 跨进程召回 `mode=hybrid`，无鉴权失败）） |
| 7 | **`tmp_user_key_option1.md` 处置**（移入 `specs/` 或加 `.gitignore`） | 任务 | 安全 | 仓根目录不再有未跟踪的留档文件 | [`architecture.md`](./architecture.md) §5.4 | 已完成（2026-09-20：三选一由用户拍板为**直接删除**，文件已从仓根移除；内容不含真实密钥，无需留档） |
| 8 | **探针：上游保存 memory 时是否支持多语言** | 研究 | MCP | 给出明确结论（是否支持多语言存储 / 检索、有无相关配置项、有无已知限制）；结论回写 `product-backlog.md` 的「记忆内容的多语言支持」条目 | `product-backlog.md` #10 · 上游源码 | 已完成（2026-09-21：**结论 = 部分支持**——① 存储不限语言（简中/繁中/英文写入全成功）；② 语义召回 `mode=hybrid` 与按 id 直取三语言一律可用；③ `memory_search` 关键词通路受 FTS5 默认分词器 `unicode61`（建表无 `tokenize=`）限制，只认**完整词元**（英文=单词、中文=标点界定整段），词元内子串与**简繁交叉**不命中；④ **无任何**语言/分词/检索配置项。可复跑探针 [`../scripts/i18n-probe.sh`](../scripts/i18n-probe.sh)（三语言×三通路矩阵，退出码 0；STRICT 边界断言全绿）；客户端通路（`ai-memory-local`）交叉复现一致；源码依据（建表 + `sanitize_fts_query` + `[mcp]` 段）落 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §9 J4。回写：[`product-backlog.md`](./product-backlog.md) #10（Done）· [`mcp/mcp-test.md`](./mcp/mcp-test.md) §1 L1.6 / §4-E · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](./knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 多语言专表 · [`architecture.md`](./architecture.md) §4.1） |
| 9 | **`--profile` 定档**：对外暴露哪一档；SSH / 门户模板是否补写 `--profile` | 研究 | MCP | 实测 `v0.10.0` 各档工具数（本地 clone 实测：core 7 / graph 19 / admin 21 / power 56 / **full 101**；`memory_capabilities` 所有档位 always-on，故实际注册数 +1）；决议写入门户模板、SSH 模板与公开文档 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8 · `product-backlog.md` #12 | 已完成（2026-09-21：**决议 = 对外（SSH / 门户统一）`core`（8 项）；管理员另设 **`admin`（22 项）**入口，两条模板分离**）。理由：对外取最小面；管理员要在自身通道里做删除 / 遗忘 / 清理与治理审批（Lifecycle + Governance），`core` 做不到；而 Meta / Archive 族（`memory_stats` / `memory_archive_stats`）属 `full` 档、**不随 `admin` 开放**，管理员确需只读统计类工具时另开条目评估。**实测**（探针 [`../scripts/profile-probe.sh`](../scripts/profile-probe.sh)，7 档全绿、退出码 0）：默认档（不传 `--profile`）= **8**（与 core 一致且**不报错**）/ core=8 / graph=20 / admin=22 / power=57 / full=101 / 自定义 `core,lifecycle`=**14**；`--profile` 与 `--tier smart` **并存生效**（CLI flag 形式，无需 env 回退）。**回写**：[`mcp/mcp-design.md`](./mcp/mcp-design.md) §8.1（实测引文）+ §8.3 #1–#4（由「待决策」转为决议表；新增 #4 已知限制：core 档不含 `memory_delete` / `memory_forget` / `memory_gc`，日后若要开放删除，最小增量档是 `core,lifecycle`（14）而非 admin / full）；[`change-log.md`](./change-log.md) 2026-09-21 小节。**模板落盘已于 2026-09-21 收尾完成**（原「移交 Sprint 3 #2」）：四处模板均已写 `--profile` —— SSH 主人行 `admin` / 用户行 `core`（[`deployment.md`](./deployment.md) §4.3 与 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.1–§5.2）、门户 `launch.argv`（[`web-portal/web-design.md`](./web-portal/web-design.md) §3.3）、本地客户端条目（[`mcp/mcp-test.md`](./mcp/mcp-test.md) §3）；另新增面向最终用户的能力文档 [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md)（档位 + 全量 101 项工具说明 + 例子，门户接入指引页唯一内容源）；`product-backlog.md` #12 标 Done、#19 描述补决议（本轮已授权改 backlog）。**剩余**：生产上线后用 `initialize` 回包复核一次） |
| 10 | **MCP 对外能力清单定稿**（档位 / i18n 范围 / LLM 与备份选择的最终决议） | 任务 | MCP | 清单定稿并落入公开文档；档位与 **#9** 的决议一致 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8 · `product-backlog.md` #19 | **已完成（2026-09-21）**：四项最终决议**均已定稿且有落点** —— ① 档位 = 对外 `core`（8）/ 管理员 `admin`（22）：[`mcp/mcp-design.md`](./mcp/mcp-design.md) §8.1 + §8.3，且已写入四处模板（[`deployment.md`](./deployment.md) §4.3 / [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.1–§5.2 / [`web-portal/web-design.md`](./web-portal/web-design.md) §3.3 / [`mcp/mcp-test.md`](./mcp/mcp-test.md) §3）② i18n 范围 = 部分支持（存储与语义召回可用、关键词通路按 FTS5 词元、无配置项）：`product-backlog.md` #10（Done）+ [`mcp/mcp-design.md`](./mcp/mcp-design.md) §2 / §9 J4 + [`mcp/mcp-test.md`](./mcp/mcp-test.md) §1 L1.6 / §4-E + 探针 [`../scripts/i18n-probe.sh`](../scripts/i18n-probe.sh) ③ LLM 选择 = `tier smart` + `qwen-plus` + `qwen3.7-text-embedding`（`dim 1024`）+ 显式 `base_url`：[`architecture.md`](./architecture.md) §2.1 #3/#4 · [`adr/ADR-007`](./adr/ADR-007-qwen-private-maas-endpoint-and-measured-embedding-dim.md) · [`deployment.md`](./deployment.md) §5.3 ④ 备份选择 = OSS 私有桶 + 每日外迁 + sha256 校验 + RPO ≤ 24h / RTO ≤ 2h：`product-backlog.md` #9 · [`deployment.md`](./deployment.md) §8。清单已落入公开文档 [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md)（用户版，门户接入页唯一内容源）；`product-backlog.md` #19 → Done。**唯一剩余**：生产环境上线后用 `initialize` 回包核对实际暴露工具数 —— 已并入 **Sprint 5 #8 上线验收**，不阻断本条 |
| 11 | **更新 `memory.agent-mate.ai/specs/` 相关技术方案（明确方案部分）** ② [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md) 结构重构（§1+§2 合并并补 `mcp.json` 示例；工具说明改为**按档位**逐档一张表，新增「示例」列） ③ 本文件体例改造（阻断级风险三表合并为单表；每个 Sprint 后新增 `Retrospective` 章节） | 任务 | 文档 | ① 受本次重排影响的技术 spec 全部同步（编号引用去耦合、排期指向正确），各文件追加变更记录 ② 能力文档按档位矩阵化：6 张档位表（core 8 / admin 22 / graph 20 / power 57 / full 101 / `core,lifecycle` 14）逐项含「做什么 / 什么时候用 / 示例」，工具数与 [`../scripts/profile-probe.sh`](../scripts/profile-probe.sh) 实测一致 ③ 风险单表化（R/D/V 全部成行、保留编号锚点）+ 每个 Sprint 有 Retrospective 章节；**无 emoji、相对链接可解析、对外示例一律占位符** | `memory.agent-mate.ai/specs/` 全目录 · [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md) · 本文件 | **已完成（2026-09-21）**：② ③ 与 Sprint 2 #10 回写完成；① 的剩余同步项同日收口 —— `sprint_plan.md` / `product-backlog.md` 中指向已合并旧 spec 的悬空引用全部改指合并后文档（历史叙述条目降级为纯文本），`link-check.allow` 的两份整文件豁免随之删除，因能力文档体例变更而失准的三处描述同步订正 |
| 12 | **目录改名收口 + specs 整合**（`hk_vps_4/` → `memory.agent-mate.ai/`；16 份 spec 合并为 8 份） | 任务 | 文档 | ① git 以 rename（R100）记录且全仓路径引用同步（Makefile / `.gitignore` / CI / 脚本 / specs / adr / knowledge）；② 含密与派生文件仍被忽略（`git check-ignore` 逐条断言 + `make secret-check` 干净）；③ `make doc-links` / `make preflight-test` / `iso-probe.sh` 全绿；④ specs 唯一真源 = `memory.agent-mate.ai/specs/`（产品级 2 + `mcp/` 2 + `web-portal/` 3） | [`architecture.md`](./architecture.md) · [`deployment.md`](./deployment.md) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) · [`web-portal/web-design.md`](./web-portal/web-design.md) · [`../scripts/link-check.sh`](../scripts/link-check.sh) | 已完成（2026-09-20：41 个 R100 rename；新增 `make doc-links` 防「删文档留悬空引用」复发） |
| 13 | **需求覆盖审计 + 回溯引用**（产品概述 / 需求层 → Backlog） | 任务 | 产品 | ① `# 需求` 节 26 条与 Backlog #1–#26 **逐条对应、无遗漏** ② 「产品概述」层（需求边界 / 用户模型 / 鉴权）带验收条件却原无条目的 5 项补入 **#27–#31**，Backlog 由 26 条扩为 **31 条** ③ 第一部分每项需求后追加 `→ [Backlog #N 名称](#product-backlog)`，共 **44 处**（表格行的链接落在**末列单元格内**，不破坏表格）④ 新增「覆盖要求 / 回溯引用」约定：**条目名为主、编号为辅**（编号会随重排失效） | [`product-backlog.md`](./product-backlog.md) | 已完成（2026-09-21：44 处回溯引用 + 5 项补录全数落地；后续改第一部分需求须同步检查第二部分） |
| 14 | **文档风格收口：自有文档去 emoji / 图标** | 任务 | 文档 | 全仓自有 spec + `.codebuddy/plans/` 共 **14 个文件、180 处** emoji / 图标改为**文字承载**（状态 → 已完成 / 进行中 / 待决策 / 待提供 / 未开始；是否 → `是` / `否`，后接文字已自解释则直接删；告警 → `注意：`；级别 → 阻断 / 高危 / warn / info）；`ai-memory-mcp/`（上游 vendored、自带 `.git`）**未改**；`make doc-links` / `make secret-check` 全绿 | [`change-log.md`](./change-log.md) `## 2026-09-21` | 已完成（2026-09-21：仅剩 **1 处显式例外** —— `adr/ADR-005`「提示话术」代码块内的 `❌ 准入判定：不通过` 系 `scripts/upstream-preflight.sh` 输出原文，改文档须与改脚本同批） |

> **执行本 Sprint 时须核对的静默失败点**：`deployment.md` §7.2 的三个（embedder 降级、curator fail-open `tagged=0`、config 挂载路径错误导致 tier 退回 semantic）+ 本文件「**阻断级风险**」的 **R1**（会话漏设/写错 `AI_MEMORY_DB` → 所有用户静默共用同一库）。**R1 是其中唯一不报错、且后果是数据串号的一项。**

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
- `link-check.allow` 的**整文件豁免只是过渡态**：每次条目收口都检查能否缩小（本轮把 `sprint_plan.md` / `product-backlog.md` 移出豁免，4 → 2）。

---

## Sprint 3

Sprint Goal: MCP 本地实现并验证

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 定制 — **LLM 选择**落地 | 配置 | 配置 | `tier = "smart"`、`[llm]` qwen/qwen-plus、`[llm.auto_tag]` 只写 model；`ai-memory doctor` 通过；Embeddings Reachability 显示 `qwen:qwen3.7-text-embedding` 且维度为 **1024**；端点为私有 MaaS（`base_url` 显式覆盖，公开仓写 `<QWEN_BASE_URL>`） | `product-backlog.md` #8 · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`../scripts/qwen-verify.sh`](../scripts/qwen-verify.sh) | 未开始（模型与维度已定并本地验证，待生产侧落地复核） |
| 2 | 定制 — **工具档位**落地 | 配置 | MCP | 按 Sprint 2 的定档决议，把 `--profile` 写入门户模板与 SSH 模板；用 `initialize` 回包核对实际暴露的工具数与清单一致 | `product-backlog.md` #12 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8 | **已完成（2026-09-21，提前落地于 Sprint 2 #9 收尾）**：`--profile` 已写入四处模板 —— SSH 主人行 `admin` / 用户行 `core`（[`deployment.md`](./deployment.md) §4.3 与 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.1–§5.2）、门户 `launch.argv`（[`web-portal/web-design.md`](./web-portal/web-design.md) §3.3）、本地客户端条目（[`mcp/mcp-test.md`](./mcp/mcp-test.md) §3）；各档工具数实测（探针 [`../scripts/profile-probe.sh`](../scripts/profile-probe.sh) 7 档全绿）与清单一致；TC-TIER-01/02 已通过。**剩余**：生产环境上线后的 `initialize` 回包核对（随 Sprint 5 上线执行） |
| 3 | 定制 — **可用性前提（agent attestation）** | 配置 | 配置 | `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 落到**所有** spawn 路径（门户模板 / forced command / compose / cron）；漏设时显式报错而非静默失败 | `product-backlog.md` #15 · [`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) | 未开始 |
| 4 | 定制 — **上游 `[limits]` 配置与行为验证** | 配置 | 配置 | 在模板补 `[limits]`（**显式写全 7 键并等于 v0.10.0 编译默认**，防升级时默认值静默漂移），生产默认值与测试阈值严格分离；测试**只经环境变量注入小阈值**，禁止改写或污染生产默认值；验证写入量、存储、链接、向量索引容量超限时明确拒绝；通过 `ai-memory quota-status` CLI 交叉核对配额；不扩大公开 `core` / `admin` 档位；实测 `max_page_size` 与 `max_inflight_requests` 对 stdio 的作用并回写唯一真源 | `product-backlog.md` #17 · [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.4 / §9 L · [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-D TC-LIMIT | `[limits]` 七键和本地行为探针已落地；2026-09-21 用户确认可用；HTTP 面及生产通道验证仍待 Sprint 5，详见 `change-log.md` 2026-09-21。 | Done |
| 5 | 定制 — **多用户数据隔离实施**（防线 D1–D5；含**移除 `config.toml.tmpl` 的 `db` 键**） | 安全 | 安全 | ① 移除 `db` 键并注明理由（D2；须实测确认移除后 `serve`/`curator`/forced command 均不受影响）② fail-closed 断言落地（D1）③ 一会话一子进程、禁池化（D3）④ 审计含库路径（D4）⑤ `architecture.md` §6 的 S4 由「静默失败点」升级为**阻断级风险**；`mcp/mcp-design.md` §7 增加**坑 #6**「漏设 `AI_MEMORY_DB` → 静默共用主库」 | `product-backlog.md` #11 · 本文件「阻断级风险」· [`mcp/mcp-design.md`](./mcp/mcp-design.md) §7 | 未开始 |
| 6 | **多用户隔离端到端验证（含负向）** | 任务 | 安全 | **V1 负向**：漏设 `AI_MEMORY_DB` 的会话**必须失败**（不得落到 `/data/ai-memory.db`）；**V2 正向**：目标库 mtime 变化且共享主库未变化；**V3 交叉**：A/B 互不可见；**V4 自检**：相同 env/argv 跑 `doctor --json`，断言 `source` == 目标库路径。**任一不过 → 阻断后续上线** | 本文件「阻断级风险」V1–V4 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | 未开始 |
| 7 | 定制 — **每用户库的后台维护** | 部署 | 部署 | 定调「门户调度 or 主机 cron」并对每库执行 `gc` / `curator --once`；**实测核实** `gc` 是否覆盖每库的 TTL 遗忘与 WAL checkpoint（原方案标为待核实，不得照抄假定） | `product-backlog.md` #13 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.3 | 未开始 |
| 8 | **写路径泄露探针**（去重/合成是否回显他人私有内容） | 研究 | 安全 | 给出明确结论「会」或「不会」；若会则方案 ② 在多用户场景禁用 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.4 #1 | 未开始 |
| 9 | **同步既有文档 9 处矛盾** | 任务 | 文档 | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S9 的 9 项全部修订；重点三条不再自相矛盾：`mcp/mcp-design.md` §6.4（「本仓不承载门户」）、`architecture.md` §2（「无公网入口」）、`architecture.md` §5（自有资产根只有 1 个） | [`web-portal/web-stories.md`](./web-portal/web-stories.md) S9 · [`architecture.md`](./architecture.md) §2 | 未开始 |
| 10 | **本地验证结论回写 `memory.agent-mate.ai/specs/` 技术方案** | 任务 | 文档 | 本 Sprint 的实测结论（`[limits]` 对 stdio 是否生效、`gc` 覆盖范围、写路径泄露结论、隔离验证结果、档位实际暴露数）全部回写到对应 spec；各文件追加变更记录 | `memory.agent-mate.ai/specs/` 全目录 | 未开始 |

> **执行本 Sprint 时须核对的静默失败点**：`deployment.md` §7.2 的三个 + 本文件「**阻断级风险**」的 **R1**。凡涉及「会话落库路径」的验证，一律以 **V1（负向）** 为准入门槛。

### Retrospective

**本轮学到**
- 待填（本 Sprint 结束时补）。

**下轮改进**
- 待填。

---

## Sprint 4

Sprint Goal: 门户开发并与 MCP 集成

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | admin portal — **登录与访问控制** | 功能 | Web App | 仅持有效 Cloudflare Access 身份者可访问管理域名；在 MCP 域名上请求管理 API 被**拒绝** | `product-backlog.md` #2 · [`web-portal/web-design.md`](./web-portal/web-design.md) §6 | 未开始 |
| 2 | admin portal — **key 生命周期** | 功能 | Web App | 签发 / 列出元信息 / 修改 / 轮换 / 删除五个操作均可用；明文仅在创建响应中出现一次；吊销后新建会话被拒、既有会话被终止 | `product-backlog.md` #3 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S2 | 未开始 |
| 3 | admin portal — **记忆身份与数据隔离（门户侧）** | 功能 | Web App | 每用户独立身份与独立库，建用户即就绪；跨用户检索命中不到；库文件属主为 `aimem` | `product-backlog.md` #4 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S4 | 未开始 |
| 4 | admin portal — **审计视图** | 功能 | Web App | 建用户 / 签发 / 轮换 / 吊销 / 每次会话开始（含解析出的库路径）均可查询；日志中不出现令牌明文 | `product-backlog.md` #5 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S5 · [`web-portal/web-test.md`](./web-portal/web-test.md) §2 | 未开始 |
| 5 | admin portal — **容量、配额与限流（门户侧）** | 功能 | Web App | 上游已支持项（配额 / 页大小）以配置纳管而非自建；门户自建的**会话级**并发上限、空闲超时、单会话最长时长在超限时**明确拒绝**；FS 级磁盘配额方案定稿 | `product-backlog.md` #6 · `src/config.rs:3703-3760` | 未开始 |
| 6 | **Integration Instructions 页面** | 功能 | Web App | 新用户按页面指引 ≤ 3 步完成客户端接入并成功调用一次工具；至少支持中 / 英双语切换 | `product-backlog.md` #7 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S3 · [`web-portal/web-design.md`](./web-portal/web-design.md) §2 | 未开始 |
| 7 | **门户 ↔ MCP 会话桥**（HTTP MCP ↔ 子进程 stdio） | 功能 | Web App | 客户端以 `memo_` 令牌经 `<MCP_HOST>/mcp` 建立会话并完成一次写入 + 召回；**一会话一子进程、禁止跨用户复用/池化**（D3）；会话结束子进程被回收 | `product-backlog.md` #14 · [`web-portal/web-design.md`](./web-portal/web-design.md) §3 | 未开始 |
| 8 | 定制 — **公网入口与认证边界**落地 | 功能 | 部署 | 两个域名分流正确（管理面 CF Access / MCP 面令牌）；跨面调用被拒；新增公网入口的决议已同步到 `architecture.md` §2 | `product-backlog.md` #16 · [`web-portal/web-design.md`](./web-portal/web-design.md) §6 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S9 | 未开始 |
| 9 | 定制 — **升级治理：门户镜像随上游重建** | 功能 | 治理 | 门户镜像的构建从 [`../upstream.lock`](../upstream.lock) 注入 tag；升级清单含「重建门户镜像」一步并被演练过，避免门户与部署制品版本漂移 | `product-backlog.md` #18 · [`web-portal/web-design.md`](./web-portal/web-design.md) §11 | 未开始 |

### Retrospective

**本轮学到**
- 待填（本 Sprint 结束时补）。

**下轮改进**
- 待填。

---

## Sprint 5

Sprint Goal: 生产上线与备份闭环

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | SSH 密钥对（调用者 ↔ 野草云4） | 阻塞 | 安全 | 无 passphrase + forced command；`ssh ai-memory` 可完成 MCP 握手 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5 | 待生成 |
| 2 | OSS 私有桶（香港 region + SSE）+ RAM 子账号 AK | 阻塞 | 安全 | 桶为私有 + SSE 已开；AK 仅存服务器侧，不入仓 | [`deployment.md`](./deployment.md) §8（备份与恢复）· 云资源准备清单见 [`../deploy/README.md`](../deploy/README.md)（原需求规格 `mcp_oss_bak_com_requirements.md` 已移出本仓） | 待提供 |
| 3 | **编写 `memory.agent-mate.ai/backup/` 备份脚本** | 任务 | 部署 | `backup-and-push.sh`（快照 → sha256 → ossutil 上传 → **回读比对** → 失败非零退出）与 `restore-drill.sh`（拉最新 → 校验 → restore → `doctor` 通过）可重复执行；`make backup` / `make restore-drill` 可用；**遍历 `/data/users/*`** | `product-backlog.md` #9 · `deployment.md` §8 | 未开始 |
| 4 | **部署执行（ai-memory）** | 任务 | 部署 | `deployment.md` §3 八步落地 + §7.3 冒烟全绿 | `deployment.md` §3 · [`../deploy/README.md`](../deploy/README.md) | 未开始 |
| 5 | **admin portal 部署 + 多用户隔离落地** | 功能 | 部署 | 走通「签发 key → 建立会话 → 隔离生效」；通过 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 与 [`web-portal/web-test.md`](./web-portal/web-test.md) §3；**且必须先通过 Sprint 3 的隔离端到端验证（含负向 V1）** | `product-backlog.md` #4 / #26 · 本文件 Sprint 3 #6 | 未开始 |
| 6 | 定制 — **接入面**落地（HTTP MCP + SSH stdio） | 功能 | 部署 | 两条路径都能完成 MCP 握手并成功读写；**停掉门户后 SSH 路径仍可用**（降级不失效） | `product-backlog.md` #14 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) S3 · [`web-portal/web-design.md`](./web-portal/web-design.md) §2 | 未开始 |
| 7 | 定制 — **备份与恢复**落地（含门户自身库）+ 首次外迁 + 恢复演练 | 功能 | 部署 | 每用户库逐一快照 + manifest；**门户自身库**（与用户记忆库分离存放）纳入同一外迁流程；按 RPO ≤ 24h / RTO ≤ 2h / 日备 30 代 + 月备 12 代 落地；恢复演练可重复执行且通过 | `product-backlog.md` #9 · [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.4 | 未开始 |
| 8 | **上线验收** | 任务 | 部署 | 三份验收清单全部通过：`deployment.md` §7.3 冒烟 + [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 + [`web-portal/web-test.md`](./web-portal/web-test.md) §3；**另用 `initialize` 回包核对对外模板实际暴露的工具数**（用户 `core` = 8 / 管理员 `admin` = 22）—— 承接 **Sprint 2 #10** 的唯一剩余项；同时作为 **D5 / V1** 的执行点 | `product-backlog.md` #26 | 未开始 |

> **执行本 Sprint 时须核对的静默失败点**：`deployment.md` §7.2 的三个（embedder 降级、curator fail-open `tagged=0`、config 挂载路径错误导致 tier 退回 semantic）+ 本文件「**阻断级风险**」的 **R1**。**上线前 D5 必须关闭**：Sprint 3 的负向验证未通过则不得上线。

### Retrospective

**本轮学到**
- 待填（本 Sprint 结束时补）。

**下轮改进**
- 待填。

---

## Sprint 6

Sprint Goal: 升级治理闭环

### ToDo

| # | 事项 | 类别 | 模块 | 验收条件 | 关联文档 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 上游升级**邮件**提醒 | 功能 | 治理 | 检测到「适合升级」的上游版本时发出邮件（现状只有 GitHub issue，不满足需求） | `product-backlog.md` #21 · `deployment.md` §9.1 | 未开始 |
| 2 | **历次版本升级跟踪与记录**（过程资产） | 功能 | 治理 | 每次升级留痕：版本 / 日期 / 判据结论 / 详细步骤 / 验证结果 / 回滚点 | `product-backlog.md` #22 · `deployment.md` §9 | 未开始 |
| 3 | **最低耦合、尽量自动化的升级方案** | 功能 | 治理 | 一次升级可在「改 [`../upstream.lock`](../upstream.lock) → 跑预检 → 重建/重启」内完成，无需手工比对版本号；门户镜像重建纳入同一条链路 | `product-backlog.md` #23 · `adr/ADR-004-version-contract-single-source-of-truth.md` | 未开始 |
| 4 | **制定部署/升级方案与脚本** | 任务 | 治理 | 相关脚本落地且可重复执行 | `product-backlog.md` #24 · `deployment.md` §9 | 未开始 |
| 5 | **升级方案端到端验证并文档化** | 任务 | 治理 | 完整演练一次升级（预检 → 部署 → 验收 → **回滚演练**）并留痕。**注意**：回滚**必须**用快照覆盖 —— 上游不拒绝「比自身更新的库」（旧二进制会静默读写不认识的 schema） | `product-backlog.md` #25 · `knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md` | 未开始 |

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
| 2026-09-21 | **Sprint 2 #11 收口并关闭（引用治理 + 能力文档体例定稿）**：① **引用治理** —— 本文件与 `product-backlog.md` 中指向已合并旧 spec 的 **85 处**引用全部改指合并后文档（`mcp/mcp-design.md` §5 / §6.2 / §6.4 / §7 / §8 / §9 · `architecture.md` §2 / §5 / §6 · `deployment.md` §3 / §7.2 / §7.3 / §8 / §9 · `web-portal/web-design.md` §2 / §3 / §6 / §11 · `web-portal/web-stories.md` S1–S9 · `web-portal/web-test.md` §2 / §3），历史叙述行只把链接降级为纯文本；`link-check.allow` 的两份整文件豁免随之删除，`make doc-links` = 30 文件 / 491 链接 / **0 悬空**（豁免 4 → 2；落盘回顾文档后复跑 31 文件 / 498 链接仍 0 悬空）② **能力文档体例定稿** —— 6 张档位表、每张只列本档新增、编号全档连续 1–101、示例入表；同步 `change-log.md` / `web-portal/web-stories.md` AC6.4 / `mcp/mcp-design.md` §8 三处转述 ③ **Sprint 2 状态置「已结束」**，本 Sprint「Retrospective」由阶段性回顾改为定稿 |
