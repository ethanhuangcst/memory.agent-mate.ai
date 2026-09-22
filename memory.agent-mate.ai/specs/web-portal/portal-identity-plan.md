# portal-identity-plan — 登录身份收口（真实邮箱）+ 文档/原型同步 + TDD 收尾

> **定位**：本计划覆盖「登录身份必须使用 Cloudflare 注册的真实邮箱」这一收口，及其连带的 spec 同步、原型同步与 Issue 1–5 收尾。**待批准**后按 §5 顺序实施。
> **状态**：v1 · as_of 2026-09-22 · **未动代码**（本文件仅计划）
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
| G5 | 既有行为不回归 | 现有 251 项全绿；覆盖率门禁 92/85/96/93 通过 |

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
| `architecture.md` | §2 登记 `D14`（真实邮箱身份）与 `ADR-015` 编号 |
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
3. **方案 D**（PRG + 服务端明文暂存 60 秒）与「明文一次性」护栏测试 —— 根治 Issue 4「明文刷新即丢」。
4. 覆盖率门禁在新增代码后复跑（阶段 4 已含）。
