# portal-identity-plan — 登录身份收口（真实邮箱）+ 文档/原型同步 + TDD 收尾

> **定位**：本计划覆盖「登录身份必须使用 Cloudflare 注册的真实邮箱」这一收口，及其连带的 spec 同步、原型同步与 Issue 1–5 收尾。**待批准**后按 §5 顺序实施。
> **状态**：v2 · as_of 2026-09-23 · **阶段 0/1 已交付**（开发登录入口、真实邮箱身份、生产身份来源护栏均已实现并实测；见 §7 的 2026-09-23 逐条复核）。剩余工作按 §8 的 SBI 编排：`SBI-P1` **已交付**（原型 08/09 页 + 159 项断言；本轮补上 index 缺失的 09 入口与失败态变体），`SBI-D1`–`D5`、`SBI-P2`/`P3` **未做**，`SBI-V1` 的**机器门禁已全绿**、**人手截图待补**（2026-09-22 那次验收用的是 `admin@example.test`，身份口径已改为真实邮箱 ⇒ 需重做一次）。
> **互链**：设计 [`web-design.md`](./web-design.md) · 故事与 AC [`web-stories.md`](./web-stories.md) · 测试 [`web-test.md`](./web-test.md) · 登录恢复 [`web-login-plan.md`](./web-login-plan.md) · 问题台账 [`issues-log.md`](./issues-log.md)
> **既定约束（用户已选定，不得改回）**：① 身份口径 = **开发登录改用真实邮箱身份 + 生产出现非 Cloudflare 身份即失败**；② mockups = **本轮改动全部反映**；③ specs = **更全**（含 `specs/mcp/` 与 `product-backlog.md`）；④ **按 TDD 实现**。

---

## 1. 问题陈述

当前开发登录（`/admin/dev-login`）把身份固定为 `admin@example.test`（自签令牌里的 `email` claim）。这带来两个问题：

1. **身份不是真的** —— 页面身份块与**审计 actor** 都写 `admin@example.test`，与本机之外的事实不符；看不出「到底是谁在操作」。
2. **没有防线** —— 若未来新增通道或配置漂移，**生产环境**理论上可能出现非 Cloudflare 身份，而当前没有任何断言拦它（现有保护只是「production + 自签通道 ⇒ 启动被拒」，是**配置层**的，不是**身份层**的）。

---

## 2. 目标与验收（可机器判定）

| # | 目标 | 验收（测试名暂定） |
| --- | --- | --- |
| G1 | 开发登录的身份 = **真实邮箱**（由本机配置提供，不入仓） | `dev-login > 令牌的 email 等于配置的真实邮箱，且页面身份块显示该邮箱` |
| G2 | **未提供真实邮箱时 fail-fast**，绝不静默回落到 `admin@example.test` | `dev-login > 未配置真实邮箱时启动/登录被明确拒绝` |
| G3 | **生产环境出现非 Cloudflare 身份即失败** | `admin-guard > 生产配置下解析来源非 access 时拒绝（401）且记录告警` |
| G4 | 审计 actor 为真实邮箱 | `dev-login > 用真实邮箱登录后，审计 actor 等于该邮箱` |
| G5 | 既有行为不回归 | 现有 **261** 项全绿；覆盖率门禁 92/85/96/93 通过（2026-09-23 实测：语句 92.78 · 分支 85.90 · 函数 97.76 · 行 94.26） |

---

## 3. 设计决策

### 3.1 真实邮箱的来源（G1/G2）

- 新增**显式**配置键：`PORTAL_TEST_JWT_EMAIL`（仅自签通道使用）。
- `scripts/portal-dev.sh --dev-login` 增 `--email <地址>`；**优先级**：`--email` > `PORTAL_TEST_JWT_EMAIL` > **报错退出**（**不得**有 `admin@example.test` 之类默认值）。
- `.env.local`（已被忽略）中提供该键；`.env.example` 补键位与说明（值留占位符）。
- **不新增任何认证通道**：仍然是既有自签测试通道，仅把声明身份固定为真实邮箱。

