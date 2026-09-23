# web-stories — 门户用户故事与验收条件（ATDD / BDD）

> **定位**：**门户自身（web app）**用户故事与验收条件（AC）的唯一 spec —— 只写「门户业务要什么、怎样算完成」。设计见 [`web-design.md`](./web-design.md)，测试计划与用例见 [`web-test.md`](./web-test.md)，排期与执行状态见 [`../sprint-backlog.md`](../sprint-backlog.md)。
> **文档边界（2026-09-22 起）**：**跨进程 / 上游契约**的故事与 AC 归 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md)（`MS{n}` / `AC-M{n}.{m}`）；**MCP 侧隔离、档位与能力边界**见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §0–§9。原 `S3` / `S4` 的 5 条契约类 AC 已迁出，编号**不重排**、在本文件保留「迁出登记表」。
> **状态**：v2.2（UI 设计系统 / 四语言 / 认证模型定档） · as_of 2026-09-22 · 当前门户**代码为零**，本 spec 先于实现落盘
> **上游基准**：`v0.10.0`（版本坐标唯一真源 [`../../upstream.lock`](../../upstream.lock)）
> **角色**：**管理员**（邀请制，经 Cloudflare Access 进入管理面）· **用户**（持 `memo_` 令牌的 MCP 客户端使用者）· **新用户**（尚未接入，读说明页）· **主人**（SSH 保底路径）· **运维**（门户与镜像）
> **边界**：不写实现方案、不写部署动作、不写密钥与真实 IP；实现与部署分别见 [`web-design.md`](./web-design.md) 与 [`../deployment.md`](../deployment.md) §12.2

---

## 体例与追踪纪律

- **故事格式**：作为「角色」，我希望「目标」，以便「价值」。
- **验收条件格式**：Given-When-Then（Gherkin）。**每条场景只验证一个行为**，`When` 只有**一个触发**；`Given` 放前置，`Then` 放可观察结果。
- **AC 编号**：`AC{故事号}.{序号}`（如 `AC4.4`）。**编号稳定，只追加、不重排** —— 跨文档引用一律写「`S{n} AC{n}.{m}`」；重排会让既有引用静默失真。
- **场景标签**：`@happy` 正常路径 · `@error` 错误路径 · `@edge` 边界 · `@negative` 负向门禁 · `@authz` 越权。每个故事**必须**至少有一条 `@happy` 与一条 `@error` 或 `@negative`。
- **领域语言**：本项目的验收断言就是「可观察的路径、环境变量、事件与计数」，因此 AC 中直接写这些确切值；但**不写**按钮 ID、CSS 类、函数名或框架细节。
- **占位符写法**：本文件一律写 `{MCP_HOST}` / `{ADMIN_HOST}` / `{handle}`。**不用**尖括号 —— Gherkin 把 `<...>` 当 Examples 参数，会造成「看着像占位符、实为未定义参数」的假可执行。
- **测试落点**：可执行用例登记在 [`web-test.md`](./web-test.md) §2（`TC-P-L0/L1/L2/L3-*`）；AC 与用例的对应以本文「故事索引」的 `AC` 与 `测试用例` 两列为准（按区间覆盖）。**不设自动化用例的 AC**（流程留痕项、人工演练项）在 [`web-test.md`](./web-test.md) §1 测试计划登记为**人工项**，并在本文「已知限制与开放问题」注明；除此以外不得默认已覆盖。
- **单一真源**：本文件是「要什么 / 怎样算完成」的唯一真源；设计不改写 AC，测试不改写 AC，排期只在 [`../sprint-backlog.md`](../sprint-backlog.md)。

### 故事索引

