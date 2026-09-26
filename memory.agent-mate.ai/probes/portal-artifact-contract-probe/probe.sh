#!/usr/bin/env bash
# #2 开工准备判据可行性探针 —— 门户制品契约（研究类，不入制品；只读）
#
# 服务对象：Sprint 5 #2 deploy:制品契约
#   判据真源：specs/web-portal/web-stories.md S12 `AC12.1`–`AC12.3`
#             specs/web-portal/web-design.md §3.4（② 版本断言 · ③ 锁侧输入的归属 · ⑤ 编排侧缺口）
#             制品：deploy/portal.compose.yml · admin_portal/Dockerfile · scripts/build-portal-image.sh
#
# 三相：
#   相 1（离线，零依赖）：**判据可行性** —— 把 #2 的判据逐条证明「**能红能绿**」（正/反对照），
#                        并把「现状」与「断言」分开记（会随正确实现翻转的观察写成 info，不写成断言）
#   相 2（需 docker + 能取基础镜像）：探活工具面的**代理**实测（底座 = node:22-bookworm-slim）
#   相 3（需 PORTAL_BUILD_TAG 的门户镜像）：权威实测 —— 工具面 / boot 耗时 / healthcheck 行为 /
#                        重启循环 / LABEL vs 锁
#   相 2 / 相 3 的前置缺失时返回 30（**未判 —— 不伪装通过**）
#
# 退出码：0 = 全判且无 FAIL · 10 = 有 FAIL · 30 = 有未判项 · 20 = 运行错误
#
# 只读边界：不改产品代码 / specs / deploy 制品；所有改写只发生在 ${TMP} 副本里（trap 清理）。
#
# 用法：
#   bash memory.agent-mate.ai/probes/portal-artifact-contract-probe/probe.sh
#   PORTAL_BUILD_TAG=<name:tag> bash …/probe.sh          # 有门户镜像时跑相 3

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/../.." && pwd)" # memory.agent-mate.ai/
DEPLOY="${PRODUCT}/deploy"
SPECS="${PRODUCT}/specs"
COMPOSE="${DEPLOY}/portal.compose.yml"
LOCK="${PRODUCT}/upstream.lock"
DOCKERFILE="${PRODUCT}/admin_portal/Dockerfile"
BUILD_SH="${PRODUCT}/scripts/build-portal-image.sh"
SELFCHECK="${PRODUCT}/admin_portal/src/selfcheck.ts"
STORIES="${SPECS}/web-portal/web-stories.md"
WEB_DESIGN="${SPECS}/web-portal/web-design.md"
MCP_DESIGN="${SPECS}/mcp/mcp-design.md"
DEPLOYMENT="${SPECS}/deployment.md"
AUDIT="${PRODUCT}/probes/deploy-guide-audit/probe.mjs"

IMG="${PORTAL_BUILD_TAG:-}"                       # 门户镜像坐标（相 3 前置）
BASE_IMAGE="${PORTAL_BASE_IMAGE:-node:22-bookworm-slim}"
NAME="portal-contract-probe-$$"

PASS=0
FAIL=0
UNJUDGED=0

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
# 「未判」不是通过：单独计数，并让退出码退化为 30（前置缺失 / 环境不支持时用它）
unjudged() { # $1=id $2=name $3=原因
  UNJUDGED=$((UNJUDGED + 1))
  printf '未判 [%s] %s — %s\n' "$1" "$2" "$3"
}
info() { printf '[i] %s\n' "$1"; }
finish() {
  echo
  echo '--- 结论 ---'
  printf '通过 %s 项 · 失败 %s 项 · 未判 %s 项\n' "${PASS}" "${FAIL}" "${UNJUDGED}"
  if [ "${FAIL}" -gt 0 ]; then exit 10; fi
  if [ "${UNJUDGED}" -gt 0 ]; then exit 30; fi
  exit 0
}

TMP="$(mktemp -d)" || { echo '无法创建临时目录' >&2; exit 20; }
cleanup() {
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  rm -rf "${TMP}"
}
trap cleanup EXIT

