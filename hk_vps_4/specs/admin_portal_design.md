# admin_portal_design — 管理门户与多用户 MCP 接入设计

> **用途**：定义 `admin_portal`（管理门户）这一**新增产品**与既有 ai-memory-mcp 部署的关系 —— 谁负责什么、数据流怎么走、耦合面有几处、怎么验收。
> **状态**：v1.0 · as_of 2026-09-20 · 上游基准 = 部署所钉 `v0.10.0`（版本坐标见 [`../upstream.lock`](../upstream.lock)）
> **关联**：[`multiuser_isolation.md`](./multiuser_isolation.md)（隔离机制与 §7 验收）· [`deployment_strategy.md`](./deployment_strategy.md)（决议真相源）· [`upstream_coupling_surface.md`](./upstream_coupling_surface.md)（契约面）· [`asset_isolation_plan.md`](./asset_isolation_plan.md)（资产隔离纪律）· [`sprint_plan.md`](./sprint_plan.md)
> **边界**：本文档**只定义设计**。不含部署动作、不含密钥、不含真实 IP。
> **证据基础**：源码行号取自本地 clone（`main` @ `96b8c694`，2026-09-20 核实）。文档与制品基准为 release tag `v0.10.0` —— 两者提交图不连通，故行号可能随上游重写而漂移（见 `upstream.lock` NOTES）。

---

## 0. 结论摘要与决议登记

**一句话**：多用户接入改由 **admin_portal** 承担 —— 门户签发 `memo_…` 令牌、按令牌解析出「用户 → 库路径 + 身份」，并以**子进程**方式拉起 ai-memory 的 MCP stdio 会话，把 HTTP 与 stdio 对接起来。**隔离仍靠「一用户一数据库」**（`multiuser_isolation.md` 方案 ③），门户不改上游一行代码。

