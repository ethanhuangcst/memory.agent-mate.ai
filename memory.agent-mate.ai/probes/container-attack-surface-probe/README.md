# #4 开工准备判据可行性探针 —— 门户容器最小攻击面

> **性质**：研究类探针（**不入制品**、**只读**）· 服务对象 = Sprint 5 `#4 deploy:容器攻击面`（原 Sprint 4 `4.6`）。
> **为什么先出探针**：按 [`ADR-017`](../../specs/adr/ADR-017-complexity-probe-before-real-build.md)，判据未定档前不施工。
> **判据真源**：[`web-stories.md`](../../specs/web-portal/web-stories.md) **S13**（`AC13.1` / `AC13.2` / `AC13.3`）·
> [`web-test.md`](../../specs/web-portal/web-test.md) `TC-P-L1-08`（无 docker socket）·
> [`web-design.md`](../../specs/web-portal/web-design.md) 的 T1（威胁面 6 项措施）·
> 制品：[`portal.compose.yml`](../../deploy/portal.compose.yml) · [`Dockerfile`](../../admin_portal/Dockerfile)。

## 怎么跑

```bash
bash memory.agent-mate.ai/probes/container-attack-surface-probe/probe.sh                      # 相 1 + 相 2
PORTAL_BUILD_TAG=<name:tag> bash memory.agent-mate.ai/probes/container-attack-surface-probe/probe.sh   # 追加相 3
```

**退出码**：`0` 全判且无 FAIL · `10` 有 FAIL · `30` **有未判项**（前置缺失 —— 不伪装通过）· `20` 运行错误。
**三相**：相 1 离线零依赖（判据可行性）· 相 2 底座镜像代理（包管理能力）· 相 3 门户镜像实测（运行身份 / socket / **只读根可行性** / 资源基线）。
**CI**：本脚本已接进 [`portal-image.yml`](../../../.github/workflows/portal-image.yml) 的「攻击面判据」步（相 3 需要镜像）。

## 本机实测结论（2026-09-26）

**9 PASS / 0 FAIL / 1 未判 · `rc=30`**（未判 1 项 = 相 3 的前置：本机无 linux/amd64 门户镜像）。

### 硬数据

| 来源 | 事实 |
|---|---|
| 相 2（本机真跑，底座 `node:22-bookworm-slim`） | 包管理能力命中 **`/usr/bin/apt-get` · `/usr/bin/apt` · `/usr/bin/dpkg` · `/usr/bin/sh`** ⇒ **AC13.3 第三条当前不合规**（最终镜像 = 底座 + `ca-certificates` + COPY ⇒ 不会自动变「更小」） |
| Dockerfile（静态） | `USER 999:999` ✓（AC13.2 的镜像侧；uid/gid 已由 `#1` 探针 `E4`/`E5` 实证） |

### 判据定档（S13 三条 AC → 判据形状与现状）

| AC | 判据形状 | 现状 |
|---|---|---|
| **AC13.1** 无容器编排能力 | **两层**：compose 层 = 非注释行零 `docker.sock` / `/var/run/docker`；容器层 = 容器内**不存在** `/var/run/docker.sock`（`TC-P-L1-08` 的容器侧） | compose **0 处** ✓（合规）· 容器侧待相 3 |
| **AC13.2** 非特权用户运行 | **两层**：compose 层 = 零 `privileged: true` / `pid: host` / `network_mode: host` / `userns_mode: host` / `cap_add`；容器层 = `id -u != 0` | compose **0 处** ✓ · Dockerfile `USER 999:999` ✓ · 容器侧待相 3 |
| **AC13.3** 最小依赖与资源限额 | **三条**：① `read_only: true` **且**给出可写的必要挂载（`tmpfs`）—— 只看 `read_only` 会**假绿**；② `mem_limit` 与 `pids_limit` **二者齐备**才算；③ 容器内包管理能力集合**只剩 `/bin/sh`**（`apt-get`/`apt`/`dpkg`/`apk`/`rpm`/`yum`/`dnf` 全空；**不能把 `sh` 一起删** —— healthcheck 的 `CMD-SHELL` 依赖它） | ① **未配齐 ✗** ② **未配齐 ✗** ③ **不合规 ✗**（底座带 apt/dpkg） |

