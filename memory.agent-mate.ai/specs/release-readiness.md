# 上线准备包（release readiness）

> **服务对象**：Sprint 5 `#9`（deploy:上线准备包）· **与 [`#14`](./sprint-backlog.md)（上线验收）配对使用**。
> **用途**：上线动作的**输入物** —— 预演一条命令跑完、三份验收清单的待执行项列清、回滚点与回滚步骤成文。
> **不重复真源**：部署步骤见 [`deployment.md`](./deployment.md) §12.2 / 八步见 §3 / 升级治理见 §9 / 回滚规则见 §10；
> 本文只做**编排**（怎么跑、按什么顺序、失败怎么办）与**待执行项清点**。

## 0. 一条命令的预演

```bash
make release-preflight                       # 报告打屏
make release-preflight ARGS="--out /tmp/release-preflight-$(date +%F).txt"   # 同时存档
```

脚本 [`../scripts/release-preflight.sh`](../scripts/release-preflight.sh) 覆盖**本机可判**的全部预演项：

| 组 | 判什么 | 依据 |
|---|---|---|
| R1 / R2 | 编排与模板制品齐备（门户 compose · 主 stack compose · `upstream.lock` · `portal.env` 样例 · `config.toml` 模板）· 本剧本在位 | `deployment.md` §12.2「要落地的文件 = 4 个」 |
| R3 | 生产模板**可渲染**（`docker compose config` 无语法/插值错误） | §12.5.5 第 1 项 |
| R4 | 加固与探活键齐备（`read_only` · `tmpfs` · `cap_drop: ALL` · `no-new-privileges` · `mem_limit` · `pids_limit` · `healthcheck` · `restart`） | `#2`/`#4` 落地项 |
| R5 | 三份清单**可枚举出待执行项** | 见下 §2 |
| R6 | 升级治理的**真实入口**存在（`make preflight` / `make pin-update` / `scripts/upstream-preflight.sh` / `upstream.lock`） | `deployment.md` §9.1 |
| R7 | 回滚依赖的**快照能力**（`backup/` 两脚本，归 `#15`）—— **未到位 ⇒ 未判** | 见下 §3 |
| R8 | **生产侧**预演（真起 stack + 真实 Access/隧道）—— **未判**，归 `#10` | §12.5.5 第 2 项 |

退出码与仓内探针同口径：`0` 全判且无失败 · `10` 有失败 · `30` 有未判 · `20` 运行错误。
**`30` 是本行正常态**：R7（`#15` 未交付）与 R8（需生产机）**都如实登记为未判，不伪装通过**。

## 1. 上线顺序（与 `#10`/`#11`/`#13`/`#14` 的对应）

1. **前置凭据就位**（`#7` SSH 公钥 · `#8` OSS 桶与 AK）。
2. **`make release-preflight`** ⇒ 报告存档（本行）。
3. **主 stack 部署**（`#10`，八步见 `deployment.md` §3）+ §7 冒烟。
4. **门户 stack 部署**（`#11`）+ 多用户隔离复验。
5. **接入面落地**（`#12`）。
6. **在线链路验收**（`#13`，需 `#6` 的隧道探针）。
7. **上线验收**（`#14`）—— 按下面三份清单逐条执行，RID `D5`/`V1` 在此执行。

## 2. 三份验收清单的待执行项（真源 + 枚举方式）

预演脚本 `R5` 会**当场枚举**（不手抄，避免与真源漂移）：

| 清单 | 真源 | 预演枚举的条目数（2026-09-27） |
|---|---|---|
| 端到端冒烟七项 | [`deployment.md`](./deployment.md) §7.3 | **7 条** |
| 生产级验证 V1–V4 | [`mcp/mcp-design.md`](./mcp/mcp-design.md) §6.2 | **29 条**（含表格行） |
| 上线验收（含 V1 负向隔离） | [`web-portal/web-test.md`](./web-portal/web-test.md)（**全文条目化行口径**，含 L3 段落） | **逐条执行时以该文为准** |

