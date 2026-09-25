#!/usr/bin/env bash
# iso-probe.sh — 多用户隔离探针（Sprint 2 #5「隔离是否可实现」的行为级证据）
#
# 前置：local-up.sh 已启动（容器 ai-memory-mcp 常驻）。会话调用方式与生产 SSH forced command
#       同构：docker exec -i [-e ...] ai-memory-mcp ai-memory mcp --tier smart（-i 不加 -t）。
#
# 目的：为「多用户隔离是否可实现」提供**实测证据**（源码依据见 specs/mcp/mcp-design.md §2 /
#       specs/sprint-backlog.md「阻断级风险」）。
#
#   A 组 负向（D2 落地后的 R1 / V1 解析链）
#     P1a 漏设 AI_MEMORY_DB（unset）→ doctor 必须 fail-loud；source 不得为共享主库，解析后的
#         目标必须是绝对路径；失败原因必须来自存储路径；共享主库记忆计数不变
#     P1b 显式设 AI_MEMORY_DB=/data/users/<u>/ai-memory.db → source 随 env 改变（env 权威性对照）
#     P4  错设 AI_MEMORY_DB（父目录不存在）→ 记录报错形态（fail-loud 与否；仅记录，不判定失败）
#
#   B 组 方案 ③ 一用户一 DB 正向
#     P2  双用户（iso-alice / iso-bob）独立 MCP 会话：A 的标记 B 检索不到；A↔B 互相 get 不可见；
#         用户库文件存在且属主 aimem；共享主库记忆计数不变（sprint-backlog V2/V3 的本地版）
#     P3  用与用户会话相同的**四项服务端 env** 跑 doctor --json，断言 source == 该用户库（V4 的本地版）
#     P5  每库显式维护通路：ai-memory --db <user> stats 可用（mcp/mcp-design.md §5.3 的前置）
#
#   C 组 方案 ② 单库 + per-user env 对照（证明「读可强制、写不可信」→ ③ 的必要性）
#     P6  同库：alice 写入私有行；bob 以 agent_id=human:iso-alice 注入（写路径可伪造）；
#         bob 读不到 alice 的私有行（读隔离生效）；alice 是否能看到被注入的行（注入后果）
#
# 幂等设计：`memory_store` 对语义相近的内容会返回 **CONFLICT（near-duplicate 去重）**，此时本次标记
#   并未落库。因此**写入与检索必须分会话**：先由写入会话取得「生效标记」（CONFLICT 时取响应中引用的
#   既有标记），再用**该生效标记**另开会话检索。否则第二次运行会对一个不存在的标记做断言（假失败）。
#
# 幂等与数据：每次运行使用唯一 ASCII 标记；core 档无删除工具，探针库数据保留供复查。
#   清理：docker exec -u 0 ai-memory-mcp rm -rf /data/users/iso-*
#
# 密钥纪律：本脚本不读 env 文件、不打印密钥；仅打印 doctor 的 source/rc 与 MCP 响应片段。
#
# 用法：bash memory.agent-mate.ai/scripts/probes/iso-probe.sh
# 退出码：0 全通过；10 前置失败；20 解析链断言失败；30 隔离断言失败；40 维护通路失败；
#         50 方案②对照会话异常（P4 仅记录、不因它失败）
set -euo pipefail

CONTAINER="ai-memory-mcp"
USERS="iso-alice iso-bob iso-shared"
STAMP="$(date +%s)-$$"

MK_A="ISO-A-${STAMP}"        # alice 私有（独立库）
MK_B="ISO-B-${STAMP}"        # bob 私有（独立库）
MK_SA="ISO-SA-${STAMP}"      # alice 私有（共享库，方案②对照）
MK_SINJ="ISO-SINJ-${STAMP}"  # bob 以 alice 名义注入（方案②对照）

log()  { printf '[iso-probe] %s\n' "$*" >&2; }
ok()   { printf '[iso-probe][OK] %s\n' "$*" >&2; }
note() { printf '[iso-probe][NOTE] %s\n' "$*" >&2; }
die()  { local code="$1"; shift; log "失败($code)：$*"; exit "$code"; }

# ── 前置：容器须常驻运行 ──
docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -qx "$CONTAINER" \
  || die 10 "容器 ${CONTAINER} 未运行（先执行 bash memory.agent-mate.ai/scripts/local-up.sh）"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── 容器侧小工具（镜像内有 stat/awk，无 python3 —— 解析一律在宿主机做）──
c_owner() { docker exec "$CONTAINER" stat -c '%U:%G' "$1" 2>/dev/null || echo MISSING; }
c_stamp() { docker exec "$CONTAINER" stat -c '%Y/%s' "$1" 2>/dev/null || echo MISSING; }
main_count() { docker exec "$CONTAINER" ai-memory --db "$MAIN_DB" stats 2>/dev/null | awk '/^total memories:/ {print $3}'; }

