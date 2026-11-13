'use strict';
/** 本地 HTTP 服务：/api/* 业务接口 + 托管前端静态文件。只绑 127.0.0.1。 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const { chunkText, extractText } = require('./chunk');
const { embedTexts, llamaStatus, DIM } = require('./embed');

const MAX_UPLOAD = 25 * 1024 * 1024;
const PREFIXES = {
  retrieval: (q) => `task: search result | query: ${q}`,
  similarity: (q) => `task: sentence similarity | sentence: ${q}`,
  code: (q) => `task: code retrieval | query: ${q}`,
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, status, body) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length });
  res.end(data);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('file too large (25 MB max)'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJson(req) {
  return readBody(req, 2 * 1024 * 1024).then((buf) => {
    try {
      return JSON.parse(buf.toString('utf8') || '{}');
    } catch {
      throw Object.assign(new Error('invalid JSON body'), { status: 400 });
    }
  });
}

function createApiServer({ store, llama, paths, appVersion, platform }) {
  const webRoot = path.resolve(paths.web);

  async function embedOne(text) {
    return embedTexts(llama.baseUrl, [text]);
  }

  async function handleApi(req, res, url) {
    const { pathname } = url;

    if (req.method === 'GET' && pathname === '/api/health') {
      return json(res, 200, {
        ok: true,
        llama: llama.baseUrl ? await llamaStatus(llama.baseUrl) : { ok: false, error: 'not started' },
        stats: {
          documents: store.stats().documents,
          chunks: store.stats().chunks,
          last_ingest: store.listDocuments()[0]?.createdAt ?? null,
        },
        dim: DIM,
        version: appVersion,
        desktop: { platform, dataDir: paths.data, modelDir: paths.modelDir },
      });
    }

    if (req.method === 'GET' && pathname === '/api/stats') {
      return json(res, 200, store.stats());
    }

    if (req.method === 'GET' && pathname === '/api/documents') {
      return json(res, 200, { documents: store.listDocuments() });
    }

    if (req.method === 'POST' && pathname === '/api/documents') {
      const contentType = String(req.headers['content-type'] || '');
      /** @type {{name: string, buffer: Buffer}[]} */
      let incoming = [];

      if (contentType.startsWith('multipart/form-data')) {
        // 浏览器端用 FormData 上传；Node 22 的 Response 能直接解 multipart
        const raw = await readBody(req, MAX_UPLOAD * 8);
        const form = await new Response(raw, { headers: { 'content-type': contentType } }).formData();
        for (const [, value] of form.entries()) {
          if (typeof value === 'string') continue;
          incoming.push({ name: value.name || 'untitled.txt', buffer: Buffer.from(await value.arrayBuffer()) });
        }
      } else {
        const name = decodeURIComponent(req.headers['x-filename'] || 'untitled.txt');
        incoming = [{ name, buffer: await readBody(req, MAX_UPLOAD) }];
      }

      if (!incoming.length) return json(res, 400, { results: [{ name: '-', ok: false, error: 'empty body' }] });

      const results = [];
      for (const item of incoming) {
        const { name, buffer } = item;
        if (!buffer.length) {
          results.push({ name, ok: false, error: 'empty file' });
          continue;
        }
        try {
          const text = await extractText(name, buffer);
          const pieces = chunkText(text);
          if (!pieces.length) {
            results.push({ name, ok: false, error: 'no extractable text' });
            continue;
          }
          const started = Date.now();
          const vectors = await embedTexts(
            llama.baseUrl,
            pieces.map((p) => `title: ${path.parse(name).name} | text: ${p}`),
          );
          const embedMs = Date.now() - started;

          const id = crypto.randomBytes(8).toString('hex');
          const doc = store.addDocument({
            id,
            name,
            suffix: path.extname(name).toLowerCase(),
            size: buffer.length,
            createdAt: new Date().toISOString(),
            chunks: pieces,
            vectors,
          });
          results.push({ name, ok: true, id: doc.id, chunks: doc.chunks, chars: text.length, embed_ms: embedMs });
        } catch (err) {
          results.push({ name, ok: false, error: err.status === 415 ? err.message : String(err.message).slice(0, 200) });
        }
      }
      return json(res, 200, { results });
    }

    const del = /^\/api\/documents\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (req.method === 'DELETE' && del) {
      const ok = store.deleteDocument(del[1]);
      return ok ? json(res, 200, { deleted: del[1] }) : json(res, 404, { detail: 'document not found' });
    }

    if (req.method === 'POST' && pathname === '/api/search') {
      const body = await readJson(req);
      const query = String(body.query || '').trim();
      if (!query) return json(res, 400, { detail: 'query is required' });
      const mode = PREFIXES[body.mode] ? body.mode : 'retrieval';
      const topK = Math.min(Math.max(Number(body.top_k) || 8, 1), 50);
      let dim = Math.min(Math.max(Number(body.dim) || 768, 128), 768);
      dim -= dim % 128;

      const started = Date.now();
      const qvec = await embedTexts(llama.baseUrl, [PREFIXES[mode](query)]);
      const embedMs = Date.now() - started;
      const hits = store.search(qvec, topK, dim, body.doc_ids);

      return json(res, 200, {
        query,
        mode,
        dim,
        results: hits.map((h) => ({
          score: Math.round(h.score * 1e6) / 1e6,
          chunk_id: h.chunkId,
          doc_id: h.docId,
          doc_name: h.docName,
          ord: h.ord,
          text: h.text,
        })),
        timing: { embed_ms: embedMs, total_ms: Date.now() - started },
      });
    }

    return json(res, 404, { detail: 'not found' });
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || !rel) rel = '/index.html';
    const file = path.resolve(webRoot, `.${rel}`);
    if (!file.startsWith(webRoot)) return json(res, 403, { detail: 'forbidden' });

    const send = (target) => {
      const ext = path.extname(target).toLowerCase();
      const stream = fs.createReadStream(target);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      stream.pipe(res);
    };

    if (fs.existsSync(file) && fs.statSync(file).isFile()) return send(file);
    const index = path.join(webRoot, 'index.html');
    if (fs.existsSync(index)) return send(index);
    return json(res, 404, { detail: 'release/web not built (run build\\build.ps1)' });
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const fail = (err) => {
      const status = err.status || 500;
      console.error('[api]', req.method, url.pathname, err.message);
      json(res, status, { detail: err.message });
    };

    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch(fail);
    } else if (req.method === 'GET' || req.method === 'HEAD') {
      try {
        serveStatic(req, res, url);
      } catch (err) {
        fail(err);
      }
    } else {
      json(res, 405, { detail: 'method not allowed' });
    }
  });

  return {
    server,
    listen: (port = 0) =>
      new Promise((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve(server.address().port));
      }),
    close: () =>
      new Promise((resolve) => {
        // fetch/undici 会保持 keep-alive 连接，必须主动断开，否则 close 永远不回调
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

module.exports = { createApiServer };
