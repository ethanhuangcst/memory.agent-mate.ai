#!/usr/bin/env bash
# =============================================================================
# run-fixtures.sh — upstream-preflight.sh 的离线自测
#
# 目的：让判定逻辑的回归在**无网络**环境下可验证。
#       fixture 与 --now 固定，「沉淀期不足」这类时间相关用例不会随日历漂移。
#
# 用法: bash memory.agent-mate.ai/scripts/tests/run-fixtures.sh
# 退出码: 0 全部通过 / 1 存在失败
# =============================================================================
set -euo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFLIGHT="$(cd "${TESTS_DIR}/.." && pwd)/upstream-preflight.sh"

NOW="2026-09-20T00:00:00Z"
PASS=0
FAIL=0

run_case() { # $1=用例名 $2=fixture $3=期望退出码 $4=期望文案 $5...=额外参数
  local name="$1" fixture="$2" want_code="$3" want_text="$4"
  shift 4
  local out rc
  set +e
  out="$(bash "$PREFLIGHT" --fixture "${TESTS_DIR}/${fixture}" --now "$NOW" "$@" 2>/dev/null)"
  rc=$?
  set -e

  local ok=1 why=""
  if [ "$rc" -ne "$want_code" ]; then
    ok=0; why="退出码 ${rc} ≠ 期望 ${want_code}"
  elif ! printf '%s' "$out" | grep -qF "$want_text"; then
    ok=0; why="输出未包含: ${want_text}"
  fi

  if [ "$ok" -eq 1 ]; then
    printf '  ✓ %-28s exit=%s  "%s"\n' "$name" "$rc" "$want_text"
    PASS=$(( PASS + 1 ))
  else
    printf '  ✗ %-28s %s\n' "$name" "$why"
    printf '%s\n' "$out" | sed 's/^/      | /'
    FAIL=$(( FAIL + 1 ))
  fi
}

printf '=== upstream-preflight 离线自测（now=%s）===\n' "$NOW"

# 1) 稳定候选 → 无硬性阻断 → exit 3
run_case "稳定候选" release-stable.json 3 "可评估升级"

# 2) 预发布版 → H1 阻断 → exit 2 + 指定话术
run_case "预发布版(H1)" release-prerelease.json 2 "该版本尚不稳定，不适合更新"

# 3) 沉淀期不足 → H2 阻断 → exit 2 + 指定话术
run_case "沉淀期不足(H2)" release-too-fresh.json 2 "该版本尚不稳定，不适合更新"

# 4) 稳定候选 + 含破坏性关键词的 CHANGELOG → 仍 exit 3，但 W1 报警
run_case "破坏性关键词(W1)" release-stable.json 3 "命中: " \
  --changelog-file "${TESTS_DIR}/changelog-with-breaking.md"

# 5) 提高沉淀期阈值 → 原本稳定的候选被 H2 阻断（阈值可配）
run_case "阈值可配(H2)" release-stable.json 2 "该版本尚不稳定，不适合更新" --soak-days 60

printf -- '---\n通过 %d / 失败 %d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1
