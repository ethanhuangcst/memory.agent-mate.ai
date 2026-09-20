# 耦合面清单 — memory.agent-mate.ai ↔ 上游 ai-memory-mcp

> **用途**：本部署依赖上游的**每一个契约点**在这里显式登记。升级预检时逐项核对，不靠记忆。
> 这是「最小耦合」的**可执行载体**：没有这张表，"最小耦合"就只是一句口号。
> **状态**：v1.0 · as_of 2026-09-20 · 依据上游 clone HEAD `96b8c694`（`Cargo.toml` 0.10.0，`CURRENT_SCHEMA_VERSION` = 81）
> **版本坐标**：不写在本文件里，一律以 [`../upstream.lock`](../upstream.lock) 为准
> **关联**：`deployment_strategy.md`（决议真相源）· `dev-plan.md` §5（升级策略）· `../scripts/upstream-preflight.sh`（自动检测）

---

## 1. 怎么用这张表

### 1.1 敏感度分级

| 级别 | 含义 | 升级时的动作 |
|---|---|---|
| **高** | 理解错了会**静默**失效（不报错、只是行为变了）或造成**数据风险** | 必查，且必须用**实际运行证据**核对，不能只读文档 |
| **中** | 理解错了会**响亮失败**（启动不了 / 报错 / 功能明显不可用） | 查当次升级的契约面差异报告即可 |
| **低** | 影响有限或易于回退 | 抽查 |

> **为什么把"静默"单列**：本项目已有三个静默失败点（embedder 降级、curator fail-open、config 挂载路径错误），全部是"服务看起来正常、实际能力退化"。**静默失败是本部署的头号风险**，因此敏感度按「是否静默」而非「是否严重」排序。

### 1.2 每行的读法

- **依赖什么** — 我们实际用到的具体值/行为（不是上游的完整能力）
- **错了会怎样** — 上游若改动该契约点，我方会出现什么症状
- **怎么检测** — 具体命令或方法；标 `[自动]` 的由 `upstream-preflight.sh --with-image` 覆盖
- **上游位置** — 源码路径:行号（可据此在任意版本复核）

---

## 2. 契约点清单

### A. 镜像与容器形态

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| A1 | `ENTRYPOINT ["ai-memory"]`——二进制度量衡入口，`docker exec … ai-memory <子命令>` 与 compose `command:` 都建立在它之上 | **高** | 若改成别的入口（如 `ENTRYPOINT ["/entrypoint.sh"]`），compose 的 `command: ["serve","--host",...]` 与 SSH forced command 的 `docker exec -i <c> ai-memory mcp` **同时断** | `docker image inspect <img> --format '{{.Config.Entrypoint}} {{.Config.Cmd}}'` | `Dockerfile:58` |
| A2 | 默认 `CMD ["serve","--host","0.0.0.0"]` | 中 | 若上游把 CMD 改短或改绑行为，我方 compose **已显式覆盖**为 `127.0.0.1`（不依赖默认值），影响面小 | `docker image inspect … .Config.Cmd`；升级后确认容器内监听地址 | `Dockerfile:59`；覆盖处 `../deploy/docker-compose.prod.yml:17` |
| A3 | `VOLUME /data` 且 `chown aimem:aimem /data`；`USER aimem` | 中 | 卷属主/路径变更 → 写入失败（**响亮**，不会静默） | `docker exec <c> ls -ld /data`；`id` | `Dockerfile:46-47,53,56` |
| A4 | `EXPOSE 9077`（我方不映射主机端口，仅在容器内回环） | 低 | 端口号变更 → 我方 `serve --port` 与 health 探针端口失配（**响亮**） | `docker exec <c> curl -sf http://127.0.0.1:9077/api/v1/health` | `Dockerfile:54` |
| A5 | 编译特性 = **默认 features（`sqlite-bundled`），不含 `sal` / `sal-postgres`** | **高** | 若上游把默认 features 改成需要外部 `store-url`，则本部署的"SQLite 命名卷"形态失效（启动失败，**响亮**） | `docker exec <c> ai-memory doctor` 看存储后端；或 `docker run --rm <img> ai-memory --version` | `Dockerfile:29`；`Cargo.toml:255-261` |
| A6 | 运行时基线 `debian:bookworm-slim` | 低 | glibc 变更极少引发问题 | `docker exec <c> cat /etc/os-release` | `Dockerfile:10,32` |
| A7 | 镜像标签语义：release workflow 推送 `<version>` 与 `latest` 两个 tag；**prerelease 不推送任何镜像** | 中 | 若上游改成只推 `latest`，我方"禁用 latest"策略需换坐标；prerelease 无镜像属**预期行为**（不是缺陷） | `make preflight ARGS=--with-image`；或 packages 页面 | `.github/workflows/release.yml:722,753-755` |

