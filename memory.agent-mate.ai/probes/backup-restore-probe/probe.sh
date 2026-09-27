#!/usr/bin/env bash
# backup-restore-probe —— Sprint 5 `#15`（backup:备份脚本）的**只读判据探针**
#
# ⚠️ **顺序说明（如实登记）**：本探针是**补记**的 —— `#15` 的本体（`backup/` 两脚本）**先**落地，
#   探针**后**补。仓内惯例是「判据先行」（`#1`–`#9`/`#17` 都是先落只读探针再施工），本行偏离了该
#   惯例 ⇒ 补一份探针守住同一条底线：**判据本身可判**（离线正/反对照，不拿制品现状当样本），
#   并把它转成**落地后契约断言**（脚本被删/入口被改指 ⇒ 立刻红）。
#
# 三相：
#   相 0 前置（输入面在位）· 相 1 **判据可行性**（合成样本正/反对照）+ 契约断言 · 相 2 未判登记（外迁段）
#
# 用法：bash memory.agent-mate.ai/probes/backup-restore-probe/probe.sh
# 退出码（与仓内探针同口径）：0 全判且无失败 · 10 有失败 · 30 有未判 · 20 运行错
# **只读**：不改产品代码；临时产物只落 ${TMP}。

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/../.." && pwd)"
REPO="$(cd "${PRODUCT}/.." && pwd)"
BACKUP="${PRODUCT}/backup"
MAKEFILE="${REPO}/Makefile"
BK_SH="${BACKUP}/backup-and-push.sh"
RS_SH="${BACKUP}/restore-drill.sh"
BK_README="${BACKUP}/README.md"

PASS=0; FAIL=0; UNJUDGED=0
check() { # $1=id $2=名称 $3=ok(0/1) $4=明细
  local detail="${4:-}"
  if [ "$3" = '0' ]; then PASS=$((PASS + 1)); printf 'PASS [%s] %s%s\n' "$1" "$2" "${detail:+ — ${detail}}"
  else FAIL=$((FAIL + 1)); printf 'FAIL [%s] %s%s\n' "$1" "$2" "${detail:+ — ${detail}}"; fi
}
unjudged() { UNJUDGED=$((UNJUDGED + 1)); printf '未判 [%s] %s — %s\n' "$1" "$2" "$3"; }
info() { printf '[i] %s\n' "$1"; }
nocomment() { grep -v '^[[:space:]]*#' "$1"; }

TMP="$(mktemp -d)" || { echo '无法建临时目录'; exit 20; }
cleanup() { rm -rf "${TMP}"; }
trap cleanup EXIT

command -v sqlite3 >/dev/null 2>&1 || { echo '未判：本机无 sqlite3（判据自检需要它造 WAL 样本）'; exit 30; }

