# ai-memory 部署方案 — 野草云4（`68.64.176.124`）

> **状态：** 决议完成，待执行
> **节点：** 野草云4 · `68.64.176.124` · Debian 13 · 4 vCPU / 7.8 GiB / `/` 89G
> **对齐基准：** [`hk_vps_4_settings.md`](./hk_vps_4_settings.md) · [`vps4_new_deployment_instruction.md`](./vps4_new_deployment_instruction.md)
> **原则：** 本文件不写密码 / Token / API key。密钥见本机 `secrets.local.hk_vps_4.md`（gitignore）。
> **as_of：** 2026-09-19（基于克隆的 HEAD `96b8c694`，`Cargo.toml` 版本 `0.10.0`，当前稳定镜像 `0.9.0`）

---

## 0. 决议摘要

| # | 决策项 | 决议 | 理由 | 已知代价 |
|---|---|---|---|---|
| 1 | **存储后端** | **SQLite 命名卷**（非 Postgres） | 官方 GHCR 镜像用 `cargo build --release` 默认特性构建，**不含 `sal-postgres`**；用官方镜像即零定制、零 CI 改动 | DB 绑死 4 号机，节点挂则数据停在最近快照；不可横向扩。官方定位 <5 agent / <10GB |
| 2 | **镜像** | `ghcr.io/alphaonedev/ai-memory:0.9.0`（**固定版本号，禁用 `latest`**） | 上游 release workflow 已发布；符合「边缘只 pull，不 build」 | 无（属 §4 已批准例外：本仓库无构建工作流） |
| 3 | **tier** | **`smart`** | 需要自动打标 / 归并 / 查询扩展 / 矛盾检测 | 每写一次触发 LLM 调用（费用）；需常驻 curator |
| 4 | **LLM** | **云端 qwen（DashScope）便宜档** | LLM 跑在云端，服务器不承载模型权重 | 每写一次的 API 费用；`qwen-turbo`/`plus` 档质量弱于旗舰档 |
| 5 | **Embedder** | **走云端 API**（非本地 Ollama） | 避免在 4 vCPU / 7.8 GiB 上再跑 Ollama | **必须显式设 `dim`**（见 §3.1） |
| 6 | **客户端接入** | **stdio-over-SSH**（方案 A） | 唯一「调用者零依赖」方案；零公网暴露；读写同一个 DB，无裂脑；零新代码 | 每次启动一次 SSH 握手延迟 |
| 7 | **域名 / NPM / HTTPS** | **不需要** | 无公网 HTTP 入口 | 无法用 REST/curl 从外部访问（如需要，见 §8 待办） |
| 8 | **HTTP api_key** | **不设置** | HTTP 面不对外暴露，且 stdio MCP 按设计无 key 机制 | 无 |
| 9 | **agent attestation** | **关闭**（`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`） | v0.9 默认开启会 403 拒绝写入。**这是可用性前提，不是安全让渡** | 写入标记为 `claimed`（自称）而非密码学证明 |
| 10 | **部署制品仓库** | 新建**薄部署仓库**（命名待定，见 §8） | 不污染上游；release-bot 有明确主输入 | 多一个仓库（内容约 5 个文件） |

### 明确排除的方案及原因

| 方案 | 排除原因 |
|---|---|
| 直接复用阿里云自建 PostgreSQL | 官方镜像不含 `sal-postgres`，需自建镜像 + CI；且 `101.132.156.250` 类跨境公网访问引入额外延迟与故障面。**作为 Phase 1 升级路径保留**（见 §8） |
| 客户端「远程 MCP 直连 `https://.../mcp`」 | **上游未实现该端点**（证据见 §7）。协议本身可行，但本产品未实现服务端 HTTP 传输 |
| federation 各机本地复制 | 官方将 federation 标记为 **beta**，不建议无人值守生产；需维护密钥对与 allowlist；最终一致性而非实时 |
| stdio→HTTP 转换网关 | 违反「调用者零依赖」偏好（需服务器侧引入第三方组件） |
| 自研 REST→MCP 网关 | 工作量最大；且存在工具覆盖缺口（101 个 MCP 工具 vs 78 条唯一 REST 路径） |

---

## 1. 目标架构

### 1.1 运行时形态

