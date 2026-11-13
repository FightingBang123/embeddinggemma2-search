'use strict';
/**
 * 无界面自检：起 llama-server + API，上传 samples、跑检索，然后全部关掉。
 * 用途：验证 Node 侧后端与推理链路，不依赖 Electron 窗口。
 */
const fs = require('node:fs');
const path = require('node:path');

const { resolvePaths, PROJECT_ROOT } = require('../src/main/paths');
const { LlamaServer } = require('../src/main/llama');
const { VectorStore } = require('../src/main/store');
const { createApiServer } = require('../src/main/api');

const RELEASE = path.join(PROJECT_ROOT, 'release');

async function upload(base, file) {
  const name = path.basename(file);
  const body = fs.readFileSync(file);
  const res = await fetch(`${base}/api/documents`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(name) },
    body,
  });
  return res.json();
}

async function search(base, query, extra = {}) {
  const res = await fetch(`${base}/api/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, top_k: 3, dim: 768, mode: 'retrieval', ...extra }),
  });
  return res.json();
}

(async () => {
  const dataDir = path.join(PROJECT_ROOT, 'data', '.selfcheck');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });

  const paths = resolvePaths({
    resources: RELEASE,
    modelDir: path.join(RELEASE, 'models'),
    web: path.join(RELEASE, 'web'),
    data: dataDir,
    logs: path.join(dataDir, 'logs'),
  });

  const llama = new LlamaServer({
    runtimeDir: paths.runtimeDir,
    modelFile: paths.modelFile,
    logsDir: paths.logs,
  });

  console.log('[selfcheck] runtime:', llama.available ? 'found' : 'MISSING', paths.runtimeDir);
  console.log('[selfcheck] model:', fs.existsSync(paths.modelFile) ? 'found' : 'MISSING', paths.modelFile);

  try {
    const t0 = Date.now();
    await llama.start();
    console.log(`[selfcheck] llama ready in ${Date.now() - t0} ms ->`, llama.baseUrl);

    const store = new VectorStore(paths);
    const app = createApiServer({ store, llama, paths, appVersion: '1.0.0-selfcheck', platform: process.platform });
    const port = await app.listen(0);
    const base = `http://127.0.0.1:${port}`;
    console.log('[selfcheck] api at', base);

    for (const file of ['faq.md', 'design-notes.md', 'ratelimit.py']) {
      const out = await upload(base, path.join(PROJECT_ROOT, 'samples', file));
      const r = out.results[0];
      console.log(`  upload ${r.name.padEnd(18)} ok=${r.ok} chunks=${r.chunks} ${r.embed_ms}ms`);
    }

    for (const q of ['忘记密码怎么办', '切块策略怎么设置', 'token bucket 限流']) {
      const out = await search(base, q);
      const top = out.results[0];
      console.log(
        `  search "${q}" -> ${top.score.toFixed(4)} ${top.doc_name}#${top.ord}  (embed ${out.timing.embed_ms}ms / total ${out.timing.total_ms}ms)`,
      );
    }

    const stats = await (await fetch(`${base}/api/stats`)).json();
    const spa = await fetch(`${base}/`);
    const html = await spa.text();
    console.log('  stats:', JSON.stringify(stats));
    console.log(`  spa: status=${spa.status} bytes=${html.length} hasRoot=${html.includes('id="root"')}`);

    await app.close();
    llama.stop();
    console.log('[selfcheck] OK');
    setTimeout(() => process.exit(0), 300);
  } catch (err) {
    console.error('[selfcheck] FAILED:', err.message);
    llama.stop();
    setTimeout(() => process.exit(1), 300);
  }
})();
