# multiuser_isolation — 多用户隔离方案

> **用途**：回答「多个用户如何各自拥有自己的 memory」，以及在 **stdio-over-SSH** 架构下如何落地。
> **状态**：v1.1 · as_of 2026-09-20 · 上游基准 = 部署所钉 `v0.10.0`（版本坐标见 [`../upstream.lock`](../upstream.lock)）
> **关联**：[`deployment_strategy.md`](./deployment_strategy.md)（决议真相源）· [`dev-plan.md`](./dev-plan.md) · [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) §K（凭证授权面）· [`sprint_plan.md`](./sprint_plan.md) · [`adr/ADR-009-per-user-db-isolation-over-single-db-agent-id.md`](./adr/ADR-009-per-user-db-isolation-over-single-db-agent-id.md)（隔离**形态**的决策与排除方案②的实测理由）

**一句话结论**：多用户**不需要换传输、也不需要多开 SSH 账号** —— 一个 SSH 账号 + N 把密钥 + N 条 forced command 记录即可；而**读写双向可信的隔离要靠「一用户一数据库」**（同一容器内），不是靠 namespace 或能力令牌。

---

## 0. 结论（Sprint 2 #5 · 2026-09-20）

> **结论：有条件可实现（conditionally feasible）。**
> 「机制**可行**」已由本地探针实测闭环（[`../scripts/iso-probe.sh`](../scripts/iso-probe.sh)，A/B/C 三组、退出码 0）；
> 「**可信**」则有硬前置条件 —— **D1 + D2**。因为 R1 不再是理论担忧，而是**已实测的行为**。

| 问题 | 答案 | 证据 |
| --- | --- | --- |
| 一用户一 DB 的物理隔离能否成立？ | ✅ **能**（双向检索未命中 / `memory_get` 返回 `memory not found` / 主库记忆计数不变） | 探针 P2 · P3 · P5 |
| 「不设 `AI_MEMORY_DB` 就共用主库」是否只是理论担忧？ | ❌ **不是** —— 已实测：**退出码 0、无任何告警**，`source` 静默落到 `config` 的 db（`/data/ai-memory.db`） | 探针 P1a |
| 方案②（单库 + per-user env）能否替代？ | ❌ **不能** —— 读隔离成立，但**写路径完全可伪造**：bob 以 `agent_id=human:iso-alice` 写入成功（响应回显 alice 身份），alice 随后**检索到了被注入的内容** | 探针 P6 |
| 错设路径是否也静默？ | ⚠️ 视情况：目标库**打不开**时是 fail-loud（`Storage=critical / failed to open database`，rc=2）；但**漏设/指到有效库**时静默 | 探针 P4 · P1a |
| 是否有条件？ | ✅ 有，见 §0.2（D1–D5，其中 **D1+D2 为硬前提**） | 本文件 + `sprint_plan.md`「阻断级风险」 |

### 0.1 冻结机制（2026-09-20 用户确认，按探针实测形态冻结）

| 项 | 冻结值 | 备注 |
| --- | --- | --- |
| 用户库路径 | `/data/users/<handle>/ai-memory.db` | 一用户一库；`<handle>` 即门户/运维侧的用户标识 |
| 用户密钥目录 | `/data/users/<handle>/keys/`（`AI_MEMORY_KEY_DIR`） | 与库同用户目录，避免所有人共用默认 key dir |
| 属主 | `aimem:aimem`（容器内进程用户） | 创建口径：`docker exec -u 0 ai-memory-mcp sh -c 'mkdir -p /data/users/<handle>/keys && chown -R aimem:aimem /data/users/<handle>'` |
| 会话 env 三件套 | `AI_MEMORY_DB` / `AI_MEMORY_AGENT_ID=human:<handle>` / `AI_MEMORY_KEY_DIR` | 全部钉在**服务端** forced command 里，客户端改不了 |
| 接入方式 | 单 OS 账号 + N 密钥，`authorized_keys` 每用户一行 forced command（模板见 §5.2） | 不新增 OS 账号 |
| 每库维护（显式） | `ai-memory --db /data/users/<handle>/ai-memory.db stats \| gc \| curator --once` | `stats` 通路已实测（P5）；gc/TTL 覆盖范围见 §0.4 #2 |
| 探针残留数据 | `iso-alice` / `iso-bob` / `iso-shared` 三库保留供复查 | 清理：`docker exec -u 0 ai-memory-mcp rm -rf /data/users/iso-*` |

