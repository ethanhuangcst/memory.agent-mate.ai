# `#1` 判据可行性探针 —— 门户镜像与编排制品（研究类，不入制品）

为 Sprint 5 `#1 deploy:门户镜像与编排制品` 服务。判据真源：[`../../specs/web-portal/web-design.md`](../../specs/web-portal/web-design.md) §3（制品约束 + 构建）· §11（部署九步）· [`../../specs/mcp/mcp-design.md`](../../specs/mcp/mcp-design.md) §5.6.3（上游侧三项制品契约的真源）。

调用（**只读**；相 1 不需要 docker 守护，相 2/3 需要）：

```bash
bash memory.agent-mate.ai/probes/portal-image-verdict-probe/probe.sh
PORTAL_BUILD_TAG=ghcr.io/<owner>/memory-agent-mate-portal:0.10.0 bash …/probe.sh   # 判别的镜像
```

退出码：`0` = 三相全判且无失败 · `10` = 有 FAIL · **`30` = 存在「未判」项**（前置缺失或环境不支持 —— 不伪装通过）· `20` = 运行错误。

**本机与 CI 跑同一份脚本**（`.github/workflows/portal-image.yml` 的「契约自检」步），判据只写一处。

## 结论（2026-09-26）

| 环境 | 结果 |
|---|---|
| **本机**（arm64 + colima + buildx v0.37.1） | 相 1 C0a–C10/S1–S3 **16 PASS** · 相 2 D1–D6 **6 PASS** · **相 3 未判**（本机不构建）⇒ **22 PASS / 0 FAIL / 1 未判 · rc=30** |
| **CI**（GitHub Actions，ubuntu-latest 原生 amd64） | 三相全判 ⇒ 探针 **rc=0**（工作流 run `36226846982` success）；构建+推送+自检合计 **≈66 s** |

### 相 1 · 编排判据（离线）

| 断言 | 结论 | 依据 / 对照 |
|---|---|---|
| C0a | **两种 compose 实现都接受** | 本机只有**独立二进制**（`docker-compose` 5.5.0）；GitHub runner 只有**插件**（`docker compose`）。首版只认独立二进制 ⇒ CI 上 **rc=127**（本地把 `docker-compose` 从 PATH 去掉即复现） |
| C0b/C4 | 制品在位；`${X:?}` 强制变量**可机械抽出**（5 个：`PORTAL_IMAGE` / `PORTAL_ADMIN_HOST` / `PORTAL_MCP_HOST` / `PORTAL_ACCESS_TEAM_DOMAIN` / `PORTAL_ACCESS_AUD`） | — |
| C1/C2/C3 | `docker compose config` **本机可判**（不需要守护）：缺变量 ⇒ rc=1 且点名 5 键 · 变量齐但无 `portal.env` ⇒ rc=1 · 两者齐 ⇒ rc=0 + 规范化 YAML | 三段对照同一命令；更正此前「真解析只能在服务器侧做」的口径 |
| C6 | 镜像坐标外置（`${PORTAL_IMAGE:?}`）且**非注释行**零硬编码上游 tag | S1/S2 正反对照 |
| C7 | 「零继承」的静态形式：全产品目录内以 `FROM 上游镜像` 起手的构建文件数**恒为 0** | — |
| C8a–c | 三项制品契约的声明形态两侧一致；**uid/gid 是「必须对齐」而非常量**（`999` 是门户侧假设值，由 D3 实测裁决） | S3 判据自检 |
| **C9** | 编排与上游**同网络**：`networks.default` = `external: true` + `name: portainer_network` | — |
| **C10** | 共享 `ai_memory_data:/data` · 门户库落 `portal_data:/srv/portal` 且**不在 `/data` 下** | — |
| C5 | **状态记录（不是断言）**：`upstream.lock` 当前**未挂**进容器 ⇒ 挂载 + 读取位归 `#17` | 见下「不写成断言的一条」 |

### 相 2 · 镜像侧实值（需 docker 守护）

| 断言 | 结论 |
|---|---|
| D1/D2 | 上游镜像可按 `linux/amd64` 拉取（**有界重试**：首跑遇到一次 ghcr 匿名 token 瞬时失败）· `RepoDigests` 含锁里的 **`IMAGE_DIGEST_MANIFEST`** —— 多架构拉取记的是**索引**摘要，比平台专属摘要会**恒假红**；平台维度归 `make preflight ARGS=--with-image` |
| D3 | `aimem` 实测 **uid=999 gid=999** ⇒ `web-design` §3.2/§3.4 的 `999` **成立，无需改** |
| D4 | `/usr/local/bin/ai-memory` 存在 · `--version` = `ai-memory 0.10.0` ⇄ 锁 tag |
| D5 | 上游 `Config` 实测 `Entrypoint=["ai-memory"]` · `Cmd=["serve","--host","0.0.0.0"]` · `Env` 含 **`AI_MEMORY_DB=/data/ai-memory.db`** ⇒ 继承它 = **每用户库静默指向共享主库**（RID `R1` 的形态）⇒「门户产物零该键」这条要求有依据、非空转 |
| D6 | **构建对照实验**（buildx 可用后被真正判掉）：`COPY --from` 的产物**零继承**上游 `Entrypoint/Cmd/Env`。**调用路径本身是判据**：`docker build` 即使装了 buildx 仍报 `no match for platform in manifest`；`buildx build --platform linux/amd64 --load` 才成立 |

