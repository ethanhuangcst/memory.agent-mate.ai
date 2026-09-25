#!/usr/bin/env bash
# gc-probe.sh — 每用户库维护覆盖面探针（L1.8 / Sprint 3 #5）
#
# 为什么需要它：compose 常驻的 serve / curator **只服务默认库**，每用户库需逐库维护。
# 本探针把「配置写对了」与「行为真的生效」分开证明，并把结论钉在**可观测产物**上，
# 不用日志措辞做断言（上一轮配额探针曾因日志 target 被默认过滤器吞掉而假失败）。
#
# 断言的五类覆盖面（均为独立一次性库，绝不触碰共享主库）：
#   1. TTL 驱逐（gc 路径）—— gc 删除 expires_at < now 的行；过期但未 gc 的行**按 id 仍可读出**
#      （`cmd_get` 不过滤 expires_at 也不触发清扫）；gc 后按 id 取不到；archive_on_gc
#      默认 true ⇒ 行进 archived_memories（archive_reason=ttl_expired）而非硬删。
#   2. TTL 驱逐（读路径惰性清扫）—— `db::gc_if_needed`（src/storage/mod.rs:10502）被
#      store / list / recall / import 与 MCP `memory_recall` fire-and-forget 调用，
#      其中 `cmd_list`（src/cli/crud.rs:99）会在返回列表前清扫过期行 ⇒ 随后 gc 报 0。
#      **结论：gc 计数不等于过期总量，维护作业不能靠业务查询代劳。**
#   3. WAL 回收 —— gc 属 CLI **写命令**，分发器 post-run `wal_checkpoint(TRUNCATE)` 覆盖它。
#      实测方式：长活 MCP 会话持有库使 -wal 增长，并行跑 gc 后断言 -wal 归零。
#   4. curator --once —— rc=0、报告可解析、memories_scanned>=1（证明读的是目标库）、
#      errors 不含 "no LLM client configured"（该静默失败点会让打标数恒为 0）。
#   5. 失败语义 —— 单库失败不中断：其余库仍被维护，最终非零退出（供 cron 告警）。
# 另有静态段：机械断言维护脚本每条调用都带显式 --db 与 attestation=0（跨条目挂账闭环）。
#
# 用法：bash memory.agent-mate.ai/scripts/probes/gc-probe.sh [--self-test]
# 退出码：0 全通过；10 前置；20 静态审计；30 TTL 驱逐；40 WAL 回收；50 curator；
#        60 失败语义；70 多库实跑 + 主库不变
set -euo pipefail

CONTAINER="ai-memory-mcp"
STAMP="$(date +%s)-$$"
BASE_DIR="/data/users/gc-probe-${STAMP}"
DB_A="${BASE_DIR}/a/ai-memory.db"
DB_B="${BASE_DIR}/b/ai-memory.db"
DB_WAL="${BASE_DIR}/wal/ai-memory.db"
DB_SWEEP="${BASE_DIR}/sweep/ai-memory.db"
FAIL_ROOT="${BASE_DIR}-fail"
MASTER_DB="/data/ai-memory.db"
WORK="$(mktemp -d)"
SELF_TEST=0
WAL_PID=""

log() { printf '[gc-probe] %s\n' "$*" >&2; }
ok() { printf '[gc-probe][OK] %s\n' "$*" >&2; }
die() { local code="$1"; shift; log "失败(${code})：$*"; exit "$code"; }

cleanup() {
  if [ -n "$WAL_PID" ]; then kill "$WAL_PID" 2>/dev/null || true; fi
  rm -rf "$WORK"
  if docker ps --filter "name=${CONTAINER}" --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    # 按唯一时间戳前缀通配，连带清掉上游 deferred-audit 旁路日志；根目录空了也一并移除。
    docker exec -u 0 "$CONTAINER" sh -c "rm -rf '${BASE_DIR}' '${FAIL_ROOT}' '${BASE_DIR}-empty'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

case "${1:-}" in
  "") ;;
  --self-test) SELF_TEST=1 ;;
  *) die 10 "未知参数：${1}" ;;
esac

