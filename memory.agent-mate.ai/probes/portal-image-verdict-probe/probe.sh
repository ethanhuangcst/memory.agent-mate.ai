#!/usr/bin/env bash
# #1 开工准备判据可行性探针 —— 门户镜像与编排制品（研究类，不入制品；只读）
#
# 服务对象：Sprint 5 #1 deploy:门户镜像与编排制品
#   判据真源：specs/web-portal/web-design.md §3（制品约束 + 构建那一行）· §11（部署九步）
#             specs/mcp/mcp-design.md §5.6.3（上游侧三项制品契约的真源）
#
# 两相：
#   相 1（离线，不需要 docker 守护）：编排判据（compose config）+ 静态制品判据（零继承 / 契约一致）
#   相 2（需要 docker 守护）      ：镜像侧实值（uid/gid · 二进制路径 · 版本 · 继承对照实验）
#   相 2 的前置缺失时返回 30（未判 —— 不伪装通过）
#
# 退出码：0 = 两相全跑且无 FAIL · 10 = 有 FAIL（结论见断言表）· 30 = 相 2 未执行（前置缺失）· 20 = 运行错误
#
# 只读边界：本探针不改产品代码、不改 specs、不改 deploy 制品；compose 解析在临时目录里做副本，
#           零污染仓库（临时目录由 trap 清理）。

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/../.." && pwd)"   # memory.agent-mate.ai/
DEPLOY="${PRODUCT}/deploy"
SPECS="${PRODUCT}/specs"
LOCK="${PRODUCT}/upstream.lock"
COMPOSE="${DEPLOY}/portal.compose.yml"
WEB_DESIGN="${SPECS}/web-portal/web-design.md"
MC_DESIGN="${SPECS}/mcp/mcp-design.md"

PASS=0
FAIL=0
check() { # $1=id $2=name $3=ok(0/1) $4=detail
  local detail="${4:-}"
  if [ "$3" = "0" ]; then
    PASS=$((PASS + 1))
    printf 'PASS [%s] %s%s\n' "$1" "$2" "${detail:+ — ${detail}}"
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL [%s] %s%s\n' "$1" "$2" "${detail:+ — ${detail}}"
  fi
}
info() { printf '[i] %s\n' "$1"; }
# 制品类扫描一律**排除注释行**：首版把 compose 第 12 行注释里的示例写法（COPY --from=… / tag 由
# upstream.lock 注入）当成了制品命中，产生 C5 / C6 两条**假红**（见 README「首轮踩到的坑」）。
nocomment() { grep -v '^[[:space:]]*#' "$1"; }

UNJUDGED=0
# 「未判」不是通过：单独计数，并让退出码退化为 30（不伪装通过）—— 前置缺失 / 环境不支持时用它
unjudged() { # $1=id $2=name $3=原因
  UNJUDGED=$((UNJUDGED + 1))
  printf '未判 [%s] %s — %s\n' "$1" "$2" "$3"
}
finish() {
  echo
  echo "--- 结论 ---"
  printf '通过 %s 项 · 失败 %s 项 · 未判 %s 项\n' "${PASS}" "${FAIL}" "${UNJUDGED}"
  if [ "${FAIL}" -gt 0 ]; then exit 10; fi
  if [ "${UNJUDGED}" -gt 0 ]; then exit 30; fi
  exit 0
}

TMP="$(mktemp -d)" || { echo "无法创建临时目录" >&2; exit 20; }
cleanup() { rm -rf "${TMP}"; }
trap cleanup EXIT

echo "=== #1 开工准备探针：门户镜像与编排制品 ==="
echo

# ─────────────────────────────── 相 0：前置 ───────────────────────────────
info "产品目录：${PRODUCT}"

if command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN="$(command -v docker-compose)"
  COMPOSE_VER="$("${COMPOSE_BIN}" version 2>&1 | head -1)"
  check C0a "独立 docker-compose 在位（本机无 docker compose 插件）" 0 "${COMPOSE_VER}"
else
  COMPOSE_BIN=""
  check C0a "独立 docker-compose 在位（本机无 docker compose 插件）" 1 "未找到 docker-compose"
fi

if [ -s "${COMPOSE}" ]; then
  check C0b "门户编排制品存在且非空" 0 "${COMPOSE#${PRODUCT}/}（$(wc -l <"${COMPOSE}" | tr -d ' ') 行）"
else
  check C0b "门户编排制品存在且非空" 1 "缺失或为空：${COMPOSE}"
fi

# 仅当反向对照也成立时，正向解析才有意义（否则「rc=0」可能只是因为根本没校验）
REQUIRED_VARS="$(sed -n 's/.*\${\(PORTAL_[A-Z0-9_]*\):?.*/\1/p' "${COMPOSE}" 2>/dev/null | sort -u | tr '\n' ' ')"
REQUIRED_COUNT="$(echo "${REQUIRED_VARS}" | wc -w | tr -d ' ')"
info "compose 里以 \${X:?} 强制要求的变量 ${REQUIRED_COUNT} 个：${REQUIRED_VARS}"

