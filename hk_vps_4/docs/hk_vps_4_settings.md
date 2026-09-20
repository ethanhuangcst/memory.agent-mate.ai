# 野草云4 — 运维方案与资源清单（与野草云3 平台层同构）

> **节点**：野草云4 · `68.64.176.124`  
> **角色**：应用/边缘节点（与 [野草云3]() **同一套部署方式**，供未来应用迁入/新建）  
> **状态**：**平台层已落地**（Docker + `portainer_network` + Portainer + NPM + GHCR registry + 运维域名 HTTPS）  
> **原则**：本文件不写密码 / Token。SSH / 管理台账号见本机 [`secrets.local.hk_vps_4.md`](./secrets.local.hk_vps_4.md)（gitignore）。  
> **对齐基准**：[``]() §0 标准运维方案。  
> **as_of**：2026-08-12（SSH 实机）

---

## 0. 标准运维方案（与野草云3 相同）

野草云4 建成后，应用发布必须走与野草云3 **同一套路**，以便任意 app 可按同一手册迁到本节点。

### 0.1 平台层（已落地）

| 组件 | 作用 | 本机事实 |
| --- | --- | --- |
| Docker Engine | 跑容器 | Debian 13 · Docker `29.7.2` + Compose `v5.4.0` |
| 外部网络 `portainer_network` | 同节点互通；NPM 用容器名反代 | **已创建；禁止删建** |
| Portainer CE | Stack 部署/更新 | 目标 `https://portainer4.agent-mate.ai` → `portainer:9443` |
| Nginx Proxy Manager | TLS + 反代 + Custom Locations | `80`/`443`/`81`；目标 `https://nginx4.agent-mate.ai` → `:81` |
| Cloudflare | DNS | 各应用域名 A/CNAME → **`68.64.176.124`** |

平台层 Compose：`/root/service-compose.yaml`，`networks.default.name: portainer_network`（`external: true`）。

### 0.2 应用如何部署（固定套路 — 复制自野草云3）

1. CI → GHCR 镜像；边缘 **只 pull**，不 `docker build` 应用镜像。  
2. Compose：`image:` only；`external: true` + `portainer_network`。  
3. Portainer：独立 `<STACK_NAME>` + 本应用 env（含真实存在的 `IMAGE_TAG`）。  
4. 主库在**外部** DB；先连通再迁移；可选本机 Qdrant / 辅助库。  
5. Cloudflare（仅本域名）→ 本节点 IP；NPM Proxy Host 上游用**容器名:容器端口**。  
6. 隔离门禁 + 发布后抽查既有应用；回滚只动本应用。  
7. Stack recreate 后：NPM 对该 Host **再 Save**；agent 类服务验 `/healthz`。

手册：`knowledge/`（`03-semi-auto-release.md`、`09-isolation-safety.md`）。

### 0.3 与野草云3 的分工

| | 野草云3 | 野草云4 |
| --- | --- | --- |
| IP | `38.55.192.140` | `68.64.176.124` |
| 现网应用 | hcp / mypoke / kb（+ media 规划） | **空**（平台建好后承接新 app 或迁移） |
| Portainer / NPM 域名 | `portainer.agent-mate.ai` / `nginx.agent-mate.ai` | `portainer4.agent-mate.ai` / `nginx4.agent-mate.ai` |
| 外部 DB | 可继续用现有阿里云/独立 MySQL，或新建库 | 按应用新建库名；勿混用他应用库 |

### 0.4 域名与 Cloudflare zone 约定

> **2026-09-19 更正。** 早期文档曾把应用域名约定为 `{appname}.qiuge.me`（zone `qiuge.me`）。该 zone **不在本项目控制范围内**，此约定作废。
>
> 现行约定：**应用与运维入口共用 `agent-mate.ai` zone，仅以子域区分。**

```text
<APP_DOMAIN> = {appname}.agent-mate.ai      # 例：jobhunt.agent-mate.ai
Cloudflare zone = agent-mate.ai             # 应用与运维共用
DNS Name 栏只填 {appname}                    # 不要填 FQDN
```

**保留子域（禁止占用，除非运维书面批准）：**

