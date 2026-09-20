# deploy — 部署事实文件

> 完整部署步骤 / 配置 / 升级 / 备份 / 回滚见 [`../specs/deployment.md`](../specs/deployment.md)（唯一真相源）。本目录只放**事实文件**。

| 文件 | 作用 |
|---|---|
| `docker-compose.prod.yml` | 服务拓扑与 compose 契约（本地基线亦复用此文件） |
| `config.toml.tmpl` | 配置模板；落地时改名为 `config.toml` 并改三个必改点 |
| `.env.prod.example` | 密钥样例；落地时改名为 `.env`（`chmod 600`） |

- `config.toml` / `.env` 为**派生文件**，路径无关忽略规则已覆盖（永不入仓）。
- 合规性检查：`make secret-check`（密钥 / 公网 IP / 私有端点）。
