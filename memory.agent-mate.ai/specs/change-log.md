# 变更日志（memory.agent-mate.ai）

> 本文件记录**结论级**变更：一次改动「做了什么、为什么、怎么验证的」。
> 过程细节与逐日流水不在此堆叠 —— 它们在 `git log` 与各 spec 文末的变更记录里。
> 本文件本身不替代任何 spec：`specs/` 是唯一真源，决议在 [`architecture.md`](architecture.md) §2，ADR 在 [`adr/`](adr/)。

---

## 2026-09-21

### `sprint_plan.md` → `sprint-plan.md` 改名 + Sprint 回顾体例收口（含 Sprint 4 归属校正）

**为什么**：① 文件名用下划线，与仓内其余 spec（`product-backlog.md` / `sdd-scrum-practices.md` / `web-design.md`）的连字符风格不一致；② Sprint 回顾章节此前是**逐条累加**式的（同一 Sprint 里出现「主块 + 多个补记子标题」），越到后期越难看出当前结论；③ 上一批（门户故事引用收口）被记在 Sprint 3，但它实际是 **Sprint 4 #0「web-portal 设计」** 的第一个增量 —— 按 [`sdd-scrum-practices.md`](sdd-scrum-practices.md) §2.3「写入**实际交付该工作的 Sprint**」，应归 Sprint 4。

**做了什么**：

- **改名**：`git mv memory.agent-mate.ai/specs/sprint_plan.md → sprint-plan.md`，按仓内既有改名口径（先例：`hk_vps_4/` → `memory.agent-mate.ai/` 的「引用 227 处 → 0」）全量同步引用，共 **16 个文件** —— specs 内 13 份（[`architecture.md`](architecture.md) · [`change-log.md`](change-log.md) · [`product-backlog.md`](product-backlog.md) · [`sdd-scrum-practices.md`](sdd-scrum-practices.md) · [`web-portal/web-stories.md`](web-portal/web-stories.md) · [`mcp/mcp-test.md`](mcp/mcp-test.md) · [`adr/ADR-006`](adr/ADR-006-public-repo-ip-placeholder-deidentification.md) / [`ADR-010`](adr/ADR-010-specs-single-source-and-doc-structure.md) / [`ADR-011`](adr/ADR-011-doc-style-text-over-icons.md) / [`ADR-013`](adr/ADR-013-sdd-scrum-process-doc-boundaries.md) · [`knowledge/docs/spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md)（含 front-matter `related_spec`）· [`knowledge/git-tooling/gotchas.md`](knowledge/git-tooling/gotchas.md) · 本文件）与脚本 3 个（[`../scripts/iso-probe.sh`](../scripts/iso-probe.sh) 注释 · [`../scripts/link-check.sh`](../scripts/link-check.sh) 注释 · [`../scripts/attestation-paths-check.sh`](../scripts/attestation-paths-check.sh) 的 `$SPECS` 文档清单）。旧名残留由 20+ 处降到 **0 处**，只在改名记录里保留旧→新映射。
- **回顾体例收口**：[`sdd-scrum-practices.md`](sdd-scrum-practices.md) §2.3 新增约束 —— `Retrospective` 只有「做得好」「学到」「下轮改进」三组，同一 Sprint 内的多次回顾**合并进这三组**，不新增「补记」类子标题；并据此把 Sprint 3 已有的三段回顾（主块 + 门户故事引用补记 + #5 维护定档补记）**合并为一组**。
- **归属校正**：门户故事引用收口的回顾由 Sprint 3 迁至 **Sprint 4**；Sprint 4 #0「web-portal 设计」的 `关联文档` 由纯文本清单改为可点击链接，并补「首个增量已落盘、待整体批准」的说明 —— 状态仍为 `ToDo`，因为其验收条件是「用户批准验收」整份门户设计，不因一个增量而关闭。

**验证**：`make doc-links` 33 文件 / **0 悬空**（改名后路径全部可解析）· `make attestation-paths` 五路径通过（`$SPECS/sprint-plan.md` 已同步）· `make secret-check` 干净 · `git diff --check` 干净 · 全仓 `grep sprint_plan` **0 残留**。

**边界**：4 份 ADR（006 / 010 / 011 / 013）内的文件名引用**已随改名同步**，但**未**在 ADR 正文追加「路径同步」附注 —— ADR 是不可变决议记录，历史事实由本小节与 git 历史承载；旧名只在本次改名记录里出现。

### 门户故事号引用订正 + S11/S12/S13 用例登记（web-stories v2.0 收口）

**为什么**：[`web-portal/web-stories.md`](web-portal/web-stories.md) 重写为 ATDD 体例后新增了 S10–S13，但**引用方不会自动跟着变** —— [`product-backlog.md`](product-backlog.md) 与 [`sprint-plan.md`](sprint-plan.md) 中写死的 `S3` / `S9` 仍指向重写前的语义，[`knowledge/web-portal/portal-launch-mechanism.md`](knowledge/web-portal/portal-launch-mechanism.md) 也只引到 `S1/S8`。这正是 [`spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md) 记录的「转述会静默过时」；且 S10–S13 在全仓**没有任何一处正确的外部引用**（S10 被写成 `S9`、S11/S12 被写成 `S9 #7`、S13 零引用）。

**做了什么**：

- **订正 5 个条目的错指（6 处文本 —— `#16` 含描述句与 `关联` 列两处）**：[`product-backlog.md`](product-backlog.md) #7 `S3`→`S6`（接入说明页与 i18n）· #16 `S9`→`S10`（管理面访问控制与面隔离）· #18 `S9 #7`→`S11 / S12`（启动自检版本断言 + 制品契约与升级治理）；[`sprint-plan.md`](sprint-plan.md) Sprint 4 #6 `S3`→`S6` · #8 `S9`→`S10 / S13`。
- **补全缺口引用**：[`sprint-plan.md`](sprint-plan.md) Sprint 4 #1 补 `S10` · #3 补 `S1 / S4` · #5 补 `S7` · #7 补 `S3 / S4 / S13` · #9 补 `S11 / S12`；Sprint 5 #6 补 `S8` · #7 补 `S9` · #8 补 `S7`；Sprint 6 #3 补 `S12` —— 使故事索引里声明的 Sprint 落点全部**双向可查**。[`portal-launch-mechanism.md`](knowledge/web-portal/portal-launch-mechanism.md) Links 由 `S1/S8` 补为 `S1 / S8 / S11 / S12 / S13`（该文件正是这三条的 E1–E7 实测证据来源）。
- **登记用例**：[`web-portal/web-test.md`](web-portal/web-test.md) §2 新增 `TC-P-L0-06`–`TC-P-L0-09`（启动自检四项：用户目录可写 / 向量服务可用性与 1024 维 / 版本断言 / 关键校验在位）与 `TC-P-L1-11`–`TC-P-L1-13`（制品契约三项核对、版本标签由版本锁注入且不继承上游默认值、非 root 运行与容器加固）。`AC12.4`（升级清单含重建门户镜像并演练）是流程留痕项，登记在 §1 测试计划为**人工项**，不设自动化用例。
- **不扩写既有用例号**：`TC-P-L1-08`（无 docker socket）语义保持不变 —— S13 的另两条断言另立 `TC-P-L1-13`，避免同一用例号承载两种语义而使既有引用静默失真。
- **闭合双向映射**：[`web-stories.md`](web-portal/web-stories.md) 故事索引新增 `AC` 列并回填 S11/S12/S13 的具体用例号（含既有 `TC-P-L1-09` 对应 `AC12.2`）；S3 的 Backlog 归属由 `#3 / #14` 校正为 `#14 / #28`（`#3` 只回链 `S2`、`#28` 明确引用 `S3 AC3.5`）；去掉 S4 行重复的同一 Sprint 条目；体例说明补「AC 与用例按区间覆盖、人工项在 §1 登记」的口径；「已知限制与开放问题」第 3 条由「尚无对应用例」改为**已登记**。

**验证**：`make doc-links` · `make secret-check` · `make attestation-paths` · `git diff --check` 退出码 0；全仓复核**错指零残留**（旧故事号只出现在历史变更记录里且为纯文本）；每张被改表的 `|` 计数与列数一致；新增 TC ID 全局唯一且连续（L0 到 09、L1 到 13），并与故事索引双向可查。

**边界**：不扫历史变更记录中的旧故事号（历史叙述不等于引用）。「**静默失败点**」编号与故事号**同名不同义**，一律不动：[`deployment.md`](deployment.md) §7.2 的 S1–S3、[`web-portal/web-design.md`](web-portal/web-design.md) §5 的 S4，以及 [`web-portal/web-test.md`](web-portal/web-test.md) 与 [`sprint-plan.md`](sprint-plan.md) 中沿用该编号的行；[`../scripts/i18n-probe.sh`](../scripts/i18n-probe.sh) 的测试项标签 `S1–S12` 同理。[`product-backlog.md`](product-backlog.md) 中「本应引用故事号但当前未引用」的条目（#2 / #6 / #11 / #17 / #26 / #29）本轮未动；#14 已引 `S3`，其缺的是 S8 侧（已由 Sprint 5 #6 补上）。如需继续补齐另开。

