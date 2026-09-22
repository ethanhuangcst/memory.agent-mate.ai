#!/usr/bin/env bash
# attestation-paths-check.sh — agent attestation 口径的**静态一致性**护栏（Sprint 3 #1 防复发）
#
# 背景：attestation 的 env 分散在四处模板（compose 两服务 / SSH forced command / 门户 launch 模板），
#       此前靠人工核对，改一处漏一处不会报错。本脚本把「四处口径一致」变成可复跑的断言。
#
# 检查项：
#   A. compose 的 `ai-memory` 与 `curator` 两服务均显式 `"0"`（恰好 2 处）
#   B. `deployment.md` 用户行与 `mcp-design.md` §5.2 模板的 `-e` 子句**逐字一致**，且含该 env
#   C. 门户 launch 模板含该 env —— 模板真源 2026-09-22 起迁至 `mcp-design.md` §5.6.4
#      （Sprint 4 #1 文档边界修正：跨进程/上游契约归 MCP 侧，门户侧只留业务功能）
#   D. 全仓**现行**文档不再残留已证伪口径（历史 `change-log.md` 与已标注真源除外）
#   E. 每库维护命令（`maintain-user-dbs.sh`，Sprint 3 #5 新增的第五条承载路径）沿用**同一**
#      attestation 取值，且每条 `ai-memory` 调用都显式 `--db`（否则漏传时会静默回落相对路径库）
#
# 只读、无 Docker、无网络。口径真源：specs/mcp/mcp-design.md §9 B3 + specs/knowledge/upstream-ai-memory/。
# 用法：bash memory.agent-mate.ai/scripts/attestation-paths-check.sh [--self-test]
# 退出码：0 全通过；10 模板缺失或路径口径不一致；20 发现已证伪口径残留

set -euo pipefail

SELF_TEST=0
case "${1:-}" in
  "") ;;
  --self-test) SELF_TEST=1 ;;
  *) printf '[attest-paths] 未知参数：%s\n' "$1" >&2; exit 10 ;;
esac

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SPECS="$REPO_ROOT/memory.agent-mate.ai/specs"
COMPOSE="$REPO_ROOT/memory.agent-mate.ai/deploy/docker-compose.prod.yml"
DEPLOYMENT="$SPECS/deployment.md"
DESIGN="$SPECS/mcp/mcp-design.md"
PORTAL="$SPECS/web-portal/web-design.md"
MAINTAIN="$REPO_ROOT/memory.agent-mate.ai/scripts/maintain-user-dbs.sh"

log() { printf '[attest-paths] %s\n' "$*" >&2; }
die() { local code="$1"; shift; log "失败($code)：$*"; exit "$code"; }

for f in "$COMPOSE" "$DEPLOYMENT" "$DESIGN" "$PORTAL"; do
  [ -f "$f" ] || die 10 "缺文件：${f#"$REPO_ROOT"/}"
done

# ── E 的判定器（独立成函数，便于 --self-test 用 fixture 验证不是「恒绿」）──
# $1=待检脚本 $2=必须出现的 attestation token（取自 B 的规范 -e 子句，保证同源）
maintenance_path_ok() {
  python3 - "$1" "$2" <<'PY'
import re, sys
path, token = sys.argv[1], sys.argv[2]
try:
    text = open(path, encoding="utf-8").read()
except OSError as exc:
    raise SystemExit("unreadable: %s" % exc)
code = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith("#")]
invocations = [l for l in code if re.search(r"(^|[\s\"'])ai-memory(\s|$)", l)]
if not invocations:
    raise SystemExit("no ai-memory invocation found")
missing = [l for l in invocations if " --db " not in l]
if missing:
    raise SystemExit("invocation without explicit --db: %r" % missing[0])
if token not in "\n".join(code):
    raise SystemExit("missing attestation token: %s" % token)
PY
}

if [ "$SELF_TEST" -eq 1 ]; then
  TMPD="$(mktemp -d)"
  trap 'rm -rf "$TMPD"' EXIT
  TOKEN='AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0'
  printf '%s\n' \
    'bad() {' \
    '  docker exec -e "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0" c ai-memory gc --json' \
    '}' > "$TMPD/no-db.sh"
  printf '%s\n' \
    'bad() {' \
    '  docker exec c ai-memory --db "$db" gc --json' \
    '}' > "$TMPD/no-attest.sh"
  printf '%s\n' \
    'good() {' \
    '  docker exec -e "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0" c ai-memory --db "$db" gc --json' \
    '}' > "$TMPD/ok.sh"

  maintenance_path_ok "$TMPD/ok.sh" "$TOKEN" || die 10 "判定器正向 fixture 失败"
  set +e
  maintenance_path_ok "$TMPD/no-db.sh" "$TOKEN" >/dev/null 2>&1; rc=$?
  set -e
  [ "$rc" -ne 0 ] || die 10 "判定器未对「调用缺 --db」 fail-closed"
  set +e
  maintenance_path_ok "$TMPD/no-attest.sh" "$TOKEN" >/dev/null 2>&1; rc=$?
  set -e
  [ "$rc" -ne 0 ] || die 10 "判定器未对「缺 attestation」 fail-closed"
  log "自测通过：E 判定器对缺 --db / 缺 attestation 均 fail-closed"
  exit 0
fi

