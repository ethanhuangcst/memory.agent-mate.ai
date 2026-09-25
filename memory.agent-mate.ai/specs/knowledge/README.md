# Knowledge Base

可复用的研究结论、运维经验与领域笔记（**不是**代码真相）。
产品需求在 `specs/` 下；架构决议在 `specs/adr/` 下。

## Index

| Doc | Topic | Updated |
|-----|-------|---------|
| [upstream-ai-memory/upstream-facts-and-gotchas.md](upstream-ai-memory/upstream-facts-and-gotchas.md) | 上游 ai-memory-mcp 的版本拓扑（历史被重写）、schema 阶梯、回滚语义、文档缺陷，及 MCP 工具行为实测（**档位实测**：默认档 = core = 8 且不报错、core/graph/admin/power/full = 8/20/22/57/101、`core,lifecycle` = 14、`--profile` 与 `--tier` 并存；core 档 8 工具 / source 枚举 / 近重复去重 / search 不吃中文 / 多用户隔离：漏设 `AI_MEMORY_DB` 静默落主库、一用户一库隔离、写路径可伪造）；工具功能说明的**完整来源** = `memory_capabilities` verbose drilldown（`tools/list` 的 `description` 是被截断的短描述，照抄会写出残缺句子） | 2026-09-21 |
| [git-tooling/gotchas.md](git-tooling/gotchas.md) | `.gitignore` 行内注释陷阱、`python3 - <<'PY'` 与管道争 stdin、`git grep` 工作树 vs `--cached` 差异、**护栏允许清单会静默失效**、**全仓文本批处理的边界（排除 vendored 上游）与「原文引用不可单方面改」** | 2026-09-21 |
| [local-dev/ai-memory-local-run-gotchas.md](local-dev/ai-memory-local-run-gotchas.md) | Apple Silicon 上跑 amd64 版 ai-memory：binfmt 免装 qemu、配置挂载点、CLI 参数形态、`printf` 拼 JSON 的坑 | 2026-09-20 |
| [web-portal/portal-launch-mechanism.md](web-portal/portal-launch-mechanism.md) | 门户启动机制 β′ 的实测证据（镜像契约 C1–C3、端到端探针配方）、两个落地缺口（`/data/users` 属主 root ⇒ 需 setgid 引导；门户必须注入 LLM key 否则静默降级）、α 无法用 socket 代理收窄 | 2026-09-21 |
| [docs/spec-doc-conventions.md](docs/spec-doc-conventions.md) | 自有 spec 的写作与维护约定：对外说明「只列增量 + 全档连续编号」、说明必须与探针实测逐项对齐（含集合比对断言）、被引文档改版要连带扫引用方转述、删并文档后的引用治理与护栏豁免收口 | 2026-09-21 |
| [web-portal/portal-implementation-notes.md](web-portal/portal-implementation-notes.md) | 门户实现笔记（`PSP-W1` 起）：把设计包变成可运行代码时的坑 —— 词表键名沿袭原型的陷阱、令牌 `43 字符` 口径、CSS 令牌收口与护栏断言、E2E 的语言与状态隐式输入、明文一次性不可走 PRG、同目录「本来就在」与「本次创建」的记账 | 2026-09-22 |
| [retrospective/sprint-4.md](retrospective/sprint-4.md) | Sprint 4 回顾总结（Learnings 71 · Opportunities 15 · Future actions 31，均带稳定锚点与各轮来源）：编号与引用治理、重排同步面、判据口径与敏感性（判据按语义判 / 正反对照 / 取行方式）、门禁自身的可信度（退出码契约 / 带病运行 / 偶发治理）、探针与夹具（假上游 / 可注入接缝 / 探针先于实现）、交付粒度与 UI 增量确认、上线产物各轮实测教训 | 2026-09-25 |
