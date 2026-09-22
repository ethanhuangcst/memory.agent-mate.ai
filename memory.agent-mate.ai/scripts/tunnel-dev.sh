#!/usr/bin/env bash
# =============================================================================
# tunnel-dev.sh — Cloudflare 隧道：逐步骤引导 + 每步自检（本机开发）
#
# 为什么用隧道而不是「本地关掉认证」：管理面身份由 Cloudflare Access 认定
#   （web-design.md §6.1 / 决议 D11）。要让本地闭环与生产同源，就得让本机门户
#   真的处在 Access 之后。做法 = 命名隧道把本机端口暴露到一个受 Access 应用保护的
#   主机名上，浏览器走 Google / 邮箱一次性验证码登录，门户从注入的签名断言取身份。
#
# 五步流程（每步可单独执行，且都自带自检；②③ 幂等，重复跑不会破坏既有配置）:
#   ① --login    授权 cloudflared（浏览器点一次；写 ~/.cloudflared/cert.pem）
#   ② --create   建命名隧道
#   ③ --route    把公开主机名 CNAME 指到隧道
#   ④ --check    打印 Cloudflare 控制台侧清单（Access 应用 / Allow 策略 / 会话时长 /
#                Service Token 并**加入策略** / MCP 面绕过），并核对 .env 键位缺口
#   ⑤ --verify   自检公开链路：未认证应被 Access 拦截（有 Service Token 时再验自动化路径）
#   另 --start   启动隧道（前台运行；建议另开一个终端）
#
# 退出码契约（调用方据此分流；禁止解析 stdout 文案）:
#   0   成功（步骤完成 / 就绪 / 自检通过）
#   20  运行错误（参数非法 / 缺必需参数）
#   30  前置不满足（未装 cloudflared / 未授权登录 / 缺隧道名）
#   31  就绪检查或自检发现缺口（打印缺口清单）
#
# 用法: tunnel-dev.sh [选项]
#   --login | --create | --route | --check | --verify | --start
#   --tunnel NAME      隧道名（--create / --route / --start 需要）
#   --port N           本机门户端口（默认 8788）
#   --hostname HOST    公开主机名（默认取 .env 的 PORTAL_ADMIN_HOST）
#   -h | --help        本帮助
#
# 设计要点:
#   - ①②③ 只调用 cloudflared 官方子命令（不是裸 API），凭据仅本机 cert.pem 与
#     credentials json；④⑤ 不修改任何远端配置。
#   - 输出中**永不打印密钥**：Service Token 只提示变量名与加入策略的位置。
#   - --check 在必需键位缺失时以 31 退出，便于调用方按码分流。
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PORTAL_DIR="${REPO_ROOT}/memory.agent-mate.ai/admin_portal"
ENV_FILE="${PORTAL_DIR}/.env"
CF_DIR="${HOME}/.cloudflared"
CERT_FILE="${CF_DIR}/cert.pem"

ACTION="check"
TUNNEL_NAME=""
PORT="8788"
HOSTNAME_ARG=""

# 只打印文件开头的连续注释块（首行 shebang 之外），不泄漏代码行
usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --check) ACTION="check" ;;
    --login) ACTION="login" ;;
    --create) ACTION="create" ;;
    --route) ACTION="route" ;;
    --verify) ACTION="verify" ;;
    --start) ACTION="start" ;;
    --tunnel) shift; TUNNEL_NAME="${1:-}" ;;
    --port) shift; PORT="${1:-}" ;;
    --hostname) shift; HOSTNAME_ARG="${1:-}" ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: 未知参数: $1（--help 查看用法）" >&2; exit 20 ;;
  esac
  shift
done

if [ -f "${ENV_FILE}" ]; then
  set -a; . "${ENV_FILE}"; set +a
fi

TUNNEL_HOSTNAME="${HOSTNAME_ARG:-${PORTAL_ADMIN_HOST:-}}"

