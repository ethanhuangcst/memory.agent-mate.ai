# 变更日志（memory.agent-mate.ai）

> 本文件记录**结论级**变更：一次改动「做了什么、为什么、怎么验证的」。
> 过程细节与逐日流水不在此堆叠 —— 它们在 `git log` 与各 spec 文末的变更记录里。
> 本文件本身不替代任何 spec：`specs/` 是唯一真源，决议在 [`architecture.md`](architecture.md) §2，ADR 在 [`adr/`](adr/)。

---

## 2026-09-21

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

**回写**：[`mcp/mcp-design.md`](mcp/mcp-design.md) §8.1（实测引文）+ §8.3（由「待决策」改为决议表 #1–#4）+ 变更记录 · [`sprint_plan.md`](sprint_plan.md) #9 完成态 + 变更记录 · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)（档位实测表与教训）。

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
- **回写**：[`product-backlog.md`](product-backlog.md) #10（ToDo → Done；改动授权来源 = 该行验收条件「给出明确结论并回写本行描述」）· [`sprint_plan.md`](sprint_plan.md) #6/#8 + 变更记录 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §1 L1.6 + §4-E（TC-I18N-01..06）+ §5 · [`mcp/mcp-design.md`](mcp/mcp-design.md) §2 能力边界 + §9 契约点 J4 + §10 · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 多语言专表 + 教训 #10 升级 · [`architecture.md`](architecture.md) §4.1 + §7。

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
