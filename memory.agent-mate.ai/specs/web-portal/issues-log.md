# sprint 1
## PSP-W2「端到端接入」
### Issue 1: Can issue token for deactivated user
- Admin loged in, user page
- create a new user ethanhuang, then deactivate it
- in detailed page, there are still Issue token button, I can still issue token for this deactivated user
- and after I click Deactivate button again, error msg: "{"error":"not_found","path":"/admin/api/users/ethanhuang/tokens"}"
### Issue 2:Duplicate user name check missing
- I create a new user ethanhuang, then deactivate it
- I create a new user ethanhuang again, there is no error msg, but I stayed in the Create new user floating window
- after I click cancel, there is an active user ethanhuang in the list
### Issue 3: UI messed up when there is long text
- All UI's when there is long text, such as "/Users/ethanhuang/code/memory.agent-mate.ai/memory.agent-mate.ai/admin_portal/.portal-data/users/ethanhuang/ai-memory.db", in all pages, there is no trim or line break, mess up the UI, with either cutting short the display, or appearing scroll bars
### Issue 4: Issue token not displayed
- Issue token succesfully, but it does not display the token, neither can I copy it. The token is simply not displayed anywhere

### Issue 5: Isse token failed with no reason
- Issue one token successfully
- Click Issue token button again
- Error msg: {"error":"not_found","path":"/admin/api/users/ethanhuang/tokens"}

### Issue 6: [FATAL] Cannot sign in — the quick path has no login entry point
- I cannot log in at all. Every attempt ends at "Sign in required".
- Pasting the cookie by hand (console / bookmarklet / DevTools cookie editor) did not work for me.
- This blocks all manual testing of the portal.

**判定：FATAL** —— 登录不可用 ⇒ 交付物无法被任何人使用。（与 Issue 1–5 不同：那五条是「登录之后」的问题，本条是**进不去**。）

#### 根因（结构层）

> ⚠️ **本节根因已被更正（2026-09-22）** —— 本次「无法登录」的**真实根因是「服务端与隧道的配置不匹配」**，见文末〈Issue 6 根因更正与流程条款〉。下面这条「快速路径没有登录入口」保留为**次要发现**：它仍是开发路径的真实缺陷，但**不是**本次无法登录的直接原因。

**快速路径根本没有「登录」这个动作。** W1 把「交付身份」这一步**外包给了用户的手工操作** —— 要求人自己向浏览器注入 `CF_Authorization` cookie。这个步骤：

- **不在产品里**：没有入口、没有按钮、没有任何反馈；
- **依赖浏览器/工具链细节**：cookie 按**主机**隔离（`localhost` 与 `127.0.0.1` 是**两个**主机，端口不参与隔离）、DevTools 入口因键盘与浏览器而异、浏览器可能直接拒绝 cookie；
- **失败与「未登录」完全同形**：一律只是 401 + "Sign in required"，**不可诊断**。

⇒ 所以「无法登录」不是操作失误，而是**这条路径的设计缺陷**：它把必须由产品承担的认证入口交给了环境。

#### 证据（实测，非推理）

| 事实 | 证据 |
|---|---|
| 令牌与校验器没问题 | `curl -H 'Cf-Access-Jwt-Assertion: <token>' /admin/users` → **200** |
| cookie 通道没问题 | Playwright 程序化写 cookie → **200**（既有 offline E2E 全通过；`open_portal.py` 窗口亦为已认证） |
| **浏览器一个凭据都没送出** | 服务端日志每条浏览器请求：`event=admin_unauthenticated, reason=missing`（无头、无 cookie） |
| 页面无 CSP（排除「书签被拦」猜测） | 401 响应头无 `content-security-policy` |
| 浏览器 Host 确为 `127.0.0.1:8788` | 服务端日志 `req.host` |
| **两条路径同时不可用** | 快速路径无入口；真身份路径未接通（本机解析不到 Cloudflare 域名 + Access 配置未完成） |

#### 根因（流程层，比技术根因更该记）

**验证方式与真实使用方式不一致。** 用 curl（请求头）与 Playwright（程序化 cookie）只能证明「服务端能验证身份」，两者都**绕过了人手**；「人能不能登录」**从未被验证过**。上一轮 DoD 把「手工测试路径」记为已完成 —— 事实上**从未有人走通过**。

⇒ 长期条款：**凡交付物要求「人做某个动作」，验收必须包含一次真实的人手操作，并留证据。**

#### 候选方案（本次不改代码，仅提案）