nocomment() { grep -v '^[[:space:]]*#' "$1"; }

echo '=== #2 开工准备探针：门户制品契约 ==='
echo

# ───────────────────────────── 相 0：前置（在位性）─────────────────────────────
missing=''
for f in "${COMPOSE}" "${LOCK}" "${DOCKERFILE}" "${BUILD_SH}" "${SELFCHECK}" "${STORIES}" "${WEB_DESIGN}" "${DEPLOYMENT}" "${AUDIT}"; do
  [ -s "${f}" ] || missing="${missing} $(basename "${f}")"
done
check C0 '判据输入文件全部在位且非空' "$([ -z "${missing}" ] && echo 0 || echo 1)" "${missing:-9/9 在位}"
[ -z "${missing}" ] || finish

# ──────────────────── 相 1：判据可行性（离线，零依赖，不需要守护）────────────────────
echo
echo '--- 相 1：判据可行性（离线：正/反对照证明判据能红能绿）---'

# ── H：编排健康检查 ────────────────────────────────────────────────────────────────
# 「合格 healthcheck」的判据 = 块内四键齐（`test` / `interval` / `timeout` / `retries`）。
# 取块要**按缩进**切：子键与下一个同级键都以字母开头，靠开头字符判不出边界。
hc_block() {
  awk '
    /^[[:space:]]*healthcheck:/ { match($0, /^[[:space:]]*/); ind = RLENGTH; f = 1; print; next }
    f { match($0, /^[[:space:]]*/); if (RLENGTH <= ind && $0 ~ /[^[:space:]]/) f = 0; if (f) print }
  ' "$1"
}
hc_ok() { # 0 = 合格；1 = 不合格（含「无块」）
  local block
  block="$(hc_block "$1")"
  [ -n "${block}" ] || return 1
  printf '%s\n' "${block}" | grep -qE '^[[:space:]]+test:' || return 1
  printf '%s\n' "${block}" | grep -qE '^[[:space:]]+interval:' || return 1
  printf '%s\n' "${block}" | grep -qE '^[[:space:]]+timeout:' || return 1
  printf '%s\n' "${block}" | grep -qE '^[[:space:]]+retries:' || return 1
  return 0
}

# 现状（**记录**，不写成断言：它会在 #2 正确落地时必然翻转 —— 口径同 `#1` 探针的 `C5`）
info "现状：compose ${COMPOSE#${PRODUCT}/} 的 healthcheck 块 —— $([ -n "$(hc_block "${COMPOSE}")" ] && echo '存在' || echo '不存在（与 §3.4 ⑤ 登记的缺口一致）')"
info "现状：depends_on 命中 $(nocomment "${COMPOSE}" | grep -c 'depends_on') 处 · restart 策略 = $(nocomment "${COMPOSE}" | sed -n 's/^[[:space:]]*restart:[[:space:]]*//p' | head -1)"

# 样本一律**在 ${TMP} 里造，且不派生自制品现状** —— 口径同 `#1` 探针的 `C5`：**会随正确实现
# 翻转的观察不该写成断言**。踩过两次：① 首版把「现状无 healthcheck」当反样本 ⇒ `#2` 第 1 批
# 落地后必然假红；② 第二版往**真 compose** 注入 ⇒ 真 compose 已有 `healthcheck` 时**重复键**、
# YAML 直接非法（`mapping key "healthcheck" already defined`）。现在先造**最小合法 compose 底座**，
# 再在其上派生三态样本。
printf 'name: probe-hc\nservices:\n  portal:\n    image: x\n    container_name: probe-hc\n' >"${TMP}/hc-none.yml"
awk '1; /^[[:space:]]*container_name:/ && !d {
       print "    healthcheck:";
       print "      test: [\"CMD\", \"node\", \"-e\", \"fetch(\\\"http://localhost:8080/healthz\\\").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"]";
       print "      interval: 30s";
       print "      timeout: 5s";
       print "      retries: 3";
       print "      start_period: 20s";
       d = 1
     }' "${TMP}/hc-none.yml" >"${TMP}/hc-ok.yml"
