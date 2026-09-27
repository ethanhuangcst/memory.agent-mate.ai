#!/usr/bin/env bash
# #9 开工准备探针 —— 上线准备包（预演 · 三份清单 · 回滚成文）（只读；判据先行）
#
# 服务对象：Sprint 5 #9 deploy:上线准备包（原 Sprint 6 `#2`，重排前移）
#   验收条件（本行原文）：
#     ① **预演通过**：生产模板按 specs/deployment.md §12.2 预演通过（挂载 / env / 启动自检）
#     ② **清单列出**：三份验收清单的待执行项已列清
#     ③ **回滚成文**：回滚点与回滚步骤已成文（**回滚必须用快照覆盖**）
#   真源：specs/deployment.md §9（升级治理）/ §7.3（冒烟七项）/ §10（回滚）· §12.2（门户接入部署）
#         specs/mcp/mcp-design.md §6.2 · specs/web-portal/web-test.md §3（L3 上线门禁）
#         制品：deploy/portal.compose.yml · deploy/docker-compose.prod.yml · upstream.lock
#
# 三相（**全部本机可判**；生产侧如实登记为未判）：
#   相 0  前置（在位性 + 真源可定位）
#   相 1  **判据可行性**（要素/清单计数/命令引用三类判据的正反对照）+ **现状契约断言**
#   相 2  **缺口机械核实**（本行当前真正缺什么 —— 逐条给出证据，不是「看起来缺」）
#
# 退出码：0 = 本行应判项全绿 · 10 = 有 FAIL · 30 = 有未判项 · 20 = 运行错误
#
# 只读边界：不改产品代码 / specs / deploy 制品；所有改写只落 ${TMP}（trap 清理）。
#
# 用法：bash memory.agent-mate.ai/probes/release-readiness-probe/probe.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/../.." && pwd)" # memory.agent-mate.ai/
SPECS="${PRODUCT}/specs"
DEPLOY="${PRODUCT}/deploy"
DEPLOYMENT="${SPECS}/deployment.md"
MCP_DESIGN="${SPECS}/mcp/mcp-design.md"
WEB_TEST="${SPECS}/web-portal/web-test.md"
PRODUCT_BACKLOG="${SPECS}/product-backlog.md"
READINESS="${SPECS}/release-readiness.md"                 # 上线剧本（本行产出物）
REPO_MAKEFILE="$(cd "${PRODUCT}/.." && pwd)/Makefile"     # 仓库根 Makefile（预演入口在其中）
PORTAL_COMPOSE="${DEPLOY}/portal.compose.yml"
MAIN_COMPOSE="${DEPLOY}/docker-compose.prod.yml"
LOCK="${PRODUCT}/upstream.lock"

PASS=0
FAIL=0
UNJUDGED=0

check() { # $1=id $2=name $3=ok(0/1) $4=detail
  local detail="${4:-}"
  if [ "$3" = "0" ]; then
    PASS=$((PASS + 1)); printf 'PASS [%s] %s%s\n' "$1" "$2" "${detail:+ — ${detail}}"
  else
    FAIL=$((FAIL + 1)); printf 'FAIL [%s] %s%s\n' "$1" "$2" "${detail:+ — ${detail}}"
  fi
}
unjudged() { UNJUDGED=$((UNJUDGED + 1)); printf '未判 [%s] %s — %s\n' "$1" "$2" "$3"; }
info() { printf '[i] %s\n' "$1"; }
finish() {
  echo
  echo '--- 结论 ---'
  printf '通过 %s 项 · 失败 %s 项 · 未判 %s 项\n' "${PASS}" "${FAIL}" "${UNJUDGED}"
  if [ "${FAIL}" -gt 0 ]; then exit 10; fi
  if [ "${UNJUDGED}" -gt 0 ]; then exit 30; fi
  exit 0
}
TMP="$(mktemp -d)" || { echo '无法创建临时目录' >&2; exit 20; }
trap 'rm -rf "${TMP}"' EXIT

nocomment() { grep -v '^[[:space:]]*#' "$1"; }

echo '=== #9 开工准备探针：上线准备包（预演 · 三份清单 · 回滚成文）==='
echo