jfield() { # $1=json 文件 $2=字段名
  python3 -c 'import json,sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    d = {}
print(d.get(sys.argv[2], ""))' "$1" "$2" 2>/dev/null || true
}

run_doctor() { # $1=输出文件；其余为 -e KEY=VAL
  local out="$1"; shift
  local args=()
  for kv in "$@"; do args+=(-e "$kv"); done
  docker exec -i "${args[@]}" "$CONTAINER" ai-memory doctor --json > "$out" 2> "$out.err"
}

run_session() { # $1=label $2=out 文件 $3=payload；其余为 -e KEY=VAL
  local label="$1" out="$2" payload="$3"; shift 3
  local args=()
  for kv in "$@"; do args+=(-e "$kv"); done
  if ! docker exec -i "${args[@]}" "$CONTAINER" ai-memory mcp --tier smart \
        < "$payload" > "$out" 2> "$out.err"; then
    log "会话 ${label} 进程异常退出；容器侧 stderr 尾部："
    tail -5 "$out.err" >&2 || true
    return 1
  fi
  return 0
}

ALICE_DIR="/data/users/iso-alice"
BOB_DIR="/data/users/iso-bob"
SHARED_DIR="/data/users/iso-shared"
ALICE_DB="${ALICE_DIR}/ai-memory.db"
BOB_DB="${BOB_DIR}/ai-memory.db"
SHARED_DB="${SHARED_DIR}/ai-memory.db"
MAIN_DB="/data/ai-memory.db"

# 会话 env（与生产 forced command 用户行同构，四项逐项对齐 §5.2 模板：
# AI_MEMORY_DB / AI_MEMORY_AGENT_ID / AI_MEMORY_KEY_DIR / AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0；
# 库路径/身份/密钥目录全部钉在服务端。attestation 显式重申与容器级取值一致，不改变断言语义。）
ALICE_ENV=("AI_MEMORY_DB=${ALICE_DB}" "AI_MEMORY_AGENT_ID=human:iso-alice" "AI_MEMORY_KEY_DIR=${ALICE_DIR}/keys" "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0")
BOB_ENV=("AI_MEMORY_DB=${BOB_DB}" "AI_MEMORY_AGENT_ID=human:iso-bob" "AI_MEMORY_KEY_DIR=${BOB_DIR}/keys" "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0")
SH_ALICE_ENV=("AI_MEMORY_DB=${SHARED_DB}" "AI_MEMORY_AGENT_ID=human:iso-alice" "AI_MEMORY_KEY_DIR=${ALICE_DIR}/keys" "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0")
SH_BOB_ENV=("AI_MEMORY_DB=${SHARED_DB}" "AI_MEMORY_AGENT_ID=human:iso-bob" "AI_MEMORY_KEY_DIR=${BOB_DIR}/keys" "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0")

# ═══════════════════ P0 前置准备 ═══════════════════
for u in $USERS; do
  docker exec -u 0 "$CONTAINER" sh -c "mkdir -p /data/users/${u}/keys && chown -R aimem:aimem /data/users/${u}" \
    || die 10 "无法准备目录 /data/users/${u}"
done
log "P0 目录就绪：$(docker exec "$CONTAINER" ls /data/users 2>/dev/null | tr '\n' ' ')"

MAIN_COUNT_BEFORE="$(main_count)"
case "$MAIN_COUNT_BEFORE" in
  ''|*[!0-9]*) die 10 "无法取得共享主库记忆计数（值=${MAIN_COUNT_BEFORE:-<empty>}），拒绝在无基线证据时继续" ;;
