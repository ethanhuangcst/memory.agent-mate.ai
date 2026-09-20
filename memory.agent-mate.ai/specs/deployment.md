# deployment — memory.agent-mate.ai 部署与运维

> **状态**：v2.0（specs 整合版） · as_of 2026-09-20
> **真相源**：`../deploy/docker-compose.prod.yml` · `../upstream.lock` · [`architecture.md`](./architecture.md) §2（决议单点）
> **范围**：服务器落地 / 配置 / 冒烟 / 备份与恢复 / 升级与回滚 / 排障 —— 同时覆盖 MCP 侧与门户侧。**隔离约束**见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5–§6，**门户部署门禁**见 [`web-portal/web-design.md`](./web-portal/web-design.md) §7.3 与 [`web-portal/web-test.md`](./web-portal/web-test.md)
> **脱敏**：真实 IP / 端点 / 凭证一律占位符（`<VPS4_IP>` 等），值在 gitignored 的 `secrets.local*.md`

---

## 1. 前置与依赖

| 层 | 要求 |
|---|---|
| 服务器 | Ubuntu 22.04+，已装 Docker + Compose，能拉 `ghcr.io` |
| 仓内 | `memory.agent-mate.ai/deploy/` 三个事实文件：`docker-compose.prod.yml`（compose 契约唯一真相源）· `config.toml.tmpl`（配置模板）· `.env.prod.example`（密钥样例） |
| 密钥 | qwen MaaS API key（私有 workspace base_url）· 用户 SSH 公钥（Sprint 3+） |
| 本地 | `docker` CLI；无 compose 插件时脚本自动回退 `docker-compose` |
| 纪律 | 改 `.gitignore` 之后才能 `git add -A`；提交前 `make secret-check`（pre-commit 已挂） |

---

## 2. 服务器落地清单

| # | 项 | 是否必需 |
|---|---|---|
| 1 | 创建数据目录 `/opt/ai-memory/data/` | **必需** |
| 2 | 落地 `docker-compose.prod.yml` 到 `/opt/ai-memory/` | **必需** |
| 3 | 重命名 `config.toml.tmpl` → `config.toml` 并改三处（见 §5.2） | **必需** |
| 4 | 落地 `.env`（GLM/Qwen/DASHSCOPE key，**只设本轮用的**） | **必需** |
| 5 | `docker compose config`（语法自检） | **必需** |
| 6 | `docker compose up -d` | **必需** |
| 7 | 从日志确认 embedder / LLM（**不 curl**：镜像无 curl，见 §7.1） | **必需** |
| 8 | 端到端冒烟（写入 → 重新连接 → 语义召回） | **必需** |
| 9 | 备份（宿主机快照 → 外迁） | 待办 |
| 10 | Cloudflare Access + 反向代理 | 门户阶段 |

**明确不需要**：Dockerfile · 自建镜像 · 官方镜像外的额外镜像层 · 额外 volumes（一个卷足够）· 额外网络声明（默认网络足够）· `postgres` / `redis` 服务 · 任何上游源码改动。

---

## 3. 部署八步（与产品决策文档的步骤映射）

| # | 步骤 | 产出 | 对应决策 |
|---|---|---|---|
| 1 | 装环境 | Docker + Compose | 宿主机 1 |
| 2 | 建目录 | `/opt/ai-memory/data/` | 宿主机 1 |
| 3 | 落地 compose | 服务拓扑 | 存储选型 ① |
| 4 | 改 config | 三个断点修好 | 存储选型 ② |
| 5 | 写 env | 密钥就位 | v2.0 新增 |
| 6 | 启动 | 容器健康 | 存储选型 ③ |
| 7 | 确认 LLM/嵌入 | 智能功能已启用 | v2.0 新增 |
| 8 | 冒烟 | 端到端可用 | 存储选型 ④ |

---

## 4. 服务器侧落地命令

### 4.1 目录与文件

```bash
sudo mkdir -p /opt/ai-memory/data
# compose → /opt/ai-memory/docker-compose.prod.yml
# config  → /opt/ai-memory/config.toml（由 config.toml.tmpl 改名并改三处，见 §5.2）
# env     → /opt/ai-memory/.env（由 .env.prod.example 改名填值；chmod 600）
```

### 4.2 专用系统账号（Sprint 3 起）

```bash
sudo useradd -m -s /bin/bash aimem-ssh
sudo mkdir -p /home/aimem-ssh/.ssh
sudo -u aimem-ssh ssh-keygen -t ed25519 -N '' -C 'mcp-forced-command-identity' -f /home/aimem-ssh/.ssh/id_ed25519
sudo install -m 600 -o aimem-ssh -g aimem-ssh /dev/null /home/aimem-ssh/.ssh/authorized_keys
```