# ─────────────────────────── 相 1：编排判据（离线） ───────────────────────────
echo
echo "--- 相 1：编排判据（离线，不需要 docker 守护）---"

cp "${COMPOSE}" "${TMP}/portal.compose.yml"

# C1 反向对照 A：变量全缺 ⇒ 必须非 0，且点名缺失键（fail-loud）
( cd "${TMP}" && env -u PORTAL_IMAGE -u PORTAL_ADMIN_HOST -u PORTAL_MCP_HOST \
    -u PORTAL_ACCESS_TEAM_DOMAIN -u PORTAL_ACCESS_AUD \
    "${COMPOSE_BIN}" -f portal.compose.yml config >/dev/null 2>"${TMP}/e1" )
RC1=$?
if [ "${RC1}" -ne 0 ] && grep -q "required variable" "${TMP}/e1"; then
  check C1 "反向对照：缺必需变量时 compose 非 0 退出并点名缺失键" 0 \
    "rc=${RC1} · $(grep -c 'required variable' "${TMP}/e1") 条缺失键报告"
else
  check C1 "反向对照：缺必需变量时 compose 非 0 退出并点名缺失键" 1 \
    "rc=${RC1}（期望非 0）· stderr 首行：$(head -1 "${TMP}/e1")"
fi

# C2 反向对照 B：变量齐但 env_file 不存在 ⇒ 必须非 0（判据的隐藏前置）
( cd "${TMP}" && PORTAL_IMAGE="x/y:0.0.0" PORTAL_ADMIN_HOST="a.test" PORTAL_MCP_HOST="b.test" \
    PORTAL_ACCESS_TEAM_DOMAIN="t.test" PORTAL_ACCESS_AUD="z" \
    "${COMPOSE_BIN}" -f portal.compose.yml config >/dev/null 2>"${TMP}/e2" )
RC2=$?
if [ "${RC2}" -ne 0 ] && grep -q "portal.env not found" "${TMP}/e2"; then
  check C2 "反向对照：变量齐但 env_file 缺失时仍非 0（前置 = portal.env 必须存在）" 0 \
    "rc=${RC2} · $(head -1 "${TMP}/e2" | cut -c1-90)"
else
  check C2 "反向对照：变量齐但 env_file 缺失时仍非 0（前置 = portal.env 必须存在）" 1 \
    "rc=${RC2}（期望非 0）· stderr 首行：$(head -1 "${TMP}/e2")"
fi

# C3 正向：变量齐 + portal.env 存在 ⇒ 0，且输出是规范化 YAML
printf 'DASHSCOPE_API_KEY=dummy-for-probe\n' >"${TMP}/portal.env"
( cd "${TMP}" && PORTAL_IMAGE="ghcr.io/example/portal:0.0.0" PORTAL_ADMIN_HOST="admin.example.test" \
    PORTAL_MCP_HOST="mcp.example.test" PORTAL_ACCESS_TEAM_DOMAIN="example.test" PORTAL_ACCESS_AUD="deadbeef" \
    "${COMPOSE_BIN}" -f portal.compose.yml config >"${TMP}/out.yaml" 2>"${TMP}/e3" )
RC3=$?
OK3=1
if [ "${RC3}" -eq 0 ] \
  && grep -q "^name: memory-agent-mate-portal$" "${TMP}/out.yaml" \
  && grep -q "^      PORTAL_ENV: production$" "${TMP}/out.yaml" \
  && grep -q "^      PORTAL_DB_PATH: /srv/portal/portal.db$" "${TMP}/out.yaml"; then
  OK3=0
fi
check C3 "正向：变量齐 + portal.env 存在 ⇒ rc=0 且输出规范化 YAML（相 1 的主判据可判）" "${OK3}" \
  "rc=${RC3} · 输出 $(wc -l <"${TMP}/out.yaml" | tr -d ' ') 行 · 首行 $(head -1 "${TMP}/out.yaml")"

# C4 必需变量集合（判据可写成「这 N 个齐 + portal.env 存在」）
if [ "${REQUIRED_COUNT}" -eq 5 ]; then
  check C4 "必需变量集合可机械抽出且与设计一致（5 个）" 0 "${REQUIRED_VARS}"
else
  check C4 "必需变量集合可机械抽出且与设计一致（5 个）" 1 "实测 ${REQUIRED_COUNT} 个：${REQUIRED_VARS}"
fi

# 把两条扫描抽成函数 ⇒ 判据自检（S1/S2）用**同一判据**在合成输入上跑，而不是另写一套
lock_mentions() { nocomment "$1" | grep -c "upstream.lock" || true; }              # 非注释行提及锁文件
hardcoded_tag() { nocomment "$1" | grep -c "ghcr.io/alphaonedev/ai-memory:" || true; }  # 非注释行硬编码上游 tag

