# architecture — memory.agent-mate.ai 产品架构

> **状态**：v2.0（specs 整合版） · as_of 2026-09-20
> **真相源**：版本坐标 [`../upstream.lock`](../upstream.lock)（唯一）· 决议见本文档 §2（唯一）· 部署动作 [`deployment.md`](./deployment.md) · MCP 侧能力 [`mcp/mcp-design.md`](./mcp/mcp-design.md) · 门户侧 [`web-portal/web-design.md`](./web-portal/web-design.md)
> **上游基准**：`v0.10.0`（制品层，schema 80）；参考层 clone `main` @ `96b8c694`（schema 81）。两条血脉提交图**不连通**（§4.3），版本差异只能用 releases API + CHANGELOG + 镜像指纹
> **边界**：本文档只定义**架构与决议**。不改上游源码；不含密钥与真实 IP（脱敏规则 §5.4）

---

## 0. 一句话

memory.agent-mate.ai = 上游 `ai-memory-mcp` 的**私有化部署 + 定制**（定制 = 配置 + 外围组件），通过两条接入路径对外提供记忆能力：**SSH stdio**（主人自用 / 保底）与**门户 HTTP MCP**（外部用户）；多用户隔离靠「**一用户一数据库**」，隔离由**服务端**钉死，门户对上游语义知识为零。

---

## 1. 产品定位与范围

| 项 | 内容 |
|---|---|
| 上游 | `ai-memory-mcp`（开源），镜像 `ghcr.io/alphaonedev/ai-memory:<tag>`，固定版本号 + 指纹双写 |
| 本产品 | 上游的私有化部署实例 + 一个自有产品面（**admin portal**） |
| 定制口径 | **配置 + 外围组件**；禁止改上游源码（例外须专门决议并登记） |
| 不做的 | 自助注册（邀请制）· 对外收费/计费 · 非 MCP 接入面 · 多租户 SaaS 账号体系 · 上游能力之外的二次开发 |

### 1.1 三条接入路径与「面」

| 面 | 主体 | 凭据 | 公网 | 设计文档 |
|---|---|---|---|---|
| 管理面（门户 UI / API） | 管理员 | Cloudflare Access（浏览器 SSO）+ 门户会话 | 仅 `<ADMIN_HOST>` | [`web-portal/web-design.md`](./web-portal/web-design.md) §5 |
| MCP 面（`<MCP_HOST>/mcp`） | 用户及其客户端 | `memo_` 令牌（`Authorization: Bearer`） | 仅 `<MCP_HOST>` | 同上 |
| SSH 面（stdio，保底） | 主人 / 运维 | SSH 密钥 + forced command | 无公网入口 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §5 |
| 上游 HTTP 面（`serve` 9077） | **不对外** | 绑 `127.0.0.1`，不映射主机端口，不设 `api_key` | 否 | [`deployment.md`](./deployment.md) §3 |

> **ai-memory 本体始终无公网入口**；新增的公网入口只属于门户面（`web-portal/web-design.md` §5）。

---

## 2. 决议单点

> 所有「已决 / 排除」集中在本节，其它文档只写「怎么做」并回链此处。

### 2.1 已决（10 条）

| # | 决策项 | 决议 | 理由（要点） | 代价 |
|---|---|---|---|---|
| 1 | 存储后端 | **SQLite 命名卷** | 官方镜像默认 features（`sqlite-bundled`），不含 `sal-postgres`；零定制 | 绑死单节点，不可横向扩 |
| 2 | 镜像 | 固定版本号 **+ 指纹双写**；**禁用 `latest`** | 防标签被重推（供应链） | — |
| 3 | tier | **`smart`** | 需要自动打标 / 归并 / 查询扩展 / 矛盾检测 | 每次写入触发 LLM 调用；需常驻 curator |
| 4 | LLM / Embedder | qwen 便宜档（主 `qwen-plus`、`[llm.auto_tag]` **只写 model** = `qwen-turbo`）；嵌入 `qwen3.7-text-embedding` **`dim = 1024`**；**必须显式覆盖 `base_url`** | 私有 MaaS workspace，qwen 别名默认公网端点不通 | API 费用；`dim` 无环境变量、只能写配置 |
| 5 | 客户端接入 | **stdio-over-SSH**（主人路径） | 调用者零依赖、零公网暴露 | 每次启动一次 SSH 握手 |
| 6 | 多用户 HTTP 接入 | 由 **admin portal** 承担（门户 spawn 子进程 + HTTP↔stdio 桥） | 上游**没有** MCP-over-HTTP | 新增公网面，需自建认证与限流 |
| 7 | 隔离形态 | **一用户一 DB**（方案 ③） | 方案 ②（单库 + per-user env）写路径**可伪造**（实测） | 每库需各自维护与备份 |
| 8 | 启动机制（门户） | **β′**：门户镜像内带上游二进制，子进程 spawn | α 需 docker socket ≈ root 等价，门户是公网组件 | 上游升级须重建门户镜像 |
| 9 | agent attestation | **关闭**（`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`） | v0.9 默认开启会 403 拒写，是可用性前提 | 写入标记为 `claimed`（自称） |
| 10 | 部署制品仓库 | **公开**仓 `ethanhuangcst/memory.agent-mate.ai` | 不污染上游 | 公开仓必须脱敏（§5.4） |

