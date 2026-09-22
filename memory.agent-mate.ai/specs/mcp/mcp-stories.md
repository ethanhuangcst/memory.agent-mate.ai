# mcp-stories — MCP 侧用户故事与验收条件（ATDD / BDD）

> **定位**：MCP 侧（[`mcp-design.md`](./mcp-design.md) / [`mcp-test.md`](./mcp-test.md) 覆盖的接入面、口径、配额、维护与工具可达性）的**用户故事与验收条件唯一 spec**，体例与 [`../web-portal/web-stories.md`](../web-portal/web-stories.md) 一致（故事「作为…我希望…以便…」 + Given-When-Then AC + 故事索引）。
> **状态**：v1.0（正文落盘） · as_of 2026-09-22 · 上游基准 `v0.10.0`（版本坐标唯一真源 [`../../upstream.lock`](../../upstream.lock)）
> **边界**：只写「本产品**新增**的 MCP 侧要求」与「跨进程 / 上游契约」——**不写上游自带功能的复述**（上游工具清单见 [`./mcp-capabilities.md`](./mcp-capabilities.md)，能力边界见 [`./mcp-design.md`](./mcp-design.md) §2）。设计见 [`./mcp-design.md`](./mcp-design.md)，测试见 [`./mcp-test.md`](./mcp-test.md)，部署见 [`../deployment.md`](../deployment.md) §3 / §5。
> **角色**：**用户**（持 `memo_` 令牌的 MCP 客户端使用者）· **管理员**（经 Cloudflare Access 进入管理面，其 MCP 入口为 `admin` 档）· **主人**（SSH 保底路径）· **运维**（上游制品、镜像与维护作业）· **集成方**（读本规格实现门户或对接方）
> **迁入说明（2026-09-22，Sprint 4 #1 文档边界修正）**：原 [`../web-portal/web-stories.md`](../web-portal/web-stories.md) 的 `S3`（用户通过 MCP 端点接入）与 `S4`（跨用户隔离）中属**跨进程/上游契约**的验收条件已迁入本文件（逐条映射见 §体例与追踪纪律 的「迁入映射」），门户侧只留业务行为。**原编号一律冻结**：本文件的 AC 编号为新的 `AC-M{n}.{m}` 空间；门户侧原 `AC3.*` / `AC4.*` 编号**不重排**，在迁徙登记表中保留映射。

---

## 体例与追踪纪律

- **故事格式**：作为「角色」，我希望「目标」，以便「价值」。
- **验收条件格式**：Given-When-Then（Gherkin）。**每条场景只验证一个行为**，`When` 只有**一个触发**；`Given` 放前置，`Then` 放可观察结果。
- **AC 编号**：`AC-M{故事号}.{序号}`（如 `AC-M4.2`）。**编号稳定，只追加、不重排** —— 跨文档引用一律写「`MS{n} AC-M{n}.{m}`」；重排会让既有引用静默失真。
- **场景标签**：`@happy` 正常路径 · `@error` 错误路径 · `@edge` 边界 · `@negative` 负向门禁 · `@authz` 越权。每个故事**必须**至少有一条 `@happy` 与一条 `@error` 或 `@negative`。
- **领域语言**：本项目的验收断言就是「可观察的路径、环境变量、命令参数、事件与计数」，因此 AC 中直接写这些确切值；但**不写**函数名、框架细节或 UI 元素。
- **占位符写法**：本文件一律写 `{MCP_HOST}` / `{ADMIN_HOST}` / `{handle}`。**不用**尖括号 —— Gherkin 把 `<...>` 当 Examples 参数，会造成「看着像占位符、实为未定义参数」的假可执行。
- **不混入上游功能**：上游自带的能力（101 项工具的逐项语义、tier/curator 的算法、加密算法选择）**不**在本文件写故事；本文件只写**我方新增的接入面、契约与运维要求**。
- **测试落点**：可执行用例登记在 [`./mcp-test.md`](./mcp-test.md) §4（`TC-M-*`）；AC 与用例的对应以本文「故事索引」的 `AC` 与 `测试用例` 两列为准。**不设自动化用例的 AC**（人工演练项）在 [`./mcp-test.md`](./mcp-test.md) §2 测试计划登记为**人工项**，并在本文「已知限制与开放问题」注明；除此以外不得默认已覆盖。
- **单一真源**：本文件是「MCP 侧要什么 / 怎样算完成」的唯一真源；设计不改写 AC，测试不改写 AC，排期只在 [`../sprint-plan.md`](../sprint-plan.md)。