# C5 锁文件是否挂进容器（3.21 已实证未挂；此处复核并定归属）—— 只扫非注释行
if [ "$(lock_mentions "${COMPOSE}")" -gt 0 ]; then
  check C5 "upstream.lock 当前未挂进门户容器（锁侧输入归镜像构建期）" 1 \
    "非注释行里出现 upstream.lock"
else
  check C5 "upstream.lock 当前未挂进门户容器（锁侧输入归镜像构建期）" 0 \
    "volumes 无该文件（仅注释里提及）⇒ #17 版本断言的锁侧输入必须由构建期注入"
fi

# C6 镜像坐标外置 + 零硬编码上游 tag（防漂移）—— 只扫非注释行
HARDCODED="$(hardcoded_tag "${COMPOSE}")"
HARDCODED="${HARDCODED:-0}"
if nocomment "${COMPOSE}" | grep -q 'PORTAL_IMAGE:?' && [ "${HARDCODED}" -eq 0 ]; then
  check C6 "镜像坐标外置（\${PORTAL_IMAGE:?}）且 compose 内零硬编码上游 tag" 0 \
    "非注释行硬编码命中 ${HARDCODED} 处"
else
  check C6 "镜像坐标外置（\${PORTAL_IMAGE:?}）且 compose 内零硬编码上游 tag" 1 \
    "非注释行硬编码命中 ${HARDCODED} 处"
fi

# S1 / S2：C5 与 C6 的判据自检（同一判据跑合成输入）—— 正对照防假红、反对照防假绿
printf 'services:\n  portal:\n    image: ghcr.io/alphaonedev/ai-memory:0.10.0\n    volumes:\n      - ./upstream.lock:/lock:ro\n' \
  >"${TMP}/s1-inject.yml"
printf '# 注释里提到 ghcr.io/alphaonedev/ai-memory:<tag> 与 upstream.lock 是**示例**，不是制品\nservices:\n  portal:\n    image: ${PORTAL_IMAGE:?x}\n' \
  >"${TMP}/s2-comment-only.yml"
if [ "$(hardcoded_tag "${TMP}/s1-inject.yml")" -gt 0 ] && [ "$(lock_mentions "${TMP}/s1-inject.yml")" -gt 0 ]; then
  check S1 "正对照：非注释行注入（硬编码 tag + 挂锁文件）必被 C5/C6 的判据抓到（防假红）" 0 \
    "注入后命中 tag=$(hardcoded_tag "${TMP}/s1-inject.yml") · lock=$(lock_mentions "${TMP}/s1-inject.yml")"
else
  check S1 "正对照：非注释行注入（硬编码 tag + 挂锁文件）必被 C5/C6 的判据抓到（防假红）" 1 \
    "注入未被抓到 ⇒ C5/C6 判据失效"
fi
if [ "$(hardcoded_tag "${TMP}/s2-comment-only.yml")" -eq 0 ] && [ "$(lock_mentions "${TMP}/s2-comment-only.yml")" -eq 0 ]; then
  check S2 "反对照：只在注释里出现时判据恒不命中（防把注释当制品 ⇒ 假红）" 0 \
    "注释副本命中 tag=0 · lock=0（首版正是在这里假红 2 条）"
else
  check S2 "反对照：只在注释里出现时判据恒不命中（防把注释当制品 ⇒ 假红）" 1 \
    "注释副本被误判为命中 ⇒ 判据扫描面过宽"
fi

# C7 「不继承上游 ENTRYPOINT/CMD/ENV」的静态可判形式：构建文件里零 FROM 上游镜像
#    （继承只在 FROM 上游镜像时发生；COPY --from 不继承 —— 相 2 的 D5 是它的对照实验）
FROM_UPSTREAM="$(grep -rn "^FROM .*alphaonedev/ai-memory" "${PRODUCT}" --include="Dockerfile*" --include="*.dockfile" 2>/dev/null | wc -l | tr -d ' ')"
BUILD_FILES="$(grep -rln "^FROM " "${PRODUCT}" --include="Dockerfile*" 2>/dev/null | wc -l | tr -d ' ')"
if [ "${FROM_UPSTREAM}" -eq 0 ]; then
  check C7 "零继承路径：全产品目录内没有以 FROM 上游镜像起手的构建文件（判据 = 该计数恒为 0）" 0 \
    "命中 ${FROM_UPSTREAM} · 当前构建文件数 ${BUILD_FILES}（门户 Dockerfile 尚未创建）"
else
  check C7 "零继承路径：全产品目录内没有以 FROM 上游镜像起手的构建文件（判据 = 该计数恒为 0）" 1 \
    "命中 ${FROM_UPSTREAM} 处 —— 该写法会继承上游 ENTRYPOINT/CMD/ENV"
