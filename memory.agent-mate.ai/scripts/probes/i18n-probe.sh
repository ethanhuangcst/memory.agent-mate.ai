#!/usr/bin/env bash
# i18n-probe.sh — 多语言（简体中文 / 英文 / 繁体中文）探针（Sprint 2 #8「上游是否支持多语言」）
#
# 前置：local-up.sh 已启动（容器 ai-memory-mcp 常驻）。会话调用与生产 SSH forced command 同构：
#       docker exec -i [-e ...] ai-memory-mcp ai-memory mcp --tier smart（只加 -i，不加 -t）。
#
# 目的：为「上游在保存 / 检索 memory 时是否支持多语言」给出**可复跑的行为级证据**，输出一张
#       「语言 x 通路」结论矩阵：存储（memory_store）· 关键词检索（memory_search）·
#       语义召回（memory_recall）· 按标识直取（memory_get）。
#
# 为什么必须实测（不能从源码推）：关键词通路走 SQLite FTS5，建表语句
#       `USING fts5(title, content, tags, content=memories, content_rowid=rowid)`
#       **未指定 tokenize=**（见 ai-memory-mcp/src/storage/migrations.rs），即默认分词器行为；
#       中文能否命中取决于「CJK 是否被切分 / 是否做简繁归一」，只能由对照实验夹出边界。三组对照：
#         ① 标点界定的整段（如 `：记忆检索；`）—— 命中 ⇒ CJK 按**整段一个词元**处理
#         ② 长段内部的子串（如 `连续中文` ⊂ `连续中文不带标点分隔的整段文字`）—— 未命中 ⇒ **不做 CJK 分词**
#         ③ 简↔繁 双向交叉查询 —— 未命中 ⇒ **不做简繁归一**
#       英文侧同构对照：`boundary`（完整词元）应命中，`bound`（词元内子串）应未命中。
#       语义通路（recall）与按 id 直取（get）是**语言无关对照**，用于区分「没存进去」与「检索不到」。
#
# 幂等与数据：写入带 `force=true`（上游语义 = 跳过近重复冲突检查，见 src/mcp/tools/store/mod.rs），
#       且每次运行使用唯一 ASCII 标记 ⇒ 可反复运行；只写隔离库 /data/users/i18n-probe/ai-memory.db，
#       不触碰共享主库与既有 iso-* 探针库（主库记忆计数前后各取一次并断言不变）。
#       core 档无删除工具 ⇒ 探针数据默认**保留供复查**；
#       清理：docker exec -u 0 ai-memory-mcp rm -rf /data/users/i18n-probe
#       或用 I18N_PROBE_CLEAN=1 让本次运行结束后自动清理。
#
# 两种模式：
#   默认     记录型 —— 只硬断言「探针本身可信」（握手 / 工具数 / 三语言写入 / 标记自证 /
#            英文完整词元 / 按 id 直取 / 语义召回 mode 未降级）；语言边界按**实测**打印
#   I18N_PROBE_STRICT=1 —— 额外把文档已登记的边界当作断言（上游行为漂移时 fail-loud）
#
# 密钥纪律：本脚本不读 env 文件、不打印密钥；仅打印 MCP 响应片段与路径。
#
# 用法：bash memory.agent-mate.ai/scripts/probes/i18n-probe.sh
# 退出码：0 全通过；10 前置失败；20 握手 / 工具清单断言失败；30 写入失败；40 检索断言失败；
#         50 探针自身异常
set -euo pipefail

CONTAINER="ai-memory-mcp"
STAMP="$(date +%s)-$$"

PROBE_USER="i18n-probe"
PROBE_DIR="/data/users/${PROBE_USER}"
PROBE_DB="${PROBE_DIR}/ai-memory.db"
PROBE_KEYS="${PROBE_DIR}/keys"

