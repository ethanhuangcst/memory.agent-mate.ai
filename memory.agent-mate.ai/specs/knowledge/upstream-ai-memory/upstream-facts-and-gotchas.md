---
title: 上游 ai-memory-mcp 的事实与坑（版本拓扑 / schema / 回滚语义）
type: research-note
status: active
as_of: 2026-09-21
tags:
  - ai-memory
  - upstream
  - versioning
  - rollback
  - ghcr
  - retrieval
  - i18n
related_spec: memory.agent-mate.ai/specs/deployment.md
related:
  - memory.agent-mate.ai/specs/mcp/mcp-design.md
  - memory.agent-mate.ai/upstream.lock
  - adr/ADR-004-version-contract-single-source-of-truth.md
  - adr/ADR-005-upgrade-admission-gate-layering.md
  - adr/ADR-009-per-user-db-isolation-over-single-db-agent-id.md
---

# 上游 ai-memory-mcp 的事实与坑

## Summary

复核上游 `alphaonedev/ai-memory-mcp` 时发现三件**不可从文档读出、只能实测**的事：
① 上游 `main` 与已发布 release tag 的**提交图不连通**（历史被重写）；
② 数据库 schema 在 release 间实际前进（v0.9.0 = 78 → v0.10.0 = 80 → main = 81），而上游文档仍写 78；
③ **旧二进制启动于「比自身更新的库」时不会报错**，导致"只改镜像 tag"的回滚是静默危险操作。
这三条共同决定了本项目的升级与回滚流程。

## Evidence

**版本拓扑（2026-09-20 实测）**

| 事实 | 证据 |
| --- | --- |
| `main` HEAD = `96b8c694…`（2026-09-17） | 本地 `git rev-parse` + GitHub API `commits/main` 一致 |
| 最新 release = `v0.10.0`（2026-07-12T13:02:27Z） | `releases/latest`：`prerelease=false, draft=false` |
| `v0.10.0` tag 对象 `6f41d99b…` → commit `43c4d410…` | `git/ref/tags/v0.10.0` + `commits/v0.10.0` |
| **`main` 与 tag 无共同祖先** | `git merge-base HEAD v0.10.0` 为空（退出码 1）；GitHub API 原文 `No common ancestor between v0.10.0 and main.`（404） |
| 两条线根提交消息/日期相同、哈希不同 | main 根 `467de197` vs release 线根 `20706363`，均 2026-03-30 20:54:24 |
| `git tag --merged HEAD` 为空 | main 上不含任何 tag |

**schema 阶梯**

| 版本 | `CURRENT_SCHEMA_VERSION` |
| --- | --- |
| v0.9.0 | 78 |
| v0.10.0 | 80 |
| main (`96b8c694`) | 81 |

> 上游文档滞后：`docs/CONFIG_SCHEMA.md:172` 与 `docs/evidence.html:209` 仍写 78；`server.json` 的 `version` 字段滞后为 `0.5.2`。

**回滚语义**（本项目最反直觉的一条）

```text
src/storage/migrations.rs:1507
    if version >= CURRENT_SCHEMA_VERSION {
        return Ok(());
    }
```

全 `src` 目录 grep `newer than` / `downgrade` / `refuse.*schema` / `unsupported schema` **无命中**
→ 不存在「库过新则拒绝启动」的保护。

**镜像**

- `ghcr.io/alphaonedev/ai-memory:0.10.0` 存在，且同时是 `latest`。
- 清单 digest `sha256:507d2a50…`，amd64 digest `sha256:7e19ae9d…`（经 registry v2 直连校验，与包页面一致）。
- `release.yml`：`docker` job `if: is_prerelease == 'false'` → **预发布版不产出镜像**（升了也拉不到）。

**MCP 工具行为（2026-09-20 实测，v0.10.0，core 档）**