### 0.2 条件矩阵（D1–D5：结论成立的依赖）

| # | 防线 | 为什么是「条件」（探针给出的理由） | 状态 |
| --- | --- | --- | --- |
| **D1** | fail-closed 断言：spawn 前断言 `AI_MEMORY_DB` 非空 + 以 `/data/users/` 开头 + 含该 `handle` | P1a 证明漏设时**无任何信号**（rc=0 → 共享主库）；没有这条断言，一次模板笔误即静默串号 | ☐ 未落地（Sprint 3 #5） |
| **D2** | 移除 `config.toml.tmpl` 的 `db` 键 | 该键是 R1 的**唯一落点**（实测生效 config 中 `db = "/data/ai-memory.db"` 存在）；移除后「默认值 → config」这条路无路可走，漏设退化为相对路径 → **fail-loud** | ☐ 未落地（Sprint 3 #5） |
| **D3** | 一会话一子进程、禁止跨用户复用/池化 | 单库方案的写路径无 caller 边界（P6 实证），会话复用即把边界交还给门户 | ☐ 未落地（Sprint 3 #5 / Sprint 4 #7） |
| **D4** | 会话审计含**解析出的库路径** | 事后可对账；`doctor --json` 的 `source`（P3 实测）即现成的解析结果来源 | ☐ 未落地（Sprint 3 #5 / Sprint 4 #4） |
| **D5** | 上线前负向验收（不过则阻断） | 本 Sprint 只给了**本地预实证**；生产级（真实 forced command / 真实模板）验证仍须走 | ☐ 未通过（Sprint 3 #6） |

> **注意 D1/D2 的性质**：它们不提升隔离**上限**（上限已由物理分离给定），只保证**下限**——即「配置错一次不会静默串号」。这是"可实现"与"可信"的分界。

### 0.3 验证项映射（V1–V4：本地预实证 → 生产级）

| # | 验证 | 本地是否已预实证 | 本次证据 | 生产级待办 |
| --- | --- | --- | --- | --- |
| **V1** | 负向：漏设 `AI_MEMORY_DB` 必须失败 | ⚠️ **预实证了「当前会静默成功」**（即 D1/D2 未落地时的基线状态 = rc 0 + 落主库） | 探针 P1a | 落地 D1/D2 后重跑，断言**必须失败**（Sprint 3 #6） |
| **V2** | 正向：目标库 mtime 变化且共享主库不变 | ✅ 本地版通过（用户库写入后独立计数 1/1，主库 7→7、mtime/size 未变） | 探针 P2 · P5 | 生产卷上复验（Sprint 3 #6） |
| **V3** | 交叉：A 写后 B 检索不到、B `get <A 的 id>` 不可见 | ✅ 本地版通过（双向 `memory_search` 未命中；`memory_get` → `memory not found`） | 探针 P2 | 生产强迫命令路径复验（Sprint 3 #6） |
| **V4** | 解析链自检：与模板完全相同的 env/argv 跑 `doctor --json`，`source` == 该用户库 | ✅ 本地版通过（`source=/data/users/iso-alice/ai-memory.db`） | 探针 P3 | 用**生产模板实际生成**的 env 再验（Sprint 3 #6） |

### 0.4 未决前提（结论成立**不依赖**、但上线前必须关闭）

