#!/usr/bin/env bash
# restore-drill.sh —— 恢复演练（Sprint 5 `#15`；入口 `make restore-drill`）
#
# 流程（判据真源 = Sprint 5 `#15` 的 AC）：**拉最新 → 校验 → restore → `doctor` 通过**
#
# ⚠️ **演练的纪律：绝不动生产。** 本脚本只写 `--workdir`（默认 `/tmp/restore-drill-<ts>`）；
#   恢复目标永远是**隔离目录**，`/data` 与 `/srv/portal` 只读。演练的目的是回答
#   「这份快照**真能**恢复出一份可用的库吗」，而不是「把生产恢复回去」——后者是人工决策
#   （见 `specs/release-readiness.md` §3 的回滚点与回滚步骤）。
#
# 用法：
#   bash backup/restore-drill.sh --snapshot /var/backups/ai-memory/<ts>      # 本地快照
#   bash backup/restore-drill.sh --from-oss                                  # 从 OSS 拉最新（需 ossutil + OSS_BUCKET）
#   bash backup/restore-drill.sh --snapshot DIR --doctor-cmd 'docker exec ai-memory-mcp ai-memory doctor'
#
# 退出码（与仓内探针同口径）：0 = 演练通过 · 10 = 有失败 · 30 = 未判（缺快照/缺工具/doctor 无通路）· 20 = 用法错

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SNAPSHOT=''
FROM_OSS=0
WORKDIR=''
DOCTOR_CMD=''
KEEP=0

usage() { sed -n '2,20p' "${BASH_SOURCE[0]}"; }
die() { printf '错误：%s\n' "$1" >&2; exit "${2:-10}"; }
log() { printf '%s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --snapshot) SNAPSHOT="${2:-}"; shift 2 ;;
    --from-oss) FROM_OSS=1; shift ;;
    --workdir) WORKDIR="${2:-}"; shift 2 ;;
    --doctor-cmd) DOCTOR_CMD="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf '未知参数：%s\n' "$1" >&2; usage >&2; exit 20 ;;
  esac
done

command -v sqlite3 >/dev/null 2>&1 || { printf '未判：本机无 sqlite3（校验与恢复都依赖它）\n'; exit 30; }
if command -v sha256sum >/dev/null 2>&1; then SUM='sha256sum'; else SUM='shasum -a 256'; fi

# ── ① 拉最新（或直接用给定快照）──────────────────────────────────────────────────────────────
if [ "${FROM_OSS}" = '1' ]; then
  command -v ossutil >/dev/null 2>&1 || { printf '未判：本机无 ossutil ⇒ 无法从 OSS 拉最新\n'; exit 30; }
  [ -n "${OSS_BUCKET:-}" ] || { printf '未判：OSS_BUCKET 未设 ⇒ 无法从 OSS 拉最新（本机可先用 --snapshot）\n'; exit 30; }
  PREFIX="oss://${OSS_BUCKET}/${OSS_PREFIX:-ai-memory-backup}/"
  LATEST="$(ossutil ls "${PREFIX}" 2>/dev/null | grep -oE "${PREFIX}[0-9]{8}T[0-9]{6}Z/" | sort | tail -1)"
  [ -n "${LATEST}" ] || die 'OSS 上找不到任何快照目录（前缀下还没有快照？先跑一次 backup）' 10
  PULL="$(mktemp -d)"
  log "① 拉最新：${LATEST} → ${PULL}"
  ossutil cp -r "${LATEST}" "${PULL}/" -f >/dev/null || die '下载快照失败'
  # ⚠️ `ossutil cp -r oss://bucket/prefix/ localdir/` 的**落点因版本而异**：
  #   v1.7.19 实测把 prefix 下的**内容**直接放进 localdir/（**不多建**一层以 prefix 末段命名的目录），
  #   别的形态可能保留 `<末段>/` 那一层 ⇒ 这里**两种都探测**，别赌（2026-09-27 首次真跑 `--from-oss` 时踩到）。
  if [ -s "${PULL}/SHA256SUMS" ]; then
    SNAPSHOT="${PULL}"
  elif [ -s "${PULL}/$(basename "${LATEST}")/SHA256SUMS" ]; then
    SNAPSHOT="${PULL}/$(basename "${LATEST}")"
  else
    die "下载回来的快照结构不认识（既无 SHA256SUMS、也无一层同名目录）：$(ls -A "${PULL}" | tr '\n' ' ')"
  fi
else
  [ -n "${SNAPSHOT}" ] || { printf '未判：未指定快照（--snapshot DIR 或 --from-oss）\n'; exit 30; }
  [ -d "${SNAPSHOT}" ] || { printf '未判：快照目录不存在：%s\n' "${SNAPSHOT}"; exit 30; }
  log "① 使用快照：${SNAPSHOT}"
fi

[ -n "${WORKDIR}" ] || WORKDIR="/tmp/restore-drill-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "${WORKDIR}"

START="$(date -u +%s)"
FAIL=0

