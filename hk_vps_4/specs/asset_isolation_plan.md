# 资产隔离计划 — 协同布局（父仓 memory.agent-mate.ai）

> **状态：** ✅ **迁移已执行**（2026-09-20；见 §9 清单与 §12 决策记录）
> **布局裁决（2026-09-20）：** 采纳**协同布局**（父仓 + 嵌套 gitignored clone）；物理分仓降级为备选记录（§6）
> **嵌套管理：** gitignored 普通 clone（非 submodule）
> **关联：** [`deployment_strategy.md`](./deployment_strategy.md) · [`dev-plan.md`](./dev-plan.md)

---

## 1. 背景与决策轨迹

| 日期 | 决策 |
| --- | --- |
| 2026-09-20（初版） | 首选「物理分仓」：上游 clone 与自有资产放在两个独立位置 |
| 2026-09-20（现版） | 改采**协同布局**：工程目录更名为 `memory.agent-mate.ai`，上游 clone 嵌套为子目录，自有资产集中在 `hk_vps_4/`。理由：单一工作区，文档/脚本/代码都在手边；隔离目标（上游纯净、自有资产独立版本化）同样达成 |

## 2. 目标态结构

```text
~/code/memory.agent-mate.ai/            # 父仓（公开）
│                                         remote = https://github.com/ethanhuangcst/memory.agent-mate.ai.git
├── .gitignore                           # 第一行：ai-memory-mcp/
├── Makefile                             # upstream / pin / pin-update / preflight / preflight-test / backup / restore-drill
├── .github/workflows/                   # 平台强制路径（根目录例外，见下方说明）
├── .github/scripts/                     # 平台强制路径下的辅助脚本（render-preflight.py）
├── ai-memory-mcp/                       # 嵌套 clone（gitignored）—— 上游，只读约定
│                                         remote = https://github.com/alphaonedev/ai-memory-mcp.git
└── hk_vps_4/                            # 自有资产（全部入库）
    ├── upstream.lock                    # ★ 版本契约单一真相源（上游 tag / 镜像指纹 / schema）
    ├── scripts/
    │   ├── upstream-preflight.sh        # 升级准入判定（判据 H1–H5 / W1–W6；退出码 0/2/3/1）
    │   └── tests/                       # 离线 fixture 自测（make preflight-test）
    ├── specs/                           # 文档与决议（2026-09-20 由 docs/ 更名，见 §12）
    │   ├── deployment_strategy.md       # 决议真相源
    │   ├── dev-plan.md                  # 部署与升级计划
    │   ├── upstream_coupling_surface.md # 耦合面清单（本部署依赖上游的每个契约点）
    │   ├── sprint_plan.md               # 短周期执行清单（ToDo / 阻塞 / 验收）
    │   ├── asset_isolation_plan.md      # 本文档
    │   ├── hk_vps_4_settings.md
    │   ├── vps4_new_deployment_instruction.md
    │   ├── mcp_oss_bak_com_requirements.md   # mcp.oss-bak.com 需求规格（另建项目用）
    │   ├── adr/                         # 架构决议记录（ADR-004 / ADR-005）
    │   └── knowledge/                   # 可复用研究与运维知识（upstream-ai-memory/）
    ├── deploy/
    │   ├── docker-compose.prod.yml
    │   ├── config.toml.tmpl
    │   ├── .env.prod.example
    │   ├── README.md                    # 运维 runbook + 升级预检清单
    │   └── deployment-plan.md           # release-bot 主输入 + IMAGE_TAG ↔ 上游 tag 映射
    └── backup/
        ├── backup-and-push.sh           # 快照 + sha256 校验 + ossutil 上传 + 回读比对
        ├── restore-drill.sh             # 季度恢复演练（可重复）
        └── ossutil.config.tmpl          # 不含真实 AK
```

**判据**：任何一个文件，要么属于上游（`ai-memory-mcp/` 内、被其跟踪、未修改），要么属于本项目（`hk_vps_4/` 内、被父仓跟踪）——**不存在第三种位置**。

**根目录例外（仅两类；内容仍属本项目，位置由基础设施/平台决定）**：

1. `.gitignore`、`Makefile` —— 仓级基础设施，必须在根。
2. `.github/workflows/`、`.github/scripts/` —— **GitHub 平台强制**工作流位于仓库根，无法下沉到 `hk_vps_4/`（见 `.github/workflows/upstream-track.yml`）。

> 决议记录与知识库（`adr/`、`knowledge/`）现位于 `hk_vps_4/specs/` 之下，**属自有资产、非根目录例外**（2026-09-20 由仓根 `specs/` 并入，见 §12）。

## 3. 嵌套 clone 的 git 行为与护栏（最易踩的坑）

嵌套 clone 位于父仓工作区内，git 会把它视为未跟踪目录。**必须防一个真实陷阱**：

