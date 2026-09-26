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
| 仓内 | `memory.agent-mate.ai/deploy/` 下**入仓事实文件 5 个**（权威清单见 [`../deploy/README.md`](../deploy/README.md)）：`docker-compose.prod.yml`（compose 契约唯一真相源）· `config.toml.tmpl`（配置模板）· `.env.prod.example`（主 stack `.env` 样例）· `portal.env.example`（门户 stack 样例）· `README.md`。另有 **4 个运行时派生文件不入仓**（`.gitignore` 路径无关规则覆盖）：`config.toml` · `.env` · `portal.env` · `config.local.toml` |
| 密钥 | qwen MaaS API key（私有 workspace base_url）· 用户 SSH 公钥（Sprint 3+） |
| 本地 | `docker` CLI；无 compose 插件时脚本自动回退 `docker-compose` |
| 纪律 | 改 `.gitignore` 之后才能 `git add -A`；提交前 `make secret-check`（pre-commit 已挂） |

### 1.1 云资源准备清单

> **用途**：生产上线前须在**云侧 / 域名侧**就绪的**外部资源**。Sprint 5 的阻塞行（`#7` / `#8`）指向本表；本表是这份清单的**唯一真源**。
> **纪律**：AK / Token / key 一律**只存服务器侧**，不入仓（`make secret-check` 守护）。

| 云资源 | 要求 | 承接条目 |
|---|---|---|
| **阿里云 OSS 私有桶** | 桶为**私有** + **SSE 已开**；region = **香港**（2026-09-26 用户确认按现登记值回填；`ossutil` 机器核查**未执行**） | Sprint 5 `#8` |
| **RAM 子账号 AK** | 只授予该桶的最小权限；只存服务器侧 | Sprint 5 `#8` |
| **SSH 密钥对** | 调用者 ↔ 野草云4；无 passphrase + forced command，`ssh ai-memory` 可完成 MCP 握手 | Sprint 5 `#7` |
| **Cloudflare Access 应用 + Allow 策略** | 策略内列已批准邮箱（**建议 ≥ 2 个**）；`<MCP_HOST>` 必须**绕过** Access | [`web-portal/web-design.md`](./web-portal/web-design.md) §6.1 · Sprint 5 `#6` |
| **Access Service Token** | 供在线链路探针判定「策略已生效」 | Sprint 5 `#6` |
| **门户专用 MaaS key** | 与主 key 分离，只放 `portal.env` | [`../deploy/portal.env.example`](../deploy/portal.env.example) |
| **DNS（两个域名）** | `<MCP_HOST>` 与 `<ADMIN_HOST>` 分别解析到本机 | Sprint 5 `#9`（上线准备包；Sprint 4 `#7` 核对时定归属） |
| **容器镜像仓库（GHCR）拉取凭据** | 门户镜像推在 `ghcr.io/<owner>/memory-agent-mate-portal:<IMAGE_TAG>`；**包默认私有** ⇒ 服务器侧需 `docker login ghcr.io`（只读 PAT），或把该包设为 public。**拉到之后先验「可用」再部署**：`make portal-image-smoke ARGS="--tag <该镜像>"` —— 真起容器判「起得来 · 答得应 · 坏姿态必拒」（退出码 **0** 全判 · **10** 有失败 · **30** 未判（守护不可用或镜像不在本地 —— **不伪装通过**）· **20** 用法错）；判据真源见 [`web-portal/web-design.md`](./web-portal/web-design.md) §3.4 ⑤ | Sprint 5 `#10`（部署执行；镜像构建见 `#1` 的 CI，运行时判据见 `#1` 的冒烟） |

**OSS region 已回填（2026-09-26）**：用户确认**按现登记值（香港）**回填四处 —— 本表 §1.1 · §8 · [`product-backlog.md`](./product-backlog.md) #9 · Sprint 5 `#8`。**`ossutil` 机器核查未执行**（如实登记）⇒ 上线前用 `ossutil ls` · `ossutil stat oss://<OSS_BUCKET>` · `ossutil config`（endpoint 形如 `oss-<region>.aliyuncs.com`），或控制台 → OSS → 该桶 → 概览 → 「地域」**一次性复核**即可。`ADR-021` D3 点名的 [`adr/ADR-005`](./adr/ADR-005-upgrade-admission-gate-layering.md) **实测无 region 表述**（仅含「阿里云 OSS」与 `ossutil ls`）⇒ 无回填项。

**`#8` 就绪需提供的信息（2026-09-26 登记）**：

| # | 信息 | 取值 / 口径 |
|---|---|---|
| 1 | 桶名 | `<OSS_BUCKET>` —— **公开文档只写占位符**，真值落 gitignored 的 `secrets.local*.md` |
| 2 | region | **香港**（已定，见上） |
| 3 | endpoint | 形如 `oss-cn-hongkong.aliyuncs.com`（由 ② 推出；`ossutil config` / `--endpoint` / env 三选一） |
| 4 | RAM 子账号 AK | **AccessKeyId / AccessKeySecret** —— 只落**服务器侧**（`chmod 600`），不入仓、不进日志 |
| 5 | 最小权限范围 | 仅该桶（建议 `oss:GetObject` / `PutObject` / `ListObjects` / `HeadObject`，前缀限定到备份目录） |
| 6 | 私有 + SSE 确认 | 控制台属性页截图或 `ossutil stat` 输出（**公开读 ⇒ 立即改回**：快照含全部用户记忆） |
| 7 | 保留策略 | 默认按 §8 已登记值（日备 30 代 + 月备 12 代）；如需不同请显式给出 |

---

## 2. 服务器落地清单