fi

# C8 三项制品契约的**声明形态**（人工比对的机械替代）。
#    ⚠️ `mcp-design.md` §5.6.3 明写「容器用户 aimem（useradd --system，UID/GID **不固定为常量**）」
#    ⇒ 数字 999 是**门户侧的假设值、不是文档事实**（首版把它当两侧共同事实断言 ⇒ 假红）。
#    实测归相 2 的 D3；不符则 `web-design.md` §3.2 / §3.4 的 999 必须改。
bin_path_declared() { grep -q -- "/usr/local/bin/ai-memory" "$1"; }   # 0 = 声明了
# 合成判据（0 = 两侧都声明）：抽成函数是为了让 S3 用**同一判据**在正反两种合成输入上自检
c8a_bad() { local bad=0; bin_path_declared "$1" || bad=1; bin_path_declared "$2" || bad=1; echo "${bad}"; }
check C8a "二进制路径 /usr/local/bin/ai-memory 两侧文档都声明" "$(c8a_bad "${WEB_DESIGN}" "${MC_DESIGN}")" \
  "web-design §3.2（COPY --from）+ mcp-design §5.6.3（真源）"

BASE_BAD=0
grep -q -- "bookworm" "${WEB_DESIGN}" || BASE_BAD=1
grep -q -- "ca-certificates" "${WEB_DESIGN}" || BASE_BAD=1
grep -q -- "bookworm" "${MC_DESIGN}" || BASE_BAD=1
check C8b "底座 bookworm 系 + ca-certificates 两侧文档都声明" "${BASE_BAD}" \
  "上游镜像底座单平台 linux/amd64，门户底座须同系"

UID_BAD=0
grep -q -- "不固定为常量" "${MC_DESIGN}" || UID_BAD=1
grep -q -- "entrypoint id" "${MC_DESIGN}" || UID_BAD=1
grep -q -- "999" "${WEB_DESIGN}" || UID_BAD=1
check C8c "uid/gid 的契约形态 = 「必须对齐」而非常量（含文档自带的验证命令 + 门户侧假设值）" "${UID_BAD}" \
  "mcp-design 明写「不固定为常量」并给 docker run --entrypoint id；999 是门户侧假设值 ⇒ 由相 2 D3 实测裁决"

# S3：C8a 的判据自检 —— 正反两种合成输入必须给出**不同**结论（专防「极性与约定反了」这类错，
#     首版 C8a/b/c 正因为把 1 当成功而三条同红）
printf 'COPY --from=x /usr/local/bin/ai-memory /usr/local/bin/ai-memory\n' >"${TMP}/s3-good.txt"
printf 'COPY --from=x /usr/local/bin/other-binary /usr/local/bin/other-binary\n' >"${TMP}/s3-bad.txt"
S3_OK=0
[ "$(c8a_bad "${TMP}/s3-good.txt" "${TMP}/s3-good.txt")" = "0" ] || S3_OK=1
[ "$(c8a_bad "${TMP}/s3-good.txt" "${TMP}/s3-bad.txt")" = "1" ] || S3_OK=1
[ "$(c8a_bad "${TMP}/s3-bad.txt" "${TMP}/s3-bad.txt")" = "1" ] || S3_OK=1
check S3 "C8a 判据自检：正输入 ⇒ 0（不报错）· 反输入 ⇒ 1（必报错），两个方向都被观察到" "${S3_OK}" \
  "好/好=$(c8a_bad "${TMP}/s3-good.txt" "${TMP}/s3-good.txt") · 好/坏=$(c8a_bad "${TMP}/s3-good.txt" "${TMP}/s3-bad.txt") · 坏/坏=$(c8a_bad "${TMP}/s3-bad.txt" "${TMP}/s3-bad.txt")"

# ─────────────────────── 相 2：镜像侧实值（需 docker 守护） ───────────────────────
echo
echo "--- 相 2：镜像侧实值（需要 docker 守护）---"

if ! docker info >/dev/null 2>&1; then
  info "docker 守护不可用：$(docker info 2>&1 | head -1 | cut -c1-90)"
  unjudged D1-D6 "相 2（镜像侧实值：拉取 / 指纹 / uid·gid / 二进制版本 / Config 继承后果 / 构建对照）" \
    "docker 守护未运行 ⇒ 本相整体未判"
  finish
fi

