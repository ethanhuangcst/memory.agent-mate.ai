# `3.18` 探针：单响应体量敞口（为 `PORTAL_RESPONSE_MAX_BYTES` 定档）

**研究类，不入制品**。为 `web-design.md` §12.9 的 `PORTAL_RESPONSE_MAX_BYTES`（「单响应上限（背压保护）」，
`4.1` 如实降级为「**本轮未实现**」）测出**供给侧的体量量级**，给这个上限一个**有数字依据**的取值。

## 为什么必须实测

`web-design.md` §12.5 的背压承诺有两半 —— ① 「stdio 管道与 HTTP 流**按 stream 处理、不整包缓冲**」；
② 「对超大响应设**门户级上限**并**明确报错**」。**①已成立**（既有转发路径是流式），**②未实现**
⇒ 门户今天对响应体量**没有上限**。而「门户无上限」是不是**真实敞口**，取决于**上游能产出多大的响应**：
既有登记只说 `[limits].max_page_size` 是 **HTTP 面专属**、stdio 会话**不经过** ⇒ 上游在 stdio 面上
**不兜底**（`mcp-test.md` §4-D TC-LIMIT-02 已证）。⇒ 供给侧量级只能实测。

## 怎么跑（自包含）

```bash
cd memory.agent-mate.ai/probes/response-size-probe
npm install && node probe.mjs          # 退出码 0 全通过 · 10 前置不足 · 30 断言失败
# 可调：PROBE_LADDER=4,16,32（KiB 阶梯）· PROBE_SMALL_N=40（索引类条数）
```

## 结论（2026-09-24 实测，两轮一致）

| # | 结论 | 实测与依据 |
|---|---|---|
| 1 | **上游对 stdio 的单条响应没有任何体量上限** | 单条内容 **4 / 16 / 32 KiB** 三档全成功，`memory_get` 回包 **5.0 / 17.0 / 33.1 KiB**，**完整含标记、无截断、无报错**（`Q2·4K`/`·16K`/`·32K` 三档 PASS） |
| 2 | **单条内容的上限 = 65536 字节（64 KiB）** | 边界轮（`PROBE_LADDER=4,64,128`）：64 KiB 与 128 KiB 档均被拒 —— `content exceeds max size of 65536 bytes`。⇒ **单条响应的现实上界 ≈ 64 KiB 正文 + 元数据（≈ 65 KiB）** |
| 3 | **索引类回包很小，不是体量来源** | `memory_list` / `memory_recall` / `memory_search` 回包是**紧凑索引行**（`id\|title\|tier\|namespace\|priority\|score\|tags\|agent_id`，**不含正文**）：**约 115 字节/条**（如 14 条 ⇒ 1.8 KiB） |
| 4 | **上游对语义近重复内容拒写** | `CONFLICT: memory near-duplicates an existing memory in namespace 'global'` —— 用同一段填充文本造数时 40 条只剩 1 条成功（**探针造数缺陷**）；换成「主体 × 属性 × 动词」组合句后 40 条成功 13–16 条 ⇒ **该门限是上游行为**，造数必须语义互异，成功率只作观察项 |
| 5 | **`memory_load_family` 的 `family` 是「工具族」不是用户数据** | 报错列出合法值：`core\|lifecycle\|graph\|governance\|power\|meta\|archive\|other` ⇒ 它不是记忆批量读通道 |
| 6 | **「多条 × 正文」体量未测（如实登记）** | `memory_smart_load {intent, k}` 本次造数下回 `count:0`（`chosen_family` 由 embedder 选出，与所写条目的 tier/kind 不匹配）⇒ 该路径的体量**未实测**，不猜 |

**由此得到的取值依据**（`4.1` 的降级项要有数字才能补）：单条最坏 ≈ **65 KiB**；若某工具一次批量返回
`k` 条正文，最坏 ≈ `k × 65 KiB`（`memory_smart_load` 默认 `k=20` ⇒ ≈ **1.3 MiB**）⇒ 门户级上限取
**4 MiB** ⇒ 对已知最坏情形仍有约 **3 倍**余量，同时把单响应的内存占用**钉死在上界**。

## 判据纪律（本探针实测换来的）

- **按标记/标题判，禁止按 `memory_recall` 的 `count` 判**（`3.14` 陷阱：语义混合检索的 `count` 是返回条数）。
- **判据要先看回包形态**：索引类**不含正文**，对其写「正文标记命中」**必然空转**（v1/v2 实测）。
- **不可控的量不写成硬断言**：上游的近重复门限、`memory_smart_load` 的选族机制都不是判据能控的量
  ⇒ 降为**观察项**并如实登记「未测」，不写「不会发生但必须写」的分支。
- **输出必须同步落盘**（`fs.writeSync`）：v3 实测，会话断开时 stdout 压在管道缓冲里 ⇒ **整轮日志丢失**，只留一个栈。
- **调用要兜住断连**：上游**子进程**退出（容器本身正常、无重启/OOM）时不要崩，记为证据并**重开会话**继续。

## 边界与残留

- 只测 **core 档 7 个工具 + `memory_capabilities`**；`power` / `graph` / `meta` 等族的批量读未测。
- 直连上游（不经门户）：门户侧「有没有上限」是**代码事实**（该键未实现）；本探针量的是**供给侧**。
- `memory_smart_load` 的批量正文体量**未实测**（见结论 6）⇒ 取值依据按最坏情形估算，不做断言。
- 原始输出落 `out/`（含 `schemas.json` 的 8 个工具全量入参），**不入库**。

## 回归入口

```bash
node probe.mjs                                        # 7/7 PASS、退出码 0
PROBE_LADDER=4,64,128 PROBE_SMALL_N=1 node probe.mjs  # 边界轮：64 KiB 起被拒（内容上限）
```
