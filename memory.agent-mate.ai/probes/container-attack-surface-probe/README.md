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

**本机**（无 linux/amd64 门户镜像）：**12 PASS / 0 FAIL / 1 未判 · `rc=30`**（未判 1 项 = 相 3 的前置）。
**CI（`#4` 本体落地后，run `36252233989` success）：17 PASS / 0 FAIL / 0 未判** —— 相 3 真跑，且 `T3` 用的是 **compose 的最终加固设置**。接入过程**前两轮红都是探针自伤**（见下「踩坑」4/5），本轮还有一次**跨行耦合**（见「三处缺口」第 3 条的 `E9` 修正）。

### 硬数据

| 来源 | 事实 | 用途 |
|---|---|---|
| **相 3 `T3`（CI，权威）** | **只读根可行**：`--read-only` + 必要挂载（`/srv/portal` **rw** · `/tmp` **tmpfs** · `/data/users` rw · `upstream.lock` ro）⇒ `/healthz` **200** · `portal_listening=1` 次 · 自检全过 | AC13.3 ① **可落地** ⇒ 施工按该挂载集合配 `read_only: true` + `tmpfs`（**待拍板 ② 由此结案**）。`#4` 本体落地后该用例升级为「**按 compose 的最终加固设置**起容器」（再加 `--cap-drop ALL --security-opt no-new-privileges --memory 512m --pids-limit 128`）⇒ 断言的是「我们发出去的那套设置跑得起来」 |
| **相 3 `T5`（CI，权威）** | 资源基线（**空闲态**）：内存 **71.54 MiB** · cgroup `pids.current=21` | AC13.3 ② 的限额取值依据 ⇒ 落成 `mem_limit: 512m`（峰值 ≈71.5 + 4×27 ≈ 180 MiB，2.8× 余量）与 `pids_limit: 128`；**含会话时更高**（`4.1` 实测 ~27 MiB/会话、全局 4 路） |
| 相 3 `T1` / `T2`（CI，权威） | 容器内 `uid=999` ✓ · `/var/run/docker.sock` **不存在** ✓ | AC13.2 / AC13.1 的**容器侧已合规** |
| 相 2（本机真跑，底座 `node:22-bookworm-slim`） | **施工前**：包管理能力命中 `/usr/bin/apt-get` · `/usr/bin/apt` · `/usr/bin/dpkg`（底座自带 ⇒ 最终镜像默认也带） | AC13.3 ③ 的**缺口**来源 ⇒ `#4` 本体在 `Dockerfile` 里移除之（保留 `sh`） |
| Dockerfile（静态） | `USER 999:999` ✓（AC13.2 的镜像侧；uid/gid 已由 `#1` 探针 `E4`/`E5` 实证） | 已判 |

### 判据定档（S13 三条 AC → 判据形状与现状）

| AC | 判据形状 | 现状 |
|---|---|---|
| **AC13.1** 无容器编排能力 | **两层**：compose 层 = 非注释行零 `docker.sock` / `/var/run/docker`；容器层 = 容器内**不存在** `/var/run/docker.sock`（`TC-P-L1-08` 的容器侧） | compose **0 处** ✓ · 容器内不存在 ✓（相 3 `T2`） |
| **AC13.2** 非特权用户运行 | **两层 + 加固侧**：compose 层 = 零 `privileged: true` / `pid: host` / `network_mode: host` / `userns_mode: host` / `cap_add`；容器层 = `id -u != 0`；加固 = `cap_drop: ALL` **且** `no-new-privileges:true`（互补，判据要求**二者齐备**） | compose **0 处** ✓ · `USER 999:999` ✓ · 容器内 `uid=999` ✓（相 3 `T1`）· 加固已配齐 ✓ |
| **AC13.3** 最小依赖与资源限额 | **三条**：① `read_only: true` **且**给出可写的必要挂载（`tmpfs`）—— 只看 `read_only` 会**假绿**；② `mem_limit` 与 `pids_limit` **二者齐备**才算；③ 容器内包管理能力集合**只剩 `/bin/sh`**（`apt-get`/`apt`/`dpkg`/`apk`/`rpm`/`yum`/`dnf` 全空；**不能把 `sh` 一起删** —— healthcheck 的 `CMD-SHELL` 依赖它） | ① 已配齐 ✓ ② 已配齐 ✓（`512m` / `128`）③ 已合规 ✓（镜像内 apt/dpkg 已移除、`sh` 保留）—— 三者均由 `Q1` 与相 3 `T4` **断言** |

判据可行性由 **`S1`–`S6` 六组正/反对照**证明（样本全部**合成**，不拿制品现状当样本）：socket 命中/不命中 · 特权键命中/不命中 · 只读根**三态**（只读+tmpfs / 只读无 tmpfs / 无只读）· 限额「配一半不算」· 包管理能力「含 apt 不合格 · 只剩 sh 合格 · **空输出不合格**」· 权限加固「`cap_drop` 与 `no-new-privileges` 二者齐备才算」。

## 三处缺口（**已随 `#4` 本体闭合**，保留登记）

1. ~~**只读根未配齐**（AC13.3 ①）~~ ⇒ 已落 `read_only: true` + `tmpfs: /tmp`（`Q1` 断言）。
2. ~~**资源限额未配齐**（AC13.3 ②）~~ ⇒ 已落 `mem_limit: 512m` + `pids_limit: 128`（`Q1` 断言；取值依据见上表 `T5`）。
3. ~~**镜像带包管理能力**（AC13.3 ③）~~ ⇒ `Dockerfile` 装完 `ca-certificates` 即移除 `apt`/`dpkg` 的二进制与元数据（`T4` 断言）；**保留 `sh`**（`healthcheck` 用 `CMD-SHELL`）。**踩到一次跨行耦合**：`#1` 探针的 `E9` 原用 `dpkg -s ca-certificates` 判「证书已装」⇒ dpkg 一移除该判据即失效（CI 红）⇒ 已把 `E9` 改判 **CA 束文件**（`/etc/ssl/certs/ca-certificates.crt` 在位且含 PEM 证书）—— **改判据，不是把 dpkg 装回来**。

