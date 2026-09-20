---
title: git / bash 脱敏脚本踩坑记
type: ops-lesson
status: active
as_of: 2026-09-20
tags:
  - gitignore
  - bash
  - git-grep
  - secret-scanning
related_spec: memory.agent-mate.ai/specs/asset_isolation_plan.md
related:
  - adr/ADR-006-public-repo-ip-placeholder-deidentification.md
---

# git / bash 脱敏脚本踩坑记

## Summary
本次做「公开仓 IP 脱敏 + secret 扫描护栏」时连续踩了三个 git/bash 陷阱，导致首次验证误判为「已脱敏」、护栏漏报。记录如下，供后续写同类脚本复用。

## Evidence
实测于 macOS（zsh / bash），仓库 `memory.agent-mate.ai`。

## Lesson / guidance

### 1. `.gitignore` 行内注释会被并入忽略模式
- 错误写法：`secrets.local*   # 本机 secret 文件（永不入库）`
- 后果：gitignore 只有「以 `#` 开头的整行」才算注释；行尾 `#` 被当作**模式的一部分**，实际模式变成 `secrets.local*   # 本机 secret 文件…`，匹配不到文件名 → secret 文件未被忽略、`git status` 照常列出。
- 正确写法：注释单独成行。
  ```gitignore
  # 本机 secret 文件（永不入库）
  secrets.local*
  ```
- 验证：`git check-ignore -v memory.agent-mate.ai/secrets.local.hk_vps_4.md` 应输出 `.gitignore:N:secrets.local*`。

### 2. `python3 - <<'PY'` 与管道 `|` 争抢 stdin
- 错误写法：`printf '%s\n' "$RAW" | python3 - "$ARG" <<'PY' ... PY`
- 后果：here-doc `<<'PY'` 会**覆盖**管道的 stdin，python 把脚本读到 stdin 后，管道送来的 `$RAW` 丢失 → 脚本读到空输入 → 永远判「无公网 IP」，护栏静默漏报。
- 正确写法（三选一）：① RAW 走环境变量 `export RAW; python3 - "$ARG" <<'PY'`（脚本内 `os.environ["RAW"]`）；② RAW 写临时文件再 `python3 script.py`；③ `python3 -c '...'`（短脚本）。本次采用①。

### 3. `git grep`（工作树）与 `git grep --cached`（索引）不是一回事
- `git grep` 搜**工作树**已跟踪文件；`git grep --cached` 搜**索引（暂存区）**。
- 一个文件改了但没 `git add`，工作树已是脱敏版，但索引仍是旧版 → `git grep` 显示 0 命中、`git grep --cached` 仍显示旧 IP。验证「已脱敏」务必以 `git grep`（工作树 / 普通 `grep`）为准；护栏的 `--staged` 模式扫索引，会正确拦下尚未暂存的旧值。
- macOS `git grep` 不支持 `\b`（会静默返回 0）；用 `-E` 可移植写法，精确八位组判定交给 `python3` 标准库，并加 `(?<![\d.])` / `(?![\d.])` 边界避免在大数里误抽（如 `1.2.3.1234`）。

## Links
- 护栏实现：`memory.agent-mate.ai/scripts/secret-check.sh` · 钩子：`memory.agent-mate.ai/scripts/git-hooks/pre-commit`
- 决策：ADR-006
