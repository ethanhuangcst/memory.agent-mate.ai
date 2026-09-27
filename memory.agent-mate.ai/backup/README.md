# backup —— 记忆库备份与恢复（Sprint 5 `#15` / `#16`）

> **入口**：`make backup` → [`backup-and-push.sh`](./backup-and-push.sh) · `make restore-drill` → [`restore-drill.sh`](./restore-drill.sh)
> **判据真源**：[`../specs/sprint-backlog.md`](../specs/sprint-backlog.md) 的 `#15` / `#16` 行 ·
> **回滚用法**：[`../specs/release-readiness.md`](../specs/release-readiness.md) §3。
> **本目录即「`make backup` 指向的实现」** —— 2026-09-27 之前此目录为空而 Makefile 已有入口（登记为「`#15` 先红」），本批填上。

## 1. 两脚本做什么

| 脚本 | 流程（判据原文逐条对应） | 退出码 |
|---|---|---|
| `backup-and-push.sh` | **① 快照 → ② sha256 → ③ ossutil 上传 → ④ 回读比对 → ⑤ 失败非零** | 0 成功 · 10 失败 · 30 未判 · 20 用法错 |
| `restore-drill.sh` | **拉最新 → 校验 → restore → `doctor` 通过**（恢复目标**永远是隔离目录**） | 同上 |

遍历范围 = **`/data/users/*`**（每用户一库）+ 主库 `/data/ai-memory.db` + **门户库 `/srv/portal/portal.db`**。

## 2. 三条设计理由（都是被现实逼出来的）

1. **快照必须用 SQLite 的 `.backup`（在线备份 API），不能裸 `cp`。**
   ai-memory 的库是 **SQLite + WAL**（门户库同）：已提交但**未 checkpoint** 的数据在 `-wal` 里 ⇒
   裸 `cp` 主库会拿到**缺数据/不一致**的快照。本机自测专门造了「1 行仅在 WAL 中」的库，
   验证快照行数与源一致（✓ 通过）。
2. **演练只写隔离目录**（`--workdir`，默认 `/tmp/restore-drill-<ts>`）：`/data` 与 `/srv/portal` **只读**。
   演练回答的是「这份快照**真能**恢复出可用的库吗」，**不是**「把生产恢复回去」—— 后者是人工决策。
3. **`doctor` 无通路时如实「未判」**（退出码 30），不伪装通过：`doctor` 需要上游二进制/容器，
   本机离线判不了。生产演练用 `--doctor-cmd 'docker exec ai-memory-mcp ai-memory doctor'`。

## 3. 生产用法

```bash
# 服务器侧（凭据只存本机 ossutil 配置，脚本零硬编码）
ossutil config                       # AccessKeyId/Secret → ~/.ossutilconfig（chmod 600）
export OSS_BUCKET=<桶名>             # region 香港；桶私有 + SSE（见 specs/deployment.md §1.1）
export OSS_PREFIX=ai-memory-backup

make backup                          # 或：bash backup/backup-and-push.sh --container ai-memory-mcp

# 季度演练（#16）：拉最新快照 → 隔离恢复 → 自检 → doctor
bash backup/restore-drill.sh --from-oss --doctor-cmd 'docker exec ai-memory-mcp ai-memory doctor'
```

- **生产推荐加 `--container <名>`**：用 `docker cp` 从容器取数，**不摸宿主卷路径**（`/var/lib/docker/volumes/...` 不稳）。
  门户库若在另一个容器，需单独确认（本脚本只从同一容器取 `/srv/portal/portal.db`）。
- `--no-upload`：只做本地快照（离线自测 / `#8` 未就绪时）⇒ 外迁段记 **未判**。

## 4. 本机自测证据（2026-09-27，离线夹具，**不联网、不动生产**）

