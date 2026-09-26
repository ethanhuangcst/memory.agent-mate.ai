# 门户镜像 —— Sprint 5 `#1`（deploy:门户镜像与编排制品）
#
# 契约真源：
#   · specs/web-portal/web-design.md §3.2（构建那一行）· §3.4（落地前置与启动自检）· §11（部署九步）
#   · specs/mcp/mcp-design.md §5.6.3（上游侧三项制品契约：二进制路径 / 底座 / uid·gid 对齐）
# 判据与实测依据：probes/portal-image-verdict-probe/README.md（20 PASS / 0 FAIL / 1 未判）
# 构建入口：make portal-image → memory.agent-mate.ai/scripts/build-portal-image.sh（**不要手敲 docker build**）
#
# 三条硬约束（都有实测依据，不是风格偏好）：
#   ① **必须钉平台并走 buildx**：上游二进制是单平台 linux/amd64；legacy builder 下 `COPY --from` 会按
#      **宿主**平台解析并失败（实测 `invalid from flag value … no match for platform`）。
#      ⇒ 平台由**构建脚本**统一钉死（`buildx build --platform linux/amd64`），本文件里不写死
#      （写死常量会被 buildx lint 判为 `FromPlatformFlagConstDisallowed`；且平台只该有一个真相源）。
#      防护是 fail-loud：若有人直接用 `docker build` 在 arm64 上构建，第一个 stage 就会报平台不匹配。
#   ② **上游 tag 由 upstream.lock 注入**（构建参数），不手写 —— 单一真相源见 ADR-004；锁变则镜像重建。
#   ③ **显式声明自己的 ENTRYPOINT/CMD，且 ENV 里零 `AI_MEMORY_DB`** —— 实测上游镜像的 `Env` 含
#      `AI_MEMORY_DB=/data/ai-memory.db`、`Entrypoint=["ai-memory"]`、`Cmd=["serve","--host","0.0.0.0"]`；
#      继承任一都会让**每个用户的库静默指向共享主库**（RID `R1` 的形态）或让门户去 serve 上游 HTTP 面。

# 由构建脚本从 upstream.lock 注入（默认值仅为可读性，脚本一律显式传参）
ARG UPSTREAM_IMAGE=ghcr.io/alphaonedev/ai-memory:0.10.0

# ── 中间 stage：只为取「上游那一个二进制」────────────────────────────────────────────────────
# **最终镜像不从它继承**：Docker 的 Config（ENTRYPOINT/CMD/ENV）只沿**最终 stage** 的 FROM 链继承，
# `COPY --from` 只搬文件 —— 这条由探针 `D5` 实测坐实（对照实验见 README）。
# 另：buildx 不支持 `COPY --from=$VAR`（`variable expansion is not supported for --from`）⇒ 必须走 stage。
FROM ${UPSTREAM_IMAGE} AS upstream

# ── 依赖 stage：装 `node_modules`（**工具链只在这一段**，不进最终镜像）────────────────────────
# 用 `node:22-bookworm`（完整变体）而不是 slim：它自带 python3 / make / g++ —— `better-sqlite3` 是原生
# 模块，实测在 slim 上会回落到 `node-gyp rebuild`（预编译包取不到时）并因**缺 Python**而失败
# （`gyp ERR! find Python … You need to install the latest version of Python`）。用它同时也省掉了在
# 模拟 amd64 下 `apt-get install` 工具链的漫长耗时（实测 apt 一层在本机要 ~18 分钟）。
FROM node:22-bookworm AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── 最终 stage：门户底座（bookworm 系 + ca-certificates）────────────────────────────────────
FROM node:22-bookworm-slim

ARG UPSTREAM_IMAGE
ARG IMAGE_TAG=0.10.0

# 门户要出站访问私有 MaaS 的 HTTPS 与 CF Access 的 JWKS ⇒ 证书必须有
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# ── 容器用户必须与上游镜像对齐 ────────────────────────────────────────────────────────────────
# 实测上游 = uid/gid 999:999（`docker run --rm --entrypoint id <img> aimem`）；门户若以不同 UID 建
# `/data/users/<handle>`，SSH 路径就写不进去（mcp-design §5.6.3 的硬要求）。
# ⚠️ **必须先建组**：`useradd --gid 999` 只接受**已存在**的 GID —— 实测在干净的 node:22-bookworm-slim
# 上直接跑会失败 `useradd: group '999' does not exist`（`web-design.md` §3.2 的单行示例漏了这一步，
# 已按实现订正该节）。
RUN groupadd --system --gid 999 aimem \
 && useradd --system --create-home --shell /bin/sh --uid 999 --gid 999 aimem

COPY --from=upstream /usr/local/bin/ai-memory /usr/local/bin/ai-memory

WORKDIR /app

# ── 依赖：从 deps stage 取（`--omit=dev` 即可跑 TS）───────────────────────────────────────────
# `tsx` 在 dependencies 里（口径 A′：0 处产品代码改动、镜像 ≈58 MB）。**不复用宿主 `node_modules`**
# 是因为 better-sqlite3 是原生模块，必须按 linux/amd64 取预编译/编译（宿主那份是 darwin-arm64）。
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules

# ── 运行期必需文件（compose 给的 PORTAL_VIEWS_ROOT/STATIC_ROOT 与这里的布局一致）────────────
COPY --chown=999:999 src ./src
COPY --chown=999:999 assets ./assets

# ── 门户自身库的落点（compose 挂 `portal_data:/srv/portal`）──────────────────────────────────
# 先建目录并**放一个占位文件**：Docker 只在「镜像里的挂载点非空」时才把内容（**含属主**）拷进新建的
# 命名卷；空目录不会触发拷贝 ⇒ 卷会是 root 属主、非 root 门户写不进去 ⇒ 启动即失败。
RUN install -d -o 999 -g 999 -m 0700 /srv/portal \
 && : > /srv/portal/.keep \
 && chown 999:999 /srv/portal/.keep

# 门户自有变量（**不是**继承上游：上游的 `AI_MEMORY_DB` 等一律不设）
ENV NODE_ENV=production

USER 999:999

EXPOSE 8080

# 显式声明入口（base 镜像 node 自带 `docker-entrypoint.sh` / `node`，不声明就会以 node 的入口起来）
ENTRYPOINT ["node", "--import", "tsx"]
CMD ["src/server.ts"]

LABEL org.opencontainers.image.title="memory-agent-mate-portal" \
      org.opencontainers.image.version="${IMAGE_TAG}" \
      ai-memory.upstream.image="${UPSTREAM_IMAGE}" \
      ai-memory.note="上游二进制经中间 stage COPY 取入；不继承上游 ENTRYPOINT/CMD/ENV"
