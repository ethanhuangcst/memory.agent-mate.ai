# 门户启动自检「三项 deferred 转正」· 开工准备探针（Sprint 5 `#17`）

**服务对象**：Sprint 5 `#17` —— **build:门户启动自检实现**（原 Sprint 4 `4.3` 的实现轮）。
**这一版是「开工准备」工件**：把判据做成**可跑的**，把「施工到底要改哪几处」钉成清单，**不施工**。

## 本行只做「三项 `deferred` 转正」

锁的挂载/读取位与**门户自身**版本断言已随 `#2` 落地（`own_version_matches_lock` 已在容器内真跑）。本行收口的是自检里另三项：

| 自检项 | 判据形状（§3.4 ① 定档） |
|---|---|
| `embeddings_reachable_1024` | 一次最小调用后「**非 401/403 且向量长度 == `1024`**」—— **不得**以「env 非空」或「调用成功」代替 |
| `binary_version_matches_lock` | 容器内 `ai-memory --version` 取**末位 semver** ⇄ [`../../upstream.lock`](../../upstream.lock) 的 `UPSTREAM_RELEASE_TAG` **去 `v`** |
| `launch_template_assertions` | [`../../admin_portal/src/bridge/launch-template.ts`](../../admin_portal/src/bridge/launch-template.ts) 常量表与 [`../../specs/mcp/mcp-design.md`](../../specs/mcp/mcp-design.md) §5.6.4 **逐字**一致（比对体沿用既有 `tests/unit/launch-template.test.ts`） |

**编排不变量**（§3.4 ②）：任一项 `fail` ⇒ **不调用 `listen`** 且退出码非 0；**`deferred` 不得当作 pass** —— `3.21` 曾实证 `pass=6 deferred=3 fail=0` 时门户照常启动，**这正是本行要收口的缺口**。

## 两相

- **相 1（离线，零依赖）**：四项判据形状的**能红能绿**证明（样本全合成）+ 现状与缺口的**机械核实**。
- **相 2（需 `node`，本机即可）**：**端到端 stub** —— 本地起一个 HTTP stub 扮演 MaaS（401 / 768 维 / 1024 维三态），用**与产品将实现的判据同形**的函数去调 ⇒ 证明判据在**真 HTTP 通路**上也能红能绿。

```bash
bash memory.agent-mate.ai/probes/selfcheck-finalization-probe/probe.sh
```
退出码：`0` 本行应判项全绿 · `10` 有 FAIL · `30` 有未判 · `20` 运行错误。

## 本机实测结论（2026-09-27）

**13 PASS / 0 FAIL / 0 未判 · `rc=0`**（**本机与干净检出模拟两侧一致** —— 本探针的判据输入**全部入仓**，故无 `#5` 那类「本机比 CI 富」的风险）。
**首跑 11/1**：那 1 处 FAIL 与 1 处未打印行都是**探针自伤**（见「踩坑」），非产品问题。

## 硬数据

| 判据 | 实测 | 说明 |
|---|---|---|
| `S1` web 判据三态 | 401 ⇒ fail · **768 维 ⇒ fail** · 1024 维 ⇒ pass | **「返回成功但维度错」不会被判成 pass**（`mcp-design` §9 F2：不显式给 `dim` 会静默回落 768） |
| `S2` 版本判据 | `v0.10.0` ⇄ `0.10.0` **同口径** ⇒ 一致 · `0.9.0` ⇒ 不一致 | **两侧必须用同一个「取末位 semver」函数**，否则 `v` 前缀会造成假红 |
| `S3` 模板判据 | 空白差异不算漂移 · 内容差异一定被抓到 | 比对体沿用既有测试；本行只需把它**搬进启动自检** |
| `S4` 不变量判据 | `fail` ⇒ 阻断 · `deferred` ⇒ 不阻断但**不得当 pass** · `pass` ⇒ 通过 | 这条是「deferred 混成 pass」缺口的判据形状 |
| `Q1` 缺口形态 | `selfcheck.ts` 里 `status: 'deferred'` **4 处**（三项 + §3.4 ② 的「开发姿态缺锁」项） | 三项是 `deferred` **而不是 `fail`** ⇒ 不阻断 ⇒ 门户照常对外服务 |
| `Q2` **测试面互斥点** | `tests/unit/selfcheck.test.ts`：`toBe('deferred')` × 1 处 + `toContain('4.3')` × 1 处 + **摘要断言 `embeddings_reachable_1024=deferred`** × 1 处 | **施工不同批改这里，测试必红**（最容易漏的耦合） |
| `Q3` 配置面缺口 | `admin_portal/src/**` 零 `/embeddings` 调用 | 门户侧**没有** MaaS embeddings 客户端 ⇒ 直连通路必须新增 |
| `Q4` 可复用件 | `POST {base}/embeddings` + body `{"model","input"}`（[`../../scripts/probes/qwen-verify.sh`](../../scripts/probes/qwen-verify.sh)）· `launch-template.ts` 常量 · 既有逐字比对测试 | 命中 4/4 ⇒ 施工不必重新发明请求形状 |
| `P1`/`P2`/`P3` 端到端 | stub 401 ⇒ 判据 fail · stub 768 ⇒ 判据 fail · stub **1024 ⇒ 判据 pass** | `P3` 是**正向控制**：没有它，前两条的 fail 可能只是「调不通」 |

