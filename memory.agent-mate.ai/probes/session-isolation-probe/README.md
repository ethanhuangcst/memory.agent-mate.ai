# 3.12 mcp:会话隔离判据探针（Sprint 4 `3.3` 的开工前置）

> **研究类探针，不入制品**（[`ADR-017`](../../specs/adr/ADR-017-complexity-probe-before-real-build.md)）。它为 Sprint 4 `3.3`「mcp:一会话一子进程」回答「**验收判据怎么写才成立**」，并在过程中**实测到产品代码的一处缺陷**。
>
> 交付对象：本 Sprint `3.3`。`AC4.5` / `AC4.6`（[`../../specs/web-portal/web-stories.md`](../../specs/web-portal/web-stories.md) §S4）是它的验收条件；**判据的形状**由本探针钉死，**产品侧的 e2e 入口**由 `3.3` 交付（跑法见 [`../../specs/mcp/mcp-test.md`](../../specs/mcp/mcp-test.md) §4-G）。

## 为什么必须先用探针

`3.3` 的两条验收条件都**指向「容器里的东西」**：

- `AC4.6`：两个并发会话对应**两个独立子进程**（`web-stories.md:299-304`）；
- `AC4.5`：会话前后不出现**其他用户的库或临时文件**（`web-stories.md:292-297`）。

这两条**没法**用假上游验（假上游既不是一个 `ai-memory` 进程、也没有用户的库文件），而真上游上「数进程」「看文件足迹」各有两个已知坑（容器**无 `ps`**、Rosetta 下 **`/proc/<pid>/exe` 不可用**）。**判据只要没实测过，写进 `mcp-test.md` 就是纸面判据** —— 所以先花一次探针的成本把它钉死。

## 跑法

**以下命令都从仓根（`/Users/ethanhuang/code/memory.agent-mate.ai`）执行。**

```bash
bash memory.agent-mate.ai/probes/session-isolation-probe/probe.sh
```

前置只有三条，缺任一条脚本会以 `10` 退出并**打印该跑哪条命令**：

```bash
bash memory.agent-mate.ai/scripts/local-up.sh
(cd memory.agent-mate.ai/admin_portal && npm install)
```

（第三条是「端口 8798 空闲」，用 `PROBE_PORT=` 换端口即可。）

覆盖默认值：

```bash
PROBE_PORT=8899 PROBE_CONTAINER=ai-memory-mcp bash memory.agent-mate.ai/probes/session-isolation-probe/probe.sh
```

> **两个踩过的坑**：① 起**上游容器**的是脚本 `scripts/local-up.sh` —— 仓根 Makefile **没有** `local-up` 目标（`make up` / `make portal-up` 起的是**门户**，不是上游）；② 仓根下**没有** `admin_portal/`，它是 `memory.agent-mate.ai/admin_portal`。
> zsh 交互式默认**不把 `#` 当注释** ⇒ 别把带 `#` 的行整段粘进去（要么 `setopt interactive_comments`，要么只粘命令行）。

| 项 | 值 |
|---|---|
| 退出码 | `0` 全部断言通过 · `10` 前置不足 · `20` 门户起不来 · `30` 断言失败 |
| 原始输出 | `out/probe-<时间戳>.log`（**不入库**，见 `.gitignore`） |
| 拓扑 | `[探针 HTTP 客户端] → [门户 /mcp] → [容器内 ai-memory]`（真上游，经 `PORTAL_LAUNCH_OVERRIDE` 借壳 `docker exec`） |
| 断言体 | [`admin_portal/tests/fixtures/session-isolation-probe.mts`](../../admin_portal/tests/fixtures/session-isolation-probe.mts) —— **放在门户树里**是为了复用门户的依赖解析与 `better-sqlite3` 原生编译（放 `probes/` 下会 `ERR_MODULE_NOT_FOUND`，实测踩过；与 `probe-runner.mts` 同因）。`tests/` 不进制品 |

## 十项判据（实测）

首跑 `2026-09-24 12:09`：**8/8 断言 PASS、退出码 `0`**，另 **2 项实测发现**；两次复跑（`12:1x`）结论一致。

| # | 判据 | 实测 |
|---|---|---|
| A1 | 两个并发会话 ⇒ 容器内上游进程 **+2** 且 PID 互不相同 | ✅ 基线 `0` ⇒ 并发 `2`（`16953` / `16966`；两次复跑 `17219/17232`、`17486/17499`） |
| A2 | 两个进程各自带着**自己用户的**库路径与身份 | ✅ `AI_MEMORY_DB=/data/users/p33a/ai-memory.db` + `AI_MEMORY_AGENT_ID=human:p33a`（另一进程为 `p33b`）—— 判据 = **同 uid 读 `/proc/<pid>/environ`** |
| A3 | 会话**真写一次**后，用户目录**之外零新增**、变化**只**落在共享审计日志 | ✅ 新增(外) `0`；变化(外) `1` = `/data/.local/state/ai-memory/audit/forensic-2026-09-24.jsonl`（**上游共享**审计日志，必须豁免） |
| A4 | 旁观者用户（`iso-alice`，本探针**不碰**）的库**零变化** | ✅ —— 「不出现其他用户的库文件」的基准 |
| A5 | 两会话正常收尾后进程数回落基线 | ✅ `2 → 0` |
| A6 | 同用户**重开**会话**不复用**旧进程（禁池化） | ✅ 新 PID（`17054` / `17320` / `17587`），旧 PID 全不重叠 |
| A7 | 重开的会话收尾后同样归零 | ✅ |
| A8 | 跨用户接管（甲令牌 + 乙 `sessionId`）被拒 **401** 且**不新增**进程 | ✅ HTTP `401` · 进程 `2 → 2` |
| A10 | **门户进程退出** ⇒ 容器内归零（β′「父死子死」） | ✅ 每轮收尾后 `0` |

