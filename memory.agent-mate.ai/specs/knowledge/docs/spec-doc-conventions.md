---
title: spec 文档体例与引用治理约定
type: ops-lesson
status: active
as_of: 2026-09-21
tags:
  - docs
  - conventions
  - link-check
related_spec: specs/sprint_plan.md
related:
  - adr/ADR-010-specs-single-source-and-doc-structure.md
  - ../../change-log.md
---

# spec 文档体例与引用治理约定

## Summary

本仓自有 spec 的写作与维护约定，来自 2026-09-21 的两轮实证：对外能力文档的体例重构，以及旧 spec 引用清理。核心三条 —— **对外说明按「增量」组织并给全档连续编号**、**凡涉及实测的描述必须与被引实测逐项对齐**、**删并文档后靠护栏把引用清零，而不是靠人工记忆**。

## Evidence

1. **体例**：`mcp/mcp-capabilities.md` 初版按「族」分 8 组、另附一个端到端例子；改为「6 张档位表、每张只列本档新增、编号全档连续 1–101、示例入表」后，读者才能回答「这一档比上一档多了什么」。
2. **对齐**：手工补录能力说明时曾写入上游**不存在**的工具（`memory_gc_hard` / `memory_demote`）；以探针 `full` 全集做集合比对（编号连续 + 集合相等）才拦住。
3. **转述会静默过时**：被引文档改版后，`change-log.md`、`web-portal/web-stories.md` AC6.4、`mcp/mcp-design.md` §8 三处转述立即失真 —— 引用方的描述不会自动跟着变。
4. **引用治理的坑**：85 处旧引用（`sprint_plan.md` 53 / `product-backlog.md` 32）长期靠 `link-check.allow` 整文件豁免存在；清零后豁免 4 → 2。批量替换有两类典型漏改 —— ① **共享前缀省略**（`dev-plan.md` §3.2 八步落地 **+ §3.3 冒烟**：后半段章节号没有文档名前缀）；② **多对一合并**（`deploy/deployment-plan.md` 与 `dev-plan.md` 都归 `deployment.md` ⇒ 产生重复列举）。
5. **历史叙述不等于引用**：变更记录里的旧文件名是当时事实，只降级为纯文本（去链接、留名字），不改指新文档。

## Lesson / guidance

- 对外说明（用户可读）：**按档位 / 分组分表，每张只列本组新增**；**编号跨表连续**（1–N，一档一段），任何一处增删都能被一眼定位。
- 说明中的每条工具 / 能力都要有**可复跑的实测来源**（探针 + 退出码），并保留**集合比对断言**（文档登记项 == 实测全集）；只靠手工整理必然漂移。
- 被引文档改体例时，把「grep 引用方的转述句（分组数 / 例子数 / 章节号）」列为变更的一部分。
- 删并文档后：先全量 grep 旧文件名，再逐处核对**目标章节是否真实存在**；锚点没把握就退化为文档级链接（章节号留在正文文字里）。
- 批量改写后必须**全文复核 + 结构比对**：行数、表格 `|` 计数，以及「同一事实是否出现第二处口径」。
- 护栏的**整文件豁免只是过渡态**：每次收口检查能否缩小，债务清空后立即删除豁免行（否则护栏对该文件永久失效）。

## Links

- [`ADR-010`](../../adr/ADR-010-specs-single-source-and-doc-structure.md)：specs 单一真源与 8 份结构、链接纪律、允许清单书写规则
- [`change-log.md`](../../change-log.md) `## 2026-09-21`：Sprint 2 #11 收口小节（旧名 → 新落点映射与验证口径）
- [`sprint_plan.md`](../../sprint_plan.md) Sprint 2 `Retrospective`：本轮「学到 / 改进」
- [`git-tooling/gotchas.md`](../git-tooling/gotchas.md)：护栏允许清单会静默失效（与本条互为补充）
