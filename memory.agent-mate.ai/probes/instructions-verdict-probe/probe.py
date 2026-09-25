#!/usr/bin/env python3
"""3.20 接入说明判据可行性探针的执行体（研究类，不入制品）。

四个问题（Q1–Q4）见 probe.sh 头注释与 README.md。**每条判据都带灵敏度对照**：
判据若恒假或恒真，会在对照项上暴露。首轮跑出的三处判据缺陷（已在 v2 修正）见 README。
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright

RESULTS: list[tuple[str, bool, str]] = []

# 裸产品域名 = 品牌串（`AC6.11` 要求出现在标题与顶栏）⇒ **不算**「真实值泄漏」；
# 其**子域**与基础设施主机名（`nginx*` / `portainer*` / `*.maas.aliyuncs.com`）仍一律禁。
PRODUCT_DOMAIN_ALLOW = {"memory.agent-mate.ai"}

TOKEN_RE = re.compile(r"memo_[A-Za-z0-9_-]{20,}")
IP_RE = re.compile(r"\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b")
ALLOW_IP_PREFIX = ("127.", "0.", "10.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.",
                   "172.2", "172.30.", "172.31.", "255.")
TIERS = ("core", "graph", "admin", "smart", "power", "full")
# 取法 A：**限定语境**——只认「档位表格行」`| … `core` … | 8 |`，不认全文里的同形词
PROFILE_ROW_RE = re.compile(r"\|\s*(?:\*\*)?[^|`]*`(core|admin|graph|power|full)`[^|]*\|\s*\*{0,2}(\d{1,3})")


def check(qid: str, name: str, ok: bool, detail: str = "") -> None:
    RESULTS.append((qid, ok, detail))
    print(f"{'PASS' if ok else 'FAIL'} [{qid}] {name}" + (f" — {detail}" if detail else ""))


def info(msg: str) -> None:
    print(f"[i] {msg}")


# ---------------------------------------------------------------- Q1 / Q2：真浏览器判据
def judge_page(page, label: str) -> dict:
    """用**同一套判据**判一个页面（判据形状即 `#4.2` 落地后要挂的判据）。"""
    steps = page.locator("#setup .step")
    n = steps.count()
    obs: dict = {"label": label, "step_count": n}
    if n:
        obs["flex_direction"] = page.eval_on_selector(
            "#setup .steps", "el => getComputedStyle(el).flexDirection"
        )
        boxes = [steps.nth(i).bounding_box() for i in range(n)]
        if all(boxes):
            xs = [round(b["x"]) for b in boxes]
            ys = [round(b["y"]) for b in boxes]
            obs["same_x"] = len(set(xs)) == 1
            obs["growing_y"] = all(ys[i] < ys[i + 1] for i in range(len(ys) - 1))
        obs["step1_codeblocks"] = steps.nth(0).locator(".codeblock, .codeblock-copy").count()
        if n >= 2:
            obs["step2_copy"] = steps.nth(1).locator(".codeblock-copy").count()
    # `AC6.1` 的「进入 Admin 的入口」：门户用 i18n 键 `admin.entry` 渲染（原型实测：不是裸 <a href>）
    obs["admin_entry"] = page.locator(
        "[data-i18n='admin.entry'], .admin-entry, a[href*='/admin']"
    ).count()
    obs["admin_links_plain"] = page.locator("a[href^='/admin']").count()
    obs["h1"] = page.locator("h1").first.inner_text().strip() if page.locator("h1").count() else ""
    return obs


def browser_questions(base_url: str, prototype_url: str) -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page()
        page.goto(base_url, wait_until="load")
        impl = judge_page(page, "已实现门户 /")
        info(f"已实现页观测：{json.dumps(impl, ensure_ascii=False)}")
        page.goto(prototype_url, wait_until="load")
        proto = judge_page(page, "原型 01-instructions.html")
        info(f"原型观测：{json.dumps(proto, ensure_ascii=False)}")
        browser.close()

    check(
        "Q1",
        "「三步接入」判据可判别（正向样本 = 原型 3 步且纵向）",
        proto.get("step_count") == 3
        and proto.get("flex_direction") == "column"
        and proto.get("same_x") is True
        and proto.get("growing_y") is True,
        f"原型 step={proto.get('step_count')} flex={proto.get('flex_direction')} "
        f"same_x={proto.get('same_x')} growing_y={proto.get('growing_y')}",
    )
    check(
        "Q1",
        "灵敏度对照：同一判据在已实现页判为「未落地」（0 步 ⇒ 判据不是恒真）",
        impl.get("step_count") == 0,
        f"已实现页 step={impl.get('step_count')}",
    )
    check(
        "Q1",
        "落地后判据形状可复用：原型第 1 步无代码块、第 2 步有复制按钮",
        proto.get("step1_codeblocks") == 0 and proto.get("step2_copy") == 1,
        f"step1_codeblocks={proto.get('step1_codeblocks')} step2_copy={proto.get('step2_copy')}",
    )
    check(
        "Q2",
        "`AC6.1`「进入 Admin 的入口」在已实现页**没有实体**（与覆盖核对一致）",
        impl.get("admin_entry") == 0,
        f"已实现页 admin 入口元素数={impl.get('admin_entry')}",
    )
    check(
        "Q2",
        "灵敏度对照：同一判据在原型上判为「有实体」（判 `admin.entry` 键，不是裸 <a href>）",
        proto.get("admin_entry", 0) >= 1,
        f"原型 admin 入口元素数={proto.get('admin_entry')}"
        f"（裸 a[href=/admin]={proto.get('admin_links_plain')}）",
    )


# ---------------------------------------------------------------- Q3：占位符合规扫描规则
def real_hosts(repo_root: Path) -> list[str]:
    secrets = repo_root / "memory.agent-mate.ai/secrets.local.hk_vps_4.md"
    if not secrets.exists():
        return []
    hosts: set[str] = set()
    for m in re.finditer(r"\b([a-z0-9][a-z0-9.-]*\.(?:com|net|cn|ai|io|xyz|dev))\b", secrets.read_text("utf-8")):
        host = m.group(1)
        if host in PRODUCT_DOMAIN_ALLOW or host.endswith("aliyuncs.com") or host in ("example.com", "example.test"):
            continue
        hosts.add(host)
    return sorted(hosts)


def scan_targets(repo_root: Path) -> list[Path]:
    base = repo_root / "memory.agent-mate.ai"
    files: list[Path] = []
    files += sorted((base / "admin_portal/src/web/views").rglob("*.njk"))
    files += sorted((base / "admin_portal/src/web/i18n").glob("*.json"))
    files += sorted((base / "specs/web-portal").glob("*.md"))
    return [f for f in files if f.is_file()]


def hits_in(path: Path, hosts: list[str]) -> list[str]:
    text = path.read_text("utf-8", errors="ignore")
    found: list[str] = []
    for m in TOKEN_RE.finditer(text):
        found.append(f"真实令牌形态 `{m.group(0)[:18]}…`")
    for host in hosts:
        if host in text:
            found.append(f"基础设施主机名 `{host}`")
    for m in IP_RE.finditer(text):
        ip = m.group(0)
        if any(ip.startswith(p) for p in ALLOW_IP_PREFIX):
            continue
        found.append(f"公网 IP `{ip}`")
    return found


def static_questions(repo_root: Path) -> None:
    hosts = real_hosts(repo_root)
    info(f"从本机 secrets 提取的基础设施主机名（已排除品牌串 `{sorted(PRODUCT_DOMAIN_ALLOW)[0]}`）：{hosts if hosts else '（无）'}")
    targets = scan_targets(repo_root)
    info(f"扫描面：{len(targets)} 个文件（`views/*.njk` + `i18n/*.json` + `specs/web-portal/*.md`）")

    dirty: list[str] = []
    for f in targets:
        for h in hits_in(f, hosts):
            dirty.append(f"{f.relative_to(repo_root)} ⇒ {h}")
    check(
        "Q3",
        "现有制品上零命中（`AC6.5` 的占位符纪律目前在制品层成立）",
        not dirty,
        f"命中 {len(dirty)} 处" + ("；" + " / ".join(dirty[:3]) if dirty else ""),
    )

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td) / "injected.njk"
        host_control = hosts[0] if hosts else None
        injected = ["memo_AbCdEfGhIjKlMnOpQrSt1234", "203.0.113.99"]
        if host_control:
            injected.append(host_control)
        tmp.write_text("\n".join(injected), "utf-8")
        found = hits_in(tmp, hosts)
        check(
            "Q3",
            "灵敏度对照：注入真实令牌形态 ⇒ 规则命中",
            any("真实令牌形态" in h for h in found),
            f"命中 {len(found)} 处",
        )
        check(
            "Q3",
            f"灵敏度对照：注入基础设施主机名 ⇒ 规则命中（本轮{'有' if host_control else '无'}可注入值）",
            bool(host_control) and any("基础设施主机名" in h for h in found),
            f"注入值={host_control or '（本机无 secrets，跳过）'}",
        )
        check(
            "Q3",
            "灵敏度对照：注入公网 IP ⇒ 规则命中",
            any("公网 IP" in h for h in found),
            "注入值=203.0.113.99",
        )


# ---------------------------------------------------------------- Q4：档位 × 工具数的取法
def naive_tier_map(text: str) -> dict[str, int]:
    """反面样本：**全文**正则（不限定语境）——会被 `--tier smart` 这类同形词污染。"""
    out: dict[str, int] = {}
    for line in text.splitlines():
        for tier in TIERS:
            if tier not in out and re.search(rf"\b{tier}\b", line, re.I):
                m = re.search(r"(\d{1,3})", line)
                if m:
                    out[tier] = int(m.group(1))
    return out


def q4_questions(repo_root: Path) -> None:
    caps = repo_root / "memory.agent-mate.ai/specs/mcp/mcp-capabilities.md"
    design = repo_root / "memory.agent-mate.ai/specs/mcp/mcp-design.md"
    caps_text, design_text = caps.read_text("utf-8"), design.read_text("utf-8")

    authoritative = {m.group(1): int(m.group(2)) for m in PROFILE_ROW_RE.finditer(caps_text)}
    info(f"取法 A（**限定语境**：只认档位表格行）在 `mcp-capabilities.md` 上得：{authoritative}")
    check(
        "Q4",
        "`AC6.4` 的权威侧可机械取到：档位表 5 档 `core`/`admin`/`graph`/`power`/`full`",
        authoritative == {"core": 8, "admin": 22, "graph": 20, "power": 57, "full": 101},
        " · ".join(f"{k}={v}" for k, v in sorted(authoritative.items())) or "（未取到）",
    )

    naive = naive_tier_map(design_text)
    info(f"取法 B（**全文** regex，反面样本 `mcp-design.md`）得：{naive}")
    check(
        "Q4",
        "反面对照：全文取法**不可靠** —— `--tier smart` 与 `--profile core` 同形，取到噪声（含 `smart`）",
        "smart" in naive or len(naive) != 5,
        f"全文取法得 {len(naive)} 档：{naive}",
    )

    src_decl = "门户「接入指引」页面的**唯一内容源**"
    back_decl = "技术口径（档位定义、实测工具数、决议与理由）"
    check(
        "Q4",
        "比对两侧已由文档**双向定档**：`capabilities` = 页面唯一内容源；`capabilities` 的技术口径指回 `design` §8",
        src_decl in design_text and back_decl in caps_text,
        "命中 `mcp-design.md` 的唯一内容源声明 + `mcp-capabilities.md` 的技术口径回指",
    )

    tools_keys = [
        k for k in json.loads((repo_root / "memory.agent-mate.ai/admin_portal/src/web/i18n/en.json").read_text("utf-8"))
        if k.startswith("tools.")
    ]
    check(
        "Q4",
        "页面侧数据源（词表 `tools.*`）已就绪但**尚无模板引用** ⇒ 比对须在 `#4.2` 落地后挂到页面",
        len(tools_keys) > 0,
        f"`tools.*` 共 {len(tools_keys)} 键（能力文档权威侧 `core`=8 / `admin`=22）",
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--prototype", required=True)
    ap.add_argument("--repo-root", required=True)
    args = ap.parse_args()
    root = Path(args.repo_root)

    print("=== Q1/Q2：真浏览器判据（同一套判据判「已实现页」与「原型」）===")
    browser_questions(args.base_url, args.prototype)
    print("\n=== Q3：占位符合规扫描规则（现有制品 + 注入对照）===")
    static_questions(root)
    print("\n=== Q4：档位 × 工具数的取法与两侧定档 ===")
    q4_questions(root)

    failed = [r for r in RESULTS if not r[1]]
    print(f"\n通过 {len(RESULTS) - len(failed)} 项 · 失败 {len(failed)} 项")
    return 0


if __name__ == "__main__":
    sys.exit(main())