### B. 环境变量（compose `.env` + `environment:`）

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| B1 | **`HOME=/data`** 是 config 路径的**唯一**输入（配置路径 = `$HOME/.config/ai-memory/config.toml`，**没有任何环境变量能改写该路径**；`AI_MEMORY_NO_CONFIG` 是"整体跳过加载"的开关，不是改路径） | **高·静默** | `HOME` 与只读挂载点不一致 → config **被静默忽略** → `tier` 退回默认 `semantic`、`[llm]`/`[embeddings]` 全部不生效。表现为"服务正常但不会打标/不走向量" | 升级后：`docker exec <c> env \| grep ^HOME=`；`docker exec <c> cat /data/.config/ai-memory/config.toml`（确认能读到）；`doctor` 看 tier | 推导 `src/config.rs:6862-6865`；跳过开关 `:6868-6872` |
| B2 | `AI_MEMORY_DB=/data/ai-memory.db` | 中 | 路径变更 → 建新空库（**静默！**表现为"记忆全不见了"）。这正是 `HOME` 之外第二个必须在升级后复核的路径类契约 | `docker exec <c> ls -l /data/*.db`；`ai-memory stats` 计数是否与升级前一致 | `src/daemon_runtime.rs:88`（默认）、`:137`（clap env）；`Dockerfile:51` |
| B3 | **`AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`** —— v0.9 起默认收紧，不设即拒写 | **高** | 不设 → HTTP 直写 `403 ATTESTATION_FAILED`；MCP 侧在 0.9.0 上同样被拒（该版本 require-everywhere 是上游已自承的缺陷，0.10.0 才改为 surface-scoped） | 写入一条记忆，检查返回的 `attest_level` 为 `claimed` 而非 403 | `src/security_profile.rs:177`（定义）、`:42`（消费）；`src/handlers/create.rs:1336,1379` |
| B4 | **`DASHSCOPE_API_KEY`**（`QWEN_API_KEY` 为等价回退）—— `[llm]` 与 `[embeddings]` 共用 | **高·静默** | 缺失/失效 → embedder 初始化失败**静默降级为 keyword**（召回质量下降但不报错）；curator fail-open（每轮 `tagged=0`，不报错） | `docker exec <c> ai-memory doctor`，核对 **LLM Reachability** 与 **Embeddings Reachability** 两节均显示 `qwen:<model>` | 回退链 `src/config.rs:6656,6715`；文档 `docs/ADMIN_GUIDE.md:280,346` |
| B5 | **`AI_MEMORY_LLM_*` / `AI_MEMORY_EMBED_*` 系列环境变量优先级高于 `config.toml`**（解析序：CLI flag > env > config > 编译默认） | **高·静默** | 若有人往 `.env` 里加了 `AI_MEMORY_EMBED_MODEL` / `AI_MEMORY_LLM_MODEL`，会**静默覆盖** `config.toml` 的 `[embeddings].model` / `[llm].model` —— 配置文件看起来是对的，实际生效的是 env | `docker exec <c> env \| grep -E '^AI_MEMORY_(LLM\|EMBED)_'`（**期望为空**）；`doctor` 显示的模型名 | `src/config.rs:4443-4462`、`:7721-7799`、`:7897-8020`；优先级文档 `docs/CLI_REFERENCE.md:52-53` |
| B6 | `AI_MEMORY_EMBED_BACKFILL_BATCH`（我方用 config 而非 env） | 低 | 越界（1..=10000 之外）会 WARN 并回落到 100，不致命 | `doctor` | `src/config.rs:4462`、`:7953-7969` |
| B7 | `AI_MEMORY_PROFILE`（`mcp --profile` 的 env 回退；未设 → `core`） | 中 | 若在 `.env` 里设了它，会改变 MCP 暴露的工具集（core 7 / full 101），可能超出客户端工具上限 | `echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \| ssh ai-memory` 数工具个数 | `src/daemon_runtime.rs:194` |
| B8 | **`AI_MEMORY_NO_CONFIG` 绝不能设置** | 中 | 设了 → `config.toml` 被完全跳过，tier/LLM/embedding 全部退回默认（**静默**） | `docker exec <c> env \| grep AI_MEMORY_NO_CONFIG`（期望无输出） | `src/config.rs:6868-6872` |
| B9 | `AI_MEMORY_REQUIRE_API_KEY`（本方案**不设**，因无公网 HTTP 入口） | 中 | 语义：真值 → 即使回环也必须配 `api_key` 否则**拒绝启动**；回环无 key 否则仅 WARN。若未来开放 HTTP 入口，此项与顶层 `api_key` 必须同时补 | `docker exec <c> env \| grep AI_MEMORY_REQUIRE_API_KEY` | `src/daemon_runtime.rs:4209-4213,4227-4266` |
| B10 | `RUST_LOG`（日志级别） | 低 | 仅影响可观测性 | — | `src/logging.rs:3343` |