| # | 项 | 是否必需 |
|---|---|---|
| 1 | 创建落地目录 `/opt/ai-memory/`（compose / `config.toml` / `.env` 三个文件的落地位置） | **必需** |
| 2 | 落地 `docker-compose.prod.yml` 到 `/opt/ai-memory/` | **必需** |
| 3 | 重命名 `config.toml.tmpl` → `config.toml` 并改三处（见 §5.2） | **必需** |
| 4 | 落地 `.env`（键只有 `IMAGE_TAG` + `DASHSCOPE_API_KEY`，**只设本轮用的**，见 §5.4） | **必需** |
| 5 | `docker compose config`（语法自检） | **必需** —— **本机可判**（2026-09-26 `#1` 开工准备实测）：独立二进制 `docker-compose`（**不需要 docker 守护**、不需要 compose 插件）即可解析，前置 = `deploy/.env` 存在（缺则非 0）；上游 `docker-compose.prod.yml` 与门户 `portal.compose.yml` **两个 compose 均实测 rc=0** |
| 6 | `docker compose up -d` | **必需** |
| 7 | 从日志确认 embedder / LLM（**不 curl**：镜像无 curl，见 §7.1） | **必需** |
| 8 | 端到端冒烟（写入 → 重新连接 → 语义召回） | **必需** |
| 9 | 备份（宿主机快照 → 外迁） | 待办 |
| 10 | Cloudflare Access + 反向代理 | 门户阶段 |

**明确不需要**：Dockerfile · 自建镜像 · 官方镜像外的额外镜像层 · 额外 volumes（一个卷足够）· **compose 自建网络**（compose 的 `default` 网络是 `external: true` 的 `portainer_network`，由宿主机提供，见 §5.1）· `postgres` / `redis` 服务 · 任何上游源码改动。

---

## 3. 部署八步（与产品决策文档的步骤映射）

