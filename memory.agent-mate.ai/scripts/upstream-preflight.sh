#!/usr/bin/env bash
# =============================================================================
# upstream-preflight.sh — 上游 ai-memory-mcp 版本预检 / 升级准入判定
#
# 回答一个问题：**上游发了新版，这个版本能不能升？**
# 产出结构化报告 + 契约化退出码。**不执行任何部署动作**（不改容器、不改服务器）。
#
# 退出码契约（调用方据此分流；禁止解析 stdout 文案做判断）:
#   0  无新版（锁文件所钉版本 == 上游最新 release）
#   2  有新版，命中硬性阻断   → 「该版本尚不稳定，不适合更新」
#   3  有新版，无硬性阻断，但存在需人工确认项 → 「可评估升级」
#   1  运行错误（网络 / 解析 / 锁文件损坏 / 缺依赖）
#
# 用法: upstream-preflight.sh [选项]
#   --with-image        额外校验 GHCR 镜像指纹（需 ghcr.io 可达；不可达则 SKIP，不阻断）
#   --write-lock        判定通过后回写 upstream.lock（命中硬性阻断时拒绝；--force 可强制）
#   --force             与 --write-lock 同用：即使命中硬性阻断也回写
#   --fixture FILE      离线：用本地 release JSON 代替 GitHub API（测试用）
#   --changelog-file F  用本地文件代替拉取 CHANGELOG（离线/自定义审阅用）
#   --now ISO8601       覆盖「当前时间」（测试用，保证判定确定）
#   --soak-days N       覆盖沉淀期阈值（默认取锁文件 SOAK_DAYS_MIN）
#   --json              输出机器可读 JSON（供 GitHub Actions 消费）
#   --offline           禁止一切网络请求
#   -h | --help         本帮助
#
# 设计要点:
#   - 依赖仅 curl + python3(标准库)；不依赖 jq，不使用 GNU-only 特性
#   - 网络统一走 fetch_url()：15s 超时 + 3 次指数退避重试
#   - 锁文件按「键名白名单」逐行解析，**不使用** source / eval
#   - 报告写 stdout，日志写 stderr
#   - 判据定义见 memory.agent-mate.ai/specs/mcp/mcp-design.md §9 与 specs/deployment.md §9
#
# 准入判据（详见 deployment.md §9.4）:
#   硬性阻断 H1 非预发布版 / H2 沉淀期 ≥ SOAK_DAYS_MIN / H3 GHCR 有对应镜像
#            H4 候选不早于所钉版本 / H5 存在新鲜外迁备份（服务器侧人工确认）
#   人工确认 W1 CHANGELOG 破坏性关键词 / W2 schema 前向迁移 / W3 契约面差异
#            W4 镜像标签被重推 / W5 版本跨度 / W6 候选 commit 失败 check-run
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LOCK_FILE="${REPO_ROOT}/memory.agent-mate.ai/upstream.lock"
CLONE_DIR="${REPO_ROOT}/ai-memory-mcp"

GITHUB_API="https://api.github.com"
GHCR="https://ghcr.io"

OPT_WITH_IMAGE=0
OPT_WRITE_LOCK=0
OPT_FORCE=0
OPT_JSON=0
OPT_OFFLINE=0
OPT_FIXTURE=""
OPT_CHANGELOG_FILE=""
OPT_NOW=""
OPT_SOAK_DAYS=""

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

TMP_DIR=""
cleanup() { [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ] && rm -rf "$TMP_DIR"; }
trap cleanup EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    --with-image)     OPT_WITH_IMAGE=1 ;;
    --write-lock)     OPT_WRITE_LOCK=1 ;;
    --force)          OPT_FORCE=1 ;;
    --json)           OPT_JSON=1 ;;
    --offline)        OPT_OFFLINE=1 ;;
    --fixture)        shift; OPT_FIXTURE="${1:-}";        [ -n "$OPT_FIXTURE" ]        || die "--fixture 需要文件参数" ;;
    --changelog-file) shift; OPT_CHANGELOG_FILE="${1:-}"; [ -n "$OPT_CHANGELOG_FILE" ] || die "--changelog-file 需要文件参数" ;;
    --now)            shift; OPT_NOW="${1:-}";            [ -n "$OPT_NOW" ]            || die "--now 需要 ISO8601 参数" ;;
    --soak-days)      shift; OPT_SOAK_DAYS="${1:-}";      [ -n "$OPT_SOAK_DAYS" ]      || die "--soak-days 需要数字参数" ;;
    -h|--help)        usage; exit 0 ;;
    *)                die "未知参数: $1（--help 查看用法）" ;;
  esac
  shift