判据可行性由 **`S1`–`S5` 五组正/反对照**证明（样本全部**合成**，不拿制品现状当样本）：socket 命中/不命中 · 特权键命中/不命中 · 只读根**三态**（只读+tmpfs / 只读无 tmpfs / 无只读）· 限额「配一半不算」· 包管理能力「含 apt 不合格 · 只剩 sh 合格 · **空输出不合格**」。

## 三处缺口（登记）

1. **只读根未配齐**（AC13.3 ①）：compose 无 `read_only`，也无 `tmpfs`。
2. **资源限额未配齐**（AC13.3 ②）：compose 无 `mem_limit` / `pids_limit`。
3. **镜像带包管理能力**（AC13.3 ③）：底座自带 `apt` / `dpkg`；**留意**：删掉它们的同时必须**保留 `sh`**（`healthcheck` 用 `CMD-SHELL`），且 `node`/`tsx`/`better-sqlite3` 的运行不受影响。

## 待拍板（⚠️ 施工前须定）

- **① 资源限额的取值**：需以相 3 的资源基线（内存峰值 / `pids.current`）为据 —— 会话上限已知（每 key 2 / 全局 4，见 `4.1`；`3.17` 探针实测 ~27 MiB/会话、容器**当时无内存上限**）。`pids_limit` 需覆盖 node 主进程线程 + 最多 4 个上游子进程 + 余量。
- **② 只读根的可写点白名单**：`/srv/portal`（命名卷，门户 SQLite 的 WAL 需要）是**必要挂载**；`/tmp` 用 `tmpfs`。**其余是否还有隐藏写入点**由相 3 `T3` 实证（`--read-only` + `tmpfs` 下门户能否起来并答 `/healthz`）。
- **③ 包管理能力的处置**：删（施工）还是**改 AC**？删的话需要实证「最终镜像仍能起 + `sh` 保留 + 体积/启动不受影响」；若发现无法安全删除（例如某原生模块构建期依赖），则应把该条 AC 的口径改述为「**无凭据与无公网可达的包源**」并在 S13 里写明理由。

## 未判项与复跑条件

| 未判（本机） | 原因 | 复跑条件 |
|---|---|---|
| 相 3 全部（`T1`–`T5`） | 本机无 linux/amd64 门户镜像（GHCR 包私有；arm64 构建 30+ 分钟） | `PORTAL_BUILD_TAG=<name:tag> bash …/probe.sh`；CI 已接入（buildx 可用） |

**范围边界（登记）**：S13 三条 AC 说的是**门户容器**（唯一公网可达、且唯一能触及全部用户库的组件）。**主 stack**（`docker-compose.prod.yml`）的同类加固**不在本行范围** —— 探针以 `info` 记录其现状（当前同样无 `read_only` / 限额），归属 `#10` 或后续行。

## 本探针踩到的坑（供后续复用）

1. **`S5` 的期望值写反**：`pkgmgrs_ok` 返回 0 = 合格，断言里该用 `! pkgmgrs_ok` 的地方直接写了 `pkgmgrs_ok` ⇒ 正反颠倒。**自检的价值**：三态对照（含 apt / 只剩 sh / 空输出）立刻暴露了它。
2. **双引号里的反引号是命令替换**（第四次同族）：`info "…相 3 的 \`T4\`…"` 忘了转义 ⇒ 实测报 `T4: command not found`。**规则**：`info` / `check` 的 detail 里凡要显示反引号，一律 `\`` 转义。
3. **别断言「当前已知不合规」的项**：AC13.3 ③ 现在必然红 ⇒ 相 1/相 3 里对它的判断**只写 `info`**，等施工后由 `Q` 类**契约断言**接手（口径同 `#1` 探针的 `C5`）。

## 边界

**不改**产品代码 / `specs/` / `deploy/` 制品：所有改写只发生在 `mktemp -d` 的副本里（`trap` 清理）；相 2/3 只起临时容器（`--rm` 与显式 `docker rm -f` 双保险），不改任何镜像与卷。
