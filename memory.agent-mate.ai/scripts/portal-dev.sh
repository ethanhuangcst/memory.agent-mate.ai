#!/usr/bin/env bash
# =============================================================================
# portal-dev.sh — 本机启动门户（PSP-W1）
#
# 为什么要有这个脚本：门户的启动有一串**前置约束**（依赖已装、必需环境键在位、
#   门户库目录可写、用户目录存在且可写），缺一项都会在运行期表现为难懂的报错
#   （或更糟：静默降级）。把这些前置一次性检查清楚，比在页面里 debug 划算。
#
# 两条本机测试路径（都不新增认证旁路；生产启用自签通道仍被启动期拒绝）:
#   1) 快速路径（无需 Cloudflare）: --env-file .env.local --dev-login
#      生成/复用开发密钥并注入**既有的**自签 JWT 测试通道，并打印**可点登录链接**
#      （/admin/dev-login）与命令行用法 —— 不需要 F12，也不需要粘贴 cookie。
#   2) 真身份路径（接近生产）: --env-file .env（真实主机名 + 团队域 + Audience），
#      经 cloudflared 隧道由 Cloudflare Access 完成 SSO（见 tunnel-dev.sh）。
#
# 退出码契约（调用方据此分流；禁止解析 stdout 文案）:
#   0   成功（进程正常退出）
#   10  启动失败（配置非法 / 自检未通过 / 进程非零退出）
#   20  运行错误（不在仓内 / 缺 node / 参数非法）
#   30  前置不满足（未装依赖 / 缺环境键 / 目录不存在或不可写 / dev-login 用于非回环）
#
# 用法: portal-dev.sh [选项]
#   --watch           以 tsx watch 启动（改代码自动重启；默认关闭）
#   --env-file F      指定环境文件（默认 admin_portal/.env，存在则加载）
#   --dev-login       本机快速登录：注入自签 JWT 测试通道，并打印**可点登录链接**（/admin/dev-login）。
#                     **仅回环 Host 可用**（非回环直接拒绝）；密钥落 .portal-data/dev/。
#   --reset-dev-keys  配合 --dev-login：丢弃既有开发密钥重新生成（旧 cookie 立即失效）
#   -h | --help       本帮助
#
# 设计要点:
#   - 环境文件只**加载**不复制；真实值不入库（.env / .env.local 已被 .gitignore 忽略）。
#   - 开发密钥与令牌落 admin_portal/.portal-data/dev/（同样已被忽略，写入时 umask 077）。
#   - 复用既有开发密钥使 cookie 能跨重启存活；令牌 12 小时有效。
#   - 先跑迁移（src/web/db/migrate.ts 就位时），迁移失败不启动。
#   - 用户目录（PORTAL_USERS_ROOT）不存在时**直接失败**，不静默创建 ——
#     生产里该目录由 setgid 一次性引导建立（deploy 流程），本地由开发者显式准备。
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PORTAL_DIR="${REPO_ROOT}/memory.agent-mate.ai/admin_portal"

WATCH=0
DEV_LOGIN=0
RESET_DEV_KEYS=0
ENV_FILE="${PORTAL_DIR}/.env"
DEV_DIR="${PORTAL_DIR}/.portal-data/dev"

# 只打印文件开头的连续注释块（首行 shebang 之外），不泄漏代码行
usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --watch) WATCH=1 ;;
    --dev-login) DEV_LOGIN=1 ;;
    --reset-dev-keys) RESET_DEV_KEYS=1 ;;
    --env-file) shift; ENV_FILE="${1:-}" ;;
    --email) shift; EMAIL_ARG="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: 未知参数: $1（--help 查看用法）" >&2; exit 20 ;;
  esac
  shift
done

[ -d "${PORTAL_DIR}" ] || { echo "ERROR: 未找到门户目录：${PORTAL_DIR}" >&2; exit 20; }
command -v node >/dev/null 2>&1 || { echo "ERROR: 未安装 node" >&2; exit 20; }
[ -d "${PORTAL_DIR}/node_modules" ] || { echo "ERROR: 未安装依赖 —— 先执行 npm install" >&2; exit 30; }

if [ -n "${ENV_FILE}" ] && [ -f "${ENV_FILE}" ]; then
  echo "[portal-dev] 加载环境文件：${ENV_FILE}"
  set -a; . "${ENV_FILE}"; set +a
fi

missing=""
for key in PORTAL_ADMIN_HOST PORTAL_MCP_HOST PORTAL_DB_PATH; do
  if [ -z "${!key:-}" ]; then missing="${missing} ${key}"; fi