awk '1; /^[[:space:]]*container_name:/ && !d {
       print "    healthcheck:";
       print "      interval: 30s";
       print "      timeout: 5s";
       print "      retries: 3";
       d = 1
     }' "${TMP}/hc-none.yml" >"${TMP}/hc-no-test.yml"

check H1 'healthcheck 判据可判（正/反对照三个方向都被观察到）' \
  "$(hc_ok "${TMP}/hc-ok.yml" && ! hc_ok "${TMP}/hc-no-test.yml" && ! hc_ok "${TMP}/hc-none.yml" && echo 0 || echo 1)" \
  '正样本（四键齐）=合格 · 缺 test =不合格 · 无块 =不合格 ⇒ 判据能分辨三态（样本全部合成）'

# H2：正样本必须是**合法 compose** —— 否则「判据转绿」可能只是因为样本本身非法（防假绿）
COMPOSE_CMD=()
command -v docker-compose >/dev/null 2>&1 && COMPOSE_CMD=(docker-compose)
[ "${#COMPOSE_CMD[@]}" -gt 0 ] || { docker compose version >/dev/null 2>&1 && COMPOSE_CMD=(docker compose); }
if [ "${#COMPOSE_CMD[@]}" -gt 0 ]; then
  # 合成样本自含（无 `${VAR:?}` 占位、无 `env_file`）⇒ 不需要任何环境变量或 `portal.env`
  ( cd "${TMP}" && "${COMPOSE_CMD[@]}" -f hc-ok.yml config >/dev/null 2>"${TMP}/e-hc" )
  RC_HC=$?
  if [ "${RC_HC}" -eq 0 ]; then
    HC_DETAIL='compose config rc=0（样本被接受 ⇒ 判据不是靠非法样本假绿）'
  else
    HC_DETAIL="compose config rc=${RC_HC} · $(head -1 "${TMP}/e-hc" 2>/dev/null | cut -c1-90)"
  fi
  check H2 '正样本是合法 compose（注入的 healthcheck 能被 compose 接受）' "$([ "${RC_HC}" -eq 0 ] && echo 0 || echo 1)" "${HC_DETAIL}"
else
  info 'H2 跳过：本机无 compose 命令行（独立二进制与插件都没有）⇒ 样本合法性未独立验证'
fi

# ── V：版本注入链路（AC12.3「版本标签来自版本锁而非手写」）──────────────────────────
LOCK_TAG="$(sed -n 's/^IMAGE_TAG="\(.*\)"$/\1/p' "${LOCK}" | head -1)"
V1_HITS=0
[ -n "${LOCK_TAG}" ] && V1_HITS=$((V1_HITS + 1))
grep -qE 'sed -n .*IMAGE_TAG' "${BUILD_SH}" && grep -q 'LOCK=' "${BUILD_SH}" && V1_HITS=$((V1_HITS + 1))
grep -q -- '--build-arg "IMAGE_TAG=' "${BUILD_SH}" && V1_HITS=$((V1_HITS + 1))
grep -qE '^ARG IMAGE_TAG' "${DOCKERFILE}" && V1_HITS=$((V1_HITS + 1))
grep -qE 'org\.opencontainers\.image\.version="\$\{IMAGE_TAG\}"' "${DOCKERFILE}" && V1_HITS=$((V1_HITS + 1))
check V1 '版本注入链路可机械抽出且**不手写**（锁 → 构建脚本 → build-arg → Dockerfile LABEL）' \
  "$([ "${V1_HITS}" -eq 5 ] && echo 0 || echo 1)" "链路上 5 个点位命中 ${V1_HITS} 个（锁 IMAGE_TAG=${LOCK_TAG:-缺}）"

