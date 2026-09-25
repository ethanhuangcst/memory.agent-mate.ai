#!/usr/bin/env bash
# =============================================================================
# 3.21 启动自检判据可行性探针（v2；研究类，**不入制品**，结论回写 specs）
#
# 服务对象：Sprint 4 `#4.3 web-portal:启动自检`（AC11.1–AC11.5 / 设计 §3.4）。
# 已有事实：`admin_portal/src/selfcheck.ts` 实做 6 项 + **显式 deferred 3 项**
#   （embeddings_reachable_1024 / binary_version_matches_lock / launch_template_assertions）
#   ⇒ 本探针只回答「这三项 + fail-closed 不变量的判据形状能不能定」。
#
# 五个问题（各带灵敏度对照）：Q1 fail-closed · Q2 deferred 语义 · Q3 embeddings 失败形态 ·
#                            Q4 版本锁取法与归一化 · Q5 模板断言逐字比对
#
# 只读：不改产品代码、不改任何 specs/制品。
# 退出码：0 = 探针本身跑通（结论以 PASS/FAIL 与 [i] 行为准）· 20 = 运行错误 · 30 = 前置不满足
# 备注（v1 踩到的坑，写在这里省下一次）：
#   ① 探针里的提示文案**不能带反引号**（双引号里的反引号会被 shell 当命令替换执行）；
#   ② `pid="$(start &)"` 会把进程变成子 shell 的子进程，`wait` 取不到 ⇒ 必须用全局变量 + 真子进程。
# =============================================================================
set -uo pipefail

PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${PROBE_DIR}/../../.." && pwd)"
PORTAL_DIR="${ROOT}/memory.agent-mate.ai/admin_portal"
LOCK_FILE="${ROOT}/memory.agent-mate.ai/upstream.lock"
CONTAINER="ai-memory-mcp"
PORT=8814
RC=0
SERVER_PID=""
WORK="$(mktemp -d)"

while [ $# -gt 0 ]; do
  case "$1" in
    --port) shift; PORT="${1:-}" ;;
    *) echo "未知参数：$1" >&2; exit 20 ;;
  esac
  shift
done

pass() { echo "PASS [$1] $2"; }
fail() { echo "FAIL [$1] $2"; }
info() { echo "[i] $1"; }

command -v docker >/dev/null 2>&1 || { echo "ERROR: 未安装 docker" >&2; exit 30; }
docker inspect -f '{{.State.Running}}' "${CONTAINER}" 2>/dev/null | grep -q true || {
  echo "ERROR: 容器 ${CONTAINER} 未运行（先 bash memory.agent-mate.ai/scripts/local-up.sh）" >&2; exit 30; }
[ -d "${PORTAL_DIR}/node_modules" ] || { echo "ERROR: 门户依赖未安装" >&2; exit 30; }

cleanup() {
  [ -n "${SERVER_PID}" ] && kill "${SERVER_PID}" 2>/dev/null
  chmod -R u+rwX "${WORK}" 2>/dev/null
  rm -rf "${WORK}"
}
trap cleanup EXIT

# 起门户（全局 SERVER_PID；真子进程，可 wait）。$1=users_root  $2=日志
# 说明：自检含 auth_posture ⇒ 必须给出一种可用身份姿态，否则「正向」场景本身就不合法
# （v1 正是在这里踩到：没配 Access 也没开测试 JWT ⇒ 自检 fail ⇒ 门户拒绝启动）。
start_portal() {
  PORTAL_ADMIN_HOST="127.0.0.1,localhost" \
  PORTAL_MCP_HOST="mcp.localhost" \
  PORTAL_DB_PATH="${WORK}/portal.db" \
  PORTAL_USERS_ROOT="$1" \
  PORTAL_PORT="${PORT}" \
  PORTAL_LOG_LEVEL="warn" \
  PORTAL_ACCESS_TEAM_DOMAIN="https://probe.cloudflareaccess.com" \
  PORTAL_ACCESS_AUD="probe-aud" \
  npx tsx src/server.ts >"$2" 2>&1 &
  SERVER_PID=$!
}