### 3.2 生产护栏（G3）

- 现状：`production` + `PORTAL_TEST_JWT_ENABLED=1` ⇒ **启动期拒绝**（配置层，已有）。
- 新增**身份层**防线（双保险）：`admin-guard` 在身份解析成功后，若 `cfg.isProduction` 且解析来源 **不是** `access`（即 `test-jwt`）⇒ **拒绝（401）并记 `identity_source_rejected` 告警**。
- ⚠️ **不得误伤自动化**：Service Token 走的是 **access** 通道（只是 `email` 为空、`common_name` 有值，来源记 `service-token`）⇒ 护栏针对的是**通道**，不是「有没有 email」。

### 3.3 与既有决定的关系

- 与 `ADR-014`（身份只来自已验证断言）**同向**：本计划把「生产只认 Cloudflare 签发」从配置层提升到身份层。
- **不触碰** `AC10.9`（门户不存密码、无邀请/重置控件）—— 本计划不引入任何密码。
- 新增 `ADR-015`：**开发登录入口的存在条件与身份声明口径**（`cfg.testJwt.enabled` 单一判据 + 真实邮箱必填 + 生产不注册该路由 + 身份层护栏）。

---

## 4. 工作分解（TDD：先写会失败的测试）

### 阶段 0 —— 探针测试（先红）

`tests/integration/dev-login.test.ts` 扩写（新增用例，**先失败**）：

- T1 `email 等于配置的真实邮箱`（G1）
- T2 `未配置真实邮箱 ⇒ 明确拒绝`（G2）
- T3 `生产配置下 test-jwt 来源被拒（401 + 告警）`（G3；用注入的方式构造该来源）
- T4 `审计 actor 为真实邮箱`（G4）

### 阶段 1 —— 实现（让测试变绿）

| 文件 | 改动 |
| --- | --- |
| `src/config.ts` | `PORTAL_TEST_JWT_EMAIL` 入 schema 与 `TestJwtConfig`；启用自签通道但**邮箱缺失** ⇒ 启动期报错 |
| `scripts/portal-dev.sh` | `--email` 参数；优先级与 fail-fast；启动横幅打印**当前身份邮箱** |
| `src/web/admin-guard.ts` | 身份来源护栏（G3） |
| `src/shared/auth.ts` | 若需，暴露「解析来源」字段供护栏判定（**不改判定逻辑**） |
| `src/web/i18n/*.json` | 新增失败/提示文案（四语言；中文 `Token` 不译） |

### 阶段 2 —— 文档同步（用户点名）

| 文件 | 要写什么 |
| --- | --- |
| `web-stories.md` | 新增故事与 AC：**真实邮箱身份**、**生产身份来源白名单**；补「开发登录」这一角色的准入说明 |
| `web-design.md` | 认证模型一节补：开发登录入口边界、`PORTAL_TEST_JWT_EMAIL`、身份来源护栏；与 `ADR-015` 互链 |
| `web-test.md` | 登记 T1–T4 用例、覆盖率口径不变、原型断言复跑要求 |
| `web-design.md` §0 | **登记 `D15`（真实邮箱身份 + 生产身份来源白名单）**。> **更正**：本行原写「`architecture.md` §2 登记 `D14`」—— 但 **`D14` 已被占用**（`web-design.md` §0 的 D 表：D14 = 外框冻结 + 代码块圆角例外），且 `architecture.md` §2.1 是**产品级** D1–D10、门户决议本就不在其中 ⇒ 按事实改为 **`D15`** 并落在门户 D 表（2026-09-23，已执行）。 |
| `architecture.md` | 若产品级视角也需一行，另议（当前门户决议统一登记在 `web-design.md` §0） |
| `adr/ADR-015-*.md` | **新增**（决策、备选、代价、边界） |
| `change-log.md` | 按日期追加一行（本批做了什么、证据、未做） |
| `sprint-backlog.md` | Sprint 4 判据补充：真实邮箱身份 + 生产护栏 + 原型/文档同步 |
| `deployment.md` | 真身份/隧道相关章节核对（含 MCP 面 Bypass 口径） |
| `specs/mcp/*.md` | 核对 MCP 面主机名与 Bypass 口径；如受本批影响则更新 |
| `product-backlog.md` | 登记本批收口与遗留 |