# ── 判定器（供 --self-test 与正式断言共用）─────────────────────────────────────
# gc JSON：要求可解析且 expired_deleted 等于期望值。
assert_gc_json() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, expected, code = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
try:
    obj = json.load(open(path))
    actual = obj["expired_deleted"]
except Exception as exc:
    print("gc JSON unreadable: %s" % exc)
    sys.exit(code)
if not isinstance(actual, int) or actual != expected:
    print("expired_deleted=%r, expected %d" % (actual, expected))
    sys.exit(code)
print("expired_deleted=%d" % actual)
PY
}

# curator JSON：要求可解析、errors 无 LLM 静默失败、memories_scanned >= 1。
assert_curator_json() {
  python3 - "$1" "$2" "$3" <<'PY'
import json, sys
path, min_scanned, code = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
try:
    obj = json.load(open(path))
    errors = obj["errors"]
    scanned = obj["memories_scanned"]
except Exception as exc:
    print("curator JSON unreadable: %s" % exc)
    sys.exit(code)
if not isinstance(errors, list):
    print("errors is not a list: %r" % errors)
    sys.exit(code)
for err in errors:
    if "no LLM client configured" in str(err):
        print("curator 未拿到 LLM（静默失败点：打标数会恒为 0）：%s" % err)
        sys.exit(code)
if isinstance(scanned, int) and scanned < min_scanned:
    print("memories_scanned=%d, expected >= %d（未读目标库？）" % (scanned, min_scanned))
    sys.exit(code)
print("memories_scanned=%d errors=%d" % (scanned, len(errors)))
PY
}

# -wal 归零断言。
assert_zero_size() {
  local actual="$1" code="$2"
  if [ "$actual" -ne 0 ]; then
    printf 'wal size=%s, expected 0\n' "$actual" >&2
    return "$code"
  fi
  return 0
}

if [ "$SELF_TEST" -eq 1 ]; then
  printf '%s' '{"expired_deleted":1}' > "$WORK/gc-ok.json"
  printf '%s' '{}' > "$WORK/gc-bad.json"
  assert_gc_json "$WORK/gc-ok.json" 1 30 >/dev/null || die 10 "gc 判定器正向 fixture 失败"
  set +e; assert_gc_json "$WORK/gc-bad.json" 1 30 >/dev/null 2>&1; rc=$?; set -e
  [ "$rc" -eq 30 ] || die 10 "gc 判定器未对缺字段 fixture fail-closed（rc=${rc}）"

  printf '%s' '{"memories_scanned":3,"errors":[]}' > "$WORK/cur-ok.json"
  printf '%s' '{"memories_scanned":3,"errors":["no LLM client configured"]}' > "$WORK/cur-llm.json"
  printf '%s' '{}' > "$WORK/cur-bad.json"
  assert_curator_json "$WORK/cur-ok.json" 1 50 >/dev/null || die 10 "curator 判定器正向 fixture 失败"
  set +e
  assert_curator_json "$WORK/cur-llm.json" 1 50 >/dev/null 2>&1; rc=$?
  set -e
  [ "$rc" -eq 50 ] || die 10 "curator 判定器未拦截 LLM 静默失败（rc=${rc}）"
  set +e; assert_curator_json "$WORK/cur-bad.json" 1 50 >/dev/null 2>&1; rc=$?; set -e
  [ "$rc" -eq 50 ] || die 10 "curator 判定器未对缺字段 fixture fail-closed（rc=${rc}）"

  assert_zero_size 0 40 || die 10 "-wal 判定器正向 fixture 失败"
  set +e; assert_zero_size 1024 40 >/dev/null 2>&1; rc=$?; set -e
  [ "$rc" -eq 40 ] || die 10 "-wal 判定器未对非零 size fail-closed（rc=${rc}）"

  ok "判定器自测通过：三项断言均 fail-closed"
  exit 0
fi

docker ps --filter "name=${CONTAINER}" --format '{{.Names}}' | grep -qx "$CONTAINER" \
  || die 10 "容器 ${CONTAINER} 未运行（先执行 local-up.sh）"
command -v python3 >/dev/null 2>&1 || die 10 "宿主机缺少 python3"

