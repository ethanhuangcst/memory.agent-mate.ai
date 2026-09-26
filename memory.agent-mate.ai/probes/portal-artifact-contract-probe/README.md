# #2 开工准备判据可行性探针 —— 门户制品契约

> **性质**：研究类探针（**不入制品**、**只读**）· 服务对象 = Sprint 5 `#2 deploy:制品契约`。
> **为什么先出探针**：按 [`ADR-017`](../../specs/adr/ADR-017-complexity-probe-before-real-build.md)，判据未定档前不施工。
> **判据真源**：[`web-stories.md`](../../specs/web-portal/web-stories.md) S12 `AC12.1`–`AC12.3` ·
> [`web-design.md`](../../specs/web-portal/web-design.md) §3.4（② 版本断言 · ③ 锁侧输入的归属 · ⑤ 编排侧缺口）·
> 制品：[`portal.compose.yml`](../../deploy/portal.compose.yml) · [`Dockerfile`](../../admin_portal/Dockerfile) ·
> [`build-portal-image.sh`](../../scripts/build-portal-image.sh)。

## 怎么跑

```bash
bash memory.agent-mate.ai/probes/portal-artifact-contract-probe/probe.sh                      # 相 1 + 相 2
PORTAL_BUILD_TAG=<name:tag> bash memory.agent-mate.ai/probes/portal-artifact-contract-probe/probe.sh   # 追加相 3
```

**退出码**：`0` 全判且无 FAIL · `10` 有 FAIL · `30` **有未判项**（前置缺失 —— 不伪装通过）· `20` 运行错误。
**三相**：相 1 离线零依赖（判据可行性）· 相 2 底座镜像代理（需 docker + 能取 `node:22-bookworm-slim`）· 相 3 门户镜像实测（需 `PORTAL_BUILD_TAG`）。

## 实测结论（2026-09-26）

**本机**（无 linux/amd64 门户镜像）：**11 PASS / 0 FAIL / 1 未判 · `rc=30` · 两跑一致**（未判 1 项 = 相 3 的前置）。
**CI**：本脚本已接进 [`portal-image.yml`](../../../.github/workflows/portal-image.yml) 的「制品契约判据」步 ⇒ **相 3 在 CI 里真跑**（镜像刚构建完就在本地守护里）；**首次绿 = run `36235735927`**（接入时版本 14 项）；**本版（+`Q1`/`Q2`）复跑 = run `36240706277` ⇒ 16 PASS / 0 FAIL / 0 未判**。本脚本由其持续裁决。

### 硬数据（可直接用于施工）

| 来源 | 事实 | 用途 |
|---|---|---|
| 相 2（本机真跑，底座 `node:22-bookworm-slim`） | 工具面命中**只有** `/usr/local/bin/node` —— **无 `curl`、无 `wget`** | `healthcheck.test` **只能**用 `node -e fetch` 形态；代理理由：最终镜像 = 底座 + `ca-certificates` + COPY（二进制 / node_modules / src / assets），装证书与拷文件都不会新增 curl / wget |
| 相 3 `T1`（CI，权威） | 镜像内探活工具面命中 `/usr/local/bin/node`（无 `curl`/`wget`） | 与相 2 代理同结论 ⇒ 形态定档 |
| **相 3 `T2`（CI，权威）** | **boot → `/healthz` 200 耗时 = 1 s / 1 s / 2 s**（3 次取样） | **`healthcheck` 参数的取值依据**：`start_period=20s`（≥10× 余量）· `interval=30s` · `timeout=5s` · `retries=3` |
| 相 3 `T3`（CI，权威） | 坏配置 + `restart: unless-stopped` ⇒ **12 s 内 `RestartCount=7`** 且 `portal_listening=0` | 「无限重启循环」是**快速且无界**的真实故障模式 ⇒ `restart` 定 `on-failure:3`（有界早停），而非 `unless-stopped` |
| 相 3 `T4`（CI，权威） | `--health-cmd`（`node -e fetch /healthz`）使**健康容器变 `healthy`** | 该断言形态在容器里真能跑通（不只是「命令能执行」） |
| 相 3 `T5`（CI，权威） | 镜像 `LABEL org.opencontainers.image.version` = **`0.10.0`** ⇄ 锁 `IMAGE_TAG` = **`0.10.0`** | AC12.3「版本由锁注入」的**外部侧**已实证 |
| 骨架冒烟（用「有 `jose` 但无门户」的临时靶镜像，跑完即删；**非产品结论**） | `T1` 走通并 PASS · `T5` 对无 LABEL 镜像**转红**（敏感性证明）· `T2`/`T4` 按预期 FAIL（无 `/healthz`、`unhealthy`） | 证明这几条判据**能红能绿**（不是恒绿的装饰） |