### 迁入映射（原门户 `S3` / `S4` → 本文件）

| 原编号（门户） | 原场景 | 迁入后 | 归属判定依据 |
|---|---|---|---|
| `S3 AC3.1` | 持有效令牌完成一次工具调用 | `MS1 AC-M1.1` | HTTP MCP 端点与协议桥属跨进程契约 |
| `S3 AC3.2` | 凭据缺失或已失效时拒绝建立会话 | `MS1 AC-M1.2` | 「认证缺失即拒绝、不降级匿名」是 MCP 面的门禁 |
| `S3 AC3.6` | 对外与管理员入口的工具数一致 | `MS6 AC-M6.1` | `--profile` 档位与注册数属上游档位契约 |
| `S4 AC4.1` | 用户之间的检索互不可见 | `MS2 AC-M2.1` | 一用户一库的物理隔离判据 |
| `S4 AC4.2` | 按 id 直取他人记忆时不可见 | `MS2 AC-M2.2` | 上游读隔离的可观察行为 |
| 其余 `AC3.*` / `AC4.*` | — | **留在门户侧**（编号冻结、不重排） | 主语是门户进程 / 门户库 / 门户接入面 |

> **门户侧仍有交叉引用**：`AC3.5`（多 key 同库）、`AC3.7`（`last_used_at`）、`AC4.4`（库路径断言门禁）等仍由 [`../web-portal/web-stories.md`](../web-portal/web-stories.md) 定义，本文件**不复制**其正文，只前述映射指明去向。

### 故事索引

| # | 故事 | 角色 | AC | Product Backlog | Sprint | 设计 | 测试用例 |
|---|---|---|---|---|---|---|---|
| <a id="ms1"></a>MS1 | 对外 MCP 端点与令牌接入 | 用户 | AC-M1.1–AC-M1.4 | [`product-backlog.md`](../product-backlog.md) #32 · #14 · #30 | Sprint 4 PSP-W2「端到端接入」 | [`mcp-design.md`](./mcp-design.md) §5.6.2 | TC-M-L1-01 · TC-M-L1-02 · TC-M-L2-01 |
| <a id="ms2"></a>MS2 | 跨用户物理隔离的可观察判据 | 用户 | AC-M2.1–AC-M2.4 | [`product-backlog.md`](../product-backlog.md) #4 · #11 | Sprint 4 PSP-W2「端到端接入」 | [`mcp-design.md`](./mcp-design.md) §3 · §6.1 D3 · §6.2 V3 | TC-M-L1-03 · TC-M-L1-04 · TC-M-L3-01 |
| <a id="ms3"></a>MS3 | 会话桥与子进程生命周期 | 集成方 | AC-M3.1–AC-M3.4 | [`product-backlog.md`](../product-backlog.md) #33 | Sprint 4 PSP-W2「端到端接入」 | [`mcp-design.md`](./mcp-design.md) §5.6.2 | TC-M-L1-05 · TC-M-L1-06 |
| <a id="ms4"></a>MS4 | 启动模板与身份注入契约 | 集成方 | AC-M4.1–AC-M4.4 | [`product-backlog.md`](../product-backlog.md) #34 | Sprint 4 PSP-W2「端到端接入」 | [`mcp-design.md`](./mcp-design.md) §5.6.1 · §5.6.4 | TC-M-L0-01 · TC-M-L1-07 · TC-M-L3-02 |
| <a id="ms5"></a>MS5 | 制品契约与上游耦合面守护 | 运维 | AC-M5.1–AC-M5.4 | [`product-backlog.md`](../product-backlog.md) #35 · #21 | Sprint 4 PSP-W3 · Sprint 7 | [`mcp-design.md`](./mcp-design.md) §5.6.3 · §9 M | TC-M-L1-08 · TC-M-L1-09 |
| <a id="ms6"></a>MS6 | 档位与工具可达性 | 用户 | AC-M6.1–AC-M6.3 | [`product-backlog.md`](../product-backlog.md) #36 | Sprint 5 PSP-M3 | [`mcp-design.md`](./mcp-design.md) §8 · §9 J4 | TC-M-L1-10 · TC-M-L1-11 |
| <a id="ms7"></a>MS7 | 配额与限流在 MCP 面的生效 | 管理员 | AC-M7.1–AC-M7.4 | [`product-backlog.md`](../product-backlog.md) #6 · #17 | Sprint 4 PSP-W3 · Sprint 6 #10 | [`mcp-design.md`](./mcp-design.md) §5.4 · §9 L | TC-M-L1-12 · TC-M-L3-03 |
| <a id="ms8"></a>MS8 | 每用户库的后台维护 | 运维 | AC-M8.1–AC-M8.4 | [`product-backlog.md`](../product-backlog.md) #13 | Sprint 3 #5（已定档）· 生产定时器留 Sprint 6 | [`mcp-design.md`](./mcp-design.md) §5.3 | TC-M-L1-13 · TC-M-L3-04 |

