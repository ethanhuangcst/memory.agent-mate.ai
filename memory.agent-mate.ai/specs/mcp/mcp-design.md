# mcp-design — MCP 侧设计（能力边界 · 多用户隔离 · 档位与工具 · 上游契约面）

> **状态**：v2.0（specs 整合版） · as_of 2026-09-20 · 上游基准 `v0.10.0`（schema 80）；契约面行号依据 clone `main` @ `96b8c694`（schema 81）
> **真相源**：版本坐标 [`../../upstream.lock`](../../upstream.lock) · 决议 [`../architecture.md`](../architecture.md) §2 · 部署动作 [`../deployment.md`](../deployment.md) · 测试 [`./mcp-test.md`](./mcp-test.md)
> **定位**：MCP 侧「能力能到哪儿、隔离怎么钉、上游踩哪几块砖」的设计唯一真源。多用户隔离的**冻结机制**在 §0.1，**验收清单**在 §6.3（不复制到别处）

---

## 0. 结论：多用户隔离 = 有条件可实现

> 「机制**可行**」已由本地探针实测闭环（`iso-probe.sh`，A/B/C 三组、退出码 0）；「**可信**」有硬前置 **D1 + D2**，因为 **R1 不再是理论担忧，而是实测行为**。

| 问题 | 答案 | 证据 |
|---|---|---|
| 一用户一 DB 的物理隔离能否成立？ | **能**（双向检索未命中 / `memory_get` → `memory not found` / 主库计数不变） | 探针 P2 · P3 · P5 |
| 「不设 `AI_MEMORY_DB` 就共用主库」只是理论担忧？ | **不是** —— D2 落地**前**（2026-09-20 实测）：退出码 0、无任何告警，`source` 静默落到 config 的 `db`（`/data/ai-memory.db`）。**该落点已于 2026-09-21（D2）消除**：漏设退化为相对路径并 fail-loud（现行行为见 §6.1 D2 / §6.2 V1） | 探针 P1a（旧行为）· §6.2 V1（现行） |
| 方案②（单库 + per-user env）能替代吗？ | **不能** —— 读隔离成立，但**写路径完全可伪造**：bob 以 `agent_id=human:iso-alice` 写入成功并回显 alice 身份，alice 随后检索到被注入内容 | 探针 P6 |
| 错设路径是否也静默？ | 注意：视情况 —— 目标库**打不开**时 fail-loud（`Storage=critical / failed to open database`，rc=2）；**指到有效他库**时仍静默（唯一拦截是 D1 断言，Sprint 4 #7）；**漏设**在 D2 落地后亦 fail-loud | 探针 P4 · §6.2 V1 |

### 0.1 冻结机制（2026-09-20 用户确认，按探针实测形态冻结）

| 项 | 冻结值 |
|---|---|
| 用户库路径 | `/data/users/<handle>/ai-memory.db` |
| 用户密钥目录 | `/data/users/<handle>/keys/`（`AI_MEMORY_KEY_DIR`） |
| 属主 | `aimem:aimem` —— `docker exec -u 0 ai-memory-mcp sh -c 'mkdir -p /data/users/<handle>/keys && chown -R aimem:aimem /data/users/<handle>'`。**2026-09-21 起**：门户路径下由门户以 `aimem` 身份自建 0700 目录，**前置**是 `/data/users` 为 `root:aimem 2775`（setgid，一次性引导见 [`deployment.md`](../deployment.md) §4.4）；`-u 0` 形式仅保留给 root 手工操作 |
| 会话 env 三件套（隔离相关） | `AI_MEMORY_DB` / `AI_MEMORY_AGENT_ID=human:<handle>` / `AI_MEMORY_KEY_DIR` —— **全部钉在服务端**，客户端改不了。用户行模板另含**可用性前提** `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`（§5.2），故实际是**四项** |
| 接入方式 | 单 OS 账号 + N 密钥，`authorized_keys` 每用户一行 forced command（§5.2 模板） |
| 每库维护 | `ai-memory --db /data/users/<handle>/ai-memory.db stats \| gc \| curator --once` |
| 探针残留 | `iso-alice` / `iso-bob` / `iso-shared` 三库保留供复查；清理 `docker exec -u 0 ai-memory-mcp rm -rf /data/users/iso-*` |

### 0.2 四个静默点（每次改动后必查）

前三个见 [`../deployment.md`](../deployment.md) §7.2（embedder 降级 keyword / curator fail-open `tagged=0` / config 挂载错位退 semantic）；第四个是隔离侧的 **R1**：会话漏设 `AI_MEMORY_DB` 曾**静默落共享主库**（无报错、无告警、无日志）—— D2 落地后该落点已消除、退化为 fail-loud；**指到有效他库仍静默**，由 D1 断言拦截（§6.1）。

---

## 1. 传输形态：stdio，且**只有** stdio

| # | 事实 | 证据 |
|---|---|---|
| 1 | 上游**未实现** `/mcp`、`/sse` HTTP 端点；正式路由仅 `/api/v1/*` + `/metrics` | `src/handlers/routes.rs:14-95`；`server.json` 只声明 `"type":"stdio"` |
| 2 | `stdout` 被 JSON-RPC 独占，日志走 stderr | `src/mcp/mod.rs:3301,3329-3348` |
| 3 | `serve` 的 9077 仅绑容器回环、无 api_key、不对外 | [`../deployment.md`](../deployment.md) §3 |
| 4 | **生产调用方式**：`ssh ai-memory`（forced command `docker exec -i ai-memory-mcp ai-memory mcp --tier smart`） | 同上 §4.3 |

> 客户端侧**只加 `-i`，绝不加 `-t`**（pty 破坏 stdio 帧，与 forced command 的 `no-pty` 同因）。若未来上游新增 HTTP MCP 端点，本结论需重评（机会项，登记在 [`./mcp-test.md`](./mcp-test.md) §4-C）。

---

## 2. 上游能力边界（逐条有依据）

| 能力 | 结论 | 依据 |
|---|---|---|
| 账号 / 租户模型 | **不存在**（无 user / tenant / invite 概念，上游自称 single-tenant） | 源码核实 |
| 多租户**读**隔离 | 存在且覆盖面广 —— 按行 `scope=private` + 属主过滤 | `is_visible_to_caller` 应用于 `session_start`/`list`/`recall`/`search`/`get`/`kg_query`/`kg_timeline`/`link`/`load_family`/`lineage`/`replay`/`find_paths` + 全部 HTTP handler |
| 可见性调用者来源 | **只认 `AI_MEMORY_AGENT_ID` 环境变量**（`resolve_read_visibility_caller`，**不接受工具参数**）；未设 = trust-all | `src/identity/mod.rs:333-345` |
| 上游官方要求 | *"Operators running a multi-tenant MCP host **MUST** set `AI_MEMORY_AGENT_ID` per tenant"* | `docs/ADMIN_GUIDE.md:1069` |
| 写路径可见性过滤 | **完全没有**（`store`/`atomise`/`promote` 命中 0） | 源码 grep |
| `namespace` | 注意：是**分类**，**不是授权边界** | 源码 |
| macaroon 能力令牌 | 注意：**additive-only**（只放宽不收紧）；v0.10.0 默认关闭 | `src/governance/capability.rs` |
| 顶层 `api_key` | 注意：单一共享密钥，无多用户、无法按用户吊销 | `src/config.rs:2793` |
| 默认 `scope` | 注意：写入**默认即 `private`** | `src/mcp/tools/list.rs:251-252` |
| 静态加密 | `AI_MEMORY_ENCRYPT_AT_REST=1` → 按 agent 的 X25519 ECDH + ChaCha20-Poly1305（per-node at-rest） | `src/encryption/mod.rs:1-20` |
| 按 agent 配额 | `agent_quotas` / `ai-memory quota-status` | `src/cli/commands/quota_status.rs` |
| 记忆内容多语言 | **部分支持** —— 存储与语义通路**不限语言**（简中 / 繁中 / 英文写入、`memory_recall` 语义召回 `mode=hybrid`、`memory_get` 按 id 直取均可用）；`memory_search` 关键词通路受 FTS5 默认分词器（`unicode61`，建表未指定 `tokenize=`）限制：只认**完整词元**（英文 = 单词、中文 = 标点/空白界定的整段），词元内子串与**简繁交叉**一律不命中；**无任何配置项**。工程口径：中文检索走 `memory_recall`，关键词通路只用于 ASCII 标记与整段引用 | 探针 [`../../scripts/i18n-probe.sh`](../../scripts/i18n-probe.sh)（L1.6，[`./mcp-test.md`](./mcp-test.md) §4-E）；源码依据本文件 §9 J4 |

