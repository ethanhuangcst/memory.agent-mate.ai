---
title: 门户启动机制（β′ / α）实测证据与两个落地缺口
type: research-note
status: active
as_of: 2026-09-21
tags:
  - web-portal
  - isolation
  - image-contract
  - spawn
related_spec: specs/web-portal/web-design.md
related:
  - knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md
  - knowledge/local-dev/ai-memory-local-run-gotchas.md
  - adr/ADR-012-portal-launch-mechanism-no-docker-socket.md
  - adr/ADR-005-upgrade-admission-gate-layering.md
---

# 门户启动机制（β′ / α）实测证据与两个落地缺口

## Summary

2026-09-21 为 Sprint 2 #6（D1 启动机制决议）做的本地实测。三条结论：

1. **β′ 已端到端跑通**（门户镜像内 `COPY` 上游二进制、以 `aimem` 身份自行 spawn 子进程）：自建 4 行 Dockerfile 的门户式镜像可完成 `initialize` → 8 工具 → 写入 → **库自动创建在 `/data/users/<u>/ai-memory.db`** → 跨进程语义召回 `mode:hybrid` 命中，且共享主库未被触碰。
2. **设计未登记的两个落地缺口**：① 非 root 门户**建不出**用户目录（`/data/users` 属 root，实测 EACCES），需一次性 setgid 引导；② 门户容器**必须**拿到 LLM/embedding 的 API key，否则 `tier=semantic` 下静默降级为 linear scan。
3. **α 无法被「受限 socket 代理」软化**：主流代理按「方法 + URL 前缀」放行、**不支持按容器/命令过滤**，而 exec 端点本身是 POST ⇒ 放行 exec 必然放开写面，α 实质 = 裸 socket。原设计 §9 附录的缓解措施不成立。

架构决议见 [`adr/ADR-012`](../../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md)。**2026-09-21 用户确认 β′**（ADR 转 Accepted）；三条落地前置写入 [`architecture.md`](../../architecture.md) §2.3 并同步到 `deployment.md` / `web-design.md` / `web-stories.md` / `mcp-design.md`。

## Evidence

### E1 镜像与平台事实

| 项 | 实测值 | 命令 |
|---|---|---|
| 架构 / OS | `amd64` / `linux`（**单平台镜像**） | `docker image inspect … --format '{{.Architecture}}'` |
| 容器用户 | `USER aimem`；`uid=999(aimem) gid=999(aimem)`，home `/home/aimem` | `docker run --entrypoint sh <img> -c 'id aimem'` |
| 二进制 | `/usr/local/bin/ai-memory`，32 MB，`root:root 0755`，`--version` = `0.10.0` | `ls -l …; ai-memory --version` |
| 运行时底座 | Debian `12.14`（bookworm） | `cat /etc/debian_version` |
| 动态依赖 | `libgcc_s.so.1` / `libm.so.6` / `libc.so.6`（x86-64） | `ldd /usr/local/bin/ai-memory` |
| 宿主架构 | VPS 为 amd64（`…-cloud-amd64`） | `hk_vps_4_settings.md` §1 |

⇒ 底座兼容性已证：在 `node:22-bookworm-slim` 中 `ldd` 全部解析、`--version` / `mcp --help` 正常。
⇒ 唯一平台约束在**开发机**（Apple Silicon）：构建门户镜像须显式 `--platform linux/amd64`。

### E2 β′ 端到端探针（4 行 Dockerfile + 两个会话）

```dockerfile
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
RUN useradd --system --create-home --shell /bin/sh aimem
COPY --from=ghcr.io/alphaonedev/ai-memory:0.10.0 /usr/local/bin/ai-memory /usr/local/bin/ai-memory
```

```bash
docker build --platform linux/amd64 -t portal-beta-probe:tmp /tmp/portal-beta-probe
docker run --rm -i --platform linux/amd64 -u 999:999 -v <vol>:/data --env-file deploy/.env \
  -e HOME=/data -e AI_MEMORY_DB=/data/users/beta-probe/ai-memory.db \
  -e AI_MEMORY_AGENT_ID=human:beta-probe -e AI_MEMORY_KEY_DIR=/data/users/beta-probe/keys \
  -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0 --entrypoint sh portal-beta-probe:tmp \
  -c 'exec ai-memory mcp --tier smart' < session_a.jsonl
```

