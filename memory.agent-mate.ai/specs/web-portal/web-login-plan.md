# web-login-plan — 登录可用性恢复方案（C + A + B）

> **定位**：[`issues-log.md`](./issues-log.md) **Issue 6 [FATAL] 无法登录** 的处置方案。只写「怎样让登录可用、按什么顺序、怎样算完成」。
> **状态**：v2 · as_of 2026-09-23 · **C/A/B 已交付**；**§9「登出与会话退出」待批准**（尚未改代码）
> **2026-09-23 用户判定：Issue 6 不关闭** —— 「还缺少 e2e 用户验证」；关闭条件见本文件 §9.4 的 `SBI-L7`。
> **互链**：设计（认证模型）见 [`web-design.md`](./web-design.md) · 故事与 AC 见 [`web-stories.md`](./web-stories.md) · 测试见 [`web-test.md`](./web-test.md) · 排期见 [`../sprint-backlog.md`](../sprint-backlog.md)
> **上游事实基准（2026-09-22 实测）**：`cloudflared` **2026.9.1** 已装并已授权；命名隧道 **`portal-dev`** 在线运行（`cloudflared tunnel run --url http://127.0.0.1:8788 portal-dev`）；`memory.agent-mate.ai` / `mcp.agent-mate.ai` 均解析到 Cloudflare；`admin_portal/.env` 已含**真实** team domain 与 AUD。
> **边界**：不写密钥与真实值（真值只存在于本机被忽略的 `admin_portal/.env`）；不写部署动作。

---

## 0. 一页结论

| 路径 | 作用 | 当前状态 | 本次动作 |
| --- | --- | --- | --- |
| **C 真身份** | 生产登录（`AC10.1` / `AC10.5`） | **≈95% 就绪**：隧道在跑、DNS 已指向 Cloudflare、Access 应用与 AUD 已配 | **换配置启动门户**（唯一缺项） |
| **A 开发登录入口** | 本机开发路径也能「登录」 | 不存在 —— 靠手工注入 cookie（**这就是 Issue 6**） | 新增**受限**路由 |
| **B 401 自诊断** | 分清「未登录」与「Host 不对」 | 不存在（两类原因**同形**） | 401 页加诊断块 |

**顺序：C → A → B。** C 解当前阻塞且几乎零成本；A/B 是开发路径的根治；三者共用同一段身份解析与同一套失败语义，**互不作废**。

---

## 1. 根因（更正后）

门户以 `.env.local`（回环 Host）启动，而隧道把 `memory.agent-mate.ai` 转发到**同一端口** ⇒ 真域名在 **Host 判定**处被判 `unknown-host` → **403**，**Access 断言根本没轮到**。

- 证据：本机 `Host: memory.agent-mate.ai` → **403**；日志 `face_denied reason=unknown-host path=/admin/users/ethanhuang`；同一进程下 `Host: mcp.agent-mate.ai` → **200**
- 判决：**不是网络问题，也不是 Cloudflare 配置问题**，是**启动配置与隧道目标不匹配**

---

## 2. C —— 接通真身份路径（先行）

**动作（全部为启动与验证，无代码改动）**

1. 停快速路径实例 → `bash scripts/portal-dev.sh --env-file admin_portal/.env`
   —— **不带** `--dev-login`：真身份路径不使用自签测试通道（非回环 Host 上启用该通道会被启动期拒绝）。
2. 自检（两条，缺一不可）：
   - 本机：`curl -H 'Host: memory.agent-mate.ai' http://127.0.0.1:8788/admin/users` ⇒ **不再是 403**；
   - 公网：`curl -D - https://memory.agent-mate.ai/admin/users` ⇒ **302 → `*.cloudflareaccess.com`**（证明 Access 已接管）。
3. 浏览器走 SSO（Google 主 / 邮箱一次性验证码兜底）→ 进入管理面 → **留截图（人手证据）**。
4. `bash scripts/tunnel-dev.sh --verify --hostname memory.agent-mate.ai`。

