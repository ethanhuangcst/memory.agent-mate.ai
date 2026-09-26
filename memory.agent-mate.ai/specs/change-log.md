# 变更日志（memory.agent-mate.ai）

> 本文件记录**结论级**变更：一次改动「做了什么、为什么、怎么验证的」。
> 过程细节与逐日流水不在此堆叠 —— 它们在 `git log` 与各 spec 文末的变更记录里。
> 本文件本身不替代任何 spec：`specs/` 是唯一真源，决议在 [`architecture.md`](architecture.md) §2，ADR 在 [`adr/`](adr/)。

---

## 2026-09-26

### Sprint 5 开工：RID 落点收口 · SSOT 悬空引用订正 · 三项拍板落盘（**产品代码与 `scripts/` 一行未动**）

**为什么**：Sprint 5 开工前的 review 发现四类**可机械判定**的问题 —— RID 的执行行与 RID 表**单边指向** · `upstream.lock`（SSOT）里三处引用**指向已不存在的文档**且护栏扫不到 · `#1` 的说明与实际制品状态**过时一半** · `#15` 的入口**先红**；同时把上一轮遗留的三项拍板（自检维度断言通路 / OSS region / 复现矩阵归属）落进真源。

**改了什么**：

- **RID 落点收口（2 处）**：① `D6`（公网真身份链路验收）的 Sprint 落点**补 `#13`（在线链路验收）** —— `#13` 行明写「与 RID `D6` 同一落点」，此前 RID 侧只指 `#14`；② `R1`（多用户隔离静默失效）的落点**补 `#11`（admin portal 部署 + 多用户隔离落地）** —— 该行明写「隔离的本地负向回归（V1）已在 Sprint 3 定型，**本行在生产卷上复验**」。两处均**同批**改「RID Registry」与「RID 覆盖对照」两张表，并为 `#11` / `#13` 补行锚点（`s5-user-isolation` / `s5-online-acceptance`），与 `s5-access-surfaces` / `s5-production-acceptance` 同体例。
- **`upstream.lock` 悬空引用订正（SSOT 文件）**：第 15 行的「读取方 · 文档」点名 `specs/deployment_strategy.md`、`specs/dev-plan.md`、`deploy/deployment-plan.md` —— **三份均不存在**（2026-09-20 specs 整合时分别并入 `architecture.md` / `deployment.md`）。改为指向**实测引用它的**三份真源（`architecture.md` §2 · `deployment.md` §3/§8/§9 · `web-portal/web-design.md` §3.2，`grep -c upstream.lock` 分别 5 / 7 / 9 次）。**漏网原因（引用治理的扫描面缺口）**：`scripts/link-check.sh:96` 只处理 `fn.endswith(".md")` ⇒ **非 `.md` 的真源文件不在 `make doc-links` 扫描面**，故该门禁对此恒绿 —— 与纪律「数量 / 路径类声明必须机械取证」同族，登记待扩面。
- **`#1` 说明订正**：原写「全仓此前不存在门户镜像**与**门户编排制品」已过时 —— `deploy/portal.compose.yml` 已由 Sprint 4 `4.4` 入仓（`PORTAL_*` 键真源），缺的只剩 `healthcheck`（已归 `#2`）⇒ **本行当前剩余范围 = 门户镜像构建链路**。机械核实：`admin_portal/` 与 `deploy/` 下**无任何门户 `Dockerfile`**。
- **`#15` 先红登记**：`memory.agent-mate.ai/backup/` **当前为空**，而 `Makefile` 第 46–50 行已声明 `backup:` / `restore-drill:` 目标指向不存在的 `backup/backup-and-push.sh` / `backup/restore-drill.sh` ⇒ **今天 `make backup` 必失败**，而 `make help` 把它列为可用入口（同 `3.16`「先红后绿」体例）。开工本行时先补脚本。
- **三项拍板落盘**：① **`#17` 自检维度断言通路 = 直连 MaaS**（用户 2026-09-26 定）：自检直接调私有 MaaS 的 embeddings 并断言**向量长度 == 1024**，不经上游 —— 依据 `3.21`「坏 key 下上游只出线性扫描告警而 `tools/call` 仍返回」⇒ 经上游判会**假绿**。**成本已登记**：门户侧无 embeddings 客户端 ⇒ 必须**新增配置键**（MaaS `base_url` + 模型名；key 复用 `portal.env` 的 `DASHSCOPE_API_KEY`），须同批同步 `deployment.md` §12.5.4 与 `deploy/portal.compose.yml`，否则 `A2` 转红。真源改 `web-portal/web-design.md` §3.4 ④（「实现前须拍板」→「已定档 2026-09-26」）。② **OSS region = 香港**（用户 2026-09-26 确认**按现登记值**回填；`ossutil` 机器核查**未执行**，如实登记）：回填 `deployment.md` §1.1 / §8 · `product-backlog.md` #9 · Sprint 5 `#8`（标题与说明）；`ADR-021` D3 点名的 `adr/ADR-005` **实测无 region 表述**（仅含「阿里云 OSS」与 `ossutil ls`）⇒ 无回填项。③ **复现矩阵留在 Sprint 6 `#11`**（不提前到 Sprint 5），Sprint 5 头部「移入登记」末行的「由用户定」改为已定。
- **`#8` 配置信息说明（用户要求）**：`deployment.md` §1.1 补「OSS 就绪需提供的信息」7 项清单（桶名 / region / endpoint / AK / 最小权限范围 / 私有 + SSE 确认 / 保留策略），使「需要提供什么」有真源而非只在对话里。
- **`as_of` 同步**：`sprint-backlog.md` 的 `as_of` 由 `2026-09-24` → **`2026-09-26`** —— 它在上一轮（09-25）改过本文件时**未同步**（仓内既有先例明确：改过本文件即同步 `as_of`，见 2026-09-24 的「一致性收口」行），本轮一并补上。**未同步**：`deployment.md` / `product-backlog.md` / `web-portal/web-design.md` 用的是 `**状态**：vX · as_of <date>` 的版本日期口径（长期停在上次定版日），不在本批范围内。

**验证**：`make doc-links` · `make attestation-paths` · `make preflight-test` 5/0 · `make deploy-doc-audit` 9/0 退 0 · `make secret-check` · `git diff --check` 干净。

**边界**：产品代码与 `scripts/` **一行未动** · 未改任何 Sprint 的行数与编号（`ADR-021` D2） · 未改 RID 的状态枚举（R1/R2/R3 仍 `Open`、D6 仍 `Pending`） · **未处理** review 的第三项 —— `D5` 的「`Implemented` vs 上线前必须关闭」语义歧义**留待用户定夺** · `.lock` 的引用治理扩面只**登记**、未改 `link-check.sh`。

### Sprint 5 开工前准备（只做计划）：执行顺序重排 · 依赖项移入登记 · 技术难点识别

**为什么**：用户指示「准备下一个 Sprint，**只做计划不施工**」—— 三件事：① review 准备阶段登记的**依赖问题**，把该移入的工作放进 Sprint 5；② 按合理**执行顺序**排行序；③ 列出**技术难点**。

**改了什么（全部落在 [`sprint-backlog.md`](./sprint-backlog.md) 的 Sprint 5；产品代码一行未动）**：

- **执行顺序重排（行序 = 执行顺序，`#N` 编号稳定不动）**：由 `1,2,3,4,5,7,8,6,9…` 改为 **`7,8`（外部凭据，阻塞类先启动）→ `1,2,4,3,5,17`（制品链连成一段）→ `18,6`（探针）→ `9`（上线准备包）→ `10,11,12`（部署执行链）→ `13,14`（验收链，`#13` 依赖 `#6`）→ `15,16`（备份链）**。判据不变：`#14` 仍是 RID `D5` / `V1` 的执行点。
- **移入登记（16 → 18 行）**：新增 **`#17`**（门户**启动自检实现轮**，承接 Sprint 4 `4.3`；判据已由 `3.21` 探针定档 **8/8**）与 **`#18`**（「多条 × 正文」**批量体量补测**，补足生产背压 **4 MiB** 的**取值依据**）；`deploy/portal.compose.yml` 缺 `healthcheck` 的契约缺口**补进 `#2`** 验收条件；**真实域名下的面隔离**已由 `#6` / `#13` / `#14` 承接（行内点明来源，不新增行）。
- **stale 引用修正（只改活跃引用，历史叙述不动）**：「经门户的配额透传 → **Sprint 5 `#2`**」**3 处**改为 **Sprint 6 `#2`**（[`sprint-backlog.md`](./sprint-backlog.md) 的 Sprint 4 `#8` 行与 `3.19` 行；`change-log` 的历史小节按「历史叙述不改」口径保留）；「复现矩阵 → **Sprint 5 `#4 PSP-M3`**」**1 处**改为 **Sprint 6 `#11`**（`mcp:工具可达性矩阵`，即重排后 `PSP-M3` 的承接行）。
- **新增 `### 技术难点（开工前识别）`（11 条）**：镜像与上游双向对齐 · β′ 在生产卷上落地 · Access **凭据分置两侧**的二分判定 · MCP Bypass 与管理面 Access 互斥 · 生产卷隔离复验与负向门禁 · SSH forced command 每用户易失准 · 备份外迁闭环 · 上游 9077 封闭 · ⚠️ **自检维度断言通路未拍板** · ⚠️ **背压取值依据 + 入出站对偶** · ⚠️ **口径变更本身**。
- **口径变更登记**：`ADR-021` D2 原写「Sprint 5 全部 16 行**不裁**」⇒ 本次是**扩展**（不裁 = 不得删减上线所需行）；ADR 按新增决议 supersede、**不回写正文**，故变更记在本小节与 Sprint 5 头部「移入登记」——**开工时勿按旧的「16 行」口径自查**。

**验证**：`make doc-links` 零悬空 · `make attestation-paths` ✓ · `make preflight-test` 5/0 · `make deploy-doc-audit` **9/0 · 退出码 0** · `make secret-check` ✓ · `git diff --check` 干净。

**边界**：本轮**未开始任何 Sprint 5 实现工作**（只落计划）· 不改产品代码与 `scripts/` · **不新增/不改**其它 Sprint 的行（只修 4 处 stale 引用）· `OSS region` 仍待用户提供（`ADR-021` D3，不得虚构）· 「**复现矩阵**是否提前到本 Sprint」待用户定夺（本 Sprint 未收）。

### Sprint 4 收口：结束标记 + 回顾重构（长文总结入 `knowledge/`，排期只留三部分）+ `4.3` 转 Sprint 5

**为什么**：Sprint 4 除 `4.3`（启动自检**实现轮**）外全部 `Done` ⇒ 按 Sprint 1 / 2 / 3 的同体例收口（结束标记 + 回顾定稿）；同时用户指出**回顾太长**（原约 **340 行 / 20 个轮次块**）⇒ 按新体例重构：**细节总结入 `knowledge/`**，排期只保留**三部分的一行式索引**。

**改了什么**：

- **新增 knowledge** [`knowledge/retrospective/sprint-4.md`](./knowledge/retrospective/sprint-4.md)（`type: ops-lesson`，`as_of 2026-09-25`）：原 20 个轮次块的**去重总结** —— **Learnings 71 条**（含跨轮「复现于」标注）· **Opportunities 15 条** · **Future actions 31 条**，每条带**稳定锚点**（`#lN` / `#oN` / `#fN`）与来源块；并在 [`knowledge/README.md`](./knowledge/README.md) 索引登记。
- **排期重构**：`### Retrospective` 只留**三部分**（`Learnings` / `Opportunities` / `Future actions`），按 `**[时间戳]，创建者，创建原因**` 分块（**16 块**），每条一行 + knowledge 深链接；开头写明**结构变更、体例对照（做得好→Opportunities · 学到→Learnings · 下轮改进→Future actions）与去重口径**。
- **结束标记**：`## Sprint 4` 标题区加 `**状态：已结束**（`4.3` 实现轮按计划转 Sprint 5 `#1`，2026-09-25）`（与 Sprint 1 / 2 / 3 同体例）。
- **`4.3` 延期登记**：本 Sprint「移出登记」表加一行（`4.3` 实现轮 → **Sprint 5**，理由 = 依赖镜像与编排制品），并在 Sprint 5 `#1` 行追加**承接说明**（**不新增行**，`ADR-021` D2：十六行不裁）。

**验证**：`make doc-links` **60 文件 / 1625 链接零悬空**（新增 118 条 knowledge 深链接全部可达）· `make attestation-paths` ✓ · `make preflight-test` 5/0 · `make deploy-doc-audit` **9/0 · 退出码 0** · `make secret-check` ✓ · `git diff --check` 干净。

**边界**：本轮**不动** `4.3` 的实现（转 Sprint 5 `#1` 承接）· 不改 Sprint 5 的行数（`ADR-021` D2）· 原回顾**原文**不再在正文保留副本（可沿 git 历史追溯）· 三部分是**索引**，条目细节与证据一律以 knowledge 文档为准。

### `3.16` 判据修正：`deploy-doc-audit` 的「真正会读」收窄为三种真读取形态（`A2` 假红转绿）

**为什么**：`make deploy-doc-audit` 在 HEAD 上红 —— `A2`（「门户真正会读的每个 `PORTAL_*` 键，都至少在一处被登记」）报「遗漏 `PORTAL_CONTACT_EMAIL`」。归因（机械取证）：该令牌**只出现在一条注释**里 —— `admin_portal/src/web/routes/index.ts`「如需按部署改地址，再加 `PORTAL_CONTACT_EMAIL`」，由 Sprint 4 `#4.2` 交付（`55a4fa0`）引入，代码从未读取；而 `A2` 的实现是**扫源码全文抽键**（注释与字符串都算），与它自己的标题「门户**真正会读的**每个键」不一致 ⇒ 这是**判据假红**，不是文档缺登记。证据：审计规则自基线 `95cc82b` 以来未变（`git diff --stat` 空），该令牌在 `95cc82b` 源码 **0 命中**、在 `55a4fa0` **1 命中**。

**改了什么**（只动探针**代码侧**抽键；deploy 侧与 doc 侧维持原样 —— `docKeys` 的宽度正是 `A2`「被登记即可」与 `Q4`（纯发现）赖以成立的基础）：

- **抽键收窄为三种真读取形态**：① zod schema 键 `PORTAL_X:` ② `raw.PORTAL_X` ③ `process.env.PORTAL_X`（当前 0 处，留作防回归）；**逐行**匹配（不跨行、不吞字符串）。实测本仓唯一入口：`config.ts:168 RawEnvSchema.safeParse(env)` → `:172 const raw = parsed.data`（全文 `process.env.*` 0 处、`raw.*` 43 处）。
- **新增 `A2a`**：`raw.X` 引用集合 ⊆ `RawEnvSchema` 声明集合（抓「读了却没声明」；反向只作 `info`，因为可选键有默认值分支）。
- **新增 `A2b`**：源码里出现过的**每个** `PORTAL_*` 令牌**要么是真读取、要么在 `UNEXPLAINED_OK` 白名单里带理由**；且白名单条目必须**仍被引用**（否则报**陈旧白名单**）⇒ 把「只收窄会留下的『靠改注释消红』口子」变成**显式登记**。
- **新增两条判据自检**：`S1` 正对照（注入 `process.env.` / `raw.` / schema 三种形态 ⇒ **必须**被抽到，防假红）· `S2` 反对照（注入**纯注释**里的键名 ⇒ **必须**抽不到、且必须被 `A2b` 拦下，防假绿）。

**结果**：`make deploy-doc-audit` 由 **4 PASS / 1 FAIL（退 `30`）** 转为 **9 PASS / 0 FAIL（退 `0`）**；`A1` 代码侧 **25 → 24**（差额即那个注释令牌）；`A3` **54/54 可达**、`A4`、`A5` 与 `Q4` 纯发现项（13 个上游 `config.toml` 键）**不回归**。

**验证**：`make deploy-doc-audit` **9/0 · 退 0** · **敏感性证明两个方向**（① 临时清空白名单 ⇒ `A2b` 转红 `8/1`（未解释）· ② 注入一条陈旧白名单 ⇒ `A2b` 转红 `8/1`（陈旧）；两次还原后**文件哈希与基准一致**、复跑 9/0）· 常驻自检 `S1`/`S2` 全过 · `doc-links` **59 文件 / 1498 链接零悬空** · `attestation-paths` ✓ · `preflight-test` 5/0 · `secret-check` ✓ · `git diff --check` 干净 · `tsc --noEmit` 0 错。

**边界**：不改 `admin_portal/`（含那条注释）· 不做方案 B（未实装的键不写进配置契约表 —— 它只在白名单里被解释，读者不会被误导去填一个不存在的键）· **动态拼接读取**（`process.env[var]` 形态）不在判据内（已登记 README）· 不加 Sprint 5 行 · 不碰并行在制品。

### Sprint 4 `#7`「deploy:真身份口径核对」交付：8 项断言逐项结论 + DNS 承接归属

**为什么**：`#7` 的验收形态是**文档核对**（`SBI-D5`：「受影响则更新；未受影响则显式登记『已核对、无需改』」）—— 这一行的交付物**就是逐项结论本身**，不是功能改动。

**三项「受影响 ⇒ 已更新」**：

- `deploy/portal.compose.yml` 注释 `PORTAL_ENV=dev` → `development`：这是全仓唯一异形值，代码侧 `z.enum(['development','production'])` 只认后两者 ⇒ 照注释填报会踩启动期校验（**只改注释措辞，不动任何键值**）。
- `deployment.md` §12.5.4 补**开发登录入口** `/admin/dev-login` 的生产禁用登记：实测 `server.ts` 为 `if (cfg.testJwt.enabled) registerDevLoginRoutes(app, deps);`，而 `cfg.testJwt.enabled` 由 `PORTAL_TEST_JWT_ENABLED` 驱动 ⇒ 该入口与已登记的 `PORTAL_TEST_JWT_*` **同源开关**；**修法是补点明入口**（禁用那套键即彻底关闭它），**不新增键、不改行为**；入口边界口径指向 `web-design.md` D15 / `ADR-015`。
- 本机**未入仓**派生文件（`deploy/config.toml` / `config.local.toml` 注释）里的旧部署目录 → `/opt/ai-memory/`：入仓模板 `config.toml.tmpl` 本就干净（旧路径来自更早版本的模板），残留只在这一对本机副本上；改它们**不进提交**（`.gitignore` 第 12/15 条）。

**五项「未受影响 ⇒ 已核对、无需改」**：生产禁用键三处同集（6 键）· 面隔离两 Host 键齐备且「必须不相交」在代码与设计两侧都写了 · 「MCP 面必须绕过 Access」四处一致 · `mcp-design.md` §5.6.2 回链有效（目标节含 Host/Bypass 表）· 旧口径规则的灵敏度对照（注入即命中）。

**DNS 承接归属落定**：`deployment.md` §1.1 的「DNS（两个域名）· **暂无承接条目**（归属待定）」⇒ 承接列改为 **Sprint 5 `#9`（上线准备包）**，视为上线前准备项；**只改承接列、不加行**（`ADR-021` D2 已定 Sprint 5 的 16 行不裁）。

**探针两条规则的修正（同一行 `#7` 的判据质量，两条都是本轮实测教训）**：

1. **M2b 从「字样存在」升级为「开关同源 + 指南有落点」**：原规则只查 `deployment.md` 里有没有 `dev-login` 字样 —— 任意一句提及即可蒙过；改为要求「代码侧注册确受 `cfg.testJwt.enabled` 支配」**且**「指南里提到该入口的那一行**同时**点明它由哪套键开关」。
   **修正过程中自身踩到一次假红（值得记）**：先写成 `l.includes('registerDevLoginRoutes')`，`findIndex` 命中的是文件顶部的 `import { registerDevLoginRoutes } ...`（第 33 行）而非调用行（第 133 行）⇒ 判据**恒假**；改为匹配**调用**（`registerDevLoginRoutes\s*\(`）后转 PASS。**教训：判据的取行方式本身就是判据的一部分。**
2. **M6 的扫描面与「制品」定义对齐**：旧路径只出现在**未入仓**的本机派生文件里 ⇒ 把未跟踪文件当制品判据，结论会随开发机状态漂移；扫描面改由 `git ls-files` 判定，未跟踪文件**显式排除并把排除项打印在结论里**（本轮排除 2 个）。

**验证**：`3.22` 复跑 **8/8 PASS · rc=0** · **敏感性证明两项**（`M1` 临时反向 ⇒ **7/1**；`M2b` 临时反向 ⇒ **7/1**；两次还原后文件哈希与基准一致、复跑 8/8）· `doc-links` 59 文件 / 1498 链接零悬空 · `attestation-paths` ✓ · `preflight-test` 5/0 · `secret-check` ✓ · `git diff --check` 干净 · `tsc --noEmit` 0 错。

**先在红项（如实登记，非本轮回归）**：`make deploy-doc-audit` 在 **HEAD 上已红** —— `A2`（「门户真正会读的每个 `PORTAL_*` 键都至少在一处登记」）遗漏 `PORTAL_CONTACT_EMAIL`。归因链：`#4.2` 交付（`55a4fa0`）在 `admin_portal/src/web/routes/index.ts` 的注释里写了「如需按部署改地址，再加 `PORTAL_CONTACT_EMAIL`」—— 审计的**正则抽键**（扫 `admin_portal/src` 全文本，注释也算）把**将来键名**当成了「代码会读的键」。机械证据：审计规则自基线提交 `95cc82b` 以来未变（`git diff --stat` 空），而该键在 `95cc82b` 源码 **0 命中**、在 `55a4fa0` **1 命中**。本轮**未修改审计规则**（属 `4.4`/`3.16` 交付物，越界）；建议二选一：① 抽键面收窄为**真读取**（如 `process.env.PORTAL_*` 形态）；② 或按 `#4.2` change-log 已登记的「待配置化」把该键写进配置契约表（但会与「目前无配置键承载它」的事实并列，需读者自行判断）。

**边界**：未动 `admin_portal/`（含该审计探针）· 未动 MCP 桥 / 上游 / 会话层 · 未涉 `4.3`（启动自检）· 未新增 Sprint 5 行 · OSS region 仍待用户提供（`ADR-021` D3，本轮不臆造）。

### `ADR-021` 落定并当轮执行：scripts 目录分层（8 个探针 → `scripts/probes/`）+ 「最小上线」范围分级

**为什么**：用户反馈「看到一堆 sh 脚本，看不懂现在在开发什么」⇒ 决策把 `scripts/` 按职责分层（护栏 / 入口+回归 / 探针），并给「最小上线」定出判据。该决策原由 Ken 起草为 `ADR-020`；本轮按用户指示**换号 `ADR-021` 并瘦身**后**当轮执行**（决策与执行分开记账）。

**决策侧**：

- **换号**：`ADR-020` 已被 `web-portal/web-login-plan.md` §9.2 预约给「登出入口与会话退出」（`SBI-L1`）⇒ 本决策改用 `ADR-021`，原稿（未跟踪）删除。
- **瘦身**（96 → 69 行）：只留 `Status / Context / Decision / Rationale / Consequences / Date`；**执行清单与执行回执移出**到 `sprint-backlog.md` Sprint 4 `#9`（仓内体例：ADR 按新增决议 supersede、**不回写正文**）；**D3（OSS region 待核查）降为前置条件**（它不是决策，是待用户提供的数据）；**D2 只留「判据 + 代价 + 反转条件」**，不复制 Sprint 6 的 15 行清单。
- **D1 名单按判据复查**：`portal-acceptance.sh` **留根**（Sprint 5 上线准入、会反复跑、调用走 `make` 目标 ⇒ 按原稿自己的判据属「入口 + 回归」，不是探针）⇒ 移入 `scripts/probes/` 的是 **8 个**，分层结果 **根目录 13 + `probes/` 8 = 21**。

**执行侧（D1）**：

- `git mv` 8 个探针入 `scripts/probes/`；`Makefile` 第 19–20 行变量值改指（`PORTAL_ACCEPTANCE` 不变）。
- **路径改指 180 处 / 37 文件**（`change-log` 33 · `sprint-backlog` 33 · `mcp-test` 27 · `mcp-design` 15 · `knowledge/upstream-ai-memory` 13 · `product-backlog` 12 · `deployment` 7 · `web-design` 4 · 研究探针 / 测试 / 配置注释等）—— 按仓内改名口径执行：**旧路径零残留**，旧路径只在本节映射表里保留；**裸名（如 `iso-probe` / `make portal-mcp-probe`）不改**（名字与目标名未变）。
- **修掉 5 处「按自身位置推导仓根」**（移动后会被打断）：`gc-probe.sh`（兄弟脚本 `maintain-user-dbs.sh`）· `limits-probe.sh`（`deploy/`）· `portal-mcp-probe.sh` 与 `portal-mcp-session-probe.sh`（`ROOT`）· `qwen-verify.sh`（`REPO_ROOT`）—— 各**多一级上溯**并加注。

**旧 → 新路径映射（8 个脚本）**：

| 旧路径 | 新路径 |
|---|---|
| `memory.agent-mate.ai/scripts/gc-probe.sh` | `memory.agent-mate.ai/scripts/probes/gc-probe.sh` |
| `memory.agent-mate.ai/scripts/i18n-probe.sh` | `memory.agent-mate.ai/scripts/probes/i18n-probe.sh` |
| `memory.agent-mate.ai/scripts/iso-probe.sh` | `memory.agent-mate.ai/scripts/probes/iso-probe.sh` |
| `memory.agent-mate.ai/scripts/limits-probe.sh` | `memory.agent-mate.ai/scripts/probes/limits-probe.sh` |
| `memory.agent-mate.ai/scripts/profile-probe.sh` | `memory.agent-mate.ai/scripts/probes/profile-probe.sh` |
| `memory.agent-mate.ai/scripts/qwen-verify.sh` | `memory.agent-mate.ai/scripts/probes/qwen-verify.sh` |
| `memory.agent-mate.ai/scripts/portal-mcp-probe.sh` | `memory.agent-mate.ai/scripts/probes/portal-mcp-probe.sh` |
| `memory.agent-mate.ai/scripts/portal-mcp-session-probe.sh` | `memory.agent-mate.ai/scripts/probes/portal-mcp-session-probe.sh` |

**D2 落盘**：Sprint 6 **15 行**逐行标注分级（上线后一周内补齐 3 · 上线后第一批 7 · 有真实规模需求再启动 4 · 随重排即时执行 1）· Sprint 7 加「压缩说明」· `product-backlog.md` 投影**已核对、`Sprint` 编号不变**（只登记核对结论，不改行）。

**D3**：**跳过**（用户未提供 OSS region）⇒ 不填任何 region 值，四处「待核查」表述保持原样。

**验证**：

- `make portal-acceptance` **退出码 0**（结论表五行全绿）—— 其中 `TC-L2`（6/6）与 `TC-L3-ISO`（15/15）是**经 `Makefile` 变量调用的被移探针** ⇒ 直接验证「移动 + 改指」。
- 其余 5 个被移探针逐个复跑：`gc-probe` / `i18n-probe` / `iso-probe` / `limits-probe` / `profile-probe` **全部 rc=0**；`qwen-verify` 仅 `--help` rc=0（**完整复跑会真实调用 MaaS，未执行** —— 如实登记，不谎称 rc=0）。
- `bash -n` 8/8 · `doc-links` **56 文件 / 1479 链接零悬空** · `attestation-paths` 通过 · `preflight-test` 5/0 · `secret-check` 通过 · `tsc --noEmit` 0 错 · `git diff --check` 干净 · 收尾后容器内同形进程 **0**、未新增测试用户目录。

**边界（如实登记）**：

- **扫描面**：零残留复检面 =「文档 + 脚本 + 配置注释 + 测试注释」；**`.codebuddy/`（过程资产）内约 16 行旧路径未动**（与 `ADR-021` 边界一致），`link-check.sh` 的 `EXCLUDE_DIRS` 亦已排除该目录。
- `admin_portal/tests/**` 只改**注释里的路径**（5 处），**无行为改动**。
- `deploy/config.toml.tmpl` 只改**注释**（键集合未动 ⇒ 与 `deployment.md` §5.3 的镜像断言无关）。
- 「约 55 处」是 ADR 原稿的快照，**实际 180 处**；已把「以现场 grep 为准」写进 `ADR-021` 的 Consequences。
- 本机未入仓的 `memory.agent-mate.ai/secrets.local.hk_vps_4.md` 内 1 处旧路径已顺手同步（不入制品）。
**交付后回归（同日，17 项门禁串行复跑）**：`secret-check` · `doc-links`（56 文件 / **1479** 链接零悬空）· `attestation-paths` · `preflight-test` 5/0 · `deploy-doc-audit` 5/0 · `pin` · `mcp-smoke`（含 attestation 正负对照）· **`portal-acceptance` 退出码 0**（结论表 5/5 · 相 2 9/9）· `portal-coverage`（35 files / 356 passed · 93.58/87.22/97.85/94.7）· `3.19` 探针 9/9 · 5 个被移探针（`gc` / `i18n` / `iso` / `limits` / `profile`）全部 rc=0 · `portal-e2e` 离线端到端通过 ⇒ **分层与 180 处改指未损坏任何一侧**。

**唯一红项是环境问题（非回归）**：`make portal-e2e` 的默认端口 8788 被 **2026-09-23 10:12 启动的常驻 dev 门户**占用（脚本真实退出码 **30** = 前置不满足；`make` 会把它折叠为 2）⇒ 用 `--port 8791` 重跑即绿。需要时可 `make portal-down PORT=8788` 停掉该常驻实例。

**未覆盖（如实登记，未测 ≠ 通过）**：生产域名链路（CF Access / 隧道）· `portal-e2e --online`（需 Service Token）· 备份外迁（OSS 凭证）· `make restore-drill`（会动数据）· `make preflight` / `pin-update`（需网络）· `probes/qwen-verify.sh` 完整复跑（真实调用 MaaS）。
### Sprint 4 `#4.2`「web-portal:接入说明」开工准备：`3.20` 判据可行性探针 + S6 契约落点同步

**为什么**：`#4.2` 的三项验收（「新用户按页面指引 ≤ 3 步完成接入 · 示例一律占位符不出现真实值 · 四语言键集合一致」）在**落地前**没有一条可机器判定的形状；同时覆盖核对发现公开首页仍是**占位页**、`AC6.4/6.5/6.6/6.11` **无实现也无判据**、`TC-P-L2-06` 的 AC 映射只写 `AC14.11`（易被读成与 S6 无关）。按 `ADR-017` 的口径：技术复杂度高 / 判据不明的条目先开**探针**，再开实现。

