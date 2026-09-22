# mcp-stories — MCP 侧用户故事与验收条件

> **状态**：占位（**Sprint 5 #1 交付物**） · as_of 2026-09-22
> **定位**：MCP 侧（[`mcp-design.md`](./mcp-design.md) / [`mcp-test.md`](./mcp-test.md) 覆盖的接入面、口径、配额、维护与工具可达性）的**用户故事与验收条件唯一 spec**，体例与 [`../web-portal/web-stories.md`](../web-portal/web-stories.md) 一致（故事「作为…我希望…以便…」 + Given-When-Then AC + 故事索引）。
> **边界**：只写「要什么、怎样算完成」；设计见 [`mcp-design.md`](./mcp-design.md)，测试见 [`mcp-test.md`](./mcp-test.md)，部署见 [`../deployment.md`](../deployment.md) §3 / §5。

## 待落盘内容（Sprint 5 #1 MCP 侧设计包）

本文件正文在 [`../sprint-plan.md`](../sprint-plan.md) 的 **Sprint 5 `#1` MCP 侧设计包** 中定稿，交付物为：

1. **story-mapping**：把 Sprint 5 的三批可交付批次映射到故事与 AC ——
   `PSP-M1「接入面与口径定档」`（上游自身 HTTP 面不对外 · 定制口径门禁 · 部署文档与制品一致）
   `PSP-M2「本地全链路联通」`（门户 → HTTP MCP → 子进程 stdio → 用户库，作为 Sprint 6 集成验收的输入）
   `PSP-M3「工具可达性」`（非英文输入能否命中 MCP 工具的结论与落地）
2. **技术设计**：落 [`mcp-design.md`](./mcp-design.md)（现有章节的增补）。
3. **测试方案**：落 [`mcp-test.md`](./mcp-test.md)（L0–L3 与 AC 的映射、用例登记）。
4. **部署方案**：落 [`../deployment.md`](../deployment.md) §3 / §5。

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-22 | 占位创建：随 Replan（Sprint 4–7 重排）登记为 **Sprint 5 #1 的交付物**，并进入 [`../architecture.md`](../architecture.md) §7「相关」表；正文待落盘 |