| # | 前提 | 影响面 | 归属 |
| --- | --- | --- | --- |
| 1 | **写路径泄露探针**：去重/合成是否把他人私有内容回显给写入者 | 只影响**方案②**；方案③为物理分离，**无跨库路径**（P6 也未观察到回显） | Sprint 3 #8 |
| 2 | **`gc` 是否覆盖每库的 TTL 遗忘 + WAL checkpoint** | 决定 §5.3 的维护命令是否够用（`stats` 已证可用，`gc`/`curator` 未验） | Sprint 3 #7 |
| 3 | `AI_MEMORY_DB` **指向有效但错误的**他库路径（非空、非 `/data/users/`） | 唯一能拦住它的是 D1 的路径断言（不能靠 sqlite 打开失败） | Sprint 3 #5 |
| 4 | sudoers 无通配符 argv 匹配行为（§5.5 替代 docker 组） | 加固项，不影响结论 | Sprint 5 前 |
| 5 | 门户尚未存在（D1/D3/D4 的最终载体） | 决定防线**由谁执行**（门户 or SSH 模板） | Sprint 3 #5 / Sprint 4 |
| 6 | `<handle>` 命名规范（大小写/长度/是否等于邮箱别名） | 影响目录名与 `AI_MEMORY_AGENT_ID` 形态 | 门户设计（Sprint 2 #6 / Sprint 4） |

### 0.5 探针证据（可重复运行）

```bash
bash hk_vps_4/scripts/iso-probe.sh     # 退出码：0 全通过 / 10 前置 / 20 解析链 / 30 隔离 / 40 维护 / 50 方案②会话
```

| 组 | 探针 | 实测结论（2026-09-20 · 本地基线容器 v0.10.0） |
| --- | --- | --- |
| A | P1a 漏设 `AI_MEMORY_DB` | rc=0；`source=/data/ai-memory.db`（= 共享主库，**静默**） |
| A | P1b 显式 `AI_MEMORY_DB` | `source=/data/users/iso-alice/ai-memory.db`（env 为权威输入） |
| A | P4 错设（父目录不存在） | `Storage=critical / failed to open database`，`overall=critical`，**rc=2（fail-loud）** |
| B | P2 双用户隔离 | alice↔bob 双向检索未命中；`get` → `memory not found`；库属主 `aimem:aimem`；主库计数 7→7 |
| B | P3 解析链自检 | `source` == 用户库路径（V4 本地版） |
| B | P5 每库维护通路 | `--db` 下 alice=1 / bob=1 / 主库=7（各自独立，互不污染） |
| C | P6 方案②对照 | 写可伪造=**是**（bob 以 alice 身份写入成功并回显 `human:iso-alice`）；读隔离=**成立**；注入对 alice **可见** |

> A 组结论 = **D2 的存在理由**；C 组结论 = **为什么必须是③而不是②**（写路径没有授权边界，单库方案下"隔离"只剩读方向）。
>
> **可重复性已验证**：第二次及以后运行必然命中 near-duplicate 去重（写入返回 `CONFLICT`、本次标记并未落库），探针据此**分会话**处理——写入会话先取"生效标记"（CONFLICT 时引用既有标记），再用该标记另开会话检索，故重复运行结果稳定（实测连续运行全绿）。这也是任何"写入 + 立刻检索"型探针的通用注意点。

---

## 1. 问题

- 场景 A：同一个人在 4 个客户端（cursor@mac1、cursor@mac2、codebuddy@mac2、cursor@mac3）—— 要**共享同一份记忆**。
- 场景 B：10 个用户 —— 每人要**自己的记忆**，互不可见。

两者在 ai-memory 里的**配置恰好相反**，所以必须先分清。

---

## 2. 上游能力边界（逐条有依据）