**做了什么（产品代码一行未动）**：

- **新增 `3.20` 探针** `memory.agent-mate.ai/probes/instructions-verdict-probe/`（`probe.sh` + `probe.py` + `README.md`，编排骨架照抄 `scripts/portal-e2e.sh`：自签 JWT + **独占端口预检** + 就绪探测 + `trap` 收尾）。
  实测 **13/13 PASS · 退出码 0**，四个问题各有**灵敏度对照**：
  ① 「三步接入」判据可判别 —— 同一套判据在**原型**判 3 步且纵向、在**已实现页**判 0 步；
  ② Admin 入口**必须判 `admin.entry` 键** —— 裸 `a[href^="/admin"]` 在原型上也是 0（照此落地会恒假绿）；
  ③ 占位符扫描规则在**17 个制品文件上 0 命中**，注入真实令牌形态 / `nginx4.agent-mate.ai` / 公网 IP 三条对照全命中；**允许清单只含裸产品域名**（品牌串 `AC6.11` 要求出现它 —— 首轮把品牌串当泄漏，误报 9 处，已修）；
  ④ 档位集合比对**权威侧可机械取到**（`mcp-capabilities.md` 档位表 `core 8 · admin 22 · graph 20 · power 57 · full 101`），且两侧已**双向定档**（`mcp-design.md` 明写 capabilities 是接入指引页的**唯一内容源**）；取法必须限定档位表格行 —— **全文 regex 会被 `--tier smart` 与 `--profile core` 的同形词污染**（实测取到 6 档噪声）。
- **契约同步**：`web-test.md` 新增「S6 落点与判据定档」块（AC↔TC 映射、四条用例的自动化落点、`TC-P-L2-06` 映射订正）· `web-design.md` §15 词表规模口径 **220 → 260 键**订正（实测 `en.json` 260 键）、§12.3 补「占位符合规的机械判据与允许清单」。
- **排期同步**：`sprint-backlog.md` `#4.2` 行 `ToDo → WIP`，说明列登记开工准备证据与现状（`/` 仍是占位页；三步内容键已在四语言词表就绪但**无模板引用** ⇒ 实现 = 接模板；`tools.*` 22 键）。

**验证**：`3.20` 探针 13/13 PASS（退出码 0，含 4 条灵敏度对照）· `make doc-links` 零悬空 · `make attestation-paths` 通过 · 探针目录仅新增 `probe.sh` / `probe.py` / `README.md` / `.gitignore`（`out/` 已忽略）。

**边界（如实登记）**：`AC6.6`（口径不一致阻断发布）本轮**未涉及**，其判据形状需在实现轮另定 · `AC6.9` 的「真实界面截图」只验了判据可判别（正向样本 = 原型），未验实现页 · `AC6.4` 的**页面侧**比对要等页面落地 · 探针的「基础设施主机名」取自本机未入仓的 `secrets.local`，无 secrets 的机器上该路对照会跳过并在输出中明示。
### Sprint 4 `#4.2`「web-portal:接入说明」交付：公开首页从占位页换成真实接入说明页

**为什么**：`#4.2` 的三项验收（「新用户按页面指引 ≤ 3 步完成接入 · 示例一律占位符不出现真实值 · 四语言键集合一致」）此前**无实现也无判据** —— 公开首页 `/` 只渲染占位页，`AC6.4` / `AC6.5` / `AC6.6` / `AC6.11` 未挂任何 `TC-P-*`。本行把页面做出来，并同批把判据补齐（契约与实现一次对齐）。

**做了什么**：

- **模板** `admin_portal/src/web/views/instructions.njk`：占位页 → 真实接入说明页。**结构与类名逐字对齐原型** `specs/web-portal/mockups/01-instructions.html`（`.shell-locale .locale-switch` · `.guide-hero` · `#setup .steps > .step`（含 `.step-num` / `.token-mask` / `.contact-admin*`）· `.codeblock*` · `.step-figure` · `#agents .agent-roster` · `#tools .guide-caps-table` · `.site-footer`）；**文案 100% 服务端取词**（零硬编码，含语言组、品牌串、三步、名册、能力表、页脚）。
- **路由与上下文**：`src/web/routes/index.ts` 注入公开页上下文；新增 `src/web/pages.ts` 的 `publicShell()` —— **复用 `buildShell` 的语言组构造**（`localeOptions` / `preservedQuery` / `formAction`），只把 `active` 置 `none`、不复用管理面导航语义。`GET /instructions → 301 /` 与面隔离行为不变。
- **示例一律占位符**（§12.3「公开页不含机密」）：配置示例用 `https://{MCP_HOST}/mcp` + `Bearer memo_…`，令牌用掩码形态 `memo_a1b2.....4o5p6`。**这里对原型做了一处有意偏离**：原型 step2 写的是真实产品域名，而 `AC6.5` 要求「主机名与令牌均以占位符出现」⇒ 按 AC 实现并登记（原型的写法若照搬会让 `AC6.5` 不可判）。
- **素材**：实现侧 `admin_portal/assets/` 的 10 个文件（`logo.png` · `wechat.png` · `chat-example.png` · `guide/*` 7 个）与原型 `mockups/assets/` 同名文件 **`shasum -a 256` 逐一同值** ⇒ **直接复用真实素材**（本轮开工准备的原「占位图 + 登记待替换」选择由此被事实取代：素材早已同源落地），`AC6.9` 按「真实加载」（`complete && naturalWidth > 0`）判，**无待替换项**。
- **判据落地**（用例号续编 `TC-P-L2-14`–`TC-P-L2-18`，挂在 `web-test.md` 的 S6 落点块）：
  `TC-P-L2-14` 结构与入口（`AC6.1`/`6.7`/`6.10`/`6.11`）· `TC-P-L2-15` 能力表与能力文档逐项一致（`AC6.4`，权威侧取法**限定档位表格行**）· `TC-P-L2-16` 占位符合规扫描（`AC6.5`，允许清单只含裸产品域名）· `TC-P-L2-17` 发布阻断（`AC6.6`，即前两条的反向对照）· `TC-P-L2-18` 真浏览器交互与图片（`AC6.8`/`AC6.9`）。`AC6.4/6.5/6.6/6.11` 由此补齐挂靠。
- **`AC6.6` 不新增门禁目标**：口径不一致或出现真实值时，`make portal-test` 直接转红（用户选择「并入既有离线门禁」）。

**验证**：

- 离线 **371 passed / 35 files**（基线 356 ⇒ **+15**）· 覆盖率 **93.6 / 87.13 / 97.86 / 94.71**（阈值 92/85/96/93）。
- 真浏览器：`bash memory.agent-mate.ai/scripts/portal-e2e.sh --port 8791` **退出码 0**（新增「公开接入说明页」段：三步纵向几何 · 悬浮层悬停/聚焦显示与焦点移出收起 · 二维码与示例图**真实加载** · 名册 7 项 · 能力表 8 行且位于可滚动容器 · 页内锚点无断链 · 四语言激活按钮与文案语言一致 · 无横向滚动 · 页脚贴合）。
- 零回归：`make portal-acceptance` **退出码 0**（结论表五行全绿）· `npx tsc --noEmit` **0 错** · `doc-links` / `attestation-paths` / `preflight-test` 通过。
- **判据敏感性证明**：往模板注入真实令牌形态（`memo_<20+ 位>`）⇒ **4 条判据同时转红**（两条扫描断言 + 两条反向对照），还原后转绿 ⇒ 门禁确实在测事、不是空转。

**过程中修掉的三处自身缺陷（都是「判据写错」而非产品缺陷）**：

1. **注释里的取词字面形态会被护栏扫成缺键**：模板注释写了取词调用示例 ⇒ `tests/unit/i18n-keys.test.ts` 的提取正则把它当真实调用，报 `instructions.njk: key`（仓内「护栏会扫中自己的文档」的又一例）⇒ 注释改为不写该字面形态。
2. **悬浮层「键盘收起」的断言写错**：`Tab` 会把焦点移进悬浮层内的邮箱链接（仍是 `:focus-within`）⇒ 仍可见；且 Playwright 的鼠标会**停在**触发器上（`:hover` 持续命中）⇒ 断言前必须移开鼠标并真正移出焦点。实现与原型同构（CSS `:focus-within`），故「键盘收起」= 焦点离开即收起。
3. **能力表被误加进「不得溢出父容器」的护栏**：`.table-wrap{overflow-x:auto}` 下「表格比容器宽」是**设计意图**（窄屏横向滚动）⇒ 放进 `OVERFLOW_SELECTORS` 必然假红；改为断言「能力表位于可滚动容器内 + 页面本身无横向滚动」。

**边界（如实登记）**：

- **FAQ 口径差异待定夺**：`web-design.md` §12.3 称首页含「3 条 FAQ」，而原型 `01-instructions.html` **无 FAQ 区** ⇒ 本轮**按原型实现**（未擅自加区），差异登记待定夺。
- **联系邮箱尚未配置化**：`CONTACT_EMAIL` 是路由常量（设计真源 = 原型 `mailto:`），目前无配置键；如需按部署改地址，再加 `PORTAL_CONTACT_EMAIL` 并同步 `deployment.md` 配置契约表。
- `AC6.9` 的「真实界面截图」用的是**已验收的原型素材**（同源同值）；若日后要换成新截图，替换 `admin_portal/assets/chat-example.png` 即可，判据不变。
- 本行**不涉及** `4.3`（启动自检）与 `#7`（真身份口径核对），也不改 MCP 桥 / 上游 / 会话层。
### Sprint 4 `#4.3`「web-portal:启动自检」开工准备：`3.21` 判据可行性探针 + §3.4 判据定档

**为什么**：`#4.3` 的四条检查（`AC11.1`–`AC11.5`）**大部分已实现** —— `admin_portal/src/selfcheck.ts` 实做 6 项并经 `server.ts` 的启动序列 fail-closed；但另有 **3 项显式 `deferred`**（`embeddings_reachable_1024` / `binary_version_matches_lock` / `launch_template_assertions`，detail 写着「待 §4.3 落地」）⇒ 本行的实质交付点就是**收口这三项 + 把判据形状定死**，而它们各自的「能不能判、怎么判」正是开工准备要回答的问题。

**做了什么（产品代码一行未动）**：

- **新增 `3.21` 探针** `memory.agent-mate.ai/probes/selfcheck-verdict-probe/`（`probe.sh` + `README.md`）。实测 **8/8 PASS · 退出码 0**，五问各带灵敏度对照：
  ① **fail-closed 三重证据**：合法配置 ⇒ `portal_listening` + `/healthz` 通；`/data/users` 不可写（`chmod 500`）⇒ **退出码 1**、日志记失败项；且此时**端口未监听**。
  ② **`deferred` 当下算通过**：`pass=6 deferred=3 fail=0` 时门户**照常启动** ⇒ 缺口坐实（收口后 deferred 应归 0）。
  ③ **`embeddings` 不能只判「调用成功」**：坏 key 下上游出「线性扫描 / 无 embeddings」告警，而 `tools/call` **仍然返回响应**（静默降级真实存在）⇒ 判据必须是「**可达 + 维度 `1024`**」。
  ④ **版本归一化取法成立**：`ai-memory --version` = `ai-memory 0.10.0`（取末位 semver）⇄ `upstream.lock` 的 `UPSTREAM_RELEASE_TAG=v0.10.0`（去 `v`）；并**实证 `upstream.lock` 未挂进门户容器** ⇒ 锁侧输入归 Sprint 5 镜像侧。
  ⑤ **模板断言可复用**：`launch-template.ts` 的 argv/env 常量表 + `mcp-design.md` §5.6.4 真源都在，启动期做同一比对体即可（现有单测 17 例已守同一比对）。
- **契约同步**：`web-design.md` §3.4 新增「**启动自检判据定档**」块（判据形状 · 编排不变量 · 锁侧输入归属 · 通路选择待拍板 · 编排侧缺口）；`web-test.md` 补 S11 的判据形状与**编排不变量**用例（新号取 `TC-P-L0-*` 最大值 +1，避开已占用的 `-10` / `-11`）。
- **排期同步**：`sprint-backlog.md` `4.3` 行 `ToDo → WIP`，说明列登记开工准备证据与边界。

**验证**：`3.21` 探针 8/8 PASS（退出码 0）· `make doc-links` 零悬空 · `make attestation-paths` 通过 · 探针目录仅新增 `probe.sh` / `README.md` / `.gitignore`（`out/` 已忽略）。

**边界（如实登记）**：**维度 `1024` 未在探针里断言**（门户侧无 embeddings 客户端，读维度需 SDK/HTTP 通路）⇒ 实现前须先拍板「spawn 上游 vs 直连 MaaS」（直连会新增配置键并牵动 `deployment.md` 契约表）· **镜像侧落地（`IMAGE_TAG` 注入 + 挂载锁文件）归 Sprint 5**，本行只交付判据/读取位/失败路径 · `portal.compose.yml` 无 `healthcheck`、`/healthz` 不反映自检结论（编排侧缺口已登记）· **实现轮必须同步改** `tests/unit/selfcheck.test.ts` 里「三项 `deferred` 且 detail 含 `4.3`」的硬断言，否则 `make portal-test` 直接转红。
### Sprint 4 `#7`「deploy:真身份口径核对」开工准备：`3.22` 判据探针 + 核对对象改指真源

**为什么**：`#7` 的验收形态是**文档核对**（`SBI-D5`：「只读核对：受影响则更新，未受影响则显式登记「已核对、无需改」」），而它点名的核对对象里有一条是**空的** —— 「`mcp/mcp-design.md` 主机名与 Bypass 口径」在该文件内**不存在**（全文搜 `Bypass` 0 命中，只回链 `web-portal/web-design.md` §6）。⇒ 开工准备要先把「核对谁、按什么判」定死，再把受影响项列出来，避免本体轮得出一条无内容的结论。

**做了什么（产品代码一行未动）**：

- **新增 `3.22` 判据探针** `memory.agent-mate.ai/probes/identity-scope-verdict-probe/`（`probe.sh` + `probe.mjs` + `README.md`；**纯静态、只读、零网络**，不需要容器）。实测 **5 PASS / 3 待修订**，每条都给出**两侧真源**与判定依据。
- **核对对象改指真源**：`deployment.md` §12.4 / §12.5.1 / §12.5.4（身份来源、Admin 邮箱与 Allow 策略、MCP 面 Bypass、`PORTAL_ACCESS_*` 与生产禁用键）+ **`web-design.md` §6**（Host/Bypass 表）与 §12.3（按 Host 分面）；并在 `mcp-design.md` §5.6.2 的**回链处就地补一句落点说明**（本文件不展开该口径，核对落在 `web-design.md` §6）。
- **三项待修订项（`SBI-D5`：受影响则更新）**：
  ① `deploy/portal.compose.yml:79` 注释写 `PORTAL_ENV=dev`，而 `admin_portal/src/config.ts` 的枚举只认 `development` / `production` ⇒ **照注释填报会踩启动期校验**；
  ② **`--dev-login` 的生产禁用口径在 `deployment.md` 缺位**（只登记在 `web-design.md` D15 / `ADR-015`）⇒ 口径覆盖不完整；
  ③ `deploy/config.toml:3` 与 `deploy/config.local.toml:3` 的注释仍写旧部署目录 `/opt/ai-memory-mcp/`（已统一为 `/opt/ai-memory/`）—— **制品侧**注释，正是运维会照抄的地方。
- **已 PASS 的五项**（可直接登记为「已核对、无需改」）：生产禁用键三处同集（6 键）· 面隔离两 Host 键齐备且「必须不相交」在代码与设计两侧都写了 · 「MCP 面必须绕过 Access」在设计/指南四处一致 · `mcp-design.md` 的回链有效（目标节含 Host/Bypass 表）· 旧口径规则的**灵敏度对照**（注入即命中，不是恒绿）。
- **契约与分工登记**：`deploy-guide-audit/README.md` 补一条边界 —— 主机名 / Bypass / 隧道 / 真身份口径**不在** `make deploy-doc-audit` 的判据内，由本探针承载（避免「本行已被门禁把住」的自证不实）。

**验证**：`3.22` 探针 5 PASS / 3 待修订（退出码 0）· `make doc-links` 零悬空 · `make attestation-paths` 通过 · 探针目录仅新增 `probe.sh` / `probe.mjs` / `README.md` / `.gitignore`（`out/` 已忽略）。

**判据不许「假绿」的两处实测教训（已写进探针规则）**：① **历史叙述不是残留** —— `deployment.md` 的变更记录行里出现旧目录是**合法历史**（按仓内改名口径保留、靠映射表收口）⇒ 规则必须豁免 `| 20YY-MM-DD |` 形式的变更记录行（实测豁免 1 处），否则第一条命中的就是历史行；② **扫描面必须含制品** —— 只扫 spec 会漏掉 `deploy/config.toml*` 注释里的旧路径，而那正是运维照抄处。

**边界（如实登记）**：三条待修订项的**实际修订**与「逐项留结论」的最终形态属 `#7` 本体 · `deployment.md:33` 的「DNS（两个域名）暂无承接条目（归属待定）」属**人工留结论**项，不在机械判据内 · 交叉引用锚点（`web-design.md` §6 / §6.1）本轮只做语义核对，不加机械断言（避免把「引用错节」误判成漂移）。






## 2026-09-24

### 备份目标写实为「阿里云 OSS」+ 云资源清单落点 + 两处指称校正（含订正上一轮核实里的误判）

**为什么**：① 用户核实备份机制时确认「备份用的是我在阿里云的 OSS」，而全仓**没有一处**写「阿里云」——只写 `OSS` 或「OSS 兼容对象存储」，靠 `ossutil` 与 `RAM 子账号` 两条阿里云专有术语间接体现；② Sprint 5 的阻塞行 `#8` 写「云资源准备清单见 `deploy/README.md`」，而该文件**并无此清单**（只有 4 个事实文件的说明）⇒ 阻塞项的依据指向空处；③ `deployment.md` 写「生产定时器安装 / 日志采集 / 告警留 Sprint 5」，但在 Sprint 5/6/7 全部行内检索 `定时器|cron|日志采集|告警|每库维护` **零命中** ⇒ 该生产项**无任何承接条目**；④ 核实中发现 `deployment.md` 有一条变更记录（2026-09-22）声称「三处的 Sprint 由 5 改为 6」，而 2026-09-23 的重排已把生产上线与备份恢复放回 Sprint 5 ⇒ **正文对、声明错**。

**做了什么**：

- **写实供应商**：`deployment.md` §8 的外迁目标由「OSS 兼容对象存储」改为**阿里云 OSS 私有桶**；[`product-backlog.md`](product-backlog.md) #9 · [`sprint-backlog.md`](sprint-backlog.md) Sprint 5 `#8` · [`web-portal/web-design.md`](web-portal/web-design.md) T10 · [`adr/ADR-005`](adr/ADR-005-upgrade-admission-gate-layering.md) 同步写实。
- **region 标为待核查**：用户明确「region 需要再核查」⇒ **不写死香港**，四处权威表述改为「region **待核查**（现登记为香港）」，并在 `deployment.md` §1.1 给出核查命令（`ossutil ls` / `ossutil stat` / `ossutil config`，或控制台看「地域」）；**核实后回填**。
- **新增 §1.1 云资源准备清单**（`deployment.md`，唯一真源，7 项：阿里云 OSS 私有桶 · RAM 子账号 AK · SSH 密钥对 · Cloudflare Access 应用与策略 · Access Service Token · 门户专用 MaaS key · DNS）；Sprint 5 `#8` 的指针改指本表。
- **补上生产项的承接**：`deployment.md` §5.3 的「留 Sprint 5」改为条目级指称 **Sprint 5 `#10`**，并在 `#10` 的说明列写明「含每库维护生产定时器安装、日志采集与失败告警」⇒ 双向可追溯。
- **订正 2026-09-22 的改指声明**：保留原行（历史叙述不改），其后标注**已被 2026-09-23 重排取代**；正文三处「Sprint 5」**自始正确，未改**。
- **如实登记的缺口**：`DNS` 在 Sprint 5 无承接条目 —— 本次只把它列进 §1.1，归属待定。

**验证**：`make doc-links` · `make secret-check` · `make attestation-paths`（五路径）· `make preflight-test`（5/0）· `git diff --check` 均通过；人工核对 §1.1 清单与 Sprint 5 `#8` 指针双向一致、四处 region 均**未写死**、`deployment.md` §12.1 的「hk_vps_4（香港 VPS）」是**服务器位置**未受影响。

**边界**：按用户选择**只写实措辞、不新增护栏**（未改 `secret-check` / `attestation-paths-check`）；region 回填待用户核查后进行。本轮同时订正了上一轮核实中**因按行号跨表取数**而误报的两项（`deployment.md` 正文三处与 §12.2 的 Sprint 号本自正确）。

### `3.9` 开工准备：`3.11` 探针钉死「身份透传」与「超时分层」的装配语义

**为什么**：`3.9`「mcp:上游能力透传与超时分层」要把 `initialize` 回包的 `serverInfo` / `capabilities` **从「桥自报」改成「代上游自报」**。这不是改两行字面量 —— 身份与能力一旦取自上游，SDK 的三处行为立刻变成硬约束，而它们**只写在编译产物的构造函数里**：能力断言发生在 `setRequestHandler`（**注册期**）、`capabilities.logging` 会让 SDK 在桥本地**吞掉** `logging/setLevel`、`ServerCapabilitiesSchema` 会**丢弃未知能力键**。不先钉死，就会写出「上游缺某项能力 ⇒ 桥直接起不来」这类**只在特定上游上暴露**的缺陷。

**做了什么**（**只做开工准备，产品代码一行未动**）：

- **新增探针 [`../probes/bridge-identity-probe/`](../probes/bridge-identity-probe/)（`3.11`，研究类）**：**全进程内**拓扑（`[探针客户端] → [桥 Server] → [假上游 Server]`，`InMemoryTransport`），**七项断言全过、退出码 `0`、两次复跑一致**。用进程内传输是**刻意的边界**并已如实登记：本探针要证的是**装配层语义**（构造参数会不会被回吐、能力断言在什么时点触发、SDK 内置 handler 会不会遮蔽 fallback、两个 `timeout` 各管哪一段），这些与传输无关；传输层（`Streamable HTTP ⇄ stdio`）已由 `3.5` / `3.10` 覆盖，再搭一遍只会把无关失败面引进来。
- **六条结论落档**（[`mcp/mcp-design.md`](mcp/mcp-design.md) §5.6.2 的 `3.11` 实证块）：① 身份与指令**字段与取值全保留**，但**键序被 schema 解析重建** ⇒ 契约**不能**写「逐字节」（首版探针按字符串比，就因这个**假失败**退了一次码 20）；② 能力是「**归一化后**透传」（`ServerCapabilitiesSchema` 是普通 `z.object`，未知键被丢弃）；③ **能力断言在注册期** ⇒ 透传转发**不依赖**能力声明，但「能力取自上游 + 无条件注册业务 handler」会让**上游缺该项时桥构造期抛错**；④ `capabilities.logging` 会让 SDK 在**桥本地吞掉** `logging/setLevel`（`removeRequestHandler` 可拽回）；⑤ **全 fallback 下 `tools/call` 往返正常** ⇒ 可删掉 `3.1` 的 4 个显式业务 handler，一并消解 ③ 与 ④；⑥ 两个超时**真正独立**（反着设值仍正确）。
- **[`web-portal/web-design.md`](web-portal/web-design.md) §12.5 新增两节定档**：「桥对客户端的身份与能力」（透传范围 / 归一化口径 / 桥可辨识性**不进** MCP 身份 / 显式 handler 一律不注册 / `setLevel` 拽回 / 恒不转发的三项 / **反方向仍未转发**的已知边界）与「超时分层」（`HANDSHAKE_TIMEOUT_MS` vs `UPSTREAM_REQUEST_TIMEOUT_MS`、各自失败形态、**只分层不定值**、可调方式）。§12.9 登记「**不**新增环境键」。
- **[`mcp/mcp-test.md`](mcp/mcp-test.md) §4-F 登记 `TC-M-L1-18` / `TC-M-L1-19` / `TC-M-L1-20`**（上游身份与能力透传 · 超时分层互不牵连 · `setLevel` 抵达上游）与计划落点；[`sprint-backlog.md`](sprint-backlog.md) 增 `3.11` 行、`3.9` 行补「开工前置已就绪」。

**验证**：`node probe.mjs` **七项断言全 PASS、退出码 `0`、两次复跑一致** —— 断言 6 实测 `303ms` / `304ms`（上游需 `1500ms`）· 断言 7 在「握手超时 300ms、请求超时 5000ms」的桥上 `1502ms` 的调用**成功**。原始输出落 `probes/bridge-identity-probe/out/`。

**当时的边界**：本次只做探针与定档，`3.9` 的产品代码**一行未改**（随后于同日交付，见下节）。

### `3.9`「mcp:上游能力透传与超时分层」交付：客户端开始看到上游的真实身份

**为什么**：`3.1` 交付后 code review 找出的两处缺口之一 —— 网关对外**自报家门**（硬编码 `portal-bridge 0.1.0` + 固定 `{tools, prompts}`），客户端看不到上游真实版本，上线后**无法判断镜像是否漂移**；同时「与上游握手」和「向上游发每一个请求」这两类**语义与失败形态都不同**的超时**共用一个值**。本行是 `3.1` 的**最后一条完成前置**。

**做了什么**：

- **身份与能力改为「代上游自报家门」**（`transport.ts`）：`serverInfo` / `capabilities` / `instructions` 取自 `Client.getServerVersion()` / `getServerCapabilities()` / `getInstructions()`，取值**先于** `new Server(...)`（`registerCapabilities()` 在 transport 已连接时**抛错**，是条时序死路）；`instructions` **条件展开** —— 上游无指令就**不写**该键（真上游 core 档正是无指令），否则会把「无」变成「空」，自己破坏契约。
- **删除 `3.1` 遗留的 4 个显式业务 handler，只留 fallback**：依据 `3.11` 探针定档 —— 能力断言发生在 `setRequestHandler`（**注册期**），一旦能力取自上游而网关仍无条件注册 `prompts/*`，**上游未声明该能力时网关会在构造期抛错**（⇒ 会话直接起不来）；且实测两条路径的能力断言**完全相同**（`Client.listTools / callTool / listPrompts` 只是 `Client.request` 的薄包装）。删除后**少两处**网关侧介入（入参校验、具名结果 schema 解析）⇒「原样转发、门户语义知识 = 0」**字面成立**。
- **把 `logging/setLevel` 拽回 fallback**：SDK 为 `capabilities.logging` 在网关**本地**自动注册该 handler（本地处理、返回 `{}`、**不转发**）⇒ 客户端以为设置了级别、上游从未收到；一行 `removeRequestHandler('logging/setLevel')` 修正（上游未声明 `logging` 时是**空操作**）。
- **超时按「语义」分层**（`route.ts` / `spawn.ts` / `server.ts`）：根因是**一个名字管两种语义**，故注入面与选项**一并拆开**为 `handshakeTimeoutMs` 与 `upstreamRequestTimeoutMs`，让二者在**类型层面**不可能再被混用；两个默认值保持 `30s`（分层本身不改变行为，取值归 `4.1`）。顺带**删掉 `relay()` 的死参 `opts.timeoutMs`** —— 声明了却从不使用，会让人误以为转发层还有一层超时兜底，而那一层在 HTTP 侧包不出来。
- **测试**：集成新增 `TC-M-L1-18`（身份 / 能力 / 指令取自上游 + **不凭空造字段**的反证）· `TC-M-L1-19`（两个超时**反着设**各起一个实例：短握手 + 长请求必须成功、长握手 + 短请求必须在 `-32001` 处失败，**错误码与耗时一起断**）· `TC-M-L1-20`（`logging/setLevel` 抵达上游，判据取**上游传输层留痕**而非上游返回值）；夹具新增五个观测位（`--identity` / `--capabilities` / `--instructions` / `--tool-hang-ms` / `--request-log`），**默认值全部不变** ⇒ 既有用例零回归。

**验证**：离线 **312 passed / 28 files** · 覆盖率 **93.05 / 85.77 / 97.66 / 94.36**（阈值 92/85/96/93，**比改前更高**）· `make portal-mcp-probe`（真上游借壳）**退出码 0、四断言 PASS** · `make doc-links` **48 文件 / 1317 链接 / 零悬空** · `npx tsc --noEmit` 无错。

**一处要如实体认的事**：真上游 core 档声明的能力恰好是 `{prompts, tools}` —— **等于网关原来的硬编码值**，所以本行对当前部署的**可观测变化只有 `serverInfo`**（`portal-bridge 0.1.0` → `ai-memory 0.10.0`）。这不削减本行的价值（契约正确 + 换档位自动跟随 + 镜像漂移可见），但意味着**验收断言只能写「等于上游声明的值」，不能写「能力发生了变化」**。

### `3.2` 开发准备：把「路径断言」从「照字面判」纠正为「按归一化判」

**为什么**：`3.2` 的验收条件是「库路径为空 / 不在 `/data/users/` 内 / 与 handle 不匹配时拒绝建立会话，且**不 spawn 子进程**」。三条判据的**字面**版本看起来完备，但 `AI_MEMORY_DB` 的渲染只是字符串替换（模板常量 `/data/users/{handle}/ai-memory.db`，`renderLaunch` 不做任何校验）—— 于是「含该 handle」这句话在**未归一化**的路径上几乎恒真。

**实测（本轮，纯计算，未改产品代码）**：

| 非法 `handle` | 渲染出的 `AI_MEMORY_DB` | 字面三项 | 归一化后 | 归一化三项 | 只看字面的后果 |
|---|---|---|---|---|---|
| `alice/../bob` | `/data/users/alice/../bob/ai-memory.db` | **三过** | `/data/users/bob/ai-memory.db` | 过 / **不过** | **静默串到他人库**（`AC4.7` 那一类） |
| `../../x` | `/data/users/../../x/ai-memory.db` | **三过** | `/x/ai-memory.db` | **不过** | 越出 users root |
| `../bob` | `/data/users/../bob/ai-memory.db` | **三过** | `/data/bob/ai-memory.db` | **不过** | 落到 users root 之外 |
| `""` | `/data/users//ai-memory.db` | **三过** | `/data/users/ai-memory.db` | 过 / 过 | **归一化也拦不住** ⇒ 见下 |