**P-A（推荐）：把开发登录做成产品里的真实入口**
- `GET /admin/dev-login`，**仅当** `PORTAL_ENV=development` **且** 自签测试通道启用 **且** Host 为回环时**注册路由**；其余配置下该路由**根本不存在**（生产是「没有」，而不是「存在但拒绝」）。
- 页面一个按钮 → `POST /admin/dev-login` → 服务端 `Set-Cookie: CF_Authorization=<自签令牌>; HttpOnly; SameSite=Lax; Path=/` → 303 → `/admin/users`。
- **不是新增旁路**：注入的就是既有自签测试通道的令牌（同签发器、同 JWKS、同校验）；且启用条件比现状**更严**。
- 文案入四语言词表（不硬编码）；`--dev-login` 从「打印一串要粘的字符串」改为「打印**可点链接**」。

**P-B（建议同时做）：401 页自诊断**
- 显示：当前 Host / 允许的 Host / 自签通道状态 / 令牌文件路径；开发环境下给「以开发身份登录」按钮。
- 收益：把「未登录」与「Host 不对」两类同形症状**分开** —— 本次若早有它，一眼可定位。

**P-C（产品正路）：接通 Cloudflare Access 真身份路径**
- 登录成为标准 SSO，无需任何手工注入。依赖外部条件（网络、域名、Access 应用与策略、AUD/团队域），**不能替代 P-A**。

**不采纳**：把令牌放进 URL 查询参数（凭据会进历史与访问日志，且是新增旁路）。

**待决（ADR 候选，`D14`）**：开发登录入口的存在条件与声明方式 —— 「配置限制注册」vs「注册但拒绝」，以及是否在启动横幅显式声明该入口已启用。

#### 验收标准（可机器判定）

1. **E2E：真浏览器、不预注入 cookie** —— 打开 → 点「以开发身份登录」→ 到达用户列表 **200**（把本次缺陷固化为回归防护）。
2. 反向：`PORTAL_ENV=production` 下 `/admin/dev-login` → **404**（路由不存在）。
3. 反向：非回环 Host 下 `/admin/dev-login` → **404/403**。
4. 人手验收：交付物是**可点链接**，由人当场走通一次并留证据（截图）。
5. DoD 增补：涉及「人要做什么」的交付，必须有一条**人手操作**的验收记录。

### Issue 6 根因更正与流程条款（2026-09-22）

**更正后的根因**：门户以 `.env.local`（回环 Host）启动，而命名隧道 `portal-dev` 正把 `memory.agent-mate.ai` 转发到**同一个端口** ⇒ 真域名在 **Host 判定**处被判 `unknown-host` → **403**，**Cloudflare Access 断言根本没轮到**。

- 证据：本机 `Host: memory.agent-mate.ai` → **403**；日志 `face_denied reason=unknown-host`；同一进程下 `Host: mcp.agent-mate.ai` → **200**
- 判决：**不是网络问题，也不是 Cloudflare 配置问题**，是**启动配置与隧道目标不匹配**

**原先的四处误判（逐条认，均已按实测更正）**

1. 「网络不通 / `cloudflared` 装不上」—— **错**：DNS 系统解析与公共解析器一致（`cloudflareaccess.com` / `api.cloudflare.com` / `ghcr.io` / `github.com` / `registry.npmjs.org` 全部正常），HTTPS 全通；`cloudflared` **2026.9.1 已安装并已授权**（`~/.cloudflared/cert.pem`）。
2. 「真身份路径未接通」—— **错**：隧道、Access 应用、AUD、团队域均已配好，`tunnel-dev.sh --check` 返回**就绪**（退出码 0）。
3. 「别用 `memory.agent-mate.ai`」—— **反了**：真域名才是正路；403 由**启动配置**造成。
4. 把 `unknown-host` 归因为「快速路径只允许回环是设计如此」—— 真因是**跑错了配置文件**。

**误判的共同根源**：我从未读 `.env` 的**实际内容**、也没看隧道的**进程状态**，只凭「我自己写的那份是空模板」这一假设往下推理。

**流程条款（长期有效）**

1. **不得凭假设推理**：下结论前必须读**配置的实际内容**与**进程/隧道的实际状态**（`ps` / `pgrep` / `cloudflared tunnel list`）。
2. **`404` / `400` / `401` 是正常应答，不是「不可达」**：判断可达性看「**有无应答**」，不看状态码是否 2xx。
3. **凡交付物要求「人做某个动作」，验收必须包含一次真实人手操作并留证据。**
4. 「**未测**」与「**不通**」必须分开登记，不得互相替代。

**处置方案**：见 [`web-login-plan.md`](./web-login-plan.md)（顺序 **C → A → B**）。

**处置进度（2026-09-22）**