require_cloudflared() {
  command -v cloudflared >/dev/null 2>&1 || {
    echo "ERROR: 未安装 cloudflared（macOS: brew install cloudflared；Linux: 见 Cloudflare 官方文档）" >&2
    exit 30
  }
}
require_login() {
  [ -f "${CERT_FILE}" ] || {
    echo "ERROR: 尚未授权（缺 ${CERT_FILE}）—— 先执行: bash ${BASH_SOURCE[0]} --login" >&2
    exit 30
  }
}
require_tunnel() {
  [ -n "${TUNNEL_NAME}" ] || { echo "ERROR: 该步骤需要 --tunnel NAME（命名隧道，非 quick tunnel）" >&2; exit 20; }
}
require_hostname() {
  [ -n "${TUNNEL_HOSTNAME}" ] || {
    echo "ERROR: 该步骤需要 --hostname HOST（或 .env 的 PORTAL_ADMIN_HOST）" >&2
    exit 20
  }
}

# ---------------------------------------------------------------------------
# ① 授权
# ---------------------------------------------------------------------------
do_login() {
  require_cloudflared
  if [ -f "${CERT_FILE}" ]; then
    echo "[portal-tunnel] 已授权（${CERT_FILE} 存在）。如需换账号或换域名："
    echo "                rm ${CERT_FILE} && bash ${BASH_SOURCE[0]} --login"
    echo "[portal-tunnel] OK ① 已授权"
    return 0
  fi
  echo "[portal-tunnel] ① 打开浏览器完成授权，并在页面上**选择要用于隧道的域名**。"
  echo "                该命令需要人机交互（这一步请在你的终端里跑）。"
  cloudflared tunnel login || { echo "ERROR: 授权失败" >&2; exit 30; }
  [ -f "${CERT_FILE}" ] || { echo "ERROR: 授权后仍未找到 ${CERT_FILE}" >&2; exit 30; }
  echo "[portal-tunnel] OK ① 已授权（cert.pem 就位）"
}

# ---------------------------------------------------------------------------
# ② 建命名隧道（幂等）
# ---------------------------------------------------------------------------
do_create() {
  require_cloudflared; require_login; require_tunnel
  if cloudflared tunnel info "${TUNNEL_NAME}" >/dev/null 2>&1; then
    echo "[portal-tunnel] 隧道已存在，跳过创建：${TUNNEL_NAME}"
  else
    echo "[portal-tunnel] ② 创建命名隧道：${TUNNEL_NAME}"
    cloudflared tunnel create "${TUNNEL_NAME}" || { echo "ERROR: 创建隧道失败（见上）" >&2; exit 30; }
  fi
  echo "[portal-tunnel] OK ② 隧道就绪"
  cloudflared tunnel info "${TUNNEL_NAME}" 2>/dev/null | sed -n '1,5p' | sed 's/^/      /'
  echo "[portal-tunnel]    凭据文件（含隧道密钥，勿外传）：${CF_DIR}/<隧道ID>.json"
}

# ---------------------------------------------------------------------------
# ③ 绑定主机名 → 隧道（幂等）
# ---------------------------------------------------------------------------
do_route() {
  require_cloudflared; require_login; require_tunnel; require_hostname
  echo "[portal-tunnel] ③ 绑定主机名：${TUNNEL_HOSTNAME} → 隧道 ${TUNNEL_NAME}"
  out="$(cloudflared tunnel route dns "${TUNNEL_NAME}" "${TUNNEL_HOSTNAME}" 2>&1)"; rc=$?
  printf '%s\n' "${out}" | sed 's/^/      /'
  if [ "${rc}" -ne 0 ]; then
    case "${out}" in
      *"already exists"*|*"already configured"*|*"409"*|*"record with that host"*)
        echo "[portal-tunnel]    提示：DNS 记录已存在，视为完成（本步骤幂等）" ;;
      *)
        echo "ERROR: 绑定 DNS 失败（见上）；确认域名已在该账号下且 --hostname 拼写正确" >&2
        exit 31 ;;
    esac
  fi
  echo "[portal-tunnel] OK ③ 主机名已指向隧道（DNS 生效通常数十秒）"
}

