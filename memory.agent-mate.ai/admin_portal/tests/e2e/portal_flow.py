"""门户管理面端到端流程（Playwright，同步 API）。

被两套入口复用：
  - `offline_flow.py`：自签 JWT 走 `CF_Authorization` cookie（零网络，覆盖页面与业务闭环）；
  - `online_flow.py`：经 cloudflared 隧道 + Cloudflare Access **Service Token**（验真链路）。

断言口径与 `tests/integration/pages.test.ts` 一致，但这里是**真实浏览器**：
渲染、表单提交、303 跳转、四语言切换都按用户实际操作路径验证。

另含**布局护栏**（`assert_no_overflow`）：把「元素是否溢出容器」变成机器可判定的断言。
"""

from __future__ import annotations

import re
import time
from pathlib import Path

from playwright.sync_api import Page, expect

TOKEN_PATTERN = re.compile(r"memo_[A-Za-z0-9_-]{43}")
PREFIX_PATTERN = re.compile(r"memo_[A-Za-z0-9_-]{8}")

ARTIFACTS = Path(__file__).parent / "artifacts"

# 断言口径：这些选择器里的任何元素都不得溢出自己的容器。
# 为什么必须有这条护栏：CSS 规则可以自相矛盾而「看起来收口了」——肉眼看不出
# 「82px 的列放不下 112px 的串」，何况下划线不产生断行点，长串只会直接撑出边框。
# 已经吃过两次教训（Issue 3 长路径、轮换弹窗里 `memo_XXXXXXXX` 撑出边框），
# 两次都是人眼发现的 ⇒ 改为量出来的宽度说话。
OVERFLOW_SELECTORS = (
    ".dialog-title",
    ".dialog-body",
    ".dialog-target",
    ".key-meta",
    ".key-meta-label",
    ".key-meta-value",
    # 详情页键值面板与之同类（长路径/长标识），一并纳入，避免只守住弹窗这一处。
    ".kv",
    ".kv dt",
    ".kv dd",
    ".field-note",
    ".error-inline",
    ".path",
    ".codeblock-text",
    "#issued-token",
    ".btn",
    # 公开接入说明页（#4.2）：长串现场 = 掩码令牌、占位符 URL 与名册
    # 注意 **不要**把 `.guide-caps-table` 放进本清单：它位于 `.table-wrap{overflow-x:auto}` 内，
    # 「表格比容器宽」是**设计意图**（窄屏横向滚动），放进来会必然假红（实测踩到一次）。
    ".token-mask",
    ".step-url code",
    ".agent-roster-row",
    ".contact-admin-mail",
)

# 弹窗宽度固定（22rem），与视口无关 ⇒ 宽视口下也必须查一遍；
# 另跑一次窄视口，覆盖媒体查询把键值表转单列后的表现。
VIEWPORTS = ((1280, 900), (720, 900))


def _shot(page: Page, name: str) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(ARTIFACTS / f"{name}.png"), full_page=True)


def assert_no_overflow(page: Page, where: str) -> None:
    """元素自身溢出（scrollWidth）或超出父容器右边界 ⇒ 断言失败，并报出具体数字。"""
    page_overflow = page.evaluate(
        "() => document.documentElement.scrollWidth - document.documentElement.clientWidth"
    )
    assert page_overflow <= 1, f"{where}：页面出现横向滚动，超出 {page_overflow}px"

    offenders = page.evaluate(
        """
        (selectors) => {
          const bad = [];
          const hasBox = (node) => {
            if (!node) return false;
            const r = node.getBoundingClientRect();
            return r.width !== 0 || r.height !== 0;
          };
          for (const sel of selectors) {
            for (const el of document.querySelectorAll(sel)) {
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) continue;   // 隐藏/无盒元素不参与
              // 向上找**第一个真正有盒的祖先**再比右边界：`display: contents` 的包装元素
              // 没有任何盒（矩形全为 0），直接拿它比较会把每个子项都判成溢出（假阳性）。
              let anchor = el.parentElement;
              while (anchor && !hasBox(anchor)) anchor = anchor.parentElement;
              const anchorRight = anchor ? anchor.getBoundingClientRect().right : Infinity;
              if (el.scrollWidth > el.clientWidth + 1 || rect.right > anchorRight + 1) {
                bad.push({
                  sel,
                  text: (el.textContent || '').trim().slice(0, 30),
                  scrollWidth: el.scrollWidth,
                  clientWidth: el.clientWidth,
                  right: Math.round(rect.right),
                  parentRight: Math.round(anchorRight),
                });
              }
            }
          }
          return bad;
        }
        """,
        list(OVERFLOW_SELECTORS),
    )
    assert not offenders, f"{where}：元素溢出容器 {offenders}"