LOCK_TAG="$(sed -n 's/^IMAGE_TAG="\(.*\)"$/\1/p' "${LOCK}" | head -1)"
LOCK_REPO="$(sed -n 's/^IMAGE_REPO="\(.*\)"$/\1/p' "${LOCK}" | head -1)"
LOCK_DIGEST_MANIFEST="$(sed -n 's/^IMAGE_DIGEST_MANIFEST="\(.*\)"$/\1/p' "${LOCK}" | head -1)"
LOCK_RELEASE_TAG="$(sed -n 's/^UPSTREAM_RELEASE_TAG="\(.*\)"$/\1/p' "${LOCK}" | head -1)"
UPSTREAM_REF="${LOCK_REPO}:${LOCK_TAG}"
NODE_REF="node:22-bookworm-slim"
SYS_ARCH="$(docker info --format '{{.Architecture}}' 2>/dev/null)"
EXPECT_UIDGID="999:999"   # web-design.md 声明的门户侧取值（待 D3 实测裁决；实测不符则改文档）
info "锁侧输入：${UPSTREAM_REF} · 索引指纹 ${LOCK_DIGEST_MANIFEST:0:24}…（标签可被重推 ⇒ 必须比指纹）"

# D1 拉取上游镜像（钉平台）—— **有界重试**：ghcr 的匿名 token 请求偶发失败，
#    首跑实测到一次 failed to authorize ⇒ 与外部系统共享资源的断言默认是竞态（同 Sprint 4 #8 的教训）
RC_PULL=1
for attempt in 1 2 3; do
  if docker pull --platform linux/amd64 "${UPSTREAM_REF}" >"${TMP}/pull.log" 2>&1; then
    RC_PULL=0
    break
  fi
  info "D1 第 ${attempt} 次拉取失败（可重试）：$(tail -1 "${TMP}/pull.log" | cut -c1-90)"
  sleep 2
done
if [ "${RC_PULL}" -eq 0 ]; then
  check D1 "上游镜像可按 linux/amd64 拉取（有界重试）" 0 "${UPSTREAM_REF}"
else
  check D1 "上游镜像可按 linux/amd64 拉取（有界重试）" 1 "$(tail -1 "${TMP}/pull.log" | cut -c1-110)"
fi