| # | 故事 | 角色 | AC | Product Backlog | Sprint | 设计 | 测试用例 |
|---|---|---|---|---|---|---|---|
| <a id="s1"></a>S1 | 创建用户（邀请制） | 管理员 | AC1.1–AC1.8 | [`product-backlog.md`](../product-backlog.md) #27 | Sprint 4 `#2` | [`web-design.md`](./web-design.md) §4.2 | TC-P-L0-01 · TC-P-L1-01 · TC-P-L3-02 |
| <a id="s2"></a>S2 | 令牌生命周期 | 管理员 | AC2.1–AC2.9 | [`product-backlog.md`](../product-backlog.md) #3 | Sprint 4 `#2` | [`web-design.md`](./web-design.md) §4.1 | TC-P-L0-04 · TC-P-L1-02 · TC-P-L2-11 · TC-P-L3-04 |
| <a id="s3"></a>S3 | 令牌接入的门户侧执行（MCP 侧契约已迁） | 用户 | `AC3.3`–`AC3.5` · `AC3.7`（`AC3.1` / `AC3.2` / `AC3.6` → [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS1` / `MS6`） | [`product-backlog.md`](../product-backlog.md) #14 / #28 | [Sprint 4 `3.1`](../sprint-backlog.md#s4-mcp-session-bridge) · `3.4` | [`web-design.md`](./web-design.md) §2 / §4.1 | TC-P-L1-04 · TC-P-L1-06 · TC-P-L2-03 |
| <a id="s4"></a>S4 | 门户侧的隔离执行与审计（MCP 侧契约已迁） | 用户 | `AC4.3`–`AC4.7`（`AC4.1` / `AC4.2` → [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS2`） | [`product-backlog.md`](../product-backlog.md) #4 / #11 | Sprint 4 `3.2` / `3.3` / `3.4` | [`web-design.md`](./web-design.md) §1 / §5 | TC-P-L0-02 · TC-P-L0-03 · TC-P-L1-05 · TC-P-L1-07 · TC-P-L3-01 · TC-P-L3-05 · TC-P-L3-09 |
| <a id="s5"></a>S5 | 审计可追溯 | 管理员 | AC5.1–AC5.3 | [`product-backlog.md`](../product-backlog.md) #5 | [Sprint 6 `#1`](../sprint-backlog.md#s4-audit-view) | [`web-design.md`](./web-design.md) §4.4 | TC-P-L0-05 |
| <a id="s6"></a>S6 | 接入说明页与 i18n | 新用户 | AC6.1–AC6.11 | [`product-backlog.md`](../product-backlog.md) #7 | Sprint 4 `4.2` | [`web-design.md`](./web-design.md) §2 / §13 / §14 | TC-P-L2-04 · TC-P-L2-05 · TC-P-L2-07 |
| <a id="s7"></a>S7 | 容量、配额与限流 | 管理员 | AC7.1–AC7.6 | [`product-backlog.md`](../product-backlog.md) #6 / #17 / #29 | Sprint 4 `4.1` · Sprint 6 `#2`–`#5` | [`web-design.md`](./web-design.md) §7 · [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.4 | TC-P-L3-06 · TC-P-L3-07 |
| <a id="s8"></a>S8 | 主人保底路径不受影响 | 主人 | AC8.1–AC8.4 | [`product-backlog.md`](../product-backlog.md) #14 | [Sprint 5 `#12`](../sprint-backlog.md#s5-access-surfaces) | [`web-design.md`](./web-design.md) §2 | TC-P-L1-08 |
| <a id="s9"></a>S9 | 门户自身数据的边界 | 运维 | AC9.1–AC9.4 | [`product-backlog.md`](../product-backlog.md) #9 / #26 | Sprint 5 `#3` · Sprint 5 `#16` | [`web-design.md`](./web-design.md) §4.4 / §11 | TC-P-L1-10 · TC-P-L3-08 |
| <a id="s10"></a>S10 | 管理面访问控制与面隔离 | 管理员 | AC10.1–AC10.10 | [`product-backlog.md`](../product-backlog.md) #2 / #16 | Sprint 4 `#2` | [`web-design.md`](./web-design.md) §6 / §6.1 | TC-P-L3-03 · TC-P-L1-14 |
| <a id="s11"></a>S11 | 门户启动自检（fail-closed） | 运维 | AC11.1–AC11.5 | [`product-backlog.md`](../product-backlog.md) #18 | Sprint 4 `4.3` | [`web-design.md`](./web-design.md) §3.4 | TC-P-L0-06 · TC-P-L0-07 · TC-P-L0-08 · TC-P-L0-09 |
| <a id="s12"></a>S12 | 门户制品契约与升级治理 | 运维 | AC12.1–AC12.5 | [`product-backlog.md`](../product-backlog.md) #18 | Sprint 5 `#2` · Sprint 7 `#3` / `#6` | [`web-design.md`](./web-design.md) §3.1 / §3.2 / §9 | TC-P-L1-09 · TC-P-L1-11 · TC-P-L1-12 |
| <a id="s13"></a>S13 | 门户容器最小攻击面 | 运维 | AC13.1–AC13.3 | [`product-backlog.md`](../product-backlog.md) #16 · [`../adr/ADR-012`](../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md) | Sprint 5 `#4` | [`web-design.md`](./web-design.md) §3 / §8 T1 | TC-P-L1-08 · TC-P-L1-13 |
| <a id="s14"></a>S14 | 门户 UI 设计系统与版式一致性 | 运维 | AC14.1–AC14.12 | [`product-backlog.md`](../product-backlog.md) #7 | Sprint 6 `#6` | [`web-design.md`](./web-design.md) §13 / §14 | TC-P-L0-10 · TC-P-L0-11 · TC-P-L2-06 · TC-P-L2-08 · TC-P-L2-09 · TC-P-L2-10 · TC-P-L2-12 · TC-P-L2-13 |

---

<a id="s1-story"></a>
## S1 创建用户（邀请制）

**故事**：作为**管理员**，我希望在管理面用 handle 创建一个用户，以便为其分配独立的记忆空间。

**范围边界**：不开放自助注册；无审批流（创建即生效）；handle 只来自管理员输入，**绝不**取自 MCP 请求。
**落地前提**：`/data/users` 为 `root:aimem 2775`（setgid 一次性引导）⇒ 门户以 `aimem` 身份即可建目录，无需 root（[`../deployment.md`](../deployment.md) §4.4）。

```gherkin
@AC1.1 @happy
Scenario: 管理员创建合法 handle 的用户
  Given 管理员已通过 Cloudflare Access 进入管理面
  And /data/users 为 root:aimem 2775（setgid 引导已完成）
  When 管理员提交 handle "alice"
  Then 用户 alice 创建成功
  And /data/users/alice/ 已存在且权限为 0700
  And 该目录属主与容器内 aimem 一致
  And 审计中出现一条 create_user 事件

@AC1.2 @error
Scenario: handle 不符合命名规范时拒绝创建
  Given 管理员已进入管理面
  When 管理员提交 handle "Alice!"
  Then 创建被拒绝并给出明确原因
  And 不创建任何用户
  And /data/users/ 下不产生新目录

@AC1.3 @negative
Scenario: handle 含路径穿越字符时拒绝创建
  Given 管理员已进入管理面
  When 管理员提交 handle "../bob"
  Then 创建被拒绝并给出明确原因
  And /data/users/ 下不产生预期外的目录
  And 既有用户与其目录未被改动

@AC1.4 @authz
Scenario Outline: 非管理员无法创建用户或令牌
  Given 请求方处于「<身份条件>」
  When 请求方提交创建用户或签发令牌的请求
  Then 请求被拒绝
  And 不创建用户、不签发令牌

  Examples:
    | 身份条件 |
    | 没有有效的 Cloudflare Access 身份 |
    | 在 MCP 域名上调用管理接口 |

@AC1.5 @happy
Scenario: 创建动作留下审计
  Given 管理员已进入管理面
  When 管理员成功创建一个用户
  Then 审计中出现该用户与创建者身份的记录
  And 该记录不包含令牌明文

@AC1.6 @edge
Scenario: handle 已存在时拒绝且不覆盖
  Given 管理面已存在用户 alice
  When 管理员再次提交 handle "alice"
  Then 创建被拒绝并给出「已存在」的原因
  And 用户 alice 的既有目录与数据未被改动
  And 不产生第二条 create_user 审计

@AC1.7 @error
Scenario: 用户目录创建失败时不产生半成品用户
  Given /data/users 不可写（setgid 引导缺失）
  When 管理员提交合法 handle "alice"
  Then 创建失败并给出可读的错误
  And 门户中不存在名为 alice 的可用用户
  And 审计中不出现该用户的创建成功记录

@AC1.8 @authz
Scenario: 用户页不提供管理员增删入口
  Given 管理员已进入用户页
  When 查看页面上的操作入口
  Then 页面只提供「创建用户」
  And 页面不提供邀请管理员、删除管理员或重设密码的控件
  And 页面指向管理员变更的实际位置（Cloudflare Access 策略）
```

---

<a id="s2-story"></a>
## S2 令牌生命周期

**故事**：作为**管理员**，我希望对用户的 `memo_` 令牌做签发、列出、轮换与吊销，以便泄露时可即时止血且保留审计链。

**范围边界**：明文**仅创建响应中出现一次**，此后不可取回（无「查看」）；不做物理删除，删除 = 软吊销。

```gherkin
@AC2.1 @happy
Scenario: 签发令牌并只展示一次明文
  Given 用户 alice 已存在
  When 管理员为 alice 签发一把令牌
  Then 响应中出现 `memo_` 开头的明文令牌（32 字节 CSPRNG，base64url 无填充，共 43 字符）
  And 此后任何列出或查询操作都不再返回该明文

@AC2.2 @negative
Scenario: 令牌明文不可从存储或界面取回
  Given 管理员已为 alice 签发一把令牌
  When 尝试从门户的存储、列表或任何接口取回该令牌明文
  Then 取回失败
  And 存储中只有该令牌的 sha256 与 key_prefix（`memo_` + 前 8 字符）
  And 令牌校验为常时比较，不因前缀不匹配而提前返回

@AC2.3 @edge
Scenario: 签发时幂等确保用户目录存在
  Given 用户 alice 已在门户登记但 /data/users/alice/ 不存在
  When 管理员为 alice 签发令牌
  Then /data/users/alice/ 被幂等创建且属主对齐 aimem
  And 不创建 ai-memory 数据库文件

@AC2.4 @happy
Scenario: 列出令牌元信息
  Given 用户 alice 有两把令牌，其中一把已被使用过
  When 管理员查看 alice 的令牌列表
  Then 列表显示每把令牌的前缀、标签、创建时间与最后使用时间
  And 列表不显示任何明文令牌
  And 不提供取回明文的操作

@AC2.5 @happy
Scenario: 轮换令牌使旧令牌不可复活
  Given 用户 alice 持有一把已签发的令牌
  When 管理员轮换 alice 的令牌
  Then 旧令牌被吊销且新令牌被签发
  And 使用旧令牌的后续请求被拒绝
  And 不存在任何操作可以让旧令牌重新生效

@AC2.6 @edge
Scenario: 删除令牌为软吊销并保留审计链
  Given 用户 alice 持有一把已签发的令牌
  When 管理员删除该令牌
  Then 该令牌被置为已吊销状态并立即失效
  And 该令牌的历史审计记录仍然保留且可查询

@AC2.7 @negative
Scenario: 吊销后新会话被拒且既有会话被终止
  Given 用户 alice 已用某令牌建立了 MCP 会话
  When 管理员吊销该令牌
  Then 用该令牌新建会话被拒绝
  And alice 的既有会话被终止（其 ai-memory 子进程被回收）

@AC2.8 @happy
Scenario: 令牌操作留下审计
  Given 管理员已依次完成一次签发、一次轮换与一次吊销
  When 管理员查询审计视图
  Then 审计中分别出现签发、轮换与吊销三类事件
  And 审计中不出现令牌明文，只出现 key_prefix

@AC2.9 @error
Scenario Outline: 对不存在的令牌执行「<操作>」
  Given 门户中不存在前缀为 "memo_deadbeef" 的令牌
  When 管理员对该前缀执行「<操作>」
  Then 操作被明确拒绝
  And 不签发任何新令牌
  And 不产生虚假的成功审计

  Examples:
    | 操作 |
    | 轮换 |
    | 吊销 |
```

---

<a id="s3-story"></a>
## S3 令牌接入的门户侧执行（MCP 侧契约已迁）

**故事**：作为**用户**，我希望持令牌经门户接入时门户侧行为可预测（子进程被回收、多设备共享同一份记忆），以便日常使用不出意外。

**范围边界**：本故事只写**门户侧**行为。原「MCP 端点与协议桥」相关验收条件属**跨进程 / 上游契约**，已迁至 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md)。**编号冻结**：`AC3.*` **不重排**；移出的编号在下表保留登记、不在本文件定义（避免既有引用静默失真）。
**MCP 面只认** `Authorization: Bearer memo_…`；不提供 REST / Web SDK / OpenAI 兼容等其它接入面。