done

# fixture 模式默认离线，保证测试确定性
if [ -n "$OPT_FIXTURE" ]; then
  OPT_OFFLINE=1
  [ -f "$OPT_FIXTURE" ] || die "fixture 文件不存在: $OPT_FIXTURE"
fi

command -v curl    >/dev/null 2>&1 || die "缺少 curl"
command -v python3 >/dev/null 2>&1 || die "缺少 python3"

TMP_DIR="$(mktemp -d)" || die "mktemp 失败"

# ── 锁文件：键名白名单解析（不用 source / eval）───────────────────────────────
LOCK_VARS="LOCK_SCHEMA UPSTREAM_REPO UPSTREAM_URL UPSTREAM_RELEASE_TAG
UPSTREAM_RELEASE_COMMIT UPSTREAM_RELEASE_PUBLISHED_AT UPSTREAM_RELEASE_CHANNEL
IMAGE_REPO IMAGE_TAG IMAGE_DIGEST_MANIFEST IMAGE_DIGEST_AMD64
IMAGE_DIGEST_VERIFIED_BY UPSTREAM_SCHEMA_VERSION SOAK_DAYS_MIN
REFERENCE_CLONE_REF REFERENCE_CLONE_COMMIT VERIFIED_AT NOTES"
# 折叠换行为空格，否则「行尾键名」在下面的 " $key " 匹配中会失配（换行 ≠ 空格）
LOCK_VARS="$(printf '%s' "$LOCK_VARS" | tr '\n' ' ')"

for _v in $LOCK_VARS; do printf -v "$_v" '%s' ''; done

load_lock() {
  local line key val
  [ -f "$LOCK_FILE" ] || die "锁文件不存在: $LOCK_FILE"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    val="${line#*=}"
    val="${val#\"}"; val="${val%\"}"
    case " $LOCK_VARS " in
      *" $key "*) printf -v "$key" '%s' "$val" ;;
    esac
  done < "$LOCK_FILE"
}
load_lock

[ -n "$UPSTREAM_REPO" ]        || die "锁文件缺少 UPSTREAM_REPO"
[ -n "$UPSTREAM_RELEASE_TAG" ] || die "锁文件缺少 UPSTREAM_RELEASE_TAG"
[ -n "$IMAGE_REPO" ]           || die "锁文件缺少 IMAGE_REPO"

SOAK_DAYS="${OPT_SOAK_DAYS:-${SOAK_DAYS_MIN:-14}}"
case "$SOAK_DAYS" in ''|*[!0-9]*) die "沉淀期阈值必须是整数，实际: $SOAK_DAYS" ;; esac

require_network() { [ "$OPT_OFFLINE" -eq 0 ]; }

# ── 网络：超时 + 指数退避重试 ────────────────────────────────────────────────
fetch_url() { # $1=url $2=outfile [$3=accept]
  local url="$1" out="$2" accept="${3:-application/vnd.github+json}"
  local attempt=1 delay=2
  while [ "$attempt" -le 3 ]; do
    if curl -fsS --max-time 15 \
         -H "Accept: ${accept}" \
         -H 'User-Agent: memory-agent-mate-preflight' \
         -o "$out" "$url"; then
      return 0
    fi
    log "请求失败（第 ${attempt}/3 次）: ${url}"
    if [ "$attempt" -lt 3 ]; then sleep "$delay"; delay=$(( delay * 2 )); fi
    attempt=$(( attempt + 1 ))
  done
  return 1
}

json_get() { # $1=file $2=key
  python3 -c '
import json, sys
try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        print(json.load(fh).get(sys.argv[2], "") or "")
except Exception:
    print("")
' "$1" "$2"
}

# ── Phase 1: 候选 release ────────────────────────────────────────────────────
RELEASE_JSON="${TMP_DIR}/release.json"
: > "$RELEASE_JSON"
RELEASE_SOURCE="api"

if [ -n "$OPT_FIXTURE" ]; then
  cp "$OPT_FIXTURE" "$RELEASE_JSON"
  RELEASE_SOURCE="fixture"
  log "离线模式：使用 fixture ${OPT_FIXTURE}"
