#!/usr/bin/env bash
# maintain-user-dbs.sh — 每用户库的定期维护入口（Sprint 3 #5 定档）
#
# 为什么需要它：compose 常驻的 `serve` / `curator` **只服务默认库**（/data/ai-memory.db），
# 每用户库（/data/users/<handle>/ai-memory.db）不被它们触达。若无人逐库维护，用户库的
# TTL 过期记忆永不驱逐、WAL 永不回收。
#
# 定档结论（2026-09-21 实测；详见 specs/mcp/mcp-design.md §5.3 与 specs/mcp/mcp-test.md §4-C TC-GC）：
#   - 调度：**宿主机 cron**；本脚本是唯一入口。生产定时器安装 / 日志采集 / 告警留 Sprint 5。
#   - 逐库命令：`ai-memory --db <库绝对路径> gc --json`
#                `ai-memory --db <库绝对路径> curator --once --max-ops N --json`
#   - 覆盖面：`gc` 自身即覆盖 TTL 驱逐与 WAL 回收（CLI 分发器对**写命令**做 post-run
#     `wal_checkpoint(TRUNCATE)`，`gc` 属写命令）；`curator` **不是**写命令，其写入依赖
#     SQLite 干净关闭时的自动 checkpoint。
#   - 失败语义：**单库失败不中断**，打印可定位信息后继续处理其余库，最终以非零码退出
#     （供 cron 告警）。遇错即停会让后面的库永远得不到维护。
#
# 两条硬约束（静态护栏 `attestation-paths-check.sh` + 探针 `gc-probe.sh` 会机械断言）：
#   1. 每条调用显式 `--db <绝对路径>`。源码侧 `--db` 只是 `AI_MEMORY_DB` 的 fallback：
#      不传且 env 缺省时会**静默新建**相对路径 `ai-memory.db`；而容器内该 env 指向**主库**，
#      漏传就可能误操作主库。（同时冗余注入 `-e AI_MEMORY_DB=` 作纵深防御；护栏仍要求 `--db` 在场。）
#   2. 每条调用显式 `AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0`。v0.11 起上游缺省翻转为全 surface
#      required，不写死会让维护任务在升级后立刻失败。
#
# 用法：bash memory.agent-mate.ai/scripts/maintain-user-dbs.sh [--dry-run] [--max-ops N] [--root DIR]
# 退出码：0 全部成功；1 至少一个库失败（逐库详情见日志）；2 参数错误；
#        3 环境不可用（容器未运行 / 无法列举用户库）—— 不得静默成功
set -uo pipefail

CONTAINER="ai-memory-mcp"
DB_ROOT="/data/users"
MAX_OPS=50
DRY_RUN=0

log() { printf '[maintain-user-dbs] %s\n' "$*" >&2; }

usage() {
  cat >&2 <<'EOF'
用法：maintain-user-dbs.sh [选项]

  --dry-run        只列出将被维护的库与将执行的命令，不做任何写入
  --max-ops <N>    curator 每轮 LLM 操作上限（默认 50）
  --root <DIR>     用户库根目录（默认 /data/users；库须形如 <root>/*/ai-memory.db）
  -h, --help       显示本帮助

退出码：0 全部成功；1 至少一个库失败；2 参数错误；3 环境不可用（容器未运行）

注意：本脚本**不会在环境不可用时静默成功**。若容器未运行或无法列举用户库，
一律以非零码退出，避免 cron 把「什么都没维护」当成「维护成功」。
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --max-ops)
      shift
      [ $# -gt 0 ] || { log "缺 --max-ops 的值"; usage; exit 2; }
      case "$1" in ''|*[!0-9]*) log "--max-ops 须为非负整数，得到：$1"; exit 2 ;; esac
      MAX_OPS="$1" ;;
    --root)
      shift
      [ $# -gt 0 ] || { log "缺 --root 的值"; usage; exit 2; }
      DB_ROOT="$1" ;;
    -h|--help) usage; exit 0 ;;
    *) log "未知参数：$1"; usage; exit 2 ;;
  esac
  shift
done

case "$DB_ROOT" in
  /*) ;;
  *) log "--root 必须是绝对路径，得到：${DB_ROOT}"; exit 2 ;;
esac

command -v docker >/dev/null 2>&1 || { log "宿主机缺少 docker"; exit 2; }

# 统一「docker exec 不可用」为显式失败：容器不在时 list_dbs 会返回空集，
# 若不拦就会以「未发现任何用户库」的样子静默成功 —— 那是本项目最忌讳的失败形态。
docker ps --filter "name=${CONTAINER}" --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER" \
  || { log "容器 ${CONTAINER} 未运行 —— 无法维护任何用户库（不以成功退出）"; exit 3; }

# 容器内列举用户库；不用 find（镜像可能不含），用 POSIX glob 并显式排除字面量残留。
# 末尾 `exit 0` 必需：glob 未命中时 `[ -f "$f" ]` 返回 1，在 `set -o pipefail` 下会把
# 「没有用户库」误报成「列举失败」。真正的 docker exec 失败仍会以非零码冒泡上来。
list_dbs() {
  docker exec "$CONTAINER" sh -c '
    for f in "$1"/*/ai-memory.db; do
      [ -f "$f" ] && printf "%s\n" "$f"
    done
    exit 0
  ' sh "$DB_ROOT" 2>/dev/null | LC_ALL=C sort
}

