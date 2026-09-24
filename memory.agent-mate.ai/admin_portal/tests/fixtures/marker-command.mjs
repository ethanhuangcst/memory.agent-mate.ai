#!/usr/bin/env node
/**
 * 「上游启动命令**有没有被执行**」的**直接观测点**（Sprint 4 `3.2` 的 `TC-M-L3-02` 用）。
 *
 * ## 为什么不复用既有的 `--env-dump`
 *
 * `fake-upstream.mjs` 的 `--env-dump` 写在模块顶层、`server.connect()` 之前 —— 看起来够早，
 * 但它**只是弱判据**：同一个夹具的 `--fail-before-initialize` 会在 dump **之前**就
 * `process.exit(3)` ⇒「dump 文件不出现」也可能意味着「进程起来了、但立刻退出」，
 * 而不是「从未被拉起」。`3.2` 要验的恰恰是否定命题「**没有 spawn**」，弱判据不够。
 *
 * ## 本脚本的判据为什么是强的
 *
 * 它**被执行的第一个动作就是 append 标记**（同步写，先于任何可能失败的逻辑）：
 *
 *   「标记文件不存在」 ⇔ 「本进程从未被执行」 ⇔ 「上游未被 spawn」
 *
 * 没有时序假设，也不依赖任何上游行为。
 *
 * ## 用法
 *
 * 把它当作 `PORTAL_LAUNCH_OVERRIDE` 的命令首段：
 *
 *   node <本文件> <标记文件路径>
 *
 * 渲染器（`launch-template.ts` 的 `renderLaunch`）会把模板 argv
 * （`mcp --tier smart --profile core`）接在后面 ⇒ **本脚本忽略多余 argv**。
 *
 * ## 退出码
 *
 * 以 **9** 退出：本脚本不是真上游，**若它真的被拉起**（说明断言没拦住），
 * 应当让会话**响亮失败**（503）、而不是假装成功 —— 免得给出一条「静默通过」的假绿。
 */

import fs from 'node:fs';

const markerPath = process.argv[2];
if (markerPath) {
  try {
    fs.appendFileSync(markerPath, `${process.pid}\n`);
  } catch {
    // 观测本身失败不影响「本进程被执行过」这一事实的语义：下面照样退非零。
  }
}

process.exit(9);