| 项 | 状态 | 证据 |
| --- | --- | --- |
| **C 真身份路径** | **已完成** | 本机 `Host: memory.agent-mate.ai` → **401**（不再 403）；公网 → **302 → `<team-domain>.cloudflareaccess.com`**（`kid` = `.env` 的 AUD）；`tunnel-dev.sh --verify` → **OK ⑤**；**用户本人 SSO 登录成功** |
| **A 开发登录入口** | 实施中 | 验收：不预注入 cookie 的 E2E / 生产 404 / 非回环 404-403 |
| **B 401 自诊断** | 待实施 | 验收：Host 不匹配时页面明确指出「Host 不在允许列表」 |
| Service Token（在线 E2E） | **凭据已通** | 带 `CF-Access-Client-Id/Secret` 访问公网 `/admin/users` → **HTTP/2 200**（此前为 302）；`make portal-e2e ARGS=--online` 待跑以关掉该遗留项 |

**本次排查的三条教训（都真的花了时间，值得留档）**

1. **302 ≠ 策略问题**：Access 的 302 `location` 里 `meta` 的 **`service_token_status`** 才是判据 —— `false` = **CF 根本没认出凭据**（团队不符 / 凭据不完整 / token 失效），`true` = 认出了但**策略不允许**。我最初写的脚本提示一律归因于「策略未配」，把你带偏了一轮（已修正）。
2. **团队（Zero Trust team）必须一致**：token 与 Access 应用若不在同一团队，症状与「策略没配」完全一样。核对方法：在创建 token 的团队里，`Applications` 列表是否能看到该主机名的应用。
3. **Shell 陷阱（zsh）**：zsh 的 `read -p` 里 `-p` 是**协进程**而非提示符 ⇒ `read -r -p '…'` 会失败且变量为空，导致「测试看似跑了其实带空值」。**跨 shell 安全写法**：`printf '提示' ; read -r VAR`（不带 `-p`，也不进历史）。另外**长串要按控制台的复制图标**复制，手动框选会截断（本次先出现 38 位带引号的截断值）。

---

## 会话交接（2026-09-22 · 暂停点）

### 本轮研究结果（全部实测）

| 项 | 结果 | 证据 |
| --- | --- | --- |
| **C 真身份路径** | **已完成** | 本机 `Host: memory.agent-mate.ai` → **401**（不再 403）；公网 → **302** 至 `<team-domain>.cloudflareaccess.com`（`kid` = `.env` 的 AUD）；`tunnel-dev.sh --verify` → **OK ⑤**；**用户本人 SSO 登录成功** |
| **Service Token（自动化前置）** | **已打通** | 带 `CF-Access-Client-Id/Secret` 访问公网 `/admin/users` → **HTTP/2 200**（此前一律 302） |
| **登录问题根因** | **已确定** | 门户曾以 `.env.local`（回环 Host）启动 ⇒ 真域名在 Host 判定处被判 `unknown-host` → 403，**Access 断言未轮到**。**不是**网络问题，**不是** Cloudflare 配置问题 |
| **网络（更正后）** | **无问题** | DNS 系统解析与公共解析器一致；HTTPS 全通（404/400/401 均为正常应答）；`cloudflared` 2026.9.1 已装并已授权 |

### 剩余待办