> **其它 `AI_MEMORY_*`**：上游共约 90 个（`src/config.rs:4230-4470` 为常量 SSOT，另有字面量散落）。**本清单一律只登记我方实际依赖的点**——这正是"最小耦合"的含义：不追求覆盖上游全集，而是明确"我只踩这几块砖"。

### C. CLI 子命令与参数（compose `command:` / SSH forced command / 运维脚本）

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| C1 | `serve` 的 **`--host` / `--port`**，且 **`serve` 没有 `--tier`**（档位只能来自 `config.toml` 顶层 `tier`） | **高·静默** | 若上游给 `serve` 加 `--tier`，则"配置里写的 tier"与"实际档位"可能出现两个来源；反之若上游把 `serve` 的 tier 来源改成别的字段，我方 `config.toml` 的 `tier = "smart"` 会**静默失效** | `docker exec <c> ai-memory doctor` 看 tier；`ai-memory serve --help` | 定义 `src/daemon_runtime.rs:781-888`；无 tier 的说明串 `:163-172` |
| C2 | `mcp --tier smart`（写死在调用者 `~/.ssh/authorized_keys` 的 forced command 与 `~/.cursor/mcp.json` 里） | **高** | flag 改名/移除 → MCP 通路断裂（**响亮**，客户端直接报错）；但若上游改了 `--tier` 的取值集合，则可能**静默**跑在别的档位 | `echo '<initialize>' \| ssh ai-memory`；`ai-memory mcp --help` | `src/daemon_runtime.rs:174-196` |
| C3 | `curator --daemon --interval-secs 3600 --max-ops 50` | **高** | flag 改名/移除 → curator 容器起不来（**响亮**）；若 `--max-ops` 语义变化（现默认 100），成本会变；若 `--interval-secs` 钳位区间变化（现 `[60,86400]`）则周期与预期不符 | `docker logs ai-memory-mcp-curator`；`docker exec ai-memory-mcp-curator ai-memory curator --once --dry-run --json` 核对 `tagged > 0` | `src/cli/curator.rs:24-105`；`SECS_PER_HOUR` `src/lib.rs:30` |
| C4 | `doctor` | 低 | 若被移除，我方冒烟脚本失据（**响亮**） | `ai-memory doctor --help` | `src/daemon_runtime.rs:653-695` |
| C5 | **`backup --to <dir> --keep 48`** | **高** | 参数改名 → 备份脚本与非零退出码检测断裂（**响亮**）；若 `--keep` 默认值语义从"保留 N 份"变成别的 → 轮换失效，可能**静默**堆积或**静默**删多 | `ai-memory backup --help`；比对 `deployment_strategy.md` §5.4 记录的 `--help` 快照 | `src/cli/backup.rs:23-33` |
| C6 | **`restore --from <dir>`** —— 注意是 **in-place**（见 I 节） | **高** | 参数改名 → 恢复演练脚本断裂（**响亮**） | `ai-memory restore --help` | `src/cli/backup.rs:35-44` |
| C7 | `stats`（端到端验收用：计数增长） | 低 | 移除则改看 `doctor` | `ai-memory stats` | `src/daemon_runtime.rs:222` |
| C8 | `reembed`（换 embedding 模型后回填向量时才用） | 中 | 移除则无法换 embedding 模型而不丢检索（**响亮**） | `ai-memory reembed --help` | `src/cli/commands/reembed.rs:58-80` |
| C9 | `config migrate --dry-run`（config schema 变更预检用） | 中 | 移除则升级预检少一道闸（**响亮**） | `ai-memory config migrate --dry-run` | `src/daemon_runtime.rs:241`；`src/cli/commands/config.rs:44-70` |
| C10 | `DEFAULT_PORT=9077` / `DEFAULT_DB="ai-memory.db"` | 低 | 默认值变更不影响我方（全部显式指定） | — | `src/daemon_runtime.rs:88-89` |

