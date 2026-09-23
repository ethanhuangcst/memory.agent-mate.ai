"""原型验收脚本（一次性，验收后删除）。

覆盖：7 页零控制台错误 · 零 404 · 单色令牌扫描 · 首页新结构（无 header / hero 入正文 /
浮动语言组 / 代码块复制 / 掩码令牌 / mcp.json 提示 / Cursor 示例 / Supported AI agents /
八项能力含示例 / 无 FAQ / 页脚左右顺序）· 四语言切换 · 用户页无 Manage admins ·
令牌表单含 Label · 审计筛选条与空态 · 容量只读声明 · 06 合并管理员说明且无增删控件 ·
窄屏无横向溢出与侧栏折叠 · 07 已删除。
"""
import functools
import io
import os
import threading
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shots")
os.makedirs(OUT, exist_ok=True)

PORT = 0


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def start_server():
    handler = functools.partial(QuietHandler, directory=ROOT)
    httpd = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


BASE = "http://127.0.0.1:" + str(start_server().server_address[1])

PAGES = [
    "01-instructions.html",
    "02-users.html",
    "03-user-detail.html",
    "04-audit.html",
    "05-capacity.html",
    "06-admin-mcp.html",
    "index.html",
    "08-signin.html",
    "09-dev-login.html",
]
BRAND = "memory.agent-mate.ai - AI Memory MCP"
MCP_URL = "https://memory.agent-mate.ai/mcp"

CSS_SCAN = """
() => {
  const bad = [];
  const allowed = ['rgb(139, 26, 26)', 'rgb(250, 246, 246)'];
  document.querySelectorAll('*').forEach(el => {
    const cs = getComputedStyle(el);
    ['color','backgroundColor','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','outlineColor'].forEach(p => {
      const v = cs[p];
      if (!v || v === 'rgba(0, 0, 0, 0)' || v === 'transparent' || v === 'none') return;
      if (allowed.indexOf(v) >= 0) return;
      const m = v.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (!m) return;
      const r = +m[1], g = +m[2], b = +m[3];
      if (r === g && g === b) return;
      bad.push(el.tagName.toLowerCase() + '.' + (el.className || '-') + ' ' + p + '=' + v);
    });
  });
  return Array.from(new Set(bad)).slice(0, 12);
}
"""

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ((" | " + str(detail)) if detail and not ok else ""))


