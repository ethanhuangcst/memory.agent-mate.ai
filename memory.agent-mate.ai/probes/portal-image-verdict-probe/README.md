# #1 开工准备判据可行性探针 —— 门户镜像与编排制品（研究类，不入制品）

为 Sprint 5 `#1 deploy:门户镜像与编排制品` 的**开工准备**服务。判据真源：[`../../specs/web-portal/web-design.md`](../../specs/web-portal/web-design.md) §3（制品约束 + 构建那一行）· §11（部署九步）· [`../../specs/mcp/mcp-design.md`](../../specs/mcp/mcp-design.md) §5.6.3（上游侧三项制品契约的真源）。

调用（**只读**；相 1 不需要 docker 守护，相 2 需要）：

```bash
bash memory.agent-mate.ai/probes/portal-image-verdict-probe/probe.sh
```

退出码：`0` = 两相全跑且无失败 · `10` = 有 FAIL · **`30` = 存在「未判」项**（前置缺失或环境不支持 —— 不伪装通过）· `20` = 运行错误。

## 结论（2026-09-26 实测 · 20 PASS / 0 FAIL / 1 未判 · 退出码 30）

> `未判` 的那 1 项是 D6（构建对照实验），原因见下「边界」——**它是环境前置，不是产品缺陷**。

| 问题 | 结论 | 灵敏度对照 |
|---|---|---|
| **C1–C4** 「`docker compose config` 通过」这条判据本机可判吗 | **可判**（此前登记「真解析只能在服务器侧做」**过宽**）：`docker-compose`（独立二进制，本机无插件）**不需要守护**即可解析；判据的**前置**是 ① 5 个以 `${X:?}` 强制的变量齐（`PORTAL_IMAGE` / `PORTAL_ADMIN_HOST` / `PORTAL_MCP_HOST` / `PORTAL_ACCESS_TEAM_DOMAIN` / `PORTAL_ACCESS_AUD`）② **`portal.env` 必须存在**（`env_file`，缺则 `config` 也非 0） | 三段对照同一命令：缺变量 ⇒ rc=1 且点名 5 个缺失键；变量齐但无 `portal.env` ⇒ rc=1；两者齐 ⇒ **rc=0 + 规范化 YAML**（`name: memory-agent-mate-portal`）。只有「该拒」与「该过」都被观察到，判据才不是恒真 |
| **C5 / C6** 镜像坐标与锁侧输入 | `upstream.lock` **未挂进容器**（仅注释提及）⇒ 锁侧输入须由**构建期**注入（`#17` 版本断言的前提）；compose 用 `${PORTAL_IMAGE:?}` 且**非注释行**零硬编码上游 tag | `S1` 正对照（注入非注释的硬编码 tag + 挂锁行 ⇒ 必被两条判据抓到）· `S2` 反对照（只写在注释里 ⇒ 恒不命中） |
| **C7** 「不继承上游 `ENTRYPOINT`/`CMD`/`ENV`」可机械判吗 | 可写成**静态判据**：全产品目录内以 `FROM 上游镜像` 起手的构建文件数**恒为 0**（继承只发生在 `FROM` 上游镜像时）。现状 = 0（门户 `Dockerfile` 尚未创建） | 判据是「计数恒 0」型：任何一处 `FROM 上游` 即转红 |
| **C8a–c** 三项制品契约的声明形态 | 二进制路径两侧都声明 · 底座 `bookworm` + `ca-certificates` 两侧都声明 · **uid/gid 的契约是「必须对齐」而非常量**（`mcp-design.md` §5.6.3 明写「UID/GID **不固定为常量**」，并给出验证命令 `docker run --rm --entrypoint id <img> aimem`）⇒ **`999` 是门户侧假设值，由 D3 实测裁决** | `S3` 判据自检（同一合成判据的正反输入：好/好=0 · 好/坏=1 · 坏/坏=1） |
| **D1–D2** 镜像可拉取 / 指纹可核 | 可按 `linux/amd64` 拉取；`RepoDigests` 含锁里的 **`IMAGE_DIGEST_MANIFEST`**（`sha256:507d2a50…`）。**取法要点**：多架构拉取后 `RepoDigests` 记的是**索引摘要**，不是平台专属摘要 ⇒ 比 `IMAGE_DIGEST_AMD64` 会**恒假红** | D1 带**有界重试**（首跑实测到一次 ghcr 匿名 token 瞬时失败 ⇒ 外部依赖默认是竞态） |
| **D3** `aimem` 的 uid/gid | **实测 `uid=999(aimem) gid=999(aimem) groups=999(aimem)` == `999:999`** ⇒ `web-design.md` §3.2 / §3.4 的 `999` **成立，无需改**；门户 `useradd --uid 999 --gid 999` 可直接照写 | 敏感性证明：期望值临时改 `888:888` ⇒ **D3 转红**；还原后文件哈希与基准一致、复跑转绿 |
| **D4** 二进制路径 + 版本 | `/usr/local/bin/ai-memory` 存在；`ai-memory --version` = `ai-memory 0.10.0` ⇒ 末位 semver `0.10.0` == 锁的 `IMAGE_TAG`（`UPSTREAM_RELEASE_TAG=v0.10.0` 去 `v`）—— 与 `#17` 版本断言**同一比对体** | 两条不同形态的版本串必须归一化到同一值 |
| **D5** 上游 `Config` 的继承后果 | **实测**：`Entrypoint=["ai-memory"]` · `Cmd=["serve","--host","0.0.0.0"]` · `Env=["PATH=…","AI_MEMORY_DB=/data/ai-memory.db"]` ⇒ **若门户镜像以任何方式继承它，每个用户的库都会静默指向共享主库**（正是 RID `R1` 的形态）；若继承 `Cmd`，门户会去 `serve` 上游 HTTP 面。⇒「门户产物 Env 零 `AI_MEMORY_DB` + Entrypoint/Cmd 自声明」这条要求**有依据、非空转** | 反向对照：若上游 `Config` 里没有这些键，本断言即 FAIL（要求失去依据须重定判据）—— 首版就这么自检过 |
| **D6** 构建对照实验 | **未判**（环境）：本机 `aarch64` 且**缺 `buildx` 组件** ⇒ ① `COPY --from=上游镜像` 按**宿主平台**解析 ⇒ `invalid from flag value … no match for platform`；② 退到 `docker cp` 取文件 + `COPY` 后仍在**导出**阶段失败 ⇒ 须在 amd64 机器 / CI / 装了 buildx 的环境复跑 | 判据已定形（门户规范产物 `Entrypoint` ≠ 上游且 `Env` 无 `AI_MEMORY_DB`），复跑即在有构建能力的环境判定 |

