#!/usr/bin/env bash
# qwen-verify.sh — 校验私有 MaaS 端点上 qwen 模型对 ai-memory 的可用性
#
# 背景：ai-memory 依赖三类模型能力 —— 对话（[llm].model）、结构化/JSON（[llm.auto_tag].model）、
#       嵌入（[embeddings].model）。私有 MaaS 端点**是否提供 embeddings、可用模型 id 与真实
#       向量维度均无法从文档推定**，必须实测：`[embeddings].dim` 一旦写死便与已达成的向量绑定，
#       猜错会静默回落 tier preset（smart=768）并造成维度不一致。
#
# 用法：
#   ./qwen-verify.sh                                  # 从 secrets 文件取 key 与 base_url
#   ./qwen-verify.sh --list-models-only               # 只列可用模型
#   ./qwen-verify.sh --embed-model text-embedding-v4  # 指定嵌入模型候选（可重复）
#   ./qwen-verify.sh --chat-model qwen-plus --auto-tag-model qwen-turbo
#
# 退出码：
#   0 全部通过        1 一般/网络错误      2 用法错误
#   3 鉴权失败(401/403)  4 端点不提供 embeddings  5 必需参数缺失
#
# 安全：API key 仅驻内存；任何输出（含报错）均不打印 key。

set -euo pipefail

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
readonly DEFAULT_SECRETS="$REPO_ROOT/memory.agent-mate.ai/secrets.local.hk_vps_4.md"
# 兜底候选：DashScope 公开嵌入模型族；/models 探测到的候选会排在前面
readonly FALLBACK_EMBED_MODELS=(text-embedding-v4 text-embedding-v3 text-embedding-v2 text-embedding-v1)

API_KEY="${QWEN_API_KEY:-}"
BASE_URL="${QWEN_BASE_URL:-}"
SECRETS_FILE="$DEFAULT_SECRETS"
CHAT_MODEL="${QWEN_CHAT_MODEL:-qwen-plus}"
AUTOTAG_MODEL="qwen-turbo"
TIMEOUT=30
RETRIES=2
LIST_ONLY=0
USER_EMBED_MODELS=()

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { log "ERROR: $*"; exit "${2:-1}"; }

usage() {
	cat <<'EOF'
用法：qwen-verify.sh [选项]

  --base-url URL            OpenAI 兼容端点（默认取 secrets 的 QWEN_BASE_URL）
  --key KEY                 API key（默认取环境变量 QWEN_API_KEY，再回落 secrets 文件）
  --secrets-file PATH       secrets 文件（默认 memory.agent-mate.ai/secrets.local.hk_vps_4.md）
  --chat-model MODEL        对话模型（默认 qwen-plus）
  --auto-tag-model MODEL    结构化/JSON 模型（默认 qwen-turbo）
  --embed-model MODEL       嵌入模型候选，可重复（默认先取 /models 探测结果，再回落公开族）
  --timeout SECONDS         单次请求超时（默认 30）
  --retries N               瞬时失败重试次数（默认 2）
  --list-models-only        只列出端点可用模型后退出
  -h, --help                显示本帮助
EOF
}

# ── 参数解析 ───────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
	case "$1" in
	--base-url) BASE_URL="${2:-}"; shift 2 ;;
	--key) API_KEY="${2:-}"; shift 2 ;;
	--secrets-file) SECRETS_FILE="${2:-}"; shift 2 ;;
	--chat-model) CHAT_MODEL="${2:-}"; shift 2 ;;
	--auto-tag-model) AUTOTAG_MODEL="${2:-}"; shift 2 ;;
	--embed-model) USER_EMBED_MODELS+=("${2:-}"); shift 2 ;;
	--timeout) TIMEOUT="${2:-}"; shift 2 ;;
	--retries) RETRIES="${2:-}"; shift 2 ;;
	--list-models-only) LIST_ONLY=1; shift ;;
	-h | --help) usage; exit 0 ;;
	*) usage >&2; die "未知参数：$1" 2 ;;
	esac
done

# ── 从 secrets 文件补齐 key / base_url ────────────────────────────────────
# secrets 文件是 Markdown，相关行为裸的 KEY=VALUE；只取第一行，去掉可能的 CR。
field_from_secrets() {
	local file="$1" name="$2" val=""
	[[ -f "$file" ]] || return 0
	val="$(sed -n "s/^${name}=//p" "$file" | head -n 1 | tr -d '\r')"
	printf '%s' "$val"
}

if [[ -z "$API_KEY" || -z "$BASE_URL" ]]; then
	[[ -f "$SECRETS_FILE" ]] || die "找不到 secrets 文件：$SECRETS_FILE（可用 --secrets-file 指定）" 5
	[[ -z "$API_KEY" ]] && API_KEY="$(field_from_secrets "$SECRETS_FILE" QWEN_API_KEY)"
	[[ -z "$BASE_URL" ]] && BASE_URL="$(field_from_secrets "$SECRETS_FILE" QWEN_BASE_URL)"
fi

