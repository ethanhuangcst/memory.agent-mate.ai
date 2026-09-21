#!/usr/bin/env bash
# profile-probe.sh — 档位（--profile）探针（Sprint 2 #9「--profile 定档」）
#
# 前置：local-up.sh 已启动（容器 ai-memory-mcp 常驻）。会话调用与生产 SSH forced command 同构：
#       docker exec -i [-e ...] ai-memory-mcp ai-memory mcp --tier smart [--profile <p>]（-i 不加 -t）。
#
# 目的：为「对外暴露哪一档」给出**可复跑的实测证据** —— 每个档位单独起一个进程，只发
#       initialize + tools/list + 一次 memory_capabilities（自述，只读），实测**实际注册工具数**
#       与关键工具归属。不发任何写入/删除调用。
#
# 为什么必须实测（不能只看文档）：
#   ① 默认档位是 core 而非 full —— 模板不写 --profile 就只暴露 8 项且**不报错**（静默面）；
#   ② memory_capabilities 属 Meta 族但被列为 ALWAYS_ON ⇒ 除 full 外各档**实际数 = 族计数 + 1**，
#      full 的 101 **已含它**（100 个 memory tools + 1 常驻，见 mcp --help 自述与 issue #862 说明）；
#   ③ --profile 与 --tier 是两个独立维度，是否真的能并存、以及逗号自定义档是否被接受，都要跑出来。
#
# 受测档位（7 例）：默认（无 --profile）· core · graph · admin · power · full · core,lifecycle
#   默认档对照用于实证「不写 --profile ⇒ 8 项」；core,lifecycle 用于实证自定义组合（对外若需开放
#   删除，最小增量是 +6 而非 +93）。
#
# 隔离与数据：每档独立库 /data/users/profile-probe/<slug>/ai-memory.db；共享主库记忆计数前后各取
#       一次并断言不变（R1 纪律）。探针不写入任何记忆，唯一副作用是会话自动创建空库目录。
#       清理：docker exec -u 0 ai-memory-mcp rm -rf /data/users/profile-probe
#       或用 PROFILE_PROBE_KEEP=1 让本次运行结束后**保留**目录供复查。
#
# --profile 生效形式：先试 CLI flag（--tier smart --profile <p>）；失败则回退 env
#       AI_MEMORY_PROFILE=<p>（解析优先级：flag > env > config > core），汇总里记录每档实际生效形式。
#
# 密钥纪律：本脚本不读 env 文件、不打印密钥；仅打印工具名与响应片段。
#
# 用法：bash memory.agent-mate.ai/scripts/profile-probe.sh
# 退出码：0 全通过；10 前置失败；20 会话/握手失败；30 工具数断言失败；40 工具归属断言失败；
#         50 探针自身异常
set -euo pipefail

CONTAINER="ai-memory-mcp"

PROBE_USER="profile-probe"
PROBE_DIR="/data/users/${PROBE_USER}"

# slug:profile —— 默认档用空 profile（不传 --profile、不设 env，实证「模板不写即 core」）
CASES="default: core:core graph:graph admin:admin power:power full:full core-lifecycle:core,lifecycle"

log()  { printf '[profile-probe] %s\n' "$*" >&2; }
ok()   { printf '[profile-probe][OK] %s\n' "$*" >&2; }
note() { printf '[profile-probe][NOTE] %s\n' "$*" >&2; }
die()  { local code="$1"; shift; log "失败(${code})：$*"; exit "$code"; }

# ── 前置：容器须常驻运行 ──
docker ps --filter "name=${CONTAINER}" --format '{{.Names}}' | grep -qx "${CONTAINER}" \
  || die 10 "容器 ${CONTAINER} 未运行（先执行 bash memory.agent-mate.ai/scripts/local-up.sh）"

# ── 自证（fail-closed，R1 风格）：每档库路径必须钉在隔离探针目录下 ──
[ "${PROBE_DIR}" = "/data/users/${PROBE_USER}" ] \
  || die 10 "探针目录自证失败：${PROBE_DIR}"

WORK="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK"
  if [ "${PROFILE_PROBE_KEEP:-0}" = "1" ]; then
    log "已按 PROFILE_PROBE_KEEP=1 保留 ${PROBE_DIR}"
  else
    docker exec -u 0 "${CONTAINER}" rm -rf "${PROBE_DIR}" >/dev/null 2>&1 || true
    log "已清理 ${PROBE_DIR}（保留请用 PROFILE_PROBE_KEEP=1）"
  fi
}
trap cleanup EXIT