# ── V2：版本断言的**两侧输入面**（判据可判 + 现状记录）────────────────────────────
# 「启动时与挂载的锁比对，不一致拒绝启动」（§3.4 ② 第 3 行）需要两个输入面同时存在：
#   ① 自身版本**读取位**（容器内可读到「我是哪个版本」）② 期望值 = **挂载进容器的锁**
# 判据用 grep 形态固定，并用注入样本证明「能被抓到」（双侧对照）。
ver_read_hits() { grep -rEc 'process\.env\.PORTAL_(IMAGE_TAG|VERSION)|PORTAL_IMAGE_TAG|APP_VERSION|image\.version' "$1" 2>/dev/null | awk -F: '{s += $NF} END {print s + 0}'; }
mount_hits() { nocomment "$1" | grep -c 'upstream\.lock'; }

SAMPLE="${TMP}/ver-sample"; mkdir -p "${SAMPLE}"
printf 'const v = process.env.PORTAL_IMAGE_TAG ?? "0.0.0";\n' >"${SAMPLE}/sample.ts"
# 挂载样本注入到 `volumes:` 块内（不是文件末尾）—— 判据要求「锁真的被挂进容器」，
# 样本本身就得是合法的挂载声明，否则又是「用非法样本证明判据」。
awk '1; /^[[:space:]]*volumes:[[:space:]]*$/ && !d { print "      - ../upstream.lock:/app/upstream.lock:ro"; d = 1 }' \
  "${COMPOSE}" >"${TMP}/mount-ok.yml"
# 反样本同样**合成**（不拿制品现状当样本 —— 它已随 `#2` 第 1 批挂上锁而翻转）
printf 'name: probe-mount-none\nservices:\n  portal:\n    image: x\n' >"${TMP}/mount-none.yml"
check V2 '版本断言的两侧输入面**可判**（自身读取位 / 挂载的锁，两侧对照都观察到）' \
  "$([ "$(ver_read_hits "${SAMPLE}")" -gt 0 ] && [ "$(ver_read_hits "${PRODUCT}/admin_portal/src")" -eq 0 ] \
     && [ "$(mount_hits "${TMP}/mount-ok.yml")" -gt 0 ] && [ "$(mount_hits "${TMP}/mount-none.yml")" -eq 0 ] && echo 0 || echo 1)" \
  '两向都由**合成样本**观察（正=命中 / 反=不命中）⇒ 判据能分辨「有没有」，且不随制品落地翻转'
info "现状：自身版本读取位在 admin_portal/src/ 命中 $(ver_read_hits "${PRODUCT}/admin_portal/src") 处 · 锁挂载在 compose 命中 $(mount_hits "${COMPOSE}") 处 ⇒ **两侧都缺**（§3.4 ③ 把「挂载 + 读取位」记归 #17）"
info "现状：selfcheck 的版本项 = $(grep -o "name: 'binary_version_matches_lock', status: '[a-z]*'" "${SELFCHECK}" | head -1 || echo '(未匹配)') ⇒ 该项判的是**上游二进制**版本，与门户**自身**版本的断言不是同一件事（归属待拍板）"

# ── V3：归属表述的可定位性（两处文本都在位 ⇒ 冲突是文本级事实，须拍板）───────────────
V3_B="$(grep -c '挂载锁文件 + 读取位' "${WEB_DESIGN}" || true)"
check V3 '「版本断言归属」的两处表述都能被机械定位（冲突须拍板，不是判据缺陷）' \
  "$([ "${V3_B}" -ge 1 ] && echo 0 || echo 1)" "§3.4 ③「挂载锁 + 读取位归 #17」命中 ${V3_B} 处"
info '现状：#2 的验收条件含「不一致拒绝启动」，而 §3.4 ③ 把「挂载锁文件 + 读取位」记归 #17 ⇒ **同一判据被两行认领**，须拍板归属（见 README「待拍板」）'