| # | 步骤 | 产出 | 对应决策 |
|---|---|---|---|
| 1 | 装环境 | Docker + Compose | 宿主机 1 |
| 2 | 建目录 | `/opt/ai-memory/` | 宿主机 1 |
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
sudo mkdir -p /opt/ai-memory
# compose → /opt/ai-memory/docker-compose.prod.yml
# config  → /opt/ai-memory/config.toml（由 config.toml.tmpl 改名并改三处，见 §5.2）
# env     → /opt/ai-memory/.env（由 .env.prod.example 改名填值；chmod 600）
```

> **运行时数据不在宿主机目录**：compose 用**命名卷** `ai_memory_data` 挂到容器 `/data`（见 §5.1），宿主机侧只需 `/opt/ai-memory/` 放下上述三个文件即可 —— 不要试图在宿主机上找 `/data`。

### 4.2 专用系统账号（Sprint 3 起）

```bash
sudo useradd -m -s /bin/bash aimem-ssh
sudo mkdir -p /home/aimem-ssh/.ssh
sudo -u aimem-ssh ssh-keygen -t ed25519 -N '' -C 'mcp-forced-command-identity' -f /home/aimem-ssh/.ssh/id_ed25519
sudo install -m 600 -o aimem-ssh -g aimem-ssh /dev/null /home/aimem-ssh/.ssh/authorized_keys
```

### 4.3 强制命令

**主人（默认库）—— 管理员入口** —— `sudo vim /home/aimem-ssh/.ssh/authorized_keys`：

```text
command="docker exec -i ai-memory-mcp ai-memory mcp --tier smart --profile admin",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding <PUBKEY>
```

**用户（一用户一库，逐行追加）** —— 完整模板与逐项解释见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2：

```text
command="docker exec -i -e AI_MEMORY_DB=/data/users/alice/ai-memory.db -e AI_MEMORY_AGENT_ID=human:alice -e AI_MEMORY_KEY_DIR=/data/users/alice/keys -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0 ai-memory-mcp ai-memory mcp --tier smart --profile core",no-agent-forwarding,no-port-forwarding,no-pty,no-user-rc,no-X11-forwarding <PUBKEY>
```

> **档位口径（2026-09-21 定稿，决议与理由见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8.3）**：用户通道 = **`--profile core`（8 项，最小面）**；管理员入口 = **`--profile admin`（22 项，含删除 / 遗忘 / 治理）**，两条模板**分开维护**，不混用。
> **不写 `--profile` 的风险**：不传该参数时上游默认就是 `core` 且**不报错、不告警**（实测，探针 [`../scripts/probes/profile-probe.sh`](../scripts/probes/profile-probe.sh)）⇒ 用户行的 `core` 是**显式声明**（防静默漂移），管理员行的 `admin` 是**实质授权**（不加就只剩 8 项）。
> 改档位必须重连才生效（harness 不支持延迟注册）。

> 逐行追加 = 最小侵入、易审计、可回滚（**不要**整文件重写，一次拼错会连带整个文件失效）。

### 4.4 用户目录属主引导（替代原 sudoers root 规则）

门户以 `aimem`（uid 999）身份创建用户目录，故 `/data/users` 必须**组可写**（一次性、幂等）：

```bash
sudo docker exec -u 0 ai-memory-mcp install -d -m 2775 -o root -g 999 /data/users
sudo docker exec -u 0 ai-memory-mcp ls -ld /data/users      # 期望 drwxrwsr-x root aimem
```

> **这不是权限放宽**：`/data` 根与共享主库本来就是 `aimem:aimem` 可写，能写它们的进程同样能写该目录；唯一新增的能力者就是门户（设计意图）。副产品：原 `NOPASSWD: docker exec -u 0 …` 的 sudoers 规则**已删除** —— `aimem-ssh` 账号的密钥一律带 forced command，**不需要**任何 sudo 权限。
> 历史目录（`/data/users/iso-*` 等）不受影响。

### 4.5 目录与权限（root 手工操作，保底）

```bash
sudo docker exec -u 0 ai-memory-mcp install -d -m 0700 /data/users/alice
sudo docker exec -u 0 ai-memory-mcp install -d -m 0700 /data/users/alice/keys
```

> 门户路径下这两步由门户自动完成（`0700`、属主 `aimem`，见 §4.4 前置）；本节留给 root 手工建库与排障。

---

## 5. compose 契约与配置

### 5.1 compose 契约（摘自 `../deploy/docker-compose.prod.yml`）

> 两个服务（`ai-memory` = serve / `curator` = 整理守护进程）**共用**同一镜像、同一 `env_file: .env`、同一数据卷与同一 config 挂载。

| 契约 | 值 | 说明 |
|---|---|---|
| 卷 | `ai_memory_data:/data` | 两服务共享；容器重启保留全部状态 |
| **config 挂载** | `./config.toml` → `/data/.config/ai-memory/config.toml:ro` | **两服务各挂一处**（共 2 处），**只读**。目标路径必须与 `HOME=/data` 的推导一致，否则配置被**静默忽略**（见 §7.2 S3） |
| 容器名 | `ai-memory-mcp`（serve）· `ai-memory-mcp-curator`（curator） | forced command 硬编码前者 |
| 网络 | `default`：`external: true`，名 **`portainer_network`** | 不是 compose 自建网络；本机基线由 [`../scripts/local-up.sh`](../scripts/local-up.sh) 先建同名网络 |
| 重启策略 | `unless-stopped` | 两服务均常驻 |
| 端口映射 | **无** | 容器端口不映射主机（SSH 接入不需要）；容器内绑 `127.0.0.1:9077` |
| serve 命令 | `serve --host 127.0.0.1 --port 9077` | 无 `--tier`（档位只认 config 的 `tier`） |
| curator 命令 | `curator --daemon --interval-secs 3600 --max-ops 50` | 后台智能整理；`--max-ops` 限每轮 LLM 操作数 |
| 环境变量 | 两服务**各设 3 项、取值一致**：`HOME=/data` · `AI_MEMORY_DB=/data/ai-memory.db` · `AI_MEMORY_REQUIRE_AGENT_ATTESTATION="0"` | 注意 compose 里 attestation 写作**带双引号**的 `"0"`；口径与实测判据见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §9 B3，静态护栏 `make attestation-paths` |
| 特性 | 官方默认（`sqlite-bundled`） | compose 未声明 `features`；**不含 postgres** |
| 拉取策略 | 显式 `image: ghcr.io/alphaonedev/ai-memory:${IMAGE_TAG}`（**禁用 latest**） | 与锁文件指纹一致 |

### 5.2 `config.toml` 三个必改点（否则静默失败）

| # | 断点 | 修复 |
|---|---|---|
| 1 | 嵌入后端与模型不适配（smart 档 preset 默认走 **Ollama 的 Nomic**，本部署无 Ollama） | 显式写 `[embeddings]`：`backend = "qwen"`、`model = "qwen3.7-text-embedding"` |
| 2 | 未显式指定 dim（无环境变量，只能写配置） | `dim = **1024**`（qwen3.7-text-embedding；**静态常量，改了必须重建**） |
| 3 | LLM 端点指向默认（`backend = "qwen"` 默认打到 dashscope **公网**端点，不是私有 MaaS） | `[llm]` **显式** `base_url = "<QWEN_BASE_URL>"`、`model = "qwen-plus"`、`api_key_env = "DASHSCOPE_API_KEY"`；`[llm.auto_tag]` **只写 model** = `qwen-turbo`（**不写 `backend`** → 逐字段继承 `[llm]`，避免照抄上游 `backend="ollama"` 导致静默全挂） |

### 5.3 `config.toml` 关键字段（与 `../deploy/config.toml.tmpl` 逐键一致）

> 本节只登记**模板里真实存在**的键。模板未出现的上游键一律「未设置、走编译默认」，不在此处臆列取值。

| 节 / 顶层 | 字段 | 值 | 说明 |
|---|---|---|---|
| 顶层 | `schema_version` | `2` | sectioned 形态（v1 扁平形态用 `ai-memory config migrate`） |
| 顶层 | `tier` | `smart` | `serve` 无 `--tier`，档位只认这里 |
| 顶层 | `api_key` | **不设置** | 不对外暴露 HTTP API；将来开放须同时设 `AI_MEMORY_REQUIRE_API_KEY=1`，认证头是 `X-API-Key`（不是 `Authorization: Bearer`） |
| `[llm]` | `backend` | `qwen` | 官方一等别名（等价 dashscope），但其**默认指向公网端点** ⇒ 必须配合 `base_url` |
| | `model` | `qwen-plus` | 便宜档；`qwen-max` 仅当万不得已 |
| | `base_url` | `<QWEN_BASE_URL>` | **必须显式覆盖**为私有 MaaS，否则 workspace 级 key 在公网端点不通 |
| | `api_key_env` | `DASHSCOPE_API_KEY` | 只写**环境变量名**，不是 key 本身（内联 `api_key` 会在解析期被拒） |
| `[llm.auto_tag]` | `model` | `qwen-turbo` | **只写 model**；其余字段逐字段继承 `[llm]` |
| `[embeddings]` | `backend` | `qwen` | smart 档 preset 默认走 Ollama 的 Nomic ⇒ **必须显式覆盖** |
| | `model` | `qwen3.7-text-embedding` | 端点 `/models` 实测存在（[`../scripts/probes/qwen-verify.sh`](../scripts/probes/qwen-verify.sh)） |
| | `dim` | `1024` | **静态常量**，见下方提示 |
| | `base_url` | `<QWEN_BASE_URL>` | 与 `[llm]` 同一私有 MaaS 端点 |
| | `backfill_batch` | `100` | 回填批次（上游界 `1..=10000`，越界回落 100 并告警） |

> **静态常量：`[embeddings].dim`（`1024`）** —— 改了必须重建 / 回填向量索引。四个易踩点：① qwen 的 embedding 模型**不在**上游 `KNOWN_EMBEDDING_DIMS` 表内，查不到即返回 `None`；② 不设 `dim` 会退回 tier preset 的 **768**，与实际 1024 不符；③ **不存在 `AI_MEMORY_EMBED_DIM` 环境变量**，只能写配置；④ 填 `0`（非正值）会被**静默忽略**并回落。同为 1024 维的 `qwen3.7-text-embedding-flash` 也不等于向量可比。

#### `[limits]` 容量与配额（显式等于 v0.10.0 编译默认）

| 字段 | 值 | 说明 |
|---|---|---|
| `max_memories_per_day` | `1000` | 每 `(agent_id, namespace)` 每日写入条数 |
| `max_storage_bytes` | `104857600` | 100 MiB（**库内计数**，不覆盖 WAL 与临时文件） |
| `max_links_per_day` | `5000` | 链接写入配额 |
| `max_page_size` | `1000` | **HTTP 面专属**（每请求内存上限，不是限流） |
| `max_inflight_requests` | `0` | **HTTP 面专属**；`0` = 不装配准入层 |
| `vector_index_capacity` | `100000` | 内存向量索引驻留条目上限 |
| `vector_index_hard_fail_at_cap` | `false` | `false` = 触顶驱逐最旧；`true` = 拒绝新插入（仍落库） |

> 七键**显式写死**（等于编译默认）以防升级时默认值静默漂移；env 覆盖优先，**非正值视为未设**。配额行按 `(agent_id, namespace)` 逐行盖章，改配置不追溯已有行。行为证据见 [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-D TC-LIMIT。

#### 每库维护（宿主机 cron；Sprint 3 #5 定档）

compose 常驻的 `serve` / `curator` **只服务默认库**，每用户库必须逐库维护，否则过期记忆与 WAL 不会被回收。

```bash
bash memory.agent-mate.ai/scripts/maintain-user-dbs.sh --dry-run   # 先核对将被维护的库
make maintain-user-dbs                                             # 逐库 gc + curator --once
```

调度定档为**宿主机 cron**（生产定时器安装 / 日志采集 / 告警留 **Sprint 5 `#10`**「deploy:部署执行（ai-memory）」）。脚本两条硬约束：每条调用**显式 `--db <绝对路径>`**（漏传会静默回落相对路径库；容器内 `AI_MEMORY_DB` 指向主库 ⇒ 有误操作主库的风险）、每条调用显式 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`（v0.11 起上游缺省翻转为全 surface required）。单库失败**不中断**、最终非零退出供 cron 告警。

