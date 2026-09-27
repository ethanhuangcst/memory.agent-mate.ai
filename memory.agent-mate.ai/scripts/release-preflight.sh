#!/usr/bin/env bash
# release-preflight.sh —— 上线预演：**一条命令**跑完本机可判的全部预演项，产出一份可存档的预演报告。
#
# 服务对象：Sprint 5 `#9` deploy:上线准备包（真源 = specs/release-readiness.md）。
#   本脚本只做**本机可判**的部分（制品核对 / 编排契约 / 三份清单待执行项枚举）；
#   **生产侧**（真起 stack + 真实 Cloudflare Access/隧道）**不在这里** —— 归 `#10`（部署执行），
#   本脚本以一个「未判」项显式登记它，不伪装通过。
#
# 用法：
#   bash memory.agent-mate.ai/scripts/release-preflight.sh              # 报告打到 stdout
#   bash memory.agent-mate.ai/scripts/release-preflight.sh --out FILE   # 同时写一份存档
#
# 退出码（与仓内探针同口径）：0 = 全判且无失败 · 10 = 有 FAIL · 30 = 有未判项 · 20 = 运行错误

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/.." && pwd)"           # memory.agent-mate.ai/
REPO="$(cd "${PRODUCT}/.." && pwd)"           # 仓库根
DEPLOY="${PRODUCT}/deploy"
SPECS="${PRODUCT}/specs"
PORTAL_COMPOSE="${DEPLOY}/portal.compose.yml"
MAIN_COMPOSE="${DEPLOY}/docker-compose.prod.yml"
LOCK="${PRODUCT}/upstream.lock"
DEPLOYMENT="${SPECS}/deployment.md"
MCP_DESIGN="${SPECS}/mcp/mcp-design.md"
WEB_TEST="${SPECS}/web-portal/web-test.md"
READINESS="${SPECS}/release-readiness.md"

OUT_FILE=''
WANT_OUT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) WANT_OUT=1; OUT_FILE="${2:-}"; shift 2 ;;
    --out=*) WANT_OUT=1; OUT_FILE="${1#--out=}"; shift ;;
    -h|--help) sed -n '2,14p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 20 ;;
  esac
done

PASS=0; FAIL=0; UNJUDGED=0
REPORT="$(mktemp)" || { echo '无法创建临时文件' >&2; exit 20; }
cleanup() { rm -f "${REPORT}"; }
trap cleanup EXIT

say() { printf '%s\n' "$*" | tee -a "${REPORT}"; }
check() { # $1=id $2=name $3=ok(0/1) $4=detail
  local detail="${4:-}"
  if [ "$3" = '0' ]; then PASS=$((PASS + 1)); say "PASS [${1}] ${2}${detail:+ — ${detail}}"
  else FAIL=$((FAIL + 1)); say "FAIL [${1}] ${2}${detail:+ — ${detail}}"; fi
}
unjudged() { UNJUDGED=$((UNJUDGED + 1)); say "未判 [${1}] ${2} — ${3}"; }
info() { say "[i] ${1}"; }
nocomment() { grep -v '^[[:space:]]*#' "$1"; }

say "=== 上线预演报告（release-preflight）==="
say "时间：$(date -u +%Y-%m-%dT%H:%M:%SZ) · 仓根：${REPO}"
say ''

# ── 1. 生产模板与落地文件（§12.2 的「门户侧要落地的文件 = 4 个」）────────────────────────────
say '--- 1. 生产模板与落地文件（§12.2）---'
missing=''
for f in "${PORTAL_COMPOSE}" "${MAIN_COMPOSE}" "${LOCK}" "${DEPLOY}/portal.env.example" "${DEPLOY}/config.toml.tmpl"; do
  [ -s "${f}" ] || missing="${missing} $(basename "${f}")"
done
check R1 '编排与模板制品齐备（门户 compose · 主 stack compose · upstream.lock · portal.env 样例 · config.toml 模板）' \
  "$([ -z "${missing}" ] && echo 0 || echo 1)" "缺：${missing:-（无）}"
check R2 '上线剧本落点在位（specs/release-readiness.md）' \
  "$([ -s "${READINESS}" ] && echo 0 || echo 1)" "$([ -s "${READINESS}" ] && echo '在位' || echo '缺失 ⇒ 见 #9 交付')"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD='docker compose'
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD='docker-compose'   # 老命令（本机常见）—— 两种都试，避免「本机判不了、CI 才判得了」
else
  COMPOSE_CMD=''
