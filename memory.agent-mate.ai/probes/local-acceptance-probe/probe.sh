#!/usr/bin/env bash
# probe.sh —— Sprint 4 `#8`「deploy:本地完整集成验收」的**难点排除探针**（`3.19`，**研究类，不入制品**）。
#
# 要回答的问题：`#8` 的 L3 判据里那四条**只有离线（假上游）判据**的（面隔离 / 并发上限 / 吊销即时生效 /
# 单响应背压），**能不能在「经门户的真上游」上判**？—— 这是 `#8` 技术设计的输入。
# 编排骨架由 `3.3` 的 `portal-mcp-session-probe.sh` 派生（本验证过：借壳、迁移、预建用户目录、收尾一致）；
# 与它的差别只有：端口 / 用户名 / 断言体路径 / **两条护栏 env**（背压 32 KiB、每 key 并发 1）。
#
# 与 `portal-mcp-probe.sh`（`3.1` 的单会话真链路）的分工：本脚本验的是 `AC4.5` / `AC4.6`
# 那两条**指向容器内**的判据 ——
#   ① 两个并发会话 ⇒ 容器内**两个**上游进程（PID 互不相同）且各带自己用户的库与身份；
#   ② 会话真写一次后，用户目录**之外零新增**（唯一豁免上游**共享**审计日志），旁观者用户库零变化；
#   ③ 同用户重开会话不复用旧进程（禁池化）；跨用户接管被拒且**不伤及**受害者。
# 判据形状由 `3.12` 探针（`probes/session-isolation-probe/`）实测钉死，本脚本把它固化成**产品侧入口**。
#
# 本机为什么能用真上游：launch 模板的二进制是 linux 二进制，macOS 跑不了 ⇒
# 借 `PORTAL_LAUNCH_OVERRIDE`（仅 development 生效）把命令换成 `docker exec -i <容器> <二进制>`。
#
# **本机局限（如实登记）**：模板里的库路径在**容器内**解析，而门户跑在宿主 ⇒ 脚本会在容器内
# **预建**两个测试用户目录；生产的 β′ 形态（门户在容器内 spawn）没有这个错位。
#
# 用法：
#   bash memory.agent-mate.ai/scripts/portal-mcp-session-probe.sh
#   PROBE_PORT=8899 PROBE_CONTAINER=ai-memory-mcp bash ...
#
# 退出码契约（与仓内其它脚本同范式）：
#   0  全部断言通过
#   10 前置不足（容器未运行 / 依赖未装 / 端口被占 / 取不到 docker endpoint / 无上游 key）
#   20 门户起不来
#   30 断言失败
#
# 与 `portal-mcp-probe.sh` 的一处**刻意差异**：上游 key 缺失在这里是**前置不足**（`10`）而非
# WARN —— 本脚本的「无他人痕迹」判据要求会话**真写一次**，没有 key 就没有真写入，判据会退化成
# 空转（详见 `specs/mcp/mcp-test.md` §4-G）。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
REPO="$(cd "$ROOT/memory.agent-mate.ai" && pwd)"
PORTAL="$REPO/admin_portal"
CONTAINER="${PROBE_CONTAINER:-ai-memory-mcp}"
PORT="${PROBE_PORT:-8802}"
HANDLE_A="${PROBE_HANDLE_A:-probe319a}"
HANDLE_B="${PROBE_HANDLE_B:-probe319b}"
BIN="${PROBE_BIN:-/usr/local/bin/ai-memory}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/portal-mcp-session-probe.XXXXXX")"
PORTAL_PID=""

log() { printf '%s\n' "$*"; }