### 判据定档（`#2` 四项验收 → 判据形状与归属）

| `#2` 验收项 | 判据形状 | 现状 |
|---|---|---|
| **镜像契约三项**（AC12.1：二进制路径 / 底座 bookworm+ca-certificates / 容器用户 `aimem`） | 已由 **`#1` 探针 `E1`–`E9`** 判定（本探针 `U1` 只登记「已判」，不重跑） | ✅ 已判（CI `36226846982`） |
| **用户标识对齐**（AC12.2：门户与上游 uid/gid 一致） | 同上 —— `E4`/`E5` 已实证 `999:999 ⇄ 999:999`；真源 = [`web-design.md`](../../specs/web-portal/web-design.md) §3.2 + [`mcp-design.md`](../../specs/mcp/mcp-design.md) §5.6.3（**不是** `deployment.md` —— 实测 uid/gid 命中 0 处） | ✅ 已判 |
| **版本号由锁注入、不手写**（AC12.3） | `V1`：链表 5 个点位**全部可机械抽出** —— 锁 `IMAGE_TAG` → `build-portal-image.sh` 的 `sed` 提取与 `--build-arg` → Dockerfile 的 `ARG IMAGE_TAG` 与 `LABEL …version="${IMAGE_TAG}"` | ✅ 5/5 命中 |
| **「不一致拒绝启动」** | `V2` 证明**两侧输入面都可判**（自身版本读取位 / 挂载进容器的锁），但现状**两侧皆缺**：源码读取位 0 处、compose 未挂 `upstream.lock` | ⚠️ **待拍板 ①** |
| **编排健康检查齐备** | `H1` 判据可判 = 块内**四键齐**（`test` / `interval` / `timeout` / `retries`，缩进切块）；`H2` 用 `docker-compose config` 证明正样本**本身合法**（防「靠非法样本假绿」）；取值依据来自相 3 `T2` 的 boot 耗时 | ⚠️ **待拍板 ②**（取值待相 3） |

## 两处缺口（登记）

### 缺口 A：编排侧（与 §3.4 ⑤ 一致，已登记）

`portal.compose.yml` **无 `healthcheck`、无 `depends_on`**；`restart: unless-stopped`；`/healthz` 固定返回 `ok:true`（**不反映自检结论**）⇒ 健康检查只能表达「进程活着」。自检失败时的行为是**退出**（`#1` 冒烟的反例 `N1`–`N3` 已三次实证「非零退出 + 从未监听」）。

### 缺口 B：**本轮新发现** —— 制品里存在「被登记但代码从不读」的键

| 键 | 登记处 | 读取位 |
|---|---|---|
| `PORTAL_ROOT` | `portal.compose.yml` 的 `environment:` **1 处** · [`deployment.md`](../../specs/deployment.md) §12.5.4 门户 env 真源表 **1 处** | **无** —— 产品代码（`admin_portal/src/**`）三种真读取形态（zod schema 键 / `raw.X` / `process.env.X`）**皆不命中**；源码里唯一含该子串的是常量 `ADMIN_PORTAL_ROOT`（由 `import.meta.url` 推导，**与 env 无关**） |

⇒ 表现为「**看起来能配、其实无作用**」。**且这是判据的方向缺口**：

- `deploy-guide-audit` 的 `A2` = `[...portalKeys].filter((key) => !deployKeys.has(key) && !docKeys.has(key))` ⇒ **只判「代码会读 → 必须被登记」**（`codeKeys ⊆ deployKeys ∪ docKeys`，**单向**）；
- `A2b` 只扫**源码**里出现过的令牌 ⇒ **部署侧多出来的键不在任何判据面内**。
- 故 `make deploy-doc-audit` 恒绿也可能漏掉这一类（本次即实证）。**处置建议**（归 `#2` 的施工内容，本轮只登记）：把方向补齐为**双向**判据，或至少为「部署侧有读取方的键」加一条派生断言 + 白名单（带理由），体例同 `A2b`。

## 待拍板（2 项 ⚠️，施工前须定）

### ① 版本断言的**归属与形态**