| 断言 | 结果 |
|---|---|
| 会话 A 进程退出码 | `0` |
| `initialize` | `serverInfo = {name: ai-memory, version: 0.10.0}` |
| `tools/list` | **8** 工具（core + always-on `memory_capabilities`） |
| `memory_store` | 成功；回显 `agent_id = human:beta-probe`（身份来自 env，非请求） |
| 库落点 | `/data/users/beta-probe/ai-memory.db` **自动创建**（786 KB + `-wal`/`-shm`），属主 `aimem:aimem` |
| 共享主库 | `/data/ai-memory.db` **不存在**（未落到 config 的 db 键） |
| 会话 B（**新进程**） | `memory_recall` → `mode:hybrid` **命中标记**；`memory_search` 命中标记 |

附带实测：`useradd --system` 在 `node:22-bookworm-slim` 里**恰好**得到 `999:999`（与上游一致）—— 但这是巧合而非契约，**必须显式 `--uid 999 --gid 999` 钉住**（换底座即漂移，SSH 路径会随之写不进去）。

### E3 缺口 A：`/data/users` 属主 = root，非 root 门户建不出用户目录

现状（本地基线卷）：`/data` = `aimem:aimem 0755`，`/data/users` = **`root:root 0755`** —— 它由 `docker exec -u 0 … mkdir` 创建（[`mcp-design.md` §0.1](../../mcp/mcp-design.md) 冻结机制；[`deployment.md` §4.4/§4.5](../../deployment.md) 的 sudoers 规则亦为 `NOPASSWD: docker exec -u 0`）。

实测：

| 步骤 | 命令 | 结果 |
|---|---|---|
| 复现 | `-u 999:999 … install -d -m 0700 /data/users/beta-probe` | **被拒**（`cannot change permissions … No such file or directory` = EACCES） |
| 一次性引导 | `-u 0 … install -d -m 2775 -o root -g 999 /data/users` | 成功：`drwxrwsr-x root aimem` |
| 门户再建 | `-u 999:999 … install -d -m 0700 /data/users/beta-probe` | 成功：`aimem:aimem`（继承 setgid → 实际 `2700`） |

⇒ β′ 的**落地前置**：`/data/users` 必须允许 `aimem` 组写（setgid）。
⇒ 该改动**不新增任何既有行为者的能力**：`/data` 根与共享主库本来就是 `aimem:aimem` 可写，能写它们的进程同样能写新目录；唯一新增的能力者就是门户本身（设计意图）。
⇒ 副产品：**可以删掉** `deployment.md` §4.4 那条 `NOPASSWD: docker exec -u 0` 的 root 授权（净减一处 root 面）。

### E4 缺口 B：门户容器必须持有 LLM/embedding API key（否则静默降级）

`config.toml` 用 **`api_key_env` 只写环境变量名**（本部署实际变量 = `DASHSCOPE_API_KEY`，由 compose 的 `env_file: .env` 注入容器）。

| 运行方式 | 结果 |
|---|---|
| 不带 `--env-file`（仅三件套 env） | `Embed failed (401 Unauthorized): No API-key provided` → 日志 `no embeddings for HNSW index, using linear scan`；**工具仍返回成功**（只有一条 WARN） |
| 带 `--env-file deploy/.env` | 正常：语义召回 `mode:hybrid` 命中 |

⇒ 这正是既有**静默失败点 #1（embedder 降级）**在 β′ 下的触发形态。
⇒ β′ 门户必须注入该 key；建议门户用**独立 MaaS key**：`api_key_env` 只写名字，故**替换值无需改 config**，且可单独限额/吊销（把「公网组件持密」的半径限住）。
⇒ 对照：α 不需要门户持 key —— 子进程继承既有 MCP 容器的 `env_file`。

### E5 α 的「受限 socket 代理」不可行（否定性结论）

`Tecnativa/docker-socket-proxy`（业界主流，Alpine + HAProxy）的机制是**按 HTTP 方法 + URL 前缀**放行：

- `EXEC` 开关默认撤销，但 exec 的创建/启动端点本身是 **POST** ⇒ 要真正 exec 必须同时 `POST=1`（该类被文档列为「安全关键、须极其谨慎」）。
- 前缀 `CONTAINERS` 之下同时包含**创建容器**这类可致宿主提权的端点（`ALLOW_START` 可另行关闭，但「创建 + 重启策略」在宿主重启后自启仍是逃逸路径）。
- README **明确不支持**按容器名/ID 或命令内容过滤；并给出「不要暴露到公网、需 `--privileged` 运行代理」等约束（后者本身即扩大权限）。