# ── B：制品侧「被登记但无读取方」的键（判据可判 + 现状记录）────────────────────────
# 这是 `deploy-guide-audit` 的**方向缺口**：`A2` = 「代码会读的键必须被登记」（`codeKeys ⊆ deployKeys`）
# —— 反方向（部署侧声明了、代码从不读）没有任何判据覆盖 ⇒ 会留下「看起来能配、其实无作用」的键。
deploy_keys() {
  # **只取 service 的 `environment:` 块内声明的键** —— 不含 compose 自身的插值变量（如 `image: ${PORTAL_IMAGE}`：
  # 那是 compose 用来定位镜像的，本来就不该被门户代码读取）。首版把两者混在一起 ⇒ `PORTAL_IMAGE` 假阳性
  # （判据要锚在语义：**「给容器的环境」≠「compose 自己的变量」**）。
  awk '
    /^[[:space:]]*environment:[[:space:]]*$/ { match($0, /^[[:space:]]*/); ind = RLENGTH; f = 1; next }
    f { match($0, /^[[:space:]]*/); if (RLENGTH <= ind && $0 ~ /[^[:space:]]/) f = 0; if (f) print }
  ' "$1" | grep -oE '^[[:space:]]*(PORTAL_[A-Z0-9_]+)[[:space:]]*:' | grep -oE 'PORTAL_[A-Z0-9_]+' | sort -u
  #                                                        ↑ `sort -u` 不能省：`comm` 的输入**必须有序**，
  #                                                        否则会把有序的一侧误判成差集（首版收窄时漏掉它 ⇒ 吐出 14 个假孤儿）
}
code_keys() {
  {
    grep -rhoE '(PORTAL_[A-Z0-9_]+)[[:space:]]*:' "${PRODUCT}/admin_portal/src/config.ts"
    grep -rhoE 'raw\.(PORTAL_[A-Z0-9_]+)' "${PRODUCT}/admin_portal/src" | sed 's/^raw\.//'
    grep -rhoE 'process\.env\.(PORTAL_[A-Z0-9_]+)' "${PRODUCT}/admin_portal/src" | sed 's/^process\.env\.//'
  } | sort -u
}
orphans() { comm -23 <(deploy_keys "$1") <(code_keys); }

# 正样本：把「只声明、代码从不读」的键注入到 **`environment:` 块内**（判据只认该块 —— 注入点必须与判据同面）
awk '1; /^[[:space:]]*environment:[[:space:]]*$/ && !d { print "      PORTAL_CODE_ONLY_KEY: x"; d = 1 }' \
  "${COMPOSE}" >"${TMP}/orphan-sample.yml"
check B1 '「被登记但代码从不读」的键**可判**（正/反两向都观察到）' \
  "$(orphans "${TMP}/orphan-sample.yml" | grep -qx 'PORTAL_CODE_ONLY_KEY' \
     && ! orphans "${COMPOSE}" | grep -qx 'PORTAL_ADMIN_HOST' && echo 0 || echo 1)" \
  '正：注入「只声明不读」的键 ⇒ 命中；反：真会被读的 PORTAL_ADMIN_HOST ⇒ **不**命中（防假阳性）'
ORPHAN_LIST="$(orphans "${COMPOSE}" | tr '\n' ' ')"
info "现状：compose 声明但代码 0 处读取的键 = 【${ORPHAN_LIST:-无}】"
if [ -n "${ORPHAN_LIST}" ]; then
  for k in ${ORPHAN_LIST}; do
    # 读取位用**判据**口径（`code_keys` 的三种真读取形态），不用子串 grep ——
    # 子串会把 `ADMIN_PORTAL_ROOT` 这类**无关常量**算成「有读取位」（首版即如此，属统计误导）。
    if code_keys | grep -qx "${k}"; then READER='有（判据口径）'; else READER='无（判据口径：三种真读取形态都不命中）'; fi
    info "  · ${k}：compose environment 声明 $(deploy_keys "${COMPOSE}" | grep -cx "${k}") 处 · deployment.md 命中 $(grep -c "${k}" "${DEPLOYMENT}") 处 · web-design.md 命中 $(grep -c "${k}" "${WEB_DESIGN}") 处 · 读取位 ${READER}"
  done
  info '  注：若某键在源码里唯一命中的是 ADMIN_PORTAL_ROOT 这类**常量**（由 import.meta.url 推导，与 env 无关），那是子串命中而非读取位 —— 读取位一律以「三种真读取形态」判据为准'
