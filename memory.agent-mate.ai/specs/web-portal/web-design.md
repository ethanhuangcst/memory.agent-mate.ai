# web-design — 管理门户（admin portal）设计

> **状态**：v1.0（specs 整合版） · as_of 2026-09-20 · 上游基准 `v0.10.0`
> **真相源**：决议集中登记在 [`../architecture.md`](../architecture.md) §2 · 数据流与两 stack 划分见 [`../architecture.md`](../architecture.md) §3 · 隔离机制见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) · 故事 [`./web-stories.md`](./web-stories.md) · 测试 [`./web-test.md`](./web-test.md) · 部署 [`../deployment.md`](../deployment.md) §12.2
> **边界**：只定义设计。**不含**部署动作、密钥、真实 IP；代码位置 `admin_portal/`（本仓，单一工作区）
> **证据基础**：源码行号取自 clone `main` @ `96b8c694`；制品基准 `v0.10.0`。两者提交图**不连通**，行号可能随上游重写漂移（版本坐标以 [`../../upstream.lock`](../../upstream.lock) 为准）

---

## 0. 一句话与决议登记

**一句话**：门户签发 `memo_…` 令牌 → 按令牌解析出「用户 → 库路径 + 身份」→ 以**子进程**拉起 ai-memory 的 MCP stdio 会话，并把 HTTP 与 stdio 对接。**隔离仍靠「一用户一数据库」**，门户不改上游一行代码。

| # | 决议 | 状态 |
|---|---|---|
| D1 | **启动机制 β′**：门户镜像内 `COPY` 上游二进制，直接 spawn（备选 α = `docker exec`，见 §9 附录） | **已定稿**（2026-09-21 用户确认；落地前置 §3.4） |
| D2 | 接入方式：新增 HTTP MCP 路径；SSH 路径**保留**为运维/主人保底 | 已定稿 |
| D3 | 隔离强度：**一用户一库** `/data/users/<handle>/ai-memory.db` | 已定稿 |
| D4 | 密钥：`memo_` + 32 字节 CSPRNG；库内只存哈希 | 已定稿 |
| D5 | 门户对上游 ai-memory 的**语义知识 = 0**；唯一知识 = 配置里一段模板 | 已定稿 |
| D6 | 代码位置：本仓 `admin_portal/`（单一工作区） | 已定稿 |
| D7 | 两 stack **不互相依赖**：门户自带二进制，不 exec 既有容器、不挂 docker socket | 已定稿 |
| D8 | 认证边界：管理面 Cloudflare Access；MCP 面 `memo_` 令牌 | 已定稿 |

> **8 条全部锁定**。D1 曾是唯一可翻转项（涉及权限模型），已于 2026-09-21 由用户确认定稿（[`../../adr/ADR-012`](../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md)）。

---

## 1. 为什么必须有「启动器」—— 三条上游硬事实

> 常见误解：ai-memory 会读「门户写的用户文件」来决定身份/隔离。**不会**，三条实测事实：

### 1.1 分库只能在**进程启动那一刻**选定

| 事实 | 位置 |
|---|---|
| 库路径是全局 CLI 参数，可由 `AI_MEMORY_DB` 提供 | `src/daemon_runtime.rs:138-139` |
| 全子命令**唯一**的库路径解析点（含 `mcp`） | `src/daemon_runtime.rs:980` → `app_config.effective_db(&cli.db)` |

⇒ 一个进程一旦启动就跑在某个特定库上，**运行中无法换库**。

### 1.2 读隔离的「调用者」**只认环境变量**

| 事实 | 位置 |
|---|---|
| `resolve_read_visibility_caller()` 只读 `std::env::var(ENV_AGENT_ID)`；未设 = trust-all | `src/identity/mod.rs:333-345` |
| `--agent-id` 虽在 clap 上带 `env = "AI_MEMORY_AGENT_ID"`，但**传 flag 不会写回 env** | `src/daemon_runtime.rs:146-147` |

⇒ **模板必须用环境变量注入身份**，不能用 `--agent-id`（否则写入标记看似正常、读路径却 trust-all，隔离根本没开）。

### 1.3 上游**没有** MCP-over-HTTP