---

<a id="ms1-story"></a>

## MS1 对外 MCP 端点与令牌接入

**故事**：作为**用户**，我希望用令牌把客户端指向 MCP 端点，以便无需 SSH 即可安全使用记忆能力。

**范围边界**：MCP 面只认 `Authorization: Bearer memo_…`；**不提供** REST / Web SDK / OpenAI 兼容等其它接入面（[`../product-backlog.md`](../product-backlog.md)「明确不做」）。令牌的签发、轮换与吊销归门户侧 [`../web-portal/web-stories.md`](../web-portal/web-stories.md) `S2`。

```gherkin
@AC-M1.1 @happy
Scenario: 持有效令牌完成一次工具调用
  Given 用户 alice 持有一把有效令牌
  When 客户端带该令牌连接 https://{MCP_HOST}/mcp
  Then 会话建立成功，可完成 initialize → tools/list → tools/call
  And 一次 memory_store 调用返回成功

@AC-M1.2 @negative
Scenario Outline: 凭据缺失或已失效时拒绝建立会话
  Given 客户端处于「<凭据状态>」
  When 客户端连接 https://{MCP_HOST}/mcp
  Then 会话建立被拒绝
  And 请求不被降级为匿名访问

  Examples:
    | 凭据状态 |
    | 未携带令牌 |
    | 携带已吊销的令牌 |

@AC-M1.3 @edge
Scenario: 令牌解析到的库路径与会话实际使用的库一致
  Given 用户 alice 持有一把有效令牌
  When 该令牌建立会话并写入一条记忆
  Then 记忆落在 /data/users/alice/ai-memory.db
  And 该会话不触碰 /data/ai-memory.db

@AC-M1.4 @negative
Scenario: 令牌格式非法时不进入会话建立流程
  Given 客户端携带的凭据不具备 memo_ 前缀
  When 客户端连接 https://{MCP_HOST}/mcp
  Then 会话建立被拒绝
  And 不因凭据内容而去创建任何用户目录或库
```

---

<a id="ms2-story"></a>

## MS2 跨用户物理隔离的可观察判据

**故事**：作为**用户**，我希望我的记忆只有我能看到，以便不与他人串号。

**范围边界**：隔离靠**一用户一数据库**（[`./mcp-design.md`](./mcp-design.md) §3 方案 ③）与**每用户身份**；**不依赖**上游多租户机制、也**不依赖**能力令牌。机制与冻结值见 [`./mcp-design.md`](./mcp-design.md) §0.1。门户侧的隔离执行（子进程隔离、审计、断言）见 [`../web-portal/web-stories.md`](../web-portal/web-stories.md) `S4`。

