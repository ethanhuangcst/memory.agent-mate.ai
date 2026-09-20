# mcp.oss-bak.com — 需求规格（新项目需求起点）

> **文档目的**：本文档是 **mcp.oss-bak.com**（阿里云 OSS 备份 MCP 服务，多租户 SaaS）的需求规格起点。设计为**独立自洽**——整篇复制到新项目仓库即可作为 `requirements.md` / `specs/requirements.md` 使用，不需要访问任何其他仓库。
> **撰写视角**：以首个潜在租户 **memory.agent-mate.ai**（一个 ai-memory 备份部署）的需求出发，推导服务端能力。
> **版本**：v1.0 · 2026-09-20 · 状态：待评审
> **决策轨迹**：前身项目名 `aliyun-oss-bak-mcp`（曾更名 `mcp.oss-bak.com`）；2026-09-20 从 ai-memory 部署计划中移出，**另建项目单独建设**（本文档即移交物）。

---

## 1. 产品定位（一段话说清）

mcp.oss-bak.com 是一个**多租户备份 MCP 服务**：服务运营方（owner）提供一个阿里云 OSS 存储后端（一个主 AK + 一个私有桶）；每个租户（如 memory.agent-mate.ai）通过 admin portal 获得一把 api-key，即可通过 MCP 协议执行「快照 → 校验 → 上传 → 列举 → 验证 → 恢复（到 staging）」的完整备份闭环。存储按租户前缀隔离，配额按租户约束，操作按租户审计。

**为什么是 MCP**：让 AI 客户端（Cursor / Claude 等）能用自然语言操作备份——「帮我备份」「最近一次备份是什么时候」「把上周的备份恢复出来看看」——而不是记命令行。

**为什么自研**：阿里云官方 OSS MCP Server（alpha，`alibabacloud-oss-mcp-server@1.0.0-alpha.2`）经评估**不可用**——仅 3 个 Bucket 级只读查询工具（ListBuckets / GetBucketInfo / GetBucketStat），**无任何对象级读写**，对本需求覆盖率 0/4（详见附录 A）。

## 2. 首个租户故事（验收场景）

> 租户 = memory.agent-mate.ai，一个把数据存在本机 SQLite 的 ai-memory 部署。

1. **接入**：租户在 admin portal 被签发一把 api-key（明文仅展示一次）。
2. **定时备份**：租户侧 cron 每小时调用服务的 CLI 腿 → 对租户数据做快照 → 校验 sha256 → 上传 OSS（落在该租户的隔离前缀下）。
3. **对话式操作**：租户的 AI 客户端通过 `https://mcp.oss-bak.com/mcp`（Bearer key）询问「最近一次备份是什么时候」「备份列表」。
4. **按需验证**：对某个备份对象执行远程校验（下载重算 sha256 与清单比对）。
5. **恢复**：演练或真实故障时，把某个备份恢复到 staging 目录（**绝不 in-place**），由租户自行执行最终 restore。

## 3. 术语与角色

| 术语 | 含义 |
| --- | --- |
| **owner** | 服务运营方。持有阿里云账号、主 AK（RAM 子账号）、私有桶，运营 admin portal |
| **租户（tenant）** | 持有一把 api-key 的客户端部署（如 memory.agent-mate.ai）。一个 key 一个租户身份 |
| **主 AK** | owner 的 RAM 子账号 AccessKey，权限最小化（见 §6.4）。全部租户共用 |
| **租户 key** | 服务签发的 api-key。**key 即身份**：绑定租户记录（prefix / 配额 / 状态） |
| **staging** | 恢复操作的落地目录。恢复**永不 in-place**，只写 staging，由租户自行执行最终 restore |
| **target** | 预配置的命名备份目标（如 `ai-memory`），映射到「快照命令 + 本地快照目录」。**工具入参不含任何路径/桶/prefix** |

## 4. 功能需求

### 4.1 MCP 工具（**4 个，硬上限**；经 `https://mcp.oss-bak.com/mcp`，Streamable HTTP + Bearer key）

