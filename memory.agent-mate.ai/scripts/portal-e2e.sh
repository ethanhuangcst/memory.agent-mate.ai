#!/usr/bin/env bash
# =============================================================================
# portal-e2e.sh — 门户端到端测试入口（离线优先；在线可跳过但必须显式）
#
# 为什么要分两条路：管理面身份由 Cloudflare Access 认定，而**浏览器 SSO 无法被自动化**。
# 因此：
#   - 离线（默认）：脚本自建测试密钥对与自签 JWT，把 JWT 放进 `CF_Authorization` cookie
#     （生产浏览器场景本来就走这条路径），用真浏览器跑完整闭环，**零网络依赖**；
#   - 在线（--online）：经 cloudflared 隧道 + Access Service Token，验真链路（AC10.1/AC10.5）。
# 在线缺前置时**以退出码 40 明确跳过** —— 绝不允许「没跑」伪装成「通过」。
#
# 退出码契约（调用方据此分流；禁止解析 stdout 文案）:
#   0   全部执行的套件都通过
#   40  在线套件被跳过（缺 cloudflared 或缺 Service Token）—— 不算失败，但必须可见
#   41  有套件失败
#   20  运行错误（不在仓内 / 缺 python3 / 缺 node）
#   30  前置不满足（缺 playwright / 未装依赖 / 服务未起）
#
# 用法: portal-e2e.sh [选项]
#   --online              追加在线套件（隧道 + Service Token）
#   --port N              离线套件使用的本机端口（默认 8788）
#   -h | --help           本帮助
#
# 环境变量（仅在线套件，勿写入仓内文件）:
#   PORTAL_E2E_ONLINE_BASE_URL（隧道公开地址）
#   PORTAL_ACCESS_SERVICE_TOKEN_ID / PORTAL_ACCESS_SERVICE_TOKEN_SECRET
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PORTAL_DIR="${REPO_ROOT}/memory.agent-mate.ai/admin_portal"
E2E_DIR="${PORTAL_DIR}/tests/e2e"

ONLINE=0
PORT="8788"

usage() { sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --online) ONLINE=1 ;;
    --port) shift; PORT="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: 未知参数: $1（--help 查看用法）" >&2; exit 20 ;;
  esac
  shift
done

[ -d "${PORTAL_DIR}" ] || { echo "ERROR: 未找到门户目录：${PORTAL_DIR}" >&2; exit 20; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: 未安装 python3" >&2; exit 20; }
command -v node >/dev/null 2>&1 || { echo "ERROR: 未安装 node" >&2; exit 20; }
[ -d "${PORTAL_DIR}/node_modules" ] || { echo "ERROR: 未安装依赖 —— 先执行 npm install" >&2; exit 30; }

if ! python3 -c 'import playwright' >/dev/null 2>&1; then
  echo "ERROR: 缺少 playwright（python3 -m pip install playwright && python3 -m playwright install chromium）" >&2
  exit 30
fi

BASE_URL="http://127.0.0.1:${PORT}"
WORK_DIR="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  if [ -n "${SERVER_PID}" ]; then kill "${SERVER_PID}" 2>/dev/null || true; fi
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

echo "[portal-e2e] 生成测试密钥与自签 JWT（仅用于本机测试）"
cd "${PORTAL_DIR}" || exit 20
if ! node --input-type=module -e "
import fs from 'node:fs';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
const [jwksPath, tokenPath] = process.argv.slice(1);
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = await exportJWK(publicKey);
fs.writeFileSync(jwksPath, JSON.stringify({ keys: [{ ...jwk, alg: 'RS256', kid: 'e2e-key', use: 'sig' }] }));
const token = await new SignJWT({ email: 'admin@example.test' })
  .setProtectedHeader({ alg: 'RS256', kid: 'e2e-key' })
  .setIssuer('https://e2e.test')
  .setAudience('e2e-aud')
  .setIssuedAt()
  .setExpirationTime('30m')
  .sign(privateKey);
fs.writeFileSync(tokenPath, token);
" "${WORK_DIR}/jwks.json" "${WORK_DIR}/token"; then
  echo "ERROR: 生成测试密钥失败" >&2
  exit 30
fi

mkdir -p "${WORK_DIR}/users"
echo "[portal-e2e] 启动门户（回环绑定，自签 JWT 通道）"
PORTAL_ADMIN_HOST="127.0.0.1,localhost" \
PORTAL_MCP_HOST="mcp.localhost" \
PORTAL_DB_PATH="${WORK_DIR}/portal.db" \
PORTAL_USERS_ROOT="${WORK_DIR}/users" \
PORTAL_PORT="${PORT}" \
PORTAL_LOG_LEVEL="warn" \
PORTAL_TEST_JWT_ENABLED="1" \
PORTAL_TEST_JWT_JWKS="$(cat "${WORK_DIR}/jwks.json")" \
PORTAL_TEST_JWT_ISS="https://e2e.test" \
PORTAL_TEST_JWT_AUD="e2e-aud" \
npx tsx src/server.ts > "${WORK_DIR}/server.log" 2>&1 &
SERVER_PID=$!

ready=0
for _ in $(seq 1 40); do
  if curl -fsS -H 'Host: 127.0.0.1' "${BASE_URL}/healthz" >/dev/null 2>&1; then ready=1; break; fi
  if ! kill -0 "${SERVER_PID}" 2>/dev/null; then break; fi
  sleep 0.5
done
if [ "${ready}" -ne 1 ]; then
  echo "ERROR: 门户未就绪（见日志）" >&2
  tail -20 "${WORK_DIR}/server.log" >&2
  exit 30
fi

failed=0
echo "[portal-e2e] 离线套件（自签 JWT + 真浏览器，零网络）"
if ! python3 "${E2E_DIR}/offline_flow.py" --base-url "${BASE_URL}" --token "$(cat "${WORK_DIR}/token")"; then
  echo "[portal-e2e] FAIL: 离线套件未通过" >&2
  failed=1
fi

skipped=0
if [ "${ONLINE}" -eq 1 ]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "[portal-e2e] SKIP: 在线套件跳过 —— 未安装 cloudflared（见 make portal-tunnel）" >&2
    skipped=1
  elif [ -z "${PORTAL_E2E_ONLINE_BASE_URL:-}" ]; then
    echo "[portal-e2e] SKIP: 在线套件跳过 —— 未提供 PORTAL_E2E_ONLINE_BASE_URL（隧道公开地址）" >&2
    skipped=1
  elif [ -z "${PORTAL_ACCESS_SERVICE_TOKEN_ID:-}" ] || [ -z "${PORTAL_ACCESS_SERVICE_TOKEN_SECRET:-}" ]; then
    echo "[portal-e2e] SKIP: 在线套件跳过 —— 未提供 Access Service Token" >&2
    skipped=1
  else
    echo "[portal-e2e] 在线套件（隧道 + Service Token，验真 Access 链路）"
    if ! python3 "${E2E_DIR}/online_flow.py" --base-url "${PORTAL_E2E_ONLINE_BASE_URL}"; then
      echo "[portal-e2e] FAIL: 在线套件未通过" >&2
      failed=1
    fi
  fi
fi

if [ "${failed}" -eq 1 ]; then exit 41; fi
if [ "${skipped}" -eq 1 ]; then
  echo "[portal-e2e] 已执行套件通过；在线套件明确跳过（退出码 40）"
  exit 40
fi
echo "[portal-e2e] OK: 全部已执行套件通过"