```text
[Cursor @ laptop]
    │  ssh (密钥 + forced command, 仅允许一条命令)
    ▼
[野草云4 :22]
    │
    ├─ docker exec -i ai-memory-mcp ai-memory mcp --tier smart
    │        └─ stdio MCP ↔ 直接读写 /data/ai-memory.db
    │
    └─ 容器 ai-memory-mcp（常驻）
             ├─ serve --host 127.0.0.1 --port 9077   # 仅容器内，不映射端口
             │     └─ 后台 GC / WAL checkpoint（TTL 记忆体的清理依赖它）
             └─ 卷 ai_memory_data → /data
                    ├─ ai-memory.db          （SQLite，WAL 模式）
                    └─ hf-cache/             （模型权重缓存，避免 recreate 重下）
```

**关键点：无公网入站端口。** 安全边界 = SSH 密钥 + forced command。

### 1.2 为什么不需要 `api_key` / 域名 / NPM

| 原本要的东西 | 为什么不需要 |
|---|---|
| 域名 + NPM Proxy Host + Let's Encrypt | 没有公网 HTTP 入口，没有需要反代的服务 |
| `api_key` + `AI_MEMORY_REQUIRE_API_KEY=1` | 认证由 SSH 层完成（比共享密钥更强）；且 stdio MCP 按设计无 key 机制 |
| 主机端口映射 `3200:9077` | 没有任何外部消费者需要访问 9077 |

### 1.3 读写不会「裂脑」

`mcp` 进程与 `serve` 守护进程**在同一台机器、同一个 `/data/ai-memory.db`**，因此：

- 无需配置 `mcp_federation_forward_url`（该配置只转发**写**工具，读仍走本地——在跨机场景才会导致「写了读不到」；本方案同机同库，该问题不存在）
- 多客户端 = 多个 SSH 会话各起一个 `mcp` 进程 → 官方明示的「WAL 多读 + 单写」场景

> ⚠️ 并发写压力大时可能出现 `Error: database is locked`。这是**向 Postgres 迁移的毕业触发条件之一**（见 §8）。

---

## 2. 服务器上要落地的东西（完整清单）

| # | 项 | 值 |
|---|---|---|
| 1 | Portainer Stack | `ai-memory-mcp` |
| 2 | 容器 | `ai-memory-mcp` |
| 3 | 命名卷 | `ai_memory_data` → `/data` |
| 4 | 主机端口 | **无**（不映射） |
| 5 | 配置文件 | `/opt/ai-memory-mcp/config.toml`（只读挂载） |
| 6 | 环境变量文件 | `/opt/ai-memory-mcp/.env`（含 LLM/embedding API key，**不进 Git**） |
| 7 | SSH 授权 | `/root/.ssh/authorized_keys` 追加 forced-command 条目 |
| 8 | 备份目录 | `/opt/ai-memory-mcp/backups`（并定期外迁） |

**不需要**：域名、NPM Proxy Host、Let's Encrypt 证书、外部数据库实例、Ollama、GPU、额外端口。

---

## 3. 配置

### 3.1 `config.toml`

