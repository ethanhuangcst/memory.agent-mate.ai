#!/usr/bin/env bash
# portal-mcp-probe.sh —— Sprint 4 `3.1`「mcp:会话桥」的**真上游**端到端验收（离线可重复）。
#
# 与 `make portal-e2e` 的分工：
#   - `portal-e2e`：门户的页面级端到端（Playwright，走管理面）；
#   - 本脚本：**接入面**的端到端 —— 真 MCP 客户端经 `/<MCP_HOST>/mcp` 建会话，
#     转发给**真上游**（容器里的 ai-memory），验「工具数 / 写入 / 召回 / 库落点」。
#
# 本机为什么能用真上游：launch 模板的二进制是 linux 二进制，macOS 跑不了 ⇒
# 借 `PORTAL_LAUNCH_OVERRIDE`（仅 development 生效）把命令换成 `docker exec -i <容器> <二进制>`。
# 这正是该键存在的理由（见 `specs/web-portal/web-design.md` §12.9）。
#
# **本机局限（如实登记）**：模板里的库路径固定为 `/data/users/<handle>/ai-memory.db`，
# 该路径在**容器内**解析；而门户跑在宿主 ⇒ 门户建的（宿主）用户目录与上游看到的不是同一个。
# 因此本脚本会在容器内**预建**该用户目录。生产的 β′ 形态（门户在容器内 spawn）没有这个错位，
# 属 Sprint 5 的门户镜像制品。
#
# 用法：
#   bash memory.agent-mate.ai/scripts/probes/portal-mcp-probe.sh
#   PROBE_PORT=8797 PROBE_HANDLE=probe31 PROBE_CONTAINER=ai-memory-mcp bash ...
#
# 退出码契约（与仓内其它脚本同范式）：
#   0  全部断言通过
#   10 前置不足（容器未运行 / 依赖未装 / 配置无效）
#   20 门户起不来
#   30 探针断言失败（工具数 / 写入 / 召回 / 库落点）
#   40 收尾失败

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"  # scripts/probes/ ⇒ 仓根为上溯三级（ADR-021 目录分层后）
REPO="$(cd "$ROOT/memory.agent-mate.ai" && pwd)"
PORTAL="$REPO/admin_portal"
CONTAINER="${PROBE_CONTAINER:-ai-memory-mcp}"
PORT="${PROBE_PORT:-8797}"
HANDLE="${PROBE_HANDLE:-probe31}"
BIN="${PROBE_BIN:-/usr/local/bin/ai-memory}"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/portal-mcp-probe.XXXXXX")"
PORTAL_PID=""

log() { printf '%s\n' "$*"; }

