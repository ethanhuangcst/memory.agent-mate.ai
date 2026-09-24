# 3.16 deploy:上线指南一致性审计探针（Sprint 4 `4.4` 的开工前置）

> **研究类探针，不入制品**（[`ADR-017`](../../specs/adr/ADR-017-complexity-probe-before-real-build.md)）。为 Sprint 4 `4.4`「deploy:上线配置指南」把「**可照做**」这条验收条件变成**可机械判定**的东西。
>
> 交付对象：本 Sprint `4.4`；判据口径落 [`../../specs/sprint-backlog.md`](../../specs/sprint-backlog.md) 的 `4.4` 行与 `3.16` 行。

## 为什么单列

`4.4` 的验收条件是「三段指南齐备（Cloudflare Access / SSH 密钥对与 forced command / 对象存储私有桶与子账号）+ **每步验证点** + **可照做**」。文档不能被执行，于是「可照做」最容易被写成一句**无法证伪**的话。但对一份**配置类**指南，「照做会得到什么」里有一大半是机械可判的：

| 问题 | 判据 |
|---|---|
| Q1 指南要求读者填的键，与**代码真正会读**的键是不是同一套？ | 漏一个 ⇒ 读者照做后**静默失败**（门户 `4.3` 的启动自检 fail-closed 会拒绝启动，属响亮失败） |
| Q2 指南引用的**仓库路径**是不是都存在？ | 45 个引用逐个 `existsSync` |
| Q3 指南自己承诺的「**逐键一致**」成不成立？ | `deployment.md` §5.4 与 `../deploy/.env.prod.example` 逐键比对 |
| Q4 指南提到的键里有没有**真源已经不认**的？ | 只作**发现**（多半是上游 `config.toml` 的键，需人工判有无陈旧） |

## 跑法

```bash
node memory.agent-mate.ai/probes/deploy-guide-audit/probe.mjs
```

| 项 | 值 |
|---|---|
| 依赖 | **零**（纯 node，无第三方包；读文件 + 正则） |
| 退出码 | `0` 全部断言通过 · `10` 前置不足（不在仓内）· `30` 断言失败 |
| 产物 | `out/probe-*.log`（**不入库**） |
| 确定性 | **纯静态审计** ⇒ 同一提交上可重复，不受环境/时序影响 |

**关于「现在是红的」**：本探针 **3 PASS / 1 FAIL**（退出码 `30`），那条 FAIL 是**它在 `4.4` 交付前应当红**的判据（`A2`）—— 即「先红后绿」里的**红**：`4.4` 把指南补齐后它才转绿。

## 四项判据（首跑实测）

| # | 判据 | 实测 |
|---|---|---|
| A1 | 三侧都抽到键（否则比对无意义） | ✅ 代码侧 **21** 个 `PORTAL_*` · 部署侧 **5** 个 · 文档侧 **16** 个全大写键 |
| **A2** | **门户真正会读的每个 `PORTAL_*` 键，至少在 compose / `*.env.example` / 指南 之一被登记** | ❌ **遗漏 21 个**（见下「决定性发现」） |
| A3 | 指南里引用的仓库路径都存在 | ✅ **45 个全部可达** |
| A4 | `deployment.md` §5.4 与 `../deploy/.env.prod.example` **逐键一致** | ✅ 两边都是 `DASHSCOPE_API_KEY` · `IMAGE_TAG` |

### 决定性发现（`A2` 红的根因）

1. **`deploy/docker-compose.prod.yml` 只有上游两个服务**（`ai-memory` / `curator`），**没有门户 stack**；门户 compose 是「部署动作：新建 `/opt/ai-memory/` 下门户 compose」（**在服务器上现写**，不入仓）。
2. **门户 stack 的 env 真源只有 1 个键**：`deploy/portal.env.example` 只有 `DASHSCOPE_API_KEY`；而门户代码真正会读 **21** 个 `PORTAL_*`（`admin_portal/src/config.ts` 的 `loadConfig`）。
3. 这 21 个键的**唯一登记处是设计文档** [`../../specs/web-portal/web-design.md`](../../specs/web-portal/web-design.md) §12.9（关键配置项），**不在**部署真源、**不在**部署指南。
   ⇒ 读者照 `deployment.md` §12.2 做，**无从知道门户 stack 要填哪些键**。`4.4` 的「可照做」正缺这一块（好在 `4.3` 的启动自检 fail-closed ⇒ 会**响亮失败**而不是静默错配）。
