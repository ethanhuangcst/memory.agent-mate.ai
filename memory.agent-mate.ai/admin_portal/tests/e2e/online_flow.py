"""在线端到端：经 cloudflared 隧道 + Cloudflare Access **Service Token**（验真链路）。

Service Token 由 Cloudflare 在边缘校验，通过后同样注入签名断言 ⇒ 门户侧无需专门代码，
本脚本只是把 `CF-Access-Client-Id` / `CF-Access-Client-Secret` 作为附加头带上。

凭证只从环境变量读取（**永不入仓**）：
  PORTAL_ACCESS_SERVICE_TOKEN_ID / PORTAL_ACCESS_SERVICE_TOKEN_SECRET
"""

from __future__ import annotations

import argparse
import os
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

from portal_flow import run_flow


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True, help="隧道公开地址（Access 保护的域名）")
    parser.add_argument("--email", default="service-token")
    args = parser.parse_args()

    client_id = os.environ.get("PORTAL_ACCESS_SERVICE_TOKEN_ID", "")
    client_secret = os.environ.get("PORTAL_ACCESS_SERVICE_TOKEN_SECRET", "")
    if not client_id or not client_secret:
        print("ERROR: 缺少 Access Service Token（PORTAL_ACCESS_SERVICE_TOKEN_ID/SECRET）", file=sys.stderr)
        return 2

    host = urlparse(args.base_url).hostname or ""
    if not host:
        print("ERROR: --base-url 无法解析主机名", file=sys.stderr)
        return 2

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(
            locale="en-US",
            extra_http_headers={
                "CF-Access-Client-Id": client_id,
                "CF-Access-Client-Secret": client_secret,
            },
        )
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))

        try:
            evidence = run_flow(page, args.base_url, args.email)
        except AssertionError as error:
            print(f"FAIL: {error}", file=sys.stderr)
            return 1
        finally:
            browser.close()

        if errors:
            print(f"FAIL: 页面出现 JS 错误：{errors[:3]}", file=sys.stderr)
            return 1

    print(f"OK: 在线端到端通过（真 Access 链路，handle={evidence.get('handle')}）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