> **Ed25519 身份 ≠ 授权**：`metadata.agent_id` 是**自述值**，任何调用者可填，不得单独作授权闸门（只用于溯源/审计/过滤）。

---

## 3. 四档隔离方案（选 ③）

| 档 | 机制 | 读写隔离 | 运维成本 | 适用 |
|---|---|---|---|---|
| ① 单库 trust-all | **不设** `AI_MEMORY_AGENT_ID` | 读：全开（有意）<br>写：不设防 | 最低 | **单人多设备共享**（场景 A） |
| ② 单库 + 每用户 env | `-e AI_MEMORY_AGENT_ID=human:<u>` | 读：强制<br>写：不强制（**可伪造**） | 低 | 互信小团队 |
| ③ 一用户一 DB | `-e AI_MEMORY_DB=/data/users/<u>/ai-memory.db` | 读：**物理**<br>写：**物理** | 中（每库各自维护+备份） | **多用户（场景 B）默认** |
| ④ 一用户一容器 | 独立 stack | 物理 + 独立故障域/tier/版本/配额 | 高（N× compose/config/env） | 需要独立故障域或差异化规格 |

> **为什么 ③ 而不是 ②**：② 的读隔离可强制，但写路径无过滤且 `agent_id` 是自述值（MCP 工具参数优先级高于 env）→ 任意用户可把他人名字写在行上。③ 让这条路径**物理上不存在**。

---

## 4. 关键澄清：不需要多开 SSH 账号

| # | 事实 | 含义 |
|---|---|---|
| 1 | `authorized_keys` **逐行**生效，`command="…"` 是**每条密钥**的属性 | 同一 OS 账号可挂 N 把密钥，各自独立 forced command |
| 2 | `docker exec`（不带 `-u`）以镜像 `USER aimem` 运行（compose 无 `user:` 覆盖） | 登录用的 OS 账号**根本不进入记忆层** |
| 3 | 记忆身份 100% 来自 forced command 里钉的 `-e` | OS 账号是「谁」对隔离**零影响** |

⇒ **N 个用户 = 1 个 OS 账号（`aimem-ssh`）+ N 把密钥 + N 条记录。**

| 维度 | 单账号 + N 密钥（推荐） | N 个 OS 账号 |
|---|---|---|
| 隔离强度 | — | 同等，**零增益** |
| 每用户成本 | 1 把密钥 + 1 行 | `useradd` + 组/sudoers + 家目录 + 密钥 |
| 攻击面 | 1 个 docker 组成员 | **N 个**（docker 组 ≈ root 等价） |
| 吊销 | 删 1 行 | 删账号（易漏家目录/组） |
| sshd 日志区分用户 | 否（**唯一实质损失**；用 `metadata.agent_id` + `authorized_keys` comment 补） | 是 |

---

## 5. 配方

### 5.1 场景 A：单人多设备共享（方案 ①）

`authorized_keys`（每台机器一条，**都不带** `-e AI_MEMORY_AGENT_ID`）：

```text
command="docker exec -i ai-memory-mcp ai-memory mcp --tier smart --profile admin",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA…mac1 user@mac1
```

- **共享**：读 trust-all → 全部互见
- **出处仍保留**：写入自动合成 `ai:cursor@mac1` / `ai:codebuddy@mac2` …（durable + pid-free；同机两个工具靠 `initialize.clientInfo.name` 区分）
- 客户端 `mcp.json`（三台相同）：`{ "mcpServers": { "ai-memory": { "command": "ssh", "args": ["ai-memory"] } } }`
- **本行不写 `-e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`**：依赖 compose 的**容器级**同名变量（[`../../deploy/docker-compose.prod.yml`](../../deploy/docker-compose.prod.yml) 的 `ai-memory` / `curator` 两处），与 [`deployment.md`](../deployment.md) §4.3 管理员行口径一致。容器级缺该键的后果见 §9 B3；**用户行则显式重申**（§5.2，防模板漂移）

### 5.2 场景 B：多用户物理隔离（方案 ③）

```
command="docker exec -i -e AI_MEMORY_DB=/data/users/alice/ai-memory.db -e AI_MEMORY_AGENT_ID=human:alice -e AI_MEMORY_KEY_DIR=/data/users/alice/keys -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0 ai-memory-mcp ai-memory mcp --tier smart --profile core",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA…alice alice@mac
```

- **档位**：用户行写 `--profile core`（8 项，对外统一口径）；管理员入口写 `--profile admin`（22 项）——决议与理由见 §8.3；改档位必须**重连**才生效
- **`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`**：可用性前提（[`../architecture.md`](../architecture.md) §2.1 #9）。**显式重申**的理由与 `--profile core` 同源 —— 防静默漂移：v0.10.0 的 MCP/CLI 面缺省即宽松（**实测写入成功、不报错**），HTTP direct-write 缺省要求签名，设 `=1` 则**全局严格**、无签名写入被拒（实测报错 `agent attestation failed: … this write is unsigned`）；而 v0.11 起默认翻转为全 surface required ⇒ 漏写这行会在升级后才爆。模板与 [`deployment.md`](../deployment.md) §4.3 用户行**逐字一致**
- `AI_MEMORY_KEY_DIR` 指向用户目录，避免所有人共用默认 key dir
- 客户端：`~/.ssh/config` 用自己的密钥；`mcp.json` 只需 `args: ["ai-memory"]`（forced command 覆盖一切）
- **逐行追加**（最小侵入、易审计、可回滚）—— 不要整文件重写，一次拼错会连带整个文件失效
- 目录准备命令见 §0.1（属主必须 `aimem:aimem`）

### 5.3 每库背景维护（必补）

compose 常驻的 `serve` 与 `curator` **只服务默认库**；每用户库需等价周期维护，否则 TTL 遗忘 / 压缩 / GC 不会跑：

```bash
for db in /data/users/*/ai-memory.db; do
  docker exec ai-memory-mcp ai-memory --db "$db" gc
  docker exec ai-memory-mcp ai-memory --db "$db" curator --once --max-ops 50
done
```

> `--db <path> stats` 通路已实测（各库计数独立）；注意：`gc` / `curator --once` 对每库 TTL 遗忘与 WAL checkpoint 的**覆盖面未验**（Sprint 3「每用户库维护行为定档」）。

### 5.4 备份与配额