### D. `config.toml` 字段

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| D1 | **顶层 `tier = "smart"`**，且 `serve` 的档位只认这个字段 | **高·静默** | 字段改名/语义变化 → 静默退回默认 `semantic`（无 LLM 整理能力，记忆库越积越碎） | `ai-memory doctor` 显示的 tier；`docker exec <c> ai-memory stats` | 字段 `src/config.rs:2694`；解析 `:7493-7495` |
| D2 | `schema_version = 2`（≥2 走 sectioned 解析；`None`/`1` 走 legacy flat，并存时 WARN） | 中 | 若上游要求更高版本号，我方配置可能落到 legacy 解析路径 → 属性**静默**不被识别 | `docker exec <c> ai-memory<…>` 启动日志中的 schema 漂移 WARN | 字段 `src/config.rs:3020`；告警 `:6974-6986` |
| D3 | `db = "/data/ai-memory.db"` | 中 | 同 B2 | 同 B2 | `src/config.rs:2696` |
| D4 | `[llm] backend = "qwen"`（别名 `dashscope`） | 中 | 别名表变更 → 启动失败（**响亮**） | `doctor` LLM Reachability 显示 `qwen` | `src/config.rs:3315-3367`（别名表 `:3319-3321`） |
| D5 | `[llm].api_key_env` / `api_key_file`（**内联 `api_key` 在解析期被拒绝**） | 中 | 若上游放开内联而不再拒绝，会诱使把 key 写进文件（**secrets 入仓风险**） | 保持内联写法应仍然报错 | `src/config.rs:3315-3367` |
| D6 | **`[llm.auto_tag]` 只写 `model`，省略 `backend` 时逐字段继承 `[llm]`** | **高·静默** | 若继承规则改变，或照抄官方样例的 `backend = "ollama"` → auto_tag / 查询扩展 / 矛盾检测**全部静默打挂**（无 Ollama 时），smart 档形同虚设 | `docker exec <c> ai-memory<…> curator --once --dry-run --json` 核对 `tagged > 0`（**这是唯一能发现它的手段**） | `resolve_llm_auto_tag` `src/config.rs:7810-7872` |
| D7 | **`[embeddings]` 显式 `backend` + `model` + `dim`** | **高·静默** | 见 F2。「未设 `dim` 且模型不在表内」→ 回落到 tier preset 的 768，与 DashScope 实际维度不符 → **写入失败或检索异常，且不报错** | `doctor` Embeddings Reachability 显示的维度与实际模型一致 | `EmbeddingsSection` `src/config.rs:3433-3484`；回退 `:7992-7995` |
| D8 | `[embeddings].backfill_batch = 100` | 低 | 越界 WARN 回落 100 | `doctor` | `src/config.rs:3480-3483`、`:7958-7969` |
| D9 | 顶层 `api_key`（secret，本方案**不设**，因无 HTTP 入口） | 中 | 未来开放 HTTP 时必须补，且认证头是 `X-API-Key`（见 H4） | `docker exec <c> env` 与 `config.toml` 均无 api_key | `src/config.rs:2792-2793`；空串视为未配置 `src/daemon_runtime.rs:4361-4362` |
| D10 | 解析优先级：**CLI flag > `AI_MEMORY_*` env > config file > 编译默认** | **高·静默** | 误以为"config 优先" → 排查时查错文件（同 B5） | 见 B5 | `docs/CLI_REFERENCE.md:52-53` |
| D11 | **`[llm].base_url` 与 `[embeddings].base_url`（后者同义字段 `url`，`base_url` 优先）** —— 别名只提供默认端点（`qwen` 别名默认公网 `dashscope.aliyuncs.com/compatible-mode/v1`），走私有 MaaS workspace 必须显式覆盖 | **高·响亮** | 不覆盖 → 打到公网端点，workspace 级 key 在那里**鉴权失败**（好在这点不静默）。反之若上游把 `base_url` 改名/改语义，我方私有端点配置会失效（**静默**风险） | `doctor` 的 LLM / Embeddings Reachability 显示的 base_url 是否为私有端点 | `LlmSection.base_url` `src/config.rs:3315-3334`；`EmbeddingsSection.base_url`/`url` `:3433-3484`；qwen 别名默认端点 `:6500` |

