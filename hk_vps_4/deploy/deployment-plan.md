# 部署计划 — ai-memory

## 0. Meta

- 应用仓库：`ethanhuangcst/memory.agent-mate.ai`（薄部署资产仓，**公开**——脱敏规则见 `asset_isolation_plan.md` §10）
- 上游镜像来源：`ghcr.io/alphaonedev/ai-memory`（版本坐标与指纹见 `hk_vps_4/upstream.lock`）
- 首次部署 git ref：`main`
- 目标节点：野草云4（`<VPS4_IP>`）
- 运维入口：Portainer `https://portainer4.agent-mate.ai` · NPM `https://nginx4.agent-mate.ai`（**本应用不使用 NPM**）
- Stack 名：`ai-memory-mcp`
- App slug：`ai-memory`
- 公网域名：**无**（本方案无公网 HTTP 入口，客户端走 stdio-over-SSH）
- Cloudflare zone：`agent-mate.ai`（**本应用不新增记录**）

## 1. 架构（运行时）

- 调用者 Cursor → **ssh（密钥 + forced command）** → 节点 → `docker exec -i ai-memory-mcp ai-memory mcp --tier smart`
- 容器内：`serve`（绑 127.0.0.1:9077，仅后台 GC / WAL checkpoint，不对外）+ 独立 curator service
- 持久化：命名卷 `ai_memory_data` → `/data`（SQLite DB、config、密钥、HF 模型缓存）
- 外部依赖：仅 qwen API（**私有 MaaS 端点**，公开仓用占位符 `<QWEN_BASE_URL>`；真实值见 `hk_vps_4/secrets.local.hk_vps_4.md`）

## 2. 服务表

| Service | container_name | Image | 容器端口 | 主机端口 | 公网 | 职责 |
| --- | --- | --- | --- | --- | --- | --- |
| ai-memory | `ai-memory-mcp` | `ghcr.io/alphaonedev/ai-memory:${IMAGE_TAG}` | 9077 | **无** | **否** | HTTP daemon（后台 GC / WAL）；MCP 经 `docker exec` |
| curator | `ai-memory-mcp-curator` | 同上 | — | 无 | 否 | 后台智能整理（dedup / tag / consolidate / reflect） |

## 3. 镜像与 CI

- **本仓库无构建工作流（已批准例外）**：镜像由上游发布，本仓库只消费
- 镜像坐标：`ghcr.io/alphaonedev/ai-memory:${IMAGE_TAG}`
- `IMAGE_TAG` 必须是 GHCR **真实存在**的版本号（当前 `0.10.0`）；**禁用 `latest`**（ADR-002）
- 上游版本升级跟踪责任方：仓库 owner（对照 `../specs/deployment_strategy.md` §6.2 与 `../specs/dev-plan.md` §5）

### 3.1 IMAGE_TAG ↔ 上游 tag / commit / digest 映射

**单一真相源：`hk_vps_4/upstream.lock`**（本表仅为便于阅读；任何不一致以锁文件为准）。

| 项 | 值 |
| --- | --- |
| 上游 release tag | `v0.10.0`（`warn-carrier`，2026-07-12 发布） |
| 上游 release commit | `43c4d4103b3ab59ac7614d99f26acdbdac499043` |
| 镜像 `IMAGE_TAG` | `0.10.0` |
| 镜像清单 digest | `sha256:507d2a5082decb786a7fd38c7b5f6a3cfb4af0e7ab9ad8fa416abdf4bce25e49` |
| 镜像 amd64 digest | `sha256:7e19ae9dcd750d93151c4d4c2b19fef4854b3c8fce9702d079eb79c4520d4364` |
| 指纹校验方式 | `registry-api`（`make preflight ARGS=--with-image`，2026-09-20 实测一致） |
| 数据库 schema | `80`（上游 `src/storage/migrations.rs` 的 `CURRENT_SCHEMA_VERSION`） |
| 参考层 clone | `main` @ `96b8c694`（**注意**：上游 main 与 release tag 提交图不连通，见 `deployment_strategy.md` §7.2） |

> 变更流程：`make preflight` 判定通过 → `make pin-update` 回写锁文件 → 同步本表与 `.env`。
> 升级顺序：**先跑 `make preflight` 读准入结论**（`dev-plan.md` §5.2），再按 §5.1 七步链路执行。

## 4. Compose 契约

- 路径：`docker-compose.prod.yml`
- 无 `build:`；`networks.default.external.name: portainer_network`
- 卷：`ai_memory_data` → `/data`；`./config.toml` → `/data/.config/ai-memory/config.toml:ro`
- 容器内 `HOME=/data`（配置路径由 `$HOME` 推导且无法改写；HF 缓存亦随之落卷）

