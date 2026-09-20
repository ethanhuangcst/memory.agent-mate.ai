# mcp-test — MCP 测试策略 · 测试计划 · 测试用例（Spec）

> **定位**：本文件是 MCP 相关测试的**测试策略 + 测试计划 + 测试用例**的唯一 spec。所有 MCP 层验收探针（本地基线、档位核对、隔离探针、生产冒烟、客户端接入）在此登记与演进；与 [`../sprint_plan.md`](../sprint_plan.md)（执行状态）、[`../deployment.md`](../deployment.md)（部署动作）、[`./mcp-design.md`](./mcp-design.md)（隔离与能力设计）互链不重复。
> **状态**：v1.1（迁入 `specs/mcp/`） · as_of 2026-09-20

---

## §0 传输形态核实（2026-09-20，源码级）

**结论：生产调用方式是 stdio-over-SSH，不是 `http url + API key`。**

| # | 事实 | 证据 |
|---|---|---|
| 1 | 上游**未实现** `/mcp`、`/sse` HTTP 端点；正式路由仅 `/api/v1/*` + `/metrics` | `src/handlers/routes.rs:14-95`；`server.json` 只声明 `"type":"stdio"` |
| 2 | `stdout` 被 JSON-RPC 独占，日志走 stderr | `src/mcp/mod.rs:3301,3329-3348` |
| 3 | `serve` 的 9077 仅绑容器内回环、无 api_key、不对外；MCP 客户端不消费它 | [`../deployment.md`](../deployment.md) §3 |
| 4 | **当前生产调用**：`ssh ai-memory`（forced command `docker exec -i ai-memory-mcp ai-memory mcp --tier smart`） | 同上 §4.3 |
| 5 | 若**未来**开放 HTTP 入口：届时才需域名 / NPM / TLS，且 config 顶层必须设 `api_key` + `AI_MEMORY_REQUIRE_API_KEY=1`；本 spec 届时增补「远程接入用例」（§4-C） | 契约面 H2/H4 |

---

## §1 测试策略

分层递进，每层通过才进下一层：

| 层 | 名称 | 手段 | 防的失败模式 |
|---|---|---|---|
| L0 | 前置健康 | `docker exec ai-memory-mcp ai-memory doctor`（LLM/Embeddings 双 200、1024-dim、tier 生效）+ curator `--once --dry-run --json` | 三个**静默失败点**：embedder 降级 keyword / curator `tagged=0` / config 挂载错位退 semantic |
| L1 | 协议冒烟 | [`../../scripts/mcp-smoke.sh`](../../scripts/mcp-smoke.sh)（stdio JSON-RPC：握手 / 工具断言 / 写入 / 召回） | MCP 协议通路本身（initialize → tools/list → tools/call） |
| L1.5 | 隔离探针 | [`../../scripts/iso-probe.sh`](../../scripts/iso-probe.sh)（A/B/C 组，P1a–P6） | **R1**：会话漏设 `AI_MEMORY_DB` → 静默落共享主库（[`./mcp-design.md`](./mcp-design.md) §0） |
| L2 | 客户端接入 | Cursor 加载（§3 配置），人肉核对工具清单与一次问答 | 真实客户端环境差异（env / 传输 / 重连） |
| L3 | 生产通道 | 同 L1 模式，传输换成 `ssh ai-memory`（Sprint 5） | SSH forced command / `no-pty` / 密钥边界 |

原则（承自项目探针惯例）：

- **脚本化可重复**：断言进脚本，退出码语义化，不靠人眼看输出。
- **唯一标记**：每次写入带 `mcp-smoke-<epoch>-<pid>`，断言只匹配当次标记，历史数据不干扰。
- **不泄密**：脚本不读 env、不打印容器环境；key 只存在于容器侧。
- **近重复容忍**：上游 near-duplicate 去重会让重复写入返回 CONFLICT —— 改验既有标记（通路验证目的一致）。
- **检索工具分工**：`memory_search` 是 ASCII 子串精确匹配 —— FTS 分词对 CJK 查询**不命中**（实测：中文子串「三层全绿」count=0，ASCII 标记同库 count=2）；**中文/语义查询必须走 `memory_recall`**。
- **capabilities 优先，但认准口径**：`memory_capabilities`（core 档亦常驻）返回家族清单 / 装载状态 / features / models / 工具总数，是档位与能力核对的**首选探针**。注意其 `summary`「7 of 100」是**族计数口径**；实际 `tools/list` 注册数 core=**8**，源码 `registry::ALL`=**101**。**一切断言以 `tools/list` 实测为准**。
- **档位只能启动时定**：客户端 harness（Cursor）回报 `deferred_registration: false` → `memory_load_family` **不会**把新家族注册进 harness；要用 core 之外的家族，必须在客户端 args 里写 `--profile <family>`（`--tier` 是搜索档，二者独立）。