### E. tier 机制

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| E1 | `smart` preset 的默认 embedder 是 **Ollama Nomic `nomic-embed-text-v1.5`（768 维）** —— 我方必须用 `[embeddings]` 覆盖掉它，否则在无 Ollama 的机器上直接失败 | **高** | 若不覆盖 → embedder 初始化失败 → **静默降级 keyword** | `docker exec <c> env \| grep -i ollama`（期望无）；`doctor` Embeddings Reachability | preset `src/config.rs:250-256`；模型枚举 `:19`；维度 `:46-47` |
| E2 | 四档 preset 差异（`keyword`/`semantic`/`smart`/`autonomous`）：embedding 模型、LLM 模型、cross-encoder、`max_memory_mb`(0/256/1024/4096) | 中 | preset 调整会改变内存占用与能力边界；`smart` 的 1024MB 上限是选型依据之一 | `docker stats`；`doctor` | `src/config.rs:234-265` |
| E3 | `serve` **不接受 `--tier`**（档位只来自 config） | 高 | 同 C1 | 同 C1 | `src/daemon_runtime.rs:163-172` |

### F. Embedding 维度解析

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| F1 | `KNOWN_EMBEDDING_DIMS` 表**不含任何 DashScope 模型**（表中只有 nomic / MiniLM / BGE / mxbai / OpenAI text-embedding-3-* / Gemini / granite / snowflake-arctic） | **高·静默** | 若上游把 DashScope 模型加进表且维度与我们写的不一致，两边取值可能打架（以显式 `dim` 为准，故风险可控）；反之若上游**移除**某条目而我们依赖自动推断 → 维度错 | 逐项核对表内容 | `src/config.rs:6572-6617`；查找函数 `:6629-6639` |
| F2 | 未命中表且未设 `dim` → **回落到 tier preset 的编译期维度**（smart = 768） | **高·静默** | 与 DashScope 实际维度不符 → **写入失败或检索质量异常，且不报错**。这是本部署唯一的"必须手工确认数值"的参数 | `doctor` Embeddings Reachability 的维度；写入 + 检索一条做端到端 | `src/config.rs:7985-7995`；注释 `:6560-6565`、`:6620-6622` |
| F3 | 显式 `[embeddings].dim` 覆盖优先；非正值被忽略 | 高 | 填 0 / 负数 → **静默**被忽略并回落 768（模板里曾经的 `dim = 0` 只是占位符，绝不能原样上线）。我方实测值：`qwen3.7-text-embedding` = **1024** | 部署前必须替换为真实值，并在 `doctor` 复核 —— 嵌入器加载行应显示 `1024-dim` | `src/config.rs:7992-7994` |

### G. 路径与缓存

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| G1 | 配置路径由 `$HOME` 推导 → `/data/.config/ai-memory/config.toml` | **高·静默** | 同 B1 | 同 B1 | `src/config.rs:2684-2685,6862-6865` |
| G2 | HF 模型缓存走 hf-hub 默认（`$HF_HOME` 或 `~/.cache/huggingface/hub`）；离线回退目录 `$HOME/.cache/huggingface/hub/models--sentence-transformers--all-MiniLM-L6-v2/snapshots/main` | 中 | 因 `HOME=/data`，缓存已落在持久卷 → recreate 不重下；若上游改缓存路径，recreate 会**静默**重下（首次检索卡顿） | `docker exec <c> du -sh /data/.cache` | `src/embeddings.rs:967-980`、`:48-49`、`:997-1013` |