### Sprint 3 #5 收口：每用户库维护行为定档（宿主机 cron + 覆盖面实测）

**做了什么**：把「每个用户的库由谁定期打扫、按什么命令、失败怎么办」定档，并给出**行为级**证据（不再停留在设计文档的「覆盖面未验」）。

- **调度定档 = 宿主机 cron**（用户确认）。理由是维护属运维性质、与「多用户接入」这一产品功能解耦，且门户方案要到 Sprint 4 才存在（只能写决议、拿不到证据）。
- **维护入口落成脚本**：新增 [`../scripts/maintain-user-dbs.sh`](../scripts/maintain-user-dbs.sh)（Bash 3.2；`--dry-run` / `--max-ops` / `--root`；退出码 0 / 1 / 2），并接 `make maintain-user-dbs`。文档只引用脚本路径 —— 只有脚本才能被 cron 稳定调用、被探针静态审计、被路径一致性护栏覆盖。逐 (库, 命令) 独立 `docker exec`，使失败可精确定位到库。
- **两条硬约束**：每条调用**显式 `--db <绝对路径>`**（源码侧 `--db` 只是 `AI_MEMORY_DB` 的 fallback：不传且 env 缺省时会**静默新建**相对路径 `ai-memory.db`；容器内该 env 指向**主库**）与**显式 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`**（v0.11 起上游缺省翻转为全 surface required）。
- **失败语义**：单库失败**不中断**、打印可定位信息后继续，最终非零退出供 cron 告警 —— 遇错即停会让排在后面的库永远得不到维护。**环境不可用（容器未运行 / 无法列举用户库）以 `3` 响亮失败**，绝不把「什么都没维护」当成成功：终审时发现首版在容器未运行时 `list_dbs` 返回空集、会以「未发现任何用户库」的样子静默成功（rc=0），正是本项目最忌讳的失败形态，已补前置存活检查与 `list_dbs` 退出码校验。退出码契约：`0` 成功 / `1` 有库失败 / `2` 参数错误 / `3` 环境不可用。
- **探针**：新增 [`../scripts/gc-probe.sh`](../scripts/gc-probe.sh)（L1.8；退出码 0/10/20/30/40/50/60/70；`--self-test` 负向自测），实跑退出码 0、7 项断言通过。

**实测得到的三条覆盖面结论**（都已推翻或修正既有假定）：

1. **TTL 驱逐不只由 `gc` 触发** —— `db::gc_if_needed`（`src/storage/mod.rs:10502`）被 `cmd_list`/`store`/`recall`/`import` 与 MCP `memory_recall` fire-and-forget 调用 ⇒ `gc` 的 `expired_deleted` **只是「此刻还剩下的过期数」，不是「过期总量」**（探针实测：先 `list` 再 `gc` 会得到 0）。`cmd_get` 不触发清扫，所以「过期但未 gc 的行按 id 仍可读」成立。**推论：维护作业不能靠业务查询代劳** —— 一个只被按 id 读或根本无人访问的用户库，只有 `gc` 会来收尸。
2. **WAL 回收已被 `gc` 覆盖**（原设计文档标「未验」）—— `Command::Gc` 在 `is_write_command` 名单内 ⇒ 分发器 post-run `wal_checkpoint(TRUNCATE)`。实测：长活 MCP 会话把 `-wal` 撑到 1499712 字节，跑一次 `gc` 后**归零**；`curator` 不在名单内，靠 SQLite 干净关闭时的自动 checkpoint。
3. **过期为归档而非硬删** —— `archive_on_gc` 默认 `true` ⇒ 行进 `archived_memories`（`archive_reason='ttl_expired'`）；归档会持续累积，逃生口是既有的 `archive purge`（其调度留 Sprint 5）。另注：CLI `gc` 读的是旧顶层键 `archive_on_gc`，只写 `[storage].archive_on_gc` 对它不生效。

**过程中的四处自纠**（都已沉淀成断言或代码注释）：

- **WAL 归零断言首版是竞态**：不等写入方静默就跑 `gc`，因 `memory_store` 之后的 deferred-audit 仍在追加，TRUNCATE 之后立刻长出新帧（实测残留 107152 字节）。改为「连续 5 次采样 `-wal` 无变化再动手」后确定性归零。
- **「`-wal` 非零」不等于「写完了」**：三条写入是**串行**且每条都含 embedding，第一条落库就让 `-wal` 非零；首版据此立刻校验三条响应，于是偶发 `missing responses: [12]` 假失败（连续复跑时暴露）。改为有界轮询等待**三条响应到齐且无 `isError`** 再进入下一步。
- **绝对计数断言被上游副作用推翻**：非干跑 `curator --once` 会写入**自报告记忆**，使多库计数从 1 变 3。改为相对口径（计数不下降 + 播种的存活行仍可按 id 读回 + 库 A 的记忆在库 B 中取不到 + 共享主库计数不变）。
- **两处脚本缺陷**：① `seed()` / `count_of()` 原先在命令替换（子 shell）内调用 `die`，不会终止父进程 —— 改为全局变量回传；② 容器内列举用户库的 glob 未命中时 `[ -f "$f" ]` 返回 1，在 `set -o pipefail` 下把「没有用户库」误报成「列举失败」（终审时被新增断言抓到）—— 内层 `sh` 补显式 `exit 0`。

**跨条目挂账闭环**：ToDo #1 挂账的「每用户维护命令随 #5 验收」与 ToDo #2 挂账的「每库维护命令随 #5 定档时同批审计（须显式 `--db`）」已同时闭环 —— [`../scripts/attestation-paths-check.sh`](../scripts/attestation-paths-check.sh) 扩到**五路径**，新增断言 E（维护命令沿用与 `deployment.md` 用户行**同一** attestation 取值、且每条 `ai-memory` 调用显式 `--db`）并补负向注入自测（缺 `--db` / 缺 attestation 均 fail-closed）。提交说明中已记录：本次同时落盘此前未提交的 TC-ATT-02 护栏文件。

**结论回写唯一真源**：[`mcp/mcp-design.md`](mcp/mcp-design.md) §5.3（调度定档 + 覆盖面表 + 两条硬约束 + 失败语义 + 边界）· [`mcp/mcp-test.md`](mcp/mcp-test.md) §1 新增 **L1.8** / §2 完成态 / §4-C `TC-GC-01..04` / §5 · [`deployment.md`](deployment.md) §5.3「每库维护」小节 + §14 · [`product-backlog.md`](product-backlog.md) #13（`Implemented`）· [`sprint-plan.md`](sprint-plan.md) #5（`Implemented`）+ Sprint 3 Retrospective 补记 · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 表行 + 教训 21 + Links · 根 `Makefile` 新增 `maintain-user-dbs` 目标并把 `attestation-paths` 描述改为五路径。

**可复跑验证**：`bash memory.agent-mate.ai/scripts/gc-probe.sh`（退出码 0）· `--self-test` · `bash memory.agent-mate.ai/scripts/attestation-paths-check.sh --self-test` · 回归 `mcp-smoke.sh` / `iso-probe.sh` / `limits-probe.sh` · `make doc-links` / `make secret-check` / `make attestation-paths` / `make preflight-test` · `git diff --check`。

**边界**：生产定时器安装、日志采集与告警留 Sprint 5；HTTP 面与生产通道复验同属 Sprint 5。

**用户验收**：2026-09-21，Robert Smith 确认可用。

**ADR：无新增** —— 本轮是「按上游既有契约选择调度形态 + 把覆盖面钉成可复跑断言」，属既有策略（宿主机侧运维、一用户一库、模板显式写死）的执行层，未引入新的架构或流程取舍。

### RID 解决方案全链路追踪 + Sprint Retrospective 双写规则

**为什么**：RID 的解决方案虽已下沉 Product Backlog，但原链接只定位到文件顶部，Sprint 落点也是不可点击文本，无法沿 `Product Backlog → Sprint Backlog → design/test` 核对实施链；`retrospective` 技能也只要求 ADR / knowledge 沉淀，未强制回写实际交付 Sprint。

**做了什么**：为 RID 涉及的 Product Backlog 与 Sprint Backlog 条目增加稳定锚点；RID 表和覆盖矩阵改为条目级可点击链路；Product Backlog 的 `关联` 列回链具体 Sprint 执行项与设计/测试依据。更新 [`sdd-scrum-practices.md`](sdd-scrum-practices.md)，规定完整追踪链与稳定锚点，并规定每次 retrospective 必须写入实际交付 Sprint 的 `Retrospective`，ADR / knowledge 仅在有持久价值时追加。

**验证**：核对 5 个 Product Backlog 锚点、6 个 Sprint 锚点均有定义和双向引用；RID 8 行覆盖矩阵无空项；Markdown 诊断无新增问题；链接回归见本次验证记录。

**边界**：不复制 Product、Sprint、design/test 的状态或正文；各自仍是其信息类型的唯一真源，跨文档只通过稳定链接导航。

### SDD/Scrum 过程文档体例收口：RID 单向下沉 + 状态与说明分列

**为什么**：RID Registry 把 R1–R3、D1–D5 与 V1–V4 混在同一张表，风险行通过 D/V 编号互相引用，解决方案、验证方法和执行状态重复；Sprint ToDo 与 Product Backlog 的状态列还混入日期和长篇过程说明，无法按枚举核对。

**做了什么**：

- 新增 [`sdd-scrum-practices.md`](sdd-scrum-practices.md) 与 [`ADR-013`](adr/ADR-013-sdd-scrum-process-doc-boundaries.md)，固定 RID Registry、Sprint Backlog、Product Backlog 的列定义、四态语义和单一真源边界。
- RID 表只保留 R1–R3 与 D1–D5；V1–V4 从 RID 行移除，但作为稳定判据名保留，定义归位到 [`mcp/mcp-design.md`](mcp/mcp-design.md) §6.2 与 Product Backlog #11 的验收条件。新增 8 行覆盖对照，逐条给出 Backlog、验收条件与 Sprint 落点，无空项。
- 6 张 Sprint ToDo 表新增「说明」列，状态只写 `ToDo` / `WIP` / `Implemented` / `Done`；长说明压缩为摘要并指向过程文档。三项原本仅存在于旧状态列的事实在本小节保留：Sprint 2「Qwen key」已从本地 secrets 回填 gitignored `.env.local` 并通过 `qwen-verify.sh` / `doctor`；临时文件 `tmp_user_key_option1.md` 经用户决定直接删除且确认不含真实密钥；Sprint 3「部署文档与事实一致性」已完成旧编号传播机械扫描，完整字段核对仍未完成。
- Product Backlog 状态只写四态枚举；#4 / #11 / #14 / #26 的验收条件分别承载 D1、V1–V4、D3、D5，#17 校正为 `[limits]` 七键与本地行为探针已落地。`architecture.md` §6 改为薄索引。

**验证**：RID 覆盖表 8 行逐项人工核对；Markdown 表格列数与状态枚举人工检查；回归执行 `make doc-links`、`make secret-check`、`make attestation-paths`、`make preflight-test` 与 `git diff --check`。

**边界**：不新增状态/覆盖护栏脚本或 Makefile 目标；不改 `scripts/link-check.allow`、gitignored 文件及 Sprint 4–6 未开始条目的事项与验收条件；过程证据仍归现有设计、测试与变更文档。

### Sprint 3 #4 收口：上游 `[limits]` 容量与配额（模板显式定默认 + 行为探针）

**做了什么**：把上游 `[limits]` 段落进生产模板并给出**行为级**证据，同时把「配置生效」与「行为生效」两件事分开证明。

- **模板（策略：显式等于编译默认）**：`deploy/config.toml.tmpl` 新增 `[limits]`，**写全 7 键且取值等于 ai-memory v0.10.0 编译默认**（`1000` / `104857600` / `5000` / `1000` / `0` / `100000` / `false`），注释说明优先级（env > section > 编译默认）、非正值视为未设、逐 `(agent_id, namespace)` 盖章、CLI 写入不计费、`max_page_size` 与 `max_inflight_requests` 为 HTTP 面专属，以及本地 `config.local.toml` 缺该段时的**行为等价性**。选「写死默认值」而非「留空靠上游」与 `--profile core`、`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 同源：不写就等于把行为交给上游默认值，而改变是**静默**的。
- **探针（不污染生产默认值）**：新增 [`../scripts/limits-probe.sh`](../scripts/limits-probe.sh)（Bash 3.2；退出码 10/20/30/40/50/60/70；含 `--self-test` 负向自测）。**只经 env 注入小阈值**，在**独立一次性库**（`/data/users/limits-probe/`，退出时按唯一时间戳前缀连同 `deferred-audit` 旁路日志一并清理）上用**每轮全新身份**运行：
  1. 三类配额各取一个全新 `agent_id`：`AI_MEMORY_MAX_MEMORIES_PER_DAY=1` → 第 2 条 `memory_store` 被拒；`AI_MEMORY_MAX_STORAGE_BYTES=1` → 首条即被拒；`AI_MEMORY_MAX_LINKS_PER_DAY=1`（会话内 `--profile graph`）→ 第 2 条 `memory_link` 被拒。错误串均含 `QUOTA_EXCEEDED`，并以 `quota-status --namespace global --json`（**刻意去掉注入 env**）交叉核对配额行**仍等于注入值** —— 同时证明「配额行在首次写入时盖章」与「注入阈值确实生效」。
  2. 向量容量：`capacity=1` + `hard_fail=true`，**跨进程**预热 ≥1 条后插入被拒（先断言阻塞预热已落地），同时断言**记忆行仍落库**（`insert` 返回 `void`，不回滚）。
  3. 面归属：`max_page_size=1` / `max_inflight_requests=1` 下 stdio 会话的写入与列表**均正常** ⇒ 二者确为 HTTP 面专属。
  4. 探针内还机械断言模板七键恒等于编译默认、且未混入测试阈值（防「测试值污染生产」）。
