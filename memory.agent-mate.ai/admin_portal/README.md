# admin_portal — 门户 UI 资产（设计包落地）

> **状态**：资产占位（Sprint 4 #1 设计包交付） · as_of 2026-09-22
> **边界**：本目录**只放 UI 资产**，**不含应用逻辑**。门户应用代码（`portal-web` / `mcp-bridge`）在实现批次（`PSP-W1`…`PSP-W3`）落地。
> **单一真源**：资产的**源**是 [`../specs/web-portal/mockups/assets/`](../specs/web-portal/mockups/assets/)（原型目录，设计阶段的可执行稿）；本目录是**实现期的目标副本**。**同步方式 = 机械复制**（见下表）。**不得在本目录单独改样式** —— 改样式一律先改原型、复核后再复制，以保证「实现与原型一致」可被机械核对。

## 资产清单

| 资产 | 源（原型） | 目标（本目录） | 用途 | 同步方式 |
|---|---|---|---|---|
| `portal.css` | `specs/web-portal/mockups/assets/portal.css` | `admin_portal/assets/portal.css` | 设计令牌与全部组件样式（**纯单色**） | 机械复制 |
| `i18n.js` | `specs/web-portal/mockups/assets/i18n.js` | `admin_portal/assets/i18n.js` | 四语言词表（`EN` / `zh-CN` / `zh-HK` / `zh-TW`，**220 键 ×4**，键集合一致）。**实现期以 `src/web/i18n/*.json` 为准**（同键名，另含 28 个实现期新增键 ⇒ 共 **248 键 ×4**） | 机械复制 |
| `mockup.js` | `specs/web-portal/mockups/assets/mockup.js` | `admin_portal/assets/mockup.js` | 原型渐进增强（i18n 渲染 · 对话框开合 · 复制回显 · URL 变体参数）。**实现期由服务端渲染替代，本文件仅作行为参照** | 参照，不直接复用 |
| `logo.png` | `specs/web-portal/mockups/assets/logo.png` | `admin_portal/assets/logo.png` | 品牌标记（**图像资产**；其自身橙色**不参与** UI 色系，用户后续更换） | 机械复制 |
| `wechat.png` | `specs/web-portal/mockups/assets/wechat.png` | `admin_portal/assets/wechat.png` | 「联系管理员」悬浮窗内的微信二维码 | 机械复制 |
| `chat-example.png` | `specs/web-portal/mockups/assets/chat-example.png` | `admin_portal/assets/chat-example.png` | 首页第 3 步「验证一次调用」的聊天截图 | 机械复制 |

## 素材来源与授权（必须遵守）

- **`wechat.png`**：由 `specs/web-portal/mockups-from-other-product/assets/EthanWeChat.png` **复制**而来 —— 它是**站主本人的微信二维码**，**不是**参考素材所属产品的品牌资产，可自由使用。（注：该参考素材目录**现已不在工作树中**，此条保留为**来源登记**；复制来的资产本身仍在 `mockups/assets/wechat.png`。）
- **`chat-example.png`**：用户提供的聊天截图（源 `specs/web-portal/chat-example.png`）。已逐字核查：**不含令牌（无 `memo_` 前缀）、不含主机名、不含 IP、不含凭据**；含一条 Memory id 与站主本人项目要点，**已获用户授权公开使用**。
- **禁止**从 `mockups-from-other-product/` 复制该产品的**品牌徽标与三张异产品 logo**（`agent-logo.png` / `play-logo.png` / `food-logo.png`）。该目录**只作风格参考**，其产品文案与信息架构亦不得进入本项目原型与实现。

## 纪律

1. **不新造色值**：模板与样式必须引用 `portal.css` 的 `:root` 令牌；**不得出现品牌橙或任何 `--accent` 系变量**（设计系统见 [`../specs/web-portal/web-design.md`](../specs/web-portal/web-design.md) §13）。
2. **禁硬编码文案**：界面文案一律取自 `i18n.js` 的键；**协议名、工具名、标识符一律不翻译**（见 `web-design.md` §12.4）。
3. **改样式走原型**：先改原型并复核，再机械复制到本目录。
4. **离线降级如实登记**：字体经 Google Fonts `@import` 加载，离线时**降级为系统字体栈** —— 不得宣称「完全离线自包含」。

## 应用代码（自 `PSP-W1` 起落地）

> 本目录自 `PSP-W1` 起同时承载**应用代码**（此前只有 UI 资产）。资产纪律不变：`assets/` 仍以 `specs/web-portal/mockups/assets/` 为唯一真源、机械复制。

| 路径 | 作用 |
|---|---|
| `src/server.ts` | 进程装配：配置校验 → 启动自检 → **面隔离（`Host`）** → **身份守卫（Access 断言）** → 静态资源 → 路由 → 监听 |
| `src/config.ts` | `PORTAL_*` 环境键读取与语义校验（缺键 fail-loud；门户库**不得**在 `/data` 下；两面 Host 不得相同） |
| `src/selfcheck.ts` | 启动自检（fail-closed）；属 `PSP-W2` 的三项**显式登记为 deferred**，不伪装通过 |
| `src/shared/` | 纯逻辑层：`host-split`（分面）· `auth`（身份验签）· `handle`（命名与目录）· `tokens`（令牌原语）· `audit`（fail-closed 审计事务）· `redact`（脱敏唯一出口）· `cookies` · `format` |
| `src/web/` | 服务端渲染与管理 API：`routes/*`（页面 + `/admin/api/*`）· `views/*.njk`（结构对齐原型）· `i18n/*.json`（四语言词表）· `db/*`（schema / 前向迁移 / 仓储） |
| `src/bridge/` | **未创建**：MCP 桥（`/mcp`、会话回收、吊销终止）属 `PSP-W2`，本批不含 |
| `tests/unit` · `tests/integration` | vitest 离线测试（**247 项**，零网络依赖；覆盖率口径与门禁见 [`../specs/web-portal/web-test.md`](../specs/web-portal/web-test.md) §1.1） |
| `tests/e2e` | Python Playwright 端到端（离线自签 JWT；在线经隧道 + Service Token） |