if [ "${FAIL}" -eq 0 ]; then
  # D2 指纹核对（标签可被重推 ⇒ 必比指纹）。
  #    ⚠️ 取法修正：多架构拉取后 docker 的 RepoDigests 记的是**索引摘要**（= 锁里的
  #    IMAGE_DIGEST_MANIFEST），**不是**平台专属摘要（IMAGE_DIGEST_AMD64）—— 首版拿后者比对
  #    ⇒ 恒假红。平台专属摘要本机 docker inspect 看不到，该维度由
  #    `make preflight ARGS=--with-image`（registry-api 直连 GHCR）覆盖，不在本探针重复造判据。
  DIGESTS="$(docker image inspect --format '{{range .RepoDigests}}{{.}} {{end}}' "${UPSTREAM_REF}" 2>/dev/null)"
  if echo "${DIGESTS}" | grep -q "${LOCK_DIGEST_MANIFEST}"; then
    check D2 "镜像 RepoDigests 含锁里的 IMAGE_DIGEST_MANIFEST（标签被重推即可发现）" 0 \
      "${LOCK_DIGEST_MANIFEST:0:24}…"
  else
    check D2 "镜像 RepoDigests 含锁里的 IMAGE_DIGEST_MANIFEST（标签被重推即可发现）" 1 \
      "实测 ${DIGESTS} · 锁 ${LOCK_DIGEST_MANIFEST:0:24}…"
  fi
  info "平台专属摘要（IMAGE_DIGEST_AMD64）本机不可判 ⇒ 归 make preflight ARGS=--with-image（见 upstream.lock 的指纹可信度栏）"

  # D3 aimem 的 uid/gid —— 命令形态**取自契约本身**（mcp-design §5.6.3：docker run --rm --entrypoint id <img> aimem）
  ID_OUT="$(docker run --rm --platform linux/amd64 --entrypoint id "${UPSTREAM_REF}" aimem 2>&1 | head -1)"
  MEASURED="$(echo "${ID_OUT}" | sed -n 's/.*uid=\([0-9]*\).*gid=\([0-9]*\).*/\1:\2/p')"
  # 期望值走变量：判据文案里不得再写死一个数字（否则敏感性证明时文案与实际断言不一致）
  if [ "${MEASURED}" = "${EXPECT_UIDGID}" ]; then
    check D3 "容器用户 aimem 实测 uid/gid == ${EXPECT_UIDGID}（与 web-design 声明的门户侧取值一致）" 0 "${ID_OUT}"
  else
    check D3 "容器用户 aimem 实测 uid/gid == ${EXPECT_UIDGID}（与 web-design 声明的门户侧取值一致）" 1 \
      "实测 ${MEASURED:-无法解析}（${ID_OUT}）⇒ web-design §3.2 / §3.4 的 999 必须改为实测值，门户 useradd 同步"
  fi

  # D4 二进制路径 + 版本归一化（与 #17 版本断言同一比对体）
  LS_OUT="$(docker run --rm --platform linux/amd64 --entrypoint /bin/ls "${UPSTREAM_REF}" -l /usr/local/bin/ai-memory 2>&1 | head -1)"
  VER_OUT="$(docker run --rm --platform linux/amd64 --entrypoint /usr/local/bin/ai-memory "${UPSTREAM_REF}" --version 2>&1 | head -1)"
  SEMVER="$(echo "${VER_OUT}" | grep -o '[0-9][0-9.]*$' | head -1)"
  if echo "${LS_OUT}" | grep -q "ai-memory" && [ "${SEMVER}" = "${LOCK_TAG}" ]; then
    check D4 "二进制在 /usr/local/bin/ai-memory 且 --version 末位 semver == 锁 tag" 0 \
      "${VER_OUT} ⇄ ${LOCK_RELEASE_TAG}/${LOCK_TAG}"
  else
    check D4 "二进制在 /usr/local/bin/ai-memory 且 --version 末位 semver == 锁 tag" 1 \
      "ls=${LS_OUT} · version=${VER_OUT} · 锁=${LOCK_TAG}"
  fi

  # D5 上游 Config 的**继承后果**（只 inspect，不需要构建 ⇒ 本相恒可判）。
  #    它是「门户产物零 AI_MEMORY_DB + Entrypoint/Cmd 自声明」这条判据的**依据**：
  #    若上游 Config 里根本没有这些键，那条要求就是空转（反向对照）。
  U_ENTRY="$(docker image inspect --format '{{json .Config.Entrypoint}}' "${UPSTREAM_REF}")"
  U_CMD="$(docker image inspect --format '{{json .Config.Cmd}}' "${UPSTREAM_REF}")"
  U_ENV="$(docker image inspect --format '{{json .Config.Env}}' "${UPSTREAM_REF}")"
  info "上游镜像 Config：Entrypoint=${U_ENTRY} · Cmd=${U_CMD}"
  info "上游镜像 Config.Env=${U_ENV}"
  if echo "${U_ENV}" | grep -q "AI_MEMORY_DB=/data/ai-memory.db" \
    && [ "${U_ENTRY}" != "null" ] && [ "${U_CMD}" != "null" ]; then
    check D5 "上游 Config 里确有可致静默失效的键（Env 含 AI_MEMORY_DB=/data/ai-memory.db、Entrypoint/Cmd 非空）" 0 \
      "继承它 ⇒ 每用户库静默指向共享主库（RID R1 的形态）⇒ 「门户产物零该键」这条要求有依据、非空转"
  else
    check D5 "上游 Config 里确有可致静默失效的键（Env 含 AI_MEMORY_DB=/data/ai-memory.db、Entrypoint/Cmd 非空）" 1 \
      "上游 Env=${U_ENV} · Entrypoint=${U_ENTRY} · Cmd=${U_CMD} ⇒ 「不继承」失去依据，须重定判据"
  fi

  # D6 构建对照实验（门户规范 `FROM node` + 只取二进制 ⇒ 产物三项与上游不同）—— **需要构建能力**。
  #    本机实测（2026-09-26）：arm64 宿主 + 缺 buildx 组件 ⇒ ① `COPY --from` 按**宿主平台**解析
  #    （invalid from flag value … no match for platform）② 退到 docker cp + COPY 后仍在**导出**
  #    阶段失败（failed to export image: NotFound: content digest … not found）。
  #    ⇒ 属**环境前置**（不是产品缺陷）⇒ 记「未判」，判据已定形，留给 amd64 机器 / CI / 装了 buildx 的环境复跑。
  if docker buildx version >/dev/null 2>&1; then
    mkdir -p "${TMP}/d6"
    printf 'FROM --platform=linux/amd64 %s\n' "${UPSTREAM_REF}" >"${TMP}/d6/Dockerfile.inherit"
    printf 'FROM --platform=linux/amd64 %s\nCOPY --from=%s /usr/local/bin/ai-memory /usr/local/bin/ai-memory\n' \
      "${NODE_REF}" "${UPSTREAM_REF}" >"${TMP}/d6/Dockerfile.portal"
    docker buildx build --platform linux/amd64 --load -q -t probe-d6-inherit -f "${TMP}/d6/Dockerfile.inherit" "${TMP}/d6" >"${TMP}/d6/b1.log" 2>&1
    RC_A=$?
    docker buildx build --platform linux/amd64 --load -q -t probe-d6-portal -f "${TMP}/d6/Dockerfile.portal" "${TMP}/d6" >"${TMP}/d6/b2.log" 2>&1
    RC_B=$?
    # 实测对照（2026-09-26）：**`docker build` 即便装了 buildx 也仍然失败**
    #   （`failed to resolve source metadata … no match for platform in manifest`）
    #   ⇒ 判据的调用路径本身也是判据：这里必须与构建脚本同款（buildx + --platform + --load）。
    if [ "${RC_A}" -eq 0 ] && [ "${RC_B}" -eq 0 ]; then
      B_ENTRY="$(docker image inspect --format '{{json .Config.Entrypoint}}' probe-d6-portal)"
      B_ENV="$(docker image inspect --format '{{json .Config.Env}}' probe-d6-portal)"
      if [ "${U_ENTRY}" != "${B_ENTRY}" ] && ! echo "${B_ENV}" | grep -q "AI_MEMORY_DB"; then
        check D6 "门户规范产物的 Config 零继承上游（Entrypoint 不同 · Env 无 AI_MEMORY_DB）" 0 \
          "产物 Entrypoint=${B_ENTRY} · Env=${B_ENV}"
      else
        check D6 "门户规范产物的 Config 零继承上游（Entrypoint 不同 · Env 无 AI_MEMORY_DB）" 1 \
          "产物 Entrypoint=${B_ENTRY} · Env=${B_ENV}"
      fi
      info "门户 Dockerfile 的硬要求（实测导出）：须显式写自己的 ENTRYPOINT/CMD —— 否则继承 base 镜像即 ${NODE_REF} 的入口"
      docker rmi -f probe-d6-inherit probe-d6-portal >/dev/null 2>&1
    else
      check D6 "门户规范产物的 Config 零继承上游（Entrypoint 不同 · Env 无 AI_MEMORY_DB）" 1 \
        "对照镜像构建失败：inherit rc=${RC_A} · portal rc=${RC_B}"
    fi
  else
    unjudged D6 "构建对照实验：门户规范产物零继承上游（Config 三项与上游不同）" \
      "本机缺 buildx 组件、宿主 ${SYS_ARCH} ⇒ 不能在本机构建 linux/amd64 门户镜像（COPY --from 平台解析 + 导出两步都会失败）；判据已定形，须在 amd64 机器 / CI / 装 buildx 的环境复跑"
  fi