### H. 传输与 HTTP 面

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| H1 | **MCP 传输只有 stdio**（`stdout` 被 JSON-RPC 独占，日志走 stderr） | **高** | 若上游把日志改写到 stdout，stdio 帧**被污染** → 客户端静默失败/协议错乱 | `docker exec -i <c> ai-memory mcp --tier smart < /dev/null` 看 stderr/stdout 分流 | `src/mcp/mod.rs:3301`、`:3329-3348`、`:3835` |
| H2 | **`/mcp` 与 `/sse` 端点不存在**（HTTP 路由常量全集只有 `/api/v1/*` + `/metrics`） | **高** | 若上游**新增**了这两个端点，我方"只能 stdio-over-SSH"的决议可被重新评估（机会）；若照抄上游 INSTALL/USER_GUIDE 里的地址配置 → 客户端连不上（**响亮**） | 升级后 `docker exec <c> ai-memory doctor`；`curl -sf http://127.0.0.1:9077/mcp`（期望 404） | `src/handlers/routes.rs:14-95`；`server.json:16-18` |
| H3 | HTTP `/api/v1/health` 免认证（我方冒烟探针依赖它） | 中 | 若被改为需认证 → 冒烟脚本失败（**响亮**） | `docker exec <c> curl -sf http://127.0.0.1:9077/api/v1/health` | `src/handlers/transport.rs:779` |
| H4 | HTTP 认证头是 **`X-API-Key`**（不是 `Authorization: Bearer`）；另兼容已弃用的 `?api_key=` query | 中 | 未来开放 HTTP 时若按 Bearer 配 → 认证失败（**响亮**） | `curl -H 'X-API-Key: <k>' …` | 头常量 `src/lib.rs:224`；中间件 `src/handlers/transport.rs:765-877`（`:828` 头、`:842-869` query） |
| H5 | **上游不含任何管理界面**（无 Web UI / 控制台 / TUI / OpenAPI 页）。运维观测出口**只有两个**：`/metrics`（供外部看板采集）与 `ai-memory doctor`（终端） | **高** | 若上游某天加入 Web UI，则**新增一个需要评估的服务面**（认证 / 反代 / TLS / api_key 全部要重评）—— 我方「无公网入口、不需要域名/NPM/api_key」的三条决议前提被打破 | 升级后：`docker exec <c> curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:9077/`（期望非 200 或非 HTML）；`ai-memory doctor` 章节数是否变化；镜像内是否出现静态资源 | 2026-09-20 核实：`routes.rs` 无非 `/api/v1` 路由；无 `rust-embed`/`include_dir`/`ServeDir`；无 `ratatui`/`crossterm`；无 `utoipa`/`swagger`；`docs/*.html` 全为**文档站** |

### I. 备份 / 恢复 CLI 契约（备份脚本与非零退出码检测建立在此之上）

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| I1 | 快照文件名 `ai-memory-<ts>.db`，时间戳格式 `%Y-%m-%dT%H%M%SZ`；配套 manifest `ai-memory-<ts>.manifest.json` | **高** | 命名规则变化 → 备份脚本的"找最新快照 / 上传 / 回读比对"逻辑断裂（**响亮**，前提是脚本用严格匹配；若用通配则会**静默**传错文件） | `ls /data/backups/`；`ai-memory backup --to /tmp/b --keep 1 && ls /tmp/b` | `src/cli/backup.rs:21,70-72,110`、`manifest_file_name :15-17` |
| I2 | manifest **含 `sha256`** 字段（另有 `snapshot/bytes/source_db/version/created_at`） | **高** | sha256 字段消失 → 备份完备性校验失去依据，可能**静默**退化为"只看文件存在" | `cat <manifest>.json`；`jq .sha256` | `BackupManifest` `src/cli/backup.rs:46-54,87-100` |
| I3 | 同名快照**拒绝覆盖** | 中 | 若改为静默覆盖 → 可能丢失上一份快照（**静默**数据风险） | 连跑两次 `backup` 到同一目录，第二次应报错 | `src/cli/backup.rs:73-78` |
| I4 | `--keep` 默认 **48**，按 mtime **newest-first** 保留，超出者连同 manifest 一起删；`0` 关闭轮换 | **高** | 轮换语义变化（如改为 oldest-first 或改删 manifest 策略）→ 要么**静默**堆积，要么**静默**删掉想要的快照 | 造 5 份快照 + `--keep 2` 观察剩余 | `src/cli/backup.rs:29-32,114-117,133-160` |
| I5 | **`restore` 是 in-place**：先校验 manifest sha256（`--skip-verify` 可跳过），把当前库 rename 为 `pre-restore-<ts>.db` 作安全网，再把快照 copy 到 `db_path` | **高** | 与"恢复永不 in-place"的直觉相反！若我方流程假设 restore 落在 staging → 实际**直接覆盖生产库**。这是本清单里最反直觉的一条 | 在**临时库**上演练：restore 后确认原库被改名为 `pre-restore-*` | `src/cli/backup.rs:35-44,171-206,212-244,246-258` |
| I6 | 迁移前自动快照：`<dbfile>.pre-migration-v<from>-to-v<to>-<nanos>.bak`，与库**同目录**，仅在 `version > 0`（已有数据的旧库）时生成 | **高** | 命名规则变化 → 回滚脚本找不到快照（**响亮**，但前提是脚本严格匹配；通配会**静默**取错） | 升级后 `ls /data/*.pre-migration-*.bak` | `src/storage/migrations.rs:868,873,915-947,1502-1529` |

