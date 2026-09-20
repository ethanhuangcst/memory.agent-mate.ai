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

## Links

- 契约点逐条清单（含敏感度与检测方法）：`hk_vps_4/specs/upstream_coupling_surface.md`
- 版本坐标唯一真相源：`hk_vps_4/upstream.lock`
- 升级策略（含准入判据规格）：`hk_vps_4/specs/dev-plan.md` §5
- 决议真相源：`hk_vps_4/specs/deployment_strategy.md` §6/§7/§9
- 相关 ADR：`adr/ADR-004-version-contract-single-source-of-truth.md`、`adr/ADR-005-upgrade-admission-gate-layering.md`
