/**
 * `4.5`「web-portal:响应背压上限」的单测（`src/bridge/response-cap.ts`）。
 *
 * 判据形状由 `3.18` 探针（`probes/response-size-probe/`）导出：上游**不兜底**（stdio 面无上限，
 * 单条内容上限 64 KiB）⇒ 「门户级上限 + 明确报错」这半条只能自己实现，且**两条路径都要断**：
 *   · 头**未**发出 ⇒ 停止转发、由回调回 `502` + `RESPONSE_TOO_LARGE`；
 *   · 头**已**发出（SSE 中途）⇒ 停止转发并**截断**（结束流）。
 *
 * 另有一条**回归点**（实现时踩过）：回调自己写的错误应答（`res.end(json)`）必须能发出去 ——
 * 若包装把「超限后的一切写入」都吞掉，错误应答会被自己吞；若允许它计数，又会再次触发超限（递归）。
 *
 * 夹具纪律（首版踩过）：**被包装对象与断言目标必须分开** —— 若让 `res === raw`，包装会就地
 * 覆盖 `raw.write` / `raw.end`，spy 随之丢失（`[Function] is not a spy`）。这里用**独立的调用记录**
 * （而不是 spy），既不依赖结构、也不怕被覆盖。
 */
import type { ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { capResponseBytes, type ResponseCapInfo } from '../../src/bridge/response-cap';

interface Recorder {
  writes: unknown[];
  ends: unknown[];
  headersSent: boolean;
}

/** 最小假响应：底层行为记进 `rec`（与 `res` 分离），`headersSent` 走 getter ⇒ 测试可中途翻转。 */
function fakeRes(headersSent = false): { rec: Recorder; res: ServerResponse } {
  const rec: Recorder = { writes: [], ends: [], headersSent };
  const res = {
    get headersSent(): boolean {
      return rec.headersSent;
    },
    write: (chunk: unknown) => {
      rec.writes.push(chunk);
      return true;
    },
    end: (chunk?: unknown) => {
      rec.ends.push(chunk);
      return res;
    },
  };
  return { rec, res: res as unknown as ServerResponse };
}

const chunk = (kib: number): string => 'x'.repeat(kib * 1024);

describe('4.5 响应背压上限（capResponseBytes）', () => {
  it('未配置上限 ⇒ 原样返回同一个响应对象，一切照常转发（不启用该护栏）', () => {
    const { rec, res } = fakeRes();
    const seen: ResponseCapInfo[] = [];
    const out = capResponseBytes(res, undefined, (info) => seen.push(info));

    expect(out).toBe(res);
    expect(out.write(chunk(64))).toBe(true);
    expect(rec.writes).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it('未超限 ⇒ 原样转发、回调不触发', () => {
    const { rec, res } = fakeRes();
    const seen: ResponseCapInfo[] = [];
    capResponseBytes(res, 64 * 1024, (info) => seen.push(info));

    res.write(chunk(1));
    res.end(chunk(1));

    expect(rec.writes).toHaveLength(1);
    expect(rec.ends).toHaveLength(1);
    expect(seen).toEqual([]);
  });

  it('超限且**头未发出** ⇒ 丢弃超限片与后续数据，回调拿到 headersSent=false（收尾交给回调）', () => {
    const { rec, res } = fakeRes(false);
    const seen: ResponseCapInfo[] = [];
    capResponseBytes(res, 1024, (info) => seen.push(info));

    res.write(chunk(1)); // 放行
    res.write(chunk(1)); // 超限：丢弃
    res.write(chunk(1)); // 已截断：丢弃
    res.end('tail'); // 已截断：幂等，不转发

    expect(rec.writes).toHaveLength(1);
    expect(rec.ends).toHaveLength(0); // 头未发出 ⇒ 由回调负责收尾
    expect(seen).toEqual([{ sentBytes: 1024, maxBytes: 1024, headersSent: false }]);
  });

  it('超限且**头已发出** ⇒ 回调拿到 headersSent=true，并自动结束流（截断）', () => {
    const { rec, res } = fakeRes(true);
    const seen: ResponseCapInfo[] = [];
    capResponseBytes(res, 512, (info) => seen.push(info));

    res.write('a'.repeat(600));

    expect(rec.writes).toHaveLength(0);
    expect(rec.ends).toHaveLength(1); // 截断
    expect(seen).toEqual([{ sentBytes: 0, maxBytes: 512, headersSent: true }]);
  });

  it('回调里的错误应答**能发出去**（重入回归点），且不会再次触发超限', () => {
    const { rec, res } = fakeRes(false);
    let calls = 0;
    capResponseBytes(res, 128, () => {
      calls += 1;
      res.end('{"error":"RESPONSE_TOO_LARGE"}'); // 回调自己写错误应答
    });

    res.write(chunk(1));

    expect(calls).toBe(1); // 只触发一次（不会因为错误应答再超限而递归）
    expect(rec.writes).toHaveLength(0);
    expect(rec.ends).toEqual(['{"error":"RESPONSE_TOO_LARGE"}']);
  });

  it('`end(chunk)` 也计入上限：超限片不转发、回调到场', () => {
    const { rec, res } = fakeRes(false);
    const seen: ResponseCapInfo[] = [];
    capResponseBytes(res, 256, (info) => seen.push(info));

    res.end(chunk(1));

    expect(rec.ends).toHaveLength(0);
    expect(seen).toEqual([{ sentBytes: 0, maxBytes: 256, headersSent: false }]);
  });
});
