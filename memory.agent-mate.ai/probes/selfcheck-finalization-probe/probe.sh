#!/usr/bin/env bash
# #17 开工准备探针 —— 门户启动自检「三项 deferred 转正」（只读；判据先行）
#
# 服务对象：Sprint 5 #17 build:门户启动自检实现（原 Sprint 4 `4.3` 的实现轮）
#   判据真源：specs/web-portal/web-stories.md **S11**（`AC11.1`–`AC11.5`）
#             specs/web-portal/web-design.md **§3.4**「启动自检判据定档」（四项形状 + 三条编排不变量
#               + ③ 锁侧输入归 `#2`（已落地）+ ④ **直连 MaaS**（已拍板）+ ⑤ 编排侧已落地）
#             specs/mcp/mcp-design.md §9 **F3**（`qwen3.7-text-embedding` 实测 = **1024** 维；
#               F2：不显式给 dim 会**静默回落 768**）
#             specs/deployment.md §12.5.4（门户 env 真源表 —— **新增键必须登记**，否则 `A2` 转红）· §12.5.5 #2
#             制品：admin_portal/src/selfcheck.ts · **tests/unit/selfcheck.test.ts** ·
#                   admin_portal/src/bridge/launch-template.ts · tests/unit/launch-template.test.ts ·
#                   deploy/portal.compose.yml · **scripts/probes/qwen-verify.sh**（现成的请求形状真源）
#
# 本行只做**三项 `deferred` 转正**（锁挂载/读取位与门户自身版本断言已随 `#2` 落地）：
#   `embeddings_reachable_1024` · `binary_version_matches_lock` · `launch_template_assertions`
#
# 两相：
#   相 1（离线，零依赖）：**判据自检**（四项形状各按「能红能绿」证明）+ **现状/缺口机械核实**
#   相 2（需 node，本机即可）：**端到端 stub 判据** —— 起一个本地 HTTP stub 扮演 MaaS，按
#         401 / 768 维 / 1024 维 三种形态调用**与产品同形的判据函数** ⇒ 证明判据真能红能绿
#
# 退出码：0 = 本行应判项全绿 · 10 = 有 FAIL · 30 = 有未判项 · 20 = 运行错误
#
# 只读边界：不改产品代码 / specs / deploy 制品；改写只落 `${TMP}`（trap 清理）；相 2 只起本地 stub。
#
# 用法：
#   bash memory.agent-mate.ai/probes/selfcheck-finalization-probe/probe.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRODUCT="$(cd "${HERE}/../.." && pwd)" # memory.agent-mate.ai/
ADMIN="${PRODUCT}/admin_portal"
SPECS="${PRODUCT}/specs"
SELFCHECK="${ADMIN}/src/selfcheck.ts"
SELFCHECK_TEST="${ADMIN}/tests/unit/selfcheck.test.ts"
LAUNCH_TPL="${ADMIN}/src/bridge/launch-template.ts"
LAUNCH_TPL_TEST="${ADMIN}/tests/unit/launch-template.test.ts"
COMPOSE="${PRODUCT}/deploy/portal.compose.yml"
STORIES="${SPECS}/web-portal/web-stories.md"
WEB_DESIGN="${SPECS}/web-portal/web-design.md"
MCP_DESIGN="${SPECS}/mcp/mcp-design.md"
DEPLOYMENT="${SPECS}/deployment.md"
QWEN_VERIFY="${PRODUCT}/scripts/probes/qwen-verify.sh"

PASS=0
FAIL=0
UNJUDGED=0