```toml
# /opt/ai-memory-mcp/config.toml
# 容器内路径：/data/.config/ai-memory/config.toml
#
# ⚠️ 路径由 $HOME 推导（src/config.rs::config_path），且没有任何环境变量能改写它。
#    compose 里设 HOME=/data（见 §3.2），配置便落入持久卷。
#    挂错位置会被【静默忽略】→ tier 退回默认 semantic、[llm]/[embeddings] 不生效。
schema_version = 2

# ---------------------------------------------------------------------------
# tier —— serve 守护进程的档位来源。
# 注意：`serve` 没有 --tier 参数，档位只能由本字段提供（MCP 客户端侧则用
# `mcp --tier` 参数，见 §4）。两处必须一致，否则运维面与服务面档位不一致。
# ---------------------------------------------------------------------------
tier = "smart"

db = "/data/ai-memory.db"

# ---------------------------------------------------------------------------
# [llm] —— smart 档的整理能力后端。
# qwen 是官方一等别名（等价 dashscope），默认 base_url:
#   https://dashscope.aliyuncs.com/compatible-mode/v1
# ---------------------------------------------------------------------------
[llm]
backend     = "qwen"
model       = "qwen-plus"          # 便宜档；更省可用 qwen-turbo
api_key_env = "DASHSCOPE_API_KEY"  # 指向环境变量名，不是 key 本身

# ⚠️ 关键：**不要**声明 [llm.auto_tag] 段。
#
# 源码证据（src/config.rs::resolve_llm_auto_tag）：省略该段时逐字段继承 [llm]
#   - backend 未设 → 继承 [llm].backend（qwen）
#   - model   未设且 backend != ollama → 继承 [llm].model
# 而官方样例文档（docs/CONFIG_SCHEMA.md）把该段写成：
#   [llm.auto_tag]
#   backend = "ollama"
#   model   = "gemma3:4b"
# 照抄这段会在没有 Ollama 的机器上把 auto_tag / 查询扩展 / 矛盾检测全部打挂。

# ---------------------------------------------------------------------------
# [embeddings] —— 必须显式指向 API。
# smart 档的 tier preset 默认 embedder 是 Nomic(768)，其默认 backend 是
# Ollama；本机无 Ollama，因此必须覆盖。
# ---------------------------------------------------------------------------
[embeddings]
backend  = "qwen"
model    = "<按 DashScope 文档确认，例如 text-embedding-v3 系列>"
dim      = 0    # ⚠️ 必须显式填写与该模型一致的维度，见下方说明

# dim 为什么必须显式设：
#   - src/config.rs::KNOWN_EMBEDDING_DIMS 只覆盖 nomic / MiniLM / BGE /
#     gemini-embedding-2 / granite / snowflake-arctic，**不含任何 DashScope 模型**
#   - 未命中表且未设 dim 时，会退回 tier preset 的维度（smart = 768），
#     可能与该模型实际输出维度不符 → 写入失败或检索质量异常
#   - **不存在 AI_MEMORY_EMBED_DIM 环境变量**，dim 只能写在配置文件的这一段
#   - 维度一旦定下即绑定到已写入的向量；后续换模型需执行 `ai-memory reembed`
#     回填（批大小由 [embeddings].backfill_batch 或
#     AI_MEMORY_EMBED_BACKFILL_BATCH 控制）

backfill_batch = 100

# ---------------------------------------------------------------------------
# 说明：本部署不对外开放 HTTP，故不设置顶层 `api_key`。
# 若未来开放 HTTP 入口（见 §8），此处必须设置 `api_key`，并同时设置容器
# 环境变量 AI_MEMORY_REQUIRE_API_KEY=1（反代场景硬性要求）。
# 注意：认证头是 X-API-Key，不是 Authorization: Bearer。
# ---------------------------------------------------------------------------
```

### 3.2 `docker-compose.prod.yml`

```yaml
name: ai-memory-mcp

services:
  ai-memory:
    image: ghcr.io/alphaonedev/ai-memory:${IMAGE_TAG:?set IMAGE_TAG in .env}
    container_name: ai-memory-mcp
    restart: unless-stopped

    # 不映射任何主机端口：本方案无公网 HTTP 入口（客户端走 SSH stdio）。
    # 若未来开放 HTTP，取消下行注释并改绑 3200:9077（野草云4 agent/MCP 段），
    # 且必须同时设置 api_key + AI_MEMORY_REQUIRE_API_KEY=1。
    # ports:
    #   - "3200:9077"

    # 覆盖镜像默认的 `serve --host 0.0.0.0`：只绑回环，纵深防御。
    # 本容器接入共享的 portainer_network，而 9077 无 api_key ——
    # 绑回环可避免同网络内其他容器访问到未认证的 HTTP 面。
    command: ["serve", "--host", "127.0.0.1", "--port", "9077"]

    env_file:
      - .env                     # DASHSCOPE_API_KEY / IMAGE_TAG；不进 Git
    environment:
      # ── 关键：HOME 指到持久卷 ─────────────────────────────────────
      # 配置路径 = $HOME/.config/ai-memory/config.toml（无法用其他 env 改写）
      # HF 模型缓存 = $HOME/.cache/huggingface（设 HOME 后 recreate 不重下）
      # 密钥目录 / 审计日志也随之全部落入持久卷。
      HOME: /data
      AI_MEMORY_DB: /data/ai-memory.db
      # 可用性前提：v0.9 默认开启 attestation，无签名写入会 403
      AI_MEMORY_REQUIRE_AGENT_ATTESTATION: "0"
      # 本方案不开放 HTTP，故不设 AI_MEMORY_REQUIRE_API_KEY

    volumes:
      - ai_memory_data:/data
      # 挂载点必须与 $HOME 推导路径一致，否则配置被静默忽略
      - ./config.toml:/data/.config/ai-memory/config.toml:ro

    networks:
      - default

  # ── curator：智能整理守护进程（决议 ①：常驻）─────────────────────
  # 先用 `curator --once --dry-run --json` 预演并人工审阅，再启用本 service。
  # Phase 0 验收必须核对 JSON 报告 tagged > 0，否则即静默失效（fail-open）。
  curator:
    image: ghcr.io/alphaonedev/ai-memory:${IMAGE_TAG:?set IMAGE_TAG in .env}
    container_name: ai-memory-mcp-curator
    restart: unless-stopped
    command: ["curator", "--daemon", "--interval-secs", "3600", "--max-ops", "50"]
    env_file:
      - .env
    environment:
      HOME: /data
      AI_MEMORY_DB: /data/ai-memory.db
      AI_MEMORY_REQUIRE_AGENT_ATTESTATION: "0"
    volumes:
      - ai_memory_data:/data
      - ./config.toml:/data/.config/ai-memory/config.toml:ro
    depends_on:
      - ai-memory
    networks:
      - default

volumes:
  ai_memory_data:

networks:
  default:
    external: true
    name: portainer_network
```