# ── ② 校验（sha256 清单；快照自身不可信时**绝不**继续恢复）────────────────────────────────────
log '② 校验快照（SHA256SUMS）'
if [ ! -s "${SNAPSHOT}/SHA256SUMS" ]; then die "快照缺 SHA256SUMS（${SNAPSHOT}）"; fi
if ( cd "${SNAPSHOT}" && ${SUM} -c SHA256SUMS >/dev/null 2>&1 ); then
  log "  ✓ $(wc -l <"${SNAPSHOT}/SHA256SUMS" | tr -d ' ') 项一致"
else
  die '快照 sha256 校验**不一致** ⇒ 拒绝恢复（快照不可信）' 10
fi

# ── ③ 恢复（到**隔离目录**；用 `.restore` 而非 cp，语义与 `.backup` 对偶）──────────────────────
log "③ 恢复到隔离目录 ${WORKDIR}（**未接触 /data 与 /srv/portal**）"
RESTORED=0
for db in "${SNAPSHOT}"/data/ai-memory.db "${SNAPSHOT}"/data/users/*/ai-memory.db "${SNAPSHOT}"/portal/portal.db; do
  [ -f "${db}" ] || continue
  rel="${db#"${SNAPSHOT}"/}"
  dst="${WORKDIR}/${rel}"
  mkdir -p "$(dirname "${dst}")"
  if sqlite3 "${dst}" ".restore '${db}'" >/dev/null 2>&1; then
    RESTORED=$((RESTORED + 1)); log "  ✓ ${rel}"
  else
    log "  ✗ ${rel}（.restore 失败）"; FAIL=$((FAIL + 1))
  fi
done
[ "${RESTORED}" -gt 0 ] || die '没有任何库被恢复（快照结构不对？）'
[ "${FAIL}" -eq 0 ] || die "有 ${FAIL} 个库恢复失败" 10

# ── ④ 恢复后自检：integrity_check + 表存在性（门户库含身份/审计表）────────────────────────────
log '④ 恢复后自检（integrity_check + 关键表）'
# **不猜上游库的表名**：主库/用户库的表结构归上游（其语义正确性由 AC 原文里的 `doctor` 判，见 ⑤），
# 这里只做与 schema 无关的 `PRAGMA integrity_check`。而**门户库**的表是我方 schema（`admin_portal/src/web/db/schema.sql`）
# ⇒ 可以且应当逐表核对（`users` / `keys` / `audit`）。
check_db() { # $1=库 $2...=必须存在的表（可省略 ⇒ 只做 integrity_check）
  local f="$1"; local label="${1#"${WORKDIR}"/}"; shift
  [ "$(sqlite3 "${f}" 'PRAGMA integrity_check;' 2>/dev/null)" = 'ok' ] || { log "  ✗ ${label}：integrity_check 未通过"; FAIL=$((FAIL + 1)); return 0; }
  for t in "$@"; do
    if [ "$(sqlite3 "${f}" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name='${t}';" 2>/dev/null)" = '0' ]; then
      log "  ✗ ${label}：缺表 ${t}"; FAIL=$((FAIL + 1)); return 0
    fi
  done
  # 用**相对路径**当标签：三个库都叫 ai-memory.db，只打 basename 会分不清是哪个用户
  if [ "$#" -gt 0 ]; then log "  ✓ ${label}（integrity ok；表：$*）"
  else log "  ✓ ${label}（integrity ok）"; fi
}
check_db "${WORKDIR}/data/ai-memory.db"
for f in "${WORKDIR}"/data/users/*/ai-memory.db; do [ -f "${f}" ] && check_db "${f}"; done
[ -f "${WORKDIR}/portal/portal.db" ] && check_db "${WORKDIR}/portal/portal.db" users keys audit

# ── ⑤ `doctor` 通过（AC 原文）—— 无通路时**如实未判**，不伪装通过 ──────────────────────────────
RTO=$(( $(date -u +%s) - START ))
log '⑤ doctor 通过性（AC 原文的第二段）'
if [ -n "${DOCTOR_CMD}" ]; then
  if eval "${DOCTOR_CMD}" >/dev/null 2>&1; then log "  ✓ doctor：${DOCTOR_CMD}"
  else log "  ✗ doctor 失败：${DOCTOR_CMD}"; FAIL=$((FAIL + 1)); fi
  DOCTOR_STATUS='判过'
else
  log '  未判：未给 --doctor-cmd（生产演练填 docker exec ai-memory-mcp ai-memory doctor；本机离线判不了）'
  DOCTOR_STATUS='未判'
fi

log "RTO（本机演练实测）= ${RTO}s · 恢复 ${RESTORED} 库 · 隔离目录 ${WORKDIR}"
[ "${KEEP}" = '1' ] || log "（演练产物保留在 ${WORKDIR} 供人工核查；由你决定何时删除 —— 本脚本不自动删）"

if [ "${FAIL}" -gt 0 ]; then exit 10; fi
if [ "${DOCTOR_STATUS}" = '未判' ]; then
  printf '未判：恢复与自检全过，但 doctor 通路未判（需 `#8`/生产容器）⇒ 本次演练按「部分判定」计\n'
  exit 30
fi
log '演练通过（校验 → 恢复 → 自检 → doctor 全过）'
exit 0
