# memory.agent-mate.ai — ai-memory 部署资产（野草云4）

ai-memory 的**薄部署资产**（公开父仓 `memory.agent-mate.ai` 的 `hk_vps_4/deploy/`）：不构建镜像，只消费上游官方镜像。
本目录内容将按 [`asset_isolation_plan.md`](../docs/asset_isolation_plan.md) §8 迁至父仓 `hk_vps_4/deploy/`。

- 上游：<https://github.com/alphaonedev/ai-memory-mcp> —— 嵌套 clone 位于父仓 `../ai-memory-mcp/`（gitignored，**只读约定**，永不修改；`make upstream` 可重建）
- 方案文档（真相源）：`hk_vps_4/docs/deployment_strategy.md`（迁移后路径）
- 节点：野草云4 · `<VPS4_IP>` · Debian 13 · 4 vCPU / 7.8 GiB

> **公开仓库纪律**：任何 key / AK / 密码 / 私钥不入仓；节点 IP 写 `<VPS4_IP>` 占位符；模板只含占位符，真实值在服务器 `.env` / 密码管理器。

## 文件

| 文件 | 用途 |
|---|---|
| `docker-compose.prod.yml` | Portainer Stack 定义（serve + curator 两个 service） |
| `config.toml.tmpl` | 复制为 `config.toml` 后填入真实值 |
| `.env.prod.example` | 复制为 `.env` 后填入真实值 |
| `deployment-plan.md` | release-bot 主输入 |
| `backup/` | 备份脚本（backup-and-push / restore-drill，见 §备份） |

## 服务器侧布局

```text
/opt/ai-memory-mcp/
├── docker-compose.prod.yml
├── config.toml          # 由 config.toml.tmpl 填充；:ro 挂载进容器
├── .env                 # 由 .env.prod.example 填充；不进 Git
└── backups/             # 快照（需定期外迁，见下）
```

## 架构要点（为什么长这样）

- **无公网 HTTP 入口**：客户端走 **stdio-over-SSH**（`ssh → docker exec -i → ai-memory mcp`）。因此不需要域名 / NPM / HTTPS / api_key。
- **无公网端口映射**：`serve` 只绑容器内回环，仅供后台 GC / WAL checkpoint。
- **配置路径由 `$HOME` 推导且无法改写**：compose 设 `HOME=/data`，配置、密钥、HF 模型缓存全部落入持久卷。挂错位置会被**静默忽略**。
- **`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`**：v0.9 默认开启会 403 拒绝无签名写入——这是可用性前提。

## 首次部署

```bash
# 1. 服务器侧准备
ssh <vps4>
mkdir -p /opt/ai-memory-mcp && cd /opt/ai-memory-mcp
# 放入 compose / config.toml / .env（真实值）

# 2. 建权限受限用户（不用 root）
useradd -m -s /bin/bash aimem-ssh
usermod -aG docker aimem-ssh

# 3. authorized_keys（forced command，密钥只能跑这一条命令）
#    注意 no-pty；docker exec -i 不加 -t（pty 会破坏 stdio 帧）
cat >> /home/aimem-ssh/.ssh/authorized_keys <<'EOF'
command="docker exec -i ai-memory-mcp ai-memory mcp --tier smart",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding ssh-ed25519 AAAA... cursor@laptop
EOF

# 4. Portainer → portainer4.agent-mate.ai → Stacks → Create（仅 ai-memory-mcp）
#    隔离门禁：不重建 portainer_network；不新增 DNS / NPM Host（本方案无域名）
```

## 调用者侧（Cursor）

`~/.ssh/config`：

```
Host ai-memory
    HostName <VPS4_IP>
    User aimem-ssh
    IdentityFile ~/.ssh/ai_memory_cursor_ed25519
    IdentitiesOnly yes
    ServerAliveInterval 30
```

`~/.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "ai-memory": {
      "command": "ssh",
      "args": ["ai-memory", "docker exec -i ai-memory-mcp ai-memory mcp --tier smart"]
    }
  }
}
```

> API key 只需在服务器 `.env` 配一次（`docker exec` 继承容器环境），无需写进每个客户端。

## 冒烟与验收

