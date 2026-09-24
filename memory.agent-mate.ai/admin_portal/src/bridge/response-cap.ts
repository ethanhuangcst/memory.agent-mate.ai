/**
 * `/mcp` 响应的**单响应字节上限** —— `web-design.md` §12.5「背压」承诺的**第二半**
 * （「对超大响应设门户级上限并**明确报错**」）。
 *
 * ## 为什么需要它
 *
 * §12.5 的背压承诺有两半：① 「stdio 管道与 HTTP 流**按 stream 处理、不整包缓冲**」（既有转发路径
 * 已成立）；② 「对超大响应设**门户级上限**并**明确报错**」—— `4.1` 如实降级为**未实现**（该轮的
 * 验收条件只含四个并发/超时上限，不含响应体量）。`3.18` 探针（`probes/response-size-probe/`）实测：
 * 上游对 **stdio** 单条响应**没有任何体量上限**（`[limits].max_page_size` 是 **HTTP 面专属**），
 * 单条内容上限 `65536` 字节 ⇒ 单响应约 65 KiB 可**完好透传**；若某工具一次批量返回正文，量级按
 * `k × 65 KiB` 估算 ⇒ 门户侧**没有任何兜底**。
 *
 * ## 语义（两条路径都留痕；由调用方决定怎么写）
 *
 * | 触发时机 | 行为 |
 * |---|---|
 * | 响应头**尚未发出**（还能改状态码） | 停止转发超限数据，由 `onExceed` 回 `502` + `RESPONSE_TOO_LARGE` |
 * | 响应头**已发出**（SSE 流中途） | 停止转发并**结束流**（截断），由 `onExceed` 负责留痕 |
 *
 * **未配置上限 ⇒ 原样返回 `res`**（不启用该护栏）—— 与 `4.1` 的并发上限同一口径：本层不写死默认值，
 * 生产取值由 `deploy/portal.compose.yml` 给出（取值依据见 `probes/response-size-probe/README.md`）。
 *
 * ## 一处必须留意的重入（实测过的坑）
 *
 * `onExceed` 的典型实现是**自己写一段错误应答**（`reply.raw.end(json)`）—— 而 `reply.raw` 正是
 * 本函数包过的那个对象。若在回调期间仍按「已截断 ⇒ 丢弃」处理，**错误应答会被自己吞掉**；
 * 若反过来允许它计数，错误应答本身又会再次触发超限（递归）。⇒ 回调期间用 `inCallback` 放行、
 * 且 `headersSent` 在**回调之前**取快照（否则「头未发出」那一支的回调写完头后，末尾的
 * `if (headersSent) end()` 会多收一次尾）。
 */
import type { ServerResponse } from 'node:http';

export interface ResponseCapInfo {
  /** 已经放行的字节数（**超限的那一片不计入**）。 */
  readonly sentBytes: number;
  readonly maxBytes: number;
  /** 响应头是否已发出（**回调之前**的快照）—— 决定调用方还能不能改状态码。 */
  readonly headersSent: boolean;
}

/** 一片数据的字节数（`write` / `end` 的入参可能是 string / Buffer / Uint8Array）。 */
function sizeOf(chunk: unknown, encoding?: BufferEncoding): number {
  if (typeof chunk === 'string') return Buffer.byteLength(chunk, encoding ?? 'utf8');
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  return 0;
}

const isChunk = (value: unknown): boolean => typeof value === 'string' || value instanceof Uint8Array;

/**
 * 给响应套上字节上限，返回**同一个**（已被包装的）`ServerResponse`。
 *
 * 超限后：**丢弃**后续数据（`write` 返回 `true` 而不转发、`end` 变幂等），只调用**一次** `onExceed`；
 * 头已发出时顺手结束流（截断），头未发出时把收尾留给 `onExceed`（它要写错误应答）。
 */
export function capResponseBytes(
  res: ServerResponse,
  maxBytes: number | undefined,
  onExceed: (info: ResponseCapInfo) => void,
): ServerResponse {
  if (maxBytes === undefined) return res;

  const write = res.write.bind(res);
  const end = res.end.bind(res);
  let sentBytes = 0;
  let capped = false;
  let inCallback = false;

  /** 统一的超限处理：只触发一次 `onExceed`，头已发出则结束流。 */
  const exceed = (): void => {
    const headersAlreadySent = res.headersSent; // **回调之前**取快照
    capped = true;
    inCallback = true;
    try {
      onExceed({ sentBytes, maxBytes, headersSent: headersAlreadySent });
    } finally {
      inCallback = false;
    }
    if (headersAlreadySent) end(); // 头已发出 ⇒ 只能结束流（截断）
  };

  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (inCallback) return write(chunk as never, ...(rest as never[])); // 回调自己写的错误应答放行
    if (capped) return true;
    const next = sentBytes + sizeOf(chunk, rest[0] as BufferEncoding | undefined);
    if (next > maxBytes) {
      exceed();
      return true; // **超限那一片不转发**
    }
    sentBytes = next;
    return write(chunk as never, ...(rest as never[]));
  }) as ServerResponse['write'];

  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    if (inCallback) return end(chunk as never, ...(rest as never[]));
    if (capped) return res;
    if (isChunk(chunk)) {
      const next = sentBytes + sizeOf(chunk, rest[0] as BufferEncoding | undefined);
      if (next > maxBytes) {
        exceed();
        return res;
      }
      sentBytes = next;
    }
    return end(chunk as never, ...(rest as never[]));
  }) as ServerResponse['end'];

  return res;
}
