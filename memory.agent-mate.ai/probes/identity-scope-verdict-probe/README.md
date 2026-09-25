# 3.22 真身份 / 主机名 / Bypass 口径核对探针（研究类，不入制品）

为 Sprint 4 `#7 deploy:真身份口径核对` 服务（**开工准备**定判据、**本体**复跑取证）；判据来源 = `specs/web-portal/portal-identity-plan.md` §8 `SBI-D5`：
「只读核对：受影响则更新，**未受影响则显式登记「已核对、无需改」**」。

调用（**纯静态、只读、零网络**，不需要容器）：

```bash
bash memory.agent-mate.ai/probes/identity-scope-verdict-probe/probe.sh
```

退出码：`0` = 探针跑通（结论以 PASS/FAIL 表为准）· `20` = 运行错误。

## 一、先把「核对对象」改指到真源（开工准备的核心结论）

`#7` 验收列点名核对「`mcp/mcp-design.md` 主机名与 Bypass 口径」，但**该口径在 `mcp-design.md` 内不存在**（全文搜 `Bypass` 0 命中）—— 该文件只把这件事**回链**给 `web-portal/web-design.md` §6。⇒ 本探针把核对对象锚到真源（并在 `mcp-design.md` 就地补一句落点说明）：

| 条目点名的对象 | 实际真源 | 说明 |
|---|---|---|
| `deployment.md` 真身份与隧道章节 | `deployment.md` §12.4 / §12.5.1 / §12.5.4 | 身份来源、Admin 邮箱与 Allow 策略、MCP 面 Bypass、`PORTAL_ACCESS_*` 键与生产禁用键 |
| `mcp-design.md` 主机名与 Bypass 口径 | **`web-design.md` §6**（+ §12.3 路由表） | 管理面/MCP 面域名与 Access 开启/绕过表、两条硬要求（域名分离、按 `Host` 面隔离）；`mcp-design.md` §5.6.2 只回链 |

## 二、逐项结论（`#7` 本体 · 2026-09-25 实测 · **8 PASS / 0 待修订**）

| 断言 | 两侧真源 | 结论（`SBI-D5`） |
|---|---|---|
| **M1**`PORTAL_ENV` 取值集合唯一 | `deploy/portal.compose.yml` 注释 ↔ `admin_portal/src/config.ts` 的 `z.enum(['development','production'])` | **已更新**：注释的 `PORTAL_ENV=dev` ⇒ `development`（开工准备时为**唯一异形值**） |
| **M2**「生产不得设置」键集合三处一致 | compose 注释块 ↔ `deployment.md` §12.5.4 ↔ `config.ts` | **已核对、无需改**：三处同集（6 键：`PORTAL_TEST_JWT_*` 五键 + `PORTAL_LAUNCH_OVERRIDE`） |
| **M2b** 开发登录入口的开关**同源**且在指南有落点 | `server.ts`（注册受 `cfg.testJwt.enabled` 支配）↔ `deployment.md` §12.5.4 ↔ `web-design.md` D15 / `ADR-015` | **已更新**：§12.5.4「生产不得设置」行补 `/admin/dev-login` 登记并**在同一行点明同源**（开工准备时为**缺位**） |
| **M3** 面隔离两个 Host 键齐备且「必须不相交」两侧都写 | compose ↔ `config.ts` 校验 ↔ `web-design.md` §6 | **已核对、无需改** |
| **M4**「MCP 面必须绕过 Access」四处一致 | `web-design.md` §6 ↔ `deployment.md` §12.4 / §12.5.1 | **已核对、无需改** |
| **M5**`mcp-design.md` 的主机名/Bypass 口径**回链有效** | `mcp-design.md` §5.6.2 ↔ `web-design.md` §6 | **已核对、无需改**：回链存在且目标节含 Host/Bypass 表 |
| **M6** 现行真源与**入仓制品**里旧口径零残留 | 三份 spec + **入仓** compose/配置（扫描面由 `git ls-files` 判定） | **已更新**：入仓模板本干净；残留只在**未入仓**本机派生文件（已同步 `/opt/ai-memory/`）⇒ 规则扫描面同时收窄为入仓文件 |
| **M6 灵敏度对照** | 注入样本 | ✓ 注入 `ai-mem` / `/opt/ai-memory-mcp/` ⇒ 规则命中（证明不是恒绿） |

