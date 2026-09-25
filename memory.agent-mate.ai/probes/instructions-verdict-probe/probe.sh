#!/usr/bin/env bash
# =============================================================================
# 3.20 接入说明判据可行性探针（研究类，**不入制品**；结论回写 specs）
#
# 目的（只回答四个可证伪的问题，见 README）：
#   Q1 「三步接入」的真浏览器判据能否区分「有 / 无」——用同一套判据判
#      ① 已实现的门户公开页 `/`（`#4.2` 未落地，预期 0 步）
#      ② 原型 `specs/web-portal/mockups/01-instructions.html`（已交付的正向样本，预期 3 步）
#   Q2 `AC6.1` 的「Admin 入口」在实现页是否有实体（预期：无）
#   Q3 「示例一律占位符（`AC6.5`）」的扫描规则在**现有制品**上是否零误报，且**注入真实形态必命中**
#   Q4 `AC6.4`「页面档位名与工具数 vs 能力文档逐项一致」的比对对象能否**机械取到**
#
# 编排骨架照抄 `scripts/portal-e2e.sh`（自签 JWT + 独占端口 + 就绪探测 + trap 收尾），
# 但**只读**：不写产品代码、不改任何 specs/制品。
#
# 退出码：0 = 探针本身跑通（结论以打印为准）· 20 = 运行错误 · 30 = 前置不满足
# =============================================================================
set -uo pipefail

PORT="8812"
while [ $# -gt 0 ]; do
  case "$1" in
    --port) shift; PORT="${1:-}" ;;
    *) echo "未知参数：$1" >&2; exit 20 ;;
  esac
  shift
done

PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${PROBE_DIR}/../../.." && pwd)"          # 仓根（三级上溯：probes/<name>/ → probes/ → memory.agent-mate.ai/ → 仓根）
PORTAL_DIR="${ROOT}/memory.agent-mate.ai/admin_portal"
PROTOTYPE="${ROOT}/memory.agent-mate.ai/specs/web-portal/mockups/01-instructions.html"
BASE_URL="http://127.0.0.1:${PORT}"

command -v python3 >/dev/null 2>&1 || { echo "ERROR: 未安装 python3" >&2; exit 20; }
python3 -c 'import playwright' >/dev/null 2>&1 || {
  echo "ERROR: 缺少 playwright（python3 -m pip install playwright && python3 -m playwright install chromium）" >&2
  exit 30
}
[ -f "${PROTOTYPE}" ] || { echo "ERROR: 原型文件不存在：${PROTOTYPE}" >&2; exit 20; }

# 独占端口预检（照抄 portal-e2e.sh 的既有纪律：宁可 fail-loud，也不要测到别人的实例）
if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "ERROR: 端口 ${PORT} 已被占用（本探针必须独占端口）。用 --port <端口> 换一个。" >&2
  lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN 2>/dev/null | sed -n '2,3p' | sed 's/^/       占用: /' >&2
  exit 30
fi

WORK_DIR="$(mktemp -d)"
SERVER_PID=""
cleanup() {
  [ -n "${SERVER_PID}" ] && kill "${SERVER_PID}" 2>/dev/null || true
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

cd "${PORTAL_DIR}" || exit 20
if ! node --input-type=module -e "
import fs from 'node:fs';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
const [jwksPath, tokenPath] = process.argv.slice(1);
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
fs.writeFileSync(jwksPath, JSON.stringify({ keys: [{ ...jwk, alg: 'RS256', kid: 'probe-key', use: 'sig' }] }));
const token = await new SignJWT({ email: 'admin@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: 'probe-key' })
  .setIssuer('https://probe.test').setAudience('probe-aud')
  .setIssuedAt().setExpirationTime('15m').sign(privateKey);
fs.writeFileSync(tokenPath, token);
" "${WORK_DIR}/jwks.json" "${WORK_DIR}/token"; then
  echo "ERROR: 生成测试密钥失败" >&2
  exit 30
fi

mkdir -p "${WORK_DIR}/users"
echo "[3.20] 启动门户（回环绑定 + 自签 JWT 通道，端口 ${PORT}）"
PORTAL_ADMIN_HOST="127.0.0.1,localhost" \
PORTAL_MCP_HOST="mcp.localhost" \
PORTAL_DB_PATH="${WORK_DIR}/portal.db" \
PORTAL_USERS_ROOT="${WORK_DIR}/users" \
PORTAL_PORT="${PORT}" \
PORTAL_LOG_LEVEL="warn" \
PORTAL_TEST_JWT_ENABLED="1" \
PORTAL_TEST_JWT_JWKS="$(cat "${WORK_DIR}/jwks.json")" \
PORTAL_TEST_JWT_ISS="https://probe.test" \
PORTAL_TEST_JWT_AUD="probe-aud" \
PORTAL_TEST_JWT_EMAIL="admin@example.test" \
npx tsx src/server.ts > "${WORK_DIR}/server.log" 2>&1 &
SERVER_PID=$!

ready=0
for _ in $(seq 1 40); do
  if curl -fsS -H 'Host: 127.0.0.1' "${BASE_URL}/healthz" >/dev/null 2>&1; then ready=1; break; fi
  kill -0 "${SERVER_PID}" 2>/dev/null || break
  sleep 0.5
done
if [ "${ready}" -ne 1 ]; then
  echo "ERROR: 门户未就绪（见日志）" >&2
  tail -20 "${WORK_DIR}/server.log" >&2
  exit 30
fi

python3 "${PROBE_DIR}/probe.py" \
  --base-url "${BASE_URL}" \
  --prototype "file://${PROTOTYPE}" \
  --repo-root "${ROOT}"
rc=$?

echo
echo "[3.20] 收尾：门户已停止（pid ${SERVER_PID}）"
exit "${rc}"