### 阶段 3 —— 原型同步（mockups）

- **新增原型**：开发登录页、401 自诊断块。
- **同步 Issue 1–5 界面修正**：停用用户无签发入口且有「恢复访问」；弹窗内显示失败原因；长文本折行（`.path{overflow-wrap:anywhere}`，`admin_portal/assets/portal.css` 与 `mockups/assets/portal.css` 两份必须一致）。
- **复跑原型断言**（134 条）并按实际差异更新（这是已登记缺口）。
- 遵守 `frontend-design` 纪律：沿用既有单色零圆角设计系统，**不引入新风格**，新增页面复用既有样式类。

### 阶段 4 —— 门禁与验收

`npm run typecheck` · `npm test` · `make portal-coverage`（92/85/96/93）· `make doc-links` · `make secret-check` · `make preflight-test` · 原型断言。
**人手验收（流程条款 3）**：用真实邮箱走一次 `/admin/dev-login` 登录，截图留证；另在 `--verify` 下确认真身份路径未被影响。

---

## 5. 顺序与依赖

```
阶段 0（红） → 阶段 1（绿） → 阶段 2（文档） → 阶段 3（原型） → 阶段 4（门禁 + 人手验收）
                                  ↘ 可并行：阶段 2 与 阶段 3
```

依赖：阶段 1 依赖阶段 0 的测试；阶段 2/3 依赖阶段 1 冻结的行为（避免文档描述与实现漂移）。

---

## 6. 本计划**不做**（显式排除）

- **不**引入数据库账号密码（保持 `AC10.9`：门户不存密码，无邀请/重置控件）。
- **不**移除开发登录入口（用户选 D，不是 B）：本机开发仍需一条不依赖 Cloudflare 的登录路径。
- **不**放宽任何 Host 白名单或认证判定逻辑（`src/shared/auth.ts` 的判定不变）。
- **不**在仓内写入真实邮箱（只入被忽略的 `.env.local` / `secrets.local*`；specs 用占位符）。

---

## 7. 已登记但本计划之外的遗留（不遗漏，明确挂账）

1. `scripts/portal-e2e.sh`：自启实例**绑定失败必须 fail-loud**（现只探 `/healthz`，任何面放行 ⇒ 会静默测到别人的实例）。
2. 在线套件跑通：`PORTAL_E2E_ONLINE_BASE_URL=https://memory.agent-mate.ai make portal-e2e ARGS="--online --port 8789"`。
3. **方案 D（PRG + 服务端明文暂存）—— Issue 4 根治**。设计已冻结，实施即可（无需再调研）：

   **契约**
   - 新模块 `src/web/issued-stash.ts`：`put(plaintext): string`（返回随机 id）· `take(id): string | undefined`（**单次取用，取后即删**）· TTL **60 秒** · 条数上限（如 32，超出丢最旧）· 惰性清理（`take` 时顺带清过期）。
   - id 用 `node:crypto` 的 `randomBytes(24).toString('base64url')`。
   - `src/web/routes/admin-api.ts` 的 **issue / rotate「成功且 HTML 客户端」**分支：① `const id = stash.put(result.plaintext)`；② `Set-Cookie: portal_issued=<id>; HttpOnly; SameSite=Lax; Path=/admin/users/<handle>; Max-Age=60`；③ **303** → `detailPath(handle)`。**JSON 客户端分支保持原样**（仍返回 `{ plaintext }`，自动化不受影响）。
   - `src/web/routes/admin-user-detail.ts`：读该 cookie → `take(id)`；命中 ⇒ 把 `issuedToken` 传给模板并**下发清除该 cookie 的响应头**；未命中但 cookie 仍在 ⇒ `issuedExpired: true`。
   - `src/web/views/admin-user-detail.njk`：有 `issuedToken` ⇒ 渲染明文面板（标题 / 明文（等宽可选中）/ 复制按钮 / 「刷新或离开后将无法再看到」）；`issuedExpired` ⇒ 渲染「明文已过期，请重新签发」。
   - 词表新增 **1 条**（四语言，`Token` 不译）：`detail.issued.expired`。

   **护栏测试（先写，随后实现）**
   - T1 签发后响应为 **303**，`Location` 是详情页（不再是 API 地址）。
   - T2 **一次性**：详情页第一次渲染含明文；**第二次请求（模拟刷新）不含**。
   - T3 TTL 到期 ⇒ 取不到，`issuedExpired` 生效（可直接测模块 + 一处集成）。
   - T4 明文**不入日志、不入库**（沿用既有断言：审计 JSON 中不得出现明文）。

   **边界（如实登记）**：暂存是**进程内存** ⇒ 多实例部署时会落空（本机单进程无影响）；需要共享存储时另行处理，不在本批。

   **落地时注意**：不要把该模块单独提交而不接线（未执行代码会拉低覆盖率，直接让门禁变红）—— 必须与本条其余改动同批完成并跑门禁。
