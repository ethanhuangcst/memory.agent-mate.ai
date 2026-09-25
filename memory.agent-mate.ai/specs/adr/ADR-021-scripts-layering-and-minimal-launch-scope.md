# ADR-021: scripts 目录分层与「最小上线」范围分级

## Status

Accepted（2026-09-24 用户定稿；2026-09-25 换号 `ADR-021` 并瘦身 —— 原稿的「执行清单」「执行回执」两段**移出**，执行与回执落在 `sprint-backlog.md` Sprint 4 `#9`。编号 `ADR-020` 留给 `web-portal/web-login-plan.md` §9.2 已预约的「登出入口与会话退出」。）

## Context

- `memory.agent-mate.ai/scripts/` 现有 **21 个** shell 脚本混放三类职责（护栏 / 探针 / 入口），日常维护主次不分 —— 用户反馈：「看到一堆 sh 脚本，看不懂现在在开发什么」。
- 探针类脚本是一次性取证工具，其**结论均已写入 specs**（隔离 `iso-probe` / 档位 `profile-probe` / 配额 `limits-probe` / 维护覆盖 `gc-probe` / 多语言 `i18n-probe` / 模型 `qwen-verify` / 桥 `portal-mcp-*-probe`），脚本存在的唯一目的是「结论可复跑」。
- 排期经 2026-09-22 / 2026-09-23 两次重排后：**Sprint 5 = 全套产品最小 MVP 上线野草云4（生产部署 · 上线验收 · 备份恢复）**，Sprint 6 = 门户运营闭环与对外口径定稿，Sprint 7 = 升级治理闭环。后两者属「上线之后」的范畴，但与上线主干排在同一份排期里，使「要做的事」在观感上比实际多。
- 用户意图：**先上线最小可用版本**（Sprint 4 产物 + Sprint 5 生产上线闭环），运营与治理类工作放上线之后。

## Decision

### D1 —— `scripts/` 分三层（探针移入子目录）

| 类 | 归属与脚本 | 判据 |
|---|---|---|
| 护栏（5） | 留 `memory.agent-mate.ai/scripts/`：`secret-check.sh` · `link-check.sh` · `attestation-paths-check.sh` · `upstream-preflight.sh` · `portal-coverage.sh` | 每次提交 / 发布必须通过，常驻 Makefile |
| 入口 + 回归（8） | 留 `scripts/`：`local-up.sh` · `portal-dev.sh` · `portal-e2e.sh` · `portal-test.sh` · `tunnel-dev.sh` · `maintain-user-dbs.sh` · `mcp-smoke.sh` · `portal-acceptance.sh` | 日常 / 上线验收**反复使用**；`mcp-smoke` 与 `portal-acceptance` 是反复跑的验收入口，非一次性取证 |
| 探针（8） | **移入 `scripts/probes/`**：`gc-probe.sh` · `i18n-probe.sh` · `iso-probe.sh` · `limits-probe.sh` · `profile-probe.sh` · `qwen-verify.sh` · `portal-mcp-probe.sh` · `portal-mcp-session-probe.sh` | 结论已落 specs 的一次性取证，只要求可复跑 |

⇒ 分层结果：**根目录 13 + `scripts/probes/` 8 = 21**。**拿不准的一律先留根目录**，并在 `sprint-backlog.md` 的对应执行行里说明。

**对 2026-09-24 原稿名单的修订 —— `portal-acceptance.sh` 留根**：它是 Sprint 4 `#8` 交付的**本地验收收口入口**、Sprint 5 上线准入的判据入口，会**反复跑**（与 `mcp-smoke.sh` 同类）；且它调用两个探针走的是 **`make` 目标**（`make -s portal-mcp-probe` / `make -s portal-mcp-session-probe`），移动探针不改变其可用性 ⇒ 按上面的判据它属「入口 + 回归」。

**与既有 `memory.agent-mate.ai/probes/` 的区别**：那是**研究探针工作区**（`local-acceptance-probe` / `response-size-probe` 等一次性研究资产，不入制品）；本 ADR 的 `scripts/probes/` 是**从 `scripts/` 移入的可复跑取证脚本**。两者同名不同物，引用时一律带全路径。

