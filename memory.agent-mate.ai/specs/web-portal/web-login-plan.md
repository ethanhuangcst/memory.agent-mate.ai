# web-login-plan — 登录可用性恢复方案（C + A + B）

> **定位**：[`issues-log.md`](./issues-log.md) **Issue 6 [FATAL] 无法登录** 的处置方案。只写「怎样让登录可用、按什么顺序、怎样算完成」。
> **状态**：v1 · as_of 2026-09-22 · **方案待批准**（尚未改代码）
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

- **C 真身份路径：已完成** —— 本机 `Host: memory.agent-mate.ai` → 401（不再 403）；公网 → 302 至 `sparkling-sun-3355.cloudflareaccess.com`；`--verify` → **OK ⑤**；**用户本人 SSO 登录成功**。
- **Service Token（自动化路径前置）：已通** —— 带 `CF-Access-Client-Id/Secret` 访问公网 `/admin/users` → **HTTP/2 200**。
- **待跑**：`make portal-e2e ARGS=--online`（关掉明细表最后一个未完成项）。
- **A（受限开发登录入口）：已完成** —— `src/web/routes/dev-login.ts`（新）+ `admin-guard.ts` 前置放行（单一判据 `cfg.testJwt.enabled`）+ `server.ts` 条件注册 + `views/dev-login.njk`（新）+ 四语言词条；**令牌文件由 JWKS 目录推导**（内联 JWKS 时回退到 `<dbPath 目录>/dev/token`，见 `resolveTokenFile`），**不新增签发代码、不把私钥引入应用进程**。
- **B（401 页自诊断）：已完成** —— `unauthorized.njk` 增加 `devDiagnostics` 块（**仅非生产**渲染）；生产不传该字段，401 页与既有行为一致，且仍**不暴露验签失败原因**（原因只进结构化日志）。
- **验收（全部机器可判定，`tests/integration/dev-login.test.ts`，6 例）**：不预注入 cookie 的完整登录流程 ⇒ 200；缺令牌 ⇒ 提示 + 409；production ⇒ 路由不存在；非回环 Host ⇒ 403；开发实例 401 页含自诊断；生产实例 401 页不含。
- **门禁**：`typecheck` 0 错误；测试 **247 → 251 项全绿**；覆盖率 **OK**（语句 93.03 · 分支 85.86 · 函数 97.70 · 行 94.39 ≥ 阈值 92/85/96/93）；词表 259 键、四语言键集合一致，且中文变体口径（`Token` 不译）由既有护栏 `i18n-keys.test.ts` 校验通过。
- **仍未做**：`portal-e2e.sh` 的「绑定失败必须 fail-loud」修复（本轮已登记，未实施）。

---

## 6. 待决 ADR（候选 `ADR-015`）

开发登录入口的存在条件与声明方式：**「配置限制注册」vs「注册但拒绝」**；以及是否在启动横幅显式声明该入口已启用。决议后落 `specs/adr/ADR-015-*.md`，并在 [`../architecture.md`](../architecture.md) §2 登记决议号。

---

## 7. 显式不做

- 把令牌放进 URL 查询参数（凭据会进历史与访问日志，且是新增旁路）。
- 为登录问题**放宽 Host 白名单**（那会把 Issue 6 换成更严重的暴露面问题）。
