#!/usr/bin/env bash
# backup-and-push.sh —— 记忆库备份并外迁（Sprint 5 `#15`；入口 `make backup`）
#
# 流程（判据真源 = Sprint 5 `#15` 的 AC，逐条对应）：
#   ① 快照  ② sha256  ③ ossutil 上传  ④ **回读比对**  ⑤ **失败非零退出**
#   · 遍历范围 = `/data/users/*`（每用户一库）+ 主库 `/data/ai-memory.db` + **门户库** `/srv/portal/portal.db`
#
# ⚠️ **为什么必须用 SQLite 的 `.backup` 而不是 `cp`**：ai-memory 的库是 **SQLite + WAL**
#   （门户库同理）。WAL 模式下「已提交但尚未 checkpoint」的数据在 `-wal` 文件里 ⇒ 裸 `cp` 主库会拿到
#   **不一致/缺数据**的快照。`.backup` 走 SQLite 的在线备份 API：对 WAL 安全、自动拿一致视图。
#   （这条口径由 `#3` 探针登记给本行，见 `specs/sprint-backlog.md` 的 `#3` 行与 `#15` 行。）
#
# 用法：
#   bash backup/backup-and-push.sh                     # 生产：默认上传到 oss://$OSS_BUCKET/$OSS_PREFIX/<ts>/
#   bash backup/backup-and-push.sh --no-upload         # 只做本地快照（离线自测 / `#8` 未就绪时）
#   bash backup/backup-and-push.sh --data-root DIR --portal-db FILE   # 指定数据源（夹具/离线）
#   bash backup/backup-and-push.sh --container NAME    # 从容器取数（生产推荐：不摸宿主卷路径）
#
# 环境（外迁段，全部可由环境覆盖；**凭据不落任何文件**）：
#   OSS_BUCKET（必填，未给且未 --no-upload ⇒ 退 30）· OSS_PREFIX（默认 ai-memory-backup）
#   ossutil 的 AK/SK 走它自己的配置（`~/.ossutilconfig`，`chmod 600`）—— 本脚本**不碰凭据**。
#
# 退出码（与仓内探针同口径）：0 = 成功 · 10 = 有失败 · 30 = 未判（缺工具/缺前置）· 20 = 用法错

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/.." && pwd)"

DATA_ROOT='/data'
PORTAL_DB='/srv/portal/portal.db'
CONTAINER=''          # 非空 ⇒ 用 docker cp 从容器取数（生产推荐）
OUT_ROOT="${BACKUP_OUT_ROOT:-/var/backups/ai-memory}"
STAMP=''
NO_UPLOAD=0
VERIFY='full'         # full | meta（meta 只回读校验清单，不下载全部内容）
KEEP_STAGE=0

usage() { sed -n '2,22p' "${BASH_SOURCE[0]}"; }
die() { printf '错误：%s\n' "$1" >&2; exit "${2:-10}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --data-root) DATA_ROOT="${2:-}"; shift 2 ;;
    --portal-db) PORTAL_DB="${2:-}"; shift 2 ;;
    --container) CONTAINER="${2:-}"; shift 2 ;;
    --out) OUT_ROOT="${2:-}"; shift 2 ;;
    --stamp) STAMP="${2:-}"; shift 2 ;;
    --verify) VERIFY="${2:-full}"; shift 2 ;;
    --no-upload) NO_UPLOAD=1; shift ;;
    --keep-stage) KEEP_STAGE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf '未知参数：%s\n' "$1" >&2; usage >&2; exit 20 ;;
  esac
done

command -v sqlite3 >/dev/null 2>&1 || { printf '未判：本机无 sqlite3（快照依赖 SQLite 在线备份 API）\n'; exit 30; }
[ -n "${STAMP}" ] || STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

DEST="${OUT_ROOT}/${STAMP}"
STAGE=''
cleanup() {
  if [ -n "${STAGE}" ] && [ "${KEEP_STAGE}" = '0' ]; then rm -rf "${STAGE}"; fi
}
trap cleanup EXIT

