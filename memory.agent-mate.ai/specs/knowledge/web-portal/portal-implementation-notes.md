---
title: 门户实现笔记（PSP-W1 起）：把「设计包」变成可运行代码时踩到的坑
type: ops-lesson
status: active
as_of: 2026-09-22
tags:
  - portal
  - implementation
  - i18n
  - testing
related_spec: specs/web-portal/web-design.md
related:
  - knowledge/web-portal/portal-launch-mechanism.md
  - adr/ADR-014-portal-admin-identity-verified-assertion-only.md
  - adr/ADR-015-dev-login-entry-config-gated-registration.md
---

# 门户实现笔记（PSP-W1 起）

## Summary

设计包（技术栈、数据模型、路由表、逐页映射）定稿后再落代码，多数问题不在业务逻辑，而在**「同一件事在文档与实现里各写一次」的地方**：词表键名、令牌长度口径、CSS 令牌清单、环境键清单、以及「哪些检查在本批根本成立不了」。这份笔记把 `PSP-W1` 实测到的坑与判据固化下来，供 `PSP-W2`/`PSP-W3` 直接复用。

## Evidence

- **词表键名沿袭原型，不等于按语义命名**：侧栏第三项的键是 `nav.guide`（`Admin MCP config`），不是 `nav.mcp`。写模板时按语义猜键名 ⇒ 页面上**原样显示 `nav.mcp`**（因为回落链最后一步是「键名本身」）。教训：**缺键必须 fail-loud**，否则这类缺陷看起来像「文案待补」。
- **`43 字符` 指的是编码部分，不含 `memo_` 前缀**：32 字节 → base64url 无填充 = 43 字符；含前缀共 **48 字符**。按「总共 43」实现会让所有令牌形状校验失败（本轮被单测当场抓到）。
- **`portal.css` 的 `:root` 与文档令牌表曾差 7 个变量**（`--bg-soft` / `--placeholder` / `--code-bg` / `--danger-wash` / `--dur-fast` / `--dur-base` / `--ease`），且 `var(--placeholder)` 被引用却未定义 ⇒ 把它收进 `:root` 后 `:root` 恰好 **30 个**，与 `web-design.md` §13.1 一一对应，「令牌 ↔ 计算样式」才可机械核对。改完**必须复跑原型 134 项断言**并同步交付副本（sha256 逐文件核对）。
- **`rem` 基准是 17px**（`html { font-size: 17px }`）：`--control-h: 2.75rem` = 44px。按 16px 折算会系统性偏小。
- **无头浏览器的语言是「默认语言」而不是英文**：Playwright 默认**不发 `Accept-Language`**，门户因此回落到 `zh-CN` ⇒ 按英文文案写的断言全部失败（页面本身没错）。修法：E2E 里显式 `new_context(locale="en-US")`，语言切换另开用例。
- **测试步骤之间有状态耦合**：E2E 第 8 步切到 `zh-TW` 会把语言写进 cookie，第 9 步若按英文断言就会失败。跨步骤的断言要么显式带 `?lang=`，要么断言语言无关的结构。
- **浏览器导航场景必须走 cookie**：Access 在生产把断言放进 `CF_Authorization` cookie，而浏览器无法给每个请求挂自定义头 ⇒ 离线 E2E 用同一 cookie 路径注入自签 JWT，**顺带覆盖了浏览器分支**，也让「cookie 回落」这条代码有真实用例。
- **语言切换用「一个 GET 表单 + 多个提交按钮」**：样式按 `.locale-switch button` 命中，改成 `<a>` 会掉样式；用表单包住整组则既保留 `<button>` 又无需 JS。同理，禁用态分页控件保留 `<button disabled>`（`button[disabled]` 有样式），可用态用 `<a>`。
- **明文一次性要求的实现含义**：签发/轮换**不能**走 PRG 303 回跳 —— 否则明文要么进 URL/历史，要么需要第二次取回。做法是「POST 后直接渲染页面并把明文放进本次响应」，刷新即不可取回（E2E 有专门断言）。
- **同一目录「本来就在」与「本次创建」必须分开记账**：并发重复建用户时，失败方若不加区分地清理目录，会**删掉对手刚建成功的目录**（本轮代码评审抓到的安全级缺陷）。只有「本次创建」才允许清理。
- **审计 fail-closed 的代价很便宜**：业务写与审计写同库 ⇒ 放同一事务即可，不需要补偿逻辑；反过来「失败的动作不写审计」也是同一事务的免费结果。
- **sticky footer 会让整页截图看起来「footer 压在内容上」**：那是外框冻结（§13.10）在整页截图下的正常表现，不是布局缺陷；判断布局问题要看视口截图而非整页截图。

## Lesson / guidance

1. **凡「文档里有一份清单、代码里还有一份」的东西，落地时必须收口成一处**（词表键、令牌变量、环境键、字段清单），并加**可机械核对的护栏**：本轮加了「模板里 `t('…')` 的字面量键必须存在」「四语言键集合一致」「中文变体不出现『令牌/權杖』」「`:root` 变量数 == 文档总表」四类断言。
2. **缺键/缺配置一律 fail-loud（开发与测试期）**：静默回落会把这些缺陷伪装成「文案待补」或「功能没做」。
3. **E2E 的语言与状态要显式固定**：不假设浏览器给什么语言，也不让前一步的 cookie 影响后一步的断言。
4. **一次性机密（令牌明文）不能用「回跳 + 再看一次」实现**：唯一能在实现上成立的形态是「在产生它的那次响应里展示」。
5. **「本批成立不了的前置检查」要显式登记为 deferred，而不是让它通过**：`PSP-W1` 不 spawn 上游子进程 ⇒ 启动自检里 embeddings / 二进制版本 / 模板断言三项以 `deferred` 输出，等 `PSP-W2` 接入时转正。

## Links

- [`adr/ADR-014`](../../adr/ADR-014-portal-admin-identity-verified-assertion-only.md) —— 身份只信签名断言、本地走隧道、双层测试凭据
- [`adr/ADR-015`](../../adr/ADR-015-dev-login-entry-config-gated-registration.md) —— 开发登录入口按**配置限制注册**（生产该路由不存在），横幅给出**可点链接**
- [`specs/web-portal/web-design.md`](../../web-portal/web-design.md) §12（技术设计）· §13（设计系统令牌）
- [`specs/web-portal/web-test.md`](../../web-portal/web-test.md) §2（`TC-P-L1-14` 与其下的在线/离线边界登记）
- [`specs/knowledge/web-portal/portal-launch-mechanism.md`](./portal-launch-mechanism.md) —— 启动机制 β′ 的实测证据