elif require_network; then
  log "查询上游最新 release: ${UPSTREAM_REPO}"
  fetch_url "${GITHUB_API}/repos/${UPSTREAM_REPO}/releases/latest" "$RELEASE_JSON" \
    || die "无法获取上游最新 release（网络不可达或限额用尽）"
else
  RELEASE_SOURCE="offline"
  die "离线模式必须用 --fixture 提供候选 release"
fi

CANDIDATE_TAG="$(json_get "$RELEASE_JSON" tag_name)"
[ -n "$CANDIDATE_TAG" ] || die "解析候选 release 失败（JSON 缺失 tag_name）"
CANDIDATE_VERSION="${CANDIDATE_TAG#v}"

# ── Phase 2: CHANGELOG 段落（判据 W1）────────────────────────────────────────
CHANGELOG_SECTION="${TMP_DIR}/changelog-section.md"
: > "$CHANGELOG_SECTION"
if [ -n "$OPT_CHANGELOG_FILE" ]; then
  [ -f "$OPT_CHANGELOG_FILE" ] || die "--changelog-file 不存在: $OPT_CHANGELOG_FILE"
  cp "$OPT_CHANGELOG_FILE" "$CHANGELOG_SECTION"
  log "使用本地 CHANGELOG: ${OPT_CHANGELOG_FILE}"
elif require_network; then
  RAW="${TMP_DIR}/changelog.md"
  if fetch_url "${GITHUB_API}/repos/${UPSTREAM_REPO}/contents/CHANGELOG.md?ref=${CANDIDATE_TAG}" "$RAW" \
       'application/vnd.github.raw'; then
    python3 - "$RAW" "$CANDIDATE_VERSION" > "$CHANGELOG_SECTION" <<'PY'
import re, sys
raw, version = sys.argv[1], sys.argv[2]
text = open(raw, encoding="utf-8", errors="replace").read()
lines = text.splitlines()
start = None
for i, ln in enumerate(lines):
    m = re.match(r"^##\s+\[?v?([0-9][^\s\]]*)\]?", ln)
    if m and m.group(1).startswith(version):
        start = i
        break
if start is not None:
    out = []
    for ln in lines[start:]:
        if out and re.match(r"^##\s+\[", ln):
            break
        out.append(ln)
    print("\n".join(out))
PY
    log "已提取 CHANGELOG 段落（${CANDIDATE_VERSION}）"
  else
    log "CHANGELOG 拉取失败 —— W1 标记为未判定"
  fi
fi

# ── Phase 3: 候选 tag 的 schema 版本（判据 W2）───────────────────────────────
SCHEMA_AT_TAG=""
if require_network; then
  MSRC="${TMP_DIR}/migrations.rs"
  if fetch_url "${GITHUB_API}/repos/${UPSTREAM_REPO}/contents/src/storage/migrations.rs?ref=${CANDIDATE_TAG}" \
       "$MSRC" 'application/vnd.github.raw'; then
    SCHEMA_AT_TAG="$(grep -m1 -oE 'CURRENT_SCHEMA_VERSION: i64 = [0-9]+' "$MSRC" | grep -oE '[0-9]+$' || true)"
  fi
fi

# ── Phase 4: 候选 commit 的 CI 结论（判据 H5）────────────────────────────────
CANDIDATE_COMMIT_SHA=""
if [ "$CANDIDATE_TAG" = "$UPSTREAM_RELEASE_TAG" ] && [ -n "$UPSTREAM_RELEASE_COMMIT" ]; then
  CANDIDATE_COMMIT_SHA="$UPSTREAM_RELEASE_COMMIT"
fi
if [ -z "$CANDIDATE_COMMIT_SHA" ] && require_network; then
  REFJSON="${TMP_DIR}/ref.json"
  if fetch_url "${GITHUB_API}/repos/${UPSTREAM_REPO}/commits/${CANDIDATE_TAG}" "$REFJSON"; then
    CANDIDATE_COMMIT_SHA="$(json_get "$REFJSON" sha)"
  fi
fi

CHECK_RUNS_STATUS="unknown"
CHECK_RUNS_NOTE="未查询"
if require_network && [ -n "$CANDIDATE_COMMIT_SHA" ]; then
  CRJSON="${TMP_DIR}/checkruns.json"
  if fetch_url "${GITHUB_API}/repos/${UPSTREAM_REPO}/commits/${CANDIDATE_COMMIT_SHA}/check-runs?per_page=100" "$CRJSON"; then
    python3 - "$CRJSON" > "${TMP_DIR}/cr.txt" <<'PY'