log() { printf '%s\n' "$*"; }
sum_file() { # $1=文件 → sha256（macOS 无 sha256sum 时退 shasum）
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}
sum_check() { # $1=目录（含 SHA256SUMS）→ 0 校验通过
  if command -v sha256sum >/dev/null 2>&1; then ( cd "$1" && sha256sum -c SHA256SUMS >/dev/null 2>&1 )
  else ( cd "$1" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ); fi
}

mkdir -p "${DEST}" || die "无法创建输出目录 ${DEST}"

# ── 取数：容器 or 本地 ────────────────────────────────────────────────────────────────────────
if [ -n "${CONTAINER}" ]; then
  command -v docker >/dev/null 2>&1 || { printf '未判：给了 --container 但本机无 docker\n'; exit 30; }
  STAGE="$(mktemp -d)" || die '无法建临时目录'
  log "取数：容器 ${CONTAINER} → ${STAGE}（docker cp；不直接访问宿主卷路径）"
  docker cp "${CONTAINER}:${DATA_ROOT}/." "${STAGE}/data/" >/dev/null 2>&1 \
    || die "docker cp 取 ${DATA_ROOT} 失败（容器名/路径是否对？）"
  # 门户库可能不在同一容器 ⇒ 单独取；取不到就如实记为缺项（门户库在 `/srv/portal`，见 compose 的 portal_data 卷）
  if docker cp "${CONTAINER}:${PORTAL_DB}" "${STAGE}/portal.db" >/dev/null 2>&1; then
    : >"${STAGE}/.portal-present"
  fi
  SRC_DATA="${STAGE}/data"; SRC_PORTAL="${STAGE}/portal.db"
else
  SRC_DATA="${DATA_ROOT}"; SRC_PORTAL="${PORTAL_DB}"
fi

[ -d "${SRC_DATA}" ] || { printf '未判：数据根不存在 %s（生产上请用 --container，或确认卷已挂）\n' "${SRC_DATA}"; exit 30; }

# ── ① 快照（`.backup`，WAL 安全）+ ② sha256 ───────────────────────────────────────────────────
COUNT=0; FAIL=0
snapshot_one() { # $1=源库 $2=目标相对路径
  # ⚠️ `local` 必须**分行**：`local src="$1" rel="$2" dst="${DEST}/${rel}"` 在 `set -u` 下会报
  # `rel: unbound variable` —— 同一条 `local` 从左到右赋值，`dst` 展开时 `rel` **还没赋**（首版即栽在这）。
  local src="$1"; local rel="$2"; local dst="${DEST}/${rel}"
  mkdir -p "$(dirname "${dst}")"
  if [ ! -f "${src}" ]; then return 1; fi
  if sqlite3 "${src}" ".backup '${dst}'" >/dev/null 2>&1; then
    # 快照必须自身可校验（integrity_check）—— 否则「快照成功」是假象
    if [ "$(sqlite3 "${dst}" 'PRAGMA integrity_check;' 2>/dev/null)" = 'ok' ]; then
      COUNT=$((COUNT + 1)); printf '  ✓ %s\n' "${rel}"; return 0
    fi
    printf '  ✗ %s（快照 integrity_check 未通过）\n' "${rel}"; FAIL=$((FAIL + 1)); return 0
  fi
  printf '  ✗ %s（.backup 失败）\n' "${rel}"; FAIL=$((FAIL + 1)); return 0
}