esac
CONTAINER_CWD="$(docker exec "$CONTAINER" pwd 2>/dev/null || true)"
case "$CONTAINER_CWD" in
  /*) ;;
  *) die 10 "无法取得容器绝对工作目录（值=${CONTAINER_CWD:-<empty>}）" ;;
esac

# ═══════════════════ P1 负向：解析链（R1 / V1）═══════════════════
CFG_DB_KEY="$(docker exec "$CONTAINER" sh -c "awk '/^[[:space:]]*\[/ { exit } /^[[:space:]]*(db|\"db\"|\\047db\\047)[[:space:]]*=/ { n++ } END { print n+0 }' /data/.config/ai-memory/config.toml" || true)"
[ "$CFG_DB_KEY" = "0" ] \
  || die 20 "P1-0 生效 config 仍有 ${CFG_DB_KEY} 个顶层 db 键（D2 未落地，拒绝继续以免验证旧行为）"
ok "P1-0 生效 config 无顶层 db fallback"

log "P1a 漏设 AI_MEMORY_DB（unset）→ doctor --json 必须 fail-loud"
set +e
docker exec "$CONTAINER" sh -c 'unset AI_MEMORY_DB; exec ai-memory doctor --json' \
  > "$WORK/p1a.json" 2> "$WORK/p1a.err"
P1A_RC=$?
set -e
P1A_SRC="$(jfield "$WORK/p1a.json" source)"
P1A_OVERALL="$(jfield "$WORK/p1a.json" overall)"
P1A_RESOLVED="$(python3 -c 'import posixpath,sys; print(posixpath.normpath(posixpath.join(sys.argv[1], sys.argv[2])))' "$CONTAINER_CWD" "$P1A_SRC" 2>/dev/null || true)"
P1A_ERR="$(cat "$WORK/p1a.err" "$WORK/p1a.json" | tr '\n' ' ' | cut -c1-500)"
note "P1a 结果：rc=${P1A_RC} overall=${P1A_OVERALL} source=${P1A_SRC} resolved=${P1A_RESOLVED}"
[ "$P1A_RC" -ne 0 ] || die 20 "P1a 断言失败：漏设 AI_MEMORY_DB 后 doctor 仍成功（source=${P1A_SRC}）"
[ -n "$P1A_SRC" ] || die 20 "P1a 断言失败：doctor 未返回 source，无法审计解析目标"
[ "$P1A_SRC" != "$MAIN_DB" ] && [ "$P1A_RESOLVED" != "$MAIN_DB" ] \
  || die 20 "P1a 断言失败：漏设 AI_MEMORY_DB 仍解析到共享主库 ${MAIN_DB}"
case "$P1A_RESOLVED" in
  /*) ;;
  *) die 20 "P1a 断言失败：解析后的目标不是绝对路径（source=${P1A_SRC} resolved=${P1A_RESOLVED:-<empty>}）" ;;
esac
printf '%s' "$P1A_ERR" | grep -Eiq 'storage|database|sqlite|open|path' \
  || die 20 "P1a 断言失败：失败原因不像存储路径解析错误（${P1A_ERR:-<empty>}）"
P1A_MAIN_COUNT_AFTER="$(main_count)"
case "$P1A_MAIN_COUNT_AFTER" in
  ''|*[!0-9]*) die 20 "P1a 后无法取得共享主库记忆计数（值=${P1A_MAIN_COUNT_AFTER:-<empty>}）" ;;
esac
[ "$MAIN_COUNT_BEFORE" = "$P1A_MAIN_COUNT_AFTER" ] \
  || die 20 "P1a 断言失败：共享主库记忆计数变化 ${MAIN_COUNT_BEFORE} → ${P1A_MAIN_COUNT_AFTER}"
ok "P1a 通过（V1）：漏设 AI_MEMORY_DB fail-loud，目标=${P1A_RESOLVED}，共享主库计数未变化"

log "P1b 显式设 AI_MEMORY_DB=${ALICE_DB} → doctor --json（env 权威性对照）"
set +e
run_doctor "$WORK/p1b.json" "AI_MEMORY_DB=${ALICE_DB}"
P1B_RC=$?
set -e
P1B_SRC="$(jfield "$WORK/p1b.json" source)"
[ "$P1B_RC" -eq 0 ] || die 20 "P1b 异常：doctor 退出码 ${P1B_RC}"
[ "$P1B_SRC" = "$ALICE_DB" ] \
  || die 20 "P1b 断言失败：显式 env 后 source=${P1B_SRC}，预期 ${ALICE_DB}"
ok "P1b 对照成立：显式 AI_MEMORY_DB 时 source 随 env 切换（env 为权威输入）"

# ═══════════════════ P2 方案③ 双用户物理隔离 ═══════════════════
# 写会话与检索会话分开：先取得「生效标记」，再以该标记检索（CONFLICT 幂等，见文件头说明）
log "P2 会话 A1(alice 写入) 标记=${MK_A}"
python3 - "$WORK" "$MK_A" "alice" <<'PY'
import json, sys
work, marker, who = sys.argv[1], sys.argv[2], sys.argv[3]
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "iso-probe", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
store = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_store", "arguments": {
        "title": f"isolation probe {who} {marker}",
        "content": (f"isolation probe private memory for {who}; unique marker {marker}; "
                    f"stored over MCP stdio with per-user AI_MEMORY_DB.")}}}
with open(f"{work}/session_a1.jsonl", "w") as f:
    for o in (init, inited, store):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY

run_session "A1(alice 写入)" "$WORK/out_a1.jsonl" "$WORK/session_a1.jsonl" "${ALICE_ENV[@]}" \
  || die 30 "会话 A1 失败"

set +e
python3 - "$WORK/out_a1.jsonl" "$MK_A" "$WORK/eff_a" "$WORK/id_a" <<'PY'
import json, re, sys
path, marker, eff_path, id_path = sys.argv[1:5]
resp = {}
for line in open(path):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if "id" in o:
        resp[o["id"]] = o

def rtext(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

store = resp.get(2)
if store is None or "error" in store:
    print(f"[verify] alice memory_store 异常: {json.dumps(store, ensure_ascii=False)[:300]}")
    sys.exit(30)
text = rtext(store)
if "CONFLICT" in text and marker not in text:
    m = re.search(r"ISO-A-\d+-\d+", text)
    if not m:
        print(f"[verify] alice 写入 CONFLICT 但提取不到既有标记: {text[:300]}")
        sys.exit(30)
    marker = m.group(0)
    print(f"[verify] alice memory_store CONFLICT（near-duplicate 去重）→ 生效标记 = {marker}")
else:
    print(f"[verify] alice memory_store ok: {text[:140]}")
uuid = re.search(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", text)
open(eff_path, "w").write(marker)
open(id_path, "w").write(uuid.group(0) if uuid else "")
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 30 "会话 A1 校验未通过（退出码 ${rc}）"

EFF_A="$(cat "$WORK/eff_a")"

log "P2 会话 A2(alice 自查生效标记 ${EFF_A})"
python3 - "$WORK" "$EFF_A" <<'PY'
import json, sys
work, marker = sys.argv[1], sys.argv[2]
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "iso-probe", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
search = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_search", "arguments": {"query": marker, "limit": 5}}}
with open(f"{work}/session_a2.jsonl", "w") as f:
    for o in (init, inited, search):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY

run_session "A2(alice 自查)" "$WORK/out_a2.jsonl" "$WORK/session_a2.jsonl" "${ALICE_ENV[@]}" \
  || die 30 "会话 A2 失败"

set +e
python3 - "$WORK/out_a2.jsonl" "$EFF_A" "$WORK/id_a" <<'PY'
import json, re, sys
path, marker, id_path = sys.argv[1:4]
resp = {}
for line in open(path):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if "id" in o:
        resp[o["id"]] = o

def rtext(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

s = resp.get(2)
if s is None or "error" in s:
    print(f"[verify] alice 自查异常: {json.dumps(s, ensure_ascii=False)[:300]}")
    sys.exit(30)
st = rtext(s)
if marker not in st:
    print(f"[verify] alice 自查未命中生效标记 {marker}；结果: {st[:300]}")
    sys.exit(30)
print(f"[verify] alice 自查命中生效标记 {marker}")
try:
    existing = open(id_path).read().strip()
except IOError:
    existing = ""
if not existing:
    uuid = re.search(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", st)
    if uuid:
        open(id_path, "w").write(uuid.group(0))
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 30 "会话 A2 校验未通过（退出码 ${rc}）"

ID_A="$(cat "$WORK/id_a" 2>/dev/null || true)"
[ -n "$ID_A" ] || die 30 "未能提取 alice 记忆 id（V3 交叉 get 断言需要）"
log "alice 生效标记=${EFF_A} id=${ID_A}"

log "P2 会话 B1(bob 写入) 标记=${MK_B}"
python3 - "$WORK" "$MK_B" "bob" <<'PY'
import json, sys
work, marker, who = sys.argv[1], sys.argv[2], sys.argv[3]
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "iso-probe", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
store = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_store", "arguments": {
        "title": f"isolation probe {who} {marker}",
        "content": (f"isolation probe private memory for {who}; unique marker {marker}; "
                    f"stored over MCP stdio with per-user AI_MEMORY_DB.")}}}
with open(f"{work}/session_b1.jsonl", "w") as f:
    for o in (init, inited, store):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY

run_session "B1(bob 写入)" "$WORK/out_b1.jsonl" "$WORK/session_b1.jsonl" "${BOB_ENV[@]}" \
  || die 30 "会话 B1 失败"

set +e
python3 - "$WORK/out_b1.jsonl" "$MK_B" "$WORK/eff_b" "$WORK/id_b" <<'PY'
import json, re, sys
path, marker, eff_path, id_path = sys.argv[1:5]
resp = {}
for line in open(path):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if "id" in o:
        resp[o["id"]] = o

def rtext(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

store = resp.get(2)
if store is None or "error" in store:
    print(f"[verify] bob memory_store 异常: {json.dumps(store, ensure_ascii=False)[:300]}")
    sys.exit(30)
text = rtext(store)
if "CONFLICT" in text and marker not in text:
    m = re.search(r"ISO-B-\d+-\d+", text)
    if not m:
        print(f"[verify] bob 写入 CONFLICT 但提取不到既有标记: {text[:300]}")
        sys.exit(30)
    marker = m.group(0)
    print(f"[verify] bob memory_store CONFLICT（near-duplicate 去重）→ 生效标记 = {marker}")
else:
    print(f"[verify] bob memory_store ok: {text[:140]}")
uuid = re.search(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", text)
open(eff_path, "w").write(marker)
open(id_path, "w").write(uuid.group(0) if uuid else "")
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 30 "会话 B1 校验未通过（退出码 ${rc}）"

EFF_B="$(cat "$WORK/eff_b")"
log "P2 会话 B2(bob 检索)：查 alice 标记 ${EFF_A}（应未命中）、查自己 ${EFF_B}（应命中）、get(alice_id)"
python3 - "$WORK" "$EFF_A" "$EFF_B" "$ID_A" <<'PY'
import json, sys
work, alice_marker, bob_marker, alice_id = sys.argv[1:5]
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "iso-probe", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
search_alice = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_search", "arguments": {"query": alice_marker, "limit": 5}}}
search_bob = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
    "name": "memory_search", "arguments": {"query": bob_marker, "limit": 5}}}
get_alice = {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
    "name": "memory_get", "arguments": {"id": alice_id}}}
with open(f"{work}/session_b2.jsonl", "w") as f:
    for o in (init, inited, search_alice, search_bob, get_alice):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY

run_session "B2(bob 检索)" "$WORK/out_b2.jsonl" "$WORK/session_b2.jsonl" "${BOB_ENV[@]}" \
  || die 30 "会话 B2 失败"

set +e
python3 - "$WORK/out_b2.jsonl" "$EFF_A" "$EFF_B" "$WORK/id_b" <<'PY'
import json, re, sys
path, alice_marker, bob_marker, id_path = sys.argv[1:5]
resp = {}
for line in open(path):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if "id" in o:
        resp[o["id"]] = o

def rtext(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

# ① alice 的标记在 bob 的库里必须检索不到
sa = resp.get(2)
if sa is None or "error" in sa:
    print(f"[verify] bob memory_search(alice 标记) 异常: {json.dumps(sa, ensure_ascii=False)[:300]}")
    sys.exit(30)
at = rtext(sa)
if alice_marker in at:
    print(f"[verify] 隔离失败：bob 检索到了 alice 的私有标记 {alice_marker}！结果: {at[:300]}")
    sys.exit(30)
print(f"[verify] 隔离成立：bob 检索 alice 标记 {alice_marker} 未命中（{at.strip()[:40]}）")

# ② bob 自查必须命中（排除「会话本身坏了」的假阴性）
sb = resp.get(3)
if sb is None or "error" in sb:
    print(f"[verify] bob memory_search(自查) 异常: {json.dumps(sb, ensure_ascii=False)[:300]}")
    sys.exit(30)
bt = rtext(sb)
if bob_marker not in bt:
    print(f"[verify] bob 自查未命中自己的标记 {bob_marker}；结果: {bt[:300]}")
    sys.exit(30)
print(f"[verify] 正向对照成立：bob 自查命中 {bob_marker}")

# ③ bob 显式 get alice 的记忆 id → 不可见
g = resp.get(4)
gt = rtext(g) if g else ""
if alice_marker in gt:
    print("[verify] 隔离失败：bob 通过 get 读到了 alice 的记忆内容")
    sys.exit(30)
print(f"[verify] bob get(alice_id) 不可见/未找到（{gt.strip()[:80] or json.dumps((g or {}).get('error', {}), ensure_ascii=False)[:80]}）")

try:
    existing = open(id_path).read().strip()
except IOError:
    existing = ""
if not existing:
    uuid = re.search(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", bt)
    if uuid:
        open(id_path, "w").write(uuid.group(0))
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 30 "会话 B2 校验未通过（退出码 ${rc}）"

ID_B="$(cat "$WORK/id_b" 2>/dev/null || true)"
[ -n "$ID_B" ] || die 30 "未能提取 bob 记忆 id（V3 反向 get 断言需要）"

log "P2 会话 C(alice 反查)：查 bob 标记 ${EFF_B}（应未命中）、get(bob_id)"
python3 - "$WORK" "$EFF_B" "$ID_B" <<'PY'
import json, sys
work, bob_marker, bob_id = sys.argv[1], sys.argv[2], sys.argv[3]
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "iso-probe", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
search_bob = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_search", "arguments": {"query": bob_marker, "limit": 5}}}
get_bob = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
    "name": "memory_get", "arguments": {"id": bob_id}}}
with open(f"{work}/session_c.jsonl", "w") as f:
    for o in (init, inited, search_bob, get_bob):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY

run_session "C(alice 反查)" "$WORK/out_c.jsonl" "$WORK/session_c.jsonl" "${ALICE_ENV[@]}" \
  || die 30 "会话 C 失败"

set +e
python3 - "$WORK/out_c.jsonl" "$EFF_B" <<'PY'
import json, sys
path, bob_marker = sys.argv[1], sys.argv[2]
resp = {}
for line in open(path):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if "id" in o:
        resp[o["id"]] = o

def rtext(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

s = resp.get(2)
if s is None or "error" in s:
    print(f"[verify] alice 检索 bob 标记异常: {json.dumps(s, ensure_ascii=False)[:300]}")
    sys.exit(30)
st = rtext(s)
if bob_marker in st:
    print(f"[verify] 隔离失败：alice 检索到了 bob 的私有标记 {bob_marker}！")
    sys.exit(30)
print(f"[verify] 反向隔离成立：alice 检索 bob 标记 {bob_marker} 未命中")

g = resp.get(3)
gt = rtext(g) if g else ""
if bob_marker in gt:
    print("[verify] 隔离失败：alice 通过 get 读到了 bob 的记忆内容")
    sys.exit(30)
print("[verify] alice get(bob_id) 不可见/未找到")
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 30 "会话 C 校验未通过（退出码 ${rc}）"

# 文件级断言（V2 的本地版：目标库变化、主库不变）
A_OWNER="$(c_owner "$ALICE_DB")"
B_OWNER="$(c_owner "$BOB_DB")"
[ "$A_OWNER" = "aimem:aimem" ] || die 30 "alice 库属主=${A_OWNER}，预期 aimem:aimem"
[ "$B_OWNER" = "aimem:aimem" ] || die 30 "bob 库属主=${B_OWNER}，预期 aimem:aimem"
log "P2 用户库文件：alice ${ALICE_DB}（${A_OWNER}，$(c_stamp "$ALICE_DB")）、bob ${BOB_DB}（${B_OWNER}，$(c_stamp "$BOB_DB")）"

MAIN_COUNT_AFTER="$(main_count)"
case "$MAIN_COUNT_AFTER" in
  ''|*[!0-9]*) die 30 "P2 后无法取得共享主库记忆计数（值=${MAIN_COUNT_AFTER:-<empty>}）" ;;
esac
[ "$MAIN_COUNT_BEFORE" = "$MAIN_COUNT_AFTER" ] \
  || die 30 "共享主库记忆计数变化：${MAIN_COUNT_BEFORE} → ${MAIN_COUNT_AFTER}（用户会话疑似落到了主库）"
ok "主库未被写入：记忆计数 ${MAIN_COUNT_BEFORE} 不变"
ok "P2 通过：双用户物理隔离成立（双向检索不可见 + get 不可见 + 库属主正确 + 主库计数不变）"

# ═══════════════════ P3 解析链自检（V4 本地版）═══════════════════
log "P3 与 alice 会话相同的服务端 env 跑 doctor --json → 断言 source == ${ALICE_DB}"
set +e
run_doctor "$WORK/p3.json" "${ALICE_ENV[@]}"
P3_RC=$?
set -e
P3_SRC="$(jfield "$WORK/p3.json" source)"
[ "$P3_RC" -eq 0 ] || die 20 "P3 异常：doctor 退出码 ${P3_RC}"
[ "$P3_SRC" = "$ALICE_DB" ] || die 20 "P3 断言失败：source=${P3_SRC}，预期 ${ALICE_DB}"
ok "P3 通过（V4 本地版）：doctor 解析出的 source 与 forced command env 一致"

# ═══════════════════ P4 错设路径（记录型）═══════════════════
log "P4 错设 AI_MEMORY_DB（父目录不存在）"
set +e
docker exec -i -e "AI_MEMORY_DB=/data/users/iso-absent-${STAMP}/ai-memory.db" "$CONTAINER" \
  ai-memory doctor --json > "$WORK/p4.json" 2> "$WORK/p4.err"
P4_RC=$?
set -e
P4_SRC="$(jfield "$WORK/p4.json" source)"
P4_OVERALL="$(jfield "$WORK/p4.json" overall)"
if [ "$P4_RC" -ne 0 ]; then
  P4_LOUD="是"
  note "P4 错设路径 → rc=${P4_RC}、overall=${P4_OVERALL}（fail-loud）"
else
  P4_LOUD="否"
  note "P4 错设路径 → rc=0、source=${P4_SRC}（未报错；若后续 D2 落地需复核此分支仍为 fail-loud）"
fi

# ═══════════════════ P5 每库维护通路 ═══════════════════
log "P5 每库维护通路：ai-memory --db <user> stats"
set +e
docker exec "$CONTAINER" ai-memory --db "$ALICE_DB" stats > "$WORK/p5a.txt" 2>&1
P5A_RC=$?
docker exec "$CONTAINER" ai-memory --db "$BOB_DB" stats > "$WORK/p5b.txt" 2>&1
P5B_RC=$?
set -e
[ "$P5A_RC" -eq 0 ] && [ "$P5B_RC" -eq 0 ] || die 40 "每库 stats 失败（alice rc=${P5A_RC} / bob rc=${P5B_RC}）"
CA="$(awk '/^total memories:/ {print $3}' "$WORK/p5a.txt")"
CB="$(awk '/^total memories:/ {print $3}' "$WORK/p5b.txt")"
[ -n "$CA" ] && [ -n "$CB" ] || die 40 "每库 stats 输出无法解析计数（alice=${CA} bob=${CB}）"
note "每库计数：alice=${CA}、bob=${CB}、主库=${MAIN_COUNT_AFTER}（各自独立）"
[ "$CA" != "0" ] && [ "$CB" != "0" ] || die 40 "用户库计数为 0（写入未落到用户库）"
ok "P5 通过：ai-memory --db <user> stats 可用（§5.3 显式维护路径的前置成立）"

# ═══════════════════ P6 方案②对照（单库 + per-user env）═══════════════════
log "P6 方案②对照（共享库 ${SHARED_DB}）：读可强制 / 写不可信"
python3 - "$WORK" "$MK_SA" <<'PY'
import json, sys
work, marker = sys.argv[1], sys.argv[2]
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "iso-probe", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
store = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_store", "arguments": {
        "title": f"iso shared alice {marker}",
        "content": f"isolation probe shared-lib private memory for alice; marker {marker}."}}}
with open(f"{work}/session_x.jsonl", "w") as f:
    for o in (init, inited, store):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY
run_session "X(alice 写入共享库)" "$WORK/out_x.jsonl" "$WORK/session_x.jsonl" "${SH_ALICE_ENV[@]}" \
  || die 50 "会话 X 失败"

set +e
python3 - "$WORK/out_x.jsonl" "$MK_SA" "$WORK/eff_sa" <<'PY'
import json, re, sys
path, marker, eff_path = sys.argv[1:4]
resp = {}
for line in open(path):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if "id" in o:
        resp[o["id"]] = o

def rtext(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

store = resp.get(2)
if store is None or "error" in store:
    print(f"[verify] P6 alice(共享库) memory_store 异常: {json.dumps(store, ensure_ascii=False)[:300]}")
    sys.exit(50)
text = rtext(store)
if "CONFLICT" in text and marker not in text:
    m = re.search(r"ISO-SA-\d+-\d+", text)
    if not m:
        print(f"[verify] P6 alice 写入 CONFLICT 但提取不到既有标记: {text[:300]}")
        sys.exit(50)
    marker = m.group(0)
    print(f"[verify] P6 alice(共享库) CONFLICT → 生效标记 = {marker}")
else:
    print(f"[verify] P6 alice(共享库) memory_store ok: {text[:120]}")
open(eff_path, "w").write(marker)
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 50 "会话 X 校验未通过（退出码 ${rc}）"
EFF_SA="$(cat "$WORK/eff_sa")"

log "P6 会话 Y1(bob 注入)：以 agent_id=human:iso-alice 写入 + 检索 alice 私有标记 ${EFF_SA}"
python3 - "$WORK" "$MK_SINJ" "$EFF_SA" <<'PY'
import json, sys
work, inj_marker, alice_marker = sys.argv[1:4]
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "iso-probe", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
# bob 以 alice 的 agent_id 写入（写路径无可见性过滤 → 预期可伪造）
store_forge = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_store", "arguments": {
        "agent_id": "human:iso-alice",
        "title": f"iso shared forged {inj_marker}",
        "content": f"forged row claiming to be alice; marker {inj_marker}."}}}
search_alice = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
    "name": "memory_search", "arguments": {"query": alice_marker, "limit": 5}}}
with open(f"{work}/session_y1.jsonl", "w") as f:
    for o in (init, inited, store_forge, search_alice):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY
run_session "Y1(bob 注入)" "$WORK/out_y1.jsonl" "$WORK/session_y1.jsonl" "${SH_BOB_ENV[@]}" \
  || die 50 "会话 Y1 失败"

set +e
python3 - "$WORK/out_y1.jsonl" "$MK_SINJ" "$EFF_SA" "$WORK/eff_sinj" "$WORK/forge" <<'PY'
import json, re, sys
path, inj_marker, alice_marker, eff_path, forge_path = sys.argv[1:6]
resp = {}
for line in open(path):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if "id" in o:
        resp[o["id"]] = o

def rtext(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

store = resp.get(2)
if store is None or "error" in store:
    print(f"[verify] P6 bob 注入写入异常: {json.dumps(store, ensure_ascii=False)[:300]}")
    sys.exit(50)
text = rtext(store)
forged = "human" in text and "iso-alice" in text
if "CONFLICT" in text and inj_marker not in text:
    m = re.search(r"ISO-SINJ-\d+-\d+", text)
    if not m:
        print(f"[verify] P6 bob 注入 CONFLICT 但提取不到既有标记: {text[:300]}")
        sys.exit(50)
    inj_marker = m.group(0)
    print(f"[verify] P6 bob 注入 CONFLICT → 生效标记 = {inj_marker}")
else:
    print(f"[verify] P6 bob 注入写入响应: {text[:160]}")
print(f"[verify] P6① 写路径可伪造 = {forged}（{'是：写入未按 caller 过滤，响应回显 alice 身份' if forged else '否：响应未回显 alice 身份，需人工复核'}）")
open(eff_path, "w").write(inj_marker)
open(forge_path, "w").write("yes" if forged else "no")

sa = resp.get(3)
if sa is None or "error" in sa:
    print(f"[verify] P6 bob 检索 alice 私有标记异常: {json.dumps(sa, ensure_ascii=False)[:300]}")
    sys.exit(50)
at = rtext(sa)
if alice_marker in at:
    print(f"[verify] P6② 读隔离失败：bob 在共享库中读到了 alice 的私有标记！")
    sys.exit(30)
print(f"[verify] P6② 读隔离成立：bob 读不到 alice 在共享库中的私有行（{'未命中' if alice_marker not in at else '命中'}）")
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die "$rc" "会话 Y1 校验未通过（退出码 ${rc}）"
EFF_SINJ="$(cat "$WORK/eff_sinj")"
FORGED="$(cat "$WORK/forge")"

log "P6 会话 Y2(bob 查注入行) + 会话 Z(alice 查注入行)"
python3 - "$WORK" "$EFF_SINJ" <<'PY'
import json, sys
work, inj_marker = sys.argv[1], sys.argv[2]
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "iso-probe", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
search_inj = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_search", "arguments": {"query": inj_marker, "limit": 5}}}
with open(f"{work}/session_y2.jsonl", "w") as f:
    for o in (init, inited, search_inj):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
with open(f"{work}/session_z.jsonl", "w") as f:
    for o in (init, inited, search_inj):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY
run_session "Y2(bob 查注入行)" "$WORK/out_y2.jsonl" "$WORK/session_y2.jsonl" "${SH_BOB_ENV[@]}" \
  || die 50 "会话 Y2 失败"
run_session "Z(alice 查注入行)" "$WORK/out_z.jsonl" "$WORK/session_z.jsonl" "${SH_ALICE_ENV[@]}" \
  || die 50 "会话 Z 失败"

set +e
python3 - "$WORK/out_y2.jsonl" "$WORK/out_z.jsonl" "$EFF_SINJ" <<'PY'
import json, sys
y_path, z_path, inj_marker = sys.argv[1:4]

def load(path):
    resp = {}
    for line in open(path):
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if "id" in o:
            resp[o["id"]] = o
    return resp

def rtext(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

y, z = load(y_path), load(z_path)
sit = rtext(y.get(2)) if y.get(2) else ""
bob_sees = inj_marker in sit
print(f"[verify] P6③ bob 查自己注入的标记 {inj_marker} → {'命中' if bob_sees else '未命中（该行归属 alice）'}")
szt = rtext(z.get(2)) if z.get(2) else ""
alice_sees = inj_marker in szt
print(f"[verify] P6③ alice 查被注入标记 → {'命中（他人以我名义写进了我的私有空间）' if alice_sees else '未命中'}")
if not alice_sees:
    print("[verify] P6 对照失败：alice 未看到 bob 以 alice 身份写入的标记，写路径伪造结论已变化")
    sys.exit(50)
if bob_sees:
    print("[verify] P6 对照失败：bob 看到了归属 alice 的注入行，读隔离结论已变化")
    sys.exit(50)
print("[verify] P6 结论：读隔离=True；写路径可伪造=True；注入行仅对 alice 可见")
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 50 "会话 Y2/Z 校验未通过（退出码 ${rc}）"

# ═══════════════════ 汇总 ═══════════════════
cat <<EOF

════════ iso-probe 证据汇总（标记前缀 ${STAMP}）════════
[A 组] P1a 漏设 AI_MEMORY_DB        → rc=${P1A_RC} / source=${P1A_SRC} / resolved=${P1A_RESOLVED}；fail-loud 且共享主库未变化 ← V1
       P1b 显式 AI_MEMORY_DB        → source=${P1B_SRC}（env 权威）
       config 顶层 'db =' 键计数     → ${CFG_DB_KEY}（必须为 0）
       P4  错设路径（父目录不存在）  → rc=${P4_RC} / overall=${P4_OVERALL}（fail-loud=${P4_LOUD}）
[B 组] P2  双用户物理隔离            → alice=${EFF_A} / bob=${EFF_B}；双向检索与 get 均不可见；属主 aimem:aimem；主库计数 ${MAIN_COUNT_BEFORE}→${MAIN_COUNT_AFTER}
       P3  doctor source（V4 本地版）→ ${P3_SRC}
       P5  每库维护通路             → alice=${CA} / bob=${CB} 条（各自独立）
[C 组] P6  方案②对照                → 写可伪造=${FORGED}；共享库 alice=${EFF_SA} / 注入=${EFF_SINJ}（详见上方 [verify] 行）
════════════════════════════════════════════════════════
EOF

log "全部通过：A 负向解析链（含 V1 fail-loud / 非共享主库 / 主库不变）+ B 方案③正向隔离 + C 方案②对照（标记 ${STAMP}）"