4. 覆盖率门禁在新增代码后复跑（阶段 4 已含）。

**2026-09-23 复核（逐条回填）**：① 与 ③ **已完成** —— `portal-e2e.sh` 的 fail-loud 已实施（端口被占用 ⇒ **退出码 30** + 打印占用进程，实测；同时结掉它当年记录的「面隔离 403 误导性失败」），方案 D 已于 2026-09-22 落地（`src/web/issued-stash.ts` + PRG 303 + 明文一次性，见 `change-log.md` 当日行）。④ **已完成** —— 覆盖率复跑并写入 `web-test.md`（语句 92.78 / 分支 85.90 / 函数 97.76 / 行 94.26，门禁绿灯）。② 仍待**持有者**执行（缺 `PORTAL_E2E_ONLINE_BASE_URL` 与 Access Service Token 两项环境变量；「明确跳过」语义已实测为**退出码 40**，另注意 `make portal-e2e` 会把非零码折叠为 2）。
另：`ADR-015` 已落档，并已按本计划 §3.3 的口径扩写为「入口边界 + 身份口径」（`isIdentitySourceAllowed` 生产护栏 + `PORTAL_TEST_JWT_EMAIL` 必填，均为**已核实的实现事实**）；`D15` 已登记于 `web-design.md` §0。

---

## 8. SBI 拆分与执行顺序（2026-09-23，按 [`ADR-016`](../adr/ADR-016-sbi-delivery-granularity.md)）

> **判据口径**：本节每一行的「端到端判据」已按 [`ADR-016`](../adr/ADR-016-sbi-delivery-granularity.md)（颗粒度）、[`ADR-017`](../adr/ADR-017-complexity-probe-before-real-build.md)（高复杂度先探针）、[`ADR-018`](../adr/ADR-018-mockup-as-clickable-simulation.md)（原型即可点全路径仿真）、[`ADR-019`](../adr/ADR-019-spec-basic-constraints-and-executable-uptake.md)（设计约束必有可执行承接）对齐。
> **为什么重排**：本计划原先把剩余工作写成「阶段 2 文档同步（9 份文件）」与「阶段 3 原型同步」两批 —— 按 `ADR-016` 的颗粒度判据，**这两批各自都太粗**（一批里装了多个可独立交付、可独立验收的增量），正是 `PSP-W1` 已经付过代价的那个形态。下面按 SBI 重排；**阶段 0/1 已交付的部分不重排**（历史不改）。