`src/handlers/routes.rs` 的 78 个路由常量中**无** `/mcp`、`/sse`、`streamable`；全仓 grep 亦 0 命中 ⇒ **HTTP↔stdio 桥必须由门户实现**。

### 1.4 结论

> **必须存在「启动器」**：会话建立时按用户拼出 env + argv → 拉起子进程 → 双向转发 MCP 消息。
> 门户**对 ai-memory 的语义知识 = 0**，只知道「把 `{handle}` 套进一段它不理解的模板」—— 这就是「0 耦合」的确切含义。

---

## 2. 接入路径与会话流程

| 路径 | 谁用 | 端点 | 认证 | 状态 |
|---|---|---|---|---|
| **SSH stdio** | 主人、运维、门户故障保底 | `ssh ai-memory`（forced command） | 每密钥一行 `authorized_keys` | 保留 |
| **HTTP MCP** | 外部用户 | `https://<MCP_HOST>/mcp` | `Authorization: Bearer memo_…` | 新增：本设计定义 |

> 全链路数据流与两 stack 划分见 [`../architecture.md`](../architecture.md) §3（不在此重复）。**为什么两条都留**：HTTP 是公网面、依赖反代与门户；SSH 零公网入口、零额外组件 ⇒ 门户挂掉时主人仍能读写（**降级不失效**）。

**门户容器内的会话流程**：

1. 校验 `memo_`：`sha256(token)` → 查门户库 → `{handle, status}`
2. 断言 `handle` 合法 + 拼 env/argv（模板来自**配置**，非代码）
3. spawn 子进程；MCP 协议桥：HTTP(Streamable) ⇄ stdio
4. 会话结束 → kill 子进程

**部署顺序依赖**：`ai-memory-mcp` 先起（创建命名卷 `ai_memory_data`），门户以 `external: true` 引用。

---

## 3. D1 启动机制：β′（定稿）

| | **α：`docker exec`** | **β′：镜像内带二进制直接 spawn（采用）** |
|---|---|---|
| 门户需要 | **docker socket** | 不需要 |
| 权限等价性 | 门户 ≈ **root 等价** | 门户 = `aimem`（本该有的权限） |
| 与既有容器的耦合 | 运行态耦合（须知容器名且容器在跑） | 无 |
| 模板长相 | `docker exec -i -e AI_MEMORY_DB={db} … ai-memory-mcp ai-memory mcp …` | `argv: [ai-memory, mcp, …]` + `env:` |
| 上游升级成本 | 改 `IMAGE_TAG` + 重启 | **需重建门户镜像**（可由 `upstream.lock` 自动化） |
| spawn 开销 | 每次 docker exec 握手 | 更低 |
| 会话生命周期 | 子进程在别人容器里，强杀需再连 socket | 天然随门户进程（父死子死） |

> **选 β′ 的理由**：门户是**公网可达**组件，给它 root 等价权限 = 把宿主机命运交给 Web 服务；α 的全部收益（省一次镜像重建）不抵此代价。

### 3.1 β′ 的制品契约（3 条，需探针守护）

| 契约点 | 值 | 探针 |
|---|---|---|
| 二进制路径 | `/usr/local/bin/ai-memory`（`Dockerfile:49`） | `docker run --rm --entrypoint ls <img> -l /usr/local/bin/ai-memory` |
| 运行时底座 | `debian:bookworm-slim` + `ca-certificates`（`Dockerfile:32,42-44`） | 门户基础镜像必须 **bookworm 系**（如 `node:22-bookworm-slim`）+ `ca-certificates` |
| 容器用户 | `aimem`（`useradd --system`，**UID/GID 不固定为常量**） | `docker run --rm --entrypoint id <img> aimem` → 与门户镜像**对齐** |

> 注意：**UID/GID 对齐是硬要求**：SSH 路径是在既有容器里以 `aimem` 打开 `/data/users/<u>/ai-memory.db`；门户若以不同 UID 建目录，SSH 路径**写不进去**。

### 3.2 门户构建（关键只有一行）