cleanup() {
  local rc=$?
  #  **退出码必须在**第一行**就抓**：`$?` 会被**下一条命令**覆盖 —— 原来把它放在 `if` 之后，
  #  而 `if` 的条件为假时其自身退出码就是 0 ⇒ `rc` 恒为 0 ⇒ 10 / 20 / 30 全被吞掉（门禁在 CI 里永不红）。
  # 只在**主 shell** 里清理：子 shell 会继承 EXIT trap，若在子 shell 里执行清理，会在主流程还没
  # 跑完时就把临时目录与测试用户目录删掉（实测踩过）。**子 shell 保护用 `if`**（别写成 `[ ... ] && return`）
  # （上面 `if` 里那条 `return 0` 是**子 shell** 保护；退出码见更上面那两行。）
  if [ "${BASH_SUBSHELL:-0}" -ne 0 ]; then
    return 0
  fi
  if [ -n "$PORTAL_PID" ] && kill -0 "$PORTAL_PID" 2>/dev/null; then
    kill "$PORTAL_PID" 2>/dev/null || true
    wait "$PORTAL_PID" 2>/dev/null || true
  fi
  # 收尾复验：门户退出后容器内同形进程应归零（β′「父死子死」的天然保证）。
  sleep 1
  local left
  left="$(docker exec "$CONTAINER" sh -c \
    'n=0; for f in /proc/[0-9]*/cmdline; do c=$(tr "\0" " " < "$f" 2>/dev/null); case "$c" in "/usr/local/bin/ai-memory mcp --tier smart --profile core"*) n=$((n+1));; esac; done; echo "$n"' 2>/dev/null || echo '未知')"
  log "  [收尾] 门户退出后容器内同形进程数 = ${left}（期望 0）"
  # 清掉本脚本在容器内预建的测试用户目录（**按名清单**，不碰其它用户）。
  # 借 root：`/data/users` 属主是 root；生产由部署期 setgid 引导建立（deployment.md §4.4）。
  for h in "$HANDLE_A" "$HANDLE_B"; do
    docker exec -u 0 "$CONTAINER" sh -c "rm -rf /data/users/$h" >/dev/null 2>&1 || true
  done
  rm -rf "$TMP"
  exit $rc
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- 1. 前置
log '[1/6] 前置检查'
command -v docker >/dev/null 2>&1 || { log 'ERROR: 未找到 docker'; exit 10; }
docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  log "ERROR: 容器 $CONTAINER 未运行（先执行 bash memory.agent-mate.ai/scripts/local-up.sh）"; exit 10; }
[ -d "$PORTAL/node_modules" ] || {
  log 'ERROR: 门户依赖未安装（(cd memory.agent-mate.ai/admin_portal && npm install)）'; exit 10; }
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  log "ERROR: 端口 $PORT 已被占用（换 PROBE_PORT=）"; exit 10
fi
DOCKER_ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
[ -n "$DOCKER_ENDPOINT" ] || { log 'ERROR: 取不到 docker endpoint'; exit 10; }
log "  docker endpoint: $DOCKER_ENDPOINT"

# 上游 key 是本脚本的**硬前置**（判据要求会话真写一次，见文件头）。
UPSTREAM_KEY="${DASHSCOPE_API_KEY:-$(docker exec "$CONTAINER" printenv DASHSCOPE_API_KEY 2>/dev/null || true)}"
[ -n "$UPSTREAM_KEY" ] || {
  log 'ERROR: 取不到上游 key（宿主 DASHSCOPE_API_KEY 与容器内都没有）⇒ 「无他人痕迹」判据会退化成空转'; exit 10; }

cat > "$TMP/env" <<EOF
PORTAL_ENV=development
PORTAL_ADMIN_HOST=localhost
PORTAL_MCP_HOST=127.0.0.1
PORTAL_PORT=$PORT
PORTAL_DB_PATH=$TMP/portal.db
PORTAL_USERS_ROOT=$TMP/users
PORTAL_LOG_LEVEL=warn
# `3.19`：本探针要测的**两条护栏**都要**可触发**才测得出来 —— 背压上限取 32 KiB（大于
# `tools/list` 等建立期响应、小于 48 KiB 的 `memory_get`），并发按**每 key 1**（同一令牌第二路必拒）。
PORTAL_RESPONSE_MAX_BYTES=32768
PORTAL_MAX_CONCURRENCY_PER_KEY=1
# 【本 heredoc 内不得出现反引号】分隔符未加引号 ⇒ 正文会做变量与命令替换，正文里的反引号会被
# **当成命令执行**（实测：把 -e VAR 用反引号括起来，会报 -e: command not found，并把 docker 的
# 用法信息打到 stderr）。写脚本时注意 —— 这不是注释自由区。
# 借壳必须**显式转发模板注入的每一项 env**（-e VAR 不带值 = 从宿主环境继承）：
# docker exec 只把容器自身的 env 给进程，宿主传进来的 AI_MEMORY_DB / AI_MEMORY_AGENT_ID
# 等一律丢在容器外 —— 少了这一步，写入会落到**共享主库**、身份退回默认值（隔离静默失效，实测过）。
PORTAL_LAUNCH_OVERRIDE="docker -H $DOCKER_ENDPOINT exec -i -e AI_MEMORY_DB -e AI_MEMORY_AGENT_ID -e AI_MEMORY_KEY_DIR -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION -e HOME -e DASHSCOPE_API_KEY $CONTAINER $BIN"
PORTAL_ACCESS_TEAM_DOMAIN=dev-placeholder.cloudflareaccess.com
PORTAL_ACCESS_AUD=dev-placeholder-aud
EOF
printf 'DASHSCOPE_API_KEY="%s"\n' "$UPSTREAM_KEY" >> "$TMP/env"
mkdir -p "$TMP/users"