| # | 决议 | 状态 | 依据 |
| --- | --- | --- | --- |
| D1 | **启动机制**：门户镜像内 `COPY` 上游官方镜像里的 `ai-memory` 二进制，以子进程拉起（**β′**） | 🟡 **本文档定稿**，可翻转（备选 α 见 [附录 A](#附录-aα-方案完整配方备选不采用)） | §4 |
| D2 | 接入方式：新增 HTTP MCP 路径；SSH 路径保留为运维/主人自用 | ✅ 已定 | §3.1 |
| D3 | 隔离强度：**一用户一库**（`/data/users/<handle>/ai-memory.db`） | ✅ 已定（用户 #2 + `multiuser_isolation.md` 方案 ③） | §5 |
| D4 | 密钥：`memo_` + 32 字节 CSPRNG；库内只存哈希 | ✅ 已定（用户 #3） | §5.1 |
| D5 | 门户与上游耦合：门户代码 **0** 知识；唯一知识 = 配置里一段模板 | ✅ 已定（用户 #1 + A） | §4.3、§8 |
| D6 | 代码位置：本仓 `admin_portal/`（单一工作区） | ✅ 已定（用户 #4） | §12 #1 |
| D7 | 两 stack **不互相依赖**：门户自带 ai-memory 二进制，不 exec 既有容器、不挂 docker socket | ✅ 已定（用户 #1） | §3.3 |
| D8 | 认证边界：管理面走 Cloudflare Access；MCP 面走 `memo_` 令牌 | ✅ 已定 | §7 |

> **需要你注意的唯一可翻转项是 D1**（涉及权限模型）。其余 7 条已由你的答复锁定。

---

## 1. 需求（用户逐字答复，本设计的起点）

| # | 用户原话 | 本文档的解读 |
| --- | --- | --- |
| 1 | *「admin portal 是完全独立的产品，与 ai-memory-mcp 几乎 0 耦合。数据库也分开，stack 也分开，两边不要依赖。admin portal 读写的用户文件是存在 hk_vps_4 服务器上的，ai-memory-mcp 只是读取用户文件而已」* | 门户自带运行时与 ai-memory 制品；两 stack 无共享进程、无共享 socket。**⚠️ 需要一处更正**：ai-memory 不读「门户写的用户文件」来决定身份/隔离（见 §2） |
| 2 | *「admin portal 是需要独立开发的，开发完成部署到服务器上的时候自然需要建用户库目录；admin 每签发一个 key 的时候就应当创建一个目录，除非与 ai-memory-mcp 的设计不符」* | ✅ 与上游设计**相符**。精确化：目录在**创建用户**时建；签发 key 时**幂等确保**存在（见 §5.2） |
| 3 | *「memo_ 前缀，后续随机字符串」* | 采纳（见 §5.1） |
| 4 | *「单一工作区，方便同步上下文」* | 门户代码进本仓 `admin_portal/`（推翻 `multiuser_isolation.md` §8 #2） |
| 5 | *「若『只输出文档』是指不执行部署（即保留这两个文件）→ 我就按原计划执行」* | 本文档只落盘，不部署 |
| 6 | *「选 A」* | 门户自己 spawn（而非独立第三进程），见 §4 |

---

## 2. 为什么必须有「启动器」—— 三条上游硬事实

用户第 1 条的愿景里有一处理解需要更正：**ai-memory 不读任何「门户写的用户文件」来决定「我是谁 / 用哪个库」。** 三条实测事实说明为什么：

### 2.1 隔离 = 分库；分库只能在**进程启动那一刻**选定

| 事实 | 位置 |
| --- | --- |
| 库路径是全局 CLI 参数，可由 `AI_MEMORY_DB` 环境变量提供 | `src/daemon_runtime.rs:138-139`（`#[arg(long, env = "AI_MEMORY_DB", default_value = DEFAULT_DB, global = true)]`） |
| 全子命令**唯一**的库路径解析点（含 `mcp` 子命令） | `src/daemon_runtime.rs:980` → `let db_path = app_config.effective_db(&cli.db);` |

一个进程一旦启动就跑在某个特定库上，**运行中无法换库**。要给 Alice 一个独立的库，就必须在她那个进程**启动时**把路径交进去。

### 2.2 读隔离的「调用者」**只认环境变量**，不认参数

| 事实 | 位置 |
| --- | --- |
| `resolve_read_visibility_caller()` 只读 `std::env::var(ENV_AGENT_ID)`；未设 = trust-all | `src/identity/mod.rs:333-345` |
| `--agent-id` 虽在 clap 上带 `env = "AI_MEMORY_AGENT_ID"`，但**传 flag 不会写回 env** | `src/daemon_runtime.rs:146-147` |

⇒ **模板必须用环境变量注入身份，不能用 `--agent-id`**（否则写入标记看似正常、读路径却 trust-all，隔离根本没开 —— 即 `multiuser_isolation.md` 坑 #3）。

### 2.3 上游**没有** MCP-over-HTTP ⇒ HTTP↔stdio 桥必须由门户实现

| 核实项 | 结果 |
| --- | --- |
| `src/handlers/routes.rs` 的 78 个路由常量中是否有 `/mcp`、`/sse`、`streamable` | **无**（0 命中） |
| 全仓 grep `streamable` / `McpTransport` / `mcp_transport` | **无**（0 命中） |
| 与本仓既有结论是否一致 | ✅ 一致 —— `deployment_strategy.md` §7.1 已列三条证据 |

⇒ 客户端（Cursor 等）**不能**直接把上游 `serve` 当 MCP 端点用。门户必须自己实现「HTTP MCP 传输 ⇄ 子进程 stdio」的桥接。

### 2.4 三条合起来 ⇒ 结论

> **必须存在一个「启动器」**：它在会话建立时按用户拼出 env + argv，拉起 ai-memory 子进程，并把 MCP 消息双向转发。
> 门户**对 ai-memory 的语义知识 = 0**，它只知道「把 `{handle}` 套进一段它不理解的模板」。这就是「0 耦合」的确切含义。

---

## 3. 架构

### 3.1 两条接入路径的边界

| 路径 | 谁用 | 端点 | 认证 | 状态 |
| --- | --- | --- | --- | --- |
| **SSH stdio**（既有） | 主人自用、运维、门户故障时的保底 | `ssh ai-memory`（forced command） | 每密钥一行 `authorized_keys` | ✅ **保留**（`deployment_strategy.md` §0 决议；`multiuser_isolation.md` §5.1） |
| **HTTP MCP**（新增） | 外部用户 | `https://<MCP_HOST>/mcp` | `Authorization: Bearer memo_…` | 🆕 本文档定义 |

**为什么两条都留**：HTTP 路径是公网面、依赖反代与门户；SSH 路径零公网入口、零额外组件。保留 SSH = 门户挂掉时主人仍能读写自己的记忆（**降级不失效**）。

### 3.2 数据流

```
【管理面】浏览器
   │  HTTPS
   ▼
Cloudflare Access（SSO，仅管理域名）── 新增
   ▼
https://<ADMIN_HOST>/            → 门户管理 UI / API（建用户、签发/吊销 key、审计）

【MCP 面】客户端（Cursor / Claude / …）
   │  HTTPS  POST https://<MCP_HOST>/mcp     Authorization: Bearer memo_…
   ▼
反向代理（TLS 终止，两个 Host 分流）── 新增（唯一新增公网入口）
   ▼
┌─────────────────────────────────────────────────────────────┐
│ admin_portal 容器（internet-facing，2 个挂载点）              │
│  ① 校验 memo_：sha256(token) → 查自己的库 → {handle, status}  │
│  ② 断言 handle 合法 + 拼 env/argv（模板来自配置，非代码）      │
│  ③ spawn 子进程；MCP 协议桥：HTTP(Streamable) ⇄ stdio         │
│  ④ 会话结束 → kill 子进程                                     │
└─────────────────────────────────────────────────────────────┘
   │ spawn  │ /data 卷（与既有 stack 共享同一命名卷）
   ▼        ▼
ai-memory 子进程（每会话一个）
   env  AI_MEMORY_DB=/data/users/<handle>/ai-memory.db   ← 物理隔离
        AI_MEMORY_AGENT_ID=human:<handle>                ← 读路径隔离（§2.2）
        AI_MEMORY_KEY_DIR=/data/users/<handle>/keys
        AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0
   argv ai-memory mcp --tier smart
        ▲ 库文件由 ai-memory 首次打开时自动创建（src/storage/connection.rs:121 起）
   ▼
/data/users/<handle>/ai-memory.db   +   /data/users/<handle>/keys/
   ▲ 与 SSH 路径（multiuser_isolation.md §5.2）**指向同一批文件** ⇒ 一个用户一份记忆，两条路径互通
```

### 3.3 两个 stack 的职责划分

| 维度 | `ai-memory-mcp`（既有 stack） | `admin_portal`（新增 stack） |
| --- | --- | --- |
| 容器 | `ai-memory`（serve）+ `curator` | `admin_portal`（门户 + 其 spawn 的 N 个子进程） |
| 服务对象 | 主人自用、运维（默认库 `/data/ai-memory.db`） | 外部用户（每用户库 `/data/users/<handle>/`） |
| 公网入口 | ❌ 无（`serve` 绑 `127.0.0.1`） | ✅ 有（经反代） |
| 数据卷 | `ai_memory_data` → `/data` | **同一卷** `ai_memory_data` → `/data`（共享文件、不共享进程） |
| 与对方的关系 | **不知道门户存在** | 知道「一段模板」 |
| 共享的东西 | **仅** `/data` 卷与 `config.toml` 文件 | 同左 |

> 「两边不要依赖」的落地口径：**无共享进程、无 docker socket、无网络互调**。共享一个数据卷是「一个用户一份记忆」的**必然要求**（否则 SSH 与门户会读到两个不同的库，同一用户出现两座孤岛）。
> **部署顺序依赖**：`ai-memory-mcp` 先起（创建命名卷），`admin_portal` 以 `external: true` 引用它（见 §11）。

---

## 4. D1 启动机制：β′（定稿）与 α（备选）

门户要 spawn ai-memory，有两条实现路线：

| | **α：`docker exec`** | **β′：门户镜像内带二进制，直接 spawn** |
| --- | --- | --- |
| 门户需要 | **docker socket** | ❌ 不需要 |
| 权限等价性 | 门户 ≈ **root 等价**（socket 可 exec 任意容器） | 门户 = `aimem`（= 它本该有的权限） |
| 与既有容器的耦合 | **运行态耦合**：必须知道容器名且容器在跑 | 无 |
| 模板长相 | `docker exec -i -e AI_MEMORY_DB={db} … ai-memory-mcp ai-memory mcp …` | `argv: [ai-memory, mcp, …]` + `env:` |
| 上游升级成本 | 改 `IMAGE_TAG` + 重启 | **需重建门户镜像**（可从 `upstream.lock` 自动化） |
| spawn 开销 | 每次 `docker exec` 握手 | 更低 |
| 会话生命周期 | 子进程在别人容器里，强杀需再连 socket | 天然随门户进程（父死子死） |

**定稿采用 β′**，理由是它在**不牺牲「0 耦合」**的前提下消掉了本设计最大的一个风险点：门户是**公网可达**的组件，给它 root 等价权限等于把整个宿主机的命运交给一个 Web 服务。而 α 的全部收益（省一次镜像重建）不抵这个代价。

### 4.1 β′ 的制品契约（3 条，需探针守护）

| 契约点 | 值 | 来源 | 探针 |
| --- | --- | --- | --- |
| 二进制在镜像内的路径 | `/usr/local/bin/ai-memory` | `Dockerfile:49` | `docker run --rm --entrypoint ls <img> -l /usr/local/bin/ai-memory` |
| 运行时底座 | `debian:bookworm-slim`；仅额外需 `ca-certificates` | `Dockerfile:32`、`:42-44` | 门户基础镜像必须是 **bookworm 系**（如 `node:22-bookworm-slim`）+ `ca-certificates` |
| 容器用户 | `aimem`（`useradd --system`，**系统 UID/GID 不固定为常量**） | `Dockerfile:45-46`、`:56` | `docker run --rm --entrypoint id <img> aimem` → 记录 UID/GID 并与门户镜像**对齐** |

> ⚠️ UID/GID 对齐是**硬要求**：SSH 路径（`multiuser_isolation.md` §5.2）是在既有 `ai-memory` 容器里以 `aimem` 打开 `/data/users/<u>/ai-memory.db` 的；门户若以不同 UID 建目录，SSH 路径会**写不进去**。此项必须进 `upstream_coupling_surface.md`（§8）。

### 4.2 落地形态（门户构建）

```dockerfile
# admin_portal/Dockerfile —— 关键只有第三行：从上游官方镜像取二进制
FROM node:22-bookworm-slim                        # 必须是 bookworm 系（§4.1）
COPY --from=ghcr.io/alphaonedev/ai-memory:<tag> \
     /usr/local/bin/ai-memory /usr/local/bin/ai-memory
# <tag> 从 hk_vps_4/upstream.lock 的 IMAGE_TAG 注入（构建参数），不手写
```

- `<tag>` **不得手写**：构建时由 `upstream.lock` 注入，使门户与部署制品天然同版本（符合 ADR-004 单一真相源）。
- 门户镜像**不继承**上游的 `ENTRYPOINT`/`CMD`/`ENV`（避免被上游默认值静默影响）。

### 4.3 门户代码里的 ai-memory 知识 = 0

全部知识收敛到**一段配置**（门户只做占位符替换，不解析语义）：

```yaml
# 门户配置文件（运维资产，会随 upstream.lock 一起被审查）
launch:
  argv:
    - /usr/local/bin/ai-memory
    - mcp
    - --tier
    - smart
    # - --profile      # ← 见 §14 #1（默认 core = 7 工具）
    # - full
  env:
    AI_MEMORY_DB: "/data/users/{handle}/ai-memory.db"
    AI_MEMORY_AGENT_ID: "human:{handle}"
    AI_MEMORY_KEY_DIR: "/data/users/{handle}/keys"
    AI_MEMORY_REQUIRE_AGENT_ATTESTATION: "0"
  # HOME 由容器统一设为 /data ⇒ 所有用户共用一份 config.toml（tier / LLM 设置）
```

**门户代码侧的强制不变量（fail-closed）**：

1. `handle` 必须匹配 `^[a-z0-9_-]{1,32}$`，且**只**来自门户数据库，**绝不**取自请求；
2. 替换后断言 `AI_MEMORY_DB` 非空、以 `/data/users/` 开头、且包含该 `handle` —— 否则**拒绝启动会话**（防 §9 S4）；
3. `AI_MEMORY_AGENT_ID` 必须由 `handle` 派生（不接受客户端传入值）；
4. 子进程**不得跨用户复用**（禁止会话池）。

---

## 5. 用户、密钥、库的模型

### 5.1 `memo_` 密钥规范（用户 #3）

| 项 | 规范 |
| --- | --- |
| 格式 | `memo_` + 32 字节 CSPRNG → base64url 无填充（43 字符），例：`memo_x7Kf9aB2cD4e…` |
| 请求头 | `Authorization: Bearer memo_…` |
| 库内存储 | **只存** `sha256(token)`（BLOB）+ `key_prefix`（`memo_` + 前 8 字符，供页面展示对账） |
| 明文 | **仅创建时显示一次**，之后不可再取（无「查看」功能） |
| 对比 | 常时比较 |
| 吊销 | 置 `revoked_at`；已建立会话可即时终止（门户 kill 子进程） |
| 归属 | `key → user → { handle, db_path, agent_id }` |
| 一个用户多把 key | ✅ 天然支持 —— 多设备/多工具共享同一库（`multiuser_isolation.md` 场景 A） |

> `memo_` 固定前缀还有一个副产品：可加入 GitHub secret scanning 自定义模式与日志脱敏规则，便于泄露扫查。

### 5.2 目录与库的创建时机（用户 #2 的精确化）

| 时机 | 动作 | 理由 |
| --- | --- | --- |
| **创建用户**（门户） | `mkdir /data/users/<handle>`（mode `0700`，owner = `aimem`） | 父目录**必须**存在 —— SQLite 不会创建父目录 |
| **签发 key**（门户） | **幂等确保**目录存在（再次 `mkdir -p` + 属主校验），**不创建 DB 文件** | 用户 #2 的判断正确；但一个用户可有多把 key，故建目录绑定在「用户」而非「key」上 |
| **首次会话**（ai-memory） | **自动创建 DB 文件并迁移到当前 schema** | `src/storage/connection.rs:121` 起：`Connection::open` → `execute_batch(SCHEMA)` → `migrate()` |

> **为什么门户不创建 DB 文件**：那会让门户必须理解上游的 schema 与「schema 版本」演进 —— 即把「0 耦合」换成「高耦合」。让 ai-memory 自己建是最低耦合的写法。

### 5.3 为什么不能走「门户写 config.toml，ai-memory 读文件」这条路

这是用户第 1 条最初设想的形态，但实测是**高耦合**：

| 问题 | 说明 |
| --- | --- |
| 门户需懂 config schema | 含 `schema_version`（模板现为 `2`）与逐版本演进，任何字段改名都要改门户 |
| 身份**根本不在** config 里 | `[identity]` 只有 `anonymize_default`；`agent_id` 只能靠 env（`src/identity/mod.rs:333-345`）⇒ 文件路线**无法完成身份注入**，最终仍要 env |
| 选择库的字段存在**优先级陷阱** | `config.toml` 有 `db` 字段（模板 `config.toml.tmpl:13`）；`AppConfig::effective_db()`（`src/config.rs:7506`）规则为「**CLI/env 路径为非默认值时 CLI/env 胜**；CLI/env 为默认值 `ai-memory.db` 时 config 胜」 |

⇒ 结论：**用 env 注入（一条模板），不用文件注入。**

---

## 6. 门户数据模型

门户**自己的库**（建议 SQLite，与 ai-memory 机制无关、互不读写）：

| 表 | 关键列 | 说明 |
| --- | --- | --- |
| `users` | `id` PK, `handle` UNIQUE, `display_name`, `status`, `created_at`, `revoked_at` | `handle` 用于拼目录名 ⇒ 必须正则白名单校验 |
| `keys` | `id` PK, `user_id` FK, `key_hash` BLOB UNIQUE, `key_prefix`, `label`, `created_at`, `last_used_at`, `revoked_at` | 只存哈希（§5.1） |
| `audit` | `id` PK, `ts`, `actor`, `action`, `target`, `detail_json`, `source_ip` | 建用户 / 签 key / 吊销 / 每次会话开始 |
| `sessions`（可选） | `id` PK, `user_id`, `started_at`, `ended_at`, `client_info`, `remote_ip` | 也可只放内存；落库便于审计与并发计数 |

**存储位置**：**独立卷**（如 `admin_portal_data` → `/srv/portal`），**不放在 `/data` 下**。理由：不与用户记忆混放（避免备份脚本误收、避免 ai-memory 的目录扫描触及）。

---

## 7. 接入面：域名、TLS、Cloudflare Access 边界（D8）

| 面 | 域名（示例） | CF Access | 认证 |
| --- | --- | --- | --- |
| 管理面 | `<ADMIN_HOST>` | ✅ **开启**（浏览器 SSO） | CF Access 身份 + 门户会话 |
| MCP 面 | `<MCP_HOST>` | ❌ **必须绕过** | `memo_` 令牌 |

**为什么必须绕**：MCP 客户端是命令行/桌面程序，**无法完成浏览器 SSO 重定向** —— 若 MCP 面被 Access 拦住，客户端只会收到 302/HTML，表现为「连不上」。

**因此有两条硬要求**：

1. **两个域名分离**（推荐），而不是同一域名靠 path 区分 —— CF Access 的策略与绕过按 host/path 配，混用极易误配；
2. **门户必须按 Host 头做面隔离**：管理 API 只接受 `<ADMIN_HOST>`，MCP 端点只接受 `<MCP_HOST>`；在 MCP 域名上命中管理路由时**拒绝**（防止 CF 绕过策略误配时管理 API 暴露公网）。

> ⚠️ 新的公网入口意味着需要对 `deployment_strategy.md` 的「无域名 / 无 NPM / 无 HTTPS / 无公网入口」做**部分修订**（见 §12 #2）：**ai-memory 本体仍无公网入口**，新增的是门户面。

---

## 8. 门户与上游的耦合面（需补进 `upstream_coupling_surface.md`）

门户依赖上游的东西**全部**如下 —— 这就是「最小耦合」的完整清单，共 8 条：

| # | 契约点 | 具体值 | 探针方式 |
| --- | --- | --- | --- |
| C1 | 二进制路径 | `/usr/local/bin/ai-memory` | `ls` 镜像内路径（§4.1） |
| C2 | 运行时底座 | `debian:bookworm-slim` + `ca-certificates` | 镜像 `FROM`/`apt` 行比对 |
| C3 | 容器用户 | `aimem` 的 **UID/GID** | `docker run --entrypoint id <img> aimem` |
| C4 | `mcp` 子命令存在及 `--tier` / `--profile` 取值 | `src/daemon_runtime.rs:175`、`:177-178`、`:179-183` | `ai-memory mcp --help` |
| C5 | 库路径 env 名与语义 | `AI_MEMORY_DB`（`src/daemon_runtime.rs:138-139`） | `--help` + §9 S4 断言 |
| C6 | 身份 env 名与「只认 env」语义 | `AI_MEMORY_AGENT_ID`（`src/identity/mod.rs:333-345`） | `--help` + 隔离探针（§13） |
| C7 | DB 自动创建 + schema 前向迁移 | `src/storage/connection.rs:121` 起；`CURRENT_SCHEMA_VERSION` | 空目录起会话 → 库文件自动出现 |
| C8 | MCP 传输仅 stdio（**上游无 HTTP MCP**） | §2.3 | 路由常量清单比对 |

**契约探针设计**：`hk_vps_4/scripts/upstream-preflight.sh --with-image` 已能拉取镜像校验指纹；应**新增一步**：在候选镜像内执行 `ai-memory --help` / `mcp --help` / `id aimem`，与上述 8 项的 baseline 快照比对，缺项或改名即阻断升级。

> 好处：**上游升级对门户的影响变成一条可执行的检查**，而不是靠人记得。若 C1/C3 变化，门户镜像重建会失败或产生权限错，预检能提前发现。

---

## 9. 静默失败点（在既有 3 个之外新增 S4）

`dev-plan.md` §3.4 已登记三个静默失败点（embedder 降级、curator fail-open、config 挂载路径错误）。门户方案引入**第四个**，且它比前三个更危险（会跨用户串号）：

| # | 静默失败点 | 症状 | 为什么危险 | 规避 |
| --- | --- | --- | --- | --- |
| **S4** | **会话漏设 `AI_MEMORY_DB`** | 子进程 `cli.db` 取默认值 `ai-memory.db`（`src/daemon_runtime.rs:88`）→ `effective_db` 判为「默认」→ **落到 config 的 `db = /data/ai-memory.db`** | **所有用户静默共用主人默认库** —— 无报错、无告警、隔离完全失效 | 门户**启动前断言**：`AI_MEMORY_DB` 非空、以 `/data/users/` 开头、含该 `handle`；否则拒绝会话（§4.3 不变量 2）。每次会话开始写审计行（含解析出的库路径），便于事后对账 |

> 附带发现（低危）：`src/mcp/mod.rs:3599` 与 `:3695` 在 inference-egress **拒绝分支**里用 `effective_db(DEFAULT_DB)` 取审计落库路径 —— 即该条审计会写到 config 的库（`/data/ai-memory.db`）而非当前会话的库。不影响隔离，但审计会「串库」，排查时需知道。

---

## 10. 安全要求（威胁模型与缓解）

| # | 威胁 | 缓解 |
| --- | --- | --- |
| T1 | **门户被攻破 = 全部用户记忆泄露** | 门户是唯一能触及所有库的组件，必须最小化：① 无 docker socket（D1 选 β′）② 无 shell/包管理器 ③ 最小依赖 ④ 容器内只读根文件系统（除必要挂载）⑤ 只以 `aimem` 运行；⑥ 容器资源限额 |
| T2 | 令牌泄露 | 只存 sha256；常时比较；可吊销；`memo_` 前缀便于扫查；`last_used_at` 异常可发现 |
| T3 | **路径穿越**（`handle` 拼进路径） | `^[a-z0-9_-]{1,32}$` 白名单 + 值只取门户 DB + 二次断言（§4.3） |
| T4 | 跨用户串号 | §9 S4 断言 + 每会话独立子进程 + 禁跨用户复用 |
| T5 | DoS（海量会话） | 每 key 并发上限 + 全局并发上限 + 空闲超时 + 会话最长时长 + 子进程 cgroup 限额 |
| T6 | 单 key 泄露 = 该用户全部记忆 | 一用户可多 key 便于轮换；提供「吊销并重签」流程；审计每条会话 |
| T7 | CF 绕过策略误配导致管理面暴露 | 两个域名分离 + 门户按 Host 头面隔离并**拒绝**跨面调用（§7） |
| T8 | 日志泄露令牌/记忆内容 | 日志只记 `key_prefix`；**不记录** MCP 报文正文与令牌明文 |
| T9 | 上游 v1.0.0 的 `[capabilities]` 默认翻转影响门户 | 门户**不使用**能力令牌（隔离靠分库）⇒ 影响面小；但仍进升级预检（`upstream_coupling_surface.md` K2/K3） |
| T10 | 快照外迁泄露 | OSS 私有桶 + SSE；可叠加 `AI_MEMORY_ENCRYPT_AT_REST=1` —— ⚠️ 注意它是 **per-node at-rest**、密钥在容器内，**不防门户被攻破**（门户仍可解），只防「快照离开主机后被读」 |

---

## 11. 部署步骤（摘要；本次不执行）

| # | 步骤 | 说明 |
| --- | --- | --- |
| 1 | DNS：`<ADMIN_HOST>`、`<MCP_HOST>` → 4 号机 | 两个域名 |
| 2 | TLS + 反向代理 | 新增组件（唯一新增公网入口） |
| 3 | Cloudflare Access：仅 `<ADMIN_HOST>` 开启；`<MCP_HOST>` 显式绕过 | §7 |
| 4 | 既有 stack 微调 | `docker-compose.prod.yml` 的卷加显式 `name: ai_memory_data`（供门户 `external` 引用）—— **这是对既有 stack 的唯一改动** |
| 5 | 构建门户镜像 | `admin_portal/Dockerfile`，`<tag>` 由 `upstream.lock` 注入（§4.2） |
| 6 | 部署门户 stack | 挂载：`ai_memory_data`（external）→ `/data`；`admin_portal_data` → `/srv/portal`；`config.toml` → `/data/.config/ai-memory/config.toml:ro` |
| 7 | 建首个用户 + 签发 key | 走门户管理面（同时验证 §5.2 目录创建） |
| 8 | 冒烟 + 隔离验收 | 见 §13 |
| 9 | 备份扩展 | 备份脚本改为遍历 `/data/users/*/ai-memory.db`（`multiuser_isolation.md` §5.4）；门户自己的库单独备份 |

> 每用户库的**后台维护**（TTL 遗忘 / GC / curator）尚未有归属 —— 既有 `curator` 只服务默认库。见 §14 #5。

---

## 12. 要推翻 / 修订的既有决议

| # | 文件 | 现有内容 | 处置 |
| --- | --- | --- | --- |
| 1 | `multiuser_isolation.md` §8 #2 | 「admin portal … 结论倾向：**本仓不承载**，如需则另建项目」 | ❌ **推翻** —— 用户决议：单一工作区，本仓 `admin_portal/` |
| 2 | `deployment_strategy.md` §0 | 「无域名 / 无 NPM / 无 HTTPS / 无公网入口 / 无 api_key」 | ⚠️ **部分修订** —— 新增门户后**存在**公网入口（仅门户面）；**ai-memory 本体仍无公网入口、仍无 api_key** |
| 3 | `asset_isolation_plan.md` §2 | 自有资产只有 `hk_vps_4/` 一个根 | ⚠️ **修订** —— 两个根：`hk_vps_4/` + `admin_portal/` |
| 4 | `deployment_strategy.md` §0 | 决议集 | ➕ **新增**：门户承担多用户 HTTP 接入；D1 = β′ |
| 5 | `upstream_coupling_surface.md` | 契约面清单 | ➕ **新增** §8 的 C1–C8（尤其 C1/C3 与「上游无 HTTP MCP」） |
| 6 | `sprint_plan.md` | **6 个 Sprint（S1–S6）** | ➕ **已落地**：门户设计→开发→部署 已排入 **Sprint 4「门户开发并与 MCP 集成」**；把 §8 的 C1–C8 契约探针加入 `upstream-preflight.sh` **仍待办** |
| 7 | `dev-plan.md` §5 | 升级七步链路 | ➕ **新增一步**：门户镜像需随 `upstream.lock` 重建（否则门户与部署制品版本漂移） |
| 8 | `Makefile` | `dist` 类目标 | ➕ 建议新增 `portal-image`（读 `upstream.lock` 注入 tag 构建门户镜像） |
| 9 | `tmp_user_key_option1.md`（仓根，未跟踪） | 「每用户 SSH 密钥 + forced command」暂记 | ⚠️ **待你处置**：它是被否路线的留档，但位于**公开仓根目录且未 gitignore**。建议移入 `hk_vps_4/specs/` 作为附录或加入 `.gitignore` |

---

## 13. 验收标准

**继承** `multiuser_isolation.md` §7 全部（每库独立计数、跨用户检索未命中、`memory_get` 不可见、库文件属主 `aimem`、维护覆盖、备份覆盖、吊销即时生效），**并新增门户侧**：

- [ ] 用户 A 的 `memo_` 令牌经 `<MCP_HOST>/mcp` 建立会话后，`--help` 之外的实调用写入落在 `/data/users/a/ai-memory.db`（**且**审计行记录该路径）
- [ ] 会话开始前后，`/data/users/` 下**没有**出现其他用户的库或临时文件
- [ ] 会话结束（客户端断开）后，`ps` 中该 ai-memory 子进程**已消失**（无僵尸、无泄漏）
- [ ] **S4 断言有效**：人为把模板里的 `AI_MEMORY_DB` 置空 → 门户**拒绝**启动会话并告警（**不得**静默落到 `/data/ai-memory.db`）
- [ ] 模板里的 `{handle}` 若替换为 `../` 等非法值 → 门户拒绝（路径穿越无效）
- [ ] 在 `<MCP_HOST>` 上请求管理 API → **拒绝**；在 `<ADMIN_HOST>` 上请求 `/mcp` → 拒绝（面隔离）
- [ ] 无 docker socket 可挂载性：门户容器**不**包含 `/var/run/docker.sock`（D1 = β′ 的验证）
- [ ] 门户镜像内 `aimem` 的 UID/GID **等于**上游镜像内 `aimem` 的 UID/GID（C3）
- [ ] 吊销 key 后，新建会话被拒；既有会话被终止
- [ ] 门户自己的库**不在** `/data` 下；备份脚本遍历用户库时**不含**门户库

---

## 14. 未决与开放问题

| # | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| 1 | 会话是否用 `--profile full`？ | 上游 `mcp --profile` **默认 `core`**（源码注释记为「v0.7.0 时的 7 个工具」；`full` 记为「v0.9.0 时 101 项」，`src/daemon_runtime.rs:179-199`）；而 `product-backlog.md` 要求「提供该版本所有功能」 | ⚠️ **需你决定**：要「所有功能」应显式加 `--profile full`。**现有 SSH 模板也没写** ⇒ 当前部署只暴露 `core` 档工具集（v0.10.0 的实际档位数**未核实**，需实测 `mcp --help` / `initialize` 回包） |
| 2 | 门户技术栈 | 影响开发与镜像 base | 未定（要求：能实现 MCP Streamable HTTP + 子进程 stdio 桥） |
| 3 | 反向代理选型 | 影响步骤 2 | 未定（NPM / Caddy / 其它） |
| 4 | MCP 传输实现 | 本项目**唯一**非平凡工程量 | 优先复用官方 MCP SDK 的「server transport + stdio client transport」组合，**不自行实现协议**；同时兼容旧版 SSE 客户端 |
| 5 | 每用户库的后台维护（GC / curator / TTL）由谁执行 | 不跑则遗忘与压缩失效 | 门户调度 or 主机 cron（`multiuser_isolation.md` §5.3 已给样例） |
| 6 | 是否启用 `AI_MEMORY_ENCRYPT_AT_REST` | 备份外迁的明文风险 | 见 T10；需评估密钥托管与恢复路径 |
| 7 | 门户镜像重建是否自动化 | 不自动则升级时易漂移 | 建议纳入 `upstream.lock` 变更触发的流水线（§12 #7） |
| 8 | 本设计文档的放置位置 | 若将来出现第二个部署目标 | 现置于 `hk_vps_4/specs/`（沿用现有约定）；若第二目标出现，再考虑上移为顶层 `specs/` |
| 9 | 写路径泄露探针（`multiuser_isolation.md` §8 #1）对门户是否仍必要 | 物理隔离下不构成跨用户泄露 | 仍建议做（结论对 SSH 方案 ② 有意义），但对门户**不是阻断项** |

---

## 15. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-20 | 初版：8 条用户决议登记；三条上游硬事实（§2）；两 stack 架构与数据流（§3）；D1 = β′（§4）；密钥/目录/schema 模型（§5–§6）；CF Access 边界（§7）；C1–C8 耦合面与探针（§8）；新增静默失败点 S4（§9）；威胁模型（§10）；部署摘要（§11）；待修订决议 9 条（§12）；验收标准（§13）；开放问题 9 项（§14） |
| 2026-09-20 | `sprint_plan.md` 重排为 6 个 Sprint 后的引用同步：§12 表第 6 行「6 项 ToDo」订正为「6 个 Sprint（S1–S6）」，并标明门户设计→开发→部署已排入 Sprint 4。本文档其余条目经复核**无编号失配**（§12 的 9 处内容矛盾仍按原计划在 Sprint 3 处理） |

---

## 附录 A：α 方案完整配方（备选，不采用）

若将来**决定接受门户持有 root 等价权限**以换取「上游升级不动门户镜像」，改用 α：

```yaml
# 门户配置（唯一变化：模板改用 docker exec；门户容器需挂 /var/run/docker.sock）
launch:
  argv:
    - docker
    - exec
    - -i
    - ai-memory-mcp          # 既有容器名（运行态耦合点）
    - ai-memory
    - mcp
    - --tier
    - smart
  env_injection_via_docker_exec:
    - AI_MEMORY_DB=/data/users/{handle}/ai-memory.db
    - AI_MEMORY_AGENT_ID=human:{handle}
    - AI_MEMORY_KEY_DIR=/data/users/{handle}/keys
```

α 与 β′ 的差异清单：

| 维度 | β′（采用） | α（备选） |
| --- | --- | --- |
| 挂载 | `ai_memory_data` → `/data` | 同 + **`/var/run/docker.sock`** |
| 权限 | `aimem` | root 等价 |
| 上游升级 | 重建门户镜像 | 改 `IMAGE_TAG` + 重启 |
| 容器名成为契约 | ❌ 否 | ✅ 是（C9，需新增探针） |
| 会话生命周期 | 父死子死 | 需显式回收，否则泄漏 exec 进程 |
| 建议加固（若采用） | — | 用受限 socket 代理（仅放行 exec 端点）替代裸 socket |