# ── 容器侧小工具（镜像内无 python3 —— 解析一律在宿主机做）──
main_count() { docker exec "${CONTAINER}" ai-memory stats 2>/dev/null | awk '/^total memories:/ {print $3}'; }

# ═══════════════════ P0 前置准备 ═══════════════════
docker exec -u 0 "${CONTAINER}" sh -c "mkdir -p ${PROBE_DIR} && chown -R aimem:aimem ${PROBE_DIR}" \
  || die 10 "无法准备目录 ${PROBE_DIR}"
MAIN_COUNT_BEFORE="$(main_count)"

# 软检查：config.toml 是否也设了 [mcp].profile（会参与「flag > env > config > core」的解析链）
docker exec "${CONTAINER}" cat /data/.config/ai-memory/config.toml > "${WORK}/config.toml" 2>/dev/null || true
CONFIG_PROFILE="$(grep -n '^profile' "${WORK}/config.toml" 2>/dev/null || true)"
log "P0 就绪：探针目录 ${PROBE_DIR}；主库计数（前）= ${MAIN_COUNT_BEFORE:-未知}"
if [ -n "${CONFIG_PROFILE}" ]; then
  note "config.toml 中存在 profile 键：${CONFIG_PROFILE}（仅影响默认档，CLI flag 优先级更高）"
fi

# ═══════════════════ P1 生成载荷与断言矩阵 ═══════════════════
python3 - "${WORK}" <<'PY'
import json, sys

work = sys.argv[1]

# 期望值来源：specs/mcp/mcp-design.md §8.1（从上游 src/profile.rs 派生）+ 本地 clone 实测。
# full 的 101 已含常驻 memory_capabilities；其余档 = 族计数 + 1。
CASES = [
    # slug,            profile,          期望数, 必含, 必不含
    ("default",         "",                  8,
     ["memory_capabilities"],
     ["memory_delete"]),
    ("core",            "core",              8,
     ["memory_store", "memory_recall", "memory_search", "memory_get", "memory_list", "memory_capabilities"],
     ["memory_delete", "memory_forget", "memory_gc"]),
    ("graph",           "graph",            20,
     ["memory_kg_query", "memory_link"],
     ["memory_delete"]),
    ("admin",           "admin",            22,
     ["memory_update", "memory_delete", "memory_forget", "memory_gc"],
     ["memory_stats", "memory_kg_query"]),
    ("power",           "power",            57,
     ["memory_consolidate", "memory_share"],
     ["memory_delete"]),
    ("full",            "full",            101,
     ["memory_stats", "memory_delete", "memory_kg_query", "memory_archive_stats"],
     []),
    ("core-lifecycle",  "core,lifecycle",  14,
     ["memory_delete", "memory_forget", "memory_gc"],
     ["memory_stats", "memory_pending_list"]),
]

INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {
    "protocolVersion": "2024-11-05", "capabilities": {},
    "clientInfo": {"name": "profile-probe", "version": "0"}}}
INITED = {"jsonrpc": "2.0", "method": "notifications/initialized"}
TOOLS_LIST = {"jsonrpc": "2.0", "id": 2, "method": "tools/list"}
# memory_capabilities 是 always-on 自述工具，只读；响应用于交叉核对族装载（软断言）
CAPS = {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
    "name": "memory_capabilities", "arguments": {}}}

with open(f"{work}/payload.jsonl", "w") as f:
    for o in (INIT, INITED, TOOLS_LIST, CAPS):
        f.write(json.dumps(o, ensure_ascii=False) + "\n")

json.dump([{"slug": s, "profile": p, "expect": n, "must": m, "must_not": mn}
           for (s, p, n, m, mn) in CASES],
          open(f"{work}/cases.json", "w"), ensure_ascii=False, indent=2)
PY
[ -s "${WORK}/payload.jsonl" ] || die 50 "载荷生成失败（payload.jsonl 为空）"