```gherkin
@AC-M2.1 @happy
Scenario: 用户之间的检索互不可见
  Given 用户 A 已写入一条记忆
  When 用户 B 在自己的会话中检索该内容
  Then 用户 B 检索不到该记忆
  And 检索不报错、不提示存在他人记忆

@AC-M2.2 @happy
Scenario: 按 id 直取他人记忆时不可见
  Given 用户 A 已写入一条记忆并已知其 id
  When 用户 B 在自己的会话中按该 id 取记忆
  Then 返回「记忆不存在」
  And 不返回该记忆的任何内容

@AC-M2.3 @edge
Scenario: 隔离在两个方向上都成立
  Given 用户 A 与用户 B 各写入一条互不相同的记忆
  When 双方各自检索对方的内容
  Then 两个方向都检索不到
  And 双方各自能检索到自己的记忆

@AC-M2.4 @negative
Scenario: 单库形态下的写路径伪造不成立
  Given 隔离已按一用户一数据库落地
  When 用户 B 在会话中以用户 A 的身份标记写入
  Then 该写入不进入用户 A 的库
  And 用户 A 的库中不出现来自用户 B 会话的内容
```

> **为什么 AC-M2.4 是负向门禁**：探针 P6 实测证明，**单库 + 每用户 env**（方案 ②）的写路径**完全可伪造** —— bob 以 `agent_id=human:iso-alice` 写入成功并回显 alice 身份。AC-M2.4 断言角色 ③ 让该路径**物理上不存在**（证据见 [`./mcp-design.md`](./mcp-design.md) §0 · §3）。

---

<a id="ms3-story"></a>

## MS3 会话桥与子进程生命周期

**故事**：作为**集成方**，我希望会话桥的行为被明确定义，以便按同一契约实现门户或对接方，而不必猜测生命周期。

**范围边界**：传输桥形态为 **HTTP(Streamable) ⇄ stdio**，**优先复用官方 MCP SDK** 的「server transport + stdio client transport」组合，**不自行实现协议**（[`./mcp-design.md`](./mcp-design.md) §5.6.2）。会话**子进程**由门户 spawn，**父死子死**。

```gherkin
@AC-M3.1 @happy
Scenario: 一会话对应一个上游子进程
  Given 用户 alice 已建立一个会话
  When 该会话存续期间观察上游进程
  Then 该会话对应恰好一个 ai-memory 子进程
  And 该子进程以 alice 的库路径与身份启动

@AC-M3.2 @happy
Scenario: 会话结束后子进程不残留
  Given 用户 alice 的会话已建立
  When 客户端断开该会话
  Then 对应的 ai-memory 子进程已退出
  And 不残留僵尸进程或占用中的库文件句柄

@AC-M3.3 @negative
Scenario: 两个用户的会话不复用同一个子进程
  Given 用户 alice 与用户 bob 分别建立会话
  When 比较两次会话对应的 ai-memory 进程
  Then 两个会话对应两个独立子进程
  And 不存在把同一子进程复用给不同用户的路径

@AC-M3.4 @edge
Scenario: 桥不缓存跨会话的响应
  Given 用户 alice 的会话已结束
  When 用户 bob 建立新会话并调用同一工具
  Then bob 收到的响应只含 bob 自己的数据
  And 不出现上一会话的任何响应片段
```

---

<a id="ms4-story"></a>

## MS4 启动模板与身份注入契约

**故事**：作为**集成方**，我希望启动模板与身份注入方式被钉死，以便新接入方不会误用会静默失效的注入方式。

**范围边界**：模板真源在 [`./mcp-design.md`](./mcp-design.md) **§5.6.4**（`launch.argv` / `launch.env` + 四条强制不变量）。**身份必须用环境变量注入** —— `--agent-id` 传 flag **不会写回 env**，会导致写入标记看似正常而读路径 trust-all（[`./mcp-design.md`](./mcp-design.md) §5.6.1 结论 2）。

```gherkin
@AC-M4.1 @happy
Scenario: 模板只含受支持的命令与键
  Given 启动模板按真源写成
  When 用 template 校验脚本逐键核对
  Then argv 与真源逐字一致（含 --tier 与 --profile）
  And env 只含真源登记的键
  And 不出现真源之外的键

@AC-M4.2 @negative
Scenario: 用命令参数注入身份时被判定为不合格
  Given 模板把身份改为通过 --agent-id 参数传入
  When 用 template 校验脚本核对
  Then 校验失败
  And 报错指出身份必须通过 AI_MEMORY_AGENT_ID 环境变量注入

@AC-M4.3 @negative
Scenario: 库路径缺失时拒绝启动会话
  Given 启动模板中的 AI_MEMORY_DB 被置空
  When 尝试建立会话
  Then 在 spawn 前拒绝启动会话
  And 不出现静默落到共享主库 /data/ai-memory.db 的会话

@AC-M4.4 @negative
Scenario: 库路径指向有效但属于他人的库时拒绝启动会话
  Given 启动模板中的 AI_MEMORY_DB 被改为一个存在且可写的他用户库路径
  When 尝试建立会话
  Then 在 spawn 前拒绝启动会话
  And 拒绝理由指出该路径与当前 handle 不匹配
  And 该会话未写入任何数据
```