### 4.3 强制命令

**主人（默认库）** —— `sudo vim /home/aimem-ssh/.ssh/authorized_keys`：

```text
command="docker exec -i ai-memory-mcp ai-memory mcp --tier smart",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding <PUBKEY>
```

**用户（一用户一库，逐行追加）** —— 完整模板与逐项解释见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2：

```text
command="docker exec -i -e AI_MEMORY_DB=/data/users/alice/ai-memory.db -e AI_MEMORY_AGENT_ID=human:alice -e AI_MEMORY_KEY_DIR=/data/users/alice/keys -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0 ai-memory-mcp ai-memory mcp --tier smart",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding <PUBKEY>
```

> 逐行追加 = 最小侵入、易审计、可回滚（**不要**整文件重写，一次拼错会连带整个文件失效）。

### 4.4 sudoers（受限）

```bash
echo "aimem-ssh ALL=(root) NOPASSWD: /usr/bin/docker exec -u 0 -i ai-memory-mcp mkdir -p /data/users/*, /usr/bin/docker exec -u 0 -i ai-memory-mcp chown ai-memory /data/users/*" \
  | sudo tee /etc/sudoers.d/aimem-ssh
sudo chmod 440 /etc/sudoers.d/aimem-ssh && sudo visudo -c
```

### 4.5 目录与权限

```bash
sudo docker exec -u 0 ai-memory-mcp mkdir -p /data/users/alice
sudo docker exec -u 0 ai-memory-mcp chown ai-memory /data/users/alice
```

---

## 5. compose 契约与配置

### 5.1 compose 契约（摘自 `../deploy/docker-compose.prod.yml`）

| 契约 | 值 | 说明 |
|---|---|---|
| 卷 | `ai_memory_data:/data` | 容器重启保留全部状态 |
| 容器名 | `ai-memory-mcp` | forced command 硬编码此名 |
| 重启策略 | `unless-stopped` | 服务常驻 |
| 端口映射 | **无** | 容器端口不映射主机（SSH 接入不需要） |
| 配置来源 | **环境变量，不挂 config 文件** | 规避挂载失败静默降级 |
| 默认库 | `/data/ai-memory.db` | HOME=/data 推导 |
| 特性 | 官方默认（`sqlite-bundled`） | **不含 postgres** |
| curator 命令 | `curator --sqlite-path /data/ai-memory.db --auto-tag --poll-interval 60 --skip-setup-wizard` | 后台智能整理 |
| 拉取策略 | 显式 `image: ghcr.io/alphaonedev/ai-memory:<tag>`（**禁用 latest**） | 与锁文件指纹一致 |

### 5.2 `config.toml` 三个必改点（否则静默失败）

| # | 断点 | 修复 |
|---|---|---|
| 1 | 嵌入模型不适配（默认 `BAAI/bge-small-zh` 与我的库不符） | 改 `[embeddings].model` / `.dim` |
| 2 | 未显式指定 dim（无环境变量，只能写配置） | `dim = **1024**`（qwen3.7-text-embedding；**静态常量，改了必须重建**） |
| 3 | LLM 端点指向默认（默认 dashscope 公网端点，不是私有 MaaS） | `[llm]` **显式** `base_url = "<QWEN_BASE_URL>"`、`model = "qwen-plus"`；`[llm.auto_tag]` **只写 model** = `qwen-turbo`（**不写 base_url** → 继承「修正后的」主 LLM 端点，避免照抄上游 `backend="ollama"` 导致静默全挂） |

### 5.3 `config.toml` 关键字段

| 节 | 字段 | 值 |
|---|---|---|
| `[llm]` | `backend` | `openai` |
| | `base_url` | `<QWEN_BASE_URL>`（**必须显式覆盖**） |
| | `model` | `qwen-plus`（便宜档；`qwen-max` 仅当万不得已） |
| | `max_tokens` | `2000` |
| | `temperature` | `0.3` |
| `[llm.auto_tag]` | `model` | `qwen-turbo`（**只写 model**；`enabled` / `temperature` 默认 true / 0.1） |
| `[embeddings]` | `provider` | `fastembed` |
| | `model` | `qwen/Qwen3-Embedding-0.6B` |
| | `dim` | **`1024`** |
| `[storage.sqlite]` | `pool_size` | `10` |
| `[memory]` | `max_age_days` | 保留默认（`0` = 仅软删除） |
| `[context_optimizer]` | `max_results` | 保留默认 5（或 10） |
| `[server]` | `api_key` | **不设置**（不对外暴露 HTTP API） |