- **结论回写唯一真源**：[`mcp/mcp-design.md`](mcp/mcp-design.md) §5.4（配额契约）+ §9 新增「**L. 容量与配额**」7 条依赖与陷阱 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §4-D（`TC-LIMIT-01` 具体化 + 新增 `TC-LIMIT-02`）· [`deployment.md`](deployment.md) §5.3 七键表 + §14 · [`sprint-plan.md`](sprint-plan.md) #4 完成态 · [`product-backlog.md`](product-backlog.md) #17（两套前缀更正）· [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 实测表 + 教训 20。

**三个只能实测得到的坑**（已全部沉淀）：
1. **默认日志过滤器看不见触顶** —— 触顶日志 target 是 `hnsw.eviction`，而 MCP 默认 directive 只有 `ai_memory=info`；不显式放宽 `RUST_LOG` 就永远观测不到，容易被误判为「功能失效」。首轮断言失败即栽在这里。
2. **配额逐 `(agent_id, namespace)` 盖章** —— 行在首次写入时固化**当次进程**的默认值，事后改配置**不追溯**；这条决定了探针必须「新身份 + 一次性库」，否则会得出「配置没生效」的错觉。
3. **CLI 一次性写入不计费** —— 用 `ai-memory store` 永远验不出配额失效；只有 daemon 面 MCP 写路径调用 `check_and_record`。
4. **`quota-status` 查错 namespace 会「自建行 + 报默认值」** —— MCP `memory_store` 默认写入 **`global`** 命名空间，而 `quota-status --namespace <ns>` 对**不存在的** `(agent, namespace)` 会**现场建行**并按当前 env 盖章。首版探针查 `default` 且**带着同一注入 env**，等于自己把值写进了新行 —— 是一条**自证式（恒真）断言**。终审时用「去掉 env 复读」把它试出来，修正为「去掉 env + `--namespace global`」后该断言才真正可失败。

**可复跑验证**：`bash memory.agent-mate.ai/scripts/limits-probe.sh`（退出码 0）· `--self-test` · 回归 `mcp-smoke.sh` / `iso-probe.sh` · `make doc-links` / `make secret-check` / `make attestation-paths` / `make preflight-test` · `git diff --check`。

**边界**：HTTP 面超限（`max_page_size` / `max_inflight_requests` 真正触发）本地**无法验证**（容器不发布端口、镜像内无 curl/wget）⇒ 留 Sprint 5 生产通道；生产 SSH 通道的配额复核同属 Sprint 5。

**ADR：无新增** —— 本轮是「按上游既有契约使用配置 + 显式固定默认值」，属既有策略（ADR-009 隔离、档位定档同源）的执行层，未引入新的架构或流程取舍。

### Sprint 3 #1–#3 完成质量修复：口径单点化 + 调用点审计留痕 + 状态登记校正 + 静态护栏

**为什么**：对 #1–#3 做只读质量复核，发现三类问题 —— ① #1 的「失准表述更正」只落到了 `mcp-design` §9 B3 与 `mcp-test` §4-D，**被引权威与引用方仍有 4 处残留**；② #2 的验收里含「每库维护命令审计」，而该命令是 #5 的产物、当时并不存在，属**不可验证项**，且审计无留痕；③ #3 的探针扎实，但 `sprint-plan.md` 风险表 D2/D5/V1/V2 的状态与同文件 Sprint 3 表的「已完成」**互相矛盾**，V4 的「与模板完全相同的 env」措辞也强于实现（实际只传三项）。

**根因**：这正是 [`ADR-010`](adr/ADR-010-specs-single-source-and-doc-structure.md) 与 Sprint 2 Retrospective 记过的「**被引文档/权威未同步 ⇒ 转述静默过时**」——修一处漏一处，且没有护栏能发现。

**做了什么**

