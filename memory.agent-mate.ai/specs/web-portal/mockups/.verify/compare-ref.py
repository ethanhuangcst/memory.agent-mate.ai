"""参考稿 vs 本项目：同名组件并排裁图（一次性，与 verify.py 同期删除）。

用途：用户报告「某组件没用参考稿样式」时，先把参考页真渲染出来裁同一组件，
再与我们的实现对比，避免只读 CSS 猜测（两处 CSS 可能逐字相同、差异来自别处）。

用法：python3 .verify/compare-ref.py
"""
import functools
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
MOCKUPS = os.path.dirname(HERE)
ROOT = os.path.dirname(MOCKUPS)  # specs/web-portal：mockups 与 mockups-from-other-product 的同级父目录
OUT = os.path.join(HERE, "shots")
os.makedirs(OUT, exist_ok=True)

TARGETS = [
    ("mockups-from-other-product/13-instructions.html", ".setup-manual .codeblock--file", "ref-codeblock-file.png"),
    ("mockups-from-other-product/13-instructions.html", ".setup-card .codeblock", "ref-codeblock-plain.png"),
    ("mockups/01-instructions.html", "#setup .step:nth-child(2) .codeblock", "our-codeblock-file.png"),
    ("mockups/06-admin-mcp.html", ".codeblock", "our-codeblock-plain.png"),
]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=ROOT))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:" + str(httpd.server_address[1])

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for page_name, selector, out in TARGETS:
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000}, device_scale_factor=2)
        page = ctx.new_page()
        page.goto(BASE + "/" + page_name)
        page.wait_for_load_state("networkidle")
        loc = page.locator(selector).first
        if loc.count() == 0:
            print("MISS " + out + " <- " + selector)
        else:
            loc.screenshot(path=os.path.join(OUT, out))
            box = loc.bounding_box()
            print("OK   " + out + " " + str(round(box["width"])) + "x" + str(round(box["height"])))
        ctx.close()
    browser.close()