### 相 3 · 门户镜像契约（镜像由 `make portal-image` 或 CI 产出）

| 断言 | 结论（CI 实测） |
|---|---|
| E1 | 平台 = **linux/amd64** |
| E2 | `Entrypoint`/`Cmd` **门户自声明**（≠ 上游 `["ai-memory"]` / ≠ base 镜像 `docker-entrypoint.sh`） |
| E3 | `Env` **零 `AI_MEMORY_DB`** |
| E4 | 容器默认以 **999:999** 运行（非 root） |
| E5 | 与上游镜像的用户标识**对齐** |
| E6 | 镜像内 `/usr/local/bin/ai-memory` 可执行且版本 == 锁 tag |
| E7 | `node --import tsx` 可跑 · `/app/src/server.ts` 在位（口径 A′：`tsx` 在 dependencies） |
| E8 | `/app/assets/portal.css` 在位（compose 的 `PORTAL_STATIC_ROOT` 指向它） |
| E9 | 底座 **bookworm 系** + `ca-certificates` 为 `install ok installed` |

## 构建链路（本探针的产物之一）

- 入口：`make portal-image` → [`../../scripts/build-portal-image.sh`](../../scripts/build-portal-image.sh)（**唯一构建入口**；从 `upstream.lock` 注入 `IMAGE_TAG`，强制 buildx + `--platform linux/amd64`，退出码 10/20/30，支持 `--print-only`；产物 tag 用**专用**变量 `PORTAL_BUILD_TAG` —— 复用 `PORTAL_IMAGE` 会被 shell/compose 残值污染，实测过）。
- CI：[`../../../.github/workflows/portal-image.yml`](../../../.github/workflows/portal-image.yml) —— 构建 → 推 GHCR（`:<tag>` + `:<tag>-sha-<7位>`）→ 跑本探针。**不复制**构建配方（调脚本）也**不复制**判据（调探针）。
- **为什么构建放 CI**（实测依据）：本机 arm64 下 `apt-get install ca-certificates` 一层 **1085 s**、`better-sqlite3`（原生模块，取不到预编译包）源码编译 **15 分钟未完成**；runner 原生 amd64 ⇒ 全流程 **≈66 s**。

## 首轮踩到的坑（已全部修，记录以免重犯）

1. **把注释当制品** ⇒ C5/C6 假红 2 条（compose 第 12 行注释里的示例写法被整文件 grep 命中）⇒ 制品类扫描必须剔注释行 + S1/S2 正反对照。
2. **把「待实测值」当「文档事实」** ⇒ C8 假红（`999` 是门户侧假设值，契约只写「必须对齐」）。
3. **极性写反**（`check` 约定 `0 = PASS`）⇒ C8a/b/c 三条同红 ⇒ 抽成合成判据 + S3 自检。「多条同时红/同时绿」是这类错的指纹。
4. **取错字段** ⇒ D2 恒假红（`RepoDigests` 是索引摘要，不是平台摘要）。
5. **外部依赖默认是竞态** ⇒ D1 遇到 ghcr token 瞬时失败 ⇒ 加有界重试。
6. **断言文案里写死被断言的数字** ⇒ 敏感性证明时文案与断言不一致 ⇒ 期望值改走变量。
7. **断言文案里的反引号会被 shell 当命令替换**（仓内 `3.21` 已记录，本轮**又犯两次**）⇒ 探针输出文案一律不带反引号。
8. **判据的调用路径本身也是判据** ⇒ D6 必须用与构建脚本同款的 `buildx + --platform + --load`。
9. **只认一种实现** ⇒ 相 1 只认独立 `docker-compose` ⇒ CI（只有插件）rc=127；本地用「PATH 去掉 `docker-compose`」复现。（教训：判据要锚在**语义**（`config` 能否解析）上，不是某个安装形态。）
10. **会随正确实现翻转的断言不该写成断言** ⇒ C5 原本断言「锁文件未挂载」，而 `#17` 正是要挂它 ⇒ 改为 `info` 状态记录。

## 边界（如实登记）

- 本探针**只读**：不改产品代码、不改 `specs/`、不改 `deploy/` 制品；compose 解析在**临时目录副本**里做（`trap` 清理，零污染）。
- **`#1` 的产物**（`Dockerfile` / 构建脚本 / CI / `.dockerignore`）不在探针内 —— 探针只判「契约是否成立」。
- 相 2 的 D2–D5 只在 **D1 成功且相 1 零失败**时执行（避免在坏基线上重复拉取镜像）。
- **GHCR 包默认私有** ⇒ 服务器侧拉镜像需凭据（已登记为 `#9`/`#10` 的部署前置）；本机若要 pull 回来复跑相 3 也需登录。
- `upstream.lock` 的**挂载与读取位**归 `#17`（启动自检实现轮），本探针只记录现状。
