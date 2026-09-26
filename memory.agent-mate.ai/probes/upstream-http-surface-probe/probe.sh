#!/usr/bin/env bash
# #5 开工准备探针 —— 上游自身 HTTP 面（serve 的 9077）封闭（只读；判据先行）
#
# 服务对象：Sprint 5 #5 mcp:上游 HTTP 面封闭（原 `2.1`）
#   判据真源：specs/web-portal/web-stories.md **`AC10.4`**（@edge：「新增门户公网入口不改变 ai-memory
#             本体的暴露面」⇒ 本体仍无公网入口 · 未启用顶层 API key 开关 · **serve 的 9077 对外不可达**）
#             specs/product-backlog.md **#30**（更精确的三条：① 主机外扫描 9077 **不可达** ② 部署制品
#             （compose + 反向代理配置）**无 9077 端口映射与代理规则** ③ `config.toml` **未启用顶层
#             `api_key` 系列键**）
#             specs/mcp/mcp-design.md §1（传输只有 stdio；`serve` 的 9077 仅绑容器回环、无 api_key）
#             specs/deployment.md §3 / §12.5（端口映射「无」；`serve --host 127.0.0.1 --port 9077`）
#             specs/sprint-backlog.md 技术难点 8（**两条都要判**：制品不含映射 + 公网不可达；
#             且「映射缺失 ≠ 端口未监听」—— 容器内仍可能监听并被**同网其他容器**访问）
#   制品：deploy/docker-compose.prod.yml · deploy/portal.compose.yml · deploy/config.toml.tmpl
#         deploy/config.toml · deploy/config.local.toml · deploy/.env* · deploy/README.md
#
# 两相：
#   相 1（离线，零依赖）：静态判据（制品面）+ 契约断言 —— 覆盖 `#30` 的第 ②/③ 条
#   相 2（需 docker 守护 + 能拉 `PROBE_TOOL_IMAGE`）：**同网可达性**判据 —— 用**合成靶**
#         （不是上游）证明「绑回环 ⇒ 同网 sibling 探不到 / 绑 0.0.0.0 ⇒ 探得到」这条判据**能红能绿**。
#         **宿主侧不能探容器 bridge IP**（Docker Desktop 不路由 172.x）⇒ 探测必须在 **sibling 容器**里做，
#         否则「不可达」会因为错误的原因成立（假绿，已登记为坑 1）。
#
# 未判（如实登记，**不伪装通过**）：本相**已无未判项** —— 公网面（`#30` ①）按 2026-09-27 拍板
#   **降为 `info` 归属登记**（执行点 = `#13`/`#14`），见文末 info。**未判仍会用于**：docker 守护不可用 /
#   拉不到相 2 的靶镜像（那时 `P1`/`P2` 如实未判 ⇒ `rc=30`）。
#
# 退出码：0 = 本行应判项全绿 · 10 = 有 FAIL · 30 = 有未判项 · 20 = 运行错误
#
# 只读边界：不改产品代码 / specs / deploy 制品；改写只发生在 `${TMP}`（trap 清理）；
#           相 2 只起临时容器与临时网络，跑完即删。
#
# 用法：
#   bash memory.agent-mate.ai/probes/upstream-http-surface-probe/probe.sh
#   PROBE_TOOL_IMAGE=python:3-alpine bash …/probe.sh     # 指定相 2 的靶/探测镜像

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/../.." && pwd)" # memory.agent-mate.ai/
DEPLOY="${PRODUCT}/deploy"
SPECS="${PRODUCT}/specs"
MAIN_COMPOSE="${DEPLOY}/docker-compose.prod.yml"
PORTAL_COMPOSE="${DEPLOY}/portal.compose.yml"
CONFIG_TMPL="${DEPLOY}/config.toml.tmpl"
CONFIG_PROD="${DEPLOY}/config.toml"
CONFIG_LOCAL="${DEPLOY}/config.local.toml"
STORIES="${SPECS}/web-portal/web-stories.md"
BACKLOG="${SPECS}/product-backlog.md"
MCP_DESIGN="${SPECS}/mcp/mcp-design.md"
DEPLOYMENT="${SPECS}/deployment.md"

