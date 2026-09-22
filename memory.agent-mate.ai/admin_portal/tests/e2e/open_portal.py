#!/usr/bin/env python3
"""打开一个**已认证**的门户浏览器窗口（本地开发专用）。

为什么需要它
------------
快速路径的身份是「手工放进浏览器的一次性自签 cookie」（由 `portal-dev.sh --dev-login` 产出）。
手工放 cookie 在真实浏览器里极易翻车：origin 写错（`localhost` 与 `127.0.0.1` 是**两个**主机）、
长串粘贴被截断、书签被拦、浏览器拒绝 cookie …… 每次都表现为「刷新后依然 Sign in required」，
而且**看不出错在哪**。

这个脚本用**同一个**既有测试通道，把 token 直接交给 Playwright 打开的真浏览器：

* 不新增任何认证通道 —— 仍然是仅回环 + `PORTAL_TEST_JWT_ENABLED=1`；
  生产环境启用该通道依旧被启动期拒绝（`src/config.ts`），与手工粘贴完全同一条路。
* 不修改服务端：走的就是浏览器导航 + `CF_Authorization` cookie 回落这条**生产路径**。

用法
----
    # 1) 先起服务（并产出令牌）
    bash scripts/portal-dev.sh --env-file admin_portal/.env.local --dev-login
    # 2) 开一个已认证的窗口（关掉窗口即结束）
    python3 admin_portal/tests/e2e/open_portal.py

退出码
------
    0   正常（窗口被关闭）
    30  前置缺失/令牌不可用
    40  Playwright 不可用（未安装）
"""

from __future__ import annotations

import argparse
import pathlib
import sys

PORTAL_DIR = pathlib.Path(__file__).resolve().parents[2]
DEFAULT_TOKEN = PORTAL_DIR / '.portal-data' / 'dev' / 'token'
DEFAULT_URL = 'http://127.0.0.1:8788/admin/users'
UNAUTH_MARKER = 'Sign in required'


def main() -> int:
    # 输出不缓冲：脚本常被重定向到日志后台运行，缓冲会让人「窗口开着但日志全白」，无法判断死活。
    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    except Exception:
        pass
    parser = argparse.ArgumentParser(description='打开已认证的门户窗口（本地开发）')
    parser.add_argument('--url', default=DEFAULT_URL, help=f'要打开的地址（默认 {DEFAULT_URL}）')
    parser.add_argument('--token-file', default=str(DEFAULT_TOKEN), help='自签令牌文件路径')
    args = parser.parse_args()

    token_path = pathlib.Path(args.token_file)
    if not token_path.is_file():
        print(f'找不到令牌文件：{token_path}', file=sys.stderr)
        print('请先运行：bash scripts/portal-dev.sh --env-file admin_portal/.env.local --dev-login', file=sys.stderr)
        return 30
    token = token_path.read_text(encoding='utf-8').strip()
    if not token:
        print(f'令牌文件为空：{token_path}', file=sys.stderr)
        return 30

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print('未安装 Playwright：pip install playwright && playwright install chromium', file=sys.stderr)
        return 40

    # cookie 的作用域是**主机**（不含端口），因此这里取主机名即可。
    host = args.url.split('://', 1)[-1].split('/', 1)[0].split(':', 1)[0]

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=False)
        context = browser.new_context()
        context.add_cookies(
            [{'name': 'CF_Authorization', 'value': token, 'domain': host, 'path': '/'}]
        )
        page = context.new_page()
        page.goto(args.url, wait_until='domcontentloaded')

        authed = UNAUTH_MARKER not in page.content()
        print(f'已打开      : {page.url}')
        print(f'页面标题    : {page.title()}')
        print(f'身份是否生效: {"是" if authed else "否（仍停在未认证页）"}')
        if not authed:
            print('若为「否」：服务是否用的是带 --dev-login 的那次启动？令牌是否过期（12 小时）？')
        print('关掉浏览器窗口即结束（或在本终端按 Ctrl+C）。')

        try:
            while len(context.pages) > 0:
                page.wait_for_timeout(500)
        except Exception:
            pass
        browser.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
