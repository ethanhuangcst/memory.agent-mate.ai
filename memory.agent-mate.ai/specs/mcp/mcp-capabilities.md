---
title: 记忆服务能做什么（能力一览 · 用户版）
type: spec
status: active
as_of: 2026-09-21
tags:
  - mcp
  - tools
  - profile
  - user-facing
related_spec: memory.agent-mate.ai/specs/web-portal/web-design.md
related:
  - memory.agent-mate.ai/specs/mcp/mcp-design.md
  - memory.agent-mate.ai/specs/mcp/mcp-test.md
  - memory.agent-mate.ai/scripts/profile-probe.sh
---

# 记忆服务能做什么（能力一览 · 用户版）

> 这是给**使用记忆服务的你**看的说明：它有哪些能力、你能用到哪些、每个工具是干什么的、怎么用起来。
> 不涉及服务器与部署细节；管理员视角的技术文档见 [`./mcp-design.md`](./mcp-design.md)。
> 本页内容将来会搬到门户的「接入指引」页面，供新用户直接阅读。

一句话：**它是一个记得住你、也找得回来的记忆助手。**你把事情交给它记，日后用大白话问它，它按意思帮你找回来。

---

## 1. 这是什么，怎么接上

### 它能帮你做三件事

| 你想做的事 | 它怎么帮你 |
| --- | --- |
| **记住** | 把偏好、约定、结论、待办交给它，它会存成一条记忆 |
| **想起来** | 你只记得大概意思，用一句话问它，它按意思把相关的记忆找回来 |
| **翻一翻** | 列出你存过什么，或按确切的词精确查找 |

记下来的东西**只属于你**：别人的记忆你检索不到，别人也检索不到你的。

### 三步接上

1. **拿一把钥匙**：在账户页面生成（或复制）你的接入密钥。
2. **填进客户端**：把下面对应的一段配置粘到你的 AI 客户端（支持 MCP 的客户端都可以），保存。
3. **说一句话验证**：对客户端说「记住：我喜欢把会议纪要写成要点」，如果它回你「已记住」，就通了。

### 客户端配置（`mcp.json`）示例

把下面**其中一段**放进客户端配置里的 `mcpServers` 下即可。尖括号里的内容换成你自己的，不要照抄。

**一、托管门户（HTTP，最常见）** —— 你的密钥由门户签发，档位由门户决定（用户通道 = `core`，8 项）：

```json
"ai-memory": {
  "type": "http",
  "url": "https://<MCP_HOST>/mcp",
  "headers": {
    "Authorization": "Bearer <你的令牌>"
  }
}
```

**二、本机自托管（stdio）** —— 服务装在你自己的机器上，命令里显式写档位：

```json
"ai-memory-local": {
  "type": "stdio",
  "command": "docker",
  "args": ["exec", "-i", "ai-memory-mcp", "ai-memory", "mcp", "--tier", "smart", "--profile", "core"]
}
```

**三、SSH 通道（stdio）** —— 客户端通过 SSH 连到服务，档位由服务端钉死（用户行 = `core`）：

```json
"ai-memory": {
  "command": "ssh",
  "args": ["ai-memory"]
}
```

> **档位（你能用哪些工具）由服务端决定**：托管与 SSH 两种形态下，你改客户端配置**不会**改变档位 —— 需要由管理员调整。
> **改完必须重新连接**：档位在**连接时**确定，换档位、换密钥后要重启该 MCP 条目（或 reconnect）才生效。
> 想知道自己当前能用哪些，直接问客户端「我现在能用哪些工具」，它会调用 `memory_capabilities` 告诉你。

---

## 2. 能力清单

能力是按「档位」整批开通的。你用的是**最小的一档**（`core`，8 项），够用、也不容易误操作。下面先给档位总览，再**逐档列出该档的全部工具**。

| 档位 | 工具数 | 谁能用 | 说明 |
| --- | --- | --- | --- |
| **核心档 `core`** | **8** | **你（最终用户）** | 记住、想起来、精确查找、查看、浏览 —— 日常够用。**不传 `--profile` 时默认也是这一档** |
| **管理档 `admin`** | 22 | 管理员 | 在核心档上加了删除 / 遗忘 / 清理 / 审批 / 通知订阅 |
| 图谱档 `graph` | 20 | 不对外开放 | 记忆之间的关联与关系网 |
| 高级档 `power` | 57 | 不对外开放 | 合并、反思、画像、协作任务、流程编排等 |
| 全量档 `full` | 101 | 不对外开放 | 全部能力，仅供内部排障 |
| 自定义档（如 `core,lifecycle`） | 视组合而定 | 未来按需 | 只加需要的那一组（示例组合 = 14 项） |