### 2.2 明确排除

| 方案 | 排除原因 |
|---|---|
| 复用自建 PostgreSQL | 官方镜像不含 `sal-postgres`，需自建镜像 + CI；**作为毕业路径保留**（[`deployment.md`](./deployment.md) §12） |
| 客户端「远程 MCP 直连 `https://…/mcp`」 | 上游**未实现**该端点（§4.2） |
| federation | 上游标记 beta，不建议无人值守生产；最终一致而非实时 |
| stdio→HTTP 转换网关 / 自研 REST→MCP 网关 | 违反「调用者零依赖」；或工作量最大且工具覆盖有缺口 |
| 上游 clone 用 submodule / 分支 overlay / fork | 摩擦大或事实上 fork（§5.3） |

---

## 3. 运行时架构

### 3.1 组件与数据流

```text
【管理面】浏览器 ──HTTPS──> Cloudflare Access ──> https://<ADMIN_HOST>/   门户 UI / API
【MCP 面】客户端 ──HTTPS──> 反向代理（TLS 终止，按 Host 分流）──> https://<MCP_HOST>/mcp
                                                        │  Authorization: Bearer memo_…
                                                        ↓
                                        ┌─── admin_portal 容器（唯一公网组件）───┐
                                        │ ① sha256(token) → {handle, status}   │
                                        │ ② 拼 env/argv（配置模板，非代码）      │
                                        │ ③ spawn 子进程 + HTTP MCP ⇄ stdio 桥  │
                                        │ ④ 会话结束 → kill 子进程             │
                                        └───────────────┬──────────────────────┘
                                                        │ spawn（一会话一进程）
                                                        ↓
                                          ai-memory mcp --tier smart（子进程）
                                            env  AI_MEMORY_DB=/data/users/<handle>/ai-memory.db
                                                 AI_MEMORY_AGENT_ID=human:<handle>
                                                 AI_MEMORY_KEY_DIR=/data/users/<handle>/keys
                                                 AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0

【SSH 面】ssh ai-memory（forced command）──> docker exec -i ai-memory-mcp ai-memory mcp --tier smart

持久化：命名卷 ai_memory_data → /data
        ├─ ai-memory.db（主人默认库）· /data/users/<handle>/ai-memory.db（用户库）
        ├─ .config/ai-memory/config.toml（HOME=/data 推导）· keys/ · .cache/huggingface/
        └─ backups/（本地快照，须外迁）
常驻：ai-memory（serve，绑 127.0.0.1:9077，后台 GC / WAL checkpoint）+ curator（智能整理）
```

### 3.2 两个 stack 的职责划分

| 维度 | `ai-memory-mcp`（既有） | `admin_portal`（新增） |
|---|---|---|
| 容器 | `ai-memory`（serve）+ `curator` | 门户 + 其 spawn 的 N 个子进程 |
| 服务对象 | 主人 / 运维（默认库） | 外部用户（每用户库） |
| 公网入口 | 否 | 是（经反代） |
| 数据卷 | `ai_memory_data` → `/data` | **同一卷**（共享文件，**不共享进程**） |
| 与对方的关系 | 不知道门户存在 | 只知道「一段模板」 |

> 「两边不依赖」的落地口径：**无共享进程、无 docker socket、无网络互调**。共享数据卷是「一个用户一份记忆」的必然要求，否则 SSH 与门户会读到两个库。

### 3.3 为什么读写不会「裂脑」

`mcp` 进程与 `serve` 守护进程**同机、同库**；多客户端 = 多 `mcp` 进程 = 官方明示的「WAL 多读 + 单写」场景。并发写压力大时可能出现 `database is locked` —— 这是毕业触发条件之一。

---

## 4. 上游契约面（架构层视角）

> **完整清单（A–K 约 60 个契约点）见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §9** —— 升级预检的 W3 判据逐项核对它。本节只登记架构层必须知道的三件事。

### 4.1 敏感度分级与头号风险

| 级别 | 含义 |
|---|---|
| **高（静默）** | 理解错了**不报错**，只是行为退化或数据风险 —— **必查，且必须用运行证据核对** |
| 中 | 会响亮失败（启动不了 / 报错） |
| 低 | 影响有限或易回退 |