```bash
docker ps --filter name=ai-memory-mcp --format '{{.Status}}'
docker exec ai-memory-mcp curl -sf http://127.0.0.1:9077/api/v1/health
docker exec ai-memory-mcp ai-memory doctor     # 核对 LLM / Embeddings Reachability 两节

# 预演 curator（零写入）
docker exec ai-memory-mcp-curator ai-memory curator --once --dry-run --json
# 核对 tagged > 0，否则 curator 处于静默失效状态
```

三个最容易静默失败的环节，**每次改动后都要核对**：

1. Embedder 初始化失败 → 召回降级为 keyword，**不报错**（看 boot banner / doctor）
2. curator 解析不到 LLM key → 每轮 `tagged=0`，**不报错**
3. config 挂载路径错误 → tier 退回 semantic，**不报错**

## 备份（默认方案：本地快照 + 外迁）

```bash
# 本地快照（小时级 cron）
docker exec ai-memory-mcp ai-memory backup --to /data/backups --keep 48
docker exec ai-memory-mcp ai-memory restore --from /data/backups
```

`/data/backups` 与 DB 同卷，属同一故障域 —— **必须外迁才闭环**。

外迁：cron + **ossutil** → 阿里云 OSS **香港 region** 私有桶（开 SSE）。脚本置于本仓库 `backup/`：

- `backup-and-push.sh` — `ai-memory backup` → 校验 manifest sha256 → `ossutil cp` → **回读远端 hash 比对** → 失败非零退出 + 日志
- `restore-drill.sh` — 从 OSS 拉最新快照 → sha256 校验 → `ai-memory restore` → doctor 通过。**每季度跑一次；未演练过的备份不算备份**

云资源一次性准备：私有桶（香港 + SSE）+ RAM 子账号（**仅** `oss:PutObject/GetObject/ListObjects`，资源限定 `acs:oss:*:*:<bucket>/<prefix>/*`）；AK 走 `0400` 文件或环境变量，**永不进 argv、永不入仓**。

> 多租户备份 MCP（mcp.oss-bak.com）已另建项目，不在本部署关键路径；其需求规格见 `docs/mcp_oss_bak_com_requirements.md`（若该文档随资产迁移入本仓库）。

## 升级 / 回滚

### 升级预检清单（每次升级逐项过）

- [ ] **升级门禁：无新鲜外迁备份，不升级** —— 确认 OSS 上最新快照的时间戳与 sha256（`ossutil ls` + 比对）
- [ ] 读上游 CHANGELOG，核对三类破坏性变更：
  - **secure-by-default 翻转**（历史证据：v0.9 attestation 翻转）→ 重验 `.env` / `config.toml` 每项假设
  - **config schema 变更** → `ai-memory config migrate --dry-run`
  - **CLI / MCP 契约变更** → 核对 `backup`/`restore` 参数（影响 backup/ 恢复演练脚本）与 Cursor MCP args（`--tier`/`--profile core`，Cursor 40 工具上限）
- [ ] 本地灰度：用生产快照副本对新镜像先跑一遍迁移，观察迁移日志

```bash
# 生产升级：改 .env 的 IMAGE_TAG（GHCR 真实存在的 tag）→ Portainer Recreate（勾选重新拉取）
# 迁移自动执行；迁移前自动在同目录生成 pre-migration 快照
# 回滚：停容器 → 用 pre-migration 快照覆盖 /data/ai-memory.db（清掉 -wal/-shm）→ IMAGE_TAG 改回旧版 → Recreate
```

### 升级后必做

1. doctor 三静默失败点核对（§上）
2. **备份管线探针**：手动跑一次 `ai-memory backup` + 确认 ossutil 上传成功（验证 `backup` CLI 契约在新二进制下未变）
3. 部署仓库 `deployment-plan.md` 的 IMAGE_TAG ↔ 上游 tag 映射更新

## 已知上游陷阱（详见方案文档 §7）

- `docs/INSTALL.md` / `docs/USER_GUIDE.md` 描述的 `/mcp`、`/sse` 端点**不存在**（路由 SSOT 与源码均已核实）——不要按那两节配置远程直连
- `docs/CONFIG_SCHEMA.md` 样例的 `[llm.auto_tag] backend = "ollama"` 在无 Ollama 机器上会打挂 LLM 类功能
- DashScope embedding 模型不在 `KNOWN_EMBEDDING_DIMS` 表内，`dim` 必须手工核对