工具名是它在协议里的名字，你一般不需要手打 —— 直接对客户端说话即可，客户端会替你挑合适的工具。

### 2.1 核心档 `core`： 8 项，**你能用的就是这些**

| # | 工具 | 做什么 | 什么时候用 | 示例 |
| --- | --- | --- | --- | --- |
|1| `memory_store` | 存一条记忆；标题加分类都相同的会自动去重，默认保存 7 天，可设为长期 | 想让它记住一件事、一个偏好、一个结论 | 「记住：我的会议纪要一律写成要点」 |
|2| `memory_recall` | 按**意思**找回相关记忆，按相关度、重要程度、最近使用情况综合排序 | 只记得大概意思，想让它帮你回忆（**中文请一律用这个**） | 「上次我说的纪要格式是什么来着？」 |
|3| `memory_search` | 按关键词**精确**查找：所有词都要出现，不做模糊匹配 | 记得确切的词或标记，想精确定位 | 查同时含「redis」和「端口」的记忆 |
|4| `memory_get` | 用编号取回一条记忆的全文，以及它关联了哪些记忆 | 已知道编号，想看原样内容 | 打开编号 `8f2c…` 的那条 |
|5| `memory_list` | 按分类、保存时长、来源列出记忆，最多 200 条 | 想盘点自己存了些什么 | 「把我记过的写作偏好都列出来」 |
|6| `memory_load_family` | 直接取回某一类里最近用过的若干条 | 明确知道自己要哪一类 | 取回「核心」类最近用过的 10 条 |
|7| `memory_smart_load` | 你说一句意图，它判断该取哪一类再取回 | 不确定该用哪类时 | 「把跟项目决策有关的都找出来」 |
|8| `memory_capabilities` | 查看当前档位、开通的分组与工具总数 | 想知道自己能用哪些工具 | 「我现在能用哪些工具？」 |

> `memory_capabilities` **永远可用**，不计入档位数量。

### 2.2 管理档 `admin`：Code 档 8 项之外，额外 14 项，共 22 项（管理员）

| # | 工具 | 做什么 | 什么时候用 | 示例 |
| --- | --- | --- | --- | --- |
|9| `memory_update` | 按编号局部修改，未提到的字段保持原样；保存时长只能往更久改 | 改一条记错的内容 | 把 `8f2c…` 的正文改成「要点列表」 |
|10| `memory_delete` | 按编号**彻底删除**一条（正文、索引、关联一起删）；删多条请用 `memory_forget` | 删掉单条 | 删掉编号 `8f2c…` |
|11| `memory_forget` | 按关键词 / 分类 / 保存时长批量删除；默认**先归档再删**（一般还能恢复），可先演习看会删到哪些 | 批量清理 | 删掉所有标记「临时」的记忆 |
|12| `memory_gc` | 清理已过期的记忆（默认先归档），可先演习 | 定期清理 | 清理过期 30 天以上的记忆 |
|13| `memory_gc_hard` | 彻底删除已过期的记忆（不可恢复），可先演习 | 定期清理 | 彻底删掉过期 30 天以上的记忆 |promote` | 把一条记忆提升为长期保存（清掉过期时间） | 想永久保留 | 把 `8f2c…` 设为长期 |
|15| `memory_demote` | 把一条记忆降级为短期保存（设上过期时间） | 想稍后再看 | 把 `8f2c…` 设为短期 |apture_turn` | 把一整轮对话原样保存（通常由客户端自动完成） | 留存对话原貌 | 客户端自动调用，一般不用手调 |
| `memory_namespace_set_standard` | 给某个分类设一段固定说明，之后每次回忆、每次开会话都会自动带上 | 设定分类口径 | 给「项目A」设一段开场说明 |
| `memory_namespace_get_standard` | 读取这段说明，也可以连上级分类的一起看 | 查看口径 | 看「项目A」的开场说明 |
| `memory_namespace_clear_standard` | 删掉这段设置 | 取消口径 | 清掉「项目A」的开场说明 |
| `memory_pending_list` | 列出等待人工批准的操作 | 治理审批 | 看有哪些待审批操作 |
| `memory_pending_approve` | 批准某个待办操作，可顺手记一条「以后这类都放行」 | 审批 | 批准编号 12 的操作 |
| `memory_pending_reject` | 拒绝某个待办操作 | 审批 | 拒绝编号 12 的操作 |
| `memory_subscribe` | 登记一个回调地址，有事情发生时推送通知（必须是 https，可带签名校验） | 接通知 | 有新记忆时通知我的服务 |
| `memory_unsubscribe` | 取消订阅（失败记录会保留，便于事后查） | 取消通知 | 取消刚才那个订阅 |

