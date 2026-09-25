# 3.22 真身份 / 主机名 / Bypass 口径核对探针（研究类，不入制品）

为 Sprint 4 `#7 deploy:真身份口径核对` 的**开工准备**服务；判据来源 = `specs/web-portal/portal-identity-plan.md` §8 `SBI-D5`：
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

## 二、逐项结论（2026-09-25 实测 · 5 PASS / 3 待修订）

| 断言 | 两侧真源 | 结论 |
|---|---|---|
| **M1**`PORTAL_ENV` 取值集合唯一 | `deploy/portal.compose.yml` 注释 ↔ `admin_portal/src/config.ts` 的 `z.enum(['development','production'])` | **✗ 待修订**：`portal.compose.yml:79` 写 `PORTAL_ENV=dev`（代码只认 `development`）—— 照注释填报会踩启动期校验 |
| **M2**「生产不得设置」键集合三处一致 | compose 注释块 ↔ `deployment.md` §12.5.4 ↔ `config.ts` | ✓ 三处同集（6 键：`PORTAL_TEST_JWT_*` 五键 + `PORTAL_LAUNCH_OVERRIDE`） |
| **M2b**`--dev-login` 的生产禁用口径在部署指南有登记 | `deployment.md` ↔ `web-design.md` D15 / `ADR-015` | **✗ 缺位**：只登记在设计/ADR 侧，`deployment.md` §12.5.4 未提 ⇒ 口径覆盖不完整（须「已更新」） |
| **M3** 面隔离两个 Host 键齐备且「必须不相交」两侧都写 | compose ↔ `config.ts` 校验 ↔ `web-design.md` §6 | ✓ |
| **M4**「MCP 面必须绕过 Access」四处一致 | `web-design.md` §6 ↔ `deployment.md` §12.4 / §12.5.1 | ✓ |
| **M5**`mcp-design.md` 的主机名/Bypass 口径**回链有效** | `mcp-design.md` §5.6.2 ↔ `web-design.md` §6 | ✓ 回链存在且目标节含 Host/Bypass 表 |
| **M6** 现行真源与**制品**里旧口径零残留 | 三份 spec + 两份 compose + 配置模板/样例 | **✗ 待修订**：`deploy/config.toml:3` 与 `deploy/config.local.toml:3` 的注释仍写旧目录 `/opt/ai-memory-mcp/`（已统一为 `/opt/ai-memory/`）—— **制品侧**注释，会误导运维 |
| **M6 灵敏度对照** | 注入样本 | ✓ 注入 `ai-mem` / `/opt/ai-memory-mcp/` ⇒ 规则命中（证明不是恒绿） |

**待修订项汇总（⇒ `#7` 本体按 `SBI-D5` 处置：受影响则更新）**：M1（`portal.compose.yml:79` 的 `dev` → `development`）· M2b（`deployment.md` 补 `--dev-login` 生产禁用登记）· M6（`deploy/config.toml:3` 与 `config.local.toml:3` 注释改 `/opt/ai-memory/`）。

## 三、判据不许「假绿」的两处实测教训（已写进规则）

1. **历史叙述不是残留**：`deployment.md` 的**变更记录行**里出现旧目录是**合法历史**（按仓内改名口径「历史叙述保留旧名、只靠映射表收口」）⇒ 规则必须豁免变更记录行（`| 20YY-MM-DD |`），否则第一条命中的就是历史行（本轮实测：豁免 1 处）。
2. **扫描面必须含制品**：只扫 spec 会漏掉 `deploy/config.toml*` 注释里的旧路径 —— 而那正是运维会照抄的地方。⇒ 扫描面 = 三份 spec + 两份 compose + 配置模板/样例/本地配置。

## 四、边界（如实登记）

- 本探针**不改**任何产品代码或 specs（`mcp-design.md` 的落点说明与排期登记属开工准备的**契约定档**，由本轮一并落盘）；三条待修订项的**实际修订**属 `#7` 本体。
- **`deploy-doc-audit` 不覆盖本行维度**：既有 `make deploy-doc-audit` 只审「键名登记 / 引用路径 / §5.4 逐键一致 / compose 结构底线」，**不含主机名、Bypass、隧道与真身份口径**；`attestation-paths-check` 只审 attestation 五路径 ⇒ 本行的判据由本探针承载（已在 `deploy-guide-audit/README.md` 登记这一分工）。
- `deployment.md:33` 的「DNS（两个域名）暂无承接条目（归属待定）」是**已知悬空承接项**，不在本探针的机械判据内 —— 属 `#7` 需人工留结论的一项。
- 交叉引用锚点（`deployment.md` 指向 `web-design.md` §6 / §6.1）本轮只做**语义核对**（§6 是 Host/Bypass 表、§6.1 是管理面认证实施细则），不加机械断言，避免把「引用错节」当成漂移。