退出码契约：`0` 全部成功 · `1` 至少一个库失败 · `2` 参数错误 · `3` 环境不可用（容器未运行）—— 环境不可用时**不得静默成功**，否则 cron 会长期漏维护而不报警。

覆盖面与判据见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.3，验证见 [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-C TC-GC。

### 5.4 `.env` 只设本轮用到的 key

与 [`../deploy/.env.prod.example`](../deploy/.env.prod.example) **逐键一致** —— 只有两个键：

```text
IMAGE_TAG=<填>             # 镜像 tag；版本坐标唯一真相源是 ../upstream.lock（不要另抄一份）
DASHSCOPE_API_KEY=<填>     # 供 config 的 [llm] 与 [embeddings] 使用（配置里只写变量名）
```

> 门户 stack 用**独立的** [`../deploy/portal.env.example`](../deploy/portal.env.example)（服务器 `/opt/ai-memory/portal.env`，`chmod 600`）：只放一把**门户专用** `DASHSCOPE_API_KEY`，须与主 key **同 workspace / 同模型权限**；见 §12.2 与 [`architecture.md`](./architecture.md) §2.3 #2。
> **不要写** `GLM_API_KEY` / `QWEN_API_KEY`：本部署 LLM 与嵌入都只经 `DASHSCOPE_API_KEY`（config 里 `api_key_env` 指向它）。
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
bash scripts/probes/iso-probe.sh      # 多用户隔离探针（A/B/C 组，P1a–P6），exit 0 为准入条件
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
> **S1 的门户侧新触发路径（2026-09-21 实测）**：门户容器漏注入 MaaS key（`DASHSCOPE_API_KEY`）时，子进程日志出现 `Embed failed (401 Unauthorized): No API-key provided` + `no embeddings for HNSW index, using linear scan`，而**工具照常返回成功** ⇒ 门户启动自检必须断言 **embeddings 可达（1024 维）**，不能只断言「变量非空」。

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
| 外迁 | **每日**同步到**阿里云 OSS 私有桶** `<OSS_BUCKET>`（region = **香港**，见 §1.1）；同步后**校验 `sha256sum` 一致** |
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
| H1 | `upstream.lock` 缺失/格式错/字段缺 | 阻断 |
| H2 | 镜像 tag 不存在（releases API 404） | 阻断 |
| H3 | digest 不匹配（标签被重推，**供应链风险**） | 阻断 |
| H4 | reference commit 不可达 | 高危 |
| H5 | 镜像 tag 含 `latest`（浮动标签，**禁止**） | 高危 |

### 9.4 告警项（W，人工判断）

| ID | 触发 | 级别 |
|---|---|---|
| W1 | 上游有更新的 release | info |
| W2 | 上游有新提交 | info |
| W3 | 上游文档改动**命中契约面**（[`mcp/mcp-design.md`](./mcp/mcp-design.md) §9） | warn |
| W4 | 上游新增依赖 | warn |
| W5 | 上游依赖含已知 CVE（OSV API 查询公开 GHCR 镜像，不需 GH_TOKEN） | 高危 |
| W6 | 本地 clone 有本地提交（**事实偏离上游**） | warn |

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

### 12.2 门户接入部署（本地开发 Sprint 4 起；生产接入在 Sprint 5）

- 门户**不依赖**既有容器运行（共享数据卷是唯一耦合点：`/data/users/<handle>/ai-memory.db` 需同时被两边读写）；**不挂 docker socket**（D1 = β′，[`architecture.md`](./architecture.md) §2.1 #8）。
- 部署动作：新建 `/opt/ai-memory/` 下门户 compose；**两个 stack 独立**，可单独重启。
- **前置（须先做，否则建用户必失败）**：§4.4 的 `/data/users` setgid 引导。
- **门户 stack 的挂载与环境**：`ai_memory_data`(external) → `/data`；`config.toml` → `/data/.config/ai-memory/config.toml:ro`；自带卷 `admin_portal_data` → `/srv/portal`；env 注入**门户专用** `DASHSCOPE_API_KEY`（与主 key 同 workspace/同模型；见 [`architecture.md`](./architecture.md) §2.3 #2）。
- **门户密钥文件**：`portal.env`（服务器 `/opt/ai-memory/portal.env`，`chmod 600`；本机开发用 `memory.agent-mate.ai/deploy/portal.env`，gitignored）—— 字段只有 `DASHSCOPE_API_KEY`，模板 [`../deploy/portal.env.example`](../deploy/portal.env.example)。**与主 stack 的 `.env` 分开**：门户是公网组件，独立 key 才能单独吊销/归因。
- **门户 key 轮换/吊销**：控制台新建一把（标签 `memory-agent-mate-portal`）→ 改 `portal.env` → 重启门户 stack → 等启动自检的 embeddings 1024 维通过 → 再吊销旧的那把。**主 stack 的 `.env` 全程不动**，主线服务零中断。
- **启动自检（fail-closed）**：`/data/users` 可写 · embeddings 可达且 1024 维 · 自身二进制版本 == `upstream.lock` —— 任一不满足**拒绝启动**（[`web-portal/web-design.md`](./web-portal/web-design.md) §3.4）。
- 上线门禁：[`web-portal/web-test.md`](./web-portal/web-test.md) 的 L3（含 V1 负向隔离验收）全绿。

### 12.3 毕业路径（架构未变，只是扩展）

| 触发 | 动作 |
|---|---|
| 并发写压力（`database is locked` 频繁） | 迁 PostgreSQL 后端（需自建镜像 + CI；正式开始维护自建镜像） |
| 单节点故障不可接受 | 高可用方案 + 备份恢复演练常态化 |
| 用户量大 | 引入缓存层与连接复用（**会话级进程不可池化，见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) D3**） |