TOOL_IMAGE="${PROBE_TOOL_IMAGE:-python:3-alpine}"
NET="upstream-http-surface-probe-$$"
SRV_A="surface-probe-loopback-$$"
SRV_B="surface-probe-any-$$"

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
  docker rm -f "${SRV_A}" "${SRV_B}" >/dev/null 2>&1 || true
  docker network rm "${NET}" >/dev/null 2>&1 || true
  rm -rf "${TMP}"
}
trap cleanup EXIT

nocomment() { grep -v '^[[:space:]]*#' "$1"; }

echo '=== #5 开工准备探针：上游自身 HTTP 面（serve 的 9077）封闭 ==='
echo

# ───────────────────────────── 相 0：前置（在位性）─────────────────────────────
missing=''
for f in "${MAIN_COMPOSE}" "${PORTAL_COMPOSE}" "${CONFIG_TMPL}" "${CONFIG_PROD}" "${CONFIG_LOCAL}" "${STORIES}" "${BACKLOG}" "${MCP_DESIGN}" "${DEPLOYMENT}"; do
  [ -s "${f}" ] || missing="${missing} $(basename "${f}")"
done
check C0 '判据输入文件全部在位且非空' "$([ -z "${missing}" ] && echo 0 || echo 1)" "${missing:-9/9 在位}"
[ -z "${missing}" ] || finish

SRC_HITS=0
grep -q 'AC10.4' "${STORIES}" && SRC_HITS=$((SRC_HITS + 1))
grep -q '主机外扫描 9077' "${BACKLOG}" && SRC_HITS=$((SRC_HITS + 1))
grep -q '9077 仅绑容器回环' "${MCP_DESIGN}" && SRC_HITS=$((SRC_HITS + 1))
grep -q 'serve --host 127.0.0.1 --port 9077' "${DEPLOYMENT}" && SRC_HITS=$((SRC_HITS + 1))
check C1 '判据真源可定位（`AC10.4` + `product-backlog` #30 的三条 + `mcp-design` §1 + `deployment` §3）' \
  "$([ "${SRC_HITS}" -eq 4 ] && echo 0 || echo 1)" "命中 ${SRC_HITS}/4"

# ───────────────────── 相 1：静态判据（制品面）+ 契约断言 ─────────────────────
echo
echo '--- 相 1：制品面判据（映射 / 绑回环 / api_key 开关 / 代理规则）---'

# ── 判据定义 ──────────────────────────────────────────────────────────────────────────────
# 「制品无 9077 映射」：只看**非注释可见行**里的 9077，豁免三类（各有理由）：
#   · `serve` / `--port` / `--host` ⇒ 这是**容器内监听**声明（是否绑回环由另一条判据管）
#   · `expose:` / `EXPOSE` ⇒ 容器/镜像**元数据**，不发布到主机（只有 `ports:` 才发布）
#   · 注释行 ⇒ 不生效
map_lines() { nocomment "$1" | grep -nE '9077' | grep -vE 'serve|--port|--host|expose:|EXPOSE' || true; }
map_hits() { map_lines "$1" | grep -c . || true; }

# 顶层 `api_key`（禁）**必须**与 `api_key_env` / `api_key_file`（允许，属 embeddings 段）区分开：
# 朴素 grep 'api_key' 会把后者误判成违规 —— `S2` 专测这一点（判据要锚在语义，不在子串）。
top_api_key_hits() { nocomment "$1" | grep -cE '^[[:space:]]*api_key[[:space:]]*=' || true; }
require_api_key_hits() { nocomment "$1" | grep -cE 'AI_MEMORY_REQUIRE_API_KEY' || true; }

# compose 的 `command:` 是 **JSON 数组**（`["serve", "--host", "127.0.0.1", "--port", "9077"]`）⇒
# 参数之间是 `", "` 而不是空格。判据若按「空格」写就会**假红**（首版即如此，`S3` 抓到）。
# ⇒ 先「拉平」：去掉引号 / 逗号 / 方括号，再按空格匹配。
flatten() { nocomment "$1" | tr -d '"'"'"',[]'; }
# 绑回环：必须**显式** `--host 127.0.0.1`（缺省值不可依赖）；显式 `0.0.0.0` 直接不合格。
loopback_ok() { # $1=文件
  flatten "$1" | grep -qE -- '--host[[:space:]]+127\.0\.0\.1' || return 1
  ! flatten "$1" | grep -qE -- '--host[[:space:]]+0\.0\.0\.0' || return 1
  return 0
}
explicit_port_ok() { flatten "$1" | grep -qE -- '--port[[:space:]]+9077' || return 1; return 0; }