4. 另有一类**只作发现**：指南提到、但代码与部署真源都不认的 **12** 个键（`AI_MEMORY_AGENT_ID` / `AI_MEMORY_KEY_DIR` / `GLM_API_KEY` / `OPENAI_API_KEY` …）—— 多半是**上游 `config.toml`** 的键（文档里已有「不要写」一类说明），需人判有无陈旧。

## 五项判据（`4.4` 交付后）

| # | 判据 | 交付后实测 |
|---|---|---|
| A1 | 三侧都抽到键 | ✅ 代码 **21** · 部署 **22** · 文档 **39** |
| A2 | 门户会读的每个 `PORTAL_*` 键都在真源或指南里登记 | ✅ **无遗漏**（真源侧 = 新入仓的 [`../../deploy/portal.compose.yml`](../../deploy/portal.compose.yml) 的 `environment`） |
| A3 | 指南引用的仓库路径都存在 | ✅ **50/50 可达** |
| A4 | `deployment.md` §5.4 与 `deploy/.env.prod.example` 逐键一致 | ✅ |
| A5 | `deploy` 下 compose 的**结构底线**（无制表符缩进 · 有顶层 `name`/`services` · `image` 非空） | ✅ |

> **A5 的口径与边界**：本机**装不了也跑不了** `docker compose config`（无 compose 插件；`node_modules` 里也没有 YAML 解析器，「`yaml` / `js-yaml` / PyYAML」实测都没有）⇒ 真解析**只能在服务器侧**做（[`../../specs/deployment.md`](../../specs/deployment.md) §12.5.5 第 1 步）。A5 只把「最常见的写坏方式」钉住，**不冒充解析器**。
>
> **扫描面**：`deploy/*.yml` **全部**（不硬编码文件名）—— 首版只扫 `docker-compose.prod.yml`，新入仓的 `portal.compose.yml` 会被漏掉。

## 由结论导出的硬约束（`4.4` 直接照用）

1. **每段指南的「验证点」必须是能跑出确定性结果的命令**（例如：CF Access 段的验证点 = 未认证被拦 **302** / Service Token 直达 **200** / 在线套件退出码 `0`；SSH 段的验证点 = `ssh` 能进、但 `bash` 被 forced command 拦；对象存储段的验证点 = 回读比对 + `make secret-check` 通过 + `AK` 不入仓）。
2. **门户 stack 的 `PORTAL_*` 清单必须进指南**（并在 `portal.env.example` 里逐键登记）—— 这条由 `A2` 判据把住。
3. **「逐键一致」这类承诺要写成可机械判定的**（`A4` 就是范例：它把 §5.4 的一句话变成了会红的断言）。
4. **键 / 路径的引用一律用相对路径**：`A3` 能成立是因为文档里的 45 个引用都是可解析的相对路径。

## 边界与如实登记

- **首版探针自己有两个 bug**（已修，属「探针也要先验证」的同族教训）：① 抽 compose 的键时**只认 `KEY:` 映射形态**，漏了 `- KEY=value` 与 `${KEY}` ⇒ 把 21 个 `PORTAL_*` 全**误报**成遗漏；② 比对引用路径时把 `../` 丢了 ⇒ 45 个引用全**误报**缺失。**若不同批跑一遍「应当通过」的对照项，这两处会把「文档有问题」的结论带错方向。**
- **`.env` / `.env.local` / `portal.env` 均已 gitignore、未被跟踪**（只有 `*.example` 入库）—— 探针只读这些文件**不入库**的内容，不复制任何值到日志。
- 本探针**不改**任何文档或代码（本轮只做开工准备）。
- **不判上游 `config.toml` 的键**（`deploy/config.toml.tmpl` 是另一套真源，`deployment.md` §5.2/§5.3 已逐键对齐），故 `docOnly` 只作发现。