1. **口径单点化**：`architecture.md` §2.1 #9（attestation 单点权威，也是 `mcp-design.md` §5.2 引用的目标）、`product-backlog.md` 第 99 行、`docker-compose.prod.yml` 第 27 行注释、`knowledge/local-dev/ai-memory-local-run-gotchas.md` 第 31 行，全部删除已证伪的「不设会 403」与不可观测的「写入标记为 `claimed`」，改为 v0.9 / v0.10.0（surface-scoped）/ v0.11（缺省翻转）三段式，并指向真源 `mcp-design.md` §9 B3。`product-backlog.md` #15 的「三路径」计数与同事实其他表述统一为**四处**，状态由「进行中」改 **Done**。
2. **审计可验证化 + 留痕**：`mcp-design.md` 新增 **§6.5 库路径调用点审计**（现存 5 条：compose ×2 / SSH 管理员行 / SSH 用户行 / 门户模板，逐条给出「库路径来源 + 证据位置」与复跑 grep 命令），结论是**无一条依赖 config 的库路径**。`sprint-plan.md` #2 验收把「每库维护命令」移出本条目（明确随 #5 定档时同批审计），标题改为「现存路径调用点审计」，并回链 §6.5。
3. **状态登记校正**：`sprint-plan.md` 风险表 D2 / D5 / V1 / V2 / V3 / V4 与 R1 / R3 的状态列改为与 Sprint 3 表一致（本地已完成项标完成、生产项留 Sprint 5 #8、D1 留 Sprint 4 #7），消除同文件自相矛盾；`mcp-design.md` §6.1 D2 与 §6.2 V1–V4 同步；§0 的「漏设即静默落主库」补上 **D2 前/后**限定，§0.1「会话 env 三件套」注明实际为**四项**（含 attestation）。
4. **措辞与实现对齐**：`iso-probe.sh` 的四个会话 env 数组补 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`，使 V4 的「与模板用户行相同的服务端 env」成立（对 `source` 解析与既有断言无影响，容器级本就为 `0`）。
5. **新增静态护栏**：`scripts/attestation-paths-check.sh`（`make attestation-paths`，只读 / 无 Docker / 无网络，退出码 0/10/20）—— 断言 A 四路径模板同值、B `deployment.md` 用户行与 `mcp-design.md` §5.2 的 `-e` 子句**逐字一致**、C 门户 launch 模板含该 env、D 现行文档无已证伪口径回流；`mcp-test.md` 登记为 **TC-ATT-02** 并纳入 §2 回归触发条件。

**验证**：`make attestation-paths` → 0；`iso-probe.sh` → 0（V1 `rc=2`、`resolved=/ai-memory.db`、主库计数 36 不变，V2–V4 与 P6 硬断言全绿）；`mcp-smoke.sh` → 0（8 工具 / 写入 / 召回 / attestation 正负对照）；`make doc-links` / `make secret-check` / `make preflight-test`（5/5）与 `git diff --check` 全绿。护栏另做**五类负向注入自测**（基线 0、curator 缺 env 10、失准口径回流 20、两模板不一致 10、用户行整行缺失 10）—— 确认非「恒绿」。

**过程中自纠一处**：护栏 D 检查最初会被 `mcp-test.md` 自身对禁用字面量的**引述**触发（跑完护栏后才补的 TC-ATT-02 引入），实测 `rc=20` 与文档自称「已完成」矛盾；改为「不复述字面量、只指向脚本内 `STALE_PATTERNS`」，并在脚本内写明该约束。同批修复 `env_clause` 在 `pipefail` 下模板缺失时以未文档化退出码 1 早退的问题。

**边界**：生产 SSH 通道复验仍属 Sprint 5 #8；门户 D1 的 spawn 前置断言仍属 Sprint 4 #7；每库 `gc` / `curator --once` 覆盖面仍属 Sprint 3 #5。

### Sprint 3 #2–#3：移除共享 DB fallback + 隔离负向门禁定型

**做了什么**：把本地配置派生、隔离负向探针和 Sprint 3 现行文档口径收紧为可复现的 fail-closed 验收，不依赖人工修改 gitignored 配置，也不把弱证据误报为通过。

**实现**：tracked 的 [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) 移除顶层 `db`；[`../scripts/local-up.sh`](../scripts/local-up.sh) 从 `config.local.toml` 派生运行时配置时剥离裸键、双引号键和单引号键形式的顶层 `db`，保留 section 内同名键，并用临时文件、原子替换和 `0600` 权限生成 `.env` / `config.toml`；结果含顶层 `db` 时拒绝启动。

**探针**：[`../scripts/iso-probe.sh`](../scripts/iso-probe.sh) 的 V1 现在要求漏设 `AI_MEMORY_DB` 时 `doctor` 非零；只规范化同一次响应中的 `source`，要求绝对路径且不等于 `/data/ai-memory.db`，失败原因属于存储路径；主库记忆计数在 P1a 与 P2 前后均必须可读且不变。P3 复用完整用户环境，方案②对照的伪造写入与归属可见性改为硬断言。

**文档同步**：更新 `sprint-plan.md` 风险 / D2 / V1 / V2 及 Sprint 3 #2–#3 状态；更新 `mcp-design.md`、`mcp-test.md`、`web-portal/web-test.md`、ADR-008/009 的现行归属与验收表述；历史变更日志中的旧编号保留，并将已取消的方案②写路径泄露探针明确标注为取消。

**验证**：`bash memory.agent-mate.ai/scripts/local-up.sh` 成功重建本地服务；`bash memory.agent-mate.ai/scripts/iso-probe.sh` 退出码 **0**。V1 实测 `rc=2`、`source=ai-memory.db` 规范化为 `/ai-memory.db`、共享主库计数不变；V2–V4、P4、P5 与方案②硬断言全部通过。静态夹具覆盖三种顶层 `db` 键形式且通过；脚本语法与 `git diff --check` 通过。

**边界**：生产 SSH 通道复验仍属 Sprint 5 #8；有效但错误他库路径的门户 spawn 前置断言仍属 Sprint 4 #7；每库 `gc` / `curator --once` 覆盖面仍属 Sprint 3 #5。

### Sprint 3 #1：agent attestation 现存路径收口（含两处失准表述更正）

**做了什么**：核对 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 在**现存**启动路径中的口径，补上 [`mcp/mcp-design.md`](mcp/mcp-design.md) §5.2 模板缺的那一项，并把「用哪个判据证明开关生效」从**不可观测的字段**换成**可复现的正负对照**。

**口径核对（现存四处，全部一致）**：[`../deploy/docker-compose.prod.yml`](../deploy/docker-compose.prod.yml) 的 `ai-memory` / `curator` 两处；[`deployment.md`](deployment.md) §4.3 用户行；[`web-portal/web-design.md`](web-portal/web-design.md) §3.3 门户模板。缺项只有一处：`mcp-design.md` §5.2 的 forced-command 模板 —— `deployment.md` §4.3 把它称作「完整模板」并指过去，它却比那边少一项。补法是**与 `deployment.md` 用户行逐字一致**；§5.1 单人行按既有口径**不写** `-e`（依赖容器级变量，与 `deployment.md` §4.3 管理员行一致），并把这层依赖**显式写成注释**，免得被读成遗漏。

**实测推翻两处既有表述**（关键，别再照抄）：

| 原表述 | 实测（v0.10.0，本地基线容器） |
| --- | --- |
| `mcp-design.md` §9 B3：不设 → 写入 `403 ATTESTATION_FAILED` | 该变量在 v0.10.0 是 **surface-scoped**：MCP / CLI 缺省**宽松**（`unset` 后写入**成功**、无告警）；HTTP direct-write 缺省要求签名；`=1` 是**全局严格**（拒无签名写入：`agent attestation failed: … this write is unsigned`）；**v0.11 起缺省才翻转为全 surface required** |
| `mcp-test.md` §4-D TC-ATT-01：写入返回 `attest_level=claimed` | **该字段在 v0.10.0 不可观测**。这句措辞出自上游文档与 daemon 的 `SECURITY POSTURE (#1798 R-12)` 启动告警（**仅**绑非回环且宽松时打印；本部署 `serve --host 127.0.0.1`，故从不打印）。MCP 响应 / `memory_get` / `export` / `memories` 表都没有它；库内带 `attest_level` 的只有 `memory_links` / `governance_rules` / `signed_events` / `archived_memory_links` / `model_attestations` 等表，且为空或 `unsigned` |

**换成什么判据**：**正负对照** —— 同一形态的写入 `=0` 必须成功（无 `isError`）、`=1` 必须被拒且原因含 attestation。它比字段断言**更强**：能证明「这个 env **仍被上游读取**」，从而同时兜住「上游改名 / 移除该 env」这类静默失效。已固化为 [`../scripts/mcp-smoke.sh`](../scripts/mcp-smoke.sh) 的**会话 C**（失败退出码 50）。

**验证**：`bash memory.agent-mate.ai/scripts/mcp-smoke.sh` → 退出码 **0**（握手 / 8 工具断言 / 写入 / 跨进程语义召回 + 关键词检索 / **attestation 正负对照**全绿）。

**回写**：[`sprint-plan.md`](sprint-plan.md) Sprint 3 #1 → **已完成**（含验收口径更正与「变更记录」行）；[`product-backlog.md`](product-backlog.md) #15 说明按实测更正，并注明「漏设即 fail-loud」在 v0.10.0 服务端**不可得**、只能落在门户 spawn 前置断言（随 Sprint 4 #7）；上游事实沉淀见 [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)。

**ADR：无新增** —— 本轮是实测更正 + 护栏加固，属 [`ADR-010`](adr/ADR-010-specs-single-source-and-doc-structure.md) 文档纪律的执行层，不产生新的架构 / 流程决议。

### Sprint 2 #11 收口：引用治理 + 能力文档体例定稿

**做了什么**：把 `sprint-plan.md` / `product-backlog.md` 中指向已合并旧 spec 的 85 处引用全部改指合并后文档与对应章节，删除 `link-check.allow` 的两份整文件豁免，并同步因能力文档体例变更而失准的转述。

**引用改写（旧名 → 新落点）**：`multiuser_isolation.md` → `mcp/mcp-design.md`（§5 配方族 / §6.2 V1–V4 / §6.4 未决前提 / §7 五个坑）；`mcp_tool_inventory.md` → `mcp/mcp-design.md` §8；`upstream_coupling_surface.md` → `mcp/mcp-design.md` §9；`admin_portal_design.md` → `web-portal/web-design.md` / `web-portal/web-stories.md` / `web-portal/web-test.md`（按设计 / 验收条件 / 测试清单分流）；`asset_isolation_plan.md` → `architecture.md` §5；`deployment_strategy.md` §0 → `architecture.md` §2；`dev-plan.md` §3 / §3.3 / §3.4 / §4 / §5 → `deployment.md` §3 / §7.3 / §7.2 / §8 / §9；`deploy/deployment-plan.md` → `deployment.md`。

**历史叙述不动**：两份文件「变更记录」行里的旧文件名是**当时事实**，只把链接降级为纯文本（去链接、留名字），不改指新文档。

**漏改自检（两类典型）**：① 共享前缀的省略写法会漏掉后半段章节号（`dev-plan.md` §3.2 八步落地 **+ §3.3 冒烟**）；② 多对一合并会产生重复列举（`deploy/deployment-plan.md` 与 `dev-plan.md` 都归 `deployment.md`）。两处均已订正。

**为什么不停在「文档级链接」**：目标章节在合并时按主题重排，逐处核对锚点后仍能精确落位（`architecture.md` §6 · `deployment.md` §7.2–§7.3 · `mcp/mcp-design.md` §6.2 等）；只有把握不足处才退化为文档级链接。

**验证**：`make doc-links` → 30 文件 / 491 链接，**0 悬空**，允许清单豁免 **2** 个文件（原 4 个）；两份文件行数与表格列数逐行比对未变。落盘回顾文档后复跑：31 文件 / 498 链接，仍 **0 悬空**。

**Sprint 2 收官**：`sprint-plan.md` 的 Sprint 2 加「**状态：已结束**（全部条目完成）」，其 `Retrospective` 由阶段性回顾改为**定稿**（补 3 条本轮实证：档位文档体例 = 只列增量 + 连续编号；能力说明必须与探针实测逐项对齐；被引文档改版会让引用方转述静默过时）。回顾落盘 [`knowledge/docs/spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md)（`knowledge/README.md` 索引同步）—— **ADR：无新增**（本轮的体例与引用纪律是 [`ADR-010`](adr/ADR-010-specs-single-source-and-doc-structure.md) 的执行层细化，不产生新的架构/流程决议，避免 ADR 碎片化）。

### Sprint 2 #10 定稿核查 + 两处文档体例改造（#11 扩展）

**做了什么**：核查「MCP 对外能力清单定稿」是否真的完成（结论：**已完成**），并把用户要求的两处文档改造登记进 Sprint 2 #11、本轮一并做完。

**一、#10 的四项最终决议 —— 均已定稿且有落点**

| 决议 | 结论 | 落点 |
| --- | --- | --- |
| 档位 | 对外 = `core`（8 项）；管理员入口 = `admin`（22 项） | [`mcp/mcp-design.md`](mcp/mcp-design.md) §8.1 / §8.3 + 四处模板（[`deployment.md`](deployment.md) §4.3 · [`mcp/mcp-design.md`](mcp/mcp-design.md) §5.1–§5.2 · [`web-portal/web-design.md`](web-portal/web-design.md) §3.3 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §3） |
| i18n 范围 | **部分支持**（存储与语义召回可用；关键词通路受 FTS5 `unicode61` 限制、简繁不归一；无任何配置项） | `product-backlog.md` #10（Done）· [`mcp/mcp-design.md`](mcp/mcp-design.md) §2 / §9 J4 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §1 L1.6 / §4-E · 探针 [`../scripts/i18n-probe.sh`](../scripts/i18n-probe.sh) |
| LLM 选择 | `tier = smart` + `qwen-plus` + `qwen3.7-text-embedding`（`dim = 1024`）+ 显式 `base_url` | [`architecture.md`](architecture.md) §2.1 #3/#4 · [`adr/ADR-007`](adr/ADR-007-qwen-private-maas-endpoint-and-measured-embedding-dim.md) · [`deployment.md`](deployment.md) §5.3 |
| 备份选择 | OSS 私有桶（香港 + SSE）+ 每日外迁 + sha256 校验 + RPO ≤ 24h / RTO ≤ 2h | `product-backlog.md` #9 · [`deployment.md`](deployment.md) §8 |

清单已落入公开文档 [`mcp/mcp-capabilities.md`](mcp/mcp-capabilities.md)；`product-backlog.md` #19 → **Done**。**唯一剩余**：生产环境上线后用 `initialize` 回包核对实际暴露工具数 —— 已并入 `sprint-plan.md` **Sprint 5 #8 上线验收**，不再挂在执行条目里造成假性阻塞。

**二、[`mcp/mcp-capabilities.md`](mcp/mcp-capabilities.md) 结构重构（用户视角）**

| 改动 | 说明 |
| --- | --- |
| §1 与 §2 合并 | 合并为「这是什么，怎么接上」，并新增 `mcp.json` **三种形态**示例：托管门户（HTTP）/ 本机自托管（stdio via `docker exec`）/ SSH 通道；示例一律占位符（`<MCP_HOST>` / `<你的令牌>`），并注明「档位由服务端决定、改完必须重连」 |
| 工具说明改为**按档位** | 原「按族」的 8 个小节取消，改为 **6 张档位详表**：`core` 8 / `admin` 22 / `graph` 20 / `power` 57 / `full` 101 / 自定义 `core,lifecycle` 14；**每张表只列本档新增**（上一档已列过的不重复），首列为**全档连续编号**（`core` 1–8 / `admin` 9–22 / `graph` 23–34 / `power` 35–83 / `full` 84–101；自定义 `core,lifecycle` 沿用 9–14），其余列固定为「工具 / 做什么 / 什么时候用 / **示例**」 |
| 例子进表格 | 原独立的「一个完整的例子」章节**删除**，示例并入表格的「示例」列（一句自然语言用法） |

工具数与成员**以运行时实测为准**，非手工整理：档位计数用 [`../scripts/profile-probe.sh`](../scripts/profile-probe.sh)（7 档全绿），成员清单用逐档 `tools/list`，功能说明用 `memory_capabilities` 的 verbose drilldown（8 族，101/101 取到完整 `docs`）—— 裸 `tools/list` 的 `description` 是被截断的短描述，不可用于对外说明。

**三、[`sprint-plan.md`](sprint-plan.md) 体例改造**

- **阻断级风险单表化**：原「风险 / 必须落地的防线 / 验证方法」三张表合并为**一张 11 列表**（编号 / 级别 / 类型 / 标题 / 说明 / 影响 / 解决方案 / 验证方法 / 关联文档 / 状态 / 更新日期）；**R1–R3 + D1–D5 + V1–V4 全部成行并保留编号**，风险行的「解决方案」指向 D 行、「验证方法」指向 V 行，维持跨条目引用锚点。
- **级别换算**（原用「严重 / 高」，新体系为 致命 / 阻塞 / 严重 / 中 / 低）：

| 编号 | 原级别 | 新级别 | 理由 |
| --- | --- | --- | --- |
| R1 | 严重 | **致命** | 不报错、不告警，后果是跨用户数据串号（发现即已污染） |
| R2 | 高 | **严重** | 单点失效即串号（隔离无纵深） |
| R3 | 高 | **严重** | 与 R1 同源同后果 |
| D1 / D2 / D5 | — | **阻塞** | 不落地则不得上线（D2 是唯一能覆盖「漏设」的手段） |
| D3 | — | **严重** | 跨用户复用 / 池化即串号 |
| D4 | — | **中** | 影响可审计性 / 可观测性 |
| V1 | — | **阻塞** | 上线准入门槛（负向） |
| V2–V4 | — | **中** | 本地版已通过，生产待执行 |

- **每个 Sprint 后新增 `Retrospective` 章节**（本轮学到 / 下轮改进）：Sprint 1 与 Sprint 2 写实际内容（含「`tools/list` 短描述不可用于对外说明」「`--profile` 不写会静默等于 core、口径须四处一致」「先想做什么再选档」「研究类条目以只读探针 + 退出码契约为起点」「R1 只能靠负向验证」），Sprint 3–6 留占位待填。
- **#11 扩展**：事项追加上述两处改造，验收条件加「档位表工具数与探针实测一致 / 无 emoji / 相对链接可解析 / 对外示例一律占位符」，状态置「进行中」。

**可复跑验证**：`make doc-links`（相对链接）· `make secret-check`（无真实地址与密钥）· `make preflight-test` · `bash memory.agent-mate.ai/scripts/profile-probe.sh`（7 档计数）。

### 模板定档落盘 + 用户版能力文档（Sprint 2 #9 收尾）

**做了什么**：把 #9 的档位决议真正写进模板；管理员入口档位由 `full`（101）**改定为 `admin`（22）**；新增面向最终用户的能力文档。

| 落点 | 改动 |
| --- | --- |
| [`deployment.md`](deployment.md) §4.3 | 主人（默认库 = 管理员入口）行 → `--profile admin`；用户行 → `--profile core`；补「不写 `--profile` **也不报错**」的静默风险注 |
| [`mcp/mcp-design.md`](mcp/mcp-design.md) §5.1 / §5.2 | 场景 A（管理员多设备）`admin`、场景 B（用户）`core`；加「改档须重连」注 |
| [`web-portal/web-design.md`](web-portal/web-design.md) §3.3 | `launch.argv` 由注释掉的待定项改为生效的 `--profile core`；§10 #1 由「未定」改为「已定」 |
| [`mcp/mcp-test.md`](mcp/mcp-test.md) §3 | 本地客户端条目显式 `--profile core`（生产条由服务端强制命令决定，不写） |

**管理员档位为何从 `full` 改成 `admin`**：`admin`（22）= Core + Lifecycle + Governance + 常驻 `memory_capabilities`，覆盖管理员真正需要的删除 / 遗忘 / 清理 / 审批与订阅；只有 `full` 才有的 Meta / Archive（`memory_stats` / `memory_agent_list` / `memory_archive_stats`）是**只读统计类**，暂不随管理员入口开放 —— 需要时另开条目评估，而不是把 101 项整体打开。

**新增文档**：[`mcp/mcp-capabilities.md`](mcp/mcp-capabilities.md) —— 面向**最终用户**（简体中文）：一句话定位 / 能做什么 / 三步接入 / 档位说明 / **全量 101 项工具逐项说明**（按档位 6 张表：每张只列本档新增、编号全档连续 1–101，每项含「做什么 + 什么时候用 + 示例」）/ 常见疑问。体例于同日收口（见「二、」），原「按 8 组」与独立例子章节均已取消。
功能说明的底稿**来自运行时实测而不是抄文档**：`tools/list` 只给 ≤50 token 的短描述（如 `memory_recall` 只有 "Recall memories relevant to a"），完整 `docs` 需通过 `memory_capabilities` 的 verbose drilldown（`family=<族>` + `include_schema=true` + `verbose=true`，逐族取回）获得 —— 101 项全部取到后再改写为用户语言。该文档登记为门户「接入指引」页的**唯一内容源**（[`web-portal/web-stories.md`](web-portal/web-stories.md) AC6.4）。

**排期影响**：Sprint 3 #2（把 `--profile` 写入门户 / SSH 模板）**已提前完成**；`product-backlog.md` #12 标 Done、#19 描述补决议 —— 生产侧的 `initialize` 回包核对留待上线后执行。

### `--profile` 定档收口（Sprint 2 #9）

**问题**：对外（SSH 与门户）暴露哪一档工具集（8 / 20 / 22 / 57 / 101）一直未定 —— SSH 模板没写 `--profile` ⇒ 实际只暴露 core 且**不报错**；门户模板里同一项是注释掉的待定行。定档缺**实测**依据（AC 要求实测 v0.10.0 各档工具数）。

**决议**：

| 通道 | 档位 | 工具数 | 理由 |
| --- | --- | --- | --- |
| 对外（SSH + 门户，**统一**） | `core` | 8 | 最小面；不引入治理 / 图谱 / 自治编排面；代价见下方「已知限制」 |
| 管理员入口（**独立**模板） | `full` | 101 | 排障需要 Meta 族（`memory_stats` / `memory_agent_list` / `memory_recall_observations`）与 Archive（`memory_archive_stats`）—— `admin`（22）档看不到这些；该通道仅管理员本人使用，提示词开销可接受 |

**实测**（可复跑探针 [`../scripts/profile-probe.sh`](../scripts/profile-probe.sh)：隔离库 `/data/users/profile-probe/`、只读、每档独立进程、退出码 0）：

| 档位 | 期望 | 实测 | 关键工具归属（实测） |
| --- | --- | --- | --- |
| 默认（不传 `--profile`） | 8 | 8 | 含 `memory_capabilities`，不含 `memory_delete` |
| `core` | 8 | 8 | 含 store / recall / search / get / list；不含 delete / forget / gc |
| `graph` | 20 | 20 | 含 `memory_kg_query` / `memory_link`；不含 delete |
| `admin` | 22 | 22 | 含 update / delete / forget / gc；不含 `memory_stats` |
| `power` | 57 | 57 | 含 `memory_consolidate` / `memory_share`；不含 delete |
| `full` | 101 | 101 | 含 stats / delete / kg_query / archive_stats |
| `core,lifecycle`（自定义） | 14 | 14 | 含 delete / forget / gc；不含 stats / pending_list |

- **生效形式**：`--profile` CLI flag 与 `--tier smart` **并存有效** —— 7 档全部以 flag 形式生效，无需回退 env `AI_MEMORY_PROFILE`。
- **默认档实证**：不传 `--profile` = 8 项 ⇒ 「模板不写 `--profile` = core」这一静默面被坐实（不报错、不告警）。

**已知限制（本轮接受）**：`core` 档**不含删除类工具** ⇒ 用户无法自行删除 / 遗忘 / 整理自己的记忆。若日后要开放删除，**最小增量档位是 `core,lifecycle`（实测 14）**，而不是 `admin`（22）或 `full`（101）—— 后两者会同时引入治理面与自治编排面。是否开放、何时开放另开条目评估。

**未做（显式移交）**：把 `--profile` 写进 SSH 模板与门户模板 = **Sprint 3 #2**（Backlog #12 AC「按 Sprint 2 的定档决议，把 `--profile` 写入门户模板与 SSH 模板」），本轮按「只完成 #9、范围最小化」口径不动模板；`product-backlog.md` #12 / #19 的描述列留待落地时一并回写（本轮未授权改 backlog）。

**回写**：[`mcp/mcp-design.md`](mcp/mcp-design.md) §8.1（实测引文）+ §8.3（由「待决策」改为决议表 #1–#4）+ 变更记录 · [`sprint-plan.md`](sprint-plan.md) #9 完成态 + 变更记录 · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)（档位实测表与教训）。

### 多语言探针结论 + 门户 key 收尾（Sprint 2 #8 / #6）

**问题**：`product-backlog.md` #10「记忆内容的多语言支持」自立项起标为「待探针确认」—— 上游在保存 / 检索 memory 时是否支持多语言、有无配置项、有无已知限制，需要可复跑的行为级结论。连带收尾 #6：门户专用 MaaS key 已由用户填入，须实测注入路径可用。

**结论（#8）= 部分支持**：

| 通路 | 简体中文 | 繁体中文 | 英文 |
| --- | --- | --- | --- |
| 存储（`memory_store`） | 支持 | 支持 | 支持 |
| 关键词·完整词元（`memory_search`） | 支持（须标点/空白界定整段） | 支持（同左） | 支持（单词） |
| 关键词·词元内子串 | 不支持 | 不支持 | 不支持 |
| 关键词·简繁交叉 | 不支持（双向） | 同左 | 不适用 |
| 语义召回（`memory_recall`） | 支持（`mode=hybrid`） | 支持 | 支持 |
| 按 id 直取（`memory_get`） | 支持 | 支持 | 支持 |

- **源码依据**：`memories_fts` 建表 `USING fts5(…)` 未指定 `tokenize=` → 默认分词器 `unicode61`（不做 CJK 分词、不做简繁归一）；`sanitize_fts_query`（`src/storage/mod.rs:7030`）剥除全部 FTS5 特殊字符（无通配）、逐词元短语化、隐式 AND；`[mcp]` 配置段仅 profile / allowlist / profile_hint_in_errors —— **无任何语言 / 分词 / 检索配置项**。
- **复现**：`bash memory.agent-mate.ai/scripts/i18n-probe.sh`（隔离库 `/data/users/i18n-probe/`，不碰主库与 iso 库；三阶段分进程；退出码 0/10/20/30/40/50；`I18N_PROBE_STRICT=1` 把语言边界当断言防上游漂移）。首跑 `1789958920-48352` / 默认复跑 `1789959024-49737` / STRICT 复跑 `1789959038-49972` 全绿（含 CONFLICT 幂等分支）。交叉验证：Cursor `ai-memory-local` 客户端直调结论一致（标记 `i18n-cross-20260921`）。
- **工程口径**：中文检索一律走 `memory_recall`；关键词通路只用于 ASCII 标记与中文整段引用。
- **#6 key 验证**：`qwen-verify.sh --key` → `embed_model=qwen3.7-text-embedding-flash`、`dim=1024`（同工作空间、同模型）；另以 `-e DASHSCOPE_API_KEY` 覆盖注入隔离会话复核 —— 写入成功 + 跨进程召回 `mode=hybrid`（embedder 未降级）、stderr 无鉴权失败。
- **回写**：[`product-backlog.md`](product-backlog.md) #10（ToDo → Done；改动授权来源 = 该行验收条件「给出明确结论并回写本行描述」）· [`sprint-plan.md`](sprint-plan.md) #6/#8 + 变更记录 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §1 L1.6 + §4-E（TC-I18N-01..06）+ §5 · [`mcp/mcp-design.md`](mcp/mcp-design.md) §2 能力边界 + §9 契约点 J4 + §10 · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 多语言专表 + 教训 #10 升级 · [`architecture.md`](architecture.md) §4.1 + §7。

### 文档风格收口：自有全仓文档去 emoji / 图标

**背景**：文档混用 ✅ ❌ ⚠️ 🟠 🔴 ☐ ⛔ 🚧 🆕 ⭐ ★ ▼ 等图标承担「状态 / 是否 / 告警 / 级别」语义 —— 渲染依赖字体、`grep` 检索不到、diff 里看不出语义变化。风格目标：**干净 · geeky · neat**，语义一律由**文字**承载。

**替换规则（后续写文档照此执行）**

| 类 | 原 | 现 |
| --- | --- | --- |
| 任务状态 | `✅已完成 / 🚧进行中 / ⏸待决策 / ⛔待提供 / ☐未开始` | `已完成 / 进行中 / 待决策 / 待提供 / 未开始` |
| 是 / 否 | `✅` `❌` | 单独成格 → `是` / `否`；后接文字已自解释（「无公网入口」「必须绕过」「不需要」）→ **直接删** |
| 告警 | `⚠️ …` | `注意：…` |
| 级别 | `🔴 阻断 / 🟠 高危 / 🟡 warn / 🔵 info` | `阻断 / 高危 / warn / info`（H / W 分组已表达层级） |
| 装饰 | `⭐ ★ 🔁 ▼` | 删；`🆕` → `新增：`；架构图流向 `▼` → `↓` |
| 决议表状态 | `🟡 **本设计定稿**` / `✅` | `已定稿（可翻转）` / `已定稿` |

**范围**：`memory.agent-mate.ai/` 自有 spec + `.codebuddy/plans/`，共 **14 个文件、180 处**。`ai-memory-mcp/`（上游 vendored、自带 `.git`）**未改**。

**例外（显式登记）**：`adr/ADR-005`「提示话术」代码块内保留 `❌ 准入判定：不通过` —— 它是 `scripts/upstream-preflight.sh` 的**输出原文**，且该话术标注「固定，禁止改写语义」；改文档必须与改脚本同批，否则文档与实际输出不符。同理**未动**脚本 / CI / 配置模板（`upstream-preflight.sh`、`.github/scripts/render-preflight.py`、`deploy/config.toml.tmpl`）—— 它们不是文档。

**验证**：`make doc-links` 26 文件 / 236 链接无悬空；全仓自有 md 复查后仅剩上述 1 处例外。

**排期**：计入 Sprint 2 —— `sprint-plan.md` 新增 #13（需求覆盖审计 + 回溯引用）与 #14（本次风格收口），均标记完成。

### 3. 回顾归档：ADR-011 与批处理操作教训（2026-09-21）

- 新增 [`adr/ADR-011-doc-style-text-over-icons.md`](adr/ADR-011-doc-style-text-over-icons.md)：风格规则固化为决议 —— 状态 / 是否 / 告警 / 级别一律由**文字**承载，含替换映射表、三个被否备选（统一图例 / 只删圆点 / Markdown 复选框）、范围边界（不动 vendored 上游）与「原文引用不可单方面改」例外。
- 更新 `knowledge/git-tooling/gotchas.md` 增第 5 条：**全仓文本类批处理的三个坑** —— ① 必须按自有资产目录划界（排除 `ai-memory-mcp/`，否则污染上游 rebase）② 文档里引用的**程序输出 / 固定话术**不能只改文档（要么同批改脚本，要么显式登记例外）③ 批量替换的次生瑕疵要复查（相邻粗体 / 双冒号 / 被删空的单元格）。
- 跳过归档：本次无新的上游事实、无环境类坑、无架构取舍变更 —— 除上述一条外无可沉淀内容。

### 门户启动机制定稿 β′（Sprint 2 #6）

**背景**：门户必须存在「启动器」——上游**没有** MCP-over-HTTP（只有 stdio），所以必须是门户按用户拼 env/argv 并把子进程接上 HTTP↔stdio 桥。备选两条：**β′**（门户镜像内带上游二进制、自己 spawn）vs **α**（门户挂 `/var/run/docker.sock`，用 `docker exec` 在既有容器里开会话）。

**决议（2026-09-21 用户确认）**：**β′**。落点：[`architecture.md`](architecture.md) §2.1 #8（定稿）+ §2.2（排除 α 与「α + 受限 socket 代理」）+ §2.3（三条落地前置）；[`adr/ADR-012`](adr/ADR-012-portal-launch-mechanism-no-docker-socket.md) 转 Accepted。

**实证（本地，证据与可复跑配方见 [`knowledge/web-portal/portal-launch-mechanism.md`](knowledge/web-portal/portal-launch-mechanism.md)）**

| # | 结论 | 关键证据 |
| --- | --- | --- |
| E1 | 镜像契约成立 | `amd64` 单平台；`USER aimem`、`uid:gid = 999:999`；二进制 `/usr/local/bin/ai-memory` 32 MB `--version` = `0.10.0`；底座 Debian 12.14（bookworm），`ldd` 在 `node:22-bookworm-slim` 内**全部解析** |
| E2 | **β′ 端到端跑通** | 4 行 Dockerfile（外来 bookworm 底座 + `COPY --from` 上游二进制）⇒ `initialize` ok / **8 工具** / 写入回显 `agent_id=human:beta-probe` / 库**自动创建**在 `/data/users/beta-probe/ai-memory.db` / 共享主库**未出现** / 新进程 `mode:hybrid` 语义召回命中 + 关键词命中 |
| E3 | 缺口 A：非 root 门户建不出用户目录 | `/data/users` = `root:root 0755` ⇒ `mkdir` **EACCES**；`install -d -m 2775 -o root -g 999` 后成功（产物 `aimem:aimem`）⇒ 一次性 setgid 引导 |
| E4 | 缺口 B：门户必须持 MaaS key | 不带 `--env-file` ⇒ `Embed failed (401): No API-key provided` + `no embeddings … linear scan`，**工具仍返回成功**（静默降级）；带则正常 |
| E5 | **α 的代理缓解不成立**（否定性结论） | 主流代理（Tecnativa/docker-socket-proxy）按「HTTP 方法 + URL 前缀」放行、**不支持**按容器/命令过滤；exec 端点是 POST ⇒ 放行 exec 必然放开写面 ⇒ α 实质 = 裸 socket |
| E6 | α 的机制本仓已在跑 | `mcp-smoke.sh` / `iso-probe.sh` 的会话即 `docker exec -i [-e …] ai-memory-mcp ai-memory mcp --tier smart`（差别只在「谁发起」） |
| E7 | β′ 的陈旧镜像风险有上游依据 | 上游**不拒绝**旧二进制操作更新的 schema（`migrations.rs:1507`，见 [ADR-005](adr/ADR-005-upgrade-admission-gate-layering.md)）⇒ 需**版本断言** |

**连带文档同步**：[`deployment.md`](deployment.md) §4.4（setgid 引导**替代** `NOPASSWD: docker exec -u 0` root 规则，净减一处 root 授权）· §4.5 · §7.2（S1 的门户侧新触发路径）· [`web-portal/web-design.md`](web-portal/web-design.md) §0/§3.2/§9 附录 · [`web-portal/web-stories.md`](web-portal/web-stories.md) AC1.1 · [`mcp/mcp-design.md`](mcp/mcp-design.md) §0.1。

**验证**：`make doc-links` 无悬空；`make secret-check` 干净；探针卷已删除（内含 `config.toml` 副本）。

**未做（明确留待）**：[`web-design.md`](web-portal/web-design.md) §10 #1（`--profile` 全档口径）与 #7（门户镜像重建自动化）仍开放；`scripts/portal-probe.sh` 待 Sprint 4 按 E2 配方落地。

**同日补记：门户专用 key 可增签 ⇒ §2.3 #2 首选生效。** 用户 2026-09-21 确认可在该私有 MaaS 工作空间（`llm-…`，`cn-beijing`）再签一把 key ⇒ 门户用**独立 key**（与主 key 同工作空间 ⇒ 模型与 1024 维天然一致），备用的「共用主 key + 残余风险」口径不启用。落地位置：服务器 `/opt/ai-memory/portal.env`（`chmod 600`）、本机开发 `memory.agent-mate.ai/deploy/portal.env`（gitignored）—— 新增模板 [`deploy/portal.env.example`](../deploy/portal.env.example)，`.gitignore` 增 `**/deploy/portal.env`，本机留档位在 `secrets.local.hk_vps_4.md` 的 `QWEN_API_KEY_PORTAL`。轮换/吊销步骤见 [`deployment.md`](deployment.md) §12.2（改 `portal.env` → 重启门户 stack → 自检通过 → 吊销旧 key；主 `.env` 不动）。

---

## 2026-09-20

本日完成一次仓库级收口：**目录改名 + specs 整合 + 链接纪律**，分三次提交（均未推送远端）。

### 1. 目录改名收口：`hk_vps_4/` → `memory.agent-mate.ai/`（提交 `0084458`）

**背景**：仓库根即产品主目录，但自有资产仍挤在 `hk_vps_4/` 子目录里，命名与产品（memory.agent-mate.ai）无关；用户已在磁盘完成 `mv`，需让仓库重新自洽。

**做了什么**

| 项 | 内容 |
| --- | --- |
| git 形态 | **41 个 rename（R100）**而非 delete+add —— 保住 `git log --follow` 的历史连续性；共 48 文件、+312/−144 |
| 路径引用同步 | 全仓 `hk_vps_4/` 引用 **227 处 → 0**：根级 `Makefile`(11)、`.gitignore`(4)、`.github/workflows/upstream-track.yml` + `render-preflight.py`(5)、`scripts/`(8)、`deploy/`(6)、`specs/` 与 `adr/` `knowledge/` 其余 |
| 密钥保护 | `.gitignore` 的含密/派生规则改为**路径无关**：`**/deploy/.env` / `**/deploy/.env.local` / `**/deploy/config.toml` / `**/deploy/config.local.toml` —— 将来再改名不会让含真实 key 与私有端点的文件失去忽略保护 |
| 钩子 | 旧 `.git/hooks/pre-commit` 仍指向 `hk_vps_4/scripts/secret-check.sh`（首次提交因此失败），用 `make hooks-install` 重装 |
| 新增护栏 | [`scripts/link-check.sh`](../scripts/link-check.sh) + `make doc-links`；允许清单 [`scripts/link-check.allow`](../scripts/link-check.allow) |
| 占位 | `memory.agent-mate.ai/backup/.gitkeep`（Sprint 5 备份脚本落点） |

**为什么**：改名是「已发生过一次」的事件。写死路径的忽略规则在下次改名时会**静默失效** —— 对公开仓而言这是密钥风险，不是整洁问题。

**验证**：`make doc-links` 27 文件 / 194 链接无悬空；`make secret-check` 干净；`make preflight-test` 5/5；`git check-ignore` 逐条断言 5 个含密文件仍被忽略。

### 2. specs 整合：16 份 → 8 份，建立唯一真源（提交 `2d21db0`）

**背景**：整合前 `specs/` 有 16 份、约 2,900 行零散文档，同一事实在多处重复叙述（改一次要同步多处），逐日流水把结论淹没。

**新增（8 份，共 1,748 行）**

| 文档 | 行数 | 定位 |
| --- | --- | --- |
| [`architecture.md`](architecture.md) | 230 | 产品级架构 + **决议单点**（§2：10 条已决 / 5 条排除）、上游契约摘要、仓库与资产边界、脱敏规则、R1–R3 索引 |
| [`deployment.md`](deployment.md) | 394 | 落地清单 / 八步 / compose 与 config 契约 / 三静默失败点 / 备份与恢复 / 升级治理 H1–H5 + W1–W6 / 回滚 / 排障 / 上线验收 |
| [`mcp/mcp-design.md`](mcp/mcp-design.md) | 400 | 传输 stdio-only、上游能力边界、四档隔离（选③）、D1–D5 + V1–V4、五个坑、档位与工具清单、上游契约面 A–K 全量 |
| [`mcp/mcp-test.md`](mcp/mcp-test.md) | 167 | 由旧 `specs/mcp-test.md` 迁入，补齐 L1.5 隔离探针层与 TC-ISO / GC / LEAK / TIER / SSH / BAK / REV / LIMIT / I18N / ATT / HTTP 用例位 |
| [`web-portal/web-stories.md`](web-portal/web-stories.md) | 123 | 门户用户故事与验收条件 |
| [`web-portal/web-design.md`](web-portal/web-design.md) | 314 | 启动机制 β′、密钥与库模型、CF Access 边界、限流、T1–T10、C1–C8 |
| [`web-portal/web-test.md`](web-portal/web-test.md) | 108 | 门户 L0–L3 测试骨架与用例位 |
| `web-portal/mockups/` | — | 空目录占位（原型图待补） |

**删除（9 份，内容已吸收）**：`admin_portal_design.md`、`deployment_strategy.md`、`dev-plan.md`、`asset_isolation_plan.md`、`multiuser_isolation.md`、`mcp_tool_inventory.md`、`upstream_coupling_surface.md`、旧 `specs/mcp-test.md`、`deploy/deployment-plan.md`。`deploy/README.md` 由长篇降为 **12 行 stub**（内容并入 `deployment.md`）。

**去重规则（后续写 spec 强制执行）**：一事实一处 · 决议单点在 `architecture.md` §2 · 验收清单归属（隔离→`mcp-design.md`，部署→`deployment.md`，门户→`web-test.md`）· 变更记录只留结论级一行 · 待移除模板不被引用（需要的运维事实**摘编**进 architecture / deployment）。

**整合时订正的历史不一致**（同一事实多处叙述留下的矛盾，借整合统一）：健康探测不用 `curl`（镜像内无 curl/wget，改判 serve 日志 + `doctor`）· 备份外迁频率统一为**每日** · 占位符统一 `<VPS4_IP>` · 档位工具数统一为**实际注册数**（core 8 / graph 20 / admin 22 / power 57 / full 101）· schema 并写 80（制品层）与 81（参考层）· 删除 `dev-plan` 中误提的 gitleaks。

**零改动文件**：`sprint-plan.md`、`product-backlog.md`（用户指定）；前者仅**追加** Sprint 2 #12 与一行变更记录（含旧→新文件名映射）。5 份 ADR（004/005/006/008/009）**仅**同步路径与指向，决议文字一字未改，文末追加一行同步说明。

**验证**：`make doc-links` 24 文件 / 201 链接无悬空（豁免 4 文件）；`make secret-check` 干净；`make preflight-test` 5/5；`iso-probe.sh` exit 0（A/B/C 三组全绿）。

### 3. 回顾归档：ADR-010 与护栏自证教训（提交 `9402636`）

- 新增 [`adr/ADR-010-specs-single-source-and-doc-structure.md`](adr/ADR-010-specs-single-source-and-doc-structure.md)：specs 唯一真源、8 份结构与四条去重规则、链接纪律、`.gitignore` 路径无关、ADR 不可变例外。
- 更新 `knowledge/git-tooling/gotchas.md` 增第 4 条：**护栏的允许清单会静默失效**。清单键按「相对产品目录」书写、脚本按「相对仓根」匹配 → 豁免从未生效却仍打印「豁免 4 个文件」，首次运行因恰好无悬空而未暴露。已改为支持两种书写（后缀匹配）。教训：任何带白名单的守卫都必须**用负向样本自证**，否则它的「通过」不能作为证据。

---

## 已知遗留（显式登记，非静默放宽）

| # | 遗留 | 处置 |
| --- | --- | --- |
| 1 | ~~`product-backlog.md` / `sprint-plan.md` 内部仍指向已合并的旧文件名~~ —— **已于 2026-09-21 清空** | 85 处引用全部改指合并后文档与对应章节（历史叙述行降级为纯文本），`link-check.allow` 两份整文件豁免同步删除（豁免 4 → 2）；此后护栏覆盖全部自有 spec，见「Sprint 2 #11 收口」小节 |
| 2 | 两份运维模板 `hk_vps_4_settings.md` / `vps4_new_deployment_instruction.md` 内部链接同样悬空 | 同上；文件待移除，关键信息已摘编进 `architecture.md` / `deployment.md` |
| 3 | `secrets.local.hk_vps_4.md` 文件名含旧目录名 | `secrets.local*` 通配仍覆盖，不影响忽略；是否改名为 `secrets.local.md` 待定 |
| 4 | 实际 1,748 行 vs 计划 1,590 行 | 因上游契约面 A–K 决定**全量保留**（升级预检的逐项判据，压缩会削弱护栏） |
| 5 | 3 次提交未推送远端 | 待用户确认后推送 |

## 回归基线（改名或增删文档后必跑）

`make doc-links` · `make secret-check` · `make preflight-test` · `bash memory.agent-mate.ai/scripts/iso-probe.sh`（exit 0 为准入）