### J. 数据库 schema 与迁移语义

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| J1 | `CURRENT_SCHEMA_VERSION = 81`（SQLite 与 Postgres 锁步） | 中 | 仅作升级预检的"是否发生前向迁移"信号。**注意上游文档滞后**：`docs/CONFIG_SCHEMA.md:172` 写 78，源码是 81 | `grep -n 'CURRENT_SCHEMA_VERSION: i64' src/storage/migrations.rs` | `src/storage/migrations.rs:859`；`src/store/postgres.rs:670` |
| J2 | 迁移**前向-only**，且 v34 / v50 / v54 三个阶梯臂**不可逆** | **高** | 不可逆迁移后无法靠"改回旧版二进制"降级 | 读 CHANGELOG + 预检报告的 W2 | `src/storage/migrations.rs:1502-1519`；`src/storage/migration_meta.rs:43` |
| J3 | ⚠️ **旧二进制启动于"比自身更新的库"时不会报错** —— `migrate()` 在 `version >= CURRENT_SCHEMA_VERSION` 时直接 `return Ok(())`；全 `src` **无**任何"库过新则拒绝启动"的逻辑 | **高·静默** | **我方原文档（`deployment_strategy.md` §6.2 / `dev-plan.md` §5.1⑥）称"二进制会拒绝启动于更新的库，回滚会大声失败" —— 该假设已证伪。** 实际行为：回滚到旧二进制后它会照常启动，并操作一个它不认识的 schema → **静默的数据损坏风险**。**结论：回滚必须用 pre-migration 快照覆盖 DB，不能只改 `IMAGE_TAG`。** | 无法在运行时检测；只能靠流程约束（预检报告强制列出 J3 提示 + 回滚 runbook 强制含快照覆盖步骤） | `src/storage/migrations.rs:1507-1509`（`if version >= CURRENT_SCHEMA_VERSION { return Ok(()); }`）；全 `src` grep `newer than` / `downgrade` / `refuse.*schema` 无命中（2026-09-20 核实） |

### K. 凭证与授权面（决定「如何向用户签发 key」）