| 能力 | 结论 | 依据 |
| --- | --- | --- |
| 账号 / 租户模型 | ❌ **不存在**（无 user / tenant / account / invite 概念） | 源码核实；上游多处用词为 "single-tenant deployment" |
| 多租户读取隔离 | ✅ **存在且覆盖面广** —— 按行 `scope=private` + 属主过滤 | `crate::visibility::is_visible_to_caller` 应用于 `session_start`/`list`/`recall`/`search`/`get`/`kg_query`/`kg_timeline`/`link`/`load_family`/`lineage`/`replay`/`find_paths` + 全部 HTTP handler + 联邦 sync |
| 可见性调用者来源 | ⭐ **只认 `AI_MEMORY_AGENT_ID` 环境变量**（`resolve_read_visibility_caller`，**不接受工具参数**）；未设 = trust-all | `src/identity/mod.rs:333-345`；`docs/ADMIN_GUIDE.md:1045-1070` |
| 上游官方要求 | *"Operators running a **multi-tenant MCP host** therefore **MUST set `AI_MEMORY_AGENT_ID` per tenant** to get private-row isolation on reads"* | `docs/ADMIN_GUIDE.md:1069` |
| 写路径可见性过滤 | ❌ **完全没有**（`store` / `atomise` / `promote` 命中 0） | 源码 grep（2026-09-20） |
| `namespace` | ⚠️ 是**分类**，**不是授权边界**（HTTP 传输层无 namespace 授权） | 源码；用途是配额 / curator 范围 / caveat 粒度 |
| macaroon 能力令牌 `[capabilities]` | ⚠️ **只放宽、不收紧**（纯 `Deny`→`Allow` 的 grant wrapper，additive-only）；v0.10.0 默认还关着 | `src/governance/capability.rs` 模块文档；`src/config.rs:5884-5905` |
| 顶层 `api_key` | ⚠️ **单一共享密钥**，无多用户、无法按用户吊销 | `src/config.rs:2793` |
| 默认 `scope` | ⚠️ 写入**默认即 `private`**（省略 scope = private） | `src/mcp/tools/list.rs:251-252` |
| 静态加密原语 | ✅ `AI_MEMORY_ENCRYPT_AT_REST=1` / `encrypt_at_rest = true` → 内容按 **agent 的 X25519 ECDH + ChaCha20-Poly1305** 加密，「只有该 agent_id 的私钥能解」（per-node at-rest，非跨联邦端到端） | `src/encryption/mod.rs:1-20` |
| 按 agent 配额 | ✅ `agent_quotas` / `ai-memory quota-status`（per-agent + per-namespace，三面齐全） | `src/cli/commands/quota_status.rs` |

---

## 3. 四档方案

| 档 | 机制 | 读写隔离 | 运维成本 | 适用 |
| --- | --- | --- | --- | --- |
| **①** 单库 trust-all | **不设** `AI_MEMORY_AGENT_ID` | 读：全开（有意）<br>写：不设防 | **最低** | **单人多设备共享**（场景 A） |
| **②** 单库 + 每用户 env | 每用户 `-e AI_MEMORY_AGENT_ID=human:<u>` | 读：✅ 强制<br>写：❌ 可伪造 | 低（一份库/维护/备份） | 互信小团队 |
| **③** 一用户一 DB ⭐ | 每用户 `-e AI_MEMORY_DB=/data/users/<u>/ai-memory.db` | 读：✅ **物理**<br>写：✅ **物理** | 中（每库需各自维护 + 备份） | **多用户（场景 B）默认选它** |
| **④** 一用户一容器 | 独立 stack | ✅ 物理 + 独立故障域 / tier / 版本 / 配额 | 高（N× compose/config/env） | 需要独立故障域或差异化规格时 |

> **为什么 ③ 而不是 ②**：② 的读隔离虽然能强制，但**写路径无过滤**（`agent_id` 是自述值，MCP 工具参数优先级高于 env）→ 任意用户可把他人的名字写在行上。③ 让这条路径**物理上不存在**（没有跨库查询）。

---

## 4. 关键澄清：**不需要多开 SSH 账号**

| # | 事实 | 含义 |
| --- | --- | --- |
| 1 | `authorized_keys` 是**逐行**生效的，`command="…"` 是**每条密钥**的属性 | 同一 OS 账号可挂 **N 把密钥**，每条各自独立 forced command |
| 2 | `docker exec`（不带 `-u`）以**镜像的 `USER aimem`** 运行（`Dockerfile:56`；compose **无** `user:` 覆盖） | **登录用的 OS 账号根本不进入记忆层** —— 容器里永远是 `aimem` 在跑 |
| 3 | 记忆身份 100% 来自 forced command 里钉的 `-e` | OS 账号是"谁"**对隔离没有任何影响** |