## 施工清单（本行交付物 —— 由本探针的机械核实得出）

1. **新增两个非密钥键**（MaaS `base_url` + 模型名）：**真源 = `deploy/portal.compose.yml` 的 `environment:`**，并**必须同批登记** [`../../specs/deployment.md`](../../specs/deployment.md) §12.5.4 —— 否则 `make deploy-doc-audit` 的 `A2`（未登记的新键）转红。key **复用**现有门户专用 MaaS key 键（注入子进程那一样）。
2. **新增 embeddings 客户端**（门户侧现无）：形状照 `qwen-verify.sh` —— `POST {base}/embeddings` + `{"model","input"}`；判据 = **非 401/403 且 `data[0].embedding.length === 1024`**。
3. **`selfcheck.ts` 三项 `deferred` → 真断言**（三项各自的判据形状见上表）。
4. **测试同批改**（`Q2` 的三处互斥断言）+ 新增三项的**正/负用例**（含「768 维 ⇒ fail」与「版本漂移 ⇒ fail」）。
5. **产品行为判据**：容器内跑真自检 + 四条负例（假 MaaS ⇒ 401 / 坏维度 ⇒ 768 / 假锁 tag ⇒ 漂移 / 坏模板 ⇒ 逐字不符），每条断「**非零退出 · 日志点名 · 从未监听**」—— 体例同 `#1` 冒烟的 `N1`–`N3` 与 `#3` 的 `B2`。

## 待拍板（⚠️ 施工前须定）

- **① 键名与取值来源**：两个新键的建议名 `PORTAL_EMBEDDINGS_BASE_URL` / `PORTAL_EMBEDDINGS_MODEL`（与既有 `PORTAL_*` 同风格）；**取值来源**：`base_url` 与模型名属**非密钥** ⇒ 进 compose 真源；但**取值本身**在 `secrets.local.*` 里（不入仓）⇒ 生产由你填、本机开发留空时自检怎么表现（见 ②）。
- **② 开发姿态的行为**：按 §3.4 ②「`deferred` 不得当作 pass」，本行**取消**这三项 `deferred` ⇒ 开发姿态下**缺 MaaS 凭据**时应当是 `fail`（拒绝启动）还是保留一条**显式的开发降级**（`deferred` 但**只在非生产**）？**未拍板不施工**（这决定 `selfcheck.test.ts` 的改法与本地开发体验）。
- **③ 真 MaaS 的 1024 维实测**：需要真实凭据 ⇒ **执行点归 `#11`/`#14`（生产）**；本机可用 `qwen-verify.sh` 手工验（有 secrets 时）。本探针**不判**它（避免把「无凭据」伪装成「维度正确」）。
- **④ 是否接 CI**：建议接（本探针 `rc=0`、判据输入**全部入仓**、相 2 只需 `node`）。**未拍板不动 CI**。

## 踩坑（本轮 3 处，全部是探针自伤）

1. **`$( )` 里再套双引号会 `bad substitution`** —— detail 文案写 `$(emb_dim_from_body "${B768}")` ⇒ 整行不执行、判据直接不打印。修法：先算进变量、再拼接。
2. **双引号内的反引号仍是命令替换**（仓内**坑 7** 的第 N 次复发）：detail 里写 `` `v` `` ⇒ shell 去执行 `v`（`command not found`）。探头输出文案**一律不带反引号**。
3. **`grep -E` 的转义陷阱**：`'\\"model\\"'` 在单引号里是「字面反斜杠 + 引号」⇒ **匹配不上**（判据假红）。修法：`'{"model":"%s","input":'`（只转义真正需要转义的 `{`）。

## 边界（如实登记）

- 本探针**只读**：不改产品代码 / `specs/` / `deploy/` 制品；改写只落 `${TMP}`；相 2 只起**本地 stub**（`127.0.0.1` + 随机端口，跑完即杀）。
- **不判**真 MaaS（归 `#11`/`#14`）· **不判**产品行为（施工后由本行新增的容器内负例接管，接口已登记）· **本轮未接 CI**（待「待拍板 ④」定）。
- **判据输入全部入仓** ⇒ 用 `#5` 那套「干净检出模拟」（`git archive HEAD` + 覆盖待验探针）验过**两侧都 13/0/0**。
