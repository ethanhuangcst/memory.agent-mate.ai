# dev-plan — ai-memory 生产部署与升级计划

> **状态：** 计划待审核 —— **文档内描述的部署动作均未执行**
> **范围变更：** mcp.oss-bak.com（多租户备份 MCP）已从本计划**移出**，另建项目单独建设；其需求规格见 [`mcp_oss_bak_com_requirements.md`](./mcp_oss_bak_com_requirements.md)。备份回归**默认方案**（§4）。
> **关联：** [`deployment_strategy.md`](./deployment_strategy.md)（决议真相源） · [`asset_isolation_plan.md`](./asset_isolation_plan.md)（资产隔离） · [`hk_vps_4_settings.md`](./hk_vps_4_settings.md) · [`vps4_new_deployment_instruction.md`](./vps4_new_deployment_instruction.md)
> **as_of：** 2026-09-20

---

## 1. 范围变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-20 | mcp.oss-bak.com（多租户备份 MCP）移出本计划，另建项目；需求规格移交至 [`mcp_oss_bak_com_requirements.md`](./mcp_oss_bak_com_requirements.md)。备份回归默认方案（§4）。新增上游升级策略（§5） |
| 2026-09-19 | 初版方向：SQLite 卷 + 官方镜像 + smart(qwen) + stdio-over-SSH（详见 deployment_strategy.md 决议表） |

## 2. 背景与已确认决议

全部决议见 [`deployment_strategy.md`](./deployment_strategy.md) §0 决议表，此处不复述。与本计划直接相关的关键约束：

- **存储**：SQLite 命名卷（官方镜像不含 `sal-postgres`，走 Postgres 需自建镜像）
- **镜像**：`ghcr.io/alphaonedev/ai-memory:0.10.0`（固定版本，禁用 `latest`；消费上游官方镜像 = 已批准例外，本仓库无构建工作流）——**版本坐标与镜像指纹的唯一真相源是 [`../upstream.lock`](../upstream.lock)**，本文档不再各自抄写
- **tier**：`smart`；LLM = qwen（DashScope）主 `qwen-plus` + `[llm.auto_tag]` 仅覆盖 model 为 `qwen-turbo`（**不写 backend**）；embedder 走 API 且**必须显式 `[embeddings].dim`**（DashScope 模型不在 `KNOWN_EMBEDDING_DIMS` 表内）
- **客户端接入**：stdio-over-SSH（forced-command，无公网 HTTP 入口）——因此无域名 / NPM / HTTPS / api_key
- **容器**：`HOME=/data`（配置路径由 `$HOME` 推导且无法改写）；`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`（v0.9 可用性前提）；`serve` 绑 `127.0.0.1`
- **上游文档陷阱**：`/mcp`、`/sse` 端点不存在；`[llm.auto_tag]` 样例的 `ollama` 会打挂 LLM 功能（详见 deployment_strategy.md §7）

## 3. ai-memory 生产部署（野草云4）

制品已就绪：`../deploy/`（`docker-compose.prod.yml`、`config.toml.tmpl`、`.env.prod.example`、`README.md`、`deployment-plan.md`）——已随资产迁移入库（见 [`asset_isolation_plan.md`](./asset_isolation_plan.md) §8）。

### 3.1 前置条件（预检）

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | DashScope API key | ☐ 待提供 |
| 2 | DashScope embedding `model` 与 `dim`（填入 config.toml 后必须跑 doctor 探针验证） | ☐ 待提供 |
| 3 | SSH 密钥对（调用者 ↔ 野草云4，forced-command） | ☐ 待生成 |
| 4 | 单建受限用户 `aimem-ssh`（docker 组，不用 root） | ☐ 待执行 |
| 5 | 部署仓库建立并 push（见 asset_isolation_plan.md §6） | ✅ 已执行（公开仓 `ethanhuangcst/memory.agent-mate.ai`，`main` 已推送） |
| 6 | 上游版本契约（锁文件 + 耦合面清单 + 预检脚本 + 跟踪 Action） | ✅ 已交付（见 §5；`upstream.lock` / `upstream_coupling_surface.md` / `upstream-preflight.sh` / `.github/workflows/upstream-track.yml`） |