check() { # $1=id $2=name $3=ok(0/1) $4=detail
  local detail="${4:-}"
  if [ "$3" = "0" ]; then
    PASS=$((PASS + 1))
    printf 'PASS [%s] %s%s\n' "$1" "$2" "${detail:+ — ${detail}}"
  else
    FAIL=$((FAIL + 1))
    printf 'FAIL [%s] %s%s\n' "$1" "$2" "${detail:+ — ${detail}}"
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
STUB_PID=''
cleanup() { [ -n "${STUB_PID}" ] && kill "${STUB_PID}" >/dev/null 2>&1 || true; rm -rf "${TMP}"; }
trap cleanup EXIT

nocomment() { grep -v '^[[:space:]]*#' "$1"; }

echo '=== #17 开工准备探针：门户启动自检「三项 deferred 转正」==='
echo

# ───────────────────────────── 相 0：前置（在位性）─────────────────────────────
missing=''
for f in "${SELFCHECK}" "${SELFCHECK_TEST}" "${LAUNCH_TPL}" "${LAUNCH_TPL_TEST}" "${COMPOSE}" "${STORIES}" "${WEB_DESIGN}" "${MCP_DESIGN}" "${DEPLOYMENT}" "${QWEN_VERIFY}"; do
  [ -s "${f}" ] || missing="${missing} $(basename "${f}")"
done
check C0 '判据输入文件全部在位且非空（**全部入仓** —— 干净检出下同样成立）' \
  "$([ -z "${missing}" ] && echo 0 || echo 1)" "${missing:-10/10 在位}"
[ -z "${missing}" ] || finish

SRC_HITS=0
for ac in AC11.1 AC11.2 AC11.3 AC11.4 AC11.5; do grep -q "${ac}" "${STORIES}" && SRC_HITS=$((SRC_HITS + 1)); done
DEF_HITS=0
for n in embeddings_reachable_1024 binary_version_matches_lock launch_template_assertions; do
  grep -q "${n}" "${SELFCHECK}" && DEF_HITS=$((DEF_HITS + 1))
done
check C1 '判据真源可定位（S11 五条 AC + 三项 `deferred` 名在代码里各 1 处）' \
  "$([ "${SRC_HITS}" -eq 5 ] && [ "${DEF_HITS}" -eq 3 ] && echo 0 || echo 1)" \
  "AC 命中 ${SRC_HITS}/5 · deferred 名命中 ${DEF_HITS}/3"

# ───────────────────────── 相 1：判据自检 + 现状/缺口核实 ─────────────────────────
echo
echo '--- 相 1：四项判据形状（能红能绿）+ 现状与缺口机械核实 ---'

# ── 判据定义（与 §3.4 ① 定档同形）──────────────────────────────────────────────────────────
# ② embeddings：**一次最小调用后「非 401 且向量长度 == 1024」**（不得以「env 非空」或「调用成功」代替）。
emb_dim_from_body() { # $1=响应体 → 打印向量长度（解析失败打印 0）
  printf '%s' "$1" | node -e 'let s="";process.stdin.on("data",(d)=>{s+=d}).on("end",()=>{try{const j=JSON.parse(s);const v=j&&j.data&&j.data[0]&&j.data[0].embedding;process.stdout.write(String(Array.isArray(v)?v.length:0))}catch(e){process.stdout.write("0")}})' 2>/dev/null || echo 0
}
emb_verdict() { # $1=HTTP 状态码 $2=响应体 → 0=pass 1=fail
  [ "$1" = '200' ] || return 1
  [ "$(emb_dim_from_body "$2")" = '1024' ]
}
# ③ 版本：容器内 `ai-memory --version` 取**末位 semver**，与锁 tag **去 v** 比对。
#    **两侧必须用同一个提取函数** —— 否则 `v0.10.0` 与 `0.10.0` 会因写法差异假红（本批实证点）。
last_semver() { printf '%s\n' "$1" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | tail -1; }
version_ok() { [ "$(last_semver "$1")" = "$(last_semver "$2")" ]; }
# ④ 关键校验：启动模板断言 = 常量表与真源**逐字**一致（比对体沿用既有 `tests/unit/launch-template.test.ts`）。
template_identical() { [ "$(printf '%s' "$1" | tr -d ' \t\n')" = "$(printf '%s' "$2" | tr -d ' \t\n')" ]; }
# ①②③④ 的**编排不变量**：任一项 fail ⇒ 阻断（`hasBlockingFailure` 只看 fail）；**deferred 不得当 pass**。
verdict_kind() { # $1=status → 打印 blocking / nonblocking / pass
  case "$1" in
    fail) printf 'blocking' ;;
    deferred) printf 'nonblocking' ;;
    *) printf 'pass' ;;
  esac
}