### D2 —— 上线范围分级：「最小上线」= Sprint 4 主干 + Sprint 5 全部

**上线判据**：Sprint 4 主干（会话桥 / 身份 / 隔离取证 / 上线配置指南）全部 `Done` ＋ **Sprint 5 全部 16 行** `Done`。**Sprint 6 与 7 不阻塞上线。**

**Sprint 6（15 行）整批延后，按四类分级**（下列为**判据**；逐条归属见 `sprint-backlog.md` Sprint 6 各行「说明」列标注，本 ADR 不复制条目清单）：

- **上线后一周内补齐**：文档类、廉价且防漂移，且与**已实现**的代码对齐。
- **上线后第一批**：按上线后的真实使用决定优先级的功能与研究类。
- **有真实规模需求再启动**：研究类；邀请制 1–5 人本身是软上限。
- **随重排即时执行（不延后）**：「排期投影一致」是每次重排的义务，不是可推迟项。

**Sprint 7 压缩**：升级治理从整批 6 行压缩为上线后实际需要的最小集 —— **升级前跑探针（`upstream-preflight` + `mcp-smoke`）+ 打快照** 两步；其余等出现第 2 次升级且改动面大时再启动（届时另立 ADR）。

**明确不裁**：备份外迁（Sprint 5 `#15` / `#16`）—— 多用户数据的 RPO 承诺，必须有；隔离负向探针与 `--db` 两条硬约束 —— 最便宜的保险，砍了以后利息最高。

**落盘方式**：Sprint 6 各行的「说明」列标注分级；`product-backlog.md` 投影同步；Sprint 7 表头加「压缩说明」。

### D3 —— 前置条件（非本轮决策）：OSS region 待核查

用户完成 region 核查后回填 4 处权威表述：`deployment.md` §1.1 / §8 · `product-backlog.md` #9 · `sprint-backlog.md` Sprint 5 `#8`，并同步 `adr/ADR-005`；核查命令已登记在 `deployment.md` §1.1（`ossutil ls` / `ossutil stat` / `ossutil config`，或控制台「地域」）。**执行 agent 不得代替用户虚构 region**；用户未提供前保持「待核查」。

## Rationale

- **上线判据聚焦**：运营与治理类工作（Sprint 6/7）不阻塞「能不能用」；「要做的事」在观感上回到真实规模。
- **目录分层**直接回应「看不懂」：日常要看的（护栏 + 入口 + 回归）与考古要用的（探针）物理分离。
- **引用同步有先例可循**：按仓内既有「改名口径」执行 —— 全量同步 + 旧路径零残留 + 只在变更记录保留旧→新映射（先例：`sprint_plan.md` → `sprint-plan.md` → `sprint-backlog.md` 两次改名，均 17 个文件级同步）。
- **分级而非删除**：Sprint 6/7 的条目全部保留、只改优先级，不产生信息损失，也随时可以按真实需求提前拉回。
- **决策与执行分家**：ADR 只记决策（本仓体例：ADR 按新增决议 supersede，**不回写正文**）；执行清单与回执登记在排期行，执行过程不再改动决策文档。

## Consequences

- 一次性成本：约 50+ 处引用改指（以现场 grep 为准）+ `Makefile` **两个**变量值改指（`PORTAL_MCP_PROBE` / `PORTAL_MCP_SESSION_PROBE`；`PORTAL_ACCEPTANCE` 不变）+ Sprint 6 各行分级标注。
- 上线判据缩窄为 Sprint 4 + 5；Sprint 6/7 变为 backlog，不再对上线形成观感压力。
- 探针移入子目录后，外部若有旧路径链接将 404（本仓无外部消费者，`make doc-links` 会拦截）。
- 升级治理压缩后，若出现连续大改的升级，需恢复完整流程并另立 ADR。
- 审计功能延后 ⇒ 上线初期多用户操作的追责依赖 SQLite 审计表查询（`audit` 表已随会话写入），可接受。

## Date

决策 2026-09-24（用户定稿）· 本文 2026-09-25 换号 `ADR-021` 并瘦身（执行清单与执行回执移出至 `sprint-backlog.md` Sprint 4 `#9`）