### 2.3 图谱档 `graph` —— 20 项（不对外开放）

| 工具 | 做什么 | 什么时候用 | 示例 |
| --- | --- | --- | --- |
| `memory_store` | 存一条记忆（同核心档） | 记住一件事 | 存一条项目结论 |
| `memory_recall` | 按意思找回记忆（同核心档） | 回忆 | 「跟架构有关的结论有哪些？」 |
| `memory_search` | 按关键词精确查找（同核心档） | 精确定位 | 查含「架构」的记忆 |
| `memory_get` | 按编号取回全文与关联 | 看原样内容 | 打开编号 `8f2c…` |
| `memory_list` | 列出记忆 | 盘点 | 列出最近 20 条 |
| `memory_load_family` | 按类取回最近用过的若干条 | 按类取 | 取回「图谱」类最近 10 条 |
| `memory_smart_load` | 说意图，由它判断取哪一类 | 不确定类别 | 「把关系网相关的取出来」 |
| `memory_capabilities` | 查看当前档位与可用工具（永远可用） | 查能力 | 「我现在能用哪些工具？」 |
| `memory_link` | 在两条记忆之间建立有方向的关系：相关 / 取代 / 矛盾 / 派生 / 反思 | 建立关系 | 把 B 标记为「取代」A |
| `memory_get_links` | 列出一条记忆的全部关联，含关系类型与签名状态 | 看关系 | 看 `8f2c…` 关联了哪些 |
| `memory_verify` | 重新校验某条关联的签名是否仍然有效 | 验签 | 校验这条关联的签名 |
| `memory_kg_query` | 沿关系一层层往外走（最多 5 层），带时间有效区间 | 关系网查询 | 查这个项目相关的三层关系 |
| `memory_find_paths` | 找出两条记忆之间的连接路径 | 找路径 | A 和 B 之间是怎么连上的 |
| `memory_kg_timeline` | 按时间顺序列出一条记忆连出去的关系 | 看时间线 | 这条记忆的关系按时间列出来 |
| `memory_lineage` | 沿「派生 / 反思」关系找出它的来龙去脉 | 溯源 | 这条总结是从哪几条来的 |
| `memory_kg_invalidate` | 给某条关系设失效时间（不是删除，可追溯） | 作废关系 | 作废 A 到 B 的「取代」关系 |
| `memory_entity_register` | 把人 / 项目 / 公司这类实体登记下来，同名会自动合并别名 | 建实体 | 登记「张三」并加上别名 |
| `memory_entity_get_by_alias` | 用别名反查实体 | 查实体 | 「小张」是谁 |
| `memory_get_taxonomy` | 列出分类的树形结构与每类数量 | 看分类 | 看看我有哪些分类、各多少条 |
| `memory_replay` | 取回这条记忆产生过程的对话记录（需运营方接通对话采集才有内容） | 回看过程 | 回看这条记忆当时的对话 |

### 2.4 高级档 `power` —— 57 项（不对外开放）