# --------------------------------------------------- 2. 门户库迁移
log '[2/6] 迁移门户库'
( cd "$PORTAL" && set -a && . "$TMP/env" && set +a && npx tsx src/web/db/migrate.ts ) >"$TMP/migrate.log" 2>&1 || {
  log 'ERROR: 迁移失败'; tail -5 "$TMP/migrate.log"; exit 10; }

# ---------------------------- 3. 容器内预建两个测试用户的库目录（本机局限，见文件头）
log '[3/6] 在容器内预建两个测试用户目录'
for h in "$HANDLE_A" "$HANDLE_B"; do
  docker exec -u 0 "$CONTAINER" sh -c "mkdir -p /data/users/$h && chown aimem:aimem /data/users/$h" \
    || { log "ERROR: 容器内建目录失败（$h）"; exit 10; }
done

# ---------------------------------------------------------------- 4. 起门户
log '[4/6] 启动门户'
( cd "$PORTAL" && set -a && . "$TMP/env" && set +a && exec npx tsx src/server.ts ) >"$TMP/portal.log" 2>&1 &
PORTAL_PID=$!
ready=0
for _ in $(seq 1 60); do
  sleep 1
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/healthz" 2>/dev/null; then ready=1; break; fi
  kill -0 "$PORTAL_PID" 2>/dev/null || break
done
if [ "$ready" -ne 1 ]; then
  log 'ERROR: 门户未能就绪'; tail -12 "$TMP/portal.log"; exit 20
fi
log "  portal_listening on 127.0.0.1:$PORT"

# --------------------------------------------- 5. 跑真上游会话隔离断言
log '[5/6] 真上游会话隔离断言'
# 直接重定向、**不用管道**：管道左侧是子 shell，会继承本脚本的 EXIT trap（提前清理，实测踩过）。
( cd "$PORTAL" \
  && set -a && . "$TMP/env" && set +a \
  && export PROBE_PORTAL_ROOT="$PORTAL" PROBE_PORTAL_DB="$TMP/portal.db" PROBE_PORTAL_PORT="$PORT" \
            PROBE_CONTAINER="$CONTAINER" PROBE_USERS_ROOT="$TMP/users" \
            PROBE_HANDLE_A="$HANDLE_A" PROBE_HANDLE_B="$HANDLE_B" \
  && npx tsx tests/fixtures/local-acceptance-probe.mts ) >"$TMP/runner.log" 2>&1
probe_rc=$?
# 回显断言明细（`-a` 容忍上游日志的原始字节：本机经 Rosetta 跑 x86_64 镜像，字节不保证是 UTF-8）。
LC_ALL=C grep -a -E 'PASS|FAIL|\[i\]|通过 ' "$TMP/runner.log" || true

# ---------------------------------------------------------------- 6. 收尾
log '[6/6] 收尾'
if [ "$probe_rc" -eq 0 ]; then
  log '  OK：本地验收判据（面隔离按 Host / 并发上限 429 / 吊销即时生效 / 大响应背压）全部成立'
  exit 0
fi
# **必须写成 `${probe_rc}`**：macOS bash 3.2 在「`$var` 紧跟多字节字符」时会把多字节首字节并进
# 变量名 ⇒ 报 unbound variable（实测踩过）。
log "  FAIL：断言未通过（runner 退出码 ${probe_rc}）"
cp "$TMP/runner.log" /tmp/portal-mcp-session-probe-runner.log 2>/dev/null || true
cp "$TMP/portal.log" /tmp/portal-mcp-session-probe-portal.log 2>/dev/null || true
tail -12 "$TMP/runner.log" || true
exit 30