**做了什么**（仍只做开发准备）：

- **定档「必须在 `path.posix.normalize` 之后判定」**，落 [`mcp/mcp-design.md`](mcp/mcp-design.md) §5.6.4 不变量 2 并附上表。
- **明确不做**不变量 1（`handle` 匹配 `HANDLE_PATTERN`）的 spawn 侧复述：空的 / 越界的 `handle` 在**签发链路**上已被 `shared/handle.ts` 的 `userDirectory()` 拦死（`path.resolve` 后 `path.dirname` 必须等于 usersRoot，否则抛错 ⇒ `issueKey` 返回 `directory-failed`，**令牌签不出来**）⇒ 再补一条就是**不可达分支**，只会稀释覆盖率（本仓 `statements` 余量本就薄）。**这是有理由的不做，不是遗漏。**
- **审计与文案口径**（[`web-portal/web-design.md`](web-portal/web-design.md) §12.5）：审计**只记原因枚举**（`empty` / `outside_users_root` / `handle_mismatch`）+ `stage`，**不记路径** —— 路径里可能含**他人 handle**，写进本用户的审计行等于把他人身份落进可检索的审计面；客户端文案用**同一句**覆盖「缺失或不匹配」，同时满足 `AC4.4` 与 `AC4.7`。
- **端到端可达性查明**：能走到 HTTP 层的坏输入**只有** `alice/../bob` 这一类（`userDirectory` 放行、归一化后指向他人库）⇒ 它正是 `AC4.7` / `TC-M-L3-02` 端到端用例的触发手段（测试里用 repo 层 `insertUser` 绕过 `createUser` 的 `validateHandle`）；`""` 与「越界」两类只能由**纯函数单测**覆盖。落点已登记 [`mcp/mcp-test.md`](mcp/mcp-test.md) §4-F。

**当时的边界**：该次只做开发准备，`3.2` 的产品代码**一行未动**（随后于**同日交付**，见下节「`3.2` 交付」）。

**顺带修一处上一轮引入的文档缺陷**：[`sprint-backlog.md`](sprint-backlog.md) 变更记录表是**追加序**，而上一轮追加 `3.9` 交付行时用了「替换」而非「追加」，把 `2026-09-20 初版：登记 4 项 ToDo 与 4 项待提供输入` 那一行**覆盖**掉了，并且插在表头。该条目已还原、错位行已移到表尾，并在同表登记了这条修复。

**决策修订（用户拍板后）**：开发准备稿里我写的是「不变量 1 的 spawn 侧复述**不做**」，理由是「不可达分支只会稀释覆盖率」。用户追问后复核发现**该理由部分不成立** —— 「不可达」只对**生产 / 集成路径**成立，对**覆盖率**不成立（判定若放在导出的纯函数里，单测可直接覆盖它）。据此改为**加上**：复用真源 `validateHandle`，代价降为「一行 + 一支可覆盖的单测」，收益是 `handle=''` 这类绕过服务层的写入不会让库静默落到 `/data/users/` 根下变成一个**共享库**。已同步：§5.6.4 不变量 1 那段（含修订留档）· §12.5 原因枚举增 `invalid_handle` · §4-F 落点由四支改五支 · `sprint-backlog` 的 `3.2` 行措辞。

### `3.2`「mcp:spawn 前置断言」交付：把「路径是否可信」变成 spawn 前的硬门

**为什么**：RID `D1`（**阻塞级**）的落地行 —— 上游被以**错误的库路径**启动时，失败形态恰恰是「**功能正常**」：漏设 `AI_MEMORY_DB` 会让所有用户静默共用主库，指向他人库则**静默串号**，两者都不报错。门户若不在起子进程之前拦下，就没有第二道防线。

**做了什么**：

- **新增 `src/bridge/user-db-path.ts`**：`checkUserDbPath(dbPath, handle)` 返回判别式结果（四项原因 `empty` / `outside_users_root` / `handle_mismatch` / `invalid_handle`），外加把 `reason` 挂到**裸 `Error`** 上的小工具（本仓零错误子类、零 `catch` 内 `instanceof` 分流 ⇒ 与 `classifyRelayFailure` 读 `error.code` 同构）。判定顺序是**先 `validateHandle`、再 `path.posix.normalize` 后判三项** —— 字面判定会放过全部已知坏输入（实测：`alice/../bob` 的字面路径三项全过、归一化后指向**他人**库）。
- **`spawn.ts`**：在 `renderLaunch(...)` 之后、构造 `StdioClientTransport` **之前**调用断言 ⇒ 拒绝时**子进程一个都不起**。
- **`route.ts`**：spawn 的 `catch` 按 `error.reason` 分流 —— 断言失败归 **500 `spawn_assertion_failed`** + 审计（`stage: 'spawn_assertion'`，**只记原因枚举、不记路径**）+ 一行 `request.log`；其余仍 **503**。顺带消费了此前是**死常量**的 `BRIDGE_ERROR_CODES.spawnAssertionFailed`。
- **测试**：单测 **6 支**（五支判定 + 错误契约）与端到端 **1 条**；新增 `tests/fixtures/marker-command.mjs` —— **执行即留痕**的标记脚本，用来断言**否定命题**「上游未被 spawn」（判据强于 `--env-dump`：后者无法区分「没起」与「起了但在 dump 前退出」）。

**验证**：离线 **319 passed / 29 files** · 覆盖率 **93.18 / 86.02 / 97.68 / 94.47**（阈值 92/85/96/93，**比改前更高**；新模块 `user-db-path.ts` 四项 **100%**）· `make portal-mcp-probe`（真上游）**退出码 0**（新增断言不误伤正常会话）· `make doc-links` 48 文件零悬空 · `npx tsc --noEmit` 无错 · `read_lints` 0 诊断。

**一处如实说明**：加上「复用 `validateHandle`」后，`alice/../bob` 这类输入会**先在 handle 关被拦**、归 `invalid_handle`（而非 `handle_mismatch`）—— 这是**更精确的根因**；`handle_mismatch` 因此留给「handle 合法、但路径指向他人」那一支（模板被改错时的形态）。两支各有一个互斥、可分别触发的入口，且都已由单测固定住。

---

### `3.3` 开工准备：`3.12` 探针钉死「会话隔离判据」，并实测到 2 处缺陷

**为什么**：`3.3`「mcp:一会话一子进程」的两条验收条件 —— `AC4.6`（两个并发会话对应两个独立子进程）与 `AC4.5`（会话前后不出现其他用户的库或临时文件）—— **都指向容器里的东西**。假上游既不是「一个 `ai-memory` 进程」，也没有「用户的库文件」⇒ 这两条**没法**用离线集成测试验；而真上游上「数进程」「看文件足迹」各有两个已知坑（容器是 debian-slim，**没有 `ps`**；本机经 Rosetta 跑 x86_64 镜像 ⇒ `/proc/<pid>/exe` 恒指向 rosetta）。判据不实测一遍，写进 `mcp-test.md` 就只是**纸面判据**。

**做了什么**（**只做开工准备，产品代码一行未动**）：

- **新增探针 [`../probes/session-isolation-probe/`](../probes/session-isolation-probe/)（`3.12`，研究类）**：**真上游**拓扑（探针 HTTP 客户端 → 门户 `/mcp` → 容器内 `ai-memory`，经 `PORTAL_LAUNCH_OVERRIDE` 借壳 `docker exec`），**8/8 断言 PASS、退出码 `0`、两次复跑一致**。缺陷类事实以 `[F] 发现：…` 输出、**不参与**退出码 —— 探针的职责是把事实钉死，不是替实现判对错。断言体放 [`../admin_portal/tests/fixtures/session-isolation-probe.mts`](../admin_portal/tests/fixtures/session-isolation-probe.mts)（放 `probes/` 下会 `ERR_MODULE_NOT_FOUND`，与 `probe-runner.mts` 同因；`tests/` 不进制品）。
- **结论与两处反直觉点落档**（[`mcp/mcp-design.md`](mcp/mcp-design.md) §5.6.2 的 `3.12` 实证块）：① 两会话 ⇒ 容器内上游进程 **0 → 2** 且 **PID 互不相同**、各自带**自己用户的** `AI_MEMORY_DB` / `AI_MEMORY_AGENT_ID`（与 §5.6.4 模板的 `human:{handle}` 一致）；② **`/proc/<pid>/environ` 同 uid 读得到、`-u 0` 读不到**（反直觉实测 ⇒ 判据不要借 root）；③ 会话**真写一次**后用户目录之外**零新增**，**唯一**变化是上游**共享**审计日志 `/data/.local/state/ai-memory/audit/*.jsonl` ⇒ 判据**必须豁免**它（**不能**写「`/data` 零变化」）；④ 旁观者用户库**零变化**；⑤ **门户退出后容器内归零**（β′「父死子死」成立，不需要额外 `kill` 逻辑）。
- **用例与跑法定档**（[`mcp/mcp-test.md`](mcp/mcp-test.md)）：§4-F 新增 `TC-M-L1-21`（两会话两进程 + 各自身份）/ `TC-M-L1-22`（无他人痕迹 + 共享审计日志豁免 + 旁观者零变化）/ `TC-M-L3-05`（**负向**：接管被拒且不伤及受害者）；**新增 §4-G「真上游端到端（online）的跑法与判据」**（入口 / 前置 / 外部依赖 / 观测面 / **拓扑无关**（容器名 + cmdline 前缀 ⇒ 本机借壳与生产 β′ 同一套判据）/ 退出码 / 收尾复验 / 本机局限），并写明**本轮即可用探针跑**同一套观测；产品侧入口 `make portal-mcp-session-probe` 由 `3.3` 交付，**既有 `make portal-mcp-probe` 不动**（不使既有门禁失稳）。同时**补记**该文件 §5 版本记录里 `3.9` 那轮的漏登记。
- **实测到 2 处缺陷（同源）→ 已定档修正**：客户端带**甲的令牌** + **乙的 `sessionId`** 发一次请求时，实现里的「不匹配就 `registry.remove()`」把**乙**的会话从注册表里摘掉 ⇒ ① 乙随后用**自己的**令牌 + 原 `sessionId` **立刻 `401`**；② 乙的上游子进程**失去唯一引用**，没有任何路径去 `close()` 它 ⇒ **孤儿**（门户进程退出才随之消失）。这是 `D3`（一会话一子进程 · 禁止跨用户复用）的**反方向**：拒绝越权请求是对的，但**不能顺手伤到别人**。修正定档于 [`web-portal/web-design.md`](web-portal/web-design.md) §12.5 的「会话归属校验的不可侵扰」（**只拒不动**；仅「该会话自己的传输已关闭」一支才幂等 `close()`），并作为 `3.3` 的**必修项**写入 [`sprint-backlog.md`](sprint-backlog.md) 的 `3.3` 行。
- **排期同步**：[`sprint-backlog.md`](sprint-backlog.md) 增 `3.12` 行（研究 · `Done`）、`3.3` 行补「开工前置已就绪」与判据落点与新缺陷、编号口径与执行顺序同步、变更记录一行。

**验证**：`bash memory.agent-mate.ai/probes/session-isolation-probe/probe.sh` **退出码 `0`**，两次复跑一致（8/8 断言 PASS · 2 项发现 · 门户退出后容器内进程 `0`）。原始输出落 `probes/session-isolation-probe/out/`（**不入库**）。

**未做（等确认才动）**：`3.3` 的产品代码（归属校验修正 · 真上游 e2e 脚本与 Make 目标 · 集成用例）**一行未改**；代码排布见计划文件。

### `3.3`「mcp:一会话一子进程」交付：隔离面的**反方向**也立住了

**为什么**：`3.3` 的两条验收条件（`AC4.6` 两个并发会话对应两个独立子进程 · `AC4.5` 会话前后不出现其他用户的库或临时文件）此前只有**结构性保证**（`spawnUpstream` 只在「新建会话」分支调用、注册表按 `sessionId` 一对一、全仓零池化），**没有可复算的证据**；而开工准备的 `3.12` 探针在真上游上实测出这条隔离面的**反方向是破的** —— 见下第 1 条。

**做了什么**：

- **修一处实测缺陷（同源两处）**（`src/bridge/route.ts`）：会话归属校验原先把「**不属于本令牌**」与「**自己的传输已关闭**」合在一支、统一 `registry.remove()`。单看**拒绝**完全正确（`401` 对、也不新增进程），实际后果是：客户端带**甲的令牌** + **乙的 `sessionId`** 发一次请求 ⇒ **乙**的会话被从注册表摘掉 ⇒ ① 乙随后用**自己的**令牌 + 原 `sessionId` **立刻 401**；② 乙的上游子进程**失去唯一引用**、没有任何路径去 `close()` ⇒ **孤儿**。现拆为两支：**不属于本令牌 ⇒ 只拒不动**（不 `remove`、不 `close`）；**自己的传输已关闭 ⇒ 幂等 `close()`**（传输 → 上游 → 删条目）后仍回 `401`。三条拒绝原因对外**同形**，不泄露会话是否存在。关闭语义按 SDK 源码核实过（服务端传输 `close()` 有 `_closed` 短路、`StdioClientTransport.close()` 把 `_process` 置空 ⇒ **均幂等**；`SessionRegistry.close()` 两步都不抛出）。
- **离线机制层 3 支**（`tests/integration/mcp-bridge-session-isolation.test.ts`）：① 两个并发会话各自 spawn 一个上游进程、**pid 互不相同**且各带**自己用户的**库与身份（`--env-dump` 逐进程落盘 ⇒ **数文件 = 数 spawn**）；② 同用户**重开**会话**不复用**旧进程（禁池化），且旧进程确实退出（`--closed-marker` 写的是那个 pid）；③ **跨用户接管被拒 `401` 且不伤及受害者** —— 不新增进程、**受害者仍可用**、其子进程仍受管（收尾后才出现关闭标记）。
- **真上游端到端新增入口**（`make portal-mcp-session-probe` = `scripts/probes/portal-mcp-session-probe.sh` + `admin_portal/tests/fixtures/session-probe-runner.mts`）：把 `3.12` 探针实测钉死的判据固化成**产品侧门禁** —— 容器内进程 `0 → 2` 且 PID 互不相同 · 各自 `AI_MEMORY_DB` / `AI_MEMORY_AGENT_ID` 正确 · 用户目录之外**零新增**（**唯一豁免**上游**共享**审计日志）· 旁观者用户库**零变化** · 同用户重开为**新 PID** · 接管 `401` 且不新增进程 · **受害者仍可用** · 收尾**无孤儿** · 门户退出后容器内归零。观测参数化为「**容器名 + cmdline 前缀**」⇒ 本机借壳与生产 β′ **共用同一套判据**。**既有 `make portal-mcp-probe` 不动**（实测仍退出码 `0`）。
- **判据敏感性自证**：把 `route.ts` 的修正**临时回退**后重跑 ⇒ **只有 `TC-M-L3-05` 转红**（其余 `321` 项照绿），恢复后转绿 ⇒ 该用例确能检出缺陷，**不是空转**。
- **`3.12` 探针转绿**：两条 `[F] 发现`（受害者被摘掉 / 孤儿）现输出为 `[i]` 的正面结论（「不可侵扰」成立 / 收尾后无孤儿）。
- **如实登记（未做）**：`web-portal/web-design.md` §12.5 声明的会话注册表字段 `child`（子进程句柄 / PID）**仍未落地** —— SDK 已公开 `StdioClientTransport.get pid()`，但本行判据全走**容器内观测**、不需要它 ⇒ 按用户拍板**不塞进本行**，改为在 `sprint-backlog.md` 的 `3.4` 行登记备忘（`3.4` 的「子进程归零」判据要用）。
- **文档**：`mcp-test.md` §4-F 回填三条用例的实测落点、§5 版本记录追加交付行；`mcp-design.md` §5.6.2 与 `web-design.md` §12.5 的定档**已按实现落地、无偏离**；`sprint-backlog.md` 置 `3.3` 为 `Done`、RID `D3` 为 `Implemented`、`3.4` 行加备忘、变更记录一行、Sprint 4 回顾一条。

**验证**：离线 **322 passed / 30 files** · 覆盖率 **93.28 / 86.26 / 97.68 / 94.48**（阈值 92/85/96/93）· `make portal-mcp-session-probe` **9/9 断言 PASS、退出码 `0`** · `make portal-mcp-probe` 退出码 `0`（零回归）· `3.12` 探针 **8/8 PASS 且两条发现转正面** · `make doc-links` / `make attestation-paths` 通过 · `npx tsc --noEmit` 0 错。

**一处既有隐患（只登记、未改）**：`scripts/probes/portal-mcp-probe.sh` 的 env heredoc 里有**两处反引号**（正文会做命令替换 ⇒ 被**当命令执行**、把 docker 用法信息打到 stderr）；本行新增的脚本已避开该坑，既有脚本属 `3.1` 的门禁、不在本行范围。

### `3.4` 开工准备：`3.13` 探针钉死「会话回收」的判据，并清出一处契约矛盾

**为什么**：`3.4`「mcp:会话回收」是本仓**第一次**要给「回收」写**验收判据**（`session.ts:8-11` 的归属说明），而 `AC3.4` 要判的三件事在 SDK 与容器两层**都不是想当然**：「子进程已退出」能数进程（`3.12` 已钉死），但「**不残留僵尸进程**」与「**不残留占用中的库文件句柄**」**没有现成观测手法**；更要紧的是 [`web-portal/web-design.md`](web-portal/web-design.md) §12.5 声明的会话记录字段 `child`（子进程句柄 / PID）—— **不实测就会把契约写错**，下游判据全跟着错。

**做了什么**（**只做开工准备，产品代码一行未动**）：

- **新增探针 [`../probes/session-reclaim-probe/`](../probes/session-reclaim-probe/)（`3.13`，研究类）**：**自包含**（自带 `node_modules`）且**不经门户** —— 要测的是 **SDK 与容器的观测语义**，与门户无关（`3.3` 的探针因为要用门户的库与 `createUser` 才放进 `admin_portal/tests/fixtures/`，本探针不需要）。**8/8 断言 PASS、退出码 `0`、两次复跑一致**。
- **四条决定性结论**：① `StdioClientTransport.pid` 的**生命周期**（连接前 `null` / 连接后可用 / `close()` 后回 `null`）与**语义** —— 本机借壳下它指向**宿主的 `docker` 客户端**（实测 `7484`）而**不是**容器内上游（`19936`）⇒ `child` 字段只能定义为「**门户侧被 spawn 的那个进程**」，**判据一律走容器内观测**；② 「**无占用中的库句柄**」有**直接**判据（扫 `/proc/<pid>/fd`）：会话**中**该会话进程持有该库 **4** 个 fd（`db` / `-shm` / `-wal` / `.deferred-audit.journal`）、**收尾后 0 个** ⇒ **双向都被实测过**，不是「无则通过」型；③ 「**无僵尸**」的判据**必须按 `comm` 认名** —— **僵尸的 `cmdline` 是空的**，按 cmdline 前缀计数**永远抓不到它**；④ **SDK 不提供任何空闲机制**（只有**每请求**超时与 ping 自动 pong）⇒ 空闲超时 / 单会话最长时长必须**自己起计时器**；而 §12.5 列的**五类**回收触发里，**代码只实现了两条**（客户端断开 / HTTP 流结束）。
- **落档**：[`web-portal/web-design.md`](web-portal/web-design.md) §12.5 新增「会话回收的实现口径」（`child` 语义 · 三条判据 · 三类触发的归属 · `AC4.3` 落点待拍板）· [`mcp/mcp-design.md`](mcp/mcp-design.md) §5.6.2 新增 `3.13` 实证块 · [`web-portal/web-test.md`](web-portal/web-test.md) §2 新增 `3.4` 落点（三条**既有**用例 `TC-P-L1-04` / `TC-P-L3-04` / `TC-P-L3-06` + 机制层 / 真上游两层判据）。
- **清出一处契约矛盾（待拍板）**：`AC4.3`「路径留痕（审计行含解析后的库路径）」的落点 —— `RID D4` 的处理说明（2026-09-23 重排）与 `src/shared/audit.ts:25-28` 的注释**都说它属 Sprint 6「审计功能」**，而 `sprint-backlog.md` 的 `3.4` 行把「路径留痕」写在**本行**的验收条件里 ⇒ 已在 `3.4` 行写明证据与推荐口径（**本行写「会话建立」审计行、审计视图留 Sprint 6**），**未擅自定**。
- **用户指定的两项并入 `3.4`**：① `child`（PID）字段落地（本轮已给出其**语义边界**：门户侧进程，不是容器内上游）② 修 `scripts/probes/portal-mcp-probe.sh` 的 heredoc 反引号隐患（既有门禁脚本，随 `3.4` 修并复跑该门禁）。
- **排期同步**：[`sprint-backlog.md`](sprint-backlog.md) 增 `3.13` 行（研究 · `Done`）· `3.4` 行扩容为「三块范围 + 用户指定的既有隐患修复 + `AC4.3` 落点待拍板」· 编号口径与执行顺序同步 · 变更记录一行。

**验证**：`cd memory.agent-mate.ai/probes/session-reclaim-probe && npm install && node probe.mjs` → **退出码 `0`**，两次复跑一致（**8/8 断言 PASS**）。原始输出落 `probes/session-reclaim-probe/out/`（**不入库**）。

**未做（等确认才动）**：`3.4` 的产品代码（三类触发 · 判据落地 · `child` 字段 · 审计行）与那处 heredoc 修复**一行未改**；代码排布见计划文件。

### `3.4`「mcp:会话回收」交付：回收从「两条事件」变成完整闭环

**为什么**：`3.4` 之前，回收只有**事件驱动**的两条（客户端断开 / HTTP 流结束 ⇒ `transport.onclose` 级联 `upstream.close()`），而 [`web-portal/web-design.md`](web-portal/web-design.md) §12.5 的「回收触发」列了**五类** —— **空闲超时 · 单会话最长时长 · 吊销事件一条都没实现**；且 `AC3.4` 的「不残留**僵尸进程**或**占用中的库文件句柄**」**没有判据**（假上游既不是一个 `ai-memory` 进程、也没有用户的库文件）。同时 §12.5 声明的会话记录字段 `child`（子进程句柄 / PID）与 `AC4.3` 的「每次会话记录解析后的库路径」都**未落地**。

**做了什么**：

- **三类触发补齐**：`SessionRegistry.reap(now, limits)` 抽成**吃 `now` 的纯方法**（判据要能确定性复现 ⇒ 单测**不睡觉**、集成层再注入短值），`route.ts` 起**单一** `setInterval(...).unref()` ticker（`onClose` 清理；**两把限额都未配置则连 timer 都不起** —— 这是 `4.1` 「取值归我」纪律的落地）；**吊销回收**落在 401 分支上，判据取「**该会话自己的** `keyId` / `userId` 是否仍可用」⇒ 对外仍是**同形 401**，且**不违反 `3.3` 的不可侵扰**（新增回归用例：用被吊销的令牌打**别人的** `sessionId` **不得**回收别人的会话）。
- **`AC3.4` 三条「归零」判据落地**：进程数回落基线 · **无进程持有该用户库句柄**（扫 `/proc/<pid>/fd`）· **无僵尸**（扫 `/proc/<pid>/stat` 的 `state=Z`；**僵尸的 `cmdline` 是空的** ⇒ 只能按 `comm` 认名）。真上游 e2e 的断言集**扩为 11 项**（新增 `TC-P-L1-04·1` / `·2`）。
- **`child` → `childPid`（字段落实并更名）**：`UpstreamSession.pid`（`transport.pid` 取一次，`close()` 后回 `null`）→ `BridgeSession.childPid`；§12.5 的字段清单**按实测校正**（SDK 只暴露 PID、**不暴露 `ChildProcess` 句柄**；本机借壳下它指向**宿主的 `docker` 客户端** ⇒ 权威判据仍在容器内），并补记 `keyId` / `dbPath`、如实登记 `clientInfo` 至今未落地。
- **`AC4.3` 机制落地 + 口径修正**：新增审计动作 **`mcp_session_opened`**（会话**登记成功后**写一行，`detail_json` 含 `dbPath` 与 `sessionId`）；`src/shared/audit.ts` 里「该审计行属审计视图批次、不在本批范围」的注释按拍板改写；**`RID D4` 处理说明**由「实现与测试落在 Sprint 6」修正为「**机制在 Sprint 4 `3.4`、审计视图在 Sprint 6**」并置 `Implemented`；**Sprint 6 `#1` 加备忘**（本行只做视图，且须覆盖该新动作）。
- **`config.ts`**：两把已登记键（`PORTAL_SESSION_IDLE_TIMEOUT` / `PORTAL_SESSION_MAX_DURATION`）的**读取位**（正整数校验；**未提供 = 不启用该触发**，不写死默认值）。
- **随本行修一处既有隐患**：`scripts/probes/portal-mcp-probe.sh` 的 env heredoc **两处反引号会被当命令执行**（往 stderr 打 docker 用法信息）—— 修后复跑该门禁**零行为变化**。
- **测试判据修正**：`mcp-bridge.test.ts` 的 `TC-M-L1-17` 原按**审计行数**判「正常转发不误报」，会被合法的 `mcp_session_opened` 打破 ⇒ 改为按**动作**筛（语义判据，且更强）。

**验证**：离线 **334 passed / 31 files** · 覆盖率 **93.47 / 86.84 / 97.72 / 94.64**（阈值 92/85/96/93，**四项均高于改前**）· `make portal-mcp-session-probe` **11/11 断言 PASS** · `make portal-mcp-probe` 退出码 `0`（同时验证 heredoc 修复零行为变化）· `make doc-links` / `make attestation-paths` 通过 · `npx tsc --noEmit` 0 错。

**一处如实登记的边界**：僵尸判据是「**无则通过**」型 —— 本机环境未产生过僵尸 ⇒ 该判据只证「可读且当前为空」，**未证「能检出僵尸」**（已写进探针 README 与 `3.13` 实证块）。

### `3.6` 开工准备：`3.14` 探针定档「全链路」判决据，并实测到一条判据陷阱

**为什么**：`3.6`「mcp:全链路联通」的验收条件之一写着「一次写入召回跑通：门户 → HTTP MCP → 子进程 stdio → **用户库** 全程贯通并返回真实结果」。**核实发现覆盖有缺口** —— 已有的真上游门禁（`make portal-mcp-probe`，`3.1` 交付）断言的是**同一个会话内**的「写入成功 + 召回命中 + 库文件落在该用户目录」，而**同进程内的召回可能是它内存里的索引给的**，**不能**证明「写入真的落进了用户库」；全仓此前**没有任何地方**验过「换一个会话 / 新进程仍能召回」（已 grep 确认）。判据不实测一遍就写，风险不只是「没测」—— 它可能写成一条**必然假失败**的断言（见下第 3 条）。

**做了什么**（**只做开工准备，产品代码一行未动**）：

- **新增探针 [`../probes/full-chain-probe/`](../probes/full-chain-probe/)（`3.14`，研究类）**：**自包含**（自带 `node_modules`）且**不经门户** —— 要测的是**持久性**这一件事（门户链路的「令牌 → handle → 库路径」已由 `make portal-mcp-probe` 证过），直接起 stdio 会话把变量压到最少（**同一库路径、不同进程**）⇒ 结论唯一归因。**7/7 断言 PASS、退出码 `0`、两轮复跑一致**。
- **决定性结论**：① **会话 A 写入 → 收尾 → 会话 B（另一进程，pid 不同）召回 ⇒ 回包含该标记** ⇒ 「写入**真的落进用户库**」成立（这正是「全链路」缺的那半条）；② **不优雅收尾**（直接 `close()`、不 `terminateSession`）后**仍能**召回 ⇒ 判决据**不**依赖「先 terminate」，e2e 更稳。
- **实测到一条判据陷阱（本轮最有价值的结论）**：`memory_recall` 是**语义混合检索**，`count` = **返回条数**而非精确命中数 —— **从未写入**的标记**同样**会返回相关命中（⇒ `count:0` **永不出现**），同一库里多一条记忆时 `count:1` 会变 `count:2` ⇒ **按 `count` 写的断言必然假失败**。判据一律写「**回包里有没有那个标记**」，并带**反向对照**防空转。**本轮首版的两条断言正是这样假失败的** —— 而**恰恰因为带了反向对照**，才在第一次运行就暴露了它（而不是等交付后偶发假失败）。
- **落档**：[`mcp/mcp-design.md`](mcp/mcp-design.md) §5.6.2 的 `3.14` 实证块 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §4-F 的 `TC-M-L1-23` 与 `3.6` 落点 · [`sprint-backlog.md`](sprint-backlog.md) 的 `3.14` 行（研究 · `Done`）与 `3.6` 行的开工前置。
- **覆盖核对（本行范围）**：`3.6` 的另一条验收条件「拒绝路径按预期失败」—— **无令牌**已由 `TC-M-L1-02` 覆盖；**越权库路径**的判据在**离线层**（`3.2` 的 spawn 前断言 fail-closed，发生在 spawn **之前** ⇒ 真上游**无观测面**，如实登记、不硬造真上游断言）。
- **一处既有脆弱点（不是缺陷，已登记）**：`scripts/probes/portal-mcp-probe.sh` 的召回断言写的是 `count:1`（`tests/fixtures/probe-runner.mts`）—— 它**现在稳**（该脚本每次清理会 `rm -rf /data/users/$HANDLE`，`portal-mcp-probe.sh:59` ⇒ 每次空库），但**判据本身脆**（一旦「一个会话写两条」或清库被去掉就假失败）⇒ 已写入 `3.6` 的范围，顺手改为按标记判。

**验证**：`cd memory.agent-mate.ai/probes/full-chain-probe && npm install && node probe.mjs` → **退出码 `0`**，两轮复跑一致（**7/7 断言 PASS**）。原始输出落 `probes/full-chain-probe/out/`（**不入库**）。

**未做（等确认才动）**：`3.6` 的产品代码（把「跨进程召回」判决据挂到门户链路 · `portal-mcp-probe.sh` 的判据改成按标记判）**一行未改**；代码排布见计划文件。

### `3.6`「mcp:全链路联通」交付：补上「写入**真的落进用户库**」这条可证伪的判据