## 取值与口径（`#4` 本体落地后）

- **① 资源限额 —— 已取值，待生产机复核**：`mem_limit: 512m`（基线 71.54 MiB + 全局 4 路会话 × ~27 MiB ≈ 180 MiB ⇒ **2.8× 余量**）· `pids_limit: 128`（覆盖 node 主进程线程 + 4 个上游子进程及其线程 + 余量）。**唯一待办**：CI runner 的内存总量（15.61 GiB）≠ 生产机 ⇒ 换机后复核这两个数字并同批更新 compose 注释。
- **③ 包管理能力 —— 已按「删」处置，但 AC 措辞订正一处**：删除可行且已被 → `T4` **断言**；**但 `sh` 必须保留**（compose 的 `healthcheck` 用 `CMD-SHELL`，运维排障与 `docker exec` 探活也依赖它）⇒ T1 的「无 **shell**/包管理器」订正为「**无包管理器**」，判据固化为「包管理器全空 **且** `sh` 仍在」。**替代方案已评估并否决**：把 `healthcheck` 改成 exec 形式（`CMD`）本可连 `sh` 一起不要，但会一并失去运维探活与 `#1` 冒烟的 `--entrypoint sh` 能力 —— 收益（少一个 `dash`）远小于代价。

- **② 只读根的可写点白名单 —— 已结案（CI `T3` 实证可行）**：AC13.3 的原文就是「根文件系统**除必要挂载外**为只读」⇒ 判据必须**连同必要挂载一起**判（否则把「夹具不完整」误报成「产品不可行」，实测已踩过一次）。**必要挂载集合（`T3` 已实证可起可服）**：`/data`（**rw**，与主 stack 共享的命名卷 —— 上游库与 `/data/users`）、`/srv/portal`（**rw**，门户库 —— compose 的 `portal_data` 卷）、`/tmp`（**tmpfs**）、`upstream.lock`（**ro**）、`config.toml`（**ro**）。**无需额外的 `HOME` 等隐藏写入点**（实测自检全过且 `portal_listening` 出现）。
- **③ 包管理能力的处置**：删（施工）还是**改 AC**？删的话需要实证「最终镜像仍能起 + `sh` 保留 + 体积/启动不受影响」；若发现无法安全删除（例如某原生模块构建期依赖），则应把该条 AC 的口径改述为「**无凭据与无公网可达的包源**」并在 S13 里写明理由。

## 未判项与复跑条件

| 未判（本机） | 原因 | 复跑条件 |
|---|---|---|
| 相 3 全部（`T1`–`T5`） | 本机无 linux/amd64 门户镜像（GHCR 包私有；arm64 构建 30+ 分钟） | `PORTAL_BUILD_TAG=<name:tag> bash …/probe.sh`；**CI 已接入并已判**（run `36247341377` ⇒ 13/0/0） |

**范围边界（登记）**：S13 三条 AC 说的是**门户容器**（唯一公网可达、且唯一能触及全部用户库的组件）。**主 stack**（`docker-compose.prod.yml`）的同类加固**不在本行范围** —— 探针以 `info` 记录其现状（当前同样无 `read_only` / 限额），归属 `#10` 或后续行。

## 本探针踩到的坑（供后续复用）

1. **`S5` 的期望值写反**：`pkgmgrs_ok` 返回 0 = 合格，断言里该用 `! pkgmgrs_ok` 的地方直接写了 `pkgmgrs_ok` ⇒ 正反颠倒。**自检的价值**：三态对照（含 apt / 只剩 sh / 空输出）立刻暴露了它。
2. **双引号里的反引号是命令替换**（第四次同族）：`info "…相 3 的 \`T4\`…"` 忘了转义 ⇒ 实测报 `T4: command not found`。**规则**：`info` / `check` 的 detail 里凡要显示反引号，一律 `\`` 转义。
3. **别断言「当前已知不合规」的项**：AC13.3 ③ 现在必然红 ⇒ 相 1/相 3 里对它的判断**只写 `info`**，等施工后由 `Q` 类**契约断言**接手（口径同 `#1` 探针的 `C5`）。
4. **夹具必须包含「必要挂载」**：`T3`（只读根可行性）首版只挂了 `/data/users` 与锁，**漏了 `/srv/portal`**（门户库）⇒ CI 首跑**必然红**。**这不是产品不可行，而是夹具不完整** —— 只读根类判据一律要按「除必要挂载外为只读」构造，否则会把自身缺陷误报成产品结论。（CI 首跑 run `36243572566` 即此因。）
5. **夹具里漏一个 env 就会打错端口**：`T3` 第二版忘了 `-e PORTAL_PORT` ⇒ 门户在**默认 8788** 上正常监听，而探活打的是 **8080** ⇒ 20 s 空等、`T3` 假红（容器 `running`、自检全过）。**教训**：读结果的顺序是「**先看自检与 `portal_listening`，再看状态码**」—— 所以判据的 detail 里要带 `portal_listening` 计数，而不是只报状态码。（CI run `36246361947` 即此因。）

## 边界

**不改**产品代码 / `specs/` / `deploy/` 制品：所有改写只发生在 `mktemp -d` 的副本里（`trap` 清理）；相 2/3 只起临时容器（`--rm` 与显式 `docker rm -f` 双保险），不改任何镜像与卷。