- 备份脚本**遍历所有库**：逐库 `ai-memory --db <each> backup --to /data/backups/<user> --keep 48`，外迁用 `tenants/<user>/` 前缀
- 配额走上游 `[limits]` 段，按 **`(agent_id, namespace)` 逐行盖章**：配额行在首次写入时由**当次进程**的默认值固化，事后改 `[limits]` **不追溯**已有行；CLI 一次性写入（`ai-memory store`）**故意不计费** ⇒ 只能用 MCP `memory_store` / `memory_link` 验证。我方「一用户一库 + 一 agent」⇒ 天然等价于 **per-用户配额**
  - 七键与编译默认（v0.10.0）：`max_memories_per_day=1000` · `max_storage_bytes=104857600`（100 MiB）· `max_links_per_day=5000` · `max_page_size=1000` · `max_inflight_requests=0`（禁用）· `vector_index_capacity=100000` · `vector_index_hard_fail_at_cap=false`
  - 优先级 **env > `[limits]` > 编译默认**；任意层**非正值（≤0）视为未设**并继续回落。环境变量有**两套前缀**：`AI_MEMORY_MAX_{MEMORIES_PER_DAY,STORAGE_BYTES,LINKS_PER_DAY,PAGE_SIZE,INFLIGHT_REQUESTS}` 与 **`AI_MEMORY_VECTOR_INDEX_{CAPACITY,HARD_FAIL}`**（后者**不是** `AI_MEMORY_MAX_*`）
  - 超限形态：MCP 面错误串含 `QUOTA_EXCEEDED`；HTTP 面为 `429` + `{"error":"QUOTA_EXCEEDED","limit","current","max"}`
  - **面归属**：`max_page_size`（每请求内存上限，非限流）与 `max_inflight_requests`（准入并发层）是 **HTTP 面专属**，stdio MCP **不经过** ⇒ 实测对 stdio 无副作用，见 [`./mcp-test.md`](./mcp-test.md) §4-D TC-LIMIT-02
  - 核对命令：`ai-memory quota-status --agent-id <id> --namespace <ns> --json`（顶层 `agent_id` / `namespace` / `quota`，字段在 `quota` 对象内）
  - 模板口径：`[limits]` **显式写全 7 键并等于编译默认** —— 与 `--profile core`、`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 同源策略：不写就等于把行为交给上游默认值，而改变是**静默**的
- 可选加固：`AI_MEMORY_ENCRYPT_AT_REST=1` → 外迁快照非明文（运维仍可解，密钥在容器内）

### 5.5 sudoers 加固（可选，优于 docker 组）

```
# /etc/sudoers.d/ai-memory-mcp
aimem-ssh ALL=(root) NOPASSWD: /usr/bin/docker exec -i ai-memory-mcp ai-memory mcp --tier smart
```

收益：即使误加一条**没有** forced command 的记录也拿不到完整 docker 权限，且规则不随用户数增长。代价：需在服务器实测无通配符 argv 匹配行为（Sprint 5 前）。

---

## 6. 条件矩阵 · 验证项 · 验收清单

### 6.1 D1–D5（结论成立的依赖）

| # | 防线 | 为什么是「条件」 | 状态 |
|---|---|---|---|
| **D1** | fail-closed 断言：spawn 前断言 `AI_MEMORY_DB` 非空 + 以 `/data/users/` 开头 + 含该 `handle` | 即使 D2 已让“漏设”失败，错设为存在且可写的他库仍不会报错；必须由门户绑定 handle 与路径 | 待落地：Sprint 4 #7「门户 ↔ MCP 会话桥」 |
| **D2** | 移除 `config.toml.tmpl` 的 `db` 键；本地派生时机械剥离私有配置遗留的顶层 `db`；现存调用点审计见 §6.5 | 该键是 R1 的共享主库落点；移除后漏设退化为相对路径并 fail-loud | **已落地（本地 2026-09-21，Sprint 3 #2）**；生产复验随 Sprint 5 #8 |
| **D3** | 一会话一子进程，**禁止跨用户复用/池化** | 单库方案写路径无 caller 边界（P6），会话复用即把边界交还给门户 | 待落地：Sprint 4 #7「门户 ↔ MCP 会话桥」 |
| **D4** | 会话审计含**解析出的库路径** | 事后可对账；`doctor --json` 的 `source` 即现成来源 | 待落地：Sprint 4 #4「审计视图」 |
| **D5** | 上线前负向验收（不过则阻断） | 本地门禁先定型，生产 forced-command 路径上线时复验 | 本地：Sprint 3 #3「隔离本地负向回归」；生产：Sprint 5 #8「上线验收」 |

> D1/D2 不提升隔离**上限**（上限由物理分离给定），只保证**下限**：配置错一次不会静默串号。这是「可实现」与「可信」的分界。

### 6.2 V1–V4（本地预实证 → 生产级）

| # | 验证 | 本地预实证 | 证据 | 生产级待办 |
|---|---|---|---|---|
| **V1** | 负向：漏设 `AI_MEMORY_DB` 必须失败 | **已通过（2026-09-21）**：`doctor` 非零；同一次响应的 `source` 规范化为绝对路径且非 `/data/ai-memory.db`；失败原因属于存储路径；共享主库记忆计数不变 | P1a | 生产模板上复验，并继续由门户 D1 拦截有效他库路径 |
| **V2** | 正向：目标库写入且共享主库计数不变 | 是（2026-09-21：用户库非空且属主正确；主库计数保持不变；mtime 仅记录不作硬门禁） | P2 · P5 | 生产卷上复验 |
| **V3** | 交叉：A 写后 B 检索不到、B `get <A id>` 不可见 | 是（2026-09-21 加固后重跑：双向未命中；`get` → `memory not found`） | P2 | 生产 forced command 路径复验 |
| **V4** | 解析链自检：与模板**用户行相同的服务端 env**（四项含 attestation；`--profile` 只影响工具集、不参与判定）跑 `doctor --json`，`source` == 该用户库 | 是（2026-09-21：`source=/data/users/iso-alice/ai-memory.db`） | P3 | 用**生产模板实际生成**的 env 再验 |

### 6.3 验收清单（方案 ③）

> `[x]` = 本地基线已预实证（`iso-probe.sh`）；`[ ]` = 生产级仍须验证。

- [x] 每用户 `ai-memory --db <own> stats` 只看到自己的计数（P5：alice=1 / bob=1 / 主库=7）
- [x] 用户 A 写入后，用户 B 检索**命中不到**（且不报错）（P2 双向）
- [x] 用户 B 显式 `memory_get <A 的记忆 id>` → **不可见**（P2：`memory not found`）
- [x] `/data/users/<u>/ai-memory.db` 存在且属主 `aimem:aimem`（P2）
- [ ] cron 维护对每个库都执行成功（日志无错）—— Sprint 3 #5「每用户库维护行为定档」
- [ ] 备份脚本对全部库产出快照 + manifest（sha256 校验通过）—— Sprint 5 #3/#7
- [ ] 吊销：删除该用户 `authorized_keys` 行后 SSH 立即失败 —— Sprint 5 #5

### 6.4 未决前提（结论成立不依赖，但上线前必须关闭）

| # | 前提 | 归属 |
|---|---|---|
| 1 | 写路径泄露探针：去重/合成是否把他人私有内容回显给写入者（**只影响已排除的方案②**；方案③无跨库路径） | **已取消**（2026-09-21 范围校准） |
| 2 | `gc` 是否覆盖每库的 TTL 遗忘 + WAL checkpoint | Sprint 3 #5「每用户库维护行为定档」 |
| 3 | `AI_MEMORY_DB` 指向**有效但错误的**他库路径 —— 唯一能拦住它的是 D1 的路径断言 | Sprint 4 #7「门户 ↔ MCP 会话桥」 |
| 4 | sudoers 无通配符 argv 匹配行为 | Sprint 5 前 |
| 5 | 门户尚未存在（D1/D3/D4 的最终载体） | Sprint 4 #7 / #4 |
| 6 | `<handle>` 命名规范（大小写/长度/是否等于邮箱别名） | 门户设计 Sprint 4 |

### 6.5 库路径调用点审计（D2 验收证据，2026-09-21）

> **范围**：只核**现存**启动路径是否显式指定目标库（D2 的「调用点审计」）。**不含**每库维护命令 —— 那要等 §5.3 定档（Sprint 3 #5）。「错设为存在且可写的他库」也不在本表范围，由门户 D1 断言拦截（Sprint 4 #7）。
>
> **复跑方式**：`grep -n 'AI_MEMORY_DB' memory.agent-mate.ai/deploy/docker-compose.prod.yml memory.agent-mate.ai/specs/deployment.md memory.agent-mate.ai/specs/web-portal/web-design.md memory.agent-mate.ai/specs/mcp/mcp-design.md`

| # | 调用点 | 启动方式 | 库路径来源 | 证据 |
|---|---|---|---|---|
| 1 | compose `ai-memory`（serve） | 容器级 env | 显式 `AI_MEMORY_DB=/data/ai-memory.db` | [`../../deploy/docker-compose.prod.yml`](../../deploy/docker-compose.prod.yml) 第 26 行 |
| 2 | compose `curator` | 容器级 env | 显式 `AI_MEMORY_DB=/data/ai-memory.db` | 同上第 52 行 |
| 3 | SSH 管理员行（主人默认库） | forced command → `docker exec` | **不写 `-e`**，依赖 #1 的容器级变量 | [`../deployment.md`](../deployment.md) §4.3 管理员行 · 本文 §5.1 |
| 4 | SSH 用户行（一用户一库） | forced command → `docker exec -e …` | 逐行显式 `-e AI_MEMORY_DB=/data/users/<handle>/ai-memory.db` | [`../deployment.md`](../deployment.md) §4.3 用户行 · 本文 §5.2 |
| 5 | 门户 spawn（β′ 子进程） | 子进程 env | 模板 `AI_MEMORY_DB=/data/users/{handle}/ai-memory.db` | [`../web-portal/web-design.md`](../web-portal/web-design.md) §3.3（运行时代码待 Sprint 4 #7） |
| 6 | 每库维护（`gc` / `curator --once`） | CLI 参数 | **待定档**：必须显式 `--db <path>` | 本文 §5.3 · Sprint 3 #5「每用户库维护行为定档」 |

**结论**：现存 5 条（#1–#5）**无一条**依赖 config 的库路径 —— 即 D2 移除顶层 `db` 后，没有任何调用点会受影响；#6 定档时须同样显式传 `--db`，且届时本表随之补行。

---

## 7. 五个坑（必读）

| # | 坑 | 症状 | 规避 |
|---|---|---|---|
| 1 | **默认 `scope=private`** | 四个客户端给不同 agent_id → 四座孤岛 | 场景 A 用方案 ①；或写入显式指定共享 scope |
| 2 | operator self-lockout（#1720） | 已有数据的库上开启 `AI_MEMORY_AGENT_ID` → 非本属主的私有行**瞬间不可见** | 在空库上启用；或先 `reown --namespace <ns> --to <caller> [--claim-unowned]`（先 `--dry-run`） |
| 3 | **`--agent-id` ≠ `AI_MEMORY_AGENT_ID`（静默失效）** | 用 flag 配身份 → 写入标记正常，但读路径 caller = `None` → trust-all，**隔离根本没开** | 一律用**环境变量**（`resolve_read_visibility_caller` 只读 env） |
| 4 | **写路径无可见性过滤** | 方案②下任意用户可 `memory_store(agent_id="human:bob")` 注入他人私有空间 | 用方案③；或仅限互信成员 |
| 5 | **别用自动合成的 id 做隔离** | `host:<hostname>` 随换机变；`anonymous:pid-<pid>-<uuid8>` 每次进程都变 → 私有行写了读不回 | 隔离场景一律**显式稳定 id**（`human:alice`） |

---

## 8. 档位（`--profile`）与工具清单

> 数字与名称**从源码派生**（上游文档在此处滞后）：工具名 `src/mcp/registry.rs` · 族 `src/profile.rs:391` · 档位 `src/profile.rs:647-697` · 计数 `:714`。**上游发新版后必须复核。**
>
> **面向最终用户的通俗版**（你能用哪些、每个工具做什么、什么时候用、示例）：[`./mcp-capabilities.md`](./mcp-capabilities.md) —— 门户「接入指引」页面的**唯一内容源**（页面只做取舍与翻译，不得自行改写工具清单）。该文档**按档位分表、每张只列本档新增**，编号从 1 连到 101（`core` 1–8 / `admin` 9–22 / `graph` 23–34 / `power` 35–83 / `full` 84–101），其体例变更时本节引文须一并同步。

### 8.1 档位与工具数

| 档位 | 组成 | 族计数口径 | **实际注册数** |
|---|---|---|---|
| `core` | Core | 7 | **8** |
| `graph` | Core + Graph | 19 | **20** |
| `admin` | Core + Lifecycle + Governance | 21 | **22** |
| `power` | Core + Power | 56 | **57** |
| `full` | 全部族 | 101 | **101** |

> **实测（2026-09-21，v0.10.0）**：探针 [`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh)（每档独立进程，只发 `initialize` + `tools/list` + 一次 `memory_capabilities`）实测注册数 —— `core=8` / `graph=20` / `admin=22` / `power=57` / `full=101`，与上表**逐档一致**；自定义 `core,lifecycle=14`（新增 Lifecycle 6 项，含 `memory_delete` / `memory_forget` / `memory_gc`，不含治理与自治面）；**默认档（不传 `--profile`）= 8 项，与 `core` 一致且不报错**。生效形式：`--profile` CLI flag，与 `--tier smart` **并存有效**（无需回退 env）。