| 行为 | 实测结论 | 证据 |
| --- | --- | --- |
| 默认档位 | 不写 `--profile` 时是 **core**，工具恰 **8 个**（core 7 + always-on `memory_capabilities`）；不是 full | `tools/list` 回包计数 |
| `memory_store.source` | **枚举字段**：`user / nhi / claude / hook / api / cli / import / consolidation / system / chaos / notify`；传其他值被**明确拒绝**并列出合法值（响亮，不静默） | 传 `codebuddy` → 报错，改 `user` 成功 |
| 近重复写入 | 语义相近的写入返回 **CONFLICT（near-duplicate 去重）**，非 bug | 冒烟二次运行命中；`mcp-smoke.sh` 按「改验既有标记」容忍 |
| `memory_search` | **按完整词元 AND 匹配**（FTS5 默认分词器 `unicode61`，建表未指定 `tokenize=`；`sanitize_fts_query` 剥除全部特殊字符即**无通配**）：ASCII 标记与英文单词可靠命中；中文**词元内子串一律不命中**，唯一可命中的中文形态是「标点/空白界定的整段」；简繁交叉不命中（精确边界见下方多语言专表） | 「三层全绿」（content 连续子串）count=0；对照 `l2-client-20260920` count=2；`i18n-probe.sh` 12 组对照（2026-09-21） |
| `memory_recall` | 语义/hybrid 检索，中文查询质量高（实测 score 0.887 / 0.893 居首），`mode:hybrid` | 查询词不含标记字面量仍命中 |
| 传输 | 服务端**无** `/mcp`、`/sse` HTTP 端点；`serve` 的 9077 仅绑容器内回环 → 客户端只能走 stdio（`docker exec -i`，**不加 `-t`**） | `specs/mcp/mcp-test.md` §0；`-t` 会破坏 stdio 帧 |
| 响应格式 | `memory_search` / `memory_recall` 的 `tools/call` 响应是**纯文本表格**（首行 `count:N` / `count:N\|mode:…\|tokens_used:N`；结果行 = UUID 竖线 + 标题摘要），**不是 JSON**——解析不能假设 JSON；`memory_get` 才返回 JSON | `i18n-probe.sh` 首跑 count=None 假失败后 peek 原文实证（2026-09-21） |
| `memory_capabilities` | core 档亦常驻的能力清单探针（家族/装载状态/features/models/工具总数）；其 `summary` 用**族计数口径**（「7 of 100 … under core」）——实际 `tools/list` 注册数 = **8**，源码 `registry::ALL` = **101**（v0.10.0 与 main 实测同；manifest 自称 100 的上游口径差未定因） | 2026-09-20 真实客户端 manifest + 源码计数 |
| 家族与工具数 | core 7 / lifecycle 6 / graph 12 / governance 8 / power 49 / meta 6 / archive 4 / other 9 = **101**；`full`=101，其余档 +1 always-on（core 实注册 8） | capabilities manifest 与 `specs/mcp/mcp-design.md` §8 一致 |
| harness 延迟注册 | 客户端回报 `your_harness_supports_deferred_registration: false` → `memory_load_family` 对 Cursor **无效**，档位只能在启动参数 `--profile` 定死 | manifest 原文 |
| 功能边界（v0.10.0） | `compaction.enabled=false`（v0.8+ 规划）、`transcripts.enabled=false`、`reranker_active="off"`（无 cross-encoder）、`recall_mode_active="hybrid"`、`embedding_dim=1024` | capabilities manifest |

**多用户隔离（2026-09-20 实测，v0.10.0，本地基线容器；可重复探针 `memory.agent-mate.ai/scripts/iso-probe.sh`）**

| 事实 | 实测结论 | 证据 |
| --- | --- | --- |
| 漏设 `AI_MEMORY_DB`（unset） | **不报错**（rc=0、无告警），库路径静默落到 `config.toml` 的 `db`（本部署 = `/data/ai-memory.db`，即共享主库） | 探针 P1a；`src/config.rs:7506-7516` + `src/daemon_runtime.rs:88/137/980` |
| 显式设 `AI_MEMORY_DB` | 解析结果随 env 改变；`doctor --json` 的 `source` 字段 = 实际解析出的库路径 | 探针 P1b/P3；`src/cli/doctor.rs:117-119/591` |
| 错设到父目录不存在 | `Storage` section `severity=critical`（`failed to open database`）、`overall=critical`、**rc=2**（fail-loud） | 探针 P4 |
| 一用户一 DB | 跨库物理隔离成立：A/B 双向 `memory_search` 未命中、`memory_get` → `memory not found`；各库计数独立（1/1）、主库计数与 mtime 不变 | 探针 P2/P5 |
| 写路径授权边界 | **不存在**：`memory_store` 顶层 `agent_id` 参数可指定他人身份写入**成功**（响应回显该身份），随后该行在原属主检索中可见 | 探针 P6；`src/mcp/tools/store/tests.rs:46/1191` |
| 读路径授权边界 | 存在但**只认 env**（`AI_MEMORY_AGENT_ID`，不接受工具参数）；同库下 B 读不到 A 的 private 行 | 探针 P6；`src/identity/mod.rs:160/333-345` |
| 用户库目录 | 属主必须是容器进程用户 `aimem:aimem`；创建须 `docker exec -u 0 … mkdir` + `chown` | 探针 P0/P2 |
| 每用户库的后台维护 | compose 常驻 serve/curator **只服务默认库**；`ai-memory --db <path> stats` 调用形态可用 | 探针 P5；`specs/mcp/mcp-design.md` §5.3 |

**多语言检索（2026-09-21 实测，v0.10.0，本地基线容器；可重复探针 `memory.agent-mate.ai/scripts/i18n-probe.sh`，`I18N_PROBE_STRICT=1` 把边界当断言）**

