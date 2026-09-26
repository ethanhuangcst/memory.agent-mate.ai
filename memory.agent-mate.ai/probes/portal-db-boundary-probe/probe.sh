#!/usr/bin/env bash
# #3 开工准备探针 —— 门户库边界（部署类，只读；判据先行，不施工）
#
# 服务对象：Sprint 5 #3 deploy:门户库边界（原 Sprint 4 `4.5`）
#   判据真源：specs/web-portal/web-stories.md **S9**（`AC9.1` – `AC9.4`）
#             specs/web-portal/web-test.md `TC-P-L1-10`（库不在 /data 下）· `TC-P-L3-08`（备份不含门户库）
#             制品：deploy/portal.compose.yml · admin_portal/src/config.ts · admin_portal/src/selfcheck.ts
#                   admin_portal/src/web/db/schema.sql
#             归属：AC9.2 的「**单独备份并外迁**」实现面与 AC9.3「单独恢复」实现面在 `#15` / `#16`
#                   （`memory.agent-mate.ai/backup/` 当前为空 —— 已在 change-log 登记为 `#15` 先红）
#
# 三相：
#   相 0  前置（在位性 + 真源可定位）
#   相 1  **判据可行性**（离线正/反对照：判据能红能绿）+ **契约断言**（现状：哪几条已满足）
#   相 2  **行为判据**（本行核心）：① 正例 —— 合规库路径下门户**起得来**（`portal_listening`）
#                            ② 负例 —— 库路径给到 `/data` 下 ⇒ **非零退出 · 日志点名 · 从未监听**
#         后端自动选：有 `PORTAL_BUILD_TAG` 用**镜像**；否则本机 `admin_portal/node_modules`（`tsx`）；
#         两者都无 ⇒ 相 2 未判（**不伪装通过**）
#
# 退出码：0 = 本行应判项全绿 · 10 = 有 FAIL · 30 = 有未判项 · 20 = 运行错误
#
# 只读边界：不改产品代码 / specs / deploy 制品；改写只发生在 `${TMP}`（trap 清理）；
#           相 2 只起**临时进程/容器**，库文件一律落在 `${TMP}` 或镜像内可写点。
#
# 用法：
#   bash memory.agent-mate.ai/probes/portal-db-boundary-probe/probe.sh
#   PORTAL_BUILD_TAG=<name:tag> bash …/probe.sh          # 用镜像跑相 2（CI 用这条）

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/../.." && pwd)" # memory.agent-mate.ai/
DEPLOY="${PRODUCT}/deploy"
SPECS="${PRODUCT}/specs"
PORTAL_COMPOSE="${DEPLOY}/portal.compose.yml"
CONFIG_TS="${PRODUCT}/admin_portal/src/config.ts"
SELFCHECK_TS="${PRODUCT}/admin_portal/src/selfcheck.ts"
SCHEMA_SQL="${PRODUCT}/admin_portal/src/web/db/schema.sql"
STORIES="${SPECS}/web-portal/web-stories.md"
WEB_TEST="${SPECS}/web-portal/web-test.md"

IMG="${PORTAL_BUILD_TAG:-}"
NAME="portal-db-boundary-probe-$$"

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
PID=''
cleanup() {
  [ -n "${PID}" ] && kill "${PID}" >/dev/null 2>&1 || true
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  rm -rf "${TMP}"
}
trap cleanup EXIT

nocomment() { grep -v '^[[:space:]]*#' "$1"; }

echo '=== #3 开工准备探针：门户库边界（S9 AC9.1–AC9.4）==='
echo

# ───────────────────────────── 相 0：前置（在位性）─────────────────────────────
missing=''
for f in "${PORTAL_COMPOSE}" "${CONFIG_TS}" "${SELFCHECK_TS}" "${SCHEMA_SQL}" "${STORIES}" "${WEB_TEST}"; do
  [ -s "${f}" ] || missing="${missing} $(basename "${f}")"
done
check C0 '判据输入文件全部在位且非空' "$([ -z "${missing}" ] && echo 0 || echo 1)" "${missing:-6/6 在位}"
[ -z "${missing}" ] || finish

S9_HITS=0
for ac in AC9.1 AC9.2 AC9.3 AC9.4; do grep -q "${ac}" "${STORIES}" && S9_HITS=$((S9_HITS + 1)); done
grep -q 'TC-P-L1-10' "${WEB_TEST}" && S9_HITS=$((S9_HITS + 1))
grep -q 'TC-P-L3-08' "${WEB_TEST}" && S9_HITS=$((S9_HITS + 1))
check C1 '判据真源可定位（S9 四条 AC + `web-test.md` 的 `TC-P-L1-10` / `TC-P-L3-08`）' \
  "$([ "${S9_HITS}" -eq 6 ] && echo 0 || echo 1)" "命中 ${S9_HITS}/6"

