#!/usr/bin/env bash
# session-isolation-probe.sh —— `3.12` 探针（研究类，**不入制品**）：为 Sprint 4 `3.3`
# 「mcp:一会话一子进程」定档**判据形状**。
#
# 回答的可证伪问题（`AC4.5` / `AC4.6` 的判据能不能成立、以及反方向会不会伤到第三方）：
#   A1 两个并发会话 ⇒ 容器内**两个**上游进程（PID 互不相同）？
#   A2 每个进程带着**自己用户的**库路径与身份（判据靠读 `/proc/<pid>/environ`）？谁能读？
#   A3 会话**真写一次**之后，用户目录**之外**出现什么文件（「他人痕迹」判据要不要豁免共享路径）？
#   A4 旁观者用户的库**零变化**（「不出现其他用户的库文件」的基准）？
#   A5 跨用户接管（甲的令牌 + 乙的 sessionId）被拒时**会不会新增进程**？
#   A6 被拒之后，**受害者的会话**还能用吗？
#   A7 受害者若被摘掉，它的子进程会不会变**孤儿**？
#   A8 同用户**重开**会话是否复用旧进程（禁池化）？
#   A9 正常收尾后**未被摘掉**的会话是否归零？
#   A10 门户进程退出 ⇒ 容器内是否归零（β′「父死子死」的天然保证）？
#
# 编排骨架照抄 `scripts/probes/portal-mcp-probe.sh`（真上游 = 容器里的 ai-memory，经
# `PORTAL_LAUNCH_OVERRIDE` 借壳 —— 模板里的二进制是 linux 二进制，macOS 跑不了）。
#
# 用法：
#   bash memory.agent-mate.ai/probes/session-isolation-probe/probe.sh
#   PROBE_PORT=8798 PROBE_CONTAINER=ai-memory-mcp bash ...
#
# 退出码契约（与仓内其它脚本同范式）：
#   0  全部断言通过
#   10 前置不足（容器未运行 / 门户依赖未装 / 端口被占）
#   20 门户起不来
#   30 探针断言失败
#
# 原始输出落 `out/probe-<时间戳>.log`（**不入库**，见 `.gitignore`）。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
REPO="$ROOT/memory.agent-mate.ai"
PORTAL="$REPO/admin_portal"
CONTAINER="${PROBE_CONTAINER:-ai-memory-mcp}"
PORT="${PROBE_PORT:-8798}"
BIN=/usr/local/bin/ai-memory
TMP="$(mktemp -d "${TMPDIR:-/tmp}/sess-iso-probe.XXXXXX")"
OUT="$HERE/out"
PORTAL_PID=""

log() { printf '%s\n' "$*"; }

cleanup() {
  local rc=$?
  #  **退出码必须在**第一行**就抓**：`$?` 会被**下一条命令**覆盖 —— 原来把它放在 `if` 之后，
  #  而 `if` 的条件为假时其自身退出码就是 0 ⇒ `rc` 恒为 0 ⇒ 10 / 20 / 30 全被吞掉（门禁在 CI 里永不红）。
  # 只在**主 shell** 里清理（子 shell 会继承 EXIT trap，提前删临时目录 —— 实测踩过）。
  if [ "${BASH_SUBSHELL:-0}" -ne 0 ]; then return 0; fi
  if [ -n "$PORTAL_PID" ] && kill -0 "$PORTAL_PID" 2>/dev/null; then
    kill "$PORTAL_PID" 2>/dev/null || true
    wait "$PORTAL_PID" 2>/dev/null || true
  fi
  # A10：门户死后容器内是否归零（`docker exec` 的管道断了 ⇒ 容器进程应随之退出）。
  sleep 1
  local after
  after="$(docker exec "$CONTAINER" sh -c \
    'n=0; for f in /proc/[0-9]*/cmdline; do c=$(tr "\0" " " < "$f" 2>/dev/null); case "$c" in "/usr/local/bin/ai-memory mcp --tier smart --profile core"*) n=$((n+1));; esac; done; echo "$n"' 2>/dev/null || echo '未知')"
  log "[A10] 门户退出后容器内同形进程数 = ${after}"
  # 清掉本探针在容器内预建的测试用户目录（不碰其它用户）；借 root 是因为
  # `/data/users` 属主是 root（生产由部署期 setgid 引导建立，见 deployment.md §4.4）。
  for h in p33a p33b; do
    docker exec -u 0 "$CONTAINER" sh -c "rm -rf /data/users/$h" >/dev/null 2>&1 || true
  done
  rm -rf "$TMP"
  exit $rc
}
trap cleanup EXIT INT TERM

mkdir -p "$OUT"
STAMP="$(date +%Y%m%d-%H%M%S)"
LOG="$OUT/probe-$STAMP.log"