# ── A. compose 两服务都必须显式 "0" ──
COMPOSE_HITS="$(grep -cE '^[[:space:]]*AI_MEMORY_REQUIRE_AGENT_ATTESTATION:[[:space:]]*"0"[[:space:]]*$' "$COMPOSE" || true)"
[ "$COMPOSE_HITS" = "2" ] \
  || die 10 "compose 中该 env 的 \"0\" 声明数为 ${COMPOSE_HITS}，预期 2（ai-memory / curator）"
log "A 通过：compose 两服务均显式 attestation=0"

# ── B. deployment.md 用户行 与 mcp-design §5.2 模板 的 -e 子句逐字一致 ──
env_clause() { # $1=文件；取含 alice 库路径那一行的 `-e …` 子句
  grep -F 'AI_MEMORY_DB=/data/users/alice/ai-memory.db' "$1" | head -1 \
    | sed -n 's/.*\(-e AI_MEMORY_DB=[^"]*\) ai-memory-mcp.*/\1/p'
}
# 注：`|| true` 必需 —— 管道在 `set -o pipefail` 下若无命中会返回 1，
# 直接触发 errexit 并以未文档化的退出码 1 早退，绕过下面的 die 10 诊断。
D_CLAUSE="$(env_clause "$DEPLOYMENT" || true)"
M_CLAUSE="$(env_clause "$DESIGN" || true)"
[ -n "$D_CLAUSE" ] || die 10 "deployment.md 中找不到用户行模板（含 alice 库路径且后接 ai-memory-mcp）"
[ -n "$M_CLAUSE" ] || die 10 "mcp-design.md 中找不到 §5.2 用户行模板（同上）"
[ "$D_CLAUSE" = "$M_CLAUSE" ] \
  || die 10 "用户行模板不一致：deployment.md=「${D_CLAUSE}」 vs mcp-design.md=「${M_CLAUSE}」"
case "$D_CLAUSE" in
  *AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0*) ;;
  *) die 10 "用户行模板缺 AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0（逐字一致的模板也须含该项）" ;;
esac
log "B 通过：两处用户行模板的 -e 子句逐字一致且含 attestation"

# ── C. 门户 launch 模板必须含该 env ──
grep -qE '^[[:space:]]*AI_MEMORY_REQUIRE_AGENT_ATTESTATION:[[:space:]]*"0"[[:space:]]*$' "$DESIGN" \
  || die 10 "门户 launch 模板（mcp-design.md §5.6.4）缺 AI_MEMORY_REQUIRE_AGENT_ATTESTATION: \"0\""
log "C 通过：门户 launch 模板含 attestation"

# ── E. 每库维护命令（第五条路径）沿用同一 attestation 取值，且每条调用显式 --db ──
[ -f "$MAINTAIN" ] || die 10 "缺每库维护脚本：scripts/maintain-user-dbs.sh（Sprint 3 #5）"
ATTEST_TOKEN="$(printf '%s' "$D_CLAUSE" | grep -oE 'AI_MEMORY_REQUIRE_AGENT_ATTESTATION=[0-9A-Za-z]+' | head -1 || true)"
[ -n "$ATTEST_TOKEN" ] \
  || die 10 "无法从 deployment.md 用户行模板提取 attestation 取值，E 无法与 B 同源"
maintenance_path_ok "$MAINTAIN" "$ATTEST_TOKEN" \
  || die 10 "每库维护命令未沿用既有口径：须含「${ATTEST_TOKEN}」且每条 ai-memory 调用显式 --db"
log "E 通过：每库维护命令带 ${ATTEST_TOKEN} 且每条调用显式 --db"

# ── D. 已证伪口径不得回流到现行文档 ──
# 真源（mcp-design §9 B3 / knowledge/upstream-ai-memory）与历史 change-log 依设计提及这些措辞，故排除。
# 注意：被扫文件**不得逐字复述**这些模式（含「本脚本禁用了 xxx」式的引述）——否则扫描器会扫中自身。
# 需说明禁用内容时，改为指向本数组名（见 mcp-test.md §4-D TC-ATT-02）。
STALE_PATTERNS=(
  '否则写入会 403'
  '否则无签名写入 403'
  '默认开启会 403'
  '不设即 403'
  '标记为 `claimed`'
)
SCAN=(
  "$SPECS/architecture.md"
  "$SPECS/product-backlog.md"
  "$SPECS/sprint-backlog.md"
  "$DEPLOYMENT"
  "$DESIGN"
  "$SPECS/mcp/mcp-test.md"
  "$SPECS/mcp/mcp-capabilities.md"
  "$PORTAL"
  "$SPECS/web-portal/web-test.md"
  "$SPECS/web-portal/web-stories.md"
  "$SPECS/knowledge/local-dev/ai-memory-local-run-gotchas.md"
  "$COMPOSE"
)
for pat in "${STALE_PATTERNS[@]}"; do
  for f in "${SCAN[@]}" "$SPECS"/adr/*.md; do
    [ -f "$f" ] || continue
    if grep -qF -- "$pat" "$f"; then
      die 20 "已证伪口径「${pat}」残留在 ${f#"$REPO_ROOT"/}（真源见 mcp-design.md §9 B3）"
    fi
  done
done
log "D 通过：现行文档无已证伪口径残留"

log "全部通过：五路径 attestation 口径一致，无失准表述回流"