> **同卷双进程说明**：`ai-memory` 与 `curator` 两个容器共享同一个 SQLite 文件。同一宿主机上 WAL 支持多进程（多读 + 单写）。若出现 `database is locked`，退路是把 curator 改为 **cron + `--once`**（不跑常驻第二个写进程）。

**为什么用 `--host 127.0.0.1`**：容器接入 `portainer_network` 后，同网络内的**其他容器**可以访问 `ai-memory-mcp:9077`。而 9077 上没有 api_key（本方案不设），因此绑回环可消除这一内部暴露面。本方案没有任何需要访问 9077 的消费者（MCP 走 `docker exec`，不是 HTTP）。

### 3.3 调用者侧 SSH 配置

**服务器侧** — `/root/.ssh/authorized_keys` 追加一条 forced-command 记录：

```
command="docker exec -i ai-memory-mcp ai-memory mcp --tier smart",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... cursor@laptop
```

关键点：
- `command="..."` → **这把密钥只能执行这一条命令**，拿不到 shell
- `no-pty` → 避免 pty 引入 CR/LF 转换破坏 stdio 帧
- `docker exec -i`（**不加 `-t`**）→ 保持 stdin 打开且不做终端分配。加 `-t` 会因 pty 换行转换破坏 MCP 的 stdio 协议

**调用者侧** — `~/.ssh/config`：

```
Host ai-memory
    HostName 68.64.176.124
    User root
    IdentityFile ~/.ssh/ai_memory_cursor_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 30
```

> ⚠️ 该密钥用于非交互登录，**不能有 passphrase**（Cursor 拉起进程时没有 tty 可输入）。
> 因此必须靠 `command=` forced command 把权限限死。建议为它单建一个权限受限的用户而非 `root`。

**Cursor 侧** — `~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "ai-memory": {
      "command": "ssh",
      "args": ["ai-memory", "docker exec -i ai-memory-mcp ai-memory mcp --tier smart"]
    }
  }
}
```

> `docker exec` 继承容器环境变量，所以 **LLM/embedding 的 API key 只需在服务器 `.env` 里配一次**，不需要写进每个客户端的 MCP 配置。这是本方案相对 stdio 本地启动的一个额外收益。

---

## 4. 部署顺序（映射到 [`vps4_new_deployment_instruction.md`](./vps4_new_deployment_instruction.md) §3 八步）

| 步 | 动作 | 本应用取值 |
|---|---|---|
| 0 | 预检 | 镜像 `ghcr.io/alphaonedev/ai-memory:0.9.0`；stack `ai-memory-mcp`；无公网端口；无 DB 迁移 |
| 0b | 隔离门禁 | 与野草云4 既有应用无冲突（当前应用栈为空）；**不新增 DNS 记录、不新增 NPM Host**；不重建 `portainer_network` |
| 1 | Compose | `/opt/ai-memory-mcp/docker-compose.prod.yml`；仅 `image:`；`external: portainer_network` |
| 2 | CI → GHCR | **不适用** —— 消费上游官方镜像。按文档 §4 例外条款留痕：镜像坐标 + 「本仓库无构建工作流」+ 版本跟踪责任方 |
| 3 | Env | `.env` 含 `DASHSCOPE_API_KEY`、`IMAGE_TAG=0.9.0`；`config.toml` 只读挂载 |
| 4 | DB | **无需迁移** —— SQLite 首次启动自建 |
| 5 | Portainer | 打开 `https://portainer4.agent-mate.ai`；仅部署 stack `ai-memory-mcp` |
| 6 | Cloudflare | **不适用**（无域名） |
| 7 | NPM | **不适用**（无 Proxy Host） |
| 8 | 冒烟 | 见 §5 |