| 工具 | 做什么 | 什么时候用 | 示例 |
| --- | --- | --- | --- |
| `memory_store` | 存一条记忆（同核心档） | 记住一件事 | 存一条调研结论 |
| `memory_recall` | 按意思找回记忆（同核心档） | 回忆 | 「之前调研过的方案有哪些？」 |
| `memory_search` | 按关键词精确查找（同核心档） | 精确定位 | 查含「调研」的记忆 |
| `memory_get` | 按编号取回全文与关联 | 看原样内容 | 打开编号 `8f2c…` |
| `memory_list` | 列出记忆 | 盘点 | 列出最近 50 条 |
| `memory_load_family` | 按类取回最近用过的若干条 | 按类取 | 取回「高级」类最近 10 条 |
| `memory_smart_load` | 说意图，由它判断取哪一类 | 不确定类别 | 「把反思相关的取出来」 |
| `memory_capabilities` | 查看当前档位与可用工具（永远可用） | 查能力 | 「我现在能用哪些工具？」 |
| `memory_auto_tag` | 用模型自动给记忆补标签 | 补标签 | 给最近 20 条补上标签 |
| `memory_check_duplicate` | 写入前先查有没有几乎一样的内容，返回最相似的一条与「是否重复」的判断 | 防重复 | 这段内容是不是已经有了 |
| `memory_detect_contradiction` | 用模型检查新内容和已有记忆是否互相矛盾 | 查矛盾 | 这条和以前的说法冲突吗 |
| `memory_expand_query` | 用模型把你的问题扩展成更好检索的说法 | 改查询 | 帮我换个说法去检索 |
| `memory_consolidate` | 把 2 到 100 条合并成一条长期记忆（合并后原条目被删除），可自动生成摘要 | 合并 | 把这 30 条合并成一条 |
| `memory_atomise` | 把一大段拆成若干条要点，原文归档保留 | 拆分 | 把这篇长文拆成要点 |
| `memory_reflect` | 基于已有记忆生成一条总结（「反思」），并自动连回来源 | 总结 | 总结一下这个项目到目前为止的结论 |
| `memory_reflection_origin` | 查这条总结是谁生成的、来自多深 | 溯源 | 这条总结的深度是多少 |
| `memory_dependents_of_invalidated` | 列出依赖某条已失效记忆的其他记忆（只提示，不自动改动） | 看影响面 | 这条失效会影响哪些记忆 |
| `memory_export_reflection` | 把总结及其来源导出成 Markdown 或 JSON（不写文件，交给客户端保存） | 导出 | 导出这份总结 |
| `memory_offload` | 把完整原文另存起来，只留指纹 | 外存原文 | 把这篇原文另存起来 |
| `memory_deref` | 按编号取回外存原文，并校验指纹是否被改动 | 取回原文 | 取回刚才外存的原文 |
| `memory_persona` | 取回某个实体的最新画像 | 看画像 | 看「张三」的画像 |
| `memory_persona_generate` | 由若干条总结综合生成画像 | 生成画像 | 生成「张三」的画像 |
| `memory_ingest_multistep` | 两步或四步的复杂提炼：先检索材料，再让模型合成 | 复杂提炼 | 把这些材料提炼成一份简报 |
| `memory_calibrate_confidence` | 只读统计：看看「把握度」打分和实际命中是否一致 | 校准 | 跑一次置信度校准 |
| `memory_quota_status` | 查看今天写了多少条、用了多少空间、建了多少关联 | 看配额 | 我今天还剩多少额度 |
| `memory_check_agent_action` | 只读检查某个操作是否违反规则（供客户端拦截调用） | 合规检查 | 这个操作允许吗 |
| `memory_rule_list` | 列出治理规则（只能读，改规则要走管理端） | 看规则 | 现在有哪些规则 |
| `memory_share` | 把一条记忆点对点复制给另一个用户，保留来源 | 分享 | 把这条分享给 alice |
| `memory_inbox` | 读自己的消息箱（未读有标记） | 收消息 | 看看有没有新消息 |
| `memory_subscription_dlq_list` | 查看通知投递失败的记录 | 排障 | 看看哪些通知没发出去 |
| `memory_subscription_replay` | 按投递顺序重放事件 | 补投 | 重放昨天失败的通知 |
| `memory_action_create` | 建一个待办协作任务 | 建任务 | 建一个「核对备份」的任务 |
| `memory_action_get` | 按编号看一个任务 | 看任务 | 看编号 7 的任务 |
| `memory_action_list` | 列出任务（可按分类与状态过滤，最新在前） | 列任务 | 列出所有未完成任务 |
| `memory_action_next` | 给出当前最该做的一个任务 | 排优先级 | 下一个该做什么 |
| `memory_action_frontier` | 列出前置条件已满足、无人占用的可做任务前沿 | 找可做任务 | 有哪些任务现在就能做 |
| `memory_action_transition` | 推进任务状态（状态流转要合法） | 推进 | 把任务 7 标记为已完成 |
| `memory_action_add_edge` | 给任务加一条有类型的依赖边 | 加依赖 | 任务 8 依赖任务 7 |
| `memory_action_edges` | 列出与某个任务相连的所有依赖边 | 看依赖 | 任务 7 被哪些任务依赖 |
| `memory_lease_acquire` | 领取一个任务的独占锁（有超时时间），被占用会冲突 | 领取 | 我来负责任务 7 |
| `memory_lease_get` | 查看某个任务当前有没有锁 | 看占用 | 任务 7 被谁领了 |
| `memory_lease_renew` | 给自己的锁续期（没有锁会报错） | 续期 | 任务还没做完，续 30 分钟 |
| `memory_lease_release` | 释放自己的锁 | 释放 | 任务做完了，释放 |
| `memory_checkpoint_create` | 建一个检查点，等某个外部条件达成 | 设卡点 | 建一个「等测试通过」的检查点 |
| `memory_checkpoint_query` | 列出检查点（可按条件类型与状态过滤） | 查检查点 | 看有哪些检查点还没达成 |
| `memory_checkpoint_resolve` | 标记检查点已达成（有密钥时会自动签名） | 达成 | 测试通过了，标记达成 |
| `memory_checkpoint_verify` | 取回检查点并校验它的签名 | 验签 | 校验这个达成记录 |
| `memory_routine_create` | 用带占位符的 JSON 模板建一个流程（先为草稿态） | 建流程 | 建一个「每日巡检」流程 |
| `memory_routine_freeze` | 把流程冻结成不可改的正式版本（有密钥时自动签名） | 冻结 | 冻结这个流程 |
| `memory_routine_list` | 列出流程（可按状态过滤，最新在前） | 列流程 | 看有哪些流程 |
| `memory_routine_run` | 按具体参数跑一次已冻结的流程 | 跑流程 | 用今天的参数跑一次巡检 |
| `memory_routine_status` | 按编号看一次运行的结果 | 看运行 | 看这次运行有没有成功 |
| `memory_signal_send` | 发一个信号（有密钥时自动签名） | 发信号 | 通知大家发布开始 |
| `memory_signal_inbox` | 看自己的信号收件箱（含广播，最新在前） | 收信号 | 看看有没有新信号 |
| `memory_signal_read` | 读取一个信号、标记已读并校验签名 | 读并校验 | 读这条信号并验签 |
| `memory_signal_ack` | 标记信号已确认收到 | 确认 | 这条我收到了 |
| `memory_signal_thread` | 按线索编号看一整串信号 | 看整串 | 把这次发布的信号串起来看 |

