#!/usr/bin/env node
/**
 * 下载当前平台的 llama.cpp 预编译运行时（并可顺带下模型）到 desktop/resources。
 *   node scripts/fetch-runtime.mjs            # 运行时
 *   node scripts/fetch-runtime.mjs --with-model
 *   LLAMA_BUILD=b12364 node scripts/fetch-runtime.mjs --force
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(HERE, '..');
const RESOURCES = path.join(DESKTOP, 'resources');
const CACHE = path.resolve(DESKTOP, '..', 'build', 'cache');
const args = new Set(process.argv.slice(2));
const force = args.has('--force');

const MODEL_REPO = 'unsloth/embeddinggemma-2-GGUF';
const MODEL_FILE = 'embeddinggemma-2-Q8_0.gguf';
const MIRROR = process.env.HF_MIRROR || 'https://hf-mirror.com';

function target() {
  const { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64') {
    return { asset: 'win-vulkan-x64.zip', subdir: 'vulkan', kind: 'zip' };
  }
  if (platform === 'linux' && arch === 'x64') {
    return { asset: 'ubuntu-vulkan-x64.tar.gz', subdir: 'vulkan', kind: 'tar' };
  }
  if (platform === 'linux' && arch === 'arm64') {
    return { asset: 'ubuntu-arm64.tar.gz', subdir: 'cpu', kind: 'tar' };
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return { asset: 'macos-arm64.tar.gz', subdir: 'metal', kind: 'tar' };
  }
  if (platform === 'darwin' && arch === 'x64') {
    return { asset: 'macos-x64.tar.gz', subdir: 'metal', kind: 'tar' };
  }
  throw new Error(`unsupported platform: ${platform}/${arch}`);
}

async function latestBuild() {
  if (process.env.LLAMA_BUILD) return process.env.LLAMA_BUILD;
  const res = await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases?per_page=10', {
    headers: { 'user-agent': 'embeddinggemma2-desktop' },
  });
  const releases = await res.json();
  for (const rel of releases) {
    if ((rel.assets || []).some((a) => /bin-win-vulkan-x64|bin-ubuntu-vulkan-x64/.test(a.name))) {
      return rel.tag_name;
    }
  }
  throw new Error('could not find a llama.cpp release with binaries');
}

async function download(url, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0 && !force) {
    console.log('[skip] cached', path.basename(dest));
    return dest;
  }
  console.log('[get ]', url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const total = Number(res.headers.get('content-length') || 0);
  let got = 0;
  const out = fs.createWriteStream(dest + '.part');
  for await (const chunk of res.body) {
    got += chunk.length;
    out.write(chunk);
    if (total) process.stdout.write(`\r        ${((got / total) * 100).toFixed(1)}%  ${(got / 1e6).toFixed(1)} MB`);
  }
  await new Promise((r) => out.end(r));
  fs.renameSync(dest + '.part', dest);
  console.log('\r        done', (got / 1e6).toFixed(1), 'MB');
  return dest;
}

function prune(dir) {
  // 只保留 llama-server 与它的依赖库：其余 CLI/bench/quantize 约占 60 MB
  let removed = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const name = entry.name;
    const isLib = /\.(dll|so|dylib)$/i.test(name) || name.includes('.so.');
    const isServer = /^llama-server/i.test(name);
    const isMeta = /\.(json|txt|md)$/i.test(name) || /^LICENSE/i.test(name);
    if (isLib || isServer || isMeta) continue;
    fs.rmSync(path.join(dir, name), { force: true });
    removed += 1;
  }
  if (removed) console.log(`[prune] removed ${removed} extra binaries`);
}

function extract(archive, dest, kind) {
  fs.mkdirSync(dest, { recursive: true });
  if (kind === 'zip') {
    execFileSync('tar', ['-xf', archive, '-C', dest], { stdio: 'inherit' });
  } else {
    execFileSync('tar', ['-xzf', archive, '-C', dest], { stdio: 'inherit' });
  }
  // 某些 tar 包会自带一层顶层目录，摊平它
  const entries = fs.readdirSync(dest);
  if (entries.length === 1) {
    const only = path.join(dest, entries[0]);
    if (fs.statSync(only).isDirectory()) {
      for (const child of fs.readdirSync(only)) {
        fs.renameSync(path.join(only, child), path.join(dest, child));
      }
      fs.rmdirSync(only);
    }
  }
  prune(dest);
}

(async () => {
  const t = target();
  const build = await latestBuild();
  console.log(`[info] platform=${process.platform}/${process.arch} build=${build} asset=${t.asset}`);

  const assetName = `llama-${build}-bin-${t.asset}`;
  const archive = await download(
    `https://github.com/ggml-org/llama.cpp/releases/download/${build}/${assetName}`,
    path.join(CACHE, assetName),
  );

  const runtimeDir = path.join(RESOURCES, 'runtime', t.subdir);
  if (fs.existsSync(runtimeDir) && force) fs.rmSync(runtimeDir, { recursive: true, force: true });
  extract(archive, runtimeDir, t.kind);
  console.log('[ok  ] runtime ->', runtimeDir);

  if (args.has('--with-model')) {
    const modelUrl = `${MIRROR}/${MODEL_REPO}/resolve/main/${MODEL_FILE}`;
    await download(modelUrl, path.join(RESOURCES, 'models', MODEL_FILE));
    console.log('[ok  ] model ->', path.join(RESOURCES, 'models', MODEL_FILE));
  }
})().catch((err) => {
  console.error('[fail]', err.message);
  process.exit(1);
});