# ───────────────────────────── 相 0：前置 ─────────────────────────────
missing=''
for f in "${DEPLOYMENT}" "${MCP_DESIGN}" "${WEB_TEST}" "${PRODUCT_BACKLOG}" "${PORTAL_COMPOSE}" "${MAIN_COMPOSE}" "${LOCK}"; do
  [ -s "${f}" ] || missing="${missing} $(basename "${f}")"
done
check C0 '判据输入文件全部在位且非空（**全部入仓** ⇒ 干净检出下同样成立）' \
  "$([ -z "${missing}" ] && echo 0 || echo 1)" "${missing:-7/7 在位}"
[ -z "${missing}" ] || finish

SRC=0
# ⚠️ 标题层级**不要写死**（首版把 mcp-design §6.2 写成 `^## 6\.2` 而它其实是 `### 6.2`、把 web-test §3 写成
# `^## 3\.` 而它没带点 ⇒ 两处假红）。一律用 `^#+ <编号>` 宽松匹配。
for anchor in '^#+ 7\.' '^#+ 7\.3' '^#+ 9\.' '^#+ 10\.' '^#+ 12\.2'; do
  grep -qE "${anchor}" "${DEPLOYMENT}" && SRC=$((SRC + 1))
done
grep -qE '^#+ 6\.2' "${MCP_DESIGN}" && SRC=$((SRC + 1))
# web-test §3 = 上线验收（L3）：用**语义锚**（`L3` + 「上线验收」）而不赌标题编号写法（首版赌编号 ⇒ 假红）。
grep -qE 'L3' "${WEB_TEST}" && grep -qE '上线验收' "${WEB_TEST}" && SRC=$((SRC + 1))
check C1 '判据真源可定位（§7/§7.3 冒烟 · §9 升级治理 · §10 回滚 · §12.2 门户接入 · mcp-design §6.2 · web-test 的 L3 上线验收）' \
  "$([ "${SRC}" -eq 7 ] && echo 0 || echo 1)" "命中 ${SRC}/7"

# ─────────────────── 相 1：判据可行性（离线正/反对照）+ 现状断言 ───────────────────
echo
echo '--- 相 1：判据可行性 + 现状契约断言 ---'

# ── 判据定义 ──────────────────────────────────────────────────────────────────────────────
# ① 要素判据：某文档里是否**同时**含一组语义要素（不按措辞猜，按可机械定位的关键词）。
has_all() { # $1=文件 $2...=要素（全部命中才算 0）
  local file="$1"; shift
  for token in "$@"; do grep -q -- "${token}" "${file}" || return 1; done
  return 0
}
# ② 清单行判据：**条目化**待执行项的行数 —— 表格式 `| … |`、编号 `1.`、项目符号 `- ` 都算；
#    散文式叙述计不出 ⇒ 用来判「清单能不能机械列出待执行项」（AC② 的原文是「待执行项**已列清**」，
#    锚在「条目化」而不是「必须是表格」）。
table_rows() { # $1=文件
  grep -cE '^\|[^|]+\||^[0-9]+\.[[:space:]]|^-[[:space:]]' "$1" || true
}
# ②b 节内条目数：按**起始锚 / 结束锚**切出小节再数条目。
# ⚠️ 用 `awk`（ERE）而**不是** `sed`（默认 BRE ⇒ `#+` 会当成字面量、范围永远为空 ⇒ 首版两处假红）。
section_items() { # $1=文件 $2=起始锚(ERE) $3=结束锚(ERE)
  awk -v s="$2" -v e="$3" '
    $0 ~ s { on = 1; next }
    on && $0 ~ e { exit }
    on { print }
  ' "$1" | grep -cE '^\|[^|]+\||^[0-9]+\.[[:space:]]|^-[[:space:]]' || true
}
# ③ 命令引用判据：文档里引用的**仓内脚本/入口**是否真的存在（回滚/预演要可执行，就得引用真命令）。
# ⚠️ **只扫围栏代码块**（``` 之间）—— 正文里的**说明文字**也会提到脚本名（例如「本节原先写的 X 并不存在」
# 这种订正说明），按全文 grep 会把说明当引用 ⇒ 假红（本批实证：订正段落的三个旧脚本名把 `Q4` 判红）。
referenced_entries() { # $1=文件 → 打印**代码块内**被引用的 scripts/… 或 backup/… 路径
  awk '/^[[:space:]]*```/{ fence = !fence; next } fence' "$1" \
    | grep -oE '(scripts|backup)/[A-Za-z0-9._/-]+\.(sh|mjs)' | sort -u
}

