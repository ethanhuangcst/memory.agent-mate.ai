#!/usr/bin/env bash
# limits-probe.sh — ai-memory v0.10.0 [limits] 行为探针
#
# 每次运行使用 /data/users/limits-probe 下的一次性数据库和全新身份；测试阈值只通过
# docker exec -e 注入，不改 config.toml。MCP 写入用于验证 daemon 计费路径（CLI 一次性写入
# 不计费，故不能用 `ai-memory store` 验配额）；quota-status 交叉核验**刻意不带注入 env** ——
# 配额行在首次写入时盖章，去掉 env 仍读到注入值才能证明真的生效。max_page_size /
# max_inflight_requests 是 HTTP 专属，本探针只断言设置小值不会影响 stdio。向量 hard-fail 的
# insert 返回 void，故以准确 ERROR 日志断言；该日志 target 是 `hnsw.eviction`，默认过滤器
# `ai_memory=info` 不覆盖它，故触顶会话须显式放宽 RUST_LOG。
#
# 用法：bash memory.agent-mate.ai/scripts/probes/limits-probe.sh [--self-test]
# 退出码：0 全通过；10 前置；20 配置；30 写入量；40 存储；50 链接；60 向量；70 stdio。
set -euo pipefail

CONTAINER="ai-memory-mcp"
STAMP="$(date +%s)-$$"
BASE_DIR="/data/users/limits-probe"
DB="${BASE_DIR}/limits-${STAMP}.db"
VECTOR_DB="${BASE_DIR}/limits-vector-${STAMP}.db"
WORK="$(mktemp -d)"
SELF_TEST=0

log() { printf '[limits-probe] %s\n' "$*" >&2; }
ok() { printf '[limits-probe][OK] %s\n' "$*" >&2; }
die() { local code="$1"; shift; log "失败(${code})：$*"; exit "$code"; }

cleanup() {
  rm -rf "$WORK"
  if docker ps --filter "name=${CONTAINER}" --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER"; then
    # 按唯一时间戳前缀通配，连带清掉上游 deferred-audit 旁路日志；目录空了也一并移除。
    docker exec -u 0 "$CONTAINER" sh -c "rm -f '${DB}'* '${VECTOR_DB}'*; rmdir '${BASE_DIR}' 2>/dev/null" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

case "${1:-}" in
  "") ;;
  --self-test) SELF_TEST=1 ;;
  *) die 10 "未知参数：${1}" ;;
esac

# 校验指定 tools/call 响应。mode=ok 要求成功；mode=quota 要求 QUOTA_EXCEEDED。
verify_call() {
  local path="$1" id="$2" mode="$3" code="$4"
  python3 - "$path" "$id" "$mode" "$code" <<'PY'
import json, sys
path, wanted, mode, code = sys.argv[1], int(sys.argv[2]), sys.argv[3], int(sys.argv[4])
responses = {}
for raw in open(path):
    raw = raw.strip()
    if not raw.startswith("{"):
        continue
    try:
        obj = json.loads(raw)
    except ValueError:
        continue
    if "id" in obj:
        responses[obj["id"]] = obj
call = responses.get(wanted)
if call is None:
    print("missing response id=%d" % wanted)
    sys.exit(code)
if "error" in call:
    text = json.dumps(call["error"], ensure_ascii=False)
    is_error = True
else:
    result = call.get("result") or {}
    text = " ".join(part.get("text", "") for part in result.get("content", []))
    is_error = bool(result.get("isError"))
if mode == "ok" and (is_error or "QUOTA_EXCEEDED" in text):
    print("expected success, got: %s" % text[:400])
    sys.exit(code)
if mode == "quota" and (not is_error or "QUOTA_EXCEEDED" not in text):
    print("expected QUOTA_EXCEEDED, got: %s" % text[:400])
    sys.exit(code)
print(text[:240])
PY
}

if [ "$SELF_TEST" -eq 1 ]; then
  printf '%s\n' '{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"stored"}]}}' > "$WORK/ok.jsonl"
  verify_call "$WORK/ok.jsonl" 2 ok 30 >/dev/null || die 10 "判定器正向 fixture 失败"
  set +e
  verify_call "$WORK/ok.jsonl" 2 quota 30 >/dev/null 2>&1
  rc=$?
  set -e
  [ "$rc" -eq 30 ] || die 10 "判定器负向 fixture 未以 30 拒绝（rc=${rc}）"
  ok "判定器自测通过：成功响应可识别，缺少 QUOTA_EXCEEDED 时 fail-closed"
  exit 0