> **AC-M4.3 / AC-M4.4 的门禁角色**：对应 [`./mcp-design.md`](./mcp-design.md) §6.2 **V1** 负向判据与 §6.1 **D1**；门户侧的同名执行断言见 [`../web-portal/web-stories.md`](../web-portal/web-stories.md) `AC4.4` / `AC4.7`（两条互补：本文件断言**契约要求**，门户侧断言**执行与告警**）。

---

<a id="ms5-story"></a>

## MS5 制品契约与上游耦合面守护

**故事**：作为**运维**，我希望上游制品契约在升级时被机械核对，以便上游改名或改行为时**响亮失败**而不是静默漂移。

**范围边界**：三项制品契约（二进制路径 / 运行时底座 / 容器用户 **UID·GID 对齐**）见 [`./mcp-design.md`](./mcp-design.md) §5.6.3；门户对上游的 8 个依赖点索引（C1–C8 → A–K）见同文件 §9 **M**。

```gherkin
@AC-M5.1 @happy
Scenario: 候选镜像的三项制品契约可被探针核对
  Given 候选上游镜像已拉取
  When 探针核对二进制路径、运行时底座与容器用户
  Then 二进制位于 /usr/local/bin/ai-memory
  And 底座为 bookworm 系且含 ca-certificates
  And 容器用户 aimem 存在

@AC-M5.2 @edge
Scenario: 门户镜像与上游镜像的用户标识对齐
  Given 门户镜像与上游镜像均已构建
  When 比较两者内 aimem 的 UID/GID
  Then 两者一致
  And 因此门户创建的 0700 用户目录可被以 aimem 打开

@AC-M5.3 @negative
Scenario: 契约项缺项或改名时阻断升级
  Given 候选镜像相对基线快照缺少某契约项
  When 运行升级预检
  Then 预检失败并阻断升级
  And 报错指出缺失或改名的契约项

@AC-M5.4 @negative
Scenario: 旧二进制操作更新的库时被流程阻断
  Given 用户库的 schema 版本已被前向迁移
  When 以版本锁之外的旧二进制启动会话
  Then 预检拒绝该二进制
  And 不允许其操作该库
```

> **为什么 AC-M5.4 存在**：上游**不拒绝**旧二进制操作更新的库（`migrate()` 在 `version >= CURRENT` 直接返回成功，全 `src` 无「库过新则拒绝」逻辑）⇒ 回滚只改 `IMAGE_TAG` 会导致**静默数据损坏**（[`./mcp-design.md`](./mcp-design.md) §9 **J3**）。故须由我方预检承担该门禁。

---

<a id="ms6-story"></a>

## MS6 档位与工具可达性

**故事**：作为**用户**，我希望对外暴露的工具集与我的使用方式匹配、且非英文输入也能用，以便不因档位或语言而在工具层失效。

**范围边界**：档位与工具数的**实际注册数**以探针实测为准（[`./mcp-design.md`](./mcp-design.md) §8.1）；对外统一 `--profile core`（8 项）、管理员入口 `admin`（22 项），决议见 §8.3。工具逐项语义属上游能力，见 [`./mcp-capabilities.md`](./mcp-capabilities.md)，本文件不复述。

```gherkin
@AC-M6.1 @edge
Scenario: 对外与管理员入口实际暴露的工具数与定档一致
  Given 对外用户通道与管理入口分别按各自模板启动
  When 用 initialize 回包核对实际注册的工具数
  Then 对外用户通道为 core 档 8 项
  And 管理员入口为 admin 档 22 项

@AC-M6.2 @edge
Scenario: 非英文输入命中工具并完成一次写入与召回
  Given 客户端以中文提出一次记忆写入请求
  When 该请求经 MCP 会话执行
  Then 写入成功且返回成功计数
  And 随后以中文提出的召回请求能命中该条记忆

@AC-M6.3 @negative
Scenario: 关键词通路的中文限制被明确登记而非静默失败
  Given 记忆以中文整段写入
  When 以该整段的真子串发起关键词检索
  Then 检索按已登记的边界返回未命中
  And 该边界有可复跑的探针证据
```