> **两个静态常量，改了必须重建**：`[embeddings].dim` 与 `[storage].embedding_dim`。

### 5.4 `.env` 只设本轮用到的 key

```text
DASHSCOPE_API_KEY=<填>     # 嵌入（provider 为 fastembed 时经 dashscope 兼容层）
GLM_API_KEY=<填>           # LLM（若 backend 走 glm）
QWEN_API_KEY=<填>          # 私有 MaaS
```

> 官方镜像**不读** `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_BASE_URL`（在 `AI_MEMORY_LLM_*` 体系外）。

---

## 6. 调用者侧

### 6.1 `~/.ssh/config`

```sshconfig
Host ai-memory
  HostName <VPS4_IP>
  Port <SSH_PORT>
  User aimem-ssh
  IdentityFile ~/.ssh/id_ed25519
  IdentitiesOnly yes
```

### 6.2 `mcp.json`

```json
{
  "mcpServers": {
    "ai-memory": {
      "command": "ssh",
      "args": ["ai-memory"]
    }
  }
}
```

> **不需要** `cwd` / `env` / `url` / `headers`。`args` 与本地调试的唯一差别是去掉 `-v`（避免污染 stdout）。

### 6.3 本地基线

```bash
bash scripts/local-up.sh       # 拉起本地 ai-memory
bash scripts/mcp-smoke.sh      # MCP 协议冒烟（握手 → 工具 → 记忆写入 → 跨进程语义召回）
bash scripts/iso-probe.sh      # 多用户隔离探针（A/B/C 组，P1a–P6），exit 0 为准入条件
make curl-probe                # 参考用：直连容器 HTTP API 探针（生产无此通道）
```

---

## 7. 冒烟与验收

### 7.1 启动后确认（**不用 curl**）

镜像内**不含 curl/wget**，容器内 HTTP 探测无法 exec。就绪与功能判据：

| 目标 | 判据 |
|---|---|
| 服务就绪 | `docker logs` 中出现 `ai-memory listening on` |
| 嵌入模型 | `docker exec ai-memory-mcp ai-memory doctor` 输出 `维度: 1024` / `1024-dim` |
| LLM 联通 | 写入一条记忆后 `ai-memory doctor` 或日志显示 tagging 成功 |
| 档位生效 | `doctor` 输出 `tier: smart` |

### 7.2 三个静默失败点（每次改动后必查）

| # | 触发条件 | 症状 |
|---|---|---|
| **S1** | 私有 MaaS 端点不通 | 写入报 `Embedding call failed` → **降级为 keyword 检索**，接口仍返回成功 |
| **S2** | curator 的 LLM 调用失败 | **fail-open**：不重试不告警，记忆**永久停留在** `tagged=0`，自动打标/归并/矛盾检测静默失效 |
| **S3** | config 挂载失败（路径错/格式错/权限错） | 配置**静默落空**，档位**退化为 semantic**，接口仍返回成功 |

> 加隔离侧 **R1**（会话漏设 `AI_MEMORY_DB` → 落共享主库）后共四个静默点，详见 [`architecture.md`](./architecture.md) §4.1 与 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §0。

### 7.3 端到端冒烟七项

1. `ssh ai-memory` 通（不被强制命令拒绝、不要求密码）
2. `mcp-smoke.sh` 退出码 0
3. 写入一条测试记忆
4. **断开后重新连接**，语义召回能命中刚写入的记忆（等价「重启不丢」）
5. `docker restart ai-memory-mcp` 后数据仍在
6. curator 日志显示 `tagged` 数增长（非 0）
7. `ai-memory doctor` 双通道 200 + `1024-dim` + `tier: smart`

> 端到端验收脚本由 Sprint 5 编写；MCP 协议层用例见 [`mcp/mcp-test.md`](./mcp/mcp-test.md)。

---

## 8. 备份与恢复

| 项 | 方案 |
|---|---|
| 备份对象 | 容器内 `/data`（SQLite + config + keys + cache） |
| 目录 | `/data/backups`（备份脚本 Sprint 5 落地到 `memory.agent-mate.ai/backup/`） |
| 本地快照 | `sqlite3 /data/ai-memory.db ".backup '/data/backups/ai-memory-<ts>.db'"`（**在线备份首选**，非 `cp` 裸文件） |
| 频率 | **每日 1 次**（对齐 RPO ≤ 24h）；留存 ≥ 30 份，带时间戳 |
| 外迁 | **每日**同步到 OSS 兼容对象存储 `<OSS_BUCKET>`；同步后**校验 `sha256sum` 一致** |
| 恢复演练 | 每月一次：拷贝 → 起临时实例 → 抽样检索验证 |
| 每用户库 | **必须一起备份**：`/data/users/<handle>/ai-memory.db` |
| 告警 | 备份失败 / 大小异常 / 恢复演练失败均告警 |