「启动时与挂载的锁比对，不一致拒绝启动」（`web-design.md` §3.4 表第 3 行）需要两个输入面：**自身版本读取位** + **挂载的期望值**。现状是同一判据被两行认领：

- `#2` 的验收条件含「**不一致拒绝启动**」；
- 而 [`web-design.md`](../../specs/web-portal/web-design.md) §3.4 ③ 明写「**挂载锁文件 + 读取位**」归 **`#17`**；
- 且 `selfcheck.ts` 既有的版本项 `binary_version_matches_lock`（`deferred`）判的是**上游二进制**版本，与**门户自身**版本的断言**不是同一件事**。

候选：(a) 整体归 `#2`（连挂载一起；`#17` 只做三项 `deferred` 转正）· (b) 整体归 `#17`（`#2` 只登记为依赖）· (c) 拆开 —— `#2` 做「镜像 tag / `LABEL` 与锁一致」的**外部**断言（现已可判：`V1` + 相 3 `T5`），`#17` 做**启动期**断言。

### ② `healthcheck` 的**语义与重启策略**

`/healthz` 固定 `ok:true` ⇒ 健康检查只能表达「进程活着」；而「自检不过就不 listen」已由**退出**兑现。两者叠加 `restart: unless-stopped` 的结果是**重启循环**（相 3 `T3` 实测 12 s 内 7 次）。

候选：(a) 接受「活着」语义 + 按 `T2` 取值 + 保留 `unless-stopped`（接受重启循环，靠日志/告警发现）· (b) 改 `restart: on-failure:<N>` 让坏配置**有界早停** + `healthcheck` 表达运行期健康 · (c) 先由 `#17` 让 `/healthz` 反映自检结论，再定 `healthcheck`。

## 未判项与复跑条件

**相 3 已在 CI 判掉**（run `36235735927`：14/0/0）；**本机仍为「未判」**（无 linux/amd64 门户镜像 —— GHCR 包私有、本机 arm64 构建需 30+ 分钟）。

| 未判（仅本机） | 原因 | 复跑条件 |
|---|---|---|
| 相 3 全部（`T1`–`T5`） | 本机无 linux/amd64 门户镜像 | `PORTAL_BUILD_TAG=<name:tag> bash …/probe.sh`（有镜像的机器）；CI 里 buildx 可用（构建配方见 [`build-portal-image.sh`](../../scripts/build-portal-image.sh)），已接进工作流 |
| `T2` 的耗时取值 | 需要**门户**镜像，且**模拟下不可用**（arm64 跑 amd64 的耗时无代表性） | amd64 实测值 —— **已由 CI 取得**（1 s / 1 s / 2 s）⇒ 本项已关闭 |

## 本探针踩到的坑（供后续复用）

1. **判据要锚在语义**：`environment:` 块内的键 ≠ compose 自身的插值变量。首版把 `image: ${PORTAL_IMAGE}` 也算进「声明的键」⇒ `PORTAL_IMAGE` 假阳性。
2. **`comm` 的输入必须有序**：收窄判据时漏掉 `sort -u` ⇒ 有序的一侧被误判成差集，吐出 **14 个假孤儿**。
3. **样本注入点必须与判据同面**：正样本要注在 `environment:` 块**内**，否则是「用判据看不见的样本证明判据」⇒ 假红。
4. **双引号里的反引号是命令替换**：`info "…`KEY`…"` 会去执行 `KEY`（实测报 `PORTAL_ADMIN_HOST: command not found`）。
5. **声明要锚到真源**：uid/gid 的真源是 `web-design.md` §3.2 与 `mcp-design.md` §5.6.3，**不是** `deployment.md`（后者实测 0 命中）—— 锚错了就是假红。
6. **正样本不能往"真制品"里注入**：`#2` 第 1 批把 `healthcheck` 落地后，再往真 compose 注入一份 ⇒ **重复键**、YAML 直接非法（`mapping key "healthcheck" already defined`）。⇒ 样本要**从一个合成底座派生**，与制品现状解耦。
7. **「现状」不能当断言**（第二次踩）：首版把「现状无 healthcheck」写进 `H1` 的反样本 ⇒ 落地后必然假红。凡断言里出现「制品当前如何」，都要问一句「正确实现之后它还会成立吗」。

## 边界

**不改**产品代码 / `specs/` / `deploy/` 制品：所有改写只发生在 `mktemp -d` 的副本里（`trap` 清理）。相 3 会临时起容器（`--rm` 与显式 `docker rm -f` 双保险），不改任何镜像与卷。