[[ -n "$API_KEY" ]] || die "缺少 API key（用 --key 或设置 QWEN_API_KEY）" 5
[[ -n "$BASE_URL" ]] || die "缺少 --base-url" 5
BASE_URL="${BASE_URL%/}"

# ── 临时目录与清理 ─────────────────────────────────────────────────────────
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── HTTP 与 JSON 辅助 ──────────────────────────────────────────────────────
HTTP_CODE=""

# http <method> <url> [json-body]  → 响应体写入 $TMP/body，状态码写入 $HTTP_CODE
http() {
	local method="$1" url="$2" data="${3:-}"
	local args=(-X "$method" --silent --show-error --max-time "$TIMEOUT"
		--retry "$RETRIES" --retry-delay 1 --retry-connrefused
		-H "Authorization: Bearer $API_KEY")
	[[ -n "$data" ]] && args+=(-H 'Content-Type: application/json' --data-binary "$data")
	HTTP_CODE="$(curl "${args[@]}" -o "$TMP/body" -w '%{http_code}' "$url" || printf '000')"
}

# jparse <mode> — 解析 $TMP/body；结果打印到 stdout，内容缺失时退出 9
jparse() {
	JPARSE_MODE="$1" python3 -c '
import json, os, sys

mode = os.environ["JPARSE_MODE"]
try:
    with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
        raw = fh.read()
except OSError:
    sys.exit(9)

try:
    obj = json.loads(raw) if raw.strip() else {}
except ValueError:
    print("响应非 JSON")
    sys.exit(9)

def err():
    e = obj.get("error") or {}
    msg = e.get("message") if isinstance(e, dict) else str(e)
    return msg or obj.get("message") or obj.get("msg") or ""

if mode == "ids":
    items = obj.get("data")
    if not isinstance(items, list):
        items = obj.get("models") or []
    found = []
    for it in items:
        if isinstance(it, str):
            found.append(it)
        elif isinstance(it, dict) and it.get("id"):
            found.append(str(it["id"]))
    if not found:
        sys.exit(9)
    print("\n".join(found))
elif mode == "err":
    print(err() or "无错误信息")
elif mode == "chat":
    ch = obj.get("choices") or []
    if ch and isinstance(ch[0], dict):
        msg = ch[0].get("message") or {}
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            print(content.strip().replace("\n", " ")[:120])
            sys.exit(0)
    print("ERR: " + (err() or "响应中无可用的 choices[0].message.content"))
    sys.exit(9)
elif mode == "dim":
    data = obj.get("data") or []
    if data and isinstance(data[0], dict) and isinstance(data[0].get("embedding"), list):
        print(str(len(data[0]["embedding"])))
        sys.exit(0)
    print("ERR: " + (err() or "响应中无 data[0].embedding"))
    sys.exit(9)
else:
    sys.exit(9)
' "$TMP/body"
}

# ── 探测 1：列出可用模型 ───────────────────────────────────────────────────
log "探测端点：$BASE_URL"
http GET "$BASE_URL/models"
DISCOVERED_EMBED=()
case "$HTTP_CODE" in
200)
	MODEL_IDS="$TMP/models.txt"
	if jparse ids >"$MODEL_IDS" 2>/dev/null; then
		log "端点可用模型数：$(wc -l <"$MODEL_IDS" | tr -d ' ')"
		while IFS= read -r m; do
			[[ -n "$m" ]] && DISCOVERED_EMBED+=("$m")
		done < <(grep -i 'embed' "$MODEL_IDS" || true)
		log "其中含 embed 关键字的模型：${DISCOVERED_EMBED[*]:-（无）}"
	else
		log "WARN: /models 返回非预期结构，跳过模型发现"
	fi
	;;
401 | 403)
	die "鉴权失败（HTTP $HTTP_CODE）：$(jparse err 2>/dev/null || true) —— 请核对 API key 是否属于该 workspace" 3
	;;
404)
	log "WARN: 端点不提供 /models（HTTP 404），改用内置候选模型列表"
	;;
000)
	die "网络不可达或超时（$BASE_URL）" 1
	;;
*)
	log "WARN: /models 返回 HTTP $HTTP_CODE，改用内置候选模型列表"
	;;
esac

if ((LIST_ONLY)); then
	[[ -s "$TMP/models.txt" ]] && cat "$TMP/models.txt"
	exit 0
fi

# ── 探测 2：对话模型 ───────────────────────────────────────────────────────
# build_payload <model> <plain|json>
# 用 python 生成请求体：printf 会把格式串里的 \" 转义掉，导致 JSON 畸形（曾误报 400）
build_payload() {
	BP_MODEL="$1" BP_MODE="$2" python3 -c '
import json, os

model, mode = os.environ["BP_MODEL"], os.environ["BP_MODE"]
if mode == "json":
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with a JSON object: {\"ok\": true}"}],
        "max_tokens": 64,
        "response_format": {"type": "json_object"},
    }
else:
    body = {
        "model": model,
        "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
        "max_tokens": 16,
    }
print(json.dumps(body))
'
}