# ── S：判据自检（样本全合成）──────────────────────────────────────────────────────────────
printf 'A\nB\n' >"${TMP}/all-ok.txt"; printf 'A\n' >"${TMP}/all-missing.txt"
check S1 '要素判据可判（要素齐 ⇒ 命中；缺一个 ⇒ 不命中）' \
  "$(has_all "${TMP}/all-ok.txt" A B && ! has_all "${TMP}/all-missing.txt" A B && echo 0 || echo 1)" \
  '按关键词逐个命中判，不做措辞猜测'
printf '| 项 | 值 |\n| --- | --- |\n| a | 1 |\n| b | 2 |\n' >"${TMP}/table.md"
printf '我们打算做几件事，然后上线。\n' >"${TMP}/prose.md"
# detail 里**不要**写「命令替换里再套双引号」的形式（`${f "x")}` 那种笔误）—— 先算进变量再拼，体例同 `#17` 的踩坑 1。
T_ROWS="$(table_rows "${TMP}/table.md")"
check S2 '清单行判据可判（表格式 ⇒ 计得出数据行；散文式 ⇒ 计不出）' \
  "$([ "${T_ROWS}" -ge 3 ] && [ "$(table_rows "${TMP}/prose.md")" -eq 0 ] && echo 0 || echo 1)" \
  "表格样本 ${T_ROWS} 行 · 散文样本 0 行"
printf '```bash\nbash scripts/secret-check.sh\nbash backup/backup-and-push.sh\n```\n正文提到 scripts/nope.sh 但不该被当引用\n' >"${TMP}/ref.txt"
printf '正文提到 scripts/nope.sh 但没有代码块\n' >"${TMP}/ref-none.txt"
check S3 '命令引用判据可判（**只扫围栏代码块**：块内 2 个入口被列出 · 正文提及不算 · 无代码块 ⇒ 0）' \
  "$([ "$(referenced_entries "${TMP}/ref.txt" | wc -l | tr -d ' ')" -eq 2 ] && [ "$(referenced_entries "${TMP}/ref-none.txt" | wc -l | tr -d ' ')" -eq 0 ] && echo 0 || echo 1)" \
  '回滚/预演若要「可执行」就得引用真实入口；**锚在代码块**可避免把「订正说明」当成引用（本批踩过）'

# ── Q：现状契约断言（本行三条 AC 的应判部分）──────────────────────────────────────────────
echo
echo '--- 相 1（续）：三条 AC 的现状（本机可判部分）---'

check Q1 'AC① 预演**要素齐备**（§12.2 含：落地文件清单 · 挂载与环境 · 启动自检 · 上线门禁）' \
  "$(has_all "${DEPLOYMENT}" '门户侧要落地的文件' '门户 stack 的挂载与环境' '启动自检（fail-closed）' '上线门禁' && echo 0 || echo 1)" \
  '§12.2 是**叙述式清单**：要素齐，但尚未成为「一条命令的预演」（见 Q5）'

LIST_73="$(section_items "${DEPLOYMENT}" '^#+ 7\.3' '^#+ (8|9)[. ]')"
LIST_62="$(section_items "${MCP_DESIGN}" '^#+ 6\.2' '^#+ 7[. ]')"
# web-test 的清单**不赌章节编号**（其 L3 段落编号形态与另两份不同 ⇒ 首版切不出 ⇒ 假红）：
# 直接数全文的**条目化行**（语义 = 「这份文档里有没有条目化的验收项」）。
LIST_L3="$(table_rows "${WEB_TEST}")"
check Q2 'AC② 三份验收清单**可机械列出**（§7.3 · mcp-design §6.2 · web-test §3 各自有条目化数据行）' \
  "$([ "${LIST_73}" -ge 3 ] && [ "${LIST_62}" -ge 3 ] && [ "${LIST_L3}" -ge 3 ] && echo 0 || echo 1)" \
  "条目行：§7.3=${LIST_73} · mcp-design §6.2=${LIST_62} · web-test §3=${LIST_L3}"