# ═══════════════════ P2 逐档会话（每档独立进程）═══════════════════
run_case() { # $1=slug $2=profile
  local slug="$1" profile="$2"
  local db="${PROBE_DIR}/${slug}/ai-memory.db"
  local keys="${PROBE_DIR}/${slug}/keys"
  local out="${WORK}/out_${slug}.jsonl"
  local args=() mode
  for kv in "AI_MEMORY_DB=${db}" "AI_MEMORY_AGENT_ID=human:${PROBE_USER}" "AI_MEMORY_KEY_DIR=${keys}"; do
    args+=(-e "$kv")
  done

  docker exec -u 0 "${CONTAINER}" sh -c "mkdir -p ${keys} && chown -R aimem:aimem ${PROBE_DIR}" \
    || die 10 "无法准备目录 ${PROBE_DIR}/${slug}"
  [ "${db}" = "/data/users/${PROBE_USER}/${slug}/ai-memory.db" ] \
    || die 10 "库路径自证失败：${db}"

  if [ -n "${profile}" ]; then
    mode="flag"
    if ! docker exec -i "${args[@]}" "${CONTAINER}" ai-memory mcp --tier smart --profile "${profile}" \
          < "${WORK}/payload.jsonl" > "$out" 2> "${out}.err"; then
      note "档位 ${slug}：--profile CLI 形式失败，回退 env AI_MEMORY_PROFILE"
      tail -3 "${out}.err" >&2 || true
      mode="env"
      args+=(-e "AI_MEMORY_PROFILE=${profile}")
      docker exec -i "${args[@]}" "${CONTAINER}" ai-memory mcp --tier smart \
        < "${WORK}/payload.jsonl" > "$out" 2> "${out}.err" \
        || { tail -5 "${out}.err" >&2 || true; die 20 "档位 ${slug} 会话失败"; }
    fi
  else
    mode="default"
    docker exec -i "${args[@]}" "${CONTAINER}" ai-memory mcp --tier smart \
      < "${WORK}/payload.jsonl" > "$out" 2> "${out}.err" \
      || { tail -5 "${out}.err" >&2 || true; die 20 "档位 ${slug}（默认档）会话失败"; }
  fi

  printf '%s\t%s\t%s\t%s\n' "$slug" "$profile" "$mode" "$out" >> "${WORK}/runs.tsv"
  log "档位 ${slug}（profile=${profile:-未指定} 生效=${mode}）会话完成"
}

for c in ${CASES}; do
  run_case "${c%%:*}" "${c#*:}"
done
ok "P2 通过：7 个档位会话全部返回"

# ═══════════════════ P3 断言：工具数 + 关键工具归属 ═══════════════════
set +e
python3 - "${WORK}" <<'PY'
import json, sys

work = sys.argv[1]
cases = json.load(open(f"{work}/cases.json"))
runs = {}
for line in open(f"{work}/runs.tsv"):
    slug, profile, mode, out = line.rstrip("\n").split("\t")
    runs[slug] = {"profile": profile, "mode": mode, "out": out}

def load(path):
    resp = {}
    with open(path) as f:
        for line in f:
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
    return " ".join(c.get("text", "") for c in (call.get("result") or {}).get("content", []))

exit_code = 0
rows = []
for c in cases:
    run = runs[c["slug"]]
    resp = load(run["out"])
    init = (resp.get(1) or {}).get("result") or {}
    name = ((init.get("serverInfo")) or {}).get("name")
    tools = ((resp.get(2) or {}).get("result") or {}).get("tools", [])
    names = sorted(t.get("name", "") for t in tools)
    missing = [t for t in c["must"] if t not in names]
    present = [t for t in c["must_not"] if t in names]

    if name != "ai-memory":
        print(f"[verify] {c['slug']}：握手断言失败 serverInfo.name={name!r}")
        exit_code = exit_code or 20
    if len(tools) != c["expect"]:
        print(f"[verify] {c['slug']}：工具数断言失败 期望={c['expect']} 实测={len(tools)}")
        exit_code = exit_code or 30
    if missing:
        print(f"[verify] {c['slug']}：必含工具缺失 {missing}")
        exit_code = exit_code or 40
    if present:
        print(f"[verify] {c['slug']}：必不含工具出现 {present}")
        exit_code = exit_code or 40

    caps = resp.get(3) or {}
    caps_text = rtext(caps) if "result" in caps else ""
    caps_head = caps_text.strip().replace("\n", " ")[:140]
    if "error" in caps:
        caps_head = f"调用返回 error（软断言，不阻断）：{json.dumps(caps['error'], ensure_ascii=False)[:140]}"
    rows.append({**c, "mode": run["mode"], "count": len(tools), "missing": missing,
                 "present": present, "caps_head": caps_head})
    json.dump(names, open(f"{work}/tools_{c['slug']}.json", "w"), ensure_ascii=False)

