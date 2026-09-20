# ADR-004: 上游版本契约采用「单一真相源锁文件 + 镜像标签/指纹双写」

## Status

Accepted

> 编号说明：本仓 `hk_vps_4/specs/adr/` 首次建立。编号从 **004** 起，接续 `hk_vps_4/specs/vps4_new_deployment_instruction.md`
> 中已引用的 ADR-002（IMAGE_TAG）/ ADR-003（NPM Save + healthz），避免同一项目生态出现两个 ADR-002。

## Context

`memory.agent-mate.ai` 是**薄部署资产仓**：不构建镜像，只消费上游 `alphaonedev/ai-memory-mcp`
发布的官方镜像。2026-09-20 复核时发现三个具体问题：

1. **版本坐标散落**：上游 release tag / 镜像 tag / 参考 clone commit 共约 30 处、分布在 9 个文件里。
   改一次要改 30 处，漏一处即自相矛盾 —— **已实际发生**：`deployment_strategy.md` 写「当前稳定镜像 0.9.0」，
   而上游早在 2026-07-12 就发布了 0.10.0 并把它打成 GHCR `latest`。
2. **上游有过历史重写**：`main` 的 HEAD 与已发布 release tag 的**提交图不连通**
   （`git merge-base` 为空；GitHub API 明确返回 `No common ancestor between v0.10.0 and main.`；
   两侧根提交消息/日期相同但哈希不同）。后果：`git diff <tag> main` 之类的版本差异手段全部失效；
   文档若引用开发 commit（`blob/96b8c694/…`），上游下次重写历史后链接会**彻底失效**。
3. **镜像 tag 可被重推**：Docker tag 只是一个可变的名字。上游既然有重写历史的前科，
   同名 tag 被重新指向不同内容是完全可能的，而 `docker pull` **不会报错**。

## Decision

1. **版本契约的唯一真相源 = `hk_vps_4/upstream.lock`**（KEY=VALUE，可被 `bash`/`python3` stdlib/`make` 零依赖读取）。
   承载：上游 repo / release tag / tag 对象 / release commit / 发布时间 / 镜像 repo 与 tag /
   **镜像 manifest 与 amd64 digest** / 指纹可信度 / schema 版本基线 / 沉淀期阈值 / 参考 clone 线与 commit / 校验日期。
   其他文档与脚本一律**引用**它，不再各自抄写版本号。
2. **镜像固定粒度 = 标签 + 指纹双写**：`.env` / compose 仍写人可读的 `0.10.0`，锁文件记录 digest。
   升级预检比对「同 tag 的 digest 是否变化」——变了即判定「标签被重推」，交人工审阅。
3. **文档引用上游一律用 release tag URL**（`blob/v0.10.0/...`），不用 `main`（内容漂移）、
   不用开发 commit（会被重写而失效）。
4. **升级预检禁止依赖 git 谱系**：版本差异只用 GitHub releases API + CHANGELOG 原文 + 镜像指纹三条证据链。
5. `make pin` 由 `git describe` 改为**读取锁文件**（`git describe` 在 main 上因无 tag 可达只会回落成 commit 短哈希）。

## Rationale

- **为什么不用「仅 tag」**：无法察觉标签被重推 —— 静默换掉运行中的软件是本项目最不能接受的失败模式。
- **为什么不用「仅 digest」**：`sha256:7e19…` 无法让人判断是哪个版本，每次升级都要手工抄写，易错。
- **为什么用 KEY=VALUE 而非 TOML/JSON/YAML**：本机 `python3` 为 3.9（**无 `tomllib`**），YAML 需引入解析器；
  KEY=VALUE 让 Bash `source`、Python 逐行解析、Makefile 直接读，**零外部依赖**（不依赖 `jq`）。
- **为什么锁文件放 `hk_vps_4/` 而非仓根**：遵守资产隔离判据 —— 自有资产集中在 `hk_vps_4/`，
  根目录只保留基础设施（`.gitignore` / `Makefile`）与平台强制位置（`.github/workflows/`）。
- **为什么切到 release tag URL 是零风险**：实测 4 份被引用的上游文档在 `v0.9.0` 与 `v0.10.0` 之间**逐字节未变**；
  唯一差异是 `CONFIG_SCHEMA.md` 在 release 与 main 之间的一处 Postgres `pgvector` 版本号（本部署用 SQLite，无影响）。

## Consequences

- ✅ 改版本 = 改一处（`make pin-update` 回写），消灭自相矛盾。
- ✅ 可由 `make preflight` 自动检出「标签被重推」与「契约面差异」。
- ✅ 文档引用不再因上游重写历史而断链。
- ⚠️ 多一个文件与一层间接：读者需知道「版本号在锁文件里」；已在各文档显式点名。
- ⚠️ digest 必须真实校验过才可信：初值来自 GHCR 包页面抓取时标记 `unverified`；
  已用 `make preflight ARGS=--with-image` 直连 registry v2 校验并改为 `registry-api`。
- ⚠️ digest 校验依赖 `ghcr.io` 可达：本机曾一度不可达，故脚本设计为**不可达即 SKIP 不阻断**。
- 🔁 后续：若上游发布流程改为不可变 tag（或提供 digest 承诺），可简化为仅 digest。

## Date

2026-09-20