**⇒ N 个用户 = 1 个 OS 账号（`aimem-ssh`）+ N 把密钥 + N 条 `authorized_keys` 记录。**

| 维度 | 单账号 + N 密钥（推荐） | N 个 OS 账号 |
| --- | --- | --- |
| 隔离强度 | 同等 | 同等 —— **零增益** |
| 每用户成本 | 1 把密钥 + 1 行记录 | `useradd` + 组/sudoers + 家目录 + 密钥 |
| 攻击面 | 1 个 docker 组成员 | **N 个 docker 组成员（docker 组 ≈ root 等价）** |
| 吊销 | 删 1 行 | 删账号（易漏家目录/组） |
| sshd 日志区分用户 | ❌ 同一账号（**唯一实质损失**，可用容器侧 `metadata.agent_id` + `authorized_keys` comment 补） | ✅ |

---

## 5. 配方

### 5.1 场景 A：单人多设备共享（方案 ①）

服务器 `authorized_keys`（每台机器一条，**都不带** `-e AI_MEMORY_AGENT_ID`）：

```
command="docker exec -i ai-memory-mcp ai-memory mcp --tier smart",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA…mac1  user@mac1
command="docker exec -i ai-memory-mcp ai-memory mcp --tier smart",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA…mac2  user@mac2
command="docker exec -i ai-memory-mcp ai-memory mcp --tier smart",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA…mac3  user@mac3
```

- **共享**：读是 trust-all → 全部互见 ✅
- **出处仍保留**：写入自动合成 `ai:cursor@mac1` / `ai:cursor@mac2` / `ai:codebuddy@mac2` / `ai:cursor@mac3`（#1720 B1：durable + pid-free；同一台机器上的两个工具靠 `initialize.clientInfo.name` 区分）
- 客户端 `~/.cursor/mcp.json`（三台内容相同）：
  ```json
  { "mcpServers": { "ai-memory": { "command": "ssh", "args": ["ai-memory"] } } }
  ```

### 5.2 场景 B：多用户物理隔离（方案 ③，推荐）

**① 目录准备**（容器进程以 `aimem` 运行，属主必须对上）：

```bash
docker exec -u 0 ai-memory-mcp mkdir -p /data/users/alice
docker exec -u 0 ai-memory-mcp chown -R aimem:aimem /data/users/alice
```

**② `authorized_keys` 每用户一行**（身份与库都钉在服务端）：

```
command="docker exec -i -e AI_MEMORY_DB=/data/users/alice/ai-memory.db -e AI_MEMORY_AGENT_ID=human:alice -e AI_MEMORY_KEY_DIR=/data/users/alice/keys ai-memory-mcp ai-memory mcp --tier smart",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA…alice alice@mac
```

> `AI_MEMORY_KEY_DIR` 单独指向用户目录，避免所有人的身份密钥混在同一个 key dir。

**③ 客户端**：`~/.ssh/config` 用**自己的**密钥；`mcp.json` 只需 `args: ["ai-memory"]`（forced command 覆盖一切，客户端改不了身份与库路径）。

> **冻结口径（2026-09-20 探针实测确认，见 §0.1）**：路径命名、`keys/` 子目录、三个 env、forced command 模板与每库维护命令均按本节形态冻结写入（用户已确认）。
> 目录准备口径已实测：`docker exec -u 0 ai-memory-mcp sh -c 'mkdir -p /data/users/<handle>/keys && chown -R aimem:aimem /data/users/<handle>'`（属主必须 `aimem:aimem`，否则容器进程无写权限）。

### 5.3 必须补的背景维护（每库）

compose 里常驻的 `serve` 与 `curator` **只服务默认库**；每用户库需要等价的周期维护，否则 TTL 遗忘 / 压缩 / GC 不会跑：