### 2.5 全量档 `full` —— 101 项（不对外开放，仅供排障）

这一档包含**所有**工具；前面各档的工具都在这里，说明从简。

| 工具 | 做什么 | 什么时候用 | 示例 |
| --- | --- | --- | --- |
| `memory_capabilities` | 查看档位、开通分组与工具总数（永远可用） | 查能力 | 「我现在能用哪些工具？」 |
| `memory_store` | 存一条记忆 | 记住一件事 | 「记住：纪要写成要点」 |
| `memory_recall` | 按意思找回记忆 | 回忆 | 「纪要格式是什么来着？」 |
| `memory_search` | 按关键词精确查找 | 精确定位 | 查含「redis」的记忆 |
| `memory_get` | 按编号取回全文与关联 | 看原样 | 打开编号 `8f2c…` |
| `memory_list` | 列出记忆 | 盘点 | 列出最近 20 条 |
| `memory_load_family` | 按类取回最近用过的若干条 | 按类取 | 取回「核心」类最近 10 条 |
| `memory_smart_load` | 说意图，由它判断取哪一类 | 不确定类别 | 「把决策相关的取出来」 |
| `memory_update` | 按编号局部修改 | 改内容 | 改 `8f2c…` 的正文 |
| `memory_delete` | 按编号彻底删除一条 | 删单条 | 删掉 `8f2c…` |
| `memory_forget` | 批量删除（默认先归档） | 批量清理 | 删掉标记「临时」的 |
| `memory_gc` | 清理过期记忆 | 清理 | 清理过期 30 天的 |
| `memory_promote` | 提升为长期保存 | 永久保留 | 把 `8f2c…` 设为长期 |
| `memory_capture_turn` | 原样保存一整轮对话 | 留存对话 | 客户端自动调用 |
| `memory_namespace_set_standard` | 给分类设固定说明 | 设口径 | 给「项目A」设开场说明 |
| `memory_namespace_get_standard` | 读取上述说明 | 看口径 | 看「项目A」的开场说明 |
| `memory_namespace_clear_standard` | 删掉上述设置 | 取消口径 | 清掉开场说明 |
| `memory_pending_list` | 列出待审批操作 | 审批 | 看有哪些待批 |
| `memory_pending_approve` | 批准待办操作 | 审批 | 批准编号 12 |
| `memory_pending_reject` | 拒绝待办操作 | 审批 | 拒绝编号 12 |
| `memory_subscribe` | 登记回调地址接通知 | 接通知 | 有变化时通知我 |
| `memory_unsubscribe` | 取消订阅 | 取消通知 | 取消这个订阅 |
| `memory_link` | 建立有方向的关系 | 建关系 | B 取代 A |
| `memory_get_links` | 列出全部关联与签名状态 | 看关系 | 看 `8f2c…` 的关联 |
| `memory_verify` | 校验关联签名 | 验签 | 校验这条关联 |
| `memory_kg_query` | 沿关系逐层往外走（最多 5 层） | 关系网查询 | 查三层关系 |
| `memory_find_paths` | 找两条记忆间的路径 | 找路径 | A 和 B 怎么连上的 |
| `memory_kg_timeline` | 按时间列出连出去的关系 | 看时间线 | 按时间列出关系 |
| `memory_lineage` | 沿派生 / 反思溯源 | 溯源 | 这条总结来自哪几条 |
| `memory_kg_invalidate` | 给关系设失效时间 | 作废关系 | 作废 A 到 B 的关系 |
| `memory_entity_register` | 登记实体并合并别名 | 建实体 | 登记「张三」 |
| `memory_entity_get_by_alias` | 按别名反查实体 | 查实体 | 「小张」是谁 |
| `memory_get_taxonomy` | 列出分类树与数量 | 看分类 | 看有哪些分类 |
| `memory_replay` | 取回产生过程的对话（需接通采集） | 回看过程 | 回看当时的对话 |
| `memory_auto_tag` | 自动补标签 | 补标签 | 给最近 20 条补标签 |
| `memory_check_duplicate` | 写入前查重 | 防重复 | 这段是不是已经有了 |
| `memory_detect_contradiction` | 检查是否矛盾 | 查矛盾 | 这条和以前冲突吗 |
| `memory_expand_query` | 扩展检索说法 | 改查询 | 换个说法去检索 |
| `memory_consolidate` | 合并多条为一条长期记忆 | 合并 | 把这 30 条合并 |
| `memory_atomise` | 拆成要点，原文归档 | 拆分 | 把长文拆成要点 |
| `memory_reflect` | 生成总结并连回来源 | 总结 | 总结这个项目 |
| `memory_reflection_origin` | 查总结的来源与深度 | 溯源 | 这条总结多深 |
| `memory_dependents_of_invalidated` | 列出受失效影响的其他记忆 | 影响面 | 这条失效影响哪些 |
| `memory_export_reflection` | 导出总结与来源 | 导出 | 导出成 Markdown |
| `memory_offload` | 原文另存，只留指纹 | 外存 | 把原文另存 |
| `memory_deref` | 取回外存原文并校验指纹 | 取回 | 取回刚才的原文 |
| `memory_persona` | 取回实体画像 | 看画像 | 看「张三」的画像 |
| `memory_persona_generate` | 由总结生成画像 | 生成画像 | 生成「张三」的画像 |
| `memory_ingest_multistep` | 多步提炼再合成 | 复杂提炼 | 提炼成一份简报 |
| `memory_calibrate_confidence` | 只读的置信度校准统计 | 校准 | 跑一次校准 |
| `memory_quota_status` | 查看配额与用量 | 看配额 | 今天还剩多少额度 |
| `memory_check_agent_action` | 只读检查操作是否违规 | 合规 | 这个操作允许吗 |
| `memory_rule_list` | 列出治理规则（只读） | 看规则 | 现在有哪些规则 |
| `memory_share` | 点对点复制给他人 | 分享 | 把这条分享给 alice |
| `memory_inbox` | 读自己的消息箱 | 收消息 | 看有没有新消息 |
| `memory_subscription_dlq_list` | 查看投递失败记录 | 排障 | 哪些通知没发出去 |
| `memory_subscription_replay` | 重放事件 | 补投 | 重放昨天失败的通知 |
| `memory_action_create` | 建协作任务 | 建任务 | 建「核对备份」任务 |
| `memory_action_get` | 看一个任务 | 看任务 | 看编号 7 |
| `memory_action_list` | 列出任务 | 列任务 | 列出未完成任务 |
| `memory_action_next` | 给出最该做的一个 | 排优先级 | 下一个做什么 |
| `memory_action_frontier` | 可做任务前沿 | 找可做 | 哪些现在能做 |
| `memory_action_transition` | 推进任务状态 | 推进 | 标记任务 7 完成 |
| `memory_action_add_edge` | 加依赖边 | 加依赖 | 任务 8 依赖任务 7 |
| `memory_action_edges` | 看依赖边 | 看依赖 | 谁依赖任务 7 |
| `memory_lease_acquire` | 领独占锁 | 领取 | 我来负责任务 7 |
| `memory_lease_get` | 看有没有锁 | 看占用 | 任务 7 被谁领了 |
| `memory_lease_renew` | 给锁续期 | 续期 | 续 30 分钟 |
| `memory_lease_release` | 释放锁 | 释放 | 做完释放 |
| `memory_checkpoint_create` | 建检查点 | 设卡点 | 等测试通过 |
| `memory_checkpoint_query` | 列检查点 | 查检查点 | 哪些还没达成 |
| `memory_checkpoint_resolve` | 标记达成 | 达成 | 测试通过了 |
| `memory_checkpoint_verify` | 校验达成签名 | 验签 | 校验这个记录 |
| `memory_routine_create` | 建流程模板 | 建流程 | 建「每日巡检」 |
| `memory_routine_freeze` | 冻结流程 | 冻结 | 冻结这个流程 |
| `memory_routine_list` | 列流程 | 列流程 | 看有哪些流程 |
| `memory_routine_run` | 跑一次流程 | 跑流程 | 用今天的参数跑一次 |
| `memory_routine_status` | 看运行结果 | 看运行 | 这次跑成功了吗 |
| `memory_signal_send` | 发信号 | 发信号 | 通知发布开始 |
| `memory_signal_inbox` | 信号收件箱 | 收信号 | 看有没有新信号 |
| `memory_signal_read` | 读信号并验签 | 读并校验 | 读这条信号 |
| `memory_signal_ack` | 标记已确认 | 确认 | 这条我收到了 |
| `memory_signal_thread` | 看一整串信号 | 看整串 | 把这次发布的串起来看 |
| `memory_agent_list` | 列出所有来源（使用者） | 看来源 | 有哪些使用者 |
| `memory_agent_register` | 登记一个使用者及其能力（登记是「自述」，不等于身份认证） | 登记来源 | 登记一个新使用者 |
| `memory_session_start` | 取回最近用过的记忆（语义档还附摘要） | 开会话 | 开新会话时取回上下文 |
| `memory_stats` | 总数、各保存时长与分类分布、归档数、占用空间 | 看总览 | 现在一共多少条、多大 |
| `memory_recall_observations` | 查看召回消费的记录 | 看流水 | 这次召回读了哪些 |
| `memory_archive_list` | 列出已归档的记忆 | 看归档 | 看归档里有什么 |
| `memory_archive_restore` | 把归档的一条恢复回来（清掉过期时间） | 恢复 | 恢复误删的那条 |
| `memory_archive_purge` | 按天数彻底清掉归档，**不可恢复** | 清空归档 | 清掉 90 天前的归档 |
| `memory_archive_stats` | 归档总数与各分类数量 | 归档统计 | 归档里有多少条 |
| `memory_notify` | 给某个用户发一条消息 | 发消息 | 给 alice 发一条 |
| `memory_list_subscriptions` | 列出现有订阅（**不会**返回密钥） | 看订阅 | 现在有哪些订阅 |
| `memory_skill_list` | 列出可复用的「技能」 | 看技能 | 有哪些技能 |
| `memory_skill_get` | 取回技能的说明与正文 | 看技能内容 | 看这个技能写了什么 |
| `memory_skill_register` | 带签名登记技能，同名重复登记会取代旧版 | 登记技能 | 登记一个新技能 |
| `memory_skill_export` | 导出成 Markdown 加资源文件，往返内容一致 | 导出技能 | 导出这个技能 |
| `memory_skill_resource` | 按指纹校验后取回资源文件 | 取资源 | 取回技能的附件 |
| `memory_skill_promote_from_reflection` | 由一条总结生成技能，并把来源一并附上 | 沉淀技能 | 把这份总结变成技能 |
| `memory_skill_compositional_context` | 按技能声明把相关总结一并取回（有长度上限） | 装配上下文 | 用技能时带上相关总结 |