### 3.2 部署顺序（映射 vps4_new_deployment_instruction.md §3 八步）

| 步 | 动作 | 本应用取值 |
| --- | --- | --- |
| 0 | 预检 | 镜像 `ghcr.io/alphaonedev/ai-memory:0.10.0`；stack `ai-memory-mcp`；无公网端口；无 DB 迁移 |
| 0b | 隔离门禁 | 与既有应用无冲突；**不新增 DNS / NPM Host**；不重建 `portainer_network` |
| 1 | Compose | `/opt/ai-memory-mcp/docker-compose.prod.yml`；仅 `image:`；`external: portainer_network` |
| 2 | CI→GHCR | **不适用**（消费上游官方镜像，例外条款留痕） |
| 3 | Env | `.env` 含 `DASHSCOPE_API_KEY`、`IMAGE_TAG=0.10.0`；config.toml 只读挂载 |
| 4 | DB | 无需迁移（SQLite 首启自建） |
| 5 | Portainer | `portainer4` → 仅部署 stack `ai-memory-mcp` |
| 6 | Cloudflare | **不适用** |
| 7 | NPM | **不适用** |
| 8 | 冒烟 | §3.3 |

### 3.3 冒烟与验收

```bash
docker ps --filter name=ai-memory-mcp --format '{{.Status}}'          # 两容器 running
docker exec ai-memory-mcp curl -sf http://127.0.0.1:9077/api/v1/health
docker exec ai-memory-mcp ai-memory doctor                             # LLM / Embeddings Reachability
docker exec ai-memory-mcp-curator ai-memory curator --once --dry-run --json   # tagged > 0
echo '{"jsonrpc":"2.0","id":1,"method":"initialize",...}' | ssh ai-memory     # MCP 通路
```

端到端：机器 A 写入 → 机器 B 检索命中（跨客户端共享）。

### 3.4 三个静默失败点（每次改动后必查）

1. **embedder 降级**：初始化失败静默降级为 keyword（不报错）→ 查 boot banner / doctor Embeddings Reachability
2. **curator fail-open**：解析不到 LLM key → 每轮 `tagged=0`（不报错）→ 查 JSON 报告计数
3. **config 挂载路径错误**：路径由 `$HOME` 推导 → tier 静默退回 semantic → 确认 `HOME=/data` 与挂载点一致

## 4. 默认备份方案

### 4.1 组成

| 层 | 机制 | 覆盖的故障 |
| --- | --- | --- |
| 本地快照 | `ai-memory backup --to /data/backups --keep 48`（VACUUM INTO + sha256 清单；小时级 cron） | 运维失误（误删/误改） |
| 外迁 | cron + ossutil → OSS **香港 region** 私有桶（每日校验） | 节点故障（与本地同域，必须外迁才闭环） |
| 恢复 | `ai-memory restore --from`（先校验 manifest sha256） | — |

### 4.2 云资源（一次性准备）

- OSS 私有桶（香港 region，开 SSE）
- RAM 子账号：**仅** `oss:PutObject` / `oss:GetObject` / `oss:ListObjects`，资源限定 `acs:oss:*:*:<bucket>/<prefix>/*`
- 服务器装 ossutil；AK 走 `0400` 配置文件或环境变量，**永不进 argv、永不入仓**

### 4.3 脚本（部署时创建于部署仓库 `backup/`）

- `backup-and-push.sh`：`ai-memory backup` → 校验 manifest sha256 → `ossutil cp` → 回读远端 hash 比对 → 失败非零退出 + 日志
- `restore-drill.sh`：从 OSS 拉最新快照 → sha256 校验 → `ai-memory restore` → `ai-memory doctor` 通过。**可重复执行；每季度跑一次**

### 4.4 已知窗口（接受）

外迁链路就绪前，备份仅覆盖本地（同故障域）——节点故障 = 数据丢失。**部署顺序上把 §4.2/4.3 排在冒烟之后立即执行，不要拖延。**