> **AC-M6.3 的口径来源**：FTS5 默认分词器 `unicode61`、建表未指定 `tokenize=`、无任何语言配置项 ⇒ 中文关键词只认**标点/空白界定的整段**、简繁不互通（[`./mcp-design.md`](./mcp-design.md) §9 **J4**，探针 `scripts/i18n-probe.sh`）。工程口径：中文检索走语义召回通路。**AC-M6.3 断言「边界被登记且可复跑」，不是断言「检索失败」**。

---

<a id="ms7-story"></a>

## MS7 配额与限流在 MCP 面的生效

**故事**：作为**管理员**，我希望每用户的上游配额在 MCP 面确实生效、并知道哪些上限**不适用**于 stdio，以便不依赖不生效的机制。

**范围边界**：上游 `[limits]` 的七键与优先级阶梯见 [`./mcp-design.md`](./mcp-design.md) §5.4 / §9 **L**；**门户自建**的会话级与全局并发上限属门户侧（[`../web-portal/web-design.md`](../web-portal/web-design.md) §7）。

```gherkin
@AC-M7.1 @happy
Scenario: 超每用户写入配额时 MCP 写入被拒
  Given 某用户的每日写入配额已被用尽
  When 该用户经 MCP 再写入一条记忆
  Then 写入被拒绝并返回配额超限错误
  And 错误串含 QUOTA_EXCEEDED

@AC-M7.2 @edge
Scenario: 配额按用户独立计算
  Given 用户 A 的配额已被用尽
  When 用户 B 经 MCP 写入一条记忆
  Then 用户 B 的写入成功

@AC-M7.3 @negative
Scenario: 用 CLI 一次性写入验证配额会得到错误结论
  Given 某用户的每日写入配额已被用尽
  When 用 ai-memory store 命令（CLI 一次性写入）验证配额
  Then 该命令返回成功
  And 该结果不被采纳为「配额失效」的证据

@AC-M7.4 @edge
Scenario: stdio 会话下的 HTTP 专属上限不生效且已登记结论
  Given 配额已按编译默认配置
  When 在 stdio 会话中触发并发上限场景
  Then 该 HTTP 专属上限层不触发
  And 该结论有可复跑的探针证据并被登记
```

> **AC-M7.3 / AC-M7.4 的口径来源**：CLI 一次性写入**故意不计费**（仅 daemon 面调用配额检查），且 `max_page_size` / `max_inflight_requests` 是 **HTTP 面专属**、stdio 不经过（[`./mcp-design.md`](./mcp-design.md) §9 **L3 / L6**）。两条都是「防误判」的登记型 AC。

---

<a id="ms8-story"></a>

## MS8 每用户库的后台维护

**故事**：作为**运维**，我希望每个用户库的过期记忆与 WAL 被周期性回收，以便库不会只涨不缩、过期数据不会长期残留。

**范围边界**：调度**定档为主机 cron**，唯一入口是逐库维护脚本（[`./mcp-design.md`](./mcp-design.md) §5.3）。**生产定时器安装、日志采集与告警留 Sprint 6**，本 Sprint 只冻结命令口径与失败语义。

```gherkin
@AC-M8.1 @happy
Scenario: 逐库维护命令覆盖 TTL 驱逐与 WAL 回收
  Given 某用户库中存在已过期记忆
  When 对该库执行 gc
  Then 过期记忆被驱逐
  And 该库的 WAL 文件被截断回收

@AC-M8.2 @negative
Scenario: 漏传库路径时不允许回落到相对路径库
  Given 维护命令的库路径参数被移除
  When 运行维护脚本
  Then 脚本拒绝执行并以非零码退出
  And 不产生相对路径的 ai-memory.db

@AC-M8.3 @edge
Scenario: 单个库失败不中断其余库的维护
  Given 维护目标中有一个库不可访问
  When 运行维护脚本
  Then 其余库仍被依次处理
  And 最终以非零码退出以供告警

@AC-M8.4 @negative
Scenario: 环境不可用时不得把「什么都没维护」当作成功
  Given 上游容器未运行
  When 运行维护脚本
  Then 脚本以环境不可用码退出
  And 不报告维护成功
```