fi

docker ps --filter "name=${CONTAINER}" --format '{{.Names}}' | grep -qx "$CONTAINER" \
  || die 10 "容器 ${CONTAINER} 未运行（先执行 local-up.sh）"
command -v python3 >/dev/null 2>&1 || die 10 "宿主机缺少 python3"

docker exec -u 0 "$CONTAINER" sh -c "mkdir -p '${BASE_DIR}' && chown -R aimem:aimem '${BASE_DIR}'" \
  || die 10 "无法准备一次性测试库目录 ${BASE_DIR}"

TEMPLATE="$(cd "$(dirname "$0")/../../deploy" && pwd)/config.toml.tmpl"  # scripts/probes/ ⇒ 仓根为上溯三级（ADR-021 目录分层后）
[ -f "$TEMPLATE" ] || die 20 "找不到 config.toml.tmpl"
python3 - "$TEMPLATE" <<'PY' || exit 20
import re, sys
text = open(sys.argv[1]).read()
expected = {
    "max_memories_per_day": "1000",
    "max_storage_bytes": "104857600",
    "max_links_per_day": "5000",
    "max_page_size": "1000",
    "max_inflight_requests": "0",
    "vector_index_capacity": "100000",
    "vector_index_hard_fail_at_cap": "false",
}
section = re.search(r"(?ms)^\[limits\]\s*$\n(.*?)(?=^\[|\Z)", text)
if not section:
    raise SystemExit("[limits] section missing")
body = section.group(1)
for key, value in expected.items():
    if not re.search(r"(?m)^\s*%s\s*=\s*%s(?:\s|#|$)" % (re.escape(key), re.escape(value)), body):
        raise SystemExit("missing/default drift: %s=%s" % (key, value))
for key in ("max_memories_per_day", "max_storage_bytes", "max_links_per_day"):
    match = re.search(r"(?m)^\s*%s\s*=\s*([^\s#]+)" % re.escape(key), body)
    if match and match.group(1) == "1":
        raise SystemExit("test threshold leaked into template: %s=1" % key)
PY
ok "模板七键等于 v0.10.0 编译默认，未混入测试阈值"

write_payloads() {
  python3 - "$WORK" "$STAMP" <<'PY'
import json, sys
work, stamp = sys.argv[1:3]
init = {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"limits-probe","version":"0"}}}
inited = {"jsonrpc":"2.0","method":"notifications/initialized"}
def call(i, name, args):
    return {"jsonrpc":"2.0","id":i,"method":"tools/call","params":{"name":name,"arguments":args}}
def dump(name, calls):
    with open("%s/%s.jsonl" % (work, name), "w") as f:
        for obj in [init, inited] + calls:
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")
def store(i, label, size=0):
    marker = "LIMIT-%s-%s" % (label, stamp)
    content = "quota probe %s; unique marker %s; payload %s" % (label, marker, "x" * size)
    return call(i, "memory_store", {"title":"limits probe %s" % marker, "content":content, "force":True})
dump("memory", [store(2, "memory-a"), store(3, "memory-b")])
dump("storage", [store(2, "storage", 128)])
dump("links", [store(2, "link-a"), store(3, "link-b"), store(4, "link-c")])
dump("vector-a", [store(2, "vector-a"), store(3, "vector-a2")])
dump("vector-b", [store(2, "vector-b")])
dump("stdio", [store(2, "stdio-a"), store(3, "stdio-b"), call(4, "memory_list", {"limit":2})])
PY
}
write_payloads

run_mcp() {
  local label="$1" profile="$2" agent="$3" payload="$4" out="$5" err="$6"; shift 6
  local db="$DB"
  if [ "$label" = "vector" ]; then db="$VECTOR_DB"; fi
  local args=(-e "AI_MEMORY_DB=${db}" -e "AI_MEMORY_AGENT_ID=${agent}" -e "AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0") kv
  for kv in "$@"; do args+=(-e "$kv"); done
  if ! docker exec -i "${args[@]}" "$CONTAINER" ai-memory mcp --tier smart --profile "$profile" \
      < "$payload" > "$out" 2> "$err"; then
    tail -10 "$err" >&2 || true
    return 1
  fi
  log "${label} 会话完成"
}

