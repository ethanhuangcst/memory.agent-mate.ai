#!/usr/bin/env bash
# #4 开工准备判据可行性探针 —— 门户容器最小攻击面（研究类，不入制品；只读）
#
# 服务对象：Sprint 5 #4 deploy:容器攻击面（原 Sprint 4 `4.6`）
#   判据真源：specs/web-portal/web-stories.md **S13**（`AC13.1` / `AC13.2` / `AC13.3`）
#             specs/web-portal/web-test.md `TC-P-L1-08`（无 docker socket）
#             specs/web-portal/web-design.md §T1（威胁面 6 项措施）· §12.6
#             制品：deploy/portal.compose.yml · admin_portal/Dockerfile
#
# 三相：
#   相 1（离线，零依赖）：**判据可行性** —— S13 四条判据逐条证明「**能红能绿**」（正/反对照，样本全合成）
#   相 2（需 docker + 能取底座镜像）：**包管理能力**的代理实测（AC13.3 第三条）
#   相 3（需 PORTAL_BUILD_TAG 的门户镜像）：**权威实测** —— 运行身份 / socket / 只读根可行性 /
#                        资源基线 / 包管理能力；`read_only` 可行性是 AC13.3 能否落地的关键未知项
#   相 2 / 相 3 的前置缺失时返回 30（**未判 —— 不伪装通过**）
#
# 退出码：0 = 全判且无 FAIL · 10 = 有 FAIL · 30 = 有未判项 · 20 = 运行错误
#
# 只读边界：不改产品代码 / specs / deploy 制品；所有改写只发生在 ${TMP} 副本里（trap 清理）；
#           相 2/3 只起临时容器（`--rm` 与显式 `docker rm -f` 双保险），不改任何镜像与卷。
#
# 用法：
#   bash memory.agent-mate.ai/probes/container-attack-surface-probe/probe.sh
#   PORTAL_BUILD_TAG=<name:tag> bash …/probe.sh        # 有门户镜像时跑相 3

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/../.." && pwd)" # memory.agent-mate.ai/
DEPLOY="${PRODUCT}/deploy"
SPECS="${PRODUCT}/specs"
PORTAL_COMPOSE="${DEPLOY}/portal.compose.yml"
MAIN_COMPOSE="${DEPLOY}/docker-compose.prod.yml"
DOCKERFILE="${PRODUCT}/admin_portal/Dockerfile"
STORIES="${SPECS}/web-portal/web-stories.md"
WEB_TEST="${SPECS}/web-portal/web-test.md"
WEB_DESIGN="${SPECS}/web-portal/web-design.md"

IMG="${PORTAL_BUILD_TAG:-}"
BASE_IMAGE="${PORTAL_BASE_IMAGE:-node:22-bookworm-slim}"
NAME="attack-surface-probe-$$"

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
cleanup() {
  docker rm -f "${NAME}" >/dev/null 2>&1 || true
  rm -rf "${TMP}"
}
trap cleanup EXIT

nocomment() { grep -v '^[[:space:]]*#' "$1"; }

echo '=== #4 开工准备探针：门户容器最小攻击面 ==='
echo

# ───────────────────────────── 相 0：前置（在位性）─────────────────────────────
missing=''
for f in "${PORTAL_COMPOSE}" "${MAIN_COMPOSE}" "${DOCKERFILE}" "${STORIES}" "${WEB_TEST}" "${WEB_DESIGN}"; do
  [ -s "${f}" ] || missing="${missing} $(basename "${f}")"
done
check C0 '判据输入文件全部在位且非空' "$([ -z "${missing}" ] && echo 0 || echo 1)" "${missing:-6/6 在位}"
[ -z "${missing}" ] || finish

# S13 的四条判据（`AC13.1` 两项 / `AC13.2` 两项 / `AC13.3` 三项）在真源里可机械定位
S13_HITS=0
grep -q 'AC13.1' "${STORIES}" && S13_HITS=$((S13_HITS + 1))
grep -q 'AC13.2' "${STORIES}" && S13_HITS=$((S13_HITS + 1))
grep -q 'AC13.3' "${STORIES}" && S13_HITS=$((S13_HITS + 1))
grep -q 'TC-P-L1-08' "${WEB_TEST}" && S13_HITS=$((S13_HITS + 1))
check C1 '判据真源可定位（S13 三条 AC + `web-test.md` 的 `TC-P-L1-08`）' \
  "$([ "${S13_HITS}" -eq 4 ] && echo 0 || echo 1)" "命中 ${S13_HITS}/4"