# ---------------------------------------------------------------------------
# ④ 控制台清单 + 键位缺口核对
# ---------------------------------------------------------------------------
do_check() {
  gaps=""
  command -v cloudflared >/dev/null 2>&1 || gaps="${gaps}
  - 未安装 cloudflared（macOS: brew install cloudflared）"
  [ -f "${CERT_FILE}" ] || gaps="${gaps}
  - cloudflared 尚未授权（缺 ${CERT_FILE}）—— 先跑 --login"
  [ -n "${TUNNEL_HOSTNAME}" ] || gaps="${gaps}
  - 未提供公开主机名（--hostname 或 .env 的 PORTAL_ADMIN_HOST）"
  [ -n "${PORTAL_MCP_HOST:-}" ] || gaps="${gaps}
  - 未设置 PORTAL_MCP_HOST（面隔离要求两个面各有一个 Host，且不得与 PORTAL_ADMIN_HOST 相同）"
  [ -n "${PORTAL_ACCESS_TEAM_DOMAIN:-}" ] || gaps="${gaps}
  - 未设置 PORTAL_ACCESS_TEAM_DOMAIN（用于取 JWKS 并校验 iss）"
  [ -n "${PORTAL_ACCESS_AUD:-}" ] || gaps="${gaps}
  - 未设置 PORTAL_ACCESS_AUD（Access 应用的 Audience 标签）"

  cat <<EOF
[portal-tunnel] 本机门户端口：${PORT}   公开主机名：${TUNNEL_HOSTNAME:-（未设置）}
[portal-tunnel] MCP 面主机名：${PORTAL_MCP_HOST:-（未设置；须与上面不同）}

终端侧（本脚本代劳，幂等）:
  bash ${BASH_SOURCE[0]} --login                    # ① 授权（浏览器点一次，选域名）
  bash ${BASH_SOURCE[0]} --create --tunnel <隧道名>   # ② 建命名隧道
  bash ${BASH_SOURCE[0]} --route  --tunnel <隧道名> --hostname ${TUNNEL_HOSTNAME:-<公开主机名>}

控制台侧（只能人工，本脚本不调用任何 API）:
  1. Zero Trust → Networks → Tunnels：确认隧道在线；其 Public Hostname 应为
     ${TUNNEL_HOSTNAME:-<公开主机名>} → http://127.0.0.1:${PORT}
     （若用 "cloudflared tunnel run --url" 本机方式，则无需在此再加 hostname）
  2. Zero Trust → Access → Applications → Add an application → Self-hosted
     应用域名：${TUNNEL_HOSTNAME:-<公开主机名>}
     · Add policy → Action: Allow → Include: Emails，列 **>= 2 个**已批准邮箱（多把钥匙，AC10.6）
     · Authentication：Google（主）+ 邮箱一次性验证码（兜底）
     · Session Duration：先选控制台**当前最大档**并记下实际值；目标 3 个月不得当成既有能力（AC10.7）
     保存后在本应用 Overview 页复制 **Application Audience (AUD) Tag** → 填 PORTAL_ACCESS_AUD
  3. Zero Trust → Settings → General 里的 **Team domain**（形如 <team>.cloudflareaccess.com）
     → 填 PORTAL_ACCESS_TEAM_DOMAIN
  4. Zero Trust → Access → Service Auth → Create Service Token（仅自动化用）
     · 把 Client ID / Secret 注入环境变量（**只从环境读，永不入仓**）：
       PORTAL_ACCESS_SERVICE_TOKEN_ID / PORTAL_ACCESS_SERVICE_TOKEN_SECRET
     · **关键**：回到第 2 步那个 Access 应用，把该 Service Token 加入其策略
       （Policy 里加一条 Service Auth / 或在 Allow 策略里 Include: Service Token）
       —— 漏了这步，自动化会拿到 302 而不是 200（--verify 会当场指出）
  5. MCP 面主机名（${PORTAL_MCP_HOST:-<MCP 主机名>}）必须**显式绕过** Access：
     为它建一个应用并把策略设为 **Bypass**（命令行客户端无法完成 SSO 重定向）。
     注：/mcp 端点在下一批次（PSP-W2）才实现，本条先落口径（AC10.6 / deployment.md §12.4）

填完 admin_portal/.env 后:
  make portal-dev                                    # 终端 A：本机门户
  bash ${BASH_SOURCE[0]} --start --tunnel <隧道名> --hostname ${TUNNEL_HOSTNAME:-<公开主机名>}   # 终端 B：隧道
  浏览器打开 https://${TUNNEL_HOSTNAME:-<公开主机名>}/admin/users 走 SSO 登录
  bash ${BASH_SOURCE[0]} --verify --hostname ${TUNNEL_HOSTNAME:-<公开主机名>}                    # ⑤ 链路自检
  make portal-e2e ARGS=--online                                                                # 在线端到端（需 Service Token 环境变量）

安全纪律：门户不存密码、不提供邀请管理员或重设密码的控件（AC10.9）；
         本机凭据只经 .env / 环境变量注入，任何真实值都不得写入仓内文件。
EOF

  if [ -n "${gaps}" ]; then
    echo "[portal-tunnel] 就绪检查发现缺口：${gaps}" >&2
    exit 31
  fi
  echo "[portal-tunnel] 就绪：cloudflared 已授权，键位齐备（下一步 --create / --route，然后 --verify）"
}