### 12.4 管理面认证（Cloudflare Access）的运维要求

> 设计口径见 [`web-portal/web-design.md`](./web-portal/web-design.md) §6 / §6.1（决议 `D8` / `D11`）：管理面身份由 **Cloudflare Access** 认定，门户**不自建账号、不存密码**。

| 项 | 要求 |
|---|---|
| **Access 应用与策略** | 为 `<ADMIN_HOST>` 建 Access 应用 + 一条 **Allow 策略**，策略内列**已批准邮箱**。**建议列 ≥ 2 个邮箱**，任一个失效仍可进入（`AC10.6`） |
| **登录方式** | **Google（主）+ 邮箱一次性验证码（兜底）**，两种钥匙互不依赖；主登录为 Google 时，重新验证多为其既有登录态静默完成 |
| **会话时长** | 目标 **3 个月**；**控制台可选档位上限疑为 1 个月**，更长需经 API / Terraform 的 `session_duration` 实测。**实施期先设控制台最大档并实测；不得把目标值写成既有能力**（`AC10.7`） |
| **增删管理员** | Zero Trust 后台：Access → Applications → 该应用 → Policies → Allow → 增删邮箱。**移除后对方在下次请求即失效**，无会话需要吊销（`AC10.10`） |
| **根凭证（必须离线保存）** | **Cloudflare 账号及其第二因素（2FA）恢复码**。邮箱失效时的恢复链：① 在 CF 后台改策略、加新邮箱 → ② 邮箱与 Google 都不可用时登 Cloudflare 账号 → ③ 再不行走**服务器 SSH**（SSH 保底路径**完全不经过门户**，主人仍可读写自己的记忆）。**恢复码须离线保存**（`AC10.8`） |
| **门户侧** | 管理面只在 06「Admin MCP 配置」内**说明**上述做法，**不提供**邀请 / 删除 / 重设密码控件；**零新增凭证、零 CF API 调用**（`AC10.9`） |
| **MCP 面** | `<MCP_HOST>` **必须绕过** Cloudflare Access —— 命令行客户端无法完成浏览器 SSO，被拦会表现为「连不上」（[`web-portal/web-design.md`](./web-portal/web-design.md) §6） |

### 12.5 三段外部前置的逐步指南（Sprint 4 `4.4` 交付）

> **读者**：资源持有者（运维）—— 三项外部前置「都有，但需要详细的指南如何配置」。
> **每步四件套**：**做什么 → 期望 → 验证 → 不符怎么办**；示例一律**占位符**（`<ADMIN_HOST>` / `<OSS_BUCKET>` 等），不写真实值。
> **机检**：本节引用的**键 / 路径 / 承诺**由门禁 `make deploy-doc-audit` 把住（探针 [`../probes/deploy-guide-audit/README.md`](../probes/deploy-guide-audit/README.md)）—— 与真源漂移会**红**。
> **边界如实登记**：控制台步骤（Cloudflare / 阿里云）**无法在本机执行**；本节保证的是「照做可得到**可验证**的结果」，故每个验证点都设计成能在**服务器或本机**跑的形态。

#### 12.5.1 Cloudflare Access（管理面认证）

| # | 做什么（Zero Trust 控制台） | 期望 | 验证（服务器 / 本机） | 不符怎么办 |
|---|---|---|---|---|
| 1 | Access → Applications → **Add self-hosted**：域名填 `<ADMIN_HOST>` | 应用建成 | `curl -s -o /dev/null -w '%{http_code}' https://<ADMIN_HOST>/` | 不是 `302` ⇒ 域名写错，或**被别的应用先匹配**（按最具体路径优先） |
| 2 | 该应用 → Policies → **Allow**：列**已批准邮箱**，**建议 ≥ 2 个**（任一失效仍可进入，`AC10.6`） | 策略生效 | 用**非名单**邮箱访问 ⇒ `302`（被拦） | 非名单也能进 ⇒ 策略不是 Allow，或还有别的 Allow 策略/组 |
| 3 | 登录方式：**Google（主）+ 邮箱一次性验证码（兜底）** | 两种钥匙**互不依赖** | 用名单邮箱登录成功 | 只配一种 ⇒ 主登录失效时**进不去** |
| 4 | 会话时长：控制台先设**最大档**（疑为 1 个月） | 实际拿到该档 | 控制台可见 | **目标 3 个月**须经 API / Terraform 的 `session_duration` 实测；**不得把目标值写成既有能力**（`AC10.7`） |
| 5 | **必须**给 `<MCP_HOST>` 建一条 **Bypass** | 命令行客户端能连 | `curl -s -o /dev/null -w '%{http_code}' https://<MCP_HOST>/` | 若也被拦 ⇒ MCP 客户端表现为「**连不上**」（命令行无法完成浏览器 SSO） |
| 6 | 增删管理员：Applications → 该应用 → Policies → Allow → 改邮箱 | **移除后对方下次请求即失效**（无会话需吊销，`AC10.10`） | 移除后让对方重试 ⇒ `302` | 仍能进 ⇒ 该邮箱还在别的 Allow 策略/组里 |
| 7 | **根凭证离线保存**：Cloudflare 账号 + 2FA 恢复码 | 存到**离线**介质 | 人工确认 | 无 —— **必须做**：邮箱失效时恢复链的第一环 |
| 8 | 门户侧：管理面只**说明**做法，**不提供**邀请 / 删除 / 重设控件（`AC10.9`） | 界面上没有这些控件 | 人工确认 | 出现控件即越界 |