**待收口的口径问题**

- **`PORTAL_ENV`**：真身份路径语义上应为 `production`（强制 team domain + AUD，并**拒绝**自签通道）。建议 C 走通后切换，并补反向用例：`production` + `PORTAL_TEST_JWT_ENABLED=1` ⇒ **启动被拒**。
- **Access 策略**：Allow 至少 **2 个邮箱**（`AC10.6`）；Session Duration 记录**控制台实际档位**（`AC10.7`，不得把「目标 3 个月」当成既有能力）。
- **`mcp.agent-mate.ai` 必须显式 Bypass**：命令行客户端无法完成 SSO 重定向。

**验收**：`make portal-e2e ARGS=--online`（需 Service Token 环境变量，且该 Token **必须已加入该 Access 应用策略** —— 漏配会拿到 302 而非 200，`--verify` 会当场指出）。

---

## 3. A —— 开发登录入口（随后）

- `GET /admin/dev-login` **仅在** `PORTAL_ENV=development` **且** 自签测试通道启用 **且** Host 为回环时**注册路由**；其余配置下该路由**不存在**（处理方式是「没有」，而不是「存在但拒绝」）。
- `POST /admin/dev-login` → `Set-Cookie: CF_Authorization=<自签令牌>; HttpOnly; SameSite=Lax; Path=/` → **303** → `/admin/users`。
- **不是新增旁路**：注入的就是既有自签测试通道的令牌（**同签发器、同 JWKS、同校验**）。
- 文案入四语言词表（不硬编码）；`--dev-login` 由「打印一串要粘的字符串」改为「打印**可点链接**」。

**验收（3 条，可机器判定）**

1. **E2E：真浏览器 + 不预注入 cookie** → 打开 → 点登录 → 用户列表 **200**（把 Issue 6 固化为回归防护）。
2. `PORTAL_ENV=production` ⇒ **已认证**的管理员访问 `/admin/dev-login` → **404**（路由不存在）。

   > **写法更正（接线核实后）**：不能断言「未认证也是 404」。`registerAdminGuard` 对 `/admin*` 是**身份先于路由**（未认证者探测不到管理路径是否存在 —— 这是既有安全模型，见 Issue「相对链接」同一批修正中的用例）。因此未认证访问该路径得到的是 **401**，与所有管理路径一致。
3. 非回环 Host ⇒ **404/403**（面隔离先拒）。

**实现要点（2026-09-22 接线核实后补）**

1. **守卫必须显式豁免**：`/admin*` 一律先过 `registerAdminGuard` ⇒ `/admin/dev-login` 会被拦成 401。需要在守卫内**前置放行该路径**，且**仅在入口启用时**（否则等于放宽守卫）。
   —— 放行条件收敛为单一判据：**`cfg.testJwt.enabled`**。理由：配置层已强制「启用自签通道 ⇒ 两个面都必须是回环 Host」，且 `PORTAL_ENV=production` 下启用该通道会被**启动期拒绝**，故该判据**同时蕴含** development 与回环两条约束，无需新增不变量。
2. **不新增签发代码、不把私钥引入应用进程**：`POST /admin/dev-login` 直接读取 `--dev-login` **已产出**的令牌文件（新增配置键 `PORTAL_TEST_JWT_TOKEN_FILE`，默认指向 `.portal-data/dev/token`），把它写入 `CF_Authorization` cookie。令牌过期时页面**明确提示**「重新运行 `--dev-login`」，而不是给一个无法解释的失败。
3. **路由装配位置**：与其它路由同批注册，但**条件注册**（`cfg.testJwt.enabled === true` 才 `registerDevLoginRoutes`）。

---

## 4. B —— 401 页自诊断（与 A 同批）

- 显示：当前 Host / **允许的 Host 列表** / 自签通道状态 /（仅开发）令牌文件路径与「以开发身份登录」按钮。
- **验收**：构造 Host 不匹配 ⇒ 页面**明确指出**「Host 不在允许列表」，而非笼统的 401/403。