**交付了什么**：`3.6` 的两条验收条件里，第二条（拒绝路径）的判据本就在**离线层**（`3.2` 的 spawn 前断言 fail-closed，真上游**无观测面**）；第一条「一次写入召回跑通」**看似已被 `make portal-mcp-probe` 覆盖，实则缺了可证伪的那半条** —— 既有三条断言都在**同一会话内**，而同进程的召回**可能是内存索引**给的。本行补上（用户拍板：落在**扩展既有门禁**，不新增目标）：

- **跨进程召回判决据**（`admin_portal/tests/fixtures/probe-runner.mts`）：会话 A 写入 → 收尾 → **会话 B（另一个子进程）**用同一标记召回 ⇒ 回包含该标记；**并带反向对照**（从未写入的标记**不出现在**回包里）。
- **既有召回断言由 `count:1` 改为按标记判**：`memory_recall` 是**语义混合检索**，`count` = **返回条数**（`3.14` 探针实测：从未写入的标记同样有相关命中、库里多一条就 `+1`）⇒ 按 `count` 写的断言**必然假失败**；它此前之所以不红，只是**靠主脚本每次清库**（`rm -rf /data/users/$HANDLE`）维持 —— 这种「靠别处恰好做了某事」的通过是**隐形**的。
- **顺手修** `scripts/probes/portal-mcp-probe.sh` 两处会误导人的前置提示：`make local-up`（**仓根没有该目标**，起容器是 `scripts/local-up.sh`）与 `cd admin_portal`（**仓根下没有该目录**）—— 用户已实际踩到这两个 `command not found`。

**验证**：`make portal-mcp-probe` 由 **4 项 → 6 项断言全 PASS、退出码 `0`**（改前基线 **4/4**）· **判据敏感性已证明**（临时删掉该用户的库后重测，**同一判据 PASS → FAIL**）· `make portal-mcp-session-probe` 退出码 `0`（零回归）· 离线 **334 passed / 31 files** · `make doc-links` / `make attestation-paths` 通过 · `npx tsc --noEmit` 0 错。

**一处如实登记**：`3.6` 的「越权库路径」在真上游**无观测面**（拒绝发生在 spawn **之前**）⇒ 判据留在离线层，**没有**硬造真上游断言。

### `3.7` 开工准备：`3.15` 探针定档「跨用户隔离」判决据

**为什么**：`3.7`「跨用户隔离」的验收条件是「A/B **经同一门户实例**互不可见」+「两侧均记录**解析后的库路径**」。覆盖核对发现**两条都有缺口** —— `scripts/probes/iso-probe.sh`（Sprint 3，`V2` / `V3` / `V4` 的本地版）已证**上游级**隔离（交叉 `get` / 库路径解析 / 共享主库不变），但那是**用显式 env 直连上游**、**没有经过门户**；`make portal-mcp-session-probe`（`3.3` / `3.4`）虽然经门户起了两个用户的会话，但验的是**进程与文件隔离**，**从没让 B 去召回 A 写的东西**。而「令牌 → handle → 库路径」这一步**恰恰在门户** —— `R1`（致命：多用户隔离可能静默失效）与 `R2`（严重：隔离完全依赖门户一处正确性，无纵深）指向的就是它。⇒ 判据不实测一遍，写进 `mcp-test.md` 就还是**纸面判据**。

**做了什么**（**只做开工准备，产品代码一行未动**）：

- **新增探针 [`../probes/cross-user-probe/`](../probes/cross-user-probe/)（`3.15`，研究类）**：编排骨架由 `3.3` 的 `portal-mcp-session-probe.sh` **派生**（改端口 / 用户名 / 断言体 / 文案），断言体放 [`../admin_portal/tests/fixtures/cross-user-probe.mts`](../admin_portal/tests/fixtures/cross-user-probe.mts)（与 `probe-runner.mts` 同因：复用门户的依赖解析与 `better-sqlite3` 原生编译）。**7/7 断言 PASS、退出码 `0`、两轮复跑一致**；拓扑是**同一门户实例 + 两个用户 + 两条令牌**。
- **决定性结论**：① **B 经同一门户实例召回 A 的标记 ⇒ 回包不含**（上游回 `count:0`）；② **灵敏度对照**：B 能召回**自己**写的（`count:1`）⇒ ① 的「不含」**不是**「B 的检索根本不可用」造成的假通过；③ 反向亦然（**双向**）；④ **按 id 直取**：B 用 A 的记忆 id 调 **`memory_get`** ⇒ 上游回 **`memory not found`**；⑤ **端到端取证**：门户 `audit` 表两侧各一行 `mcp_session_opened`，`detail_json.dbPath` 各自指向 `/data/users/<自己>/ai-memory.db` 且互不相同（`AC4.3` 的机制由 `3.4` 交付，这里判它在**跨用户**场景下成立）；⑥ 两侧库文件真实存在；⑦ 收尾后容器内归零。
- **判据硬约束（写进用例口径）**：召回类判据一律按「**回包里有没有那个标记**」判、**禁止按 `count` 判**（`3.14` 的教训）；且**每条否定型判据必须配一条「必须为正向」的灵敏度对照** —— 这是本轮实测到的**假绿风险**（只有 X2 而没有 X3 时，「B 的检索环境坏掉」也会让它变绿）。
- **覆盖核对与范围**：`3.7` 的第二条验收条件「两侧记录解析后的库路径」的**机制已由 `3.4` 交付** ⇒ 本行只需**取证与登记**，不需新机制。

**验证**：`bash memory.agent-mate.ai/probes/cross-user-probe/probe.sh` **退出码 `0`**，两轮复跑一致（**7/7 断言 PASS** · 收尾后容器内同形进程 `0`）。原始输出落 `probes/cross-user-probe/out/`（**不入库**）。

**未做（等确认才动）**：`3.7` 的产品代码（把三类判据挂到门禁）**一行未改**；代码排布见计划文件。

### `3.7`「mcp:跨用户隔离」交付：判据落到门户链路，并修掉「门禁永不红」的缺陷

**交付了什么**（用户拍板 G-a ①：**扩展既有 `make portal-mcp-session-probe`**，不新增目标）：

- **四条判据**（[`../admin_portal/tests/fixtures/session-probe-runner.mts`](../admin_portal/tests/fixtures/session-probe-runner.mts)）：`TC-M-L1-23·1` **经同一门户实例双向互不可见** · `·2` **灵敏度对照（必须为正向：两侧各自能召回自己写的）** · `·3` **按 id 直取不可见**（工具名从 `listTools()` 取，实测上游回 `memory not found`）· `·4` **两侧审计行各记自己的解析后库路径且互不相同**（`AC4.3` 的机制由 `3.4` 交付，本行判它在**跨用户**场景下成立）。会话标记提升为**可复用变量**（**不重复写**，避免库内多条让判据漂移）。
- **断言数 11 → 15 全 PASS、退出码 `0`**（改前基线 **11/11**；既有 11 条**零回归**；`make portal-mcp-probe` **6/6** 零回归）。
- **判据敏感性已证明（不是空转）**：临时把 B 的令牌换成 A 的（模拟「令牌 → handle → 库路径」**串号**这一失效形态）⇒ 新增四条**全部转红**（`23·1` 抓到 B←A 含标记 · `23·4` 显示 B 的审计行缺失），还原后转绿。

**顺带修一处门禁缺陷（本行的必修项）**：四个真上游脚本（`3.1` / `3.3` / `3.12` / `3.15` 的）的 `cleanup()` 把 `local rc=$?` 放在

```bash
  if [ "${BASH_SUBSHELL:-0}" -ne 0 ]; then return 0; fi
  local rc=$?
```

**之后** —— 而 `if` 的条件为假时其**自身**退出码就是 `0`，于是 `$?` 早被覆盖 ⇒ `rc` **恒为 `0`** ⇒ 文档承诺的 `10`（前置不足）/ `20`（门户起不来）/ `30`（断言失败）**一个都传不出来**。**后果**：门禁在 CI 里**永不红** —— 而 `3.7` 这一行的全部价值就是「把判据挂进门禁」，不修等于没挂。**修法**：把捕获提到**函数第一行**；**验证**：合成对照钉死（旧写法 ⇒ `0` · 新写法 ⇒ `10`），四个脚本在「容器名不存在」下实测均返回 `10`，经 `make` 返回 `2`（非零）。

**验证**：`make portal-mcp-session-probe` **15/15 PASS · 退出码 `0`** · `make portal-mcp-probe` **6/6 · 退出码 `0`** · `3.15` 探针 **7/7** · 离线 **334 passed / 31 files** · 覆盖率 **93.47 / 86.84 / 97.72 / 94.64** · `make doc-links` / `make attestation-paths` 通过 · `npx tsc --noEmit` 0 错。

**风险口径已回写**：[`sprint-backlog.md`](sprint-backlog.md) 的 `R1` / `R2` 两行各补本次取证结论，**状态仍 `Open`** —— 生产复验（`V1` 负向判据）随 Sprint 5 上线验收；`R2`「纵深不足」这一结论**不因本行消失**（上游仍无多租户授权边界）。

### `4.4` 开工准备：`3.16` 探针把「指南可照做」变成可机械判定的东西

**为什么**：`4.4` 的验收条件是「三段指南齐备（CF Access / SSH 密钥对与 forced command / 对象存储私有桶与子账号）+ **每步验证点** + **可照做**」。文档不能被执行 ⇒ 「可照做」极易写成**无法证伪**的一句话。但对**配置类**指南，「照做会得到什么」里有三块是机械可判的：**键**（指南要求填的 vs 代码真正会读的）、**引用路径**（存不存在）、**文档自己的承诺**（`deployment.md` §5.4 自称与 `../deploy/.env.prod.example`「逐键一致」）。

**做了什么**（**只做开工准备，文档与代码一行未动**）：新增探针 [`../probes/deploy-guide-audit/`](../probes/deploy-guide-audit/)（`3.16`，研究类，**纯静态、零依赖、确定性**）。首跑：**3 项过、1 项红**（退出码 `30`，那条红是**刻意**的）。

- `A1` 三侧都抽到键 ✅（代码侧 **21** 个 `PORTAL_*` · 部署侧 **5** · 文档侧 **16**）。
- **`A2` 红**：门户真正会读的 **21** 个 `PORTAL_*`，`compose` / `*.env.example` / 指南**三处都没登记**。
- `A3` ✅ 指南引用的 **45** 个仓库路径**全部可达**。
- `A4` ✅ `deployment.md` §5.4 与 `deploy/.env.prod.example` **逐键一致**（`DASHSCOPE_API_KEY` · `IMAGE_TAG`）。

**决定性发现（`A2` 红的根因）**：① `deploy/docker-compose.prod.yml` **只有上游两个服务**（`ai-memory` / `curator`），**门户 stack 没有 compose**（按 §12.2 是「在服务器上新写」）；② 门户 stack 的 env 真源 `deploy/portal.env.example` **只有 1 个键**；③ 那 21 个键的**唯一登记处是设计文档** `web-portal/web-design.md` §12.9 ⇒ **不在部署真源、也不在指南**，读者照 §12.2 做**无从知道门户 stack 要填哪些键**（好在 `4.3` 的启动自检 fail-closed ⇒ 会**响亮失败**而不是静默错配）。这正是 `4.4`「可照做」缺的那一块。

**一处自我校正（如实登记）**：探针**首版自己有两个 bug** —— 抽 compose 的键时只认 `KEY:` 映射形态（漏了 `- KEY=value` 与 `${KEY}`）⇒ 把 21 个键**误报**成遗漏；比对引用路径时丢了 `../` ⇒ 45 个引用**误报**缺失。两处都已修，并写下「**探针也要先跑一遍应当通过的对照项**」这条教训（与 `3.6` 的 `count` 陷阱同族：**判据的假阳性会把结论带错方向**）。

**验证**：`node memory.agent-mate.ai/probes/deploy-guide-audit/probe.mjs` → **退出码 `30`**（`A2` 红是 `4.4` 交付前应有状态），`A1` / `A3` / `A4` 全绿；原始输出落 `probes/deploy-guide-audit/out/`（**不入库**）。另核对：`deploy/.env` / `.env.local` / `portal.env` **均已 gitignore 且未被跟踪**（只有 `*.example` 入库）⇒ 无密钥入库风险。

**未做（等确认才动）**：`4.4` 的三段指南与 `portal.env.example` 的键清单（`A2` 的转绿项）**一行未改**；排布见计划文件。

### `4.4`「deploy:上线配置指南」交付：三段逐步指南 + 门户 stack 真源入仓

**交付了什么**（用户拍板：H-a **固化探针为门禁** · H-b **门户 compose 入仓**）：

- **三段逐步指南**（[`deployment.md`](deployment.md) §12.5，每步「**做什么 → 期望 → 验证 → 不符怎么办**」四件套，示例一律占位符）：
  - **§12.5.1 Cloudflare Access**（8 步）：建 self-hosted 应用 → Allow 策略（**≥2 个邮箱**，`AC10.6`）→ Google + 邮箱 OTP 双钥匙 → 会话时长（**控制台最大档；目标 3 个月须 API/Terraform 实测，不得把目标写成既有能力**，`AC10.7`）→ **`<MCP_HOST>` 必须 Bypass**（否则客户端「连不上」）→ 增删即失效（`AC10.10`）→ **根凭证离线保存** → 门户侧零控件（`AC10.9`）。验证点：未认证 **302** · 非名单仍被拦 · 收口 `make portal-e2e ARGS=--online` 退出码 `0`（**`40` 不算通过**）。
  - **§12.5.2 SSH 密钥对与 forced command**（7 步）：`ssh-keygen -t ed25519` → 公钥**带外**传递 → `authorized_keys` **逐行追加**（不要整文件重写）→ 每用户行**显式** `--profile core` / 管理员入口 `--profile admin` → 调用者 `~/.ssh/config` → 首连 → **交互 shell 不可用**（`no-pty` 等）。验证点：`ssh -G ai-memory` · `ssh ai-memory` 能连 · `ssh ai-memory bash -i` **拿不到 shell**。
  - **§12.5.3 对象存储私有桶与 RAM 子账号**（5 步）：建桶（**私有 + SSE**）→ RAM 子账号**最小权限**（桶级 `PutObject`/`GetObject`/`ListObjects`）→ **AK 只落服务器侧**（`chmod 600`，`make secret-check` 守护）→ 每日同步 + `sha256sum` 校验 → **回读比对**。
  - **§12.5.4 门户 env 真源表**：把 21 个 `PORTAL_*` 按 **8 组**列出（运行环境 / 面隔离 / 存储 / 会话 / 身份 / 日志 i18n / **生产不得设置** / **仅开发期**），并写明真源 = `portal.compose.yml` + `portal.env`（只放密钥）。
  - **§12.5.5 收口验证 5 项**：compose `config` · **启动自检全过**（`/data/users` 可写 · embeddings 1024 维 · 二进制版本 == `upstream.lock`）· `make deploy-doc-audit` · 在线套件 · `make secret-check`。
- **门户 stack 真源入仓（H-b）**：新增 [`../deploy/portal.compose.yml`](../deploy/portal.compose.yml) —— **21 个 `PORTAL_*` 键的真源** + 共享卷 `ai_memory_data`（external，与主 stack 唯一耦合点）+ 独立卷 `portal_data` + 生产**不得设置**的测试通道键（留注释说明「写了就是事故」）；`portal.env.example` 写明「**只放密钥**」的分工；`deploy/README.md` 登记该事实文件。**镜像名不入仓**（是构建产物坐标：按 `web-design.md` §3.2 构建，由 `PORTAL_IMAGE` 给出）。

**`A2` 由红转绿**：`make deploy-doc-audit` **5/5 PASS · 退出码 `0`**（首跑为 `3 PASS / 1 FAIL`）—— 这就是「**先红后绿**」的完成态。另新增 `A5`（compose **结构底线**）并把扫描面由「硬编码一个 compose」改为 **`deploy/*.yml` 全部**。

**一处如实登记的边界**：本机**装不了也跑不了** `docker compose config`（无 compose 插件；`node_modules` 里无 `yaml`/`js-yaml`；PyYAML 也没有）⇒ **新 compose 的真解析只能在服务器侧做**（§12.5.5 第 1 步）；本机只做了结构底线（`A5`）与键/路径/承诺三类一致性地检。

**验证**：`make deploy-doc-audit` **5/5 · 退出码 `0`** · `make doc-links` **53 文件 / 1482 链接零悬空** · `make attestation-paths` 通过 · `make secret-check` 通过 · 离线 **334 passed / 31 files**（本行不改代码）· `deployment.md` §14 变更记录已追加。

### `4.1` 开工准备：`3.17` 探针测出会话限流的「现状」与「取值依据」

**为什么**：`4.1` 的验收条件是「**超每 key 并发 / 全局并发 / 空闲超时 / 单会话最长时长任一上限时给出明确原因** · **不排队致死** · **额度内不受影响**」（`AC7.3` / `TC-P-L3-06`）。它有两块实质：**补护栏**（从无到有）与**给取值**（有依据）。**取值没有依据就是拍脑袋**；而「不排队致死」这条判据，**不先测出基线延迟就写不出来**（「立即拒绝」的「立即」需要一个实测参照）。静态覆盖核对先钉住现状：

| 键 | 在 `admin_portal/src` 里 | 结论 |
|---|---|---|
| `PORTAL_MAX_CONCURRENCY_PER_KEY` / `_GLOBAL` | **0 处** | **未实现**（而 `web-design.md` §12.9 登记为「必填」⇒ **登记与实现不一致**，要一并收口） |
| `PORTAL_RESPONSE_MAX_BYTES`（背压） | **0 处** | **未实现** |
| `PORTAL_SESSION_IDLE_TIMEOUT` / `_MAX_DURATION` | 已读（`3.4` 交付） | **机制已交付**，**取值**归本行 |

**做了什么**（**只做开工准备，产品代码一行未动**）：新增探针 [`../probes/session-limit-probe/`](../probes/session-limit-probe/)（`3.17`，研究类，**不经门户**：直接起 stdio 会话，测「上游每个会话进程的开销」）。**8/8 断言 PASS、退出码 `0`、两轮复跑一致**：

- **现状无任何上限（决定性）**：并发 **1 / 2 / 4** 路 ⇒ 容器内新增**同样多**的会话进程且**全部成功、无拒绝**；**第 5 路同样成功** ⇒ `4.1` 的护栏是**从无到有**，不是「调参」。
- **取值依据（实测）**：每会话 **~27 MiB**（RSS，1 路 29 · 2 路 27×2 · 4 路 27×4）；并发墙钟 **535 / 555 / 753 ms**（每会话 store + recall 各一次，真 embedding）。
- **另一项决定性事实**：容器**内存上限未设置**（`docker inspect` 的 `HostConfig.Memory = 0`）⇒ **没有任何容器级护栏**，门户侧并发上限是**唯一**约束 ⇒ 取值要按**服务器可用内存**倒推。
- **判据形状（本轮最重要的导出）**：「**不排队致死**」必须**同断三件事** —— **HTTP 码 + 响应时间 + 不新增子进程**（只断状态码会漏掉「其实排了队」，而「排队」正是该条验收条件要防的）；「**额度内不受影响**」可写成「额度内并发下延迟 ≤ 基线 × 常数」。

**验证**：`cd memory.agent-mate.ai/probes/session-limit-probe && npm install && node probe.mjs` → **退出码 `0`**，两轮复跑一致（**8/8 断言 PASS** · 收尾后容器内同形进程 `0`）。原始输出落 `probes/session-limit-probe/out/`（**不入库**）。

**未做（等确认才动）**：`4.1` 的实现（两个并发上限 + 背压 + 拒绝形状 + 取值登记）**一行未改**；排布与一处待拍板（**拒绝码**是否复用 `429`）见计划文件。

### `4.1`「web-portal:会话限流」交付：门户自建的并发护栏 + 取值定档

**交付了什么**（用户拍板 J-a：**复用 `429` + 门户侧独立 `error` 串**）：

- **两个并发上限**（每 key / 全局），**先判后起**：超限回 **`429` + `SESSION_LIMIT_EXCEEDED` + `scope`（`per_key` / `global`）/ `limit` / `current`**，且**在建会话之前**拒绝 ⇒ 验收条件里的「**不新增子进程**」由机制天然成立（不需要额外断言进程数）。
- **判定与计数都不维护第二套状态**：判定是 [`limits.ts`](../admin_portal/src/bridge/limits.ts) 的**纯函数**（多分支不进装配层 —— `route.ts` 的覆盖率余量极薄），计数由 `SessionRegistry` **现算**（`countAll` / `countByKey`）⇒ 「某条回收路径忘了减一」这个失败面**从设计上消失**；`session.ts` 与 `limits.ts` 的覆盖率实测 **100%**。
- **取值定档**（依据 = `3.17` 探针：每会话 ~27 MiB · 4 路并发每会话仍 ~0.75 s · 容器无内存上限）：空闲超时 **15 min** · 最长时长 **24 h** · 每 key **2** · 全局 **4**；生产取值落 [`../deploy/portal.compose.yml`](../deploy/portal.compose.yml)（`4.4` 已建的真源）；**未提供即不启用该项**（不写死默认值）。

**实现中发现并修掉的一个缺陷（值得单独记）**：条目只在三种时机被摘（`reap` / 该会话**自己的**下一次请求 / 登记失败）⇒ 客户端 `DELETE` 之后条目仍算「在册」，对并发上限而言就是**容量泄漏**：用户会被**自己的旧会话**挡住，直到空闲回收才放行。修法：新增 `SessionRegistry.pruneClosed()`，并在**建会话前**做一次**懒清理**（确定性、幂等、仍只经 `close()`）。**这个缺陷是被集成用例 ④「关掉一个会话后额度**立刻**释放」抓出来的** —— 若把用例写成「等 reap 后释放」，它会被测试**掩护过去**。

**一处如实降级登记**：`PORTAL_RESPONSE_MAX_BYTES`（单响应背压）**本轮未实现** —— 它不在 `4.1` 的四条上限（每 key / 全局 / 空闲超时 / 最长时长）之内，且要动转发热路径、而 `route.ts` 的覆盖率余量极薄 ⇒ `web-design.md` §12.9 里它的「必填」改为**「否（未实现）」并归 Sprint 6 容量行**，不假装它可用。

**契约同步**：`web-design.md` §12.5 失败映射表**新增一行**（门户自建限流与上游配额**同码不同串**，客户端不必靠状态码猜来源）· §12.7 表按实现回写（键名 + 超限行为）· §12.9 四行状态对齐 · `web-test.md` 的 `TC-P-L3-06` 落点回填实测证据。

**验证**：离线 **348 passed / 33 files**（新增单测 8 条 + 集成 4 条：拒绝 + 不新增 spawn + 额度内可用 + 计数释放）· 覆盖率 **93.7 / 87.15 / 97.77 / 94.84**（阈值 92/85/96/93）· `make portal-mcp-session-probe` **15/15** · `make portal-mcp-probe` **6/6**（零回归）· `make doc-links` / `make attestation-paths` 通过。

**一处如实登记的偶发**：`mcp-bridge-session-reclaim` 的 `afterAll` 曾出现一次 `ENOTEMPTY`（夹具子进程仍在写 `--env-dump` 文件时删临时目录）—— 复跑即过，属**该用例 teardown 的既有竞态**，与本行改动无关（本行不改它的任何判据）。

### 删除 `sdd-scrum-practices.md`（过程体例文档移出本项目范围）

**为什么**：用户指示（2026-09-24）—— 该文档已从本项目范围移除，不再由本仓维护。

**做了什么**：

- **删除** `specs/sdd-scrum-practices.md`（194 行）。
- **去链接（36 处、4 种形态）**：历史叙述**保留原文、只断开链接** —— `change-log` 的 2026-09-21/22 节 · `ADR-013` / `ADR-016` 的决议正文 · `architecture.md` 与 `sprint-backlog.md` 的变更记录 · `web-design.md` 的变更记录。按 `ADR-013` 自身口径（「ADR 按新增决议 supersede，**不回写旧 ADR 正文**」）不改写 ADR 正文。
- **现行指称改写**（只去链接不够 —— 否则正文指向不存在的文档）：`product-backlog.md` 与 `sprint-backlog.md` 头部的「体例」指针行移除 · `architecture.md` §7「相关」表移除该行 · `sprint-backlog.md` 的批次口径（Increment）与 SBI 口径行的判据落点**改指 `ADR-016`**（其决议正文已重述 PSP 四条判据）。状态枚举（`ToDo` / `WIP` / `Implemented` / `Done`）由 `ADR-013` 决议正文承载，不随文档消失。

**验证**：`make doc-links` **53 文件 / 1456 链接 / 零悬空** · `make attestation-paths` 通过 · `make secret-check` 通过 · `make preflight-test` **5 / 0** · 指向该文档的链接残留 **0 处**（`grep -rnoE ']\([^)]*sdd-scrum-practices[^)]*\)'` 为空）。

**边界**：`.codebuddy/plans/` 下的历史计划快照仍含该文档名 —— `link-check.sh:59` 的 `EXCLUDE_DIRS` 已排除 `.codebuddy`，属过程资产、不参与门禁，未改动。

### `4.5`「web-portal:响应背压上限」交付：把 §12.5 的背压承诺补齐（先探针定档，再实现）

**为什么**：`web-design.md` §12.5 的背压承诺有两半 —— ① 「stdio 管道与 HTTP 流按 stream 处理、不整包缓冲」；② 「对超大响应设**门户级上限**并**明确报错**」。`4.1` 只落了①，②以「**如实降级：本轮未实现 ⇒ 归 Sprint 6 容量行**」登记。而「门户无上限」是否构成**真实敞口**，取决于**上游能产出多大的响应** —— 全仓没有这个数字，故先做探针。

**做了什么**：

- **`3.18` 探针定档取值**（[`../probes/response-size-probe/`](../probes/response-size-probe/)，**7/7 断言 PASS · 退出码 0 · 两轮复跑一致**）：**上游对 stdio 单条响应没有任何体量上限**（4 / 16 / 32 KiB ⇒ 回包 5.0 / 17.0 / 33.1 KiB **完整含标记**）；**单条内容上限 = 65536 字节**（边界轮 64 / 128 KiB ⇒ `content exceeds max size of 65536 bytes`）；索引类回包是**紧凑索引行**（约 115 字节/条，**不含正文**）；上游对**语义近重复**内容拒写（`CONFLICT: near-duplicates`）；`memory_smart_load` 的「多条 × 正文」体量**未测**（如实登记）。
- **实现**（新模块 `src/bridge/response-cap.ts` + `route.ts` 接线）：边转发边计字节，超限即**停止转发**；头**未**发出 ⇒ `502` + **新错误码 `RESPONSE_TOO_LARGE`**；头**已**发出（SSE 中途）⇒ **截断**流；两种路径**都写审计**（`action='mcp_response_capped'`）。配置键 `PORTAL_RESPONSE_MAX_BYTES`（**未提供 = 不启用**，与 `4.1` 的并发上限同一口径），生产取值 `deploy/portal.compose.yml` **4 MiB**（≈3 倍余量）。
- **契约同步**：`web-design.md` §12.5（背压行回写 + 失败映射表新增一行）· §12.7 上限表新增一行 · §12.9 该键状态 **否 → 是** · `web-test.md` 新增 `TC-P-L3-10`。

**验证**：离线 **356 passed / 35 files**（新增单测 **6** 条 + 集成 **2** 条）· 覆盖率 **93.58 / 87.22 / 97.85 / 94.7**（阈值 92/85/96/93）· `make portal-mcp-probe` **6/6**（未配置上限 ⇒ 零回归）· `make portal-mcp-session-probe` **15/15** · `tsc --noEmit` 0 错 · `doc-links` / `attestation-paths` 通过。**灵敏度对照**（否定型判据必带）：未配置上限时同一条请求**完整**返回 ⇒ 「超限没有转发出去」不是环境问题。

**一处如实登记**：「多条 × 正文」的批量体量（`memory_smart_load`）**未实测** ⇒ 4 MiB 按 `k × 65 KiB` 最坏情形估算，**未**把它写成实测结论。

### `#8` 开工准备：`3.19` 探针定档「哪几条 L3 判据能提升到真上游」

**为什么**：`#8`「deploy:本地完整集成验收」的验收条件是「L2 真实客户端跑通」+「L3 本地版全绿（跨用户隔离 / 面隔离双向拒绝 / 吊销即时生效 / 并发与配额生效 / 单响应背压生效）」，它的性质是**收口 + 上线准入**。覆盖核对发现：L2 与「跨用户隔离」**已有真上游门禁**（`make portal-mcp-probe` / `make portal-mcp-session-probe`），而**其余四条只有离线（假上游）判据** —— 能不能提升到真上游、判据怎么写，全仓没有实测。

**做了什么**（**只做开工准备，产品代码一行未动**）：

- **新增探针 [`../probes/local-acceptance-probe/`](../probes/local-acceptance-probe/)（`3.19`，研究类）**：骨架由 `3.3` 的会话探针**派生**（差别只有端口 / 用户名 / 断言体路径 / 两条护栏 env），**一次门户起停跑四个场景** —— **9/9 断言 PASS · 退出码 0 · 两轮一致**。
- **决定性结论：四条全部可在真上游上判** —— ① **面隔离**：本机两个「面」只是两个 `Host`（`PORTAL_ADMIN_HOST` / `PORTAL_MCP_HOST`）⇒ 构造 Host 头即判，信号是 **`403` + `Forbidden: request host does not match this face.`**；② **并发上限**：同令牌第二路 ⇒ `429` + `SESSION_LIMIT_EXCEEDED` 且**不新增子进程**；③ **吊销即时生效**：机制是 `route.ts:248` 的**请求驱动惰性回收**（吊销本身不杀进程 ⇒ 下一次带「该会话自己的 `sessionId`」的请求才回收）⇒ `401` + 子进程消失，**确定性可判**；④ **背压**：40 KiB 内容 ⇒ 大 `memory_get` 不把完整内容送回（客户端 0 字节）+ 门户库留 `mcp_response_capped`。
- **顺手补一处契约缺口**：门户 `src/server.ts:75` 的 `bodyLimit: 64 * 1024`（**代码常量、不可配**）此前**未在契约登记** —— 它是背压上限的**入站对偶**（入 64 KiB / 出 4 MiB）⇒ 已补进 `web-design.md` §12.7，并写清「判据的输入量必须落在入站与出站两个上限之间」（首版用 ~86 KiB 的 `memory_store` 直接被 `413 FST_ERR_CTP_BODY_TOO_LARGE` 拦下）。
- **三条工程教训（写进探针 README）**：`keyPrefix` 只能从库里取（`issueKey()` 不返回它，首版据此直接调 `revokeKey` ⇒ `key-not-found` 假失败）· 判据输入量要落在两个上限之间 · 派生脚本的固定文案要当代码改（`3.15` 同款）。