```dockerfile
FROM --platform=linux/amd64 node:22-bookworm-slim   # 上游镜像单平台 ⇒ 构建平台钉 amd64
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN useradd --system --create-home --shell /bin/sh --uid 999 --gid 999 aimem  # 必须与镜像内 aimem 对齐
COPY --from=ghcr.io/alphaonedev/ai-memory:<tag> \
     /usr/local/bin/ai-memory /usr/local/bin/ai-memory
# <tag> 由 upstream.lock 的 IMAGE_TAG 注入（构建参数），不手写
```

- `<tag>` **不得手写**：构建时注入，使门户与部署制品天然同版本（ADR-004 单一真相源）
- 门户镜像**不继承**上游的 `ENTRYPOINT`/`CMD`/`ENV`（避免被上游默认值静默影响）

### 3.3 门户代码里的 ai-memory 知识 = 0

全部知识收敛到**一段配置**（门户只做占位符替换，不解析语义）：

```yaml
launch:
  argv:
    - /usr/local/bin/ai-memory
    - mcp
    - --tier
    - smart
    - --profile
    - core          # §10 #1 已定（2026-09-21）：对外统一 core（8 工具）；管理员入口 admin（22）。见 ../mcp/mcp-design.md §8.3
  env:
    AI_MEMORY_DB: "/data/users/{handle}/ai-memory.db"
    AI_MEMORY_AGENT_ID: "human:{handle}"
    AI_MEMORY_KEY_DIR: "/data/users/{handle}/keys"
    AI_MEMORY_REQUIRE_AGENT_ATTESTATION: "0"
  # HOME 统一设为 /data ⇒ 所有用户共用一份 config.toml（tier / LLM 设置）
```

**强制不变量（fail-closed）**：

1. `handle` 必须匹配 `^[a-z0-9_-]{1,32}$`，且**只**来自门户数据库，**绝不**取自请求
2. 替换后断言 `AI_MEMORY_DB` 非空、以 `/data/users/` 开头、且包含该 `handle` —— 否则**拒绝启动会话**（防 §5 的 S4）
3. `AI_MEMORY_AGENT_ID` 必须由 `handle` 派生（不接受客户端传入值）
4. 子进程**不得跨用户复用**（禁止会话池）

### 3.4 落地前置：三条硬前置 + 一条启动自检（2026-09-21 实测所得）

> 逐条依据（含可复跑探针配方）见 [`../knowledge/web-portal/portal-launch-mechanism.md`](../knowledge/web-portal/portal-launch-mechanism.md) E1–E7；决议单点见 [`../architecture.md`](../architecture.md) §2.3。

| # | 前置 | 做法 | 不做的后果 |
|---|---|---|---|
| 1 | **`/data/users` 组可写（setgid）** | 一次性 `docker exec -u 0 ai-memory-mcp install -d -m 2775 -o root -g 999 /data/users`（[`../deployment.md`](../deployment.md) §4.4） | 非 root 门户**建不出**用户目录（实测 EACCES）⇒ 建用户动作直接失败 |
| 2 | **门户容器持 MaaS key** | compose 注入**同名** `DASHSCOPE_API_KEY`，值用门户**专用** key（与主 key 同 workspace / 同模型权限）；`config.toml` 的 `api_key_env` 只写变量名 ⇒ 不改配置。**2026-09-21 已确认可增签 ⇒ 首选生效**；值填 `portal.env`（服务器 `/opt/ai-memory/portal.env`、本机 `deploy/portal.env`，模板 [`../../deploy/portal.env.example`](../../deploy/portal.env.example)） | 缺 key（或 key 的模型/维度不一致）⇒ `tier=semantic` **静默降级** linear scan，工具照常返回成功 |
| 3 | **版本断言** | 构建期注入 `IMAGE_TAG`；启动时与挂载的 `upstream.lock` 比对，不一致**拒绝启动** | 陈旧门户镜像在用户库被前向迁移后**静默**操作未知 schema（上游不拒绝旧二进制） |
| 4 | **启动自检（fail-closed）** | 启动时一次性断言：① `/data/users` 可写 ② embeddings 可达且 `1024` 维 ③ 自身二进制版本 == 锁文件 ④ `handle` 白名单与模板断言在位 | 上述三类失败会分别表现为「建用户报错 / 检索静默降级 / 库静默不兼容」，**都要在启动时炸掉，而不是在用户会话里** |