# ──────────────────── 相 1：判据可行性（离线，零依赖，不需要守护）────────────────────
echo
echo '--- 相 1：判据可行性（离线：正/反对照证明判据能红能绿）---'

# ── 判据定义（全部按「**非注释可见行**」抽取，口径同仓内既有做法）────────────────────
# AC13.1：容器内不存在 docker socket（挂载层面）
socket_hits() { nocomment "$1" | grep -cE 'docker\.sock|/var/run/docker'; }
# AC13.2：不得持有宿主 root 等价权限（特权/宿主命名空间/cap 提升）
privilege_hits() { nocomment "$1" | grep -cE '^[[:space:]]*privileged:[[:space:]]*true|^[[:space:]]*pid:[[:space:]]*host|^[[:space:]]*network_mode:[[:space:]]*host|^[[:space:]]*userns_mode:[[:space:]]*host|^[[:space:]]*cap_add:'; }
# AC13.3 第一条：根文件系统只读 —— **且**必须同时给出可写的必要挂载（`tmpfs`），
#   否则「只读」是不完整的（门户要写临时文件；判据口径：只看 read_only 会**假绿**）
readonly_ok() { # 0 = 合格
  local f="$1"
  nocomment "${f}" | grep -qE '^[[:space:]]*read_only:[[:space:]]*true' || return 1
  nocomment "${f}" | grep -qE '^[[:space:]]*tmpfs:' || return 1
  return 0
}
# AC13.3 第二条：资源限额（内存 + 进程数，二者缺一即不完整）
limits_ok() {
  local f="$1"
  nocomment "${f}" | grep -qE '^[[:space:]]*mem_limit:' || return 1
  nocomment "${f}" | grep -qE '^[[:space:]]*pids_limit:' || return 1
  return 0
}
# AC13.2 的**加固侧**（「不持有宿主 root 等价权限」的最强手段）：丢弃全部 capabilities **且**
# 禁止提权 —— 两者互补：`cap_drop` 管当前进程，`no-new-privileges` 管「镜像里若残留 setuid 程序」
# 的那条路。判据要求**两者齐备**（只写一个不给过）。
hardening_ok() {
  local f="$1"
  nocomment "${f}" | grep -qE '^[[:space:]]*cap_drop:[[:space:]]*$' || return 1
  nocomment "${f}" | grep -qE '^[[:space:]]*-[[:space:]]*ALL[[:space:]]*$' || return 1
  nocomment "${f}" | grep -qE 'no-new-privileges:true' || return 1
  return 0
}
# AC13.3 第三条：**镜像内不含非必需的系统包管理能力** —— 判据作用在**容器内的命令可见性**
#   （`command -v` 的原始输出文本）。离线侧只能证明「判据能分辨」，取值归相 2/3 实测。
pkgmgrs_ok() { # $1 = `command -v …` 的输出文本；0 = 合格（无包管理器，且保留了 sh）
  local out="$1"
  printf '%s\n' "${out}" | grep -qE '/(apt-get|apt|dpkg|apk|rpm|yum|dnf)$' && return 1
  printf '%s\n' "${out}" | grep -qE '/sh$' || return 1 # healthcheck 的 CMD-SHELL 依赖它，不能一并删掉
  return 0
}

# ── 判据自检：正/反对照全部用**合成样本**（不拿制品现状当样本 —— 口径同 #1 探针的 C5）──────
printf 'name: s\nservices:\n  p:\n    image: x\n    volumes:\n      - /var/run/docker.sock:/var/run/docker.sock\n' >"${TMP}/socket.yml"
printf 'name: s\nservices:\n  p:\n    image: x\n    volumes:\n      - ./a:/b\n' >"${TMP}/nosocket.yml"
check S1 'AC13.1 判据可判：socket 挂载命中 / 未挂载不命中' \
  "$([ "$(socket_hits "${TMP}/socket.yml")" -gt 0 ] && [ "$(socket_hits "${TMP}/nosocket.yml")" -eq 0 ] && echo 0 || echo 1)" \
  "含 socket 样本命中 $(socket_hits "${TMP}/socket.yml") 处 · 不含样本 $(socket_hits "${TMP}/nosocket.yml") 处"