| SBI | 交付物 | 接收方 | 端到端判据（可独立验收） | 依赖 |
| --- | --- | --- | --- | --- |
| **SBI-D1** | `web-stories.md`：新增「开发登录准入 / 真实邮箱身份 / 生产身份来源白名单」的故事与 `AC` | 评审 + 实现期 | 新增 `AC` 编号连续；每个新 `AC` 在 `web-test.md` 有对应用例号（**0 悬空**）；**按 [`ADR-019`](../adr/ADR-019-spec-basic-constraints-and-executable-uptake.md) 覆盖四类基本约束**（重复/冲突 · 不存在 · 非法输入 · 并发与二次操作）与**状态前置条件**（开发登录入口在哪些配置下存在/不存在） | — |
| **SBI-D2** | `web-design.md` §6 认证模型：开发登录入口边界 · `PORTAL_TEST_JWT_EMAIL` · 身份来源护栏 · 与 `ADR-015` 互链 | 评审 | 三处口径与实现一致（`admin-guard.ts` 的 `isIdentitySourceAllowed`、`config.ts` 的必填键），链接有效（`make doc-links`） | — |
| **SBI-D3** | `web-test.md`：登记 T1–T4 四条用例（真实邮箱 / 缺配置拒绝 / 生产来源拒绝 / 审计 actor） | 实现期 + 验收 | T1–T4 每条都能指到 `dev-login.test.ts` 里的**实际用例名** | — |
| **SBI-D4** | `sprint-backlog.md`（Sprint 4 判据补充 + 后续按 SBI 编排）· `product-backlog.md`（登记本批收口与遗留） | 排期 | 两文件互链一致；Sprint 4 行含「真实邮箱 + 生产护栏」判据要点 | — |
| **SBI-D5** | `deployment.md` 真身份 / 隧道章节核对 · `specs/mcp/*.md` 主机名与 Bypass 口径核对 | 运维 | 只读核对：受影响则更新，**未受影响则显式登记「已核对、无需改」** | — |
| **SBI-P1** | `mockups/`：**新增**开发登录页与 401 自诊断块（含四语言词条），按 [`ADR-018`](../adr/ADR-018-mockup-as-clickable-simulation.md) 做成**可点击的全路径仿真** | 评审 | 新页可打开；四语言键集合一致；**关键路径可点通**（成功 / 失败 / 刷新 / 返回 / 同一入口第二次操作）；断言从静态渲染扩展到交互路径且全绿 | — |
| **SBI-P2** | `mockups/`：同步 Issue 1–5 的界面修正（停用用户无签发入口且有「恢复访问」· 弹窗内显示失败原因 · 长文本折行） | 评审 | 两份 `portal.css` 逐文件一致（sha256）；对应断言在原型侧通过 | — |
| **SBI-P3** | `mockups/`：同步本轮版式（弹窗 +50% 宽 · 目标块两列规格栏）并复跑 134 项断言 | 评审 | 原型断言全绿；实现与原型的目标块渲染一致（同列即同一字段） | SBI-P1 |
| **SBI-V1** | 门禁 + **人手验收**：`typecheck` · `test` · `portal-coverage` · `doc-links` · `secret-check` · `preflight-test` · 原型断言；用**真实邮箱**走一次 `/admin/dev-login` 并留截图 | 用户 | 六条门禁全绿 + 人手截图（流程条款 3：「人要做什么」的交付必须有人手验收） | D1–D5 · P1–P3 |
| **SBI-V2P** | **探针**（按 [`ADR-017`](../adr/ADR-017-complexity-probe-before-real-build.md)，高复杂度先探针）：用**一条命令**回答「隧道地址可达 且 Service Token 已加入该 Access 应用策略」 | 后续 SBI-V2 | 命令与原始输出落档；判定「通 / 不通」（漏配策略的典型表现是 302 而非 200）；**产物不产品化** | 持有者 |
| **SBI-V2** | 在线套件**真链路运行**（`scripts/portal-e2e.sh --online`） | 用户 | 退出码 **0**（而非 40）；需持有者提供 `PORTAL_E2E_ONLINE_BASE_URL` 与 Access Service Token | SBI-V2P |

**建议顺序**：文档侧 `D2 → D1 → D3 → D4 → D5`（先权威、后引用）与原型侧 `P1 → P2 → P3`（先新增、后同步）**可并行**；两者完成后 `V1`；`V2` 待持有者。

**本批不做**（沿用 §6）：不引入数据库账号密码；不移除开发登录入口；不放宽任何 Host 白名单或认证判定；不在仓内写入真实邮箱。