> **口径说明**：`web-test.md` 的 L3 段落编号形态与另两份不同 ⇒ 预演按「全文条目化行」计数并在报告里**标注口径**，
> 而不是假装切出了精确小节。**执行时以文档为准**，预演只保证「清单可被机械枚举、不是一句散文」。

## 3. 回滚点与回滚步骤（**必须快照覆盖**）

**规则真源**：[`deployment.md`](./deployment.md) §10 —— 「**数据回滚必须快照覆盖**」·「恢复前先备份当前」·「回滚后重跑冒烟」。

### 3.1 回滚点（什么时候必须回滚）

| 回滚点 | 触发信号 |
|---|---|
| **R-a｜升级后发现库 schema 不兼容** | 上游不拒绝「比自身更新的库」⇒ **旧二进制会静默读写不认识的 schema** ⇒ 一旦发现版本漂移（`make pin` 与镜像内版本不符）立即回滚 |
| **R-b｜门户启动自检在**生产**姿态下 fail** | 镜像内版本 ≠ 锁 · embeddings 维度 ≠ `1024` · `/data/users` 不可写 —— 任一 fail 即**不 `listen`**（fail-closed）⇒ 先回滚门户 stack |
| **R-c｜§7 冒烟或 L3 验收出现阻断项** | 按 §9.3（H）与 §9.4（W）的判断 |
| **R-d｜数据损坏 / 误删** | 立即**先备份当前**（哪怕它已损坏），再用快照恢复 |

### 3.2 回滚步骤（**引用真实入口，不写虚构命令**）

**代码/编排层**（可与数据层分开）：

```bash
git -C <repo> checkout <上一个提交>     # §10 的代码回滚
make portal-up                          # 或 make up（按层）
make release-preflight                  # 回滚后重新预演（本剧本 §0）
```

**数据层**（⚠️ **快照入口归 `#15`，当前尚未就绪**）：

```bash
make backup          # 备份并外迁：快照 → sha256 → ossutil 上传 → 回读比对   ← #15
make restore-drill   # 季度恢复演练（硬验收，可重复执行）                    ← #15
```

> **依赖登记（本行的诚实边界）**：`make backup` / `make restore-drill` 的实现在
> [`../backup/`](../backup/)（`backup-and-push.sh` · `restore-drill.sh`）—— **当前尚未交付**（归 Sprint 5 `#15`/`#16`，
> 已在 `change-log` 登记为「`#15` 先红：Makefile 已声明入口而 `backup/` 为空」）。
> ⇒ **在那之前，数据层回滚步骤不可执行**；本剧本**引用入口并显式标注「待 `#15` 就绪」**，不写虚构命令。
> 快照口径（给 `#15`/`#16`）：**门户库是 SQLite + WAL**（`admin_portal/src/web/db/migrate.ts`）⇒ 快照必须走
> `sqlite3 .backup` 或 `VACUUM INTO`，**不能裸 `cp`**（裸 cp 会拿到不一致的库）。

### 3.3 回滚后的验证（§10 的纪律：**回滚不是终点**）

1. `make release-preflight` ⇒ 报告无失败（本机侧）；
2. 重跑 [`deployment.md`](./deployment.md) §7 的冒烟七项；
3. **数据层**回滚后另跑一次恢复演练（`make restore-drill`，待 `#15`）；
4. 记入版本记录（`deployment.md` §9.6）。

## 4. 与 `#14`（上线验收）的接缝

- 本剧本的 §2 清单 = `#14` 的**执行输入**；`#14` 执行完把结论回填到 `deployment.md` §9.6 的版本记录。
- **RID `D5`（生产卷隔离复验）与 `V1`（负向隔离）** 的执行点在 `#14`/`#11`。
- 预演报告（`--out` 存档）应随上线记录一并保留 —— 它是「上线前那一跑判据」的唯一凭证。
