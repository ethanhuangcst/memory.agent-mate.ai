# web-design — 管理门户（admin portal）设计

> **状态**：v1.1（Sprint 4 #1：文档边界修正 + 门户技术设计） · as_of 2026-09-22 · 上游基准 `v0.10.0`
> **真相源**：决议集中登记在 [`../architecture.md`](../architecture.md) §2 · 数据流与两 stack 划分见 [`../architecture.md`](../architecture.md) §3 · 故事 [`./web-stories.md`](./web-stories.md) · 测试 [`./web-test.md`](./web-test.md) · 部署 [`../deployment.md`](../deployment.md) §12.2
> **文档边界（2026-09-22 起）**：本文件只写**门户自身（web app）**的设计。**门户 ↔ 上游的接入契约**（MCP 端点、会话桥、启动模板、制品契约、上游耦合面）真源在 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) **§5.6** 与 **§9 M**；**MCP 侧隔离、档位与能力边界**真源在 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) **§0–§8**；**MCP 侧故事与验收条件**在 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md)。§1 / §2 / §3.1 / §3.3 / §3.4 / §9 已按此边界改为「门户侧动作 + 回链」。
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
| D9 | **门户技术栈**：Node.js 22 LTS + TypeScript；**Fastify + Nunjucks 服务端模板 + 原生 CSS**（`:root` 设计令牌）；MCP 桥用官方 `@modelcontextprotocol/sdk`（Streamable HTTP server transport + stdio client transport）；门户库 SQLite | **已定稿**（2026-09-22 用户确认；选型理由与被拒备选见 §12.0） |
| D10 | **UI 色系：纯单色灰阶，无品牌色**：主按钮墨黑实底（`--ink`）、活动态与聚焦环一律墨色、唯一有色为危险红（`--danger`）。**推翻** 2026-09-22 早前的「保留 logo 橙作唯一强调色」 | **已定稿**（2026-09-22 用户确认，属**需求变更**；理由与 `logo.png` 例外说明见 §13 开头） |
| D11 | **管理面认证维持 D8，门户不自建账号**：登录方式 = **Google（主）+ 邮箱一次性验证码（兜底）**；管理员「多把钥匙」= 在 Cloudflare Access 策略中配置**多个邮箱**；门户新增**只读**管理员页（说明 + 后台深链）。**撤销**「门户内邀请 admin / 重设密码 / 门户自建账号」三项需求 | **已定稿**（2026-09-22 用户确认；失效链与选型理由见 §6.1） |

| D12 | **页面集定为 6 页**：撤销原「07 只读管理员页」，其内容**并入 06「Admin MCP 配置」**；§12.3 路由表**无** `/admin/admins`；用户页**不含**管理员增删入口（管理员变更在 Cloudflare 侧） | **已定稿**（2026-09-22 用户确认；逐页映射见 §14） |
| D13 | **用户停用是可逆软操作**：停用 = 一次性吊销该用户**全部令牌** + 拒绝新会话，**库文件保留**；恢复 = 签发新令牌。**删除数据库属服务端独立决定，门户内不提供** | **已定稿**（2026-09-22 用户提出「缺注销用户功能」后定档；对应 `AC2.4` 语义扩展） |
| D14 | **外框冻结 + 代码块圆角例外**：`.app-header` 与 `.site-footer` 用 `sticky` 构成**固定外框**（不透明底 + 结构线）；设计系统「零圆角」有**唯一显式例外** —— `.codeblock` 保留参考稿的 `8px` 圆角 | **已定稿**（2026-09-22 用户要求「header / footer should be fixed」；实现细则见 §13.9 / §13.10） |
| D15 | **开发登录用真实邮箱身份 + 生产身份来源白名单**：开发登录入口（`/admin/dev-login`）的声明身份取自显式配置 `PORTAL_TEST_JWT_EMAIL`（**缺则启动期报错**，不得回落到 `admin@example.test` 之类测试值）；**生产**下身份解析来源必须是 Cloudflare（`access-jwt` / `service-token`），出现 `test-jwt` 一律 **401** 并记 `identity_source_rejected` 告警（Service Token 走 access 通道，不受影响） | **已定稿**（2026-09-22 用户选定口径；2026-09-23 落档。实现：`src/config.ts` 必填键 + `src/web/admin-guard.ts` 的 `isIdentitySourceAllowed`；决议见 [`../../adr/ADR-015`](../adr/ADR-015-dev-login-entry-config-gated-registration.md)） |

> **15 条全部锁定（D15 于 2026-09-23 新增）**（D9 / D10 / D11 于 2026-09-22 新增；**D12 / D13 / D14 于同日 UI 迭代轮新增**）。D1 曾是唯一可翻转项（涉及权限模型），已于 2026-09-21 由用户确认定稿（[`../../adr/ADR-012`](../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md)）；D9 曾是 §10 #2 的长期未决项，已于 2026-09-22 关闭。

---

## 1. 门户 ↔ 上游 接入契约（已迁 MCP 侧）

> **边界修正（2026-09-22，Sprint 4 #1）**：本节原「三条上游硬事实（分库只能在进程启动时选定 · 读隔离只认环境变量 · 上游无 MCP-over-HTTP）」属**跨进程 / 上游契约** —— 它随上游版本漂移、需探针守护 —— 已迁至 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) **§5.6.1**。门户侧只写「门户该怎么做」。
> **真源（本节不再复制其正文）**：[`../mcp/mcp-design.md`](../mcp/mcp-design.md) **§5.6**（门户接入面契约）· **§5.6.1**（三条上游硬事实）· **§5.6.2**（接入路径与会话桥）· **§5.6.3**（β′ 启动机制与制品契约）· **§5.6.4**（`launch` 模板与四条强制不变量）· **§9 M**（门户耦合面 C1–C8）。

**门户承接的三件事**（契约在上游侧，门户是执行方）：