fi
info "方向缺口的实现依据：${AUDIT#${PRODUCT}/} 的 A2 = \`[...portalKeys].filter((key) => !deployKeys.has(key) && !docKeys.has(key))\` ⇒ **只判「代码会读 → 必须被登记」**；A2b 只扫源码令牌 ⇒ 部署侧多出来的键不在任何判据面内"

# ── U：uid/gid 对齐（AC12.2）—— 已由 #1 探针实证，此处只判「判据已存在且已判」─────
# 真源 = `web-design.md` §3.2（构建那一行）与 `mcp-design.md` §5.6.3（上游侧三项制品契约）；
# **不是** `deployment.md`（实测 uid/gid 命中 0 处 —— 首版把声明锚错到它上面，直接假红）。
U_HITS=0
grep -qiE 'uid.{0,4}gid' "${WEB_DESIGN}" && U_HITS=$((U_HITS + 1))
grep -qiE 'uid.{0,4}gid' "${MCP_DESIGN}" && U_HITS=$((U_HITS + 1))
grep -q 'E4' "${PRODUCT}/probes/portal-image-verdict-probe/probe.sh" && grep -q 'E5' "${PRODUCT}/probes/portal-image-verdict-probe/probe.sh" && U_HITS=$((U_HITS + 1))
grep -q '999' "${DOCKERFILE}" && U_HITS=$((U_HITS + 1))
check U1 'uid/gid 对齐（AC12.2）判据已存在且**已判**（引用 #1 探针 E4/E5，不重复跑）' \
  "$([ "${U_HITS}" -eq 4 ] && echo 0 || echo 1)" "真源声明/web-design/mcp-design/判据/实现四处命中 ${U_HITS} 个（E4/E5 已实证 999:999 ⇄ 999:999）"

# ── Q：第 1 批「编排可判」的**契约断言**（已落地 ⇒ 可以断言了）──────────────────────────
# 与 H1/V2 的区别（重要）：H1/V2 证明「**判据能判**」（用合成样本，不随实现翻转）；Q 断言
# 「**制品现状符合拍板契约**」—— 一旦被改坏就该红。体例同 `#1` 探针的 `C1`–`C10`（编排结构断言）。
HC_NOW="$(hc_block "${COMPOSE}")"
HC_KEYS="$(printf '%s\n' "${HC_NOW}" | grep -cE '^[[:space:]]+(test|interval|timeout|retries):' || true)"
RESTART_NOW="$(nocomment "${COMPOSE}" | sed -n 's/^[[:space:]]*restart:[[:space:]]*//p' | head -1)"
check Q1 '编排契约：`healthcheck` 四键齐 + `restart` 为**有界**形态（`on-failure:N`）' \
  "$([ "${HC_KEYS}" -ge 4 ] && printf '%s' "${RESTART_NOW}" | grep -qE '^on-failure:[0-9]+$' && echo 0 || echo 1)" \
  "healthcheck 键命中 ${HC_KEYS}/4 · restart=${RESTART_NOW:-（无）}"
check Q2 '编排契约：锁已挂载（版本断言的期望值输入面）且**无读取方的键**（`PORTAL_ROOT`）零残留' \
  "$([ "$(mount_hits "${COMPOSE}")" -gt 0 ] && [ "$(nocomment "${COMPOSE}" | grep -c 'PORTAL_ROOT')" -eq 0 ] && echo 0 || echo 1)" \
  "锁挂载 $(mount_hits "${COMPOSE}") 处 · PORTAL_ROOT 可见行 $(nocomment "${COMPOSE}" | grep -c 'PORTAL_ROOT') 处"

