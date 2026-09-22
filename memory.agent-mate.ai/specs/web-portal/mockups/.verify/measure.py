"""UI 质量度量（一次性，与 verify.py 同期删除）。

度量四类客观问题，避免靠肉眼判断：
  1. 被容器裁切的内容（scrollWidth > clientWidth）——表格第三列「示例」看不到就是这一类；
  2. 表格列宽与容器宽度的关系（是否溢出到横向滚动）；
  3. 控件高度一致性（input / select / button / a.btn 实测高度）；
  4. 段落与单元格的实测行宽（字符数）与行数——用于判断「文字断行/宽度不合理」。

用法：python3 .verify/measure.py [--mobile]
"""
import functools
import os
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGES = [
    "01-instructions.html",
    "02-users.html",
    "03-user-detail.html",
    "04-audit.html",
    "05-capacity.html",
    "06-admin-mcp.html",
]

MOBILE = "--mobile" in sys.argv
VIEWPORT = {"width": 390, "height": 844} if MOBILE else {"width": 1440, "height": 1000}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


httpd = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=ROOT))
threading.Thread(target=httpd.serve_forever, daemon=True).start()
BASE = "http://127.0.0.1:" + str(httpd.server_address[1])

PROBE = """
() => {
  const out = {clipped: [], clippedText: [], tables: [], controls: [], narrow: []};
  const uniq = a => Array.from(new Set(a));

  // 1. 被裁切（横向溢出）的元素
  document.querySelectorAll('body *').forEach(el => {
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      const txt = (el.innerText || '').trim().slice(0, 24).replace(/\\s+/g, ' ');
      out.clipped.push(el.tagName.toLowerCase() + '.' + (el.className || '-') +
        ' [' + el.clientWidth + '<' + el.scrollWidth + '] ' + txt);
    }
  });
  // 1b. 表格单元格内容溢出（表格 scrollWidth 异常的主因）
  document.querySelectorAll('table th, table td').forEach(el => {
    if (el.scrollWidth > el.clientWidth + 1) {
      out.clipped.push('CELL ' + el.tagName.toLowerCase() +
        ' [' + el.clientWidth + '<' + el.scrollWidth + '] ' +
        (el.innerText || '').trim().slice(0, 28).replace(/\s+/g, ' '));
    }
  });
  out.clipped = uniq(out.clipped).slice(0, 14);

  // 2. 表格列宽 vs 容器
  document.querySelectorAll('table').forEach(t => {
    const ths = Array.from(t.querySelectorAll('thead th')).map(th => Math.round(th.getBoundingClientRect().width));
    const df = t.querySelector('tbody td');
    const wrap = t.closest('.table-wrap');
    const cols = df ? Math.round(df.getBoundingClientRect().width) : null;
    out.tables.push((t.className || t.tagName) + ' th=' + JSON.stringify(ths) +
      ' firstTd=' + cols + ' tableW=' + Math.round(t.getBoundingClientRect().width) +
      (wrap ? ' wrapW=' + wrap.clientWidth + ' wrapScroll=' + wrap.scrollWidth : ''));
  });

  // 3. 控件高度
  document.querySelectorAll('input, select, button, a.btn').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.height < 1) return;
    out.controls.push(el.tagName.toLowerCase() + '.' + (el.className || '-') +
      ' h=' + (Math.round(r.height * 10) / 10) + ' fs=' + getComputedStyle(el).fontSize);
  });
  out.controls = uniq(out.controls);

  // 4. 折叠/贴边的窄元素（文字断行问题的可疑点）
  document.querySelectorAll('main p, main td, main li, main h1, main h2, main h3, main dt, main dd').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.width < 90 && (el.innerText || '').trim().length > 12) {
      const txt = el.innerText.trim().slice(0, 20).replace(/\\s+/g, ' ');
      out.narrow.push(el.tagName.toLowerCase() + '.' + (el.className || '-') + ' w=' + Math.round(r.width) + ' ' + txt);
    }
  });
  out.narrow = uniq(out.narrow).slice(0, 12);

  // 5. 布局几何：侧栏 / 内容 / 首个表格 的 x 与宽（判断内容列是否居左留死白）
  const geo = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return Math.round(r.x) + ',' + Math.round(r.width);
  };
  out.layout = 'viewport=' + window.innerWidth +
    ' sidebar(x,w)=' + geo(document.querySelector('.sidebar')) +
    ' content(x,w)=' + geo(document.querySelector('.content, .guide-body, main')) +
    ' table(x,w)=' + geo(document.querySelector('table')) +
    ' rightGap=' + (document.querySelector('.content, main')
      ? Math.round(window.innerWidth - document.querySelector('.content, main').getBoundingClientRect().right) : null);
  // 6. 超出视口右缘的元素（窄屏横向溢出的责任人）
  out.overflowRight = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > window.innerWidth + 1) {
      out.overflowRight.push(el.tagName.toLowerCase() + '.' + (el.className || '-') +
        ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width));
    }
  });
  out.overflowRight = uniq(out.overflowRight).slice(0, 8);
  return out;
}
"""

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    all_controls = set()
    for name in PAGES:
        ctx = browser.new_context(viewport=VIEWPORT)
        page = ctx.new_page()
        page.goto(BASE + "/" + name)
        page.wait_for_load_state("networkidle")
        data = page.evaluate(PROBE)
        print("\n================ " + name + " (" + str(VIEWPORT["width"]) + "px) ================")
        print("-- 被裁切内容 --")
        for c in data["clipped"]:
            print("   " + c)
        if not data["clipped"]:
            print("   (无)")
        print("-- 表格 --")
        for t in data["tables"]:
            print("   " + t)
        if not data["tables"]:
            print("   (无)")
        print("-- 布局几何 --")
        print("   " + data["layout"])
        print("-- 超出视口右缘 --")
        for o in data["overflowRight"]:
            print("   " + o)
        if not data["overflowRight"]:
            print("   (无)")
        print("-- 过窄且文字多的元素 --")
        for n in data["narrow"]:
            print("   " + n)
        if not data["narrow"]:
            print("   (无)")
        all_controls.update(data["controls"])
        ctx.close()
    browser.close()

print("\n================ 控件高度汇总（全页去重） ================")
for c in sorted(all_controls):
    print("   " + c)
