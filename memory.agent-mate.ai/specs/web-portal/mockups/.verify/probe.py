"""计算样式探针（一次性，与 verify.py 同期删除）。

用法：python3 .verify/probe.py <页面> [视口宽] [选择器1|选择器2|...]

打印每个选择器的盒模型与关键计算样式（display / min-width / flex / white-space /
word-break / overflow-wrap / overflow-x / table-layout），用于定位布局与折行问题的真因，
避免靠读 CSS 猜测。
"""
import functools
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JS = """(sels) => sels.map(s => {
  const el = document.querySelector(s);
  if (!el) return s + ' :: 不存在';
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return s + ' :: x=' + Math.round(r.x) + ' w=' + Math.round(r.width) +
    ' h=' + Math.round(r.height) +
    ' display=' + cs.display +
    ' minW=' + cs.minWidth +
    ' flex=' + (cs.flexGrow + '/' + cs.flexShrink + '/' + cs.flexBasis) +
    ' ws=' + cs.whiteSpace +
    ' wb=' + cs.wordBreak +
    ' ow=' + cs.overflowWrap +
    ' ovX=' + cs.overflowX +
    ' gtc=' + cs.gridTemplateColumns +
    ' gt=' + cs.gridTemplateRows +
    ' tl=' + cs.tableLayout;
})"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=ROOT))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:" + str(httpd.server_address[1])

page_path = sys.argv[1]
width = int(sys.argv[2]) if len(sys.argv) > 2 else 1440
sels = sys.argv[3].split("|") if len(sys.argv) > 3 else []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_context(viewport={"width": width, "height": 900}).new_page()
    page.goto(BASE + "/" + page_path)
    page.wait_for_load_state("networkidle")
    print("### " + page_path + " @ " + str(width) + "px")
    for line in page.evaluate(JS, sels):
        print("  " + line)
    browser.close()