- **两个易算错的点**：① `memory_capabilities` 属 `Meta` 族但被列为 `ALWAYS_ON_TOOLS`，**所有档位**都加载 ⇒ 除 `full` 外各档**实际注册数 = 族计数 + 1**；② **默认档位是 `core` 不是 `full`** —— 模板不显式写 `--profile full` 就只暴露 8 项，**且不报错**。
- 自定义档位：`--profile core,graph,archive`（逗号分隔族列表）。
- 解析优先级：`--profile` > `AI_MEMORY_PROFILE` > `config.toml [mcp].profile` > `core`。
- **`--profile`（工具档）与 `--tier`（搜索档：keyword/semantic/smart）是两个独立维度**，不要混用。
- **档位只能启动时定**：Cursor 回报 `deferred_registration: false`，`memory_load_family` **不会**把新家族注册进 harness → 改档必须改客户端 args 并重连。

### 8.2 工具清单（按族，共 101 项）

| 族 | 数 | 可见档位 | 工具 |
|---|---|---|---|
| **Core** | 7 | 所有 | `memory_store` `memory_recall` `memory_list` `memory_get` `memory_search` `memory_load_family` `memory_smart_load` |
| **Lifecycle** | 6 | admin/full | `memory_update` `memory_delete` `memory_forget` `memory_gc` `memory_promote` `memory_capture_turn` |
| **Graph** | 12 | graph/full | `memory_kg_query` `memory_kg_timeline` `memory_kg_invalidate` `memory_link` `memory_get_links` `memory_entity_register` `memory_entity_get_by_alias` `memory_get_taxonomy` `memory_replay` `memory_verify` `memory_find_paths` `memory_lineage` |
| **Governance** | 8 | admin/full | `memory_pending_list` `memory_pending_approve` `memory_pending_reject` `memory_namespace_set_standard` `memory_namespace_get_standard` `memory_namespace_clear_standard` `memory_subscribe` `memory_unsubscribe` |
| **Power** | 49 | power/full | `memory_consolidate` `memory_detect_contradiction` `memory_check_duplicate` `memory_auto_tag` `memory_expand_query` `memory_inbox` `memory_subscription_replay` `memory_subscription_dlq_list` `memory_quota_status` `memory_reflect` `memory_reflection_origin` `memory_dependents_of_invalidated` `memory_check_agent_action` `memory_rule_list` `memory_export_reflection` `memory_offload` `memory_deref` `memory_atomise` `memory_persona` `memory_persona_generate` `memory_ingest_multistep` `memory_calibrate_confidence` `memory_share` `memory_action_create` `memory_action_get` `memory_action_transition` `memory_action_list` `memory_action_add_edge` `memory_action_edges` `memory_action_frontier` `memory_action_next` `memory_lease_acquire` `memory_lease_renew` `memory_lease_release` `memory_lease_get` `memory_signal_send` `memory_signal_read` `memory_signal_inbox` `memory_signal_thread` `memory_signal_ack` `memory_checkpoint_create` `memory_checkpoint_resolve` `memory_checkpoint_query` `memory_checkpoint_verify` `memory_routine_create` `memory_routine_freeze` `memory_routine_run` `memory_routine_status` `memory_routine_list` |
| **Meta** | 6 | full（`memory_capabilities` 例外：全档位） | `memory_capabilities` `memory_agent_register` `memory_agent_list` `memory_session_start` `memory_stats` `memory_recall_observations` |
| **Archive** | 4 | full | `memory_archive_list` `memory_archive_purge` `memory_archive_restore` `memory_archive_stats` |
| **Other** | 9 | full | `memory_list_subscriptions` `memory_notify` `memory_skill_register` `memory_skill_list` `memory_skill_get` `memory_skill_resource` `memory_skill_export` `memory_skill_promote_from_reflection` `memory_skill_compositional_context` |