probe_chat() {
	local model="$1" json_mode="${2:-0}" payload label
	if ((json_mode)); then
		label="${model},json"
		payload="$(build_payload "$model" json)"
	else
		label="$model"
		payload="$(build_payload "$model" plain)"
	fi
	http POST "$BASE_URL/chat/completions" "$payload"
	case "$HTTP_CODE" in
	200)
		if jparse chat >"$TMP/chat.txt" 2>/dev/null; then
			log "  chat(${label}) OK → $(cat "$TMP/chat.txt")"
			return 0
		fi
		log "  chat(${label}) 响应不可解析（HTTP 200）"
		return 1
		;;
	401 | 403)
		die "鉴权失败（HTTP $HTTP_CODE）：$(jparse err 2>/dev/null || true)" 3
		;;
	*)
		log "  chat(${label}) HTTP $HTTP_CODE → $(jparse err 2>/dev/null || true)"
		return 1
		;;
	esac
}

# ── 探测 3：嵌入模型与维度 ─────────────────────────────────────────────────
probe_embed() {
	local model="$1" payload
	payload="$(printf '{"model":"%s","input":["ai-memory embedding probe"]}' "$model")"
	http POST "$BASE_URL/embeddings" "$payload"
	case "$HTTP_CODE" in
	200)
		if jparse dim >"$TMP/dim.txt" 2>/dev/null; then
			log "  embeddings(${model}) OK → dim=$(cat "$TMP/dim.txt")"
			return 0
		fi
		log "  embeddings(${model}) 响应不可解析（HTTP 200）"
		return 1
		;;
	401 | 403)
		die "鉴权失败（HTTP $HTTP_CODE）：$(jparse err 2>/dev/null || true)" 3
		;;
	*)
		log "  embeddings(${model}) HTTP $HTTP_CODE → $(jparse err 2>/dev/null || true)"
		return 1
		;;
	esac
}

# ── 组装嵌入候选（用户指定 > 端点发现 > 内置兜底，去重） ────────────────────
EMBED_CANDIDATES=()
add_candidate() {
	local c="$1" e
	for e in ${EMBED_CANDIDATES[@]+"${EMBED_CANDIDATES[@]}"}; do
		[[ "$e" == "$c" ]] && return 0
	done
	EMBED_CANDIDATES+=("$c")
}
if ((${#USER_EMBED_MODELS[@]})); then
	for m in "${USER_EMBED_MODELS[@]}"; do add_candidate "$m"; done
else
	for m in ${DISCOVERED_EMBED[@]+"${DISCOVERED_EMBED[@]}"}; do add_candidate "$m"; done
	for m in "${FALLBACK_EMBED_MODELS[@]}"; do add_candidate "$m"; done
fi

# ── 执行验证 ───────────────────────────────────────────────────────────────
log "验证对话模型：$CHAT_MODEL"
CHAT_OK=0
probe_chat "$CHAT_MODEL" 0 && CHAT_OK=1

log "验证结构化/JSON 模型：$AUTOTAG_MODEL"
AUTOTAG_OK=0
JSON_MODE_OK=0
if probe_chat "$AUTOTAG_MODEL" 0; then
	AUTOTAG_OK=1
	probe_chat "$AUTOTAG_MODEL" 1 && JSON_MODE_OK=1
	((JSON_MODE_OK)) || log "WARN: ${AUTOTAG_MODEL} 不支持 response_format=json_object；auto_tag 的结构化输出可能退化"
fi

log "验证嵌入模型（候选 ${#EMBED_CANDIDATES[@]} 个）"
EMBED_MODEL=""
EMBED_DIM=""
for m in "${EMBED_CANDIDATES[@]}"; do
	if probe_embed "$m"; then
		EMBED_MODEL="$m"
		EMBED_DIM="$(cat "$TMP/dim.txt")"
		break
	fi
done

# ── 汇总（stdout，机器可读；日志在 stderr） ─────────────────────────────────
echo "RESULT base_url=$BASE_URL"
echo "RESULT chat_model=$CHAT_MODEL status=$([[ $CHAT_OK -eq 1 ]] && echo ok || echo fail)"
echo "RESULT autotag_model=$AUTOTAG_MODEL status=$([[ $AUTOTAG_OK -eq 1 ]] && echo ok || echo fail) json_mode=$([[ $JSON_MODE_OK -eq 1 ]] && echo ok || echo fail)"
echo "RESULT embed_model=${EMBED_MODEL:-none} dim=${EMBED_DIM:-0}"

if [[ -z "$EMBED_MODEL" ]]; then
	log "ERROR: 端点未提供任何可用的嵌入模型 —— 需决策：嵌入是否改走公网 dashscope"
	exit 4
fi
((CHAT_OK)) || die "对话模型不可用：$CHAT_MODEL" 1
((AUTOTAG_OK)) || die "结构化模型不可用：$AUTOTAG_MODEL" 1

log "全部通过：chat=$CHAT_MODEL / autotag=$AUTOTAG_MODEL / embed=$EMBED_MODEL (dim=$EMBED_DIM)"
exit 0