# ─────────────────────── 相 2：基础镜像代理（需 docker + 网络）───────────────────────
echo
echo '--- 相 2：探活工具面的代理实测（底座镜像；proxy）---'
if ! docker info >/dev/null 2>&1; then
  unjudged P2 'docker 守护可用' 'docker info 失败 ⇒ 相 2 / 相 3 整体未判'
  finish
fi
if ! docker image inspect "${BASE_IMAGE}" >/dev/null 2>&1; then
  if docker pull "${BASE_IMAGE}" >/dev/null 2>&1; then
    info "已拉取底座镜像：${BASE_IMAGE}"
  else
    unjudged T1p '底座镜像可取' "${BASE_IMAGE} 不在本地且拉取失败 ⇒ 相 2 未判"
    finish
  fi
fi
TOOLS_BASE="$(docker run --rm --entrypoint sh "${BASE_IMAGE}" -c 'command -v curl; command -v wget; command -v node' 2>/dev/null | tr '\n' ' ')"
check T1p '底座镜像的探活工具面可机械判定（值见 detail）' \
  "$([ -n "${TOOLS_BASE}" ] && echo 0 || echo 1)" "命中：${TOOLS_BASE:-（空）}"
info "代理理由：最终镜像 = 本底座 + \`ca-certificates\` + COPY（二进制 / node_modules / src / assets）⇒ 装证书与拷文件都**不会**新增 curl / wget ⇒ 此处取值对最终镜像有参考性；**权威取值仍归相 3 的 T1**"

# ─────────────────────────── 相 3：门户镜像实测（需镜像）───────────────────────────
echo
echo '--- 相 3：门户镜像实测（权威）---'
if [ -z "${IMG}" ] || ! docker image inspect "${IMG}" >/dev/null 2>&1; then
  unjudged T1 '门户镜像在本地（PORTAL_BUILD_TAG）' \
    "${IMG:-未提供 PORTAL_BUILD_TAG} ⇒ 相 3 未判。复跑条件：构建后带 PORTAL_BUILD_TAG 跑本脚本（CI 里 buildx 可用，构建配方见 scripts/build-portal-image.sh）"
  finish
fi
info "门户镜像：${IMG}"

TOOLS_IMG="$(docker run --rm --entrypoint sh "${IMG}" -c 'command -v curl; command -v wget; command -v node' 2>/dev/null | tr '\n' ' ')"
check T1 '门户镜像的探活工具面（决定 healthcheck.test 的形态）' \
  "$(printf '%s' "${TOOLS_IMG}" | grep -qE '(^|/)node' && echo 0 || echo 1)" \
  "命中：${TOOLS_IMG:-（空）} ⇒ healthcheck 只能用已命中的那一支"

LABEL_VER="$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.version"}}' "${IMG}" 2>/dev/null)"
check T5 '镜像 LABEL 的版本 == 锁的 IMAGE_TAG（外部侧可判的那一半）' \
  "$([ "${LABEL_VER}" = "${LOCK_TAG}" ] && echo 0 || echo 1)" "LABEL=${LABEL_VER:-（空）} ⇄ 锁 IMAGE_TAG=${LOCK_TAG}"

# dev 姿态（与 scripts/portal-image-smoke.sh 同口径：两个**不同名**回环 Host —— 门户守卫禁止同名）
JWKS="$(docker run --rm --entrypoint node "${IMG}" --input-type=module -e "
import { exportJWK, generateKeyPair } from 'jose';
const { publicKey } = await generateKeyPair('RS256');
process.stdout.write(JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'contract-probe', use: 'sig' }] }));
" 2>/dev/null)"
if [ -z "${JWKS}" ]; then
  unjudged T2 '自签 JWKS 生成' '镜像内 node 无法 import jose ⇒ 相 3 的容器用例整体未判'
  finish