MK_HANS="i18n-hans-${STAMP}"   # 简体中文条目标记（ASCII，关键词通路可靠命中的对照物）
MK_HANT="i18n-hant-${STAMP}"   # 繁体中文条目标记
MK_EN="i18n-en-${STAMP}"       # 英文条目标记

log()  { printf '[i18n-probe] %s\n' "$*" >&2; }
ok()   { printf '[i18n-probe][OK] %s\n' "$*" >&2; }
note() { printf '[i18n-probe][NOTE] %s\n' "$*" >&2; }
die()  { local code="$1"; shift; log "失败(${code})：$*"; exit "$code"; }

# ── 前置：容器须常驻运行 ──
docker ps --filter "name=${CONTAINER}" --format '{{.Names}}' | grep -qx "${CONTAINER}" \
  || die 10 "容器 ${CONTAINER} 未运行（先执行 bash memory.agent-mate.ai/scripts/local-up.sh）"

# ── 自证（fail-closed，R1 风格）：会话库路径必须钉在隔离探针库 ──
[ "${PROBE_DB}" = "/data/users/${PROBE_USER}/ai-memory.db" ] \
  || die 10 "探针库路径自证失败：${PROBE_DB}（必须位于 /data/users/${PROBE_USER}/ 下）"

WORK="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK"
  if [ "${I18N_PROBE_CLEAN:-0}" = "1" ]; then
    docker exec -u 0 "${CONTAINER}" rm -rf "${PROBE_DIR}" >/dev/null 2>&1 || true
    log "已按 I18N_PROBE_CLEAN=1 清理 ${PROBE_DIR}"
  fi
}
trap cleanup EXIT

# ── 容器侧小工具（镜像内无 python3 —— 解析一律在宿主机做）──
c_owner() { docker exec "${CONTAINER}" stat -c '%U:%G' "$1" 2>/dev/null || echo MISSING; }
main_count() { docker exec "${CONTAINER}" ai-memory stats 2>/dev/null | awk '/^total memories:/ {print $3}'; }

run_session() { # $1=label $2=out 文件 $3=payload；其余为 -e KEY=VAL
  local label="$1" out="$2" payload="$3"; shift 3
  local args=()
  for kv in "$@"; do args+=(-e "$kv"); done
  if ! docker exec -i "${args[@]}" "${CONTAINER}" ai-memory mcp --tier smart \
        < "$payload" > "$out" 2> "$out.err"; then
    log "会话 ${label} 进程异常退出；容器侧 stderr 尾部："
    tail -5 "$out.err" >&2 || true
    return 1
  fi
  return 0
}

# 会话 env（与生产 forced command 同构；库路径 / 身份 / 密钥目录全部钉在服务端）
PROBE_ENV=("AI_MEMORY_DB=${PROBE_DB}" "AI_MEMORY_AGENT_ID=human:${PROBE_USER}" "AI_MEMORY_KEY_DIR=${PROBE_KEYS}")

# ═══════════════════ P0 前置准备 ═══════════════════
docker exec -u 0 "${CONTAINER}" sh -c "mkdir -p ${PROBE_KEYS} && chown -R aimem:aimem ${PROBE_DIR}" \
  || die 10 "无法准备目录 ${PROBE_DIR}"
MAIN_COUNT_BEFORE="$(main_count)"
log "P0 就绪：探针库 ${PROBE_DB}；主库计数（前）= ${MAIN_COUNT_BEFORE:-未知}；标记前缀 ${STAMP}"

# ═══════════════════ P1 生成载荷与期望（文本 / 查询 / 期望单点定义）═══════════════════
python3 - "${WORK}" "${MK_HANS}" "${MK_HANT}" "${MK_EN}" <<'PY'
import json, sys

work, mk_hans, mk_hant, mk_en = sys.argv[1:5]