```bash
# host cron（示例）
for db in /data/users/*/ai-memory.db; do
  docker exec ai-memory-mcp ai-memory --db "$db" gc
  docker exec ai-memory-mcp ai-memory --db "$db" curator --once --max-ops 50
done
```

> `Gc` = "Run garbage collection"（`src/daemon_runtime.rs:219-220`）；`--db` 是 global flag（`:137`），故 `ai-memory --db <path> <sub>` 合法。
> ⚠️ **待核实**：每用户库的 TTL 遗忘与 WAL checkpoint 是否被 `gc` 全覆盖 —— 上线前用 `ai-memory --help` / 实测确认，不要照抄假定。
> ✅ **已实测（2026-09-20 探针 P5）**：`ai-memory --db <用户库> stats` 通路成立（各库计数独立：alice=1 / bob=1 / 主库=7），即"每库显式维护"的调用形态可用；`gc` / `curator --once` 的行为覆盖面仍属 Sprint 3 #7。

### 5.4 备份与配额

- 备份脚本改为**遍历所有库**：逐库 `ai-memory --db <each> backup --to /data/backups/<user> --keep 48`，外迁 OSS 用 `tenants/<user>/` 前缀（与 mcp.oss-bak.com 设计对齐）。
- 配额：`agent_quotas` 可给每用户/每命名空间设上限，防一人写爆盘（per-DB 时每库独立）。
- 可选加固：`AI_MEMORY_ENCRYPT_AT_REST=1` → 备份快照外迁时**不是明文**，且跨 agent 不可解（运维仍可解，因密钥在容器内）。

### 5.5 sudoers 加固（可选，比 docker 组更安全）

docker 组 ≈ root 等价。可改为**精确 sudoers 规则**（无通配符 → 只能跑这一条 argv）：

```
# /etc/sudoers.d/ai-memory-mcp
aimem-ssh ALL=(root) NOPASSWD: /usr/bin/docker exec -i ai-memory-mcp ai-memory mcp --tier smart
```

- 收益：defense in depth（即使有人误加一条**没有** forced command 的 `authorized_keys` 记录，也拿不到完整 docker 权限）；**规则不随用户数增长**
- 代价：多一个文件；需在服务器实测 sudoers 的无通配符 argv 匹配行为

---

## 6. 五个坑（必读）

| # | 坑 | 症状 | 规避 |
| --- | --- | --- | --- |
| 1 | **默认 `scope=private`** | 四个客户端给**不同** agent_id → 四座孤岛，"存了在另一台读不到" | 场景 A 用方案 ①；或写入显式指定共享 scope |
| 2 | **#1720 operator self-lockout** | 已有数据的库上开启 `AI_MEMORY_AGENT_ID` → 非本属主的私有行**瞬间不可见** | 在空库上启用；或先 `reown`：`ai-memory reown --namespace <ns> --to <caller> [--claim-unowned]`（先 `--dry-run`） |
| 3 | **`--agent-id` ≠ `AI_MEMORY_AGENT_ID`**（**静默失效**） | 用 `--agent-id` 配身份 → 写入标记正常，但读路径 caller = `None` → **trust-all，隔离根本没开** | 一律用**环境变量**（`resolve_read_visibility_caller` 只读 env；源码中无生产代码把 flag 写回 env） |
| 4 | **写路径无可见性过滤** | 方案 ② 下，任意用户可用 `memory_store(agent_id="human:bob")` 往他人私有空间**注入**行 | 用方案 ③（物理隔离）；或仅限互信成员 |
| 5 | **别用自动合成的 id 做隔离** | `host:<hostname>` 随换机而变；`anonymous:pid-<pid>-<uuid8>` **每次进程都变** → 私有行写了再也读不回 | 隔离场景一律**显式指定稳定 id**（`human:alice` 等） |

> 附：坑 4 还与一个**未定风险**相关 —— 写路径内部的去重/合成检索不走可见性过滤，是否会把他人私有内容回显给写入者，**尚未实测**（见 §8）。

---

## 7. 验收标准（方案 ③）

> 标注口径：`[x]` = 本地基线已预实证（`iso-probe.sh`）；`[ ]` = 生产级仍须验证。