printf 'name: s\nservices:\n  p:\n    image: x\n    privileged: true\n    cap_add:\n      - SYS_ADMIN\n' >"${TMP}/priv.yml"
printf 'name: s\nservices:\n  p:\n    image: x\n    user: "999:999"\n' >"${TMP}/nopriv.yml"
check S2 'AC13.2 判据可判：特权/宿主命名空间/cap 提升命中，普通配置不命中' \
  "$([ "$(privilege_hits "${TMP}/priv.yml")" -gt 0 ] && [ "$(privilege_hits "${TMP}/nopriv.yml")" -eq 0 ] && echo 0 || echo 1)" \
  "特权样本命中 $(privilege_hits "${TMP}/priv.yml") 处 · 普通样本 $(privilege_hits "${TMP}/nopriv.yml") 处"

printf 'name: s\nservices:\n  p:\n    image: x\n    read_only: true\n    tmpfs:\n      - /tmp\n' >"${TMP}/ro-ok.yml"
printf 'name: s\nservices:\n  p:\n    image: x\n    read_only: true\n' >"${TMP}/ro-notmpfs.yml"
printf 'name: s\nservices:\n  p:\n    image: x\n' >"${TMP}/ro-none.yml"
check S3 'AC13.3 只读根判据可判（**三态**：只读+tmpfs 合格 · 只读无 tmpfs 不合格 · 无只读不合格）' \
  "$(readonly_ok "${TMP}/ro-ok.yml" && ! readonly_ok "${TMP}/ro-notmpfs.yml" && ! readonly_ok "${TMP}/ro-none.yml" && echo 0 || echo 1)" \
  '正样本合格 · 缺 tmpfs 不合格（**不完整不是合格**）· 无只读不合格 ⇒ 判据能分辨三态'

printf 'name: s\nservices:\n  p:\n    image: x\n    mem_limit: 1g\n    pids_limit: 128\n' >"${TMP}/lim-ok.yml"
printf 'name: s\nservices:\n  p:\n    image: x\n    mem_limit: 1g\n' >"${TMP}/lim-nopids.yml"
check S4 'AC13.3 资源限额判据可判（mem_limit 与 pids_limit **二者齐备**才算）' \
  "$(limits_ok "${TMP}/lim-ok.yml" && ! limits_ok "${TMP}/lim-nopids.yml" && echo 0 || echo 1)" \
  '正样本合格 · 缺 pids_limit 不合格 ⇒ 「配了一半」不会被判成合格'

check S5 'AC13.3 包管理能力判据可判（含 apt/dpkg ⇒ 不合格；只剩 sh ⇒ 合格 —— 且不能把 sh 一起删掉）' \
  "$(! pkgmgrs_ok "$(printf '/usr/bin/apt-get\n/usr/bin/dpkg\n/bin/sh')" && pkgmgrs_ok "$(printf '/bin/sh')" && ! pkgmgrs_ok '' && echo 0 || echo 1)" \
  '含包管理器不合格 · 只剩 sh 合格 · **空输出不合格**（命令都没了 ⇒ 不是「最小」而是「坏了」）'

printf 'name: s\nservices:\n  p:\n    image: x\n    cap_drop:\n      - ALL\n    security_opt:\n      - no-new-privileges:true\n' >"${TMP}/hard-ok.yml"
printf 'name: s\nservices:\n  p:\n    image: x\n    cap_drop:\n      - ALL\n' >"${TMP}/hard-nonnp.yml"
printf 'name: s\nservices:\n  p:\n    image: x\n' >"${TMP}/hard-none.yml"
check S6 'AC13.2 加固侧判据可判（`cap_drop: ALL` 与 `no-new-privileges` **二者齐备**才算；只写一个不给过）' \
  "$(hardening_ok "${TMP}/hard-ok.yml" && ! hardening_ok "${TMP}/hard-nonnp.yml" && ! hardening_ok "${TMP}/hard-none.yml" && echo 0 || echo 1)" \
  '正样本合格 · 只丢 caps 不合格 · 都没有不合格 ⇒ 「加固了一半」不会被判成合格'

