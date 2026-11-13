'use strict';
/** 首次启动：下载 GGUF 到 userData（带进度、断点续传可后续加）。 */
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const REPO = process.env.MODEL_REPO || 'unsloth/embeddinggemma-2-GGUF';
const FILE = process.env.MODEL_FILE || 'embeddinggemma-2-Q8_0.gguf';
const MIRROR = process.env.HF_MIRROR || 'https://hf-mirror.com';

function modelUrl() {
  return process.env.MODEL_URL || `${MIRROR}/${REPO}/resolve/main/${FILE}`;
}

function download(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too many redirects'));
    const req = https.get(url, { headers: { 'User-Agent': 'embeddinggemma2-desktop' } }, (res) => {
      const { statusCode, headers } = res;

      if (statusCode >= 300 && statusCode < 400 && headers.location) {
        res.resume();
        const next = new URL(headers.location, url).toString();
        return download(next, dest, onProgress, redirects + 1).then(resolve, reject);
      }
      if (statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${statusCode} for ${url}`));
      }

      const total = Number(headers['content-length'] || 0);
      let received = 0;
      const tmp = `${dest}.part`;
      const out = fs.createWriteStream(tmp);

      res.on('data', (chunk) => {
        received += chunk.length;
        onProgress({
          received,
          total,
          percent: total ? Math.round((received / total) * 1000) / 10 : null,
        });
      });
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          fs.rename(tmp, dest, (err) => (err ? reject(err) : resolve({ bytes: received })));
        });
      });
      out.on('error', reject);
      res.on('error', reject);
    });

    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('download timeout')));
  });
}

async function downloadModel(dest, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const url = modelUrl();
  console.log('[download]', url, '->', dest);
  return download(url, dest, onProgress);
}

module.exports = { downloadModel, modelUrl };