import json, sys
try:
    runs = json.load(open(sys.argv[1], encoding="utf-8")).get("check_runs", [])
except Exception:
    print("unknown\t解析失败")
    raise SystemExit
if not runs:
    print("unknown\t该 commit 无可查的 check-runs")
else:
    bad = [r for r in runs if r.get("conclusion") in ("failure", "timed_out", "cancelled", "action_required")]
    pending = [r for r in runs if r.get("status") != "completed"]
    if bad:
        names = ", ".join(sorted({(r.get("name") or "?") for r in bad})[:5])
        print("failed\t%d 项失败/取消: %s" % (len(bad), names))
    elif pending:
        print("pending\t%d 项未完成" % len(pending))
    else:
        print("ok\t%d 项全部通过" % len(runs))
PY
    if [ -s "${TMP_DIR}/cr.txt" ]; then
      IFS=$'\t' read -r CHECK_RUNS_STATUS CHECK_RUNS_NOTE < "${TMP_DIR}/cr.txt" || true
    fi
  else
    CHECK_RUNS_NOTE="check-runs 查询失败"
  fi
elif [ -n "$CANDIDATE_COMMIT_SHA" ]; then
  CHECK_RUNS_NOTE="离线模式未查询"
else
  CHECK_RUNS_NOTE="无法解析 tag 对应 commit"
fi
log "CI 结论: ${CHECK_RUNS_STATUS}（${CHECK_RUNS_NOTE}）"

# ── Phase 5: GHCR 镜像指纹（判据 H3 / W4；需 --with-image）───────────────────
IMAGE_STATUS="skip"
IMAGE_NOTE="未启用（加 --with-image 启用）"
IMAGE_DIGEST_MANIFEST_REMOTE=""
IMAGE_DIGEST_AMD64_REMOTE=""
if [ "$OPT_WITH_IMAGE" -eq 1 ]; then
  if ! require_network; then
    IMAGE_STATUS="skip"; IMAGE_NOTE="离线模式，跳过镜像校验"
  else
    REPO_PATH="${IMAGE_REPO#ghcr.io/}"
    TOKJSON="${TMP_DIR}/token.json"
    if fetch_url "${GHCR}/token?scope=repository:${REPO_PATH}:pull&service=ghcr.io" "$TOKJSON"; then
      TOKEN="$(json_get "$TOKJSON" token)"
      if [ -n "$TOKEN" ]; then
        HDR="${TMP_DIR}/img.hdr"; BODY="${TMP_DIR}/img.json"
        if curl -fsS --max-time 20 -D "$HDR" -o "$BODY" \
             -H "Authorization: Bearer ${TOKEN}" \
             -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json' \
             "${GHCR}/v2/${REPO_PATH}/manifests/${CANDIDATE_VERSION}"; then
          IMAGE_STATUS="ok"
          IMAGE_DIGEST_MANIFEST_REMOTE="$(tr -d '\r' < "$HDR" | awk 'tolower($1)=="docker-content-digest:"{print $2}' | head -1)"
          IMAGE_DIGEST_AMD64_REMOTE="$(python3 -c '
import json, sys
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    print(""); raise SystemExit
for m in d.get("manifests", []):
    p = m.get("platform", {}) or {}
    if p.get("os") == "linux" and p.get("architecture") == "amd64":
        print(m.get("digest", "")); raise SystemExit
print("")
' "$BODY")"
          IMAGE_NOTE="清单 ${IMAGE_DIGEST_MANIFEST_REMOTE:-?}${IMAGE_DIGEST_AMD64_REMOTE:+ / amd64 ${IMAGE_DIGEST_AMD64_REMOTE}}"
        else
          IMAGE_STATUS="missing"
          IMAGE_NOTE="GHCR 上不存在 tag ${CANDIDATE_VERSION} 的镜像"
        fi
      else
        IMAGE_STATUS="skip"; IMAGE_NOTE="ghcr.io 鉴权失败（匿名 token 不可用）"
      fi
    else
      IMAGE_STATUS="skip"; IMAGE_NOTE="ghcr.io 不可达（本机常被阻断）"
    fi
  fi
fi
log "镜像校验: ${IMAGE_STATUS}（${IMAGE_NOTE}）"

