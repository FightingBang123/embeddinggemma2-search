'use strict';
/** llama-server /v1/embeddings 客户端：批量、L2 归一化，返回 Float32Array(n*768)。 */
const DIM = 768;
const BATCH = 16;

async function embedTexts(baseUrl, texts, { model = 'embeddinggemma2', timeoutMs = 180000 } = {}) {
  if (!texts.length) return new Float32Array(0);
  const out = new Float32Array(texts.length * DIM);

  for (let start = 0; start < texts.length; start += BATCH) {
    const batch = texts.slice(start, start + BATCH);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let payload;
    try {
      const res = await fetch(`${baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: batch, encoding_format: 'float' }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`embedding failed: HTTP ${res.status}`);
      payload = await res.json();
    } finally {
      clearTimeout(timer);
    }

    const rows = [...payload.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    rows.forEach((row, i) => {
      const vec = row.embedding;
      if (vec.length !== DIM) throw new Error(`unexpected embedding dimension: ${vec.length}`);
      let norm = 0;
      for (let d = 0; d < DIM; d += 1) norm += vec[d] * vec[d];
      norm = Math.sqrt(norm) || 1;
      const base = (start + i) * DIM;
      for (let d = 0; d < DIM; d += 1) out[base + d] = vec[d] / norm;
    });
  }
  return out;
}

async function llamaStatus(baseUrl) {
  try {
    const health = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    const models = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
    const data = await models.json();
    const first = (data.data && data.data[0]) || {};
    const meta = first.meta || {};
    return {
      ok: health.ok,
      url: baseUrl,
      name: first.id,
      params: meta.n_params,
      quant: meta.ftype,
      n_ctx: meta.n_ctx,
    };
  } catch (err) {
    return { ok: false, url: baseUrl, error: String(err && err.message ? err.message : err).slice(0, 200) };
  }
}

module.exports = { embedTexts, llamaStatus, DIM };