结论矩阵（简中 / 繁中 / 英文 × 通路；双通路交叉验证：`docker exec` 探针 + Cursor `ai-memory-local` 客户端直调结论一致）：

| 通路 | 简体中文 | 繁体中文 | 英文 |
| --- | --- | --- | --- |
| 存储（`memory_store`） | 支持 | 支持 | 支持 |
| 关键词·完整词元（`memory_search`） | 支持（须标点/空白界定**整段**） | 支持（同左） | 支持（单词） |
| 关键词·词元内子串 | 不支持 | 不支持 | 不支持（bound 查 boundary 不命中） |
| 关键词·简繁交叉 | 不支持（`unicode61` 不做简繁归一，双向不命中） | 同左 | 不适用 |
| 语义召回（`memory_recall`） | 支持（`mode=hybrid`） | 支持 | 支持 |
| 按 id 直取（`memory_get`） | 支持（语言无关） | 支持 | 支持 |

源码依据：`memories_fts` 建表 `USING fts5(title, content, tags, content=memories, content_rowid=rowid)` **无 `tokenize=`**（写入侧由 AFTER INSERT/UPDATE/DELETE 触发器同步入库，索引入库不受语言限制）；`sanitize_fts_query`（`src/storage/mod.rs:7030`）按空白切分、剥除全部 FTS5 特殊字符、逐词元短语化、隐式 AND；`[mcp]` 配置段仅 `profile` / `allowlist` / `profile_hint_in_errors` —— **无任何语言 / 分词 / 检索配置项**。客户端交叉证据标记 `i18n-cross-20260921`（主库 id `de386c65-…5680`）。用例登记 `specs/mcp/mcp-test.md` §4-E；契约面 `specs/mcp/mcp-design.md` §9 J4。

## Lesson / guidance

1. **不要用 git 谱系判断上游版本差异**。上游会重写历史；`git log <tag>..main` 与 `git diff` 会直接失效。
   可靠的三条证据链是：releases API（版号/时间）+ CHANGELOG 原文 + 镜像 digest。
2. **文档引用上游一律用 release tag URL**。用开发 commit 看似最精确，实则最脆弱 ——
   它锁住的是上游随时可能丢弃的一段历史；而且读者无法从 commit 判断"这是哪版文档"。
   （实测：4 份被引用文档在 v0.9.0 → v0.10.0 之间逐字节未变，切基准零信息损失。）
3. **tag 是可变的，digest 才是内容身份**。固定镜像要 tag + digest 双写：tag 给人看，digest 用来发现"同名 tag 被重推"。
4. **回滚必须恢复快照，不能只换镜像 tag**。上游不拒绝更新的库 → 旧二进制会静默读写不认识的 schema。
   回滚流程强制：停容器 → 用 `*.pre-migration-*.bak` 覆盖 DB（清 `-wal`/`-shm`）→ 再换回旧 `IMAGE_TAG`。
5. **schema 前向迁移只在前向**：v34 / v50 / v54 三个阶梯臂不可逆，唯一退路是 pre-migration 快照。
6. **升级闸门必须"可通过"**：判据里若混入与本部署无关的条件（如上游 npm 发布 job 失败），闸门会永久卡死。
   客观且决定能否运行的条件才做硬性阻断，其余归人工确认（见 ADR-005）。
7. **上游文档缺陷清单**（照抄会踩坑）：`/mcp` 与 `/sse` 端点不存在；`[llm.auto_tag]` 样例写 `backend = "ollama"`；
   qwen（DashScope）embedding 模型不在 `KNOWN_EMBEDDING_DIMS` 表内（`dim` 必须显式设，填 0 会被**静默**忽略并回落 768）；
   `qwen` 别名的默认端点是**公网** dashscope，走私有 MaaS 必须显式覆盖 `[llm].base_url` / `[embeddings].base_url`；
   schema 版本文档滞后。
8. **可用模型与维度只能实测**（2026-09-20 于私有 MaaS 端点）：`/models` 列出 256 个模型；
   `qwen-plus` / `qwen-turbo` / `qwen-flash` 的 chat 均可用，`qwen-turbo` 支持 `response_format=json_object`；
   `qwen3.7-text-embedding` 与 `qwen3.7-text-embedding-flash` 实测都是 **1024 维**。
   可重复探针：`memory.agent-mate.ai/scripts/qwen-verify.sh`（决策见 ADR-007）。
9. **MCP 默认档位是 core，工具恰 8 个**：档位不会在输出里自证，唯一可靠判据是 `tools/list` 回包的工具**计数**；
   把「= 8」写死进冒烟脚本，档位一旦漂移就响亮失败（否则只表现为"某个高级工具不见了"的困惑）。