| # | 门户侧动作 | 契约依据 |
|---|---|---|
| 1 | 按令牌解析出 `{handle}` → **拼 env + argv**；身份**用环境变量**注入（不用 `--agent-id`） | [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.1 结论 2 · §5.6.4 不变量 3 |
| 2 | 启动会话**前**断言库路径（非空 · 以 `/data/users/` 开头 · 含该 handle），否则**拒绝启动会话** | [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.4 不变量 2 · 静默失败点见 §5 |
| 3 | **一会话一子进程**，会话结束回收子进程；**禁止**跨用户复用 | [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.2 · §5.6.4 不变量 4 |

---

## 2. 门户的 MCP 端点与会话编排（门户侧）

> **边界修正（2026-09-22，Sprint 4 #1）**：原「接入路径表（SSH stdio / HTTP MCP）」「会话流程第 3 步（HTTP(Streamable) ⇄ stdio 协议桥）」「部署顺序依赖」属**上游接入契约**，已迁至 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) **§5.6.2**。本节只保留门户侧的端点暴露与会话编排。

| 项 | 门户侧职责 | 真源 |
|---|---|---|
| 对外端点 | 在 `https://<MCP_HOST>/mcp` 暴露 MCP Streamable HTTP；**只接受** `<MCP_HOST>`（面隔离见 §6） | [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.2 |
| 认证 | `Authorization: Bearer memo_…` → `sha256` 查门户库 → `{handle, status}` | 令牌模型见 §4.1 |
| 会话编排 | 拼 env/argv → spawn → 桥接 → 会话结束 kill（四步的**归属划分**见真源） | [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.2 |
| 保底路径 | SSH stdio **保留**给主人 / 运维，门户故障时不失效 | [`../deployment.md`](../deployment.md) §4.3（落地归 Sprint 6 接入面） |

> **为什么两条路径都留**：HTTP 是公网面、依赖反代与门户；SSH 零公网入口、零额外组件 ⇒ 门户挂掉时主人仍能读写（**降级不失效**）。全链路数据流与两 stack 划分见 [`../architecture.md`](../architecture.md) §3。

**部署顺序依赖**：`ai-memory-mcp` 先起（创建命名卷 `ai_memory_data`），门户以 `external: true` 引用。

---

## 3. 门户容器与启动（门户侧）

> **边界修正（2026-09-22，Sprint 4 #1）**：原本节（§3）的 α/β′ 机制对照、**制品契约（二进制路径 / 运行时底座 / 容器用户对齐）**、`launch` 模板与四条强制不变量、`/data/users` setgid 与版本断言的**上游依据**，均属**上游接入契约**，已迁至 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) **§5.6.3 / §5.6.4**。本节保留「门户自身的启动机制结论、镜像构建、知识收敛与落地前置」。

**启动机制（已定稿）**：**β′** —— 门户镜像内带上游二进制，**直接 spawn** 子进程；**不挂 docker socket**、**不 `docker exec`**。
机制对照（α vs β′）与选型理由见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.3；决议 [`../adr/ADR-012`](../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md)。

### 3.1 β′ 对门户的产品级后果

| # | 后果 | 门户侧承担的事 |
|---|---|---|
| 1 | 会话子进程**随门户进程存活**（父死子死） | 无需额外回收机制即可满足「会话结束回收」（S3 AC3.4 · TC-P-L1-04） |
| 2 | 上游升级**必须重建门户镜像** | 归入升级流程（§11 步骤 5 含此项；演练归 Sprint 7） |
| 3 | 门户镜像必须与上游在**制品契约**上对齐 | 见 §3.2 的构建片段与 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.3 |

> **制品契约的真源在上游侧**：[`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.3（二进制路径 `/usr/local/bin/ai-memory` · 底座 `bookworm` 系 + `ca-certificates` · 容器用户 `aimem` 且 **UID/GID 必须对齐**）。本节不再复制该表。

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

- `<tag>` **不得手写**：构建时注入，使门户与部署制品天然同版本（[`../adr/ADR-004`](../adr/ADR-004-version-contract-single-source-of-truth.md) 单一真相源）
- 门户镜像**不继承**上游的 `ENTRYPOINT`/`CMD`/`ENV`（避免被上游默认值静默影响）—— 契约依据 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.3

### 3.3 门户代码里的 ai-memory 知识 = 0

**模板真源已迁**：[`../mcp/mcp-design.md`](../mcp/mcp-design.md) **§5.6.4**（`launch.argv` / `launch.env` 全文，含 `--profile core` 与四条强制不变量）。本节不再复制模板，只登记门户据此要做的两件事：

| # | 门户侧动作 | 说明 |
|---|---|---|
| 1 | **占位符替换** | `{handle}` → 门户库中的 handle；门户**不解析**模板语义 |
| 2 | **替换后断言** | 见 §1 表格第 2 行；不满足即**拒绝启动会话**（防 §5 的静默失败点 S4） |

> 改模板（含档位或任一 `env` 键）必须同批复跑 `make attestation-paths` —— 断言 B/C 均以该模板为核对对象。

### 3.4 落地前置：三条硬前置 + 一条启动自检（门户侧执行）

> **上游侧的契约依据**（`/data/users` 卷权限形态、embeddings `1024` 维契约、旧二进制不拒绝更新的库）见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.3 与 §9 A3 · E1–F3 · J3。本节只登记**门户要做的动作**与判据。

| # | 前置 / 自检 | 门户侧做法 | 不做的后果 |
|---|---|---|---|
| 1 | **`/data/users` 组可写（setgid）** | 一次性引导 `docker exec -u 0 ai-memory-mcp install -d -m 2775 -o root -g 999 /data/users`（[`../deployment.md`](../deployment.md) §4.4） | 非 root 门户**建不出**用户目录（实测 EACCES）⇒ 建用户动作直接失败 |
| 2 | **门户容器持 MaaS key** | compose 注入**同名** `DASHSCOPE_API_KEY`，值用门户**专用** key（与主 key 同 workspace / 同模型权限）；`config.toml` 的 `api_key_env` 只写变量名 ⇒ 不改配置。**2026-09-21 已确认可增签 ⇒ 首选生效**；值填 `portal.env`（服务器 `/opt/ai-memory/portal.env`、本机 `deploy/portal.env`，模板 [`../../deploy/portal.env.example`](../../deploy/portal.env.example)） | 缺 key（或 key 的模型/维度不一致）⇒ `tier=semantic` **静默降级** linear scan，工具照常返回成功 |
| 3 | **版本断言** | 构建期注入 `IMAGE_TAG`；启动时与挂载的 [`../../upstream.lock`](../../upstream.lock) 比对，不一致**拒绝启动** | 陈旧门户镜像在用户库被前向迁移后**静默**操作未知 schema |
| 4 | **启动自检（fail-closed）** | 启动时一次性断言：① `/data/users` 可写 ② embeddings 可达且 `1024` 维 ③ 自身二进制版本 == 锁文件 ④ `handle` 白名单与**模板断言**在位 | 三类失败会分别表现为「建用户报错 / 检索静默降级 / 库静默不兼容」，**都要在启动时炸掉，而不是在用户会话里** |

> 逐条证据（含可复跑探针配方）：[`../knowledge/web-portal/portal-launch-mechanism.md`](../knowledge/web-portal/portal-launch-mechanism.md) E1–E7；决议单点 [`../architecture.md`](../architecture.md) §2.3。
> 故事与用例：**S11**（启动自检 fail-closed）· `TC-P-L0-06`–`TC-P-L0-09`。
> 另两条**制品约束**见 §3.2：底座必须 `bookworm` 系 + `ca-certificates`；镜像内 `aimem` 必须显式 `--uid 999 --gid 999`（否则 SSH 路径写不进门户建的目录）。

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

**`last_used_at` 的更新粒度（2026-09-23 定档，Sprint 4 `3.1` 开工前置）**：**会话建立（令牌认证成功）时更新一次**，**不是**每个工具调用更新。理由：一次会话内多个请求共用一个上游 stdio 子进程，「使用该令牌」的自然语义是「用它建了会话」；且避免每请求写库。**判据**：[`web-stories.md`](./web-stories.md) `AC3.7`（同一用户的多把令牌 `last_used_at` 各自独立更新）—— 未定档前，请求级与会话级两种实现都能让该 AC 判「过」。

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

### 6.1 管理面认证实施细则（D11，2026-09-22）

> **一句话**：管理员身份**由 Cloudflare Access 认定**，门户**不自建账号、不存密码**，也不提供邀请与重设密码；门户只提供一页**只读**的「管理员」页（说明 + 跳 Cloudflare 后台的深链）。

| 项 | 口径 |
|---|---|
| **身份认定** | 在 Cloudflare Zero Trust 为 `<ADMIN_HOST>` 建 Access 应用 + 一条 **Allow 策略**，策略内列**已批准邮箱**。门户从 Cloudflare 注入的**签名断言**中取身份；**门户不存密码**。 |
| **登录方式** | **Google（主）** + **邮箱一次性验证码（兜底）**。两种钥匙互不依赖 —— 任一失效仍可进入。主登录为 Google 时，重新验证多为其既有登录态**静默完成**（换电脑摩擦最小）。 |
| **多把钥匙冗余** | **在 Access 策略中配置多个邮箱**（纯配置，非门户功能）。这是「**防自己丢钥匙**」的实现方式，故**门户内不需要「邀请 admin」功能**。 |
| **会话时长** | **目标 3 个月**。**平台约束（不得断言 3 个月可用）**：Cloudflare 官方文档路径已迁移（`.../authorization-cookie/session-management/` 于 2026-09-22 两次抓取均 404），无法取得权威原文；据可得信息，控制台可见档位为 30 分钟 / 1·2·6·12·24 小时 / 1 周 / **上限疑为 1 个月**，更长需经 API / Terraform 的 `session_duration` 实测。**处理方式**：实施期**先设控制台最大档**，并实测 API 可否配置更长；若平台不接受更长，则**维持 1 个月**并记录为平台上限。 |
| **根凭证（必须离线保存）** | **Cloudflare 账号 + 其 2FA 恢复码**。这是本方案的**根凭证**——邮箱失效时经它改策略即可恢复访问。**本条为本次新增缺口**，须同时落 `deployment.md`。 |
| **失效链（三层，均不依赖门户）** | ① 换邮箱 → 在 CF 后台加新删旧（`O(1)`，无需转移流程）；② 邮箱彻底失效 → 登录 **Cloudflare 账号**改策略恢复；③ 再不行 → **服务器 SSH**，且 **SSH 保底路径（D2 / 故事 `S8`）完全不经过门户**，主人仍可读写自己的记忆。 |
| **明确不做** | 门户内**邀请 admin** · **重设密码** · **门户自建账号（邮箱 + 密码 + 会话）** · 任何形式的密码存储。**这三项为 2026-09-22 用户确认撤销的需求**（真需求「多邮箱冗余 + 不怕忘密码」已由 CF 策略天然满足；自建账号反而**引入**密码遗忘风险，且其「多邮箱」只能靠邀请功能实现，与撤销前提自相矛盾）。 |
| **门户侧唯一新增** | **内容并入 06「Admin MCP 配置」**（原「07 只读管理员页」已撤销，见 **D12** / §14）：登录方式说明 · 多把钥匙自检清单 · 会话时长说明 · **Cloudflare 侧增删管理员的确切步骤** · 跳 Cloudflare 后台深链 · SSH 保底路径提示。**零新增凭证、零 CF API 调用、零新代码**（页面内**不含**邀请 / 删除 / 重设控件）。根凭证的离线保存要求落 [`../deployment.md`](../deployment.md) §12.1（对应 `AC10.8`）。 |

> **为何不选「门户代理 CF 成员管理」或「门户自建账号」**：前者的全部收益（门户内管理名单）与「一年只用一两次、去后台点两下」相比性价比不成立，且要新增一个 CF API Token；后者是**唯一引入新外部依赖（邮件服务）**且实现量最大的方案，并会把密码遗忘风险与公网组件的防爆破 / 会话 / 限流责任一并收进门户。

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

## 9. 与上游的耦合面（已迁 MCP 侧）

> **边界修正（2026-09-22，Sprint 4 #1）**：原 §9 的 **C1–C8 契约表**、契约探针步骤与 **α 方案附录**，全部属**上游耦合契约**（随上游版本漂移、需探针守护），已迁至 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) **§9 M「门户耦合面索引（C1–C8 → A–K 映射）」**；α 的排除理由收口在 [`../architecture.md`](../architecture.md) §2.2，机制对照见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.3。
> **本节不再复制契约正文**（[`../adr/ADR-010`](../adr/ADR-010-specs-single-source-and-doc-structure.md)「一事实一处」）：A–K 是全量契约清单，C1–C8 是其中**门户实际依赖的 8 个点**的稳定索引。

**门户侧据此要做的只有一件事**：把「上游升级预检」升级为**可执行检查** —— 在候选镜像内执行 `ai-memory --help` / `mcp --help` / `id aimem`，与 baseline 快照比对，缺项或改名即**阻断升级**。脚本入口与逐项判据见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §9 M。

### 附录：α 方案（已迁 MCP 侧）

> 原文（α 机制描述 + 2026-09-21「α 已排除且缓解措施被证不成立」的结论）已迁至 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.3 与 §9 M；**α 仍为排除项**，理由见 [`../architecture.md`](../architecture.md) §2.2、证据见 [`../knowledge/web-portal/portal-launch-mechanism.md`](../knowledge/web-portal/portal-launch-mechanism.md)。

---

## 10. 未决与开放问题

| # | 问题 | 建议 |
|---|---|---|
| 1 | ~~会话是否用 `--profile full`？~~ **已定（2026-09-21）** | 对外（门户 + SSH 用户行）**统一 `core`（8 工具）**；管理员入口 = **`admin`（22 工具）**，两条模板分开维护。**已落盘**：门户 `launch.argv`（[`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.4，原 §3.3 内容已按文档边界迁出）、SSH 强制命令（[`../deployment.md`](../deployment.md) §4.3 / [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.1–§5.2）、本地客户端条目（[`../mcp/mcp-test.md`](../mcp/mcp-test.md) §3）。决议与理由：[`../mcp/mcp-design.md`](../mcp/mcp-design.md) §8.3；实测依据 [`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh) |
| 2 | ~~门户技术栈~~ **已定（2026-09-22）** | **Node.js 22 LTS + TypeScript；Fastify + Nunjucks 服务端模板 + 原生 CSS（`:root` 令牌）；MCP 桥用官方 `@modelcontextprotocol/sdk`（Streamable HTTP server transport + stdio client transport）；门户库 SQLite**。选型理由、被拒备选与落地形态见 **§12** |
| 3 | 反向代理选型 | 未定（NPM / Caddy / 其它） |
| 4 | MCP 传输实现 | **已定（落点已迁 MCP 侧）**：**本项目唯一非平凡工程量**；优先复用官方 MCP SDK 的「server transport + stdio client transport」组合，**不自行实现协议**。设计真源 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.2；契约与故事 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS3` |
| 5 | 每用户库后台维护（GC / curator / TTL）由谁执行 | **已定（Sprint 3 #5）：主机 cron** 逐库调度，唯一入口 `scripts/maintain-user-dbs.sh`。真源 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.3；故事 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS8`。生产定时器与告警留 Sprint 5 |
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

## 12. 门户技术设计

> **本章只写门户自身（web app）的实现方案**；跨进程 / 上游契约（MCP 端点形态、会话桥契约、`launch` 模板、制品契约）真源在 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6，本章只写「门户怎么落地」。

### 12.0 技术栈定档（2026-09-22，关闭 §10 #2）

| 层 | 选型 | 理由（要点） |
|---|---|---|
| 运行时 | **Node.js 22 LTS + TypeScript** | §3.2 的底座**已钉 `node:22-bookworm-slim`** ⇒ 选 Node **零改动**保住制品契约（§3.1 / TC-P-L1-11·12）；与官方 MCP TS SDK 同栈 |
| HTTP 框架 | **Fastify** | 路由与**按 Host 分面**在 Hook 层一处收口（§6 两条硬要求）；静态资源与低开销 |
| 视图 | **Nunjucks 服务端模板** | 原型是纯 HTML + 单一 CSS ⇒ 模板可**逐字复用**原型结构，直接兑现「**实现的 UI 与 mockup 完全一致**」；无客户端框架与构建步骤 |
| 样式 | **原生 CSS + `:root` 设计令牌**（单文件 `portal.css`） | 与参考 mockup **同一手法且同一令牌体系**（令牌集中在自定义属性，见 §13.1）；无 CDN 样式依赖、无打包器 |
| 字体 | `Outfit`（拉丁 UI）+ `Noto Sans SC` / `Noto Sans TC`（中日韩）+ `JetBrains Mono`（数据与代码） | 经 Google Fonts `@import` 加载（照参考稿）；栈内含 `system-ui` / `ui-monospace` ⇒ **离线降级为系统字体栈** |
| MCP 桥 | **`@modelcontextprotocol/sdk`**：服务端用 **Streamable HTTP server transport**，客户端用 **stdio client transport** | §10 #4 明令「**优先复用官方 SDK**、**不自行实现协议**」；**不手写帧解析** |
| 门户库 | **SQLite**（单文件，落在 `admin_portal_data` 卷）；驱动定档 **`better-sqlite3`**（同步 API ⇒ 事务边界清晰，天然支撑 fail-closed 审计；`engines: node >= 22` 与容器底座一致） | 单机、零外部依赖、备份与恢复简单；与上游同技术栈；**不在 `/data` 下**（§4.4） |
| 入参校验 | **Zod** | `handle` 白名单与请求体校验；与 MCP SDK 的 schema 习惯一致 |
| i18n | **四语言服务端词表**（`en` / `zh-CN` / `zh-HK` / `zh-TW`）+ `Accept-Language` / `?lang=` / `localStorage` | 与参考稿一致的四语言；**协议名、工具名、标识符一律不翻译**；**新增语言不改业务逻辑**（TC-P-L2-05）；纪律见 §12.4，字号规则见 §13.2 |
| 容器 | `node:22-bookworm-slim` + `ca-certificates`；`aimem` **uid/gid 999**、非 root、只读根（临时目录用 tmpfs） | §3.2 · TC-P-L1-11 / TC-P-L1-12 / TC-P-L1-13 |

**明确拒绝的备选**：

| 备选 | 拒绝理由 |
|---|---|
| React SPA | 必须把原型改造成组件 ⇒ 与「UI 与 mockup 完全一致」的强要求**摩擦最大**，是 UI 漂移的主要来源 |
| Next.js（App Router） | 同上；且把**长连接会话桥**放进 route handler 会与框架的请求生命周期/流式模型冲突，桥的部署形态被迫改成 standalone |
| Python / FastAPI | 需把 §3.2 底座改为 `python:3.12-bookworm-slim` 并同步改 TC-P-L1-11/12 探针，收益不足以抵该代价；仓库与历史中**亦无** Python 方案的既有记录 |

> 决议登记与 §10 #2 的关闭见 §0 / §10；上游耦合与制品契约侧不需改动。

### 12.1 模块划分与进程模型

| 模块 | 职责 | **不**包含 |
|---|---|---|
| `portal-web` | 页面渲染（Nunjucks）· 管理 API · 门户库读写 · 审计写库 · i18n · 启动自检（§3.4） | **不** spawn 上游子进程 |
| `mcp-bridge` | 令牌 → `{handle}` 解析后的**会话建立**：占位符替换 · spawn 前断言 · spawn · `HTTP(Streamable) ⇄ stdio` 双向转发 · 会话回收 · 响应吊销事件终止既有会话 | **不**渲染页面、**不**承担管理业务 |

- 两模块**同镜像、同进程树**（D7：门户自带二进制，不 exec 既有容器、不挂 docker socket）。真源对照见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.2 的「归属」列。
- **进程模型**：单个 Node 进程承载两模块；**每个 MCP 会话一个上游子进程**，父死子死。**不使用** cluster / 多 worker —— 会话状态（子进程句柄、transport 实例）是**进程内**的，多 worker 会破坏「一会话一子进程」与吊销终止的确定性（T4 / T5）。
- **契约要点**（实现前必读）：身份**只经环境变量**注入（`--agent-id` 传 flag **不写回 env**）；spawn 前断言库路径 —— 两者真源均在 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.1 / §5.6.4。

### 12.2 目录与文件命名（代码位置 `admin_portal/`）

```
admin_portal/
├── Dockerfile                  # 见 §3.2（底座 / uid·gid / COPY 上游二进制；tag 由 upstream.lock 注入）
├── package.json                # 依赖钉版本（含 @modelcontextprotocol/sdk）；无前端构建步骤
├── tsconfig.json
├── src/
│   ├── server.ts               # 启动自检（§3.4）→ Fastify 装配 → listen
│   ├── config.ts               # env 读取与校验（**不含** launch 模板来源 —— 模板已内建，见 §12.9）
│   ├── selfcheck.ts            # 四项 fail-closed 自检
│   ├── web/                    # portal-web
│   │   ├── routes/             # index(首页 = 接入说明) · admin.users · admin.detail · admin.audit · admin.capacity · admin.mcp
│   │   ├── views/              # Nunjucks 模板：**结构 = specs/web-portal/mockups/*.html（同名映射，见 §14）**
│   │   ├── i18n/               # en.json · zh-CN.json · zh-HK.json · zh-TW.json（键集合相同；协议名不翻译）
│   │   └── db/                 # schema.sql · migrate.ts · repo/*
│   ├── bridge/                 # mcp-bridge
│   │   ├── route.ts            # /mcp 路由（仅接受 {MCP_HOST}）
│   │   ├── session.ts          # 会话注册表与生命周期、回收、吊销终止
│   │   ├── spawn.ts            # 占位符替换 + 断言 + spawn
│   │   ├── transport.ts        # Streamable HTTP server transport ⇄ stdio client transport
│   │   └── launch-template.ts  # **内建 launch 模板常量**（逐字对照 ../mcp/mcp-design.md §5.6.4，由启动自检断言；见 §12.9）
│   └── shared/                 # host-split.ts · handle.ts · audit.ts · redact.ts
├── assets/                     # UI 资产（源自 specs/web-portal/mockups/assets/，清单见 §15）
└── README.md                   # UI 资产清单与同步方式（见 §15）
```

**命名约定**：模板文件名与原型**同名**（如原型 `03-user-detail.html` ↔ 模板 `views/admin-user-detail.njk`），并在 §14 的逐页映射表中登记**一一对应**关系，使「实现与原型一致」可机械核对。

### 12.3 路由表与按 Host 分面

| 面 | Host | 路径 | 模块 | 认证 | 可见性 |
|---|---|---|---|---|---|
| 公开 | `<ADMIN_HOST>` | `/`（**首页即接入说明**：8 项能力 + 三步接入 + HTTP 客户端配置 + 3 条 FAQ；四语言） | `portal-web` | 无 | 公开 |
| 管理面 | `<ADMIN_HOST>` | `/admin/users` · `/admin/users/:handle` · `/admin/audit` · `/admin/capacity` · **`/admin/mcp`（Admin MCP 配置）** | `portal-web` | Cloudflare Access 身份 + 门户会话 | 仅管理员 |
| 管理面 API | `<ADMIN_HOST>` | `/admin/api/*`（建用户 · 签发 · 轮换 · 吊销 · 列表 · 审计查询） | `portal-web` | 同上 | 仅管理员 |
| **MCP 面** | `<MCP_HOST>` | `/mcp`（Streamable HTTP：`POST` / `GET`） | `mcp-bridge` | `Authorization: Bearer memo_…` | 持令牌的 MCP 客户端 |

**面隔离（fail-closed，对应 AC10.x / T7）**：Fastify 在 `onRequest` 钩子按 `Host` 头**先判面再路由** ——
① 在 `<MCP_HOST>` 上命中任何 `/admin*` 或公开页 → **拒绝**（不回退到管理面）；
② 在 `<ADMIN_HOST>` 上命中 `/mcp` → **拒绝**（不降级为匿名）；
③ 两个域名**分离**、不靠 path 区分（§6 两条硬要求）。

**旧路径兼容**：`/instructions` 作为历史路径 **301 → `/`**（首页已与接入说明合并，避免旧链接失效）。

**公开页不含机密**：`/` 只渲染静态文案与占位符示例（`{MCP_HOST}` / `{handle}`），**不读取**任何用户库、**不列出**用户或令牌；`/admin/mcp` 的管理员配置示例同样**只用占位符**（不含真实主机名、IP 与凭据）。

### 12.4 模板与 i18n 约定

- **模板 = 原型**：`views/*.njk` 的结构与类名**照原型**（原型是结构的唯一参照；一一映射见 §14）；样式一律走 `portal.css` 的令牌与类，**不在模板内写内联样式**（除原型本身已用的少量内联）。
- **四语言**：`en` / `zh-CN` / `zh-HK` / `zh-TW`（与参考稿一致；语言按钮组标 `EN` / `CN` / `HK` / `TW`）。四份词表**键集合相同**；缺键回落 `en`、再回落键名本身。
- **i18n 纪律**：**禁止硬编码用户可见文案** —— 模板一律 `{{ t('page.section.item') }}`；**协议名、工具名与标识符不翻译**（如 `memory_store`、`human:<handle>`、`memo_` 前缀）；词表键缺失**在开发/测试期 fail-loud**（渲染报错，不静默回退），新增语言只增词表、**不改业务逻辑**（TC-P-L2-05）。
- **语言解析顺序**：`?lang=` 优先，其次 `Accept-Language`，回落 `zh-CN`；切换只影响渲染，**不改变**任何业务分支；选择记入 `localStorage`（与参考稿同机制）。
- **渐进增强**：词表渲染、语言按钮组、对话框开合、复制回显与「query 驱动变体态」都由极少量脚本承担（沿用参考稿的 `[data-i18n]` / `data-open-dialog` / `data-copy` / `data-i18n-attr` 约定）；**脚本未执行时页面仍可读**（HTML 内保留英文兜底文案），**不引入**打包器与前端框架。
- **文案纪律**：四语言**一律短句**；术语用用户语言（写「令牌」不写内部字段名）；动作名贯穿流程（按钮与结果提示同一词）。

### 12.5 会话桥实现方案（`mcp-bridge`）

> **契约在** [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.2；本节只写落地选型。**实现前必须按官方文档核对 SDK 当前签名**（SDK 在版本间会改方法名与注册方式），**不得**照抄历史片段。

| 环节 | 方案 |
|---|---|
| 会话标识 | 门户生成 `sessionId` 并与**该会话的上游子进程**一对一绑定（注册表键） |
| 服务端 transport | 官方 SDK 的 **Streamable HTTP server transport**，挂到 `/mcp`；**兼容旧版 SSE 客户端**（§10 #4） |
| 客户端 transport | 官方 SDK 的 **stdio client transport**：`command` / `args` / `env` **全部来自 `launch` 模板的替换结果**，门户**不解析语义**。**开发期例外**：`command`/`args` 可被 `PORTAL_LAUNCH_OVERRIDE` 覆盖（仅 development，生产拒绝启动）；**覆盖时 env 透传由覆盖命令自己负责**（见 §12.9） |
| 双向转发 | 由 SDK 的 server↔client 直连能力完成（**不手写帧解析**）；门户只负责建连、注册、回收 |
| 背压 | stdio 管道与 HTTP 流**按 stream 处理**，**不整包缓冲**；对超大响应设门户级上限并**明确报错**（避免大响应击穿内存） |
| 会话注册表 | `sessionId → { userId, handle, keyId, childPid, dbPath, transport, startedAt, lastActivityAt }` —— **`3.4` 按实测校正**：① SDK **不暴露 `ChildProcess` 句柄**、只暴露 `StdioClientTransport.pid` ⇒ 字段名由 `child` 改为 **`childPid`**（且本机借壳下它指向**宿主的 `docker` 客户端**，见下方「会话回收的实现口径」）；② 补上实际已在用的 **`keyId`**（会话归属校验与吊销回收的判据）与 **`dbPath`**（`AC4.3` 审计行的取值，来自模板渲染结果）；③ **`clientInfo` 至今未落地**，如实登记（不在 `3.4` 范围） |
| 回收触发 | 客户端断开 · HTTP 流结束 · **空闲超时** · **单会话最长时长** · **吊销事件** → `kill` 子进程并注销（AC3.4 / TC-P-L3-04） |
**会话归属校验的不可侵扰（2026-09-24 定档，Sprint 4 `3.3` 开工前置）**

> **为什么必须写死**：`3.12` 探针在真上游上实测到一条**可被第三方触发的破坏** —— 客户端带**甲的令牌** + **乙的 `sessionId`** 发一次请求时，实现里的「不匹配就 `registry.remove()`」把**乙**的会话从注册表里摘掉了，后果是两件事：① 乙随后用**自己的**令牌 + 原 `sessionId` **立刻 `401`**（正常会话被第三方打断）；② 乙的上游**子进程失去唯一引用**，没有任何路径去 `close()` 它 ⇒ **孤儿**（门户进程退出才随之消失）。这与 `D3`「一会话一子进程、禁止跨用户复用」是**同一个隔离面的反方向**：拒绝越权请求是对的，但**不能顺手伤到别人**。
>
> | 分支 | 定档 | 理由 |
> |---|---|---|
> | 该 `sessionId` **不属于本令牌**（不存在 / `keyId` 不同 / `handle` 不同） | **只拒**：`401` + `unauthorized`，**不触碰**该会话（既不 `remove` 也不 `close`） | 「本请求无权」与「那个会话该不该回收」是两件事。第三方**不得**通过发请求影响别人的会话；误报的 `sessionId`（例如同一浏览器/客户端缓存了别人的会话 id）同理 |
> | 该会话**自己的**传输已关闭 | 顺手**幂等回收**（`close()`：传输 + 上游一并关，再摘注册表条目），仍回 `401` | 这一支是「该会话自己的终态」，回收它不伤任何人；用 `remove()` 会留下**没人收**的子进程与传输（即上文②的孤儿） |
>
> 判据：[`../mcp/mcp-test.md`](../mcp/mcp-test.md) §4-F 的 `TC-M-L3-05`（含「受害者仍可用」与「其子进程仍受管、收尾后归零」两条）；观测手法见同文件 §4-G。

**会话回收的实现口径（2026-09-24 定档，Sprint 4 `3.4` 开工前置）**

> 依据：`3.13` 探针（[`../../probes/session-reclaim-probe/`](../../probes/session-reclaim-probe/)，**8/8 断言 PASS、退出码 `0`、两次复跑一致**）。为什么必须写死：上面「回收触发」一行列了**五类**触发，但代码里只有**事件驱动**的两条（客户端断开 / HTTP 流结束 ⇒ `transport.onclose` 级联 `upstream.close()`）；**空闲超时 · 单会话最长时长 · 吊销事件一条都没实现**，而 SDK **不提供**任何空闲机制（`shared/protocol.js` 只有**每请求**超时与 ping 自动 pong）⇒ 必须自己起计时器，且判据必须能「**判死**」。
>
> | 项 | 定档 |
> |---|---|
> | 会话记录字段 `child` | **语义 = 门户侧被 spawn 的那个进程**（`StdioClientTransport.pid`：**连接后**才有值、`close()` 后回 `null`）。**实测**：本机借壳下它指向**宿主的 `docker` 客户端**（`pid=7484` vs 容器内真上游 `19936`）⇒ **不得**把它当「上游进程 pid」用；生产 β′（门户容器内直接 spawn）下它才等于上游二进制进程 ⇒ 契约按后者写，**判据一律走容器内观测**（见下行） |
> | 「子进程归零」的三条判据 | ① **进程数回落基线**（容器内 `cmdline` 精确前缀计数，手法见 `3.12`）② **无进程持有该用户库的句柄** —— 扫 `/proc/<pid>/fd` 找指向 `/data/users/<handle>/ai-memory.db*` 的符号链接（实测：会话**中**该会话进程持有 **4** 个 fd：`db` / `-shm` / `-wal` / `.deferred-audit.journal`；**收尾后 0 个**）③ **无僵尸** —— 扫 `/proc/<pid>/stat` 的 `state=Z`，且**僵尸的 `cmdline` 是空的** ⇒ 只能按 `stat` 的 `comm` 认名 |
> | 三类触发的实现归属 | **空闲超时 / 单会话最长时长**：本行实现**机制**（每会话计时器 + 复用支刷新 `lastActivityAt`），**取值归 `4.1`**（§12.9 的两把键已登记为「必填」，但**本行不写死默认值**）· **吊销事件**：本行实现（`:410` 一行已把它挂在 `AC3.4` / `TC-P-L3-04` 上），实现位置**必须遵守上方「不可侵扰」纪律** —— 只回收**属于本令牌**的会话 |
> | `AC4.3` 路径留痕（审计行含解析后的库路径） | **已定档并落地（2026-09-24，用户拍板；`3.4` 交付）**：**机制在 Sprint 4 `3.4`** —— 会话**登记成功后**写一行审计动作 **`mcp_session_opened`**，`detail_json` 含 `dbPath`（模板渲染出的**实际使用**的库路径）与 `sessionId`；**审计视图（查询 / 页面 / 展示）在 Sprint 6「审计功能」**（`RID D4` 的处理说明与 Sprint 6 `#1` 的备忘已同步）。原先「该审计行属审计视图批次、不在本批范围」的注释与口径已在 `src/shared/audit.ts` 与排期表同步 |

**失败映射（2026-09-23 定档，Sprint 4 `3.1` 开工前置）**

> 为什么必须写死：`MS1 AC-M1.2` / `AC-M1.4` 只写「被拒」、`TC-P-L2-02` 只写「拒绝」—— **没有状态码**，桥的对外契约就可被任意实现，`3.6` / `3.7` 与真实客户端会对不上。逐场景定档如下（与 [`../mcp/mcp-test.md`](../mcp/mcp-test.md) §4-F 的断言一一对应）。

| 场景 | HTTP | 错误体 `error` | 说明与判据 |
|---|---|---|---|
| 未携带 `Authorization` | **401** | `unauthorized` | **不降级为匿名**（`MS1 AC-M1.2`） |
| `memo_` 令牌不存在 / 已吊销 / 用户已停用 | **401** | `unauthorized` | **统一 401**：不区分「不存在」与「已吊销」，不给探测者区分信号 |
| 非 `memo_` 前缀（含 `Bearer` 缺失或畸形） | **401** | `unauthorized` | **且不创建**任何用户目录或库（`MS1 AC-M1.4`） |
| 面不匹配（在 `<ADMIN_HOST>` 上访问 `/mcp`） | **403** | `wrong_face` | 面隔离**先于**身份（既有实现，见 §12.3） |
| **spawn 前断言失败**（库路径为空 / 不在 `/data/users/` 内 / 与 handle 不匹配） | **500** | `spawn_assertion_failed` | **拒绝且不 spawn**（`AC4.4` / `AC4.7`）· 必写审计行 · **不回传库路径**（`3.2` 定档，2026-09-24）—— 判定口径见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.4 不变量 2（**在 `path.posix.normalize` 归一化之后判定**；字面判定会放过 `alice/../bob` 这类串号输入）。**审计只记原因枚举**（`empty` / `outside_users_root` / `handle_mismatch` / `invalid_handle`）+ `stage`，**不记路径**：路径里可能含**他人 handle**，把它写进本用户的审计行等于把他人身份落进可检索的审计面。**客户端文案用同一句**覆盖「缺失或与 handle 不匹配」⇒ 同时满足 `AC4.4`（拒绝并告警）与 `AC4.7`（理由指出不匹配），也不需要用路径去解释 |
| **spawn 失败**（二进制缺失 / 权限 / 上游启动即退） | **503** | `upstream_unavailable` | 必写审计行 · 错误体只含场景名，**不含上游 stderr 原文** |
| **上游超时** | **视时点而定**（见下方实测机制） | `upstream_timeout` / MCP 层错误 | **不能用单一状态码表达** —— 实测分三支（握手期 503 · 转发期 MCP 层错误 · 转发阶段同步异常 504） |
| **转发阶段的其他异常**（SDK / 桥的**内部状态错误**，非上游业务错误） | **502** | `upstream_error` | **新增行（2026-09-23 `3.10` 探针定档）** · 必写审计行 + 日志 · **`504` 只留给超时** —— 把内部错误报成「上游超时」会把排障引向错误方向（实测这些异常的来源只有：`Transport already started` / `Stateless transport cannot be reused` / `Cannot send a response on a standalone SSE stream` / `No connection established for request ID`） |
| **配额超限**（上游返回配额错误） | **429** | `QUOTA_EXCEEDED` | **透传上游客口**（取值见 [`../knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](../knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md)）· 门户**不自建**计数器（`AC7.1`） |
| **客户端断开** | 无响应（连接已断） | — | 仅回收子进程并注销会话（`AC3.4`） |

**上游超时的实测机制（2026-09-23 实测，`3.1` 交付时修正本行原口径）**：原定档写「请求已发出但无响应 → 504」，实测发现**状态码能否使用取决于响应头是否已发出** —— Streamable HTTP 的响应是 SSE 流、**响应头先于上游结果**发出，一旦发出就无法再改写状态码。故实际分三支：

| 时点 | 实际行为 | 判据与理由 |
|---|---|---|
| **握手期**挂起（`client.connect` 未返回） | HTTP **503** `upstream_unavailable` | 响应头**未**发出 ⇒ 可用状态码表达；集成测试**同时断言耗时**（`elapsed < 4s`），只断言状态码会漏掉「超时没生效」 |
| **转发期**上游慢（SSE 响应头已发） | **MCP 层错误**返回，并**显式 `end()` 结束流** | 状态码**改不动**；少了 `end()` 调用方会一直挂到上游最终响应为止（实测抓到：`5.1s` 而非 `0.3s`） |
| **转发阶段同步异常** | HTTP **504** `upstream_timeout` + 回收会话 | `relay` 的 `catch` 分支 —— **504 的唯一可写时点** |

⇒ 两条结论：① **`504` 的适用范围是「响应头未发出的转发阶段异常」，不是「任何上游超时」**（把它读成后者会让验收断言写错）；② 超时必须加在**上游请求**上，在 HTTP 层用 `Promise.race` 包转发**不生效**（转发把响应交给异步流后立即返回）。

**转发阶段失败的分类定档（2026-09-23，`3.10` 探针实测后为 `3.8` 定档）**：`relay` 的 `catch` 里**能捞到什么**、该报**什么**，此前是「一律 `upstream_timeout`」。实测后按**异常来源**分三层：

| 层 | 来源 | 处理 | 依据 |
|---|---|---|---|
| **上游业务错误**（`-32601` / `-32602` / 上游 `-32603` 等） | 上游回的 error response | **无需写代码** —— SDK 自动保留 `code` / `message` / `data` 并转成 JSON-RPC error 发回客户端 | 探针断言 3：客户端收到 `code=-32601`（**原样**） |
| **上游超时**（`-32001 RequestTimeout`） | SDK client 的请求超时 | 见上方三分支（握手期 **503** · 转发期 **MCP 层错误** · 同步异常 **504**） | 已有 |
| **其他异常**（`-32000 ConnectionClosed` 与 SDK / 桥的内部状态错误） | 传输层 | `-32000` → **503**（与 spawn 失败同形：客户端看来都是「上游没了」）· 其余 → **502 `upstream_error`** | 探针实测：`webStandardStreamableHttp.js` 的全部 `throw` 点**均为内部状态错误**，无一来自上游业务 |

**两条实测细节（会决定实现写法，别按直觉写）**：

- **`message` 会被逐层加 `MCP error <code>: ` 前缀**：每经过一次 SDK 客户端就加一层（本探针拓扑实测 **3 层**）。**`code` 是原样的、无需重建**；若要 `message` 也干净，必须在 `fallbackRequestHandler` 里用 `error.code` / `error.message` **手工重建**错误体。
- **两个 fallback 必须构造后赋值实例属性**（`server.fallbackRequestHandler = …`）。按类型提示传构造参数（`ServerOptions` 类型上合法）**静默失效** —— `Protocol` 的构造函数只把 options 存进 `_options`，从不提升为实例属性；后果是请求侧被合成 `Method not found`、通知侧**直接静默丢弃**（连错误都不报）。依据与反例见 [`../../probes/bridge-fallback-probe/`](../../probes/bridge-fallback-probe/) 的断言 2 / 5。

**桥对客户端的身份与能力（2026-09-24 定档，Sprint 4 `3.9` 开工前置）**

> 依据：`3.11` 探针（[`../../probes/bridge-identity-probe/`](../../probes/bridge-identity-probe/)，**七项断言全过、退出码 `0`、两次复跑一致**）。为什么必须定档：`3.9` 把 `initialize` 回包的**身份与能力**从「桥自报」改成「代上游自报」，而 SDK 对这两件事的处理**写在构造函数里**（不在文档里）—— 不定档就会出现「上游缺某项能力 ⇒ 桥直接起不来」这类**只在特定上游上暴露**的缺陷。

| 项 | 定档 | 理由与判据 |
|---|---|---|
| 透传范围 | `serverInfo` / `capabilities` / `instructions` **均取自上游**（`Client.getServerVersion()` / `getServerCapabilities()` / `getInstructions()`，上游握手完成后即可用） | 客户端据此看到 `ai-memory` 的**真实版本与能力** ⇒ Sprint 5 上线后可直接发现镜像漂移（本行的原始动机）。取值点必须在 `new Server(...)` **之前**；**不要**用 `registerCapabilities()`（transport 已连接时抛错，是条时序死路） |
| 透传的准确含义 | **经 SDK schema 归一化后的透传**，**不是逐字节**：`serverInfo` 字段与取值保留（**键序被 schema 解析重建**）；`capabilities` 的已知键保留、**未知键被丢弃** | 探针断言 1 / 2（首版探针按字符串比，就因键序重建**假失败**退了一次码）。⇒ **验收断言必须写「字段与取值」，不能写「逐字节」** |
| 桥的可辨识性 | **不进 MCP 身份** —— 不往 `serverInfo` / `instructions` 里塞桥的自我标识 | 与 `3.8` 的「原样转发、门户语义知识 = 0」同源。判「这个会话是否经桥」看门户日志与 `mcp-session-id`，**不看** MCP 身份 |
| 桥的显式业务 handler | **一律不注册，全部经 fallback 转发**（`3.9` 删除 `3.1` 遗留的 4 个） | 能力断言发生在**注册期**（`setRequestHandler`）而非分派期 ⇒ 若能力取自上游而桥仍无条件注册 `prompts/*`，**上游未声明 `prompts` 时桥会在构造期抛错**（⇒ 503）。且探针断言 5 已证「全 fallback 下 `tools/call` 往返正常」 |
| `logging/setLevel` | 透传 `logging` 能力后**必须** `removeRequestHandler('logging/setLevel')` 把它拽回 fallback | SDK 在**桥本地**自动注册该 handler（本地处理、返回 `{}`、**不转发**）⇒ 否则客户端以为设置了级别、**上游从未收到**（探针断言 4 的对照支就是这个偏差） |
| 恒不转发的三项 | `ping`（本地自动 pong）· `initialize` · `initialized` 通知 —— SDK **无条件**内置注册，任何装法都遮蔽 fallback | 如实登记，免得被当成「透传不彻底」。`3.9` 不改变其行为 |
| 反方向（**已知边界，不在本行**） | 桥当前只做「客户端 → 上游」；**上游 → 客户端**的主动通知与 server→client 请求（`roots/list` / `sampling/*` / `elicitation/*`）**尚未转发** | 透传能力后这层不对称**更显眼**，但它是独立缺口 ⇒ 另立条目，不塞进 `3.9`。**触发条件（2026-09-24 定档）**：上游**一旦声明** `logging` / `resources` / `tools.listChanged` 中任一项，本边界**立即失效、必须重评** —— 那意味着客户端会期待收到桥此刻转发不了的 `notifications/message` / `notifications/resources/updated` / `notifications/tools/list_changed`。当前真上游 core 档只声明 `{prompts, tools}`，且实测一次会话（握手 + 5 次真实调用 + 3s 静默）**零条主动消息** ⇒ 本边界当前**无损**。 |

**超时分层（2026-09-24 定档，Sprint 4 `3.9` 开工前置）**

| 常量 | 管哪一段 | 该段失败形态 |
|---|---|---|
| `HANDSHAKE_TIMEOUT_MS` | 桥 → 上游**握手**（`client.connect`） | 握手期挂起 ⇒ **503 `upstream_unavailable`**（见上表「上游超时」的握手期支） |
| `UPSTREAM_REQUEST_TIMEOUT_MS` | 桥 → 上游**每一个请求**（`request(…, {timeout})`） | 转发期 ⇒ **MCP 层错误**（`-32001`），按上方「上游超时」三分支 |

- **两者互不牵连**（实测：握手超时 `300ms` + 请求超时 `5000ms` 的桥上，耗时 `1502ms` 的调用**成功** —— 探针断言 7）。分层前二者**共用同一个值**，语义被混为一谈（`3.10` / `3.1` 的注释里「请求级转发超时」同时管着握手）。
- **本行只分层、不定义值**：两个常量的**默认值保持不变**（`30s`）⇒ 分层本身**不改变现有行为**；**取值归 `4.1`**。
- **可调整方式**：装配层注入（`McpBridgeDeps` 的两个可选字段，**仅供测试注短值** —— 否则「上游挂起」这条路径在测试里要等 30 秒）；**不**引入环境变量键（§12.9 因此**不变**）。

**四条统一纪律**：① 错误体一律 `{"error":"<code>","message":"<可读说明>"}`，**不含**内部路径、堆栈或上游 stderr 原文；② 任何失败路径都**不得留下未回收的子进程**（与 §12.7 的回收触发同源）；③ `spawn_assertion_failed` 与 `upstream_unavailable` **必写审计行**；④ **转发阶段的异常必留一行日志 + 一行审计**（动作 `mcp_upstream_error`，`detail` 只放 `stage` / `errorCode` / 规范化 message，**不含**上游 stderr 原文）—— 「上游起不来」与「转发阶段出错」是两类故障，混在一起会让排障无从下手。

### 12.6 门户数据模型落地

表结构与列定义沿用 §4.4（`users` / `keys` / `audit` / `sessions`），落地补充：

- **迁移**：`db/migrate.ts` 以 `schema_version` 表驱动**前向-only** 迁移；升级时先备份（与 §9 升级步骤一致）。
- **索引**：`keys(key_hash)` **唯一**（认证查询热路径）；`keys(user_id)`；`audit(ts)` 与 `audit(actor)`（审计检索）。
- **敏感字段纪律**：`keys` 只存 `key_hash` + `key_prefix`，**无明文列**；`audit.detail_json` **不得**含令牌明文或记忆正文（T8 / TC-P-L0-05）。
- **存储位置**：`admin_portal_data` 卷 → `/srv/portal`，**不在 `/data` 下**（TC-P-L1-10 / TC-P-L3-08）。
- **审计写入失败的策略**：**已定：fail-closed（无审计不动作）**（2026-09-22 用户定夺，随 `PSP-W1` 落地）。实现方式：业务写与审计写放在**同一个 SQLite 事务**内（`shared/audit.ts` 的 `withAudit`），审计插入失败即整体回滚 —— 用户/令牌不落库、也不产生半成品；反向亦然：动作抛错时不写审计（失败的动作不留痕）。因二者同库同事务，**不需要补偿逻辑**。**失败的动作也不得写审计**（`AC1.6` / `AC2.9`：不得产生虚假的成功记录）。

### 12.7 门户自建的并发、限流与超时（§7 的落地形态）

| 项 | 取值来源 | 超限行为 |
|---|---|---|
| 每 key 并发上限 | 配置项 | **明确拒绝**（不排队致死，T5 / TC-P-L3-06） |
| 全局并发上限 | 配置项 | 同上 |
| 空闲超时 | 配置项 | 回收会话与子进程 |
| 单会话最长时长 | 配置项 | 同上 |

> 上游 `[limits]` 的**四类强制行为**（写入量 / 存储字节 / 链接 / 向量容量）在 MCP 面生效，**其余两键是 HTTP 面专属**（stdio 不经过）——真源与实测结论见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.4 / §9 L，以及 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS7`。

### 12.8 日志与可观测性

- 结构化日志（JSON 行）；**只记** `key_prefix`，**不记**令牌明文、**不记** MCP 报文正文（T8）。
- 会话开始/结束各一行：`sessionId` · `handle` · **解析出的库路径** · 时长 · 结束原因（正常 / 超时 / 吊销 / 错误）。
- 启动自检结论各一行（通过 / 失败项）；失败即**拒绝启动**（§3.4）。
- **脱敏集中一处**：`shared/redact.ts` 提供统一脱敏函数，日志与审计**共用**，避免两处规则漂移。

### 12.9 关键配置项（门户侧）

> **只登记键名与语义，不写任何真实值**（ADR-006 公开仓脱敏纪律）。

| 键 | 语义 | 必填 |
|---|---|---|
| `PORTAL_ADMIN_HOST` / `PORTAL_MCP_HOST` | 两个面各自的 Host（面隔离判据） | 是 |
| `PORTAL_DB_PATH` | 门户库文件路径（**必须不在 `/data` 下**） | 是 |
| ~~`PORTAL_LAUNCH_TEMPLATE`~~ | **已内建为代码常量**（`src/bridge/launch-template.ts`），**不再作为 env 键**（2026-09-23 定档）：模板是「门户对上游的唯一知识」，改它等于升级适配 ⇒ 与代码同版本控制；由**启动自检**断言其与 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.4 **逐字一致**（`TC-M-L0-01`） | 否（已内建） |
| `PORTAL_SESSION_IDLE_TIMEOUT` / `PORTAL_SESSION_MAX_DURATION` | 空闲超时 / 单会话最长时长 | 是 |
| `PORTAL_MAX_CONCURRENCY_PER_KEY` / `PORTAL_MAX_CONCURRENCY_GLOBAL` | 并发上限 | 是 |
| `PORTAL_RESPONSE_MAX_BYTES` | 单响应上限（背压保护） | 是 |
| `PORTAL_LAUNCH_OVERRIDE` | **开发期命令覆盖**（2026-09-23 随 `3.1` 落地）：覆盖 launch 模板的「二进制那一段」（可给多段，如 `docker -H <uri> exec -i <容器> <二进制>`），模板 argv 的其余部分照旧接在其后。**仅 `PORTAL_ENV=development` 生效；production 下出现即拒绝启动**（与自签 JWT / 开发登录入口同构，见 [`adr/ADR-015`](../adr/ADR-015-dev-login-entry-config-gated-registration.md)）。存在的理由：本机是 macOS，执行不了镜像内的 linux 二进制。**它的语义边界**：只覆盖 `command`/`args`；**env 透传由覆盖命令自己负责** —— 例如借壳 `docker exec` 时必须显式 `-e AI_MEMORY_DB -e AI_MEMORY_AGENT_ID …`，否则模板注入的四项 env 进不了容器：`memory_store` 照样成功，但数据落到**共享主库**、身份退回上游默认值（即隔离静默失效，实测踩过） | 否 |
| `DASHSCOPE_API_KEY` | 门户专用 MaaS key（与主 key 同 workspace，§3.4 前置 2） | 是 |
| `PORTAL_I18N_DEFAULT` | 默认语言（`zh-CN`） | 否 |

> **`3.9` 定档（2026-09-24）：超时分层**不**新增环境键** —— 两个超时常量（握手 / 每请求）的**默认值不变**（`30s`），只保留**装配层注入位**（仅供测试注短值）；取值归 `4.1`，届时若判定需要可配置，再**在此登记键名**。理由：本行的判据是「两个超时**各自可调**且互不牵连」，而「可调」在装配层已成立 —— 过早引入 env 键会把尚未定值的业务参数固化成对外配置面。

**本地开发认证实施口径（2026-09-22 定档，随 `PSP-W1` 落地）**

> 背景：§6.1 规定身份由 Cloudflare Access 认定，但**全仓此前未规定本地开发如何替代它**。定档如下（用户决策）。

| 项 | 口径 |
|---|---|
| 身份来源（唯一） | **Cloudflare Access 签名断言**。Web 界面经 `Cf-Access-Jwt-Assertion` 头；**浏览器导航回落到 `CF_Authorization` cookie**（生产本来就如此）。验签走 JWKS + `iss` + `aud` + `exp`（含 30s 时钟偏移） |
| `CF-Access-Authenticated-User-Email` | **只作交叉校验**：与断言内 `email` 不一致即判 401；**绝不单独采信**（该头可伪造） |
| Service Token | **门户侧无需专门代码**：由 Cloudflare 在边缘校验后注入**同一断言**（此时断言只有 `common_name`）。门户据 `common_name` 把来源记为 `service-token` 以便审计与排障 |
| 本机开发 | **命名隧道 + Access 应用**（`make portal-tunnel` 打印配置清单）⇒ 本地与生产同源，不引入「本地关掉认证」的分支 |
| 自动化（离线） | **自签 JWT + 测试密钥对**（`PORTAL_TEST_JWT_ENABLED=1`，只允许绑定回环 Host）⇒ 覆盖验签、过期、受众不符、头不一致等分支，**零网络** |
| 自动化（在线） | **Access Service Token** 头（`CF-Access-Client-Id` / `Secret`）⇒ 验真链路；缺前置时 `make portal-e2e ARGS=--online` 以**退出码 40 明确跳过**（不伪装通过） |
| 生产 fail-closed | `PORTAL_ENV=production` 下：必须配齐团队域与 `aud`，且**启用自签通道即拒绝启动**；若 Host 非回环而自签通道开启，同样拒绝启动 |
| 新增环境键 | `PORTAL_ENV` · `PORTAL_ACCESS_TEAM_DOMAIN` · `PORTAL_ACCESS_AUD` · `PORTAL_ACCESS_JWKS_URL`（可选，默认由团队域推导）· `PORTAL_TEST_JWT_ENABLED` / `_JWKS` / `_ISS` / `_AUD`（仅测试） |

### 12.10 与其它组件的依赖与待办（防遗漏）

| # | 依赖 | 方向 | 落点 | 状态 |
|---|---|---|---|---|
| 1 | 上游二进制与制品契约（路径 / 底座 / uid·gid） | 门户 → 上游 | [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.3 · `admin_portal/Dockerfile` | 契约已定；镜像未构建 |
| 2 | `launch` 模板（唯一知识来源） | 门户 → 上游 | [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.4 | 已定稿；门户侧待实现 |
| 3 | `/data/users` setgid 引导（一次性） | 运维 → 卷 | [`../deployment.md`](../deployment.md) §4.4 · §3.4 前置 1 | 待生产执行（Sprint 6） |
| 4 | 门户专用 MaaS key 注入 | 运维 → 门户 | §3.4 前置 2 · `deploy/portal.env.example` | 待生产注入 |
| 5 | 共享卷 `ai_memory_data` 以 `external` 引用 | 门户 → 上游 stack | §11 步骤 4/6 | 待生产执行 |
| 6 | 静态护栏 `make attestation-paths`（模板真源已迁 MCP 侧） | CI → 文档 | [`../mcp/mcp-test.md`](../mcp/mcp-test.md) §4-D TC-ATT-02 | **已迁移并复跑通过** |
| 7 | 反向代理与 CF Access 面配置 | 运维 → 门户 | §6 · §11 步骤 2/3 | 选型未定（§10 #3） |
| 8 | 门户库备份纳入备份脚本 | 运维 → 门户 | [`../product-backlog.md`](../product-backlog.md) #9 · TC-P-L3-08 | 待 Sprint 5 |

## 13. UI 设计系统（geeky + neat 的性冷淡风 · 纯单色）

> **需求变更（2026-09-22，用户确认）**：本节**推翻**同日上午的「保留 logo 橙作唯一强调色」——用户明确要求「**UI 色系不要用橙色，沿用示例项目的色系**」。因此**全站无品牌色变量**：主按钮改为**墨黑实底**，活动态与聚焦环一律**墨色**；**唯一有色是危险红**（仅错误与破坏性动作）。
> **来源与边界**：**令牌体系照搬**另一产品的可执行稿（**仅本地临时参考、不入库**；该素材**已不在工作树中**，见 §15「不入库 / 不入制品」）的**实测色板**——其 `mockup.css` 的十六进制色值经 `grep -oE '#[0-9a-f]{6}' | sort | uniq -c` 实测，**唯一有色即 `#8b1a1a`**（危险红）。直接沿用实测值可避免二次诠释偏差，并让「实现与原型一致」有唯一数值基准。
> **只取手法与令牌，不取其内容**：该素材的**产品文案、品牌徽标与三张异产品 logo**（`agent-logo.png` / `play-logo.png` / `food-logo.png`）**不得**进入本项目原型与实现。
> **`logo.png` 说明（2026-09-22 定版）**：logo **自带品牌色** —— 灰底圆角徽标上「**MCP**」为**黄色**（`MEMORY` 为白、`agent-mate.ai` 为浅灰）。它属**品牌资产**，**不参与 UI 色系体系**：
> ① 实现「无彩色」核对**只扫元素的计算样式**（`portal.css` 令牌与内联样式），**图像像素不在扫描面内** —— 这是既有校对方式，不是临时豁免；
> ② **「品牌色孤岛」—— 2026-09-22 用户逐项定夺：保留现状**。该黄（实测主色 `#F6EC34`，占徽标不透明像素 **2.1%**；其余为灰 `rgb(115,115,115)` 79.7%）是站内**除危险红之外的唯一色相**。已明确**不**立强调色令牌、**不**要求品牌侧出灰阶版 —— 它是品牌资产的**既有事实，不是待修项**。口径由此收敛为「**UI 无品牌色；品牌资产图像自带色**」，与 ① 的扫描面（元素计算样式）一致；§13.1 仍**无品牌色变量**，实现不得据此新增 `--accent`。
> **2026-09-22 已换为透明底版本**（1004×520，实测四角 alpha = 0），原「白底 + 投影」的已知项**关闭**。
> **不采用其认证页渐变**：参考稿的 `.auth-shell` 单色渐变只服务于其**自建登录页**；本项目管理面认证由 Cloudflare Access 承担（见 §6），**不存在自建认证页**，故**不引入**该渐变。
> **强制程度**：§13 的令牌即 §12.2 `assets/portal.css` 的 `:root` 值；**实现必须引用令牌，不得在模板里新造色值** —— 这是「原型 ↔ 实现一致」可被**机械核对**的前提。

### 13.1 令牌总表（照 `mockup.css` 的**实测色板**；纯单色，无品牌色）

```css
:root {
  --bg: #fafafa;            --bg-elevated: #fff;      --bg-soft: #f7f7f7;
  --ink: #0a0a0a;           --ink-2: #1f1f1f;         --mute: #525252;
  --mute-soft: #6b6b6b;     --placeholder: #9a9a9a;
  --line: #e0e0e0;          --line-strong: #bdbdbd;   --fill: #f0f0f0;
  --code-bg: #f4f4f4;
  --danger: #8b1a1a;        --danger-wash: #faf6f6;
  --radius: 0;
  --control-h: 2.75rem;     --control-px: 1.25rem;   --control-border: 1.5px;
  --control-fs: 0.875rem;   /* 表单控件字号：input / select / button 共用 */
  --btn-font-size: 0.8125rem;  --btn-tracking: 0.08em;  --btn-page-min: 10.5rem;
  --font-ui: "Outfit", "Noto Sans SC", "Noto Sans TC", system-ui, sans-serif;
  --font-cn: "Noto Sans SC", "Noto Sans TC", "Outfit", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --max: 760px;             --guide-max: 56rem;
  --dur-fast: 120ms;        --dur-base: 180ms;        --ease: cubic-bezier(.2,.8,.2,1);
  /* 无 --accent / --accent-deep：全站无品牌色变量（见本节开头需求变更） */
}
```

> **根字号基准（易错点，务必按此折算）**：`html { font-size: 17px }` —— 本项目 **`rem` 以 17px 为基，不是 16px**。故 `--control-h: 2.75rem` = **44px**、`--btn-font-size: 0.8125rem` ≈ **13.8px**、`--control-fs: 0.875rem` ≈ **14.9px**、内容列上限 `72rem` = **1224px**、`.how-to` 标签列 `7.5rem` = **127.5px**。按 16px 估算会系统性偏小（曾在验收阈值上踩过这一坑）。

| 维度 | 规则 | 依据令牌 |
|---|---|---|
| **圆角** | **全局 `0`** —— 容器、控件、面板、对话框一律零圆角（仅胶囊状态点保留全圆 `999px`）。**唯一例外：代码块 `.codeblock` 保留参考稿的 `8px` 圆角**（其右侧 `COPY` 灰条因此带圆角右缘；把代码块一并压平会与参考稿不一致 —— 2026-09-22 曾误压平并回滚） | `--radius: 0` |
| **地面** | 页面底 `--bg`、抬升面 `--bg-elevated`、填充底 `--fill`；**控件与表格用描边区分，而不用背景色块** | `--bg` / `--bg-elevated` / `--fill` |
| **文字** | `--ink`（标题与主文）· `--ink-2`（次强调）· `--mute`（次要说明）· `--mute-soft`（元数据） | 灰阶三档 |
| **描边** | 结构分隔 `1px --line`；**控件描边 `1.5px --line-strong`**（比结构线更重 ⇒ gadget 质感） | `--line` / `--line-strong` / `--control-border` |
| **唯一彩色** | **危险红 `--danger`**（`#8b1a1a`），仅用于**错误与破坏性动作**（危险按钮描边、`.callout-danger` 左边框 + `--danger-wash` 底、`.status.is-off` 状态点）。**全站无品牌色变量** | `--danger` / `--danger-wash` |
| **灰阶语义映射** | 无彩色可用的语义位一律回落灰阶：`.callout-info` → `--line-strong` 左边框；`.callout-warn` → `--ink-2` 左边框；用量条 `is-warn` → `--danger`（该风格下「接近上限」只能用危险色表达） | 无 `--ok` / `--warn` / `--info` 令牌 |
| **按钮** | 小字号 + **大写**（`text-transform: uppercase`）+ **`0.08em` 字距**；主按钮 = **墨黑实底白字**（`--ink`，hover `--ink-2`），次按钮 = `--line-strong` 描边，文字按钮 = 下划线式 | `--btn-font-size` / `--btn-tracking` |
| **数据** | 库路径、令牌前缀、计数、时间戳**一律 `--font-mono`**；数值列右对齐 | geeky 的可读性核心 |
| **栏宽** | 说明页 `--guide-max`（56rem，窄栏长文可读，**居中**）；管理面内容列 `min(100%, 72rem)`（1224px）并**紧贴左侧栏、不居中**，正文段落另限宽 `46rem` 防行宽过长。`--max: 760px` **已不再约束管理面内容列**（仅作阅读栏基准保留） | `--guide-max` / `72rem` / `46rem` |
| **结构线分段** | 区块之间用 `1px --line` 的**上边框**分段（而非留白分节），如说明页 `h2 { border-top: 1px solid var(--line) }` | 参考稿 `.guide-body h2` |
| **投影** | **几乎不用** —— 仅对话框遮罩 `rgba(10,10,10,.28)`；面板与对话框**不加阴影** | 参考稿 `.dialog-backdrop` |
| **字体加载** | `portal.css` 首行 `@import` Google Fonts（`Outfit` / `Noto Sans SC` / `Noto Sans TC` 各 400;500;600，`JetBrains Mono` 400;500）；**无 `@font-face`** | `mockup.css:1` |
| **离线降级** | 字体栈内含 `system-ui` / `ui-monospace` 回落 ⇒ **离线时降级为系统字体栈**；除字体外原型**无外部依赖**（不引 CDN 样式、无打包器）。**不再宣称「完全离线自包含」** | 如实登记 |

### 13.2 字号与字重

| 角色 | 规格 | 用途 |
|---|---|---|
| 页标题 `h1` | `28px / 600` | 每页**只有一个** |
| 区块标题 `h2` | `18px / 600`（说明页 `1.15rem`）+ **上边框分段** | 说明页各节 / 管理面区块 |
| 小节 `h3` `.guide-sub` | `16px / 500` | 表内分组、说明小节 |
| 正文 | `14px / 400`，行高 `1.55` | 通用 |
| 导语 `.lead` / `.page-head-lead` | `14px / 400`，颜色 `--mute` | 页头一句话 |
| 眉题 `.eyebrow` | `0.75rem / 500`，`--font-mono`，**大写** + `0.16em` 字距，颜色 `--mute` | 页头小标（如 `MEMORY`） |
| 字段标签 `.field-label` | `0.75rem / 500`，`--font-mono`，大写 + `0.12em` 字距 | 表单标签 |
| 元数据 / 页脚 | `0.78rem / 400`，颜色 `--mute` | 版本坐标、版权 |
| 数据 / 代码 | `--font-mono` | 路径、前缀、计数、时间戳 |

**纪律**：① 每页**只有一个** `h1`；② **眉题与字段标签一律等宽大写**（geeky 的关键记号）；③ 正文**不用斜体**；④ 按 `html[lang]` 在 `--font-ui` / `--font-cn` 间切换，**不为英文另立字号**。

### 13.3 版式与骨架

| 骨架 | 类 | 结构 |
|---|---|---|
| **说明页** | `.guide-shell` | `.guide-header`（品牌 mark + 语言按钮组）→ `.guide-body`（`--guide-max` 居中）→ `.site-footer` |
| **管理面** | `.app-shell` | `.app-header`（品牌 · 菜单钮 · 右侧「接入指南」入口 + 身份 + 语言按钮组）→ `.app-body`（`grid-template-columns: 200px 1fr`）→ `.sidebar > .nav` + `.content` → `.site-footer` |
| **原型索引** | `.gallery-shell` | `.gallery` > `.screen-list`（编号 + 页名 + 一句说明） |

- **左侧导航**：`.nav a` 常态 `--mute`；**活动态** `--ink` + `font-weight: 500` + `box-shadow: inset 2px 0 0 var(--ink)`（**墨色内嵌条，不用彩色**）。
- **页头**：`.page-head` > `.eyebrow` + `.page-head-row`（左 `.page-head-lead`，右 `.page-head-actions`）。
- **表格**：`.table-wrap`（横向滚动容器）> `table`；`.mono` 承载数据列；状态用 `.status`（`is-on` 等）。
- **空态**：`.empty`（一句引导 + 一个主按钮），**由 query 参数切出，不另建页面**。
- **对话框**：`.dialog-backdrop`（默认 `display:none`，`.is-open` 显示）> `.dialog` > `.dialog-title` + `.dialog-body` + `.dialog-actions`。
- **代码块**：`.code-block`（`1.5px --line-strong` 描边 + `#f4f4f4` 底）> `pre > code`；复制按钮 `.btn-copy`（图标按钮 + `data-copy`）。
- **明文仅一次**：`.key-panel` > `.key-meta`(`.key-meta-label` / `.key-meta-value`) + `.code-block` + `.warn` + `.form-actions`。
- **三步接入（纵向）**：`.steps`（`list-style: none`，`display: flex; flex-direction: column`，顶部 `1px --line` 分段线）> `.step`（`grid-template-columns: 3.25rem minmax(0, 1fr)`：序号列 + 内容列）> `.step-num`（`--font-mono` / `--mute`）+ `.step-body`（`h3` + `p` + `.code-block` + `.step-figure`）。**窄屏 `<720` 转单列**（序号在上、内容在下）。**不再横向并列**（用户 2026-09-22 要求）。
- **说明页截图**：`.step-figure` > `img` —— `width: 100%` 但 `max-width: 34rem`、`1.5px --line-strong` 描边、`--bg-elevated` 底；**零圆角、无阴影**。
- **Contact Admin 悬浮窗**：`.contact-admin`（`position: relative; display: inline-block`）> `.contact-admin-trigger`（下划线式按钮，`--line-strong` → hover / focus-visible 变 `--ink`）+ `.contact-admin-pop`（`position: absolute` 弹层，**hover / `:focus-within` 显示**，`opacity` + `visibility` 过渡；`1.5px --ink` 描边、`--bg-elevated` 底、`max-width: min(15rem, 100vw - 2.5rem)`）；内含 `.contact-admin-pop img`（微信二维码，`1px --line` 描边）+ `.contact-admin-caption` + `.contact-admin-mail`。**键盘可达**（触发器可聚焦，`focus-within` 展开）。

### 13.4 响应式

| 断点 | 规则 |
|---|---|
| `≥1280` | 管理面含 200px 左侧导航；内容区按 `--max` 收窄 + 两侧留白 |
| `1024–1280` | 保持左导航；表格允许横向滚动（`.table-wrap`） |
| `<1024` | `.app-body` 转单列；左导航经 `.menu-toggle` 展开（`.app-shell.is-nav-open`）；表格转**两列键值卡**（`td::before` 承接表头） |
| `<720` | `.guide-body` 内边距收窄；`.locale-switch` 不换行 |

### 13.5 动效

| 场景 | 规则 |
|---|---|
| 时长 / 缓动 | `120ms`（hover）· `180ms`（对话框）· `cubic-bezier(.2,.8,.2,1)` |
| hover | 控件**描边加深**（`--line-strong` → `--ink`）；**不位移、不加阴影** |
| 对话框 | 淡入（`180ms`）；关闭**立即** |
| 复制回显 | 按钮文案切「已复制」，`1.6s` 后回退（照参考稿 `bindCopy`） |
| **降级** | `@media (prefers-reduced-motion: reduce)` 下**关闭全部过渡与动画** |

**纪律**：动效**只服务状态变化**（反馈 / 数值变化）；**不做**入场编排、视差、渐变或环境动画 —— 该风格下过度动效会直接消解「冷淡」。

### 13.6 交互纪律

- **危险动作**（吊销、轮换）走**对话框二次确认**，并**复述目标对象**（handle + 令牌前缀）。
- **明文仅一次**：签发 / 轮换后的明文用 `.code-block` + `.btn-copy` 呈现，并以**两处**文案警示（页头导语 + `.key-panel .warn`）。
- **错误**：页内提示条（`.callout-error` / `.error-inline`），**不用**弹窗堆叠；文案说明**发生了什么 + 怎么修**，不道歉、不模糊。
- **查无结果**：`.empty` 给一句引导 + 一个主按钮，不留白面板。
- **文案纪律**（与 §12.4 的 i18n 纪律配套）：四语言**一律短句**；动作名**贯穿全流程**（按钮写「吊销」→ 结果提示也写「已吊销」）；**不写实现术语**（写「令牌」不写 `key_hash`）；**协议名、工具名、标识符一律不翻译**。

### 13.7 可达性底线（不宣告，直接做到）

键盘可达（`Tab` 顺序 + 可见聚焦环，聚焦环用 `--ink`）· 正文对比度 ≥ `4.5:1`（`#0a0a0a` on `#fafafa` 远超阈值）· 触达目标 ≥ `--control-h` · 语义化标签与必要的 `aria-label`（语言按钮组标 `aria-label` + `aria-pressed`；跳转链接用 `.sr-only`）· 表格表头与单元格关联 · `prefers-reduced-motion` 生效。

### 13.8 采用 / 不采用（参考素材）

| 采用（令牌与手法层） | 不采用（内容与品牌层） |
|---|---|
| **完整令牌体系**（零圆角 · 灰阶 · 1.5px · 三字族 · 窄栏） | 异产品的**品牌徽标与三张 logo** |
| **说明页版式**（眉题 + 标题 + 导语 + 目录锚点 + 能力表 + 代码块） | 异产品的**产品文案与示例内容** |
| **管理面骨架**（顶栏 + `.sidebar > .nav` 左侧一级导航 + `.content`） | 异产品的导航条目与信息架构 |
| **四语言机制**（词表 + `[data-i18n]` 渲染 + `localStorage` + 按钮组） | 其语言集合之外的自定义（本项目即 EN / CN / HK / TW） |
| **URL query 驱动变体态**（`?empty=1` / `?confirm=<id>` 等） | 其站点结构与邮件版式页面 |
| **墨色内嵌条**作导航活动态（`inset 2px 0 0 var(--ink)`） | 其**认证页单色渐变**（`.auth-shell`；本项目无自建认证页） |
| **三步纵向版式**（序号列 + 内容列，窄屏转单列） | 其**自建账号流程页**（登录 / 重设 / 接受邀请 / 管理员增删） |
| **Contact Admin 悬浮窗**（hover / focus 弹层 + 二维码 + 邮箱） | 其品牌徽标与三张异产品 logo |
| **危险红 `#8b1a1a`**作唯一彩色（含 `--danger-wash` 错误底） | **一切其它彩色**（品牌橙、状态绿 / 橙 / 蓝、渐变装饰） |

### 13.9 组件规范（本轮新增 / 补齐）

> 本节组件均由 `mockups/assets/portal.css` 的显式规则给出；**实现引用同名类，不另造**。新增组件的动因多为「原型里用了类名但 CSS 无对应规则」，故同时登记**缺失时的表现**，便于复现与验收。

| 组件 | 结构 | 关键规则 | 缺失时曾出现的表现 |
|---|---|---|---|
| **分页** `.pager` | `.pager-count`（左）+ `.pager-controls`（右：上一页 / 当前页 / 下一页） | 上边框 `1px --line` + `margin-top: 1.5rem`；`flex` 两端对齐；`.pager-page.is-current` 用墨色下划线；首末页对应按钮 `disabled`（`--placeholder` 色） | ——（本轮新增，替代原先的「搜索框」） |
| **说明型区块** `.how-to` | `dl` 两列 grid | `grid-template-columns: 7.5rem minmax(0, 1fr)`、`gap: 0.5rem 1rem`；标签列须容纳最长标签（EN「Where to change」约 105px）；窄屏 `≤720px` 转单列（标签在上） | 标签列若取 168px，说明列起排 188px，中文长句被挤到第二行（用户两次反馈「太靠右 / 断行」） |
| **危险按钮** `.btn-danger` | 与 `.btn` 同构 | **危险红实底白字**；hover 用 `opacity: .85`（**不引入调色板外的色值**，否则破坏单色扫描）。`.btn-text.is-danger` 为行内危险文字按钮 | 该规则此前**完全缺失** ⇒ Revoke 确认框里的破坏性按钮被渲染成**普通墨色主按钮**，与「危险」语义不符 |
| **对话框补充** | `.dialog-target` / `.dialog-actions` / `.dialog-path` | `.dialog-target`：`1px --line` 描边 + `--fill` 底 + `1.35rem` 上距；`.dialog-actions`：右对齐 + 上方 `1px --line` 分隔 + `1.6rem` 上距；`.dialog-path`：**左侧 2px 引线**呈现只读派生值 | `.dialog-actions` 与 `.dialog-target` 此前**均无规则** ⇒ 路径预览与按钮贴死、键值块与正文挤在一起 |
| **`.dialog-path` 的形态纪律** | —— | 只读派生值**不得**用「描边 + 填充」形态呈现 —— 那与可编辑 `.input-box` **完全同形**，会被误认为可输入 | 曾用灰底描边方框，视觉上与输入框无法区分 |
| **文字按钮** `.btn-text` | `button` / `a` | 字号回到 `--btn-font-size`（约 13.8px）、不下划线以外装饰 | 曾继承正文 `17px`，成为页内最大字号 |

### 13.10 外框与滚动（固定顶栏与页脚 · 内容列）

**固定外框**（2026-09-22 用户要求）：

```css
.app-header   { position: sticky; top: 0;    z-index: 40; }  /* 顶栏贴视口顶 */
.site-footer  { position: sticky; bottom: 0; z-index: 30; }  /* 页脚贴视口底 */
```

- 两者**必须是不透明底**（`.app-header` / `.site-footer` 均 `--bg-elevated` + 结构线），否则滚动时内容会透出。
- 效果：顶栏贴上、页脚贴底、**中间内容滚动**；验收断言为「滚动 900px 后顶栏 `top == 0` 且页脚 `bottom == 视口高`」。
- **未固定**：左侧栏（`.sidebar`）。其导航会随内容滚走 —— 若要固定需引入 `--header-h` 令牌绑定顶栏高度（当时评估为可选增强，未做）。

**页脚结构**：`.site-footer` 为 `flex` + `justify-content: flex-end` + `align-items: baseline` + `gap: .4rem 1.25rem`；**入口链接在左、版权在右、同一行、整组右对齐**（01 页的 `a` 与 `p` 顺序须与索引页一致）。

**内容列宽度**：

```css
.content { max-width: min(100%, 72rem);  margin-inline: 0; }   /* 1224px @17px，左对齐 */
.page-head-lead, .lead-note, .callout p { max-width: 46rem; }  /* 正文限宽，防行宽过长 */
```

> **禁止用 `margin-inline: auto` 居中内容列**：网格项一旦设 `auto` 外边距即**取消默认 stretch**、转为按 `fit-content` 定宽 —— 内容列被从侧栏右侧推到 `x=406`（用户反馈「宽度变窄」），且窄屏下其 min-content 会撑破视口（实测 390px 视口下 `.content` 变成 696px）。`max-width: 100%` 亦不可省。

---

## 14. 逐页 UI 设计（原型 ↔ 模板 ↔ 路由）

> **用途**：把「实现与原型一致」变成**可机械核对**的对照表 —— 实现期逐页对照落地，评审期逐页比对。§12.2 的 `views/` 命名与本表一一对应。

| 页 | 原型文件 | Nunjucks 模板 | 路由 | 区块（自上而下） | 主要组件 / 令牌 |
|---|---|---|---|---|---|
| 接入说明（公开首页） | `mockups/01-instructions.html` | `views/instructions.njk` | `/` | hero（logo ×2 + H1 + 关键词条）→ 三步纵向（取令牌 · 配置客户端 · 验证一次调用）→ Supported AI agents（7 项）→ Tools（8 行 3 列）→ 页脚 | `.guide-hero` · `.steps`/`.step` · `.contact-admin` 悬浮窗 · `.codeblock--file`（8px 圆角）· `.agent-roster` · `.guide-caps-table`（`table-layout: fixed`，首列 `12.5rem`、第三列 `28%`）· `.shell-locale` 浮动语言组 |
| 用户列表 | `mockups/02-users.html` | `views/admin-users.njk` | `/admin/users` | 页头（眉题 + 标题 + 导语 + 「创建用户」）→ 表格（handle / 库路径 / 令牌数 / 创建 / 状态）→ 分页 → 建用户对话框 | `.page-head-row` · `.table-wrap` + `.path`（不折行）· `.pager` · `#dialog-new-user`（含 `.dialog-path` 只读派生路径） |
| 用户详情 | `mockups/03-user-detail.html` | `views/admin-user-detail.njk` | `/admin/users/:handle` | 页头（handle + 库路径 + 状态 + 返回）→ 身份只读块 → Tokens（表 + 签发 / 轮换 / 吊销）→ Diagnostics（只读）→ **停用该用户**（危险区） | `.readonly` + `.kv` · `.row-actions` · `.btn-danger` · `#dialog-deactivate` · 区块节奏 `.section`（`3rem`） |
| 审计 | `mockups/04-audit.html` | `views/admin-audit.njk` | `/admin/audit` | 页头（+ 导出）→ 筛选条（事件类型 / 时间范围 / 用户 / Filter / 命中数）→ 表格（时间 / 事件 / handle / 结果 / 解析路径）→ 分页 → 空态 → 边界说明 callout | `.filter-bar`（控件等高）· `.status` · `.pager` · `[data-audit-empty]` · `.callout-info` |
| 容量与配额 | `mockups/05-capacity.html` | `views/admin-capacity.njk` | `/admin/capacity` | 页头 → 只读声明 callout → `.how-to` 参数调整说明 → 指标卡（2）→ 上游配额表（7 行）→ 边界 callout | `.metric` + `.bar` · `.how-to` · `.table-wrap` · `.callout-info` |
| Admin MCP 配置 | `mockups/06-admin-mcp.html` | `views/admin-mcp.njk` | `/admin/mcp` | 页头 → Tier → Local stdio → SSH stdio → How you sign in → Keep more than one key → Session（含 Cloudflare `.how-to`）→ If you lose access（后台深链 + 管理员增删 `.how-to`） | `.readonly` · `.codeblock` · `.how-to` · `.btn-page` 深链（`one.dash.cloudflare.com`） |
| 原型索引 | `mockups/index.html` | ——（**仅原型**，不生成模板） | —— | 6 页清单 + 变体态入口 | `.gallery` · `.screen-list` |

> **页面集为 6 页**（+ 原型索引）：原「07 只读管理员页」**已于本轮撤销**，其内容并入 06「Admin MCP 配置」—— 故 §12.3 路由表**无** `/admin/admins`，用户页也**不含**「管理管理员」入口（对应 `S1 AC1.8`、`S10 AC10.9`）。

**变体态（原型用 URL query 驱动；实现期对应真实状态）**

| 变体 | 原型 | 对应实现状态 |
|---|---|---|
| 用户页空态 | `02-users.html?empty=1` | 零用户 |
| 建用户对话框 | `02-users.html?confirm=new-user` | 打开对话框 |
| 非法 handle 内联错误 | `02-users.html?invalid=1` | 前端校验失败 |
| 列表内联错误条 | `02-users.html?error=1` | 后端拒绝 |
| 令牌签发确认 | `03-user-detail.html?confirm=issue` | 签发对话框 |
| 令牌轮换确认 | `03-user-detail.html?confirm=rotate` | 轮换对话框 |
| 令牌吊销确认 | `03-user-detail.html?confirm=revoke` | 吊销对话框（危险按钮） |
| 停用用户确认 | `03-user-detail.html?confirm=deactivate` | 停用二次确认 |
| 联系管理员悬浮窗展示态 | `01-instructions.html?hover=contact` | 悬停 / 聚焦态（评审用） |
| 审计空态 | `04-audit.html?nomatch=1` | 筛选无命中 |
| 四语言切片 | 任意页 `?lang=TW` | 语言切换 |

---

## 15. UI 资产清单与同步方式

> **单一真源**：所有 UI 资产以 `specs/web-portal/mockups/assets/` 为**唯一真源**；`admin_portal/assets/` 是其**逐字副本**（实现期由构建 / 部署步骤复制，**不手工改两处**）。
> **同步方式**：`cp -R specs/web-portal/mockups/assets/. admin_portal/assets/`，随后以 sha256 **逐文件核对一致**（原型验收脚本已含该项核对，2026-09-22 实测 7/7 一致）。

| 资产 | 源路径 | 目标路径 | 说明 |
|---|---|---|---|
| 设计系统样式 | `mockups/assets/portal.css` | `admin_portal/assets/portal.css` | 全部令牌与组件规则；**唯一真源**，实现期不得另建样式表 |
| 四语言词表 | `mockups/assets/i18n.js` | `admin_portal/assets/i18n.js` | 四份词表（键集合一致，实测各 220 键）；实现期按 §12.2 拆为 `src/web/i18n/{en,zh-CN,zh-HK,zh-TW}.json`，**键名与结构不变** |
| 交互脚本 | `mockups/assets/mockup.js` | `admin_portal/assets/mockup.js` | 语言切换 · `[data-i18n]` 渲染 · 复制回显 · URL query 变体态 · 对话框开合。**原型专用**：实现期由真实路由与前端行为替代 |
| 品牌标识 | `mockups/assets/logo.png` | `admin_portal/assets/logo.png` | 与仓库根 `memory.agent-mate.ai/logo.png` 同源（**三处 sha256 一致**）；**透明底品牌徽标 1004×520**（灰底 + 黄色「MCP」；品牌资产，**不参与 UI 色系核对**，见 §13 开头的说明）。公开页 hero 高 `112px`、管理面顶栏 `72px`（`≤720px` 时 `40px`）；按 `height` + `width:auto` + `object-fit: contain` 渲染，**不拉伸变形**（实测 hero `112×216`、顶栏 `72px`、`≤720px` 时 `40px`）。**语义重复 —— 2026-09-22 用户逐项定夺：保留**：徽标是**横向锁定款**，自带品牌名（`MEMORY MCP`）与域名（`agent-mate.ai`），与相邻的文本品牌串在 hero（`AI Memory MCP`）与顶栏（`memory.agent-mate.ai - AI Memory MCP`）**语义重复**；因 `AC6.11` 要求顶栏出现完整品牌串、`AC14.12` 要求公开页 hero 与管理面顶栏**各有一处** logo，重复是两条 AC 的**结构性结果**，不再改动 |
| 管理员微信二维码 | `mockups/assets/wechat.png` | `admin_portal/assets/wechat.png` | 站主本人二维码（第 1 步 Contact Admin 悬浮窗）；**属站主个人资产，非异产品品牌资产** |
| 调用示例截图 | `mockups/assets/chat-example.png` | `admin_portal/assets/chat-example.png` | 第 3 步「验证一次调用」示例；已核查**不含令牌明文 / 主机名 / IP**（仅一条 Memory id 与站主本人项目要点，站主已授权公开） |
| AI 客户端图标 | `mockups/assets/guide/{cursor,claude,codex,codebuddy,trae,copilot,kiro}.png` | 同名 | 7 项 Supported AI agents 的图标；**许可提示见下** |
| 原型页面与索引 | `mockups/*.html` | ——（不上线） | 评审用；**不得**随制品发布 |

**不入库 / 不入制品**

| 路径 | 原因 |
|---|---|
| `mockups/.verify/` | 原型验收脚本（`verify.py` / `measure.py` / `probe.py` / `crops.py`）与截图。**已显式排除在提交之外**，且**不入制品**；截图按需重生成。保留在本地是为了**实现期复跑同一组断言**（本文档写定时共 134 项断言全绿） |
| `mockups-from-other-product/`（**2026-09-22 已从工作树移除**） | **另一产品**的参考稿，含其产品文案、品牌徽标与三张异产品 logo ⇒ **本地临时参考、不入库**（本仓为公开仓，不转载他方品牌资产）。其**唯一**被本项目复制的资产是 `wechat.png`（站主本人二维码，**来源登记**见 [`../../admin_portal/README.md`](../../admin_portal/README.md)） |

> **AI 客户端图标的许可提示（发布前须确认）**：7 张图标分别为各自厂商的品牌标识（Cursor / Anthropic Claude / OpenAI Codex / CodeBuddy / TRAE / GitHub Copilot / AWS Kiro）。本页仅作「已实测可用」的**事实性列举**；公开站使用他方品牌标识前须确认其使用条款，必要时**改为纯文字列举**（去掉图标即可，不影响结构）。

---

## 16. 变更记录

> 编号 12–15 **已全部落盘**（§12 门户技术设计 · §13 UI 设计系统 · §14 逐页 UI 设计 · §15 UI 资产清单）。

| 日期 | 变更 |
|---|---|
| 2026-09-20 | **specs 整合**：由 `admin_portal_design.md` 迁入 `web-portal/`；**去重** —— 全链路数据流与两 stack 职责表已上移 [`../architecture.md`](../architecture.md) §3，本文档只保留门户内部设计；静默失败点 S4 与 architecture 的 R1 互指不重复叙述；耦合面 C1–C8 与 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §9（A–K）分工：C* 是门户对上游的 8 个依赖点，A–K 是全量契约清单 |
| 2026-09-20 | 已关闭的既有矛盾：门户代码位置定为本仓 `admin_portal/`（推翻「本仓不承载」）；「无公网入口」决议**部分修订**为「ai-memory 本体无公网入口，门户面有」；自有资产根增为两个（`memory.agent-mate.ai/` + `admin_portal/`）；升级七步增「门户镜像随 `upstream.lock` 重建」 |
| 2026-09-21 | **D1 定稿（β′，用户确认）+ 新增 §3.4 落地前置 + §9 附录更新**：§0 的 D1 由「可翻转」转**已定稿**；§3.2 构建片段补 `--platform=linux/amd64` / `ca-certificates` / 显式 `--uid 999 --gid 999`；新增 §3.4「三条硬前置 + 一条启动自检」（`/data/users` setgid 引导、门户持独立 MaaS key、版本断言、启动自检 fail-closed）；§9 附录补「α 的缓解措施被证不成立 + α 已排除」。依据 [`../knowledge/web-portal/portal-launch-mechanism.md`](../knowledge/web-portal/portal-launch-mechanism.md) E1–E7 |
| 2026-09-21 | **§3.3 会话档位定稿 + §10 #1 关闭**：`launch.argv` 由注释掉的待定项改为生效的 `--profile core`（对外统一 8 项）；§10 #1 由「未定」改为**已定**（管理员入口 = `admin` 22 项，两条模板分开维护），并指向已落盘的四处模板。决议与理由 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §8.3；实测 [`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh)；接入说明页的内容源 = [`../mcp/mcp-capabilities.md`](../mcp/mcp-capabilities.md)（[`./web-stories.md`](./web-stories.md) AC6.4） |
| 2026-09-22 | **文档边界修正（Sprint 4 #1）**：原 §1（三条上游硬事实）· §2（接入路径与会话流程）· §3 的 α/β′ 对照与 §3.1（β′ 制品契约）· §3.3（`launch` 模板与四条强制不变量）· §3.4 的上游依据 · §9（耦合面 C1–C8 + α 附录）**迁至** [`../mcp/mcp-design.md`](../mcp/mcp-design.md) **§5.6** 与 **§9 M**；本节改为「门户侧动作 + 回链」，`§9 附录` 保留稳定锚点作 α 回链（锚点冻结）。门户侧**保留**：§3.2（门户镜像构建）· §4（用户/密钥/库模型）· §5（静默失败点 S4）· §6（接入面与 CF Access 边界）· §7（容量、配额与限流）· §8（威胁模型 T1–T10）。文档头新增「**文档边界**」声明。判定标准：**随上游版本漂移、需探针守护**的跨进程契约归 MCP 侧；门户业务功能留本文件。连带：`scripts/attestation-paths-check.sh` 断言 C 改指 `mcp-design.md`（`launch` 模板真源随之迁移） |
| 2026-09-22 | **新增 §12「门户技术设计」+ 技术栈定档（关闭 §10 #2）**：① §0 决议登记新增 **D9 门户技术栈**（Node.js 22 LTS + TypeScript · Fastify · **Nunjucks 服务端模板** · 原生 CSS + `:root` 令牌 · 官方 MCP SDK 双 transport · 门户库 SQLite），并记明**被拒备选**（React SPA / Next.js / Python）与理由；② §10 #2 由「未定」转**已定**；③ §12 落 **10 个子节**：技术栈定档 · 模块划分与进程模型（`portal-web` / `mcp-bridge`）· 目录结构与文件命名（`admin_portal/`，模板与原型**同名映射**）· 路由表与**按 Host 分面 fail-closed** · 模板与 i18n 纪律（禁硬编码文案；CSS-only 交互，不引打包器）· 会话桥实现方案（**不手写帧解析**，禁 cluster/多 worker）· 门户数据模型落地（迁移 / 索引 / 敏感字段纪律）· 自建并发限流与超时 · 日志与脱敏（`shared/redact.ts` 单一脱敏源）· 关键配置项（只登记键名，不写真实值）与**组件依赖待办表**；④ 编号 12–15 预留给本 Sprint 的门户设计章节，原「变更记录」由 §12 顺延为 **§16**（无外部按号引用） |
| 2026-09-22 | **UI 二次迭代（Sprint 4 #1 追加）：色系改纯单色（D10）+ 管理面认证实施细则（D11）**：① §0 新增 **D10**——全站**无品牌色变量**，主按钮墨黑实底、活动态与聚焦环一律墨色、唯一有色为危险红；**推翻**同日上午的「保留 logo 橙」并计入**需求变更**（`logo.png` 图像自身橙色属品牌资产，不参与 UI 色系核对）；② §0 新增 **D11** + 新增 **§6.1「管理面认证实施细则」**——身份由 Cloudflare Access 认定、登录方式 Google 主 + 邮箱 OTP 兜底、多把钥匙=策略内多邮箱、**会话时长目标 3 个月但平台上限疑为 1 个月（实施期实测，不得断言）**、**根凭证=CF 账号 2FA 恢复码须离线保存（新增缺口）**、三层失效链、明确**撤销**「门户内邀请 admin / 重设密码 / 门户自建账号」；③ §13 整体改为**纯单色令牌**（移除 `--accent` / `--accent-deep` 与 `--ok` / `--warn` / `--info`，新增 `--bg-soft` / `--placeholder` / `--danger-wash`），并新增**三步接入纵向版式**、**说明页截图**、**Contact Admin 悬浮窗**三条组件规范与灰阶语义映射表；④ 同步 `portal.css`（残留彩色令牌 0 处） |
| 2026-09-22 | **UI 迭代轮收口（§13.9 / §13.10 / §14 / §15 落盘）**：① **§0 新增 D12 / D13 / D14**（页面集 6 页与 07 撤销 · 用户停用为可逆软操作 · 外框冻结与代码块圆角例外）；② **§12.3 路由表修正**：`/admin/guide（管理员接入指南）` → **`/admin/mcp（Admin MCP 配置）`**（含「公开页不含机密」同处引用），§12.2 目录树的 `routes/admin.guide` → `admin.mcp`；③ **§13.1 补 `--control-fs` 令牌**、登记 **代码块 8px 圆角例外**（曾误压平并回滚）、新增**根字号基准 17px**（`rem` 折算易错点）、更新**栏宽口径**（内容列 `min(100%, 72rem)` 左对齐 + 正文 `46rem` 限宽，`--max` 不再约束）；④ **新增 §13.9 组件规范**（分页 / 说明型区块 / 危险按钮 / 对话框补充 / `.dialog-path` 形态纪律 —— 并登记各自**缺失时的表现**，因此前多处类名在 CSS 中无规则）；⑤ **新增 §13.10 外框与滚动**（顶栏与页脚 `sticky` + 不透明底 + **禁止用 `margin-inline: auto` 居中内容列**的原因与被撑破视口的实测）；⑥ **新增 §14 逐页 UI 设计**（6 页 × 原型 ↔ 模板 ↔ 路由 ↔ 区块 ↔ 组件，含 11 种变体态）与 **§15 UI 资产清单**（单一真源、同步方式与哈希核对、**不入库清单**、AI 客户端图标的许可提示）—— 二者闭合 §12.2 的前向引用；⑦ 移除 `.content` 中已被覆盖的死规则 `max-width: calc(var(--max) + 4rem)` |
| 2026-09-22 | **两处待决项定夺并回填（用户逐项确认，均选「保留现状」）**：① §13 开头的 `logo.png` 说明第 ② 条由「是否有意为之由用户决定」改为**已定：保留** —— 徽标黄（实测 `#F6EC34`，占不透明像素 **2.1%**；其余为灰 `rgb(115,115,115)` 79.7%）**不**立强调色令牌、**不**要求灰阶化，口径收敛为「**UI 无品牌色；品牌资产图像自带色**」；这与 `AC14.1` 的扫描面（元素计算样式）一致，§13.1 仍**无品牌色变量**，实现不得据此新增 `--accent`；② §15「品牌标识」行补记**语义重复已定保留** —— 徽标为横向锁定款（自带 `MEMORY MCP` + `agent-mate.ai`），与 hero 的 `AI Memory MCP`、顶栏的 `memory.agent-mate.ai - AI Memory MCP` 重复，但 `AC6.11` 要求顶栏出现完整品牌串、`AC14.12` 要求两处**各有一处** logo ⇒ 重复是两条 AC 的**结构性结果**；同批把该行的高度口径补为**实测值**（hero `112×216`、顶栏 `72px`、`≤720px` 时 `40px`）|
| 2026-09-22 | **`PSP-W1`「账号与凭证」实现落地，设计文档同步五处**：① **§12.6 审计写入失败策略定档 fail-closed**（原「待决议」）—— 业务写与审计写同事务、审计写不进即整体回滚；并明确「失败的动作不写审计」（`AC1.6` / `AC2.9`）；② **§12.0 门户库驱动定档 `better-sqlite3`**（同步 API ⇒ 事务边界清晰、天然支撑 fail-closed；`engines: node >= 22` 与容器底座一致）；③ **§12.9 之后新增「本地开发认证实施口径」**（命名隧道 + Access 应用取得真身份；自动化分两层：离线自签 JWT、在线 Access Service Token；`CF-Access-Authenticated-User-Email` 只作交叉校验）；④ **§13.1 令牌收口落地**：`portal.css` 的 `:root` 补齐 `--bg-soft` / `--placeholder` / `--code-bg` / `--danger-wash` / `--dur-fast` / `--dur-base` / `--ease` 七个变量 ⇒ **恰好 30 个**，与本节总表一致，且 `var(--placeholder)` 的未定义引用消除；原型 134 项断言复跑全绿、交付副本 sha256 一致；⑤ 四语言词表由 `i18n.js` 的 220 键转为 `src/web/i18n/*.json` 并**新增 28 键**（错误提示、占位页、明文一次面板、401 页），键集合四语言一致（**248 键 ×4**）；另把 `dlg.deact.title` 改写为带 `{handle}` 插值（原型里写死了 `alice`）|
| 2026-09-23 | **§12.5 的上游超时口径回写为实测三分支（`3.1` 交付后 DoD 复核修正）**：原表写「**上游超时**（请求已发出但无响应） → **504** `upstream_timeout`」，实测不准确 —— Streamable HTTP 的响应是 SSE 流、**响应头先于上游结果**发出，故**响应头是否已发出决定状态码能否使用**：① **握手期**挂起（`client.connect` 未返回）→ **503** `upstream_unavailable`（响应头未发 ⇒ 可用状态码；集成测试**同时断言耗时** `elapsed < 4s`，只断状态码会漏掉「超时没生效」）；② **转发期**上游慢（SSE 头已发）→ **MCP 层错误**返回并**显式 `end()` 结束流**（状态码改不动；少了 `end()` 调用方会挂到上游最终响应为止 —— 实测 `5.1s` 而非 `0.3s`）；③ **转发阶段同步异常** → **504**（`relay` 的 `catch`，**504 的唯一可写时点**）。⇒ 结论：**`504` 的适用范围是「响应头未发出的转发阶段异常」，不是「任何上游超时」**；超时必须加在**上游请求**上（在 HTTP 层用 `Promise.race` 包转发**不生效** —— 转发把响应交给异步流后立即返回）。本条实测结论此前只在 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.2 的实证块，门户侧真源未同步；按 [`../sdd-scrum-practices.md`](../sdd-scrum-practices.md) §2.2 复核 `3.1` 的 `Done` 时发现并补上，同批结论见 [`../change-log.md`](../change-log.md) 2026-09-23 小节 |
| 2026-09-24 | **§12.5 的反方向边界补「触发条件」（`3.9` 交付）**：该行原本只写「尚未转发、属独立缺口」，本轮补上**可触发的判据** —— **上游一旦声明** `logging` / `resources` / `tools.listChanged` 中任一项，本边界**立即失效、必须重评**（那意味着客户端会期待收到桥此刻转发不了的 `notifications/message` / `notifications/resources/updated` / `notifications/tools/list_changed`）；当前真上游 core 档只声明 `{prompts, tools}`，且实测一次会话（握手 + 5 次真实调用 + 3s 静默）**零条主动消息** ⇒ 当前无损。另：§12.5 的「桥对客户端的身份与能力」与「超时分层」两节由 `3.9` **实现落地且未偏离定档**，故正文不改（实现轮取舍见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.2）；§12.9 按定档**未新增环境键**。 |
| 2026-09-24 | **§12.5 的 `spawn_assertion_failed` 行补两条口径（`3.2` 开发准备）**：① **判定必须在 `path.posix.normalize` 之后** —— 原行只写「库路径为空 / 不在 `/data/users/` 内 / 与 handle 不匹配」，**没说在哪个路径形态上判**；实测：`handle='alice/../bob'` 的字面路径 `/data/users/alice/../bob/ai-memory.db` **三过**字面断言，归一化后才是 `/data/users/bob/ai-memory.db`（**他人库** ⇒ 正是 `AC4.7` 那一类静默串号）⇒ **判定写在归一化之前等于没判**。口径真源见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.4 不变量 2 的实测表。② **审计只记原因枚举**（`empty` / `outside_users_root` / `handle_mismatch`）+ `stage`、**不记路径** —— 路径可能含**他人 handle**，写进本用户的审计行等于把他人身份落进可检索的审计面；客户端文案用**同一句**覆盖「缺失或不匹配」，同时满足 `AC4.4`（拒绝并告警）与 `AC4.7`（理由指出不匹配），无需回传路径。 |
| 2026-09-24 | **§12.5 的原因枚举补 `invalid_handle`（`3.2` 决策修订）**：`3.2` 的断言除「归一化后判三项」外，**再复用真源 `validateHandle`** 复述不变量 1（`handle` 为空 / 含 `/` / 含 `..` / 超长 / 不合字符集即拒绝）⇒ 审计原因枚举由三值扩为**四值**（`empty` / `outside_users_root` / `handle_mismatch` / `invalid_handle`）；客户端文案**不变**（仍是「缺失或不匹配」那一句、**不含路径**）。「为什么它不是冗余」（`users` 表的 `INSERT` 只有一条不做校验的路径）与「上一轮『不做』的定档被推翻」的留档见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.6.4 不变量 1 那一段。 |