# ---------------------------------------------------------------- 1. 前置
log '[1/5] 前置检查'
command -v docker >/dev/null 2>&1 || { log 'ERROR: 未找到 docker'; exit 10; }
docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  log "ERROR: 容器 $CONTAINER 未运行（先执行 bash memory.agent-mate.ai/scripts/local-up.sh —— 注意不是 make local-up，仓根没有该目标）"; exit 10; }
[ -d "$PORTAL/node_modules" ] || {
  log 'ERROR: 门户依赖未安装（(cd memory.agent-mate.ai/admin_portal && npm install) —— 从仓根执行）'; exit 10; }
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  log "ERROR: 端口 $PORT 已被占用（换 PROBE_PORT=）"; exit 10
fi
# 借壳必须显式给 docker endpoint：模板把 `HOME` 固定为 `/data`（生产必需），
# 而 docker CLI 按 `$HOME` 找默认 socket ⇒ 本机（colima）会找不到（实测踩过）。
DOCKER_ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
[ -n "$DOCKER_ENDPOINT" ] || { log 'ERROR: 取不到 docker endpoint'; exit 10; }
log "  docker endpoint: $DOCKER_ENDPOINT"

UPSTREAM_KEY="${DASHSCOPE_API_KEY:-$(docker exec "$CONTAINER" printenv DASHSCOPE_API_KEY 2>/dev/null || true)}"
[ -n "$UPSTREAM_KEY" ] || log '  WARN: 未取到上游 key ⇒ 会话内的 `memory_store` 会失败（A3 依赖它）'

cat > "$TMP/env" <<EOF
PORTAL_ENV=development
PORTAL_ADMIN_HOST=localhost
PORTAL_MCP_HOST=127.0.0.1
PORTAL_PORT=$PORT
PORTAL_DB_PATH=$TMP/portal.db
PORTAL_USERS_ROOT=$TMP/users
PORTAL_LOG_LEVEL=warn
PORTAL_LAUNCH_OVERRIDE="docker -H $DOCKER_ENDPOINT exec -i -e AI_MEMORY_DB -e AI_MEMORY_AGENT_ID -e AI_MEMORY_KEY_DIR -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION -e HOME -e DASHSCOPE_API_KEY $CONTAINER $BIN"
PORTAL_ACCESS_TEAM_DOMAIN=dev-placeholder.cloudflareaccess.com
PORTAL_ACCESS_AUD=dev-placeholder-aud
EOF
[ -n "$UPSTREAM_KEY" ] && printf 'DASHSCOPE_API_KEY="%s"\n' "$UPSTREAM_KEY" >> "$TMP/env"
mkdir -p "$TMP/users"

# --------------------------------------------------- 2. 门户库迁移 + 预建目录
log '[2/5] 迁移门户库'
( cd "$PORTAL" && set -a && . "$TMP/env" && set +a && npx tsx src/web/db/migrate.ts ) >"$TMP/migrate.log" 2>&1 || {
  log 'ERROR: 迁移失败'; tail -5 "$TMP/migrate.log"; exit 10; }

log '[3/5] 容器内预建两个活跃用户的库目录（本机局限：门户在宿主、库在容器）'
for h in p33a p33b; do
  docker exec -u 0 "$CONTAINER" sh -c "mkdir -p /data/users/$h && chown aimem:aimem /data/users/$h" \
    || { log "ERROR: 建目录失败 $h"; exit 10; }
done

# ---------------------------------------------------------------- 4. 起门户
log '[4/5] 启动门户'
( cd "$PORTAL" && set -a && . "$TMP/env" && set +a && exec npx tsx src/server.ts ) >"$TMP/portal.log" 2>&1 &
PORTAL_PID=$!
ready=0
for _ in $(seq 1 60); do
  sleep 1
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null; then ready=1; break; fi
  kill -0 "$PORTAL_PID" 2>/dev/null || break
done
[ "$ready" -eq 1 ] || { log 'ERROR: 门户未能就绪'; tail -12 "$TMP/portal.log"; exit 20; }
log "  portal_listening on 127.0.0.1:$PORT"

# ------------------------------------------------------------ 5. 跑断言
log '[5/5] 断言（明细同步落 out/）'
( cd "$PORTAL" \
  && set -a && . "$TMP/env" && set +a \
  && export PROBE_PORTAL_ROOT="$PORTAL" PROBE_PORTAL_DB="$TMP/portal.db" PROBE_PORTAL_PORT="$PORT" \
            PROBE_CONTAINER="$CONTAINER" PROBE_USERS_ROOT="$TMP/users" \
  && npx tsx tests/fixtures/session-isolation-probe.mts ) >"$LOG" 2>&1
rc=$?
# 回显明细：`-a` 容忍上游日志的原始字节（本机经 Rosetta 跑 x86_64 镜像，字节不保证是 UTF-8）。
LC_ALL=C grep -a -E '^\[|PASS|FAIL|===' "$LOG" || true
log "  明细：$LOG"

if [ "$rc" -eq 0 ]; then
  log '  OK：会话隔离判据与三条硬事实全部成立'
  exit 0
fi
log "  FAIL：探针断言未通过（runner 退出码 ${rc}）"
exit 30