> 若它未被 ignore 就执行 `git add .`，git 会把嵌套仓库记录为 **gitlink（mode 160000）**——一个指向 commit 的指针，且父仓没有 `.gitmodules` → 对克隆父仓的人来说是**无法 checkout 的坏引用**，上游代码也进不了父仓。

**护栏（必须全部到位）**：

| # | 护栏 | 实现 |
| --- | --- | --- |
| 1 | 父仓 `.gitignore` 第一行 `ai-memory-mcp/` | 迁移时立即写入，先于任何 `git add` |
| 2 | pre-commit 守卫拒绝 stage `ai-memory-mcp/` | 一行脚本（防 `git add -f` 手滑）；可选但成本低 |
| 3 | 上游 remote 非本方所有 → **天然无推送权** | 无需额外机制 |
| 4 | 每次上游升级后，父仓 `git status` 必须仍然干净 | 写入 dev-plan.md §5 升级预检清单 |
| 5 | 父仓记录上游对应版本 | **`hk_vps_4/upstream.lock` 为唯一真相源**（上游 tag / commit / 镜像 digest / schema / 沉淀期阈值）；`deployment-plan.md` §3.1 提供人读映射表；`make pin` 打印、`make pin-update` 回写 |

## 4. 「只读策略」评估结论

**技术上无法对本地 clone 强制真只读**（操作者拥有这台机器；`git pull` 本身也要写 `.git`；chmod 方案会破坏 pull）。因此：

- **不需要**引入 chmod / 独立系统账户等重型机制；
- 隔离的**真正保障** = §3 护栏 1–5（上游内容进不了父仓 + 无推送权 + 状态校验）；
- 「想改上游文件」的冲动出现时，那个改动应当落在 `hk_vps_4/` 的覆盖层（配置/补丁/文档结论），而不是改 clone——此为**团队约定**，写入部署仓库 README。

## 5. 隔离规则（长期生效）

1. **clone 内禁止修改任何被跟踪文件**；需要「覆盖」上游行为的一律放 `hk_vps_4/`，并注明对应上游版本。
2. **引用上游文档一律用 GitHub URL + release tag**（如 `https://github.com/alphaonedev/ai-memory-mcp/blob/v0.10.0/docs/CONFIG_SCHEMA.md`），不用跨仓库相对路径（GitHub 网页上必断链），也不用 main 分支（内容会漂移）或开发 commit（上游重写历史后会消失，见 `deployment_strategy.md` §7.2）。
3. **父仓记录上游对应版本**：**唯一真相源为 `hk_vps_4/upstream.lock`**（tag / commit / 镜像 digest / schema）；`make pin` 打印、`make pin-update` 回写。
4. **secrets 永不入父仓**（公开仓库）：key/AK/密码/私钥只在服务器 `.env` / 密码管理器；模板只含占位符。
5. **公开仓库脱敏**（§9）。

## 6. 备选方案记录（含否决理由）

| 方案 | 结论 |
| --- | --- |
| **物理分仓**（两个独立位置；本计划初版） | 可行的备选。隔离强度略高（物理分离），代价是双工作区来回切换。若未来发现嵌套布局纪律失守，可退回此方案 |
| **git submodule** | 可复现性更强（父仓锁定上游 commit）；但 clone `--recursive` / `submodule update` 摩擦大，升级还要动指针。否决 |
| **git branch overlay**（自有资产放分支，定期 merge 上游） | 每次升级都有合并冲突面；长期偏离 = 事实上 fork。否决 |
| **fork 上游仓库** | 违背「用官方镜像、不改上游」前提。否决 |

## 7. Makefile（父仓根；woodensword 惯例）

```makefile
upstream:            ## 首次/重建上游 clone（gitignored，随生产版本 checkout）
	git clone https://github.com/alphaonedev/ai-memory-mcp.git ai-memory-mcp

pin:                 ## 打印当前上游 tag/commit（回填 deployment-plan.md 用）
	cd ai-memory-mcp && git describe --tags --always

backup:              ## bash hk_vps_4/backup/backup-and-push.sh
restore-drill:       ## bash hk_vps_4/backup/restore-drill.sh
up: / down:          ## 本地栈起停（见 dev-plan.md §3）
```

> `make upstream` 解决「公开父仓不含上游代码」的 bootstrap 问题：新机器/新同事一条命令补齐。

## 8. 迁移步骤（**已执行**，2026-09-20；前置：GitHub 空仓已建）

1. `mv ~/code/ai-memory-mcp ~/code/memory.agent-mate.ai`
2. 父仓初始化：`git init` + 关联 GitHub remote（或先 clone 空仓再搬入）
3. 上游 clone 原样移入 `memory.agent-mate.ai/ai-memory-mcp/`（保留其 `.git` 与 remote）
4. 自有资产移入 `hk_vps_4/`：`docs/ye_cao_yun_production/*` → `hk_vps_4/specs/`；`docs/ye_cao_yun_production/deploy/*` → `hk_vps_4/deploy/`
5. 写 `.gitignore`（`ai-memory-mcp/`）→ **先于任何 `git add`**
6. 修正文档内引用：仓内互引改为 `hk_vps_4/...` 相对路径；上游引用改为 GitHub URL + 固定 tag
7. 验证：父仓 `git status` 仅出现 `hk_vps_4/` 与 Makefile；`ai-memory-mcp/` 内 `git status` 干净、`git pull` 可用
8. `git push` 后在 GitHub 网页确认：父仓**不含任何上游代码**；抽查 3 个上游文档链接可访问且与生产版本一致

