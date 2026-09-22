#!/usr/bin/env bash
# =============================================================================
# portal-test.sh — 门户离线测试入口（类型检查 + 单元/集成测试）
#
# 为什么要有这个脚本：门户的判据（建用户 → 签发 → 列出 → 轮换 → 吊销即时失效）
#   必须能**离线、可重复**复跑；而真实 Cloudflare Access 链路需要账号与网络。
#   所以离线测试必须是默认入口，在线端到端另走 portal-e2e.sh 且允许明确跳过
#   （跳过要显式，不能让「没跑」看起来像「通过」）。
#
# 退出码契约（调用方据此分流；禁止解析 stdout 文案）:
#   0   全部通过（类型检查 + 测试）
#   10  类型检查失败
#   11  测试失败
#   20  运行错误（不在仓内 / 缺 node / 缺 npm）
#   30  前置不满足（Node 版本过低 / 未安装依赖）
#
# 用法: portal-test.sh [选项]
#   -h | --help  本帮助
#
# 设计要点:
#   - 零网络依赖：只跑 vitest 的 unit/integration（配置见 admin_portal/vitest.config.ts）。
#   - Node 版本按 package.json 的 engines（>=22）检查，早失败好过跑出诡异错误。
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PORTAL_DIR="${REPO_ROOT}/memory.agent-mate.ai/admin_portal"

usage() { sed -n '2,25p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: 未知参数: $1（--help 查看用法）" >&2; exit 20 ;;
  esac
done

[ -d "${PORTAL_DIR}" ] || { echo "ERROR: 未找到门户目录：${PORTAL_DIR}" >&2; exit 20; }
command -v node >/dev/null 2>&1 || { echo "ERROR: 未安装 node" >&2; exit 20; }
command -v npm  >/dev/null 2>&1 || { echo "ERROR: 未安装 npm" >&2; exit 20; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  echo "ERROR: 门户要求 Node >= 22（当前 $(node --version)）" >&2
  exit 30
fi

if [ ! -d "${PORTAL_DIR}/node_modules" ]; then
  echo "ERROR: 未安装依赖 —— 先在 ${PORTAL_DIR} 执行 npm install" >&2
  exit 30
fi

cd "${PORTAL_DIR}"

echo "[portal-test] 类型检查（tsc --noEmit）"
if ! npm run --silent typecheck; then
  echo "[portal-test] FAIL: 类型检查未通过" >&2
  exit 10
fi

echo "[portal-test] 单元/集成测试（vitest run，离线）"
if ! npm run --silent test; then
  echo "[portal-test] FAIL: 测试未通过" >&2
  exit 11
fi

echo "[portal-test] OK: 类型检查与离线测试全部通过"