| # | 待办 | 状态 / 阻塞 |
| --- | --- | --- |
| 1 | 在线套件：`PORTAL_E2E_ONLINE_BASE_URL=https://memory.agent-mate.ai make portal-e2e ARGS="--online --port 8789"` | **待跑**（用非 8788 端口，避开与真身份实例的互斥） |
| 2 | 修 `portal-e2e.sh`：**自己启动的实例绑定失败必须 fail-loud** | **已完成（2026-09-23）** —— 端口被占用 ⇒ **退出码 30** + 打印占用进程（实测：拿被占用的 8788 当靶子立即拒绝；空闲端口照常全绿）。原实现无此预检，绑定失败后会把就绪探测打到**别人的实例**上 ⇒ 静默测错实例，本次 403 即由此而来 |
| 3 | **A 开发登录入口** | **已完成** —— `GET/POST /admin/dev-login`，**仅在 `cfg.testJwt.enabled` 时注册**；守卫对该路径**前置放行**；POST 读取 `--dev-login` 的令牌文件 → `Set-Cookie: CF_Authorization; HttpOnly; SameSite=Lax; Path=/` → **303** → `/admin/users`。验收：**不预注入 cookie** 的完整流程 ⇒ 200；缺令牌 ⇒ 页面明确提示 + POST 409；production ⇒ `printRoutes()` 无该路由（未认证仍 401，与所有管理路径一致）；非回环 Host ⇒ 403。**人手验收（2026-09-22）**：用户本人打开 `http://127.0.0.1:8788/admin/dev-login` 点击登录 → **以 `admin@example.test` 身份进入管理面成功** ⇒ Issue 6 流程条款第 3 条（凡要求人做动作的交付必须有人手验收并留证据）已履行。**人手验收（2026-09-23，身份口径改为真实邮箱后重做）**：用户打开 `http://127.0.0.1:8788/admin/dev-login` 点击登录 → 以 **`me@ethanhuang.com`（真实邮箱）** 进入用户列表（截图留存）⇒ **`SBI-V1` 的人手部分完成**。注：2026-09-22 那次的证据随身份口径变更**已失效**（用测试身份验收不等于用真实身份验收）。 |
| 4 | **B 401 页自诊断** | **已完成** —— 401 页在**非生产**下显示：你使用的 Host、自签通道状态、期望的令牌文件、以及「开发登录」入口；**生产不传该上下文** ⇒ 页面与既有行为完全一致（不新增暴露面，仍不暴露验签失败原因） |
| 5 | `secrets.local.hk_vps_4.md` 回写 **Refresh 后**的新 Secret | 待做（否则下次从文件取值会取到已失效值） |
| 6 | Issue 1–5 的收尾：方案 D（PRG + 明文暂存 60 秒）、护栏测试、覆盖率门禁复跑、原型断言复跑（改了 `mockups/assets/portal.css`） | **已完成（2026-09-23 复核）** —— 方案 D 已于 2026-09-22 落地（`issued-stash`：一次性取用 + TTL 60 秒 + 明文不入库不入日志）；覆盖率门禁已复跑（语句 **92.78** / 分支 85.90 / 函数 97.76 / 行 94.26，阈值 92/85/96/93 ⇒ 达标，但**语句边距仅 0.78pt**，见第 3 条）；原型断言已复跑 **159/159**（断言数由 134 增至 159） |

### 对话结果（决策与更正记录）

- **决策**：停用用户**不得签发**（改走独立「恢复访问」动作，已实现并实测：签发入口 0 处 / 恢复入口 2 处 / API 拒绝 400 `user-disabled` / `303` 回跳 / 审计分记 `restore_user`）；明文处理采用**方案 D**（PRG + 服务端暂存，**未实现**）。
- **更正（逐条认）**：①「网络不可达 / cloudflared 装不上」→ 错；②「真身份路径未接通」→ 错（你早已配好）；③「别用真域名」→ **反了**；④ 把 `unknown-host` 归因为「快速路径只允许回环是设计如此」→ 真因是**跑错配置文件**。
- **新增流程条款（长期有效）**：不得凭假设推理（先读配置与进程/隧道状态）；`404/400/401` 是正常应答不是不可达；凡要求人做动作的交付必须有人手验收；「未测」与「不通」分开登记；凭据排查先取判据（`service_token_status`）且团队不一致与策略未配症状相同；跨 shell 命令要验（zsh 的 `read -p` 是协进程）；**误导性的静默失败必须修**（脚本提示、E2E 端口冲突、`/healthz` 就绪探测）。

### 评估：Cloudflare Access 登录 vs 自建 DB 账号密码（留档待决）

| 维度 | Cloudflare Access（现状） | 自建 DB 账号密码 |
| --- | --- | --- |
| **本机/离线开发** | **差** —— 需隧道或注入 cookie（**Issue 6 的根源**）；无 Cloudflare 就登不进 | **好** —— 本机即登录、零外部依赖；Issue 6 这类问题不存在 |
| 一次性配置成本 | **已付清**（隧道 / DNS / Access 应用 / 策略 / AUD / Service Token 全部完成并验收） | 需新建：哈希、会话、CSRF、节流、锁定、重置 |
| 日常运维成本 | **≈0** —— SSO；门户不存凭据；撤销 = 改策略（**即时失效**，`AC10.5`） | **持续** —— 重置密码需**邮件通道**、会话回收、暴力破解防护、凭据泄露处置 |
| 安全风险面 | 集中在**外部配置**（团队 / AUD / 策略 / token 轮换） | 集中在**自己写的认证代码**（最易出错的一类代码） |
| 测试成本 | 需双层（自签 JWT 离线 + Service Token 在线） | 更低（内存库 + 明文断言） |
| 与既有决定 | 即 `ADR-014`（身份只来自**已验证断言**）+ `AC10.9`（门户**不存密码**、无邀请/重置控件） | **二者都需推翻** ⇒ 属 **ADR 级**变更 |
| 切换代价 | — | 重写身份层 + 新增邮件通道 + 改 AC/ADR + 重做验收 |