**验证**：`bash memory.agent-mate.ai/probes/local-acceptance-probe/probe.sh` **退出码 `0`**，两轮复跑一致（**9/9 断言 PASS** · 收尾后容器内同形进程数 `0`）。原始输出落 `probes/local-acceptance-probe/out/`（**不入库**）。

**未做（等确认才动）**：`#8` 的产品代码（收口入口 `make portal-acceptance` + 四条真上游判据的固化）**一行未改**；代码排布见计划文件 `.codebuddy/plans/sprint4-8-local-acceptance.md`。

### `#8`「deploy:本地完整集成验收」交付：一条命令给出本地验收结论表

**交付了什么**：`#8` 是「本 Sprint 全部产物的**收口判据** + Sprint 5 上线的**准入条件**」。覆盖核对显示：L2 真链路与 L3 跨用户隔离**已有真上游门禁**，其余四条（面隔离 / 吊销即时生效 / 并发上限 / 单响应背压）**只有离线判据** ⇒ 本行把四条提升到「经门户的真上游」，并给出**一条命令的收口入口**。

- **新增收口入口 `make portal-acceptance`**（`scripts/portal-acceptance.sh`）：**相 1** 串既有四关（离线全绿 / 覆盖率 / `portal-mcp-probe` / `portal-mcp-session-probe`，**不重造**）；**相 2** 带两条护栏 env（每 key 并发 1 / 背压 32 KiB）跑四条真上游判据；结尾打印**逐条结论表**与**边界项**；任一段失败即以非零码退出并把全量日志落 `/tmp/portal-acceptance-*.log`，同时给出**分段重跑**命令（`ACC_PHASE=2` 可只跑相 2）。
- **新增断言体** `admin_portal/tests/fixtures/acceptance-runner.mts`：由 `3.19` 探针**去探针化**（判据形状一字未改，9 条断言挂到 `TC-P-L3-03` / `TC-P-L3-04` / `TC-P-L3-06` / `TC-P-L3-10`）。
- **清掉三类门禁偶发**（收口入口首跑就暴露 —— 验收门禁不能自己偶发）：① `mcp-bridge-session-isolation` ③ 读到空 `childPid`：夹具 `--closed-marker` 原用 `writeFileSync`（先建文件后写内容，读者可能看到「已存在但为空」）⇒ 改**原子写**（临时文件 + `rename`），测试侧 5 处「先等存在再读」因此都不用改；② `mcp-bridge-session-reclaim` 的 `afterAll` `ENOTEMPTY`（仓内已登记）⇒ `rmSync` 加 `maxRetries` / `retryDelay`；③ `TC-M-L1-19`（超时分层）的时间常数按**同一语义放大**（握手 300 ⇒ 1000ms、每请求 5000 ⇒ 8000ms；反向用例 5000 ⇒ 8000ms、300 ⇒ 800ms）——35 个 vitest worker 并行时 300ms 握手会被打穿（实测失败详情 `upstream_unavailable`）。
- **背压判据加「有界等待」**：响应被门户截断后，SDK 侧可能在等一条**永不结束**的流（实测：无界等待会让该判据挂住、整条收口入口卡死）⇒ 给大 `memory_get` 包 12s 上限，**抛错 / 超时 / 内容不全**三种表现**都算**「没有把完整内容送回」。

**验证**：`make portal-acceptance` **退出码 `0`** · 结论表 **L2 + 五条 L3 全绿**（`TC-OFFLINE` / `TC-COVERAGE` / `TC-L2` / `TC-L3-ISO` / `TC-L3-ACC`）· 相 2 **9/9 断言 PASS** · **敏感性证明**：把背压判据（`TC-P-L3-10·2`）临时反向 ⇒ 该条**转红**、结论表 `FAIL TC-L3-ACC`、退 `30`，还原后转绿 · 零回归：离线 **356 passed / 35 files** · 覆盖率 **93.58 / 87.22 / 97.85 / 94.7**（阈值 92/85/96/93）· `portal-mcp-probe` **6/6** · `portal-mcp-session-probe` **15/15** · `3.19` 探针 **9/9**（加固后复跑）· `tsc --noEmit` 0 错 · `doc-links` / `attestation-paths` 通过 · 收尾后容器内同形进程数 `0`。

**边界如实登记（不属本行）**：真实域名下的面隔离（CF Access / 隧道）归 Sprint 5 上线验收 · **经门户的配额透传**归 Sprint 5 `#2`「mcp:配额透传」· 「多条 × 正文」的批量体量仍未测（`3.18` 登记）。

**一条操作纪律（本轮实测）**：收口入口与其它门禁**不要并发跑** —— 一次「覆盖率与探针同时跑」的尝试里，`session-reclaim` ② 因负载吃满 60s 超时（单独复跑即绿）。

---

## 2026-09-23

### `3.8`「mcp:桥的透传完整性与失败诊断」交付：桥开始「按契约可用」

**为什么**：`3.1` 交付后 code review 发现桥「能跑通」但**不按契约可用** —— 它自称「原样转发、门户语义知识 = 0」，却只注册 4 个方法、其余请求由桥自行合成 `Method not found`；转发阶段的失败一律被报成 `upstream_timeout`（把排障引向「上游太慢」），而且 **`catch` 是空的**（线上真出问题没有任何线索）。本批把这三处补齐。

**做了什么**：

- **整行转发**（`transport.ts`）：以**赋值式**装两个 fallback（`fallbackRequestHandler` / `fallbackNotificationHandler`），并**显式注册** `cancelled` —— 依据是 `3.10` 探针的两条硬约束：构造参数形式**静默失效**、`cancelled` / `progress` **在每一跳都被 SDK 内置消费**。宽松 schema `z.unknown()` 让结果的形状由上游决定（桥不替它校验）。
- **上游 client 补能力声明**（`spawn.ts`）：`roots.listChanged` —— 否则转发 `notifications/roots/list_changed` 会被 `assertNotificationCapability` 拦下、错误再被 `onerror` **静默吞掉**（探针第五条结论在实现里的直接落地）。
- **失败可诊断**（`route.ts`）：新增 `upstream_error`（**502**）与导出纯函数 `classifyRelayFailure`（按 SDK `ErrorCode` 三分类）；`relay` 的 `catch` 由「一律 504」改为**分类 + 回调**；审计出口泛化为 `auditFailure`，新增动作 `mcp_upstream_error`（与「会话被拒」**分开** —— 两类故障混在一起排障时无从下手）并补一行 `request.log`；文案表刻意用**收窄类型**写成完整映射，避免「不会发生但必须写」的未覆盖分支。
- **回收对齐**（`spawn.ts`）：握手失败分支补 `client.close()`，与成功路径的回收顺序一致（此前只关 transport，留下 client 侧状态）。
- **测试（同批）**：新增单测（三分类 + 畸形输入）· 集成 4 条（`TC-M-L1-15`×2 / `16` / `17`）· **注入假传输**的失败面 4 条；夹具补三个观测点（未注册请求 / 上游自定义 `-32601` / 通知留痕）并**显式注册** `cancelled` 的 recorder。

**验证**：离线 **309 项**全绿 · 覆盖率 **92.88 / 85.75 / 96.78 / 94.17**（阈值 92/85/96/93 —— **比改前更高**，新增测试顺带覆盖了既有缺口）· `make portal-mcp-probe`（真上游）退出码 **0** · `make doc-links` 零悬空。

**一处值得记下的过程**：要测「转发阶段抛错」，外部手段**全都撞墙** —— SDK 把非 `initialize` 请求、无 `method` 的响应消息等都优雅处理掉了（后者回 **202** 而非抛错）。最终靠**可注入的模块边界**（`vi.mock` 掉 `createBridgeTransport`，换成按指令抛错的假传输）确定地覆盖了两条分支。⇒ 失败路径的可测性来自**接缝**，而不是把断言写松。

**边界**：`3.9`（能力透传与超时分层）不在本批 —— `3.1` 因此**仍为 `WIP`**（其第三条 AC 要求 `3.8` 与 `3.9` 都交付）。

---

### `3.8` 技术准备：`3.10` 探针定档「fallback 的正确写法」与「转发失败怎么分类」

**为什么**：`3.8` 的两条判据（「未注册的请求与通知原样转发」「失败按类型可诊断」）全部依赖 SDK 的**转发与错误传播形状**，而这些形状本仓从未用过 —— 照直觉写会**静默失效**。于是按 [`ADR-017`](adr/ADR-017-complexity-probe-before-real-build.md) 先交付一个只回答一个可证伪问题的探针。

**做了什么**：

- **`3.10` 探针**（[`../probes/bridge-fallback-probe/`](../probes/bridge-fallback-probe/)）：本机 `node` + **假上游观测器**（不依赖 docker），A/B 双 Server 并排对照 —— A 组专门用「构造参数」写法充当**反例**。五项断言全 PASS、退出码 `0`、两次复跑一致 ⇒ 判据为「通」，`3.8` 具备开工条件。
- **两条会决定实现写法的硬约束**（已回写 [`mcp/mcp-design.md`](mcp/mcp-design.md) §5.6.2 实证块）：
  1. **两个 fallback 必须构造后赋值实例属性**。按类型提示传构造参数（`ServerOptions = ProtocolOptions & {…}`，类型上完全合法）**静默失效** —— `Protocol` 的构造函数只把 options 存进 `_options`，从不提升为实例属性，而 `_onrequest` / `_onnotification` 读的正是实例属性 ⇒ 请求侧被合成 `Method not found`、**通知侧直接 `return`**（连错误都不报）。
  2. **`cancelled` 与 `progress` 在每一跳都被 SDK 内置消费**（`Protocol` 构造函数里就注册了这两个 handler）⇒ 它们**永远落不到 fallback**；要转发取消**必须显式 `setNotificationHandler(CancelledNotificationSchema, …)`**。
- **失败分类定档**（[`web-portal/web-design.md`](web-portal/web-design.md) §12.5）：新增 **502 `upstream_error`** 行 + 「转发阶段失败的分类定档」三层表 —— **上游业务错误由 SDK 自动透传且 `code` 原样保留**（零代码）／超时三分支／其余内部错误 502；纪律由三条扩为**四条**（新增「转发阶段异常必留日志 + 审计」，动作 `mcp_upstream_error`）。同批录下「`message` 被逐层加 `MCP error <code>: ` 前缀（本拓扑 3 层），而 `code` 不必重建」。
- **用例登记**（[`mcp/mcp-test.md`](mcp/mcp-test.md) §4-F）：新增 `TC-M-L1-15` / `TC-M-L1-16` / `TC-M-L1-17`；并修正 `TC-M-L1-14` 里与 §12.5 新口径冲突的一处（「上游超时 → 504」→「**视时点而定**」，补 502 行）。

**验证**：探针两次复跑退出码均 **`0`**（五项断言全 PASS）· `make doc-links` 零悬空 · **门户离线套件与覆盖率不受影响**（本批未改任何产品代码）。

**边界（用户口径「只做技术准备，不实现」）**：未改 `admin_portal/src/bridge/` 下任何文件，未改产品测试 —— `3.8` / `3.9` 的实现属其自身。

---

### `3.1` 自 `Done` 退回 `WIP`：code review 的缺口拆为两个增量

**为什么**：`3.1` 交付并通过真上游验收后，用 `mcp-server-patterns` 做了一轮 code review，共发现四处缺口。其中两处不是「能不能跑通」层面的问题，而是**桥的自我声明与实现不一致** —— 桥自称「把请求原样转给上游、门户语义知识 = 0」，但 `transport.ts` 只注册了 4 个方法，其余请求由**桥自己合成** `MethodNotFound`；能力与版本**硬编码**，客户端看不到真实上游。用户判定：**「能跑通」不等于「按契约可用」** ⇒ `3.1` 退回 `WIP`，缺口拆为两个增量。

**做了什么**：

- **`3.1`**：验收条件新增第三条**二值判据**（「桥的契约完整性：`3.8` 与 `3.9` 均已交付」），状态列 `Done → WIP`（[`sprint-backlog.md`](sprint-backlog.md)）。**这两个增量交付前 `3.1` 不得置 `Done`**。
- **`3.8`「mcp:桥的透传完整性与失败诊断」**（第一个增量）：整行转发 —— 用 SDK 的 `fallbackRequestHandler`（已核实存在于 `shared/protocol.d.ts`），使上游支持但桥未显式注册的方法由**上游**应答、或回**上游自己的** `-32601`；转发阶段的任何异常必留**一行日志 + 一行审计**并按异常类型区分错误码（取代现在的空 `catch {}` 一律报 `upstream_timeout`）；上游握手失败时 `client` 与 `transport` **双关**（对齐成功路径的回收顺序）。
- **`3.9`「mcp:上游能力透传与超时分层」**（第二个增量）：`initialize` 回包的 `serverInfo` / `capabilities` **取自上游**（用已核实的 `Client.getServerCapabilities()` / `getServerVersion()` 与 `Server.registerCapabilities()`）—— 客户端从此能看到 `ai-memory` 的真实版本与能力；握手超时与上游请求超时**拆为两个独立常量**（取值仍归 `4.1`，本行只分层不定值）。
- **行序**：两个增量插在 `3.1` 之后（维持「行序 = 执行顺序」），故实际执行序为 `3.5` → `3.1` → `3.8` → `3.9` → `3.2` …

**未改**：RID 落点（两者不承担 RID —— `D1` 仍在 `3.2`、`D3` 仍在 `3.3`）· 5 个稳定锚点 · `product-backlog` 的 Sprint 投影（两者属 #33 既有范围）。

**为什么值得退回重做**：这两条缺口在**本地**几乎看不出来 —— `--profile core` 恰好只有 tools，所以「只注册 4 个方法」不露馅；`portal-bridge 0.1.0` 在本地也没人质疑。但两者都在「换 profile / 上游升级 / 上线排障」时立刻变成问题，而那时排查成本远高于现在。**code review 若能早一轮做，这两条本可并入 `3.1` 一起交付** —— 这是本轮真正的教训（见 Sprint 4 回顾）。

---

### DoD 复核 `3.1`：`Done` 成立；同批修正「超时口径」等四处一致性缺口

**为什么**：`3.1` 已置 `Done` 并附证据段，但按仓内 `Done` 的定义（`sdd-scrum-practices.md` §2.2：**本条目的全部验收条件已满足**）逐条独立复核时，发现四处「实现 / 实测 ≠ 文档」的不一致 —— 它们**不改变验收结论**，但会让后来者写错断言或误判 503。

**做了什么**：

- **§12.5 的上游超时口径回写为实测三分支**（原写「请求已发出但无响应 → `504`」）。实测的决定因素是**响应头是否已发出**：握手期挂起 → **503**；转发期上游慢（SSE 头已发）→ **MCP 层错误**且须显式 `end()`（否则调用方挂到上游最终响应）；转发阶段同步异常 → **504**（唯一可写时点）。⇒ 明确「**`504` 的适用范围不是『任何上游超时』**」。这条结论此前只回写在 [`mcp/mcp-design.md`](mcp/mcp-design.md) §5.6.2 的实证块，**没有**回写到门户侧真源，故补上。
- **`selfcheck.ts` 三项 `deferred` 的理由已成假陈述**：原写「随 `PSP-W2` 启用（本批不 `spawn` 上游子进程）」，而 `3.1` 就是该批次的落地且**已经 `spawn`** ⇒ 理由改指 `4.3`；`selfcheck.test.ts` 的断言原本按 `PSP-W2` 字样校验，同批改指（否则测试会挡下这次修正 —— 门禁在此起了正确的作用）。
- **[`web-portal/web-test.md`](web-portal/web-test.md) §2 补登接入批次的自动化落点与手工验收前提**：`TC-P-L1-03` / `TC-P-L2-01` / `TC-P-L2-02` → 集成 13 条；模板门控 17 条；桥模块 6 条；真上游 → `make portal-mcp-probe`。另登记**本机手工验收的三处前提**（缺任一即 `503`，**不是**桥的缺陷）：未设 `PORTAL_LAUNCH_OVERRIDE` · MCP 面非**回环 Host**（真实客户端改不了 `Host` 头）· 容器内未预建用户库目录（上游**不创建**库文件的父目录）。
- **[`sprint-backlog.md`](sprint-backlog.md) 的 `3.1` 说明列压为结论级摘要 + 证据指针**（§2.1 要求「说明只写摘要与指针，不堆放命令输出」），覆盖率数字更正为实测值，并补边界「**`500` / `429` 未实现** ⇒ `TC-M-L1-14` 全绿要等 `3.2` 与配额行」。

**验证**：逐条独立复跑 —— `make portal-test` **297 passed** / 26 files · `make portal-coverage` **92.08 / 85.25 / 96.69 / 93.31**（阈值 92/85/96/93）· `make portal-mcp-probe` **退出码 0**（真上游四断言）· `make doc-links` 零悬空 · 本地 HEAD 与 `origin/main` 一致。**一处数字更正**：覆盖率分支原记 **85.4**，本轮实测 **85.25**（阈值 85，仍在线上）。

---

### `3.1`「mcp:会话桥」交付：接入面第一次真正可用

**为什么**：在此之前的 `/mcp` 只是一个 `404 not_implemented` 占位 —— 用户拿得到 `memo_` 令牌，却没有任何地方能用它。本批让「持令牌的 MCP 客户端经 `/mcp` 建立会话、完成一次写入与召回」这条链路真正跑通，是**首个对外可用**的增量。

**做了什么**：

- **新增 `admin_portal/src/bridge/`**（五文件）：`launch-template`（内建模板常量，逐字对照契约真源）· `spawn`（占位符替换 + **最小 env 白名单**；fail-closed 路径断言**只预留位置**，归 `3.2`）· `transport`（官方 SDK 的 Streamable HTTP ⇄ stdio **直连转发**，不手写帧解析）· `session`（会话注册表与关闭顺序）· `route`（接管 `/mcp`：统一 **401** 且理由不外泄 · 会话复用要求同一令牌 · 统一失败应答）。
- **新增配置键 `PORTAL_LAUNCH_OVERRIDE`**：**仅 `development` 生效、production 出现即拒绝启动**（与自签 JWT / 开发登录入口同构）。它解决一个硬约束 —— 本机是 macOS，执行不了镜像内的 linux 二进制，只能用 `docker exec` 借壳。
- **审计**：新增 `mcp_session_rejected` 动作（失败面纪律 3 的落地）；「会话开始」的审计行仍归审计视图批次（`D4`）。
- **既有一处改为按行为变更同步**：`public-routes.test.ts` 断言 `/mcp` 返回 `not_implemented` ⇒ 改为 `401 unauthorized`。

**验证**：

- 离线 **297 项**测试全绿（新增：模板与门控单测 17 · `/mcp` 端到端集成 13 · 桥模块单测）。集成测试用**假上游**夹具（`tests/fixtures/fake-upstream.mjs`）⇒ **不依赖 docker、874ms 跑完**，覆盖「写入召回 / 身份与库路径注入 / 五类拒绝路径 / 多令牌使用时间独立 / 会话回收 / 上游不可用 503 + 审计 / 握手超时兜底」。
- 覆盖率 **92.08 / 85.4 / 96.69 / 93.31**（阈值 92/85/96/93）达标。**如实说明**：新代码一度把语句覆盖率压到 **90.81**（低于阈值），是同批补测才回到线内 —— 这条与上一轮「边距仅 0.78pt」的预警完全对应。
- `make portal-mcp-probe`（**真上游**，经 `docker exec` 借壳跑容器里的 ai-memory 0.10.0）：**四断言全 PASS、退出码 0** —— `core` 档 8 工具 · `memory_store` 回包 `agent_id=human:probe31` · `memory_recall` 命中 · 库落 `/data/users/probe31/ai-memory.db`。

**实现期实测到的六条硬约束**（已回写 `mcp-design.md` §5.6.2 实证块，它们是「不做就会踩」的）：

1. **响应是 SSE 流、响应头先于上游结果发出** ⇒ 上游超时**无法用 `504` 表达**，必须加在**上游请求**上并以 MCP 层错误返回；只有握手阶段还能用状态码（503）。
2. `StreamableHTTPServerTransport.handleRequest` 对 `initialize` **立即返回** ⇒ 在 HTTP 层用 `Promise.race` 包超时**完全无效**。
3. 客户端 `transport.close()` **不发任何通知** ⇒ 要终止会话须用 `terminateSession()`（`DELETE`）。
4. **`docker exec` 不转发宿主 env** ⇒ 借壳时模板注入的四项 env 全丢：`memory_store` 照样成功，但数据落到**共享主库**、身份退回上游默认值 —— 即**隔离静默失效**。这条直接写进了 §12.9 该键行的语义边界。
5. SDK `1.30.0` 的 `onclose` / `sessionId` 类型与 `exactOptionalPropertyTypes` 不兼容 ⇒ 两处收窄断言并留注。
6. 请求缺 `Accept: application/json, text/event-stream` ⇒ **406**（协议层门禁，非业务分支）。

---

## 2026-09-23

### `3.1` 开工前置：失败面口径、使用时间粒度、模板载体三处定档

**为什么**：review `Sprint 4 3.1「mcp:会话桥」` 时发现三处规格缺口 —— 缺了它们，「写完就算过」的判定可以被**两种不同实现**同时满足，或者干脆无法验收：① `/mcp` 的**失败面没有任何状态码定义**（`MS1 AC-M1.2` 只写「被拒」、用例也只写「拒绝」）；② `last_used_at` 的**更新粒度未定**（请求级与会话级都能让 `AC3.7` 判「过」）；③ launch 模板的**载体未定**（§12.9 把它列为必填 env 键，但代码里根本不存在该键，而模板本身已在 §5.6.4 逐字定稿）。另发现 `3.1` 行的**判据引用失配**。

**做了什么**：