> 另两条制品约束见 §3.2：底座必须 `bookworm` 系 + `ca-certificates`；镜像内 `aimem` 必须显式 `--uid 999 --gid 999`（否则 SSH 路径写不进门户建的目录）。

---

## 4. 用户、密钥、库的模型

### 4.1 `memo_` 密钥规范

| 项 | 规范 |
|---|---|
| 格式 | `memo_` + 32 字节 CSPRNG → base64url 无填充（43 字符） |
| 请求头 | `Authorization: Bearer memo_…` |
| 库内存储 | **只存** `sha256(token)` + `key_prefix`（`memo_` + 前 8 字符，供展示对账） |
| 明文 | **仅创建时显示一次**，之后不可取回（无「查看」） |
| 对比 | 常时比较 |
| 吊销 | 置 `revoked_at`；已建立会话可即时终止（门户 kill 子进程） |
| 归属 | `key → user → { handle, db_path, agent_id }` |
| 一用户多 key | 天然支持（多设备/多工具共享同一库） |

> 固定 `memo_` 前缀可用于 GitHub secret scanning 自定义模式与日志脱敏规则。

### 4.2 目录与库的创建时机

| 时机 | 动作 | 理由 |
|---|---|---|
| **创建用户** | `mkdir /data/users/<handle>`（mode `0700`，owner `aimem`） | 父目录**必须**存在 —— SQLite 不创建父目录 |
| **签发 key** | **幂等确保**目录存在（再次 `mkdir -p` + 属主校验），**不创建 DB 文件** | 一用户可有多 key ⇒ 建目录绑定在「用户」而非「key」 |
| **首次会话** | ai-memory **自动创建** DB 文件并迁移到当前 schema | `src/storage/connection.rs:121` 起 |

> **门户不创建 DB 文件**：否则门户必须理解上游 schema 演进 = 把「0 耦合」换成「高耦合」。

### 4.3 为什么不能走「门户写 config.toml，ai-memory 读文件」

| 问题 | 说明 |
|---|---|
| 门户需懂 config schema | 含 `schema_version` 与逐版本演进，任何字段改名都要改门户 |
| 身份**根本不在** config 里 | `[identity]` 只有 `anonymize_default`；`agent_id` 只能靠 env ⇒ 文件路线**无法完成身份注入** |
| 选库字段有**优先级陷阱** | `AppConfig::effective_db()` 规则：「CLI/env 路径**为非默认值**时 CLI/env 胜；**为默认值**时 config 胜」⇒ 漏设即静默落 config 的共享主库 |

⇒ **用 env 注入（一条模板），不用文件注入。**

### 4.4 门户数据模型（自己的库，建议 SQLite）

| 表 | 关键列 |
|---|---|
| `users` | `id` PK, `handle` UNIQUE, `display_name`, `status`, `created_at`, `revoked_at` |
| `keys` | `id` PK, `user_id` FK, `key_hash` BLOB UNIQUE, `key_prefix`, `label`, `created_at`, `last_used_at`, `revoked_at` |
| `audit` | `id` PK, `ts`, `actor`, `action`, `target`, `detail_json`, `source_ip` |
| `sessions`（可选） | `id` PK, `user_id`, `started_at`, `ended_at`, `client_info`, `remote_ip` |

**存储位置**：**独立卷**（`admin_portal_data` → `/srv/portal`），**不在 `/data` 下** —— 避免与用户记忆混放（备份误收 / ai-memory 目录扫描触及）。

---

## 5. 静默失败点 S4（在既有 3 个之外新增）

| # | 静默失败点 | 症状 | 为什么危险 | 规避 |
|---|---|---|---|---|
| **S4** | **会话漏设 `AI_MEMORY_DB`** | 子进程 `cli.db` 取默认值 → `effective_db` 判为「默认」→ **落到 config 的 `db = /data/ai-memory.db`** | **所有用户静默共用主人默认库** —— 无报错、无告警、隔离完全失效 | 启动前断言（§3.3 不变量 2）；每次会话写审计行（含解析出的库路径） |

> 这是 [`../architecture.md`](../architecture.md) §6 的 **R1**，已有本地行为级证据（`rc=0` 且 `source=/data/ai-memory.db`）。
> 附带发现（低危）：`src/mcp/mod.rs:3599`/`:3695` 在 inference-egress **拒绝分支**里用 `effective_db(DEFAULT_DB)` 取审计落库路径 ⇒ 该条审计会写到 config 的库而非会话库。不影响隔离，但审计「串库」，排查时需知道。