---

## 5. 流程条款（本次教训固化，已同步 `issues-log.md`）

1. **不得凭假设推理**：下结论前必须读**配置的实际内容**与**进程/隧道的实际状态**。
2. **`404`/`400`/`401` 是正常应答，不是「不可达」**：可达性看「有无应答」。
3. **凡交付物要求「人做某个动作」，验收必须包含一次真实人手操作并留证据。**
4. 「**未测**」与「**不通**」必须分开登记。
5. **凭据类排查先取判据再动手**：Access 用 `service_token_status` 区分「未认出凭据」与「策略不允许」；团队不一致的症状与策略未配**完全相同**。
6. **跨 shell 的可粘贴命令要验**：zsh 的 `read -p` 是**协进程**而非提示符 ⇒ 统一用 `printf '提示'; read -r VAR`（不带 `-p`，也不进历史）；长串一律用控制台**复制图标**，手动框选会截断。

---

## 8. 收口记录（2026-09-22）

- **C 真身份路径：已完成** —— 本机 `Host: memory.agent-mate.ai` → 401（不再 403）；公网 → 302 至 `<team-domain>.cloudflareaccess.com`；`--verify` → **OK ⑤**；**用户本人 SSO 登录成功**。
- **Service Token（自动化路径前置）：已通** —— 带 `CF-Access-Client-Id/Secret` 访问公网 `/admin/users` → **HTTP/2 200**。
- **待跑**：`make portal-e2e ARGS=--online`（关掉明细表最后一个未完成项）。
- **A（受限开发登录入口）：已完成** —— `src/web/routes/dev-login.ts`（新）+ `admin-guard.ts` 前置放行（单一判据 `cfg.testJwt.enabled`）+ `server.ts` 条件注册 + `views/dev-login.njk`（新）+ 四语言词条；**令牌文件由 JWKS 目录推导**（内联 JWKS 时回退到 `<dbPath 目录>/dev/token`，见 `resolveTokenFile`），**不新增签发代码、不把私钥引入应用进程**。
- **B（401 页自诊断）：已完成** —— `unauthorized.njk` 增加 `devDiagnostics` 块（**仅非生产**渲染）；生产不传该字段，401 页与既有行为一致，且仍**不暴露验签失败原因**（原因只进结构化日志）。
- **验收（全部机器可判定，`tests/integration/dev-login.test.ts`，6 例）**：不预注入 cookie 的完整登录流程 ⇒ 200；缺令牌 ⇒ 提示 + 409；production ⇒ 路由不存在；非回环 Host ⇒ 403；开发实例 401 页含自诊断；生产实例 401 页不含。
- **门禁**：`typecheck` 0 错误；测试 **247 → 251 项全绿**；覆盖率 **OK**（语句 93.03 · 分支 85.86 · 函数 97.70 · 行 94.39 ≥ 阈值 92/85/96/93）；词表 259 键、四语言键集合一致，且中文变体口径（`Token` 不译）由既有护栏 `i18n-keys.test.ts` 校验通过。
- **仍未做**：`portal-e2e.sh` 的「绑定失败必须 fail-loud」修复（本轮已登记，未实施）。
- **2026-09-23 补：上述 fail-loud 已实施并验证 —— 结掉 2026-09-22 登记的那条工具缺陷**（`change-log.md` 当日行原文：「离线套件以 403 失败（`Forbidden: request host does not match this face`），根因是**真身份实例仍占用 8788 端口** ⇒ E2E 自己启动的回环实例绑定失败、浏览器打到了配置为真域名的那个实例」）。修后：端口被占用时脚本打印**占用进程**并以 **退出码 30** 拒绝启动；空闲端口照常全绿（实测 8792 通过；本机 8788 上长期跑着一个 `--dev-login` 实例，正是该陷阱的现场）。
- **2026-09-23 补**：`ADR-015` 已落档并按 ADR-014 惯例登记（见 §6）。
- **2026-09-23 补：在线套件的「明确跳过」语义已实测** —— 缺前置时 `scripts/portal-e2e.sh --online` ⇒ **退出码 40** + `SKIP: 在线套件跳过 —— 未提供 PORTAL_E2E_ONLINE_BASE_URL`。**同时量到一处口径陷阱**：`make portal-e2e ARGS=--online` 会把非零码折叠为 **2**（实测），即「跳过」与「失败」在 make 层面不可分 ⇒ 机器调用方须**直接调用脚本**（脚本头已写明）。
- **仍未做（需持有者执行）**：在线套件的**真链路运行** —— 需要 `PORTAL_E2E_ONLINE_BASE_URL` 与 Access **Service Token** 两个环境变量（§2 已述：该 Token 必须已加入该 Access 应用策略，漏配会拿到 302 而非 200）。**登记口径**：这是「**未测**」，不是「不通」—— 链路本身已于 2026-09-22 由 `tunnel-dev.sh --verify`（Service Token → HTTP 200、OK ⑤）验证过。