## 5. 上游升级策略（最小耦合）

### 5.0 三件套与责任划分

升级治理由三个制品承载，**单向依赖、各司其职**：

| 制品 | 角色 | 谁维护 |
| --- | --- | --- |
| [`../upstream.lock`](../upstream.lock) | **制品层**：唯一版本坐标（release tag / commit / 镜像 tag+digest / schema / 沉淀期阈值） | `make pin-update` 回写；人工审阅提交 |
| [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) | **契约层**：本部署依赖上游的每个契约点 + 敏感度 + 检测方法 | 人工；上游契约变更时同步 |
| [`../scripts/upstream-preflight.sh`](../scripts/upstream-preflight.sh) | **执行层**：判定"能不能升"，产出报告与退出码 | 人工；判据变更时同步本 §5.2 |

**提醒层**：`.github/workflows/upstream-track.yml` 每日比对上游 latest release 与锁文件，不一致即自动开 issue —— **只提醒，不升级**。部署决策与执行**始终人工**。

### 5.1 七步链路（人工触发）

```text
① 跟踪 → ② 预检（准入判定） → ③ 本地灰度 → ④ 生产升级 → ⑤ 验证 → ⑥ 回滚预案 → ⑦ 文档同步
```

| 步 | 动作 | 命令 / 依据 |
| --- | --- | --- |
| ① | **跟踪**：Actions 每日比对上游 latest release 与锁文件；不一致按准入结论开 issue（`upstream-unstable` / `ready-to-upgrade`） | `.github/workflows/upstream-track.yml` |
| ② | **预检**：跑准入判定，读报告。**命中硬性阻断即停止**（输出「该版本尚不稳定，不适合更新」） | `make preflight`（加 `ARGS=--with-image` 启用镜像指纹与「标签被重推」检测） |
| ③ | **本地灰度**：用**生产快照副本**对新镜像先跑迁移，观察迁移日志；`--with-image` 跑 `ai-memory --help` / `doctor` 与耦合面清单比对（W3） | `docker run` 临时容器 + 快照副本 |
| ④ | **生产升级**：`make pin-update` 回写锁文件 → 改服务器 `.env` 的 `IMAGE_TAG` → Portainer Recreate（勾选重新拉取）→ 迁移自动执行（自动生成 pre-migration 快照） | `deploy/README.md` §升级 |
| ⑤ | **验证**：doctor 三静默失败点（§3.4）+ §3.3 冒烟 + **§5.4 备份管线探针** | `ai-memory doctor` |
| ⑥ | **回滚预案**：pre-migration 快照**覆盖** `/data/ai-memory.db`（清 `-wal`/`-shm`）+ `IMAGE_TAG` 改回旧版 → Recreate。⚠️ **快照覆盖不可省略**（见 §5.6） | §5.6 |
| ⑦ | **文档同步**：`deployment_strategy.md` §9 变更记录 + `deploy/deployment-plan.md` §3.1 映射表 | — |

### 5.2 稳定性准入判据（`make preflight` 求值）

**这些判据的规格在本节；执行体是 `scripts/upstream-preflight.sh`（两者变更必须同步）。**
退出码契约：`0` 无新版 · `2` 命中硬性阻断 · `3` 可评估升级 · `1` 运行错误。

#### 5.2.1 硬性阻断（任一命中即不通过）

| 编号 | 判据 | 判定方式 |
| --- | --- | --- |
| **H1** | 非预发布版（`prerelease=false` 且 `draft=false`） | releases API。上游 `release.yml` 明确：SemVer `-` 后缀的预发布版**不产出 GHCR 镜像**，升了也拉不到 |
| **H2** | 沉淀期 ≥ `SOAK_DAYS_MIN`（锁文件，默认 **14 天**） | `published_at` 与当前时间。新版本暴露缺陷需要时间窗口 |
| **H3** | GHCR 上存在对应 tag 的镜像 | registry v2 manifest（需 `--with-image`）。无镜像 = 无法部署 |
| **H4** | 候选版本不早于当前所钉版本 | 版本号比较，防"升级"成降级 |
| **H5** | 存在新鲜外迁备份（**服务器侧人工确认**） | `ossutil ls` 比对最新快照时间戳与 sha256 |

