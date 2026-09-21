#!/usr/bin/env bash
# mcp-smoke.sh — MCP stdio 协议冒烟（对本地常驻基线容器，Sprint 2 #4 验收探针）
#
# 前置：local-up.sh 已启动（容器 ai-memory-mcp 常驻运行）。
# 调用方式与生产 SSH forced command 逐字同构：
#   docker exec -i ai-memory-mcp ai-memory mcp --tier smart   （-i 不加 -t，pty 会破坏 stdio 帧）
#
# 会话 A（写入）：initialize 握手 → tools/list 断言 core 档 8 工具（依据
#                specs/mcp/mcp-design.md §8，v0.10.0 实测名单：
#                store/recall/search/list/load_family/smart_load/get/capabilities）
#                → memory_store 写入含唯一标记的自然语句（schema 实证：必填 content + title）
# 会话 B（召回，新 docker exec 进程 = 跨进程验证持久化）：
#   ① memory_recall（语义召回，required: context）——查询词【不含标记字面量】，
#      命中即证明 embedder 工作在语义模式（静默失败点 #1 的行为级证据）
#   ② memory_search（关键词/全文检索）——用标记字面量查询，命中即证明检索通路与持久化
#   ※ 上游文档未讲清 recall 与 search 的差别，此语义区分来自 v0.10.0 实测（详见 specs/knowledge）
#
# 会话 C（attestation 正负对照 = TC-ATT-01）：
#   正：会话 A 的写入本身即「容器级 AI_MEMORY_REQUIRE_AGENT_ATTESTATION=0 下可用」的证据
#   负：同形态写入加 -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=1（全局严格）**必须被拒**
#   ※ 这是「该 env 仍被上游读取」的唯一可靠判据。`attest_level=claimed` **不可断言** ——
#     它是上游文档与启动告警的措辞（daemon 绑非回环且宽松时才打印），v0.10.0 的 MCP 响应
#     / memory_get / export / memories 表均不暴露该值（实测 2026-09-21，见 specs/knowledge）
#
# 幂等性：core 档无删除工具，无法清理旧冒烟记忆；上游 near-duplicate 去重会让重复运行时
#        memory_store 返回 CONFLICT。此时自动转为验证 CONFLICT 指向的既有近似记忆的标记
#        （通路验证目的一致）；输出会明确标注当前生效的标记。
#
# 每次成功写入会在本地基线库留 1 条冒烟记忆；断言只匹配生效标记，不受更早历史干扰。
# 超时：docker exec -i 在 payload EOF 后自然结束（实测秒级返回），不依赖 GNU timeout。
# 密钥纪律：本脚本不读 env、不打印容器环境；失败时仅打印 MCP 响应与容器日志尾部辅助分诊。
#
# 用法：bash memory.agent-mate.ai/scripts/mcp-smoke.sh
# 退出码：0 全通过；10 前置失败（容器未运行）；20 握手或工具数断言失败；
#         30 写入失败（含 CONFLICT 但无法提取既有标记）；40 召回未命中/失败；
#         50 attestation 负向对照失败（=1 未拒绝，或拒绝原因非 attestation）

set -euo pipefail

CONTAINER="ai-memory-mcp"
EXPECTED_TOOLS=8
# 唯一标记：epoch 秒 + PID，避免同秒重复运行串扰
MARKER="mcp-smoke-$(date +%s)-$$"

log() { printf '[mcp-smoke] %s\n' "$*" >&2; }
die() { local code="$1"; shift; log "失败($code)：$*"; exit "$code"; }

# ── 前置：容器须常驻运行 ──
docker ps --filter "name=$CONTAINER" --format '{{.Names}}' | grep -qx "$CONTAINER" \
  || die 10 "容器 $CONTAINER 未运行（先执行 bash memory.agent-mate.ai/scripts/local-up.sh）"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── 会话 A 的 payload（json.dumps 负责转义，不手拼 JSON）──
python3 - "$WORK" "$MARKER" <<'PY'
import json, sys
work, marker = sys.argv[1], sys.argv[2]
title = f"MCP 冒烟写入 {marker}"
content = (f"这是通过 MCP stdio 协议写入的冒烟记忆，唯一标记为 {marker}。"
           f"主题：本地基线的协议通路验证——写入与语义召回。")
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "mcp-smoke", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
tools_list = {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}
store = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
    "name": "memory_store", "arguments": {"title": title, "content": content}}}
with open(f"{work}/session_a.jsonl", "w") as f:
    for o in (init, inited, tools_list, store):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY

# ── 会话 A：握手 + 工具数断言 + 写入 ──
log "会话 A：initialize / tools/list（断言 ${EXPECTED_TOOLS} 工具）/ memory_store  标记=${MARKER}"
if ! docker exec -i "$CONTAINER" ai-memory mcp --tier smart \
      < "$WORK/session_a.jsonl" > "$WORK/out_a.jsonl" 2> "$WORK/err_a.log"; then
  tail -5 "$WORK/err_a.log" >&2 || true
  die 30 "会话 A 进程异常退出（上方为容器侧日志尾部）"
fi

set +e
python3 - "$WORK/out_a.jsonl" "$EXPECTED_TOOLS" "$MARKER" "$WORK/effective_marker" <<'PY'
import json, re, sys
path, expected, marker, out_path = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
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

def result_text(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

# 1) initialize：握手回包须有 result 且服务端是 ai-memory
init = resp.get(1)
r = (init or {}).get("result") or {}
if not init or not r or r.get("serverInfo", {}).get("name") != "ai-memory":
    print(f"[verify] initialize 异常: {json.dumps(init, ensure_ascii=False)[:300]}")
    sys.exit(20)
print(f"[verify] initialize ok: serverInfo={r['serverInfo']}")

# 2) tools/list：断言工具数与关键工具在列
tl = resp.get(2)
tools = ((tl or {}).get("result") or {}).get("tools") or []
names = sorted(t["name"] for t in tools)
if len(tools) != expected:
    print(f"[verify] 工具数 {len(tools)} != 预期 {expected}；实际清单: {names}")
    sys.exit(20)
for must in ("memory_store", "memory_search", "memory_recall", "memory_capabilities"):
    if must not in names:
        print(f"[verify] 缺关键工具 {must}；实际清单: {names}")
        sys.exit(20)
print(f"[verify] tools/list ok: {len(tools)} 工具（core 档 + always-on）: {names}")

# 3) memory_store：成功写入，或 near-duplicate CONFLICT（改验既有标记）
call = resp.get(3)
if call is None:
    print(f"[verify] memory_store 无响应；原始输出前 300 字: {open(path).read()[:300]}")
    sys.exit(30)
if "error" in call:
    print(f"[verify] memory_store 返回 error: {json.dumps(call['error'], ensure_ascii=False)[:300]}")
    sys.exit(30)
text = result_text(call)
if "CONFLICT" in text and marker not in text:
    # 上游 near-duplicate 去重：本次内容与库中既有冒烟记忆语义近似，写入被拒
    m = re.search(r"mcp-smoke-\d+-\d+", text)
    if not m:
        print(f"[verify] 写入 CONFLICT 但无法提取既有标记: {text[:300]}")
        sys.exit(30)
    effective = m.group(0)
    print(f"[verify] memory_store CONFLICT（near-duplicate 去重生效）：改验既有标记 {effective}")
else:
    effective = marker
    print(f"[verify] memory_store ok: {text[:160]}")
with open(out_path, "w") as f:
    f.write(effective)
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die "$rc" "会话 A 校验未通过（退出码 ${rc}）"

EFFECTIVE_MARKER="$(cat "$WORK/effective_marker")"

# ── 会话 B 的 payload（依赖会话 A 得到的生效标记）──
python3 - "$WORK" "$EFFECTIVE_MARKER" <<'PY'
import json, sys
work, marker = sys.argv[1], sys.argv[2]
# 语义查询词：描述主题但不含标记字面量 → 只有语义检索能命中
semantic_query = "通过 MCP 协议写入的冒烟记忆与语义召回验证"
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "mcp-smoke", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
recall = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_recall", "arguments": {"context": semantic_query}}}
search = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
    "name": "memory_search", "arguments": {"query": marker, "limit": 5}}}
with open(f"{work}/session_b.jsonl", "w") as f:
    for o in (init, inited, recall, search):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY

# ── 会话 B：跨进程语义召回 + 关键词检索（新 docker exec 进程，同容器同卷同库）──
log "会话 B：memory_recall（语义，不含标记字面量）+ memory_search（标记字面量 ${EFFECTIVE_MARKER}）"
if ! docker exec -i "$CONTAINER" ai-memory mcp --tier smart \
      < "$WORK/session_b.jsonl" > "$WORK/out_b.jsonl" 2> "$WORK/err_b.log"; then
  tail -5 "$WORK/err_b.log" >&2 || true
  die 40 "会话 B 进程异常退出（上方为容器侧日志尾部）"
fi

set +e
python3 - "$WORK/out_b.jsonl" "$EFFECTIVE_MARKER" <<'PY'
import json, sys
path, marker = sys.argv[1], sys.argv[2]
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