# 代理规则：任何反代设施里出现 9077 ⇒ 违规（`#30` 明确含「反向代理配置」这一面）
proxy_9077_hits() { grep -rInE '9077' "${DEPLOY}" 2>/dev/null | grep -cE 'proxy_pass|reverse_proxy|traefik|rule=|upstream[[:space:]]' || true; }
proxy_facility_hits() { grep -rIlE 'proxy_pass|reverse_proxy|traefik\.|caddy|nginx' "${DEPLOY}" 2>/dev/null | grep -c . || true; }

# ── S：判据自检（样本全部**合成**，不拿制品现状当样本）──────────────────────────────────────
printf 'name: s\nservices:\n  a:\n    image: x\n    ports:\n      # - "3200:9077"\n      - "3100:8080"\n' >"${TMP}/map-commented.yml"
printf 'name: s\nservices:\n  a:\n    image: x\n    ports:\n      - "3200:9077"\n' >"${TMP}/map-live.yml"
printf 'name: s\nservices:\n  a:\n    image: x\n    command: ["serve", "--host", "127.0.0.1", "--port", "9077"]\n' >"${TMP}/map-command.yml"
check S1 'AC「制品无映射」判据可判（**三态**：注释态映射**不算**违规 · 未注释映射**算** · `serve --port 9077` **不算**（容器内监听≠主机映射））' \
  "$([ "$(map_hits "${TMP}/map-commented.yml")" -eq 0 ] && [ "$(map_hits "${TMP}/map-live.yml")" -ge 1 ] && [ "$(map_hits "${TMP}/map-command.yml")" -eq 0 ] && echo 0 || echo 1)" \
  '注释态 0 · 生效态 ≥1 · command 里的 --port 0 ⇒ 三类分得清'

printf 'api_key = "inline-should-be-banned"\n' >"${TMP}/key-top.toml"
printf 'api_key_env = "DASHSCOPE_API_KEY"\n' >"${TMP}/key-env.toml"
printf 'api_key_file = "/run/secrets/k"\n' >"${TMP}/key-file.toml"
check S2 'AC「未启用顶层 api_key」判据可判（顶层 `api_key =` 命中 · `api_key_env =` / `api_key_file =` **不**命中 —— 后两者属 embeddings 段，是允许项）' \
  "$([ "$(top_api_key_hits "${TMP}/key-top.toml")" -ge 1 ] && [ "$(top_api_key_hits "${TMP}/key-env.toml")" -eq 0 ] && [ "$(top_api_key_hits "${TMP}/key-file.toml")" -eq 0 ] && echo 0 || echo 1)" \
  '朴素 grep api_key 会把 api_key_env 误判成违规 ⇒ 本判据锚在「行首键名 = api_key」'

printf 'name: s\nservices:\n  a:\n    image: x\n    command: ["serve", "--host", "127.0.0.1", "--port", "9077"]\n' >"${TMP}/host-ok.yml"
printf 'name: s\nservices:\n  a:\n    image: x\n    command: ["serve", "--host", "0.0.0.0", "--port", "9077"]\n' >"${TMP}/host-any.yml"
printf 'name: s\nservices:\n  a:\n    image: x\n    command: ["serve", "--port", "9077"]\n' >"${TMP}/host-none.yml"
check S3 'AC「绑容器回环」判据可判（`--host 127.0.0.1` 合格 · `0.0.0.0` 不合格 · **缺 `--host` 不合格**（不依赖上游缺省值））' \
  "$(loopback_ok "${TMP}/host-ok.yml" && ! loopback_ok "${TMP}/host-any.yml" && ! loopback_ok "${TMP}/host-none.yml" && echo 0 || echo 1)" \
  '显式回环合格；绑任意地址与「不写」都不合格'