### 2.6 自定义档示例 `core,lifecycle` —— 14 项（未来按需）

如果日后要给用户开放「删除」，最小增量是**只加生命周期这一组**（14 项），而不是把 `admin` 或 `full` 整体打开。

| 工具 | 做什么 | 什么时候用 | 示例 |
| --- | --- | --- | --- |
| `memory_store` | 存一条记忆（同核心档） | 记住一件事 | 「记住：纪要写成要点」 |
| `memory_recall` | 按意思找回记忆（同核心档） | 回忆 | 「纪要格式是什么来着？」 |
| `memory_search` | 按关键词精确查找（同核心档） | 精确定位 | 查含「纪要」的记忆 |
| `memory_get` | 按编号取回全文与关联 | 看原样 | 打开编号 `8f2c…` |
| `memory_list` | 列出记忆 | 盘点 | 列出最近 20 条 |
| `memory_load_family` | 按类取回最近用过的若干条 | 按类取 | 取回「核心」类最近 10 条 |
| `memory_smart_load` | 说意图，由它判断取哪一类 | 不确定类别 | 「把偏好相关的取出来」 |
| `memory_capabilities` | 查看当前档位与可用工具（永远可用） | 查能力 | 「我现在能用哪些工具？」 |
| `memory_update` | 按编号局部修改 | 改内容 | 改 `8f2c…` 的正文 |
| `memory_delete` | 按编号彻底删除一条 | 删单条 | 删掉 `8f2c…` |
| `memory_forget` | 批量删除（默认先归档，可先演习） | 批量清理 | 删掉标记「临时」的 |
| `memory_gc` | 清理过期记忆 | 清理 | 清理过期 30 天的 |
| `memory_promote` | 提升为长期保存 | 永久保留 | 把 `8f2c…` 设为长期 |
| `memory_capture_turn` | 原样保存一整轮对话 | 留存对话 | 客户端自动调用 |