**注意第 6/7 步的「不适用」必须在 `deployment-plan.md` 中显式声明**，否则 release-bot 会按标准流程寻找 DNS/NPM 步骤而卡住。

---

## 5. 冒烟与验收

### 5.1 容器与守护进程

```bash
# 容器健康
docker ps --filter name=ai-memory-mcp --format '{{.Status}}'

# 守护进程在容器内可达（不对外）
docker exec ai-memory-mcp curl -sf http://127.0.0.1:9077/api/v1/health

# 全量健康面板：10 节，重点是
#   LLM Reachability (#1146)        → 应显示 qwen:<model>
#   Embeddings Reachability (#1598) → 应显示 qwen:<model>，且维度正确
# 若 LLM/Embedder 无法解析，此处是最早能发现的地方
docker exec ai-memory-mcp ai-memory doctor
```

> **两个最容易静默失败的环节，必须逐次核对**：
> 1. **Embedder 初始化失败会降级**：日志会打印 `embedder init failed … semantic recall DEGRADED to keyword`。降级后不报错，只是召回质量下降 —— 必须核对 boot banner / doctor，不能只看「服务起来了」。
> 2. **curator 解析不到 LLM key 会 fail open**：每轮 `tagged=0`，没有更响亮的错误（官方明确警告）。smart 档的价值全靠它，必须单独验证。

### 5.2 MCP 通路

```bash
# 在调用者机器上模拟 Cursor 的调用
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  | ssh ai-memory
# 期望：返回 JSON-RPC initialize 响应（含 serverInfo / capabilities）
```

### 5.3 端到端

| # | 检查 | 期望 |
|---|---|---|
| 1 | `ai-memory doctor` 的 LLM Reachability | 显示 `qwen`，非 `none` |
| 2 | `ai-memory doctor` 的 Embeddings Reachability | 显示 `qwen` + 正确维度 |
| 3 | 从机器 A 的 Cursor 写一条记忆 | 成功，且 `attest_level` 为 `claimed`（非 403） |
| 4 | 从机器 B 的 Cursor 检索同一内容 | **能召回**（验证跨客户端共享） |
| 5 | `ai-memory stats` | 计数增长，tier 分布合理 |
| 6 | 抽查 `portainer4` / `nginx4` 未被改动 | 通过 |
| 7 | 抽查野草云4 上既有应用（当前为空 → 记录「首发，无既有应用可抽查」） | — |

---

## 6. 运维

### 6.1 备份

```bash
# VACUUM INTO 快照 + sha256 清单；--keep 由旧到新轮换
docker exec ai-memory-mcp ai-memory backup --to /data/backups --keep 48
docker exec ai-memory-mcp ai-memory restore --from /data/backups   # 用最新快照
```

> ⚠️ `/data/backups` 与 DB **在同一卷**，属同一故障域。**必须定期外迁**到另一台机或对象存储，否则「备份」在节点故障时不成立。

建议节奏：小时级快照 + 48 份轮换 + 每周外迁（具体频率见 §8 待办）。

### 6.2 升级

```bash
# 1. 备份
docker exec ai-memory-mcp ai-memory backup --to /data/backups
# 2. 改 .env 里的 IMAGE_TAG 为新版本号（必须是 GHCR 上真实存在的 tag）
# 3. Portainer → 本 Stack → Recreate（勾选重新拉取）
#    ⚠️ Portainer 默认常不重新 pull `latest`；本方案固定版本号 + Recreate 可规避
# 4. 迁移自动执行；迁移前会自动在同目录生成 pre-migration 快照
docker exec ai-memory-mcp ai-memory doctor
```

- 迁移**前向-only**，无法降级
- 迁移前快照命名：`<db-file>.pre-migration-v<FROM>-to-v<TO>-<token>.bak`，落在 `/data` 内（已在持久卷）
- 二进制会拒绝启动于「比自身更新的库」——部分回滚会**大声失败**而非静默损坏

### 6.3 回滚

```bash
# 停容器 → 用 pre-migration 快照覆盖 /data/ai-memory.db（清掉 -wal / -shm 兄弟文件）
# → .env 的 IMAGE_TAG 改回旧版本 → Portainer Recreate
```

### 6.4 排障速查

