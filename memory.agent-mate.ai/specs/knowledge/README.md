# Knowledge Base

可复用的研究结论、运维经验与领域笔记（**不是**代码真相）。
产品需求在 `specs/` 下；架构决议在 `specs/adr/` 下。

## Index

| Doc | Topic | Updated |
|-----|-------|---------|
| [upstream-ai-memory/upstream-facts-and-gotchas.md](upstream-ai-memory/upstream-facts-and-gotchas.md) | 上游 ai-memory-mcp 的版本拓扑（历史被重写）、schema 阶梯、回滚语义、文档缺陷，及 MCP 工具行为实测（core 档 8 工具 / source 枚举 / 近重复去重 / search 不吃中文 / 多用户隔离：漏设 `AI_MEMORY_DB` 静默落主库、一用户一库隔离、写路径可伪造） | 2026-09-20 |
| [git-tooling/gotchas.md](git-tooling/gotchas.md) | `.gitignore` 行内注释陷阱、`python3 - <<'PY'` 与管道争 stdin、`git grep` 工作树 vs `--cached` 差异、**护栏允许清单会静默失效**（须用负向样本自证） | 2026-09-20 |
| [local-dev/ai-memory-local-run-gotchas.md](local-dev/ai-memory-local-run-gotchas.md) | Apple Silicon 上跑 amd64 版 ai-memory：binfmt 免装 qemu、配置挂载点、CLI 参数形态、`printf` 拼 JSON 的坑 | 2026-09-20 |