printf 'name: s\nservices:\n  a:\n    image: x\n    labels:\n      - "traefik.http.routers.a.rule=Host(`x`)"\n' >"${TMP}/proxy-none.yml"
printf 'name: s\nservices:\n  a:\n    image: x\n' >"${TMP}/proxy-clean.yml"
check S4 'AC「无代理规则」判据可判（反代设施里出现 9077 ⇒ 命中；无反代设施 ⇒ 0）' \
  "$([ "$(grep -rInE '9077' "${TMP}/proxy-none.yml" | grep -cE 'proxy_pass|reverse_proxy|traefik|rule=|upstream[[:space:]]' || true)" -eq 0 ] && echo 0 || echo 1)" \
  '样本无 9077 ⇒ 0；本判据在制品面上按「含 9077 且含代理关键字」计数'

printf 'AI_MEMORY_REQUIRE_API_KEY=1\n' >"${TMP}/req-live.env"
printf '# 若将来映射 9077 则必须 AI_MEMORY_REQUIRE_API_KEY=1\n' >"${TMP}/req-comment.env"
check S5 'AC #30-③ 判据可判（**生效行**的 `AI_MEMORY_REQUIRE_API_KEY=1` 命中 · 仅**注释**提及不命中）' \
  "$([ "$(require_api_key_hits "${TMP}/req-live.env")" -ge 1 ] && [ "$(require_api_key_hits "${TMP}/req-comment.env")" -eq 0 ] && echo 0 || echo 1)" \
  '同一个键名出现在注释里是「旁证」（制品里写「将来必须启用」）；只有生效行才算「已启用」'

# ── Q：契约断言（现状）────────────────────────────────────────────────────────────────────
echo
echo '--- 相 1（续）：契约断言（现状）---'

check Q1 'AC #30-②（主 stack）：`docker-compose.prod.yml` 无生效的 9077 端口映射' \
  "$([ "$(map_hits "${MAIN_COMPOSE}")" -eq 0 ] && echo 0 || echo 1)" \
  "命中 $(map_hits "${MAIN_COMPOSE}") 处 · $(map_lines "${MAIN_COMPOSE}" | head -1)"

check Q2 'AC #30-②（门户 stack）：`portal.compose.yml` 无生效的 9077 端口映射' \
  "$([ "$(map_hits "${PORTAL_COMPOSE}")" -eq 0 ] && echo 0 || echo 1)" \
  "命中 $(map_hits "${PORTAL_COMPOSE}") 处"

check Q3 'AC「绑容器回环」：`serve` **显式**绑 `127.0.0.1` **且显式**指端口（不依赖上游缺省值 `DEFAULT_PORT=9077`）' \
  "$(loopback_ok "${MAIN_COMPOSE}" && explicit_port_ok "${MAIN_COMPOSE}" && echo 0 || echo 1)" \
  "command = $(nocomment "${MAIN_COMPOSE}" | grep -o '\["serve".*\]' | head -1 | cut -c1-90)"