---

## 6. 接入面：域名、TLS、Cloudflare Access 边界（D8）

| 面 | 域名 | CF Access | 认证 |
|---|---|---|---|
| 管理面 | `<ADMIN_HOST>` | **开启**（浏览器 SSO） | CF Access 身份 + 门户会话 |
| MCP 面 | `<MCP_HOST>` | **必须绕过** | `memo_` 令牌 |

**为什么必须绕**：MCP 客户端是命令行/桌面程序，**无法完成浏览器 SSO 重定向**；被拦时只会收到 302/HTML，表现为「连不上」。

**两条硬要求**：

1. **两个域名分离**（不靠 path 区分）—— CF Access 的策略与绕过按 host/path 配，混用极易误配
2. **门户按 Host 头做面隔离**：管理 API 只接受 `<ADMIN_HOST>`，MCP 端点只接受 `<MCP_HOST>`；在 MCP 域名上命中管理路由时**拒绝**

> 注意：新增公网入口 ⇒ 对原有「无域名 / 无 NPM / 无公网入口」决议做**部分修订**：**ai-memory 本体仍无公网入口、仍无 api_key**；新增的只是门户面。

---

## 7. 容量、配额与限流

| 类 | 机制 | 归属 |
|---|---|---|
| **上游原生** | `[limits].max_memories_per_day` / `max_storage_bytes` / `max_links_per_day`（均 **per-(agent, namespace)** ⇒ 一用户一库一 agent 天然等价 **per-用户**）、`max_page_size`（每请求内存上限，不是限流） | 以**配置**实现并核验生效 |
| 注意：**仅 HTTP 面** | `[limits].max_inflight_requests` = 全局 HTTP 准入并发上限，超限返 503 | 多用户走 **stdio MCP**，**很可能不生效**，需实测后登记结论 |
| **门户必须自建** | 每 key 并发上限、全局并发上限、空闲超时、单会话最长时长 | 上游无「会话」概念，stdio 进程由 spawner 管 |
| **另需方案** | FS 级磁盘配额 | `max_storage_bytes` 是**库内计数**，不覆盖 WAL 与临时文件 |

查询入口：`memory_quota_status` 工具 / `ai-memory quota-status` CLI。

---

## 8. 威胁模型与缓解（T1–T10）

| # | 威胁 | 缓解 |
|---|---|---|
| T1 | **门户被攻破 = 全部用户记忆泄露** | 门户是唯一能触及所有库的组件，必须最小化：① 无 docker socket（D1=β′）② 无 shell/包管理器 ③ 最小依赖 ④ 只读根文件系统（除必要挂载）⑤ 只以 `aimem` 运行 ⑥ 容器资源限额 |
| T2 | 令牌泄露 | 只存 sha256；常时比较；可吊销；`memo_` 前缀便于扫查；`last_used_at` 异常可发现 |
| T3 | **路径穿越**（handle 拼进路径） | 正则白名单 + 值只取门户 DB + 二次断言 |
| T4 | 跨用户串号 | S4 断言 + 每会话独立子进程 + 禁跨用户复用 |
| T5 | DoS（海量会话） | 每 key / 全局并发上限 + 空闲超时 + 会话最长时长 + 子进程 cgroup 限额 |
| T6 | 单 key 泄露 = 该用户全部记忆 | 一用户多 key 便于轮换；「吊销并重签」流程；审计每条会话 |
| T7 | CF 绕过策略误配致管理面暴露 | 两个域名分离 + 门户按 Host 头面隔离并**拒绝**跨面调用 |
| T8 | 日志泄露令牌/记忆内容 | 日志只记 `key_prefix`；**不记录** MCP 报文正文与令牌明文 |
| T9 | 上游 v1.0.0 的 `[capabilities]` 默认翻转 | 门户**不使用**能力令牌（隔离靠分库）⇒ 影响面小；仍进升级预检 |
| T10 | 快照外迁泄露 | OSS 私有桶 + SSE；可叠加 `AI_MEMORY_ENCRYPT_AT_REST=1` —— 注意：它是 **per-node at-rest**、密钥在容器内，**不防门户被攻破**，只防「快照离开主机后被读」 |