---

## §2 测试计划（阶段映射）

| 阶段 | 内容 | 状态 |
|---|---|---|
| Sprint 2 #4 | 本地基线：local-up 常驻 + L0 + L1（证据：8 工具断言、`mode:hybrid` 语义召回命中） | ✅ 2026-09-20 |
| L2 客户端接入（即时） | Cursor 加载 `ai-memory-local`（8 工具 + 2 prompts）+ agent 直调（§4-B2） | ✅ 2026-09-20 |
| Sprint 2 #5 | L1.5 隔离探针：本地预实证 A/B/C 三组全绿（P1a 静默证据 → D1/D2 的存在理由） | ✅ 2026-09-20 |
| Sprint 3 #2 | 档位核对（TC-TIER）：**双探针** `memory_capabilities` + `tools/list` 计数（core=8 / graph=20 / admin=22 / power=57 / full=101） | 待做 |
| Sprint 3 #6 | 隔离负向验收（TC-ISO）：落地 D1/D2 后重跑 V1，断言**必须失败** | 待做 |
| Sprint 3 #7 | 每库维护（TC-GC）：`gc` / `curator --once` 对每用户库的覆盖面对账 | 待做 |
| Sprint 3 #8 | 写路径泄露探针（TC-LEAK）：去重/合成是否回显他人私有内容 | 待做 |
| Sprint 4 | 门户 / 公网入口若引入：先回到 §0 #5 增补远程接入用例（TC-HTTP） | 待做 |
| Sprint 5 | 服务器冒烟 L3（ssh 通道跑同构 jsonl）+ 生产 doctor 三静默失败点；备份（TC-BAK）/ 恢复（TC-REV）/ 吊销（TC-SSH-03） | 待做 |
| 回归触发 | 每次改动 config / 镜像 tag / 档位 / forced command 后重跑 L0 + L1 + L1.5 | 持续 |

---

## §3 客户端接入配置（Cursor）

### 本地基线（容器常驻后）

`~/.cursor/mcp.json` 的 `mcpServers` 内追加（**放全局，不放项目级** `.cursor/mcp.json` —— 后者会入库）：

```json
"ai-memory-local": {
  "type": "stdio",
  "command": "docker",
  "args": ["exec", "-i", "ai-memory-mcp", "ai-memory", "mcp", "--tier", "smart"]
}
```

- **只加 `-i`，绝不加 `-t`**：pty 会破坏 stdio 帧（与生产 forced command `no-pty` 同因）。
- **无需 `env` 字段**：`docker exec` 继承容器环境，qwen key 不进 Cursor 配置、不进仓。
- 前置：`bash memory.agent-mate.ai/scripts/local-up.sh` 已常驻；容器重启后在 Cursor MCP 面板 reconnect。
- 生效核对：Settings → MCP 出现 `ai-memory-local` 且可见 8 个 `memory_*` 工具。
- **改档位**：在 `args` 里加 `--profile <family>`（如 `--profile core,graph`）；改完**必须重启该 MCP 条目 / reconnect**（harness 不支持延迟注册）。

### 生产（Sprint 5 上线后，与本地条目并存）

```json
"ai-memory": { "command": "ssh", "args": ["ai-memory"] }
```

`~/.ssh/config` 与 forced command 见 [`../deployment.md`](../deployment.md) §4.3 / §6.1；`agent_id` 无法在 `mcp.json` 配置（由服务端 forced command 钉死）。

---

## §4 测试用例

### A. 现役：协议冒烟 `mcp-smoke.sh`（L1，本地基线）