- [x] 每用户 `ai-memory --db <own> stats` 只看到自己的计数 ✅ 探针 P5（alice=1 / bob=1 / 主库=7）
- [x] 用户 A 写入后，用户 B 检索**命中不到**（且不报错）✅ 探针 P2（双向）
- [x] 用户 B 显式 `memory_get <A 的记忆 id>` → **不可见**（应返回不可见/未找到）✅ 探针 P2（返回 `memory not found`）
- [x] `docker exec <c> ls -l /data/users/<u>/ai-memory.db` 存在且属主 `aimem` ✅ 探针 P2（`aimem:aimem`）
- [ ] cron 维护对每个库都执行成功（日志无错）—— 生产级（Sprint 3 #7）
- [ ] 备份脚本对全部库产出快照 + manifest（sha256 校验通过）—— 生产级（Sprint 5 #3/#7）
- [ ] 吊销：删除该用户 `authorized_keys` 行后，其 SSH 立即失败 —— 生产级（Sprint 5 #5）

---

## 8. 未纳入 / 开放问题

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | **写路径泄露探针**：写路径去重/合成是否会把他人私有内容回显给写入者 | ☐ **待实测**（Sprint 3 #8）。**部分实证**（2026-09-20 探针 P6）：写路径**无 caller 过滤**已确认——bob 以 `agent_id=human:iso-alice` 写入成功且响应回显 alice 身份；"是否回显他人内容"仍未验。该风险只作用于**方案②**，方案③物理分离无跨库路径 |
| 2 | **admin portal（签发/管理密钥的 Web 界面）** | ☐ **待裁决** —— 与本仓「薄部署资产 + 低耦合」定位的关系见沟通记录；结论倾向：**本仓不承载**，如需则另建项目（同 mcp.oss-bak.com 的决策模式） |
| 3 | `encrypt_at_rest` 与备份外迁的组合（密钥托管、恢复路径） | ☐ 待评估 |
| 4 | 上游 v1.0.0 的 `[capabilities]` 默认翻转 与 `capability init` | ☐ 升级预检项（见 `upstream_coupling_surface.md` K2/K3） |

---

## 9. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-20 | 初版：上游能力边界（含 11 条依据）、四档方案、单账号 N 密钥的澄清、配方、五个坑、验收标准 |
| 2026-09-20 | 本次复核（`sprint_plan.md` 重排为 6 个 Sprint）：§6 五个坑、§7 验收、§8 开放问题的**状态仍准确**，且已分别在 Sprint 3（隔离实施与端到端验证、写路径泄露探针、新增坑 #6）与 Sprint 5（多用户隔离落地）排期，**无编号失配**；§8 #2「本仓不承载 admin portal」的推翻按 Sprint 3 的「同步既有文档 9 处矛盾」处理，本文件暂不改该结论 |
| 2026-09-20 | **v1.1 — Sprint 2 #5 结论落盘（研究 + 探针）**：新增 **§0 结论**（结论=**有条件可实现**；冻结机制 §0.1；D1–D5 条件矩阵 §0.2；V1–V4 映射 §0.3；未决前提 §0.4；探针证据 §0.5）。新增探针脚本 [`../scripts/iso-probe.sh`](../scripts/iso-probe.sh)（A 负向解析链 / B 方案③双用户隔离 / C 方案②对照；语义化退出码，可重复）。关键实测：① 漏设 `AI_MEMORY_DB` → `rc=0` 且静默落 `/data/ai-memory.db`（R1 行为级证实，D2 的存在理由）；② 错设到不可打开的路径 → `Storage=critical`、`rc=2`（fail-loud）；③ 一用户一 DB 双向检索/get 互不可见、主库计数不变；④ `doctor --json` 的 `source` 可作为解析链自证；⑤ 方案②写路径可伪造（跨 agent 注入成功且 alice 可见）。连带：§5.2 追加冻结口径与目录准备命令；§5.3 标注 `--db stats` 已实测；§7 标注 4 项本地预实证 |
