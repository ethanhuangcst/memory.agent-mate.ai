# 3.20 接入说明判据可行性探针（研究类，不入制品）

为 Sprint 4 `#4.2 web-portal:接入说明` 的**开工准备**服务：把该条的验收条件
（「新用户按页面指引 ≤ 3 步完成接入 · 示例一律占位符不出现真实值 · 四语言键集合一致」）
在**落地前**定成可机器判定的形状，并如实记录「现在有没有实体」。

调用（需要容器常驻基线 + `python3` + `playwright`；**独占端口**，默认 8812）：

```bash
bash memory.agent-mate.ai/probes/instructions-verdict-probe/probe.sh            # 默认端口 8812
bash memory.agent-mate.ai/probes/instructions-verdict-probe/probe.sh --port 8813
```

编排骨架照抄 `scripts/portal-e2e.sh`（自签 JWT + 独占端口预检 + 就绪探测 + `trap` 收尾）；**只读**：不写产品代码、不改任何制品。

## 结论（2026-09-25 实测 · 13/13 PASS · 退出码 0）

| 问题 | 结论 | 灵敏度对照 |
|---|---|---|
| **Q1**「三步接入」能用真浏览器判吗 | **能**。判据 = `#setup .step` 计数 `==3` + `.steps` 计算样式 `flex-direction: column` + 三步 `same_x && growing_y`；另可判「第 1 步无代码块、第 2 步有复制按钮」 | 同一判据在**原型** `mockups/01-instructions.html` 判 **3 步且纵向**；在**已实现页**判 **0 步**（⇒ 判据既不恒真也不恒假） |
| **Q2**「进入 Admin 的入口」怎么判 | **判 `admin.entry` 键（或 `.admin-entry`）**，**不要**判 `<a href="/admin">` | 原型 `admin.entry` **=1**、裸 `a[href^="/admin"]` **=0** ⇒ 用裸链接判会得到恒 0 的假绿；已实现页两者皆 0（入口尚无实体） |
| **Q3**「示例一律占位符」能机械扫吗 | **能**，规则 = {真实令牌形态 `memo_[A-Za-z0-9_-]{20,}`} ∪ {**基础设施**主机名（来自本机 secrets）} ∪ {公网 IP（白名单外）}，扫描面 = `views/**/*.njk` + `i18n/*.json` + `specs/web-portal/*.md` | 现有 **17 个文件 0 命中**；注入真实令牌形态 / `nginx4.agent-mate.ai` / `203.0.113.99` **三条对照全命中** |
| **Q4**「页面档位名与工具数 vs 能力文档逐项一致」的比对对象 | **可取且已双向定档**：权威侧 = `mcp-capabilities.md` 档位表（`core 8 · admin 22 · graph 20 · power 57 · full 101`，共 1–101），另一侧 = 页面；`mcp-design.md:507` 明写 capabilities 是门户「接入指引」页的**唯一内容源**，capabilities 又回指 design §8 为技术口径 | 同一取法若**不限定语境**（全文 regex），在 `mcp-design.md` 上会取到 **6 档噪声**（`smart=4 / admin=11 / core=0 …`）—— 因为 `--tier smart` 与 `--profile core` 同形 ⇒ 取法必须只认档位表格行 |

### 现状（与 `#4.2` 的覆盖核对一致）

- 公开首页 `/` 目前是**占位页**（`admin_portal/src/web/routes/index.ts` → `views/instructions.njk` 只渲染 `placeholder.*`）⇒ `AC6.1/6.2/6.7/6.8/6.9` **暂无实体**，上面 Q1/Q2 的判据此刻判为「未落地」是**正确结论**，不是缺陷。
- 三步内容键（`guide.*` / `step1-3.*` / `contact.*` / `agents.*` / `tools.*`）**已在四语言词表就绪**（`en.json` 实测 260 键），但**无任何模板引用** ⇒ 实现是「接上模板」而不是「造内容」。
- 页面侧 `tools.*` 共 **22 键**；与能力文档任一档的集合比对须在 `#4.2` 落地后再挂（当前无页面实体可比）。

## 首轮跑出的三处**判据缺陷**（v2 已修正，记录以备复用）

1. **Admin 入口判据写错**：初版判 `a[href^="/admin"]` ⇒ 原型上也是 0（原型用 `admin.entry` 键渲染）⇒ 若照此落地，判据会对**任何**实现都恒判「缺失」。修正后才在原型上转正（灵敏度对照的价值）。
2. **占位符规则误报品牌串**：初版把裸产品域名 `memory.agent-mate.ai` 当「真实主机名」⇒ 现有制品 **9 处误报**（标题与顶栏的品牌串 `AC6.11` **要求**出现它）。修正 = 允许清单只含**裸产品域名**，其**子域**与基础设施主机名（`nginx*` / `portainer*` / `*.maas.aliyuncs.com`）仍一律禁。
3. **档位×工具数的取法不限定语境**：初版全文 regex ⇒ 在 `mcp-design.md` 上取到 `smart`（`--tier smart`）等噪声。修正 = 只认档位表格行（`| … \`core\` … | 8 |`）。

## 边界（如实登记）

- 本探针**不改**任何产品代码与 specs，只产出判据形状与现状证据；`#4.2` 的实现另开。
- `AC6.4` 的**页面侧**比对要等页面落地；`AC6.6`（口径不一致阻断发布）本轮**未涉及**，其判据形状需在实现轮另定。
- `AC6.9`（第 3 步真实界面截图）本轮只验「判据可判别」（原型侧图 `naturalWidth>0` 已由 `mockups/.verify/verify.py` 覆盖），**未**验实现页。
- Q3 的基础设施主机名来自本机 `secrets.local.hk_vps_4.md`（未入仓）⇒ 无 secrets 的机器上该路对照会跳过，输出会明示。