| ID | 用例 | 断言 | 退出码 |
|---|---|---|---|
| TC-ENV-01 | 前置：容器 `ai-memory-mcp` 常驻运行 | `docker ps` 可见 | 10 |
| TC-HS-01 | initialize 握手（protocolVersion 2024-11-05） | 回包 `serverInfo.name == "ai-memory"` | 20 |
| TC-HS-02 | tools/list 工具清单 | **恰 8 个**（core 7 + always-on `memory_capabilities`），含 store/search/recall/capabilities | 20 |
| TC-W-01 | `memory_store` 写入含唯一标记的自然语句 | 成功；CONFLICT 时改验既有标记可提取 | 30 |
| TC-R-01 | **新进程** `memory_recall`，查询词描述主题但**不含标记字面量** | 结果含生效标记 → 语义检索工作（embedder 未降级） | 40 |
| TC-R-02 | **新进程** `memory_search`，用标记字面量查询 | 命中 → 跨进程持久化 + 检索通路 | 40 |

> TC-W/R 分两个 `docker exec` 进程 = 同时证明「协议通路」与「卷持久化」。全通过退出码 0。

### B. 现役：doctor 三静默失败点（L0）

| ID | 用例 | 断言 |
|---|---|---|
| TC-DOC-01 | `ai-memory doctor` | LLM Reachability 200；Embeddings Reachability 200 且 dim=1024；tier=smart |
| TC-DOC-02 | `ai-memory curator --once --dry-run --json` | `tagged > 0` |

> 镜像内无 curl/wget → **不用**容器内 HTTP 探测；就绪判据用 serve 日志 `ai-memory listening on` + `doctor`（[`../deployment.md`](../deployment.md) §7.1）。

### B2. 现役：L2 客户端接入（Cursor `ai-memory-local`）

| ID | 用例 | 断言 |
|---|---|---|
| TC-L2-01 | Cursor MCP 面板加载 `ai-memory-local` | 8 个 `memory_*` 工具 + 2 prompts，无启动报错 |
| TC-L2-02 | agent 直调 `memory_store`，content 含唯一标记 `l2-client-<date>` | 返回 id；**负例**：非法枚举参数（如 `source`）被服务端拒绝并列出合法值，无静默吞错 |
| TC-L2-03 | `memory_recall`，查询词描述主题但**不含标记字面量** | 新记忆以最高分命中（语义通路，embedder 未降级） |
| TC-L2-04 | `memory_search`，用标记字面量查询 | 恰命中该 id（count=1） |

> 首次执行（2026-09-20）：全通过。标记 `l2-client-20260920` → id `55d04c8c-1910-4d04-a8b7-5c41dced492d`；recall `mode:hybrid` score 0.887 居首；search count=1；`source:"codebuddy"` 被拒后改 `user` 成功。
> 第二次执行（同日，**另一客户端交叉验证**）：另一 Cursor agent（`ai:cursor-vscode@974b303dab0e`，同一容器）向 `places-workspace` 写入 3 条 long-tier 记忆 —— 其中一条首轮因 `source:"conversation"` 被拒（TC-L2-02 负例**独立再现**），修正为 `user` 后 3/3 落库；随后由本客户端按语义召回交叉命中（score 0.899 / 0.781）。⇒ **跨客户端写入 + 跨客户端召回**可作为 L2 加强判据。注意：被拒与成功轮次并存时客户端叙述可能只报结果，核验一律以 `memory_list` / `memory_get` 为准。

### C. 隔离与档位（L1.5 / Sprint 3）