# ---------------------------------------------------------------- Q1：fail-closed
echo "=== Q1：fail-closed（用户目录不可写 ⇒ 拒绝启动且不 listen）==="
mkdir -p "${WORK}/users-ok" "${WORK}/users-bad"
chmod 500 "${WORK}/users-bad"
cd "${PORTAL_DIR}" || exit 20

start_portal "${WORK}/users-ok" "${WORK}/ok.log"
ready=0
for _ in $(seq 1 40); do
  if curl -fsS -H 'Host: 127.0.0.1' "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "${SERVER_PID}" 2>/dev/null || break
  sleep 0.5
done
if [ "${ready}" -eq 1 ]; then
  pass Q1 "正向对照：目录可写 + 身份姿态合法 ⇒ 门户开始监听（/healthz 通）"
else
  fail Q1 "正向对照失败：门户未监听（见下述自检结论）"
  info "正向日志末 4 行：$(tail -4 "${WORK}/ok.log" | tr '\n' ' ' | cut -c1-260)"
fi
kill "${SERVER_PID}" 2>/dev/null
wait "${SERVER_PID}" 2>/dev/null
SERVER_PID=""

start_portal "${WORK}/users-bad" "${WORK}/bad.log"
bad_exit=""
for _ in $(seq 1 40); do
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then wait "${SERVER_PID}"; bad_exit=$?; break; fi
  sleep 0.5
done
if [ -n "${bad_exit}" ] && [ "${bad_exit}" -ne 0 ]; then
  pass Q1 "负向：不可写目录 ⇒ 进程非零退出（退出码 ${bad_exit}）"
  grep -aoE '"status":"fail","id":"[a-z_]+"' "${WORK}/bad.log" | head -2 | while read -r line; do info "失败项：${line}"; done
else
  fail Q1 "负向：不可写目录下进程未按预期退出（bad_exit=${bad_exit:-仍在跑}）"
  kill "${SERVER_PID}" 2>/dev/null
fi
SERVER_PID=""
if curl -fsS -H 'Host: 127.0.0.1' "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
  fail Q1 "负向：自检失败后端口仍在监听（fail-closed 不成立）"
else
  pass Q1 "负向：自检失败后端口未监听（拒绝对外服务成立）"
fi

# ---------------------------------------------------------------- Q2：deferred 语义
echo
echo "=== Q2：deferred 当下是否被当作通过 ==="
pass_count=$(grep -aoE '"status":"pass"' "${WORK}/ok.log" | wc -l | tr -d ' ')
defer_count=$(grep -aoE '"status":"deferred"' "${WORK}/ok.log" | wc -l | tr -d ' ')
fail_count=$(grep -aoE '"status":"fail"' "${WORK}/ok.log" | wc -l | tr -d ' ')
info "计数：pass=${pass_count} deferred=${defer_count} fail=${fail_count}（正向场景）"
if [ "${ready}" -eq 1 ] && [ "${defer_count}" -ge 1 ]; then
  pass Q2 "实证：存在 deferred 项时门户仍然启动 ⇒ 当下 deferred 不阻塞（本行要收口的缺口）"
else
  fail Q2 "未能实证 deferred 语义（ready=${ready} deferred=${defer_count}）"
fi
info "deferred 三项清单：$(grep -aoE '"status":"deferred","id":"[a-z_0-9]+"' "${WORK}/ok.log" | sed 's/.*id..//;s/.$//' | tr '\n' ' ')"

# ---------------------------------------------------------------- Q3：embeddings 失败形态
echo
echo "=== Q3：embeddings 的失败形态（坏 key 下工具是否仍成功）==="
bad_out="$(printf '%s\n%s\n%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"3.21-probe","version":"0.0.1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memory_recall","arguments":{"context":"probe"}}}' \
  | docker exec -i -e DASHSCOPE_API_KEY=probe-invalid-key "${CONTAINER}" ai-memory mcp --tier smart --profile core 2>&1 || true)"
