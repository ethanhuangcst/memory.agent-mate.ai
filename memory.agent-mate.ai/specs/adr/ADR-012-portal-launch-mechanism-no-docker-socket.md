# ADR-012: 门户启动机制定稿为 β′（门户自带二进制 spawn），不持有 docker socket

## Status

Accepted（2026-09-21 用户确认 β′）。Decision 3 的**目录引导**与**密钥归属**两条前置由代理提出建议并被采纳 —— 若事后否决，只改本 ADR 的 Decision 3 与对应文档，Decision 1 / 2 / 4 不受影响。

## Context

- 门户必须存在「启动器」：分库在**进程启动那一刻**选定（`AI_MEMORY_DB`），身份只认环境变量（`AI_MEMORY_AGENT_ID`），上游无 MCP-over-HTTP ⇒ 必须由门户按用户拼 env/argv 并拉起子进程（[`web-portal/web-design.md`](../web-portal/web-design.md) §1）。
- 备选两条：**β′** = 门户镜像内 `COPY` 上游二进制、直接 spawn；**α** = 门户挂 `/var/run/docker.sock`，用 `docker exec` 在既有容器里开会话。α 需门户持**宿主 root 等价**权限（挂 socket 即等价 root）。
- 门户是**新增的公网可达组件**（`<MCP_HOST>` 面向命令行客户端，`<ADMIN_HOST>` 面向浏览器），是「最可能被攻破、且攻破后可触及全部用户记忆」的那一个（威胁 T1）。
- 该主机是**多应用共享**节点：同机跑 Portainer（自身挂 socket）、Nginx Proxy Manager（证书私钥）、其它应用 stack、OSS 备份凭据与 SSH 密钥 ⇒ α 的爆炸半径不止本项目。
- 2026-09-21 补充实测（[`knowledge/web-portal/portal-launch-mechanism.md`](../knowledge/web-portal/portal-launch-mechanism.md)）：β′ 机制已端到端跑通；同时发现两个设计未登记的缺口与一个否定性结论（socket 代理无法收窄）。

## Decision

1. **D1 定稿为 β′**：门户镜像 `COPY --from=ghcr.io/alphaonedev/ai-memory:<tag>` 取二进制并要求
   - 底座 `bookworm` 系 + `ca-certificates`
   - **显式** `useradd --system --uid 999 --gid 999 aimem`（不依赖 `useradd` 的分配巧合）
   - 构建平台钉 `linux/amd64`（上游镜像单平台），`<tag>` 由 `upstream.lock` 注入、**不手写**
2. **门户容器不挂 docker socket、不用 `docker exec` 开会话**；两条 stack 互不依赖（仅共享数据卷 + 只读 config）。
3. **新增三条落地前置**（原设计未覆盖，本次实测发现）：
   - **目录引导**：`/data/users` 一次性改为 `root:aimem 2775`（setgid），使非 root 门户能创建 `0700`、属主 `aimem` 的用户目录；据此**删除** `deployment.md` §4.4 的 `NOPASSWD: docker exec -u 0` root 规则。
   - **密钥归属**：门户容器必须注入 LLM/embedding 的 key（否则 `tier=semantic` 静默降级为 linear scan）。门户使用**独立 MaaS key**（**2026-09-21 用户确认可增签 ⇒ 本项首选生效**），且必须与主 key **同 workspace / 同模型权限**（否则 embeddings 模型或维度不一致，同样静默降级）；`api_key_env` 只写变量名 ⇒ 换值不改 config，可单独限额与吊销。值只填 gitignored 的 `deploy/portal.env`（服务器 `/opt/ai-memory/portal.env`，`chmod 600`），永不入仓。**备用口径（若日后无法增签）**：退回共用主 key，并把「公网组件持密」登记为残余风险 + 纳入轮换清单。门户启动自检须断言 **embeddings 可达（1024 维）**，不能只断言「变量非空」。
   - **版本断言**：门户启动时比对自身二进制版本与挂载的 `upstream.lock`／`IMAGE_TAG`，不一致**拒绝启动**（对冲 4 的陈旧镜像风险）。
4. **不采纳 α**，且不采纳「α + 受限 socket 代理」：主流代理（Tecnativa/docker-socket-proxy）按「HTTP 方法 + URL 前缀」放行，**不支持**按容器或命令过滤；exec 端点是 POST ⇒ 放行 exec 必然放开写面（前缀 `CONTAINERS` 下含可致宿主提权的创建容器端点）⇒ 代理方案在本项目可达范围内**不成立**，α 实质 = 裸 socket。

## Rationale

- **α 的收益被高估**：它的真实优势只有「天然与运行中容器同版本、升级不必重建门户镜像」；而升级七步**本就包含**门户镜像随 `upstream.lock` 重建，成本已计入。
- **β′ 已被实证可行**（非纸面方案）：实测 4 行 Dockerfile 的门户式镜像可完成 8 工具握手 / 写入 / 库落点正确 / 跨进程语义召回命中。
- **权限差异是量级差异**：α ⇒ 门户 RCE = 宿主 root（同机其它应用、证书、备份凭据全部暴露）；β′ ⇒ 门户 RCE = `aimem`（本项目记忆面）。同为主机上的共享节点，这个量级差不值得用「省一次镜像重建」去换。
- **α 的缓解措施不可靠**：见 Decision 4，代理无法把「exec 一个容器」与「创建容器」分开授权。
- **反面风险已量化并给出对策**：β′ 的版本偏移风险为「陈旧镜像静默操作已被前向迁移的 schema」（上游不拒绝旧二进制，[`ADR-005`](./ADR-005-upgrade-admission-gate-layering.md)）→ 由 Decision 3 的版本断言对冲。
- **两缺口都有低成本对策**：目录引导是一行 `install -d`，且**顺带减少**一处 root 授权；密钥问题用独立 key 解决。

## Consequences

- 门户实现更简单（本地 `spawn` + stdio 桥，无需 Docker 客户端、无 exec 生命周期管理）；会话生命周期天然「父死子死」。
- 上游升级多一步「重建门户镜像」——已有流程覆盖；未重建会被版本断言拦下（fail-loud，而非静默）。
- 门户容器成为**持密组件**（独立 MaaS key）：需在部署清单里登记该 key 的轮换与吊销流程。
- `/data/users` 改为组可写 ⇒ 威胁模型不变（`/data` 与主库本就 `aimem` 可写），但**文档须写清理由**，避免后来者误判为权限放宽。
- 门户对上游的契约面收敛为 C1–C3 + 平台 + 版本断言（`web-design.md` §9）；α 的额外契约（容器名 C9、容器存活、Docker API 版本）不再需要。
- 不变项：门户被攻破仍可读全部用户记忆（两条路径在**记忆机密性**上等价）⇒ T1 的最小化措施（无关 socket、只读根、最小依赖、无 shell、资源限额）继续适用。

## Date

2026-09-21

> 证据与探针配方：[`knowledge/web-portal/portal-launch-mechanism.md`](../knowledge/web-portal/portal-launch-mechanism.md)（E1–E7）。本 ADR 在用户确认前为 `Proposed`。