# ⚠️ 文案一律**不用反引号**（仓内坑 7）：双引号内的反引号仍会**命令替换** —— 首版写
# log "…（SQLite `.backup`；…）" ⇒ `.backup` 被当命令执行（`command not found`）且标题被吞。
log '① 快照（SQLite 在线备份 API，WAL 安全）· 目标见上'
snapshot_one "${SRC_DATA}/ai-memory.db" 'data/ai-memory.db'
# 遍历范围 = `/data/users/*`（AC 原文）
if [ -d "${SRC_DATA}/users" ]; then
  for d in "${SRC_DATA}"/users/*/; do
    [ -d "${d}" ] || continue
    h="$(basename "${d}")"
    snapshot_one "${d}/ai-memory.db" "data/users/${h}/ai-memory.db"
  done
else
  printf '  ! %s/users 不存在（无用户库；生产上这本身可疑）\n' "${SRC_DATA}"
fi
PORTAL_SRC="${SRC_PORTAL}"
[ -f "${PORTAL_SRC}" ] && snapshot_one "${PORTAL_SRC}" 'portal/portal.db' \
  || printf '  ! 门户库未取到（%s）—— 快照将不含门户库，请核对 portal_data 卷\n' "${PORTAL_SRC}"

# manifest：sha256 清单（标准 `sha256sum -c` 格式 ⇒ 回读比对直接可用）+ 人类可读元数据
( cd "${DEST}" && find . -type f -name '*.db' | LC_ALL=C sort | while IFS= read -r f; do
    printf '%s  %s\n' "$(sum_file "${f}")" "${f}"
  done ) >"${DEST}/SHA256SUMS"
{
  printf 'snapshot_utc=%s\n' "${STAMP}"
  printf 'source_data=%s\n' "${SRC_DATA}"
  printf 'source_portal=%s\n' "${SRC_PORTAL}"
  printf 'dbs=%s\n' "${COUNT}"
  printf 'snapshotter=.backup (SQLite online backup API; WAL-safe)\n'
} >"${DEST}/manifest.txt"
log "② sha256 清单：$(wc -l <"${DEST}/SHA256SUMS" | tr -d ' ') 项 + manifest.txt"

if [ "${FAIL}" -gt 0 ]; then die "快照有 ${FAIL} 项失败（本地已留 ${DEST} 供诊断）"; fi
[ "${COUNT}" -gt 0 ] || die '没有任何库被快照（数据源不对？）'

# ── ③ 上传 + ④ 回读比对（AC 的两条硬项）─────────────────────────────────────────────────────
if [ "${NO_UPLOAD}" = '1' ]; then
  printf '未判：外迁段跳过（--no-upload）—— ③上传/④回读比对未判（`#8` 就绪后用 make backup 真跑）\n'
  log "本地快照完成：${DEST}（${COUNT} 库）"
  exit 30
fi
command -v ossutil >/dev/null 2>&1 || { printf '未判：本机无 ossutil ⇒ 外迁段未判（本地快照已完成：%s）\n' "${DEST}"; exit 30; }
[ -n "${OSS_BUCKET:-}" ] || { printf '未判：OSS_BUCKET 未设 ⇒ 外迁未判（本地快照已完成：%s）\n' "${DEST}"; exit 30; }

REMOTE="oss://${OSS_BUCKET}/${OSS_PREFIX:-ai-memory-backup}/${STAMP}"
log "③ 上传 → ${REMOTE}"
ossutil cp -r "${DEST}/" "${REMOTE}/" -f >/dev/null || die "上传失败：${REMOTE}"

log '④ 回读比对（下载回来逐项 sha256 校验；失败即非零 —— AC 的硬要求）'
VBACK="$(mktemp -d)"
if [ "${VERIFY}" = 'meta' ]; then
  ossutil cp "${REMOTE}/SHA256SUMS" "${VBACK}/SHA256SUMS" -f >/dev/null || die '回读 SHA256SUMS 失败'
  printf '  （--verify meta：仅比对清单可达性；**不作 sha256 内容校验** ⇒ 仍记未判）\n'
  printf '未判：回读比对仅做到清单级（--verify meta）\n'
  rm -rf "${VBACK}"; exit 30
fi
ossutil cp -r "${REMOTE}/" "${VBACK}/" -f >/dev/null || die '回读下载失败'
if sum_check "${VBACK}"; then
  log "  ✓ 回读比对通过（$(wc -l <"${VBACK}/SHA256SUMS" | tr -d ' ') 项全部一致）"
else
  rm -rf "${VBACK}"
  die '回读比对**不一致** ⇒ 备份不可信（已保留远端对象，请人工核查）' 10
fi
rm -rf "${VBACK}"
log "完成：${COUNT} 库 → ${REMOTE}（回读比对通过）"
exit 0