| FR | 工具 | 行为 | 成功返回 |
| --- | --- | --- | --- |
| FR-1 | `backup_now(target)` | 执行 target 的 snapshot_cmd → 定位最新快照 → 本地 sha256 校验 → 上传至租户前缀 → **回读远端对象重算 hash 比对** | `{object_key, size, sha256, etag, uploaded_at}` |
| FR-2 | `backup_list(target)` | 列举**本租户**前缀下的快照（时间倒序） | `[{object_key, size, sha256?, last_modified}]` |
| FR-3 | `backup_verify(target, object_key)` | 下载到临时目录，重算 sha256 与清单比对 | `{verified, sha256_local, sha256_manifest}` |
| FR-4 | `backup_restore(target, object_key, confirm)` | `confirm` 必须为 `true`；下载到 **staging**（按租户分目录），**绝不 in-place** | `{staging_path, sha256, verified}` |

**拒绝路径（必须实现并测试）**：
- sha256 不匹配 → 拒绝继续（FR-1 上传后比对失败 → 报错并标记该对象不可信）
- FR-4 缺 `confirm=true` → 400
- 对象 key 越出本租户 prefix → 403（物理上不应可达：key 不由客户端提供，见 §5）
- 配额超限 → 403 `QUOTA_EXCEEDED`
- 无效 / 已吊销 key → 401

**硬约束**：工具数超过 4 = 范围蔓延；工具入参**永远不出现** bucket / prefix / 任意路径字段。

### 4.2 CLI 腿（与 MCP 同一套核心库；供 cron 无人值守）

| FR | 命令 | 说明 |
| --- | --- | --- |
| FR-5 | `oss-bak snapshot <target>` | 快照 + 校验（不涉及 OSS） |
| FR-6 | `oss-bak push <target>` | 上传 + 回读比对 |
| FR-7 | `oss-bak verify <target> <object_key>` | 远程校验 |
| FR-8 | `oss-bak restore <target> <object_key> [--confirm]` | 同 FR-4，落 staging |

**为什么必须有 CLI**：MCP 由 agent 按需调用，**无法承载「按计划」的定时备份**。cron 需要非 agent 触发路径。附带收益：CLI 非零退出码 + 结构化失败日志 = cron 可告警，直接对冲静默失败。

### 4.3 admin portal（`admin.oss-bak.com`；Cloudflare Access 保护）

| FR | 功能 |
| --- | --- |
| FR-9 | 签发 key：录入租户显示名 + 配额 → 生成 key（明文仅展示一次，服务端只存哈希 + 前缀） |
| FR-10 | 列出 key：属主、前缀、配额、创建/吊销时间、状态 |
| FR-11 | 吊销 / 恢复 key：吊销后该 key 的下一个请求即 401 |
| FR-12 | 审计查看：按租户/时间过滤的操作流水 |

## 5. 多租户与存储隔离

### 5.1 方案 A（MVP 采用）：单桶 + 租户前缀

```text
<private-bucket>/
  tenants/
    <tenant-id>/          ← 该租户全部对象只允许出现在这里
      2026/09/20/snapshot-xxxx.tar.gz
```

**隔离机制（安全核心，缺一不可）**：

1. **路径只由服务端推导**：`target`（租户自己的命名目标）→ 服务端从 key 对应的租户记录查出真实 bucket 前缀。工具入参**没有**路径/桶/prefix 字段 → 物理上无法跨租户寻址。
2. **每租户配额**：对象数 / 总字节 / 快照数（记录在租户记录中）；超限 403 `QUOTA_EXCEEDED`——防止一个租户写爆共享桶。
3. **按租户审计**：append-only（操作、object_key、字节数、时间、key 指纹）。
4. **restore 边界**：只允许拉回本租户 prefix 内的对象；staging 按租户分目录。

### 5.2 演进路径（写入规格，MVP 不做）

| 方案 | 触发条件 | 说明 |
| --- | --- | --- |
| B：每租户独立桶 | 租户要求强隔离 / 单桶容量风险 | 签 key 自动建桶；主 AK 需建桶权限；迁移脚本需提前设计 |
| C：每请求 STS | 服务被打穿也不许泄露主 AK | 为每个请求签发限定 prefix 的 STS token；复杂度高 |

## 6. 安全需求