MAINT="$(cd "$(dirname "$0")/.." && pwd)/maintain-user-dbs.sh"  # scripts/probes/ ⇒ 仓根为上溯三级（ADR-021 目录分层后）
[ -f "$MAINT" ] || die 20 "找不到 maintain-user-dbs.sh"

# ── 20. 静态审计：维护脚本每条调用显式 --db 且固定 attestation=0 ──────────────
python3 - "$MAINT" <<'PY' || die 20 "维护脚本静态审计未通过"
import re, sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read()
code_lines = [l for l in text.splitlines() if l.strip() and not l.lstrip().startswith("#")]
invocations = [l for l in code_lines if re.search(r"(^|[\s\"'])ai-memory(\s|$)", l)]
if not invocations:
    raise SystemExit("维护脚本中找不到任何 ai-memory 调用")
missing_db = [l for l in invocations if " --db " not in l]
if missing_db:
    raise SystemExit("调用未显式传 --db：%r" % missing_db[0])
if not any(re.search(r"\bgc\b", l) for l in invocations):
    raise SystemExit("维护脚本缺少 gc 调用")
curator_lines = [l for l in invocations if "curator" in l]
if not curator_lines:
    raise SystemExit("维护脚本缺少 curator 调用")
if not all("--once" in l and "--max-ops" in l for l in curator_lines):
    raise SystemExit("curator 调用必须同时带 --once 与 --max-ops（限幅 LLM）")
if "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0" not in "\n".join(code_lines):
    raise SystemExit("维护脚本未显式固定 AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0")
if "--db ai-memory.db" in text:
    raise SystemExit("维护脚本出现相对路径缺省库 `--db ai-memory.db`")
print("invocations=%d" % len(invocations))
PY
ok "静态审计：维护脚本每条调用显式 --db、curator 带 --once/--max-ops、attestation=0 已固定"

# ── 准备一次性库目录 ─────────────────────────────────────────────────────────
docker exec -u 0 "$CONTAINER" sh -c "mkdir -p '${BASE_DIR}/a' '${BASE_DIR}/b' '${BASE_DIR}/wal' '${BASE_DIR}/sweep' '${FAIL_ROOT}/good' '${FAIL_ROOT}/bad' '${BASE_DIR}-empty'" \
  || die 10 "无法创建一次性测试库目录"
docker exec -u 0 "$CONTAINER" sh -c "chown -R aimem:aimem '${BASE_DIR}' '${FAIL_ROOT}' '${BASE_DIR}-empty'" \
  || die 10 "无法设置一次性测试库属主"

# CLI 封装：stdout 进 CLI_OUT，stderr 进 $WORK/last.err，rc 进 CLI_RC。
CLI_OUT=""
CLI_RC=0
cli_capture() {
  local db="$1"; shift
  set +e
  CLI_OUT="$(docker exec \
      -e "AI_MEMORY_DB=${db}" \
      -e "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0" \
      "$CONTAINER" ai-memory --db "$db" "$@" 2>"$WORK/last.err")"
  CLI_RC=$?
  set -e
}

# -wal 字节数；文件不存在视为 0（干净关闭时 SQLite 会移除它）。
wal_size() {
  local p="$1-wal"
  docker exec "$CONTAINER" sh -c "wc -c < \"$p\" 2>/dev/null || echo 0" | tr -d ' \n'
}

# seed <db> <label> <ttl|far> —— 结果 id 写入 SEED_ID（不用命令替换：子shell 里的 die 不会终止父进程）
SEED_ID=""
seed() {
  local db="$1" label="$2" mode="$3"
  local title="gc-probe-${label}-${STAMP}" content="gc probe ${label} marker ${STAMP}"
  if [ "$mode" = "ttl" ]; then
    cli_capture "$db" store -T "$title" -c "$content" --ttl-secs 2 --json
  else
    cli_capture "$db" store -T "$title" -c "$content" --expires-at "2035-01-01T00:00:00Z" --json
  fi
  [ "$CLI_RC" -eq 0 ] || die 30 "写入 ${label} 失败（rc=${CLI_RC}）：$(tail -2 "$WORK/last.err" | tr '\n' ' ')"
  SEED_ID="$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['id'])" "$CLI_OUT")"
  [ -n "$SEED_ID" ] || die 30 "写入 ${label} 的响应中取不到 id"
}