# ── Phase 6: 判据引擎（python）───────────────────────────────────────────────
export LOCK_FILE CHANGELOG_FILE="$CHANGELOG_SECTION"
export PREFLIGHT_NOW="$OPT_NOW"
export PREFLIGHT_SOAK_DAYS="$SOAK_DAYS"
export PREFLIGHT_CANDIDATE_TAG="$CANDIDATE_TAG"
export PREFLIGHT_CANDIDATE_VERSION="$CANDIDATE_VERSION"
export PREFLIGHT_CANDIDATE_COMMIT_SHA="$CANDIDATE_COMMIT_SHA"
export PREFLIGHT_RELEASE_SOURCE="$RELEASE_SOURCE"
export PREFLIGHT_IMAGE_STATUS="$IMAGE_STATUS"
export PREFLIGHT_IMAGE_NOTE="$IMAGE_NOTE"
export PREFLIGHT_IMAGE_DIGEST_MANIFEST="$IMAGE_DIGEST_MANIFEST_REMOTE"
export PREFLIGHT_IMAGE_DIGEST_AMD64="$IMAGE_DIGEST_AMD64_REMOTE"
export PREFLIGHT_CHECK_RUNS_STATUS="$CHECK_RUNS_STATUS"
export PREFLIGHT_CHECK_RUNS_NOTE="$CHECK_RUNS_NOTE"
export PREFLIGHT_SCHEMA_AT_TAG="$SCHEMA_AT_TAG"
export PREFLIGHT_JSON="$OPT_JSON"

set +e
python3 - "$RELEASE_JSON" <<'PY'
import datetime, json, os, re, sys

def env(key, default=""):
    return os.environ.get(key, default)

