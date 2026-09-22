#!/usr/bin/env bash
# =============================================================================
# link-check.sh — 校验仓内 Markdown 的「相对链接」是否悬空
#
# 为什么要有这个护栏：本仓已两次因「文档删除 / 改名后引用未同步」留下悬空链接
#   —— mcp_oss_bak_com_requirements.md 删除后留下 11 处引用（2026-09-20 已清）；
#      hk_vps_4/ → memory.agent-mate.ai/ 改名与 specs 整合会再删 9 份文档。
#   人工 grep 不可靠（链接写法多样、锚点与标题各异），故固化为可重复脚本并挂
#   `make doc-links`，让这类缺陷可被显式检出而不是靠记忆。
#
# 退出码契约（调用方据此分流；禁止解析 stdout 文案做判断）:
#   0   无悬空相对链接
#   10  发现悬空链接；stdout 列出 "<源文件>:<行号>: <链接目标>"
#   20  运行错误（缺 python3 / 不在仓内）
#
# 用法: link-check.sh [选项]
#   --verbose   另打印每个文件的被检链接数（排查用）
#   -h | --help 本帮助
#
# 设计要点:
#   - 只判「相对链接」：http(s) / mailto 等带协议的外部链接不校验（离线也会通过）。
#   - 锚点忽略：只校验 `#` 之前的路径部分（锚点内容随文档重写易变，且不可离线判）。
#   - 允许清单 scripts/link-check.allow：把「已知且暂不修」的遗留**显式化**，
#     而不是静默放宽规则；每行 `<源文件相对路径> <链接目标>`，目标写 `*` 表示该文件
#     的全部悬空链接暂允。源文件路径相对仓根或相对产品目录书写均可（后缀匹配）。
#     清单里的每一行都必须带理由注释。
#   - 依赖仅 python3（标准库）；零外部依赖，可离线运行。
# =============================================================================
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ALLOW_FILE="${SCRIPT_DIR}/link-check.allow"

VERBOSE=0

usage() { sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --verbose) VERBOSE=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: 未知参数: $1（--help 查看用法）" >&2; exit 20 ;;
  esac
  shift
done

command -v python3 >/dev/null 2>&1 || { echo "ERROR: 缺少 python3" >&2; exit 20; }
cd "$REPO_ROOT" || { echo "ERROR: 无法进入仓库根目录: $REPO_ROOT" >&2; exit 20; }

python3 - "$REPO_ROOT" "$ALLOW_FILE" "$VERBOSE" <<'PY'
import os
import re
import sys

root, allow_path, verbose = sys.argv[1], sys.argv[2], sys.argv[3] == "1"

# 上游 clone 与 IDE / 工具数据不参与校验（前者只读、后者 gitignored）
EXCLUDE_DIRS = {".git", ".codebuddy", "ai-memory-mcp", "node_modules", ".venv", ".idea"}

# ── 允许清单：<源文件相对路径> -> {链接目标或 "*"} ──────────────────────────────
allow = {}
if os.path.isfile(allow_path):
    with open(allow_path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) >= 2:
                allow.setdefault(parts[0], set()).add(parts[1])
elif verbose:
    print("note: 无允许清单（%s）" % allow_path)

# Markdown 行内链接：兼容 [text](target)、[text](<target>)、[text](target "title")
LINK_RE = re.compile(r'\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)')
SCHEME_RE = re.compile(r'^[A-Za-z][A-Za-z0-9+.\-]*:')  # http/https/mailto/... 外部协议

def is_allowed(rel_src, target, path_part):
    """允许清单匹配：源文件路径既可用「相对仓根」也可用「相对产品目录」书写。

    后者（如 `specs/sprint-backlog.md`）是清单里的惯用写法，靠后缀匹配兼容，
    避免清单与脚本对「相对谁」的理解不一致导致豁免静默失效 —— 这正是本护栏要防的缺陷。
    """
    for key, tgts in allow.items():
        key = key.lstrip("./")
        if rel_src == key or rel_src.endswith("/" + key):
            if "*" in tgts or target in tgts or path_part in tgts:
                return True
    return False

md_files = []
for dirpath, dirnames, filenames in os.walk(root):
    dirnames[:] = [d for d in dirnames if d not in EXCLUDE_DIRS]
    for fn in filenames:
        if fn.endswith(".md"):
            md_files.append(os.path.join(dirpath, fn))
md_files.sort()

dangling = []
total_links = 0
per_file = {}

for path in md_files:
    rel_src = os.path.relpath(path, root)
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    except (UnicodeDecodeError, OSError):
        continue

    count = 0
    for lineno, line in enumerate(lines, 1):
        for match in LINK_RE.finditer(line):
            target = match.group(1)
            if not target or target.startswith("#"):
                continue
            if SCHEME_RE.match(target):
                continue
            path_part = target.split("#", 1)[0].split("?", 1)[0]
            if not path_part:
                continue

            count += 1
            total_links += 1

            base = root if path_part.startswith("/") else os.path.dirname(path)
            resolved = os.path.normpath(os.path.join(base, path_part.lstrip("/")))
            if os.path.exists(resolved):
                continue

            if is_allowed(rel_src, target, path_part):
                continue
            dangling.append((rel_src, lineno, target))

    if count:
        per_file[rel_src] = count

if verbose:
    for rel_src in sorted(per_file):
        print("  %-58s %d 个相对链接" % (rel_src, per_file[rel_src]))

print("已检：%d 个 Markdown 文件、%d 个相对链接" % (len(md_files), total_links))

if dangling:
    print("")
    print("悬空链接 %d 处（目标不存在）：" % len(dangling))
    for rel_src, lineno, target in dangling:
        print("  %s:%d: %s" % (rel_src, lineno, target))
    print("")
    print("修复方式二选一：改引用指向新文档，或在 scripts/link-check.allow 登记并写清理由。")
    sys.exit(10)

print("OK: 无悬空相对链接（允许清单豁免 %d 个文件）" % len(allow))
sys.exit(0)
PY

rc=$?
exit "$rc"