# ── 30. TTL 驱逐（显式 gc 路径）───────────────────────────────────────────────
# 播种顺序很关键：先播存活行、后播过期行。上游 `store` 自身会 fire-and-forget 调用
# `db::gc_if_needed`（src/cli/store.rs:147），若在过期行之后再有一次 store，可能被顺带清扫。
seed "$DB_A" live far
LID="$SEED_ID"
seed "$DB_A" expired ttl
EID="$SEED_ID"
log "DB_A 已播种：live=${LID} expired=${EID}"
sleep 4

# `get` 不触发惰性清扫（src/cli/crud.rs:61 的 cmd_get 不调用 gc_if_needed），这正是
# 「过期但未 gc 的行按 id 仍可读出」的证据；因此这里也**不能**先调 list —— 它会清扫。
cli_capture "$DB_A" get "$EID" --json
[ "$CLI_RC" -eq 0 ] || die 30 "过期但未 gc 的行按 id 应仍可读出（预热读数失败 rc=${CLI_RC}）"

cli_capture "$DB_A" gc --json
[ "$CLI_RC" -eq 0 ] || die 30 "gc 调用失败（rc=${CLI_RC}）"
printf '%s' "$CLI_OUT" > "$WORK/gc1.json"
assert_gc_json "$WORK/gc1.json" 1 30 >/dev/null \
  || die 30 "gc 未驱逐恰好 1 条过期记忆（实际 $(cat "$WORK/gc1.json")）"

cli_capture "$DB_A" get "$EID" --json
[ "$CLI_RC" -ne 0 ] || die 30 "gc 后过期行仍可按 id 读出"
grep -Fq "not found" "$WORK/last.err" || die 30 "gc 后按 id 取不到，但失败原因不是 not found：$(tail -2 "$WORK/last.err" | tr '\n' ' ')"

cli_capture "$DB_A" get "$LID" --json
[ "$CLI_RC" -eq 0 ] || die 30 "gc 误删了存活记忆（rc=${CLI_RC}）"

cli_capture "$DB_A" archive list --json
[ "$CLI_RC" -eq 0 ] || die 30 "archive list 调用失败（rc=${CLI_RC}）"
printf '%s' "$CLI_OUT" > "$WORK/archive.json"
python3 - "$WORK/archive.json" "$EID" <<'PY' || die 30 "过期行未按 archive_on_gc 默认语义进归档（archive_reason=ttl_expired）"
import json, sys
obj = json.load(open(sys.argv[1]))
eid = sys.argv[2]
rows = obj.get("archived") or []
hit = [r for r in rows if r.get("id") == eid]
if not hit:
    raise SystemExit("归档中找不到被驱逐的行 %s" % eid)
if hit[0].get("archive_reason") != "ttl_expired":
    raise SystemExit("archive_reason=%r, expected ttl_expired" % hit[0].get("archive_reason"))
PY

cli_capture "$DB_A" gc --json
printf '%s' "$CLI_OUT" > "$WORK/gc2.json"
assert_gc_json "$WORK/gc2.json" 0 30 >/dev/null || die 30 "gc 不幂等：第二次仍报告驱逐"

cli_capture "$DB_A" stats --json
printf '%s' "$CLI_OUT" > "$WORK/stats-a.json"
python3 - "$WORK/stats-a.json" <<'PY' || die 30 "gc 后存活计数不等于 1"
import json, sys
obj = json.load(open(sys.argv[1]))
if obj.get("total") != 1:
    raise SystemExit("total=%r, expected 1" % obj.get("total"))
PY
ok "TTL 驱逐（gc）：过期行按 id 仍可读出；gc 驱逐 1 条并归档（ttl_expired）；存活行保留；二次 gc 幂等"

# ── 30b. TTL 驱逐（读路径惰性清扫）───────────────────────────────────────────
# 覆盖面事实：TTL 驱逐**不只**由 gc 触发。`db::gc_if_needed`（src/storage/mod.rs:10502）被
# 多条路径 fire-and-forget 调用，其中 `cmd_list`（src/cli/crud.rs:99，清扫在 :110）会在
# 返回列表前把过期行清扫掉 —— 此时随后的 gc 会报 0。这条断言把该行为钉住，
# 以免将来误把「gc 计数」当成「过期总量」，也解释了为何维护脚本必须独立于业务查询运行。
seed "$DB_SWEEP" live far
SW_LID="$SEED_ID"
seed "$DB_SWEEP" expired ttl
SW_EID="$SEED_ID"
sleep 4