**结论**：只看「**本机开发能否登录**」，自建确实**更简单**（这正是本次疼痛的来源）；但看**端到端**（安全 / 运维 / 测试 / 合规），自建**显著更重**且是常错面；而 Cloudflare 侧**最贵的一次性配置已付清并通过验收**，现在切换**收益小、代价是推翻两条既有决定**。

⇒ **推荐**：登录仍用 Cloudflare Access；用 **A（受限开发登录入口）** 解决「本机开发登不进」这个真实诉求 —— 成本最低且不与既有决定冲突。若确实要去 Cloudflare 依赖 ⇒ 作为 **ADR 级**议题单独立项（含自建 IdP/OIDC 的中间路线评估），并明确 `AC10.9` 的替代条款与新增风险面。

---

### 修复情况核查（2026-09-22，对运行中实例逐条实测）

> **方法**：不采信文档自述，直接用自签令牌对 `http://127.0.0.1:8788` 发真实请求；无法自动判定的项**明确标注**，不冒充已验证。

| Issue | 实测证据 | 结论 |
| --- | --- | --- |
| **1** 停用仍能签发 | 停用后 `?dialog=issue` 链接 **0** 处、`?dialog=restore` **2** 处；恢复动作 **303** | **已修**（服务层拒绝此前已实测：`{"error":"user-disabled"} [HTTP 400]`） |
| **2** 重名无提示 | 重名 POST 渲染页面含 `data-dialog-error` **1** 处 + 重名文案命中 **2** 次 | **已修**（报错已进弹窗，不再被遮罩盖住） |
| **3** 长文本溢出 | 服务端 CSS 含 `overflow-wrap: anywhere` ✓；但**用户截图实测：建用户弹窗里的路径仍被切碎**（`.portal-data/users/aidan1/` 之类）；另有 1 处真实 `word-break: break-all`（第 1739 行，两份 CSS 同步） | **未修复**（我此前说的「部分修 / `.path` 已收口」**不成立** —— 修的规则**没覆盖弹窗里的路径**；表格与弹窗是两处元素） |
| **4** 明文不显示 | **已按方案 D 实现**（见下）—— 新增 `src/web/issued-stash.ts`（单次取用 / TTL 60s / 上限 32）；`admin-api` 的 issue+rotate HTML 分支改为「暂存 + `portal_issued` cookie + **303 回详情页**」（响应体里不再有明文）；`admin-user-detail` 取用即销毁并清除 cookie；模板新增「明文已过期」提示；词表 +1 条（261 键）。护栏测试 4 条（`tests/integration/issued-once.test.ts`）：T1 303 且 Location 为详情页 · T2 **第二次请求拿不到明文** · T3 单次取用/过期/上限 · T4 明文不入库 | **已实现，待浏览器确认**（`typecheck` 0 错误；测试 251 → **261 项全绿**；覆盖率 **OK** 92.78/85.90/97.76/94.26） |
| **5** 签发报 `not_found` | 详情页绝对链接 **4** 处（`href="/admin/users/<handle>?dialog=…"`） | **已修** |
| **6** 无法登录 | `GET /admin/dev-login` **200**；`POST` 下发 `CF_Authorization` ✓；未认证 401 页含 `data-dev-diagnostics` ✓ | **已修**（C/A/B 三条，均有人手验收） |

**本次核查纠正了我两处不准确表述**：① 「Issue 3 已收口」不准确 —— 只收口了 `.path` 相关规则，另有 **1 处真实 `break-all` 仍在**（第 1739 行，选择器待确认是否影响数据列）；② 我最初把**注释**里的 `break-all` 也计入规则（时报「4 处」，实为 **1** 处规则 + 3 处注释）。

⇒ 这正是流程条款第 1 条（**不得凭假设推理**）的价值：**文档自述不是证据，实测才是**。

### Issue 7: 「handle」是内部术语，用户看不懂（文案缺陷）

- 实测（用户截图）：建用户弹窗里显示「**该 handle 已被占用。**」，用户第一反应是「handle 是什么？看不懂」。
- 同类问题：弹窗字段标签直接写 **`HANDLE`**，且是**硬编码**（未走词表 —— 违反「UI 文案不硬编码」的既有约定）。
- **判定**：可用性缺陷（非功能缺陷）。按设计原则「用使用者能识别的名字命名，而不是按系统实现命名」，内部术语不应直接抛给用户。
- **候选修法**：① UI 主用「**用户标识**」，首次出现处带 `（handle）` 保留领域词对应；② 字段标签走词表，并给一句允许字符说明（小写字母、数字、下划线、连字符）；③ 错误文案改为「这个用户标识已经被占用了」；④ 四语言同步（`Token` 不译的口径不变）。
- **待用户确认**：UI 主词用「用户标识」还是「用户名」（后者更口语，但离仓库领域词 `handle` 更远）。