> **静默失败是本部署的头号风险**，故敏感度按「是否静默」排序。三个经典静默失败点（embedder 降级 keyword / curator fail-open `tagged=0` / config 挂载错位退 semantic）+ 隔离侧的 **R1**（见 §6）构成「四个静默点」，每次改动后必查：[`deployment.md`](./deployment.md) §7。

**高敏感（静默）速查**：`HOME=/data`（config 路径唯一输入）· `AI_MEMORY_DB` · `DASHSCOPE_API_KEY` · `AI_MEMORY_LLM_*`/`AI_MEMORY_EMBED_*` 优先级高于 config · `serve` 无 `--tier`（档位只认 config）· `[llm.auto_tag]` 继承规则 · `[embeddings].dim` 必须显式（qwen 不在 `KNOWN_EMBEDDING_DIMS` 表内）· 解析优先级 CLI > env > config > 编译默认 · `AI_MEMORY_NO_CONFIG` 绝不能设。

### 4.2 上游文档缺陷（本地记录，不向上游反馈）

| # | 缺陷 | 后果 |
|---|---|---|
| 1 | `INSTALL.md` / `USER_GUIDE.md` 描述 `/mcp`、`/sse` 远程 MCP 端点，**不存在**（路由 SSOT 只有 `/api/v1/*` + `/metrics`；`server.json` 只声明 stdio） | 照抄配置 → 客户端连不上 |
| 2 | `CONFIG_SCHEMA.md` 的 `[llm.auto_tag]` 样例写 `backend = "ollama"` | 无 Ollama 机器上照抄 → auto_tag / 查询扩展 / 矛盾检测**静默全挂** |
| 3 | qwen 嵌入模型不在 `KNOWN_EMBEDDING_DIMS` 表内 | 不显式设 `dim` → 静默回落 768，维度不符 |
| 4 | schema 版本文档滞后（`CONFIG_SCHEMA.md` 写 78，源码 81；`server.json` version 滞后为 0.5.2） | 不可用于版本判断，**以源码与锁文件为准** |
| 5 | 上游 `main` 与 release tag 提交图不连通（§4.3） | 依赖 git 谱系的自动化全部失效 |

### 4.3 版本拓扑约束

- `git merge-base HEAD v0.10.0` 为空，GitHub API 明示「No common ancestor」；根提交消息相同、哈希不同 ⇒ **上游重写过历史**。
- **禁用 `git diff` / `git log <tag>..HEAD` 做版本差异**；只用 releases API + CHANGELOG + 镜像指纹（锁文件 digest）。
- 引用上游文档**一律用 release tag URL**（`blob/v0.10.0/…`）：不用 `main`（漂移），不用开发 commit（重写后断链）。
- 锁文件分别记录参考层 commit 与制品层 release commit；`make pin` 读锁文件（不再用 `git describe`）。

---

## 5. 仓库与资产边界

### 5.1 布局（协同布局）

```text
~/code/memory.agent-mate.ai/                 # 父仓（公开）remote: ethanhuangcst/memory.agent-mate.ai
├── .gitignore          # 第一行 ai-memory-mcp/；含密/派生文件用**路径无关**规则（**/deploy/.env 等）
├── Makefile            # 仓级基础设施（doc-links / secret-check / preflight / pin …）
├── .github/            # 平台强制路径
├── ai-memory-mcp/      # 上游嵌套 clone（gitignored，只读约定；make upstream 可重建）
├── admin_portal/       # 自有产品代码（门户）
└── memory.agent-mate.ai/                    # 自有资产（全部入库）
    ├── upstream.lock   # 版本坐标唯一真相源
    ├── deploy/         # 部署事实文件（compose / 模板 / 示例 env）
    ├── scripts/        # 探针与守卫脚本
    ├── backup/         # 备份脚本（Sprint 5 落地）
    └── specs/          # 本文档所在目录 = 全部 spec 的唯一真源
```

**判据**：任一文件要么属上游（`ai-memory-mcp/` 内），要么属本项目 —— **不存在第三种位置**。

**根目录例外（仅两类）**：`.gitignore` / `Makefile`（仓级基础设施）；`.github/`（GitHub 平台强制）。

### 5.2 仓库纪律

1. **上游 clone 只读**：不改任何被跟踪文件；想改上游的行为 ⇒ 落到 `memory.agent-mate.ai/` 的覆盖层（配置 / 脚本 / 文档结论）。
2. **引用上游文档用 URL + release tag**；仓内互引用相对路径（由 `make doc-links` 校验无悬空）。
3. **父仓记录上游版本**，唯一真相源 `upstream.lock`；升级后父仓 `git status` 必须仍干净。
4. **gitlink 陷阱**：`.gitignore` 必须在**任何 `git add` 之前**忽略 `ai-memory-mcp/`，否则 git 会记 mode 160000 坏引用。
5. **含密文件用路径无关忽略规则**，防止将来再次改名时失保护。