# 刻意**不传**注入用的 env：配额行在首次写入时盖章，去掉 env 仍读到注入值才能证明真的生效。
# namespace 必须是 `global` —— 那是 MCP `memory_store` 的默认命名空间（实测）；查错 ns 会让
# quota-status 现场另建一行并按默认值盖章，从而读出「注入没生效」的假象。
quota_json() {
  local agent="$1" out="$2"
  docker exec -e "AI_MEMORY_DB=${DB}" "$CONTAINER" ai-memory quota-status \
    --agent-id "$agent" --namespace global --json > "$out" 2> "$out.err"
}

assert_quota() {
  local path="$1" field="$2" expected="$3" code="$4"
  python3 - "$path" "$field" "$expected" "$code" <<'PY'
import json, sys
path, field, expected, code = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
try:
    obj = json.load(open(path))
    actual = obj["quota"][field]
except Exception as exc:
    print("quota JSON unreadable: %s" % exc)
    sys.exit(code)
if actual != expected:
    print("quota %s=%r, expected %r" % (field, actual, expected))
    sys.exit(code)
print("%s=%s" % (field, actual))
PY
}

MEM_AGENT="human:limits-memory-${STAMP}"
run_mcp "memories" core "$MEM_AGENT" "$WORK/memory.jsonl" "$WORK/memory.out" "$WORK/memory.err" \
  "AI_MEMORY_MAX_MEMORIES_PER_DAY=1" || die 30 "写入量会话异常退出"
verify_call "$WORK/memory.out" 2 ok 30 >/dev/null || die 30 "第一条写入未成功"
verify_call "$WORK/memory.out" 3 quota 30 >/dev/null || die 30 "第二条写入未被写入量配额拒绝"
quota_json "$MEM_AGENT" "$WORK/memory.quota" || die 30 "写入量 quota-status 失败"
assert_quota "$WORK/memory.quota" max_memories_per_day 1 30 >/dev/null \
  || die 30 "去掉注入 env 后配额行未保留注入值（盖章语义不成立）"
ok "max_memories_per_day=1：首条成功、第二条 QUOTA_EXCEEDED；去掉 env 复读仍为 1（配额行已盖章）"

STORAGE_AGENT="human:limits-storage-${STAMP}"
run_mcp "storage" core "$STORAGE_AGENT" "$WORK/storage.jsonl" "$WORK/storage.out" "$WORK/storage.err" \
  "AI_MEMORY_MAX_STORAGE_BYTES=1" || die 40 "存储配额会话异常退出"
verify_call "$WORK/storage.out" 2 quota 40 >/dev/null || die 40 "超字节写入未被拒绝"
quota_json "$STORAGE_AGENT" "$WORK/storage.quota" || die 40 "存储 quota-status 失败"
assert_quota "$WORK/storage.quota" max_storage_bytes 1 40 >/dev/null \
  || die 40 "去掉注入 env 后配额行未保留注入值（盖章语义不成立）"
ok "max_storage_bytes=1：首条超限写入 QUOTA_EXCEEDED；去掉 env 复读仍为 1（配额行已盖章）"

LINK_AGENT="human:limits-links-${STAMP}"
run_mcp "link setup" graph "$LINK_AGENT" "$WORK/links.jsonl" "$WORK/links.out" "$WORK/links.err" \
  "AI_MEMORY_MAX_LINKS_PER_DAY=1" || die 50 "链接准备会话异常退出"
for id in 2 3 4; do verify_call "$WORK/links.out" "$id" ok 50 >/dev/null || die 50 "链接准备写入 ${id} 失败"; done
python3 - "$WORK/links.out" "$WORK/link-calls.jsonl" <<'PY' || die 50 "无法从写入响应提取三个 memory id"
import json, re, sys
responses = {}
for raw in open(sys.argv[1]):
    try: obj = json.loads(raw)
    except ValueError: continue
    if "id" in obj: responses[obj["id"]] = obj
