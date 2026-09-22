# ADR-006: 保持公开仓 + IP 占位化脱敏（撤销「本仓转私有」决议）

## Status
Accepted

## Context
本仓 `memory.agent-mate.ai` 是**公开** GitHub 仓库（部署资产仓）。Sprint 2 初版曾把「把本仓改为私有」列为 #1，理由是避免真实公网 IP 等敏感信息随公开仓泄露。但在执行 IP 脱敏时发现：野草云4 的 IP（`<VPS4_IP>`）已由公开 DNS 解析（`portainer4.agent-mate.ai` / `nginx4.agent-mate.ai` 均指向它），重写历史对它零收益且需 force push；而另 3 个 IP（野草云3、阿里云 PostgreSQL、阿里云 MySQL）虽未公开解析、有保密价值，但只需从文档迁出即可，不必为此把整个仓转为私有。转私有还会带来私有仓 Actions 额度、协作摩擦等代价。

## Decision
**保持公开仓**；改为把真实值迁出到 gitignored 的本机文件 `memory.agent-mate.ai/secrets.local.hk_vps_4.md`，仓库文档一律使用具名占位符：

| 占位符 | 语义 |
| --- | --- |
| `<VPS4_IP>` | 野草云4 节点公网 IP |
| `<VPS3_IP>` | 野草云3 节点公网 IP（仅作「不得触碰」约束） |
| `<PG_HOST>` | 阿里云自建 PostgreSQL |
| `<MYSQL_HOST>` | 阿里云 MySQL |

并新增防复发护栏：`secret-check.sh`（扫已跟踪/暂存文件公网 IP）+ pre-commit 钩子（`make hooks-install`），真实值只在 `secrets.local` 一处。

## Rationale
- 撤销「转私有」：公开仓带来的协作/可见性收益保留；仅 1 个 IP 属公开解析，「卫生」级别，重写历史无意义。
- 占位化而非加密：文档需可读、可评审，占位符满足「人可读 + 机器可扫」。
- 护栏用通用 IPv4 正则 + 私网白名单（不硬编码真实 IP），既能拦本次 4 个 IP，也能拦未来新增的公网 IP；检查器自身不成为泄露源。
- 护栏允许 `git commit --no-verify` 绕过，与既有「只提醒、不自动改」纪律一致。

## Consequences
- 真实 IP 的物理真相源变为本机 `secrets.local.hk_vps_4.md`（不入仓，需本机保管/密码管理器）。
- 任何含公网 IP 的提交会被 pre-commit 拦下；`make secret-check` 可手动复查。
- 变更记录行**不得**写真实 IP 字面量（否则会触发自己的护栏）；应写占位符或指向 `secrets.local`。
- 决策已写入 `architecture.md` §5（仓库与资产边界 / 脱敏规则）、`sprint-backlog.md` Sprint 2 #1 与变更记录、`architecture.md` §2 决议 10 与变更记录。

## Date
2026-09-20

> 2026-09-20：本文档的**路径与指向**随目录改名（`hk_vps_4/` → `memory.agent-mate.ai/`）及 specs 整合同步；决议文字与理由一字未改。