**迁出登记（原 `AC3.*` → MCP 侧，2026-09-22，Sprint 4 #1）**：

| 原编号 | 场景 | 去向 |
|---|---|---|
| `AC3.1` | 持有效令牌完成一次工具调用 | [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS1 AC-M1.1` |
| `AC3.2` | 凭据缺失或已失效时拒绝建立会话 | [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS1 AC-M1.2` |
| `AC3.6` | 对外与管理员入口的工具数一致 | [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS6 AC-M6.1` |

**留本文件的验收条件**（门户侧行为）：

```gherkin
@AC3.3 @edge
Scenario: MCP 面不被 Cloudflare Access 拦截
  Given MCP 面已显式绕过 Cloudflare Access
  When 命令行客户端连接 https://{MCP_HOST}/mcp
  Then 客户端不会收到登录重定向或登录页面
  And 客户端完成 MCP 握手

@AC3.4 @happy
Scenario: 会话结束后子进程被回收
  Given 用户 alice 已建立会话并由门户 spawn 了一个 ai-memory 子进程
  When 客户端断开该会话
  Then 该用户的 ai-memory 子进程已退出
  And 不残留僵尸进程或占用中的库文件句柄

@AC3.5 @happy
Scenario: 同一用户的多把令牌共享同一份记忆
  Given 用户 alice 有两把有效令牌（分别用于设备 A 与设备 B）
  And 设备 A 已用其中一把令牌写入一条记忆
  When 设备 B 用另一把令牌检索该记忆
  Then 设备 B 召回同一条记忆
  And 两把令牌解析到同一 handle 与同一库文件

@AC3.7 @edge
Scenario: 多把令牌的使用时间各自独立更新
  Given 用户 alice 有两把有效令牌
  When 只有其中一把令牌被使用
  Then 该令牌的最后使用时间被更新
  And 另一把令牌的最后使用时间保持不变
```

---

<a id="s4-story"></a>
## S4 门户侧的隔离执行与审计（MCP 侧契约已迁）

**故事**：作为**用户**，我希望门户在每次会话里都真的把隔离执行到位、且事后可对账，以便隔离不是纸面约定。

**范围边界**：本故事只写**门户侧**的隔离**执行、断言与审计**。隔离的**可观察判据**（跨用户检索互不可见、按 id 直取不可见）属**物理隔离契约**，已迁至 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md)。**编号冻结**：`AC4.*` **不重排**（`AC4.4` 被 V1 判据与冲刺条目引用）。
**门禁**：`AC4.4` 是**上线准入门槛**（对应 V1 负向判据，定义见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §6.2）；不通过则不得上线。

**迁出登记（原 `AC4.*` → MCP 侧，2026-09-22，Sprint 4 #1）**：

| 原编号 | 场景 | 去向 |
|---|---|---|
| `AC4.1` | 用户之间的检索互不可见 | [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS2 AC-M2.1` |
| `AC4.2` | 按 id 直取他人记忆时不可见 | [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS2 AC-M2.2` |

**留本文件的验收条件**（门户侧执行与审计）：

```gherkin
@AC4.3 @edge
Scenario: 每次会话断言并记录实际使用的库路径
  Given 用户 alice 的会话已建立
  When 门户为该会话写入审计
  Then 审计行含该会话解析出的库路径
  And 该路径等于 /data/users/alice/ai-memory.db

@AC4.4 @negative @gate
Scenario: 模板缺失库路径时拒绝启动会话
  Given 启动模板中的 AI_MEMORY_DB 被置空
  When 用户尝试建立会话
  Then 门户拒绝启动会话并告警
  And 不出现静默落到共享主库 /data/ai-memory.db 的会话

@AC4.5 @edge
Scenario: 会话前后不出现其他用户的库或临时文件
  Given 用户 alice 的会话即将建立
  When 会话建立并结束
  Then /data/users/ 下除既有用户目录外不出现其他用户的库文件
  And 不残留本会话的临时文件

@AC4.6 @negative
Scenario: 会话不跨用户复用
  Given 用户 alice 与用户 bob 分别建立会话
  When 比较两次会话对应的 ai-memory 进程
  Then 两个会话对应两个独立子进程
  And 不存在把同一子进程复用给不同用户的路径

@AC4.7 @negative
Scenario: 库路径指向有效但属于他人的库时拒绝启动会话
  Given 启动模板中的 AI_MEMORY_DB 被改为一个存在且可写的他用户库路径
  When 用户尝试建立会话
  Then 门户在 spawn 前拒绝启动会话
  And 拒绝理由指出该路径与当前 handle 不匹配
  And 该用户会话未写入任何数据
```

---

<a id="s5-story"></a>
## S5 审计可追溯

**故事**：作为**管理员**，我希望审计视图覆盖关键事件，以便事后对账「这次会话落在哪个库」。

**范围边界**：只记事件与必要的标识（如 key_prefix、解析出的库路径）；**不记录**令牌明文与 MCP 报文正文。

```gherkin
@AC5.1 @happy
Scenario: 关键事件均可查询
  Given 门户已完成建用户、签发、轮换、吊销与若干次会话
  When 管理员查询审计视图
  Then 上述五类事件均可查到
  And 每条事件含时间、操作者与目标

@AC5.2 @happy
Scenario: 会话审计含解析出的库路径
  Given 用户 alice 建立过一次会话
  When 管理员查看该次会话开始的审计行
  Then 该行含解析出的库路径 /data/users/alice/ai-memory.db
  And 可由该行判断隔离是否被正确钉住

@AC5.3 @negative
Scenario: 审计与日志不泄露令牌或记忆正文
  Given 门户已处理若干次带令牌的会话
  When 检查审计记录与运行日志
  Then 不出现任何令牌明文
  And 不出现 MCP 报文正文或记忆内容
  And 令牌只以 key_prefix 形式出现
```

---

<a id="s6-story"></a>
## S6 接入说明页与 i18n

**故事**：作为**新用户**，我希望有一个说明页告诉我怎么接入，以便 ≤ 3 步完成配置。

**范围边界**：i18n **只**覆盖门户 UI 与接入说明页，MCP 服务本身不做 i18n；页面内容只做**取舍与翻译**，不得自行改写工具清单或档位数字。

```gherkin
@AC6.1 @happy
Scenario: Home 展示接入步骤与 Admin 入口
  Given 新用户打开门户 Home
  When 页面加载完成
  Then 页面展示「获取 key → 配置客户端 → 验证」三步
  And 页面提供进入 Admin 的入口

@AC6.2 @happy
Scenario: 新用户按页面指引完成接入
  Given 新用户已拿到自己的令牌
  When 新用户按页面指引完成接入
  Then 接入在不超过 3 步内完成
  And 新用户成功调用一次工具并收到结果

@AC6.3 @edge
Scenario: 语言切换生效且范围受限
  Given 门户已提供英文与三种中文变体（简体 / 香港繁体 / 台湾繁体）
  When 用户切换语言
  Then 门户 UI 与接入说明页随之切换
  And 当前语言在刷新页面后保持
  And MCP 服务本身的响应与语言无关

@AC6.4 @edge
Scenario: 页面内容与能力文档保持同一口径
  Given 能力说明的唯一内容源是 mcp-capabilities 文档
  When 页面展示档位说明与逐档工具说明
  Then 页面中的档位名称与工具数量与内容源逐项一致
  And 页面未自行改写工具清单或档位数字

@AC6.5 @edge
Scenario: 页面示例一律使用占位符
  Given 接入说明页展示配置示例
  When 检查页面中的示例内容
  Then 主机名与令牌均以占位符形式出现
  And 页面不出现任何真实令牌或真实凭据

@AC6.6 @negative
Scenario: 页面内容与能力内容源口径不一致时阻断发布
  Given 能力内容源中的档位或工具数量已变更
  And 页面文案尚未同步该变更
  When 执行一次页面发布检查
  Then 发布被阻断并指出不一致项
  And 不发布与内容源口径不一致的页面

@AC6.7 @happy
Scenario: 三步接入为纵向排布
  Given 新用户打开接入说明页
  When 页面加载完成
  Then 三步按序号自上而下纵向排列
  And 每一步独占一行且带序号

@AC6.8 @happy
Scenario: 第 1 步可就地联系管理员
  Given 新用户还没有令牌
  When 在第 1 步的 Contact Admin 上悬停或用键盘聚焦
  Then 弹出浮层显示管理员微信二维码与联系邮箱
  And 浮层可由键盘到达与收起

@AC6.9 @edge
Scenario: 第 3 步给出一次真实调用示例
  Given 接入说明页展示第 3 步「验证一次调用」
  When 查看该步附带的示例
  Then 示例为一次真实调用的界面截图
  And 截图不含令牌明文、真实主机名与 IP

@AC6.10 @negative
Scenario: 页面不重复三步已覆盖的内容
  Given 接入说明页已包含三步接入
  When 检查页面章节与页内锚点
  Then 不存在与三步重复的独立「取令牌」或「客户端配置」章节
  And 页内锚点无断链

@AC6.11 @edge
Scenario: 品牌名统一
  Given 门户以 memory.agent-mate.ai 对外提供服务
  When 检查页面标题与顶栏品牌
  Then 两者均为 memory.agent-mate.ai - AI Memory MCP
```

---

<a id="s7-story"></a>
## S7 容量、配额与限流

**故事**：作为**管理员**，我希望用户不会写爆盘或拖垮服务，以便服务稳定。

**范围边界**：写入量、存储量、链接数与页大小**走上游 `[limits]` 配置**，门户不自建重复计数器；**仅门户自建**会话级并发、空闲超时与单会话最长时长；文件系统级磁盘配额需另出方案。

```gherkin
@AC7.1 @negative
Scenario: 上游配额生效且超限被拒
  Given 某用户所在库的写入量配额已按配置收紧
  When 该用户通过 MCP 继续写入超过配额
  Then 写入被拒绝并返回可读的配额错误
  And 门户未使用自建的重复计数器来判定该拒绝

@AC7.2 @edge
Scenario: 对 stdio 的上游限流结论已登记且可复跑
  Given 上游的全局准入并发上限仅作用于 HTTP 面
  When 按测试规格执行该限流项的 stdio 实测
  Then 存在一条明确结论，说明该项对 stdio 是否生效
  And 结论附可复跑命令与出处

@AC7.3 @edge
Scenario: 门户自建的会话级上限明确拒绝而非排队致死
  Given 门户已配置每 key 并发上限、全局并发上限、空闲超时与单会话最长时长
  When 并发或时长超过任一上限
  Then 请求被明确拒绝并给出原因
  And 不出现无限排队导致全部会话不可用

@AC7.4 @edge
Scenario: 文件系统级磁盘配额方案定稿
  Given 库内存储计数不覆盖 WAL 与临时文件
  When 评审门户的磁盘保护方案
  Then 存在覆盖 WAL 与临时文件的文件系统级配额方案
  And 方案已定稿并登记

@AC7.5 @edge
Scenario: 用户规模上限有实测依据并落地为校验
  Given 已完成单库体积、WAL 增长与并发会话内存占用的实测
  When 管理员创建用户已达上限
  Then 创建被拒绝并给出上限原因
  And 上限取值有可查的实测依据

@AC7.6 @happy
Scenario: 配额与并发额度内的用户不受影响
  Given 用户 alice 的写入量、存储量与并发会话数均在配额内
  When alice 正常写入并检索记忆
  Then 写入与检索均成功
  And 不出现因配额或限流而产生的额外等待或拒绝
```

---

<a id="s8-story"></a>
## S8 主人保底路径不受影响

**故事**：作为**主人**，我希望门户挂掉时仍能读写自己的记忆。

**范围边界**：SSH stdio 路径**保留**；门户与 SSH 是**两个独立 stack**，共享数据卷是唯一耦合点。

```gherkin
@AC8.1 @happy
Scenario: 门户故障时 SSH 路径仍可用
  Given 门户 stack 已停止
  When 主人通过 ssh ai-memory 建立 MCP 会话
  Then 会话建立成功并可完成一次写入与召回

@AC8.2 @edge
Scenario: 两条路径指向同一批文件
  Given 用户 alice 同时拥有门户令牌与 SSH 密钥
  And alice 已经门户写入一条记忆
  When alice 经 SSH 召回该记忆
  Then SSH 路径召回同一条记忆
  And 两条路径作用于同一个库文件

@AC8.3 @negative
Scenario: 门户容器不持有 docker socket
  Given 门户容器以 β′ 机制运行（镜像内自带二进制直接 spawn）
  When 检查门户容器内的挂载与可访问对象
  Then 容器内不存在 docker socket
  And 门户不通过 docker exec 启动会话

@AC8.4 @edge
Scenario: 门户 stack 可独立重启而不影响既有服务
  Given 既有 ai-memory stack 正在运行
  When 单独重启门户 stack
  Then 既有 stack 的容器不重启、服务不中断
  And 共享卷上的既有库文件未被改动
```

---

<a id="s9-story"></a>
## S9 门户自身数据的边界

**故事**：作为**运维**，我希望门户自己的库不与用户记忆混放，以免备份脚本误收。

**范围边界**：门户库在**独立卷**；用户记忆库仍只在 `/data/users/{handle}/`。

```gherkin
@AC9.1 @happy
Scenario: 门户库位于独立卷且不在用户数据目录下
  Given 门户 stack 已按标准形态部署
  When 检查门户自身数据的存储位置
  Then 门户库位于独立卷（如 admin_portal_data 挂载到 /srv/portal）
  And 门户库不在 /data 下

@AC9.2 @edge
Scenario: 备份遍历用户库时不包含门户库
  Given 备份脚本按 /data/users/*/ai-memory.db 遍历
  When 执行一次备份
  Then 备份产物中不含门户库
  And 门户库由同一流程单独备份并外迁

@AC9.3 @edge
Scenario: 门户库可单独恢复
  Given 已存在一份门户库快照
  When 按恢复流程还原门户库并校验
  Then 门户库可独立恢复
  And 恢复后门户可用且用户库未被改动

@AC9.4 @negative
Scenario: 门户库误放入用户数据目录时被阻断
  Given 门户的库文件路径被配置到 /data 下
  When 执行部署前的边界校验
  Then 校验失败并指出该路径违规
  And 不进入对外提供服务的状态
```

---

<a id="s10-story"></a>
## S10 管理面访问控制与面隔离

**故事**：作为**管理员**，我希望管理面只对已认证的我开放、且与 MCP 面严格分开，以便用户面不被浏览器登录流程阻断，管理面也不被绕过。

**范围边界**：两个域名分离，**不靠 path 区分**；门户按 Host 头做面隔离。

```gherkin
@AC10.1 @authz
Scenario: 未通过 Cloudflare Access 无法访问管理面
  Given Cloudflare Access 已开启在管理域名
  When 未认证浏览器访问管理域名
  Then 访问被拦截于 Cloudflare Access 登录流程
  And 未认证请求无法调用任何管理接口

@AC10.2 @negative
Scenario: 在 MCP 域名上调用管理接口被拒绝
  Given 门户按 Host 头区分两个面
  When 客户端向 {MCP_HOST} 请求管理接口
  Then 请求被拒绝
  And 不执行任何管理动作

@AC10.3 @negative
Scenario: 在管理域名上请求 MCP 端点被拒绝
  Given 门户按 Host 头区分两个面
  When 请求方向 {ADMIN_HOST} 请求 /mcp 端点
  Then 请求被拒绝
  And 不建立 MCP 会话

@AC10.4 @edge
Scenario: 新增门户公网入口不改变 ai-memory 本体的暴露面
  Given 门户新增了公网入口
  When 检查 ai-memory 本体的公网可达性与鉴权开关
  Then ai-memory 本体仍无公网入口
  And 未启用顶层 API key 相关开关
  And 上游自身 HTTP 面（serve 的 9077）对外不可达

@AC10.5 @happy
Scenario: 已认证管理员正常使用管理面
  Given 管理员已通过 Cloudflare Access 完成浏览器登录
  When 管理员访问管理域名
  Then 管理面正常加载
  And 管理操作在其权限范围内可用

@AC10.6 @edge
Scenario: 多把钥匙互为备份
  Given Cloudflare Access 策略中列有两个以上登录入口
  When 其中任一个失效
  Then 仍可用另一个独立完成管理面认证
  And 该认证不依赖门户自身的账号体系

@AC10.7 @edge
Scenario: 会话时长按平台档位生效
  Given 管理面会话时长已在 Access 应用上设定
  When 会话超过该时长
  Then 再次访问要求重新认证
  And 文档记录控制台可选档位与实测结论（不得把目标值写成既有能力）

@AC10.8 @edge
Scenario: 根凭证的离线保存要求已落文档
  Given 管理面的根凭证是 Cloudflare 账号及其第二因素
  When 检查部署文档
  Then 文档要求离线保存第二因素恢复码
  And 文档给出邮箱失效时的恢复链（改策略 → Cloudflare 账号 → 服务器 SSH）

@AC10.9 @negative
Scenario: 门户内不存在管理员增删与密码重设控件
  Given 管理员已进入管理面
  When 检查页面上的操作控件
  Then 不存在邀请管理员、删除管理员或重设密码的控件
  And 门户不存储任何门户密码

@AC10.10 @happy
Scenario: 管理面给出在 Cloudflare 侧增删管理员的确切步骤
  Given 管理员需要增删一名管理员
  When 查看管理面说明
  Then 页面给出 Access → Applications → Policies 的具体路径
  And 说明移除后访问在下次请求即失效、无需吊销会话
```

---

<a id="s11-story"></a>
## S11 门户启动自检（fail-closed）

**故事**：作为**运维**，我希望门户在启动时就把会导致静默失败的配置错误炸出来，以便故障不推迟到用户会话里。

**范围边界**：四类前置任一不满足即**拒绝启动**，而不是带病运行。

```gherkin
@AC11.1 @negative
Scenario: 用户目录不可写时拒绝启动
  Given /data/users 不可写（缺少 setgid 引导）
  When 门户进程启动
  Then 启动自检失败并拒绝启动
  And 报错明确指出用户目录不可写

@AC11.2 @negative
Scenario Outline: 向量服务不可用或维度不符时拒绝启动
  Given 模型服务处于「<异常形态>」
  When 门户进程启动
  Then 启动自检失败并拒绝启动
  And 不以「检索静默降级」的形式继续提供服务

  Examples:
    | 异常形态 |
    | 门户专用凭据缺失，服务返回未授权 |
    | 服务可达但返回维度不是 1024 |

@AC11.3 @negative
Scenario: 自身二进制版本与版本锁不一致时拒绝启动
  Given 门户镜像内二进制版本与版本锁不一致
  When 门户进程启动
  Then 启动自检失败并拒绝启动
  And 报错指出版本漂移

@AC11.4 @negative
Scenario Outline: 关键校验缺失时拒绝启动
  Given 「<缺失项>」未就位
  When 门户进程启动
  Then 启动自检失败并拒绝启动

  Examples:
    | 缺失项 |
    | handle 白名单校验 |
    | 启动模板断言 |

@AC11.5 @happy
Scenario: 启动自检通过后才对外提供服务
  Given 四项启动自检全部通过
  When 门户进程启动完成
  Then 门户开始接受管理面与 MCP 面的请求
  And 自检结论被记录到日志
```

---

<a id="s12-story"></a>
## S12 门户制品契约与升级治理

**故事**：作为**运维**，我希望门户镜像与部署制品始终同版本、且制品契约可被探针守护，以便上游升级不会引入静默漂移。

**范围边界**：门户镜像**不继承**上游镜像的入口、命令与默认环境变量；镜像内二进制版本由版本锁注入，不手写。

```gherkin
@AC12.1 @happy
Scenario: 制品契约的关键三项可被探针核对
  Given 候选门户镜像已构建
  When 探针检查镜像内的二进制路径、运行时底座与容器用户
  Then 二进制位于 /usr/local/bin/ai-memory
  And 底座为 bookworm 系且含 ca-certificates
  And 容器用户为 aimem

@AC12.2 @edge
Scenario: 门户与上游镜像的用户标识对齐
  Given 门户镜像与上游镜像均已构建
  When 比较两者内 aimem 的 UID/GID
  Then 两者一致
  And 因此 SSH 路径可写入门户创建的用户目录

@AC12.3 @edge
Scenario: 镜像版本由版本锁注入且不继承上游默认值
  Given 门户镜像通过构建参数注入版本标签
  When 检查镜像构建定义与运行环境
  Then 版本标签来自版本锁而非手写
  And 门户不继承上游的入口、命令与默认环境变量

@AC12.4 @edge
Scenario: 升级清单包含重建门户镜像并已演练
  Given 上游版本变更需要门户镜像同步重建
  When 执行一次升级流程
  Then 升级清单含「重建门户镜像」一步
  And 该步骤已被完整演练并留痕

@AC12.5 @negative
Scenario: 制品契约缺项时阻断升级
  Given 候选镜像相对基线快照缺少某项制品契约
  When 运行升级预检
  Then 预检失败并阻断升级
  And 报错指出缺失或改名的契约项
```

---

<a id="s13-story"></a>
## S13 门户容器最小攻击面

**故事**：作为**运维**，我希望门户容器即使被攻破也不等于宿主 root，以便把影响范围限制在门户自身。

**范围边界**：门户是唯一公网可达组件，也是唯一能触及全部用户库的组件，因此按最小权限与最小依赖运行。

```gherkin
@AC13.1 @negative
Scenario: 门户不具备容器编排能力
  Given 门户容器已部署
  When 检查容器可访问的运行接口与挂载
  Then 容器内不存在 docker socket
  And 门户不调用 docker exec 或等价接口启动会话

@AC13.2 @happy
Scenario: 门户以非特权用户运行
  Given 门户容器已启动
  When 检查其运行身份
  Then 门户以 aimem 非 root 身份运行
  And 门户不持有宿主 root 等价权限

@AC13.3 @edge
Scenario: 门户容器按最小依赖与资源限额运行
  Given 门户容器已启动
  When 检查其文件系统与资源设置
  Then 根文件系统除必要挂载外为只读
  And 容器配置了资源限额
  And 镜像内不含非必需的系统包管理能力
```

---

<a id="s14-story"></a>
## S14 门户 UI 设计系统与版式一致性

**故事**：作为**运维**，我希望门户所有页面共用一套可机械核对的设计系统，以便改版不靠观感、评审有唯一基准。

**范围边界**：只约束门户自身 UI（公开说明页与管理面）；不约束 MCP 服务响应、不约束上游。令牌数值与组件规范见 [`web-design.md`](./web-design.md) §13 / §14。

```gherkin
@AC14.1 @happy
Scenario: 全站单色
  Given 门户所有页面已应用设计令牌
  When 扫描所有元素的计算色值
  Then 除危险红及其浅底外不存在任何彩色
  And 主按钮为墨色实底而非品牌色

@AC14.2 @edge
Scenario: 代码块保留圆角例外
  Given 设计系统约定面板与控件零圆角
  When 检查代码块容器
  Then 代码容器保留 8px 圆角（含右侧复制条）
  And 其余面板与控件为直角

@AC14.3 @edge
Scenario: 表单控件尺度一致
  Given 页面同一行内存在输入框、下拉框与按钮
  When 测量它们的渲染高度与字号
  Then 三者高度一致
  And 三者字号一致

@AC14.4 @negative
Scenario: 表格不被容器裁切
  Given 页面在 1440px 宽视口下渲染
  When 检查能力表的容器与列
  Then 表格无横向溢出
  And 所有列（含示例列）在视口内可见

@AC14.5 @negative
Scenario: 数据不在词中断开
  Given 表格单元内含路径、时间戳或标识符
  When 在窄屏下渲染
  Then 这些值不逐字符折断
  And 溢出由容器横向滚动承接

@AC14.6 @happy
Scenario: 管理面顶栏固定
  Given 管理面页面内容长于一屏
  When 向下滚动
  Then 顶栏仍贴在视口顶部
  And 内容从顶栏下缘开始滚动

@AC14.7 @happy
Scenario: 页脚固定
  Given 页面内容长于一屏
  When 向下滚动
  Then 页脚仍贴在视口底部

@AC14.8 @edge
Scenario: 页脚结构与对齐
  Given 页脚含入口链接与版权
  When 检查两者位置
  Then 入口链接在版权左侧且同一行
  And 整组在页脚内右对齐

@AC14.9 @edge
Scenario: 内容列宽度与正文行宽
  Given 管理面页面在宽视口下渲染
  When 测量内容列与正文段落
  Then 内容列紧贴左侧栏并使用可用宽度
  And 正文段落有最大行宽，长行不横跨整页

@AC14.10 @happy
Scenario: 分页组件可用
  Given 用户列表与审计页含多行记录
  When 查看列表底部
  Then 显示「Showing a–b of c」计数
  And 提供上一页 / 下一页与当前页，首末页对应按钮禁用

@AC14.11 @edge
Scenario: 四语言词表键集合一致
  Given 门户提供四份语言词表
  When 逐份比对键集合
  Then 四份键集合完全一致（无缺失、无多余）
  And 缺键时回落英文，再回落键名本身

@AC14.12 @edge
Scenario: logo 尺寸按位置分档
  Given 公开页 hero 与管理面顶栏各有一处 logo
  When 测量两处渲染尺寸
  Then 两处按既定档位渲染且不拉伸变形
  And 窄屏下顶栏 logo 降档，页面无横向溢出
```

---

## 范围外（明确不做）

自助注册 · 对外收费/计费 · 非 MCP 接入面（REST / Web SDK / OpenAI 兼容）· 上游能力之外的二次开发 · 服务器 OS 账号同步（单账号 + N 密钥已足够）· 用 macaroon 能力令牌做隔离（additive-only，只放宽不收紧）· 门户挂载 docker socket（[`../adr/ADR-012`](../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md)）。

## 已知限制与开放问题

| # | 事项 | 现状 |
|---|---|---|
| 1 | `core` 档**不含删除类工具**，用户无法自行删除或遗忘自己的记忆 | 已知限制，本轮接受（[`../mcp/mcp-design.md`](../mcp/mcp-design.md) §8.3 #4）；若要开放，最小增量档为 `core,lifecycle`。接入说明页是否需显式告知该限制，待定 |
| 2 | 审计写入失败时的 fail-open / fail-closed 策略 | **未定**：`S5` 未规定审计落库失败时是否仍放行会话，需在实现前决议 |
| 3 | ~~`S11` / `S12` 的验收条件尚无对应测试用例~~ **已登记（2026-09-21）** | [`web-test.md`](./web-test.md) §2 已补 `TC-P-L0-06`–`TC-P-L0-09`（启动自检四项，对应 `S11`）、`TC-P-L1-11` / `TC-P-L1-12`（制品契约核对、版本注入与不继承上游默认值）与既有 `TC-P-L1-09`（UID/GID 对齐，对应 `AC12.2`），三者合起来对应 `S12`；`S13` 由既有 `TC-P-L1-08` 与新增 `TC-P-L1-13` 覆盖。`AC12.4`（升级演练）是流程留痕项，登记在 §1 测试计划为**人工项**，不设自动化用例 |
| 4 | ~~门户技术栈~~ **已定（2026-09-22）** | **Node.js 22 LTS + TypeScript；Fastify + Nunjucks 服务端模板 + 原生 CSS；MCP 桥用官方 `@modelcontextprotocol/sdk` 双 transport；门户库 SQLite** —— 选型理由与被拒备选见 [`web-design.md`](./web-design.md) §12.0，决议登记 §0 **D9** |
| 5 | 反向代理选型 | 未定（NPM / Caddy / 其它）—— [`web-design.md`](./web-design.md) §10 #3 |
| 6 | MCP 传输实现 | 本项目唯一非平凡工程量；优先复用官方 SDK 的 server transport + stdio client transport，不自行实现协议 —— [`web-design.md`](./web-design.md) §10 #4 |
| 7 | ~~每用户库后台维护的执行方~~ **已定档（Sprint 3 #5）** | **主机 cron** 逐库调度，唯一入口 `scripts/maintain-user-dbs.sh`；命令口径、覆盖面实测与失败语义见 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §5.3，故事 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS8`。生产定时器与告警留 Sprint 5 |
| 8 | 是否启用静态加密（`AI_MEMORY_ENCRYPT_AT_REST`） | 未定；注意它只防「快照离开主机后被读」，不防门户被攻破 —— [`web-design.md`](./web-design.md) §10 #6 / §8 T10 |
| 9 | 门户镜像重建是否自动化 | 建议纳入版本锁变更触发的流水线 —— [`web-design.md`](./web-design.md) §10 #7 |
| 10 | 管理面**没有密码重设**入口（`D11` 撤销） | 已知限制，本轮接受：身份由 Cloudflare Access 认定，登录走 Google（主）与邮箱一次性验证码（兜底），故**没有密码可重设**；失效链为「改策略 → Cloudflare 账号 → 服务器 SSH」，根凭证（Cloudflare 账号第二因素恢复码）**须离线保存**（`AC10.8`）。撤销理由见 [`web-design.md`](./web-design.md) §0 **D11** 与 §6.1 |

## 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-20 | **specs 整合**：由 `admin_portal_design.md` §1 需求表（用户逐字答复）与 `product-backlog.md` 的 web portal 条目重写为 S1–S9 故事 + AC；`product-backlog.md` **未被修改** |
| 2026-09-21 | **D1 定稿（β′）+ AC1.1 补前置**：用户确认 β′（[`../adr/ADR-012`](../adr/ADR-012-portal-launch-mechanism-no-docker-socket.md)），AC1.1 增加「`/data/users` 为 `root:aimem 2775`（setgid）」前置与「门户启动自检不可写即拒绝启动」；AC8.3（不挂 docker socket）不变。落地前置三条见 [`../architecture.md`](../architecture.md) §2.3 |
| 2026-09-21 | **S6 新增 AC6.4**：接入说明页的内容取自 [`../mcp/mcp-capabilities.md`](../mcp/mcp-capabilities.md)（**唯一内容源**：档位 + 全量 101 项工具说明 + 端到端例子），页面只做**取舍与翻译**，不得自行改写工具清单或档位数字（口径单点在 [`../mcp/mcp-design.md`](../mcp/mcp-design.md) §8） |
| 2026-09-21 | **AC6.4 描述同步**：能力文档体例定稿为「6 张档位表、每张只列本档新增、编号全档连续 1–101、示例入表」，AC6.4 随之由「工具功能说明 + 端到端例子」改为「逐档工具说明」 |
| 2026-09-21 | **ATDD 重写（v2.0）**：① 全部 AC 由「描述」改为 **Given-When-Then**，并按「一条场景一个行为、一个 `When` 触发」拆分；② 新增场景：`AC1.6` / `AC1.7`（重复 handle、目录创建失败无半成品）· `AC2.9`（对不存在令牌操作）· `AC3.6`（对外与管理员入口工具数核对）· `AC3.7`（多把令牌的使用时间各自独立）· `AC4.7`（指向他用户库路径的负向断言，对应 D1）· `AC6.5`（示例一律占位符）· `AC6.6`（页面口径不一致时阻断发布）· `AC7.5`（用户规模上限落地为校验）· `AC7.6`（配额内用户不受影响）· `AC8.4`（门户 stack 独立重启）· `AC9.3`（门户库单独恢复）· `AC9.4`（门户库误放 /data 时阻断）· `AC10.5`（已认证管理员正常使用管理面）；③ 新增 **S10 管理面访问控制与面隔离**、**S11 门户启动自检（fail-closed）**、**S12 门户制品契约与升级治理**、**S13 门户容器最小攻击面**，承接 [`product-backlog.md`](../product-backlog.md) #2 / #16 / #18 与 [`web-design.md`](./web-design.md) §3.1–§3.4 / §6 / §8 T1；④ 新增「故事索引」表（故事 → 角色 → Backlog → Sprint → 设计 → 测试用例）与「AC 编号只追加不重排」纪律；⑤ 新增「已知限制与开放问题」表，显式登记 `S11`/`S12` **尚无测试用例**与「审计写入失败策略未定」两处缺口。**既有 AC 编号一字未重排**（`AC6.4`、`S3 AC3.5` 等跨文档引用仍有效） |
| 2026-09-21 | **引用收口（故事索引 + 已知限制）**：故事索引新增 `AC` 列（`AC{n}.{m}` 区间）并把 `S11` / `S12` / `S13` 的「待登记用例」替换为具体用例号（`TC-P-L0-06`–`TC-P-L0-09`；`TC-P-L1-09` / `TC-P-L1-11` / `TC-P-L1-12`；`TC-P-L1-08` / `TC-P-L1-13`），形成 AC ↔ TC 双向映射；「已知限制与开放问题」第 3 条由「尚无对应用例」改为**已登记**，并注明 `AC12.4`（升级演练）为 §1 人工项。同日 [`product-backlog.md`](../product-backlog.md) / [`sprint-backlog.md`](../sprint-backlog.md) / [`change-log.md`](../change-log.md) 同步订正指向本文件旧故事号的 5 处错指 |
| 2026-09-22 | **故事索引的 Sprint 落点随 Replan 改指**（锚点 id `s4-*` / `s5-*` 全部保留，跨文档链接未断）：S1 / S2 / S10 → `Sprint 4 PSP-W1「账号与凭证」`；S3 / S4 / S13 → `Sprint 4 PSP-W2「端到端接入」`；S5 / S6 / S11 → `Sprint 4 PSP-W3「可运维、可发布」`；S7 → `Sprint 4 PSP-W2 / PSP-W3 · Sprint 6 #10 / #11`；S8 → `Sprint 6「接入面」`；S9 → `Sprint 6 #9`；S12 → `Sprint 4 PSP-W3 · Sprint 7 #3 / #6` |
| 2026-09-22 | **文档边界修正（v2.1，Sprint 4 #1）**：本文件收窄为**门户自身（web app）**的故事与 AC。① `S3` 由「用户通过 MCP 端点接入」改为「**令牌接入的门户侧执行**」、`S4` 由「跨用户隔离」改为「**门户侧的隔离执行与审计**」（**锚点 `#s3` / `#s4` / `#s3-story` / `#s4-story` 冻结未改**）；② 5 条属**跨进程 / 上游契约**的 AC 迁出至 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md)：`AC3.1` → `MS1 AC-M1.1` · `AC3.2` → `MS1 AC-M1.2` · `AC3.6` → `MS6 AC-M6.1` · `AC4.1` → `MS2 AC-M2.1` · `AC4.2` → `MS2 AC-M2.2`（**原编号一律不重排**，两故事内各留「迁出登记」表，既有跨文档引用继续可解析）；③ 故事索引的 `AC` 列与 `设计` 列随之更新（设计指向改为门户侧章节）；④ 「已知限制」第 7 条（每用户库维护执行方）关闭为**已定档：主机 cron**。**留本文件的 AC 原文一字未改** |
| 2026-09-22 | **UI 需求变更与 AC 追加（v2.2）**：① **语言范围需求变更**：门户由「中英两种」扩为**四语言**（`en` / `zh-CN` / `zh-HK` / `zh-TW`）—— `AC6.3` **编号不变、内文改写**并补「刷新后保持」；② **色系需求变更**：弃用品牌橙、全站改**纯单色**（唯一有色为危险红），**推翻**同日早前的「保留 logo 橙」（决议登记 [`web-design.md`](./web-design.md) §0 **D10**）；③ **撤销**「门户内邀请管理员 / 重设密码 / 门户自建账号」三项需求，管理面维持 Cloudflare Access（**D11**），故新增 `S1 AC1.8`（用户页只提供「创建用户」，不提供管理员增删入口）；④ **S6 追加 `AC6.7`–`AC6.11`**（三步纵向排布 / 第 1 步 Contact Admin 悬浮窗 / 第 3 步真实调用示例截图 / 删除与三步重复的章节 / 品牌名统一）；⑤ **S10 追加 `AC10.6`–`AC10.10`**（多把钥匙冗余 / 会话时长按平台档位生效且不得把目标写成既有能力 / 根凭证离线保存要求落文档 / 门户内无管理员增删与密码控件 / 给出 Cloudflare 侧增删管理员的确切步骤）；⑥ **新增 `S14`「门户 UI 设计系统与版式一致性」**（`AC14.1`–`AC14.12`：全站单色 / 代码块 8px 圆角例外 / 表单控件尺度一致 / 表格不被裁切 / 数据不在词中断开 / 顶栏固定 / 页脚固定 / 页脚结构与对齐 / 内容列宽度与正文行宽 / 分页组件 / 四语言词表键集合一致 / logo 按位置分档）。**既有 AC 编号一字未重排**；页面集由 7 页回到 **6 页** —— 原「07 只读管理员页」**撤销**，其内容并入 06「Admin MCP 配置」（见 [`web-design.md`](./web-design.md) §14） |
| 2026-09-22 | **用例索引展开（`S4` 行）**：`TC-P-L0-02/03 · TC-P-L1-05/07 · TC-P-L3-01/05/09` → **逐号写全**（`TC-P-L0-02 · TC-P-L0-03 · TC-P-L1-05 · TC-P-L1-07 · TC-P-L3-01 · TC-P-L3-05 · TC-P-L3-09`）。简写形式使「索引 → 用例定义」的机械核对读不出每组的第二个号，那四个号因此被误报为孤儿；**展开不改变任何覆盖映射**（只改可读性）。另：`TC-P-L1-03`（经 `/mcp` 建会话并写入）· `TC-P-L2-01`（客户端带令牌接入）· `TC-P-L2-02`（无令牌 / 已吊销 → 拒绝）三条验证的是 `AC3.1` / `AC3.2` 的**门户侧执行**，随该两条 AC 于 v2.1 迁出，已登记到 [`../mcp/mcp-stories.md`](../mcp/mcp-stories.md) `MS1` 的「测试用例」列，本文件不重复登记 |
| 2026-09-22 | **`S10` 索引用例归属修正（`PSP-W1`）**：`S10` 行原指 `TC-P-L3-03 · TC-P-L2-09`，但 `TC-P-L2-09` 实为 `S14`「固定外框与页脚结构」的用例（见 [`web-test.md`](./web-test.md) §2）⇒ 改指**新增的 `TC-P-L1-14`**（`AC10.5`「已认证管理员正常使用管理面」此前无对应用例）。**编号只追加不重排**：新号 `TC-P-L1-14` 排在既有 L1 序列之后，`TC-P-L2-09` 归位 `S14`（其 `S14` 行的用例列本就含该号，未改动） |
