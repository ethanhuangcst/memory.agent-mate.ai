---
title: 上游 ai-memory-mcp 的事实与坑（版本拓扑 / schema / 回滚语义）
type: research-note
status: active
as_of: 2026-09-20
tags:
  - ai-memory
  - upstream
  - versioning
  - rollback
  - ghcr
related_spec: hk_vps_4/specs/deployment_strategy.md
related:
  - hk_vps_4/specs/upstream_coupling_surface.md
  - hk_vps_4/upstream.lock
  - adr/ADR-004-version-contract-single-source-of-truth.md
  - adr/ADR-005-upgrade-admission-gate-layering.md
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
| `memory_search` | **ASCII 子串精确匹配**：ASCII 标记可靠命中；**中文查询一律 count=0**（FTS 分词不吃 CJK），即使该串在 title/content 中连续存在 | 「三层全绿」（content 连续子串）count=0；对照 `l2-client-20260920` count=2 |
| `memory_recall` | 语义/hybrid 检索，中文查询质量高（实测 score 0.887 / 0.893 居首），`mode:hybrid` | 查询词不含标记字面量仍命中 |
| 传输 | 服务端**无** `/mcp`、`/sse` HTTP 端点；`serve` 的 9077 仅绑容器内回环 → 客户端只能走 stdio（`docker exec -i`，**不加 `-t`**） | `mcp-test.md` §0；`-t` 会破坏 stdio 帧 |

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
   可重复探针：`hk_vps_4/scripts/qwen-verify.sh`（决策见 ADR-007）。
9. **MCP 默认档位是 core，工具恰 8 个**：档位不会在输出里自证，唯一可靠判据是 `tools/list` 回包的工具**计数**；
   把「= 8」写死进冒烟脚本，档位一旦漂移就响亮失败（否则只表现为"某个高级工具不见了"的困惑）。
10. **中文检索只能走 `memory_recall`，`memory_search` 只认 ASCII 子串**：写断言时标记一律用 ASCII
    （如 `mcp-smoke-<epoch>`），语义验证用 recall 的中文查询词；两者职责对调会出现「明明存进去了却搜不到」的假故障。
11. **写元数据前先按 `inputSchema` 构造参数**：`source` 等是枚举字段，凭字段名猜值会被响亮拒绝（好）但白耗一轮往返。
12. **批量/重复写入必须容忍 CONFLICT**：near-duplicate 去重让语义相近的写入返回 CONFLICT，
    脚本若不处理，第二次运行就会假失败（正解：改验既有标记，见 `mcp-test.md` §1 原则）。

## Links

- 契约点逐条清单（含敏感度与检测方法）：`hk_vps_4/specs/upstream_coupling_surface.md`
- 版本坐标唯一真相源：`hk_vps_4/upstream.lock`
- 升级策略（含准入判据规格）：`hk_vps_4/specs/dev-plan.md` §5
- 决议真相源：`hk_vps_4/specs/deployment_strategy.md` §6/§7/§9
- MCP 测试策略 / 计划 / 用例（L0–L3 分层、客户端接入配置、工具行为原则）：`hk_vps_4/specs/mcp-test.md`
- 相关 ADR：`adr/ADR-004-version-contract-single-source-of-truth.md`、`adr/ADR-005-upgrade-admission-gate-layering.md`、`adr/ADR-008-local-baseline-reuses-production-compose.md`