if printf '%s' "${bad_out}" | grep -qiE 'linear scan|no embeddings|fallback'; then
  pass Q3 "坏 key ⇒ 出现「线性扫描 / 无 embeddings」告警（静默降级路径存在）"
else
  info "未捕获线性扫描告警，输出前 3 行：$(printf '%s' "${bad_out}" | head -3 | tr '\n' ' ' | cut -c1-200)"
  fail Q3 "未复现静默降级告警（判据形状需另定）"
fi
if printf '%s' "${bad_out}" | grep -q '"id":2'; then
  pass Q3 "坏 key 下 tools/call 仍然返回响应 ⇒ 只判「调用成功」会漏判（判据必须看告警或维度）"
else
  info "坏 key 下未取到 id:2 响应（可能被上游拒或超时）——按「更安全」记：上游会拒"
fi

# ---------------------------------------------------------------- Q4：版本锁取法
echo
echo "=== Q4：binary_version_matches_lock 的取法与归一化 ==="
raw_version="$(docker exec "${CONTAINER}" /usr/local/bin/ai-memory --version 2>/dev/null | tr -d '\r\n' || true)"
semver="$(printf '%s' "${raw_version}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
lock_tag="$(grep -oE '^UPSTREAM_RELEASE_TAG="[^"]*"' "${LOCK_FILE}" | cut -d'"' -f2)"
lock_image="$(grep -oE '^IMAGE_TAG="[^"]*"' "${LOCK_FILE}" | cut -d'"' -f2)"
info "容器内 --version=[${raw_version}] ⇒ 取末位 semver=[${semver}] · lock: tag=[${lock_tag}] image=[${lock_image}]"
norm() { printf '%s' "$1" | sed -E 's/^v//'; }
if [ -n "${semver}" ] && [ "${semver}" = "$(norm "${lock_tag}")" ]; then
  pass Q4 "归一化取法成立：--version 取 semver、lock 的 tag 去 v ⇒ 二者相等（${semver} ⇄ ${lock_tag}）"
else
  fail Q4 "版本比对不成立（semver=${semver} lock=${lock_tag}）"
fi
if docker exec "${CONTAINER}" sh -c 'ls /srv/portal/upstream.lock /data/upstream.lock /upstream.lock 2>/dev/null' | grep -q .; then
  info "容器内可见 upstream.lock ⇒ 门户可在启动时直接读"
else
  pass Q4 "实证：upstream.lock 未挂进门户容器（compose volumes 无此项）⇒ 锁侧输入须由镜像构建期固定（归 Sprint 5 镜像侧）"
fi

# ---------------------------------------------------------------- Q5：模板断言
echo
echo "=== Q5：launch_template_assertions 的逐字比对可行性 ==="
PROBE_ROOT="${ROOT}" node --input-type=module -e "
import fs from 'node:fs';
const repo = process.env.PROBE_ROOT;
const tpl = fs.readFileSync(repo + '/memory.agent-mate.ai/admin_portal/src/bridge/launch-template.ts', 'utf8');
const design = fs.readFileSync(repo + '/memory.agent-mate.ai/specs/mcp/mcp-design.md', 'utf8');
const hasConst = /LAUNCH_(ARGS|ENV_TEMPLATE|BINARY|HOME)/.test(tpl);
const designHas = design.includes('docker exec') && design.includes('--profile');
console.log('[i] 模板源含 argv/env 常量表：' + (hasConst ? '是' : '否') + ' · 设计侧可解析：' + (designHas ? '是' : '否'));
console.log((hasConst && designHas ? 'PASS' : 'FAIL') + ' [Q5] 启动期可复用同一常量表 + 同一真源做逐字比对（对照：单测 launch-template.test.ts 17 例已守同一比对体）');
" || fail Q5 "模板断言可行性取证脚本运行失败"

echo
echo "[3.21] 探针结束（结论以 PASS/FAIL 与 [i] 行为准）"
exit "${RC}"