| 子域 | 用途 |
| --- | --- |
| `portainer4` / `nginx4` | 野草云4 运维入口 |
| `portainer` / `nginx` | 野草云3 运维入口 |
| `@`（apex） / `www` | 根域与外网主入口 |
| `mail` / `api` / `admin` / `status` | 常规基础设施名 |

**隔离判据（由「跨 zone 隔离」更正为「同 zone 内子域唯一」）：**

1. 本应用 `{appname}` 不在保留清单；
2. 不与野草云3/4 任何既有应用子域重名；
3. **只**新增本应用的一条 DNS 记录与 NPM 一条 Proxy Host；
4. 不改动 `portainer4` / `nginx4` 及其他应用记录。

细则见 [`vps4_new_deployment_instruction.md`](./vps4_new_deployment_instruction.md) §0。

---

## 1. 主机概览

| 项 | 值 |
| --- | --- |
| 公网 IP | `68.64.176.124` |
| SSH | user `root`（密码见 secrets.local；建议改 key） |
| Hostname | `qiuge` |
| OS / Kernel | Debian GNU/Linux 13 (trixie) · `6.12.57+deb13-cloud-amd64` |
| CPU / Memory / Disk | 4 vCPU · 7.8 GiB · `/` 89G |
| Timezone | `Asia/Shanghai` |
| Docker 外部网 | `portainer_network`（创建后禁止删建） |

说明：基线文档曾写「目标 Ubuntu LTS」；实机为 **Debian 13**，与野草云3 发行版不同，平台栈（Docker / Portainer / NPM）用法一致。

---

## 2. 共享运维栈（Stack: `root` · 已部署）

| 服务 | 容器名 | 镜像 | 主机端口 | 域名 | 持久化 |
| --- | --- | --- | --- | --- | --- |
| Portainer CE | `portainer` | `portainer/portainer-ce:lts` | `9443`、`8000` | `portainer4.agent-mate.ai` → `https://portainer:9443` | volume `root_portainer_data` + docker.sock |
| Nginx Proxy Manager | `root-nginx-proxy-manager-1` | `jc21/nginx-proxy-manager:latest` | `80`、`443`、`81` | `nginx4.agent-mate.ai` → `:81` | `/root/data`、`/root/letsencrypt` |

Compose：`/root/service-compose.yaml`。

### NPM Proxy Hosts

| 域名 | 上游 | SSL |
| --- | --- | --- |
| `portainer4.agent-mate.ai` | `https://portainer:9443` | Let's Encrypt · Force SSL |
| `nginx4.agent-mate.ai` | `http://root-nginx-proxy-manager-1:81` | Let's Encrypt · Force SSL |

Cloudflare：上述两子域 A → `68.64.176.124`，**DNS only（灰云）**（申请证书时）。

上游一律**容器名**，不要写宿主机公网 IP。

### Portainer Registry

| Name | URL | Auth |
| --- | --- | --- |
| `ghcr.io` | `ghcr.io` | 当前无认证（已验证可匿名 pull 公开包）；私有包再补 `read:packages` PAT |

### 公网端口说明

云厂商安全组目前 **仅放行约 22/80/443**（本机可达 `:80`；公网直连 `:81`/`:9443` 超时）。生产管理入口应走域名 `:443`（NPM）；临时管理用 SSH 隧道：

```bash
ssh -L 9443:127.0.0.1:9443 -L 8181:127.0.0.1:81 root@68.64.176.124
# 然后 https://127.0.0.1:9443 与 http://127.0.0.1:8181
```

---

## 3. 应用占用总览（当前：空）

| Stack / 项目 | 状态 | 公网域名 | 主机端口 | 本机数据 | 外部库 |
| --- | --- | --- | --- | --- | --- |
| （无） | — | — | — | — | — |

新应用迁入时：选空闲主机端口段、独立 Stack 名、独立 `<APP_DOMAIN>`、独立 `<DB_NAME>`，流程同野草云3 §0.2。

---

## 4. 按应用明细

（尚无应用。部署后按野草云3 §4 同级表格追加。）

---

## 5. 主机端口分配表