> **本段收口验证**：`make portal-e2e ARGS=--online` ⇒ **退出码 `0`**（缺前置时它以 `40` **明确跳过** —— **不算通过**）。

#### 12.5.2 SSH 密钥对与 forced command

| # | 做什么 | 期望 | 验证 | 不符怎么办 |
|---|---|---|---|---|
| 1 | 调用者侧生成密钥对：`ssh-keygen -t ed25519 -C "<用途标签>" -f ~/.ssh/id_ed25519` | 生成 `.pub` | `ls ~/.ssh/id_ed25519.pub` | 已有密钥则**不要覆盖**：换 `-f` 新路径，并在 `~/.ssh/config` 的 `IdentityFile` 指过去 |
| 2 | 公钥交服务器方（**带外通道**，不要明文粘贴到聊天工具） | 服务器方拿到一行公钥 | 人工确认 | — |
| 3 | 服务器方**逐行追加**到 `/home/aimem-ssh/.ssh/authorized_keys`（`sudo vim`）：主人行 + 每用户行；模板与逐项解释见 §4.3 与 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5.2 | 属主 `aimem-ssh` · 权限 `600` | `ls -l /home/aimem-ssh/.ssh/authorized_keys` | **不要整文件重写**（一次拼错会连带整个文件失效）⇒ 只逐行追加 |
| 4 | 每用户行的 `command=` 里**显式写档位**：用户通道 `--profile core`（8 项）· 管理员入口 `--profile admin` | 显式声明 | 人工核对 `authorized_keys` 各行 | 不写 `--profile` 时上游**默认 `core` 且不报错不告警**（实测）⇒ 必须显式写 |
| 5 | 调用者侧写 `~/.ssh/config` 的 Host 块（见 §6.1） | 别名可用 | `ssh -G ai-memory` | 别名不生效 ⇒ `Host` 名拼错，或配置文件权限过宽 |
| 6 | 首次连接 | 能建立连接 | `ssh ai-memory`（MCP 客户端走 stdio 时也用它） | 被拒 ⇒ 先看 `authorized_keys` 权限与属主，再看 §4.3 的强制命令 |
| 7 | 交互 shell **不可用**（`no-pty` / `no-agent-forwarding` / `no-port-forwarding` / `no-user-rc` / `no-X11-forwarding`） | 只跑被允许的那条命令 | `ssh ai-memory bash -i` ⇒ 得到的仍是 harness（**不是**交互 shell） | 拿到交互 shell ⇒ 强制命令没生效，**立即修正**（这是保底路径的安全边界） |

#### 12.5.3 对象存储私有桶与 RAM 子账号

| # | 做什么（阿里云控制台 / 服务器） | 期望 | 验证 | 不符怎么办 |
|---|---|---|---|---|
| 1 | 建 **OSS 桶** `<OSS_BUCKET>`（region 按 §1.1 的核查结论填）· **读权限 = 私有** · **开启 SSE** | 私有 + SSE 已开 | 控制台属性页确认 | 公开读 ⇒ **立即改回**（快照含全部用户记忆） |
| 2 | 建 **RAM 子账号**（只用于备份），只授**对该桶**的最小权限（`PutObject` / `GetObject` / `ListObjects`） | AK 只够备份用 | 控制台策略明细确认 | 授了 `*` ⇒ 收窄到桶级 |
| 3 | AK / Secret **只落服务器侧**（如 `/opt/ai-memory/oss.env`，`chmod 600`）：**不入仓、不进聊天工具** | 仓库里没有任何值 | `make secret-check` | 一旦写进 `*.example` / specs ⇒ **立即吊销并轮换** |
| 4 | 备份同步（脚本 Sprint 5 落地 `memory.agent-mate.ai/backup/`）：每日快照 → 同步到桶 | 见 §8 的「同步后**校验 `sha256sum` 一致**」 | 见 §8 | 校验不一致 ⇒ **按失败告警**，不要静默重传 |
| 5 | **回读比对**（恢复演练的最小版）：从桶取回一份快照比哈希 | 一致 | `sha256sum <本地快照> <回读文件>` | 不一致 ⇒ 先查 SSE / 分片上传造成的对象差异，再查传输截断 |

> **合规性复核**：三步做完后跑 `make secret-check`（密钥 / 公网 IP / 私有端点）—— 它是**上线前**与**每次改动后**的必过项。

#### 12.5.4 门户 stack 的配置（`PORTAL_*` 的真源与取值）

**真源**：[`../deploy/portal.compose.yml`](../deploy/portal.compose.yml)（**非密钥键全部在此**）· [`../deploy/portal.env.example`](../deploy/portal.env.example) → 落地为 `portal.env`（**只放密钥**，`chmod 600`）。