# ── S：判据自检（样本全部**合成**）──────────────────────────────────────────────────────────
printf '%s' '{"error":{"message":"unauthorized"}}' >"${TMP}/body-401.json"
node -e 'process.stdout.write(JSON.stringify({data:[{embedding:new Array(768).fill(0.1)}]}))' >"${TMP}/body-768.json"
node -e 'process.stdout.write(JSON.stringify({data:[{embedding:new Array(1024).fill(0.1)}]}))' >"${TMP}/body-1024.json"
B768="$(cat "${TMP}/body-768.json")"; B1024="$(cat "${TMP}/body-1024.json")"; B401="$(cat "${TMP}/body-401.json")"
# detail 里**不能**写 `$(f "x")` 这种「命令替换里再套双引号」的形式 —— 会 bad substitution（首版即如此）。
D768="$(emb_dim_from_body "${B768}")"; D1024="$(emb_dim_from_body "${B1024}")"
check S1 'AC11.2 判据可判（**三态**：401 ⇒ fail · 200 但 **768 维** ⇒ fail · 200 且 **1024 维** ⇒ pass）' \
  "$(! emb_verdict 401 "${B401}" && ! emb_verdict 200 "${B768}" && emb_verdict 200 "${B1024}" && echo 0 || echo 1)" \
  "768 维命中 ${D768} · 1024 维命中 ${D1024} ⇒ 「返回成功但维度错」不会被判成 pass"
check S2 'AC11.3 判据可判（末位 semver 提取：v0.10.0 ⇄ 锁 0.10.0 **同口径** ⇒ 一致 · 漂移 ⇒ 不一致）' \
  "$(version_ok 'ai-memory v0.10.0' '0.10.0' && ! version_ok 'ai-memory 0.9.0' '0.10.0' && ! version_ok 'ai-memory v0.9.0' 'v0.10.0' && echo 0 || echo 1)" \
  '两侧同用 last_semver ⇒ v 前缀不造成假红；版本漂移一定被抓到'
check S3 'AC11.4（模板断言）判据可判（逐字一致 ⇒ 一致 · 改一个字符 ⇒ 不一致）' \
  "$(template_identical 'A B C' 'A  B  C' && ! template_identical 'A B C' 'A B D' && echo 0 || echo 1)" \
  '空白差异不算漂移（比对体如此）；内容差异一定被抓到'
check S4 'AC11.5 编排不变量判据可判（fail ⇒ **阻断** · deferred ⇒ 不阻断但**不得当 pass** · pass ⇒ 通过）' \
  "$([ "$(verdict_kind fail)" = 'blocking' ] && [ "$(verdict_kind deferred)" = 'nonblocking' ] && [ "$(verdict_kind pass)" = 'pass' ] && echo 0 || echo 1)" \
  '三态分得清 ⇒ 「deferred 被当成 pass」这种缺口能被判据识别'

# ── Q：现状与缺口（机械核实）──────────────────────────────────────────────────────────────
echo
echo '--- 相 1（续）：现状与缺口（机械核实）---'

DEFER_AT="$(grep -c "status: 'deferred'" "${SELFCHECK}" || true)"
check Q1 '缺口的**确切形态**：三项在自检里显式登记为 `deferred`（**不是** `fail` ⇒ 不阻断启动 ⇒ 门户照常对外服务）' \
  "$([ "${DEFER_AT}" -ge 3 ] && echo 0 || echo 1)" \
  "selfcheck.ts 里 status: deferred 出现 ${DEFER_AT} 处（含 §3.4 ② 记录的开发姿态缺锁项）"