# ── 现状记录（**只写 info**；是否达标由 `Q` 类契约断言在施工后接手）────────────────────
info "现状（门户 compose）：socket 挂载 $(socket_hits "${PORTAL_COMPOSE}") 处 · 特权键 $(privilege_hits "${PORTAL_COMPOSE}") 处 · $(readonly_ok "${PORTAL_COMPOSE}" && echo '只读根已配齐' || echo '只读根未配齐 ✗') · $(limits_ok "${PORTAL_COMPOSE}" && echo '资源限额已配齐' || echo '资源限额未配齐 ✗')"
info "现状（主 stack compose）：socket 挂载 $(socket_hits "${MAIN_COMPOSE}") 处 · 特权键 $(privilege_hits "${MAIN_COMPOSE}") 处 · $(readonly_ok "${MAIN_COMPOSE}" && echo '只读根已配齐' || echo '只读根未配齐 ✗') · $(limits_ok "${MAIN_COMPOSE}" && echo '资源限额已配齐' || echo '资源限额未配齐 ✗')"
info '范围边界：S13 的三条 AC 说的是**门户容器**（公网可达组件）；主 stack 的加固不在本行范围（登记备查，归属 `#10`/后续）'
info "现状（Dockerfile）：运行身份 = $(grep -m1 -E '^USER ' "${DOCKERFILE}" || echo '（未声明 USER）')（AC13.2 的镜像侧；uid/gid 已由 #1 探针 E4/E5 实证 999:999）"

# ── U：已判项引用（不重跑）────────────────────────────────────────────────────────
check U1 'AC13.2「非 root 运行」的镜像侧**已判**（引用 #1 探针 `E4`：容器内 uid=999）' \
  "$(grep -q 'E4' "${PRODUCT}/probes/portal-image-verdict-probe/probe.sh" && grep -qE '^USER 999:999' "${DOCKERFILE}" && echo 0 || echo 1)" \
  'Dockerfile 声明 `USER 999:999` · #1 探针 E4 已实测容器内 uid=999'

# ── Q：`#4` 本体落地后的**编排契约断言**（落地 ⇒ 被改坏即红；口径同 `#2` 探针的 `Q` 类）──────────
check Q1 '编排契约：只读根**配齐**（`read_only: true` **且**给出可写的必要挂载 `tmpfs`）且资源限额**齐备**（`mem_limit` + `pids_limit`）' \
  "$(readonly_ok "${PORTAL_COMPOSE}" && limits_ok "${PORTAL_COMPOSE}" && echo 0 || echo 1)" \
  "只读根 $(readonly_ok "${PORTAL_COMPOSE}" && echo 合格 || echo '不合格 ✗') · 限额 $(limits_ok "${PORTAL_COMPOSE}" && echo 合格 || echo '不合格 ✗')"
check Q2 '编排契约：权限加固**齐备**（`cap_drop: ALL` + `no-new-privileges:true`）' \
  "$(hardening_ok "${PORTAL_COMPOSE}" && echo 0 || echo 1)" \
  "加固判据 $(hardening_ok "${PORTAL_COMPOSE}" && echo 合格 || echo '不合格 ✗')"

# ─────────────────────── 相 2：底座镜像代理（需 docker + 网络）───────────────────────
echo
echo '--- 相 2：包管理能力的代理实测（底座镜像；proxy）---'
if ! docker info >/dev/null 2>&1; then
  unjudged P2 'docker 守护可用' 'docker info 失败 ⇒ 相 2 / 相 3 整体未判'
  finish
fi
if ! docker image inspect "${BASE_IMAGE}" >/dev/null 2>&1; then
  docker pull "${BASE_IMAGE}" >/dev/null 2>&1 || {
    unjudged T1p '底座镜像可取' "${BASE_IMAGE} 不在本地且拉取失败 ⇒ 相 2 未判"
    finish
  }
fi
PKG_BASE="$(docker run --rm --entrypoint sh "${BASE_IMAGE}" -c 'command -v apt-get; command -v apt; command -v dpkg; command -v apk; command -v rpm; command -v yum; command -v dnf; command -v sh' 2>/dev/null || true)"
check T1p '底座的包管理能力面可机械判定（值见 detail）' \
  "$([ -n "${PKG_BASE}" ] && echo 0 || echo 1)" "命中：$(printf '%s' "${PKG_BASE}" | tr '\n' ' ')"
