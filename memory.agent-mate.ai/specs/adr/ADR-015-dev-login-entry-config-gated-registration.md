# ADR-015: 开发登录入口的边界与身份口径（配置限制注册 + 真实邮箱 + 生产来源白名单）

## Status

Accepted

## Context

[`issues-log.md`](../web-portal/issues-log.md) **Issue 6 [FATAL] 无法登录**：快速路径（本机开发）**没有任何登录动作** —— 它把「交付身份」这一步外包给使用者的手工操作（自己往浏览器注入 `CF_Authorization` cookie）。那个步骤不在产品里（无入口、无按钮、无反馈）、依赖工具链细节（cookie 按**主机**隔离、DevTools 入口因键盘与浏览器而异、长串复制被截断、浏览器可能直接拒绝 cookie），失败时又与「未登录」**完全同形** ⇒ 不可诊断，且**从未有人走通过**。

处置方案见 [`web-portal/web-login-plan.md`](../web-portal/web-login-plan.md)（C + A + B）。其中「A —— 开发登录入口」自身引出两个必须先定、否则会留隐患的问题：

| 问题 | 候选 | 顾虑 |
|---|---|---|
| 入口的**存在条件** | ① 配置限制**注册** | 路由只在满足条件时被注册；生产环境**没有**该路径 |
| | ② **注册但拒绝** | 路由始终存在，运行时判定后拒绝 ⇒ 判据必须与配置保持一致（否则配置改了、判定没改就悄悄开口子），且生产多一个可达端点 |
| | ③ 不做入口，继续手工注入 | 即 Issue 6 原状 |
| 入口的**声明方式** | ① 沉默 | 使用者不知道入口已启用，只能靠文档 |
| | ② 启动横幅声明并给出**可点链接** | 横幅多两行输出 |

实现前已核实、并直接决定此次取舍的既有事实：

- 配置层已强制：启用自签通道 ⇒ 必须 `development` 且两个面都是**回环 Host**；`PORTAL_ENV=production` 下启用自签通道 ⇒ **启动期拒绝**（`admin_portal/src/config.ts`）。
- 守卫（`admin_portal/src/web/admin-guard.ts`）对 `/admin*` 是**身份先于路由**（未认证者探测不到管理路径是否存在 —— 既有安全模型）。因此任何「用来获得身份」的路径都必须显式豁免，否则会被拦成 401。

## Decision

1. **存在条件取 ①：按配置限制注册。** `admin_portal/src/server.ts` 只在自签通道启用时注册该路由：

   ```ts
   // ---- 开发登录入口：**仅在自签通道启用时注册**（其余配置下该路由不存在）----
   if (cfg.testJwt.enabled) registerDevLoginRoutes(app, deps);
   ```

   ⇒ 生产配置下该路由**不存在**（是「没有」，不是「存在但拒绝」）。

2. **守卫豁免收敛为同一判据。** `admin_portal/src/web/admin-guard.ts` 的放行条件是单一条件：

   ```ts
   if (deps.cfg.testJwt.enabled && pathname === DEV_LOGIN_PATH) return;
   ```

   **不新增不变量** —— 该判据已同时蕴含「development」与「两个面均为回环 Host」（由配置层在启动期强制）。

3. **入口不新增签发能力、不把私钥引入应用进程。** `POST /admin/dev-login` 读取 `--dev-login` **已产出**的令牌文件（`resolveTokenFile`：与 JWKS 同目录；JWKS 为内联 JSON 时回退到 `<dbPath 目录>/dev/token`），写入 `CF_Authorization` cookie 后 **303 → `/admin/users`**。缺令牌时返回 **409** 并明确提示「重新运行 `--dev-login`」，而不是给一个无法解释的失败。

4. **cookie 属性与生产一致**：`HttpOnly; SameSite=Lax; Path=/`，HTTPS 时带 `Secure`；使用入口时写审计事件 `dev_login_used`（`warn` 级，含 `host`）。

5. **声明方式取 ②：启动横幅显式声明，并直接给出可点链接。** `scripts/portal-dev.sh` 打印
   `打开 http://127.0.0.1:<port>/admin/dev-login → 点击「以测试管理员身份登录」`，
   替代此前「打印一串要粘的 cookie」。