| ID | 用例 | 断言 | 阶段 |
|---|---|---|---|
| TC-ISO-01 | **负向**：会话不设 `AI_MEMORY_DB` | 落地 D1/D2 后**必须失败**（当前基线：rc=0 静默落 `/data/ai-memory.db`） | Sprint 3 #6 |
| TC-ISO-02 | 正向：alice 会话 `doctor --json` | `source == /data/users/alice/ai-memory.db` | Sprint 3 #6 |
| TC-ISO-03 | 交叉：alice 写入后 bob 检索 | 双向未命中；bob `memory_get <alice id>` → `memory not found` | Sprint 3 #6 |
| TC-ISO-04 | 维护通路：各库 `--db stats` | 计数独立（alice=1 / bob=1 / 主库=7） | Sprint 3 #6 |
| TC-GC-01 | 每库 `gc` / `curator --once` | 日志无错，且 TTL 遗忘与 WAL checkpoint 已覆盖（**覆盖面待验**） | Sprint 3 #7 |
| TC-LEAK-01 | 写路径泄露：方案②下 A 写入后检查是否回显 B 的私有内容 | 期望**无**跨库回显；方案③物理分离本应无路径 | Sprint 3 #8 |
| TC-TIER-01 | `initialize` + `tools/list` 计核，逐档核对 | core=8 / graph=20 / admin=22 / power=57 / full=101 | Sprint 3 #2 |
| TC-TIER-02 | `memory_capabilities` 家族与装载状态 | 与 `tools/list` 一致（族计数口径差异已注明） | Sprint 3 #2 |

> 现役探针：[`../../scripts/iso-probe.sh`](../../scripts/iso-probe.sh)（退出码 0 全通过 / 10 前置 / 20 解析链 / 30 隔离 / 40 维护 / 50 方案②会话），组 A=P1a/P1b/P4，组 B=P2/P3/P5，组 C=P6。可重复性已验证：第二次起必然命中 near-duplicate 去重，探针**分会话**处理（写入会话先取「生效标记」再另开会话检索），故重复运行稳定。

### D. 生产通道与运维（Sprint 4–5 占位）

| ID | 用例 | 断言 | 阶段 |
|---|---|---|---|
| TC-SSH-01 | `ssh ai-memory` 跑 §4-A 同构 jsonl 会话 | 与 L1 结果一致（握手 + 8 工具 + 写入 + 跨进程召回） | Sprint 5 |
| TC-SSH-02 | `no-pty` / 误加 `-t` 负例 | 加 `-t` 时 stdio 帧损坏 → 客户端报错（证明 `no-pty` 必要） | Sprint 5 |
| TC-SSH-03 | 吊销：删除该用户 `authorized_keys` 行 | 该密钥 SSH **立即失败** | Sprint 5 #5 |
| TC-BAK-01 | 备份脚本遍历全部库产出快照 + manifest | `sha256sum` 与 manifest 一致；外迁后回读比对通过 | Sprint 5 #3/#7 |
| TC-REV-01 | 恢复演练（在**临时库**上） | 恢复后原库被 rename 为 `pre-restore-*`（in-place 行为，契约面 I5） | Sprint 5 |
| TC-LIMIT-01 | 配额 `agent_quotas` 生效 | 超限时被拒，不写爆盘 | Sprint 5 |
| TC-I18N-01 | 多语言检索（`--tier` / locale 相关，若有） | CJK 走 `memory_recall` 命中；`memory_search` 中文子串不命中属**预期** | 待定 |
| TC-ATT-01 | `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0` 生效 | 写入返回 `attest_level=claimed`，非 403 | Sprint 5 |
| TC-HTTP-01 | （仅当开放 HTTP 入口）url + api_key 接入；未带 key → 401；`X-API-Key` 头生效 | §0 #5 前置配置已落地 | Sprint 4 或 §0 #5 落地时 |

---

## §5 版本记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | 初版：定位声明；传输形态核实（stdio-over-SSH，源码级证据）；固化 mcp-smoke.sh 6 用例与 doctor 2 用例；登记本地/生产 Cursor 接入配置 |
| 2026-09-20 | 增补 §4-B2 L2 客户端用例（TC-L2-01..04），首次执行全通过；§2 登记 L2 ✅ |
| 2026-09-20 | 增补 §1 原则两条（capabilities 计数口径；档位只能启动时定）与 §3 改档说明；§2 Sprint 3 #2 改双探针；§4-B2 记录第二客户端交叉验证 |
| 2026-09-20 | **specs 整合**：迁入 `specs/mcp/`（原 `specs/mcp-test.md`）；新增 **L1.5 隔离探针层**与 §4-C（TC-ISO / TC-GC / TC-LEAK / TC-TIER）、§4-D（TC-SSH / TC-BAK / TC-REV / TC-LIMIT / TC-I18N / TC-ATT / TC-HTTP）用例位；L0 补「镜像无 curl，改用 serve 日志 + doctor」 |
