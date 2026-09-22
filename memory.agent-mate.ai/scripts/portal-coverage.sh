#!/usr/bin/env bash
# =============================================================================
# portal-coverage.sh — 门户覆盖率入口（v8；阈值低于即失败）
#
# 为什么单独一个入口而不是塞进 pre-commit：覆盖率运行会显著拖慢提交，而它属于
#   **收口期**判定项（验收/回顾时跑），不是每次提交都要付的成本。因此它是独立目标。
#
# 两段式判定（退出码可分流，调用方不必解析文案）:
#   ① 先跑离线测试：测试逻辑失败 ⇒ 10（覆盖率数字此时无意义，先修测试）
#   ② 再跑覆盖率：低于 vitest.config.ts 里 thresholds 的任一项 ⇒ 11
#   —— 阈值本身由 vitest 判定并返回非零；本脚本负责把它与「测试失败」区分开。
#
# 退出码契约（调用方据此分流；禁止解析 stdout 文案）:
#   0   通过（测试全绿且四项覆盖率均达标）
#   10  测试未通过（与覆盖率无关）
#   11  覆盖率未达阈值（四项数值与阈值见输出；明细见 admin_portal/coverage/index.html）
#   20  运行错误（不在仓内 / 缺 node / 参数非法）
#   30  前置不满足（未装依赖 / 未装 @vitest/coverage-v8）
#
# 用法: portal-coverage.sh [选项]
#   -h | --help   本帮助
#
# 设计要点:
#   - 零外部依赖（bash + python3 标准库），可离线执行；产物落 admin_portal/coverage/
#     （该目录已在根 .gitignore 中忽略）。
#   - 阈值真源是 admin_portal/vitest.config.ts：本脚本只**读取并展示**，不在脚本里另立一套，
#     避免「文档写一套、配置跑另一套」。
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PORTAL_DIR="${REPO_ROOT}/memory.agent-mate.ai/admin_portal"

usage() { awk 'NR==1{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "${BASH_SOURCE[0]}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: 未知参数: $1（--help 查看用法）" >&2; exit 20 ;;
  esac
  shift
done

[ -d "${PORTAL_DIR}" ] || { echo "ERROR: 未找到门户目录：${PORTAL_DIR}" >&2; exit 20; }
command -v node >/dev/null 2>&1 || { echo "ERROR: 未安装 node" >&2; exit 20; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: 未安装 python3" >&2; exit 20; }
[ -d "${PORTAL_DIR}/node_modules" ] || { echo "ERROR: 未安装依赖 —— 先执行 npm install" >&2; exit 30; }
[ -d "${PORTAL_DIR}/node_modules/@vitest/coverage-v8" ] || {
  echo "ERROR: 未安装 @vitest/coverage-v8（npm install；版本与 vitest 同版）" >&2
  exit 30
}

cd "${PORTAL_DIR}" || exit 20
mkdir -p coverage

echo "[portal-coverage] ① 离线测试（逻辑正确性优先）"
if ! npm run --silent test; then
  echo "[portal-coverage] FAIL: 测试未通过 —— 先修测试，覆盖率数字此时无意义" >&2
  exit 10
fi

echo "[portal-coverage] ② 覆盖率（v8；阈值低于即失败）"
npm run --silent test:coverage 2>&1 | tee coverage/last-run.log
rc="${PIPESTATUS[0]}"

# 展示「实测 vs 阈值」：阈值真源 = vitest.config.ts（只读，不在脚本里另立一套）
python3 - "${PORTAL_DIR}/coverage/coverage-summary.json" "${PORTAL_DIR}/vitest.config.ts" <<'PY' || true
import json
import re
import sys

summary_path, config_path = sys.argv[1], sys.argv[2]
try:
    with open(summary_path, encoding="utf-8") as handle:
        total = json.load(handle)["total"]
except (OSError, KeyError, ValueError):
    print("[portal-coverage] 提示：未读到 coverage-summary.json（测试可能未跑完）")
    raise SystemExit(0)

keys = [("statements", "语句"), ("branches", "分支"), ("functions", "函数"), ("lines", "行")]
actual = {key: total[key]["pct"] for key, _ in keys}

thresholds: dict[str, str] = {}
try:
    with open(config_path, encoding="utf-8") as handle:
        config = handle.read()
    block = re.search(r"thresholds:\s*\{(.*?)\}", config, re.S)
    if block:
        for key, value in re.findall(r"(\w+):\s*([0-9.]+)", block.group(1)):
            thresholds[key] = value
except OSError:
    pass

print()
print("[portal-coverage] 实测（src/** 全部）：" + " · ".join(
    f"{label} {actual[key]:.2f}%" for key, label in keys))
if thresholds:
    print("[portal-coverage] 阈值：" + " · ".join(
        f"{label} {thresholds.get(key, '未设')}" for key, label in keys))
    unmet = [
        f"{label}({actual[key]:.2f}% < {thresholds[key]}%)"
        for key, label in keys
        if key in thresholds and actual[key] < float(thresholds[key])
    ]
    if unmet:
        print("[portal-coverage] 未达阈值：" + "、".join(unmet))
else:
    print("[portal-coverage] 阈值：未设置（vitest.config.ts 的 test.coverage.thresholds 为空）")
print("[portal-coverage] 明细：admin_portal/coverage/index.html（已忽略，不入库）")
PY

if [ "${rc}" -eq 0 ]; then
  echo "[portal-coverage] OK: 测试全绿且覆盖率达标"
  exit 0
fi
echo "[portal-coverage] FAIL: 覆盖率未达阈值（见上表与 coverage/index.html）" >&2
exit 11
