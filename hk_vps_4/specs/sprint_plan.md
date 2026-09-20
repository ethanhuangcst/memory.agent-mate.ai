# sprint_plan — memory.agent-mate.ai（野草云4 部署）

> **用途**：本仓的短周期执行清单 —— 做什么、卡在哪、验收是什么。
> **真相源**：`deployment_strategy.md`（决议）· `dev-plan.md`（部署与升级计划）· [`../upstream.lock`](../upstream.lock)（版本坐标）
> **as_of**：2026-09-20

---

## 本期目标

把 ai-memory（上游 `ai-memory-mcp` `v0.10.0`）正式部署到野草云4，并让**备份外迁**与**升级治理**闭环。

## ToDo

| # | 事项 | 类别 | 依赖 / 阻塞 | 验收标准 | 关联文档 |
| --- | --- | --- | --- | --- | --- |
| **1** | **公开仓真实 IP 脱敏**（26 处） | 安全 | 无 —— **可立即执行** | 全仓 grep 无真实 IP（4 号机 / 阿里云 PG / 野草云3）；`<VPS4_IP>` 等占位符到位；真实值仅存服务器侧或密码管理器 | `asset_isolation_plan.md` §10 |
| **2** | **编写 `hk_vps_4/backup/` 备份脚本** | 交付 | 脚本可先写；端到端验证需 OSS 桶 + RAM（见「待提供输入」#3） | `backup-and-push.sh`（快照 → sha256 → ossutil 上传 → **回读比对** → 失败非零退出）与 `restore-drill.sh`（拉最新 → 校验 → restore → doctor 通过）可重复执行；`make backup` / `make restore-drill` 可用 | `dev-plan.md` §4.3、`deploy/README.md` §备份 |
| **3** | **回填 `deploy/config.toml.tmpl` 的 `[embeddings]`** | 配置 | 待 DashScope 文档确认 model 与 dim（见「待提供输入」#2） | `model` 与 `dim` 填真实值（**不可留 `dim = 0`**）；部署后 `ai-memory doctor` 的 Embeddings Reachability 显示 `qwen:<model>` 且维度一致 | `deployment_strategy.md` §3.1、`upstream_coupling_surface.md` F1–F3 |
| **4** | **部署执行**（`dev-plan.md` §8 第 2 步起） | 交付 | **阻塞于「待提供输入」全部 4 项** | 按 §3.2 八步落地：云资源 → 服务器（受限用户 + SSH forced-command + `/opt/ai-memory-mcp`）→ Portainer 部署 stack → §3.3 冒烟全绿 → 备份首次外迁 + 恢复演练 → 客户端双机共享验证 | `dev-plan.md` §3、`deploy/README.md` |
| **5** | **写路径泄露探针**（去重/合成是否回显他人私有内容） | 安全 | 无 —— 可在部署前用本地库实测 | 给出明确结论：**会**或**不会**回显；若会，则方案 ② 在多用户场景下**禁用**（只允许方案 ③ 物理隔离） | `multiuser_isolation.md` §8 #1 |
| **6** | **多用户隔离落地**（仅当确实要多人各自独立） | 交付 | 依赖 ToDo #4 完成；档位选 **方案 ③（一用户一 DB）** | 通过 `multiuser_isolation.md` §7 全部验收项：跨用户检索命中不到、`memory_get` 不可见、每库维护与备份均覆盖、吊销即时生效 | `multiuser_isolation.md` §5–§7 |

> **执行 4 时必须逐次核对的三个静默失败点**（`dev-plan.md` §3.4）：embedder 降级、curator fail-open（`tagged=0`）、config 挂载路径错误（tier 退回 semantic）。

## 待提供输入（阻塞 ToDo #4）

| # | 输入 | 用于 | 状态 |
| --- | --- | --- | --- |
| 1 | DashScope API key | 服务器 `.env` 的 `DASHSCOPE_API_KEY` | ☐ 待提供 |
| 2 | DashScope embedding 的 **model + dim** | `deploy/config.toml.tmpl`（同时解锁 ToDo #3） | ☐ 待提供 |
| 3 | OSS 私有桶（香港 region + SSE）+ RAM 子账号 AK | 备份外迁（同时解锁 ToDo #2 的验证） | ☐ 待提供 |
| 4 | SSH 密钥对（调用者 ↔ 野草云4，无 passphrase + forced command） | 客户端 stdio-over-SSH 接入 | ☐ 待生成 |

## 已完成（本期前序，2026-09-20）

| 项 | 交付 |
| --- | --- |
| 版本契约层 | [`../upstream.lock`](../upstream.lock) + `upstream_coupling_surface.md` + [`../scripts/upstream-preflight.sh`](../scripts/upstream-preflight.sh) + `.github/workflows/upstream-track.yml` |
| 制品改钉 | `IMAGE_TAG` `0.9.0` → `0.10.0`（最新 release，修正 0.9.0 的 attestation 缺陷） |
| 升级治理 | `dev-plan.md` §5 七步链路 + 准入判据（H1–H5 硬性阻断 / W1–W6 人工确认）+ 回滚强制快照覆盖 |
| 纪律 | `.codebuddy/` 已 gitignore；文档上游引用统一为 release tag URL；提交身份已配置 |

## 变更记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-20 | 初版：登记 4 项 ToDo 与 4 项待提供输入 |
| 2026-09-20 | 新增 ToDo #5（写路径泄露探针）与 #6（多用户隔离落地，档位定为一用户一 DB）；同步 `multiuser_isolation.md` |
