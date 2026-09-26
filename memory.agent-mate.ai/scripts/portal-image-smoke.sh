#!/usr/bin/env bash
# 门户镜像**运行时冒烟**（Sprint 5 `#1` 的「可用」判据；`#2` healthcheck 的原型）
#
# 为什么需要它：`probes/portal-image-verdict-probe/`（相 3）判的是**静态契约** —— 平台 / 入口 /
#   `Env` 零 `AI_MEMORY_DB` / 非 root / 与上游对齐 / 二进制版本，这些都从 `docker inspect` 读出来，
#   **不证明镜像起得来、答得应**。本脚本补的正是缺的那一步：真起容器 → 断言自检通过并开始监听 →
#   从**容器内**打 `/healthz` → 断言「身份先于路由」。
#
# 判据真源：specs/web-portal/web-design.md §3.4（启动自检 fail-closed）· §3.4 ⑤（编排侧缺口的
#   那条断言「自检不过就不 listen」）· §11（部署九步·第 8 步冒烟）
#
# 两类判据：
#   正例（1 个容器）  dev 姿态 + **两个不同的**回环 Host（管理面 `localhost` / MCP 面 `127.0.0.1`；
#                     门户守卫禁止两面同名）⇒ 必须起来、自检零 fail、开始监听、`/healthz` 200 且回体
#                     含 `ok:true` + `schemaVersion`、管理面受保护路径无断言头回 401、面隔离 403、
#                     `/healthz` 任一面放行、三条 `deferred` 如实登记（不伪装通过）
#   反例（3 个容器）  身份姿态的三条守卫必须**拒绝启动**（非零退出 + 点名原因 + 从未监听）：
#                     N1 production 缺 Cloudflare Access ⇒ 拒（没有身份源就不服务）
#                     N2 production 却启用自签测试通道 ⇒ 拒（测试旁路不得流入生产）
#                     N3 dev 姿态 + 非回环 Host 启用自签通道 ⇒ 拒（测试旁路不得流向真实域名）
#                   —— 反例此前只写在文档里（§3.4 ④/⑤），本脚本把它变成可复跑的判据。
#
# 为什么断言走 `docker exec` 而不是 `-p` 发布端口：门户**非生产姿态绑 `127.0.0.1`**
#   （`src/server.ts` 的 `resolveBindHost`：`isProduction ? '0.0.0.0' : '127.0.0.1'`）⇒ 发布到宿主
#   的回环端口在本机不可达。这也正是 `#2` 的 compose `healthcheck` 必须在**容器内**发起的同一个理由。
#
# 退出码：0 = 全判且无 FAIL · 10 = 有 FAIL（结论见断言表）· 30 = 未判（docker 不可用 / 镜像不在本地
#         —— **不伪装通过**）· 20 = 用法或环境错误
#
# 只读边界：不改任何受版本控制的文件；容器与临时目录由 `trap` 清理。
#
# 用法：
#   bash memory.agent-mate.ai/scripts/portal-image-smoke.sh --tag <name:tag>
#   PORTAL_SMOKE_TAG=<name:tag> make portal-image-smoke
#   （CI 里由 .github/workflows/portal-image.yml 在构建后直接调用，tag 取本次构建的 sha 标签）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${SCRIPT_DIR}/.." && pwd)" # memory.agent-mate.ai/

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
# 「未判」不是通过：单独计数并让退出码退化为 30（前置缺失时用它，不伪装通过）
unjudged() { # $1=id $2=name $3=原因
  UNJUDGED=$((UNJUDGED + 1))
  printf '未判 [%s] %s — %s\n' "$1" "$2" "$3"
}
info() { printf '[i] %s\n' "$1"; }
die() { printf 'ERROR: %s\n' "$2" >&2; exit "$1"; }
finish() {
  echo
  echo '--- 结论 ---'
  printf '通过 %s 项 · 失败 %s 项 · 未判 %s 项\n' "${PASS}" "${FAIL}" "${UNJUDGED}"
  if [ "${FAIL}" -gt 0 ]; then exit 10; fi
  if [ "${UNJUDGED}" -gt 0 ]; then exit 30; fi
  exit 0
}

TAG="${PORTAL_SMOKE_TAG:-}"
NAME="${PORTAL_SMOKE_NAME:-portal-smoke-$$}"
PORT="${PORTAL_SMOKE_PORT:-8080}" # 与镜像 EXPOSE / compose 的 PORTAL_PORT 默认一致
READY_TIMEOUT="${PORTAL_SMOKE_READY_TIMEOUT:-30}"
EXIT_TIMEOUT="${PORTAL_SMOKE_EXIT_TIMEOUT:-20}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --tag) shift; TAG="${1:-}" ;;
    --name) shift; NAME="${1:-}" ;;
    -h | --help) sed -n '2,40p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) die 20 "未知参数：$1（支持 --tag <name:tag> / --name <容器名>）" ;;
  esac
  shift