done
if [ -n "${missing}" ]; then
  echo "ERROR: 缺少必需环境键:${missing}（键名与语义见 admin_portal/.env.example）" >&2
  exit 30
fi

# 回环判定：与 src/shared/host-split.ts 的 isLoopbackHost 保持同一语义
is_loopback() {
  case "$1" in
    localhost|127.0.0.1|::1|\[::1\]|*.localhost) return 0 ;;
    *) return 1 ;;
  esac
}

DEV_TOKEN=""
if [ "${DEV_LOGIN}" -eq 1 ]; then
  # 先把「非回环」挡在这里：服务端也会拒，但本脚本能给出可操作的提示
  nonloop=""
  IFS=','
  for part in ${PORTAL_ADMIN_HOST},${PORTAL_MCP_HOST}; do
    host="$(printf '%s' "${part}" | tr -d '[:space:]')"
    [ -n "${host}" ] || continue
    is_loopback "${host}" || nonloop="${nonloop} ${host}"
  done
  unset IFS
  if [ -n "${nonloop}" ]; then
    echo "ERROR: --dev-login 仅允许回环 Host（防止测试通道流向真实域名），检测到非回环:${nonloop}" >&2
    echo "       快速路径请用: make portal-dev ARGS=\"--env-file .env.local --dev-login\"" >&2
    exit 30
  fi

  JWKS_FILE="${DEV_DIR}/jwks.json"
  KEY_FILE="${DEV_DIR}/private.jwk.json"
  TOKEN_FILE="${DEV_DIR}/token"
  DEV_ISS="${PORTAL_DEV_JWT_ISS:-https://portal-dev.test}"
  DEV_AUD="${PORTAL_DEV_JWT_AUD:-portal-dev-aud}"

  mkdir -p "${DEV_DIR}" || { echo "ERROR: 无法创建开发目录：${DEV_DIR}" >&2; exit 30; }
  chmod 700 "${DEV_DIR}" 2>/dev/null || true

  if [ "${RESET_DEV_KEYS}" -eq 1 ] || [ ! -f "${JWKS_FILE}" ] || [ ! -f "${KEY_FILE}" ]; then
    echo "[portal-dev] 生成开发密钥（RS256，仅本机；--reset-dev-keys 可重生成）"
    if ! (cd "${PORTAL_DIR}" && umask 077 && node --input-type=module -e "
import fs from 'node:fs';
import { exportJWK, generateKeyPair } from 'jose';
const [jwksPath, keyPath] = process.argv.slice(1);
// extractable: true —— 私钥要落盘供重启后复用（否则 exportJWK 抛 non-extractable）
const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const kid = 'dev-login';
const pub = await exportJWK(publicKey);
const priv = await exportJWK(privateKey);
fs.writeFileSync(jwksPath, JSON.stringify({ keys: [{ ...pub, alg: 'RS256', kid, use: 'sig' }] }), { mode: 0o600 });
fs.writeFileSync(keyPath, JSON.stringify({ ...priv, alg: 'RS256', kid }), { mode: 0o600 });
" "${JWKS_FILE}" "${KEY_FILE}"); then
      echo "ERROR: 生成开发密钥失败" >&2
      exit 30
    fi
  else
    echo "[portal-dev] 复用既有开发密钥：${DEV_DIR}（--reset-dev-keys 可重生成）"
  fi

  # 开发登录身份 = **真实邮箱**（用户决定：不接受 admin@example.test 之类的测试身份）。
  # 优先级：--email > PORTAL_TEST_JWT_EMAIL（环境文件）> **报错退出**（**刻意不设默认值**）。
  DEV_EMAIL="${EMAIL_ARG:-${PORTAL_TEST_JWT_EMAIL:-}}"
  if [ -z "${DEV_EMAIL}" ]; then
    echo "ERROR: 缺少开发登录身份邮箱 —— 请用 --email <地址>，或在该环境文件中设置 PORTAL_TEST_JWT_EMAIL" >&2
    echo "       该邮箱应为你在 Cloudflare Access 策略里注册过的邮箱；门户侧同样强制必填，不会回落到测试身份。" >&2
    exit 20
  fi
  echo "[portal-dev] 开发登录身份：${DEV_EMAIL}（应为 Cloudflare Access 策略中已注册的邮箱）"

  if ! (cd "${PORTAL_DIR}" && umask 077 && node --input-type=module -e "
import fs from 'node:fs';
import { importJWK, SignJWT } from 'jose';
const [keyPath, tokenPath, iss, aud, ttl, email] = process.argv.slice(1);
const priv = await importJWK(JSON.parse(fs.readFileSync(keyPath, 'utf8')), 'RS256');
const token = await new SignJWT({ email })
  .setProtectedHeader({ alg: 'RS256', kid: 'dev-login' })
  .setIssuer(iss)
  .setAudience(aud)
  .setIssuedAt()
  .setExpirationTime(ttl)
  .sign(priv);
fs.writeFileSync(tokenPath, token, { mode: 0o600 });
" "${KEY_FILE}" "${TOKEN_FILE}" "${DEV_ISS}" "${DEV_AUD}" '12h' "${DEV_EMAIL}"); then
    echo "ERROR: 签发开发令牌失败" >&2
    exit 30
  fi

  export PORTAL_TEST_JWT_ENABLED=1
  export PORTAL_TEST_JWT_JWKS="$(cat "${JWKS_FILE}")"
  export PORTAL_TEST_JWT_EMAIL="${DEV_EMAIL}"
  export PORTAL_TEST_JWT_ISS="${DEV_ISS}"
  export PORTAL_TEST_JWT_AUD="${DEV_AUD}"
  DEV_TOKEN="$(cat "${TOKEN_FILE}")"
fi

# 门户库目录必须存在且可写（文件本身由迁移创建）
DB_DIR="$(dirname "${PORTAL_DB_PATH}")"
[ -d "${DB_DIR}" ] || { echo "ERROR: 门户库目录不存在：${DB_DIR}" >&2; exit 30; }
[ -w "${DB_DIR}" ] || { echo "ERROR: 门户库目录不可写：${DB_DIR}" >&2; exit 30; }

if [ -n "${PORTAL_USERS_ROOT:-}" ]; then
  [ -d "${PORTAL_USERS_ROOT}" ] || { echo "ERROR: 用户目录不存在：${PORTAL_USERS_ROOT}（生产由 setgid 引导建立）" >&2; exit 30; }
  [ -w "${PORTAL_USERS_ROOT}" ] || { echo "ERROR: 用户目录不可写：${PORTAL_USERS_ROOT}" >&2; exit 30; }
else
  echo "[portal-dev] 提示：PORTAL_USERS_ROOT 未设置，将回落 /data/users（生产默认）"
fi

BIND_PORT="${PORTAL_PORT:-8788}"
if [ "${DEV_LOGIN}" -eq 1 ]; then
  echo "[portal-dev] ─────────────────────────────────────────────────────────────"
  echo "[portal-dev] 快速登录已就绪（仅本机开发；Host 全为回环，生产仍禁用该通道）"
  echo "[portal-dev]   管理面 URL : http://127.0.0.1:${BIND_PORT}/admin/users"
  echo "[portal-dev]   令牌文件   : ${TOKEN_FILE}（12 小时有效；密钥复用 ⇒ 重启后仍可用）"
  echo "[portal-dev]"
  echo "[portal-dev]   ① 浏览器（推荐，**不需要 F12、不需要粘 cookie**）："
  echo "[portal-dev]      打开 http://127.0.0.1:${BIND_PORT}/admin/dev-login → 点击「以测试管理员身份登录」"
  echo "[portal-dev]      （该入口仅在自签通道启用时存在；生产环境不注册此路由。身份邮箱见上方「开发登录身份」）"
  echo "[portal-dev]"
  echo "[portal-dev]   ② 命令行："
  echo "[portal-dev]      curl -s -o /dev/null -w '%{http_code}\\n' -H 'Host: 127.0.0.1' \\"
  echo "[portal-dev]        -H \"Cf-Access-Jwt-Assertion: \$(cat ${TOKEN_FILE})\" \\"
  echo "[portal-dev]        http://127.0.0.1:${BIND_PORT}/admin/users"
  echo "[portal-dev]      期望 200；去掉断言头应回 401（身份先于路由）"
  echo "[portal-dev] ─────────────────────────────────────────────────────────────"
fi

cd "${PORTAL_DIR}"

if [ -f src/web/db/migrate.ts ]; then
  echo "[portal-dev] 迁移门户库"
  if ! npm run --silent migrate; then
    echo "[portal-dev] FAIL: 迁移失败" >&2
    exit 10
  fi
else
  echo "[portal-dev] 提示：迁移尚未落地（src/web/db/migrate.ts 未就位），跳过"
fi

echo "[portal-dev] 启动门户"
if [ "${WATCH}" -eq 1 ]; then
  npm run --silent dev
else
  npm run --silent start
fi
status=$?
[ "${status}" -eq 0 ] || { echo "[portal-dev] FAIL: 进程退出码 ${status}" >&2; exit 10; }