cli_capture "$DB_SWEEP" list --json
[ "$CLI_RC" -eq 0 ] || die 30 "活清扫测试库 list 调用失败（rc=${CLI_RC}）"
printf '%s' "$CLI_OUT" > "$WORK/list-sweep.json"
python3 - "$WORK/list-sweep.json" <<'PY' || die 30 "list 未过滤过期行（应只返回存活行）"
import json, sys
obj = json.load(open(sys.argv[1]))
if obj.get("count") != 1:
    raise SystemExit("list count=%r, expected 1（过期行应被过滤）" % obj.get("count"))
PY

cli_capture "$DB_SWEEP" archive list --json
printf '%s' "$CLI_OUT" > "$WORK/archive-sweep.json"
python3 - "$WORK/archive-sweep.json" "$SW_EID" <<'PY' || die 30 "list 未触发惰性 TTL 清扫（归档中找不到过期行）"
import json, sys
obj = json.load(open(sys.argv[1]))
eid = sys.argv[2]
rows = [r for r in (obj.get("archived") or []) if r.get("id") == eid]
if not rows:
    raise SystemExit("list 之后归档中仍无 %s —— 惰性清扫未发生" % eid)
if rows[0].get("archive_reason") != "ttl_expired":
    raise SystemExit("archive_reason=%r, expected ttl_expired" % rows[0].get("archive_reason"))
PY

cli_capture "$DB_SWEEP" gc --json
printf '%s' "$CLI_OUT" > "$WORK/gc-sweep.json"
assert_gc_json "$WORK/gc-sweep.json" 0 30 >/dev/null \
  || die 30 "list 已清扫后 gc 应报 0（实际 $(cat "$WORK/gc-sweep.json")）"

cli_capture "$DB_SWEEP" get "$SW_LID" --json
[ "$CLI_RC" -eq 0 ] || die 30 "惰性清扫误删了存活记忆（rc=${CLI_RC}）"
ok "TTL 驱逐（读路径惰性清扫）：list 先清扫过期行进归档（ttl_expired），随后 gc 报 0；存活行保留"