# 主库路径不得出现在维护目标里 —— 它是 serve/curator 的常驻对象，误操作后果最重。
assert_not_master() {
  case "$1" in
    /data/ai-memory.db) return 1 ;;
    *) return 0 ;;
  esac
}

# 执行单步维护。参数：<库路径> <子命令...>；stdout 写 JSON，stderr 单独捕获。
# 返回 0 成功；非 0 为上游退出码。调用方负责记账与日志。
run_step() {
  local db="$1"; shift
  local err out rc
  err="$(mktemp "${TMPDIR:-/tmp}/maintain-user-dbs.XXXXXX")"
  out="$(docker exec \
      -e "AI_MEMORY_DB=${db}" \
      -e "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0" \
      "$CONTAINER" ai-memory --db "$db" "$@" 2>"$err")"
  rc=$?
  STEP_ERR="$(cat "$err" 2>/dev/null || true)"
  rm -f "$err"
  STEP_OUT="$out"
  return "$rc"
}

DBS="$(list_dbs)"
LIST_RC=$?
[ "$LIST_RC" -eq 0 ] || { log "列举用户库失败（rc=${LIST_RC}）—— 不以成功退出"; exit 3; }
[ -n "$DBS" ] || { log "在 ${DB_ROOT} 下未发现任何用户库（<root>/*/ai-memory.db）"; exit 0; }

if [ "$DRY_RUN" -eq 1 ]; then
  printf '%s\n' "$DBS" | while IFS= read -r db; do
    log "dry-run：${db}"
    printf '  docker exec -e AI_MEMORY_DB=%s -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0 %s ai-memory --db %s gc --json\n' "$db" "$CONTAINER" "$db"
    printf '  docker exec -e AI_MEMORY_DB=%s -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0 %s ai-memory --db %s curator --once --max-ops %s --json\n' "$db" "$CONTAINER" "$db" "$MAX_OPS"
  done
  log "dry-run 结束：未执行任何写入"
  exit 0
fi

TOTAL=0
FAILED=0
SUMMARY=""

while IFS= read -r db; do
  [ -n "$db" ] || continue
  TOTAL=$((TOTAL + 1))

  if ! assert_not_master "$db"; then
    FAILED=$((FAILED + 1))
    log "跳过主库（不属于用户库维护范围）：${db}"
    SUMMARY="${SUMMARY}${db}\tSKIPPED(master)\n"
    continue
  fi

  DB_OK=1

  if run_step "$db" gc --json; then
    log "gc OK  ${db}  ${STEP_OUT}"
  else
    DB_OK=0
    log "gc FAILED rc=$? ${db}"
    log "  stderr: $(printf '%s' "$STEP_ERR" | tail -3 | tr '\n' ' ')"
  fi

  if run_step "$db" curator --once --max-ops "$MAX_OPS" --json; then
    log "curator OK  ${db}"
  else
    DB_OK=0
    log "curator FAILED rc=$? ${db}"
    log "  stderr: $(printf '%s' "$STEP_ERR" | tail -3 | tr '\n' ' ')"
  fi

  if [ "$DB_OK" -eq 1 ]; then
    SUMMARY="${SUMMARY}${db}\tOK\n"
  else
    FAILED=$((FAILED + 1))
    SUMMARY="${SUMMARY}${db}\tFAILED\n"
  fi
done <<EOF
$DBS
EOF

log "汇总：处理 ${TOTAL} 个库，失败 ${FAILED} 个"
printf '%b' "$SUMMARY" >&2

if [ "$FAILED" -gt 0 ]; then
  log "存在失败项 —— 以非零码退出，供 cron 告警"
  exit 1
fi

log "全部成功"
exit 0