⇒ 设计 §9 附录里「若采用 α，建议用受限 socket 代理（仅放行 exec 端点）替代裸 socket」**在本项目可达的组件范围内做不到**；选择 α 就等于接受**裸 socket 等价**（宿主 root）。

### E6 α 的机制在本仓已被现有探针覆盖

[`scripts/mcp-smoke.sh`](../../../scripts/mcp-smoke.sh) 与 [`scripts/probes/iso-probe.sh`](../../../scripts/probes/iso-probe.sh) 的会话调用即
`docker exec -i [-e AI_MEMORY_DB=… ] ai-memory-mcp ai-memory mcp --tier smart`。

⇒ α 不是「未验证的备选」，而是**已经在跑的机制**（差别只在「由谁发起」：SSH forced command / 门户经 socket）。
⇒ 反过来说：α 的收益不是「省一次镜像重建」，而是「**天然与运行中容器同版本**」（E7）。

### E7 β′ 的陈旧镜像风险有上游依据

[`ADR-005`](../../adr/ADR-005-upgrade-admission-gate-layering.md) 已核实：上游**不会**因「库比二进制新」而拒绝启动
（`src/storage/migrations.rs:1507`：`version >= CURRENT_SCHEMA_VERSION` 时直接 `return Ok(())`，全 `src` 无拒绝逻辑）。

⇒ 若门户镜像未随 `upstream.lock` 重建：新容器（或每库维护 cron）把用户库**前向迁移**后，旧门户二进制会**静默**操作它不认识的 schema（无报错、无告警）⇒ β′ 需要一条**版本断言**硬化。

## Lesson / guidance

### β′ 落地前置（4 条，缺一不可）

1. 底座 `bookworm` 系 + `ca-certificates`（实测 `ldd` 全解析）。
2. **显式** `useradd --system --uid 999 --gid 999 aimem`（不要依赖 `useradd` 的分配巧合）。
3. 构建平台钉 `linux/amd64`，镜像 tag 由 `upstream.lock` 注入（不手写）。
4. **版本断言**：门户启动时比对自身二进制版本与挂载的锁文件 / `IMAGE_TAG`，不一致即拒绝启动（对冲 E7）。

### 另两条

5. 一次性引导：`install -d -m 2775 -o root -g 999 /data/users`（此后可删 sudoers 的 root 规则）。
6. 密钥：门户用独立 MaaS key（同 env 名、不同值）。**必须与主 key 同 workspace / 同模型权限** —— 否则 embeddings 模型或维度不一致，同样静默降级；且**自检要断言「embeddings 可达 + 1024 维」，不能只断言「变量非空」**（E4 的失败形态就是"变量缺失但工具照常成功"）。
   若 MaaS 侧不能增签 key ⇒ 退回共用主 key，并把「公网组件持密」登记为残余风险 + 纳入轮换清单。

### 复用配方

E2 的 4 行 Dockerfile + 两个会话的 payload 就是「β′ 版 mcp-smoke」的最小实现 —— Sprint 4 可据此落成 `scripts/portal-probe.sh`（断言：8 工具 / 库落点 / 主库未触碰 / 跨进程召回）。

## Links

- 决议：[`adr/ADR-012`](../../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md) · 升级准入：[`adr/ADR-005`](../../adr/ADR-005-upgrade-admission-gate-layering.md)
- 设计：[`web-portal/web-design.md`](../../web-portal/web-design.md) §3（D1）· §9 附录（α）· 故事 [`web-stories.md`](../../web-portal/web-stories.md) S1 / S8 / S11 / S12 / S13
- 隔离冻结机制：[`mcp/mcp-design.md`](../../mcp/mcp-design.md) §0.1 · 目录与 sudoers：[`deployment.md`](../../deployment.md) §4.4/§4.5
- 上游事实：[`knowledge/upstream-ai-memory/upstream-facts-and-gotchas.md`](../upstream-ai-memory/upstream-facts-and-gotchas.md)
- 代理机制依据：`github.com/Tecnativa/docker-socket-proxy`（README：开关按方法/前缀、无按容器过滤、安全建议）