| 分组 | 键 | 生产取值 / 说明 |
|---|---|---|
| 运行环境 | `PORTAL_ENV` | `production`（此值下**启用自签测试通道即拒绝启动**） |
| 面隔离 | `PORTAL_ADMIN_HOST` · `PORTAL_MCP_HOST` · `PORTAL_PORT` | 两个面各自的 Host（面隔离判据的来源）；端口只对同网反代暴露 |
| 存储 | `PORTAL_DB_PATH` · `PORTAL_USERS_ROOT` · `PORTAL_ROOT` · `PORTAL_VIEWS_ROOT` · `PORTAL_STATIC_ROOT` | 门户库**必须不在 `/data` 下**；`PORTAL_USERS_ROOT=/data/users`（与主 stack 共享卷）；后三个是**镜像内路径**，填错由启动自检**响亮失败** |
| 会话 | `PORTAL_SESSION_IDLE_TIMEOUT` · `PORTAL_SESSION_MAX_DURATION` | 毫秒；**取值归 `4.1`**，compose 里给的是保守初值 |
| 身份 | `PORTAL_ACCESS_TEAM_DOMAIN` · `PORTAL_ACCESS_AUD` · `PORTAL_ACCESS_JWKS_URL` | 团队域 + Access 应用的 `aud`；`JWKS_URL` **可选**（默认由团队域推导） |
| 日志 / i18n | `PORTAL_LOG_LEVEL` · `PORTAL_I18N_DEFAULT` | `info` · `zh-CN` |
| **生产不得设置** | `PORTAL_TEST_JWT_ENABLED` · `PORTAL_TEST_JWT_JWKS` · `PORTAL_TEST_JWT_ISS` · `PORTAL_TEST_JWT_AUD` · `PORTAL_TEST_JWT_EMAIL` | 自签 JWT 通道：仅离线自动化用，且**只允许绑定回环 Host**；写进生产即拒绝启动。该通道**同时**启用**开发登录入口** `/admin/dev-login`（**同源开关**：`enabled` 为真才注册该路由，否则路由不存在）—— 故禁止这套键即彻底关闭该入口。入口边界与身份口径见 [`web-portal/web-design.md`](./web-portal/web-design.md) D15 / [`adr/ADR-015-dev-login-entry-config-gated-registration.md`](./adr/ADR-015-dev-login-entry-config-gated-registration.md) |
| **仅开发期** | `PORTAL_LAUNCH_OVERRIDE` | 覆盖 launch 模板的「二进制那一段」；生产用 β′（镜像自带上游二进制）⇒ **不设** |

#### 12.5.5 收口验证（三段做完后一次跑完）

| # | 做什么 | 期望 |
|---|---|---|
| 1 | `docker compose -f portal.compose.yml --env-file portal.env config` | 无语法 / 插值错误（**落地前先跑**） |
| 2 | `docker compose ... up -d`，看门户日志 | 启动自检**全过**：`/data/users` 可写 · embeddings 可达且 **1024** 维 · 自身二进制版本 == [`../upstream.lock`](../upstream.lock)；任一不满足**拒绝启动**（fail-closed） |
| 3 | `make deploy-doc-audit` | **退出码 `0`**（指南与真源不漂移） |
| 4 | `make portal-e2e ARGS=--online` | 退出码 `0`（`40` = 前置不足，**不算通过**） |
| 5 | `make secret-check` | 通过（无密钥 / 无公网 IP / 无私有点） |

---

## 13. 部署验收清单

- [ ] 三个静默失败点已确认（embedder 未降级 / curator `tagged` 非 0 / 档位为 `smart`）
- [ ] 端到端冒烟七项全通过
- [ ] `iso-probe.sh` exit 0（多用户隔离）
- [ ] 备份脚本已落地并成功执行过一次，外迁校验 `sha256sum` 一致
- [ ] 恢复演练已做过一次
- [ ] 管理面 Cloudflare Access 已配置：Allow 策略含 **≥ 2 个邮箱**、登录方式为 **Google + 邮箱一次性验证码**，且 **Cloudflare 账号的 2FA 恢复码已离线保存**（`AC10.6`–`AC10.8`）
- [ ] `make secret-check` / `make doc-links` 通过
- [ ] 部署完成后补文档记录（日期 / 版本 / 配置文件 / 冒烟结果 / 备份位置 / 已知问题）

---