cleanup() {
  local rc=$?
  # 只在**主 shell** 里清理：子 shell 会继承 EXIT trap，若在子 shell 中执行清理，
  # 会在主流程还没跑完时就把临时目录与测试用户目录删掉（实测踩过）。
  #  **退出码必须在**第一行**就抓**：`$?` 会被**下一条命令**覆盖 —— 原来把它放在 `if` 之后，
  #  而 `if` 的条件为假时其自身退出码就是 0 ⇒ `rc` 恒为 0 ⇒ 10 / 20 / 30 全被吞掉（门禁在 CI 里永不红）。
  if [ "${BASH_SUBSHELL:-0}" -ne 0 ]; then
    return 0
  fi
  if [ -n "$PORTAL_PID" ] && kill -0 "$PORTAL_PID" 2>/dev/null; then
    kill "$PORTAL_PID" 2>/dev/null || true
    wait "$PORTAL_PID" 2>/dev/null || true
  fi
  # 清掉本脚本在容器内预建的测试用户目录（不碰其它用户）。
  # 借 root：`/data/users` 属主是 root（β′ 探针 E3 记录过），非 root 删不掉；
  # 生产不依赖 root —— 用户目录由**部署期的 setgid 引导**建立（deployment.md §4.4）。
  docker exec -u 0 "$CONTAINER" sh -c "rm -rf /data/users/$HANDLE" >/dev/null 2>&1 || true
  rm -rf "$TMP"
  exit $rc
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------- 1. 前置
log '[1/6] 前置检查'
command -v docker >/dev/null 2>&1 || { log 'ERROR: 未找到 docker'; exit 10; }
docker inspect "$CONTAINER" >/dev/null 2>&1 || {
  log "ERROR: 容器 $CONTAINER 未运行（先执行 bash memory.agent-mate.ai/scripts/local-up.sh —— 注意不是 make local-up，仓根没有该目标）"; exit 10; }
[ -d "$PORTAL/node_modules" ] || {
  log 'ERROR: 门户依赖未安装（(cd memory.agent-mate.ai/admin_portal && npm install) —— 从仓根执行）'; exit 10; }
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  log "ERROR: 端口 $PORT 已被占用（换 PROBE_PORT=）"; exit 10
fi
# 上游 key：优先用宿主的，否则从容器里取（探针不额外要求宿主配置）。
UPSTREAM_KEY="${DASHSCOPE_API_KEY:-$(docker exec "$CONTAINER" printenv DASHSCOPE_API_KEY 2>/dev/null || true)}"
[ -n "$UPSTREAM_KEY" ] || log '  WARN: 未取到上游 key ⇒ 语义召回会静默降级为 linear scan（本探针仍可跑）'

# 借壳必须显式指定 docker endpoint：launch 模板把 `HOME` 固定为 `/data`（生产必需 ——
# 所有用户共用一份 config.toml），而 docker CLI 是按 `$HOME` 去找默认 socket 的
# ⇒ 不指定就会出现 `dial unix /var/run/docker.sock: no such file or directory`
#（本机 macOS + colima 的 socket 在 ~/.colima/default/docker.sock，实测踩过）。
DOCKER_ENDPOINT="$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)"
[ -n "$DOCKER_ENDPOINT" ] || { log 'ERROR: 取不到 docker endpoint'; exit 10; }
log "  docker endpoint: $DOCKER_ENDPOINT"

# 值一律加引号：这个文件既要被 `dotenv` 风格读取，也要能被 shell `source`
#（不加引号时，含空格的值会被 shell 当命令执行 —— 实测踩过）。
# Access 两项是 `development` 下的**占位值**：启动自检要求「认证姿态已配置」在位，
# 而本探针只走 `/mcp`（令牌认证）与 `/healthz`，不经过 Access 验签。
cat > "$TMP/env" <<EOF
PORTAL_ENV=development
PORTAL_ADMIN_HOST=localhost
PORTAL_MCP_HOST=127.0.0.1
PORTAL_PORT=$PORT
PORTAL_DB_PATH=$TMP/portal.db
PORTAL_USERS_ROOT=$TMP/users
PORTAL_LOG_LEVEL=warn
# 借壳必须**显式转发模板注入的每一项 env**（-e VAR 不带值 = 从宿主环境继承）：
#   docker exec 只把容器自身的 env 给进程，宿主传进来的 AI_MEMORY_DB / AI_MEMORY_AGENT_ID /
#   … 一律丢 **进不了容器**。少了这一步的后果实测过且很严重：
#   memory_store 照样成功，但数据落到**共享主库**、身份退回上游默认值 —— 即隔离静默失效。
#   ⇒ 这条也说明 PORTAL_LAUNCH_OVERRIDE 的语义：**env 透传由覆盖命令自己负责**（见 web-design.md §12.9）。
# 【本 heredoc 内不得出现反引号】分隔符未加引号 ⇒ 正文会做变量与命令替换，正文里的反引号会被
# **当成命令执行**（实测：会报 -e: command not found，并把 docker 的用法信息打到 stderr）。
# 3.4 修掉了这两处历史遗留（原先只表现为 stderr 噪音 + env 文件里被替换掉的注释文字）。
PORTAL_LAUNCH_OVERRIDE="docker -H $DOCKER_ENDPOINT exec -i -e AI_MEMORY_DB -e AI_MEMORY_AGENT_ID -e AI_MEMORY_KEY_DIR -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION -e HOME -e DASHSCOPE_API_KEY $CONTAINER $BIN"
PORTAL_ACCESS_TEAM_DOMAIN=dev-placeholder.cloudflareaccess.com
PORTAL_ACCESS_AUD=dev-placeholder-aud
EOF
[ -n "$UPSTREAM_KEY" ] && printf 'DASHSCOPE_API_KEY="%s"\n' "$UPSTREAM_KEY" >> "$TMP/env"
mkdir -p "$TMP/users"

# --------------------------------------------------- 2. 门户库迁移
log '[2/6] 迁移门户库'
( cd "$PORTAL" && set -a && . "$TMP/env" && set +a && npx tsx src/web/db/migrate.ts ) >"$TMP/migrate.log" 2>&1 || {
  log 'ERROR: 迁移失败'; tail -5 "$TMP/migrate.log"; exit 10; }

# ---------------------------- 3. 容器内预建该用户的库目录（本机局限，见文件头）
log '[3/6] 在容器内预建用户目录'
# 借 root 建目录并把属主交给容器用户 `aimem`（上游以该用户运行、要能写自己的库）。
# 这里的 root 只出现在**本机探针**里：生产路径是「部署期 setgid 引导 + 门户以 aimem 身份建目录」，
# 不依赖 `docker exec -u 0`（见 `deployment.md` §4.4 与 β′ 探针 E3）。
docker exec -u 0 "$CONTAINER" sh -c "mkdir -p /data/users/$HANDLE && chown aimem:aimem /data/users/$HANDLE" \
  || { log 'ERROR: 容器内建目录失败'; exit 10; }

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

# ------------------------------------------------- 5. 跑真上游端到端断言
log '[5/6] 真上游端到端断言'
# 直接重定向，**不用管道**：管道左侧是一个子 shell，它会继承本脚本的 EXIT trap
#（`cleanup` 会在子 shell 退出时提前删掉临时目录与测试用户目录 —— 实测踩过），
# 而且 `PIPESTATUS` 在本机的 bash 3.2 + `set -u` 下不可靠。
( cd "$PORTAL" \
  && set -a && . "$TMP/env" && set +a \
  && export PROBE_PORTAL_ROOT="$PORTAL" PROBE_PORTAL_DB="$TMP/portal.db" PROBE_PORTAL_PORT="$PORT" \
            PROBE_HANDLE="$HANDLE" PROBE_CONTAINER="$CONTAINER" PROBE_USERS_ROOT="$TMP/users" \
  && npx tsx tests/fixtures/probe-runner.mts ) >"$TMP/runner.log" 2>&1
probe_rc=$?
# 回显断言明细（`-a` 容忍上游日志的原始字节：本机经 Rosetta 跑 x86_64 镜像，字节不保证是 UTF-8）。
LC_ALL=C grep -a -E 'PASS|FAIL|已建房户|通过 ' "$TMP/runner.log" || true
cp "$TMP/runner.log" /tmp/portal-mcp-probe-runner.log 2>/dev/null || true

# ---------------------------------------------------------------- 6. 收尾
log '[6/6] 收尾'
if [ "$probe_rc" -eq 0 ]; then
  log '  OK：真上游链路验证通过'
  exit 0
fi
# **必须写成 `${probe_rc}`**：macOS 的 bash 3.2 在「`$var` 紧跟多字节字符（全角括号）」时
# 会把多字节字符的首字节并进变量名 ⇒ 报 `unbound variable`（本脚本实测踩过，
# 而同一个变量在 `[ "$probe_rc" -eq 0 ]` 里却正常，因为后面是 ASCII 引号）。
log "  FAIL：探针断言未通过（runner 退出码 ${probe_rc}）"
cp "$TMP/portal.log" /tmp/portal-mcp-probe-portal.log 2>/dev/null || true
tail -12 "$TMP/portal.log" || true
exit 30
