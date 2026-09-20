#!/usr/bin/env python3
"""把 upstream-preflight.sh 的 --json 报告渲染成 GitHub Actions 输出与 issue 正文。

用法:
    render-preflight.py <report.json> <exit_code> <issue-body-out.md>

stdout 输出 GitHub Actions 的 `key=value` 行（供 `>> $GITHUB_OUTPUT` 消费）:
    action  none | unstable | ready | error
    tag     候选版本 tag（error 时为空）
    title   issue 标题（none / error 时为空）

为什么单独成文件（而不是内联在 workflow 的 heredoc 里）：
YAML 块标量会剥离缩进，而 Python 对缩进敏感 —— 内联 heredoc 极易踩
IndentationError；抽成文件后可本地直接跑、可单测。
"""
from __future__ import annotations

import json
import sys

RENDER_TITLE_LIMIT = 16


def emit(key: str, value: object) -> None:
    print("%s=%s" % (key, str(value).replace("\n", " ")))


def load_report(path: str) -> dict:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return {}


def build_lines(action: str, data: dict) -> list[str]:
    cand = data.get("candidate") or {}
    pinned = data.get("pinned") or {}
    tag = cand.get("tag") or "unknown"

    if action == "unstable":
        title = "[上游升级] ai-memory %s —— 该版本尚不稳定，不适合更新" % tag
    elif action == "ready":
        title = "[上游升级] ai-memory %s —— 可评估升级" % tag
    else:
        return []

    age = cand.get("age_days")
    age_text = ("%.1f" % age) if isinstance(age, (int, float)) else "?"

    lines = [
        "## %s" % title,
        "",
        "| 项 | 值 |",
        "| --- | --- |",
        "| 本部署所钉 | `%s`（IMAGE_TAG=%s，schema=%s） |"
        % (pinned.get("tag", "?"), pinned.get("image_tag", "?"), pinned.get("schema_version", "?")),
        "| 上游最新 | `%s`（发布 %s，沉淀 %s 天） |" % (tag, cand.get("published_at", "?"), age_text),
        "| 准入结论 | **%s** |" % data.get("message", "?"),
        "",
    ]

    def section(heading: str, items: list, symbol: str) -> None:
        if not items:
            return
        lines.append("### %s" % heading)
        lines.append("")
        for item in items:
            lines.append(
                "- %s **%s %s**：%s"
                % (symbol, item.get("id", ""), item.get("name", ""), item.get("detail", ""))
            )
        lines.append("")

    section("硬性阻断（必须满足）", data.get("hard_blocks") or [], "❌")
    section("人工确认项（逐条读）", data.get("warnings") or [], "⚠️")
    section("未判定项（需人工 / 服务器侧确认）", data.get("unknown") or [], "—")

    suggestion = data.get("suggestion")
    if suggestion:
        lines += ["### 建议", "", str(suggestion), ""]

    lines += [
        "---",
        "",
        "**本 issue 由 `.github/workflows/upstream-track.yml` 每日自动创建/更新。**",
        "升级决策与执行**始终人工**：详见 `hk_vps_4/specs/dev-plan.md` §5 ——",
        "先 `make preflight` 读准入结论，再按 §5.1 七步链路执行；回滚见 §5.6（快照覆盖不可省）。",
        "",
        "复现本地判定：`make preflight ARGS=--with-image`",
    ]
    return lines


def main() -> int:
    if len(sys.argv) != 4:
        print("用法: render-preflight.py <report.json> <exit_code> <issue-body-out.md>", file=sys.stderr)
        return 2

    report_path, rc, body_path = sys.argv[1], sys.argv[2], sys.argv[3]
    data = load_report(report_path)
    action = {"0": "none", "2": "unstable", "3": "ready"}.get(rc, "error")
    tag = ((data.get("candidate") or {}).get("tag")) or ""

    emit("action", action)
    emit("tag", tag)

    if action == "error":
        emit("title", "")
        print("预检脚本运行错误（exit %s），未生成 issue" % rc, file=sys.stderr)
        return 0

    if action == "none":
        emit("title", "")
        pinned = (data.get("pinned") or {}).get("tag", "?")
        print("上游无新版：所钉 %s 即最新 release" % pinned, file=sys.stderr)
        return 0

    lines = build_lines(action, data)
    body = "\n".join(lines) + "\n"
    with open(body_path, "w", encoding="utf-8") as fh:
        fh.write(body)

    emit("title", lines[0][3:])  # 去掉 "## " 前缀
    # 便于在 Actions 日志里直接看到结论
    print("\n".join(lines[:RENDER_TITLE_LIMIT]), file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