---

## 6. 已决 ADR：`ADR-015`（2026-09-23 落档）

开发登录入口的**存在条件**与**声明方式**已决议并落档：[`../adr/ADR-015-dev-login-entry-config-gated-registration.md`](../adr/ADR-015-dev-login-entry-config-gated-registration.md)。

- **存在条件**：选「**配置限制注册**」—— `server.ts` 仅在 `cfg.testJwt.enabled` 时注册该路由（`if (cfg.testJwt.enabled) registerDevLoginRoutes(app, deps);`），生产配置下该路由**不存在**（是「没有」，不是「存在但拒绝」）。守卫豁免同样收敛为**单一判据** `cfg.testJwt.enabled`（`admin-guard.ts`）。
- **声明方式**：选「启动横幅显式声明 + 给出**可点链接**」—— `scripts/portal-dev.sh` 已如此输出（「打开 …/admin/dev-login → 点击『以测试管理员身份登录』」，不需要 F12、不需要粘 cookie）。
- **登记处（与原写法的偏差）**：原写「在 [`../architecture.md`](../architecture.md) §2 登记决议号」，但 §2.1 是**产品级** D1–D10 决议表，`ADR-014`（门户身份，同属门户实现层）并不在其中 ⇒ 为与既有惯例一致，本 ADR 与 ADR-014 同处登记于 [`../knowledge/web-portal/portal-implementation-notes.md`](../knowledge/web-portal/portal-implementation-notes.md)（frontmatter `related:` + Links）。若产品级视角也需一行，示意后我再补 §2.1。

---

## 7. 显式不做

- 把令牌放进 URL 查询参数（凭据会进历史与访问日志，且是新增旁路）。
- 为登录问题**放宽 Host 白名单**（那会把 Issue 6 换成更严重的暴露面问题）。

---

## 9. 登出与会话退出（2026-09-23 新增，**待批准**）

> **定位**：用户判定 **Issue 6 不关闭** —— 「还缺少 e2e 用户验证」。本节把「登出」与「完整链路验收」一起定义：**登出是链路的起点，链路走通才是 Issue 6 的关闭条件**。

### 9.1 用户要求（原话口径）

1. **登出功能**：入口放在**左侧菜单栏**；**同步更新 mockups**。
2. **完整链路**（= Issue 6 的验收）：处于 **log out 状态** → **点 login** → **出现 Cloudflare 登录窗口并登录成功** → **可以访问 users page**。

### 9.2 设计决策（拟落 `ADR-020`）