| 用例 | 结果 |
|---|---|
| **A** 快照（4 库：主 + 2 用户 + 门户） | ✓ `rc=30`（外迁未判）· sha256 清单 4 项 + `manifest.txt` |
| **A′ WAL 安全** | ✓ 夹具中 alice 有 **1 行仅在 WAL、未 checkpoint** ⇒ 快照行数 **4 = 源 4**。<br>**⚠️ 更强的证据在探针里**（`../probes/backup-restore-probe/` 的 `S1`）：要复现「**裸 `cp` 会丢数据**」，夹具必须让库处于**被占用**状态（保持连接打开 + `wal_autocheckpoint=0`）—— 否则 SQLite 在最后一个连接关闭时会 checkpoint，`-wal` 被合并 ⇒ 裸 `cp` **也能**拿到完整数据 ⇒ 判据**假通过**（探针首版即如此，被自检抓出）。生产上库**始终被容器占用**，所以 `.backup` 不是「更讲究」，而是**必需**。 |
| **B** 演练（`--snapshot` 本地） | ✓ 校验 4 项一致 · 恢复 4 库 · 逐库 `integrity_check` ok · **门户库三表**（`users`/`keys`/`audit`）在位 · 输出 **RTO 实测**；`rc=30`（doctor 未判） |
| **C 失败非零** | ✓ 篡改快照 1 字节 ⇒ **`rc=10` 且拒绝恢复**（快照不可信时不往下走） |
| **D 可重复执行** | ✓ 同 `--stamp` 重跑 ⇒ `SHA256SUMS` 逐项一致 |

## 5. 未判项（**如实登记，不伪装通过**）

- **外迁段（③上传 / ④回读比对）**：需 `#8`（OSS 桶 + AK）与本机 `ossutil` —— 本机无 `ossutil` ⇒ 记 30。
  **`#8` 就绪后跑一次 `make backup` 即可闭合**（这也是 `#15` 置 `Done` 的最后一道）。
- **`doctor` 通路**：需生产容器 ⇒ 归 `#16`（首次外迁 + 恢复演练）与 `#10`。
- **量化指标（RPO ≤ 24h / RTO ≤ 2h / 日备 30 月备 12）**：口径与计时落点在 `#16`（本脚本已输出 RTO 实测秒数）。
- **门户库外迁口径**：是否与用户库**同桶同密钥**待拍板（门户库含身份与审计数据，**不含记忆正文**；见 `#3` 行登记）。

## 6. 踩坑（写脚本时踩到的，供后来者省时间）

1. **双引号内的反引号仍是命令替换**（仓内坑 7，本次**复发**）：文案里写 `` `.backup` `` ⇒ 被当命令执行。
   ⇒ **脚本输出文案一律不用反引号**。
2. **`local` 不能在同一句里「先声明后引用」**：`local src="$1" rel="$2" dst="${DEST}/${rel}"` 在 `set -u` 下报
   `rel: unbound variable`（同一 `local` 从左到右赋值，`dst` 展开时 `rel` 还没赋）⇒ **分行声明**。

## 7. 外迁段实测通过（2026-09-27）

首次**真跑**（真实桶），两条脚本的外迁 / 回读路径均验证：

- `backup-and-push.sh` ⇒ 3 个库上传到 `oss://memory-agent-mate-bak/ai-memory-backup/<stamp>/`，**回读比对 3 项一致**，**`rc=0`**；
- `restore-drill.sh --from-oss` ⇒ **从桶拉最新** → 校验 → 隔离恢复 → `integrity_check` 全过；**`rc=30`** 仅因 `doctor` 通路需生产容器（**执行点归 `#16`**）。

环境：macOS + ossutil **v1.7.19** · 桶**私有 + SSE（OSS 完全托管 / AES256）** · RAM 子账号策略**不含 `DeleteObject`**（过期清理交给桶的**生命周期规则** —— 见 `../specs/deployment.md` §1.1）。

### 新增踩坑

1. **`ossutil cp -r oss://bucket/prefix/ localdir/` 的落点因版本而异** —— v1.7.19 把 prefix 下的**内容直接**放进 `localdir/`（**不多建**一层以 prefix 末段命名的目录），别的形态会保留那一层 ⇒ 解析下载结果的脚本**必须两种都探测**（本仓首版只赌了后者，真跑即报「快照缺 SHA256SUMS」）。
2. **zsh 交互模式下 `#` 不是注释**（`setopt interactive_comments` 未开时）⇒ 粘给别人的**一行命令里不要写行内注释**，否则 `#` 后面的字会被当成参数执行（实测报 `export: not valid in this context`）。
3. **`ossutil config` 的输入是明文回显**，且注意 `stsToken` 提示（用长期 AK 时**直接回车跳过**）；配置文件路径默认 `~/.ossutilconfig`，装完记得 `chmod 600`。