# 测试面**互斥点**：施工不同批改这里，测试必红（这是本行最容易被漏的耦合）
TEST_DEFER="$(grep -c "toBe('deferred')" "${SELFCHECK_TEST}" || true)"
TEST_DETAIL="$(grep -c "toContain('4.3')" "${SELFCHECK_TEST}" || true)"
TEST_SUMMARY="$(grep -c 'embeddings_reachable_1024=deferred' "${SELFCHECK_TEST}" || true)"
check Q2 '测试面**互斥断言**已定位（`tests/unit/selfcheck.test.ts`：三项 `toBe(deferred)` + `detail` 含 4.3 + **摘要里 `=deferred` 字符串**）⇒ 施工必须同批改' \
  "$([ "${TEST_DEFER}" -ge 1 ] && [ "${TEST_DETAIL}" -ge 1 ] && [ "${TEST_SUMMARY}" -ge 1 ] && echo 0 || echo 1)" \
  "命中 toBe(deferred) ${TEST_DEFER} 处 · toContain('4.3') ${TEST_DETAIL} 处 · 摘要断言 ${TEST_SUMMARY} 处"

# 配置面缺口：门户侧**无** MaaS embeddings 客户端（只有注释提到 embeddings）
CLIENT_HITS="$(grep -rInE '(/embeddings|POST[^)]*embedding)' "${ADMIN}/src" 2>/dev/null | grep -c . || true)"
check Q3 '配置面缺口：门户侧**没有** MaaS embeddings 客户端（`admin_portal/src/**` 零 `/embeddings` 调用）⇒ 施工须新增键 + 客户端' \
  "$([ "${CLIENT_HITS}" -eq 0 ] && echo 0 || echo 1)" "源码内 /embeddings 调用命中 ${CLIENT_HITS} 处"

# 可复用件：请求形状（现成真源）+ launch 模板与比对体
SHAPE_OK=0
grep -qE 'POST "\$BASE_URL/embeddings"' "${QWEN_VERIFY}" && SHAPE_OK=$((SHAPE_OK + 1))
# 注意 `grep -E` 的转义：单引号里 `\{` 是字面 `{`，而 `\\"` 会变成「字面反斜杠 + 引号」⇒ 匹配不上（首版即如此）。
grep -qE '\{"model":"%s","input":' "${QWEN_VERIFY}" && SHAPE_OK=$((SHAPE_OK + 1))
grep -q 'LAUNCH_BINARY' "${LAUNCH_TPL}" && SHAPE_OK=$((SHAPE_OK + 1))
grep -q 'mcp-design' "${LAUNCH_TPL_TEST}" && SHAPE_OK=$((SHAPE_OK + 1))
check Q4 '可复用件在位（请求形状真源 `POST {base}/embeddings` + body `{"model","input"}` · `launch-template.ts` 常量 · 既有逐字比对测试）' \
  "$([ "${SHAPE_OK}" -eq 4 ] && echo 0 || echo 1)" "命中 ${SHAPE_OK}/4"

# ───────────────── 相 2：端到端 stub 判据（真 HTTP 通路，本机可判）─────────────────
echo
echo '--- 相 2：端到端 stub（本地扮演 MaaS：401 / 768 / 1024 三态）---'

judge_embeddings() { # $1=base_url → 0=pass 1=fail（**与产品将实现的判据同形**）
  node -e '
(async () => {
  const [base] = process.argv.slice(1);
  try {
    const r = await fetch(base + "/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer stub-key" },
      body: JSON.stringify({ model: "stub-model", input: ["ai-memory embedding probe"] }),
      signal: AbortSignal.timeout(5000),
    });
    if (r.status === 401 || r.status === 403) process.exit(1);
    if (!r.ok) process.exit(1);
    const j = await r.json();
    const v = j && j.data && j.data[0] && j.data[0].embedding;
    process.exit(Array.isArray(v) && v.length === 1024 ? 0 : 1);
  } catch (e) { process.exit(1); }
})();
' "$1" >/dev/null 2>&1
}