# ──────────────────── 相 1：判据可行性（离线，零依赖）+ 契约断言 ────────────────────
echo
echo '--- 相 1：判据可行性（共同步对照证明判据能红能绿）---'

# ── 判据定义 ──────────────────────────────────────────────────────────────────────────────
# AC9.1 / AC9.4 的路径面：门户库路径**不得**落在 `/data` 下。
# **注意前缀陷阱**：判定必须要求 `/data` 本身**或** `/data/` 开头 —— 若写成 `startsWith('/data')`，
# 则 `/database/x.db` 会被误判为违规 ⇒ `S1` 专测这一点。
under_data() { # $1=路径
  [ "$1" = '/data' ] && return 0
  case "$1" in /data/*) return 0 ;; esac
  return 1
}
# AC9.2 的**第一半**（本行可判）：备份遍历面 = `/data/users/*/ai-memory.db` ⇒ 门户库必须不在其下。
in_backup_scope() { # $1=路径
  case "$1" in /data/users/*) return 0 ;; esac
  return 1
}
# AC9.1 的卷面：必须存在 `X:/srv/portal` 的**独立卷**挂载，且该卷**不得**同时挂到 `/data` 下
# （同一卷两处挂 = 门户库与用户数据卷混放 ⇒ 故事目标失效）。
portal_volume_of() { # $1=compose 文件 → 打印挂到 /srv/portal 的卷名
  nocomment "$1" | sed -nE 's|^[[:space:]]*-[[:space:]]*([A-Za-z0-9_.-]+):/srv/portal([[:space:]]*)$|\1|p' | head -1
}
volume_ok() { # $1=compose 文件
  local vol
  vol="$(portal_volume_of "$1")"
  [ -n "${vol}" ] || return 1
  ! nocomment "$1" | grep -qE "^[[:space:]]*-[[:space:]]*${vol}:/data(/|[[:space:]]*$)"
}
# AC9.2 的目标面（故事话术「不与用户记忆混放」）由 `Q4` 的遍历面判据承担（结构性排除）。
# 「从未监听」判据（负例的第三断）
never_listened() { ! printf '%s\n' "$1" | grep -q '"event":"portal_listening"'; }

# ── S：判据自检（样本全部**合成**，不拿制品现状当样本）──────────────────────────────────────
check S1 'AC9.1/AC9.4 路径判据可判（**三态含前缀陷阱**：`/data/x` 命中 · `/srv/portal/x` 不命中 · `/database/x` **不命中**）' \
  "$(under_data '/data/x.db' && under_data '/data' && ! under_data '/srv/portal/portal.db' && ! under_data '/database/x.db' && echo 0 || echo 1)" \
  '`/database/x.db` 不命中 ⇒ 判据不是「以 /data 开头的字符串」（否则会把合法路径误杀）'
check S2 'AC9.2 判据可判（备份遍历面 `/data/users/*`：命中 · 独立卷 `/srv/portal` 不命中）' \
  "$(in_backup_scope '/data/users/alice/ai-memory.db' && ! in_backup_scope '/srv/portal/portal.db' && ! in_backup_scope '/data/users' && echo 0 || echo 1)" \
  '用户库命中 · 门户库不命中 ⇒「备份不含门户库」可由**遍历面**结构性保证'
printf 'name: s\nservices:\n  p:\n    image: x\n    volumes:\n      - portal_data:/srv/portal\nvolumes:\n  portal_data:\n' >"${TMP}/vol-ok.yml"
printf 'name: s\nservices:\n  p:\n    image: x\n    volumes:\n      - shared_data:/srv/portal\n      - shared_data:/data\nvolumes:\n  shared_data:\n' >"${TMP}/vol-shared.yml"
check S3 'AC9.1 卷判据可判（独立卷合格 · **同一卷既挂 `/srv/portal` 又挂 `/data` 不合格**）' \
  "$(volume_ok "${TMP}/vol-ok.yml" && ! volume_ok "${TMP}/vol-shared.yml" && echo 0 || echo 1)" \
  '合格样本含 `portal_data:/srv/portal`；反样本同一卷两处挂 ⇒ 判为不合格'

# ── Q：契约断言（现状：`#3` 的应判项现在就该成立）────────────────────────────────────────
echo
echo '--- 相 1（续）：契约断言（现状）---'

check Q1 'AC9.1：门户库在**独立卷**且该卷不挂到 `/data` 下' \
  "$(volume_ok "${PORTAL_COMPOSE}" && echo 0 || echo 1)" \
  "compose 挂载 = $(portal_volume_of "${PORTAL_COMPOSE}" || echo '无') → /srv/portal"

DB_PATH_VALUE="$(nocomment "${PORTAL_COMPOSE}" | sed -nE 's/^[[:space:]]*PORTAL_DB_PATH:[[:space:]]*//p' | head -1 | tr -d '"'"'"' ')"
# AC9.1-b：`PORTAL_DB_PATH` 必须落在 `/srv/portal/` 下（⇒ 在独立卷内）且不在 `/data` 下。
# **写成函数而不是内联 `$(case … esac)`**：`case` 的分支 `)` 会被 `$( )` 当作**命令替换的结束** ⇒ 语法错。
db_path_ok() { # $1=路径
  case "$1" in /srv/portal/*) ;; *) return 1 ;; esac
  ! under_data "$1"
}
check Q2 'AC9.1 / `TC-P-L1-10`：`PORTAL_DB_PATH` 指向 `/srv/portal/` 下（⇒ 落在独立卷内）且**不在 `/data` 下**' \
  "$(db_path_ok "${DB_PATH_VALUE}" && echo 0 || echo 1)" \
  "PORTAL_DB_PATH=${DB_PATH_VALUE:-未设}"

GUARD_CONFIG="$(grep -c 'isUnderDataDir' "${CONFIG_TS}" || true)"
GUARD_SELFCHECK="$(grep -c 'portal_db_outside_data' "${SELFCHECK_TS}" || true)"
GUARD_THROW="$(grep -c 'PORTAL_DB_PATH 必须不在 /data 下' "${CONFIG_TS}" || true)"
check Q3 'AC9.4（静态面）：守卫链在位 —— `loadConfig` 抛错（`isUnderDataDir` + 点名文案）**且**启动自检有 `portal_db_outside_data` 项（双处）' \
  "$([ "${GUARD_CONFIG}" -ge 2 ] && [ "${GUARD_THROW}" -ge 1 ] && [ "${GUARD_SELFCHECK}" -ge 1 ] && echo 0 || echo 1)" \
  "config.ts 引用 ${GUARD_CONFIG} 处 · 自检项 ${GUARD_SELFCHECK} 处 · 点名文案 ${GUARD_THROW} 处"

# `#15` 行的遍历范围原文（「遍历 `/data/users/*`」）—— AC9.2 的**需求**是否已定档
BACKUP_SCOPE_DOC="$(grep -c '遍历 `/data/users/\*`' "${SPECS}/sprint-backlog.md" || true)"
check Q4 'AC9.2（第一半「不含」）：备份遍历面 = `/data/users/*` 已定档（`#15` 行）**且**门户库路径不在该面下' \
  "$([ "${BACKUP_SCOPE_DOC}" -ge 1 ] && ! in_backup_scope "${DB_PATH_VALUE}" && echo 0 || echo 1)" \
  "需求命中 ${BACKUP_SCOPE_DOC} 处 · 门户库 ${DB_PATH_VALUE:-未设} 不在遍历面下"

# 卷名漂移残留：`schema.sql` 的注释写 `admin_portal_data`，而 compose（真源）写 `portal_data`
SCHEMA_VOL="$(grep -oE '`[a-z_]*portal_data`' "${SCHEMA_SQL}" | tr -d '`' | head -1)"
COMPOSE_VOL="$(portal_volume_of "${PORTAL_COMPOSE}")"
check Q5 '制品一致：`schema.sql` 注释里的卷名 == compose 的卷名（防「卷名漂移」残留）' \
  "$([ -n "${SCHEMA_VOL}" ] && [ "${SCHEMA_VOL}" = "${COMPOSE_VOL}" ] && echo 0 || echo 1)" \
  "schema 写 '${SCHEMA_VOL:-未提及}' · compose 写 '${COMPOSE_VOL:-无}'（文档 6 处已于 #2 批订正为 portal_data，此处是代码注释残留）"

# ────────────────────────── 相 2：行为判据（本行核心）──────────────────────────
echo
echo '--- 相 2：行为判据（正例起得来 · 负例必拒启动且从未监听）---'

if [ -n "${IMG}" ]; then
  BACKEND='image'
elif [ -d "${PRODUCT}/admin_portal/node_modules" ]; then
  BACKEND='local'
else
  BACKEND='none'
fi
info "相 2 执行后端：${BACKEND}${IMG:+（镜像 ${IMG}）}"

if [ "${BACKEND}" = 'none' ]; then
  unjudged B1 '正例：合规库路径下门户起得来（`portal_listening`）' \
    '既无 PORTAL_BUILD_TAG 镜像、也无本机 admin_portal/node_modules ⇒ 无法起进程'
  unjudged B2 '负例：库路径给到 `/data` 下 ⇒ 非零退出 + 日志点名 + 从未监听' \
    '同上：无可用执行后端'
else
  # 自签 JWKS（**免宿主依赖**：本机用 admin_portal 的 jose；镜像内自带 jose）
  if [ "${BACKEND}" = 'image' ]; then
    JWKS="$(docker run --rm --entrypoint node "${IMG}" --input-type=module -e \
      "import {exportJWK,generateKeyPair} from 'jose';const {publicKey}=await generateKeyPair('RS256');process.stdout.write(JSON.stringify({keys:[{...(await exportJWK(publicKey)),alg:'RS256',kid:'db-boundary',use:'sig'}]}));" 2>/dev/null || true)"
  else
    JWKS="$(cd "${PRODUCT}/admin_portal" && node --input-type=module -e \
      "import {exportJWK,generateKeyPair} from 'jose';const {publicKey}=await generateKeyPair('RS256');process.stdout.write(JSON.stringify({keys:[{...(await exportJWK(publicKey)),alg:'RS256',kid:'db-boundary',use:'sig'}]}));" 2>/dev/null || true)"
  fi

  USERS_DIR="${TMP}/users"
  mkdir -p "${USERS_DIR}" && chmod 1777 "${USERS_DIR}"

  # 起一次门户（正例/负例同一函数，只有库路径不同）。用**随机端口**避开宿主已占用端口
  # （本机踩过：8080 被别的进程占用 ⇒ 误把「别人的 200」当门户的结论）。
  run_once() { # $1=日志文件 $2=库路径(容器内视角) $3=本机库路径 $4=等待秒
    local log="$1" db_container="$2" db_local="$3" wait_s="$4" port attempt=0
    while [ "${attempt}" -lt 3 ]; do
      port=$(( (RANDOM % 2000) + 21000 ))
      : >"${log}"
      if [ "${BACKEND}" = 'image' ]; then
        docker rm -f "${NAME}" >/dev/null 2>&1 || true
        docker run --rm --name "${NAME}" \
          -v "${USERS_DIR}:/data/users" \
          -e PORTAL_ENV=development -e PORTAL_ADMIN_HOST=localhost -e PORTAL_MCP_HOST=127.0.0.1 \
          -e PORTAL_DB_PATH="${db_container}" -e PORTAL_PORT="${port}" \
          -e PORTAL_USERS_ROOT=/data/users \
          -e PORTAL_TEST_JWT_ENABLED=1 -e PORTAL_TEST_JWT_JWKS="${JWKS}" \
          -e PORTAL_TEST_JWT_ISS=https://db-boundary.test -e PORTAL_TEST_JWT_AUD=db-boundary \
          -e PORTAL_TEST_JWT_EMAIL=db-boundary@localhost \
          "${IMG}" >"${log}" 2>&1 &
        PID=$!
      else
        # `exec`：让子 shell **被 node 替换** ⇒ `${PID}` 就是 node 的 PID（否则 kill 只杀掉子 shell，
        # node 变孤儿进程继续占端口 —— 本机复跑时会踩到）。
        ( cd "${PRODUCT}/admin_portal" && \
          PORTAL_ENV=development PORTAL_ADMIN_HOST=localhost PORTAL_MCP_HOST=127.0.0.1 \
          PORTAL_DB_PATH="${db_local}" PORTAL_PORT="${port}" PORTAL_USERS_ROOT="${USERS_DIR}" \
          PORTAL_TEST_JWT_ENABLED=1 PORTAL_TEST_JWT_JWKS="${JWKS}" \
          PORTAL_TEST_JWT_ISS=https://db-boundary.test PORTAL_TEST_JWT_AUD=db-boundary \
          PORTAL_TEST_JWT_EMAIL=db-boundary@localhost \
          exec node --import tsx src/server.ts ) >"${log}" 2>&1 &
        PID=$!
      fi
      local waited=0
      while [ "${waited}" -lt "${wait_s}" ]; do
        kill -0 "${PID}" 2>/dev/null || break
        grep -q '"event":"portal_listening"' "${log}" 2>/dev/null && break
        sleep 1
        waited=$((waited + 1))
      done
      if grep -q 'EADDRINUSE' "${log}" 2>/dev/null; then
        kill "${PID}" 2>/dev/null || true
        docker rm -f "${NAME}" >/dev/null 2>&1 || true
        PID=''
        attempt=$((attempt + 1))
        continue
      fi
      return 0
    done
    return 1
  }

  # ── B1 正例：合规库路径（本机 = ${TMP}；镜像 = /srv/portal，即真实部署落点）
  if [ "${BACKEND}" = 'image' ]; then
    DB_OK_CONTAINER='/srv/portal/portal.db'
  else
    DB_OK_CONTAINER="${TMP}/portal.db"
  fi
  LOG_POS="${TMP}/positive.log"
  if run_once "${LOG_POS}" "${DB_OK_CONTAINER}" "${DB_OK_CONTAINER}" 25; then
    LISTENED_POS="$(grep -c '"event":"portal_listening"' "${LOG_POS}" || true)"
    check B1 '正例：合规库路径下门户**起得来**（`portal_listening` 出现）' \
      "$([ "${LISTENED_POS}" -ge 1 ] && echo 0 || echo 1)" \
      "库=${DB_OK_CONTAINER} · portal_listening=${LISTENED_POS} 次 · 日志首行：$(head -1 "${LOG_POS}" | cut -c1-90)"
  else
    unjudged B1 '正例：合规库路径下门户起得来（`portal_listening`）' '三个随机端口均 EADDRINUSE ⇒ 本机端口环境不干净，不作判据'
  fi
  kill "${PID}" >/dev/null 2>&1 || true
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  PID=''

  # ── B2 负例（本行核心）：库路径给到 `/data` 下 ⇒ 必拒启动
  LOG_NEG="${TMP}/negative.log"
  run_once "${LOG_NEG}" '/data/portal-probe.db' '/data/portal-probe.db' 20
  NEG_WAITED=0
  while kill -0 "${PID}" 2>/dev/null && [ "${NEG_WAITED}" -lt 20 ]; do sleep 1; NEG_WAITED=$((NEG_WAITED + 1)); done
  NEG_RUNNING='false'; kill -0 "${PID}" 2>/dev/null && NEG_RUNNING='true'
  NEG_LOGS="$(cat "${LOG_NEG}" 2>/dev/null || true)"
  if [ "${NEG_RUNNING}" = 'true' ]; then
    # 仍在跑 ⇒ 说明**没被拦下**（这是安否的核心：必须失败）
    kill "${PID}" >/dev/null 2>&1 || true
  fi
  NEG_NAMED="$(printf '%s\n' "${NEG_LOGS}" | grep -c 'PORTAL_DB_PATH' || true)"
  check B2 'AC9.4（行为）：库路径给到 `/data` 下 ⇒ **非零退出 · 日志点名 `PORTAL_DB_PATH` · 从未监听**' \
    "$([ "${NEG_RUNNING}" = 'false' ] && [ "${NEG_NAMED}" -ge 1 ] && never_listened "${NEG_LOGS}" && echo 0 || echo 1)" \
    "仍在运行=${NEG_RUNNING} · 点名 ${NEG_NAMED} 处 · 从未监听=$([ "${NEG_LOGS}" ] && (never_listened "${NEG_LOGS}" && echo ✓ || echo ✗) || echo '（无日志）') · 首条：$(printf '%s' "${NEG_LOGS}" | grep -o '"event":"config_invalid","message":"[^"]*"' | head -1 | cut -c1-150)"
  PID=''
fi

# ────────────────────────── 归属登记（**不是未判**：需求已定档，实现归他行）──────────────────────
echo
info 'AC9.2 第二半「门户库由同一流程单独备份并外迁」：**实现面归 `#15`/`#16`**（`memory.agent-mate.ai/backup/` 当前为空）—— 本行只判「备份遍历面不含门户库」（`Q4`）。'
info 'AC9.3「门户库可单独恢复」：**实现面归 `#15`/`#16`**（恢复流程脚本未在位）⇒ 本行不判，登记接口。'
info '接管接口（给 #15/#16）：脚本落地后，本探针补**动态**断言 —— ① backup-and-push.sh 的产物清单**不含** portal.db（结构上由 Q4 保证，动态再看一遍）② 门户库有**独立快照 + sha256 + 回读比对** ③ 恢复演练**只动门户库**（用户库 mtime/hash 不变）。**WAL 提醒**：门户库是 SQLite + WAL（migrate.ts / connection.ts）⇒ 快照必须走 sqlite3 .backup 或 VACUUM INTO，**不能裸 cp**（裸 cp 会拿到不一致的库）。'

finish
