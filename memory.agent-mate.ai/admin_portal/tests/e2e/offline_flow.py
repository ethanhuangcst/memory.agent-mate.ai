"""离线端到端：自签 JWT 经 `CF_Authorization` cookie 注入身份（零网络）。

为什么用 cookie 而不是请求头：真实浏览器无法给每个请求挂自定义头，而 Access 生产环境
本来就把断言放进 `CF_Authorization` cookie —— 用同一条路径测试，等于顺带验证了
「浏览器导航场景」的认证分支（§6.1）。

退出码：0 通过 | 1 断言失败 | 2 用法错误 | 3 前置不满足（缺 token / 服务未起）
"""

from __future__ import annotations

import argparse
import sys
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

from portal_flow import run_flow


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8788")
    parser.add_argument("--token", default="", help="自签 JWT（由 portal-e2e.sh 生成）")
    parser.add_argument("--email", default="admin@example.test")
    args = parser.parse_args()

    if not args.token:
        print("ERROR: 需要 --token（自签 JWT）", file=sys.stderr)
        return 2

    host = urlparse(args.base_url).hostname or "127.0.0.1"

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        # 显式设定语言：无头浏览器默认不发 Accept-Language，门户会回落到默认语言（zh-CN），
        # 断言文案就变成中文 —— 用 locale 固定语言，让断言稳定（四语言另有专门用例覆盖）。
        context = browser.new_context(locale="en-US")
        context.add_cookies(
            [
                {
                    "name": "CF_Authorization",
                    "value": args.token,
                    "domain": host,
                    "path": "/",
                    "httpOnly": True,
                }
            ]
        )
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)

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

    # 把实测宽度一起打出来：布局类问题只有数字能自证（「看起来没溢出」不算证据）
    print(
        "OK: 离线端到端通过"
        f"（handle={evidence.get('handle')} prefix={evidence.get('prefix')}"
        f" 轮换弹窗值列={evidence.get('rotate_value')}）"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
