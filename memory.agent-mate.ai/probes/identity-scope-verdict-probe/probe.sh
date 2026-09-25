#!/usr/bin/env bash
# 3.22 真身份 / 主机名 / Bypass 口径核对探针（研究类，**不入制品**；纯静态、只读、零网络）。
#
# 用法：bash memory.agent-mate.ai/probes/identity-scope-verdict-probe/probe.sh
# 退出码：0 = 探针跑通（结论以 PASS/FAIL 表为准）· 20 = 运行错误
set -uo pipefail
PROBE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "${PROBE_DIR}/out"
exec node "${PROBE_DIR}/probe.mjs" "$@"