KEY_TOP=$(( $(top_api_key_hits "${CONFIG_TMPL}") + $(top_api_key_hits "${CONFIG_PROD}") + $(top_api_key_hits "${CONFIG_LOCAL}") ))
KEY_REQ=$(require_api_key_hits "${CONFIG_TMPL}")
# 只数**生效行**（`nocomment` 口径）：制品多处出现该键名是在**注释**里写「将来映射时必须启用」——
# 那是旁证不是违规。首版按 `grep -rIc`（**含注释**）数 ⇒ 把 4 个文件的注释算成违规（`S` 自检没覆盖
# 这一点 ⇒ 同批补 `S5`）。
KEY_REQ_ALL=0
for f in "${DEPLOY}"/.env* "${DEPLOY}"/*.toml "${DEPLOY}"/*.yml "${DEPLOY}"/*.example; do
  [ -f "${f}" ] && KEY_REQ_ALL=$((KEY_REQ_ALL + $(require_api_key_hits "${f}")))
done
check Q4 'AC #30-③：`config.toml` **未启用顶层 `api_key`**（模板 / 生产 / 本地三处）**且**未启用 `AI_MEMORY_REQUIRE_API_KEY`' \
  "$([ "${KEY_TOP}" -eq 0 ] && [ "${KEY_REQ}" -eq 0 ] && [ "${KEY_REQ_ALL}" -eq 0 ] && echo 0 || echo 1)" \
  "顶层 api_key 命中 ${KEY_TOP} 处（模板/生产/本地）· 模板内 REQUIRE_API_KEY ${KEY_REQ} 处 · 制品中出现的文件数 ${KEY_REQ_ALL}"

PROXY_HITS="$(proxy_9077_hits)"
FACILITY="$(proxy_facility_hits)"
check Q5 'AC #30-②（反向代理面）：制品内**无**指向 9077 的代理规则' \
  "$([ "${PROXY_HITS}" -eq 0 ] && echo 0 || echo 1)" \
  "指向 9077 的代理规则 ${PROXY_HITS} 处 · 制品内反代设施文件 ${FACILITY} 个（0 个 ⇒ 该面无承载物，结构性排除）"

IMPLICATION=0
grep -qE '取消注释.*3200:9077' "${MAIN_COMPOSE}" && IMPLICATION=$((IMPLICATION + 1))
grep -qE '必须同时设置|必须：此处设 api_key' "${MAIN_COMPOSE}" && IMPLICATION=$((IMPLICATION + 1))
grep -qE '必须：此处设 api_key' "${CONFIG_TMPL}" && IMPLICATION=$((IMPLICATION + 1))
check Q6 '契约自洽（fail-loud 旁证）：制品里写着「**若将来映射 9077 ⇒ 必须同时启用 api_key 系列键**」的指示（compose 注释 + 模板注释）' \
  "$([ "${IMPLICATION}" -eq 3 ] && echo 0 || echo 1)" \
  "命中 ${IMPLICATION}/3 处（compose 两处 + 模板一处）"

DEPLOY_MAP_TOTAL=0
for f in "${DEPLOY}"/*.yml "${DEPLOY}"/*.toml "${DEPLOY}"/.env* "${DEPLOY}"/*.example; do
  [ -f "${f}" ] && DEPLOY_MAP_TOTAL=$((DEPLOY_MAP_TOTAL + $(map_hits "${f}")))
done
check Q7 'AC #30-②（面广一层）：`deploy/` 全制品（compose / toml / env）**零**生效 9077 映射' \
  "$([ "${DEPLOY_MAP_TOTAL}" -eq 0 ] && echo 0 || echo 1)" "全制品命中合计 ${DEPLOY_MAP_TOTAL} 处"

# ───────────────── 相 2：同网可达性（合成靶，证明判据能红能绿）─────────────────
echo
echo '--- 相 2：同网可达性判据（合成靶：绑回环 ⇒ sibling 探不到；绑任意 ⇒ 探得到）---'

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  unjudged P1 '同网可达性判据自检·正向控制（绑 0.0.0.0 ⇒ sibling **可达**）' '本机 docker 守护不可用'
  unjudged P2 '同网可达性（绑 127.0.0.1 ⇒ sibling **不可达**，与制品 `--host 127.0.0.1` 配成一对）' '本机 docker 守护不可用'
elif ! docker image inspect "${TOOL_IMAGE}" >/dev/null 2>&1 && ! docker pull -q "${TOOL_IMAGE}" >/dev/null 2>&1; then
  unjudged P1 '同网可达性判据自检·正向控制（绑 0.0.0.0 ⇒ sibling **可达**）' "拉不到靶镜像 ${TOOL_IMAGE}（可设 PROBE_TOOL_IMAGE）"
  unjudged P2 '同网可达性（绑 127.0.0.1 ⇒ sibling **不可达**）' "同上：拉不到靶镜像 ${TOOL_IMAGE}"
else
  info "相 2 靶/探测镜像：${TOOL_IMAGE}（探测一律在 **sibling 容器**内做 —— 宿主探 bridge IP 在 Docker Desktop 上不成立，会假绿）"
  docker network create "${NET}" >/dev/null 2>&1 || { echo '无法创建临时网络' >&2; exit 20; }

  PY='import socket,sys; s=socket.socket(); s.settimeout(3); sys.exit(0 if s.connect_ex((sys.argv[1], int(sys.argv[2]))) == 0 else 1)'
  probe_from_sibling() { # $1=目标容器名 → 0=可达 1=不可达 2=探测自身出错
    docker run --rm --network "${NET}" --entrypoint python "${TOOL_IMAGE}" -c "${PY}" "$1" 9077 >/dev/null 2>&1
    echo $?
  }

  # ⚠️ 必须给**完整命令**：`docker run <image> <args>` 是**替换 CMD**、不是追加 —— `python:3-alpine`
  # 的 CMD 是 `python3`，只传 `-m http.server …` 会让容器去 exec `-m` ⇒ 退出 127（首版即如此）。
  # 而它造成的后果很险：`P2`（不可达）会**通过**，但原因是「监听没起来」而不是「绑了回环」= **假绿**
  # ⇒ `P1` 正向控制正是为抓这种情形而存在。
  # 正向控制：绑 0.0.0.0 ⇒ 同网 sibling **应当可达**（否则「不可达」是假绿 —— 探测通路本身没通）
  docker run -d --name "${SRV_B}" --network "${NET}" --entrypoint python3 "${TOOL_IMAGE}" \
    -m http.server 9077 --bind 0.0.0.0 >/dev/null 2>&1 || true
  sleep 3
  RC_B="$(probe_from_sibling "${SRV_B}")"
  check P1 '同网可达性判据自检·正向控制：合成靶绑 `0.0.0.0` ⇒ 同网 sibling **可达**（证明探测通路有效）' \
    "$([ "${RC_B}" = '0' ] && echo 0 || echo 1)" "sibling 探测 rc=${RC_B}（0=可达，期望 0）"

  # 本行判据：绑 127.0.0.1 ⇒ 同网 sibling **不可达**（与制品里的 `--host 127.0.0.1` 构成完整判据）
  docker run -d --name "${SRV_A}" --network "${NET}" --entrypoint python3 "${TOOL_IMAGE}" \
    -m http.server 9077 --bind 127.0.0.1 >/dev/null 2>&1 || true
  sleep 3
  RC_A="$(probe_from_sibling "${SRV_A}")"
  check P2 '同网可达性：合成靶绑 `127.0.0.1` ⇒ 同网 sibling **不可达**（容器内回环不外露 ⇒ 同网其他容器访问不到）' \
    "$([ "${RC_A}" = '1' ] && echo 0 || echo 1)" "sibling 探测 rc=${RC_A}（1=不可达，期望 1）"

  docker rm -f "${SRV_A}" "${SRV_B}" >/dev/null 2>&1 || true
  docker network rm "${NET}" >/dev/null 2>&1 || true
fi

# ─────────────── 公网面：**归生产**（2026-09-27 拍板：降为 info 归属登记）───────────────
# 口径（与 `#3` 把 `AC9.2` 第二半归 `#15`/`#16` **同型**）：**本行判据 = 制品面**（本机可判、已全绿）
# **+ 公网面接口登记**（需求已定档、执行点明确 = `#13`/`#14`）⇒ 本探针 `rc=0`、可接 CI。
# 为什么不用 `unjudged`：它不是「本行判不了」，而是「**执行点在本行之外的生产环境**」；写成未判会让
# CI 该步**恒 `rc=30` 而红**。这与「不把未判当通过」不矛盾 —— 判据没被删，只是登记到了执行点。
echo
info 'AC #30-①（主机外扫描 9077 不可达）：**执行点归 `#13`（在线链路验收）/ `#14`（上线验收）** —— 需生产 + 主机外视角。接口**两条缺一不可**：① 主机外 `nc -z -w3 <host> 9077`（或 `curl --max-time 3 http://<host>:9077/metrics`）**必失败** ② **同一命令探门户公网入口必成功**（证明探测通路有效）。'
info '接口（给 #13 / #14 与在线链路探针 #6）：生产上线后补两条 —— ① 主机外 `nc -z -w3 <host> 9077`（或 `curl --max-time 3 http://<host>:9077/metrics`）**必须失败/超时** ② 同一命令对**门户的公网入口**必须成功（证明「探测通路有效」，否则失败可能是网络原因 ⇒ 假绿）。**两条缺一不可**（同相 2 的正向控制原理）。'
info '同网面（本相已判）：制品把 `serve` 绑到容器回环 ⇒ 同网其他容器（含门户）访问不到；若将来有人改成 `--host 0.0.0.0`（例如为了「容器间调试」），`Q3` 与 `P2` 会同时红 ⇒ 这正是技术难点 8 要防的形态。'

finish