def result_text(call):
    return " ".join(c.get("text", "") for c in call.get("result", {}).get("content", []))

init = resp.get(1)
if not init or not init.get("result"):
    print(f"[verify] 会话 B initialize 异常: {json.dumps(init, ensure_ascii=False)[:300]}")
    sys.exit(20)

# 1) memory_recall：语义召回（查询词不含标记字面量），断言结果含生效标记
recall = resp.get(2)
if recall is None:
    print(f"[verify] memory_recall 无响应；原始输出前 300 字: {open(path).read()[:300]}")
    sys.exit(40)
if "error" in recall:
    print(f"[verify] memory_recall 返回 error: {json.dumps(recall['error'], ensure_ascii=False)[:300]}")
    sys.exit(40)
rtext = result_text(recall)
if marker not in rtext:
    print(f"[verify] 语义召回未命中生效标记 {marker}")
    print(f"[verify] recall 结果前 300 字: {rtext[:300]}")
    print("[verify] 分诊：doctor 的 Embeddings Reachability 若非 200/1024-dim → embedder 降级（静默失败点 #1）")
    sys.exit(40)
print(f"[verify] memory_recall ok: 语义召回命中标记 {marker}")
print(f"[verify] recall 摘要: {rtext[:200]}")

# 2) memory_search：标记字面量关键词检索，断言命中（持久化 + 检索通路）
search = resp.get(3)
if search is None or "error" in search:
    print(f"[verify] memory_search 异常: {json.dumps(search, ensure_ascii=False)[:300]}")
    sys.exit(40)
stext = result_text(search)
if marker not in stext:
    print(f"[verify] 关键词检索未命中标记 {marker}；结果前 300 字: {stext[:300]}")
    sys.exit(40)
print(f"[verify] memory_search ok: 标记字面量命中（持久化 + 检索通路）")
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die "$rc" "会话 B 校验未通过（退出码 ${rc}）"

# ── 会话 C：attestation 负向对照（TC-ATT-01 的可断言一半）──
NEG_MARKER="ATT-C-$(date +%s)-$$"
python3 - "$WORK" "$NEG_MARKER" <<'PY'
import json, sys
work, marker = sys.argv[1], sys.argv[2]
init = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "mcp-smoke", "version": "0"}}}
inited = {"jsonrpc": "2.0", "method": "notifications/initialized"}
store = {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {
    "name": "memory_store", "arguments": {
        "title": f"attestation negative control {marker}",
        "content": (f"negative control write that must be rejected while agent attestation "
                    f"is globally strict; marker {marker}.")}}}
with open(f"{work}/session_c.jsonl", "w") as f:
    for o in (init, inited, store):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")
PY

log "会话 C：attestation 负向对照（-e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=1，期望被拒）标记=${NEG_MARKER}"
if ! docker exec -i -e AI_MEMORY_REQUIRE_AGENT_ATTESTATION=1 "$CONTAINER" ai-memory mcp --tier smart \
      < "$WORK/session_c.jsonl" > "$WORK/out_c.jsonl" 2> "$WORK/err_c.log"; then
  tail -5 "$WORK/err_c.log" >&2 || true
  die 50 "会话 C 进程异常退出（上方为容器侧日志尾部）"
fi

set +e
python3 - "$WORK/out_c.jsonl" <<'PY'
import json, sys
resp = {}
for line in open(sys.argv[1]):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if "id" in o:
        resp[o["id"]] = o

call = resp.get(2)
if call is None or "error" in call or not call.get("result"):
    print(f"[verify] 负向对照异常（无 tools/call 结果）: {json.dumps(call, ensure_ascii=False)[:300]}")
    sys.exit(50)
r = call["result"]
text = " ".join(c.get("text", "") for c in r.get("content", []))
if not r.get("isError"):
    print("[verify] 负向对照失败：=1 时写入**未被拒** —— 该 env 可能已失效或被上游改名")
    print(f"[verify] 响应片段: {text[:200]}")
    sys.exit(50)
if "attestation" not in text.lower():
    print(f"[verify] 负向对照失败：被拒但原因不是 attestation: {text[:200]}")
    sys.exit(50)
print(f"[verify] 负向对照成立：=1 拒绝无签名写入 → {text[:110]}…")
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die "$rc" "会话 C 校验未通过（退出码 ${rc}）"

log "全部通过：握手 / ${EXPECTED_TOOLS} 工具断言 / 写入 / 跨进程语义召回 + 关键词检索（生效标记 ${EFFECTIVE_MARKER}）/ attestation 正负对照（=0 可写、=1 被拒）"