## 对 `#1` 的判据定档（本探针的主要产出）

1. **编排判据本机可判**：「`docker compose config` 通过」的前置是 **5 个必需变量 + `portal.env` 存在**；缺任一必 `rc≠0` 且点名。⇒ 不必等服务器侧（更正 `4.4`/`3.16` 轮「真解析只能在服务器侧做」的登记口径：**结构与插值**本机可判，**真实 healthcheck 行为**才需运行环境）。
2. **构建配方（新增硬要求）**：门户镜像**必须钉 `linux/amd64`，且需要 BuildKit（`buildx`）** —— 本机 arm64 + legacy builder 下 `COPY --from` 会按宿主平台解析而失败。构建地点三选一：amd64 机器 / CI / 服务器侧；本机要跑则先装 `buildx`。
3. **「零继承」的判据形式**：门户镜像 `inspect` 的 `Env` **零 `AI_MEMORY_DB`**，且 `Entrypoint`/`Cmd` 是**自己声明的**（否则继承 base 镜像 `node:22-bookworm-slim` 的 `docker-entrypoint.sh` / `node`）。
4. **版本断言三件套可判**：二进制路径存在 + `--version` 末位 semver == 锁 tag；锁文件**未挂进容器** ⇒ `IMAGE_TAG` 由构建期注入。
5. **指纹口径**：本机只能核**索引摘要**（`IMAGE_DIGEST_MANIFEST`）；平台专属摘要（`IMAGE_DIGEST_AMD64`）归既有门禁 `make preflight ARGS=--with-image`（registry-api），**不重复造判据**。
6. **uid/gid 已实测**：`999:999` 成立（门户侧声明无需改）。

## 首轮踩到的坑（v2 已全修，记录以免重犯）

1. **把注释当制品 ⇒ 2 条假红**（C5 / C6）：compose 第 12 行注释里的示例写法（`COPY --from=…` / tag 由 `upstream.lock` 注入）被整文件 grep 命中 ⇒ 制品类扫描**必须剔注释行**（`nocomment()`），并配 `S1`/`S2` 正反对照。
2. **把「待实测值」当「文档事实」** ⇒ 1 条假红（C8）：`mcp-design.md` 明写 uid/gid「**不固定为常量**」，我却断言两侧都写 `999`。正确判据形态是「**契约 = 对齐，取值待实测**」。
3. **极性写反 ⇒ 三条同红**（C8a/b/c 首版）：`check` 的约定是 `0 = PASS`，我却用 `1` 表示成功。「三条同时红/同时绿」是这类错的典型指纹 ⇒ 抽成合成判据函数并加 `S3` 自检。
4. **取错字段 ⇒ 恒假红**（D2）：多架构镜像的 `RepoDigests` 是**索引摘要**，我却比平台专属摘要。判据要先确认「观测字段的语义」。
5. **外部依赖默认是竞态**（D1）：ghcr 匿名 token 请求偶发失败 ⇒ 一次假红。加**有界重试**（3 次 / 2s）。
6. **判据文案里不得写死被断言的数字**：D3 首版把 `999:999` 写进断言名，做敏感性证明时「断言是 888、文案写 999」⇒ 期望值改走变量（`EXPECT_UIDGID`）。

## 边界（如实登记）

- 本探针**只读**：不改产品代码、不改 `specs/`、不改 `deploy/` 制品；compose 解析在**临时目录副本**里做（`trap` 清理，零污染 —— `portal.env` 虽被 gitignore，也不落仓库）。
- **`#1` 的产物（`Dockerfile` + 构建脚本）不在本探针内**：本探针只回答「判据能不能定、取值是多少」；镜像本体归 `#1` 实现轮。
- **D6 未判 = 环境前置**：本机无 `buildx` 且宿主为 arm64。复跑条件：amd64 宿主 / 装 `buildx` / 在 CI。**不是「通过」**，故退出码为 30。
- `portal.env` 的**真值**（门户专用 MaaS key）不在本探针范围：模板见 [`../../deploy/portal.env.example`](../../deploy/portal.env.example)。
- 相 2 的 D2–D5 只在 **D1 成功且相 1 零失败**时执行（避免在坏基线上重复拉取镜像）；若 `D1` 失败，结论行会相应变少，属**有意的短路**。