#### 5.2.2 人工确认项（不阻断，但必须逐条读）

| 编号 | 判据 | 处置 |
| --- | --- | --- |
| **W1** | CHANGELOG 命中破坏性关键词（`secure-default` / `fail-open → fail-closed` / `Removed` / `Deprecated` / `breaking` / `erratum` / `default flip` …） | 逐条核对是否触及本部署（见 §5.3 四类） |
| **W2** | 数据库 schema **前向迁移**（候选 `CURRENT_SCHEMA_VERSION` > 锁文件基线） | 迁移前向-only，且 v34/v50/v54 不可逆 → 回滚只能靠快照（§5.6） |
| **W3** | 契约面差异（新镜像的 CLI / 环境变量 / 配置字段与 [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) 不符） | 按清单敏感度逐项处置；**高敏感=静默失败**优先 |
| **W4** | 镜像指纹与锁文件不一致（**标签被重推**） | 同一 tag 内容已变 → 视为供应链事件，人工审阅后再决定 |
| **W5** | 跨 ≥2 个 minor（或跨 major） | 跨度越大灰度越慎重 |
| **W6** | 候选 commit 存在失败 check-run | **不阻断**：我们消费镜像，而"构建成功"已由 H3 证明；上游同一 commit 还跑 npm / PyPI / Homebrew / mobile 等与本部署无关的 job（v0.10.0 即为此例） |

#### 5.2.3 提示话术（用户可见，禁止改写语义）

```
❌ 准入判定：不通过
   ai-memory vX.Y.Z —— 该版本尚不稳定，不适合更新
   不满足 H2 沉淀期 ≥ 14 天：已发布 3.2 天（阈值 14 天）
   建议：沉淀期不足：建议 2026-10-05 之后重跑 make preflight。
```

`--json` 输出同语义（`verdict: "unstable"`，`exit_code: 2`），供 Actions 分流。

### 5.3 四类破坏性变更（W1 命中后逐类核对）

| 类别 | 历史证据 | 核对动作 |
| --- | --- | --- |
| **secure-by-default 翻转** | v0.9 把 attestation 翻成默认收紧；0.10.0 是 v1.0.0 翻转的 WARN-carrier | 重验 `.env` / `config.toml` 每项假设仍成立 |
| **config schema 变更** | legacy flat 字段已移除；有 `ai-memory config migrate` | 跑 `config migrate --dry-run` 看差异 |
| **CLI / MCP 契约变更** | `backup`/`restore` 参数、profile 工具数（core=7）、Cursor 40 工具上限 | 核对 Cursor MCP args、curator/CLI 调用（§5.5） |
| **上游历史重写**（2026-09-20 新增） | `main` 与 release tag 提交图不连通（`deployment_strategy.md` §7.2） | **禁用 `git diff/log` 做版本差异**；只用 releases API + CHANGELOG + 镜像指纹 |

### 5.4 升级后备份管线探针（必做）

手动跑一次 `ai-memory backup` + 确认 ossutil 上传成功 —— 验证备份管线在新二进制下仍工作，是 `backup` CLI 契约变更的检测探针。

### 5.5 与备份外迁脚本的耦合点

`backup-and-push.sh` / `restore-drill.sh` 直接调用 `ai-memory backup` / `restore` —— 上游改这两个命令的参数/行为即断裂。**列入每次升级预检**（耦合面清单 I1–I6）；脚本内置 `--help` 快照比对可提前发现。

### 5.6 回滚（§6.2 订正后的强制流程）

```bash
# 1) 停容器
# 2) 找到 pre-migration 快照：ls /data/*.pre-migration-*.bak
# 3) 【必须】用快照覆盖 /data/ai-memory.db，并清掉 -wal / -shm 兄弟文件
# 4) 改 .env 的 IMAGE_TAG 回旧版本 → Portainer Recreate
```