| 症状 | 处置 |
|---|---|
| `database is locked` | 并发写竞争。查 `docker exec ai-memory-mcp pgrep -fa ai-memory`；限流，或考虑迁 Postgres（§8 毕业触发） |
| 召回明显变差但不报错 | 大概率 embedder 降级成了 keyword。查 boot banner / `doctor` 的 Embeddings Reachability |
| smart 功能（打标/归并）无效 | curator 未运行或解析不到 LLM key（fail open）。查 curator 日志是否每轮 `tagged=0` |
| 写入返回 `403 ATTESTATION_FAILED` | `AI_MEMORY_REQUIRE_AGENT_ATTESTATION` 未生效为 `0` |
| SSH stdio 无响应 / 帧损坏 | `docker exec` 误加了 `-t`；或 authorized_keys 缺 `no-pty` |
| 首次检索卡住约一分钟 | 一次性下载模型权重（~90MB）。若始终不完成，查容器 → HuggingFace 的连通性 |

---

## 7. 已知上游缺陷（本地记录，避免重复踩坑）

### 7.1 `docs/INSTALL.md` 与 `docs/USER_GUIDE.md` 描述了**不存在的 MCP 端点**

| 文件 | 位置 | 错误声称 |
|---|---|---|
| `docs/INSTALL.md` | § "xAI Grok (API-level, remote MCP)"，约 L555–585 | `"server_url": "https://your-server.example.com/mcp"` |
| `docs/INSTALL.md` | § "META Llama (via Llama Stack)"，约 L587–603 | `mcp_endpoint={"uri": "http://localhost:9077/sse"}` |
| `docs/INSTALL.md` | 同上，约 L615–619 | `mcp_endpoint: uri: "http://localhost:9077/sse"` |
| `docs/USER_GUIDE.md` | L46 | 「Grok connects via remote MCP over HTTPS only… Run `ai-memory serve` and expose it behind an HTTPS reverse proxy」 |
| `docs/USER_GUIDE.md` | L48 | 「Llama Stack connects over HTTP rather than stdio MCP… point your client at `http://localhost:9077`」 |

**判定：文档缺陷，非配置问题。** 三条独立证据：

1. **路由 SSOT 完整枚举无该端点** —— `src/handlers/routes.rs` 共 95 个常量，全部 `/api/v1/*` + `/metrics`：

   ```14:14:src/handlers/routes.rs
   pub const ACTIONS_ID_TRANSITION: &str = "/api/v1/actions/{id}/transition";
   ```

2. **全 `src/` 零匹配** —— 搜索字面量 `"/mcp"`、`"/sse"`、`streamable`、`Mcp-Session-Id` → 0 命中；`.route("` 与 `.nest(` 的全部命中均为 `/api/v1/*`。

3. **官方注册清单只声明 stdio** —— `server.json`：

   ```16:18:server.json
         "transport": {
           "type": "stdio"
         },
   ```

**为什么会误判**：同一份 `INSTALL.md` 的 L511 说 Cursor「supports `url` + `headers` for remote HTTP/SSE servers」——**这句是真的**（客户端能力）。于是「客户端能连远程」+「服务端提供远程」各自看都对，合起来推出了一个不存在的端点。

**对方案的约束**：`ai-memory` 的远程能力是 **REST**，不是 MCP 传输层。两者是平行通道，REST 端点不能被 MCP 客户端当工具调用。

**参照物**：`framework.sdd.works` 的 MCP 配置为 `{"url": "https://framework.sdd.works/mcp"}` —— 远程 MCP 直连**在协议上完全可行**。其工具描述自证实现了两套传输（「Stdio writes local paths directly. HTTP always returns packageUrl + paths + manifest + instructions」），说明「能远程直连」是**自己实现出来的**。结论：问题不在协议，在 `ai-memory` 的实现选择。

> 本项仅作本地记录，不向上游反馈（决策：2026-09-19）。

---

## 8. 未决事项与 Phase 1 前置

### 8.1 待你确认（不阻塞 Phase 0 执行）