6. **声明身份必须是真实邮箱，缺配置即拒启动。** 自签通道的身份取自显式配置键
   `PORTAL_TEST_JWT_EMAIL`（`src/config.ts` 在「启用自签通道」时把它列为**必需**；
   `scripts/portal-dev.sh` 提供 `--email`，优先级为 `--email` > `PORTAL_TEST_JWT_EMAIL` > **报错退出**）。
   **不设** `admin@example.test` 之类默认值 —— 身份不许静默回落（页面的身份块与审计 actor 都会用它）。
7. **生产环境只接受 Cloudflare 来源（身份层护栏）。** `src/web/admin-guard.ts` 的
   `isIdentitySourceAllowed(isProduction, source)`：非生产一律放行；生产下只允许
   `access-jwt` 与 `service-token`，出现 `test-jwt` ⇒ **401** 并记 `identity_source_rejected` 告警。
   注意该判据针对的是**通道**而非「有没有 email」—— Service Token 走的是 access 通道
   （`email` 为空、`common_name` 有值，来源记为 `service-token`）⇒ **不会误伤自动化**。

## Rationale

- **「不存在」优于「存在但拒绝」**：生产环境根本没有这条路径 ⇒ 攻击面为零，也无需维护一条「是否该拒绝」的运行时逻辑；而 ② 会让生产多出一个可达端点，其判据还必须与配置**始终一致**。
- **单一判据的理由**：`testJwt.enabled` 之所以够用，是因为「development」「回环 Host」「production 拒绝启动」三条约束都由**配置层在启动期**强制 ⇒ 它同时蕴含这三者。为此再引入一个独立开关，只会多出一处可能与配置脱节的不变量。
- **不做 ③**：手工注入正是 Issue 6 的根因，也是「验证方式与真实使用方式不一致」的典型 —— 服务端能被验证，人却进不去。
- **横幅必须声明**：一个只在特定配置下存在的入口，如果不说，就等于把「能不能登录」重新变回靠人猜；而给出**可点链接**是把「粘贴长串」这类翻车点从流程里彻底移除（Issue 6 的直接教训）。
- **不是新增旁路**：注入的就是既有自签测试通道的令牌 —— 同签发器、同 JWKS、同校验；且启用条件比此前的手工注入更严（后者对任何配置都可手工做）。
- **身份护栏是「身份层」而非「配置层」**：配置层已有的保护是「production + 启用自签通道 ⇒ 启动被拒」；第 7 条补的是**即便通道存在也验身份来源**的第二道防线 —— 将来新增通道或配置漂移时，非 Cloudflare 来源在生产仍然过不去。
- **拒绝默认邮箱，是因为默认值会把「谁在操作」变成假事实**：页面的身份块与审计 actor 都用这个值；一个看起来合理的测试地址（`admin@example.test`）会让审计「看起来正常但不对」，比直接报错更糟。

## Consequences

- **正面**：开发路径有真实登录动作（人可当场走通，且有 E2E 回归防护）；生产不存在该路径；认证代码仍只有一条路径；横幅把可点链接直接给出，登录不再依赖 F12 或剪贴板。
- **代价**：开发密钥（`.portal-data/dev/`，权限 `0600`）若被误当真实凭据使用，等价于测试身份泄漏 ⇒ 由配置层的启动期拒绝 + 文件权限兜住。
- **护栏（已实施，`admin_portal/tests/integration/dev-login.test.ts`，6 例）**：不预注入 cookie 的完整登录流程 ⇒ 200；缺令牌 ⇒ 409 + 提示；production ⇒ 路由不存在；非回环 Host ⇒ 403；开发实例的 401 页含自诊断、生产实例不含（生产仍**不暴露验签失败原因**，原因只进结构化日志）。
- **后续**：`PSP-W2` 的 `/mcp` 复用同一段令牌校验；生产反代路径（[`web-portal/web-design.md`](../web-portal/web-design.md) §11）不涉及本入口。

## Date

2026-09-23（身份口径部分于同日按 `portal-identity-plan.md` §3.3 补入）
