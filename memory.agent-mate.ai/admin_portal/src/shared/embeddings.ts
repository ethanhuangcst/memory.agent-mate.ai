/**
 * 直连 MaaS 的 embeddings 探针（Sprint 5 `#17`；判据形状见 `specs/web-portal/web-design.md` §3.4 ①）。
 *
 * **为什么直连**（§3.4 ④ 已拍板）：经上游判会**假绿** —— `3.21` 实测坏 key 下上游只出「线性扫描 /
 * 无 embeddings」告警，而 `tools/call` **仍然返回响应**。判据必须同时断「可达」与「向量长度 == 1024」，
 * 且**不经**上游的降级路径。
 *
 * 请求形状**照搬** [`scripts/probes/qwen-verify.sh`](../../../scripts/probes/qwen-verify.sh)（仓内既有的
 * 实测真源，避免重新发明）：
 *
 * ```
 * POST {base_url}/embeddings
 * {"model": "<model>", "input": ["ai-memory embedding probe"]}
 * ```
 *
 * 判据：① `401/403` ⇒ `unauthorized` ② 其他非 2xx ⇒ `http` ③ 取不到 `data[0].embedding` ⇒ `shape`
 * ④ 长度 ≠ 期望 ⇒ `dimension`（**静默降级形态**：不显式给 `dim` 时上游会回落 768）⑤ 网络/超时 ⇒ `network`。
 * 任一不过都返回 `ok: false`；**本模块不决定姿态**（生产 `fail` / 开发 `deferred` 由自检决定）。
 */

/** 期望向量维度（`mcp-design.md` §9 F3 实测 `qwen3.7-text-embedding` = 1024）。 */
export const DEFAULT_EMBEDDING_DIM = 1024;

/** 单次探测超时（毫秒）。 */
export const DEFAULT_EMBEDDING_TIMEOUT_MS = 10_000;

export interface EmbeddingProbeOptions {
  readonly baseUrl: string;
  /** 门户专用 MaaS key（`DASHSCOPE_API_KEY`）；`null` = 不带 Authorization 头。 */
  readonly apiKey: string | null;
  readonly model: string;
  readonly expectedDim: number;
  readonly timeoutMs?: number;
  /** 注入口（仅测试用）；默认用全局 `fetch`。 */
  readonly fetchImpl?: typeof fetch;
}

export type EmbeddingProbeFailureKind = 'unauthorized' | 'http' | 'shape' | 'dimension' | 'network';

export type EmbeddingProbeResult =
  | { readonly ok: true; readonly dim: number }
  | { readonly ok: false; readonly kind: EmbeddingProbeFailureKind; readonly detail: string };

/** 一次最小调用后判断「非 401/403 且向量长度 == `expectedDim`」。 */
export async function probeEmbeddingDimension(
  options: EmbeddingProbeOptions,
): Promise<EmbeddingProbeResult> {
  const { baseUrl, apiKey, model, expectedDim, timeoutMs = DEFAULT_EMBEDDING_TIMEOUT_MS } = options;
  const doFetch = options.fetchImpl ?? fetch;
  const url = `${baseUrl.replace(/\/+$/, '')}/embeddings`;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: ['ai-memory embedding probe'] }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, kind: 'network', detail: `调用 ${url} 失败：${reason}` };
  }

  // ① 凭据不可用（AC11.2 的 Examples 之一：门户专用凭据缺失 / 服务返回未授权）。
  if (response.status === 401 || response.status === 403) {
    return { ok: false, kind: 'unauthorized', detail: `${url} 返回 HTTP ${response.status}（凭据不可用）` };
  }
  if (!response.ok) {
    return { ok: false, kind: 'http', detail: `${url} 返回 HTTP ${response.status}` };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, kind: 'shape', detail: `${url} 回体不是 JSON` };
  }

  const vector = (body as { data?: Array<{ embedding?: unknown }> }).data?.[0]?.embedding;
  if (!Array.isArray(vector)) {
    return { ok: false, kind: 'shape', detail: `${url} 回体缺少 data[0].embedding（数组）` };
  }
  // ④ 维度不符 —— **不得**静默通过：不显式给 dim 时上游会回落 768（`mcp-design.md` §9 F2）。
  if (vector.length !== expectedDim) {
    return {
      ok: false,
      kind: 'dimension',
      detail: `向量长度 ${vector.length} ≠ ${expectedDim}（静默降级形态）`,
    };
  }
  return { ok: true, dim: vector.length };
}