| # | 需求 |
| --- | --- |
| 6.1 | **api-key 模型**：单一 key 不分只读/读写，持 key 可用全部 4 工具；`/mcp` 所有请求需 `Authorization: Bearer <key>`，**无匿名**；key 只存哈希（如 SHA-256）+ 前缀展示；吊销即时生效 |
| 6.2 | **key 生命周期**：portal 签发（明文一次性展示）→ 使用 → 吊销/轮换；签发/吊销/使用（每次调用的 key 指纹）入 append-only 审计 |
| 6.3 | **限流**：按 key 限速（防单租户打爆服务）；建议同时设全局并发上限 |
| 6.4 | **主 AK 最小权限**：RAM 子账号仅 `oss:PutObject` / `oss:GetObject` / `oss:ListObjects`，资源限定 `acs:oss:*:*:<bucket>/tenants/*`；AK 走 env 或 `0400` 文件，**永不进 argv、永不入仓** |
| 6.5 | **传输**：全站 HTTPS。`mcp.oss-bak.com` TLS 终结（Cloudflare 橙云 Full(strict) 或 NPM + Let's Encrypt，二选一，见 §11） |
| 6.6 | **admin portal**：`admin.oss-bak.com` 由 **Cloudflare Access** 保护（零自建登录；服务端校验 CF 身份头防直连源站绕过）。portal 是最高价值目标——绝不能无保护公网暴露 |
| 6.7 | **恢复双重门槛**：`confirm=true` + 只落 staging |
| 6.8 | **secrets 纪律**：任何 key/AK 不入 Git、不进日志（日志只记指纹）、不出现在错误信息里 |

## 7. 非功能需求（静默失败防线）

本项目最大的风险是「**你以为有备份，其实没有**」。以下为硬性设计要求：

| # | 要求 |
| --- | --- |
| 7.1 | 上传后**回读比对**：FR-1 必须重新下载远端对象重算 hash，与本地一致才算成功 |
| 7.2 | CLI 每个子命令非零退出码 + 结构化失败日志（cron 据此告警） |
| 7.3 | 认证失败 / 配额超限返回明确的 401 / 403 语义（不能静默吞掉） |
| 7.4 | 服务健康端点（`/healthz`，免认证）供探活 |
| 7.5 | 审计可导出（运维排查「某天到底有没有备份成功」） |

## 8. 测试规约（stub/mock 契约同源）

**目标**：在真实 OSS 就绪前，租户侧（如 memory.agent-mate.ai）即可用 mock 跑通全链路；真实服务就绪后**只换启动命令**，不改编排。

| # | 规约 |
| --- | --- |
| 8.1 | 正式仓库同时产出 `mcp_oss_bak`（真实服务）与 `mcp_oss_bak_mock`（pip 包），两者共享**同一份工具 schema 定义文件**（schema 漂移在 CI 即失败） |
| 8.2 | mock 行为表必须覆盖：成功路径 / sha256 不匹配 / 缺 confirm / 无效 key 401 / 已吊销 key 401 / 超配额 403 / OSS 5xx 模拟 |
| 8.3 | mock 以相同传输暴露（Streamable HTTP，本地端口），客户端切换 = 换 URL 或启动命令 |
| 8.4 | 契约测试：mock 与真实服务对同一请求返回**结构一致**的响应（字段名/错误码），由 CI 双跑比对 |
| 8.5 | 租户侧验收顺序：mock 全链路 → 真实服务就绪 → 撤 mock → e2e（含真实恢复演练） |

## 9. 技术栈与部署

| 项 | 选择 |
| --- | --- |
| 语言 | Python 3.12 |
| MCP 框架 | FastMCP（Streamable HTTP 传输） |
| OSS SDK | `oss2`（阿里云官方） |
| portal | 同栈：FastAPI + 轻量前端（HTMX / 小型 React）；单仓单部署 |
| key/审计存储 | SQLite（持久卷） |
| 部署 | Docker；建议与租户同节点（野草云4）或独立小节点；DNS：`oss-bak.com` zone（需确认托管在 Cloudflare） |
| 传输 | `https://mcp.oss-bak.com/mcp`（Streamable HTTP）+ CLI（cron） |

### 里程碑

| M | 交付 | 验收 |
| --- | --- | --- |
| M1 | 核心库 + CLI（多租户：路径由 key 推导） | 单测：sha256 拒绝 / 跨租户寻址拒绝 / 配额超限 / 401 |
| M2 | MCP Streamable HTTP 前端（4 工具 + 认证 + 限流） | 冒烟：无 key 401、吊销 key 401、正常 key 全链路 |
| M2.5 | admin portal + CF Access 接入 | portal 仅经 Access 可达；吊销即时生效 |
| M3 | 部署生产（DNS/CF/TLS + RAM/桶） | 公网 HTTPS 冒烟 + 无 key 401 + 限流生效 |
| M4 | **恢复演练**（硬验收） | 首个租户（memory.agent-mate.ai）从 OSS 拉回 → sha256 → 真实 restore → 健康检查通过；脚本可重复 |