fi

# ─────────────── 相 3：门户镜像契约（镜像由 make portal-image / CI 产出）───────────────
echo
echo "--- 相 3：门户镜像契约（PORTAL_BUILD_TAG 指定；缺则记未判）---"

PORTAL_TAG="${PORTAL_BUILD_TAG:-memory-agent-mate-portal:${LOCK_TAG}}"
if ! docker image inspect "${PORTAL_TAG}" >/dev/null 2>&1; then
  unjudged E1-E8 "门户镜像契约（Entrypoint/Cmd 自声明 · Env 零 AI_MEMORY_DB · 非 root 999:999 · 二进制版本 · tsx 可解析 · 静态资源在位）" \
    "镜像不在本机：${PORTAL_TAG}（构建入口：make portal-image，或 CI 的 .github/workflows/portal-image.yml）"
else
  info "被测镜像：${PORTAL_TAG}"
  # 上游 Config（相 2 未跑时在这里补算一次；供「不自声明成上游那样」的对照）
  U_ENTRY="${U_ENTRY:-$(docker image inspect --format '{{json .Config.Entrypoint}}' "${UPSTREAM_REF}" 2>/dev/null)}"
  U_CMD="${U_CMD:-$(docker image inspect --format '{{json .Config.Cmd}}' "${UPSTREAM_REF}" 2>/dev/null)}"

  # E1 平台
  P_ARCH="$(docker image inspect --format '{{.Architecture}}' "${PORTAL_TAG}" 2>/dev/null)"
  if [ "${P_ARCH}" = "amd64" ]; then
    check E1 "门户镜像是 linux/amd64（与上游二进制单平台一致）" 0 "Architecture=${P_ARCH}"
  else
    check E1 "门户镜像是 linux/amd64（与上游二进制单平台一致）" 1 "实测 Architecture=${P_ARCH}"
  fi

  # E2 入口是**门户自声明**的（既不是上游的，也不是 base 镜像 node 的）
  P_ENTRY="$(docker image inspect --format '{{json .Config.Entrypoint}}' "${PORTAL_TAG}" 2>/dev/null)"
  P_CMD="$(docker image inspect --format '{{json .Config.Cmd}}' "${PORTAL_TAG}" 2>/dev/null)"
  if [ "${P_ENTRY}" != "null" ] && [ "${P_ENTRY}" != "${U_ENTRY}" ] && [ "${P_CMD}" != "${U_CMD}" ] \
    && ! echo "${P_ENTRY}" | grep -q "docker-entrypoint.sh"; then
    check E2 "Entrypoint/Cmd 是门户自声明（≠ 上游 ${U_ENTRY} / ≠ base 镜像 docker-entrypoint.sh）" 0 \
      "Entrypoint=${P_ENTRY} · Cmd=${P_CMD}"
  else
    check E2 "Entrypoint/Cmd 是门户自声明（≠ 上游 ${U_ENTRY} / ≠ base 镜像 docker-entrypoint.sh）" 1 \
      "Entrypoint=${P_ENTRY} · Cmd=${P_CMD}"
  fi

  # E3 Env 零 AI_MEMORY_DB（继承它 = 每用户库静默指向共享主库 = RID R1 的形态）
  P_ENV="$(docker image inspect --format '{{json .Config.Env}}' "${PORTAL_TAG}" 2>/dev/null)"
  if echo "${P_ENV}" | grep -q "AI_MEMORY_DB"; then
    check E3 "门户镜像 Env 里零 AI_MEMORY_DB（继承上游该键 ⇒ 每用户库静默指向共享主库）" 1 "Env=${P_ENV}"
  else
    check E3 "门户镜像 Env 里零 AI_MEMORY_DB（继承上游该键 ⇒ 每用户库静默指向共享主库）" 0 "Env=${P_ENV}"
  fi

  # E4/E5 运行用户 = 999:999，且与上游镜像的 aimem 对齐
  P_ID="$(docker run --rm --entrypoint id "${PORTAL_TAG}" 2>&1 | head -1)"
  P_UIDGID="$(echo "${P_ID}" | sed -n 's/.*uid=\([0-9]*\).*gid=\([0-9]*\).*/\1:\2/p')"
  if [ "${P_UIDGID}" = "${EXPECT_UIDGID}" ]; then
    check E4 "门户容器默认以 999:999 运行（非 root）" 0 "${P_ID}"
  else
    check E4 "门户容器默认以 999:999 运行（非 root）" 1 "实测 ${P_UIDGID:-无法解析}（${P_ID}）"
  fi
  U_ID="$(docker run --rm --entrypoint id "${UPSTREAM_REF}" aimem 2>&1 | head -1)"
  U_UIDGID="$(echo "${U_ID}" | sed -n 's/.*uid=\([0-9]*\).*gid=\([0-9]*\).*/\1:\2/p')"
  if [ "${P_UIDGID}" = "${U_UIDGID}" ] && [ -n "${P_UIDGID}" ]; then
    check E5 "门户与上游镜像的用户标识**对齐**（否则 SSH 路径写不进门户建的目录）" 0 \
      "门户 ${P_UIDGID} == 上游 aimem ${U_UIDGID}"
  else
    check E5 "门户与上游镜像的用户标识**对齐**（否则 SSH 路径写不进门户建的目录）" 1 \
      "门户 ${P_UIDGID:-?} vs 上游 ${U_UIDGID:-?}"
  fi

  # E6 上游二进制真的进了镜像，且版本 == 锁 tag
  P_VER="$(docker run --rm --entrypoint /usr/local/bin/ai-memory "${PORTAL_TAG}" --version 2>&1 | head -1)"
  P_SEMVER="$(echo "${P_VER}" | grep -o '[0-9][0-9.]*$' | head -1)"
  if [ "${P_SEMVER}" = "${LOCK_TAG}" ]; then
    check E6 "镜像内 /usr/local/bin/ai-memory 可执行且版本 == 锁 tag" 0 "${P_VER}"
  else
    check E6 "镜像内 /usr/local/bin/ai-memory 可执行且版本 == 锁 tag" 1 "实测 ${P_VER} · 锁 ${LOCK_TAG}"
  fi

  # E7 运行期入口与依赖在位（tsx 由 dependencies 提供 —— 口径 A′）
  P_TSX="$(docker run --rm --entrypoint node "${PORTAL_TAG}" --import tsx -e "console.log('tsx-ok')" 2>&1 | tail -1)"
  P_SERVER="$(docker run --rm --entrypoint /bin/ls "${PORTAL_TAG}" -l /app/src/server.ts 2>&1 | head -1)"
  if echo "${P_TSX}" | grep -q "tsx-ok" && echo "${P_SERVER}" | grep -q "server.ts"; then
    check E7 "镜像内可跑 node --import tsx，且 /app/src/server.ts 在位（依赖装对、入口在位）" 0 \
      "tsx 输出=${P_TSX}"
  else
    check E7 "镜像内可跑 node --import tsx，且 /app/src/server.ts 在位（依赖装对、入口在位）" 1 \
      "tsx 输出=${P_TSX} · server.ts=${P_SERVER}"
  fi

  # E8 静态资源在位（门户页面依赖 /app/assets）
  P_CSS="$(docker run --rm --entrypoint /bin/ls "${PORTAL_TAG}" -l /app/assets/portal.css 2>&1 | head -1)"
  if echo "${P_CSS}" | grep -q "portal.css"; then
    check E8 "静态资源在位（/app/assets/portal.css —— compose 的 PORTAL_STATIC_ROOT 指向它）" 0 "${P_CSS}"
  else
    check E8 "静态资源在位（/app/assets/portal.css —— compose 的 PORTAL_STATIC_ROOT 指向它）" 1 "${P_CSS}"
  fi
fi

finish
