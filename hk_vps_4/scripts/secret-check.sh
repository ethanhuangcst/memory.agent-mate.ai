#!/usr/bin/env bash
# =============================================================================
# secret-check.sh — 扫描「入库内容」中是否混入公网 IPv4 / 私有 MaaS 端点主机名
#
# 真实值的单一真相源是 gitignored 的 hk_vps_4/secrets.local.hk_vps_4.md，
# 仓库中的文档一律使用具名占位符（<VPS4_IP> / <VPS3_IP> / <PG_HOST> /
# <MYSQL_HOST> / <QWEN_BASE_URL>）。本脚本作为防复发护栏：把真实 IP 或真实
# 端点主机名写进被跟踪文件时拦截。
#
# 退出码契约（调用方据此分流；禁止解析 stdout 文案做判断）:
#   0  未发现非白名单公网 IPv4，也未发现真实 MaaS 端点主机名
#   1  发现命中；stdout 列出 "<文件>:<行号>: <片段>"，并提示真实值归属
#   2  运行错误（缺 git / python3 / 当前不在 git 仓内）
#
# 用法: secret-check.sh [选项]
#   --staged      扫描暂存区（index）内容（git grep --cached）；用于 pre-commit 钩子
#   -h | --help   本帮助
#
# 设计要点:
#   - 真相渠道只用 git 自身：git grep（已跟踪文件）/ git grep --cached（暂存区）。
#     gitignored 的 secrets.local.* 不会进跟踪集或 index，天然豁免，无需额外排除。
#   - 不硬编码任何真实 IP（否则检查器自身成为泄露源）；用通用 IPv4 模式 +
#     私网/回环白名单，既能拦住本次 4 个 IP，也能拦住未来新增的其它公网 IP。
#   - 模式校验放 python3 标准库：macOS 的 git grep 不支持 \b / -P（实测会静默
#     返回 0），故 git 层只做「四段数字」粗筛，精确八位组(0-255)与白名单判定
#     交给 python，并加 (?<!\d)/(?!\d) 边界避免在大数里误抽（如 1.2.3.1234）。
#   - 依赖仅 git + python3（标准库）；零外部依赖，可离线运行。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

STAGED=0

usage() { sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --staged) STAGED=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: 未知参数: $1（--help 查看用法）" >&2; exit 2 ;;
  esac
  shift
done

command -v git     >/dev/null 2>&1 || { echo "ERROR: 缺少 git" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "ERROR: 缺少 python3" >&2; exit 2; }

cd "$REPO_ROOT" || { echo "ERROR: 无法进入仓库根目录: $REPO_ROOT" >&2; exit 2; }

# ── 真相渠道：git grep（自动豁免 gitignored 文件）─────────────────────────────
# 粗筛模式：四段「数字.数字.数字.数字」，交给 python 做精确判定。
IP_RAW_PATTERN='([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})'

# 私有 MaaS 端点主机名：workspace 标识（llm-<workspace>.<region>.maas.aliyuncs.com）
# 可被探测，与公网 IP 同属「应脱敏」信息 —— 仓库中只允许 <QWEN_BASE_URL> 占位符。
# （上面这行刻意写成占位形态，否则本脚本自己的注释会被自己命中。）
# 只写通用后缀、不含具体 workspace 值，避免检查器自身成为泄露源。
MAAS_HOST_PATTERN='[A-Za-z0-9-]+\.maas\.aliyuncs\.com'

if [ "$STAGED" -eq 1 ]; then
  # 暂存区内容（pre-commit 钩子使用）。gitignored 文件不会进 index。
  RAW="$(git grep --cached -nE "$IP_RAW_PATTERN" 2>/dev/null || true)"
  HOST_RAW="$(git grep --cached -nE "$MAAS_HOST_PATTERN" 2>/dev/null || true)"
else
  # 已跟踪文件（默认）。git grep 默认不搜忽略文件，secrets.local.* 天然豁免。
  RAW="$(git grep -nE "$IP_RAW_PATTERN" 2>/dev/null || true)"
  HOST_RAW="$(git grep -nE "$MAAS_HOST_PATTERN" 2>/dev/null || true)"
fi

if [ -z "$RAW" ] && [ -z "$HOST_RAW" ]; then
  echo "OK: 未发现公网 IPv4 / 私有 MaaS 主机名（模式: $([ "$STAGED" -eq 1 ] && echo '暂存区' || echo '已跟踪文件')）"
  exit 0
fi

# ── 精确判定（python3 标准库）──────────────────────────────────────────────
# 白名单：私网 / 回环 / 链路本地 / 全零 / 广播；这些不是「应脱敏的公网 IP」。
# 注意：RAW 经环境变量传入，避免「管道 |」与「here-doc <<'PY'」争抢 stdin
# （here-doc 会覆盖管道，导致 python 读不到候选行而永远漏报）。
SECRET_FILE="hk_vps_4/secrets.local.hk_vps_4.md"
export RAW

HITS="$(python3 - "$SECRET_FILE" <<'PY'
import os, re, sys

raw = os.environ.get("RAW", "")
secret_file = sys.argv[1]

def is_public(octets):
    a, b, c, d = octets
    # 0.0.0.0
    if (a, b, c, d) == (0, 0, 0, 0):
        return False
    # 127.0.0.0/8 回环
    if a == 127:
        return False
    # 10.0.0.0/8
    if a == 10:
        return False
    # 172.16.0.0/12
    if a == 172 and 16 <= b <= 31:
        return False
    # 192.168.0.0/16
    if a == 192 and b == 168:
        return False
    # 169.254.0.0/16 链路本地
    if a == 169 and b == 254:
        return False
    # 255.255.255.255 广播
    if (a, b, c, d) == (255, 255, 255, 255):
        return False
    return True

# git grep 输出格式：<文件>:<行号>:<内容>
# 同一行可能含多个 IP；逐个判定，边界用 (?<!\d)/(?!\d) 避免在大数里误抽。
pat = re.compile(r'(?<![\d.])((\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}))(?![\d.])')
out = []
for line in raw.splitlines():
    line = line.rstrip('\n')
    if ':' not in line:
        continue
    file_part, line_no, content = line.split(':', 2)
    reported = False
    for m in pat.finditer(content):
        octets = tuple(int(m.group(i)) for i in range(2, 6))
        if any(x > 255 for x in octets):
            continue
        if is_public(octets):
            out.append("%s:%s: %s" % (file_part, line_no, content.strip()))
            reported = True
            break  # 一行只要有 1 个公网 IP 即报一次，避免重复刷屏
    _ = reported
print("\n".join(out))
PY
)"

# 主机名命中无需 python 精判：git grep 命中的即为真实 *.maas.aliyuncs.com
if [ -n "$HOST_RAW" ]; then
  echo "发现以下私有 MaaS 端点主机名（仓库内应改用占位符 <QWEN_BASE_URL>）:"
  echo "$HOST_RAW"
  echo
fi

if [ -n "$HITS" ]; then
  echo "发现以下公网 IPv4（应迁移到 ${SECRET_FILE}，仓库内改用具名占位符）:"
  echo "$HITS"
  echo
fi

if [ -n "$HITS" ] || [ -n "$HOST_RAW" ]; then
  echo "处置：把真实值写入 ${SECRET_FILE}，并在文档中替换为对应占位符，再提交。"
  exit 1
fi

echo "OK: 未发现公网 IPv4 / 私有 MaaS 主机名（命中的 IP 均为私网/回环等白名单地址）"
exit 0