## 9. 迁移清单（执行时勾选）

| # | 资产 | 迁移动作 | 状态 |
| --- | --- | --- | --- |
| 1 | 上游 clone 整体 | → `ai-memory-mcp/`（保留 .git） | ✅ |
| 2 | `deployment_strategy.md` | → `hk_vps_4/specs/` | ✅ |
| 3 | `dev-plan.md` | → `hk_vps_4/specs/` | ✅ |
| 4 | 本文档 | → `hk_vps_4/specs/` | ✅ |
| 5 | `hk_vps_4_settings.md` | → `hk_vps_4/specs/` | ✅ |
| 6 | `vps4_new_deployment_instruction.md` | → `hk_vps_4/specs/` | ✅ |
| 7 | `mcp_oss_bak_com_requirements.md` | → `hk_vps_4/specs/` | ✅ |
| 8 | `deploy/`（5 文件） | → `hk_vps_4/deploy/` | ✅ |
| 9 | `backup/` 脚本 | → `hk_vps_4/backup/`（dev-plan.md §4 落地时创建） | ☐ |
| 10 | `.gitignore` + Makefile | 父仓根（先于 git add） | ✅ |
| 11 | 相对引用修正 | 上游 → URL + tag；仓内 → hk_vps_4 路径 | ✅ |
| 12 | 验证 | 两仓 status / pull / push / GitHub 无上游代码 | ✅ |

## 10. 公开仓库脱敏规则

父仓是**公开**的，以下内容**不得**出现：

| 类别 | 处理 |
| --- | --- |
| API key / AK/SK / SSH 私钥 / 密码 | 永不入仓；模板只含占位符，真实值在服务器 `.env` / 密码管理器 |
| 节点公网 IP | 写作 `<VPS4_IP>`；真实值在服务器侧 `secrets.local.*`（不入仓） |
| 运维入口完整 URL | 可保留（DNS 公开可解析）；求稳可写 `<PORTAINER_URL>` |
| 备份桶名 | 写作 `<OSS_BUCKET>`（避免为攻击者提供探测目标） |
| 长期防线 | pre-commit secret 扫描（如 gitleaks） |

> 本文档自身也将进入公开仓库，已按以上规则使用占位符。

## 11. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 迁移遗漏文件 | §9 清单逐项勾选；以两仓 `git status` 干净为完成判据 |
| 公开仓意外提交 secrets | 迁移前逐文件检索；gitleaks 长期防线 |
| 文档断链 | 隔离规则第 2 条（URL + tag）；迁移步骤 6 全量检索 |
| 父仓误吞上游代码（gitlink） | §3 护栏 1–2 |
| 上游 clone 纪律失守（有人改了它） | §3 护栏 4（git status 校验）+ §4 约定；极端情况退回物理分仓 |
| 两仓版本漂移 | §3 护栏 5（`make pin` 自动回填映射） |
| 公开仓外部 issue/PR 骚扰 | README 写明「部署资产仓，不接受功能性 PR」 |

## 12. 决策记录

| 日期 | 决策 |
| --- | --- |
| 2026-09-20 | 确立资产隔离：初版为物理分仓；同日改采**协同布局**（父仓 `memory.agent-mate.ai` 公开仓 + 嵌套 gitignored 上游 clone + `hk_vps_4/` 自有资产）。**迁移已执行（同日，见 §9 清单）。** |
| 2026-09-20 | 新增**版本契约层**：`hk_vps_4/upstream.lock`（单一真相源）+ `specs/upstream_coupling_surface.md`（耦合面清单）+ `scripts/upstream-preflight.sh`（升级准入判定）+ `.github/workflows/upstream-track.yml`（每日跟踪）。§3 护栏 5 与 §5 规则 3 的映射载体由 `deployment-plan.md` 正文改为锁文件；§2 判据补充根目录例外（`.github/workflows/`，平台强制）。 |
| 2026-09-20 | **目录更名**：`hk_vps_4/docs/` → **`hk_vps_4/specs/`**；仓根 `specs/`（ADR / knowledge）并入 `hk_vps_4/specs/`。理由：自有资产（含决议与知识）全部集中在 `hk_vps_4/` 之下，根目录只余基础设施与平台强制路径，§2 判据回到「只有两种归属」。同步清扫全仓路径引用（Makefile / upstream.lock / 预检脚本 / Actions / deploy 文档 / ADR / knowledge）。 |