info "代理含义：最终镜像 = 本底座 + \`ca-certificates\` + COPY ⇒ **不会**自动变「更小」⇒ 此处若命中 apt/dpkg，最终镜像默认也带（AC13.3 第三条的**缺口**）；权威取值仍归相 3 的 T4"

# ─────────────────────────── 相 3：门户镜像实测（权威）───────────────────────────
echo
echo '--- 相 3：门户镜像实测（权威）---'
if [ -z "${IMG}" ] || ! docker image inspect "${IMG}" >/dev/null 2>&1; then
  unjudged T1 '门户镜像在本地（PORTAL_BUILD_TAG）' \
    "${IMG:-未提供 PORTAL_BUILD_TAG} ⇒ 相 3 未判。复跑条件：构建后带 PORTAL_BUILD_TAG 跑本脚本（CI 里 buildx 可用）"
  finish
fi
info "门户镜像：${IMG}"

RUN_ID="$(docker run --rm --entrypoint sh "${IMG}" -c 'id -u' 2>/dev/null || echo '?')"
check T1 'AC13.2：容器内运行身份为非 root（uid != 0）' \
  "$([ "${RUN_ID}" != '0' ] && [ "${RUN_ID}" != '?' ] && echo 0 || echo 1)" "uid=${RUN_ID}（期望 999）"

SOCK="$(docker run --rm --entrypoint sh "${IMG}" -c 'if [ -e /var/run/docker.sock ]; then echo yes; else echo no; fi' 2>/dev/null || echo '?')"
check T2 'AC13.1：容器内不存在 docker socket（`TC-P-L1-08` 的容器侧）' \
  "$([ "${SOCK}" = 'no' ] && echo 0 || echo 1)" "/var/run/docker.sock 存在=${SOCK}（期望 no）"

PKG_IMG="$(docker run --rm --entrypoint sh "${IMG}" -c 'command -v apt-get; command -v apt; command -v dpkg; command -v apk; command -v rpm; command -v yum; command -v dnf; command -v sh' 2>/dev/null || true)"
# `#4` 本体已在 `Dockerfile` 里移除包管理能力 ⇒ 由「现状记录」**升为契约断言**（`Q` 类口径：
# 落地之后就该被改坏即红）。判据要求「包管理器全空 **且** `sh` 仍在」。
check T4 'AC13.3 第三条：镜像内**不含**非必需的系统包管理能力（且保留了 `sh`）' \
  "$(pkgmgrs_ok "${PKG_IMG}" && echo 0 || echo 1)" "命中：$(printf '%s' "${PKG_IMG}" | tr '\n' ' ')"

# 只读根可行性（AC13.3 第一条的**关键未知项**）：`--read-only` + 必要 tmpfs 下门户还能不能起来
JWKS="$(docker run --rm --entrypoint node "${IMG}" --input-type=module -e "
import { exportJWK, generateKeyPair } from 'jose';
const { publicKey } = await generateKeyPair('RS256');
process.stdout.write(JSON.stringify({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'attack-probe', use: 'sig' }] }));
" 2>/dev/null || true)"
if [ -z "${JWKS}" ]; then
  unjudged T3 '只读根可行性' '镜像内 node 无法 import jose ⇒ 起容器类用例整体未判'
  finish
fi
USERS_DIR="${TMP}/users"; mkdir -p "${USERS_DIR}"; chmod 1777 "${USERS_DIR}"
# **必要挂载必须齐**（AC13.3 的原文就是「根文件系统**除必要挂载外**为只读」）：门户要写
# `/srv/portal`（门户库 —— compose 里是 `portal_data` 命名卷）与 `/tmp`（tmpfs）。首版漏了前者 ⇒
# CI 首跑转红（**探针自伤**：夹具不完整会把「产品不可行」误报成结论 —— 实测依据见 change-log 同日小节）。
PDPORTAL_DIR="${TMP}/srv-portal"; mkdir -p "${PDPORTAL_DIR}"; chmod 1777 "${PDPORTAL_DIR}"
docker rm -f "${NAME}" >/dev/null 2>&1 || true
# **按 compose 的最终加固设置**起容器：`--read-only` + 必要 `tmpfs` + `--cap-drop ALL` +
# `--security-opt no-new-privileges` + `--memory` / `--pids-limit`。断言的不是「只读根理论上可行」，
# 而是「**我们发出去的那套设置跑得起来**」—— compose 若与运行时实际能力冲突，这里会第一个红。
docker run -d --name "${NAME}" \
  --read-only --tmpfs /tmp:mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --memory 512m --pids-limit 128 \
  -v "${USERS_DIR}:/data/users" \
  -v "${PDPORTAL_DIR}:/srv/portal" \
  -v "${PRODUCT}/upstream.lock:/app/upstream.lock:ro" \
  -e PORTAL_ENV=development \
  -e PORTAL_ADMIN_HOST=localhost \
  -e PORTAL_MCP_HOST=127.0.0.1 \
  -e PORTAL_DB_PATH=/srv/portal/portal.db \
  -e PORTAL_PORT=8080 \
  -e PORTAL_TEST_JWT_ENABLED=1 \
  -e "PORTAL_TEST_JWT_JWKS=${JWKS}" \
  -e PORTAL_TEST_JWT_ISS=https://attack-probe.test \
  -e PORTAL_TEST_JWT_AUD=attack-probe-aud \
  -e PORTAL_TEST_JWT_EMAIL=attack-probe@localhost \
  "${IMG}" >/dev/null 2>&1