## 14. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-22 | **新增 §12.4 管理面认证（Cloudflare Access）的运维要求**：把 [`web-portal/web-design.md`](./web-portal/web-design.md) §6.1（`D8` / `D11`）的实施细则落到部署侧 —— Access 应用与 Allow 策略、**策略内 ≥ 2 个邮箱的冗余**、登录方式（Google 主 + 邮箱一次性验证码兜底）、**会话时长档位**（目标 3 个月 / 控制台上限疑为 1 个月 / 实施期实测，**不得把目标当既有能力**）、增删管理员的步骤、**根凭证（Cloudflare 账号 2FA 恢复码）须离线保存**与三层恢复链、门户侧不提供增删与重设控件、MCP 面必须绕过 Access。§13 补对应验收项。**背景**：该要求此前只写在 `web-design.md` §6.1（并声明「须落 `deployment.md`」），部署文档缺失 ⇒ `AC10.8` 无法验收，属本次一致性审计的实质缺口 |
| 2026-09-22 | **与部署制品逐字段收敛（Sprint 3 #6）**：§5.1 compose 契约表改正两处实质失准 —— ①「配置来源」由「环境变量，不挂 config 文件」改为真实的 `./config.toml → /data/.config/ai-memory/config.toml:ro`（两服务各一处、只读）；② curator 命令由不存在的 `--sqlite-path / --auto-tag / --poll-interval / --skip-setup-wizard` 改为真实的 `--daemon --interval-secs 3600 --max-ops 50`。补登 `config 挂载` · 网络（`external: true` 的 `portainer_network`）· 两服务环境变量（`HOME` · `AI_MEMORY_DB` · `AI_MEMORY_REQUIRE_AGENT_ATTESTATION="0"`）· curator 容器名 `ai-memory-mcp-curator` · serve 命令。§5.3 关键字段表按 `config.toml.tmpl` 逐键重写（删去上游**不存在**的 `max_tokens` / `temperature` / `[storage.sqlite].pool_size` / `[memory].max_age_days` / `[context_optimizer].max_results`；`[embeddings]` 的 `provider=fastembed` / `model=qwen/Qwen3-Embedding-0.6B` 更正为 `backend=qwen` / `model=qwen3.7-text-embedding`）；「两个静态常量」更正为仅 `[embeddings].dim`（上游无 `[storage].embedding_dim`，那是运行时结构体字段）。§1 事实文件清单由「三个」改为**入仓 5 个 + 派生 4 个**；§2/§5.4 的 `.env` 键与 `.env.prod.example` 对齐（`IMAGE_TAG` + `DASHSCOPE_API_KEY`，去掉未使用的 `GLM_API_KEY` / `QWEN_API_KEY`）；§2/§3/§4.1 部署目录由 `/opt/ai-memory/data/` 更正为 `/opt/ai-memory/` 并注明运行时数据在**命名卷**。另把 `.env.prod.example` 的服务器路径 `/opt/ai-memory-mcp/` 统一为 `/opt/ai-memory/` |
| 2026-09-21 | **每库维护定档（Sprint 3 #5）**：§5.3 新增「每库维护（宿主机 cron）」小节 —— 维护入口 [`../scripts/maintain-user-dbs.sh`](../scripts/maintain-user-dbs.sh) / `make maintain-user-dbs`、两条硬约束（显式 `--db`、显式 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`）与失败语义；生产定时器安装留 Sprint 5。覆盖率证据见 [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-C TC-GC |
| 2026-09-21 | **补 `[limits]` 容量与配额（Sprint 3 #4）**：§5.3 新增七键表（显式等于 v0.10.0 编译默认）与优先级 / 逐行盖章 / HTTP 面专属说明；模板 [`../deploy/config.toml.tmpl`](../deploy/config.toml.tmpl) 同步落盘；行为证据见 [`mcp/mcp-test.md`](./mcp/mcp-test.md) §4-D TC-LIMIT |
| 2026-09-20 | **specs 整合**：`dev-plan.md` / `deployment_strategy.md` / `deploy/README.md` / `deploy/deployment-plan.md` 并入本文档；订正三处历史不一致 —— ① 健康探测**不用 curl**（镜像无 curl，改判 serve 日志 + `doctor`）；② 备份外迁频率统一为**每日**；③ 占位符统一 `<VPS4_IP>`（原文 `<vps4>` 混用）。删除 dev-plan 中误提的 gitleaks（本项目用 `make secret-check`） |
| 2026-09-21 | **§4.4 改为「用户目录属主引导」**：一次性 `install -d -m 2775 -o root -g 999 /data/users`（setgid）使非 root 门户可自建 `0700` 用户目录，并**删除**原 `NOPASSWD: docker exec -u 0` root 规则（`aimem-ssh` 密钥一律带 forced command，不需要 sudo）；§4.5 改为「root 手工操作，保底」。§12.2 补门户 stack 的挂载/密钥/启动自检前置。§7.2 补 S1 的门户侧新触发路径（缺 `DASHSCOPE_API_KEY` ⇒ 401 + linear scan，工具仍成功）。依据 [`architecture.md`](./architecture.md) §2.3 与 [`knowledge/web-portal/portal-launch-mechanism.md`](./knowledge/web-portal/portal-launch-mechanism.md) |
| 2026-09-21 | **§4.3 强制命令定档**：主人（默认库 = **管理员入口**）行 → `--profile admin`（22 项）；用户（一用户一库）行 → `--profile core`（8 项，显式声明 —— 不传时默认也是 core 且**不报错**）；补「档位口径」注与「改档须重连」。决议与理由 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §8.3；实测依据 [`../scripts/probes/profile-probe.sh`](../scripts/probes/profile-probe.sh)（7 档全绿）；对外用户版说明 [`mcp/mcp-capabilities.md`](./mcp/mcp-capabilities.md) |
| 2026-09-22 | **Sprint 编号随 Replan 改指**：§5.3 生产定时器、端到端验收脚本、`/data/backups` 备份脚本目录三处的 Sprint 由旧 Sprint 5 改为 **Sprint 6** |
| 2026-09-24 | **云资源清单落点 + 备份目标写实 + 两处指称校正**：① 新增 **§1.1 云资源准备清单**（唯一真源，7 项外部资源）；Sprint 5 `#8` 的指针由 `deploy/README.md`（该文件**并无**此清单）改指 §1.1；② §8 外迁目标由「OSS 兼容对象存储」写实为**阿里云 OSS 私有桶**，region 标 **待核查**并给出核查命令；③ §5.3 的「留 Sprint 5」改为**条目级**指称 `#10`，与该行承接的「生产定时器安装 / 日志采集 / 告警」互指（此前该生产项在任何 Sprint 都无承接条目）；④ **订正上一条（2026-09-22）**：其「改为 Sprint 6」的改指已被 2026-09-23 重排取代 —— 生产上线与备份恢复整体回到 Sprint 5，故正文三处「Sprint 5」自始正确，本次未改正文。依据与过程见 [`change-log.md`](./change-log.md) 2026-09-24 |
| 2026-09-24 | **三段外部前置的逐步指南（Sprint 4 `4.4`）**：① 新增 **§12.5**（CF Access 8 步 · SSH 密钥对与 forced command 7 步 · 对象存储私有桶与 RAM 子账号 5 步 · 门户 `PORTAL_*` 真源表 · 收口验证 5 项），每步「**做什么 → 期望 → 验证 → 不符怎么办**」四件套、示例一律占位符；② **门户 stack 真源入仓**（同样服务于本行，文件在 [`../deploy/portal.compose.yml`](../deploy/portal.compose.yml)）：21 个 `PORTAL_*` 键从「只写在设计文档 §12.9」变为**部署真源**；③ 本节引用的键 / 路径 / 承诺由门禁 `make deploy-doc-audit` 把住（判据 `A2` 即由「红」转「绿」）。依据见 [`change-log.md`](./change-log.md) 2026-09-24 的 `4.4` 交付小节；`§1.1` / `§8` / `§12.2` 正文**未改**（本行只新增 §12.5）。 |