# ── 判据函数（与被验证的脚本**同语义**，但独立实现 ⇒ 避免「拿自己的实现证明自己」）────────────
wal_ok() { # $1=快照库 $2=源库 → 快照行数是否等于源行数（0/1）
  [ -f "$1" ] && [ -f "$2" ] || return 1
  [ "$(sqlite3 "$1" 'SELECT count(*) FROM memories;' 2>/dev/null)" = "$(sqlite3 "$2" 'SELECT count(*) FROM memories;' 2>/dev/null)" ]
}
sums_ok() { # $1=目录（含 SHA256SUMS）→ 0 通过
  [ -s "$1/SHA256SUMS" ] || return 1
  if command -v sha256sum >/dev/null 2>&1; then ( cd "$1" && sha256sum -c SHA256SUMS >/dev/null 2>&1 )
  else ( cd "$1" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 ); fi
}
user_dbs() { # $1=data 根 → 枚举用户库（**只算目录**：非目录条目不算用户）
  [ -d "$1/users" ] || return 0
  for d in "$1"/users/*/; do
    [ -d "${d}" ] || continue
    [ -f "${d}ai-memory.db" ] && printf '%s\n' "${d}ai-memory.db"
  done
}
target_cmd() { # $1=目标名 → 打印该目标的命令体
  awk -v t="^$1:" '$0 ~ t { f = 1; next } f && /^\t/ { print; exit }' "${MAKEFILE}" 2>/dev/null
}
entry_file() { # $1=目标名 → 打印它指向的仓内脚本路径
  target_cmd "$1" | grep -oE 'memory\.agent-mate\.ai/[A-Za-z0-9._/-]+\.sh' | head -1
}

echo '=== backup-restore-probe（Sprint 5 `#15`，开工准备·补记）==='
echo

# ── 相 0：输入面 ─────────────────────────────────────────────────────────────────────────────
MISSING=''
for f in "${BK_SH}" "${RS_SH}" "${BK_README}" "${MAKEFILE}"; do [ -s "${f}" ] || MISSING="${MISSING} $(basename "${f}")"; done
check C0 '判据输入面全部在位且非空（两脚本 · README · 仓库 Makefile）' \
  "$([ -z "${MISSING}" ] && echo 0 || echo 1)" "缺：${MISSING:-（无）}"

# ── 相 1a：**判据可行性**（合成样本正/反对照；不拿 `backup/` 现状当样本）──────────────────────
# S1 —— 最核心的一条：**「WAL 安全」这个判据本身能不能区分「裸 cp」与「.backup」**。
# ⚠️ 夹具的**关键**：必须让库处于**「被占用」**状态（保持一个连接打开 + `PRAGMA wal_autocheckpoint=0`）。
#   否则 SQLite 在**最后一个连接关闭时**会做 checkpoint ⇒ `-wal` 被合并/清空 ⇒ **裸 cp 也能拿到完整数据**
#   ⇒ 判据**假通过**（本探针首版正是如此：`.backup` 判对、`cp` **也**判对 ⇒ S1 红 ⇒ 自检把它抓了出来）。
#   生产上库**始终被容器里的进程占用** ⇒ 「WAL 里有已提交未 checkpoint 的数据」是常态 ⇒ 裸 cp 真会丢数据；
#   而这一点**只有「保持连接」才能在离线夹具里复现**。用 mkfifo 给 sqlite3 挂一个常开的 stdin。
mkdir -p "${TMP}/s1"
mkfifo "${TMP}/s1/fifo"
sqlite3 "${TMP}/s1/src.db" <"${TMP}/s1/fifo" >/dev/null 2>&1 &
SQL_PID=$!
exec 3>"${TMP}/s1/fifo"
printf 'PRAGMA journal_mode=WAL;\nPRAGMA wal_autocheckpoint=0;\nCREATE TABLE memories(id INTEGER PRIMARY KEY);\nINSERT INTO memories VALUES (1),(2);\nINSERT INTO memories VALUES (3);\n' >&3
sleep 1                                                   # 等它落进 -wal（且连接保持打开）
WAL_BYTES="$(wc -c <"${TMP}/s1/src.db-wal" 2>/dev/null | tr -d ' ' || true)"
cp "${TMP}/s1/src.db" "${TMP}/s1/naive.db"                # 裸 cp：只拷主库 ⇒ 丢掉 -wal 里的那行
sqlite3 "${TMP}/s1/src.db" ".backup '${TMP}/s1/good.db'" >/dev/null 2>&1   # 在线备份：WAL 安全
exec 3>&-; wait "${SQL_PID}" 2>/dev/null
if wal_ok "${TMP}/s1/good.db" "${TMP}/s1/src.db"; then S1_OK=1; else S1_OK=0; fi
if wal_ok "${TMP}/s1/naive.db" "${TMP}/s1/src.db"; then S1_NAIVE=1; else S1_NAIVE=0; fi
check S1 '判据可判：**WAL 安全**判据能区分「`.backup`（对）」与「裸 `cp`（错）」—— 夹具须让库**被占用**' \
  "$([ "${S1_OK}" -eq 1 ] && [ "${S1_NAIVE}" -eq 0 ] && echo 0 || echo 1)" \
  "-wal=${WAL_BYTES:-0} 字节 · .backup 判对=${S1_OK} · 裸 cp 判错=${S1_NAIVE}（两者都必须成立，否则判据无区分力）"

# S2 —— 「失败非零」判据：篡改一个字节必须被判为不一致
mkdir -p "${TMP}/s2" && printf 'x\n' >"${TMP}/s2/a.db"
( cd "${TMP}/s2" && if command -v sha256sum >/dev/null 2>&1; then sha256sum a.db >SHA256SUMS; else shasum -a 256 a.db >SHA256SUMS; fi )
BEFORE=0; sums_ok "${TMP}/s2" && BEFORE=1
printf 'y' >>"${TMP}/s2/a.db"
AFTER=0; sums_ok "${TMP}/s2" && AFTER=1
check S2 '判据可判：**回读比对/失败非零**判据（未篡改 ⇒ 通过；篡改 1 字节 ⇒ 不通过）' \
  "$([ "${BEFORE}" -eq 1 ] && [ "${AFTER}" -eq 0 ] && echo 0 || echo 1)" \
  "未篡改=${BEFORE} · 篡改后=${AFTER}"

# S3 —— 「遍历范围 = /data/users/*」判据：非目录条目不得算作用户
mkdir -p "${TMP}/s3/users/alice" "${TMP}/s3/users/bob"
: >"${TMP}/s3/users/alice/ai-memory.db"; : >"${TMP}/s3/users/bob/ai-memory.db"
: >"${TMP}/s3/users/README.md"                     # 干扰项：文件，不是用户目录
printf 'alice\nbob\n' >"${TMP}/s3/expect"
check S3 '判据可判：遍历判据**只算用户目录**（`users/README.md` 这类文件不得被当用户）' \
  "$(diff -q <(user_dbs "${TMP}/s3" | sed 's#.*/users/##; s#/ai-memory.db##' | sort) "${TMP}/s3/expect" >/dev/null 2>&1 && echo 0 || echo 1)" \
  '命中 alice / bob 两个用户库（README.md 被排除）'

# ── 相 1b：**落地后契约断言**（本体已在 `#15` 批落地 ⇒ 被改坏即红）────────────────────────────
check Q1 '契约：两脚本在位且语法通过（`bash -n`）' \
  "$(bash -n "${BK_SH}" 2>/dev/null && bash -n "${RS_SH}" 2>/dev/null && echo 0 || echo 1)" \
  "$(basename "${BK_SH}") · $(basename "${RS_SH}")"

# Q2 —— **这条就是「`#15` 先红」的闭环**：`make` 的入口必须**指向真实存在的文件**。
BK_ENTRY="$(entry_file backup)"; RS_ENTRY="$(entry_file restore-drill)"
BK_OK=0; RS_OK=0
[ -n "${BK_ENTRY}" ] && [ -f "${REPO}/${BK_ENTRY}" ] && BK_OK=1
[ -n "${RS_ENTRY}" ] && [ -f "${REPO}/${RS_ENTRY}" ] && RS_OK=1
check Q2 '契约：`make backup` / `make restore-drill` 的入口**指向真实存在的脚本**（此前是指向空目录的「先红」项）' \
  "$([ "${BK_OK}" -eq 1 ] && [ "${RS_OK}" -eq 1 ] && echo 0 || echo 1)" \
  "backup→${BK_ENTRY:-未识别} · restore-drill→${RS_ENTRY:-未识别}"

check Q3 '契约：README 覆盖四件事（用法 · 设计理由 · **未判项** · 踩坑）' \
  "$(grep -q 'make backup' "${BK_README}" && grep -qi 'WAL' "${BK_README}" \
      && grep -q '未判' "${BK_README}" && grep -q '坑' "${BK_README}" && echo 0 || echo 1)" \
  'README 是「怎么用 + 为什么这么设计 + 还差什么」的唯一入口'

# ── 相 2：未判项（**如实登记，不伪装通过**）────────────────────────────────────────────────────
unjudged U1 '判据的**外迁段**（③ ossutil 上传 / ④ 回读比对）' \
  '需 `#8`（OSS 桶 + AK）+ 本机 `ossutil` ⇒ 本探针只判**本机可判**的部分（快照 / 校验 / 失败非零 / 遍历面）'
unjudged U2 '`restore-drill.sh` 的 `doctor` 通路' \
  '需生产容器（`--doctor-cmd docker exec ai-memory-mcp ai-memory doctor`）⇒ 归 `#16`/`#10`'

echo
echo "通过 ${PASS} 项 · 失败 ${FAIL} 项 · 未判 ${UNJUDGED} 项"
if [ "${FAIL}" -gt 0 ]; then exit 10; fi
if [ "${UNJUDGED}" -gt 0 ]; then exit 30; fi
exit 0