---

## 3. 小提示与常见疑问

- **中文怎么用？** 存中文没问题；但**精确查找（`memory_search`）对中文只认「整段」**，一句话里挖几个字去查会查不到。**按意思找请一律用「想起来」（`memory_recall`）**。
- **为什么没有「删除」？** 你用的这一档（核心档 8 项）不含删除、遗忘、清理。需要删除请联系管理员。这是为了不让你误删 —— 日后若开放删除，会只加生命周期那一组（共 14 项），而不是把全部能力都打开。
- **能存多久？** 默认是 7 天（到期自动过期清理）；标注为「长期」的会一直保留。
- **别人能看到我的记忆吗？** 不能。每个人的记忆是分开存放的，检索只在你自己的范围里。
- **改档位后为什么没变化？** 档位在**连接时**确定，改完需要重新连接客户端。
- **我怎么知道当前开通了哪些？** 问客户端「我现在能用哪些工具」，它会调用 `memory_capabilities`，返回档位、可用分组和工具总数。
- **那些「不对外开放」的工具写在这里干什么？** 让你知道这套服务整体能做什么、边界在哪。这一页搬到门户时，会只保留你能用的部分。

---

## 关联文档

- 技术口径（档位定义、实测工具数、决议与理由）：[`./mcp-design.md`](./mcp-design.md) §8
- 测试与验收（各档工具数断言、客户端接入配置）：[`./mcp-test.md`](./mcp-test.md)
- 档位实测探针（可复跑）：[`../../scripts/profile-probe.sh`](../../scripts/profile-probe.sh)
- 门户接入指引页面（本页内容的落地位置）：[`../web-portal/web-design.md`](../web-portal/web-design.md)
