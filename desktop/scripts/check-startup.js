'use strict';
/**
 * 启动链路的静态/单元自检（不起窗口、不连模型）。
 *
 * 守的是几条"一改就容易悄悄坏掉"的约定：
 *   - userData 不可写时必须换目录（否则 Chromium 建不了单例锁，静默退出）；
 *   - 换 userData 必须发生在 requestSingleInstanceLock() 之前；
 *   - 启动动画页面与 preload 通道要对得上；
 *   - 启动器找的主程序名要和打包配置一致。
 *
 * 用法：node desktop/scripts/check-startup.js（或 npm run check:startup）
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { chooseUserData } = require('../src/main/userdata');

const DESKTOP = path.resolve(__dirname, '..');
const MAIN = path.join(DESKTOP, 'src', 'main', 'main.js');
const PRELOAD = path.join(DESKTOP, 'src', 'preload', 'preload.js');
const SPLASH = path.join(DESKTOP, 'src', 'splash', 'splash.html');
const BUILDER = path.join(DESKTOP, 'electron-builder.yml');
const LAUNCHER = path.join(DESKTOP, 'launcher', 'Launcher.cs');

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}

/** 去掉整行注释，避免"文档里提到的名字"被当成代码顺序。 */
function codeOnly(source) {
  return source
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/'));
    })
    .join('\n');
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'eg2-check-'));
const exeDir = path.join(scratch, 'app');
fs.mkdirSync(exeDir, { recursive: true });

console.log('[check] userData 选择');

check('默认目录可写时沿用它', () => {
  const preferred = path.join(scratch, 'userData-ok');
  const choice = chooseUserData({ preferred, exeDir });
  assert.strictEqual(choice.dir, preferred);
  assert.strictEqual(choice.kind, 'default');
  assert.strictEqual(choice.fallback, false);
});

check('默认目录不可写时换到程序目录 userdata', () => {
  // 父级是一个文件 → 目录不可能建出来
  const blocker = path.join(scratch, 'blocker');
  fs.writeFileSync(blocker, 'x');
  const preferred = path.join(blocker, 'nested');
  const choice = chooseUserData({ preferred, exeDir });
  assert.notStrictEqual(choice.dir, preferred);
  assert.strictEqual(choice.kind, 'portable');
  assert.strictEqual(choice.fallback, true);
  assert.ok(choice.dir.startsWith(exeDir), choice.dir);
});

check('程序目录也不可写时退到临时目录', () => {
  const blocker = path.join(scratch, 'blocker2');
  fs.writeFileSync(blocker, 'x');
  const preferred = path.join(blocker, 'nested');
  const lockedExeDir = path.join(blocker, 'app');
  const choice = chooseUserData({ preferred, exeDir: lockedExeDir });
  assert.ok(choice.kind === 'temp' || choice.kind === 'os-temp', choice.kind);
  assert.ok(choice.dir.includes('embeddinggemma2-'), choice.dir);
});

console.log('[check] 主进程顺序');

check('setPath(userData) 在 requestSingleInstanceLock 之前', () => {
  const src = codeOnly(fs.readFileSync(MAIN, 'utf8'));
  const setPath = src.indexOf("app.setPath('userData'");
  const lock = src.indexOf('app.requestSingleInstanceLock(');
  assert.ok(setPath > 0, '没有找到 app.setPath(userData)');
  assert.ok(lock > 0, '没有找到 app.requestSingleInstanceLock');
  assert.ok(setPath < lock, 'userData 必须在申请单实例锁之前换好');
});

check('主进程会先弹启动动画再做重活', () => {
  const src = codeOnly(fs.readFileSync(MAIN, 'utf8'));
  const splash = src.indexOf('splash = splashWindow(');
  assert.ok(splash > 0, '没有找到 splashWindow()');
  const stack = src.indexOf('await startStack();', splash);
  assert.ok(stack > splash, '启动动画应在 startStack 之前创建');
});

console.log('[check] 启动动画页面');

check('splash.html 有四个阶段与状态通道', () => {
  const html = fs.readFileSync(SPLASH, 'utf8');
  for (const stage of ['boot', 'model', 'index', 'ui']) {
    assert.ok(html.includes(`data-stage="${stage}"`), `缺少阶段 ${stage}`);
  }
  assert.ok(html.includes('onStatus'), '缺少 onStatus 订阅');
  assert.ok(html.includes('animation'), '缺少动画定义');
});

check('preload 暴露 splash.onStatus/onNotice', () => {
  const src = fs.readFileSync(PRELOAD, 'utf8');
  assert.ok(src.includes("ipcRenderer.on('splash:status'"), '缺少 splash:status');
  assert.ok(src.includes("ipcRenderer.on('splash:notice'"), '缺少 splash:notice');
});

check('主进程发送 splash:status / splash:notice', () => {
  const src = fs.readFileSync(MAIN, 'utf8');
  assert.ok(src.includes("send('splash:status'"), '没有发送 splash:status');
  assert.ok(src.includes("send('splash:notice'"), '没有发送 splash:notice');
});

console.log('[check] 打包/启动器约定');

check('启动器找的主程序名与 electron-builder 一致', () => {
  const cs = fs.readFileSync(LAUNCHER, 'utf8');
  const yml = fs.readFileSync(BUILDER, 'utf8');
  const m = cs.match(/CoreExe\s*=\s*"([^"]+)"/);
  assert.ok(m, 'Launcher.cs 里没有 CoreExe 常量');
  assert.ok(
    yml.includes(`executableName: ${path.parse(m[1]).name}`),
    `打包配置的 executableName 应等于 ${path.parse(m[1]).name}`,
  );
});

check('打包配置包含两个启动器入口', () => {
  const yml = fs.readFileSync(BUILDER, 'utf8');
  assert.ok(yml.includes('to: EmbeddingGemma2.exe'), '缺少 EmbeddingGemma2.exe');
  assert.ok(yml.includes('to: EmbeddingGemma2App.exe'), '缺少 EmbeddingGemma2App.exe');
});

fs.rmSync(scratch, { recursive: true, force: true });

console.log(failed === 0 ? '[check] OK' : `[check] ${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