> 每项的功能描述以运行时 `memory_capabilities` 自述为准，此处只登记名称与归属（避免与上游漂移）。

### 8.3 档位决议与开放问题

| # | 决策 | 现状 |
|---|---|---|
| 1 | 对用户暴露哪一档 | **已定（2026-09-21）**：对外（SSH 与门户**统一**）= **`core`（8 项）**；管理员另设入口 = **`admin`（22 项）**，两条模板分离。理由：对外取最小面（不开放删除，代价见 #4）；管理员通道要在同一入口里做删除 / 遗忘 / 清理与治理审批（Lifecycle + Governance）—— `core` 做不到；而 Meta / Archive 族（`memory_stats` / `memory_agent_list` / `memory_archive_stats`）属 `full` 档，**不随 `admin` 开放**（管理员若确需只读统计类工具，另开条目评估）。**模板已落盘（2026-09-21 收尾，原「移交 Sprint 3 #2 / Backlog #12」提前完成）**：SSH 主人行 `admin` + 用户行 `core`（[`../deployment.md`](../deployment.md) §4.3）、完整配方（本文 §5.1 `admin` / §5.2 `core`）、门户 `launch.argv`（[`../web-portal/web-design.md`](../web-portal/web-design.md) §3.3）、本地客户端条目（[`./mcp-test.md`](./mcp-test.md) §3） |
| 2 | 门户模板与 SSH 模板是否统一档位 | **已定**：统一为 `core`（同上 #1）；管理员入口（`admin`）单独一条，不与用户通道混用 |
| 3 | 选档后如何验收 | 用 `initialize` + `tools/list` 实测计数 —— 能力已由 [`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh) 提供（7 档全绿）；**TC-TIER-01 / 02 已完成 2026-09-21**（各档计数实测 + `memory_capabilities` 交叉一致；四处模板均已含 `--profile`），登记在 [`./mcp-test.md`](./mcp-test.md) §4-C |
| 4 | `core` 档**不含删除类工具**（`memory_delete` / `memory_forget` / `memory_gc`） | **已知限制，本轮接受**：用户无法自行删除或遗忘自己的记忆。若要开放删除，**最小增量档位是 `core,lifecycle`（实测 14 项）**，不是 `admin`（22）或 `full`（101）——后者会同时引入治理面与自治编排面。是否开放、何时开放另开条目评估，**不在 #9 结论内** |

---

## 9. 上游契约面清单（升级预检逐项核对）

> 这是「最小耦合」的**可执行载体**：只登记我方**实际踩的那几块砖**，不追求覆盖上游全集。
> **敏感度**：**高·静默** = 理解错了不报错、只是行为退化 → 必查且必须用**运行证据**核对；中 = 会响亮失败；低 = 影响有限。
> 注意：检测命令中的 `curl` 仅作**上游位置**的语义说明 —— **镜像内不含 curl/wget**，容器内 HTTP 探测改用 `ai-memory doctor` 与 serve 日志（见 [`../deployment.md`](../deployment.md) §7.1）。

### A. 镜像与容器形态

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| A1 | `ENTRYPOINT ["ai-memory"]` | 高 | 改入口 → compose `command:` 与 SSH forced command **同时断** | `Dockerfile:58` |
| A2 | 默认 `CMD ["serve","--host","0.0.0.0"]` | 中 | 我方已显式覆盖为 `127.0.0.1`，影响小 | `Dockerfile:59`；覆盖处 compose |
| A3 | `VOLUME /data` + `chown aimem:aimem /data` + `USER aimem` | 中 | 属主/路径变 → 写入失败（响亮） | `Dockerfile:46-47,53,56` |
| A4 | `EXPOSE 9077`（我方不映射主机端口） | 低 | 端口变 → `serve --port` 与健康探针失配（响亮） | `Dockerfile:54` |
| A5 | 编译特性 = 默认（`sqlite-bundled`），**不含 `sal-postgres`** | 高 | 默认 features 变更 → SQLite 命名卷形态失效（响亮） | `Dockerfile:29`；`Cargo.toml:255-261` |
| A6 | 基线 `debian:bookworm-slim` | 低 | glibc 变更极少引发问题 | `Dockerfile:10,32` |
| A7 | 标签语义：release 推 `<version>` + `latest`；**prerelease 不推镜像**（预期行为） | 中 | 若只推 latest → 「禁用 latest」策略需换坐标 | `.github/workflows/release.yml:722,753-755` |

### B. 环境变量

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| B1 | **`HOME=/data`** 是 config 路径的**唯一**输入（`$HOME/.config/ai-memory/config.toml`，无 env 能改写该路径） | 高·静默 | 与挂载点不一致 → config **静默忽略** → tier 退 `semantic`，llm/embeddings 全不生效 | `src/config.rs:6862-6872` |
| B2 | `AI_MEMORY_DB=/data/ai-memory.db` | 中 | 路径变 → 建新空库（**记忆全不见了**） | `src/daemon_runtime.rs:88,137` |
| B3 | **`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`**（v0.10.0 是 **surface-scoped**：MCP/CLI 缺省宽松、HTTP direct-write 缺省要求签名；`=1` 是**全局严格**） | 高 | 不设：v0.10.0 的 MCP/CLI 写入**仍然成功**（实测，静默宽松，不报错）；设 `=1` → 无签名写入被拒（`agent attestation failed: … this write is unsigned`）；**v0.11 起缺省翻转为全 surface required ⇒ 不设即被拒** | `src/security_profile.rs:177,42` |
| B4 | **`DASHSCOPE_API_KEY`**（`QWEN_API_KEY` 等价回退） | 高·静默 | 缺失/失效 → embedder 静默降级 keyword + curator fail-open | `src/config.rs:6656,6715` |
| B5 | **`AI_MEMORY_LLM_*` / `AI_MEMORY_EMBED_*` 优先级高于 config** | 高·静默 | `.env` 里误加 → **静默覆盖** config 的模型配置（文件看起来对，实际生效的是 env） | `src/config.rs:4443-4462,7721-7799` |
| B6 | `AI_MEMORY_EMBED_BACKFILL_BATCH`（我方用 config） | 低 | 越界 WARN 回落 100 | `src/config.rs:4462` |
| B7 | `AI_MEMORY_PROFILE`（`--profile` 的 env 回退，未设 → `core`） | 中 | 设了会改变暴露的工具集（8 / 101），可能超客户端上限 | `src/daemon_runtime.rs:194` |
| B8 | **`AI_MEMORY_NO_CONFIG` 绝不能设** | 中 | 设了 → config 被完全跳过，tier/llm/embedding 全退默认（静默） | `src/config.rs:6868-6872` |
| B9 | `AI_MEMORY_REQUIRE_API_KEY`（本方案不设，无公网 HTTP） | 中 | 未来开放 HTTP 必须与顶层 `api_key` 同时补 | `src/daemon_runtime.rs:4209-4266` |
| B10 | `RUST_LOG` | 低 | 仅影响可观测性 | `src/logging.rs:3343` |

### C. CLI 子命令与参数

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| C1 | `serve` 有 `--host/--port` 但**无 `--tier`**（档位只认 config 顶层 `tier`） | 高·静默 | 若上游给 `serve` 加 `--tier`，或改 tier 来源 → config 的 `tier="smart"` 静默失效 | `src/daemon_runtime.rs:781-888,163-172` |
| C2 | `mcp --tier smart`（写死在 forced command 与客户端配置） | 高 | flag 改名 → MCP 通路断（响亮）；取值集合变 → 可能静默跑别的档 | `:174-196` |
| C3 | `curator --daemon --interval-secs 3600 --max-ops 50` | 高 | flag 改名 → curator 起不来（响亮）；`--max-ops`（默认 100）/ 钳位 `[60,86400]` 语义变 → 成本与周期不符预期 | `src/cli/curator.rs:24-105` |
| C4 | `doctor` | 低 | 移除则冒烟失据（响亮） | `:653-695` |
| C5 | `backup --to <dir> --keep 48` | 高 | 参数改名 → 备份脚本断；`--keep` 语义变 → 静默堆积或静默删多 | `src/cli/backup.rs:23-33` |
| C6 | `restore --from <dir>`（**in-place**，见 I5） | 高 | 参数改名 → 恢复演练脚本断 | `src/cli/backup.rs:35-44` |
| C7 | `stats`（端到端验收：计数增长） | 低 | 移除则改看 `doctor` | `:222` |
| C8 | `reembed`（换 embedding 模型后回填向量） | 中 | 移除则无法换模型而不丢检索 | `src/cli/commands/reembed.rs:58-80` |
| C9 | `config migrate --dry-run`（schema 变更预检） | 中 | 移除则升级预检少一道闸 | `:241`；`src/cli/commands/config.rs:44-70` |
| C10 | `DEFAULT_PORT=9077` / `DEFAULT_DB="ai-memory.db"` | 低 | 我方全部显式指定，不受影响 | `:88-89` |

### D. `config.toml` 字段

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| D1 | **顶层 `tier="smart"`**，`serve` 档位只认此字段 | 高·静默 | 改名/语义变 → 静默退默认 `semantic`（无 LLM 整理，库越积越碎） | `src/config.rs:2694,7493-7495` |
| D2 | `schema_version=2`（≥2 sectioned；`None`/`1` legacy flat 并存 WARN） | 中 | 落到 legacy 路径 → 属性静默不被识别 | `:3020,6974-6986` |
| D3 | `db="/data/ai-memory.db"` | 中 | 同 B2 | `:2696` |
| D4 | `[llm] backend="qwen"`（别名 `dashscope`） | 中 | 别名表变 → 启动失败（响亮） | `:3315-3367` |
| D5 | `[llm].api_key_env` / `api_key_file`（**内联 `api_key` 解析期被拒**） | 中 | 若放开内联 → 诱使 key 入文件（**secrets 入仓风险**） | 同上 |
| D6 | **`[llm.auto_tag]` 只写 `model`，省略 `backend` 时逐字段继承 `[llm]`** | 高·静默 | 继承规则变、或照抄官方样例 `backend="ollama"` → auto_tag / 查询扩展 / 矛盾检测**静默全挂**，smart 档形同虚设 | `resolve_llm_auto_tag :7810-7872` |
| D7 | **`[embeddings]` 显式 `backend` + `model` + `dim`** | 高·静默 | 不设 `dim` 且模型不在表内 → 回落 preset 768 → 写入失败/检索异常且**不报错** | `:3433-3484,7992-7995` |
| D8 | `[embeddings].backfill_batch=100` | 低 | 越界 WARN 回落 | `:3480-3483` |
| D9 | 顶层 `api_key`（本方案**不设**） | 中 | 未来开放 HTTP 必补，且认证头是 `X-API-Key` | `:2792-2793` |
| D10 | 解析优先级 **CLI > env > config > 编译默认** | 高·静默 | 误以为 config 优先 → 排查查错文件（同 B5） | `docs/CLI_REFERENCE.md:52-53` |
| D11 | `[llm].base_url` / `[embeddings].base_url`（后者同义 `url`，`base_url` 优先）—— 别名只给默认公网端点，私有 MaaS **必须显式覆盖** | 高·响亮 | 不覆盖 → workspace key 在公网端点鉴权失败（好在不静默） | `:3315-3334`；`:3433-3484`；qwen 默认端点 `:6500` |

### E. tier 机制

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| E1 | `smart` preset 默认 embedder 是 **Ollama Nomic 768** —— 必须用 `[embeddings]` 覆盖 | 高 | 不覆盖 → 无 Ollama 机器上**静默降级 keyword** | `:250-256`；模型枚举 `:19`；维度 `:46-47` |
| E2 | 四档 preset 差异（embedding/LLM/cross-encoder/`max_memory_mb` 0/256/1024/4096） | 中 | `smart` 的 1024MB 上限是选型依据之一 | `:234-265` |
| E3 | `serve` **不接受 `--tier`** | 高 | 同 C1 | `:163-172` |

### F. Embedding 维度

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| F1 | `KNOWN_EMBEDDING_DIMS` **不含任何 DashScope 模型**（只有 nomic/MiniLM/BGE/mxbai/OpenAI/Gemini/granite/snowflake） | 高·静默 | 若上游移除某条目而我们依赖推断 → 维度错（显式 `dim` 为准，风险可控） | `:6572-6639` |
| F2 | 未命中表且未设 `dim` → 回落 preset 编译期维度（smart=768） | 高·静默 | 与实际维度不符 → 写入失败或检索异常**且不报错** | `:7985-7995` |
| F3 | 显式 `dim` 覆盖优先；**非正值被忽略**（模板里 `dim=0` 只是占位符，绝不能原样上线）。实测 `qwen3.7-text-embedding` = **1024** | 高 | 填 0/负数 → 静默回落 768 | `:7992-7994` |

### G. 路径与缓存

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| G1 | 配置路径由 `$HOME` 推导 → `/data/.config/ai-memory/config.toml` | 高·静默 | 同 B1 | `:2684-2685,6862-6865` |
| G2 | HF 缓存走默认（`$HF_HOME` 或 `~/.cache/huggingface/hub`）；因 `HOME=/data` 已在持久卷 | 中 | 改缓存路径 → recreate 静默重下（首次检索卡顿） | `src/embeddings.rs:967-1013` |

### H. 传输与 HTTP 面

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| H1 | **MCP 传输只有 stdio**（stdout 被 JSON-RPC 独占，日志走 stderr） | 高 | 若日志改写到 stdout → stdio 帧被污染，客户端静默失败 | `src/mcp/mod.rs:3301,3329-3348` |
| H2 | **`/mcp` 与 `/sse` 不存在**（路由全集 `/api/v1/*` + `/metrics`） | 高 | 若新增 → 「只能 stdio-over-SSH」决议可重评（机会） | `src/handlers/routes.rs:14-95`；`server.json:16-18` |
| H3 | `/api/v1/health` 免认证（冒烟依赖） | 中 | 改为需认证 → 冒烟脚本失败（响亮） | `src/handlers/transport.rs:779` |
| H4 | 认证头是 **`X-API-Key`**（不是 `Authorization: Bearer`），兼容已弃用 `?api_key=` | 中 | 未来按 Bearer 配 → 认证失败（响亮） | `src/lib.rs:224`；`:765-877` |
| H5 | **上游不含任何管理界面**（无 Web UI/控制台/TUI/OpenAPI 页）；观测出口只有 `/metrics` 与 `doctor` | 高 | 若加入 Web UI → 新增一个需评估的服务面，「无公网入口 / 不需域名 NPM api_key」三条决议前提被打破 | 2026-09-20 核实：`routes.rs` 无非 `/api/v1` 路由；无 `rust-embed`/`ratatui`/`utoipa` |

### I. 备份 / 恢复 CLI 契约

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| I1 | 快照名 `ai-memory-<ts>.db`（`%Y-%m-%dT%H%M%SZ`）+ manifest `ai-memory-<ts>.manifest.json` | 高 | 命名变 → 找快照/上传/回读断裂（严格匹配则响亮，通配则**静默**传错） | `src/cli/backup.rs:21,70-72,110` |
| I2 | manifest **含 `sha256`**（另有 snapshot/bytes/source_db/version/created_at） | 高 | 字段消失 → 完备性校验失去依据，静默退化为「只看文件存在」 | `:46-54,87-100` |
| I3 | 同名快照**拒绝覆盖** | 中 | 改静默覆盖 → 可能丢上一份快照 | `:73-78` |
| I4 | `--keep` 默认 **48**，按 mtime **newest-first** 保留，超出连同 manifest 删；`0` 关闭轮换 | 高 | 语义变 → 静默堆积或静默删掉想要的快照 | `:29-32,114-160` |
| I5 | 注意：**`restore` 是 in-place**：校验 manifest sha256（`--skip-verify` 可跳）→ 当前库 rename 为 `pre-restore-<ts>.db` 作安全网 → 快照 copy 到 `db_path` | 高 | 与「恢复永不 in-place」的直觉相反；若流程假设落在 staging → **实际直接覆盖生产库**。本清单最反直觉的一条 | `:35-44,171-258` |
| I6 | 迁移前自动快照 `<dbfile>.pre-migration-v<from>-to-v<to>-<nanos>.bak`（同目录，仅 `version>0` 时生成） | 高 | 命名变 → 回滚脚本找不到快照（通配会静默取错） | `src/storage/migrations.rs:868,915-947,1502-1529` |

### J. schema 与迁移语义

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| J1 | `CURRENT_SCHEMA_VERSION`：v0.10.0 = **80**（clone `main` = **81**）；文档滞后写 78 | 中 | 仅作「是否发生前向迁移」的信号；**文档不可用于版本判断** | `src/storage/migrations.rs:859` |
| J2 | 迁移**前向-only**，v34 / v50 / v54 三个阶梯臂**不可逆** | 高 | 不可逆迁移后无法靠改回旧二进制降级 | `:1502-1519` |
| J3 | 注意：**旧二进制启动于「比自身更新的库」时不会报错**（`migrate()` 在 `version >= CURRENT` 直接 `return Ok(())`；全 `src` 无「库过新则拒绝」逻辑） | 高·静默 | **回滚只改 `IMAGE_TAG` 是危险的**：旧二进制照常启动并操作不认识的 schema → **静默数据损坏**。⇒ **回滚必须用 pre-migration 快照覆盖 DB** | `:1507-1509`；全 src grep 无命中（2026-09-20 核实） |
| J4 | **FTS5 全文索引用默认分词器 `unicode61`**：建表 `USING fts5(title, content, tags, content=memories, content_rowid=rowid)` **未指定 `tokenize=`** —— 不做 CJK 分词、不做简繁归一；查询串经 `sanitize_fts_query`（按空白切分、剥除全部 FTS5 特殊字符即**无通配**、逐词元短语化、隐式 AND）；`[mcp]` 段无任何语言 / 分词 / 检索配置键 | 高·静默 | 若上游改用 CJK 分词器 / 简繁归一 / 增加相关配置 → 「中文关键词只能整段命中、简繁不互通」的边界变化，依赖此行为的断言与文档口径**静默漂移** | 建表语句 `src/storage/mod.rs`（`memories_fts`，触发器同步入库）；`sanitize_fts_query` `src/storage/mod.rs:7030`；行为探针 [`../../scripts/i18n-probe.sh`](../../scripts/i18n-probe.sh)（`I18N_PROBE_STRICT=1` 把边界当断言，2026-09-21 实测全绿） |

### K. 凭证与授权面

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| K1 | HTTP `api_key` 是**单一共享密钥**，不是多用户体系 | 中 | 换 key = 所有客户端同时重配；**无法按用户吊销** | `src/config.rs:2793` |
| K2 | macaroon 能力令牌 `[capabilities]`：v0.9.0 引入，**v0.10.0 默认 `false`**（GA 姿态 = 恒等函数）；`main`（v1.0.0 方向）编译默认已改 `true` 并新增零配置 `owner` issuer | 高 | 升级 v1.0.0 需重评「无令牌调用者行为不变」（上游称 additive-only） | v0.10.0 `:5884-5905`；main `src/governance/capability.rs:102` |
| K3 | CLI 签发链路（v0.10.0 已有）：`capability keygen/mint/attenuate/inspect/verify`；caveat **只能收窄**（AND）：`--namespace-prefix`/`--op-ceiling`/`--action`/`--agent`/`--expires-*`/`--not-before`。注意：**v0.10.0 没有 `capability init`**（v1.0.0 特性）—— 照搬运维文档会失败 | 高 | flag 改名 → 「无 UI 签发 key」的 runbook 断裂（响亮） | `src/cli/capability.rs:117-171` |
| K4 | `issuers` 是**封闭白名单**，无隐式 issuer；每项需 `<id>.caproot`（0600）+ `<id>.pub`；`max_op` **必填**，解析失败即跳过该 issuer（fail-closed） | 高 | 以为可省 `max_op` → 令牌校验全失败（运行时才暴露） | `:5898-5912` |
| K5 | **Ed25519 身份是「出处证明」不是授权**：`agent_id` 是自述值，**不得单独作授权闸门** | 高 | 当权限依据 → 任何人自称任意 id → **静默越权** | `docs/ADMIN_GUIDE.md:996-1010` |
| K6 | 密钥目录解析 `--key-dir` > `AI_MEMORY_KEY_DIR` > `$HOME/.config/ai-memory/keys`；私钥 0600。因 `HOME=/data`，密钥随持久卷留存（收益） | 中 | 改到卷外 → 丢失导致既有令牌全部不可验证 | `src/cli/capability.rs`；`src/identity/keypair.rs:170` |

> 上游共约 90 个 `AI_MEMORY_*`（常量 SSOT `src/config.rs:4230-4470`）。本清单只登记**我方实际依赖**的点 —— 这正是「最小耦合」的含义。

### L. 容量与配额（`[limits]`，2026-09-21 本地实测）

> 我方**只依赖其中 4 类强制行为**（写入量 / 存储字节 / 链接 / 向量容量）；另 2 键是 **HTTP 面专属**（stdio MCP 不经过），1 键是触顶策略开关。行为证据：[`../../scripts/limits-probe.sh`](../../scripts/limits-probe.sh)。

| # | 依赖什么 | 敏感度 | 错了会怎样 | 上游位置 |
|---|---|---|---|---|
| L1 | 优先级阶梯 **env > `[limits]` > 编译默认**，且任意层**非正值视为未设**并继续回落 | 中 | 误以为写 `0` 能「禁用」某配额 —— 实际回落到编译默认（仅 `max_inflight_requests` 的 `0` 是「不装配准入层」的特殊语义） | `src/config.rs:8420-8477` |
| L2 | 配额按 **`(agent_id, namespace)` 逐行盖章**，行在首次写入时固化**当次进程**的默认值；事后改配置**不追溯**已有行。另：**MCP `memory_store` 的默认 namespace 是 `global`**，而 `quota-status` 对**不存在的** `(agent, namespace)` **会现场建行**并按当前 env / 默认值盖章 | 高·静默 | ① 调大 `[limits]` 后老身份仍被旧阈值拒 → 误判「配置没生效」；② 用错 namespace 查配额 → 读到的是**新建行的默认值**（看似「注入没生效」），实际写入落在别的命名空间；③ 查询若与写入**带着同一注入 env**，会变成**自证式**断言（查询自己把值写进新行） | `src/quotas.rs`（`ensure_row` / `check_quota`）；2026-09-21 实测（探针已修正为「去掉 env + `--namespace global`」） |
| L3 | **CLI 一次性写入不计费** —— 只有 daemon 面（MCP `memory_store` / `memory_link` 与 HTTP 写路径）调用 `check_and_record` | 高 | 用 `ai-memory store` 验证配额 → 永远「通过」，得出配额失效的错误结论 | `src/mcp/tools/store/*`；上游自带测试即以 `QUOTA_EXCEEDED` 断言 |
| L4 | 向量容量环境变量前缀是 **`AI_MEMORY_VECTOR_INDEX_*`**，**不是** `AI_MEMORY_MAX_*`；布尔只认 `1`/`0`/`true`/`false`（大小写不敏感），其余回落 | 中 | 写成 `AI_MEMORY_MAX_VECTOR_INDEX_CAPACITY` → **静默**不生效（回落默认 100000） | `src/config.rs:4252-4258`、`:8466-8477` |
| L5 | 触顶日志 target = **`hnsw.eviction`**，而默认日志过滤器是 `ai_memory=info`，**不覆盖**该 target | 中 | 断言「触顶被拒」时观测不到日志 → 误判为功能失效（须显式放宽 `RUST_LOG`） | `src/hnsw.rs:30`、`src/logging.rs:46`、`src/mcp/mod.rs:3341-3348` |
| L6 | `max_page_size` 与 `max_inflight_requests` **仅 HTTP 面**生效（准入层在 HTTP router 装配，值为 `0` 时该层根本不装配） | 中 | 以为能给 stdio 会话做并发限流 → 该层永不触发 | `src/handlers/*`、HTTP router 装配点 |
| L7 | 触顶行为：`hard_fail_at_cap=false`（默认）**驱逐最旧**，被驱逐记忆退化为关键词检索；`true` 则拒绝新插入但**不阻止 DB 落库**（`insert` 返回 `void`） | 高 | 收紧 `capacity` 会**不可逆驱逐**真实条目 ⇒ 容量类探针必须用一次性库 | `src/hnsw.rs:872-881`、`:925-939` |

> **无必要 ADR**：本条结论是「按上游既有契约使用配置」，未引入我方架构选择；模板取值固定为编译默认亦属既有策略（`--profile core` 同源）的延续。

---

## 10. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | **specs 整合**：`multiuser_isolation.md` 全文（结论/冻结/D–V/能力边界/四档/配方/五坑/验收）+ `mcp_tool_inventory.md`（档位与工具清单、计数核对）+ 旧 `mcp-test.md` §0 传输形态核实 + `upstream_coupling_surface.md` 全量契约点，并入本文档；上游文档缺陷 6 条移入 [`../architecture.md`](../architecture.md) §4.2 |
| 2026-09-20 | 订正：档位工具数统一写**实际注册数**（core=8 / graph=20 / admin=22 / power=57 / full=101），族计数另列；`minimal` 档位为笔误，正确是 `full`；`memory_capabilities` 已加 always-on 注；`capability init` 标注为 v1.0.0 特性；schema 版本并写 80（制品层）/81（参考层） |
| 2026-09-21 | **§0.1 冻结机制「属主」行补前置**：2026-09-21 起门户路径由门户以 `aimem` 身份自建 `0700` 用户目录，**前置**为 `/data/users` = `root:aimem 2775`（setgid 一次性引导，[`../deployment.md`](../deployment.md) §4.4）；`docker exec -u 0 … mkdir/chown` 形式仅保留给 root 手工操作。背景：门户启动机制定稿 β′（[`../adr/ADR-012`](../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md)），证据 [`../knowledge/web-portal/portal-launch-mechanism.md`](../knowledge/web-portal/portal-launch-mechanism.md) E3 |
| 2026-09-21 | **多语言能力边界落盘（Sprint 2 #8）**：§2 新增「记忆内容多语言」行（部分支持——存储 / 语义通路不限语言；关键词通路按 FTS5 `unicode61` 完整词元匹配、简繁不互通、无配置项）；§9 新增契约点 **J4**（分词器行为 + `sanitize_fts_query` + 探针方式），供上游升级预检核对。依据：探针 [`../../scripts/i18n-probe.sh`](../../scripts/i18n-probe.sh)（L1.6，三语言 × 三通路矩阵 + STRICT 边界断言）+ 源码复核；用例登记 [`./mcp-test.md`](./mcp-test.md) §4-E |
| 2026-09-21 | **档位定档收口（Sprint 2 #9）**：§8.1 补**实测**引文（探针 [`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh)：`core=8` / `graph=20` / `admin=22` / `power=57` / `full=101` / `core,lifecycle=14` / 默认档 `=8`，`--profile` 与 `--tier` 并存有效）；§8.3 由「待决策」改为「档位决议与开放问题」——#1 已定（对外 `core`、管理员 `full`，模板落盘归 Sprint 3 #2）、#2 已定（两条用户通道统一 `core`）、#3 验收方式落到 profile-probe、新增 #4（core 不含删除 = 已知限制，开放删除的最小增量是 `core,lifecycle`） |
| 2026-09-21 | **模板定档落盘 + 用户版能力文档（Sprint 2 #9 收尾）**：① §5.1（管理员自用场景）→ `--profile admin`、§5.2（用户场景）→ `--profile core`，并补「改档须重连」注；② §8.3 #1 管理员入口由 `full`（101）改定 `admin`（22）（Meta / Archive 族不随 admin 开放），并标注**模板已落盘**（SSH 主人行 + 用户行 [`../deployment.md`](../deployment.md) §4.3 · 门户 `launch.argv` [`../web-portal/web-design.md`](../web-portal/web-design.md) §3.3 · 本地客户端条目 [`./mcp-test.md`](./mcp-test.md) §3），#3 的 TC-TIER-01/02 标为已完成；③ §8 顶部登记面向最终用户的通俗版 [`./mcp-capabilities.md`](./mcp-capabilities.md)（门户接入指引页唯一内容源） |
| 2026-09-21 | **§8 引文同步（能力文档体例定稿）**：面向最终用户的 [`./mcp-capabilities.md`](./mcp-capabilities.md) 体例定为「6 张档位表 + 每张只列本档新增 + 编号全档连续 1–101 + 示例列」；§8 顶部引文随之更新（不再提「一个完整例子」，补编号口径）。同步：`../web-portal/web-stories.md` AC6.4 与 `../change-log.md` 同日小节 |