json.dump(rows, open(f"{work}/rows.json", "w"), ensure_ascii=False, indent=2)
sys.exit(exit_code)
PY
rc=$?
set -e
case "$rc" in
  0)  ok "P3 通过：7 档工具数与关键工具归属全部符合预期" ;;
  20) die 20 "握手断言失败" ;;
  30) die 30 "工具数断言失败（实测与 §8.1 登记值不符）" ;;
  40) die 40 "工具归属断言失败（必含缺失或必不含出现）" ;;
  *)  die 50 "断言阶段异常（退出码 ${rc}）" ;;
esac

# ═══════════════════ P4 主库守卫 + 汇总 ═══════════════════
MAIN_COUNT_AFTER="$(main_count)"
if [ -n "${MAIN_COUNT_BEFORE}" ] && [ -n "${MAIN_COUNT_AFTER}" ]; then
  [ "${MAIN_COUNT_BEFORE}" = "${MAIN_COUNT_AFTER}" ] \
    || die 40 "共享主库记忆计数变化：${MAIN_COUNT_BEFORE} → ${MAIN_COUNT_AFTER}（探针疑似落到主库）"
  ok "P4 主库未被写入：记忆计数 ${MAIN_COUNT_BEFORE} 不变"
else
  note "主库计数取得失败（before=${MAIN_COUNT_BEFORE:-空} after=${MAIN_COUNT_AFTER:-空}），跳过计数断言"
fi

set +e
python3 - "${WORK}" <<'PY'
import json, sys
work = sys.argv[1]
rows = json.load(open(f"{work}/rows.json"))

print()
print("════════ 实测矩阵（每档独立进程，initialize + tools/list）════════")
print(f"  {'档位':<16}{'--profile':<16}{'生效':<8}{'期望':<6}{'实测':<6}{'计数':<8}{'必含':<8}{'必不含'}")
for r in rows:
    print(f"  {r['slug']:<16}{(r['profile'] or '(未指定)'):<16}{r['mode']:<8}"
          f"{r['expect']:<6}{r['count']:<6}{'一致' if r['count'] == r['expect'] else '不一致':<8}"
          f"{'齐全' if not r['missing'] else '缺' + ','.join(r['missing']):<8}"
          f"{'干净' if not r['present'] else '越界:' + ','.join(r['present'])}")

print()
print("════════ memory_capabilities 自述（软断言，交叉核对）════════")
for r in rows:
    print(f"  {r['slug']:<16}{r['caps_head']}")

print()
print("════════ 结论（可复述版）════════")
full = next(r for r in rows if r["slug"] == "full")
default = next(r for r in rows if r["slug"] == "default")
core = next(r for r in rows if r["slug"] == "core")
custom = next(r for r in rows if r["slug"] == "core-lifecycle")
print(f"  默认档（不写 --profile）= {default['count']} 项 ⇒ 与 core 档 "
      f"{'一致' if default['count'] == core['count'] else '不一致'}（不报错，静默只暴露 core）")
print(f"  各档实测：core={core['count']} / graph={next(r for r in rows if r['slug']=='graph')['count']} / "
      f"admin={next(r for r in rows if r['slug']=='admin')['count']} / "
      f"power={next(r for r in rows if r['slug']=='power')['count']} / full={full['count']}")
print(f"  自定义组合 core,lifecycle = {custom['count']} 项（含删除 / 遗忘 / gc，不含治理与自治面）")
print(f"  生效形式：{[r['mode'] for r in rows]}（flag = --profile CLI；env = AI_MEMORY_PROFILE 回退）")
PY
rc=$?
set -e
[ "$rc" -eq 0 ] || die 50 "汇总渲染异常（退出码 ${rc}）"

cat <<EOF

════════ profile-probe 证据汇总 ════════
探针目录 ${PROBE_DIR}（每档独立空库，未写入任何记忆）
主库计数 ${MAIN_COUNT_BEFORE:-未知} → ${MAIN_COUNT_AFTER:-未知}（须不变）
清理     docker exec -u 0 ${CONTAINER} rm -rf ${PROBE_DIR}（默认已清理；保留用 PROFILE_PROBE_KEEP=1）
════════════════════════════════════════
EOF

log "全部通过：7 档实测工具数与关键工具归属符合预期（对外定档依据）"
