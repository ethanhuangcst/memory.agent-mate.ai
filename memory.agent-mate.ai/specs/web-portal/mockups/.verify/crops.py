"""局部截图（一次性，与 verify.py 同期删除）。

整页缩略图看不清细节（列宽、控件对齐、断行），这里把待评审区域单独裁出来。
用法：python3 .verify/crops.py
"""
import functools
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(OUT, exist_ok=True)

TARGETS = [
    ("01-instructions.html", 1440, ".guide-hero", "crop-hero.png"),
    ("01-instructions.html", 1440, ".site-footer", "crop-footer.png"),
    ("02-users.html", 1440, ".app-header", "crop-header.png"),
    ("06-admin-mcp.html", 1440, 'section:has(h2:text-is("If you lose access"))', "crop-06-admin.png"),
]

# (页面, 视口宽, 滚动位置, 输出名) —— 验证固定顶栏/页脚在滚动态下的表现
SCROLLS = [
    ("06-admin-mcp.html", 1440, 900, "scroll-06.png"),
    ("04-audit.html", 1440, 700, "scroll-04.png"),
]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=ROOT))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:" + str(httpd.server_address[1])

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for page_name, width, selector, out in TARGETS:
        ctx = browser.new_context(viewport={"width": width, "height": 1000}, device_scale_factor=2)
        page = ctx.new_page()
        page.goto(BASE + "/" + page_name)
        page.wait_for_load_state("networkidle")
        loc = page.locator(selector).first
        loc.screenshot(path=os.path.join(OUT, out))
        box = loc.bounding_box()
        print("OK " + out + " " + str(round(box["width"])) + "x" + str(round(box["height"])))
        ctx.close()
    # 滚动态：固定顶栏/页脚是否遮挡内容（整屏截图）
    for page_name, width, y, out in SCROLLS:
        ctx = browser.new_context(viewport={"width": width, "height": 900}, device_scale_factor=1)
        page = ctx.new_page()
        page.goto(BASE + "/" + page_name)
        page.wait_for_load_state("networkidle")
        page.evaluate("() => window.scrollTo(0, " + str(y) + ")")
        page.wait_for_timeout(250)
        page.screenshot(path=os.path.join(OUT, out))
        print("OK " + out + " scrollY=" + str(y))
        ctx.close()
    browser.close()