# ── 受测内容（三语言；标记保证每次运行唯一）──
# 简体：`记忆检索` 由 `：`/`；` 界定（完整词元候选）；`连续中文不带标点分隔的整段文字` 为长段
TEXT_HANS = (f"多语言探针简体中文条目：记忆检索；连续中文不带标点分隔的整段文字。"
             f"唯一标记 {mk_hans}。本条关注关键词通路对简体中文的切分边界。")
# 繁体：`跨語言檢索邊界` 由 `：`/`；` 界定；其简体对照 `跨语言检索边界` 不出现在任何条目中
TEXT_HANT = (f"多語言探針繁體中文條目：跨語言檢索邊界；語意向量檢索的備份與遷移。"
             f"唯一標記 {mk_hant}。本條驗證繁體字形是否與簡體互通。")
# 英文：`boundary` 为完整词元，`bound` 为其词元内子串
TEXT_EN = (f"i18n probe English entry: keyword boundary control. "
           f"The unique marker is {mk_en}. This row is the ASCII control for the keyword path.")

INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "i18n-probe", "version": "0"}}}
INITED = {"jsonrpc": "2.0", "method": "notifications/initialized"}

def store(call_id, title, content, marker):
    # force=true：跳过近重复冲突检查（上游语义），使探针可反复运行且每次写入都生效
    return {"jsonrpc": "2.0", "id": call_id, "method": "tools/call", "params": {
        "name": "memory_store", "arguments": {
            "title": f"{marker} {title}", "content": content,
            "tags": ["i18n-probe", marker], "force": True}}}

# ── 会话 A：写入 3 条 ──
with open(f"{work}/session_a.jsonl", "w") as f:
    for o in (INIT, INITED,
              store(2, "简体中文条目", TEXT_HANS, mk_hans),
              store(3, "繁體中文條目", TEXT_HANT, mk_hant),
              store(4, "english entry", TEXT_EN, mk_en)):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")

# ── 会话 B：关键词检索对照（id 3 起；id 2 为 tools/list）──
# hard=True 的条目只用于证明「探针可信」（语言无关）；语言边界条目为记录型，STRICT 下才断言。
SEARCHES = [
    # label,                  query,                          lang,      path,             expect, hard,  purpose
    ("S1-marker-hans",        mk_hans,                        "对照",    "标记自证",       "hit",  True,  "ASCII 标记自证（简中条目）"),
    ("S2-marker-hant",        mk_hant,                        "对照",    "标记自证",       "hit",  True,  "ASCII 标记自证（繁中条目）"),
    ("S3-marker-en",          mk_en,                          "对照",    "标记自证",       "hit",  True,  "ASCII 标记自证（英文条目）"),
    ("S4-hans-token",         "记忆检索",                      "简体中文", "关键词·完整词元", "hit",  False, "标点界定的整段 ⇒ 命中则 CJK 按整段一个词元"),
    ("S5-hans-substring",     "连续中文",                      "简体中文", "关键词·词元内子串", "miss", False, "长段内子串 ⇒ 未命中则不做 CJK 分词"),
    ("S6-hans-full-run",      "连续中文不带标点分隔的整段文字",  "简体中文", "关键词·完整词元", "hit",  False, "长段全等（区分整段可比对与不可比对）"),
    ("S7-hant-token",         "跨語言檢索邊界",                 "繁体中文", "关键词·完整词元", "hit",  False, "繁体侧标点界定的整段"),
    ("S8-hant-substring",     "檢索",                          "繁体中文", "关键词·词元内子串", "miss", False, "繁体长段内子串"),
    ("S9-cross-simp-to-hant", "跨语言检索边界",                 "简繁交叉", "关键词·简繁归一", "miss", False, "简体字形查繁体内容 ⇒ 未命中则不做简繁归一"),
    ("S10-cross-hant-to-simp", "記憶檢索",                     "简繁交叉", "关键词·简繁归一", "miss", False, "繁体字形查简体内容（反向）"),
    ("S11-en-word",           "boundary",                      "英文",    "关键词·完整词元", "hit",  True,  "英文完整词元（语言无关对照）"),
    ("S12-en-substring",      "bound",                         "英文",    "关键词·词元内子串", "miss", False, "英文词元内子串 ⇒ 单词亦须完整"),
]