def assert_status_single_line(page: Page, where: str) -> None:
    """状态标签必须是单行。

    为什么需要：用户列表的「状态」列在表格 auto 布局下只剩约 57px（「库路径」列吃掉
    635px），而「已吊销」需要 49 + 状态点 7 + 间距约 7.65 ≈ 64px ⇒ 中文默认允许任意字符间
    断行，于是被挤成「已吊 / 销」两行（2026-09-23 由用户截图发现；实测 h=50 / line-height=25.2）。
    样式侧已用 `white-space: nowrap` 修掉，这里加断言防回归 —— 布局类缺陷只靠肉眼发现
    一次就够了（Issue 8 与本案同一教训）。
    """
    too_tall = page.evaluate(
        """() => {
          const bad = [];
          for (const el of document.querySelectorAll('.status')) {
            const cs = getComputedStyle(el);
            const lh = cs.lineHeight === 'normal' ? parseFloat(cs.fontSize) * 1.2 : parseFloat(cs.lineHeight);
            const h = el.getBoundingClientRect().height;
            if (h > lh * 1.5) {
              bad.push({ text: (el.textContent || '').trim(), height: Math.round(h), lineHeight: Math.round(lh) });
            }
          }
          return bad;
        }"""
    )
    assert not too_tall, f"{where}：状态标签折行了（应为单行）{too_tall}"


def _value_metrics(page: Page, selector: str) -> dict[str, int]:
    """量「文本实际宽度 / 盒子可用宽度」，写进证据（数字比「看起来没溢出」可信）。"""
    return page.evaluate(
        """
        (sel) => {
          const el = document.querySelector(sel);
          if (!el) return { box: 0, scroll: 0, text: 0 };
          const range = document.createRange();
          range.selectNodeContents(el);
          return {
            box: Math.round(el.clientWidth),
            scroll: Math.round(el.scrollWidth),
            text: Math.round(range.getBoundingClientRect().width),
          };
        }
        """,
        selector,
    )


def _assert_all_viewports(page: Page, where: str) -> None:
    """同一屏（对话框打开状态下）在多个视口各量一次 —— 弹窗宽度与视口无关，所以两者都要查。"""
    original = page.viewport_size or {"width": 1280, "height": 900}
    try:
        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            assert_no_overflow(page, f"{where}（视口 {width}）")
    finally:
        page.set_viewport_size(original)


def assert_footer_pinned(page: Page, where: str) -> None:
    """页脚贴底（2026-09-23 用户要求：所有页面）。

    为什么要**量**而不是读 CSS：这是「内容不足一屏」才暴露的问题 ——
    `min-height: 100vh` 加一栏 `flex: 1` 只是规则，不能证明某个页面真的贴底。
    同 Issue 8 的教训：只有量出来的矩形作数。
    两个条件：① 未滚动时页脚底边 = 视口底边（贴底）；② 滚到底时内容底边不越过页脚顶边（不遮挡）。
    """
    top = page.evaluate(
        """() => {
          const f = document.querySelector('.site-footer').getBoundingClientRect();
          return { footerBottom: Math.round(f.bottom), innerH: window.innerHeight };
        }"""
    )
    assert abs(top["footerBottom"] - top["innerH"]) <= 1, (
        f"{where}：未滚动时页脚未贴底（页脚底 {top['footerBottom']}px / 视口 {top['innerH']}px）"
    )
    page.evaluate("window.scrollTo(0, document.documentElement.scrollHeight)")
    page.wait_for_timeout(120)
    bottom = page.evaluate(
        """() => {
          const f = document.querySelector('.site-footer').getBoundingClientRect();
          const main = document.querySelector('main').getBoundingClientRect();
          return { footerTop: Math.round(f.top), mainBottom: Math.round(main.bottom) };
        }"""
    )
    assert bottom["mainBottom"] <= bottom["footerTop"] + 1, (
        f"{where}：滚到底时内容被页脚遮挡（内容底 {bottom['mainBottom']}px / 页脚顶 {bottom['footerTop']}px）"
    )
    page.evaluate("window.scrollTo(0, 0)")


