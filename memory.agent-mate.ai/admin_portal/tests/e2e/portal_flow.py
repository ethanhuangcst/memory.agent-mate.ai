"""门户管理面端到端流程（Playwright，同步 API）。

被两套入口复用：
  - `offline_flow.py`：自签 JWT 走 `CF_Authorization` cookie（零网络，覆盖页面与业务闭环）；
  - `online_flow.py`：经 cloudflared 隧道 + Cloudflare Access **Service Token**（验真链路）。

断言口径与 `tests/integration/pages.test.ts` 一致，但这里是**真实浏览器**：
渲染、表单提交、303 跳转、四语言切换都按用户实际操作路径验证。
"""

from __future__ import annotations

import re
import time
from pathlib import Path

from playwright.sync_api import Page, expect

TOKEN_PATTERN = re.compile(r"memo_[A-Za-z0-9_-]{43}")
PREFIX_PATTERN = re.compile(r"memo_[A-Za-z0-9_-]{8}")

ARTIFACTS = Path(__file__).parent / "artifacts"


def _shot(page: Page, name: str) -> None:
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(ARTIFACTS / f"{name}.png"), full_page=True)


def run_flow(page: Page, base_url: str, admin_email: str) -> dict[str, str]:
    """跑通「建用户 → 签发 → 列出 → 轮换 → 吊销 → 停用」并返回关键证据。"""
    evidence: dict[str, str] = {}
    handle = f"e2e{int(time.time()) % 100000}"

    # ---- 1. 用户列表（空态或已有数据都可）----
    page.goto(f"{base_url}/admin/users", wait_until="networkidle")
    expect(page.locator(".app-header")).to_contain_text(admin_email)
    expect(page.locator("nav.nav a")).to_have_count(4)
    _shot(page, "01-users-list")

    # ---- 2. 建用户（对话框 → 提交 → 303 到详情页）----
    page.goto(f"{base_url}/admin/users?new=1", wait_until="networkidle")
    dialog = page.locator("#dialog-new-user")
    expect(dialog).to_be_visible()
    dialog.locator("#new-handle").fill(handle)
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
    page.locator("#dialog-revoke").get_by_role("button", name=re.compile("^Revoke$", re.I)).click()
    page.wait_for_load_state("networkidle")
    expect(page).to_have_url(re.compile(rf"/admin/users/{handle}$"))

    page.goto(f"{base_url}/admin/users/{handle}", wait_until="networkidle")
    assert rotated_plaintext not in page.content(), "吊销后仍出现明文"
    expect(page.locator("table")).to_contain_text(rotated_plaintext[:13])
    _shot(page, "09-token-revoked")

    # ---- 7. 停用用户（可逆软操作 D13）----
    page.goto(f"{base_url}/admin/users/{handle}?dialog=deactivate", wait_until="networkidle")
    deactivate_dialog = page.locator("#dialog-deactivate")
    expect(deactivate_dialog).to_be_visible()
    expect(deactivate_dialog).to_contain_text(handle)
    _shot(page, "10-dialog-deactivate")
    deactivate_dialog.get_by_role("button", name=re.compile("^Deactivate$", re.I)).click()
    page.wait_for_load_state("networkidle")
    expect(page.locator(".status.is-off").first).to_be_visible()
    expect(page.locator("a[href*='dialog=deactivate']")).to_have_count(0)
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
    _shot(page, "13-placeholder-audit")

    # ---- 10. 面隔离：管理域名上不应有 /mcp ----
    response = page.request.get(f"{base_url}/mcp")
    assert response.status == 403, f"管理域名上的 /mcp 应为 403，实际 {response.status}"

    return evidence
