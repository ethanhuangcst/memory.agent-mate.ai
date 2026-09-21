# ADR-009: 多用户隔离采用「一用户一数据库 + 服务端钉死身份」，排除单库 per-agent 方案

## Status

Accepted

## Context

Sprint 2 #5 的验收要求给出「多用户隔离是否可实现」的明确结论（`specs/mcp/mcp-design.md` §0）。结论是**有条件可实现**，但结论成立需要一个前提：隔离的**形态**必须先定死，且不能是"看起来可以、写路径不可信"的那种。

三个事实压在一起：

1. **上游没有租户模型**。多租户读取隔离存在（按行 `scope=private` + 属主过滤），但**可见性调用者只认 `AI_MEMORY_AGENT_ID` 环境变量**（`src/identity/mod.rs:333-345`，不接受工具参数）；而**写路径完全没有可见性过滤**（`store` / `atomise` / `promote` 命中 0）。
2. **写路径的 `agent_id` 是自述值**。已在本地基线实测（`iso-probe.sh` P6，v0.10.0）：会话身份为 `human:iso-bob` 的调用者，用 `memory_store(agent_id="human:iso-alice")` **写入成功**且响应回显 alice 身份；随后 alice 在自己的私有视图里**检索到了这条被注入的内容**。同一库内读隔离（bob 读不到 alice 的 private 行）确实成立 —— 即**读能强制、写不可信**。
3. **库路径解析存在优先级陷阱（R1）**。`AppConfig::effective_db()` 只在「CLI/env 的库路径**恰为默认值** `ai-memory.db`」时才改用 config 的 `db`（`src/config.rs:7506-7516`；默认值 `src/daemon_runtime.rs:88`），且 `daemon_runtime.rs:980` 是全子命令唯一解析点。实测：**漏设 `AI_MEMORY_DB` 时 `doctor --json` 的 `source` 仍为 `/data/ai-memory.db` 且 rc=0、无任何告警**（静默落共享主库）；作为对照，错设到**打不开**的路径才是 fail-loud（`overall=critical`、rc=2）。

即：如果隔离形态选错（单库 + per-agent），那么"隔离"只剩读方向，写方向由任意调用者自由伪造；而即使形态选对（一用户一库），一次模板笔误仍会静默把所有用户合并到主库。

## Decision

1. **隔离单位 = 一用户一数据库**：`/data/users/<handle>/ai-memory.db`，同目录下 `keys/` 作为该用户的 `AI_MEMORY_KEY_DIR`；目录属主必须是容器内进程用户 `aimem:aimem`（创建口径 `docker exec -u 0 … mkdir -p … && chown -R aimem:aimem …`）。
2. **身份与库路径由服务端钉死**：会话三件套 `AI_MEMORY_DB` / `AI_MEMORY_AGENT_ID=human:<handle>` / `AI_MEMORY_KEY_DIR` 全部写在**服务端**（SSH `authorized_keys` 的 forced command，或门户 spawn 的 env），客户端参数不参与身份与库解析。
3. **排除方案②（单库 + 每用户 `AI_MEMORY_AGENT_ID`）**：其写路径无授权边界（见 Context 2），不得用于多用户；仅可用于**互信**小团队或单人多设备场景。
4. **不新增 OS 账号**：单 OS 账号 + N 把密钥 + N 行 forced command；记忆身份与库都不依赖登录账号（容器内恒为 `aimem`）。
5. **上线硬前提 D1 + D2**：spawn 前 fail-closed 断言（`AI_MEMORY_DB` 非空 + 以 `/data/users/` 开头 + 含该 handle）+ **移除 `config.toml` 的 `db` 键**（该键是"漏设 → 静默落主库"的唯一落点，移除后漏设退化为相对路径 → fail-loud）。D3（一会话一子进程、禁池化）/ D4（审计含解析出的库路径）/ D5（负向验收不过则阻断上线）为配套。
6. **探针常设**：`memory.agent-mate.ai/scripts/iso-probe.sh` 作为该决策的常设回归证据（A 负向解析链 / B 方案③双用户隔离 / C 方案②对照；语义化退出码；可重复运行，含 near-duplicate CONFLICT 幂等分支）。本决策的每一条都可以被它重跑证伪。

## Rationale

- **物理分离消除整类风险**：一用户一库时不存在跨库查询路径，所以"写路径无 caller 过滤"这一上游缺陷在多用户场景下**不可达**；而方案②把这条路径完整保留下来，且没有任何上游开关能补。
- **为什么不换传输、不加账号**：隔离强度不来自传输层，也不来自 OS 账号（容器内固定 `aimem`）；加 OS 账号只增加 docker 组成员数（≈ root 等价）与吊销遗漏面，零隔离增益。
- **为什么 D2 是"唯一覆盖漏设分支"的手段**：漏设时 sqlite 能正常打开目标库，任何运行期检查都不会报错；只有让"默认值 → config"这条路**在配置层不存在**，错误才会前移到路径解析（相对路径 → 失败），从而可被断言捕获。
- **为什么把"结论"与"形态"一起定死**：结论本身（有条件可实现）若不带形态，下个 Sprint 可能实现成"单库多 agent"并在生产中静默串号；ADR 的作用是把这次的**实测证据**钉在决策上。
- **观测性**：`doctor --json` 的 `source` 字段（`src/cli/doctor.rs:591`）天然给出"这条会话落在哪个库"，无需新增埋点即可用于审计（D4）与解析链自检（V4）。

## Consequences

- **正向**：多用户场景的风险面从"任意跨库伪造"收缩到"配置与运维错误"；后者由 D1/D2 显式阻断，并可被 V1（负向）在生产前验收。
- **成本**：每用户库需要各自的周期维护（`--db <path> gc` / `curator --once`）与**逐一备份**（外迁前缀 `tenants/<handle>/`）；`gc` 是否覆盖每库的 TTL 遗忘与 WAL checkpoint 仍属未核实项（Sprint 3 #5「每用户库维护行为定档」）。
- **对门户的约束**：必须"一会话一子进程、禁止跨用户复用/池化"（D3），且 key 的创建/轮换/吊销要同步管理库目录与 `authorized_keys` 行。
- **仍未关闭的上游风险**：`AI_MEMORY_DB` 若被错设为一个**有效但错误**的他库路径（非空、非 `/data/users/`），sqlite 不会报错 —— 只能靠 D1 的路径断言拦住（归 Sprint 4 #7「门户 ↔ MCP 会话桥」）。
- **待定**：`<handle>` 命名规范（大小写/长度/是否等于邮箱别名）与 sudoers 无通配符 argv 匹配的实测（`specs/mcp/mcp-design.md` §6.4）。
- **本 ADR 不实施任何防线**：D2 与 D5 本地门禁由 Sprint 3 #2–#3 落地；D1/D3/D4 由 Sprint 4 #7/#4 落地；生产 D5 由 Sprint 5 #8 复验。本 ADR 只固定形态与判据。

## Date

2026-09-20

> 2026-09-20：本文档的**路径与指向**随目录改名（`hk_vps_4/` → `memory.agent-mate.ai/`）及 specs 整合同步；决议文字与理由一字未改。