> **恢复铁律**：恢复会**覆盖当前数据**；恢复前**先备份当前状态**，再执行恢复。

---

## 9. 升级治理

### 9.1 三件套

```bash
bash scripts/check-upstream.sh                      # 看上游有没有新版本
bash scripts/diff-upstream.sh <ref-or-tag>          # 看差异，人工判断是否锁
bash scripts/pin-update.sh <ref> [--force]          # 更新锁文件（--force 用于绕过 dirty 检查，须人工确认）
```

### 9.2 七步升级流程

1. 执行 `check-upstream.sh`
2. 有更新 → `diff-upstream.sh`（**人工读差异**）
3. 判断是否需要锁（安全/bugfix 通常跟进；破坏性变更先不動）
4. 需要 → `pin-update.sh`（更新 `upstream.lock`）
5. 通知用户 **review 后**提交（**不自动提交**）
6. 更新 compose /配置 → 重建容器 → 跑 §7 冒烟
7. **升级后立即跑 `iso-probe.sh`**（exit 0 才准入）

### 9.3 阻断项（H，人工必看）

| ID | 触发 | 级别 |
|---|---|---|
| H1 | `upstream.lock` 缺失/格式错/字段缺 | 🔴 阻断 |
| H2 | 镜像 tag 不存在（releases API 404） | 🔴 阻断 |
| H3 | digest 不匹配（标签被重推，**供应链风险**） | 🔴 阻断 |
| H4 | reference commit 不可达 | 🟠 高危 |
| H5 | 镜像 tag 含 `latest`（浮动标签，**禁止**） | 🟠 高危 |

### 9.4 告警项（W，人工判断）

| ID | 触发 | 级别 |
|---|---|---|
| W1 | 上游有更新的 release | 🔵 info |
| W2 | 上游有新提交 | 🔵 info |
| W3 | 上游文档改动**命中契约面**（[`mcp/mcp-design.md`](./mcp/mcp-design.md) §9） | 🟡 warn |
| W4 | 上游新增依赖 | 🟡 warn |
| W5 | 上游依赖含已知 CVE（OSV API 查询公开 GHCR 镜像，不需 GH_TOKEN） | 🔴 高危 |
| W6 | 本地 clone 有本地提交（**事实偏离上游**） | 🟡 warn |

### 9.5 四类破坏性变更判断

前置判断：**升级是否跨 minor/major**（跨了才需要看破坏性变更清单；patch 一般直接升）。

| 类别 | 判断依据 | 处置 |
|---|---|---|
| **依赖库升级**（框架/运行时大版本） | 上游 `Cargo.toml` 依赖版本跳变 | 评估兼容性，必要时延后升级 |
| **配置文件格式变更** | `config.toml` 结构或键名变化 | 同步改本地 `config.toml`；**改 `dim` 必须重建索引** |
| **数据迁移 / schema 变更** | SQLx migration 文件新增 | **先快照备份**再升级；确认迁移可逆 |
| **API 接口变更** | REST/MCP 工具签名或行为变化 | 同步改调用方；必要时走兼容层 |

> **补丁发布不应包含破坏性变更** —— 若发现，视为上游发布失误，记录下来并考虑延后升级。

### 9.6 版本记录

`upstream.lock` 三段式：`[reference]`（clone HEAD：真实 commit + 真实 tag + subject + dirty 标记）/ `[artifact]`（镜像：tag + digest + release commit + fetch 时间）/ `[history]`（最近 N 次升级）。

---

## 10. 回滚

| 层 | 回滚方式 | 注意 |
|---|---|---|
| **应用** | 换回旧版本镜像 tag → 重建容器 → 冒烟 | 换 tag 前确认旧 tag 与锁文件内容一致 |
| **配置** | 换回上一版 `config.toml` → 重启 | 改 `dim` 后**必须重建索引** |
| **数据** | 用快照恢复（**先备份当前状态**） | 见 §8 恢复铁律 |
| **代码仓库** | `git checkout <上一个提交>` | 回滚后 `git status` 应干净 |
| **纪律** | 回滚后重跑 `iso-probe.sh` 与 §7 冒烟 | 回滚不是终点 |