| # | 事项 | 状态 |
|---|---|---|
| 1 | 部署制品仓库 | ✅ 已决：**私有**，名 `memory.agent-mate.ai`（与域名同名；注意本方案不含该域名，见 §9 变更记录） |
| 2 | qwen 模型档位 | ✅ 已决：主 `qwen-plus`，`[llm.auto_tag]` 用 `qwen-turbo`（**只写 model，不写 backend**） |
| 3 | DashScope embedding 的具体 `model` 与 `dim` | ⏳ **待你提供**（从 DashScope 文档/控制台取）。`KNOWN_EMBEDDING_DIMS` 不含 DashScope 模型，`dim` 必须手工填且必须一致；填错不报错，只会召回异常。**回填后必须跑 §5.1 的 doctor 探针验证** |
| 4 | curator | ✅ 已决：**常驻**（独立 compose service；先 `--once --dry-run` 预演审阅；`--max-ops 50`；Phase 0 核对 `tagged > 0`） |
| 5 | 备份外迁 | ✅ 已决（2026-09-20 更新）：**默认方案** —— `ai-memory backup` 本地快照 + cron + ossutil 外迁 OSS 香港 region 私有桶（RAM 最小权限）+ 季度恢复演练；升级门禁「无新鲜外迁备份，不升级」。多租户备份 MCP（mcp.oss-bak.com）**移出本计划、另建项目**，其独立需求规格见 [`mcp_oss_bak_com_requirements.md`](./mcp_oss_bak_com_requirements.md)（移交物）。详见 [`dev-plan.md`](./dev-plan.md) §4–5 |
| 6 | SSH 身份 | ✅ 已决：**单建权限受限用户** + docker 组 + forced-command 密钥（不用 root） |
| 7 | 部署仓库制品 | ✅ 已生成并随资产迁移入库：`hk_vps_4/deploy/` |

### 8.2 Phase 1 前置：PG 扩展核查（若考虑迁移）

在自建 PostgreSQL（`101.132.156.250`）上执行以下**只读** SQL 并回填：

```sql
-- 1. 版本
SELECT version();

-- 2. 可用扩展与已装版本（vector 是硬性要求；缺 age 则 KG 图查询退化为递归 CTE）
SELECT name, default_version, installed_version
  FROM pg_available_extensions
 WHERE name IN ('vector', 'age');

-- 3. 实际已安装扩展
SELECT extname, extversion FROM pg_extension ORDER BY extname;

-- 4. AGE 需要预加载（未预加载则 CREATE EXTENSION age 会失败）
SHOW shared_preload_libraries;
```

**注意**：即使 PG 扩展齐全，走 Postgres 仍需**自建 `--features sal-postgres` 镜像并推自己的 GHCR**（官方镜像不含该特性）。这是迁移成本的真正大头，不是装扩展。

### 8.3 毕业触发条件（满足任一即应重新评估存储后端）

| 触发条件 | 说明 |
|---|---|
| 记忆总量 > ~1M 条 或 > 10GB | 超出官方对 SQLite 单实例的推荐区间 |
| 持续出现 `database is locked` | 写入并发超过 WAL 单写者的承载 |
| 需要跨节点 / 多写 | SQLite 无法横向扩 |
| 需要 KG 图查询加速 | AGE Cypher 相对递归 CTE 的性能优势 |
| 需要从公网以 REST 访问 | 那时必须补回域名 / NPM / TLS / api_key |

**当前明确不做**：Postgres、federation、Ollama 本地 LLM、公网 HTTP 入口。避免过早优化。

---