def run_flow(page: Page, base_url: str, admin_email: str) -> dict[str, str]:
    """跑通「建用户 → 签发 → 列出 → 轮换 → 吊销 → 停用」并返回关键证据。"""
    evidence: dict[str, str] = {}
    handle = f"e2e{int(time.time()) % 100000}"
    page.set_viewport_size({"width": 1280, "height": 900})

    # ---- 1. 用户列表（空态或已有数据都可）----
    page.goto(f"{base_url}/admin/users", wait_until="networkidle")
    expect(page.locator(".app-header")).to_contain_text(admin_email)
    expect(page.locator("nav.nav a")).to_have_count(4)
    assert_no_overflow(page, "用户列表")
    assert_status_single_line(page, "用户列表")
    assert_footer_pinned(page, "用户列表")
    _shot(page, "01-users-list")

    # ---- 2. 建用户（对话框 → 提交 → 303 到详情页）----
    page.goto(f"{base_url}/admin/users?new=1", wait_until="networkidle")
    dialog = page.locator("#dialog-new-user")
    expect(dialog).to_be_visible()
    dialog.locator("#new-handle").fill(handle)
    _assert_all_viewports(page, "新建用户弹窗")
    _shot(page, "02-dialog-new-user")
    dialog.get_by_role("button", name=re.compile("Create user", re.I)).click()
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile(rf"/admin/users/{handle}$"))
    expect(page.locator("h1")).to_have_text(handle)
    evidence["handle"] = handle
    _shot(page, "03-user-detail")

    # ---- 3. 签发令牌（明文只出现一次）----
    page.goto(f"{base_url}/admin/users/{handle}?dialog=issue", wait_until="networkidle")
    issue_dialog = page.locator("#dialog-issue")
    expect(issue_dialog).to_be_visible()
    issue_dialog.locator("#issue-label").fill("E2E laptop")
    _assert_all_viewports(page, "签发令牌弹窗")
    _shot(page, "04-dialog-issue")
    issue_dialog.get_by_role("button", name=re.compile("^Issue$", re.I)).click()
    page.wait_for_load_state("networkidle")

    body = page.content()
    plaintexts = TOKEN_PATTERN.findall(body)
    assert len(plaintexts) == 1, f"明文应只出现一次，实际 {len(plaintexts)} 次"
    plaintext = plaintexts[0]
    prefix = plaintext[:13]
    evidence["prefix"] = prefix
    expect(page.locator("#issued-token")).to_have_text(plaintext)
    expect(page.get_by_text("E2E laptop")).to_be_visible()
    assert_no_overflow(page, "详情页（明文面板）")
    assert_footer_pinned(page, "详情页（明文面板）")
    _shot(page, "05-token-issued-once")

    # ---- 4. 刷新后明文不再出现（AC2.1 / AC2.2）----
    page.reload(wait_until="networkidle")
    after_reload = page.content()
    assert plaintext not in after_reload, "刷新后仍能取回明文"
    assert prefix in after_reload, "列表应显示前缀"
    evidence["prefix_visible_after_reload"] = "yes"
    _shot(page, "06-token-list-no-plaintext")

    # ---- 5. 轮换：旧前缀失效、新明文一次 ----
    page.goto(f"{base_url}/admin/users/{handle}?dialog=rotate&prefix={prefix}", wait_until="networkidle")
    rotate_dialog = page.locator("#dialog-rotate")
    expect(rotate_dialog).to_be_visible()
    expect(rotate_dialog).to_contain_text(prefix)
    # 这一处就是「memo_XXXXXXXX 撑出边框」的现场：值列窄、串又无处可断。
    metrics = _value_metrics(page, "#dialog-rotate .dialog-target .key-meta:last-of-type .key-meta-value")
    evidence["rotate_value"] = f"文本 {metrics['text']}px / 盒子 {metrics['box']}px / 内容 {metrics['scroll']}px"
    # 宽度本身是**设计要求**（2026-09-22：22rem → 33rem，+50%），锚住它免得被后续改动悄悄改回去。
    # 断言按**根字号换算**，不写死像素 —— 本项目 1rem = 17px（不是默认 16px），
    # 写死 528px 会得到一次假失败（实测 561px）。容差 ±2px 覆盖边框。
    dialog_metrics = page.evaluate(
        """() => {
          const el = document.querySelector('#dialog-rotate .dialog');
          const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
          return { width: el.getBoundingClientRect().width, rem: root };
        }"""
    )
    expected_width = 33 * dialog_metrics["rem"]
    evidence["dialog_width"] = (
        f"{round(dialog_metrics['width'])}px（1rem={dialog_metrics['rem']}px，预期 {round(expected_width)}px）"
    )
    assert abs(dialog_metrics["width"] - expected_width) <= 2, (
        f"弹窗宽度应为 33rem（1rem={dialog_metrics['rem']}px ⇒ {round(expected_width)}px），"
        f"实际 {round(dialog_metrics['width'])}px"
    )
    # 目标块版式：两个字段**并排**、标签在值上方、且第二字段真的用上右半边
    # （2026-09-23 重新设计前的形态是「标签全在左列、值全挤在左半边、右侧死白」，
    #   这两条断言当时都会失败，所以它们是有效的守护，而不是写真）。几何断言的意义：
    #   让「好看」里可量化的那部分也有回归防护。
    field_geo = page.evaluate(
        """() => {
          const box = document.querySelector('#dialog-rotate .dialog-target');
          const boxRect = box.getBoundingClientRect();
          const rects = (sel) => [...box.querySelectorAll(sel)].map((el) => el.getBoundingClientRect());
          const labels = rects('.key-meta-label');
          const values = rects('.key-meta-value');
          return {
            boxWidth: boxRect.width,
            labelTops: labels.map((r) => Math.round(r.top)),
            labelLefts: labels.map((r) => Math.round(r.left)),
            valueTops: values.map((r) => Math.round(r.top)),
          };
        }"""
    )
    assert len(field_geo["labelTops"]) == 2, f"轮换弹窗应有 2 个字段，实际 {len(field_geo['labelTops'])}"
    assert field_geo["labelTops"][0] == field_geo["labelTops"][1], f"两个标签应在同一行（字段并排）：{field_geo}"
    assert field_geo["valueTops"][0] == field_geo["valueTops"][1], f"两个值应在同一行：{field_geo}"
    assert field_geo["valueTops"][0] > field_geo["labelTops"][0], f"标签应在值上方：{field_geo}"
    spacing = field_geo["labelLefts"][1] - field_geo["labelLefts"][0]
    assert spacing >= field_geo["boxWidth"] * 0.3, (
        f"两个字段应分占两列（宽度被用上，而非挤在左半边）：左边界 {field_geo['labelLefts']}，"
        f"容器宽 {round(field_geo['boxWidth'])}px"
    )
    evidence["target_layout"] = f"字段间距 {round(spacing)}px / 容器 {round(field_geo['boxWidth'])}px"
    _assert_all_viewports(page, "轮换弹窗")
    _shot(page, "07-dialog-rotate")
    rotate_dialog.get_by_role("button", name=re.compile("^Rotate$", re.I)).click()
    page.wait_for_load_state("networkidle")

    rotated = TOKEN_PATTERN.findall(page.content())
    assert len(rotated) == 1, "轮换后应出现一次新明文"
    rotated_plaintext = rotated[0]
    evidence["rotated"] = "yes"
    _shot(page, "08-token-rotated")

    # ---- 6. 吊销：行保留、动作入口消失、明文不可取回 ----
    revoke_dialog_page = page.goto(
        f"{base_url}/admin/users/{handle}?dialog=revoke&prefix={rotated_plaintext[:13]}",
        wait_until="networkidle",
    )
    assert revoke_dialog_page is not None
    revoke_dialog = page.locator("#dialog-revoke")
    expect(revoke_dialog).to_be_visible()
    _assert_all_viewports(page, "吊销弹窗")
    revoke_dialog.get_by_role("button", name=re.compile("^Revoke$", re.I)).click()
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile(rf"/admin/users/{handle}$"))

    page.goto(f"{base_url}/admin/users/{handle}", wait_until="networkidle")
    assert rotated_plaintext not in page.content(), "吊销后仍出现明文"
    expect(page.locator("table")).to_contain_text(rotated_plaintext[:13])
    assert_no_overflow(page, "详情页（已吊销）")
    _shot(page, "09-token-revoked")

    # ---- 7. 停用用户（可逆软操作 D13）----
    page.goto(f"{base_url}/admin/users/{handle}?dialog=deactivate", wait_until="networkidle")
    deactivate_dialog = page.locator("#dialog-deactivate")
    expect(deactivate_dialog).to_be_visible()
    expect(deactivate_dialog).to_contain_text(handle)
    _assert_all_viewports(page, "停用用户弹窗")
    _shot(page, "10-dialog-deactivate")
    deactivate_dialog.get_by_role("button", name=re.compile("^Deactivate$", re.I)).click()
    page.wait_for_load_state("networkidle")
    expect(page.locator(".status.is-off").first).to_be_visible()
    expect(page.locator("a[href*='dialog=deactivate']")).to_have_count(0)
    # 停用后应改为「恢复访问」入口（D13 可逆侧，独立动作）
    restore_entry = page.locator("a[href*='dialog=restore']")
    expect(restore_entry.first).to_be_visible()
    _assert_all_viewports(page, "停用后的详情页")
    _shot(page, "11-user-deactivated")

    # ---- 8. 四语言切换（记得住）----
    page.goto(f"{base_url}/admin/users?lang=zh-TW", wait_until="networkidle")
    expect(page.locator("nav.nav")).to_contain_text("使用者")
    page.goto(f"{base_url}/admin/users", wait_until="networkidle")
    expect(page.locator("nav.nav")).to_contain_text("使用者")
    _shot(page, "12-locale-zh-tw")

    # ---- 9. 占位页（导航齐全、显式未交付）----
    # 上一步已把语言切到中文（cookie 持久），这里显式指定英文再断言英文文案
    page.goto(f"{base_url}/admin/audit?lang=en", wait_until="networkidle")
    expect(page.locator(".content")).to_contain_text("NOT DELIVERED YET")
    assert_footer_pinned(page, "占位页（内容不足一屏）")
    _shot(page, "13-placeholder-audit")

    # ---- 10. 面隔离：管理域名上不应有 /mcp ----
    response = page.request.get(f"{base_url}/mcp")
    assert response.status == 403, f"管理域名上的 /mcp 应为 403，实际 {response.status}"

    # ---- 11. 公开接入说明页（Sprint 4 `#4.2` / 故事 S6）----
    # 判据形状由 `3.20` 探针定档（memory.agent-mate.ai/probes/instructions-verdict-probe/README.md）：
    # 三步 = `#setup .step` ×3 且纵向；Admin 入口判**元素存在**（不是裸 `<a href>`）；示例只用占位符。
    page.goto(f"{base_url}/?lang=en", wait_until="networkidle")
    steps = page.locator("#setup .step")
    expect(steps).to_have_count(3)
    flex_dir = page.eval_on_selector("#setup .steps", "el => getComputedStyle(el).flexDirection")
    boxes = [steps.nth(i).bounding_box() for i in range(3)]
    assert all(boxes), "三步应各有盒子（缺盒说明结构或样式没落地）"
    same_x = len({round(b["x"]) for b in boxes}) == 1
    growing_y = all(boxes[i]["y"] < boxes[i + 1]["y"] for i in range(2))
    assert flex_dir == "column" and same_x and growing_y, (
        f"三步接入应纵向排列：flex={flex_dir} same_x={same_x} growing_y={growing_y}"
    )
    assert page.locator("#setup .step-num").all_inner_texts() == ["01", "02", "03"]
    expect(page.locator("a[href='/admin/users']").first).to_be_visible()
    expect(page.locator("h1")).to_have_text("AI Memory MCP")

    # 第 1 步：悬停 / 聚焦显示悬浮层（二维码真实加载 + 邮箱可达），焦点离开后收起
    trigger = page.locator(".contact-admin-trigger")
    pop = page.locator(".contact-admin-pop")
    trigger.hover()
    expect(pop).to_be_visible()
    assert page.eval_on_selector(
        ".contact-admin-pop img", "el => el.complete && el.naturalWidth > 0"
    ), "微信二维码应真实加载（不是破图）"
    expect(page.locator(".contact-admin-mail")).to_have_attribute("href", re.compile(r"^mailto:"))
    trigger.focus()
    expect(pop).to_be_visible()
    # 「键盘可收起」= 焦点离开即收起（实现是 CSS `:focus-within`，与原型同构）。
    # 两处细节都是实测踩到的：① Tab 会把焦点移进悬浮层内的邮箱链接 ⇒ 仍可见，须真正移出焦点；
    # ② Playwright 的鼠标会**停在**触发器上（`:hover` 持续命中）⇒ 断言前必须把鼠标移开。
    page.evaluate("() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); }")
    page.mouse.move(0, 0)
    expect(pop).to_be_hidden()

    # 第 2 步：配置块用占位符，复制按钮按选择器指向同一节点
    expect(page.locator("#step2-config")).to_contain_text("{MCP_HOST}")
    assert page.locator("button.codeblock-copy").first.get_attribute("data-copy") == "#step2-config"

    # 第 3 步：示例图真实加载
    assert page.eval_on_selector(
        ".step-figure img", "el => el.complete && el.naturalWidth > 0"
    ), "第 3 步示例图应真实加载"

    # 名册与能力表（8 = `core` 档工具数，权威侧见 specs/mcp/mcp-capabilities.md）
    expect(page.locator(".agent-roster-row")).to_have_count(7)
    expect(page.locator(".guide-caps-table tbody tr")).to_have_count(8)
    # 能力表在窄屏靠**容器内横向滚动**兜底（`.table-wrap{overflow-x:auto}`），
    # 而不是靠压缩列宽 ⇒ 判据是「表格位于可滚动容器内」，页面本身不得横向滚动。
    table_wrap_overflow = page.eval_on_selector(
        "#tools .table-wrap", "el => getComputedStyle(el).overflowX"
    )
    assert table_wrap_overflow in {"auto", "scroll"}, (
        f"能力表容器应可横向滚动（overflow-x: auto），实际 {table_wrap_overflow}"
    )

    # 页内锚点无断链（AC6.10）
    dangling = page.evaluate(
        "() => Array.from(document.querySelectorAll('a[href^=\"#\"]'))"
        ".map((a) => a.getAttribute('href').slice(1))"
        ".filter((id) => id && !document.getElementById(id))"
    )
    assert dangling == [], f"页内锚点断链：{dangling}"

    # 四语言切换生效且按钮状态同步（AC6.3）
    cjk = re.compile(r"[\u4e00-\u9fff]")
    labels = {"en": "EN", "zh-CN": "简", "zh-HK": "港", "zh-TW": "台"}
    for tag, expect_cjk in (("en", False), ("zh-CN", True), ("zh-HK", True), ("zh-TW", True)):
        page.goto(f"{base_url}/?lang={tag}", wait_until="networkidle")
        step1_title = page.locator("#setup .step").first.locator("h3").inner_text()
        active = page.locator(".locale-switch button.is-active").inner_text()
        assert bool(cjk.search(step1_title)) is expect_cjk, (
            f"?lang={tag} 的第 1 步标题语言不符：{step1_title!r}"
        )
        assert active == labels[tag], f"?lang={tag} 的激活语言按钮应为 {labels[tag]}，实际 {active!r}"
        evidence[f"S6 step1.title ({tag})"] = step1_title

    page.goto(f"{base_url}/?lang=en", wait_until="networkidle")
    assert_no_overflow(page, "公开接入说明页")
    _assert_all_viewports(page, "公开接入说明页")
    assert_footer_pinned(page, "公开接入说明页")
    _shot(page, "14-instructions")

    return evidence