# ── 40. WAL 回收（gc 的 post-run checkpoint 覆盖面）──────────────────────────
python3 - "$WORK" "$STAMP" <<'PY'
import json, sys
work, stamp = sys.argv[1], sys.argv[2]
init = {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"gc-probe","version":"0"}}}
lines = [json.dumps(init), json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"})]
for i in range(3):
    lines.append(json.dumps({"jsonrpc":"2.0","id":10+i,"method":"tools/call","params":{
        "name":"memory_store",
        "arguments":{"title":"gc-probe wal %s %d" % (stamp, i),
                     "content":"wal growth payload %s %d" % (stamp, i), "force":True}}}))
open("%s/wal.jsonl" % work, "w").write("\n".join(lines) + "\n")
PY

# 长活会话：写完 3 条后保持 stdin 打开，使 -wal 保持非空。
{ cat "$WORK/wal.jsonl"; sleep 60; } | docker exec -i \
    -e "AI_MEMORY_DB=${DB_WAL}" \
    -e "AI_MEMORY_AGENT_ID=human:gc-probe-${STAMP}" \
    -e "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0" \
    "$CONTAINER" ai-memory mcp --tier smart --profile core \
    > "$WORK/wal.out" 2> "$WORK/wal.err" &
WAL_PID=$!

# 三条写入必须真的落库 —— 写入是**串行**且每条都含 embedding，`-wal` 只因第一条就非零，
# 所以不能拿 `-wal > 0` 当作「写完了」；必须等三条响应到齐（有界轮询，避免假失败）。
wal_writes_complete() {
  python3 - "$WORK/wal.out" 2>/dev/null <<'PY'
import json, sys
seen = {}
try:
    handle = open(sys.argv[1], encoding="utf-8", errors="replace")
except OSError:
    sys.exit(1)
for raw in handle:
    raw = raw.strip()
    if not raw.startswith("{"):
        continue
    try: obj = json.loads(raw)
    except ValueError: continue
    if "id" in obj: seen[obj["id"]] = obj
if any(i not in seen for i in (10, 11, 12)):
    sys.exit(1)
if any((seen[i].get("result") or {}).get("isError") for i in (10, 11, 12)):
    sys.exit(1)
PY
}

i=0
WRITES_OK=0
while [ "$i" -lt 60 ]; do
  if wal_writes_complete; then WRITES_OK=1; break; fi
  sleep 1
  i=$((i + 1))
done
[ "$WRITES_OK" -eq 1 ] || { tail -5 "$WORK/wal.err" >&2 || true; die 40 "WAL 测试库的三条写入未在超时内全部成功"; }

i=0
WAL_BEFORE=0
while [ "$i" -lt 40 ]; do
  WAL_BEFORE="$(wal_size "$DB_WAL")"
  [ "$WAL_BEFORE" -gt 0 ] && break
  sleep 1
  i=$((i + 1))
done
[ "$WAL_BEFORE" -gt 0 ] || die 40 "长活 MCP 会话未产生 -wal 增长，WAL 断言前提不成立"

# 等写入方静默：`memory_store` 之后还有 deferred-audit 排空等异步追加，若不等静默，
# TRUNCATE checkpoint 之后会立刻长出新帧 —— 实测会把「归零」断言打成竞态（曾出现残留 107152 字节）。
i=0
LAST=-1
STABLE=0
while [ "$i" -lt 40 ]; do
  CUR="$(wal_size "$DB_WAL")"
  if [ "$CUR" = "$LAST" ]; then STABLE=$((STABLE + 1)); else STABLE=0; fi
  [ "$STABLE" -ge 5 ] && break
  LAST="$CUR"
  sleep 1
  i=$((i + 1))
done
WAL_BEFORE="$(wal_size "$DB_WAL")"
log "WAL 前置：写入后 ${WAL_BEFORE} 字节，且已连续 5 次采样无变化"

cli_capture "$DB_WAL" gc --json
[ "$CLI_RC" -eq 0 ] || die 40 "对 WAL 测试库执行 gc 失败（rc=${CLI_RC}）"

WAL_AFTER="$(wal_size "$DB_WAL")"
assert_zero_size "$WAL_AFTER" 40 || die 40 "gc 未回收 -wal（前 ${WAL_BEFORE} 字节，后 ${WAL_AFTER} 字节）"

kill "$WAL_PID" 2>/dev/null || true
wait "$WAL_PID" 2>/dev/null || true
WAL_PID=""
WAL_EXIT="$(wal_size "$DB_WAL")"
assert_zero_size "$WAL_EXIT" 40 || die 40 "会话退出后 -wal 仍非零（${WAL_EXIT} 字节）"
ok "WAL 回收：-wal ${WAL_BEFORE} 字节 → gc 后 0 字节（写命令 post-run checkpoint 覆盖维护路径）"

# ── 50. curator --once ──────────────────────────────────────────────────────
cli_capture "$DB_A" curator --once --dry-run --json
[ "$CLI_RC" -eq 0 ] || die 50 "curator --once --dry-run 失败（rc=${CLI_RC}）：$(tail -2 "$WORK/last.err" | tr '\n' ' ')"
printf '%s' "$CLI_OUT" > "$WORK/cur-dry.json"
assert_curator_json "$WORK/cur-dry.json" 1 50 >/dev/null || die 50 "curator 干跑报告不合格（未读目标库或命中 LLM 静默失败）"

cli_capture "$DB_A" curator --once --max-ops 1 --json
[ "$CLI_RC" -eq 0 ] || die 50 "curator --once（真实运行）失败（rc=${CLI_RC}）：$(tail -2 "$WORK/last.err" | tr '\n' ' ')"
printf '%s' "$CLI_OUT" > "$WORK/cur-real.json"
assert_curator_json "$WORK/cur-real.json" 1 50 >/dev/null || die 50 "curator 真实运行报告不合格"
ok "curator --once：干跑与真实运行均 rc=0，报告可解析、memories_scanned>=1、无 LLM 静默失败"

# ── 60. 失败语义：单库失败不中断 ─────────────────────────────────────────────
cli_capture "${FAIL_ROOT}/good/ai-memory.db" store -T "gc-probe-good-${STAMP}" -c "good db payload ${STAMP}" --expires-at "2035-01-01T00:00:00Z" --json
[ "$CLI_RC" -eq 0 ] || die 60 "失败语义测试库准备失败（rc=${CLI_RC}）"
docker exec -u 0 "$CONTAINER" sh -c "printf 'this is not a sqlite database' > '${FAIL_ROOT}/bad/ai-memory.db'; chown aimem:aimem '${FAIL_ROOT}/bad/ai-memory.db'" \
  || die 60 "无法注入损坏库"

set +e
bash "$MAINT" --root "$FAIL_ROOT" > "$WORK/maint-fail.out" 2> "$WORK/maint-fail.err"
MRC=$?
set -e
[ "$MRC" -ne 0 ] || die 60 "损坏库存在时维护脚本应非零退出，实际 rc=0"
grep -Fq "gc FAILED" "$WORK/maint-fail.err" || die 60 "维护脚本未报告损坏库的 gc 失败"
grep -Eq "gc OK +${FAIL_ROOT}/good/" "$WORK/maint-fail.err" || die 60 "单库失败后未继续维护其余库（good 库无 gc OK）"
grep -Fq "curator OK  ${FAIL_ROOT}/good/" "$WORK/maint-fail.err" || die 60 "单库失败后未继续维护其余库（good 库无 curator OK）"
ok "失败语义：损坏库被报告且非零退出；同轮其余库仍完成 gc + curator（不中断）"

# 退出码契约：参数错误必须 rc=2；空根目录是合法情形（rc=0 且有明确说明，不是静默成功）。
set +e
bash "$MAINT" --max-ops abc >/dev/null 2>"$WORK/args.err"
ARC=$?
set -e
[ "$ARC" -eq 2 ] || die 60 "维护脚本对非法 --max-ops 应 rc=2，实际 rc=${ARC}"
grep -Fq "非负整数" "$WORK/args.err" || die 60 "非法 --max-ops 未给出可定位说明"

set +e
bash "$MAINT" --root "${BASE_DIR}-empty" >/dev/null 2>"$WORK/empty.err"
ERC=$?
set -e
[ "$ERC" -eq 0 ] || die 60 "空根目录应 rc=0（合法情形），实际 rc=${ERC}"
grep -Fq "未发现任何用户库" "$WORK/empty.err" || die 60 "空根目录未给出明确说明（会被误读为静默成功）"
ok "退出码契约：非法参数 rc=2 可定位；空根目录 rc=0 但有显式说明（非静默成功）"

# ── 70. 多库实跑 + 主库不变 ─────────────────────────────────────────────────
# 注意：非干跑 curator 会写入**自报告记忆**（见 src/curator/mod.rs，dry-run 分支才跳过），
# 所以本段用**相对**断言（维护后计数不得下降），不用硬编码绝对值。
seed "$DB_B" b far
BID="$SEED_ID"

cli_capture "$MASTER_DB" stats --json
[ "$CLI_RC" -eq 0 ] || die 70 "读取共享主库 stats 失败（rc=${CLI_RC}）"
printf '%s' "$CLI_OUT" > "$WORK/master-before.json"

# count_of <db> —— 结果写入 TOTAL_OF（同样避开命令替换里的 die）
TOTAL_OF=""
count_of() {
  cli_capture "$1" stats --json
  [ "$CLI_RC" -eq 0 ] || die 70 "读取 $1 stats 失败（rc=${CLI_RC}）"
  TOTAL_OF="$(python3 -c "import json,sys;print(json.loads(sys.argv[1])['total'])" "$CLI_OUT")"
}
count_of "$DB_A";     A_BEFORE="$TOTAL_OF"
count_of "$DB_B";     B_BEFORE="$TOTAL_OF"
count_of "$DB_WAL";   W_BEFORE="$TOTAL_OF"
count_of "$DB_SWEEP"; S_BEFORE="$TOTAL_OF"

set +e
bash "$MAINT" --root "$BASE_DIR" > "$WORK/maint.out" 2> "$WORK/maint.err"
MRC=$?
set -e
[ "$MRC" -eq 0 ] || { tail -20 "$WORK/maint.err" >&2 || true; die 70 "维护脚本对四个健康库应 rc=0，实际 rc=${MRC}"; }

for name in a b wal sweep; do
  grep -Fq "gc OK  ${BASE_DIR}/${name}/ai-memory.db" "$WORK/maint.err" || die 70 "库 ${name} 未完成 gc"
  grep -Fq "curator OK  ${BASE_DIR}/${name}/ai-memory.db" "$WORK/maint.err" || die 70 "库 ${name} 未完成 curator"
done

count_of "$DB_A";     A_AFTER="$TOTAL_OF"
count_of "$DB_B";     B_AFTER="$TOTAL_OF"
count_of "$DB_WAL";   W_AFTER="$TOTAL_OF"
count_of "$DB_SWEEP"; S_AFTER="$TOTAL_OF"
for pair in "a:${A_BEFORE}:${A_AFTER}" "b:${B_BEFORE}:${B_AFTER}" "wal:${W_BEFORE}:${W_AFTER}" "sweep:${S_BEFORE}:${S_AFTER}"; do
  name="${pair%%:*}"; rest="${pair#*:}"; before="${rest%%:*}"; after="${rest#*:}"
  [ "$after" -ge "$before" ] || die 70 "库 ${name} 维护后计数下降（${before} → ${after}），存活数据被误删"
done

# 各组播种的存活行必须仍可按 id 读回（维护不得破坏存活数据）。
for spec in "${DB_A}:${LID}" "${DB_B}:${BID}" "${DB_SWEEP}:${SW_LID}"; do
  db="${spec%%:*}"; id="${spec#*:}"
  cli_capture "$db" get "$id" --json
  [ "$CLI_RC" -eq 0 ] || die 70 "维护后存活行不可读：${db} / ${id}（rc=${CLI_RC}）"
done

# 跨库隔离：A 的存活行在 B 中必须取不到（维护不得造成串库）。
cli_capture "$DB_B" get "$LID" --json
[ "$CLI_RC" -ne 0 ] || die 70 "跨库隔离失效：库 b 中取到了库 a 的记忆 ${LID}"

cli_capture "$MASTER_DB" stats --json
printf '%s' "$CLI_OUT" > "$WORK/master-after.json"
python3 - "$WORK/master-before.json" "$WORK/master-after.json" "$MASTER_DB" <<'PY' || die 70 "共享主库在维护后发生了变化（维护越界）"
import json, sys
before = json.load(open(sys.argv[1]))
after = json.load(open(sys.argv[2]))
if before.get("total") != after.get("total"):
    raise SystemExit("主库 total 从 %r 变为 %r" % (before.get("total"), after.get("total")))
print("master total=%r unchanged" % after.get("total"))
PY
ok "多库实跑：四个库各自完成 gc + curator、存活行仍可读、无跨库串号，共享主库计数不变"

cat <<EOF

gc-probe 通过（一次性库根 ${BASE_DIR}）
- 静态审计：维护脚本每条调用显式 --db、curator 带 --once/--max-ops、attestation=0 固定
- TTL 驱逐（gc）：gc 驱逐过期行并归档（ttl_expired）；存活行保留；二次 gc 幂等；read-by-id 不过滤 expires_at
- TTL 驱逐（读路径）：list 惰性清扫过期行进归档，随后 gc 报 0（gc 计数不等于过期总量）
- WAL 回收：长活会话造成的 -wal 增长被 gc 的 post-run checkpoint 归零
- curator --once：干跑与真实运行均成功，且确实读到目标库
- 失败语义：损坏库非零退出但不中断，同轮其余库仍被维护；非法参数 rc=2；空根目录 rc=0 但有显式说明（非静默成功）
- 多库独立性：四个库各自维护、存活行仍可按 id 读回、A 的记忆在 B 中取不到（无串库）
- 边界：共享主库不在维护范围内且计数不变
EOF