## 9. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-19 | 初版。决议：SQLite 卷 + 官方镜像 + smart(qwen 便宜档) + stdio-over-SSH |
| 2026-09-19 | 更正：`qiuge.me` zone 不在控制范围，应用域名约定改为 `agent-mate.ai`（见 [`vps4_new_deployment_instruction.md`](./vps4_new_deployment_instruction.md) 顶部更正说明与 [`hk_vps_4_settings.md`](./hk_vps_4_settings.md) §0.4） |
| 2026-09-19 | 更正：客户端「远程 MCP 直连」不可行（上游未实现 `/mcp` 与 `/sse`），改采 stdio-over-SSH；连带取消域名 / NPM / HTTPS / api_key 需求 |
| 2026-09-19 | 更正：`smart`/`autonomous` 在本机**不需要** Ollama —— 该结论仅适用于「本地模型路径」；云端 API 路径下主机不承载模型权重 |
| 2026-09-19 | 补充：`[llm.auto_tag]` 不得照抄官方样例（样例写 `ollama`，会打挂 LLM 类功能）；`[embeddings].dim` 必须显式设且无对应环境变量 |
| 2026-09-19 | 更正：**config 路径由 `$HOME` 推导且无法改写** —— 由 `/etc/ai-memory/config.toml` 改为 `HOME=/data` + `/data/.config/ai-memory/config.toml`；顺带解决 HF 模型缓存持久化。原写法会静默忽略配置、tier 退回 semantic |
| 2026-09-19 | 决议：curator 常驻（独立 service，先 dry-run 预演，`--max-ops 50`）；SSH 用单建受限用户；部署仓库私有、名 `memory.agent-mate.ai`；qwen 主 `plus` + auto_tag `turbo` |
| 2026-09-19 | 备注：仓库名 `memory.agent-mate.ai` 与「本方案无该域名（方案 A）」存在命名不一致，按你的指示保留；若未来启用 HTTP 入口则名称自洽 |
| 2026-09-19 | 生成部署制品：`docs/ye_cao_yun_production/deploy/`（staging，复制入新仓库即可） |
| 2026-09-19 | 决议：备份外迁改采**先自研通用 OSS 备份 MCP**（当时名 `oss-backup-mcp`）作为前置项目。架构要点：一套核心 + 两个前端（MCP 给 agent、CLI 给 cron——MCP 无法承载定时触发）；恢复永不 in-place、必须过恢复演练验收。ai-memory 本地快照腿独立、可先行启用。（当时规格文件几经更名，现内容并入 [`mcp_oss_bak_com_requirements.md`](./mcp_oss_bak_com_requirements.md)） |
| 2026-09-19 | 更名：项目更名为 **`aliyun-oss-bak-mcp`**（曾短暂改为「产品内置」后撤回，回归自研独立项目）；规格文件更名为 `aliyun_oss_bak_mcp_spec.md`，内容不变（含官方 OSS MCP alpha 替代评估：不可用，覆盖率 0/4） |
| 2026-09-20 | **备份方案裁决**：mcp.oss-bak.com 从本计划**取消**，另建项目单独建设；研究整理为独立自洽需求规格 [`mcp_oss_bak_com_requirements.md`](./mcp_oss_bak_com_requirements.md)（移交物，旧规格文件删除、轨迹保留于此）。备份回归**默认方案**（本地快照 + cron/ossutil 外迁 OSS 香港 + 季度恢复演练），落地细节见 [`dev-plan.md`](./dev-plan.md) §4–5 |
| 2026-09-20 | 新增：上游升级策略（7 步链路 + 三类破坏性变更审查 + 升级门禁「无新鲜外迁备份不升级」+ 升级后备份管线探针 + 半自动版本跟踪）——见 [`dev-plan.md`](./dev-plan.md) §5；资产隔离计划——见 [`asset_isolation_plan.md`](./asset_isolation_plan.md)（迁移待批） |
| 2026-09-20 | 资产隔离布局定稿：**协同布局** —— 工程目录更名 `memory.agent-mate.ai`（公开仓 `ethanhuangcst/memory.agent-mate.ai`），上游 clone 嵌套为 `ai-memory-mcp/`（gitignored，只读约定），自有资产集中 `hk_vps_4/`；`.gitignore` 防 gitlink 陷阱 + `make pin` 回填版本映射；物理分仓降级为备选（见 asset_isolation_plan.md §6）。迁移已执行 |
| 2026-09-20 | **资产迁移已执行**：自有资产入父仓 `hk_vps_4/`、上游重新 clone 为嵌套 gitignored 目录、断链修正、首提交 `4dbff84` 推送 GitHub；旧目录改名备份未删除（含 CodeBuddy 会话数据） |

---

## 10. 相关文档

| 文档 | 用途 |
|---|---|
| [`hk_vps_4_settings.md`](./hk_vps_4_settings.md) | 野草云4 端口 / 网络 / 平台验收 |
| [`vps4_new_deployment_instruction.md`](./vps4_new_deployment_instruction.md) | 节点 + 域名约定；`deployment-plan.md` 必填章节 |
| [`../../docs/install-quickstart.md`](https://github.com/alphaonedev/ai-memory-mcp/blob/96b8c694/docs/install-quickstart.md) | 上游安装说明 |
| [`../../docs/CONFIG_SCHEMA.md`](https://github.com/alphaonedev/ai-memory-mcp/blob/96b8c694/docs/CONFIG_SCHEMA.md) | `[llm]` / `[embeddings]` 段权威 schema |
| [`../../docs/ADMIN_GUIDE.md`](https://github.com/alphaonedev/ai-memory-mcp/blob/96b8c694/docs/ADMIN_GUIDE.md) | 全部环境变量与运维面 |
| [`../../docs/integrations/llm-backends.md`](https://github.com/alphaonedev/ai-memory-mcp/blob/96b8c694/docs/integrations/llm-backends.md) | 各 LLM 后端配方（含 qwen / DashScope） |
| `specs/adr/` ADR-002 / ADR-003 | IMAGE_TAG；NPM Save + healthz |
