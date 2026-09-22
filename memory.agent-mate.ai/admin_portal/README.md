# admin_portal — 门户 UI 资产（设计包落地）

> **状态**：资产占位（Sprint 4 #1 设计包交付） · as_of 2026-09-22
> **边界**：本目录**只放 UI 资产**，**不含应用逻辑**。门户应用代码（`portal-web` / `mcp-bridge`）在实现批次（`PSP-W1`…`PSP-W3`）落地。
> **单一真源**：资产的**源**是 [`../specs/web-portal/mockups/assets/`](../specs/web-portal/mockups/assets/)（原型目录，设计阶段的可执行稿）；本目录是**实现期的目标副本**。**同步方式 = 机械复制**（见下表）。**不得在本目录单独改样式** —— 改样式一律先改原型、复核后再复制，以保证「实现与原型一致」可被机械核对。

## 资产清单

| 资产 | 源（原型） | 目标（本目录） | 用途 | 同步方式 |
|---|---|---|---|---|
| `portal.css` | `specs/web-portal/mockups/assets/portal.css` | `admin_portal/assets/portal.css` | 设计令牌与全部组件样式（**纯单色**） | 机械复制 |
| `i18n.js` | `specs/web-portal/mockups/assets/i18n.js` | `admin_portal/assets/i18n.js` | 四语言词表（`EN` / `zh-CN` / `zh-HK` / `zh-TW`，177 键 ×4，键集合一致） | 机械复制 |
| `mockup.js` | `specs/web-portal/mockups/assets/mockup.js` | `admin_portal/assets/mockup.js` | 原型渐进增强（i18n 渲染 · 对话框开合 · 复制回显 · URL 变体参数）。**实现期由服务端渲染替代，本文件仅作行为参照** | 参照，不直接复用 |
| `logo.png` | `specs/web-portal/mockups/assets/logo.png` | `admin_portal/assets/logo.png` | 品牌标记（**图像资产**；其自身橙色**不参与** UI 色系，用户后续更换） | 机械复制 |
| `wechat.png` | `specs/web-portal/mockups/assets/wechat.png` | `admin_portal/assets/wechat.png` | 「联系管理员」悬浮窗内的微信二维码 | 机械复制 |
| `chat-example.png` | `specs/web-portal/mockups/assets/chat-example.png` | `admin_portal/assets/chat-example.png` | 首页第 3 步「验证一次调用」的聊天截图 | 机械复制 |

## 素材来源与授权（必须遵守）

- **`wechat.png`**：由 `specs/web-portal/mockups-from-other-product/assets/EthanWeChat.png` **复制**而来 —— 它是**站主本人的微信二维码**，**不是**参考素材所属产品的品牌资产，可自由使用。
- **`chat-example.png`**：用户提供的聊天截图（源 `specs/web-portal/chat-example.png`）。已逐字核查：**不含令牌（无 `memo_` 前缀）、不含主机名、不含 IP、不含凭据**；含一条 Memory id 与站主本人项目要点，**已获用户授权公开使用**。
- **禁止**从 `mockups-from-other-product/` 复制该产品的**品牌徽标与三张异产品 logo**（`agent-logo.png` / `play-logo.png` / `food-logo.png`）。该目录**只作风格参考**，其产品文案与信息架构亦不得进入本项目原型与实现。

## 纪律

1. **不新造色值**：模板与样式必须引用 `portal.css` 的 `:root` 令牌；**不得出现品牌橙或任何 `--accent` 系变量**（设计系统见 [`../specs/web-portal/web-design.md`](../specs/web-portal/web-design.md) §13）。
2. **禁硬编码文案**：界面文案一律取自 `i18n.js` 的键；**协议名、工具名、标识符一律不翻译**（见 `web-design.md` §12.4）。
3. **改样式走原型**：先改原型并复核，再机械复制到本目录。
4. **离线降级如实登记**：字体经 Google Fonts `@import` 加载，离线时**降级为系统字体栈** —— 不得宣称「完全离线自包含」。