def get_status(url):
    try:
        with urllib.request.urlopen(url) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    # ---------- 1. 全页巡检 ----------
    for page_name in PAGES:
        ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = ctx.new_page()
        console_errors, bad_responses = [], []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("response", lambda r: bad_responses.append(str(r.status) + " " + r.url) if r.status >= 400 else None)
        page.goto(BASE + "/" + page_name)
        page.wait_for_load_state("networkidle")

        real_console = [e for e in console_errors if "fonts.googleapis" not in e and "net::ERR" not in e]
        real_bad = [b for b in bad_responses if "fonts.g" not in b]
        check(page_name + " · 控制台无错误", not real_console, real_console)
        check(page_name + " · 无 404", not real_bad, real_bad)

        bad_colors = page.evaluate(CSS_SCAN)
        check(page_name + " · 单色令牌（无橙色）", not bad_colors, bad_colors)
        check(page_name + " · title 含品牌名", BRAND in page.title(), page.title())

        page.screenshot(path=os.path.join(OUT, page_name.replace(".html", "") + ".png"), full_page=True)
        ctx.close()

    check("07-admins.html 已删除（404）", get_status(BASE + "/07-admins.html") == 404)

    # ---------- 2. 首页结构与交互 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    page.goto(BASE + "/01-instructions.html")
    page.wait_for_load_state("networkidle")

    check("首页 · 无 page header", page.locator("header.app-header").count() == 0)
    check("首页 · 浮动语言组存在", page.locator(".shell-locale .locale-switch").count() == 1)
    labels = page.eval_on_selector_all(".shell-locale .locale-switch button", "els => els.map(e => e.textContent.trim())")
    check("首页 · 语言短标签 EN/简/港/台", labels == ["EN", "简", "港", "台"], labels)
    check("首页 · h1 为 AI Memory MCP", page.locator(".guide-hero h1").inner_text().strip() == "AI Memory MCP")
    check("首页 · hero 含 logo 图", page.locator(".guide-hero-title .logo-header-mark").count() == 1)
    for gone in ["#faq", "#key", "#config", ".guide-toc"]:
        check("首页 · 已移除 " + gone, page.locator(gone).count() == 0)

    check("首页 · 三步存在", page.locator("#setup .step").count() == 3)
    flex_dir = page.eval_on_selector("#setup .steps", "el => getComputedStyle(el).flexDirection")
    boxes = [page.locator("#setup .step").nth(i).bounding_box() for i in range(3)]
    same_x = len({round(b["x"]) for b in boxes}) == 1
    growing_y = boxes[0]["y"] < boxes[1]["y"] < boxes[2]["y"]
    check("首页 · 三步纵向", flex_dir == "column" and same_x and growing_y, {"flex": flex_dir})

    token_text = page.locator("#setup .step").first.locator(".token-mask").inner_text().strip()
    check("首页 · 令牌掩码形态", token_text == "memo_a1b2.....4o5p6", token_text)
    step1 = page.locator("#setup .step").first
    check("首页 · 第 1 步无代码块/无复制按钮",
          step1.locator(".codeblock, .codeblock-copy").count() == 0)

    step2 = page.locator("#setup .step").nth(1)
    check("首页 · 第 2 步有代码块 + 复制按钮", step2.locator(".codeblock-copy").count() == 1)
    check("首页 · 代码块标注 mcp.json", step2.locator(".codeblock-tag").inner_text().strip() == "mcp.json")
    copy_attr = step2.locator(".codeblock-copy").get_attribute("data-copy")
    check("首页 · 复制内容含 MCP 地址", MCP_URL in (copy_attr or ""), copy_attr)
    check("首页 · 正文含 MCP 地址", MCP_URL in step2.inner_text())
    check("首页 · 含 Cursor 指引", "Cursor" in step2.inner_text())

    page.hover(".contact-admin-trigger")
    page.wait_for_timeout(250)
    check("首页 · Contact Admin 悬浮窗可见", page.locator(".contact-admin-pop").is_visible())
    check("首页 · 二维码真实加载", page.eval_on_selector(".contact-admin-pop img", "el => el.complete && el.naturalWidth > 0"))
    check("首页 · 悬浮窗含邮箱", page.locator('.contact-admin-mail[href="mailto:me@ethanhuang.com"]').count() == 1)
    check("首页 · 聊天截图真实加载", page.eval_on_selector(".step-figure img", "el => el.complete && el.naturalWidth > 0"))

    roster = page.locator("#agents .agent-roster-row")
    check("首页 · Supported AI agents 共 7 项", roster.count() == 7, roster.count())
    icons_ok = page.eval_on_selector_all("#agents .agent-roster-icon", "els => els.every(e => e.complete && e.naturalWidth > 0)")
    check("首页 · agent 图标全部加载", icons_ok)

    cols = page.locator("#tools thead th").count()
    rows = page.locator("#tools tbody tr").count()
    check("首页 · 能力表 8 行 3 列（含示例）", cols == 3 and rows == 8, {"cols": cols, "rows": rows})
    check("首页 · 示例列有内容", len(page.locator("#tools tbody tr td:nth-child(3)").first.inner_text().strip()) > 5)
    examples = page.eval_on_selector_all("#tools tbody tr td:nth-child(3)", "els => els.map(e => e.textContent.trim().length)")
    check("首页 · 8 行示例列均非空", len(examples) == 8 and all(n > 5 for n in examples), examples)
    header3 = page.locator("#tools thead th").nth(2).inner_text().strip().lower()
    check("首页 · 第三列表头为 Example", header3 == "example", header3)
    check("首页 · 能力表可见（未被裁切）", page.locator("#tools .table-wrap").is_visible() and page.locator("#tools tbody tr").first.is_visible())
    # 补强：此前只用 is_visible() 断言，而溢出容器内的元素仍算「可见」⇒ 曾误判为绿。
    check("首页 · 能力表无横向溢出",
          page.eval_on_selector("#tools .table-wrap", "el => el.scrollWidth <= el.clientWidth + 1"),
          page.eval_on_selector("#tools .table-wrap", "el => el.scrollWidth + '>' + el.clientWidth"))
    check("首页 · 示例列在视口内",
          page.eval_on_selector("#tools tbody tr td:nth-child(3)", "el => el.getBoundingClientRect().right <= window.innerWidth + 1"),
          page.eval_on_selector("#tools tbody tr td:nth-child(3)", "el => Math.round(el.getBoundingClientRect().right)"))

    fbox = page.locator(".site-footer")
    link_box = fbox.locator("a").first.bounding_box()
    copy_box = fbox.locator("p").first.bounding_box()
    # issues.md 第三轮-2/3：入口链接在左、版权在右，同一行且整组右对齐；页脚固定
    check("首页 · 页脚入口在左、版权在右（同行）",
          link_box["x"] < copy_box["x"] and abs(link_box["y"] - copy_box["y"]) < 4,
          {"link": link_box, "copy": copy_box})
    check("首页 · 页脚整组右对齐", copy_box["x"] + copy_box["width"] > 1440 - 44, copy_box)
    check("首页 · 页脚固定在视口底部",
          page.eval_on_selector(".site-footer", "el => getComputedStyle(el).position") == "sticky")
    hero_logo = page.eval_on_selector(".guide-hero-title .logo-header-mark",
                                      "el => Math.round(el.getBoundingClientRect().height)")
    check("首页 · hero logo ×2（高 112px）", hero_logo == 112, hero_logo)

    page.goto(BASE + "/01-instructions.html?hover=contact")
    page.wait_for_load_state("networkidle")
    check("首页 · ?hover=contact 变体", page.locator(".contact-admin-pop").is_visible())
    ctx.close()

    # ---------- 3. 四语言切换 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    page.goto(BASE + "/01-instructions.html")
    page.wait_for_load_state("networkidle")
    expect = {"CN": "zh-CN", "HK": "zh-HK", "TW": "zh-TW", "EN": "en"}
    for loc, lang in expect.items():
        page.click('.shell-locale .locale-switch button[data-locale="' + loc + '"]')
        page.wait_for_timeout(120)
        got = page.eval_on_selector("html", "el => el.lang")
        body = page.locator("#setup > p").first.inner_text()
        check("四语言 · " + loc, got == lang and len(body.strip()) > 4, {"lang": got, "body": body})
    ctx.close()

    # ---------- 4. 用户页 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    page.goto(BASE + "/02-users.html")
    page.wait_for_load_state("networkidle")
    check("用户页 · 无 Manage admins", page.locator("text=Manage admins").count() == 0)
    check("用户页 · 无 07-admins 链接", page.locator('a[href="07-admins.html"]').count() == 0)
    check("用户页 · 仍有 Create user", page.locator(".page-head-actions .btn").count() == 1)
    # issues.md 02-2：取消搜索框、增加分页
    check("用户页 · 已取消搜索框", page.locator(".page-head-actions .input-box").count() == 0)
    pager = page.locator(".pager .pager-count").inner_text().strip()
    check("用户页 · 分页计数正确", pager == "Showing 1–3 of 3", pager)
    check("用户页 · 分页首末页按钮禁用",
          page.eval_on_selector_all(".pager .btn-text", "els => els.length === 2 && els.every(e => e.disabled)"))
    # issues.md 第三轮-4：管理面顶栏 logo ×3
    admin_logo = page.eval_on_selector(".app-header .logo-header-mark",
                                       "el => Math.round(el.getBoundingClientRect().height)")
    check("用户页 · 顶栏 logo ×3（高 72px）", admin_logo == 72, admin_logo)
    ctx.close()

    # ---------- 5. 用户详情：令牌表单 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    page.goto(BASE + "/03-user-detail.html?confirm=issue")
    page.wait_for_load_state("networkidle")
    dlg = page.locator("#dialog-issue")
    check("详情 · 签发对话框已打开", dlg.is_visible())
    check("详情 · 有 Label 输入框", dlg.locator("#issue-label").count() == 1)
    dlg_text = dlg.inner_text().lower()
    check("详情 · 含 Label 标签文案", "label" in dlg_text)
    check("详情 · 说明前缀由签发后生成", "generated after issuing" in dlg_text)
    ctx.close()

    # ---------- 6. 审计筛选 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    page.goto(BASE + "/04-audit.html")
    page.wait_for_load_state("networkidle")
    check("审计 · 筛选条有 3 个可见标签", page.locator(".filter-bar .field-label span").count() == 3)
    for lab in ["Event type", "Time range", "User"]:
        check("审计 · 标签 '" + lab + "'", page.locator(".filter-bar .field-label span", has_text=lab).count() == 1)
    check("审计 · 有 Filter 按钮", page.locator("[data-filter-apply]").count() == 1)
    check("审计 · 有命中数", "5" in page.locator(".filter-bar .row-end").inner_text())
    hs = page.eval_on_selector_all(".filter-bar .input-box, .filter-bar .btn",
                                   "els => Array.from(new Set(els.map(e => Math.round(e.getBoundingClientRect().height))))")
    check("审计 · 筛选控件等高", len(hs) == 1, hs)
    # issues.md 04-2：删除筛选说明文字
    check("审计 · 已删除筛选说明文字", "Press Filter" not in page.locator("main").inner_text())
    # issues.md 04-1：增加分页
    apager = page.locator(".pager .pager-count").inner_text().strip()
    check("审计 · 分页计数正确", apager == "Showing 1–5 of 5", apager)

    page.goto(BASE + "/04-audit.html?nomatch=1")
    page.wait_for_load_state("networkidle")
    check("审计 · ?nomatch=1 显示空态", page.locator("[data-audit-empty]").is_visible())
    check("审计 · ?nomatch=1 隐藏表格", not page.locator("[data-audit-table]").is_visible())
    ctx.close()

    # ---------- 7. 容量只读 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    page.goto(BASE + "/05-capacity.html")
    page.wait_for_load_state("networkidle")
    check("容量 · 明示只读", "Read only" in page.locator("main").inner_text())
    check("容量 · 无表单输入", page.locator("main input, main select").count() == 0)
    ctx.close()

    # ---------- 8. 06：合并管理员说明且无增删控件 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()
    page.goto(BASE + "/06-admin-mcp.html")
    page.wait_for_load_state("networkidle")
    main_text = page.locator("main").inner_text()
    check("06 · 含管理员登录说明", "How you sign in" in main_text)
    check("06 · 含多把钥匙自检", "Keep more than one key" in main_text)
    check("06 · 含兜底路径", "If you lose access" in main_text)
    check("06 · 含后台深链", page.locator('a[href^="https://one.dash.cloudflare.com"]').count() == 1)
    controls = page.locator("main button, main a")
    ctexts = [controls.nth(i).inner_text().lower() for i in range(controls.count())]
    bad = [t for t in ctexts if any(w in t for w in ["invite", "delete", "reset", "revoke", "remove"])]
    check("06 · 无邀请/删除/重设控件", not bad, bad)
    nav_items = page.locator(".sidebar .nav a")
    check("06 · 侧栏 4 项且无 Public page",
          nav_items.count() == 4 and "Public page" not in page.locator(".sidebar").inner_text(),
          nav_items.count())
    check("06 · 顶栏接入说明指向 01",
          page.locator('.header-guide[href="01-instructions.html"]').count() == 1)
    ctx.close()

    # ---------- 9. issues.md 批次 ----------
    ctx = browser.new_context(viewport={"width": 1440, "height": 1000})
    page = ctx.new_page()

    # 全文-1：代码块恢复参考稿的 8px 圆角（COPY 灰条因此带圆角右缘）
    page.goto(BASE + "/01-instructions.html")
    page.wait_for_load_state("networkidle")
    radius = page.eval_on_selector("#setup .codeblock", "el => getComputedStyle(el).borderTopLeftRadius")
    check("代码块圆角 8px（对齐参考稿）", radius == "8px", radius)

    # 全文-2 / 03-1 / 03-2：区块标题与上文有间距
    page.goto(BASE + "/03-user-detail.html")
    page.wait_for_load_state("networkidle")
    gaps = page.evaluate("""() => [...document.querySelectorAll('.section > h2')].map(h => {
      const prev = h.closest('.section').previousElementSibling;
      return prev ? Math.round(h.getBoundingClientRect().top - prev.getBoundingClientRect().bottom) : 999;
    })""")
    check("详情 · 区块标题与上文有间距", len(gaps) >= 3 and all(g >= 16 for g in gaps), gaps)

    # 03-3：注销用户（危险区 + 危险色填充按钮）
    check("详情 · 危险区存在（注销用户）",
          page.locator('button[data-open-dialog="dialog-deactivate"]').count() == 1)
    bg = page.eval_on_selector(".btn-danger", "el => getComputedStyle(el).backgroundColor")
    check("详情 · 危险按钮为危险红填充（此前无样式）", bg == "rgb(139, 26, 26)", bg)

    # issues.md 第二轮-1：内容列恢复左对齐且放宽（此前 `margin-inline:auto` 会取消
    # 网格项 stretch，把内容列从 x=200 推到 x=406，被感知为「变窄」）
    geo = page.evaluate("""() => {
      const c = document.querySelector('.content').getBoundingClientRect();
      const s = document.querySelector('.sidebar').getBoundingClientRect();
      return {left: Math.round(c.left), width: Math.round(c.width), sidebarRight: Math.round(s.right)};
    }""")
    check("布局 · 内容列紧贴侧栏（恢复左对齐）", abs(geo["left"] - geo["sidebarRight"]) <= 1, geo)
    check("布局 · 内容列已放宽（>1000px @1440）", geo["width"] > 1000, geo)

    # 02-1：对话框路径预览与动作按钮分行
    page.goto(BASE + "/02-users.html?confirm=new-user")
    page.wait_for_load_state("networkidle")
    dgap = page.evaluate("""() => Math.round(
      document.querySelector('#dialog-new-user .dialog-actions').getBoundingClientRect().top -
      document.querySelector('#dialog-new-user .dialog-path').getBoundingClientRect().bottom)""")
    check("用户页 · 对话框路径与按钮分行", dgap >= 20, dgap)

    # 05-1：参数调整说明（并检查说明文字不再「太靠右 / 断行」）
    page.goto(BASE + "/05-capacity.html")
    page.wait_for_load_state("networkidle")
    check("容量 · 含参数调整说明",
          page.locator(".how-to").count() == 1 and "Where to change" in page.locator("main").inner_text())
    for loc in ["CN", "HK", "TW", "EN"]:
        page.click('.app-header .locale-switch button[data-locale="' + loc + '"]')
        page.wait_for_timeout(120)
        info = page.evaluate("""() => {
          const dl = document.querySelector('.how-to');
          const x0 = dl.getBoundingClientRect().left;
          return [...dl.querySelectorAll('dd')].map(d => {
            const cs = getComputedStyle(d);
            const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
            return {offset: Math.round(d.getBoundingClientRect().left - x0),
                    lines: Math.round(d.getBoundingClientRect().height / lh)};
          });
        }""")
        # 起排偏移 = 标签列 7.5rem + gap 1rem；本项目根字号为 17px（非 16px），
        # 故 7.5rem×17 + 1rem×17 = 145px。收窄前为 168 + 20 = 188px。
        check("容量 · how-to 说明起排左移（" + loc + "）",
              info and all(i["offset"] <= 150 for i in info), info)
        check("容量 · how-to 说明不折行（" + loc + "）",
              info and all(i["lines"] <= 1 for i in info), info)

    # 06-1：Cloudflare 调整说明（用户确认「Claude flare」为 Cloudflare 笔误）
    page.goto(BASE + "/06-admin-mcp.html")
    page.wait_for_load_state("networkidle")
    t06 = page.locator("main").inner_text()
    check("06 · 含 Cloudflare 调整说明",
          "Cloudflare Zero Trust" in t06 and "console cap" in t06)
    # issues.md 第三轮-5：删除只读声明与占位符两处 callout
    check("06 · 已删除只读声明与占位符 callout",
          "Read only: no invite" not in t06 and "Placeholders only" not in t06)

    # issues.md 第四轮：管理面顶栏固定（与页脚一起构成固定外框，实测滚动后仍贴边）
    check("06 · 顶栏 position:sticky",
          page.eval_on_selector(".app-header", "el => getComputedStyle(el).position") == "sticky")
    page.evaluate("() => window.scrollTo(0, 900)")
    page.wait_for_timeout(250)
    hdr_top = page.eval_on_selector(".app-header", "el => Math.round(el.getBoundingClientRect().top)")
    check("06 · 滚动 900px 后顶栏仍贴顶", hdr_top == 0, hdr_top)
    ftr_bottom = page.eval_on_selector(".site-footer", "el => Math.round(el.getBoundingClientRect().bottom)")
    vh = page.evaluate("() => window.innerHeight")
    check("06 · 滚动后页脚仍贴底", abs(ftr_bottom - vh) <= 1, {"footerBottom": ftr_bottom, "viewport": vh})
    check("06 · 已移除 Claude 客户端配置段", "claude_desktop_config.json" not in t06)
    # issues.md 第二轮-2：管理员增删需要详细说明
    check("06 · 含管理员增删详细说明",
          "Add an admin" in t06 and "Remove an admin" in t06 and "No password" in t06)
    for loc in ["CN", "HK", "TW", "EN"]:
        page.click('.app-header .locale-switch button[data-locale="' + loc + '"]')
        page.wait_for_timeout(120)
        info = page.evaluate("""() => [...document.querySelectorAll('.how-to dd')].map(d => {
          const cs = getComputedStyle(d);
          const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
          return Math.round(d.getBoundingClientRect().height / lh);
        })""")
        check("06 · Cloudflare 说明不折行（" + loc + "）", info and all(n <= 1 for n in info), info)
    ctx.close()

    # ---------- 10. 窄屏 ----------
    ctx = browser.new_context(viewport={"width": 390, "height": 844})
    page = ctx.new_page()
    for name in ["01-instructions.html", "02-users.html", "04-audit.html", "06-admin-mcp.html"]:
        page.goto(BASE + "/" + name)
        page.wait_for_load_state("networkidle")
        overflow = page.evaluate("() => document.documentElement.scrollWidth - window.innerWidth")
        check(name + " · 窄屏无横向溢出", overflow <= 1, overflow)
        page.screenshot(path=os.path.join(OUT, "mobile-" + name.replace(".html", "") + ".png"), full_page=True)

    page.goto(BASE + "/02-users.html")
    page.wait_for_load_state("networkidle")
    sidebar = page.locator(".sidebar")
    check("窄屏 · 侧栏默认折叠", not sidebar.is_visible())
    check("窄屏 · 菜单按钮可见", page.locator(".menu-toggle").is_visible())
    page.click(".menu-toggle")
    page.wait_for_timeout(150)
    check("窄屏 · 点击后侧栏展开", sidebar.is_visible())
    ctx.close()

      # ---------- 12. 需要身份页 / 开发登录页 / 页脚贴底 / 侧栏会话区（2026-09-23）----------
    ctx = browser.new_context(viewport={"width": 1280, "height": 900})
    page = ctx.new_page()

    page.goto(BASE + "/08-signin.html?lang=CN")
    page.wait_for_load_state("networkidle")
    eyebrow = page.locator(".eyebrow").first.inner_text().strip()
    check("08 · eyebrow 为 ADMIN（Issue 9：不得再出现「尚未交付」）", eyebrow == "ADMIN", eyebrow)
    check("08 · 生产登录入口指向用户页", page.locator('a[data-auth-prod][href="02-users.html"]').count() == 1)
    check("08 · 生产态不显示开发入口", not page.locator("a[data-auth-dev]").is_visible())

    page.goto(BASE + "/08-signin.html?lang=CN&mode=dev")
    page.wait_for_load_state("networkidle")
    check("08 · 开发态显示开发登录入口", page.locator("a[data-auth-dev]").is_visible())
    check("08 · 开发态显示自诊断块", page.locator("[data-dev-diagnostics]").is_visible())

    page.goto(BASE + "/09-dev-login.html?lang=CN")
    page.wait_for_load_state("networkidle")
    check("09 · 默认态显示登录按钮", page.locator("[data-dev-login-form] button[type=submit]").is_visible())
    check("09 · eyebrow 为 ADMIN", page.locator(".eyebrow").first.inner_text().strip() == "ADMIN")

    page.goto(BASE + "/09-dev-login.html?lang=CN&mode=missing")
    page.wait_for_load_state("networkidle")
    check("09 · 缺 Token 态隐藏表单", not page.locator("[data-dev-login-form]").is_visible())
    check("09 · 缺 Token 态显示原因与提示", page.locator("[data-dev-login-missing]").is_visible())

    for name in ("08-signin.html", "01-instructions.html"):
        page.goto(BASE + "/" + name)
        page.wait_for_load_state("networkidle")
        m1 = page.evaluate("""() => {
          const f = document.querySelector('.site-footer').getBoundingClientRect();
          return { footerBottom: Math.round(f.bottom), viewport: window.innerHeight };
        }""")
        check("页脚贴底 · " + name, abs(m1["footerBottom"] - m1["viewport"]) <= 1, m1)
        page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
        page.wait_for_timeout(120)
        m2 = page.evaluate("""() => {
          const f = document.querySelector('.site-footer').getBoundingClientRect();
          const main = document.querySelector('main').getBoundingClientRect();
          return { footerTop: Math.round(f.top), mainBottom: Math.round(main.bottom) };
        }""")
        check("页脚不遮挡内容 · " + name, m2["mainBottom"] <= m2["footerTop"] + 1, m2)

    page.goto(BASE + "/02-users.html?lang=CN")
    page.wait_for_load_state("networkidle")
    check("会话区 · 侧栏存在会话区", page.locator(".nav-session").count() == 1)
    nav_count = page.locator(".nav a").count()
    check("会话区 · 导航目的地仍为 4 项", nav_count == 4, nav_count)
    check("会话区 · 登出按钮文案非空", len(page.locator(".nav-logout").inner_text().strip()) > 0)
    geo = page.evaluate("""() => {
      const nav = document.querySelector('.nav').getBoundingClientRect();
      const ses = document.querySelector('.nav-session').getBoundingClientRect();
      return { navBottom: Math.round(nav.bottom), sessionTop: Math.round(ses.top) };
    }""")
    check("会话区 · 位于导航之下", geo["sessionTop"] >= geo["navBottom"], geo)
    ctx.close()

    browser.close()

failed = [r for r in results if not r[1]]
print("\n==== 汇总 ====")
print("共 " + str(len(results)) + " 项，通过 " + str(len(results) - len(failed)) + "，失败 " + str(len(failed)))
for name, _, detail in failed:
    print("FAILED: " + name + " | " + str(detail))
raise SystemExit(1 if failed else 0)