> ⚠️ **第 3 步不可省略。** 「旧二进制会拒绝启动于更新的库」这一假设**已由源码证伪**
> （`src/storage/migrations.rs:1507`：`version >= CURRENT_SCHEMA_VERSION` 时直接 `Ok(())`，全 `src` 无拒绝逻辑）。
> 只改 `IMAGE_TAG` 的"回滚"会让旧二进制静默操作它不认识的 schema → **可能损坏数据**。
> 详见 [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) J3 与 `deployment_strategy.md` §6.2/§6.3。

## 6. 风险登记

| # | 风险 | 缓解 |
| --- | --- | --- |
| 1 | embedder 静默降级 | doctor 每次改动后核对 |
| 2 | curator fail-open | `--once --dry-run --json` 核对 `tagged > 0` |
| 3 | config 路径静默失效 | `HOME=/data` + 挂载点一致性检查 |
| 4 | 外迁未就绪窗口（节点故障丢数据） | 部署后立即执行 §4.2/4.3；升级门禁兜底 |
| 5 | 上游 secure-default 再翻转 | §5.3 预检清单第一优先级 |
| 6 | 公开仓库泄露 secrets | asset_isolation_plan.md §10 脱敏规则 + gitleaks |
| 7 | **上游重推同名镜像 tag**（同 tag 内容变） | 锁文件记录 digest；`make preflight ARGS=--with-image` 的 W4 检测一致性与否 |
| 8 | **上游再次重写历史**（main 与 tag 再次不连通） | 文档引用限 release tag（不用 main / 开发 commit）；版本差异只用 releases API + CHANGELOG + 镜像指纹（§5.3 第四类） |
| 9 | 升级闸门因**无关 check-run 失败**被误阻断 | W6 已降级为人工确认项，不参与硬性阻断（H1–H5） |
| 10 | 回滚时误判"旧二进制会拒绝启动"而省掉快照覆盖 | §5.6 强制流程 + 耦合面清单 J3；该假设已于 2026-09-20 证伪 |

## 7. DoD 对照（用户 dod 规则）

| dod 项 | 本计划的落实 |
| --- | --- |
| 测试通过 | §3.3 冒烟 + §5.3 探针 + 恢复演练脚本 |
| 验收标准（AC）落实 | §3.3 / §4.3 / §5 各验收条目 |
| 前后端端到端集成 | 机器 A 写 → 机器 B 检索（跨客户端共享）|
| 错误处理 / 边界 | §3.4 三静默失败点；`database is locked` 处置（见 deployment_strategy.md §6.4） |
| 真实集成，无 mock | 全部真实组件（DashScope / OSS / SSH）；无 mock |
| 用户确认可用 | §3.3 完成后向用户演示并确认 |
| 文档同步 | deployment_strategy / dev-plan / 部署仓库 README |
| 回顾（retrospective） | 部署完成后按 dod 规则执行 |

## 8. 执行清单（按序）

| # | 动作 | 依赖 |
| --- | --- | --- |
| 1 | 父仓初始化 + 资产迁移（asset_isolation_plan.md §8；含 `.gitignore` 护栏与 Makefile） | ✅ 已完成 |
| 2 | 云资源：DashScope key、embedding model/dim 确认、OSS 桶 + RAM | ☐ |
| 3 | 服务器：受限用户 + SSH forced-command + `/opt/ai-memory-mcp` 落地 | ☐ |
| 4 | Portainer 部署 stack + 冒烟（§3.3） | 1–3 |
| 5 | 备份：ossutil + 脚本 + cron + 首次外迁 + **恢复演练**（§4） | 4 |
| 6 | 客户端：Cursor MCP 配置 + 双机共享验证 | 4 |
| 7 | 版本跟踪 Action 上线（§5.1①） | ✅ 已交付（`.github/workflows/upstream-track.yml`；**push 到远端后**才会按计划触发） |
| 8 | 版本契约三件套（锁文件 / 耦合面清单 / 预检脚本，§5.0） | ✅ 已交付（`make preflight` / `make preflight-test` 已可跑） |