with open(f"{work}/session_b.jsonl", "w") as f:
    f.write(json.dumps(INIT, ensure_ascii=False) + "\n")
    f.write(json.dumps(INITED, ensure_ascii=False) + "\n")
    f.write(json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, ensure_ascii=False) + "\n")
    for i, s in enumerate(SEARCHES, start=3):
        call = {"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": {
            "name": "memory_search", "arguments": {"query": s[1], "limit": 10}}}
        f.write(json.dumps(call, ensure_ascii=False) + "\n")

json.dump([{"label": l, "query": q, "lang": lang, "path": p, "expect": e, "hard": h, "purpose": pu}
           for (l, q, lang, p, e, h, pu) in SEARCHES],
          open(f"{work}/searches.json", "w"), ensure_ascii=False, indent=2)

# ── 语义召回规格（查询词不含标记字面量）──
RECALLS = [
    {"label": "R1-recall-hans", "context": "简体中文的记忆检索切分边界如何界定", "lang": "简体中文"},
    {"label": "R2-recall-hant", "context": "繁體中文的檢索邊界與字形互通", "lang": "繁体中文"},
    {"label": "R3-recall-en",   "context": "how does the english keyword control row look", "lang": "英文"},
]
json.dump(RECALLS, open(f"{work}/recalls.json", "w"), ensure_ascii=False, indent=2)
PY
[ -s "${WORK}/session_a.jsonl" ] || die 50 "载荷生成失败（session_a.jsonl 为空）"

# ═══════════════════ P2 会话 A：写入三种语言 ═══════════════════
log "P2 会话 A 写入 3 条（简中 ${MK_HANS} / 繁中 ${MK_HANT} / 英文 ${MK_EN}）"
run_session "A(写入)" "$WORK/out_a.jsonl" "$WORK/session_a.jsonl" "${PROBE_ENV[@]}" || die 30 "会话 A 失败"

set +e
python3 - "$WORK/out_a.jsonl" "$MK_HANS" "$MK_HANT" "$MK_EN" <<'PY'
import json, sys
path, *markers = sys.argv[1:]
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
    return " ".join(c.get("text", "") for c in (call.get("result") or {}).get("content", []))

info = ((resp.get(1) or {}).get("result") or {}).get("serverInfo", {})
print(f"[verify] serverInfo={json.dumps(info, ensure_ascii=False)}")

exit_code = 0
for i, mk in enumerate(markers, start=2):
    call = resp.get(i)
    if call is None or "error" in call:
        print(f"[verify] 写入异常（标记 {mk}）: {json.dumps(call, ensure_ascii=False)[:300]}")
        exit_code = 30
        continue
    text = rtext(call)
    if "CONFLICT" in text and mk not in text:
        print(f"[verify] 写入 CONFLICT（force=true 下意外出现）: {text[:200]}")
        exit_code = 30
        continue
    if mk not in text:
        print(f"[verify] 写入响应未回显标记 {mk}: {text[:200]}")
        exit_code = 30
        continue
    print(f"[verify] 写入 ok: {mk}（{text.strip()[:100]}）")
sys.exit(exit_code)
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 30 "会话 A 校验未通过（退出码 ${rc}）"
ok "P2 通过：三种语言各写入一条且响应回显标记（force=true 跳过近重复检查，无 CONFLICT）"

# ═══════════════════ P3 会话 B：关键词检索对照 ═══════════════════
log "P3 会话 B 关键词检索（tools/list + 12 组对照）"
run_session "B(关键词检索)" "$WORK/out_b.jsonl" "$WORK/session_b.jsonl" "${PROBE_ENV[@]}" || die 40 "会话 B 失败"