fi
dev_args() {
  printf '%s\n' \
    -e PORTAL_ENV=development \
    -e PORTAL_ADMIN_HOST=localhost \
    -e PORTAL_MCP_HOST=127.0.0.1 \
    -e PORTAL_DB_PATH=/srv/portal/portal.db \
    -e PORTAL_PORT=8080 \
    -e PORTAL_TEST_JWT_ENABLED=1 \
    -e "PORTAL_TEST_JWT_JWKS=${JWKS}" \
    -e PORTAL_TEST_JWT_ISS=https://portal-contract.test \
    -e PORTAL_TEST_JWT_AUD=portal-contract-aud \
    -e PORTAL_TEST_JWT_EMAIL=portal-contract@localhost
}
USERS_DIR="${TMP}/users"
mkdir -p "${USERS_DIR}"
chmod 1777 "${USERS_DIR}"

# T2：boot → /healthz 200 的耗时（**给 healthcheck 的 start_period / interval / retries 提供取值依据**）
BEST=''
code=''
for i in 1 2 3; do
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  START="${SECONDS}"
  # shellcheck disable=SC2046
  docker run -d --name "${NAME}" -v "${USERS_DIR}:/data/users" $(dev_args) "${IMG}" >/dev/null 2>&1 || continue
  waited=0
  while [ "${waited}" -lt 60 ]; do
    code="$(docker exec "${NAME}" node -e "fetch('http://localhost:8080/healthz').then((r) => process.stdout.write(String(r.status))).catch(() => process.exit(3));" 2>/dev/null || true)"
    [ "${code}" = '200' ] && break
    sleep 1
    waited=$((waited + 1))
  done
  took=$((SECONDS - START))
  [ "${code}" = '200' ] && BEST="${BEST} ${took}"
done
check T2 '/healthz 在 60 s 内就绪（并给出 3 次取样的耗时）' \
  "$([ -n "${BEST}" ] && echo 0 || echo 1)" "取样耗时（秒）：${BEST:-无成功取样}"

# T3：坏配置 + `restart: unless-stopped` ⇒ **无限重启循环是真实故障模式**（§3.4 ⑤ 的待定项）
docker rm -f "${NAME}" >/dev/null 2>&1 || true
docker run -d --name "${NAME}" --restart unless-stopped \
  -e PORTAL_ENV=production \
  -e PORTAL_ADMIN_HOST=portal.example.test \
  -e PORTAL_MCP_HOST=mcp.example.test \
  -e PORTAL_DB_PATH=/srv/portal/portal.db \
  "${IMG}" >/dev/null 2>&1
sleep 12
RESTARTS="$(docker inspect -f '{{.RestartCount}}' "${NAME}" 2>/dev/null || echo '?')"
LISTENED="$(docker logs "${NAME}" 2>&1 | grep -c '"event":"portal_listening"' || true)"
check T3 '坏配置下 Docker **确实会重启**（⇒「重启循环」须定策略，不能只靠 restart 兜）' \
  "$([ "${RESTARTS}" != '?' ] && [ "${RESTARTS}" -ge 1 ] && [ "${LISTENED}" -eq 0 ] && echo 0 || echo 1)" \
  "12 s 内 RestartCount=${RESTARTS} · portal_listening=${LISTENED} 次"

# T4：`--health-cmd` 的候选命令在**健康容器**上真的能变 healthy（取值 → 行为，端到端）
docker rm -f "${NAME}" >/dev/null 2>&1 || true
# shellcheck disable=SC2046
docker run -d --name "${NAME}" -v "${USERS_DIR}:/data/users" \
  --health-cmd "node -e \"fetch('http://localhost:8080/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))\"" \
  --health-interval=2s --health-timeout=2s --health-retries=3 --health-start-period=5s \
  $(dev_args) "${IMG}" >/dev/null 2>&1
sleep 12
HEALTH="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${NAME}" 2>/dev/null || echo '?')"
check T4 'healthcheck 候选命令可让健康容器变 `healthy`（行为侧可达）' \
  "$([ "${HEALTH}" = 'healthy' ] && echo 0 || echo 1)" "12 s 后 Health.Status=${HEALTH}"

finish