| 问题 | 事实（已核对） | 决定（提案） |
| --- | --- | --- |
| **谁来结束会话** | 门户**没有自己的会话**（`ADR-014`：身份只来自 Access 断言）。因此**只清 `CF_Authorization` cookie 不会结束 Cloudflare 的 SSO 会话** ⇒ 用户会被 Access **静默重新登录**，表现成「登出无效」 | **登录态**：`POST /admin/logout` → **302 到** `https://<teamDomain>/cdn-cgi/access/logout`（`cfg.access.teamDomain` 已在配置中）；**开发通道**（团队域为空）：清 `CF_Authorization` cookie 后回到登出态 |
| **入口放哪** | 侧栏 `<nav class="nav">` 渲染的是**导航目的地**（4 项，来自 `navItems`） | 登出是**会话动作**、不是目的地 ⇒ 放在侧栏**底部的独立「会话区」**（与导航之间有分隔线），**不塞进 `navItems`** |
| **链接还是表单** | 第三方页面可用 `<img src="/admin/logout">` 触发 GET 登出（CSRF-登出） | 用 **POST 表单**（`layout.njk` 已有表单式控件先例：语言组与建用户表单） |
| **登出后落点** | — | 回门户的**登出态**：开发通道回 401 页（含登录入口）；生产由 Access 登出流程决定（**待 `SBI-L0` 探针确认**）。`?next=` **只允许站内相对路径**（防开放重定向） |
| **未登录时访问登出** | — | **幂等**：仍跳到登出态（不报错、不 401）；作为「状态前置条件」写进 spec（`ADR-019`） |
| **回退键** | 登出后按浏览器回退不得看到管理面内容 | 管理面响应加 **`Cache-Control: no-store`**；由 E2E 断言覆盖 |

### 9.3 四类基本约束（`ADR-019`：spec 必须写明，且每条配一条用例）

| 约束 | 行为 | 承接 |
| --- | --- | --- |
| **重复 / 冲突** | 连点两次登出：第二次仍安全（幂等），不产生额外副作用 | 集成 + E2E |
| **不存在** | 会话 / 断言已失效时登出：仍回到登出态 | 集成 |
| **非法输入** | `?next=https://evil.example` ⇒ **忽略**，只接受站内相对路径 | 集成（安全用例） |
| **并发与二次操作** | 登出后按回退：不得看到管理面内容（`no-store`）；两个标签页其一登出后，另一个再操作 ⇒ 落到 401 页 | E2E |
| **状态前置条件** | 登出入口只在**已认证的管理面**渲染；401 页只渲染**登录**入口（不含登出） | 集成 + 原型断言 |

### 9.4 SBI 拆分（`ADR-016` 颗粒度；`ADR-017` 高复杂度先探针）

| SBI | 交付物 | 接收方 | 端到端判据 | 依赖 |
| --- | --- | --- | --- | --- |
| **SBI-L0（探针）** | 用**真身份实例**回答三个问题：① Access 登出端点的确切路径与是否接受返回地址；② 登出后落到哪里；③ **是否清掉 SSO 会话**（能否做到「登出后访问 `/admin/users` 必须重新出现 Cloudflare 登录窗口」）。产物**不产品化**，结论落档（命令 + 原始响应片段） | `SBI-L3` | 三问各有明确判定；**若 ③ 为「不能」⇒ 立即停下改设计**（备选：只清门户 cookie + 明确提示「需在 Cloudflare 侧登出」），不得直接实现 | 持有者（需真身份会话） |
| **SBI-L1** | `ADR-020`：登出入口与会话退出（含 9.2 全部决定、备选与代价） | 评审 | 覆盖 9.2 每一行；写明「不采纳门户自建会话」「不采纳 GET 登出」的理由 | — |
| **SBI-L2** | `web-stories.md` 新增 `AC10.x`（登出行为 + 链路验收）+ 四类约束与状态前置条件 | 评审 | AC 编号连续；每条 AC 在 `web-test.md` 有对应用例号（**0 悬空**） | — |
| **SBI-L3** | 实现：`POST /admin/logout`（两种模式）+ 侧栏底部会话区入口 + 401 页「登录」入口 + `no-store` + 词表 ×4 | 用户 | **开发通道可点通**：登出 → 点登录 → 到 users page | `SBI-L0` · `SBI-L1` · **`SBI-L6a`（UI 先确认）** |
| **SBI-L4** | 集成测试：9.3 五行逐条 | 实现期 | 每条约束一条用例，全绿 | `SBI-L3` |
| **SBI-L5** | E2E：**开发通道自动跑完整链路**（登出 → 点登录 → users page）+ 真身份链路的**人手验收清单**（含截图要求） | 用户 | 自动部分进门禁；人手部分留截图 | `SBI-L4` |
| **SBI-L6a（原型先行）** | `mockups/`：**新增 401 页**（含**生产环境的登录入口**、并修掉其「尚未交付」eyebrow，见 Issue 9）· **新增开发登录页** · **侧栏会话区** + 可点击仿真（点登出 → 落点可走） | **用户（UI 增量确认）** | 三处 UI 可点可看；两份 `portal.css` sha256 一致；原型断言覆盖新页 | — |
| **SBI-L6b（原型收口）** | 同步实现后的最终版式，扩展原型断言（登出落点 / 登录入口 / 会话区） | 评审 | 原型断言全绿；与实现渲染一致 | `SBI-L3` |
| **SBI-L7** | **Issue 6 关闭判定**：只有**人手走通真链路并留证据**才关闭 | 用户 | `issues-log.md` 的关闭记录含**截图**与**链路四步**（流程条款 3） | `SBI-L5` |