# ---------- 锁文件 ----------
lock = {}
try:
    with open(env("LOCK_FILE"), encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            lock[k.strip()] = v.strip().strip('"')
except OSError as exc:
    print("ERROR: 无法读取锁文件: %s" % exc, file=sys.stderr)
    raise SystemExit(1)

try:
    with open(sys.argv[1], encoding="utf-8") as fh:
        rel = json.load(fh)
except Exception as exc:
    print("ERROR: 解析 release JSON 失败: %s" % exc, file=sys.stderr)
    raise SystemExit(1)

def parse_ts(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None

now = parse_ts(env("PREFLIGHT_NOW")) or datetime.datetime.now(datetime.timezone.utc)
published = parse_ts(rel.get("published_at"))
soak_days = int(env("PREFLIGHT_SOAK_DAYS") or lock.get("SOAK_DAYS_MIN") or "14")

cand_tag = env("PREFLIGHT_CANDIDATE_TAG") or rel.get("tag_name", "")
cand_ver = env("PREFLIGHT_CANDIDATE_VERSION") or cand_tag.lstrip("v")
pin_tag = lock.get("UPSTREAM_RELEASE_TAG", "")
pin_ver = pin_tag.lstrip("v")

def ver_tuple(v):
    parts = re.findall(r"\d+", v or "")
    return tuple(int(p) for p in parts[:3]) if parts else (0,)

# ---------- H1..H6 ----------
age_days = (now - published).total_seconds() / 86400.0 if published else None

h1_ok = not (rel.get("prerelease") or rel.get("draft"))
h1_detail = "预发布/草稿版本" if not h1_ok else "正式发布（prerelease=false, draft=false）"

if age_days is None:
    h2_ok, h2_detail = False, "缺少 published_at，无法判定沉淀期"
else:
    h2_ok = age_days >= soak_days
    h2_detail = "已发布 %.1f 天（阈值 %d 天）" % (age_days, soak_days)

img_status = env("PREFLIGHT_IMAGE_STATUS", "skip")
if img_status == "ok":
    h3_ok, h3_detail = True, env("PREFLIGHT_IMAGE_NOTE")
elif img_status == "missing":
    h3_ok, h3_detail = False, env("PREFLIGHT_IMAGE_NOTE")
else:
    h3_ok, h3_detail = None, "未校验（%s）" % env("PREFLIGHT_IMAGE_NOTE")

h4_ok = ver_tuple(cand_ver) >= ver_tuple(pin_ver)
h4_detail = ("候选 %s ≥ 所钉 %s" % (cand_ver, pin_ver)) if h4_ok else \
            ("候选 %s 低于所钉 %s（疑似降级）" % (cand_ver, pin_ver))

checks_h = [
    {"id": "H1", "name": "非预发布版", "ok": h1_ok, "detail": h1_detail},
    {"id": "H2", "name": "沉淀期 ≥ %d 天" % soak_days, "ok": h2_ok, "detail": h2_detail},
    {"id": "H3", "name": "GHCR 存在对应镜像", "ok": h3_ok, "detail": h3_detail},
    {"id": "H4", "name": "候选不早于当前所钉版本", "ok": h4_ok, "detail": h4_detail},
    {"id": "H5", "name": "存在新鲜外迁备份（人工确认）", "ok": None,
     "detail": "服务器侧判据：升级前须确认 OSS 上存在新鲜外迁备份（deployment.md §9.4 W3）"},
]

# ---------- W1：CHANGELOG 破坏性关键词 ----------
KEYWORDS = ["secure-default", "secure default", "fail-open", "fail-closed", "fail open",
            "fail closed", "breaking", "removed", "deprecated", "erratum", "errata",
            "attestation required", "default flip", "migration guide"]
changelog = ""
try:
    with open(env("CHANGELOG_FILE"), encoding="utf-8", errors="replace") as fh:
        changelog = fh.read()
except OSError:
    pass
if not changelog.strip():
    w1_ok, w1_detail = None, "未取得 CHANGELOG（离线或拉取失败）"
else:
    low = changelog.lower()
    hits = sorted({k for k in KEYWORDS if k in low})
    w1_ok = not hits
    w1_detail = ("命中: %s" % ", ".join(hits)) if hits else "未命中破坏性关键词"

# ---------- W2：schema 前向迁移 ----------
schema_at_tag = env("PREFLIGHT_SCHEMA_AT_TAG", "")
base_schema = lock.get("UPSTREAM_SCHEMA_VERSION", "")
if schema_at_tag and base_schema:
    advanced = int(schema_at_tag) > int(base_schema)
    w2_ok = not advanced
    w2_detail = ("schema %s → %s（前向-only 迁移；回滚必须用快照覆盖，见耦合面清单 J3）"
                 % (base_schema, schema_at_tag)) if advanced else "schema 未前进（%s）" % schema_at_tag
elif schema_at_tag:
    w2_ok, w2_detail = None, "候选 schema=%s，但锁文件缺 UPSTREAM_SCHEMA_VERSION" % schema_at_tag
else:
    w2_ok, w2_detail = None, "未取得候选 schema 版本"

# ---------- W3：契约面差异（需镜像）----------
w3_ok, w3_detail = None, "未校验（需 --with-image，并在服务器/CI 上对镜像跑 --help / doctor 比对）"

# ---------- W4：标签被重推 ----------
# 语义前提：只有「候选版本 == 当前所钉的 IMAGE_TAG」时，digest 才应该一致。
# 候选是**另一个版本**时 digest 天然不同，那不是「标签被重推」，不能误报。
if img_status == "ok" and lock.get("IMAGE_DIGEST_MANIFEST") and cand_ver == lock.get("IMAGE_TAG"):
    same_manifest = env("PREFLIGHT_IMAGE_DIGEST_MANIFEST") == lock.get("IMAGE_DIGEST_MANIFEST")
    remote_amd = env("PREFLIGHT_IMAGE_DIGEST_AMD64")
    same_amd = (not remote_amd) or remote_amd == lock.get("IMAGE_DIGEST_AMD64")
    w4_ok = same_manifest and same_amd
    w4_detail = ("指纹一致（%s…）" % env("PREFLIGHT_IMAGE_DIGEST_MANIFEST")[:19]) if w4_ok else \
                "指纹不一致 —— 同名 tag 内容已变，该标签被重推过，必须人工审阅"
else:
    w4_ok, w4_detail = None, "未校验（需 --with-image）"

# ---------- W5：版本跨度 ----------
ct, pt = ver_tuple(cand_ver), ver_tuple(pin_ver)
if ct == pt:
    w5_ok, w5_detail = True, "同一版本"
elif ct[0] != pt[0]:
    w5_ok, w5_detail = False, "跨 major（%s → %s），跨度极大，灰度需更慎重" % (pin_ver, cand_ver)
elif ct[1] - pt[1] >= 2:
    w5_ok, w5_detail = False, "跨 %d 个 minor（%s → %s），跨度较大，灰度需更慎重" % (ct[1] - pt[1], pin_ver, cand_ver)
else:
    w5_ok, w5_detail = True, "跨越 %d 个 minor" % max(ct[1] - pt[1], 0)

# ---------- W6：候选 commit 的失败 check-run ----------
# 为什么不是硬性阻断：本部署消费的是**镜像**，而「镜像构建成功」已由 H3 直接证明。
# 上游在同一个 release commit 上还跑 npm / PyPI / Homebrew / mobile 等**与本部署无关**
# 的发布 job；把它们的失败当作硬阻断会让闸门可能永远无法通过（v0.10.0 即为此例：
# `publish @alphaone/ai-memory to npm` 失败，但 GHCR 镜像完好）。故降级为人工确认项。
cr = env("PREFLIGHT_CHECK_RUNS_STATUS", "unknown")
if cr == "ok":
    w6_ok, w6_detail = True, env("PREFLIGHT_CHECK_RUNS_NOTE")
elif cr == "failed":
    w6_ok, w6_detail = False, env("PREFLIGHT_CHECK_RUNS_NOTE") + "（可能与本部署无关，请人工判断）"
else:
    w6_ok, w6_detail = None, "未判定（%s）" % env("PREFLIGHT_CHECK_RUNS_NOTE")

checks_w = [
    {"id": "W1", "name": "CHANGELOG 无破坏性关键词", "ok": w1_ok, "detail": w1_detail},
    {"id": "W2", "name": "schema 未发生前向迁移", "ok": w2_ok, "detail": w2_detail},
    {"id": "W3", "name": "契约面无差异", "ok": w3_ok, "detail": w3_detail},
    {"id": "W4", "name": "镜像标签未被重推", "ok": w4_ok, "detail": w4_detail},
    {"id": "W5", "name": "版本跨度不大", "ok": w5_ok, "detail": w5_detail},
    {"id": "W6", "name": "候选 commit 无失败 check-run", "ok": w6_ok, "detail": w6_detail},
]

blocked = [c for c in checks_h if c["ok"] is False]
warned = [c for c in checks_w if c["ok"] is False]
unknown = [c for c in checks_h + checks_w if c["ok"] is None]

# ---------- 结论 ----------
if cand_tag == pin_tag:
    verdict, code = "up_to_date", 0
    message = "上游无新版：%s 即当前所钉版本" % cand_tag
elif blocked:
    verdict, code = "unstable", 2
    message = "ai-memory %s —— 该版本尚不稳定，不适合更新" % cand_tag
else:
    verdict, code = "ready", 3
    message = "ai-memory %s —— 可评估升级（人工确认后按 deployment.md §9.2 执行）" % cand_tag

suggest = ""
if code == 2:
    if not h1_ok:
        suggest = "该 tag 为预发布版，上游不为其构建镜像；等待正式 release 后再评估。"
    elif published is not None and age_days is not None and age_days < soak_days:
        eta = published + datetime.timedelta(days=soak_days)
        suggest = "沉淀期不足：建议 %s 之后重跑 make preflight。" % eta.strftime("%Y-%m-%d")

def mark(ok):
    return "✅" if ok is True else ("❌" if ok is False else "—")

if env("PREFLIGHT_JSON") == "1":
    print(json.dumps({
        "verdict": verdict,
        "exit_code": code,
        "message": message,
        "suggestion": suggest,
        "source": env("PREFLIGHT_RELEASE_SOURCE"),
        "pinned": {"tag": pin_tag, "image_tag": lock.get("IMAGE_TAG", ""),
                   "commit": lock.get("UPSTREAM_RELEASE_COMMIT", ""),
                   "schema_version": lock.get("UPSTREAM_SCHEMA_VERSION", "")},
        "candidate": {"tag": cand_tag, "published_at": rel.get("published_at", ""),
                      "age_days": round(age_days, 2) if age_days is not None else None,
                      "commit": env("PREFLIGHT_CANDIDATE_COMMIT_SHA"),
                      "schema_version": schema_at_tag,
                      "changelog_url": "https://github.com/%s/blob/%s/CHANGELOG.md"
                                       % (lock.get("UPSTREAM_REPO", ""), cand_tag)},
        "hard_blocks": blocked,
        "warnings": warned,
        "unknown": unknown,
        "soak_days_min": soak_days,
        "checked_at": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }, ensure_ascii=False, indent=2))
else:
    print("=== ai-memory 上游版本预检 ===")
    print("数据来源       : %s" % env("PREFLIGHT_RELEASE_SOURCE"))
    print("本部署所钉版本 : %s（IMAGE_TAG=%s，schema=%s，commit=%s）"
          % (pin_tag or "?", lock.get("IMAGE_TAG", "?"), lock.get("UPSTREAM_SCHEMA_VERSION", "?"),
             (lock.get("UPSTREAM_RELEASE_COMMIT", "") or "?")[:10]))
    print("上游最新 release: %s（发布 %s，沉淀 %s 天，commit %s）"
          % (cand_tag, rel.get("published_at", "?"),
             ("%.1f" % age_days) if age_days is not None else "?",
             (env("PREFLIGHT_CANDIDATE_COMMIT_SHA") or "?")[:10]))
    print()
    print("硬性阻断判据")
    for c in checks_h:
        print("  %s %-30s %s" % (mark(c["ok"]), "%s %s" % (c["id"], c["name"]), c["detail"]))
    print("人工确认项")
    for c in checks_w:
        print("  %s %-30s %s" % (mark(c["ok"]), "%s %s" % (c["id"], c["name"]), c["detail"]))
    print()
    print("-" * 74)
    if code == 0:
        print("✅ 准入判定：无新版，无需动作")
    elif code == 2:
        print("❌ 准入判定：不通过")
        print("   %s" % message)
        for c in blocked:
            print("   不满足 %s %s：%s" % (c["id"], c["name"], c["detail"]))
    else:
        print("⚠️  准入判定：可评估升级")
        print("   %s" % message)
        for c in warned:
            print("   注意 %s %s：%s" % (c["id"], c["name"], c["detail"]))
    if suggest:
        print("   建议：%s" % suggest)
    if unknown:
        print("   未判定项（需人工/服务器侧确认）：%s" % ", ".join(c["id"] for c in unknown))
    print("-" * 74)

raise SystemExit(code)
PY
PY_RC=$?
set -e

# ── Phase 7: --write-lock ────────────────────────────────────────────────────
if [ "$OPT_WRITE_LOCK" -eq 1 ]; then
  if [ "$PY_RC" -eq 1 ]; then
    die "判定过程出错，未回写锁文件"
  elif [ "$PY_RC" -eq 2 ] && [ "$OPT_FORCE" -ne 1 ]; then
    log "拒绝回写锁文件：候选版本命中硬性阻断（确需回写请加 --force）"
  else
    set_lock_key() {
      local key="$1" val="$2" tmp
      tmp="${TMP_DIR}/lock.new"
      awk -v k="$key" -v v="$val" '
        index($0, k "=") == 1 { print k "=\"" v "\""; found = 1; next }
        { print }
        END { if (!found) print k "=\"" v "\"" }
      ' "$LOCK_FILE" > "$tmp"
      mv "$tmp" "$LOCK_FILE"
    }

    NEW_PUBLISHED="$(json_get "$RELEASE_JSON" published_at)"
    NEWS_SCHEMA="${SCHEMA_AT_TAG}"

    set_lock_key UPSTREAM_RELEASE_TAG "$CANDIDATE_TAG"
    [ -n "$CANDIDATE_COMMIT_SHA" ] && set_lock_key UPSTREAM_RELEASE_COMMIT "$CANDIDATE_COMMIT_SHA"
    [ -n "$NEW_PUBLISHED" ]        && set_lock_key UPSTREAM_RELEASE_PUBLISHED_AT "$NEW_PUBLISHED"
    set_lock_key UPSTREAM_RELEASE_CHANNEL "stable"
    set_lock_key IMAGE_TAG "$CANDIDATE_VERSION"
    [ -n "$NEWS_SCHEMA" ] && set_lock_key UPSTREAM_SCHEMA_VERSION "$NEWS_SCHEMA"
    if [ -n "$IMAGE_DIGEST_MANIFEST_REMOTE" ]; then
      set_lock_key IMAGE_DIGEST_MANIFEST "$IMAGE_DIGEST_MANIFEST_REMOTE"
      [ -n "$IMAGE_DIGEST_AMD64_REMOTE" ] && set_lock_key IMAGE_DIGEST_AMD64 "$IMAGE_DIGEST_AMD64_REMOTE"
      set_lock_key IMAGE_DIGEST_VERIFIED_BY "registry-api"
    fi
    if [ -d "${CLONE_DIR}/.git" ]; then
      set_lock_key REFERENCE_CLONE_COMMIT "$(git -C "$CLONE_DIR" rev-parse HEAD)"
    fi
    set_lock_key VERIFIED_AT "$(date -u +%Y-%m-%d)"
    log "锁文件已回写: ${LOCK_FILE}"
  fi
fi

exit "$PY_RC"