# ---------------------------------------------------------------------------
# ⑤ 公开链路自检
# ---------------------------------------------------------------------------
do_verify() {
  require_cloudflared; require_hostname
  url="https://${TUNNEL_HOSTNAME}/admin/users"
  echo "[portal-tunnel] ⑤ 自检：${url}"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${url}" 2>/dev/null)"
  code="${code:-000}"
  case "${code}" in
    302|303|401|403)
      echo "      未认证 → HTTP ${code}：Access 已在链路前（符合预期）" ;;
    200)
      echo "      ✗ 未认证竟返回 200 —— Access 应用未生效或未绑定该主机名" >&2
      exit 31 ;;
    000)
      echo "      ✗ 无法连通（隧道未启动 / DNS 未生效 / 网络不通）" >&2
      exit 31 ;;
    *)
      echo "      ✗ 意外状态码 ${code}" >&2; exit 31 ;;
  esac

  if [ -n "${PORTAL_ACCESS_SERVICE_TOKEN_ID:-}" ] && [ -n "${PORTAL_ACCESS_SERVICE_TOKEN_SECRET:-}" ]; then
    code2="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
      -H "CF-Access-Client-Id: ${PORTAL_ACCESS_SERVICE_TOKEN_ID}" \
      -H "CF-Access-Client-Secret: ${PORTAL_ACCESS_SERVICE_TOKEN_SECRET}" \
      "${url}" 2>/dev/null)"
    code2="${code2:-000}"
    if [ "${code2}" = "200" ]; then
      echo "      Service Token → HTTP 200：自动化路径可用（可跑 make portal-e2e ARGS=--online）"
    else
      echo "      ✗ Service Token → HTTP ${code2}（期望 200）" >&2
      echo "        302 有两种成因，**先判别再动手**：看 302 location 里 meta 的 service_token_status" >&2
      echo "          · false ⇒ CF **根本没认出凭据** —— 优先核对「token 与 Access 应用是否在同一团队」" >&2
      echo "                    以及 Client ID/Secret 是否复制完整（ID 应以 .access 结尾）" >&2
      echo "          · true  ⇒ CF 认出了凭据但**策略不允许** —— 给该应用加一条" >&2
      echo "                    Action=Service Auth、Include=Service Token 的策略" >&2
      exit 31
    fi
  else
    echo "      （未提供 Service Token，跳过自动化路径自检；配置位置见 --check 第 4 步）"
  fi
  echo "[portal-tunnel] OK ⑤ 链路自检通过"
}

case "${ACTION}" in
  login) do_login ;;
  create) do_create ;;
  route) do_route ;;
  verify) do_verify ;;
  check) do_check ;;
  start)
    require_cloudflared; require_tunnel
    echo "[portal-tunnel] 启动命名隧道：${TUNNEL_NAME} → http://127.0.0.1:${PORT}"
    exec cloudflared tunnel run --url "http://127.0.0.1:${PORT}" "${TUNNEL_NAME}"
    ;;
  *) echo "ERROR: 未知动作 ${ACTION}" >&2; exit 20 ;;
esac