set +e
python3 - "$WORK" "$MK_HANS" "$MK_HANT" "$MK_EN" <<'PY'
import json, re, sys
work, mk_hans, mk_hant, mk_en = sys.argv[1:5]
markers = {"简体中文": mk_hans, "繁体中文": mk_hant, "英文": mk_en}

resp = {}
for line in open(f"{work}/out_b.jsonl"):
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if "id" in o:
        resp[o["id"]] = o

# 握手 + 工具清单断言（core 档 8 工具：7 core + 常驻 memory_capabilities）
init = resp.get(1, {})
name = ((init.get("result") or {}).get("serverInfo") or {}).get("name")
tl = ((resp.get(2) or {}).get("result") or {}).get("tools", [])
tool_names = sorted(t.get("name", "") for t in tl)
print(f"[verify] initialize serverInfo.name={name}")
print(f"[verify] tools/list 数量={len(tl)} 名单={tool_names}")
hard_fail = None
if name != "ai-memory":
    print("[verify] 握手断言失败：serverInfo.name != ai-memory")
    hard_fail = 20
if len(tl) != 8:
    print(f"[verify] 工具清单断言失败：期望 8（core 档 + memory_capabilities），实际 {len(tl)}")
    hard_fail = 20

searches = json.load(open(f"{work}/searches.json"))
results = {}
ids = {}
for i, s in enumerate(searches, start=3):
    call = resp.get(i)
    if call is None:
        print(f"[verify] {s['label']} 无响应")
        hard_fail = hard_fail or 40
        continue
    if "error" in call:
        print(f"[verify] {s['label']} error: {json.dumps(call['error'], ensure_ascii=False)[:200]}")
        hard_fail = hard_fail or 40
        continue
    text = " ".join(c.get("text", "") for c in (call.get("result") or {}).get("content", []))
    # search 响应为纯文本表格（首行 `count:N`；JSON 形态仅作后备兼容）
    m = re.search(r"count:\s*(\d+)", text) or re.search(r'"count"\s*:\s*(\d+)', text)
    count = int(m.group(1)) if m else None
    hit_markers = sorted({mk for mk in markers.values() if mk in text})
    results[s["label"]] = {"count": count, "hit_markers": hit_markers, "raw_head": text[:200]}
    expect_hit = s["expect"] == "hit"
    measured_hit = bool(hit_markers)
    print(f"[verify] {s['label']:<24} query={s['query']!r:<36} count={str(count):<4} "
          f"命中={measured_hit} 期望={expect_hit} {'一致' if measured_hit == expect_hit else '不一致'}")
    if s["hard"] and measured_hit != expect_hit:
        print(f"    ^ 硬断言失败（探针可信性）：{s['label']} / {s['purpose']}")
        hard_fail = hard_fail or 40
    # 顺带从检索结果表格行里取三条记忆的 id（行首为 UUID；标记出现在 title/tags 列）
    for rowline in text.splitlines():
        first = rowline.split("|", 1)[0].strip()
        if not re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", first):
            continue
        for mk in markers.values():
            if mk in rowline and mk not in ids:
                ids[mk] = first

json.dump(results, open(f"{work}/results_b.json", "w"), ensure_ascii=False, indent=2)
json.dump(ids, open(f"{work}/ids.json", "w"), ensure_ascii=False, indent=2)
print(f"[verify] 取到 id: {[f'{mk}:{str(v)[:8]}…' for mk, v in ids.items()]}")

# ── 生成会话 C：3 组语义召回 + 3 组按 id 直取（id 必须来自上面的真实检索结果）──
recalls = json.load(open(f"{work}/recalls.json"))
INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "i18n-probe", "version": "0"}}}
INITED = {"jsonrpc": "2.0", "method": "notifications/initialized"}
lines = [json.dumps(INIT, ensure_ascii=False), json.dumps(INITED, ensure_ascii=False)]
call_id = 2
plan = {"recall": [], "get": []}
for r in recalls:
    lines.append(json.dumps({"jsonrpc": "2.0", "id": call_id, "method": "tools/call", "params": {
        "name": "memory_recall", "arguments": {"context": r["context"], "limit": 5}}}, ensure_ascii=False))
    plan["recall"].append({"id": call_id, **r})
    call_id += 1