fi
if [ -n "${COMPOSE_CMD}" ]; then
  TMPD="$(mktemp -d)"
  cp "${PORTAL_COMPOSE}" "${TMPD}/" && : >"${TMPD}/portal.env"
  if ( cd "${TMPD}" && PORTAL_IMAGE=x PORTAL_ADMIN_HOST=a.test PORTAL_MCP_HOST=b.test \
        PORTAL_ACCESS_TEAM_DOMAIN=c.test PORTAL_ACCESS_AUD=d \
        ${COMPOSE_CMD} -f portal.compose.yml config >/dev/null 2>&1 ); then
    check R3 '生产模板**可渲染**（compose config 无语法/插值错误 —— §12.5.5 第 1 项）' 0 "命令：${COMPOSE_CMD}"
  else
    check R3 '生产模板**可渲染**（compose config 无语法/插值错误 —— §12.5.5 第 1 项）' 1 "命令：${COMPOSE_CMD} ⇒ rc≠0"
  fi
  rm -rf "${TMPD}"
else
  unjudged R3 '生产模板可渲染（compose config）' '本机 docker / docker-compose 均不可用'
fi

# ── 2. 编排契约（加固 / 探活 / 限额）───────────────────────────────────────────────────────────
say ''
say '--- 2. 编排契约（Sprint 5 `#2`/`#4` 落地项的复核）---'
keys_ok() { # $1=文件 $2...=必须出现的非注释行模式
  local f="$1"; shift
  for pat in "$@"; do nocomment "${f}" | grep -qE "${pat}" || return 1; done
  return 0
}
check R4 '加固与探活键齐备（`read_only` · `tmpfs` · `cap_drop: ALL` · `no-new-privileges` · `mem_limit` · `pids_limit` · `healthcheck` · `restart`）' \
  "$(keys_ok "${PORTAL_COMPOSE}" '^[[:space:]]*read_only:[[:space:]]*true' '^[[:space:]]*tmpfs:' 'cap_drop:' 'no-new-privileges:true' '^[[:space:]]*mem_limit:' '^[[:space:]]*pids_limit:' '^[[:space:]]*healthcheck:' '^[[:space:]]*restart:' && echo 0 || echo 1)" \
  '任一缺失即红（这些键各自都有探针判据把守 `#2`/`#4`）'

# ── 3. 三份验收清单的**待执行项枚举**（AC②「清单列出」）─────────────────────────────────────────
say ''
say '--- 3. 三份验收清单的待执行项（枚举，不手抄）---'
section_items() { # $1=文件 $2=起始锚(ERE) $3=结束锚(ERE)
  awk -v s="$2" -v e="$3" '
    $0 ~ s { on = 1; next }
    on && $0 ~ e { exit }
    on { print }
  ' "$1" | grep -nE '^\|[^|]+\||^[0-9]+\.[[:space:]]|^-[[:space:]]' || true
}
# 枚举并把条目数**回传给调用方指定的变量**（`printf -v`），**不走命令替换** ——
# 否则函数内 `say` 的 stdout 会被调用方捕获，条目数变量会混进整段文本（首版即如此）。
emit_list() { # $1=标题 $2=文件 $3=起始锚(ERE) $4=结束锚(ERE) $5=接收条目数的变量名
  local title="$1" file="$2" body count shown
  body="$(section_items "${file}" "$3" "$4")"
  count="$(printf '%s\n' "${body}" | grep -c . || true)"
  shown="$(printf '%s\n' "${body}" | sed 's/^/    /' | head -40)"
  say "[清单] ${title} —— 条目 ${count} 条（来源 ${file#"${PRODUCT}"/}）"
  printf '%s\n' "${shown}" | tee -a "${REPORT}" >/dev/null
  printf '%s\n' "${shown}"
  printf -v "$5" '%s' "${count}"
}
emit_list 'deployment.md §7.3 端到端冒烟七项（本地/生产）' "${DEPLOYMENT}" '^#+ 7\.3' '^#+ (8|9)[. ]' C73
emit_list 'mcp-design.md §6.2 V1–V4（生产级待办）' "${MCP_DESIGN}" '^#+ 6\.2' '^#+ 7[. ]' C62
# web-test 的 L3 段落**不赌章节编号**（其编号形态与另两份不同，切小节会抓出整篇 100+ 行）⇒
# 按「全文条目化行」计并如实标注口径（语义 = 这份文档有可枚举的验收条目；体例同 `#9` 探针的 `Q2`）。
FILE_ITEMS() { printf '%s\n' "$(grep -cE '^\|[^|]+\||^[0-9]+\.[[:space:]]|^-[[:space:]]' "$1" || true)"; }
CL3="$(FILE_ITEMS "${WEB_TEST}")"
say "[清单] web-test.md 上线验收条目（**全文条目化行口径**，含 L3 的 V1 负向隔离）—— 条目 ${CL3} 条"
check R5 '三份清单均**可枚举出待执行项**（条目数 > 0）' \
  "$([ "${C73}" -ge 1 ] && [ "${C62}" -ge 1 ] && [ "${CL3}" -ge 1 ] && echo 0 || echo 1)" \
  "§7.3=${C73} 条 · §6.2=${C62} 条 · web-test L3=${CL3} 条"

