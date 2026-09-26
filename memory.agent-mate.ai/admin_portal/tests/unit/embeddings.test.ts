/**
 * 直连 MaaS 的 embeddings 探针单元测试（Sprint 5 `#17`）。
 *
 * 覆盖两类：① **判据五形态**（`ok` / `dimension` / `unauthorized` / `http` / `shape` / `network`）——
 * 其中 `dimension` 是**静默降级形态**（不显式给 `dim` 时上游会回落 768，`mcp-design.md` §9 F2）；
 * ② **请求形状**（照搬 `scripts/probes/qwen-verify.sh`：`POST {base}/embeddings` + `{"model","input"}`）。
 *
 * 用 `fetchImpl` 注入口 ⇒ 不起真服务器（真 HTTP 通路由 `#17` 开工准备探针的 stub 相覆盖）。
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_EMBEDDING_DIM, probeEmbeddingDimension } from '../../src/shared/embeddings';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const BASE = {
  baseUrl: 'https://maas.test/v1',
  apiKey: 'test-key',
  model: 'qwen3.7-text-embedding',
  expectedDim: DEFAULT_EMBEDDING_DIM,
};

describe('probeEmbeddingDimension：判据五形态', () => {
  it('1024 维 ⇒ ok:true（**正向控制**）', async () => {
    const result = await probeEmbeddingDimension({
      ...BASE,
      fetchImpl: async () => jsonResponse({ data: [{ embedding: new Array(1024).fill(0.1) }] }),
    });
    expect(result).toEqual({ ok: true, dim: 1024 });
  });

  it('768 维 ⇒ dimension（**静默降级形态**，不得判成通过）', async () => {
    const result = await probeEmbeddingDimension({
      ...BASE,
      fetchImpl: async () => jsonResponse({ data: [{ embedding: new Array(768).fill(0.1) }] }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('dimension');
      expect(result.detail).toContain('768');
    }
  });

  it('401 / 403 ⇒ unauthorized（凭据不可用）', async () => {
    for (const status of [401, 403]) {
      const result = await probeEmbeddingDimension({
        ...BASE,
        fetchImpl: async () => jsonResponse({ error: { message: 'unauthorized' } }, status),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.kind).toBe('unauthorized');
    }
  });

  it('其他非 2xx ⇒ http', async () => {
    const result = await probeEmbeddingDimension({
      ...BASE,
      fetchImpl: async () => jsonResponse({ error: 'boom' }, 500),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('http');
  });

  it('回体缺 data[0].embedding ⇒ shape（不回体解析失败也要有结论）', async () => {
    const missing = await probeEmbeddingDimension({
      ...BASE,
      fetchImpl: async () => jsonResponse({ data: [] }),
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.kind).toBe('shape');

    const notJson = await probeEmbeddingDimension({
      ...BASE,
      fetchImpl: async () => new Response('not json', { status: 200 }),
    });
    expect(notJson.ok).toBe(false);
    if (!notJson.ok) expect(notJson.kind).toBe('shape');
  });

  it('网络异常 ⇒ network，**不抛出**（交调用方按姿态处置）', async () => {
    const result = await probeEmbeddingDimension({
      ...BASE,
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:443');
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('network');
      expect(result.detail).toContain('ECONNREFUSED');
    }
  });
});

describe('请求形状（照搬 scripts/probes/qwen-verify.sh）', () => {
  it('POST {base}/embeddings · Bearer 头 · body {model,input} · base 尾部斜杠被规整', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ data: [{ embedding: new Array(1024).fill(0) }] });
    }) as unknown as typeof fetch;

    await probeEmbeddingDimension({ ...BASE, baseUrl: 'https://maas.test/v1/', fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://maas.test/v1/embeddings');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer test-key');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: 'qwen3.7-text-embedding',
      input: ['ai-memory embedding probe'],
    });
  });

  it('apiKey 为空 ⇒ 不带 Authorization 头（不伪造凭据）', async () => {
    const calls: Array<RequestInit> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(init);
      return jsonResponse({ data: [{ embedding: new Array(1024).fill(0) }] });
    }) as unknown as typeof fetch;

    await probeEmbeddingDimension({ ...BASE, apiKey: null, fetchImpl });
    expect((calls[0]?.headers as Record<string, string>).authorization).toBeUndefined();
  });
});