## 10. 验收标准（DoD 摘要）

- [ ] 4 工具 + 4 CLI + portal 功能全部实现，拒绝路径有测试覆盖
- [ ] **恢复演练**（M4）完成且脚本可重复——未演练 = 未完成
- [ ] mock 与真实服务契约测试通过（CI 双跑比对）
- [ ] 无 key 一律 401；吊销即时生效
- [ ] 跨租户寻址不可达（渗透式自测：用租户 A 的 key 访问租户 B 前缀 → 403/404）
- [ ] 审计完整：签发、吊销、每次工具调用可追溯
- [ ] secrets 零入仓、零入日志、零入 argv

## 11. 预检项 / 开放问题

| # | 事项 | 状态 |
| --- | --- | --- |
| 1 | `oss-bak.com` 域名归属与 Cloudflare 托管（CF Access 依赖） | ☐ 待确认 |
| 2 | OSS 私有桶（prod + dev 分离）、RAM 子账号（dev/prod 分开） | ☐ 待创建 |
| 3 | CF Access 策略（限 owner 邮箱；service token 是否需要） | ☐ 待配置 |
| 4 | staging 目录约定（服务端容器内路径 vs 挂载到租户侧） | ☐ 设计决策 |
| 5 | 首个租户 memory.agent-mate.ai 的快照命令对接（其快照 CLI 契约以租户侧文档为准，服务端只存命令模板） | ☐ 接入时确认 |
| 6 | 部署节点（与租户同机 vs 独立小节点） | ☐ 待定 |

## 附录 A：为什么不用阿里云官方 OSS MCP Server

**评估对象**：[官方文档](https://help.aliyun.com/zh/oss/developer-reference/oss-mcp-server-alpha) · [GitHub `aliyun/alibabacloud-oss-mcp-server`](https://github.com/aliyun/alibabacloud-oss-mcp-server)（`1.0.0-alpha.2`，MIT，7 commits / 4 stars / 无 roadmap）

**结论：不可用。覆盖率 0/4。**

| 本需求 | 官方 alpha |
| --- | --- |
| backup_now（上传快照 + 回读校验） | ❌ 无上传 |
| backup_list（列远端快照**对象**） | ❌ 仅能列 **bucket**，无对象列举 |
| backup_verify（下载 + sha256 比对） | ❌ 无下载 |
| backup_restore（下载到 staging） | ❌ 无下载 |

工具集仅 3 个 Bucket 级只读查询（`ListBuckets` / `GetBucketInfo` / `GetBucketStat`），无任何对象级读写。其余事实：Node.js ≥ 18.20.5（npx）；stdio + Streamable HTTP；AK/SK + 可选 STS 自动刷新；无只读开关（靠 `tools` 白名单间接实现）；官方警告 breaking changes、不建议生产。

**已排除路径**：直接采用（0/4）；fork 补齐（价值部分用 FastMCP+oss2 成本更低，fork 7-commit alpha 仓库 = 长期背上游漂移）；等待补齐（无 roadmap，阻塞租户）。

**保留观察**：① `GetBucketStat` 将来可做备份完备性旁路监控（可选）；② **退出条款**——若官方补上对象级 Put/Get + 工具白名单并脱离 alpha，可评估用官方版替换自研的 MCP 腿（CLI 腿不受影响，退出成本低）。

## 附录 B：决策轨迹

| 日期 | 决策 |
| --- | --- |
| 2026-09-19 | 需求研究在 ai-memory-mcp 部署调研中完成；初名 `aliyun-oss-bak-mcp`，定位 ai-memory 的前置备份项目 |
| 2026-09-19 | 更名 `mcp.oss-bak.com`；确立多租户、方案 A 隔离、api-key 模型、CF Access portal、4 工具边界、官方 alpha 0/4 评估 |
| 2026-09-20 | 从 ai-memory 部署计划中**移出，另建项目**；本规格作为移交物（本文档） |