---

## 9. 与上游的耦合面 C1–C8（「最小耦合」的完整清单）

| # | 契约点 | 具体值 | 探针方式 |
|---|---|---|---|
| C1 | 二进制路径 | `/usr/local/bin/ai-memory` | `ls` 镜像内路径 |
| C2 | 运行时底座 | `debian:bookworm-slim` + `ca-certificates` | 镜像 `FROM`/`apt` 行比对 |
| C3 | 容器用户 | `aimem` 的 **UID/GID** | `docker run --entrypoint id <img> aimem` |
| C4 | `mcp` 子命令及 `--tier` / `--profile` 取值 | `src/daemon_runtime.rs:175,177-183` | `ai-memory mcp --help` |
| C5 | 库路径 env 名与语义 | `AI_MEMORY_DB`（`:138-139`） | `--help` + S4 断言 |
| C6 | 身份 env 名与「只认 env」语义 | `AI_MEMORY_AGENT_ID`（`src/identity/mod.rs:333-345`） | `--help` + 隔离探针 |
| C7 | DB 自动创建 + schema 前向迁移 | `src/storage/connection.rs:121` 起 | 空目录起会话 → 库文件自动出现 |
| C8 | MCP 传输仅 stdio（**上游无 HTTP MCP**） | §1.3 | 路由常量清单比对 |

**契约探针**：`scripts/upstream-preflight.sh --with-image` 已能校验镜像指纹；应**新增一步**：在候选镜像内执行 `ai-memory --help` / `mcp --help` / `id aimem`，与上述 8 项的 baseline 快照比对，缺项或改名即阻断升级 ⇒ **上游升级对门户的影响变成可执行检查，而不是靠人记得**。

### 附录：α 方案（备选，不采用）

若将来接受「门户持有 root 等价权限」以换取「上游升级不动门户镜像」，改用 α：模板改用 `docker exec -i -e AI_MEMORY_DB=… ai-memory-mcp ai-memory mcp --tier smart`，门户容器挂载 `/var/run/docker.sock`。差异：权限 root 等价 · 容器名成为契约（需新增探针 C9）· 会话需显式回收否则泄漏 exec 进程。

**2026-09-21 定稿：α 已排除，且其缓解措施被证不成立。** ① 主流 socket 代理（Tecnativa/docker-socket-proxy）按「HTTP 方法 + URL 前缀」放行，**不支持**按容器名/命令过滤；而 exec 端点是 POST ⇒ 放行 exec 必须开 `POST=1`，`/containers/*` 前缀内的创建容器端点随之可用（可致宿主提权）⇒ 原「建议用受限 socket 代理（仅放行 exec）」**在本项目可达范围内做不到**，α 实质 = 裸 socket。② 门户是**公网可达组件**，β′ 已实测端到端可行（[`../knowledge/web-portal/portal-launch-mechanism.md`](../knowledge/web-portal/portal-launch-mechanism.md) E2），α 的唯一收益「上游升级不必重建门户镜像」已由升级流程覆盖。决议见 [`../adr/ADR-012`](../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md) 与 [`../architecture.md`](../architecture.md) §2.2。

---

## 10. 未决与开放问题

