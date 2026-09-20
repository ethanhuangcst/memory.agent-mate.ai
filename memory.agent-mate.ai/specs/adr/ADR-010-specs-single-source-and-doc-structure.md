# ADR-010: specs 唯一真源、8 份文档结构与链接纪律

## Status

Accepted

## Context

- 自有资产目录由 `hk_vps_4/` 改名为 `memory.agent-mate.ai/`（仓库根即产品主目录），改名本身不影响语义，但会让所有路径引用与 `.gitignore` 规则失效。
- 改名前的 `specs/` 有 **16 份、约 2,900 行**零散文档。同一事实在多处重复叙述（例如「可见性调用者只认 `AI_MEMORY_AGENT_ID`」在隔离方案、契约面、知识库各写一遍），改一次要同步多处；逐日流水堆叠在 spec 里，结论被过程淹没。
- 本仓**两次**因「文档删除 / 改名后引用未同步」留下悬空链接：`mcp_oss_bak_com_requirements.md` 删除后遗留 11 处引用；本次整合会再删 9 份文档。人工 grep 不可靠（链接写法多样），需要可重复的护栏。
- 本仓是**公开仓**：`.gitignore` 里保护含密/派生文件的规则若写死旧路径，改名会让 `deploy/.env`、`config.toml`（含真实 API key 与私有端点）**失去忽略保护**。
- 约束：`sprint_plan.md` 与 `product-backlog.md` 由用户指定**零改动**；两份运维模板文件本次「不改、不被引用，将来移除」。

## Decision

1. **specs 唯一真源 = `memory.agent-mate.ai/specs/`**，结构固定为：
   - 产品级 2 份：`architecture.md`（架构与**决议单点**）、`deployment.md`（部署/升级/备份/回滚，同时覆盖 web-portal 与 mcp）
   - `mcp/` 2 份：`mcp-design.md`（能力与隔离设计 + 上游契约面 A–K 全量）、`mcp-test.md`（测试策略 + 计划 + 用例）
   - `web-portal/` 3 份 + `mockups/`：`web-stories.md`（故事与 AC）、`web-design.md`（设计）、`web-test.md`（测试）
   - 保留：`adr/`、`knowledge/`、`sprint_plan.md`、`product-backlog.md`
2. **去重规则（写新 spec 时强制执行）**：
   - **一事实一处**：同一事实只在其归属文档完整叙述，其余用一句 + 链接
   - **决议单点**：所有「已决 / 排除」集中在 `architecture.md` §2；其它文档只写「怎么做」
   - **验收清单归属**：隔离验收在 `mcp-design.md`、部署验收在 `deployment.md`、门户验收在 `web-test.md`，互不复制
   - **历史瘦身**：变更记录只留结论级一行，过程交 git 历史与 `knowledge/`
   - **模板文件不被引用**：需要的运维事实以**摘编**写入 `architecture.md` / `deployment.md`
3. **链接纪律**：新增 `scripts/link-check.sh` + `make doc-links`，校验仓内 md 的所有相对链接；允许清单 `scripts/link-check.allow` 每行必须带理由，把「已知遗留」**显式化**而非静默放宽。允许清单是债务台账，清理后须删行。
4. **含密/派生文件的忽略规则改为路径无关**：`**/deploy/.env`、`**/deploy/.env.local`、`**/deploy/config.toml`、`**/deploy/config.local.toml` —— 使将来再次改名不会重新暴露密钥。
5. **ADR 不可变例外**：本次对 5 份 ADR（004/005/006/008/009）**仅**替换路径与指向，决议文字与理由一字未改，并在文末追加一行同步说明。

## Rationale

- **为什么是 8 份而不是更多**：按「谁改这份文档」划分 —— 改部署看 deployment，改隔离看 mcp-design，改门户看 web-portal 三份，改决议看 architecture。粒度再细会退回到「一事实多处」。
- **为什么契约面 A–K 放 `mcp/mcp-design.md` 而不是 architecture**：每一行都是**上游 ai-memory 运行时**的契约（CLI/env/config/传输/工具/凭证/迁移），升级预检按它逐项核对；放产品级架构会把 60 行参考表塞进决策文档。
- **为什么链接校验要脚本化**：本仓已两次踩坑，人工 grep 对链接写法多样性（尖括号形式、标题锚点、带 title 的写法）不可靠；脚本化后缺陷可被**显式检出**而不是靠记忆。
- **为什么不改 sprint_plan / product-backlog**：用户明确指定零改动。代价是它们内部仍指向旧文件名（74 处悬空），已在允许清单登记为已知遗留，不静默放宽规则。
- **为什么 `.gitignore` 必须路径无关**：改名是「已发生过一次」的事件，写死路径的规则在下次改名时会静默失效 —— 这是公开仓的密钥风险，不是整洁问题。

## Consequences

- 整合后 8 份目标文档共 **1,748 行**（原约 2,900 行，压减约 40%）；略超计划的 1,590 行目标，原因是上游契约面 A–K 决定**全量保留**（它是升级预检的逐项判据，压缩会削弱护栏）。
- **已知遗留**：`sprint_plan.md` / `product-backlog.md` 内部仍指向已合并的旧文件名，允许清单 4 条（另 2 条是待移除模板）。清理时机 = 用户决定重写这两份文件时。
- 新增 spec 或删文档后**必须**跑 `make doc-links`（与 `make secret-check`、`make preflight-test` 同为回归项）。
- 允许清单的豁免曾因「相对谁」理解不一致而**静默失效**（首次运行恰好无悬空，未暴露）。已修为支持两种书写方式，并把教训写入 `knowledge/git-tooling/gotchas.md`：**带白名单的护栏必须有自证机制**。

## Date

2026-09-20