**判据的两个反直觉点（都已实测、都写进了判据口径）**：

1. **`/proc/<pid>/environ` 要「同 uid」读，`-u 0` 反而读不到** —— `docker exec -u 0` 读该文件得到 `Permission denied`，而容器默认用户（`aimem`）读得到。判据**不要**借 root。
2. **`/data` 上不能写「零变化」** —— 会话只要真写一次，上游就会更新**共享** forensic 审计日志（`/data/.local/state/ai-memory/audit/*.jsonl`）。判据必须写成「**除该共享日志外**，变化只落在活跃会话自己的用户目录内」。

## 两项实测发现（`[F]`，**不参与**退出码）

> 探针的职责是把事实钉死，不是替实现判对错 —— 所以这两条以 `[F] 发现：…` 输出，**不影响** `exit 0`。
> **两条都是条件输出**：`3.3` 的修正落地后，它们会变成 `[i]` 的正面结论（「不可侵扰成立」/「收尾后无孤儿」）⇒ **同一个探针直接当回归判据用**，不需要另改判据。

| # | 发现 | 依据 |
|---|---|---|
| F1 | **接管被拒时，受害者的会话被顺手摘掉**：`route.ts` 在「会话不属于本令牌」分支上做 `registry.remove(existing.id)` ⇒ 攻击/误用者拿**甲**的令牌 + **乙**的 `sessionId` 发一次请求，**乙**随后用自己的令牌 + 原 `sessionId` 就**已经是 401** | `src/bridge/route.ts:228`；实测：接管 `401` 之后，乙 `listTools()` 抛 `unauthorized` |
| F2 | **受害者的子进程成孤儿**：被摘掉的会话已不在注册表里 ⇒ 没有任何引用去 `close()` 它 ⇒ 收尾后**残留 1 个**容器内进程（**门户进程退出时才随之消失**，故不是永久泄漏，但会一直占着库与内存） | 实测：收尾后残留 `17367` / `17634`；门户退出后归零（A10） |

⇒ `3.3` 的修正方向（**已定档**，见 [`../../specs/web-portal/web-design.md`](../../specs/web-portal/web-design.md) §12.5「第三方会话的不可侵扰」）：**不属于本令牌的会话只拒不动**；只有「该会话自己的传输已关闭」这一支才顺手 `close()`（幂等回收）。

## 由结论导出的判据实现口径（`3.3` 直接照用）

| 要判的事 | 判据实现 | 不要这样做 |
|---|---|---|
| 两个会话两个进程 | 容器内按 `cmdline` **精确前缀**计数（前缀必须带 `--profile core`，否则会把别处遗留的同形孤儿一起数进来） | 不用 `ps`（镜像里没有）；不按 `/proc/<pid>/exe` 判（Rosetta 下恒指向 rosetta） |
| 「以谁的库与身份启动」 | **同 uid** 读 `/proc/<pid>/environ` 取 `AI_MEMORY_DB` / `AI_MEMORY_AGENT_ID` | 不借 `-u 0`（实测读不到） |
| 「他人痕迹」 | `find /data /tmp -type f -printf '%p\|%T@\|%s\n'` 前后快照差分；豁免**共享**审计日志；正面对照 = 旁观者用户库零变化 | 不断言「`/data` 零变化」（共享审计日志必然变） |
| 拓扑无关 | 观测参数化为「**容器名 + cmdline 前缀**」⇒ 本机借壳与生产 β′（门户在容器内直接 spawn）用**同一套判据** | 不要把判据绑在 `docker exec` 这一形态上 |

## 边界（如实登记）

- **本机局限**：模板库路径在**容器内**解析，而门户跑在宿主 ⇒ 脚本在容器内**预建**测试用户目录；生产 β′（门户在容器内 spawn）无此错位。
- **只测两条会话并发**，不测同用户**同时**两会话落在**同一个**库上的行为（那是 SQLite 并发写路径，属配额与并发上限 `4.1`）。
- **未覆盖**：`4.1` 的空闲超时 / 并发上限取值；`3.4` 的「回收判据（子进程归零 + 路径留痕审计）」—— 本探针只提供 A5/A7/A10 三个可用观测位。
- 本探针**不改**产品代码（本轮只做开工准备）；F1 / F2 的修正归 `3.3`。
