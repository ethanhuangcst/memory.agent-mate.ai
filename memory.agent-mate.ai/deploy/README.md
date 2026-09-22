# deploy — 部署事实文件

> 完整部署步骤 / 配置 / 升级 / 备份 / 回滚见 [`../specs/deployment.md`](../specs/deployment.md)（唯一真相源）。本目录只放**事实文件**。

| 文件 | 作用 |
|---|---|
| `docker-compose.prod.yml` | 服务拓扑与 compose 契约（本地基线亦复用此文件） |
| `config.toml.tmpl` | 配置模板；落地时改名为 `config.toml` 并改三个必改点 |
| `.env.prod.example` | 密钥样例；落地时改名为 `.env`（`chmod 600`） |
| `portal.env.example` | **门户 stack** 环境文件样例（Sprint 4）；落地时改名为 `portal.env`（`chmod 600`）—— 与主 `.env` 分离，只放门户专用 MaaS key |

- 入仓事实文件共 **5 个**（上表 4 个 + 本 `README.md`）。派生文件 `config.toml` / `.env` / `portal.env`（服务器侧）与 `config.local.toml` / `.env.local`（本机开发）均**永不入仓**，由 `.gitignore` 的路径无关忽略规则覆盖。
- 合规性检查：`make secret-check`（密钥 / 公网 IP / 私有端点）。
