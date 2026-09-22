# ADR-013: SDD/Scrum 过程文档边界与 RID 解决方案下沉

## Status

Accepted

## Context

- [`sprint-backlog.md`](../sprint-backlog.md) 的 RID Registry 曾把风险 R1–R3、防线 D1–D5 与验证 V1–V4 放在同一张表：风险行以 D 编号作为解决方案、以 V 编号作为验证方法，而 D/V 行又分别重复状态、关联和说明，形成环状引用与重复口径。
- 同一文件的 Sprint ToDo 表把过程说明、日期、剩余边界和状态混在「状态」列，无法按枚举检索；[`product-backlog.md`](../product-backlog.md) 也缺少 `Implemented`，难以区分「已实现待生产验收」与「全部完成」。
- RID 的处置必须进入 Product Backlog 才能拥有产品描述、可执行验收条件与 Sprint 排期；验证步骤不是 Risk、Impediment 或 Dependency，不应作为 RID 行。
- ADR-010 Decision §1 固定了当时的 specs 文档清单，但没有过程文档体例的唯一真源。当前需要新增 [`sdd-scrum-practices.md`](../sdd-scrum-practices.md)，而 ADR 按新增决议 supersede，不回写旧 ADR 正文。

## Decision

1. 新增 [`sdd-scrum-practices.md`](../sdd-scrum-practices.md)，作为 RID Registry、Sprint Backlog 与 Product Backlog 的列定义、状态语义、说明写法及单一真源边界。该文件扩展并 supersede ADR-010 Decision §1 的文档清单；ADR-010 的去重、链接和密钥纪律继续有效。
2. RID Registry 只登记 Risk、Impediment 与 Dependency：
   - 保留 R1–R3 与 D1–D5；验证 V1–V4 不再占 RID 行。
   - 「解决方案」只指向 `product-backlog.md` 的真实条目。
   - 验证方法由对应 Product Backlog 条目的「验收条件」承载；V1–V4 作为稳定判据名保留，完整矩阵归属 `mcp/mcp-design.md` §6.2。
   - RID 状态只取 `Pending` / `Open` / `Implemented` / `Closed`，处理过程写入独立「处理说明」列。
3. Sprint Backlog 与 Product Backlog 状态统一为 `ToDo` / `WIP` / `Implemented` / `Done`；状态列只写枚举。Sprint ToDo 表新增「说明」列，承载结论级摘要、剩余边界与过程证据指针。
4. `sprint-backlog.md` 的 RID 节维护「RID → Backlog 条目 → 验收条件落点 → Sprint 落点」覆盖表，所有 RID 必须 100% 覆盖且不得有空项。
5. 事实与状态保持单点归属：RID 的处理状态只在 RID Registry，Sprint 执行状态只在 Sprint Backlog；允许 RID、Product Backlog、Sprint Backlog 与 design/test 通过稳定锚点双向导航，但不得复制他处状态或正文。Product Backlog 的 `Sprint` 列只投影 `sprint-backlog.md` 排期；详细过程归 `change-log.md`，不在状态列复制。

## Rationale

- Product Backlog 天然具备「描述 + 验收条件 + Sprint + 状态」，是解决方案的正确落点；继续在 RID 表内造 D/V 子系统只会产生第二套执行模型。
- 保留 V1–V4 名称可兼容现有设计、测试与部署文档中的判据引用，同时把定义收敛到验收条件与验证矩阵。
- `Implemented` 显式表达「本地或实现层已完成，但生产验收仍在其它已登记条目中」，避免把未闭环工作误标 `Done`，也避免完成项长期停留 `WIP`。
- 覆盖对照表比环状编号引用更易审计：每条 RID 的解决方案、验证和排期在一行内可见。

## Consequences

- `architecture.md` §6 只保留 R1–R3 薄索引；RID 细节与状态统一由 `sprint-backlog.md` 维护。
- `product-backlog.md` 的 #4、#5、#11、#14、#26 承载现有 RID 解决方案；本次不新增为凑映射而产生的条目。
- V1–V4 不再是 RID 行，但仍是 `mcp/mcp-design.md` §6.2 与 Product Backlog #11 的可引用判据。
- 过程文档新增一份，规格结构不再使用 ADR-010 标题中的「8 份」作为数量约束；「按职责划分、一事实一处」仍是约束。
- 本次不新增状态或覆盖静态检查脚本；覆盖由对照表、文档回归命令与人工核对保证。

## Date

2026-09-21
