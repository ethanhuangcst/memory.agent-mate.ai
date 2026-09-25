# 3.21 启动自检判据可行性探针（研究类，不入制品）

为 Sprint 4 `#4.3 web-portal:启动自检` 的**开工准备**服务（用例 `TC-P-L0-06`–`09`，设计 §3.4）。

已有事实（本轮覆盖核对的起点）：`admin_portal/src/selfcheck.ts` 已实做 **6 项**并通过 `server.ts` 的启动序列 fail-closed；另有 **3 项显式 `deferred`**（`embeddings_reachable_1024` / `binary_version_matches_lock` / `launch_template_assertions`，detail 写着「待 §4.3 落地」）⇒ 本探针只回答「这三项 + fail-closed 不变量的**判据形状**能不能定」。

调用（需要容器常驻基线 + 门户依赖已装；**独占端口**，默认 8814）：

```bash
bash memory.agent-mate.ai/probes/selfcheck-verdict-probe/probe.sh [--port 8815]
```

只读：不改产品代码、不改任何 specs/制品。

## 结论（2026-09-25 实测 · 8/8 PASS · 退出码 0）

| 问题 | 结论 | 灵敏度对照 |
|---|---|---|
| **Q1** `fail-closed` 成立吗 | **成立**，三重证据：① 合法配置 ⇒ `portal_listening` + `/healthz` 通 ② 用户目录不可写（`chmod 500`）⇒ 进程**退出码 1**、日志记失败项 ③ 此时端口**未监听** | ①②③ 互为对照：只有「能启」与「该拒」两种结果都被观察到，才证明不是恒真/恒假 |
| **Q2** `deferred` 当下算通过吗 | **算**（实证：`pass=6 deferred=3 fail=0` 时门户**照常启动**）⇒ 这就是本行要收口的缺口：三项 deferred 必须变成**真检查**或**显式 pass**，不能继续悬着 | 「有 deferred 仍启动」本身就是对照：收口后再跑，deferred 计数应为 0 |
| **Q3** `embeddings` 怎么判 | **不能只判「调用成功」**：坏 key 下上游出「线性扫描 / 无 embeddings」告警，而 `tools/call` **仍然返回响应** ⇒ 判据必须是「**可达 + 维度 1024**」（或至少能读到该告警面） | 坏 key 与真 key 两条对照 ⇒ 只有前者会出告警 |
| **Q4** 版本比对怎么落地 | 归一化取法成立：容器内 `ai-memory --version` = `ai-memory 0.10.0` ⇒ **取末位 semver**；`upstream.lock` 的 `UPSTREAM_RELEASE_TAG=v0.10.0` / `IMAGE_TAG=0.10.0` ⇒ **去 `v` 后相等**。另实证：**`upstream.lock` 未挂进门户容器**（`portal.compose.yml` volumes 无此项）⇒ 「锁侧输入」须由**镜像构建期**固定（归 Sprint 5 镜像侧） | 两条不同形态的版本串（`v0.10.0` / `0.10.0`）必须都归一化到同一个值，才说明规则不漏 |
| **Q5** 模板断言能复用吗 | **能**：`src/bridge/launch-template.ts` 的 argv/env 常量表 + `mcp-design.md` §5.6.4 真源都在，启动期可做同一比对体（现有 `tests/unit/launch-template.test.ts` 17 例已守同一比对） | 单测是「同一比对体」的正向对照；收口时把同一函数搬到启动期即可 |

## 首轮踩到的坑（v2 已修，记录以免重犯）

1. **探针文案里的反引号会被 shell 当命令替换执行**（`"=== Q2：\`deferred\` …"` ⇒ `deferred: command not found`）⇒ 探针输出文案一律不带反引号。
2. **`pid="$(start &)"` 取不到子进程**：进程成了子 shell 的子进程，`wait` 报 not a child ⇒ 必须用全局变量在**当前 shell**里后台起进程。
3. **「正向」场景必须先给合法身份姿态**：自检含 `auth_posture`，没配 Access 又没开测试 JWT 时**正向场景本身就不合法**（门户直接拒绝启动 —— 这条也顺带证明 fail-closed 生效）。

## 边界（如实登记）

- 本探针**不改**产品代码与 specs；`#4.3` 的实现（把三项 deferred 收口 + 加编排不变量断言）另开。
- **② 的「维度 1024」未在探针里断言**：门户侧目前**没有任何 embeddings 客户端**（`admin_portal/src/**` 无 MaaS HTTP 客户端，唯一通路是 spawn 上游子进程），而「读维度」需要 SDK/HTTP 通路 ⇒ 探针只证到「静默降级真实存在」这一步；**通路选择（spawn 上游 vs 直连 MaaS）需在实现前拍板**（直连会新增配置键，须同步 `deployment.md` 契约表）。
- **③ 的镜像侧落地**（构建期注入 `IMAGE_TAG`）归 Sprint 5；本行可交付的是**判据 + 读取位 + 失败路径**。
- 容器编排侧现状：`portal.compose.yml` **无 `healthcheck`、无 `depends_on`**，且 `/healthz` 固定返回 `ok:true`（**不反映自检结论**）⇒ 「通过后才对外服务」目前只由「进程内自检不过就不 listen」兑现；`restart: unless-stopped` 与「自检失败退出」组合还需要在实现轮定策略（避免失败重启循环）。