| 端口 | 用途 | 状态 |
| --- | --- | --- |
| 22 | SSH | 使用中 |
| 80 / 443 | NPM | **占用** |
| 81 | NPM Admin | **占用**（建议仅隧道/域名访问） |
| 8000 / 9443 | Portainer | **占用**（建议仅隧道/域名访问） |
| 3001+ | 应用 web 入口 | **空闲，按应用分配** |
| 3200+ | MCP / RAG 等 | **空闲，按应用分配** |
| 6333+（建议 `127.0.0.1`） | Qdrant 等 | **空闲，按应用分配** |

与野草云3 **端口数字无需一致**（两机独立）；惯例保持「web 3xxx / agent·rag 32xx / qdrant 回环 63xx」。

---

## 6. Docker 卷与本机路径

| 路径 / Volume | 用途 |
| --- | --- |
| `root_portainer_data` | Portainer |
| `/root/data` · `/root/letsencrypt` | NPM |
| `/root/service-compose.yaml` | 平台 compose |
| `/opt/<app-slug>/` | 各应用 compose + `.env`（按需） |

---

## 7. 外部数据库

本节点不默认跑主库。新应用：

- 在现有 Postgres `101.132.156.250` 或 MySQL `38.55.199.241` **新建独立库**，或另购实例；  
- **禁止**复用野草云3 上其他应用的库名；  
- 连接串只进节点/本机 `.env`，不进 Git。

---

## 8. 镜像

平台：`portainer/portainer-ce:lts`、`jc21/nginx-proxy-manager:latest`。  
应用：一律 GHCR（或约定 registry）CI 制品。Portainer 已登记 `ghcr.io`。

---

## 9. 网络

唯一应用互通网：`portainer_network`（bridge）。

| 容器 | IPv4 |
| --- | --- |
| `root-nginx-proxy-manager-1` | `172.18.0.2/16` |
| `portainer` | `172.18.0.3/16` |

禁止删除/重建该网。

---

## 10. 落地待办与验收

### 平台项

- [ ] SSH key 登录；轮换曾明文出现的 root 密码  
- [x] 系统探活 + 安装 Docker（Debian 13）  
- [x] 创建 docker network `portainer_network`  
- [x] 部署 Stack `root`：Portainer + NPM（`/root/service-compose.yaml`）  
- [x] 初始化 Portainer / NPM admin（密钥仅 `secrets.local`）  
- [x] Cloudflare：`portainer4` / `nginx4` A → `68.64.176.124`（灰云）  
- [x] NPM：为上述子域建 Proxy Host（上游已配）  
- [x] NPM：Let's Encrypt + Force SSL；验收 `https://portainer4.agent-mate.ai` / `https://nginx4.agent-mate.ai`  
- [x] Portainer Registries：`ghcr.io`（当前无 PAT；公开包可 pull）  
- [ ] 用一本 release-job（任意新 app）走通：GHCR → Stack → DNS → NPM → 冒烟  
- [x] 实机回填本文 §1 Hostname/规格、§2 域名定稿、§9 网络成员  

### 验收清单（平台层）

| 项 | 结果 |
| --- | --- |
| Docker Engine + Compose | 通过 |
| `portainer_network` | 通过 |
| 容器 `portainer` / `root-nginx-proxy-manager-1` running | 通过 |
| 本机 `curl -k https://127.0.0.1:9443` / `http://127.0.0.1:81` | 通过 |
| `ghcr.io` registry 已登记 | 通过 |
| 运维域名 HTTPS | 通过（LE + Force SSL） |

---

## 11. 运维注意

1. 与野草云3 **相同隔离规则**；两机互不影响，DNS 切节点时只改目标应用记录。  
2. 禁止删建 `portainer_network`。  
3. `IMAGE_TAG` = GHCR 真实 tag（ADR-002）。  
4. Agent 类服务 recreate 后 NPM Save + `/healthz`（ADR-003）。  
5. 密码只放 `secrets.local.hk_vps_4.md` / 密码管理器，不写进本文件。  
6. 勿触碰野草云3（`38.55.192.140`）任何 Stack / NPM / DNS。

---

## 12. 来源

- 用户提供：公网 IP `68.64.176.124`、SSH `root`（密钥文件）  
- 方案对齐：[``]()  
- 手册：`knowledge/` · ADR-002 / ADR-003