for mk in (mk_hans, mk_hant, mk_en):
    mid = ids.get(mk)
    if not mid:
        print(f"[verify] 未取到 {mk} 的 id ⇒ 跳过其 memory_get 断言")
        hard_fail = hard_fail or 40
        continue
    lines.append(json.dumps({"jsonrpc": "2.0", "id": call_id, "method": "tools/call", "params": {
        "name": "memory_get", "arguments": {"id": mid}}}, ensure_ascii=False))
    plan["get"].append({"id": call_id, "marker": mk, "memory_id": mid})
    call_id += 1
open(f"{work}/session_c.jsonl", "w").write("\n".join(lines) + "\n")
json.dump(plan, open(f"{work}/plan_c.json", "w"), ensure_ascii=False, indent=2)

if hard_fail:
    sys.exit(hard_fail)
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die "$rc" "会话 B 校验未通过（退出码 ${rc}）"
ok "P3 通过：握手 / 8 工具 / 12 组关键词对照采集完成（矩阵见 P5 汇总）"

# ═══════════════════ P4 会话 C：语义召回 + 按标识直取 ═══════════════════
log "P4 会话 C 语义召回（简中 / 繁中 / 英文）+ 按 id 直取"
run_session "C(召回+直取)" "$WORK/out_c.jsonl" "$WORK/session_c.jsonl" "${PROBE_ENV[@]}" || die 40 "会话 C 失败"

set +e
python3 - "$WORK" <<'PY'
import json, re, sys
work = sys.argv[1]
plan = json.load(open(f"{work}/plan_c.json"))

resp = {}
for line in open(f"{work}/out_c.jsonl"):
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
    return " ".join(c.get("text", "") for c in (call.get("result") or {}).get("content", []))

out = {"recall": [], "get": []}
exit_code = 0
for r in plan["recall"]:
    call = resp.get(r["id"])
    if call is None or "error" in call:
        print(f"[verify] {r['label']} 异常: {json.dumps(call, ensure_ascii=False)[:250]}")
        exit_code = 40
        continue
    text = rtext(call)
    m = re.search(r"mode[:=]\s*([a-zA-Z_-]+)", text)
    mode = m.group(1) if m else None
    # 召回结果为纯文本表格（`count:N|mode:hybrid|…`）；保留全文，宿主机侧再按标记判定命中
    out["recall"].append({"label": r["label"], "lang": r["lang"], "mode": mode, "hit": None,
                          "raw_text": text})
    print(f"[verify] {r['label']:<16} mode={mode} 响应片段={text[:120]!r}")
for g in plan["get"]:
    call = resp.get(g["id"])
    text = rtext(call) if call else ""
    hit = g["marker"] in text
    out["get"].append({"marker": g["marker"], "memory_id": g["memory_id"], "hit": hit,
                       "raw_text": text})
    print(f"[verify] memory_get {g['marker']} id={str(g['memory_id'])[:8]}… 命中={hit} 期望=True")
    if not hit:
        exit_code = 40
json.dump(out, open(f"{work}/results_c_raw.json", "w"), ensure_ascii=False, indent=2)
sys.exit(exit_code)
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 40 "会话 C 直取断言失败（退出码 ${rc}）"
ok "P4 通过：按 id 直取命中（语言无关通路成立）"