start_stub() { # $1=形态(401|768|1024) $2=端口
  node -e '
const http = require("http");
const mode = process.argv[1], port = Number(process.argv[2]);
http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => { body += d; });
  req.on("end", () => {
    if (req.method !== "POST" || !req.url.endsWith("/embeddings")) {
      res.writeHead(404, { "content-type": "application/json" }).end("{}");
      return;
    }
    if (mode === "401") {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { message: "unauthorized" } }));
      return;
    }
    const dim = mode === "768" ? 768 : 1024;
    res.writeHead(200, { "content-type": "application/json" })
       .end(JSON.stringify({ data: [{ embedding: new Array(dim).fill(0.01) }], model: "stub-model" }));
  });
}).listen(port, "127.0.0.1");
' "$1" "$2" &
  STUB_PID=$!
}

run_case() { # $1=形态 $2=期望判据结果(0/1)
  local mode="$1" expect="$2" port attempt=0 rc=9
  while [ "${attempt}" -lt 3 ]; do
    port=$(( (RANDOM % 2000) + 23000 ))
    start_stub "${mode}" "${port}"
    sleep 1
    judge_embeddings "http://127.0.0.1:${port}"
    rc=$?
    kill "${STUB_PID}" >/dev/null 2>&1 || true
    STUB_PID=''
    [ "${rc}" != '9' ] && break
    attempt=$((attempt + 1))
  done
  printf '%s' "${rc}"
}

if ! command -v node >/dev/null 2>&1; then
  unjudged P1 'AC11.2 端到端：stub 回 401 ⇒ 判据 fail（凭据缺失形态）' '本机无 node'
  unjudged P2 'AC11.2 端到端：stub 回 768 维 ⇒ 判据 fail（维度不符形态）' '本机无 node'
  unjudged P3 'AC11.2 端到端：stub 回 1024 维 ⇒ 判据 pass（正向控制）' '本机无 node'
else
  RC1="$(run_case 401 1)"
  check P1 'AC11.2（端到端·真 HTTP）：stub 回 **401** ⇒ 判据 **fail**（凭据缺失形态）' \
    "$([ "${RC1}" = '1' ] && echo 0 || echo 1)" "判据返回 ${RC1}（1=fail，期望 1）"
  RC2="$(run_case 768 1)"
  check P2 'AC11.2（端到端·真 HTTP）：stub 回 **768 维** ⇒ 判据 **fail**（维度不符形态 ⇒ 不得静默降级）' \
    "$([ "${RC2}" = '1' ] && echo 0 || echo 1)" "判据返回 ${RC2}（1=fail，期望 1）"
  RC3="$(run_case 1024 0)"
  check P3 'AC11.2（端到端·真 HTTP）：stub 回 **1024 维** ⇒ 判据 **pass**（**正向控制**：证明通路与解析都有效）' \
    "$([ "${RC3}" = '0' ] && echo 0 || echo 1)" "判据返回 ${RC3}（0=pass，期望 0）—— 没有它，前两条的 fail 可能只是「调不通」"
fi

# ────────────────────────── 归属登记（**不是未判**）──────────────────────────
echo
info '真 MaaS 的 1024 维实测：执行点归 `#11`/`#14`（生产；需真实凭据）—— 本机可用 scripts/probes/qwen-verify.sh 手工验（有 secrets 文件时；key 与 base_url 均不入仓）。本探针不判它。'
info '施工后的**产品行为**判据（本行交付物之一）：在容器内跑真自检 + 三条负例（假 MaaS ⇒ 401 / 坏维度 ⇒ 768 / 假锁 tag ⇒ 版本漂移 / 坏模板 ⇒ 逐字不符）各断「非零退出 · 日志点名 · **从未监听**」—— 体例同 #1 冒烟的 N1–N3 与 #3 的 B2；接口已在此登记，施工批实现。'
info '新键登记面（施工硬要求）：MaaS `base_url` + 模型名属**非密钥** ⇒ 真源是 deploy/portal.compose.yml 的 environment:，并必须同步 deployment.md §12.5.4（否则 make deploy-doc-audit 的 A2 转红）；key 复用现有 PORTAL_* 的 MaaS key 键（注入子进程那一把）。'

finish