### 运行方式

| 目的 | 命令 |
|---|---|
| 离线测试（类型检查 + 单元/集成） | `make portal-test` |
| **覆盖率**（v8；阈值低于即失败；明细落 `coverage/index.html`） | `make portal-coverage` |
| 端到端（离线；追加 `ARGS=--online` 走隧道） | `make portal-e2e` |
| **本机快速登录**（无需 Cloudflare，回环 + 自签通道） | `make portal-dev ARGS="--env-file .env.local --dev-login"` |
| 本机启动门户（真身份/隧道路径，读 `.env`） | `make portal-dev` |
| Cloudflare 隧道：逐步骤引导与自检（`--login` / `--create` / `--route` / `--check` / `--verify` / `--start`） | `make portal-tunnel ARGS="--check"` |

环境键样例见 [`.env.example`](./.env.example)（**只列键名与语义，不含任何真实值**；`.env` 已被仓库 `.gitignore` 忽略）。

### 本地认证口径（`PSP-W1` 定档）

管理面身份**只来自 Cloudflare Access 签名断言**：Web 界面经 `Cf-Access-Jwt-Assertion` 头，**浏览器导航回落到 `CF_Authorization` cookie**（生产本来如此）；验签走 JWKS + `iss` + `aud` + `exp`。`CF-Access-Authenticated-User-Email` **只作交叉校验**，不单独采信（可伪造）。本机开发走**命名隧道 + Access 应用**取得真身份，不引入「本地关掉认证」的分支；自动化测试分两层 —— **离线**用自签 JWT（测试密钥对，仅允许回环绑定）覆盖验签与状态机，**在线**用 Access **Service Token** 验证真链路（Service Token 由 Cloudflare 在边缘校验后注入同一断言，门户侧无需专门代码）。`PORTAL_ENV=production` 下启用自签通道会**拒绝启动**。

### 本机两条测试路径

环境值分文件承载，互不污染：`.env.local`（快速路径）与 `.env`（真身份路径）—— 两者都已被 `.gitignore` 忽略。

**路径 B · 快速路径（无需 Cloudflare，用来立刻看页面、点完整闭环）**

```bash
mkdir -p admin_portal/.portal-data/users          # 首次：用户数据根目录必须已存在
make portal-dev ARGS="--env-file .env.local --dev-login"
```

`--dev-login` 生成（或复用）开发密钥到 `admin_portal/.portal-data/dev/`（`umask 077`；复用使 cookie 能跨重启存活，`--reset-dev-keys` 可强制重生成），并把**既有的自签 JWT 测试通道**注入进来；启动横幅会打印可直接粘贴的浏览器登录行：

```js
document.cookie = "CF_Authorization=<横幅里给出的令牌>; path=/";
```

粘贴后刷新即进入管理面（令牌 12 小时有效）。**这不是新增的认证旁路**：服务端一行未改，走的就是生产浏览器同一条「cookie 回落」路径；`--dev-login` 只接受**回环 Host**（非回环直接拒绝），且 `PORTAL_ENV=production` 下该通道启用即拒绝启动。

**路径 A · 真身份路径（接近生产；需要能访问 Cloudflare 的网络）**

```bash
make portal-tunnel ARGS="--check"        # 打印逐步骤清单并列出键位缺口（只读）
# ① 授权 → ② 建命名隧道 → ③ 绑主机名（②③ 幂等）
make portal-tunnel ARGS="--login"
make portal-tunnel ARGS="--create" ARGS="--tunnel <隧道名>"
make portal-tunnel ARGS="--route"  ARGS="--tunnel <隧道名> --hostname <ADMIN_HOST>"
# 控制台侧（只能人工）：Access 应用 + Allow 策略（≥2 邮箱）+ 会话时长 + Service Token 并**加入策略**
# 把团队域与 AUD 填进 admin_portal/.env，然后：
make portal-dev                                                        # 终端 A
make portal-tunnel ARGS="--start" ARGS="--tunnel <隧道名> --hostname <ADMIN_HOST>"   # 终端 B
make portal-tunnel ARGS="--verify" ARGS="--hostname <ADMIN_HOST>"       # 自检：未认证应被 Access 拦截
make portal-e2e ARGS=--online                                          # 需 Service Token 环境变量
```

**注意（本机网络实测）**：若所在网络解析不到 `cloudflareaccess.com` / `ghcr.io` 等域名（如内网 DNS 仅放行国内镜像），则**在线链路无法在本机跑通** —— 隧道客户端装不上、门户也取不到真 JWKS。此时路径 B 与全部离线测试不受影响（零网络），路径 A 需换到能访问 Cloudflare 的网络或配置代理后再执行；`make portal-e2e ARGS=--online` 缺前置时以**退出码 40** 显式跳过，不会伪装通过。