- **失败面口径**（[`web-portal/web-design.md`](./web-portal/web-design.md) §12.5 由一行扩为逐场景映射表）：未携带 / 无效 / 已吊销 / 用户停用 / 非 `memo_` 前缀 → **401 `unauthorized`**（「不存在」与「已吊销」同形，不给探测者区分信号）· 面不匹配 → **403 `wrong_face`** · spawn 前断言失败 → **500 `spawn_assertion_failed`** · spawn 失败 → **503 `upstream_unavailable`** · 上游超时 → **504 `upstream_timeout`** · 配额超限 → **429 `QUOTA_EXCEEDED`**（透传上游客口）· 客户端断开 → 仅回收无响应。三条统一纪律：错误体**不含**内部路径 / 堆栈 / 上游 stderr 原文；任何失败**不留**未回收子进程；两类 spawn 失败**必写审计行**。
- **使用时间粒度**（`web-design.md` §4.4）：`last_used_at` 定为**会话建立（认证成功）时更新一次**，非每请求 —— 理由是一次会话内多请求共用一个上游 stdio 子进程，「使用该令牌」的自然语义是「用它建了会话」，且避免每请求写库。
- **模板载体**（[`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.6.4 + `web-design.md` §12.9 / §12.2）：改为**内建代码常量**（`src/bridge/launch-template.ts`）、**取消 `PORTAL_LAUNCH_TEMPLATE` env 键**，由启动自检断言其与真源逐字一致（`TC-M-L0-01`）。理由：模板是「门户对上游的唯一知识」，改它等于升级适配 ⇒ 应与代码同版本控制。
- **引用失配**（`sprint-backlog.md` 的 `3.1` 行）：补引**判据真家** `MS1 AC-M1.1` / `AC-M1.2` / `AC-M1.3` 与 `MS3 AC-M3.1`、用例 `TC-M-L1-01` / `TC-M-L2-01` / `TC-M-L1-14`。原列只引门户侧 `AC3.3` / `AC3.5` / `AC3.7`，而 `AC3.3` 只断言「绕过 CF Access + 完成握手」，**会允许「只握手成功」判过**。
- **测试侧同步**：`mcp-test.md` §4-F 的 `TC-M-L1-02` / `TC-M-L3-02` 补状态码断言，**新增 `TC-M-L1-14`**（逐场景核对整张映射表），并回填 `mcp-stories.md` 的 `MS1` / `MS4` 用例列 —— 保持**引用与定义双向一致**（不产生悬空引用或孤儿用例）。

**验证**：`make doc-links` **46 个 Markdown / 1238 条相对链接 / 零悬空**（首跑抓出一处我把指向测试文档的链接多写了一级 `../../mcp/`，已修） · 原型断言 **159/159** · `3.1` 行的关联文档可解析到 `MS1` / `MS3` 与 `mcp-test.md` §4-F · `TC-M-L1-14` 在定义处（`mcp-test.md` §4-F）1 处、在索引用例列（`mcp-stories.md` 的 `MS1` / `MS4`）2 处 ⇒ **引用与定义双向一致**。

---

### 计划体例：行序即执行顺序；`3.5` 桥可行性探针 Done

**为什么**：用户口径 ——「**计划的顺序就是执行的顺序**」。此前 Sprint 的 ToDo 表用一句「执行顺序：…」描述次序，而**行的物理排列与它不一致**（例：桥探针 `3.5` 在执行顺序里是第一行，却排在 `3.4` 之后）；读者要同时读表与说明句才能还原真实次序。

**做了什么**：

- **体例定稿**：Sprint 的 ToDo 表**行的排列顺序即执行顺序**；`#` / `N.M` 是**稳定 id**，调整顺序时**只移动行、不改编号**（否则跨文档引用与锚点会失效）。落入 `sdd-scrum-practices.md` §2.1，四个 Sprint 的表前说明同批改写。
- **据此重排**：Sprint 4 把 `3.5` 探针提到最前（执行第一行）、已交付历史行收在表末；Sprint 5 把外部凭据行移到在线链路探针**之前**（探针验证的是「凭据配置已生效」）。顺带修掉 Sprint 4 表格里一处旧的**表格断裂**（`#2` 与 `#5` 之间多一个空行，导致历史行不在同一张表里）。
- **`3.5` mcp:桥可行性探针 Done**：按 [`ADR-017`](./adr/ADR-017-complexity-probe-before-real-build.md) 新建可丢弃探针 [`../probes/mcp-bridge-probe/`](../probes/mcp-bridge-probe/)（**不入制品**），回答「门户侧能否用官方 SDK 把 HTTP(Streamable) 请求经 stdio 转发给已启动的上游子进程并取回完整回包」。

**验证**：探针四项断言全 PASS —— `tools/list` **8 项**（core 档）· `memory_store` 成功 · `memory_recall` **回读到刚写入的标记** · 上游子进程 **0 → 1 → 0**；退出码 **0**，两次复跑一致。实测值：SDK `@modelcontextprotocol/sdk@1.30.0` · HTTP 层每会话一个 `sessionId` · HTTP 握手 **25–43ms** · 上游连接 **370–464ms**。结论回写 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.6.2。**探针自身修掉三处缺陷**：漏 `close()` 上游 client（首版容器内留孤儿进程）· 两版错误的进程检测判据（容器 debian-slim **没有 `ps`**；本机 Rosetta 转译致 `/proc/*/exe` 全指向转译器 ⇒ 改用 cmdline + 足量区分参数，否则会把别处遗留的同形进程一起数进来）。**顺带实测到一条上游行为**：库文件的父目录不会被自动创建（未预建即 `failed to open database`）—— 正是 `3.2` 断言要拦的形态。

---

### Replan：Sprint 目标重写为「上线产物 → 生产上线 → 运营与口径」

**为什么**：原排期把同一件事（让受邀用户真正用上）切成**三段、跨三个 Sprint** —— 桥在 Sprint 4、两端合跑在 Sprint 5、集成验收与上线在 Sprint 6，形成 **4 跳依赖链**。用户口径（2026-09-23）：**每个 Sprint 必须是一个完整闭环，尽量不让两个 Sprint 之间存在大的依赖**；并把 Sprint 4 的目标改为「全套产品最小 MVP 上线野草云4」。

**做了什么**：

- **Sprint 4** → 「交付可上线的全套产品最小 MVP（接入链路跑通 + 隔离取证）」：原 Sprint 5 的「全链路联通」「跨用户隔离」并入为 `3.6` / `3.7`，原 Sprint 6 的「本地完整集成验收」前移为 `#8`；**新增** `3.5`「mcp:桥可行性探针」（按 [`ADR-017`](./adr/ADR-017-complexity-probe-before-real-build.md)，桥是该 Sprint 唯一首次引入的跨进程协议）与 `4.4`「deploy:上线配置指南」（三段：Cloudflare Access / SSH 密钥对 / 对象存储，含每步验证点 —— 用户口径「我都有，但需要详细的指南如何配置」）。移出 12 行，并在该 Sprint 末登记「移出登记」表。
- **Sprint 5** → 「全套产品最小 MVP 上线野草云4（生产部署 · 上线验收 · 备份恢复）」：整体承接原 Sprint 6 的部署、接入面与备份内容；**新增**「门户镜像与编排制品」—— 全仓此前**不存在**门户 Dockerfile 与门户 compose（该缺口在设计包期以「假设（可推翻）」登记过，一直未产出），是重排后新识别的最关键缺口。
- **Sprint 6** → 「门户运营闭环与对外口径定稿」：承接原 Sprint 4 移出的运营、容量、界面与文档收口项，以及原 Sprint 5 的 MCP 侧收尾；其中原 Sprint 4 `4.8` 与原 Sprint 6 `#10`（同一件事的「判据面」与「实测面」）**合并为一行**。
- **Sprint 7** 不变（升级治理）。
- **同步面**：RID Registry 与覆盖对照表逐行改指（R1–R3 / D1–D6）· [`product-backlog.md`](./product-backlog.md) 的 31 条 `Sprint` 投影与 5 处关联列链接文字 · [`web-portal/web-stories.md`](./web-portal/web-stories.md) 故事索引 14 行 · [`mcp/mcp-stories.md`](./mcp/mcp-stories.md) / [`mcp/mcp-test.md`](./mcp/mcp-test.md) / [`mcp/mcp-design.md`](./mcp/mcp-design.md) 的落点列与前瞻句 · [`deployment.md`](./deployment.md) · [`architecture.md`](./architecture.md) · [`web-portal/web-design.md`](./web-portal/web-design.md) · [`web-portal/web-test.md`](./web-portal/web-test.md) · [`web-portal/portal-identity-plan.md`](./web-portal/portal-identity-plan.md) · [`web-portal/issues-log.md`](./web-portal/issues-log.md) · [`adr/ADR-009`](./adr/ADR-009-per-user-db-isolation-over-single-db-agent-id.md) · [`adr/ADR-008`](./adr/ADR-008-local-baseline-reuses-production-compose.md) · [`../scripts/probes/limits-probe.sh`](../scripts/probes/limits-probe.sh) 与 [`../scripts/maintain-user-dbs.sh`](../scripts/maintain-user-dbs.sh) 的注释。5 个稳定锚点 id 全部保留、只随行迁移，并显式声明「**id 前缀不等于当前 Sprint 号**」（`s4-audit-view` / `s4-identity-docs` 现落在 Sprint 6）。
- **历史不改**：Sprint 1–3 的回顾正文、各文档变更记录流水、`knowledge/*` 证据、`sdd-scrum-practices.md` 的体例举例按原样保留（该口径与「活跃引用必改」在上一轮 Replan 中已定型）。

**验证**：`make doc-links` → **45 个 Markdown / 1190 条相对链接 / 零悬空**（首次跑曾抓出变更记录里一处通配符链接 `ADR-008-*.md`，已改为纯文本）· 原型断言 **159/159** · `sprint-backlog.md` 内 5 个锚点 id **各定义 1 处** · RID 覆盖对照表 **R1–R3 / D1–D6 每行 4/4 列非空** · 全仓 grep 指向旧落点的**活跃引用为 0**（已排除变更记录与历史叙述）· `product-backlog.md` 的 31 条投影与 `sprint-backlog.md` 逐条核对一致。

---

## 2026-09-22

### 门户实现：`PSP-W1`「账号与凭证」（Sprint 4 `#2`）交付

**为什么**：设计包（Sprint 4 `#1`）已把技术栈、数据模型、路由表与逐页映射定稿，但**门户代码为零**；本批是设计包第一次变成可运行的东西，也是「管理员能否真正建用户、发令牌、止血」的第一次可验收。

**做了什么**：

- **从零搭起门户**（`admin_portal/`）：Node 22 + TypeScript（strict + `exactOptionalPropertyTypes`）· Fastify 5 · Nunjucks 服务端模板 · `better-sqlite3` · Zod · `jose`；依赖按官方当前版本核定后**钉死**（`web-design.md` §12.5 明确禁止照抄历史片段）。
- **分层落点**：`src/shared/`（纯逻辑、无 HTTP 依赖 ⇒ 可被后续批次复用）· `src/web/`（路由、模板、词表、库与迁移）· `src/selfcheck.ts`；`src/bridge/` **刻意未创建**（属 `PSP-W2`）。
- **两道门按顺序生效**：`onRequest` **先判 `Host` 分面**（`<MCP_HOST>` 命中管理路径或公开页即 403、`<ADMIN_HOST>` 命中 `/mcp` 即 403、未登记 Host 一律拒绝），**再判身份**（Cloudflare Access 断言验签 + `iss`/`aud`/`exp` + 邮箱头交叉校验）；实测顺序为 `401 → 404`（认证先于路由）与 `403`（面隔离先于身份）。
- **身份四来源收敛**：生产/隧道的真 Access JWT、Access **Service Token**（由 CF 边缘校验后注入同一断言 ⇒ 门户侧零专门代码）、离线测试的自签 JWT —— 全部产出同一 `AdminIdentity`；生产环境启用自签通道即**拒绝启动**，非回环 Host 亦然。
- **令牌与用户**：`memo_` + 32 字节 CSPRNG（base64url 无填充，含前缀 48 字符）· 库内**只存 sha256 与展示前缀** · 校验先唯一索引命中再**常时比较**、判定完全不看前缀 · 明文只在签发/轮换响应出现一次（刷新即不可取回）· 轮换 = 吊销旧 + 签发新且**旧令牌无复活路径** · 删除 = 软吊销 · 停用 = 一次性吊销全部令牌 + 库文件保留、再签发即恢复（`D13`）。
- **fail-closed 审计**：业务写与审计写在**同一 SQLite 事务**内（`withAudit`）⇒ 审计写不进则用户/令牌都不落库；失败的动作**不写审计**（不留虚假成功记录）。
- **四语言与服务端渲染**：`i18n.js` 的 220 键转为四份 JSON（键名不变）并新增 28 键（错误提示、占位页、明文一次面板、401 页）⇒ **248 键 ×4**、键集合一致、启动期与测试期双向校验；语言解析 `?lang=` → 记住的选择（cookie）→ `Accept-Language` → 默认；切换语言用**GET 表单包住整组按钮**，既保留既有样式又无需 JS。
- **无 JS 亦可闭环**：建用户 / 签发 / 轮换 / 吊销 / 停用全部是真实表单与链接（成功按 PRG 303 回跳；唯独签发与轮换**不回跳**，因为明文只允许出现在本次响应里）。
- **占位页按决策实现**：导航四项齐全（与原型一致），审计 / 容量 / Admin MCP / 公开说明页渲染占位并**写明交付批次**，不伪装成已交付。
- **测试**：vitest 离线 **163 项**（分面、配置、handle、令牌、脱敏、库与迁移、审计回滚、身份验签、页面闭环、词表护栏）+ Python Playwright **端到端**（真浏览器走完「建用户 → 签发 → 列出 → 轮换 → 吊销 → 停用」并产出 13 张截图）。
- **工具链**：根 `Makefile` 新增 `portal-dev` / `portal-test` / `portal-e2e` / `portal-tunnel`（**不新增裸 `up`/`down`**，避免与既有 `local-up.sh` 语义冲突）；四个脚本按仓库范式（header 契约块 + 契约化退出码 + 可离线）；`portal-e2e.sh` 自建测试密钥、起门户、跑浏览器、清理；`.gitignore` 增补门户依赖与本地产物。

**验证**：`make portal-test` → 类型检查 + **163/163 通过**（零网络） · `make portal-e2e` → 离线端到端通过（退出码 0；无隧道时在线套件以 **40 显式跳过**） · 原型验收复跑 **134/134**（令牌收口后） · `portal.css` 的 `:root` 由 23 → **30 个变量**且与 §13.1 一致 · 交付副本与原型**逐文件 sha256 一致** · 四条门禁全绿。

**边界**：① **离线套件不覆盖真 Cloudflare Access 链路** —— `AC10.1`/`AC10.5` 的端到端验收需一个经隧道暴露且受 Access 应用保护的域名 + Service Token（`make portal-e2e ARGS=--online`），本机当前**未装 `cloudflared`**，故该项以退出码 40 明确跳过而非伪装通过；② 本批**不含** `/mcp` 端点、MCP 桥、会话回收与吊销终止（`PSP-W2`），也不含门户 stack 的 compose / Dockerfile 生产化（`PSP-W3`）；③ 启动自检中属 `PSP-W2` 的三项（embeddings 可达、二进制版本、模板断言）以 `deferred` 显式登记。

### `sprint-plan.md` → `sprint-backlog.md` 改名（文件名与仓内口径对齐）

**为什么**：文件名与仓内口径不一致 —— `sdd-scrum-practices.md` 早已把该文件的内容称作「**Sprint Backlog**」（§4 单一真源表的「Sprint 排期与执行状态」行、§5 文档清单），而 `specs/` 内其余文件也都是内容名风格（`product-backlog.md` / `sdd-scrum-practices.md` / `web-design.md`）。用户要求文件名跟上该口径。

**做了什么**：

- **`git mv`**：`specs/sprint-plan.md` → [`sprint-backlog.md`](sprint-backlog.md)（保留 rename 形态与 `git log --follow` 历史）；H1 同步为 `# sprint-backlog — memory.agent-mate.ai 产品化`。
- **全量同步引用**：按仓内既有改名口径（先例：2026-09-21 的 `sprint_plan.md` → `sprint-plan.md`；更早的 `hk_vps_4/` → `memory.agent-mate.ai/`）同步 **17 个文件** —— specs 内 14 份 + 脚本 3 个。
- **三类分别处理，防止误改**：① **链接式**（含 **15 处深链接** `sprint-backlog.md#<anchor>`，锚点 id 原样保留）；② **正文提及**（含两处 `related_spec:` front-matter —— `sdd-scrum-practices.md` 与 [`knowledge/docs/spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md)；以及 `sdd-scrum-practices.md` 的 §4 单一真源表 / §5 文档清单、[`adr/ADR-010`](adr/ADR-010-specs-single-source-and-doc-structure.md) 的文档结构表）；③ **旧名映射**（刻意不改）。
- **脚本**：[`../scripts/attestation-paths-check.sh`](../scripts/attestation-paths-check.sh) 的 `SCAN` 数组硬编码路径同步（不改会让该护栏直接失败）；[`../scripts/probes/iso-probe.sh`](../scripts/probes/iso-probe.sh) 与 [`../scripts/link-check.sh`](../scripts/link-check.sh) 的注释指称同步。
- **旧名残留收口**：旧名只作为**映射**保留在两处 —— ① **改名记录**（本文件 2026-09-21 节与本次小节 · [`architecture.md`](architecture.md) / `sdd-scrum-practices.md` / [`sprint-backlog.md`](sprint-backlog.md) 各自变更记录）；② **改名口径说明**（[`knowledge/docs/spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md) 新增的 guidance 条，需指名写出改名链才能被复核）。其余位置一律已改指新名。`.codebuddy/plans/` 下 18 份历史计划虽含该串，但该目录已被 `.gitignore` 忽略（`git ls-files` 0 条）⇒ 不在仓库内，不改。

**验证**：`make doc-links` 36 文件 / **1029 相对链接 / 0 悬空**（计数为本条写出时刻的快照；同节其它条目内的计数为其自身批次快照，故数值不同） · `make attestation-paths` 五路径通过（`$SPECS/sprint-backlog.md` 已同步）· `make secret-check` 干净 · `git diff --check` 干净 · `git status` 呈 `R` rename 形态 · 全仓 `grep sprint-plan` 残留逐条核为改名记录。

**边界**：不改任何 AC / 故事 / 用例编号，不改锚点 id，不改 [`product-backlog.md`](product-backlog.md) 的 `Sprint` 列语义，不改 `.gitignore` / `Makefile` / [`../scripts/link-check.allow`](../scripts/link-check.allow)。4 份 ADR 内的文件名引用**已随改名同步**，但**不**在 ADR 正文追加「路径同步」附注 —— ADR 是不可变决议记录，历史事实由本小节与 git 历史承载（沿用 2026-09-21 同项边界口径）。

### 门户 UI 迭代：单色设计系统、四语言、冻结外框与设计包收口

**为什么**：三轮用户反馈驱动的 UI 迭代 —— ① 色系**不能用品牌橙**（沿用参考稿的单色）；② 首页要重做（品牌名、三步改纵向、第 1 步加 Contact Admin 悬浮窗、第 3 步用真实调用截图、删重复章节）；③ 版式问题（标题贴上文、能力表第三列被裁掉、控件高度不一、路径与时间戳被逐字符折断、内容列过窄）；④ 外框要固定（顶栏与页脚）；⑤ 语言口径不一致（`token` 在三个中文变体里分裂为「令牌」与 `Token`）。

**做了什么**：

- **设计系统**：弃用品牌橙，全站改**纯单色**（唯一有色为危险红 `#8b1a1a`，错误浅底 `#faf6f6`）；**唯一显式例外**是代码块保留参考稿的 `8px` 圆角（前一轮曾误压平，本轮回滚并写进 §13.1 的例外条款）；补 `--control-fs` 令牌并把「**`rem` 基准是 17px 而非 16px**」登记为易错点（[`web-portal/web-design.md`](web-portal/web-design.md) §13.1 / §13.9）。
- **页面集 7 → 6**：撤销「07 只读管理员页」，其内容并入 06「Admin MCP 配置」；路由 `/admin/guide` → `/admin/mcp`（决议 `D12`）。
- **首页重做**：品牌名统一为 `memory.agent-mate.ai - AI Memory MCP`；三步改**纵向**；第 1 步内嵌 **Contact Admin 悬浮窗**（微信二维码 + 邮箱，hover 与键盘聚焦均可触发）；第 3 步改用**真实调用截图**；删除与三步重复的两节。
- **管理面**：用户页**取消搜索框、加分页**；用户详情新增**可逆停用**（一次性吊销全部令牌、库文件保留、签发新令牌即可恢复，`D13`）；审计页加分页并删去冗余说明；容量页与 06 补 `.how-to` 说明（参数怎么改、Cloudflare 侧怎么增删管理员）；**顶栏与页脚冻结**（`sticky` + 不透明底，`D14`）；内容列恢复**左对齐并放宽到 `72rem`**，正文段落另限宽 `46rem`（[`web-design.md`](web-portal/web-design.md) §13.10）。
- **i18n**：四语言（`en` / `zh-CN` / `zh-HK` / `zh-TW`）词表 **220 键 × 4 零缺失零多余**；统一 `token` 口径为 **`Token`**（此前 CN 用「令牌」19 处、HK/TW 用 `Token` 各 20 处）；顺带修掉 14 处「`Token` 与汉字之间缺空格」。
- **Stories / AC / 用例**：新增 **`S14`「门户 UI 设计系统与版式一致性」（`AC14.1`–`AC14.12`）**；`S6` 追加 `AC6.7`–`AC6.11`、`S10` 追加 `AC10.6`–`AC10.10`、`S1` 追加 `AC1.8`；`AC6.3` 内文由「中英两种」改为**四语言**；[`web-portal/web-test.md`](web-portal/web-test.md) 追加 L0 ×2 + L2 ×7 用例。**既有 AC 与用例编号一字未重排**。
- **设计文档补全**：新增 **§14 逐页 UI 设计**（6 页 × 原型 ↔ 模板 ↔ 路由 ↔ 区块 ↔ 组件，含 11 种变体态）与 **§15 UI 资产清单**（单一真源 / 同步方式 / 哈希核对 / **不入库清单** / AI 客户端图标的许可提示），二者**闭合 §12.2 的前向引用**；§0 新增 `D12`–`D14`；`architecture.md` §1.1 的管理面行补登录方式与「门户不自建账号」。

**验证**：原型一次性验收脚本 **134 项断言全绿**（含单色计算样式扫描、能力表列宽不裁切、同一行控件等高、四语言键集合一致、滚动 900px 后顶栏贴顶与页脚贴底、分页与停用交互、`.how-to` 起排与不折行）；`admin_portal/assets/` 与原型逐文件 **sha256 一致**；四条门禁同批复跑 —— `make doc-links`（36 文件 / 996 相对链接 / **0 悬空**）· `make secret-check`（干净）· `make attestation-paths`（五路径一致）· `make preflight-test`（**5 / 0**）。

**品牌资产定版（用户提供）**：logo 换为**透明底品牌徽标**（1004×520，灰底圆角 + 黄色「MCP」/ 白色 `MEMORY` / 浅灰 `agent-mate.ai`），三处副本同源（sha256 一致）；同时修掉因新款更宽（aspect 1.246 → **1.93**）导致窄屏顶栏**溢出 26px** 的回归（`≤720px` 时给 logo 加 `max-width` 锁回原 footprint）。**两个待决项 → 2026-09-22 用户逐项定夺（均选「保留现状」）**：① 新 logo 是**横向锁定款**，与相邻的文本品牌名**语义重复**（hero 现读作「MEMORY MCP ｜ AI Memory MCP」，顶栏同样重复）—— 因 `AC6.11` 明文要求「页面标题与**顶栏品牌**两者均为 `memory.agent-mate.ai - AI Memory MCP`」、`AC14.12` 要求「公开页 hero 与管理面顶栏**各有一处** logo」，两处品牌露出都是 AC 要求的，重复属**两条 AC 的结构性结果** ⇒ **保留不改**；② 其**黄色**（实测 `#F6EC34`，占徽标不透明像素 **2.1%**）是站内除危险红外的**唯一色相**（「品牌色孤岛」）—— 该 AC 的 `When` 限定为「扫描所有元素的**计算色值**」，图像像素不在扫描面内 ⇒ **不**立强调色令牌、**不**灰阶化，作为品牌资产的既有事实**保留**，口径收敛为「UI 无品牌色；品牌资产图像自带色」。两项结论已回填 [`web-portal/web-design.md`](web-portal/web-design.md) §13 开头与 §15 资产表。

**边界与不入库**：本轮**不写应用代码**（门户实现仍归 Sprint 4 的 PSP 批次，逐页映射见 §14）；原型是 `mockup.js` 驱动的静态 HTML（语言切换与对话框为前端模拟）。`specs/web-portal/mockups/.verify/`（一次性验收脚本与截图）与 `specs/web-portal/mockups-from-other-product/`（**另一产品**的参考稿，含其品牌徽标与三张异产品 logo）**均不入库** —— 后者为公开仓不转载他方品牌资产。

### Replan：Sprint 4–7 重排为「设计包 + PSP 批次」（总数 8 → 7）

**为什么**：原排期把「门户开发 / 生产上线 / 升级治理」按**阶段**切成三个 Sprint，每个 Sprint 内是一串**任务**（写代码 / 写文档 / 联调）。这有两个问题：① 交付粒度是「任务完成」而不是「某类角色能用的东西」，做完一个 Sprint 也说不清谁现在能用上什么；② 上线前的「准备」与上线后的「执行」被拆成两个 Sprint，而准备包**只有在真上线时才被验证** ⇒ 伪交接。用户要求改为**按功能批次（PSP）交付**并重排目标。

**做了什么**：

> **编号基准**（避免读者在「原 Sprint N」上踩歧义）：**「重排前」** = 仓库原有的 6 个 Sprint（4 = 门户开发并与 MCP 集成 · 5 = 生产上线与备份闭环 · 6 = 升级治理闭环）；**「用户提案」** = 用户本次给出的方案（4 = web-portal 本地开发 · 5 = MCP 本地开发 + 联调 · 6 = 本地集成 + 上线准备 · 7 = 生产上线与备份闭环 · 8 = 升级治理）；**「落定」** = 本文件当前状态（共 7 个）。

- **Sprint 4 → 「完成 web-portal 本地开发」**：ToDo 由 10 条任务收敛为 **1 行设计包 + 3 批 PSP** —— `#1` 设计包（story-mapping 定稿 / 技术设计 / UI 设计 / 测试方案 / 部署方案，另含「非英文输入能否命中 MCP 工具」的实测）· `#2` `PSP-W1「账号与凭证」`（交付给管理员）· `#3` `PSP-W2「端到端接入」`（交付给用户，**首个对外可用的增量**）· `#4` `PSP-W3「可运维、可发布」`（交付给运维与新用户）。旧 `#0`–`#9` 按功能拆入各批，Sprint 内编号重排。
- **Sprint 5 → 「完成 MCP 本地收尾，并与 web-portal 本地联调通过」**：`#1` MCP 侧设计包（正文落新建的 [`mcp/mcp-stories.md`](mcp/mcp-stories.md)）· `#2` `PSP-M1「接入面与口径定档」`（上游 HTTP 面不对外 + 定制口径门禁 + 部署文档一致性）· `#3` `PSP-M2「本地全链路联通」`（门户 → HTTP MCP → 子进程 stdio → 用户库全链路，作为 Sprint 6 集成验收的输入）· `#4` `PSP-M3「工具可达性」`（承接 Sprint 4 的实测结论，决定是否需要新 ADR）。
- **Sprint 6 = 用户提案的第 6 与第 7 个 Sprint 合并**（「本地集成 + 上线准备」+「生产上线与备份闭环」）：上线准备与真上线同处一个 Sprint（消除伪交接），外部前置（SSH 密钥 / OSS 桶 / DNS / CF Access）以**阻塞**行显式跟踪而非单开 Sprint；新增「本地完整集成验收」「上线准备包」「用户规模上限定值」三条。
- **Sprint 7 = 升级治理闭环**（**重排前**仓库的 Sprint 6 内容下移，并补入原 Sprint 4 #9 的「门户镜像随上游重建」）。
- **连带同步**：`product-backlog.md` 的 `Sprint` 投影列 **31 条逐条重算**（#18 → 7；#9 / #14 / #26 / #29 → 6；#21–#25 → 7；#30 / #31 → 5）；**6 个对外锚点 id 全部保留并指向新位置**（`s3-*` ×2 / `s4-*` ×2 / `s5-*` ×2），跨文档链接零断裂；`mcp-design` / `mcp-test` / `web-stories` / `web-test` / `deployment` / `architecture` / `ADR-008` / `ADR-009` 的现行 Sprint 引用共约 **46 处**改指（历史变更记录按「历史叙述不等于引用」保留原号）；PSP 体例写入 `sdd-scrum-practices.md` §2.4。
- **登记落点**：本项作为**独立过程治理项登记为 Sprint 3 `#8`（`Done`）**（同 `#7` 的追溯方式）；Sprint 3 的 `#6` 已由用户同日收口并置「已结束」，本次未迁移其条目。可复用教训按「写入实际交付该工作的 Sprint」落在 Sprint 4 `Retrospective`。

**验证**：`make doc-links` 34 文件 / **0 悬空** · `make secret-check` 干净 · `make attestation-paths` 五路径通过 · `git diff --check` 干净。人工核对：31 条投影与映射表**逐条一致**（脚本比对通过）；全仓现行行旧编号零残留（仅历史变更记录与回顾中的当时叙述保留旧号）；每张被改表竖线计数 = 列数 + 1。

**边界**：ADR 正文只同步其中的**现行引用**，不追加「路径同步」附注（ADR 为不可变决议记录，历史事实由本小节与 git 历史承载）；[`knowledge/docs/spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md) 证据第 10 / 11 条中的旧编号属**当时叙述**（描述 2026-09-21 那次故事号事件），保留原样；文件名仍是 `sprint-backlog.md`。

### Sprint 3 #6 收口：部署文档与部署制品逐字段收敛（+ 完工项状态置 Done）

**为什么**：`deployment.md` 是部署侧的唯一真相源，但它的 §5.1 契约表与 §5.3 关键字段表已与真实制品（`deploy/docker-compose.prod.yml` / `config.toml.tmpl` / `.env.prod.example`）失联到「照抄会出错」的程度 —— 配置挂载方向写反、curator 参数集在上游**根本不存在**、`[embeddings]` 的模型名与后端不符（这一项直接关系到 1024 维向量绑定）。

**做了什么**（六维字段对照矩阵，每项都指到「文档行号 ↔ 制品行号」两侧证据）：

- **§5.1 compose 契约表**：改正 2 处实质失准 —— ①「配置来源 = 环境变量，**不挂 config 文件**」→ 真实为 `./config.toml → /data/.config/ai-memory/config.toml:ro`（**两服务各一处、只读**；该行原本与本文 §7.2 S3、§12.2 自相矛盾）；② curator 命令 `--sqlite-path / --auto-tag / --poll-interval 60 / --skip-setup-wizard` → 真实 `curator --daemon --interval-secs 3600 --max-ops 50`（**参数集完全不同**）。补 5 类缺行：`config 挂载`、网络（`external: true` 的 `portainer_network`）、两服务环境变量（`HOME=/data` · `AI_MEMORY_DB=/data/ai-memory.db` · `AI_MEMORY_REQUIRE_AGENT_ATTESTATION="0"`）、curator 容器名 `ai-memory-mcp-curator`、serve 命令 `serve --host 127.0.0.1 --port 9077`。
- **§5.3 关键字段表**：按 `config.toml.tmpl` **逐键重写** —— 删去上游 `src/config.rs` 里**不存在**的 5 个键（`max_tokens` / `temperature` / `[storage.sqlite].pool_size` / `[memory].max_age_days` / `[context_optimizer].max_results`）；`[embeddings]` 由 `provider = "fastembed"` / `model = "qwen/Qwen3-Embedding-0.6B"` 更正为 `backend = "qwen"` / `model = "qwen3.7-text-embedding"`，并补 `schema_version` / `tier` / `api_key_env` / `backfill_batch`。原「两个静态常量」更正为**仅 `[embeddings].dim`** —— `[storage].embedding_dim` 不是配置节，而是上游 `ResolvedEmbeddings` 的运行时字段。
- **§5.2 三个必改点**：第 1 条由「默认 `BAAI/bge-small-zh`」更正为「smart 档 preset 默认走 **Ollama 的 Nomic**」。
- **§1 事实文件清单**：由「三个事实文件」更正为**入仓 5 个**（`docker-compose.prod.yml` · `config.toml.tmpl` · `.env.prod.example` · `portal.env.example` · `README.md`）+ **派生 4 个不入仓**（`config.toml` · `.env` · `portal.env` · `config.local.toml`），并指向 `deploy/README.md` 为权威清单（`README.md` 同步标注「入仓共 5 个」）。依据是 `git ls-files` 与 `.gitignore` 的 `11/12/14/15/17` 行。
- **§2/§5.4 `.env` 键**：与 `.env.prod.example` 逐键对齐为 `IMAGE_TAG` + `DASHSCOPE_API_KEY`，删去本部署不用的 `GLM_API_KEY` / `QWEN_API_KEY`；补门户 `portal.env` 的独立说明。
- **部署目录口径统一**：`.env.prod.example` 与 Sprint 2 条目里的 `/opt/ai-memory-mcp/` 统一为 `/opt/ai-memory/`（真源 `deployment.md` §2/§4.1/§12.2 与门户样例均为后者）；§2/§3/§4.1 的 `/opt/ai-memory/data/` 更正为 `/opt/ai-memory/`，并注明运行时数据在**命名卷** `ai_memory_data` 而非宿主机目录。
- **ADR-009「未核实」表述**：把「`gc` 是否覆盖每库 TTL 遗忘与 WAL checkpoint 仍属未核实项」更新为**已核实**并指向唯一真源（`mcp-design.md` §5.3 · `mcp-test.md` §4-C TC-GC）；ADR 的 Context / Decision / Rationale **未动**。
- **编号引用收口**：1 处失准 —— `mcp-design.md` §8.3 #1 用 `Sprint 3 #2` 指「把 `--profile` 写入模板」，而现行 #2 已改指 D2 ⇒ 改用条目名（Backlog #12）。3 处「措辞过时」同步关闭：`mcp-design.md` §6.4 未决前提 #2、§6.5 第 6 行与 `ADR-009` 后果行（原写「待定档 / 未核实」，现均标为已定档 / 已核实）。历史变更日志与当时叙述按纪律**保留原编号**。
- **#1–#5 结论落点核查**：逐条核实 22 个声称落点，**全部真实存在且内容对得上**（含 `mcp-design` §9 B3 / §5.3 / §5.4 / §9 L / §6.2 / §6.5、`mcp-test` §1 L1.8 / §4-C / §4-D、`limits-probe.sh` / `gc-probe.sh` / `maintain-user-dbs.sh` / `attestation-paths-check.sh`、`Makefile` 的 `maintain-user-dbs`、`deployment.md` §5.3、`product-backlog` #13 / #17、知识文档教训 20 / 21）。
- **完工项状态与 Sprint 收口**：Sprint 3 的 **#2 / #3 / #4 / #5 由 `Implemented` 改为 `Done`**（本地验收已闭环，**说明列保留「生产复验归 Sprint 5」边界**）；**#6 由 `WIP` 改为 `Done`**。复核确认 **#1–#7 全部 `Done`**，故按 Sprint 1 / 2 的既有体例在标题区补上缺失的 **`**状态：已结束**（全部条目完成，2026-09-22）`** 与「收口说明」（说明其中四条的生产复验已作为已登记条目移交 Sprint 5）。

**验证**：`make doc-links`（33 个 Markdown / 相对链接 0 悬空）· `make secret-check` · `make attestation-paths`（五路径）· `make preflight-test`（5/5）· 四支探针 `mcp-smoke.sh` / `iso-probe.sh` / `limits-probe.sh` / `gc-probe.sh` 均 `rc=0` · `git diff --check` 干净。

**边界**：生产环境落地（定时器 / 备份外迁 / 生产通道复验）仍属 Sprint 5；本次只收敛文档与制品的口径，不改任何架构决策，也不动在途的改名故事与门户故事改动。

**Retrospective 沉淀**：本轮可复用结论并入 Sprint 3 回顾三组（做得好 +1 / 学到 +4 / 下轮改进 +2），并沉淀到 [`knowledge/docs/spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md)（**证据第 12–14 条 + 6 条 guidance**：配置文档与制品双向互为镜像、数量与路径类声明须 `git ls-files` 取证、字段对照矩阵优于通读、Sprint 收口要核结束标记）。该知识文档 `as_of` 同步为 2026-09-22、补 `config-doc` 标签与 3 条 Links。

**ADR：无新增** —— 本轮是既有决议的文档一致性维护（含一处状态性表述更新），未引入新的架构或流程取舍。

## 2026-09-21

### `sprint_plan.md` → `sprint-plan.md` 改名 + Sprint 回顾体例收口（含 Sprint 4 归属校正）

**为什么**：① 文件名用下划线，与仓内其余 spec（`product-backlog.md` / `sdd-scrum-practices.md` / `web-design.md`）的连字符风格不一致；② Sprint 回顾章节此前是**逐条累加**式的（同一 Sprint 里出现「主块 + 多个补记子标题」），越到后期越难看出当前结论；③ 上一批（门户故事引用收口）被记在 Sprint 3，但它实际是 **Sprint 4 #0「web-portal 设计」** 的第一个增量 —— 按 `sdd-scrum-practices.md` §2.3「写入**实际交付该工作的 Sprint**」，应归 Sprint 4。

**做了什么**：

- **改名**：`git mv memory.agent-mate.ai/specs/sprint_plan.md → sprint-plan.md`，按仓内既有改名口径（先例：`hk_vps_4/` → `memory.agent-mate.ai/` 的「引用 227 处 → 0」）全量同步引用，共 **16 个文件** —— specs 内 13 份（[`architecture.md`](architecture.md) · [`change-log.md`](change-log.md) · [`product-backlog.md`](product-backlog.md) · `sdd-scrum-practices.md` · [`web-portal/web-stories.md`](web-portal/web-stories.md) · [`mcp/mcp-test.md`](mcp/mcp-test.md) · [`adr/ADR-006`](adr/ADR-006-public-repo-ip-placeholder-deidentification.md) / [`ADR-010`](adr/ADR-010-specs-single-source-and-doc-structure.md) / [`ADR-011`](adr/ADR-011-doc-style-text-over-icons.md) / [`ADR-013`](adr/ADR-013-sdd-scrum-process-doc-boundaries.md) · [`knowledge/docs/spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md)（含 front-matter `related_spec`）· [`knowledge/git-tooling/gotchas.md`](knowledge/git-tooling/gotchas.md) · 本文件）与脚本 3 个（[`../scripts/probes/iso-probe.sh`](../scripts/probes/iso-probe.sh) 注释 · [`../scripts/link-check.sh`](../scripts/link-check.sh) 注释 · [`../scripts/attestation-paths-check.sh`](../scripts/attestation-paths-check.sh) 的 `$SPECS` 文档清单）。旧名残留由 20+ 处降到 **0 处**，只在改名记录里保留旧→新映射。
- **回顾体例收口**：`sdd-scrum-practices.md` §2.3 新增约束 —— `Retrospective` 只有「做得好」「学到」「下轮改进」三组，同一 Sprint 内的多次回顾**合并进这三组**，不新增「补记」类子标题；并据此把 Sprint 3 已有的三段回顾（主块 + 门户故事引用补记 + #5 维护定档补记）**合并为一组**。
- **归属校正**：门户故事引用收口的回顾由 Sprint 3 迁至 **Sprint 4**；Sprint 4 #0「web-portal 设计」的 `关联文档` 由纯文本清单改为可点击链接，并补「首个增量已落盘、待整体批准」的说明 —— 状态仍为 `ToDo`，因为其验收条件是「用户批准验收」整份门户设计，不因一个增量而关闭。

**验证**：`make doc-links` 33 文件 / **0 悬空**（改名后路径全部可解析）· `make attestation-paths` 五路径通过（`$SPECS/sprint-plan.md` 已同步）· `make secret-check` 干净 · `git diff --check` 干净 · 全仓 `grep sprint_plan` **0 残留**。

**边界**：4 份 ADR（006 / 010 / 011 / 013）内的文件名引用**已随改名同步**，但**未**在 ADR 正文追加「路径同步」附注 —— ADR 是不可变决议记录，历史事实由本小节与 git 历史承载；旧名只在本次改名记录里出现。

### 门户故事号引用订正 + S11/S12/S13 用例登记（web-stories v2.0 收口）

**为什么**：[`web-portal/web-stories.md`](web-portal/web-stories.md) 重写为 ATDD 体例后新增了 S10–S13，但**引用方不会自动跟着变** —— [`product-backlog.md`](product-backlog.md) 与 [`sprint-backlog.md`](sprint-backlog.md) 中写死的 `S3` / `S9` 仍指向重写前的语义，[`knowledge/web-portal/portal-launch-mechanism.md`](knowledge/web-portal/portal-launch-mechanism.md) 也只引到 `S1/S8`。这正是 [`spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md) 记录的「转述会静默过时」；且 S10–S13 在全仓**没有任何一处正确的外部引用**（S10 被写成 `S9`、S11/S12 被写成 `S9 #7`、S13 零引用）。

**做了什么**：

- **订正 5 个条目的错指（6 处文本 —— `#16` 含描述句与 `关联` 列两处）**：[`product-backlog.md`](product-backlog.md) #7 `S3`→`S6`（接入说明页与 i18n）· #16 `S9`→`S10`（管理面访问控制与面隔离）· #18 `S9 #7`→`S11 / S12`（启动自检版本断言 + 制品契约与升级治理）；[`sprint-backlog.md`](sprint-backlog.md) Sprint 4 #6 `S3`→`S6` · #8 `S9`→`S10 / S13`。
- **补全缺口引用**：[`sprint-backlog.md`](sprint-backlog.md) Sprint 4 #1 补 `S10` · #3 补 `S1 / S4` · #5 补 `S7` · #7 补 `S3 / S4 / S13` · #9 补 `S11 / S12`；Sprint 5 #6 补 `S8` · #7 补 `S9` · #8 补 `S7`；Sprint 6 #3 补 `S12` —— 使故事索引里声明的 Sprint 落点全部**双向可查**。[`portal-launch-mechanism.md`](knowledge/web-portal/portal-launch-mechanism.md) Links 由 `S1/S8` 补为 `S1 / S8 / S11 / S12 / S13`（该文件正是这三条的 E1–E7 实测证据来源）。
- **登记用例**：[`web-portal/web-test.md`](web-portal/web-test.md) §2 新增 `TC-P-L0-06`–`TC-P-L0-09`（启动自检四项：用户目录可写 / 向量服务可用性与 1024 维 / 版本断言 / 关键校验在位）与 `TC-P-L1-11`–`TC-P-L1-13`（制品契约三项核对、版本标签由版本锁注入且不继承上游默认值、非 root 运行与容器加固）。`AC12.4`（升级清单含重建门户镜像并演练）是流程留痕项，登记在 §1 测试计划为**人工项**，不设自动化用例。
- **不扩写既有用例号**：`TC-P-L1-08`（无 docker socket）语义保持不变 —— S13 的另两条断言另立 `TC-P-L1-13`，避免同一用例号承载两种语义而使既有引用静默失真。
- **闭合双向映射**：[`web-stories.md`](web-portal/web-stories.md) 故事索引新增 `AC` 列并回填 S11/S12/S13 的具体用例号（含既有 `TC-P-L1-09` 对应 `AC12.2`）；S3 的 Backlog 归属由 `#3 / #14` 校正为 `#14 / #28`（`#3` 只回链 `S2`、`#28` 明确引用 `S3 AC3.5`）；去掉 S4 行重复的同一 Sprint 条目；体例说明补「AC 与用例按区间覆盖、人工项在 §1 登记」的口径；「已知限制与开放问题」第 3 条由「尚无对应用例」改为**已登记**。

**验证**：`make doc-links` · `make secret-check` · `make attestation-paths` · `git diff --check` 退出码 0；全仓复核**错指零残留**（旧故事号只出现在历史变更记录里且为纯文本）；每张被改表的 `|` 计数与列数一致；新增 TC ID 全局唯一且连续（L0 到 09、L1 到 13），并与故事索引双向可查。

**边界**：不扫历史变更记录中的旧故事号（历史叙述不等于引用）。「**静默失败点**」编号与故事号**同名不同义**，一律不动：[`deployment.md`](deployment.md) §7.2 的 S1–S3、[`web-portal/web-design.md`](web-portal/web-design.md) §5 的 S4，以及 [`web-portal/web-test.md`](web-portal/web-test.md) 与 [`sprint-backlog.md`](sprint-backlog.md) 中沿用该编号的行；[`../scripts/probes/i18n-probe.sh`](../scripts/probes/i18n-probe.sh) 的测试项标签 `S1–S12` 同理。[`product-backlog.md`](product-backlog.md) 中「本应引用故事号但当前未引用」的条目（#2 / #6 / #11 / #17 / #26 / #29）本轮未动；#14 已引 `S3`，其缺的是 S8 侧（已由 Sprint 5 #6 补上）。如需继续补齐另开。

### Sprint 3 #5 收口：每用户库维护行为定档（宿主机 cron + 覆盖面实测）

**做了什么**：把「每个用户的库由谁定期打扫、按什么命令、失败怎么办」定档，并给出**行为级**证据（不再停留在设计文档的「覆盖面未验」）。

- **调度定档 = 宿主机 cron**（用户确认）。理由是维护属运维性质、与「多用户接入」这一产品功能解耦，且门户方案要到 Sprint 4 才存在（只能写决议、拿不到证据）。
- **维护入口落成脚本**：新增 [`../scripts/maintain-user-dbs.sh`](../scripts/maintain-user-dbs.sh)（Bash 3.2；`--dry-run` / `--max-ops` / `--root`；退出码 0 / 1 / 2），并接 `make maintain-user-dbs`。文档只引用脚本路径 —— 只有脚本才能被 cron 稳定调用、被探针静态审计、被路径一致性护栏覆盖。逐 (库, 命令) 独立 `docker exec`，使失败可精确定位到库。
- **两条硬约束**：每条调用**显式 `--db <绝对路径>`**（源码侧 `--db` 只是 `AI_MEMORY_DB` 的 fallback：不传且 env 缺省时会**静默新建**相对路径 `ai-memory.db`；容器内该 env 指向**主库**）与**显式 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`**（v0.11 起上游缺省翻转为全 surface required）。
- **失败语义**：单库失败**不中断**、打印可定位信息后继续，最终非零退出供 cron 告警 —— 遇错即停会让排在后面的库永远得不到维护。**环境不可用（容器未运行 / 无法列举用户库）以 `3` 响亮失败**，绝不把「什么都没维护」当成成功：终审时发现首版在容器未运行时 `list_dbs` 返回空集、会以「未发现任何用户库」的样子静默成功（rc=0），正是本项目最忌讳的失败形态，已补前置存活检查与 `list_dbs` 退出码校验。退出码契约：`0` 成功 / `1` 有库失败 / `2` 参数错误 / `3` 环境不可用。
- **探针**：新增 [`../scripts/probes/gc-probe.sh`](../scripts/probes/gc-probe.sh)（L1.8；退出码 0/10/20/30/40/50/60/70；`--self-test` 负向自测），实跑退出码 0、7 项断言通过。

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

**结论回写唯一真源**：[`mcp/mcp-design.md`](mcp/mcp-design.md) §5.3（调度定档 + 覆盖面表 + 两条硬约束 + 失败语义 + 边界）· [`mcp/mcp-test.md`](mcp/mcp-test.md) §1 新增 **L1.8** / §2 完成态 / §4-C `TC-GC-01..04` / §5 · [`deployment.md`](deployment.md) §5.3「每库维护」小节 + §14 · [`product-backlog.md`](product-backlog.md) #13（`Implemented`）· [`sprint-backlog.md`](sprint-backlog.md) #5（`Implemented`）+ Sprint 3 Retrospective 补记 · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 表行 + 教训 21 + Links · 根 `Makefile` 新增 `maintain-user-dbs` 目标并把 `attestation-paths` 描述改为五路径。

**可复跑验证**：`bash memory.agent-mate.ai/scripts/probes/gc-probe.sh`（退出码 0）· `--self-test` · `bash memory.agent-mate.ai/scripts/attestation-paths-check.sh --self-test` · 回归 `mcp-smoke.sh` / `iso-probe.sh` / `limits-probe.sh` · `make doc-links` / `make secret-check` / `make attestation-paths` / `make preflight-test` · `git diff --check`。

**边界**：生产定时器安装、日志采集与告警留 Sprint 5；HTTP 面与生产通道复验同属 Sprint 5。

**用户验收**：2026-09-21，Robert Smith 确认可用。

**ADR：无新增** —— 本轮是「按上游既有契约选择调度形态 + 把覆盖面钉成可复跑断言」，属既有策略（宿主机侧运维、一用户一库、模板显式写死）的执行层，未引入新的架构或流程取舍。

### RID 解决方案全链路追踪 + Sprint Retrospective 双写规则

**为什么**：RID 的解决方案虽已下沉 Product Backlog，但原链接只定位到文件顶部，Sprint 落点也是不可点击文本，无法沿 `Product Backlog → Sprint Backlog → design/test` 核对实施链；`retrospective` 技能也只要求 ADR / knowledge 沉淀，未强制回写实际交付 Sprint。

**做了什么**：为 RID 涉及的 Product Backlog 与 Sprint Backlog 条目增加稳定锚点；RID 表和覆盖矩阵改为条目级可点击链路；Product Backlog 的 `关联` 列回链具体 Sprint 执行项与设计/测试依据。更新 `sdd-scrum-practices.md`，规定完整追踪链与稳定锚点，并规定每次 retrospective 必须写入实际交付 Sprint 的 `Retrospective`，ADR / knowledge 仅在有持久价值时追加。

**验证**：核对 5 个 Product Backlog 锚点、6 个 Sprint 锚点均有定义和双向引用；RID 8 行覆盖矩阵无空项；Markdown 诊断无新增问题；链接回归见本次验证记录。

**边界**：不复制 Product、Sprint、design/test 的状态或正文；各自仍是其信息类型的唯一真源，跨文档只通过稳定链接导航。

### SDD/Scrum 过程文档体例收口：RID 单向下沉 + 状态与说明分列

**为什么**：RID Registry 把 R1–R3、D1–D5 与 V1–V4 混在同一张表，风险行通过 D/V 编号互相引用，解决方案、验证方法和执行状态重复；Sprint ToDo 与 Product Backlog 的状态列还混入日期和长篇过程说明，无法按枚举核对。

**做了什么**：

- 新增 `sdd-scrum-practices.md` 与 [`ADR-013`](adr/ADR-013-sdd-scrum-process-doc-boundaries.md)，固定 RID Registry、Sprint Backlog、Product Backlog 的列定义、四态语义和单一真源边界。
- RID 表只保留 R1–R3 与 D1–D5；V1–V4 从 RID 行移除，但作为稳定判据名保留，定义归位到 [`mcp/mcp-design.md`](mcp/mcp-design.md) §6.2 与 Product Backlog #11 的验收条件。新增 8 行覆盖对照，逐条给出 Backlog、验收条件与 Sprint 落点，无空项。
- 6 张 Sprint ToDo 表新增「说明」列，状态只写 `ToDo` / `WIP` / `Implemented` / `Done`；长说明压缩为摘要并指向过程文档。三项原本仅存在于旧状态列的事实在本小节保留：Sprint 2「Qwen key」已从本地 secrets 回填 gitignored `.env.local` 并通过 `qwen-verify.sh` / `doctor`；临时文件 `tmp_user_key_option1.md` 经用户决定直接删除且确认不含真实密钥；Sprint 3「部署文档与事实一致性」已完成旧编号传播机械扫描，完整字段核对仍未完成。
- Product Backlog 状态只写四态枚举；#4 / #11 / #14 / #26 的验收条件分别承载 D1、V1–V4、D3、D5，#17 校正为 `[limits]` 七键与本地行为探针已落地。`architecture.md` §6 改为薄索引。

**验证**：RID 覆盖表 8 行逐项人工核对；Markdown 表格列数与状态枚举人工检查；回归执行 `make doc-links`、`make secret-check`、`make attestation-paths`、`make preflight-test` 与 `git diff --check`。

**边界**：不新增状态/覆盖护栏脚本或 Makefile 目标；不改 `scripts/link-check.allow`、gitignored 文件及 Sprint 4–6 未开始条目的事项与验收条件；过程证据仍归现有设计、测试与变更文档。

### Sprint 3 #4 收口：上游 `[limits]` 容量与配额（模板显式定默认 + 行为探针）

**做了什么**：把上游 `[limits]` 段落进生产模板并给出**行为级**证据，同时把「配置生效」与「行为生效」两件事分开证明。

- **模板（策略：显式等于编译默认）**：`deploy/config.toml.tmpl` 新增 `[limits]`，**写全 7 键且取值等于 ai-memory v0.10.0 编译默认**（`1000` / `104857600` / `5000` / `1000` / `0` / `100000` / `false`），注释说明优先级（env > section > 编译默认）、非正值视为未设、逐 `(agent_id, namespace)` 盖章、CLI 写入不计费、`max_page_size` 与 `max_inflight_requests` 为 HTTP 面专属，以及本地 `config.local.toml` 缺该段时的**行为等价性**。选「写死默认值」而非「留空靠上游」与 `--profile core`、`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 同源：不写就等于把行为交给上游默认值，而改变是**静默**的。
- **探针（不污染生产默认值）**：新增 [`../scripts/probes/limits-probe.sh`](../scripts/probes/limits-probe.sh)（Bash 3.2；退出码 10/20/30/40/50/60/70；含 `--self-test` 负向自测）。**只经 env 注入小阈值**，在**独立一次性库**（`/data/users/limits-probe/`，退出时按唯一时间戳前缀连同 `deferred-audit` 旁路日志一并清理）上用**每轮全新身份**运行：
  1. 三类配额各取一个全新 `agent_id`：`AI_MEMORY_MAX_MEMORIES_PER_DAY=1` → 第 2 条 `memory_store` 被拒；`AI_MEMORY_MAX_STORAGE_BYTES=1` → 首条即被拒；`AI_MEMORY_MAX_LINKS_PER_DAY=1`（会话内 `--profile graph`）→ 第 2 条 `memory_link` 被拒。错误串均含 `QUOTA_EXCEEDED`，并以 `quota-status --namespace global --json`（**刻意去掉注入 env**）交叉核对配额行**仍等于注入值** —— 同时证明「配额行在首次写入时盖章」与「注入阈值确实生效」。
  2. 向量容量：`capacity=1` + `hard_fail=true`，**跨进程**预热 ≥1 条后插入被拒（先断言阻塞预热已落地），同时断言**记忆行仍落库**（`insert` 返回 `void`，不回滚）。
  3. 面归属：`max_page_size=1` / `max_inflight_requests=1` 下 stdio 会话的写入与列表**均正常** ⇒ 二者确为 HTTP 面专属。
  4. 探针内还机械断言模板七键恒等于编译默认、且未混入测试阈值（防「测试值污染生产」）。
- **结论回写唯一真源**：[`mcp/mcp-design.md`](mcp/mcp-design.md) §5.4（配额契约）+ §9 新增「**L. 容量与配额**」7 条依赖与陷阱 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §4-D（`TC-LIMIT-01` 具体化 + 新增 `TC-LIMIT-02`）· [`deployment.md`](deployment.md) §5.3 七键表 + §14 · [`sprint-backlog.md`](sprint-backlog.md) #4 完成态 · [`product-backlog.md`](product-backlog.md) #17（两套前缀更正）· [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 实测表 + 教训 20。

**三个只能实测得到的坑**（已全部沉淀）：
1. **默认日志过滤器看不见触顶** —— 触顶日志 target 是 `hnsw.eviction`，而 MCP 默认 directive 只有 `ai_memory=info`；不显式放宽 `RUST_LOG` 就永远观测不到，容易被误判为「功能失效」。首轮断言失败即栽在这里。
2. **配额逐 `(agent_id, namespace)` 盖章** —— 行在首次写入时固化**当次进程**的默认值，事后改配置**不追溯**；这条决定了探针必须「新身份 + 一次性库」，否则会得出「配置没生效」的错觉。
3. **CLI 一次性写入不计费** —— 用 `ai-memory store` 永远验不出配额失效；只有 daemon 面 MCP 写路径调用 `check_and_record`。
4. **`quota-status` 查错 namespace 会「自建行 + 报默认值」** —— MCP `memory_store` 默认写入 **`global`** 命名空间，而 `quota-status --namespace <ns>` 对**不存在的** `(agent, namespace)` 会**现场建行**并按当前 env 盖章。首版探针查 `default` 且**带着同一注入 env**，等于自己把值写进了新行 —— 是一条**自证式（恒真）断言**。终审时用「去掉 env 复读」把它试出来，修正为「去掉 env + `--namespace global`」后该断言才真正可失败。

**可复跑验证**：`bash memory.agent-mate.ai/scripts/probes/limits-probe.sh`（退出码 0）· `--self-test` · 回归 `mcp-smoke.sh` / `iso-probe.sh` · `make doc-links` / `make secret-check` / `make attestation-paths` / `make preflight-test` · `git diff --check`。

**边界**：HTTP 面超限（`max_page_size` / `max_inflight_requests` 真正触发）本地**无法验证**（容器不发布端口、镜像内无 curl/wget）⇒ 留 Sprint 5 生产通道；生产 SSH 通道的配额复核同属 Sprint 5。

**ADR：无新增** —— 本轮是「按上游既有契约使用配置 + 显式固定默认值」，属既有策略（ADR-009 隔离、档位定档同源）的执行层，未引入新的架构或流程取舍。

### Sprint 3 #1–#3 完成质量修复：口径单点化 + 调用点审计留痕 + 状态登记校正 + 静态护栏

**为什么**：对 #1–#3 做只读质量复核，发现三类问题 —— ① #1 的「失准表述更正」只落到了 `mcp-design` §9 B3 与 `mcp-test` §4-D，**被引权威与引用方仍有 4 处残留**；② #2 的验收里含「每库维护命令审计」，而该命令是 #5 的产物、当时并不存在，属**不可验证项**，且审计无留痕；③ #3 的探针扎实，但 `sprint-backlog.md` 风险表 D2/D5/V1/V2 的状态与同文件 Sprint 3 表的「已完成」**互相矛盾**，V4 的「与模板完全相同的 env」措辞也强于实现（实际只传三项）。

**根因**：这正是 [`ADR-010`](adr/ADR-010-specs-single-source-and-doc-structure.md) 与 Sprint 2 Retrospective 记过的「**被引文档/权威未同步 ⇒ 转述静默过时**」——修一处漏一处，且没有护栏能发现。

**做了什么**

1. **口径单点化**：`architecture.md` §2.1 #9（attestation 单点权威，也是 `mcp-design.md` §5.2 引用的目标）、`product-backlog.md` 第 99 行、`docker-compose.prod.yml` 第 27 行注释、`knowledge/local-dev/ai-memory-local-run-gotchas.md` 第 31 行，全部删除已证伪的「不设会 403」与不可观测的「写入标记为 `claimed`」，改为 v0.9 / v0.10.0（surface-scoped）/ v0.11（缺省翻转）三段式，并指向真源 `mcp-design.md` §9 B3。`product-backlog.md` #15 的「三路径」计数与同事实其他表述统一为**四处**，状态由「进行中」改 **Done**。
2. **审计可验证化 + 留痕**：`mcp-design.md` 新增 **§6.5 库路径调用点审计**（现存 5 条：compose ×2 / SSH 管理员行 / SSH 用户行 / 门户模板，逐条给出「库路径来源 + 证据位置」与复跑 grep 命令），结论是**无一条依赖 config 的库路径**。`sprint-backlog.md` #2 验收把「每库维护命令」移出本条目（明确随 #5 定档时同批审计），标题改为「现存路径调用点审计」，并回链 §6.5。
3. **状态登记校正**：`sprint-backlog.md` 风险表 D2 / D5 / V1 / V2 / V3 / V4 与 R1 / R3 的状态列改为与 Sprint 3 表一致（本地已完成项标完成、生产项留 Sprint 5 #8、D1 留 Sprint 4 #7），消除同文件自相矛盾；`mcp-design.md` §6.1 D2 与 §6.2 V1–V4 同步；§0 的「漏设即静默落主库」补上 **D2 前/后**限定，§0.1「会话 env 三件套」注明实际为**四项**（含 attestation）。
4. **措辞与实现对齐**：`iso-probe.sh` 的四个会话 env 数组补 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`，使 V4 的「与模板用户行相同的服务端 env」成立（对 `source` 解析与既有断言无影响，容器级本就为 `0`）。
5. **新增静态护栏**：`scripts/attestation-paths-check.sh`（`make attestation-paths`，只读 / 无 Docker / 无网络，退出码 0/10/20）—— 断言 A 四路径模板同值、B `deployment.md` 用户行与 `mcp-design.md` §5.2 的 `-e` 子句**逐字一致**、C 门户 launch 模板含该 env、D 现行文档无已证伪口径回流；`mcp-test.md` 登记为 **TC-ATT-02** 并纳入 §2 回归触发条件。

**验证**：`make attestation-paths` → 0；`iso-probe.sh` → 0（V1 `rc=2`、`resolved=/ai-memory.db`、主库计数 36 不变，V2–V4 与 P6 硬断言全绿）；`mcp-smoke.sh` → 0（8 工具 / 写入 / 召回 / attestation 正负对照）；`make doc-links` / `make secret-check` / `make preflight-test`（5/5）与 `git diff --check` 全绿。护栏另做**五类负向注入自测**（基线 0、curator 缺 env 10、失准口径回流 20、两模板不一致 10、用户行整行缺失 10）—— 确认非「恒绿」。

**过程中自纠一处**：护栏 D 检查最初会被 `mcp-test.md` 自身对禁用字面量的**引述**触发（跑完护栏后才补的 TC-ATT-02 引入），实测 `rc=20` 与文档自称「已完成」矛盾；改为「不复述字面量、只指向脚本内 `STALE_PATTERNS`」，并在脚本内写明该约束。同批修复 `env_clause` 在 `pipefail` 下模板缺失时以未文档化退出码 1 早退的问题。

**边界**：生产 SSH 通道复验仍属 Sprint 5 #8；门户 D1 的 spawn 前置断言仍属 Sprint 4 #7；每库 `gc` / `curator --once` 覆盖面仍属 Sprint 3 #5。

### Sprint 3 #2–#3：移除共享 DB fallback + 隔离负向门禁定型

**做了什么**：把本地配置派生、隔离负向探针和 Sprint 3 现行文档口径收紧为可复现的 fail-closed 验收，不依赖人工修改 gitignored 配置，也不把弱证据误报为通过。

**实现**：tracked 的 [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) 移除顶层 `db`；[`../scripts/local-up.sh`](../scripts/local-up.sh) 从 `config.local.toml` 派生运行时配置时剥离裸键、双引号键和单引号键形式的顶层 `db`，保留 section 内同名键，并用临时文件、原子替换和 `0600` 权限生成 `.env` / `config.toml`；结果含顶层 `db` 时拒绝启动。

**探针**：[`../scripts/probes/iso-probe.sh`](../scripts/probes/iso-probe.sh) 的 V1 现在要求漏设 `AI_MEMORY_DB` 时 `doctor` 非零；只规范化同一次响应中的 `source`，要求绝对路径且不等于 `/data/ai-memory.db`，失败原因属于存储路径；主库记忆计数在 P1a 与 P2 前后均必须可读且不变。P3 复用完整用户环境，方案②对照的伪造写入与归属可见性改为硬断言。

**文档同步**：更新 `sprint-backlog.md` 风险 / D2 / V1 / V2 及 Sprint 3 #2–#3 状态；更新 `mcp-design.md`、`mcp-test.md`、`web-portal/web-test.md`、ADR-008/009 的现行归属与验收表述；历史变更日志中的旧编号保留，并将已取消的方案②写路径泄露探针明确标注为取消。

**验证**：`bash memory.agent-mate.ai/scripts/local-up.sh` 成功重建本地服务；`bash memory.agent-mate.ai/scripts/probes/iso-probe.sh` 退出码 **0**。V1 实测 `rc=2`、`source=ai-memory.db` 规范化为 `/ai-memory.db`、共享主库计数不变；V2–V4、P4、P5 与方案②硬断言全部通过。静态夹具覆盖三种顶层 `db` 键形式且通过；脚本语法与 `git diff --check` 通过。

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

**回写**：[`sprint-backlog.md`](sprint-backlog.md) Sprint 3 #1 → **已完成**（含验收口径更正与「变更记录」行）；[`product-backlog.md`](product-backlog.md) #15 说明按实测更正，并注明「漏设即 fail-loud」在 v0.10.0 服务端**不可得**、只能落在门户 spawn 前置断言（随 Sprint 4 #7）；上游事实沉淀见 [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)。

**ADR：无新增** —— 本轮是实测更正 + 护栏加固，属 [`ADR-010`](adr/ADR-010-specs-single-source-and-doc-structure.md) 文档纪律的执行层，不产生新的架构 / 流程决议。

### Sprint 2 #11 收口：引用治理 + 能力文档体例定稿

**做了什么**：把 `sprint-backlog.md` / `product-backlog.md` 中指向已合并旧 spec 的 85 处引用全部改指合并后文档与对应章节，删除 `link-check.allow` 的两份整文件豁免，并同步因能力文档体例变更而失准的转述。

**引用改写（旧名 → 新落点）**：`multiuser_isolation.md` → `mcp/mcp-design.md`（§5 配方族 / §6.2 V1–V4 / §6.4 未决前提 / §7 五个坑）；`mcp_tool_inventory.md` → `mcp/mcp-design.md` §8；`upstream_coupling_surface.md` → `mcp/mcp-design.md` §9；`admin_portal_design.md` → `web-portal/web-design.md` / `web-portal/web-stories.md` / `web-portal/web-test.md`（按设计 / 验收条件 / 测试清单分流）；`asset_isolation_plan.md` → `architecture.md` §5；`deployment_strategy.md` §0 → `architecture.md` §2；`dev-plan.md` §3 / §3.3 / §3.4 / §4 / §5 → `deployment.md` §3 / §7.3 / §7.2 / §8 / §9；`deploy/deployment-plan.md` → `deployment.md`。

**历史叙述不动**：两份文件「变更记录」行里的旧文件名是**当时事实**，只把链接降级为纯文本（去链接、留名字），不改指新文档。

**漏改自检（两类典型）**：① 共享前缀的省略写法会漏掉后半段章节号（`dev-plan.md` §3.2 八步落地 **+ §3.3 冒烟**）；② 多对一合并会产生重复列举（`deploy/deployment-plan.md` 与 `dev-plan.md` 都归 `deployment.md`）。两处均已订正。

**为什么不停在「文档级链接」**：目标章节在合并时按主题重排，逐处核对锚点后仍能精确落位（`architecture.md` §6 · `deployment.md` §7.2–§7.3 · `mcp/mcp-design.md` §6.2 等）；只有把握不足处才退化为文档级链接。

**验证**：`make doc-links` → 30 文件 / 491 链接，**0 悬空**，允许清单豁免 **2** 个文件（原 4 个）；两份文件行数与表格列数逐行比对未变。落盘回顾文档后复跑：31 文件 / 498 链接，仍 **0 悬空**。

**Sprint 2 收官**：`sprint-backlog.md` 的 Sprint 2 加「**状态：已结束**（全部条目完成）」，其 `Retrospective` 由阶段性回顾改为**定稿**（补 3 条本轮实证：档位文档体例 = 只列增量 + 连续编号；能力说明必须与探针实测逐项对齐；被引文档改版会让引用方转述静默过时）。回顾落盘 [`knowledge/docs/spec-doc-conventions.md`](knowledge/docs/spec-doc-conventions.md)（`knowledge/README.md` 索引同步）—— **ADR：无新增**（本轮的体例与引用纪律是 [`ADR-010`](adr/ADR-010-specs-single-source-and-doc-structure.md) 的执行层细化，不产生新的架构/流程决议，避免 ADR 碎片化）。

### Sprint 2 #10 定稿核查 + 两处文档体例改造（#11 扩展）

**做了什么**：核查「MCP 对外能力清单定稿」是否真的完成（结论：**已完成**），并把用户要求的两处文档改造登记进 Sprint 2 #11、本轮一并做完。

**一、#10 的四项最终决议 —— 均已定稿且有落点**

| 决议 | 结论 | 落点 |
| --- | --- | --- |
| 档位 | 对外 = `core`（8 项）；管理员入口 = `admin`（22 项） | [`mcp/mcp-design.md`](mcp/mcp-design.md) §8.1 / §8.3 + 四处模板（[`deployment.md`](deployment.md) §4.3 · [`mcp/mcp-design.md`](mcp/mcp-design.md) §5.1–§5.2 · [`web-portal/web-design.md`](web-portal/web-design.md) §3.3 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §3） |
| i18n 范围 | **部分支持**（存储与语义召回可用；关键词通路受 FTS5 `unicode61` 限制、简繁不归一；无任何配置项） | `product-backlog.md` #10（Done）· [`mcp/mcp-design.md`](mcp/mcp-design.md) §2 / §9 J4 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §1 L1.6 / §4-E · 探针 [`../scripts/probes/i18n-probe.sh`](../scripts/probes/i18n-probe.sh) |
| LLM 选择 | `tier = smart` + `qwen-plus` + `qwen3.7-text-embedding`（`dim = 1024`）+ 显式 `base_url` | [`architecture.md`](architecture.md) §2.1 #3/#4 · [`adr/ADR-007`](adr/ADR-007-qwen-private-maas-endpoint-and-measured-embedding-dim.md) · [`deployment.md`](deployment.md) §5.3 |
| 备份选择 | OSS 私有桶（香港 + SSE）+ 每日外迁 + sha256 校验 + RPO ≤ 24h / RTO ≤ 2h | `product-backlog.md` #9 · [`deployment.md`](deployment.md) §8 |

清单已落入公开文档 [`mcp/mcp-capabilities.md`](mcp/mcp-capabilities.md)；`product-backlog.md` #19 → **Done**。**唯一剩余**：生产环境上线后用 `initialize` 回包核对实际暴露工具数 —— 已并入 `sprint-backlog.md` **Sprint 5 #8 上线验收**，不再挂在执行条目里造成假性阻塞。

**二、[`mcp/mcp-capabilities.md`](mcp/mcp-capabilities.md) 结构重构（用户视角）**

| 改动 | 说明 |
| --- | --- |
| §1 与 §2 合并 | 合并为「这是什么，怎么接上」，并新增 `mcp.json` **三种形态**示例：托管门户（HTTP）/ 本机自托管（stdio via `docker exec`）/ SSH 通道；示例一律占位符（`<MCP_HOST>` / `<你的令牌>`），并注明「档位由服务端决定、改完必须重连」 |
| 工具说明改为**按档位** | 原「按族」的 8 个小节取消，改为 **6 张档位详表**：`core` 8 / `admin` 22 / `graph` 20 / `power` 57 / `full` 101 / 自定义 `core,lifecycle` 14；**每张表只列本档新增**（上一档已列过的不重复），首列为**全档连续编号**（`core` 1–8 / `admin` 9–22 / `graph` 23–34 / `power` 35–83 / `full` 84–101；自定义 `core,lifecycle` 沿用 9–14），其余列固定为「工具 / 做什么 / 什么时候用 / **示例**」 |
| 例子进表格 | 原独立的「一个完整的例子」章节**删除**，示例并入表格的「示例」列（一句自然语言用法） |

工具数与成员**以运行时实测为准**，非手工整理：档位计数用 [`../scripts/probes/profile-probe.sh`](../scripts/probes/profile-probe.sh)（7 档全绿），成员清单用逐档 `tools/list`，功能说明用 `memory_capabilities` 的 verbose drilldown（8 族，101/101 取到完整 `docs`）—— 裸 `tools/list` 的 `description` 是被截断的短描述，不可用于对外说明。

**三、[`sprint-backlog.md`](sprint-backlog.md) 体例改造**

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

**可复跑验证**：`make doc-links`（相对链接）· `make secret-check`（无真实地址与密钥）· `make preflight-test` · `bash memory.agent-mate.ai/scripts/probes/profile-probe.sh`（7 档计数）。

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

**实测**（可复跑探针 [`../scripts/probes/profile-probe.sh`](../scripts/probes/profile-probe.sh)：隔离库 `/data/users/profile-probe/`、只读、每档独立进程、退出码 0）：

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

**回写**：[`mcp/mcp-design.md`](mcp/mcp-design.md) §8.1（实测引文）+ §8.3（由「待决策」改为决议表 #1–#4）+ 变更记录 · [`sprint-backlog.md`](sprint-backlog.md) #9 完成态 + 变更记录 · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)（档位实测表与教训）。

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
- **复现**：`bash memory.agent-mate.ai/scripts/probes/i18n-probe.sh`（隔离库 `/data/users/i18n-probe/`，不碰主库与 iso 库；三阶段分进程；退出码 0/10/20/30/40/50；`I18N_PROBE_STRICT=1` 把语言边界当断言防上游漂移）。首跑 `1789958920-48352` / 默认复跑 `1789959024-49737` / STRICT 复跑 `1789959038-49972` 全绿（含 CONFLICT 幂等分支）。交叉验证：Cursor `ai-memory-local` 客户端直调结论一致（标记 `i18n-cross-20260921`）。
- **工程口径**：中文检索一律走 `memory_recall`；关键词通路只用于 ASCII 标记与中文整段引用。
- **#6 key 验证**：`qwen-verify.sh --key` → `embed_model=qwen3.7-text-embedding-flash`、`dim=1024`（同工作空间、同模型）；另以 `-e DASHSCOPE_API_KEY` 覆盖注入隔离会话复核 —— 写入成功 + 跨进程召回 `mode=hybrid`（embedder 未降级）、stderr 无鉴权失败。
- **回写**：[`product-backlog.md`](product-backlog.md) #10（ToDo → Done；改动授权来源 = 该行验收条件「给出明确结论并回写本行描述」）· [`sprint-backlog.md`](sprint-backlog.md) #6/#8 + 变更记录 · [`mcp/mcp-test.md`](mcp/mcp-test.md) §1 L1.6 + §4-E（TC-I18N-01..06）+ §5 · [`mcp/mcp-design.md`](mcp/mcp-design.md) §2 能力边界 + §9 契约点 J4 + §10 · [`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md) 多语言专表 + 教训 #10 升级 · [`architecture.md`](architecture.md) §4.1 + §7。

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

**排期**：计入 Sprint 2 —— `sprint-backlog.md` 新增 #13（需求覆盖审计 + 回溯引用）与 #14（本次风格收口），均标记完成。

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

**零改动文件**：`sprint-backlog.md`、`product-backlog.md`（用户指定）；前者仅**追加** Sprint 2 #12 与一行变更记录（含旧→新文件名映射）。5 份 ADR（004/005/006/008/009）**仅**同步路径与指向，决议文字一字未改，文末追加一行同步说明。

**验证**：`make doc-links` 24 文件 / 201 链接无悬空（豁免 4 文件）；`make secret-check` 干净；`make preflight-test` 5/5；`iso-probe.sh` exit 0（A/B/C 三组全绿）。

### 3. 回顾归档：ADR-010 与护栏自证教训（提交 `9402636`）

- 新增 [`adr/ADR-010-specs-single-source-and-doc-structure.md`](adr/ADR-010-specs-single-source-and-doc-structure.md)：specs 唯一真源、8 份结构与四条去重规则、链接纪律、`.gitignore` 路径无关、ADR 不可变例外。
- 更新 `knowledge/git-tooling/gotchas.md` 增第 4 条：**护栏的允许清单会静默失效**。清单键按「相对产品目录」书写、脚本按「相对仓根」匹配 → 豁免从未生效却仍打印「豁免 4 个文件」，首次运行因恰好无悬空而未暴露。已改为支持两种书写（后缀匹配）。教训：任何带白名单的守卫都必须**用负向样本自证**，否则它的「通过」不能作为证据。

---

## 已知遗留（显式登记，非静默放宽）

| # | 遗留 | 处置 |
| --- | --- | --- |
| 1 | ~~`product-backlog.md` / `sprint-backlog.md` 内部仍指向已合并的旧文件名~~ —— **已于 2026-09-21 清空** | 85 处引用全部改指合并后文档与对应章节（历史叙述行降级为纯文本），`link-check.allow` 两份整文件豁免同步删除（豁免 4 → 2）；此后护栏覆盖全部自有 spec，见「Sprint 2 #11 收口」小节 |
| 2 | 两份运维模板 `hk_vps_4_settings.md` / `vps4_new_deployment_instruction.md` 内部链接同样悬空 | 同上；文件待移除，关键信息已摘编进 `architecture.md` / `deployment.md` |
| 3 | `secrets.local.hk_vps_4.md` 文件名含旧目录名 | `secrets.local*` 通配仍覆盖，不影响忽略；是否改名为 `secrets.local.md` 待定 |
| 4 | 实际 1,748 行 vs 计划 1,590 行 | 因上游契约面 A–K 决定**全量保留**（升级预检的逐项判据，压缩会削弱护栏） |
| 5 | 3 次提交未推送远端 | 待用户确认后推送 |

## 回归基线（改名或增删文档后必跑）

`make doc-links` · `make secret-check` · `make preflight-test` · `bash memory.agent-mate.ai/scripts/probes/iso-probe.sh`（exit 0 为准入）
| 2026-09-22 | **门户本机可测化 + 覆盖率收口（补上一轮登记的缺口）**：① **两条本机测试路径**落地并可复跑 —— **快速路径** `make portal-dev ARGS="--env-file .env.local --dev-login"`（生成/复用开发密钥到 `.portal-data/dev/`，注入**既有**自签 JWT 测试通道并打印可粘贴的浏览器 cookie；**服务端未新增任何旁路**，非回环 Host 直接拒绝、`PORTAL_ENV=production` 启用即拒绝启动）与**真身份路径**（命名隧道 + Access SSO）；新增 `admin_portal/.env.local`、`.env` 两个**已忽略**的环境文件，`.gitignore` 显式忽略 `.env.local`（它是不同于 `.env` 的 basename，原规则不覆盖它）。② **`tunnel-dev.sh` 由「只读清单」升级为逐步骤引导 + 每步自检**（`--login` / `--create` / `--route` / `--check` / `--verify` / `--start`；②③ 幂等；`--verify` 断言未认证被 Access 拦截、有 Service Token 时断言 200，并当场指出「Service Token 未加入应用策略」这一最常见漏配）。③ **覆盖率从「未测量」收为可机器失败的门禁**：装 `@vitest/coverage-v8@5.0.1`（与 vitest **同版**；经镜像取得后已把 `package-lock.json` 的 `resolved` 还原为 canonical 地址、版本写法由 `^` 改回精确），首测基线 79.30 / 72.74 / 88.02 / 80.05 ⇒ 据缺口补测（`selfcheck` **0% → 100%** 等）后 **94.87 / 88.25 / 98.77 / 96.39**，阈值写入 `vitest.config.ts`（92/85/96/93，**低于即失败**）并**双向验证**（抬到 99 时 rc=1）；新增 `make portal-coverage`（两段式：退出码 10 测试失败 / 11 未达阈值）；离线测试 163 → **247 项**。④ **如实登记的环境限制**：本机网络解析不到 `cloudflareaccess.com` / `ghcr.io`（内网 DNS 仅放行国内镜像，npm 官方 registry 亦不可达）⇒ `brew install cloudflared` 与**在线 Access 链路无法在本机完成**，`make portal-e2e ARGS=--online` 继续以**退出码 40** 显式跳过（未伪装通过）；快速路径与全部离线测试零网络，不受影响。⑤ **文档同步**：[`web-portal/web-test.md`](web-portal/web-test.md) 新增 **§1.1 覆盖率口径**（含两处进程入口豁免与保留不测分支的**逐条理由**）、[`admin_portal/README.md`](../admin_portal/README.md) 补「本机两条测试路径」与网络限制、[`admin_portal/.env.example`](../admin_portal/.env.example) 订正 `PORTAL_VIEWS_ROOT` 默认路径（`src/views` → `src/web/views`）并说明两个本机环境文件的分工 |
| 2026-09-22 | **更正上一行第 ④ 条的网络结论（该判断有误）**：本机网络**没有问题** —— DNS 系统解析与公共解析器一致（`cloudflareaccess.com` / `api.cloudflare.com` / `ghcr.io` / `github.com` / `registry.npmjs.org` 全部正常解析），HTTPS 全部可达（`404`/`400`/`401` 均为**正常应答**，此前被误读为「不可达」），`cloudflared` **2026.9.1 已安装并已授权**（`~/.cloudflared/cert.pem`），命名隧道 `portal-dev` **在线运行**。真正的「无法登录」根因是**启动配置与隧道目标不匹配**（门户以 `.env.local` 回环 Host 启动 ⇒ 真域名被判 `unknown-host` → 403，Access 断言未轮到）。处置方案见 [`web-portal/web-login-plan.md`](web-portal/web-login-plan.md)（顺序 C → A → B）；问题登记与根因更正见 [`web-portal/issues-log.md`](web-portal/issues-log.md) **Issue 6**（含四条流程条款）。 |
| 2026-09-22 | **C（真身份路径）打通 —— Issue 6 [FATAL] 解除**：根因确认为**启动配置与隧道目标不匹配**（门户曾以 `.env.local` 回环 Host 启动 ⇒ 真域名被判 `unknown-host` → 403，Access 断言未轮到）。改为 `bash scripts/portal-dev.sh --env-file admin_portal/.env`（**不带** `--dev-login`）后实测：本机 `Host: memory.agent-mate.ai` → **401**（不再 403）；公网 `https://memory.agent-mate.ai/admin/users` → **HTTP/2 302 → `<team-domain>.cloudflareaccess.com/cdn-cgi/access/login/…&kid=50265d84…`**（`kid` 与 `.env` 的 AUD **一致**）；`tunnel-dev.sh --verify` → **OK ⑤ 链路自检通过**；**用户本人完成一次 SSO 登录成功**（人手验收证据，为 Issue 6 流程条款第 3 条的首个执行案例）。**未完成**：Service Token 未注入 ⇒ 自动化路径（`make portal-e2e ARGS=--online`）仍以**退出码 40** 显式跳过；**A（受限开发登录入口）/ B（401 页自诊断）**按 [`web-portal/web-login-plan.md`](web-portal/web-login-plan.md) 实施中。 |
| 2026-09-22 | **Cloudflare Access 的 Service Token 链路打通（自动化路径具备前置）**：带 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 访问 `https://memory.agent-mate.ai/admin/users` → **HTTP/2 200**（此前一律 302）。`tunnel-dev.sh` 的失败提示已修正（不再把 302 一律归因于「策略未配」），改为按 Access 返回的 `service_token_status` 区分：`false` = 凭据未被认出（团队不符 / 复制截断 / token 失效），`true` = 已认出但策略不允许。三条实际耗费时间的排查路径（`service_token_status` 判别、Zero Trust **团队一致性**、zsh `read -p` 非提示符导致「测试带空值空跑」）已登记进 [`web-portal/issues-log.md`](web-portal/issues-log.md) Issue 6 附表。**待办**：`bash scripts/tunnel-dev.sh --verify`（应显示 Service Token → HTTP 200）与 `make portal-e2e ARGS=--online` —— 后者是 Issue 6 明细表最后一个未完成项。 |
| 2026-09-22 | **在线链路自检通过（`tunnel-dev.sh --verify` → Service Token → HTTP 200 且 OK ⑤）** —— 真身份路径（C）与自动化前置（Service Token）均打通。**同时发现一处工具缺陷**：`make portal-e2e ARGS=--online` 的**离线套件**以 403 失败（`Forbidden: request host does not match this face`），根因是**真身份实例仍占用 8788 端口**，导致 E2E 自己启动的回环实例绑定失败、浏览器打到了配置为真域名的那个实例（Host 不匹配 ⇒ 面隔离 403）。⇒ 需修复：`portal-e2e.sh` 在绑定失败/端口被占时必须 **fail-loud**，而不是继续对一个「不是自己启动的实例」跑断言（与本次 `service_token_status` 提示同类问题：**误导性的静默失败**）。 |
| 2026-09-22 | **A（受限开发登录入口）+ B（401 页自诊断）落地 —— Issue 6 [FATAL] 的根治侧**：① **A**：新增 `GET/POST /admin/dev-login`，**仅在 `cfg.testJwt.enabled` 时注册路由**（配置层已保证 development + 回环；生产启用自签通道会被启动期拒绝 ⇒ 生产**不存在**该路由），守卫按同一判据**前置放行**（否则「用来获得身份的页面」会先被 401 拦死）；POST 读取 `--dev-login` 已产出的令牌文件（`resolveTokenFile`：JWKS 同目录，内联 JWKS 时回退 `<dbPath 目录>/dev/token`），写 `CF_Authorization`（`HttpOnly; SameSite=Lax; Path=/`）后 **303** 回跳 —— **不新增签发代码、不把私钥引入应用进程，故不是新旁路**；令牌缺失时页面明确提示、POST 返 **409**（可诊断，而非无法解释的失败）。② **B**：401 页在**非生产**下显示「你使用的 Host / 自签通道状态 / 期望的令牌文件 / 开发登录入口」，把「未登录」与「Host 不对」两类**同形症状**分开；生产不传该上下文 ⇒ 行为与既有完全一致（仍不暴露验签失败原因）。③ **门禁**：`typecheck` 0 错误；测试 **247 → 251 项全绿**（`tests/integration/dev-login.test.ts` 6 例，含「**不预注入 cookie** 的完整登录流程 ⇒ 200」这条把 Issue 6 固化为回归防护的用例）；覆盖率 **OK**（93.03 / 85.86 / 97.70 / 94.39 ≥ 92/85/96/93）；词表 259 键、四语言一致，中文口径由既有护栏校验通过（写作途中被该护栏抓到一次「令牌」用词，已按护栏口径改为 `Token`，**未改护栏**）。④ **仍未做**：`portal-e2e.sh` 绑定失败 fail-loud 修复。 |
| 2026-09-22 | **登录身份收口（阶段 0/1 完成，按 TDD）—— 不再接受 `admin@example.test` 这类测试身份**：计划见 [`web-portal/portal-identity-plan.md`](web-portal/portal-identity-plan.md)。① **阶段 0（红）**：先写会失败的验收测试 —— T2「启用自签通道但缺邮箱 ⇒ `loadConfig` 抛错」、T3「生产身份来源白名单」；同时**删除了一个「绿但无用」的用例**（它断言的是测试夹具自签令牌里的 email，会给人「真实邮箱身份已验证」的错觉），改为显式登记覆盖边界：脚本行为交**人手验收**。② **阶段 1（绿）**：`src/config.ts` 新增 `PORTAL_TEST_JWT_EMAIL` 并**在启用自签通道时强制必填**（缺即拒绝启动 ⇒ 不可能静默回落到测试邮箱）；`src/web/admin-guard.ts` 新增 **生产身份层护栏** `isIdentitySourceAllowed()`——生产只接受 `access-jwt` 与 `service-token`（**Service Token 是 Cloudflare 身份，必须允许**，否则误伤自动化），拒绝 `test-jwt` 并落 `identity_source_rejected` 告警；`scripts/portal-dev.sh` 新增 `--email`（优先级 `--email` > `PORTAL_TEST_JWT_EMAIL` > **报错退出**，**刻意不设默认值**），启动横幅打印当前身份邮箱，并把键导出给门户。③ **门禁**：typecheck 0 错误；测试 **251 → 257 项全绿**（5 个既有测试文件补必填键）；覆盖率 **OK**（92.75 / 85.84 / 97.71 / 94.05 ≥ 92/85/96/93）。④ **已知小缺口（不藏）**：`portal-dev.sh --help` 的 usage 尚未写 `--email`；覆盖率语句由 93.03 降至 92.75（新护栏的「拒绝分支」目前仅纯函数单测覆盖，集成层用例待补）。⑤ **仍待做**：阶段 2（web-* 三件套 + architecture + 新 ADR-015 + mcp/ + product-backlog 等）、阶段 3（原型两页 + 同步 Issue 1–5 界面修正 + 复跑 134 断言）、阶段 4（门禁 + 人手验收）。 |
| 2026-09-22 | **方案 D 落地 —— Issue 4「明文刷新即丢」根治（七个问题里最后一条实质缺陷）**：① **新模块** `src/web/issued-stash.ts`：一次性明文暂存（`put` 返回随机引用、`take` **命中即删**、**TTL 60 秒**、**上限 32 条**丢最旧、惰性清理，无定时器；id 用 `crypto.randomBytes(24).toString('base64url')`）。② **签发/轮换的 HTML 分支**由「在 API 地址上直接渲染详情页」改为 **PRG**：暂存明文 → `Set-Cookie: portal_issued=<id>; HttpOnly; SameSite=Lax; Path=/admin/users/<用户名>; Max-Age=60` → **303 → 详情页**；**JSON 客户端分支保持不变**（自动化路径不受影响）。③ **详情页 GET 侧**取用即销毁并**无论命中与否都清除**该 cookie；cookie 在但暂存已取用/过期 ⇒ 渲染「明文已过期，请重新签发」（词表 +1，四语言 261 键，`Token` 不译口径不变）。④ **护栏测试 4 条**（`tests/integration/issued-once.test.ts`）：303 且 Location 为详情页 · **第二次请求拿不到明文** · 单次取用/过期/上限 · 明文不入库；并按新行为改写 `pages.test.ts` 的签发与轮换两条用例（原用例断言的是「200 + 在 API 地址渲染明文」）。⑤ **门禁**：`typecheck` 0 错误；测试 **251 → 261 项全绿**；覆盖率 **OK**（92.78/85.90/97.76/94.26 ≥ 92/85/96/93）。⑥ **已知边界（如实登记）**：暂存是**进程内存** ⇒ 多实例部署会落空（本机单进程无影响），需共享存储时另行处理。⑦ **仍待做**：浏览器人手验收（重启后签发 → 303 回详情页 + 一次性面板 → 刷新显示「已过期」）、原型与 134 断言同步、阶段 2 文档。 |
| 2026-09-23 | **弹窗版式重做 + 布局护栏（Issue 8）**：① 「值撑出边框」根因实测为「固定标签列 168px ⇒ 值列 94px 放不下 123px 的 memo_XXXXXXXX，且**下划线不产生断行点**（`.mono` 并非元凶）」；② 弹窗宽度 **+50%（22rem → 33rem，实测 374 → 561px）**，目标块由「标签列 + 值列」改为**两列规格栏**（每字段标签在上、值在下，两列分占整行），**固定标签列宽从结构上取消**；③ 新增**布局护栏**：`assert_no_overflow()`（6 个弹窗 × 2 视口 + 详情页键值面板）、弹窗宽度断言（按根字号换算，本项目 1rem = 17px —— 写死像素曾造成一次假失败）、目标块几何断言（字段并排 / 标签在值上方 / 用满宽度）；三处均**先见其失败、再修复**；④ 修 `portal-e2e.sh` 两处既有缺陷：端口被占用时会**静默测到别人的实例**（现以**退出码 30** fail-loud 并打印占用进程）、缺 `PORTAL_TEST_JWT_EMAIL` 导致官方 E2E 入口**根本起不来**；⑤ 落 **`ADR-015`**（开发登录入口按配置限制注册 + 横幅给出可点链接），按 ADR-014 惯例登记于门户实现笔记。证据：原型断言 **134/134**、离线 E2E 通过（含新增护栏）、`typecheck` 0 错误（本轮无 TS 改动）。 |
| 2026-09-23 | **`PSP-W1` 计划收尾（`online-e2e` 项）+ 文档口径纠正**：① **结掉 2026-09-22 登记的那条 fail-loud 工具缺陷**（当日现象：真身份实例占用 8788 ⇒ E2E 自启的回环实例绑定失败 ⇒ 浏览器打到配置为真域名的实例 ⇒ 面隔离 **403** 的**误导性失败**）：修后端口被占用时打印**占用进程**并以**退出码 30** 拒绝启动，空闲端口照常全绿；② 在线套件的「明确跳过」语义**实测**通过（`scripts/portal-e2e.sh --online` ⇒ **40** + SKIP 文案）；同时量到 `make portal-e2e` 会把非零码**折叠为 2** ⇒「跳过」与「失败」在 make 层面不可分，机器调用方须直接调用脚本（脚本头已写明）；③ `web-test.md` 回填实测：离线测试 **261 项**、覆盖率 语句 **92.78** / 分支 **85.90** / 函数 **97.76** / 行 **94.26**（阈值 92/85/96/93，门禁绿灯；语句边距 +0.78 偏薄）；④ 在线套件**真链路运行**登记为「**未测**」（缺 Service Token 与隧道地址两项环境变量，需持有者执行），与「不通」分开登记（链路本身已于 2026-09-22 由 `tunnel-dev.sh --verify` 验过）。 |
| 2026-09-23 | **脱敏：Cloudflare Access 团队域不再入仓**：`change-log` / `issues-log` / `web-login-plan` 共 **1** 处曾写入真实团队域，已统一替换为 `<team-domain>.cloudflareaccess.com`。依据：`web-login-plan.md` 自身边界「**不写密钥与真实值**（真值只存在于本机被忽略的 `admin_portal/.env`）」。**AUD 未泄漏** —— 文档只按名引用 `.env` 的 AUD，未写其值。**保留项**：`me@ethanhuang.com` 是**产品对外的公开联系地址**（公开说明页与原型中本就在用、且早已提交）⇒ 不属脱敏范围。发现的机制：提交前的敏感值兜底扫描（本次新增做法，已并入提交清单）。 |
| 2026-09-23 | **删除用户列表说明文案 + 状态标签折行修复（Issue 9）**：① 表头说明「每位用户一个独立数据库。路径用等宽字体，便于逐字符核对。」整体删除（四语言词条同步移除，键数 **261 → 260** 且四语言一致），并删除承载它的 `<caption>`、给 `<table>` 补 `aria-label`（避免表格失去无障碍名称）；② **Issue 9**：状态列仅 **57px** 而「已吊销」需约 **64px**（49 文本 + 7 状态点 + 7.65 间距）⇒ 中文默认允许任意字符间断行，标签被折成「已吊 / 销」两行（实测 `.status` h=**50** / line-height 25.2）⇒ `.status { white-space: nowrap }`（两份 CSS 同步、sha256 一致），并新增 E2E 断言 `assert_status_single_line()` —— 既有护栏只查**溢出**，而折行不产生溢出故长期漏检；③ **`SBI-V1` 完成**（七条门禁全绿 + 真实邮箱 `me@ethanhuang.com` 人手截图；2026-09-22 那次测试身份的验收随之失效）。证据：261 测试 / 原型 159 / 离线 E2E 全通过。 |
| 2026-09-23 | **Sprint 计划体例改造：PSP 批次细化为 Increment（规则由用户逐条定稿）**：① **体例**（`sdd-scrum-practices.md` §2.1）：待办表列名 `事项` → **`Increment`**（`类别` / `模块` 保留）；命名必须为 **`范围:名词`**，范围词表限定 `web-portal` / `mcp` / `deploy` / `backup`，且**范围按契约归属**判定（不按代码位置、不按接收方角色 —— 例：会话桥实现于 `admin_portal/src/bridge/` 但契约真源在 [`mcp/mcp-design.md`](mcp/mcp-design.md) §5.6 ⇒ `mcp:会话桥`）；每行必须是一个**可交付的增量**，粒度以「一个功能」为起点、按 §2.4 的 SBI 判据过大时拆到**子功能**；**验收条件必须二值判定**（只有满足/不满足），格式为「条件名称 + 判定依据」。② **拆分**：Sprint 4 原 `#3`（`PSP-W2`）→ `3.1`–`3.6`、原 `#4`（`PSP-W3`）→ `4.1`–`4.10`；Sprint 5 原 `#2`/`#3`/`#4`（`PSP-M1/M2/M3`）→ `2.1`–`2.2` / `3.1`–`3.2` / `4.1`；[`web-portal/portal-identity-plan.md`](web-portal/portal-identity-plan.md) §8 的剩余 SBI 排入（`D1`–`D5`、`P2`、`P3` → Sprint 4 `#7`–`#13`；`V2P`、`V2` → Sprint 5 `#5`–`#6`）。③ **两处未决项按证据落定**：容量 `S7` 按 AC 拆为 `3.5`（会话限流）/ `3.6`（配额透传）/ `4.7`–`4.9`（磁盘方案、规模上限、限流结论）—— 依据是 [`web-portal/web-design.md`](web-portal/web-design.md) §7「上游无『会话』概念 ⇒ 会话级限流必须门户自建」，故依赖会话桥者排在桥之后；Sprint 4 `#3` 与 Sprint 5 `#3` 的判据重叠按「**桥本身（Sprint 4 交付 `3.1`–`3.4`）/ 两端合跑 + 跨用户隔离 + 拒绝路径（Sprint 5 `3.x`）**」划界，重叠消除。④ **引用同步**：`web-stories.md` 14 行故事落点按新编号重算；`product-backlog.md` 关联列改指新编号；`web-test.md` 的 `D1` 落点改指 `3.2`；`issues-log.md` 的批次标题改名；**四个被外部引用的锚点**（`s4-mcp-session-bridge` / `s4-audit-view` / `s5-access-surfaces` / `s5-production-acceptance`）保留、27 处引用未断。⑤ **历史不改**：`#1` / `#2` / `#5` / `#6`（已 `Done`）与 ADR、change-log 流水、回顾正文中的旧批次名一律保留（[`ADR-016`](adr/ADR-016-sbi-delivery-granularity.md) 第 3 条「既有批次不重排」）。**编号基准**：重排前 `#3`/`#4` 指 `PSP-W2`/`PSP-W3`、Sprint 5 `#2`/`#3`/`#4` 指 `PSP-M1`/`M2`/`M3`；重排后 **`3.x` / `4.x` 表示由原 `#3` / `#4` 拆出的子项**，Sprint 5 的 `2.x` / `3.x` / `4.1` 同理。证据：`make doc-links` 无悬空（45 文件 / **1155** 相对链接）；拆分后表格列数与锚点完整性均校验通过。 |