**敏感性证明（本条 todo 的判据质量要求）**：`M1` 临时改回 `PORTAL_ENV=dev` ⇒ **转红 7/1**；`M2b` 临时去掉 `/admin/dev-login` 落点 ⇒ **转红 7/1**；两次还原后文件哈希与基准一致、复跑 **8/8**。

## 三、判据不许「假绿 / 假红」的四条实测教训（已写进规则）

1. **历史叙述不是残留**：`deployment.md` 的**变更记录行**里出现旧目录是**合法历史**（按仓内改名口径「历史叙述保留旧名、只靠映射表收口」）⇒ 规则必须豁免变更记录行（`| 20YY-MM-DD |` 形态），否则第一条命中的就是历史行（实测：豁免 1 处）。
2. **扫描面必须与「制品」定义对齐**：`deploy/config.toml` / `config.local.toml` 是**未入仓**的本机派生文件（`.gitignore` 第 12/15 条）—— 旧路径出现在它们里面只说明「本机副本旧」，不是制品漂移；把未跟踪文件当制品判据，结论会随开发机状态漂移。⇒ 扫描面改由 `git ls-files` 判定，未跟踪文件**显式排除并把排除项打印在结论里**（实测排除 2 个）。
3. **判据的「取行方式」本身就是判据的一部分**：M2b 第一版用 `l.includes('registerDevLoginRoutes')` 定位注册点，`findIndex` 命中的却是文件顶部的 `import ... `（第 33 行）而不是调用行（第 133 行）⇒ 判据**恒假**（真红不了，也说明它没在测真事）。改为匹配**调用**（`registerDevLoginRoutes\s*\(`）后转 PASS。
4. **「字样存在」不是口径覆盖**：M2b 原版只查 `deployment.md` 是否出现 `dev-login` 字样 —— 任意一句提及都能蒙过；改为「**开关同源**（代码侧受 `cfg.testJwt.enabled` 支配）**+ 指南里同一行点明由哪套键开关**」。

## 四、边界（如实登记）

- 本探针**不改**任何产品代码或 specs；三项受影响项的**修订**与 M2b/M6 的**规则精化**在 `#7` 本体轮完成，结论落 `sprint-backlog.md` 的 `#7` 行与 `change-log.md`。
- **`deploy-doc-audit` 不覆盖本行维度**：既有 `make deploy-doc-audit` 只审「键名登记 / 引用路径 / §5.4 逐键一致 / compose 结构底线」，**不含主机名、Bypass、隧道与真身份口径**；`attestation-paths-check` 只审 attestation 五路径 ⇒ 本行的判据由本探针承载（已在 `deploy-guide-audit/README.md` 登记这一分工）。
- **已知先在红项（不属于本探针）**：`make deploy-doc-audit` 在 HEAD 上红 —— `A2` 把 `#4.2` 交付注释里的**将来键名** `PORTAL_CONTACT_EMAIL` 当成「代码会读的键」（正则抽键扫 `admin_portal/src` 全文本，注释也计入）。归因证据与两条修法建议见 `change-log.md` 的 `#7` 交付小节；**本探针不代它判定**。
- `deployment.md:33` 的 DNS 承接项：`#7` 本体已按用户定夺登记为 **Sprint 5 `#9`（上线准备包）**（原先为「暂无承接条目（归属待定）」）。
- 交叉引用锚点（`deployment.md` 指向 `web-design.md` §6 / §6.1）只做**语义核对**（§6 是 Host/Bypass 表、§6.1 是管理面认证实施细则），不加机械断言，避免把「引用错节」当成漂移。
