# multiuser_isolation — 多用户隔离方案

> **用途**：回答「多个用户如何各自拥有自己的 memory」，以及在 **stdio-over-SSH** 架构下如何落地。
> **状态**：v1.0 · as_of 2026-09-20 · 上游基准 = 部署所钉 `v0.10.0`（版本坐标见 [`../upstream.lock`](../upstream.lock)）
> **关联**：[`deployment_strategy.md`](./deployment_strategy.md)（决议真相源）· [`dev-plan.md`](./dev-plan.md) · [`upstream_coupling_surface.md`](./upstream_coupling_surface.md) §K（凭证授权面）· [`sprint_plan.md`](./sprint_plan.md)

**一句话结论**：多用户**不需要换传输、也不需要多开 SSH 账号** —— 一个 SSH 账号 + N 把密钥 + N 条 forced command 记录即可；而**读写双向可信的隔离要靠「一用户一数据库」**（同一容器内），不是靠 namespace 或能力令牌。

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

- [ ] 每用户 `ai-memory --db <own> stats` 只看到自己的计数
- [ ] 用户 A 写入后，用户 B 检索**命中不到**（且不报错）
- [ ] 用户 B 显式 `memory_get <A 的记忆 id>` → **不可见**（应返回不可见/未找到）
- [ ] `docker exec <c> ls -l /data/users/<u>/ai-memory.db` 存在且属主 `aimem`
- [ ] cron 维护对每个库都执行成功（日志无错）
- [ ] 备份脚本对全部库产出快照 + manifest（sha256 校验通过）
- [ ] 吊销：删除该用户 `authorized_keys` 行后，其 SSH 立即失败

---

## 8. 未纳入 / 开放问题

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | **写路径泄露探针**：写路径去重/合成是否会把他人私有内容回显给写入者 | ☐ **待实测**（目前只有源码证据，无结论） |
| 2 | **admin portal（签发/管理密钥的 Web 界面）** | ☐ **待裁决** —— 与本仓「薄部署资产 + 低耦合」定位的关系见沟通记录；结论倾向：**本仓不承载**，如需则另建项目（同 mcp.oss-bak.com 的决策模式） |
| 3 | `encrypt_at_rest` 与备份外迁的组合（密钥托管、恢复路径） | ☐ 待评估 |
| 4 | 上游 v1.0.0 的 `[capabilities]` 默认翻转 与 `capability init` | ☐ 升级预检项（见 `upstream_coupling_surface.md` K2/K3） |

---

## 9. 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-20 | 初版：上游能力边界（含 11 条依据）、四档方案、单账号 N 密钥的澄清、配方、五个坑、验收标准 |