### 修复进展回填（2026-09-22 第二轮，用户已选定口径）

**用户决策**：① Issue 3 显示口径选 **A** —— 只显示可读尾段 `…/users/<用户名>/`，完整绝对路径放 `title`；② Issue 7 术语选 **B** —— UI 主词用「**用户名**」。

**已实现（尚未经浏览器确认）**：

| 项 | 改动前 | 改动后 |
| --- | --- | --- |
| 弹窗字段标签 | 硬编码 `handle`（违反「文案不硬编码」） | `{{ t('users.field.handle') }}` → 中文「用户名」/ en `Username` / zh-TW「使用者名稱」 |
| 弹窗路径行 | 整条绝对路径 → 绕成 4 行，断在 `-`/`.` 上（`memory.agent-` / `mate.ai`） | `…/users/aidan1/`（一行），完整路径进 `title`（悬停可见） |
| 重名报错 | 该 handle 已被占用。 | 这个用户名已经被占用了。 |
| 列头 | `handle` | 用户名 / Username / 使用者名稱 |
| 其余 5 处含 `handle` 的文案 | 直接用内部术语 | 统一改为「用户名」（四语言，`Token` 不译口径不变） |

**涉及文件**：`src/web/views/admin-users.njk`、`src/web/routes/admin-users.ts`（新增 `usersRootTail`）、`src/web/i18n/*.json`（260 键，四语言一致）。**门禁**：typecheck 0 错误；22 个测试文件全绿；覆盖率 OK（92.75/85.84/97.71/94.05）。

**人手验收（2026-09-22，已完成）**：用户重启服务后肉眼确认 —— 弹窗标签为「用户名」、路径为 `…/users/<用户名>/` 一行（悬停可见完整路径）、重名报错为「这个用户名已经被占用了。」⇒ **Issue 3（按方案 A）与 Issue 7（按方案 B）均已修复**。

登记纪律说明：本条的状态由「已实现，待确认」改为「已修复」，唯一依据是**用户本人的肉眼确认**（流程条款第 3 条），而不是代码阅读或测试通过 —— 我此前两次凭推理宣布 Issue 3 修好，两次都被实测推翻。

**仍待做**：① **阶段 3 原型同步** —— `SBI-P1`（开发登录页 + 401 自诊断块）**已交付**（`08-signin.html` / `09-dev-login.html`，断言由 134 增至 **159**；本轮补上 `index.html` 缺失的 09 入口与失败态变体），`SBI-P2`/`SBI-P3`（Issue 1–5 界面修正、本轮弹窗版式同步）**未做**；② **阶段 2 文档登记** —— `web-stories`/`web-design`/`web-test` 的 AC 与用例登记（`SBI-D1`–`D5`）**未做**；③ **覆盖率语句边距补测** —— 实测 **92.78**（阈值 92，**边距仅 0.78pt**）⇒ 仍待补。⚠️ 数字口径：本条此前写的 92.75 与 [`sprint-backlog.md`](../sprint-backlog.md) 的 94.87 是**不同时间点**的值（后者是 `PSP-W1` 完成时；其后新增代码未同步补测 ⇒ 覆盖率回落），不是记录错误。薄弱点：`admin-api.ts` 语句 78.07% · `dev-login.ts` 分支 75%（`readToken` 异常分支）。

### Issue 8: Long token prefix runs past the dialog border

- In the rotate dialog the token prefix (`memo_pDBN7TtZ`) runs past the right edge of the box.
- The issue dialog shows the same shape on its token-prefix row ("generated after issuing").

**判定**：可用性缺陷（视觉/布局）。与 **Issue 3（长路径撑破表格）同源** —— 都是「不可断的长串 + 过窄的容器」。

#### 根因（数字全部实测，非推算）