> **为什么 AC-M8.2 是负向门禁**：源码侧 `--db` 只是 `AI_MEMORY_DB` 的 fallback；不传且 env 缺省时会**静默新建**相对路径 `ai-memory.db`（实测 rc=0），而容器内该 env 指向**主库** ⇒ 漏传即可能误操作主库（[`./mcp-design.md`](./mcp-design.md) §5.3「两条硬约束」）。退出码契约与失败语义同节。

---

## 范围外（明确不做）

- **上游自带功能的复述**：101 项工具的逐项语义、tier/curator 算法、加密算法选择 —— 见 [`./mcp-capabilities.md`](./mcp-capabilities.md) 与 [`./mcp-design.md`](./mcp-design.md) §2。
- **REST / Web SDK / OpenAI 兼容接入面**：与 [`../product-backlog.md`](../product-backlog.md)「明确不做」一致。
- **门户业务行为**：建用户、令牌生命周期、审计视图、接入说明页与 i18n —— 见 [`../web-portal/web-stories.md`](../web-portal/web-stories.md) `S1` / `S2` / `S5` / `S6`。
- **上游源码修改**：定制口径为「配置 + 外围组件」，不改上游源码（[`../product-backlog.md`](../product-backlog.md) 需求边界 #31）。

## 已知限制与开放问题

| # | 项 | 说明 |
|---|---|---|
| 1 | `MS5 AC-M5.3` 的探针步骤尚未落地 | `scripts/upstream-preflight.sh --with-image` 已能校验镜像指纹，但「镜像内 `--help` / `id aimem` 与 baseline 快照比对」这一步登记为待补（[`./mcp-design.md`](./mcp-design.md) §9 M） |
| 2 | `MS8` 的生产定时器与告警 | 安装、日志与告警留 Sprint 6；本 Sprint 只冻结命令口径、失败语义与退出码 |
| 3 | `MS6 AC-M6.2` 的复现矩阵 | 「中文 vs 英文提问 × 对外 8 项工具」的完整矩阵归 Sprint 5 `PSP-M3`；本文件只固定判据 |
| 4 | 归档只增不减 | `gc` 默认归档而非硬删 ⇒ `archived_memories` 会持续累积；清理逃生口 `archive purge` 的调度同样留 Sprint 6（[`./mcp-design.md`](./mcp-design.md) §5.3「边界」） |

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-22 | 占位创建：随 Replan（Sprint 4–7 重排）登记为 **Sprint 5 #1 的交付物**，并进入 [`../architecture.md`](../architecture.md) §7「相关」表；正文待落盘 |
| 2026-09-22 | **正文落盘（Sprint 4 #1 文档边界修正）**：由占位转正文。① 从 [`../web-portal/web-stories.md`](../web-portal/web-stories.md) **迁入** 5 条跨进程/上游契约 AC（`AC3.1` / `AC3.2` / `AC3.6` / `AC4.1` / `AC4.2` → `AC-M1.1` / `AC-M1.2` / `AC-M6.1` / `AC-M2.1` / `AC-M2.2`，逐条映射见「迁入映射」）；② 为 MCP 本产品**新增功能**新写 8 条故事的其余验收条件（`MS1` 端点与令牌接入 · `MS2` 物理隔离判据 · `MS3` 会话桥与子进程生命周期 · `MS4` 启动模板与身份注入 · `MS5` 制品契约与耦合面守护 · `MS6` 档位与工具可达性 · `MS7` 配额生效 · `MS8` 每库维护），**不含**上游自带功能的复述；③ 建立本文件独立的 `MS{n}` / `AC-M{n}.{m}` 编号空间，门户侧原 `AC3.*` / `AC4.*` 编号**不重排**（锚点与编号冻结）；④ 交付物由 Sprint 5 #1 提前到 Sprint 4 #1 ⇒ Sprint 5 #1 范围按此收窄（见 [`../sprint-plan.md`](../sprint-plan.md)） |