| # | 问题 | 建议 |
|---|---|---|
| 1 | ~~会话是否用 `--profile full`？~~ **已定（2026-09-21）** | 对外（门户 + SSH 用户行）**统一 `core`（8 工具）**；管理员入口 = **`admin`（22 工具）**，两条模板分开维护。**已落盘**：门户 `launch.argv`（§3.3）、SSH 强制命令（[`../deployment.md`](../deployment.md) §4.3 / [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.1–§5.2）、本地客户端条目（[`../mcp/mcp-test.md`](../mcp/mcp-test.md) §3）。决议与理由：[`../mcp/mcp-design.md`](../mcp/mcp-design.md) §8.3；实测依据 [`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh) |
| 2 | 门户技术栈 | 未定（要求：能实现 MCP Streamable HTTP + 子进程 stdio 桥） |
| 3 | 反向代理选型 | 未定（NPM / Caddy / 其它） |
| 4 | MCP 传输实现 | **本项目唯一非平凡工程量**；优先复用官方 MCP SDK 的「server transport + stdio client transport」组合，**不自行实现协议**；兼容旧版 SSE 客户端 |
| 5 | 每用户库后台维护（GC / curator / TTL）由谁执行 | 门户调度 or 主机 cron（[`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.3 已给样例） |
| 6 | 是否启用 `AI_MEMORY_ENCRYPT_AT_REST` | 见 T10；需评估密钥托管与恢复路径 |
| 7 | 门户镜像重建是否自动化 | 建议纳入 `upstream.lock` 变更触发的流水线 |
| 8 | 写路径泄露探针（[`../mcp/mcp-design.md`](../mcp/mcp-design.md) §6.4 #1） | 物理隔离下不构成跨用户泄露 ⇒ 对门户**不是阻断项** |

---

## 11. 部署步骤（摘要）

| # | 步骤 |
|---|---|
| 1 | DNS：`<ADMIN_HOST>`、`<MCP_HOST>` → 4 号机 |
| 2 | TLS + 反向代理（唯一新增公网入口） |
| 3 | Cloudflare Access：仅 `<ADMIN_HOST>` 开启；`<MCP_HOST>` 显式绕过 |
| 4 | 既有 stack 微调：`docker-compose.prod.yml` 的卷加显式 `name: ai_memory_data`（供门户 `external` 引用）—— **对既有 stack 的唯一改动** |
| 5 | 构建门户镜像（`<tag>` 由 `upstream.lock` 注入） |
| 6 | 部署门户 stack：挂载 `ai_memory_data`(external) → `/data`；`admin_portal_data` → `/srv/portal`；`config.toml` → `/data/.config/ai-memory/config.toml:ro` |
| 7 | 建首个用户 + 签发 key（同时验证目录创建） |
| 8 | 冒烟 + 隔离验收（[`./web-test.md`](./web-test.md)） |
| 9 | 备份扩展：遍历 `/data/users/*/ai-memory.db`；门户库单独备份 |

---

## 12. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | **specs 整合**：由 `admin_portal_design.md` 迁入 `web-portal/`；**去重** —— 全链路数据流与两 stack 职责表已上移 [`../architecture.md`](../architecture.md) §3，本文档只保留门户内部设计；静默失败点 S4 与 architecture 的 R1 互指不重复叙述；耦合面 C1–C8 与 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §9（A–K）分工：C* 是门户对上游的 8 个依赖点，A–K 是全量契约清单 |
| 2026-09-20 | 已关闭的既有矛盾：门户代码位置定为本仓 `admin_portal/`（推翻「本仓不承载」）；「无公网入口」决议**部分修订**为「ai-memory 本体无公网入口，门户面有」；自有资产根增为两个（`memory.agent-mate.ai/` + `admin_portal/`）；升级七步增「门户镜像随 `upstream.lock` 重建」 |
| 2026-09-21 | **D1 定稿（β′，用户确认）+ 新增 §3.4 落地前置 + §9 附录更新**：§0 的 D1 由「可翻转」转**已定稿**；§3.2 构建片段补 `--platform=linux/amd64` / `ca-certificates` / 显式 `--uid 999 --gid 999`；新增 §3.4「三条硬前置 + 一条启动自检」（`/data/users` setgid 引导、门户持独立 MaaS key、版本断言、启动自检 fail-closed）；§9 附录补「α 的缓解措施被证不成立 + α 已排除」。依据 [`../knowledge/web-portal/portal-launch-mechanism.md`](../knowledge/web-portal/portal-launch-mechanism.md) E1–E7 |
| 2026-09-21 | **§3.3 会话档位定稿 + §10 #1 关闭**：`launch.argv` 由注释掉的待定项改为生效的 `--profile core`（对外统一 8 项）；§10 #1 由「未定」改为**已定**（管理员入口 = `admin` 22 项，两条模板分开维护），并指向已落盘的四处模板。决议与理由 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §8.3；实测 [`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh)；接入说明页的内容源 = [`../mcp/mcp-capabilities.md`](../mcp/mcp-capabilities.md)（[`./web-stories.md`](./web-stories.md) AC6.4） |