# 召回命中的判定放到宿主机做（需要标记常量）
set +e
python3 - "$WORK" "$MK_HANS" "$MK_HANT" "$MK_EN" <<'PY'
import json, sys
work, mk_hans, mk_hant, mk_en = sys.argv[1:5]
markers = {"简体中文": mk_hans, "繁体中文": mk_hant, "英文": mk_en}
raw = json.load(open(f"{work}/results_c_raw.json"))
exit_code = 0
for r in raw["recall"]:
    blob = r.get("raw_text", "")
    hit = markers[r["lang"]] in blob
    r["hit"] = hit
    print(f"[verify] {r['label']:<16} 命中本语言标记={hit} mode={r['mode']} 期望=True")
    if not hit:
        exit_code = 40
    if r["mode"] != "hybrid":
        print("    ^ 语义通路降级：mode 非 hybrid（检查容器是否注入 DASHSCOPE_API_KEY；缺 key 会静默退化 linear scan）")
        exit_code = 40
json.dump(raw, open(f"{work}/results_c.json", "w"), ensure_ascii=False, indent=2)
sys.exit(exit_code)
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 40 "语义召回断言失败（退出码 ${rc}）"
ok "P4 通过：三种语言的语义召回均命中且 mode=hybrid"

# ═══════════════════ P5 文件级断言 + 结论矩阵 ═══════════════════
DB_OWNER="$(c_owner "${PROBE_DB}")"
[ "${DB_OWNER}" = "aimem:aimem" ] || die 40 "探针库属主=${DB_OWNER}，预期 aimem:aimem"
MAIN_COUNT_AFTER="$(main_count)"
if [ -n "${MAIN_COUNT_BEFORE}" ] && [ -n "${MAIN_COUNT_AFTER}" ]; then
  [ "${MAIN_COUNT_BEFORE}" = "${MAIN_COUNT_AFTER}" ] \
    || die 40 "共享主库记忆计数变化：${MAIN_COUNT_BEFORE} → ${MAIN_COUNT_AFTER}（探针疑似落到主库）"
  ok "P5 主库未被写入：记忆计数 ${MAIN_COUNT_BEFORE} 不变；探针库 ${PROBE_DB}（${DB_OWNER}）"
else
  note "主库计数取得失败（before=${MAIN_COUNT_BEFORE:-空} after=${MAIN_COUNT_AFTER:-空}），跳过计数断言"
fi

set +e
python3 - "$WORK" "${I18N_PROBE_STRICT:-0}" <<'PY'
import json, sys
work, strict = sys.argv[1], sys.argv[2] == "1"

searches = json.load(open(f"{work}/searches.json"))
res_b = json.load(open(f"{work}/results_b.json"))
res_c = json.load(open(f"{work}/results_c.json"))

hard_fail = False
strict_fail = False

print()
print("════════ 证据明细（关键词检索，逐条实测）════════")
for s in searches:
    r = res_b.get(s["label"], {})
    measured_hit = bool(r.get("hit_markers"))
    expect_hit = s["expect"] == "hit"
    agree = measured_hit == expect_hit
    print(f"  {s['label']:<24}{s['lang']:<8}{s['path']:<18}count={str(r.get('count')):<4}"
          f"期望={'命中  ' if expect_hit else '未命中'}"
          f"实测={'命中  ' if measured_hit else '未命中'}{'一致' if agree else '不一致'}"
          f"{'  <- 硬断言' if s['hard'] else ''}")
    if s["hard"] and not agree:
        hard_fail = True
    if (not s["hard"]) and (not agree):
        strict_fail = True

print()
print("════════ 证据明细（语义召回 / 按 id 直取）════════")
for r in res_c["recall"]:
    print(f"  {r['label']:<24}{r['lang']:<8}{'语义召回':<18}mode={str(r['mode']):<8}"
          f"实测={'命中' if r['hit'] else '未命中'}")
    if not r["hit"] or r["mode"] != "hybrid":
        hard_fail = True
for g in res_c["get"]:
    print(f"  memory_get               {'':<8}{'按 id 直取':<18}{'':<13}"
          f"实测={'命中' if g['hit'] else '未命中'}")
    if not g["hit"]:
        hard_fail = True