# ── 4. 升级/回滚入口的**可执行性**（引用的命令必须真实存在 —— `#9` 缺口 A）──────────────────────
say ''
say '--- 4. 升级/回滚入口可执行性 ---'
entry_ok() { # $1=相对仓库根的路径
  [ -e "${REPO}/$1" ] && return 0
  [ -e "${PRODUCT}/${1#memory.agent-mate.ai/}" ] && return 0
  return 1
}
E1=0; E2=0; E3=0; E4=0
entry_ok 'memory.agent-mate.ai/scripts/upstream-preflight.sh' && E1=1
entry_ok 'memory.agent-mate.ai/upstream.lock' && E2=1
grep -qE '^preflight:' "${REPO}/Makefile" 2>/dev/null && E3=1
grep -qE '^pin-update:' "${REPO}/Makefile" 2>/dev/null && E4=1
check R6 '升级治理的**真实入口**存在（`make preflight` / `make pin-update` / `scripts/upstream-preflight.sh` / `upstream.lock`）' \
  "$([ "${E1}" -eq 1 ] && [ "${E2}" -eq 1 ] && [ "${E3}" -eq 1 ] && [ "${E4}" -eq 1 ] && echo 0 || echo 1)" \
  "preflight 脚本=${E1} 锁=${E2} make preflight=${E3} make pin-update=${E4}"
# `backup` / `restore-drill` 是**回滚的依赖**，其实现归 `#15`（`memory.agent-mate.ai/backup/`）。
if [ -s "${PRODUCT}/backup/backup-and-push.sh" ] && [ -s "${PRODUCT}/backup/restore-drill.sh" ]; then
  check R7 '回滚依赖的**快照能力**已就绪（`backup/backup-and-push.sh` + `backup/restore-drill.sh`，`#15` 交付物）' 0 '两个脚本在位'
else
  unjudged R7 '回滚依赖的快照能力（`backup/` 两个脚本，归 `#15`）' \
    '脚本尚不存在 ⇒ 回滚步骤在 release-readiness.md 里**引用入口并显式标注「待 #15 就绪」**（不写虚构命令）'
fi

# ── 5. 生产侧（显式登记，不伪装通过）─────────────────────────────────────────────────────────
say ''
say '--- 5. 生产侧 ---'
unjudged R8 '生产侧预演（真起 stack + 真实 Cloudflare Access/隧道 + §12.5.5 第 2 项「启动自检全过」）' \
  '需生产机 ⇒ 归 `#10`（部署执行）；本脚本只判**本机可判**的部分'

say ''
say '--- 结论 ---'
say "通过 ${PASS} 项 · 失败 ${FAIL} 项 · 未判 ${UNJUDGED} 项"
if [ "${WANT_OUT}" = '1' ] && [ -n "${OUT_FILE}" ]; then
  cp "${REPORT}" "${OUT_FILE}" && echo "[i] 报告已存档：${OUT_FILE}"
fi
if [ "${FAIL}" -gt 0 ]; then exit 10; fi
if [ "${UNJUDGED}" -gt 0 ]; then exit 30; fi
exit 0