done

[ -n "${TAG}" ] || die 20 '缺少镜像标签：用 --tag <name:tag> 或 PORTAL_SMOKE_TAG=<name:tag>'
command -v docker >/dev/null 2>&1 || die 20 '本机无 docker 命令'

USERS_DIR=''
cleanup() {
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  [ -n "${USERS_DIR}" ] && rm -rf "${USERS_DIR}"
  return 0
}
trap cleanup EXIT

echo "门户镜像运行时冒烟：${TAG}（容器 ${NAME}，容器内端口 ${PORT}）"
echo

# ── 前置：docker 守护可用 + 镜像在本地（缺则整轮「未判」，退出码 30）────────────────────────
if ! docker info >/dev/null 2>&1; then
  unjudged 'P0' 'docker 守护可用' 'docker info 失败 ⇒ 本脚本整体未判'
  finish
fi
if ! docker image inspect "${TAG}" >/dev/null 2>&1; then
  unjudged 'P0' '镜像在本地' "本地无 ${TAG} ⇒ 先 make portal-image 或 docker pull（CI 里为本次构建产物）"
  finish
fi
info "守护与镜像就位：$(docker image inspect -f '{{.Id}}' "${TAG}" | cut -c1-19)"

# ── 自签 JWKS：**用镜像自己**生成（镜像内自带 jose，故不引入宿主依赖）──────────────────────
JWKS=''
generate_jwks() {
  docker run --rm --entrypoint node "${TAG}" --input-type=module -e "
import { exportJWK, generateKeyPair } from 'jose';
const { publicKey } = await generateKeyPair('RS256');
const pub = await exportJWK(publicKey);
process.stdout.write(JSON.stringify({ keys: [{ ...pub, alg: 'RS256', kid: 'portal-smoke', use: 'sig' }] }));
" 2>/dev/null
}
JWKS="$(generate_jwks)"
if [ -z "${JWKS}" ]; then
  unjudged 'P1' '自签 JWKS 生成' '镜像内 node 无法 import jose ⇒ 后续用例整体未判（相 3 的 E7 应已判过该项）'
  finish
fi
info '自签 JWKS 已生成（RS256，容器内 jose；仅本次运行使用）'
echo

# ── 正例 ──────────────────────────────────────────────────────────────────────────────────
# 路径类键**全部留默认**（PORTAL_VIEWS_ROOT / STATIC_ROOT / USERS_ROOT 都不给）—— 通过即同时
# 证明镜像内建布局成立（views=/app/src/web/views · static=/app/assets · users=/data/users）。
# 两个 Host **必须不同**、且都必须回环：门户有一条配置守卫「管理面与 MCP 面的 Host 不得相同
# （面隔离判据失效）」—— 首版把两面都写成 `127.0.0.1`，CI 首跑即被它**正确**拦下（容器 `exit=1`
# `config_invalid`；本机同代码路径秒级复现）。不同名回环 ⇒ 自签通道与面隔离两条判据同时成立。
USERS_DIR="$(mktemp -d)" || die 20 '无法创建临时目录'
chmod 1777 "${USERS_DIR}"

echo '--- 正例：dev 姿态（两个不同的回环 Host）应当起来并服务 ---'
if ! docker run -d --name "${NAME}" \
  -v "${USERS_DIR}:/data/users" \
  -e PORTAL_ENV=development \
  -e PORTAL_ADMIN_HOST=localhost \
  -e PORTAL_MCP_HOST=127.0.0.1 \
  -e PORTAL_DB_PATH=/srv/portal/portal.db \
  -e PORTAL_PORT="${PORT}" \
  -e PORTAL_TEST_JWT_ENABLED=1 \
  -e PORTAL_TEST_JWT_JWKS="${JWKS}" \
  -e PORTAL_TEST_JWT_ISS='https://portal-smoke.test' \
  -e PORTAL_TEST_JWT_AUD='portal-smoke-aud' \
  -e PORTAL_TEST_JWT_EMAIL='portal-smoke@localhost' \
  "${TAG}" >/dev/null; then
  check 'P1' '容器启动' 1 'docker run 失败'
  finish
fi

# 容器内探活：打印 HTTP 状态码（不可达时非零退出）。$1 = URL 主机（**决定走哪个面** · 管理面
# `localhost` / MCP 面 `127.0.0.1`），$2 = 路径。用 URL 主机而不是手工设 `Host` 头：fetch 会自动
# 把 URL 主机写进 `Host`（`Host` 是禁止手工覆盖的头），请求也就自然落在对应面上。
http_status() { # $1=URL 主机（面） $2=路径
  docker exec "${NAME}" node -e "
fetch('http://$1:${PORT}$2')
  .then((r) => process.stdout.write(String(r.status)))
  .catch(() => process.exit(3));
" 2>/dev/null
}
http_body() { # $1=URL 主机（面） $2=路径
  docker exec "${NAME}" node -e "
fetch('http://$1:${PORT}$2')
  .then((r) => r.text())
  .then((t) => process.stdout.write(t))
  .catch(() => process.exit(3));
" 2>/dev/null
}