RO_OK='?'
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  RO_OK="$(docker exec "${NAME}" node -e "fetch('http://localhost:8080/healthz').then((r) => process.stdout.write(String(r.status))).catch(() => process.exit(3));" 2>/dev/null || true)"
  [ "${RO_OK}" = '200' ] && break
  sleep 1
done
RO_LOGS="$(docker logs "${NAME}" 2>&1 || true)"
RO_DIAG="$(printf '%s\n' "${RO_LOGS}" | grep -o '"event":"config_invalid","message":"[^"]*"\|"event":"selfcheck_failed"[^}]*\|"event":"startup_failed","message":"[^"]*"' | head -1 || true)"
# 诊断**必须自带**：容器「在跑但从未监听」时，唯一有用的信息就是**进程自己说了什么**。
# 首版只摘 JSON 事件 ⇒ 若失败发生在**自检之前**（如 EROFS 写失败，进程压根没跑到自检），明细会是空的
# ⇒ 白跑一轮 CI（实测发生过一次）。⇒ 一并带上容器状态/退出码与日志**首行**。口径同 `#2` 冒烟的 `P2`/`P3`。
RO_STATE="$(docker inspect -f '{{.State.Status}} exit={{.State.ExitCode}}' "${NAME}" 2>/dev/null || echo '?')"
RO_HEAD="$(printf '%s\n' "${RO_LOGS}" | grep -v '^[[:space:]]*$' | head -3 | tr '\n' '|' | cut -c1-300)"
RO_LISTEN="$(printf '%s\n' "${RO_LOGS}" | grep -c '"event":"portal_listening"' || true)"
check T3 'AC13.3 第一条：按 compose 的**最终加固设置**（`read_only` + `tmpfs` + `cap_drop ALL` + `no-new-privileges` + 限额）起容器 ⇒ 门户**仍能起来并服务**' \
  "$([ "${RO_OK}" = '200' ] && echo 0 || echo 1)" \
  "20 s 内 /healthz 状态码 '${RO_OK}' · 容器 ${RO_STATE} · portal_listening=${RO_LISTEN} 次 · 日志首行：${RO_HEAD:-（空）}${RO_DIAG:+【${RO_DIAG}】}"

# 资源基线（给限额取值提供依据）：健康容器运行 ~8 s 后的内存峰值与进程数
sleep 8
MEM_USED="$(docker stats --no-stream --format '{{.MemUsage}}' "${NAME}" 2>/dev/null || echo '?')"
PIDS_CUR="$(docker exec "${NAME}" sh -c 'cat /sys/fs/cgroup/pids.current 2>/dev/null || echo ?' 2>/dev/null || echo '?')"
check T5 'AC13.3 第二条：资源基线可实测（内存 / 进程数 —— 限额取值需以此为据）' \
  "$([ "${MEM_USED}" != '?' ] && echo 0 || echo 1)" "内存 ${MEM_USED} · cgroup pids.current=${PIDS_CUR}"
info "限额取值口径（供施工拍板）：内存上限 ≥ 基线 × 常数（含 4 路会话，取值见 web-design §12.9 与 3.17 探针：~27 MiB/会话）· pids_limit ≥ node 线程 + 4 子进程 + 余量"

finish