10. **中文检索只能走 `memory_recall`，`memory_search` 只认完整词元**（2026-09-21 探针实证升级，精确边界见上方多语言专表）：
    FTS5 `unicode61` 分词下，中文唯一可命中的形态是「标点/空白界定的整段」，词元内子串与简繁交叉一律 count=0，
    且**无任何配置项可调**。写断言时标记一律用 ASCII（如 `mcp-smoke-<epoch>`），语义验证用 recall 的中文查询词；
    两者职责对调会出现「明明存进去了却搜不到」的假故障。边界探针：`scripts/i18n-probe.sh`（STRICT 模式断言边界漂移）。
11. **写元数据前先按 `inputSchema` 构造参数**：`source` 等是枚举字段，凭字段名猜值会被响亮拒绝（好）但白耗一轮往返。
12. **批量/重复写入必须容忍 CONFLICT**：near-duplicate 去重让语义相近的写入返回 CONFLICT，
    脚本若不处理，第二次运行就会假失败（正解：改验既有标记，见 `specs/mcp/mcp-test.md` §1 原则）。
13. **档位是启动参数，不是运行时能力**：`--profile`（工具档）与 `--tier`（搜索档）彼此独立；
    且 Cursor 等 harness 不支持动态注册（`your_harness_supports_deferred_registration: false`），
    想用 core 之外的家族只能在客户端 args 里写死 `--profile` 再重连 —— 上线前必须在**客户端侧**确认档位，而不是只看服务端。
14. **多用户隔离的失效形态是「功能正常」**：漏设 `AI_MEMORY_DB` 时进程 rc=0、无告警，所有用户静默共用 `config.toml` 指定的主库
    （上游 `AppConfig::effective_db()` 的优先级陷阱：CLI/env 库路径**恰为默认值**时改用 config 的 `db`）。
    因此多用户部署必须同时做两件事：**移除 config 的 `db` 键**（让"漏设"退化为相对路径 → fail-loud）+ **spawn 前 fail-closed 断言**（路径非空、以 `/data/users/` 开头、含该 handle）。
    只"写对 env"是在赌模板永不出错。
15. **`doctor --json` 的 `source` 是解析链的自证手段**：任何"这条会话到底落在哪个库"的问题，用它对照模板的 env/argv 即可闭环（V4 探针法），比翻日志/看时间戳可靠。
16. **单库 + per-agent env 不构成隔离**：写路径**完全没有** caller 过滤（`agent_id` 是自述值，可被任意调用者指定为他人），
    读路径又只认 env —— 结果是「读能被强制、写完全不可信」。真正的多用户隔离只能靠**一用户一数据库**（物理分离，无跨库路径）。
17. **探针脚本里「写入 + 立刻检索」必须分会话**：near-duplicate CONFLICT 时**本次标记并未落库**，
    同一会话内紧接着检索该标记必然 `count:0`（表现为「明明存了却搜不到」的假失败，且只在第二次运行后暴露）。
    正解：写入会话先取「生效标记」（CONFLICT 响应中引用的既有标记），再用该标记另开会话检索 —— 见 `iso-probe.sh` 的 A1/A2、B1/B2 结构。
    另：`memory_store` 的 CONFLICT 响应同样带 `id` 字段，可直接作为后续 `memory_get` 的目标。

## Links

- 契约点逐条清单（含敏感度与检测方法）：`memory.agent-mate.ai/specs/mcp/mcp-design.md` §9
- 版本坐标唯一真相源：`memory.agent-mate.ai/upstream.lock`
- 升级策略（含准入判据规格）：`memory.agent-mate.ai/specs/deployment.md` §9
- 决议真相源：`memory.agent-mate.ai/specs/architecture.md` §2
- MCP 测试策略 / 计划 / 用例（L0–L3 分层、客户端接入配置、工具行为原则）：`memory.agent-mate.ai/specs/mcp/mcp-test.md`
- 多用户隔离方案与结论（冻结机制 / D1–D5 / V1–V4 / 未决前提）：`memory.agent-mate.ai/specs/mcp/mcp-design.md` §0
- 隔离探针（可重复）：`memory.agent-mate.ai/scripts/iso-probe.sh`（A 负向解析链 / B 方案③双用户隔离 / C 方案②对照）
- 多语言检索边界探针（可重复）：`memory.agent-mate.ai/scripts/i18n-probe.sh`（三语言 × 三通路矩阵 + 简繁交叉 + STRICT 边界断言）
- 相关 ADR：`adr/ADR-004-version-contract-single-source-of-truth.md`、`adr/ADR-005-upgrade-admission-gate-layering.md`、`adr/ADR-008-local-baseline-reuses-production-compose.md`、`adr/ADR-009-per-user-db-isolation-over-single-db-agent-id.md`（多用户隔离形态的决策，含"排除单库 per-agent"的实测理由）