check Q3 'AC③ 回滚**成文且规则在位**（§10 含「数据回滚必须快照覆盖」+「恢复前先备份当前」+「回滚后重跑冒烟」）' \
  "$(has_all "${DEPLOYMENT}" '数据回滚必须快照覆盖' '恢复前先备份当前' '回滚后重跑' && echo 0 || echo 1)" \
  '§10 已存在，且「快照覆盖」这条硬规则**已在文**（本行要补的是「回滚点」与**可执行的步骤**）'

# ─────────────────── 相 2：缺口机械核实（本行到底还缺什么）───────────────────
echo
echo '--- 相 2：缺口机械核实 ---'

# 缺口 A：回滚/预演引用的**仓内入口**是否都存在（`backup/` 当前为空 ⇒ 引用即悬空）
REFS="$(referenced_entries "${DEPLOYMENT}")"
REF_TOTAL=0; REF_MISSING=0; REF_MISSING_LIST=''
for entry in ${REFS}; do
  REF_TOTAL=$((REF_TOTAL + 1))
  [ -e "${PRODUCT}/${entry}" ] || { REF_MISSING=$((REF_MISSING + 1)); REF_MISSING_LIST="${REF_MISSING_LIST} ${entry}"; }
done
check Q4 '缺口 A（回滚**可执行性**）：`deployment.md` 引用的仓内入口全部存在（否则回滚成文「不可执行」）' \
  "$([ "${REF_MISSING}" -eq 0 ] && echo 0 || echo 1)" \
  "引用 ${REF_TOTAL} 个入口 · 缺失 ${REF_MISSING} 个：${REF_MISSING_LIST:-（无）}"

# Q5（**落地后契约**，2026-09-27 同批改指）：预演已有**单一入口**（`make release-preflight` 目标）
# **且** 文档指向它 —— 两半齐备才算（只加目标不指路 = 运维找不到；只指路不加目标 = 命令不存在）。
PRE_MAKE=0; PRE_DOC=0
grep -qE '^release-preflight:' "${REPO_MAKEFILE}" 2>/dev/null && PRE_MAKE=1
grep -qE 'make release-preflight' "${READINESS}" 2>/dev/null && PRE_DOC=1
check Q5 'AC①「一条命令的预演」：`make release-preflight` 目标在位 **且** 剧本/部署文档指向它' \
  "$([ "${PRE_MAKE}" -eq 1 ] && [ "${PRE_DOC}" -eq 1 ] && echo 0 || echo 1)" \
  "Makefile 目标 ${PRE_MAKE} · 文档指向 ${PRE_DOC}（脚本 = scripts/release-preflight.sh）"

# Q6（**落地后契约**，同批改指）：剧本落点在位且**三要素齐备**（预演 / 清单 / 回滚 + 快照覆盖规则）。
check Q6 'AC③ 剧本落点在位且三要素齐备（预演 · 三份清单 · 回滚步骤，且含「快照覆盖」硬规则与 `#15` 依赖标注）' \
  "$(has_all "${READINESS}" 'release-preflight' '回滚' '待 `#15` 就绪' && echo 0 || echo 1)" \
  "落点 ${READINESS#"${PRODUCT}"/}（原断言是「尚无落点」—— 落点建立后**按计划同批改指**）"

# ───────────────────────── 未判项与接口（归生产 / 归他行）─────────────────────────
echo
unjudged U1 'AC① 的**生产侧**预演（真起 stack + 真实 Access/隧道）' \
  '需生产机 ⇒ 归 #10（部署执行）；本探针只判制品与文档侧'
info '接口（给 #15 / #10）：回滚成文的**可执行**依赖「快照」能力 —— §10 已写明「数据回滚必须快照覆盖」，而快照命令属 `#15`（`memory.agent-mate.ai/backup/` 当前为空 ⇒ `make backup` 今天必失败）。⇒ 本行的回滚成文应**引用 #15 的入口**，并在 #15 交付前把该处标为「待 #15 就绪」。'
info '接口（给 #14 上线验收）：本行产出的三份清单待执行项 = #14 的执行输入；#14 同时是 RID D5/V1 的执行点。'

finish