| # | 依赖什么 | 敏感度 | 错了会怎样 | 怎么检测 | 上游位置 |
|---|---|---|---|---|---|
| K1 | **HTTP `api_key` 是单一共享密钥，不是多用户体系**（`config.toml` 顶层 `api_key` + `AI_MEMORY_REQUIRE_API_KEY=1`；认证头 `X-API-Key`） | 中 | 本方案不开放 HTTP，暂不涉及。若未来开放：**换 key = 所有客户端同时重配**，且**无法按用户单独吊销** | 见 B9 / D9 / H4 | `src/config.rs:2793` |
| K2 | **macaroon 能力令牌 `[capabilities]`**：v0.9.0 G10.1(#1827) 引入；**`enabled` 在 v0.10.0 默认 `false`**（GA 姿态 = 令牌层是纯恒等函数）；env `AI_MEMORY_CAPABILITIES=on\|off` 覆盖 | **高** | ⚠️ **版本敏感**：main（v1.0.0 方向）已把编译默认改为 `true` 并新增零配置 `owner` issuer。若升级到 v1.0.0，需重评「无令牌调用者行为不变」的假设（上游称该默认翻转是 *additive-only*：只放宽不放严；但「无令牌即拒绝」是**另一个**延迟翻转） | `docker exec <c> env \| grep AI_MEMORY_CAPABILITIES`；升级后查 `[capabilities].enabled` 语义 | v0.10.0 `src/config.rs:5884-5905`（`enabled` 默认 false）；main `src/governance/capability.rs:102`（`DEFAULT_CAPABILITIES_ENABLED = true`） |
| K3 | **CLI 签发链路（v0.10.0 已有）**：`capability keygen <issuer>` / `mint <issuer>` / `attenuate --token` / `inspect --token` / `verify --token --action --namespace --agent`。caveat **只能收窄**（AND 语义）：`--namespace-prefix`、`--op-ceiling`(none/read/write/admin)、`--action`(Store/Delete/Promote/Reflect)、`--agent`、`--expires-at`、`--expires-in-secs`、`--not-before`。令牌展示通道：MCP 工具参数 `capability` / HTTP 头 `X-AI-Memory-Capability` / CLI | **高** | flag 或子命令改名 → 我方「无 UI 签发 key」的 runbook 断裂（**响亮**，命令直接报错）。⚠️ **v0.10.0 没有 `capability init`**（零配置 owner 是 v1.0.0 特性）—— 照搬运维文档会失败 | `ai-memory capability --help` / `mint --help`；用 `inspect` + `verify` 做本地自查 | v0.10.0 `src/cli/capability.rs:117-171`；展示通道 `src/daemon_runtime.rs:280,1017` |
| K4 | **`issuers` 是封闭白名单**：无隐式 issuer，解析器**永不**回退到宽松的 `db::agent_pubkey` 注册表；每项需 `<id>.caproot` 铸造密钥（mode 0600）+ 归因公钥 `<id>.pub`；`max_op` **必填**，解析失败即**整个跳过该 issuer**（fail-closed，绝不默认放大） | **高** | 若以为有隐式 issuer 或 `max_op` 可省 → 令牌校验全部失败（**响亮**，但只在运行时暴露） | 核对 `config.toml` 的 `[capabilities.issuers.*]` 与 key dir 实际文件一致；用 `capability verify` 按具体请求元组复现 | v0.10.0 `src/config.rs:5898-5912` |
| K5 | **Ed25519 身份（`ai-memory identity`）是「出处证明」，不是授权**。上游明确警告：`metadata.agent_id` 是**自述值**，可被任意调用者填写，**不得单独作授权闸门** | **高** | 若把 `agent_id` 当权限依据 → 任何人都能自称任意 id → **静默越权** | 只用它做溯源 / 审计 / 过滤；授权一律走 K2–K4 | `docs/ADMIN_GUIDE.md:996-1010`（Trust model） |
| K6 | 密钥目录解析：`--key-dir` > `AI_MEMORY_KEY_DIR` > `$HOME/.config/ai-memory/keys`；私钥 0600 | 中 | 因我方 `HOME=/data`，密钥与 `.caproot` 随持久卷留存（recreate 不丢）——这是**收益**；若改到卷外则可能丢失，导致既有令牌全部不可验证 | `docker exec <c> ls -l /data/.config/ai-memory/keys` | `src/cli/capability.rs`（`resolve_key_dir`）；`src/identity/keypair.rs:170` |

---

## 3. 上游文档缺陷（本地记录，避免重复踩坑）

沿用 `deployment_strategy.md` §7.1 的判定方法，本次复核后补充：

| # | 缺陷 | 证据 | 后果 |
|---|---|---|---|
| 1 | `docs/INSTALL.md` / `docs/USER_GUIDE.md` 描述`/mcp`、`/sse` 远程 MCP 端点，**该端点不存在** | `src/handlers/routes.rs:14-95` 常量为 `/api/v1/*` + `/metrics`；`server.json:16-18` 只声明 stdio | 照抄配置 → 客户端连不上（**响亮**） |
| 2 | `docs/CONFIG_SCHEMA.md` 的 `[llm.auto_tag]` 样例写 `backend = "ollama"` | 见 `deployment_strategy.md` §3.1 注释 | 无 Ollama 机器上照抄 → auto_tag / 查询扩展 / 矛盾检测**静默全挂** |
| 3 | DashScope embedding 模型不在 `KNOWN_EMBEDDING_DIMS` 表内 | `src/config.rs:6572-6617` | 不显式设 `dim` → **静默**回落 768，维度不符 |
| 4 | **schema 版本文档滞后**：`docs/CONFIG_SCHEMA.md:172` 与 `docs/evidence.html:209` 写 `CURRENT_SCHEMA_VERSION = 78`，源码是 **81** | `src/storage/migrations.rs:859` | 以源码为准；文档不可用于版本判断 |
| 5 | `server.json:5,14` 的 `version` 字段滞后为 `0.5.2` | 同文件 | 不可作为版本判断依据 |
| 6 | **上游 main 与 release tag 提交图不连通（历史被重写）** | 见 `deployment_strategy.md` §7.2 | 依赖 git 谱系/diff 的任何自动化都会失效（已于 2026-09-20 核实） |

---

## 4. 与其它文件的关系

| 文件 | 关系 |
|---|---|
| [`../upstream.lock`](../upstream.lock) | **版本坐标的唯一真相源**。本清单只描述"契约长什么样"，不写版本号 |
| [`../scripts/upstream-preflight.sh`](../scripts/upstream-preflight.sh) | 自动检测：契约面差异（W3）、标签被重推（W4）、schema 前向迁移（W2）均对应本清单的条目 |
| [`dev-plan.md`](./dev-plan.md) §5 | 升级策略与准入判据（**H1–H5 硬性阻断 / W1–W6 人工确认**）；本清单是其中的「人工核对输入」（判据 W3） |
| [`deployment_strategy.md`](./deployment_strategy.md) | 决议真相源；§7 上游缺陷、§6 运维（含 J3 引发的回滚订正） |
| 上游源码 | 本清单所有行号基于 clone HEAD `96b8c694`；升级后行号会漂移，但**契约点本身**应保持可核对 |