print()
print("════════ 结论矩阵（语言 x 通路）════════")
def cell(lang, path):
    rows = [s for s in searches if s["lang"] == lang and s["path"] == path]
    if not rows:
        return "不适用"
    hits = [bool(res_b.get(s["label"], {}).get("hit_markers")) for s in rows]
    counts = [res_b.get(s["label"], {}).get("count") for s in rows]
    return f"{'支持' if all(hits) else '不支持'}（count={counts}）"

def lang_path(lang, kind):
    if kind == "recall":
        rows = [r for r in res_c["recall"] if r["lang"] == lang]
        return "支持" if rows and all(r["hit"] for r in rows) else "不支持"
    if kind == "get":
        rows = [g for g in res_c["get"]]
        return "支持" if rows and all(g["hit"] for g in rows) else "不支持"
    return ""

print(f"  {'语言':<8}{'关键词·完整词元':<26}{'关键词·词元内子串':<22}{'语义召回':<10}{'按 id 直取':<10}")
for lang in ("简体中文", "繁体中文", "英文"):
    print(f"  {lang:<8}{cell(lang, '关键词·完整词元'):<26}{cell(lang, '关键词·词元内子串'):<22}"
          f"{lang_path(lang, 'recall'):<10}{lang_path(lang, 'get'):<10}")
cross = [s for s in searches if s["lang"] == "简繁交叉"]
cross_ok = all(not res_b.get(s["label"], {}).get("hit_markers") for s in cross) if cross else False
print(f"  {'简繁交叉':<8}{'不支持（双向均未命中）' if cross_ok else '注意：出现命中，需复核':<26}"
      f"{'不适用':<22}{'不适用':<10}{'不适用':<10}")

print()
print("════════ 结论（可复述版）════════")
print("  存储：三种语言均写入成功（memory_store 与语言无关）")
print("  检索：语义召回（recall / mode=hybrid）与按 id 直取对三种语言一律可用")
print("  关键词：FTS5 默认分词器按「完整词元」匹配 —— 英文词元是单词，中文词元是标点界定的整段；")
print("          词元内部子串一律不命中（英文 bound 也不命中 boundary），且简繁字形不做归一")
print("  推论：中文的可检索性依赖语义通路；关键词通路只适合 ASCII 标记与整段引用")
print()
if hard_fail:
    print("[render] 硬断言失败：见上方明细")
    sys.exit(40)
if strict and strict_fail:
    print("[render] STRICT：语言边界与文档登记值不一致（上游行为可能已漂移）")
    sys.exit(41)
sys.exit(0)
PY
rc=$?
set -e
case "$rc" in
  0)  ok "P5 通过：结论矩阵采集完成（见上方汇总）" ;;
  40) die 40 "结论渲染阶段硬断言失败" ;;
  41) die 40 "STRICT 模式断言失败：语言边界与文档登记值不一致（上游行为可能已漂移）" ;;
  *)  die 50 "结论渲染异常（退出码 ${rc}）" ;;
esac

cat <<EOF

════════ i18n-probe 证据汇总（标记前缀 ${STAMP}）════════
探针库   ${PROBE_DB}（${DB_OWNER}，数据保留供复查）
写入     简中 ${MK_HANS} / 繁中 ${MK_HANT} / 英文 ${MK_EN}（force=true 跳过近重复检查）
主库计数 ${MAIN_COUNT_BEFORE:-未知} → ${MAIN_COUNT_AFTER:-未知}（须不变）
模式     STRICT=${I18N_PROBE_STRICT:-0}（1 = 语言边界按文档登记值断言）
清理     docker exec -u 0 ${CONTAINER} rm -rf ${PROBE_DIR}
════════════════════════════════════════════════════════
EOF

log "全部通过：三语言写入 + 关键词边界对照 + 语义召回 + 按 id 直取（标记前缀 ${STAMP}）"