ids = []
for i in (2, 3, 4):
    text = " ".join(x.get("text", "") for x in responses.get(i, {}).get("result", {}).get("content", []))
    match = re.search(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", text)
    if not match: raise SystemExit("missing id in response %d: %s" % (i, text[:160]))
    ids.append(match.group(0))
init={"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"limits-probe","version":"0"}}}
inited={"jsonrpc":"2.0","method":"notifications/initialized"}
def link(i, target): return {"jsonrpc":"2.0","id":i,"method":"tools/call","params":{"name":"memory_link","arguments":{"source_id":ids[0],"target_id":target}}}
with open(sys.argv[2], "w") as f:
    for obj in (init, inited, link(2, ids[1]), link(3, ids[2])): f.write(json.dumps(obj)+"\n")
PY
run_mcp "links" graph "$LINK_AGENT" "$WORK/link-calls.jsonl" "$WORK/link-calls.out" "$WORK/link-calls.err" \
  "AI_MEMORY_MAX_LINKS_PER_DAY=1" || die 50 "链接配额会话异常退出"
verify_call "$WORK/link-calls.out" 2 ok 50 >/dev/null || die 50 "第一条链接未成功"
verify_call "$WORK/link-calls.out" 3 quota 50 >/dev/null || die 50 "第二条链接未被链接配额拒绝"
quota_json "$LINK_AGENT" "$WORK/links.quota" || die 50 "链接 quota-status 失败"
assert_quota "$WORK/links.quota" max_links_per_day 1 50 >/dev/null \
  || die 50 "去掉注入 env 后配额行未保留注入值（盖章语义不成立）"
ok "max_links_per_day=1：首条链接成功、第二条 QUOTA_EXCEEDED；去掉 env 复读仍为 1（配额行已盖章）"

VECTOR_AGENT="human:limits-vector-${STAMP}"
run_mcp "vector" core "$VECTOR_AGENT" "$WORK/vector-a.jsonl" "$WORK/vector-a.out" "$WORK/vector-a.err" \
  || die 60 "向量预置会话异常退出"
for id in 2 3; do verify_call "$WORK/vector-a.out" "$id" ok 60 >/dev/null || die 60 "向量预置写入 ${id} 未成功"; done
run_mcp "vector" core "$VECTOR_AGENT" "$WORK/vector-b.jsonl" "$WORK/vector-b.out" "$WORK/vector-b.err" \
  "AI_MEMORY_VECTOR_INDEX_CAPACITY=1" "AI_MEMORY_VECTOR_INDEX_HARD_FAIL=true" "RUST_LOG=info" \
  || die 60 "向量触顶会话异常退出"
grep -Fq "HNSW index ready (" "$WORK/vector-b.err" || die 60 "第二会话未完成阻塞预热，触顶判定前提不成立"
verify_call "$WORK/vector-b.out" 2 ok 60 >/dev/null || die 60 "向量 hard-fail 不应回滚数据库写入"
grep -Fq "vector index at capacity: rejecting insert (hard-fail-at-cap mode)" "$WORK/vector-b.err" \
  || { tail -20 "$WORK/vector-b.err" >&2 || true; die 60 "未观察到 v0.10.0 向量触顶 ERROR 字面量"; }
ok "vector capacity=1 + hard-fail：预热 ≥1 条后插入被拒（hnsw.eviction ERROR），DB 写入仍成功"

STDIO_AGENT="human:limits-stdio-${STAMP}"
run_mcp "stdio-only controls" core "$STDIO_AGENT" "$WORK/stdio.jsonl" "$WORK/stdio.out" "$WORK/stdio.err" \
  "AI_MEMORY_MAX_PAGE_SIZE=1" "AI_MEMORY_MAX_INFLIGHT_REQUESTS=1" \
  || die 70 "stdio 非生效对照会话异常退出"
for id in 2 3 4; do verify_call "$WORK/stdio.out" "$id" ok 70 >/dev/null || die 70 "HTTP 专属小阈值影响了 stdio 调用 ${id}"; done
python3 - "$WORK/stdio.out" "$STAMP" <<'PY' || die 70 "stdio memory_list(limit=2) 未返回两条测试记忆"
import json, sys
responses={}
for raw in open(sys.argv[1]):
    try: obj=json.loads(raw)
    except ValueError: continue
    if "id" in obj: responses[obj["id"]]=obj
text=" ".join(x.get("text","") for x in responses.get(4,{}).get("result",{}).get("content",[]))
for label in ("stdio-a", "stdio-b"):
    if "LIMIT-%s-%s" % (label, sys.argv[2]) not in text:
        raise SystemExit("missing %s in list result: %s" % (label, text[:300]))
PY
ok "max_page_size=1 / max_inflight_requests=1 对 stdio 无副作用；HTTP 超限留 Sprint 5 验证"

cat <<EOF

limits-probe 通过（一次性库 ${DB}）
- 写入量、存储字节、链接：MCP 超限明确返回 QUOTA_EXCEEDED，quota-status 与注入阈值一致
- 向量索引：capacity=1 且 hard-fail=true 时出现上游准确 ERROR；记忆行仍落库
- page size / inflight requests：HTTP 专属；小阈值不影响 stdio MCP
EOF