| 环节 | 事实 |
| --- | --- |
| 弹窗宽度 | `.dialog { max-width: 22rem }`，且本项目 `html { font-size: 17px }` ⇒ **374px**，内宽 304px |
| 目标块可用宽 | 再减 `.dialog-target` 左右内边距 ⇒ 283px |
| 标签列 | `.key-meta { grid-template-columns: 168px minmax(0,1fr) }` + 1.25rem 间距 ⇒ 值列 **94px** |
| 串的实际宽度 | `memo_XXXXXXXX` = **123px** |
| 为什么不换行 | `.mono` 并没有 `nowrap`（第一次诊断猜错了）；真因是**下划线不产生断行点**，而 `overflow-wrap` 默认 `normal` ⇒ 无处可断，只能溢出 |
| 结构错配 | 「键值表转单列」的规则挂在 `@media (max-width: 960px)` 上，按**视口**判断；而弹窗**任何视口下都只有 22rem 宽** ⇒ 该规则永远救不了弹窗 |

**先失败、后修复的护栏证据**（Playwright 实测）：

```
修复前：.key-meta-value   scrollWidth=123   clientWidth=94
修复后：值列 123px / 盒子 322px ⇒ scroll == client
```

#### 修法（两次；第二次取代第一次）

1. **2026-09-22（止血）**：标签列 168px → 7.5rem，值列加 `overflow-wrap: anywhere`；并删除 `.key-meta*` 在文件后段的**重复定义**（列宽与字号都不同 —— 正是 Issue 3 那类「两条规则互相抵消」的隐患）。
2. **2026-09-23（用户评审：布局不好看 ⇒ 重新设计）**：弹窗宽度 **+50%（22rem → 33rem；实测 374 → 561px）**；目标块由「固定标签列 + 值列」改为**两列规格栏** —— 每个字段「标签在上、值在下」自成一体，两列等宽分占整行。**固定标签列宽从结构上被取消** ⇒ 7.5rem 这类救火数字随之删除。

#### 新增护栏（不让它再靠肉眼发现）

- `tests/e2e/portal_flow.py` 的 `assert_no_overflow()`：**6 个弹窗 × 2 视口（1280/720）+ 详情页键值面板**，量 `scrollWidth`／父容器右边界／整页横向滚动，失败时报出具体数字。
- 同处新增**弹窗宽度断言**（33rem）：按**根字号换算**而非硬编码像素 —— 第一版写死 528px 造成过一次**假失败**（本项目 1rem = 17px，真值 561px）。
- 同处新增**目标块几何断言**：两个字段并排（同列即同一字段）、标签在值上方、第二字段越过容器中线（确认宽度真的被用上，而不是又留一片死白）。

#### 顺带修好的既有缺陷（同类：坏了却没人发现）

`scripts/portal-e2e.sh`（官方 E2E 入口）此前**根本无法启动**：启用自签通道时 `PORTAL_TEST_JWT_EMAIL` 是必填（`config.ts` 校验），脚本未传 ⇒ 官方 E2E 长期跑不起来。这也是「这类缺陷只能靠人眼发现」的原因之一 —— 唯一能自动发现布局问题的入口是坏的。

#### 流程条款（第 4 条，承接 Issue 6）

**布局类改动必须附一条可机器判定的几何断言，并在改前先看到它失败。** 我此前两次宣布「CSS 已收口」，两次都被用户肉眼推翻；根因是「读规则」不等于「量结果」—— 规则可以自相矛盾而看起来收口了，只有量出来的宽度不会说谎。

### Issue 9: Status label wraps into two lines in the users table

- 用户列表的「状态」列把「已吊销」显示成「已吊 / 销」两行（2026-09-23 由用户截图发现）。

**判定**：可用性缺陷（视觉/布局）。与 **Issue 8 同源**（容器窄 + 内容不可断），但**失效方向相反**：Issue 8 是「无法断行 ⇒ 溢出」，本案是「默认允许任意字符间断行 ⇒ 折成两行」。

#### 根因（实测数字）

| 环节 | 事实 |
| --- | --- |
| 表格布局 | 默认 `table-layout: auto`；「库路径」列按内容拿到 **635px**（表格总宽 1012px） |
| 状态列可用宽 | 仅 **57px** |
| 「已吊销」所需宽 | 49（文本）+ 7（状态点）+ 约 7.65（`gap: 0.45rem`）≈ **64px** ⇒ 超出 7px |
| 为何折行而非溢出 | 中文**允许任意字符间断行**（CJK 默认行为）⇒ 超宽部分转成第二行 |
| 修复前实测 | `.status`「已吊销」h=**50** / line-height=25.2 ⇒ **2 行**；「正常」h=25 ⇒ 1 行 |

#### 修法

`.status` 加 `white-space: nowrap`（状态标签语义上不可拆）；auto 布局随后把状态列自适到 **69px**。两份 `portal.css` 同步，**sha256 逐文件一致** ✓。

**修复后实测**：「已吊销」w=61 / h=**25** ⇒ **1 行** ✓

#### 新增护栏