### 9.5 影响面（已核对）

- `admin_portal/tests/e2e/portal_flow.py:145` 的「导航 4 项」断言：因登出**不进** `navItems`，语义不变；另加一条「会话区 1 项」断言。
- 原型 134 项断言：新增登录入口与侧栏会话区会改变导航区渲染 ⇒ 需复跑并按实际差异更新（含两份 CSS 的 sha256 一致性）。
- 词表：新增 `nav.logout` 与 401 页的登录入口文案 ⇒ 四语言键集合一致（既有护栏 `i18n-keys.test.ts` 会拦住漏翻）。
- **不冲突**：`AC10.9`（门户不存密码）· `D11`（管理员变更在 Cloudflare 侧）· `ADR-014`（身份只信断言）—— 登出只是让浏览器离开 Access 会话，**不引入第二套认证**。
- **不采纳**：门户自建会话 / 自建登出（会变成第二套认证状态，与 `ADR-014` 直接冲突）；把登出做成 GET 链接（可被第三方页面触发）。

**执行顺序（2026-09-23 修正）**：**原型先行** —— `L0（探针）` → `L6a（原型：401 页含登录入口 + 开发登录页 + 侧栏会话区）` → **交用户确认 UI** → `L1`/`L2` → `L3（实现）` → `L4` → `L5` → `L6b（原型收口）` → `L7`。

- **修正理由**：上一版把「实现」排在「原型」之前，与用户要求（**同步更新 mockups**）及 [`ADR-018`](../adr/ADR-018-mockup-as-clickable-simulation.md)（原型即可点击的全路径仿真、UI 增量确认）冲突。

**已核对的页面缺口（2026-09-23）**：`mockups/` 仅有 7 个文件（`01`–`06` + `index`），**没有 401 页、也没有开发登录页** —— 两者目前只存在于实现（`unauthorized.njk` / `dev-login.njk`）。因此生产环境下 401 页**只有「接入说明」可点**、**没有 login 入口**（开发环境才有「以测试管理员身份登录」）⇒ 用户要求的「**点 login**」在生产是空的，`SBI-L6a`/`SBI-L3` 必须补上，且**原型先于实现**。

**顺带核出的一处文案缺陷（2026-09-23）**：401 页的 eyebrow 复用了 `placeholder.eyebrow`，实际渲染为「**尚未交付**」（en `NOT DELIVERED YET`）—— 401 页要说的不是「尚未交付」，而是「**你还没有身份**」。已另立 **Issue 9**（[`issues-log.md`](./issues-log.md)），并入 `SBI-L6a` 一并修正（四语言）。