## 5. 环境变量

| Name | Required | Notes |
| --- | --- | --- |
| `IMAGE_TAG` | yes | 与 GHCR 已有 tag 一致 |
| `DASHSCOPE_API_KEY` | yes | qwen `[llm]` + `[embeddings]` 共用；只放 `.env`，不进 Git |
| `AI_MEMORY_REQUIRE_AGENT_ATTESTATION` | yes（固定 `0`） | v0.9 默认开启会 403 拒绝无签名写入 |
| `HOME` | yes（固定 `/data`） | 决定配置与模型缓存路径 |
| `AI_MEMORY_DB` | yes（固定 `/data/ai-memory.db`） | — |
| `APP_URL` | **N/A** | 本应用无公网 HTTP 入口 |

> ⚠️ **端点与模型不在环境变量里**：私有 MaaS 端点写 `config.toml` 的 `[llm].base_url`
> 与 `[embeddings].base_url`，嵌入维度写 `[embeddings].dim` —— **`dim` 不存在任何
> 环境变量**，只能落配置文件（见 `config.toml.tmpl`）。这也是「模型设置」以 config
> 为单一真相源的原因。

## 6. 数据库

- 引擎：**SQLite**（容器内 `/data/ai-memory.db`，WAL 模式），命名卷 `ai_memory_data`
- **无外部数据库实例**；官方镜像不含 `sal-postgres`，走 Postgres 需自建镜像（见方案文档 §8.3 毕业触发条件）
- 迁移：**无需迁移**——SQLite 首次启动自建；后续升级自动前向迁移
- 隔离声明：独立命名卷，不与其他应用共享任何存储

## 7. DNS 与 TLS

**N/A —— 本方案无公网 HTTP 入口。**

- 不新增 Cloudflare 记录；不新增 NPM Proxy Host；不申请证书
- 若未来开放 HTTP：域名 `memory.agent-mate.ai`（zone `agent-mate.ai`，运维已批准）+ NPM Forward `http://ai-memory-mcp:9077` + `proxy_buffering off` + 加长 read/send 超时，且必须补 `api_key` + `AI_MEMORY_REQUIRE_API_KEY=1`

## 8. 反代附加项

**N/A**（无反代）。

## 9. 冒烟清单

- [ ] `docker ps --filter name=ai-memory-mcp` 两容器 running
- [ ] `docker exec ai-memory-mcp curl -sf http://127.0.0.1:9077/api/v1/health`
- [ ] `ai-memory doctor`：LLM Reachability 显示 `qwen` / `qwen-plus` / base_url 为私有 MaaS；Embeddings Reachability 显示 `qwen` / `qwen3.7-text-embedding`，且嵌入器加载为 **1024-dim**
- [ ] `curator --once --dry-run --json`：报告 `tagged > 0`
- [ ] 调用者模拟：`echo '<initialize>' | ssh ai-memory` 返回 JSON-RPC 响应
- [ ] 机器 A 写入记忆 → 机器 B 检索命中（跨客户端共享）
- [ ] 抽查 `portainer4` / `nginx4` 未被改动；确认未新增 DNS/NPM 记录
- [ ] 抽查野草云4 既有应用：**首发，无既有应用可抽查**

## 10. 隔离清单（首次部署前）

- [ ] Stack / 容器名 / 卷名不与野草云4 既有应用冲突（当前应用栈为空）
- [ ] **不重建 `portainer_network`**
- [ ] **不新增** Cloudflare / NPM 记录（本方案无公网入口）
- [ ] 不编辑其他 NPM Host；不改 `portainer4` / `nginx4` 记录
- [ ] 不触碰野草云3（`<VPS3_IP>`）
- [ ] SSH 使用单建受限用户 + forced-command 密钥，不使用 root

## 11. 运维注意（应用特有）

- **三个静默失败点必须逐次核对**：① embedder 降级（不报错，召回变差）② curator `tagged=0`（fail-open）③ config 挂载路径错误（tier 退回 semantic）
- 首次语义检索会一次性下载 ~90MB 模型权重（HOME=/data 后缓存持久化，不再重复）
- 备份：`ai-memory backup --to /data/backups --keep 48`；**必须外迁**（同卷同故障域）；外迁后做 restore 演练
- 升级：改 `IMAGE_TAG` → Portainer Recreate（勾选重新拉取）；迁移前自动生成 pre-migration 快照
- 回滚：pre-migration 快照覆盖 `/data/ai-memory.db`（清 `-wal`/`-shm`）+ 旧版 IMAGE_TAG
- 并发写出现 `database is locked` → curator 改 cron + `--once`；持续出现则按方案文档 §8.3 评估迁 Postgres
