# 变更日志（memory.agent-mate.ai）

> 本文件记录**结论级**变更：一次改动「做了什么、为什么、怎么验证的」。
> 过程细节与逐日流水不在此堆叠 —— 它们在 `git log` 与各 spec 文末的变更记录里。
> 本文件本身不替代任何 spec：`specs/` 是唯一真源，决议在 [`architecture.md`](architecture.md) §2，ADR 在 [`adr/`](adr/)。

---

## 2026-09-21

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

**排期**：计入 Sprint 2 —— `sprint_plan.md` 新增 #13（需求覆盖审计 + 回溯引用）与 #14（本次风格收口），均标记完成。

### 3. 回顾归档：ADR-011 与批处理操作教训（2026-09-21）

- 新增 [`adr/ADR-011-doc-style-text-over-icons.md`](adr/ADR-011-doc-style-text-over-icons.md)：风格规则固化为决议 —— 状态 / 是否 / 告警 / 级别一律由**文字**承载，含替换映射表、三个被否备选（统一图例 / 只删圆点 / Markdown 复选框）、范围边界（不动 vendored 上游）与「原文引用不可单方面改」例外。
- 更新 `knowledge/git-tooling/gotchas.md` 增第 5 条：**全仓文本类批处理的三个坑** —— ① 必须按自有资产目录划界（排除 `ai-memory-mcp/`，否则污染上游 rebase）② 文档里引用的**程序输出 / 固定话术**不能只改文档（要么同批改脚本，要么显式登记例外）③ 批量替换的次生瑕疵要复查（相邻粗体 / 双冒号 / 被删空的单元格）。
- 跳过归档：本次无新的上游事实、无环境类坑、无架构取舍变更 —— 除上述一条外无可沉淀内容。

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

**零改动文件**：`sprint_plan.md`、`product-backlog.md`（用户指定）；前者仅**追加** Sprint 2 #12 与一行变更记录（含旧→新文件名映射）。5 份 ADR（004/005/006/008/009）**仅**同步路径与指向，决议文字一字未改，文末追加一行同步说明。

**验证**：`make doc-links` 24 文件 / 201 链接无悬空（豁免 4 文件）；`make secret-check` 干净；`make preflight-test` 5/5；`iso-probe.sh` exit 0（A/B/C 三组全绿）。

### 3. 回顾归档：ADR-010 与护栏自证教训（提交 `9402636`）

- 新增 [`adr/ADR-010-specs-single-source-and-doc-structure.md`](adr/ADR-010-specs-single-source-and-doc-structure.md)：specs 唯一真源、8 份结构与四条去重规则、链接纪律、`.gitignore` 路径无关、ADR 不可变例外。
- 更新 `knowledge/git-tooling/gotchas.md` 增第 4 条：**护栏的允许清单会静默失效**。清单键按「相对产品目录」书写、脚本按「相对仓根」匹配 → 豁免从未生效却仍打印「豁免 4 个文件」，首次运行因恰好无悬空而未暴露。已改为支持两种书写（后缀匹配）。教训：任何带白名单的守卫都必须**用负向样本自证**，否则它的「通过」不能作为证据。

---

## 已知遗留（显式登记，非静默放宽）

| # | 遗留 | 处置 |
| --- | --- | --- |
| 1 | `product-backlog.md` / `sprint_plan.md` 内部仍指向已合并的旧文件名（悬空链接 **73** 处 = 前者 32 / 后者 41） | 用户指定零改动；已在 `link-check.allow` 登记为债务，清理时机 = 重写这两份文件时 |
| 2 | 两份运维模板 `hk_vps_4_settings.md` / `vps4_new_deployment_instruction.md` 内部链接同样悬空 | 同上；文件待移除，关键信息已摘编进 `architecture.md` / `deployment.md` |
| 3 | `secrets.local.hk_vps_4.md` 文件名含旧目录名 | `secrets.local*` 通配仍覆盖，不影响忽略；是否改名为 `secrets.local.md` 待定 |
| 4 | 实际 1,748 行 vs 计划 1,590 行 | 因上游契约面 A–K 决定**全量保留**（升级预检的逐项判据，压缩会削弱护栏） |
| 5 | 3 次提交未推送远端 | 待用户确认后推送 |

## 回归基线（改名或增删文档后必跑）

`make doc-links` · `make secret-check` · `make preflight-test` · `bash memory.agent-mate.ai/scripts/iso-probe.sh`（exit 0 为准入）