`tests/e2e/portal_flow.py` 的 `assert_status_single_line()`：断言每个 `.status` 的高度 ≤ 行高的 1.5 倍。修复前该断言必然失败（h/line-height = 50/25.2 ≈ **2.0** > 1.5）—— 与探针量到的 2 行是同一判据。

#### 为什么之前没抓住（与 Issue 8 同一机制）

实现侧护栏此前只查 `scrollWidth > clientWidth`（**溢出**），而折行**不产生溢出** ⇒ 检测不到；原型静态断言只验证渲染结果，不验证「不该断的地方有没有断」。⇒ 护栏要覆盖**两个方向**：溢出（`scroll > client`）与**意外折行**（高度 > 单行）。

### Issue 6 状态更正（2026-09-23，用户判定）—— **不关闭**

**用户判定**：**不同意关闭 Issue 6** —— 「还缺少 e2e 用户验证」。

因此本条**不作「已修复」登记**，并把此前漏掉的验收边界补齐：

| 已验（机器） | **未验（人手）** |
| --- | --- |
| 本机 `Host: memory.agent-mate.ai` → 不再 403；公网 → 302 到 `*.cloudflareaccess.com`；Service Token → 200；开发通道登录可达 | **完整链路的人手走通**：处于 log out 状态 → 点 login → **出现 Cloudflare 登录窗口并登录成功** → **可访问 users page** |

**关闭条件（2026-09-23 新增）**：新增**登出**功能（入口在**左侧菜单栏**，同步 `mockups`）后，由**用户本人**走通上述四步并留**截图**；本条记录里必须含该截图与链路四步。判定依据 = 流程条款 3（凡交付物要求「人做某个动作」，验收必须包含一次真实人手操作并留证据）；方案见 [`web-login-plan.md`](./web-login-plan.md) **§9 登出与会话退出**（`SBI-L7` 即本条的关闭判定）。

**教训（并入 Sprint 4 回顾）**：此前把「服务端能被验证」当成「人能登录」—— 用 curl（请求头）与 Playwright（程序化 cookie）的通过**替代了人手验收**，这正是 Sprint 4 回顾里「验证方式与真实使用方式不一致」的同一条。

### Issue 9: 401 page says "NOT DELIVERED YET" — eyebrow copy reused from the placeholder page

- 未登录访问 `/admin/users` 时，页面顶部显示「**尚未交付**」（英文 `NOT DELIVERED YET`），紧接着才是「需要登录 / Sign in required」。
- 观感上像「这个功能还没做」，而不是「你还没有身份」—— 我在收到用户截图时也曾据此误判为「占位页」。

**判定**：可用性缺陷（文案）。属「**错误提示应该如何处理**」这一类（用户本轮经验第 3 条）。

#### 证据（实测）

| 事实 | 证据 |
| --- | --- |
| 401 页的 eyebrow 复用了**公开面占位页**的键 | `admin_portal/src/web/views/unauthorized.njk` 用 `t('placeholder.eyebrow')`；该键的译文是「尚未交付」/`NOT DELIVERED YET` |
| 实际渲染 | `curl -H 'Host: 127.0.0.1' /admin/users`（无 cookie）⇒ `<h1>需要登录</h1>` 之前渲染出「尚未交付」；真浏览器截图见 `admin_portal/tests/e2e/artifacts/401-page-zh.png` |
| 同一页另有真实缺口 | 生产环境下该页只有「接入说明」可点，**没有登录入口**（开发环境才有「以测试管理员身份登录」）⇒ 用户要求的「点 login」在生产是空的 |

#### 修法（并入 [`web-login-plan.md`](./web-login-plan.md) §9 的 `SBI-L6a` / `SBI-L3`）

1. 新增**专用** eyebrow 键（如 `unauth.eyebrow`）并给四语言译文（中文口径：「需要身份」或直接去掉 eyebrow，取评审意见）。
2. **原型先行**（[`ADR-018`](../adr/ADR-018-mockup-as-clickable-simulation.md)）：`mockups/` 目前**没有 401 页**，需新增该页原型（含**登录入口**）并交用户确认。
3. 生产环境的 401 页补**登录入口**（指向 `/admin/users`，由 Access 接管并弹出 Cloudflare 登录窗口）。
4. 承接（[`ADR-019`](../adr/ADR-019-spec-basic-constraints-and-executable-uptake.md)）：为「未认证时的提示口径」补一条断言（渲染中不得出现「尚未交付」），并登记四语言键集合一致性由既有护栏覆盖。

**状态**：待修（随 `SBI-L6a` 一起做；本条的关闭依据同样是**原型确认 + 实现后的人手确认**）。
