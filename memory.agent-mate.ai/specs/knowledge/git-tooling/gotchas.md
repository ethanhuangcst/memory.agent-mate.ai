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
  - guardrails
related_spec: memory.agent-mate.ai/specs/architecture.md
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

### 4. 护栏的「允许清单」会静默失效 —— 护栏必须自证豁免真的生效
- 场景：`link-check.sh` 的允许清单按「相对产品目录」书写（`specs/sprint_plan.md`），脚本却按「相对仓根」（`memory.agent-mate.ai/specs/sprint_plan.md`）匹配 → 键永不命中。
- 后果：**首次运行恰好无悬空**，脚本仍打印「豁免 4 个文件」→ 误以为护栏在工作；真出 74 处悬空时才暴露豁免从未生效。**护栏本身成了盲区**（与上一条「护栏静默漏报」同类）。
- 正确做法：① 清单键同时接受「相对仓根」与「相对产品目录」（后缀匹配），并在脚本注释写明；② **用负向样本验证护栏** —— 故意造一个悬空链接（或用一次真实的文档删除）确认它会被报出，而不是只看「通过」字样；③ 输出里区分「豁免命中数」与「清单条目数」，只有数字为 0 却又说「已豁免」就是信号。
- 教训（可推广）：**任何带豁免/白名单的守卫，都必须有自证机制**；否则它的「通过」不能作为证据。

## Links
- 护栏实现：`memory.agent-mate.ai/scripts/secret-check.sh` · 钩子：`memory.agent-mate.ai/scripts/git-hooks/pre-commit`
- 链接护栏：`memory.agent-mate.ai/scripts/link-check.sh` + `scripts/link-check.allow`（`make doc-links`）
- 决策：ADR-006（脱敏）· ADR-010（specs 结构与链接纪律）