STATUS=''
waited=0
while [ "${waited}" -lt "${READY_TIMEOUT}" ]; do
  running="$(docker inspect -f '{{.State.Running}}' "${NAME}" 2>/dev/null || echo false)"
  if [ "${running}" != 'true' ]; then break; fi
  STATUS="$(http_status localhost /healthz || true)"
  [ "${STATUS}" = '200' ] && break
  sleep 1
  waited=$((waited + 1))
done

LOGS="$(docker logs "${NAME}" 2>&1 || true)"
RUNNING="$(docker inspect -f '{{.State.Running}}' "${NAME}" 2>/dev/null || echo false)"
EXIT_CODE="$(docker inspect -f '{{.State.ExitCode}}' "${NAME}" 2>/dev/null || echo '?')"

INFO="$(printf '%s\n' "${LOGS}" | grep -c '"event":"portal_listening"')"
SELFCHECK_FAIL="$(printf '%s\n' "${LOGS}" | grep -c '"status":"fail"')"
DEFERRED="$(printf '%s\n' "${LOGS}" | grep -c '"status":"deferred"')"
BODY="$(http_body localhost /healthz || true)"

# 失败时把「进程自己怎么说」带进断言明细：容器起不来时**唯一**有用的信息就是那一行报错。
# 首版没带这行 ⇒ CI 首跑只报了 `exit=1`，根因（两面 Host 不得相同）得本机复现才拿到。
DIAG="$(printf '%s\n' "${LOGS}" | grep -o '"event":"config_invalid","message":"[^"]*"' | head -1 || true)"
[ -n "${DIAG}" ] || DIAG="$(printf '%s\n' "${LOGS}" | grep -o '"event":"selfcheck_failed"[^}]*' | head -1 || true)"
[ -n "${DIAG}" ] || DIAG="$(printf '%s\n' "${LOGS}" | grep -o '"event":"startup_failed","message":"[^"]*"' | head -1 || true)"
[ -n "${DIAG}" ] || DIAG='（无 config_invalid / selfcheck_failed / startup_failed）'

check 'P2' '容器仍在运行' "$([ "${RUNNING}" = 'true' ] && echo 0 || echo 1)" \
  "running=${RUNNING} exit=${EXIT_CODE}【${DIAG}】"
check 'P3' '日志出现 portal_listening' "$([ "${INFO}" -ge 1 ] && echo 0 || echo 1)" \
  "${INFO} 处（超时 ${READY_TIMEOUT} s，末次状态码 '${STATUS}'）"
check 'P4' '启动自检零 fail' "$([ "${SELFCHECK_FAIL}" -eq 0 ] && echo 0 || echo 1)" \
  "status=fail 计 ${SELFCHECK_FAIL} 处【${DIAG}】"
check 'P5' '三条 deferred 如实登记（不伪装通过）' "$([ "${DEFERRED}" -eq 3 ] && echo 0 || echo 1)" \
  "status=deferred 计 ${DEFERRED} 处（期望 3）"
check 'P6' '/healthz 回 200（管理面 Host）' "$([ "${STATUS}" = '200' ] && echo 0 || echo 1)" \
  "状态码 '${STATUS}'【${DIAG}】"
check 'P7' '/healthz 回体含 ok:true 与 schemaVersion' \
  "$(printf '%s' "${BODY}" | grep -q '"ok":true' && printf '%s' "${BODY}" | grep -q '"schemaVersion"' && echo 0 || echo 1)" \
  "${BODY:0:120}"

ADMIN_STATUS="$(http_status localhost /admin/users || true)"
check 'P8' '管理面受保护路径无断言头回 401（身份先于路由）' \
  "$([ "${ADMIN_STATUS}" = '401' ] && echo 0 || echo 1)" "状态码 '${ADMIN_STATUS}'"

# 面隔离：管理面路径在 **MCP 面 Host** 上必须被拒（403）—— 与启动期那条「两面 Host 不得相同」
# 的配置守互为表里（守卫防配置写错，本断言证明运行时真的按面分流）。
FACE_STATUS="$(http_status 127.0.0.1 /admin/users || true)"
check 'P9' '面隔离生效：管理面路径在 MCP 面上回 403' \
  "$([ "${FACE_STATUS}" = '403' ] && echo 0 || echo 1)" "状态码 '${FACE_STATUS}'（期望 403）"

# `/healthz` 在任一面都放行（`server.ts` 的「探活：不承载机密，任何面放行」）⇒ `#2` 的 compose
# `healthcheck` 无论用哪个 Host 发起都能用。
MCP_HEALTH="$(http_status 127.0.0.1 /healthz || true)"
check 'P10' '/healthz 在 MCP 面上也放行（容器 healthcheck 可用任一面）' \
  "$([ "${MCP_HEALTH}" = '200' ] && echo 0 || echo 1)" "状态码 '${MCP_HEALTH}'（期望 200）"

# ── 反例：身份姿态的三条守卫必须拒绝启动 ──────────────────────────────────────────────────
# 每个反例断言三件事：非零退出 · 日志点名原因 · **从未监听**（第三条是关键：退出码非零也可能是
# 「起来后又崩」，而这里的契约是「自检不过就不 listen」）。
echo
echo '--- 反例：身份姿态守卫应当拒绝启动 ---'
negative() { # $1=label $2=期望命中的错误子串 $3..=docker run 参数
  local label="$1" expect="$2"
  shift 2
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  if ! docker run -d --name "${NAME}" -v "${USERS_DIR}:/data/users" "$@" "${TAG}" >/dev/null 2>&1; then
    check "${label}.1" "容器能启动以接受判定" 1 'docker run 失败'
    return
  fi
  local waited=0 running='true'
  while [ "${waited}" -lt "${EXIT_TIMEOUT}" ]; do
    running="$(docker inspect -f '{{.State.Running}}' "${NAME}" 2>/dev/null || echo false)"
    [ "${running}" != 'true' ] && break
    sleep 1
    waited=$((waited + 1))
  done
  local rc logs listened
  rc="$(docker inspect -f '{{.State.ExitCode}}' "${NAME}" 2>/dev/null || echo '?')"
  logs="$(docker logs "${NAME}" 2>&1 || true)"
  listened="$(printf '%s\n' "${logs}" | grep -c '"event":"portal_listening"' || true)"
  check "${label}.1" '非零退出（拒绝启动）' "$([ "${running}" != 'true' ] && [ "${rc}" != '0' ] && echo 0 || echo 1)" \
    "running=${running} exit=${rc}"
  check "${label}.2" "日志点名原因（含「${expect}」）" "$(printf '%s\n' "${logs}" | grep -q "${expect}" && echo 0 || echo 1)" \
    "$(printf '%s\n' "${logs}" | grep -m1 -o 'config_invalid\|selfcheck_failed' || echo '无 config_invalid/selfcheck_failed')"
  check "${label}.3" '从未监听（自检不过就不 listen）' "$([ "${listened}" -eq 0 ] && echo 0 || echo 1)" \
    'portal_listening 出现 0 次'
}

negative 'N1' 'Cloudflare Access' \
  -e PORTAL_ENV=production \
  -e PORTAL_ADMIN_HOST=portal.example.test \
  -e PORTAL_MCP_HOST=mcp.example.test \
  -e PORTAL_DB_PATH=/srv/portal/portal.db \
  -e PORTAL_PORT="${PORT}"

negative 'N2' '自签 JWT' \
  -e PORTAL_ENV=production \
  -e PORTAL_ADMIN_HOST=portal.example.test \
  -e PORTAL_MCP_HOST=mcp.example.test \
  -e PORTAL_DB_PATH=/srv/portal/portal.db \
  -e PORTAL_PORT="${PORT}" \
  -e PORTAL_TEST_JWT_ENABLED=1 \
  -e PORTAL_TEST_JWT_JWKS="${JWKS}" \
  -e PORTAL_TEST_JWT_ISS='https://portal-smoke.test' \
  -e PORTAL_TEST_JWT_AUD='portal-smoke-aud' \
  -e PORTAL_TEST_JWT_EMAIL='portal-smoke@localhost'

negative 'N3' '仅允许在本机' \
  -e PORTAL_ENV=development \
  -e PORTAL_ADMIN_HOST=portal.example.test \
  -e PORTAL_MCP_HOST=mcp.example.test \
  -e PORTAL_DB_PATH=/srv/portal/portal.db \
  -e PORTAL_PORT="${PORT}" \
  -e PORTAL_TEST_JWT_ENABLED=1 \
  -e PORTAL_TEST_JWT_JWKS="${JWKS}" \
  -e PORTAL_TEST_JWT_ISS='https://portal-smoke.test' \
  -e PORTAL_TEST_JWT_AUD='portal-smoke-aud' \
  -e PORTAL_TEST_JWT_EMAIL='portal-smoke@localhost'

info "判据真源：${PRODUCT}/specs/web-portal/web-design.md §3.4（启动自检 fail-closed）"
finish
