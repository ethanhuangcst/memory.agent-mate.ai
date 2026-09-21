#!/usr/bin/env bash
# local-up.sh — 本机常驻启动 ai-memory（serve + curator），使用与生产完全相同的 docker-compose.prod.yml
#
# 与 README「本地部署」节的一次性 docker run 的区别：那是短生命周期探针（跑完即退）；
# 本脚本启动的是【常驻服务】，作为后续隔离 / 门户等方案验证的对照基线。
# 容器名与生产一致（ai-memory-mcp / ai-memory-mcp-curator），MCP 冒烟走
# docker exec -i ai-memory-mcp ai-memory mcp --tier smart —— 与生产 SSH forced command 逐字同构。
#
# 数据卷：ai-memory-mcp_ai_memory_data（compose 项目名 ai-memory-mcp 加前缀）—— 与一次性
# 探针用的 ai_memory_local_data 是【不同卷】，即本地基线从全新库开始，不受历史测试数据干扰。
#
# 用法：bash memory.agent-mate.ai/scripts/local-up.sh
# 幂等：可重复执行（派生 / 建网 / up -d 均幂等；已有容器则原地不动或按定义收敛）
# 退出码：0 成功；10 前置缺失或配置派生失败（docker 未运行 / 缺 .env.local 或
#         config.local.toml / 缺 IMAGE_TAG / 运行时配置仍含顶层 db）；
#         11 compose 启动失败；12 健康等待超时

set -euo pipefail
umask 077

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEPLOY_DIR="$REPO_ROOT/memory.agent-mate.ai/deploy"
NETWORK="portainer_network"
HEALTH_TIMEOUT_SECS=90

log() { printf '[local-up] %s\n' "$*" >&2; }
die() { local code="$1"; shift; log "失败($code)：$*"; exit "$code"; }

# ── 前置检查（key 只做存在性判断，任何输出都不回显内容）──
command -v docker >/dev/null 2>&1 || die 10 "未找到 docker 命令"
docker info >/dev/null 2>&1 || die 10 "docker daemon 未运行"
[ -f "$DEPLOY_DIR/.env.local" ]        || die 10 "缺 $DEPLOY_DIR/.env.local（真实 key，gitignored）"
[ -f "$DEPLOY_DIR/config.local.toml" ] || die 10 "缺 $DEPLOY_DIR/config.local.toml（真实端点，gitignored）"

# ── 1) 派生 compose 固定引用的文件名（.env / config.toml；两者已 gitignored，含真实值）──
# 私有 config.local.toml 可能保留旧版顶层 db；派生时机械剥离，避免漏设 AI_MEMORY_DB
# 静默回落到共享主库。只处理首个 TOML table 之前的顶层键，不触碰 section 内同名键。
ENV_TMP="$(mktemp "$DEPLOY_DIR/.env.XXXXXX")" || die 10 "无法创建 .env 临时文件"
CONFIG_TMP="$(mktemp "$DEPLOY_DIR/.config.toml.XXXXXX")" || die 10 "无法创建运行时配置临时文件"
trap 'rm -f "${ENV_TMP:-}" "${CONFIG_TMP:-}"' EXIT
cp "$DEPLOY_DIR/.env.local" "$ENV_TMP"
chmod 600 "$ENV_TMP"
grep -q '^IMAGE_TAG=' "$ENV_TMP" || die 10 ".env.local 缺 IMAGE_TAG（对照 .env.prod.example 补齐）"
mv "$ENV_TMP" "$DEPLOY_DIR/.env"
ENV_TMP=""
awk '
  /^[[:space:]]*\[/ { in_table = 1 }
  !in_table && /^[[:space:]]*(db|"db"|\047db\047)[[:space:]]*=/ { next }
  { print }
' "$DEPLOY_DIR/config.local.toml" > "$CONFIG_TMP" || die 10 "无法从 config.local.toml 派生运行时配置"
if awk '
  /^[[:space:]]*\[/ { exit }
  /^[[:space:]]*(db|"db"|\047db\047)[[:space:]]*=/ { found = 1 }
  END { exit found ? 0 : 1 }
' "$CONFIG_TMP"; then
  die 10 "派生后的 config.toml 仍含顶层 db（拒绝启动，防止共享库 fallback）"
fi
chmod 600 "$CONFIG_TMP"
mv "$CONFIG_TMP" "$DEPLOY_DIR/config.toml"
CONFIG_TMP=""
log "已派生 config.toml，并确认不存在顶层 db fallback"

# ── 2) compose 把网络声明为 external(portainer_network)；本机不存在则先建 ──
#      不改生产 compose 文件本身，保持与服务器侧零差异
if ! docker network inspect "$NETWORK" >/dev/null 2>&1; then
  docker network create "$NETWORK" >/dev/null
  # 注意：macOS 自带 bash 3.2 下，$NETWORK 紧跟全角字符会被误解析变量名，故用 ${NETWORK}
  log "已创建网络 ${NETWORK}（compose 声明为 external，本机需自备）"
fi

# ── 3) 启动（serve + curator 常驻；镜像仅 amd64，Apple Silicon 显式指定平台走 Rosetta）──
# 探测 compose 实现：优先 docker compose 插件，回退独立 docker-compose（本机为后者）
if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  die 10 "未找到 docker compose 插件，也未找到独立的 docker-compose"
fi
export DOCKER_DEFAULT_PLATFORM="${DOCKER_DEFAULT_PLATFORM:-linux/amd64}"
if ! "${COMPOSE[@]}" -f "$DEPLOY_DIR/docker-compose.prod.yml" up -d; then
  die 11 "docker compose up 失败（见上方输出）"
fi

# ── 4) 等待就绪：镜像内无 curl/wget（README 的 curl 健康探测在本机不可行）， ──
#        改以 serve 日志出现监听行为准（"ai-memory listening on http://127.0.0.1:9077"）
log "等待 serve 监听日志（最长 ${HEALTH_TIMEOUT_SECS}s）..."
deadline=$(( $(date +%s) + HEALTH_TIMEOUT_SECS ))
while :; do
  if docker logs ai-memory-mcp 2>&1 | grep -q 'ai-memory listening on'; then
    break
  fi
  if [ "$(date +%s)" -ge "$deadline" ]; then
    docker ps --filter name=ai-memory-mcp >&2 || true
    docker logs --tail 30 ai-memory-mcp >&2 || true
    die 12 "就绪等待超时：serve 未在 ${HEALTH_TIMEOUT_SECS}s 内输出监听日志（上方为容器状态与日志尾部）"
  fi
  sleep 2
done

docker ps --filter name=ai-memory-mcp --format '{{.Names}} → {{.Status}}' >&2
log "本地基线已常驻（卷 ai-memory-mcp_ai_memory_data，全新库）"
log "停止：${COMPOSE[*]} -f memory.agent-mate.ai/deploy/docker-compose.prod.yml down（保留数据卷）"