### 5.3 备选方案（已否决）

物理分仓（可行备选，代价是双工作区）· git submodule（摩擦大）· branch overlay（长期偏离 = fork）· fork（违背不改上游）。

### 5.4 公开仓脱敏规则

| 类别 | 处理 |
|---|---|
| key / AK / 私钥 / 密码 | 永不入仓；模板只含占位符 |
| 节点公网 IP | `<VPS4_IP>` / `<VPS3_IP>` / `<PG_HOST>` / `<MYSQL_HOST>` |
| 私有 MaaS 端点（含 workspace 标识） | `<QWEN_BASE_URL>` |
| 备份桶名 | `<OSS_BUCKET>` |
| 真实值归属 | gitignored 的 `memory.agent-mate.ai/secrets.local*.md`，**永不入仓** |
| 长期防线 | `make secret-check`（公网 IPv4 + `*.maas.aliyuncs.com`）+ pre-commit 钩子（`make hooks-install`）+ `make doc-links` |

---

## 6. 阻断级风险索引（门户上线前必须关闭）

| # | 风险 | 机制 | 级别 |
|---|---|---|---|
| **R1** | **多用户隔离静默失效 —— 所有用户共用同一个库** | `effective_db()` 只在「CLI/env 库路径**恰为默认值**」时才改用 config 的 `db`；而 config 写死共享主库 ⇒ 会话**漏设/写错** `AI_MEMORY_DB` 即落到共享主库，**无报错、无告警、无日志**（已获**行为级证据**：`rc=0` 且 `source=/data/ai-memory.db`） | 严重 |
| **R2** | 隔离完全依赖门户一处正确性，无纵深 | 上游无任何多租户授权边界：写路径无可见性过滤；macaroon 能力令牌 **additive-only**（只放宽不收紧） | 高 |
| **R3** | SSH 手工 forced command 的同类风险 | 每用户一条很长的单行命令，手工拼写易漏；且**难以审计**（逐行生效，错一次连带整文件） | 高 |

> R1 定级「严重」的理由：多数故障会报错能被发现，**R1 表现为「功能正常」**，只是所有人共享同一份记忆。

**防线与验证**：**D1** fail-closed 断言（`AI_MEMORY_DB` 非空 + 以 `/data/users/` 开头 + 含该 handle，否则拒绝启动会话）· **D2** 移除 config 模板的 `db` 键（消除 R1 落点，使漏设退化为 **fail-loud**）· **D3** 一会话一子进程禁池化 · **D4** 审计含解析出的库路径 · **D5** 上线前负向验收。对应验证 **V1（负向，准入门槛）/ V2 正向 / V3 交叉 / V4 解析链自检** —— 完整矩阵与探针见 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6。

---

## 7. 变更记录与相关文档

| 日期 | 变更 |
|---|---|
| 2026-09-19→20 | 决议与部署方案的历次结论（存储 / 镜像 / tier / LLM / 接入 / 备份 / 脱敏 / 隔离 / 门户）已并入本文档 §2 与 [`deployment.md`](./deployment.md)；逐日流水交 git 历史与 `knowledge/` |
| 2026-09-20 | **specs 整合**：`deployment_strategy.md` / `asset_isolation_plan.md` / `upstream_coupling_surface.md` / `dev-plan.md`（部分）并入本文档；决议集中为 §2 单点，契约面完整清单下沉 [`mcp/mcp-design.md`](./mcp/mcp-design.md) §9 |
| 2026-09-20 | **目录改名收口**：`hk_vps_4/` → `memory.agent-mate.ai/`，全仓路径引用同步；新增 `make doc-links` 防「删文档留悬空引用」复发 |

| 相关 | 用途 |
|---|---|
| [`deployment.md`](./deployment.md) | 部署 / 配置 / 升级 / 备份 / 回滚 / 排障 |
| [`mcp/mcp-design.md`](./mcp/mcp-design.md) | MCP 能力、多用户隔离、档位与工具、上游契约面全量 |
| [`mcp/mcp-test.md`](./mcp/mcp-test.md) | MCP 测试策略 + 计划 + 用例 |
| [`web-portal/web-design.md`](./web-portal/web-design.md) · [`web-stories.md`](./web-portal/web-stories.md) · [`web-test.md`](./web-portal/web-test.md) | 门户设计 / 故事 / 测试 |
| [`../upstream.lock`](../upstream.lock) · [`adr/`](./adr/) · [`knowledge/`](./knowledge/) | 版本坐标 · 架构决议 · 可复用知识 |
