'use strict';
/**
 * 路径解析：既能在 Electron 里跑（main 会注入 env），也能被 node 脚本单测。
 */
const path = require('node:path');
const fs = require('node:fs');

const DESKTOP_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(DESKTOP_ROOT, '..');

function resolvePaths(overrides = {}) {
  const resources =
    overrides.resources || process.env.APP_RESOURCES || path.join(DESKTOP_ROOT, 'resources');
  const data = overrides.data || process.env.APP_DATA || path.join(PROJECT_ROOT, 'data');
  const web = overrides.web || process.env.APP_WEB || path.join(PROJECT_ROOT, 'release', 'web');
  const logs = overrides.logs || process.env.APP_LOGS || path.join(data, 'logs');

  // 模型优先级：显式指定 > 随包 resources/models > 用户数据目录
  const bundledModels = path.join(resources, 'models');
  const hasBundled = fs.existsSync(path.join(bundledModels, 'embeddinggemma-2-Q8_0.gguf'));
  const modelDir =
    overrides.modelDir || process.env.APP_MODELS || (hasBundled ? bundledModels : path.join(data, 'models'));

  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(logs, { recursive: true });

  return {
    projectRoot: PROJECT_ROOT,
    desktopRoot: DESKTOP_ROOT,
    resources,
    data,
    web,
    logs,
    // 与服务器端同名同结构：两种形态可共用/互换同一个 app.db
    dbFile: path.join(data, 'app.db'),
    indexFile: path.join(data, 'index.json'),
    vectorsFile: path.join(data, 'vectors.f32'),
    chunksFile: path.join(data, 'chunks.jsonl'),
    modelDir,
    modelFile: path.join(modelDir, 'embeddinggemma-2-Q8_0.gguf'),
    runtimeDir: overrides.runtimeDir || process.env.APP_RUNTIME || path.join(resources, 'runtime'),
  };
}

module.exports = { resolvePaths, DESKTOP_ROOT, PROJECT_ROOT };