> **数据回滚必须快照覆盖**，且**恢复前先备份当前** —— 「先备份再恢复」是最高优先级规则。

---

## 11. 排障速查

| 现象 | 排障顺序 |
|---|---|
| `ssh ai-memory` 报 Permission denied | 查 `authorized_keys` 是否生效（`no-pty` 等）→ 查密钥是否匹配 → 查容器名是否为 `ai-memory-mcp` |
| 写入成功但检索不到 | **先查 S1**（嵌入降级 keyword）→ 查 `tagged=0`（**S2** curator fail-open）→ 查档位是否退化为 semantic（**S3**） |
| 档位不是 smart | 查 `serve` 是否误传 `--tier`（档位只认 config/CLI）→ 查 config 是否挂载成功 |
| 容器反复重启 | `docker logs` 看具体错误 → 常见为 config 格式错或 key 缺失 |
| 数据丢失 | 检查卷 `ai_memory_data` 是否还在（`docker volume ls`）；**有备份才能恢复** |
| 多用户数据串了 | 查该会话 `AI_MEMORY_DB` 是否被正确钉住（**R1**，[`mcp/mcp-design.md`](./mcp/mcp-design.md) §6） |
| 门户会话异常 | 看门户日志的库路径断言（**D1/D4**）与子进程退出码 |

---

## 12. 运维要素摘编与未来路径

### 12.1 节点运维约定（摘编自运维模板，不引用原文件）

| 项 | 值 |
|---|---|
| 节点名 | hk_vps_4（香港 VPS） |
| 面板 | Portainer `https://portainer4.<zone>`；NPM `https://nginx4.<zone>`（zone 托管于 CF，含 DNS + 泛证书 + Access SSO） |
| 约定 | 一律 **Docker Compose 部署**；所有服务 **NPM 反代**，**不直接暴露端口** |
| 主机端口段 | 门户管理面 `3100-3109`（建议 `3100`）；MCP 面 `3101`；ai-memory-mcp 内部 `9077`；MCP/RAG 后续 `3200+` |
| MCP 容器端口 | `3200` 预留，**不暴露**（门户 spawn 模式不需要） |
| 数据库 | 外部共享实例（PG 15.13 / MySQL 8.0.42，私有 IP + 内网 DNS）；本产品当前用 SQLite 命名卷 |
| 交付纪律 | 交付前 `docker ps` 核对容器状态与端口映射 |

> 模板原文含真实端点与凭据，**永不入仓**；本节只保留可公开的运维事实。真实值见 gitignored `secrets.local*.md`。

### 12.2 门户接入部署（Sprint 4 起）

- 门户**不依赖**既有容器运行（共享数据卷是唯一耦合点：`/data/users/<handle>/ai-memory.db` 需同时被两边读写）。
- 部署动作：新建 `/opt/ai-memory/` 下门户 compose；**两个 stack 独立**，可单独重启。
- 上线门禁：[`web-portal/web-test.md`](./web-portal/web-test.md) 的 L3（含 V1 负向隔离验收）全绿。

### 12.3 毕业路径（架构未变，只是扩展）

| 触发 | 动作 |
|---|---|
| 并发写压力（`database is locked` 频繁） | 迁 PostgreSQL 后端（需自建镜像 + CI；正式开始维护自建镜像） |
| 单节点故障不可接受 | 高可用方案 + 备份恢复演练常态化 |
| 用户量大 | 引入缓存层与连接复用（**会话级进程不可池化，见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) D3**） |

---

## 13. 部署验收清单

- [ ] 三个静默失败点已确认（embedder 未降级 / curator `tagged` 非 0 / 档位为 `smart`）
- [ ] 端到端冒烟七项全通过
- [ ] `iso-probe.sh` exit 0（多用户隔离）
- [ ] 备份脚本已落地并成功执行过一次，外迁校验 `sha256sum` 一致
- [ ] 恢复演练已做过一次
- [ ] `make secret-check` / `make doc-links` 通过
- [ ] 部署完成后补文档记录（日期 / 版本 / 配置文件 / 冒烟结果 / 备份位置 / 已知问题）

---

## 14. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | **specs 整合**：`dev-plan.md` / `deployment_strategy.md` / `deploy/README.md` / `deploy/deployment-plan.md` 并入本文档；订正三处历史不一致 —— ① 健康探测**不用 curl**（镜像无 curl，改判 serve 日志 + `doctor`）；② 备份外迁频率统一为**每日**；③ 占位符统一 `<VPS4_IP>`（原文 `<vps4>` 混用）。删除 dev-plan 中误提的 gitleaks（本项目用 `make secret-check`） |
