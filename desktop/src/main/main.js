'use strict';
/**
 * Electron 主进程：拉起 llama-server + 本地 API 服务，再开窗口加载 UI。
 * 开发：`npm start`（内部走 release/web 或 vite dev server）
 * 打包：`npm run dist:*`
 *
 * 启动顺序有两处刻意为之：
 *   1. 先把 userData 换成"真的能写"的目录，再申请单实例锁。
 *      Chromium 的进程单例锁建不出来时会静默退出（退出码 0、无输出），
 *      用户看到的就是"双击没反应"。详见 userdata.js。
 *   2. 立刻弹出启动动画，再去做加载模型这些慢活，用户不会对着空屏等。
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const log = require('./startup-log');
const { chooseUserData } = require('./userdata');

// node:sqlite 在 Node 24 仍标记 experimental，启动时刷一行警告，过滤掉
process.on('warning', (w) => {
  if (w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  console.warn(w);
});

const bootAt = Date.now();
log.begin();
log.log('boot', {
  electron: process.versions.electron,
  node: process.versions.node,
  chrome: process.versions.chrome,
  arch: process.arch,
  packaged: app.isPackaged,
  exe: process.execPath,
  cwd: process.cwd(),
});

// ---------------------------------------------------------------- 用户数据目录
// 必须在 requestSingleInstanceLock() 之前完成。
const exeDir = path.dirname(process.execPath);
let defaultUserData = '';
try {
  defaultUserData = app.getPath('userData');
} catch (err) {
  log.log('getPath(userData) failed:', err.message);
}
const userData = chooseUserData({ preferred: defaultUserData, exeDir });
log.log('userData', {
  default: defaultUserData,
  chosen: userData.dir,
  kind: userData.kind,
  writable: !userData.unwritable,
});
if (userData.dir !== defaultUserData) {
  try {
    app.setPath('userData', userData.dir);
    log.log('userData switched ->', userData.dir, `(${userData.note})`);
  } catch (err) {
    log.log('setPath(userData) failed:', err.message);
  }
}
try {
  // 缓存/会话数据跟着一起走，否则 Chromium 仍会去写默认目录
  app.setPath('sessionData', userData.dir);
} catch (err) {
  log.log('setPath(sessionData) skipped:', err.message);
}

const { resolvePaths } = require('./paths');
const { LlamaServer, resolveBinary } = require('./llama');
const { SqliteStore } = require('./store-sqlite');
const { createApiServer } = require('./api');
const { downloadModel, modelUrl } = require('./download');

let mainWindow = null;
let setupWindow = null;
let splash = null;
let splashLoaded = false;
let splashStage = 'boot';
let splashText = '正在初始化…';
let llama = null;
let api = null;
let paths = null;
let uiUrl = null;

// ---------------------------------------------------------------- 启动动画
function splashWindow() {
  const win = new BrowserWindow({
    width: 470,
    height: 348,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    center: true,
    skipTaskbar: true,
    backgroundColor: '#09090b',
    title: '正在启动 EmbeddingGemma 2',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  win.webContents.once('did-finish-load', () => {
    splashLoaded = true;
    pushSplash();
    // 数据目录被换掉时告诉用户实际位置，别让人以为"数据丢了"
    if (userData.fallback || userData.unwritable) {
      win.webContents.send('splash:notice', { dataDir: userData.dir, fallback: true });
    }
  });
  win.on('closed', () => {
    splash = null;
    splashLoaded = false;
  });
  win.loadFile(path.join(__dirname, '..', 'splash', 'splash.html'));
  return win;
}

function pushSplash() {
  if (!splash || splash.isDestroyed() || !splashLoaded) return;
  splash.webContents.send('splash:status', { stage: splashStage, text: splashText });
}

/** 切换启动阶段：boot → model → index → ui */
function setStage(stage, text) {
  splashStage = stage;
  if (text) splashText = text;
  log.log('stage', stage, splashText);
  pushSplash();
}

function closeSplash() {
  if (!splash) return;
  const win = splash;
  splash = null;
  splashLoaded = false;
  try {
    if (!win.isDestroyed()) win.close();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- 窗口
function revealMain(shownRef) {
  // 让启动动画至少停留一小会儿，避免"闪一下就没了"的观感
  const wait = Math.max(0, 520 - (Date.now() - bootAt));
  setTimeout(() => {
    closeSplash();
    if (shownRef.done) return;
    if (mainWindow && !mainWindow.isDestroyed()) {
      shownRef.done = true;
      mainWindow.show();
      mainWindow.focus();
      log.log('main window shown after', Date.now() - bootAt, 'ms');
    }
  }, wait);
}

function createWindow(url) {
  const shown = { done: false };
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#09090b',
    show: false,
    autoHideMenuBar: true,
    title: 'EmbeddingGemma 2 语义检索',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => revealMain(shown));
  // 兜底：万一 ready-to-show 不触发，也别让用户一直看启动动画
  mainWindow.webContents.once('did-finish-load', () => setTimeout(() => revealMain(shown), 4000));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.log('renderer gone', details && details.reason, details && details.exitCode);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });

  setStage('ui', '正在打开界面…');
  mainWindow.loadURL(url);
  if (process.env.DEBUG_DESKTOP) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 640,
    height: 440,
    resizable: false,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    title: '首次启动 · 准备模型',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setupWindow.once('ready-to-show', () => {
    closeSplash();
    if (setupWindow && !setupWindow.isDestroyed()) setupWindow.show();
  });
  setupWindow.on('closed', () => {
    setupWindow = null;
  });
  setupWindow.loadFile(path.join(__dirname, '..', 'setup', 'setup.html'));
  return setupWindow;
}

// ---------------------------------------------------------------- 启动链路
function resolveAppPaths() {
  const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources');
  const web = app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', '..', '..', 'release', 'web');
  return resolvePaths({
    resources,
    web,
    // 走 app.getPath：上面已经把 userData 换成可写目录，这里自动跟随
    data: path.join(app.getPath('userData'), 'data'),
    logs: path.join(app.getPath('userData'), 'logs'),
  });
}

async function startStack() {
  llama = new LlamaServer({
    runtimeDir: paths.runtimeDir,
    modelFile: paths.modelFile,
    logsDir: paths.logs,
    onEvent: (event) => {
      if (event === 'spawn') setStage('model', '正在加载模型…');
    },
  });

  if (!fs.existsSync(paths.modelFile) || !resolveBinary(paths.runtimeDir)) {
    log.log('model or runtime missing -> setup flow', paths.modelFile, paths.runtimeDir);
    return startSetupFlow();
  }

  setStage('model', '正在加载模型…');
  await llama.start();

  setStage('index', '正在载入本地索引…');
  const store = new SqliteStore(paths);
  api = createApiServer({
    store,
    llama,
    paths,
    appVersion: app.getVersion(),
    platform: process.platform,
  });
  const port = await api.listen(0);
  const url = `http://127.0.0.1:${port}`;
  uiUrl = url;
  log.log('api listening', url);
  createWindow(url);
  return url;
}

function startSetupFlow() {
  const win = createSetupWindow();
  win.webContents.once('did-finish-load', () => {
    const missingRuntime = !resolveBinary(paths.runtimeDir);
    win.webContents.send('setup:state', {
      missingRuntime,
      runtimeDir: paths.runtimeDir,
      modelFile: paths.modelFile,
      modelUrl: modelUrl(),
    });
  });
  return null;
}

ipcMain.handle('setup:download', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  try {
    fs.mkdirSync(paths.modelDir, { recursive: true });
    await downloadModel(paths.modelFile, (progress) => {
      if (!win.isDestroyed()) win.webContents.send('setup:progress', progress);
    });
    if (!win.isDestroyed()) win.webContents.send('setup:done', { ok: true });
  } catch (err) {
    log.log('model download failed:', err.message);
    if (!win.isDestroyed()) win.webContents.send('setup:done', { ok: false, error: err.message });
    return { ok: false, error: err.message };
  }
  return { ok: true };
});

ipcMain.handle('setup:continue', async () => {
  if (setupWindow) {
    setupWindow.close();
    setupWindow = null;
  }
  try {
    await startStack();
  } catch (err) {
    reportFailure('启动失败', err);
  }
});

ipcMain.handle('desktop:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  dataDir: paths ? paths.data : userData.dir,
  modelFile: paths ? paths.modelFile : '',
  packaged: app.isPackaged,
  userDataDir: userData.dir,
  userDataKind: userData.kind,
}));

ipcMain.handle('desktop:openData', () => {
  if (paths) shell.openPath(paths.data);
});

ipcMain.handle('desktop:openLogs', () => {
  if (paths) shell.openPath(paths.logs);
});

function buildMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        { label: '打开数据目录', click: () => paths && shell.openPath(paths.data) },
        { label: '打开日志目录', click: () => paths && shell.openPath(paths.logs) },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    { label: '编辑', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }] },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------- 失败也要看得见
function reportFailure(title, err) {
  const message = err && err.message ? err.message : String(err);
  log.log('FAILED:', err && err.stack ? err.stack : message);
  closeSplash();
  try {
    dialog.showErrorBox(
      title,
      `${message}\n\n` +
        `启动日志：${log.file()}\n` +
        `数据目录：${paths ? paths.data : userData.dir}\n` +
        `运行时：${paths ? paths.runtimeDir : '-'}\n` +
        `模型：${paths ? paths.modelFile : '-'}`,
    );
  } catch {
    /* dialog 也可能失败，日志已经写过了 */
  }
}

process.on('uncaughtException', (err) => reportFailure('启动失败（未捕获异常）', err));
process.on('unhandledRejection', (reason) => reportFailure('启动失败（异步错误）', reason));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.log('another instance is running - exiting');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    // 第一件事就是把启动动画摆出来
    splash = splashWindow();

    try {
      buildMenu();

      setStage('boot', '正在检查运行环境…');
      paths = resolveAppPaths();
      log.log('paths', paths);
      if (userData.unwritable) {
        throw new Error(`没有可写的数据目录（最后尝试：${userData.dir}）`);
      }

      await startStack();
      log.log('startup complete in', Date.now() - bootAt, 'ms');
    } catch (err) {
      reportFailure('启动失败', err);
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length > 0) return;
      // 服务仍在跑（macOS 关窗不退进程）：直接重开窗口，别重复拉起 llama
      if (uiUrl) createWindow(uiUrl);
      else startStack().catch((err) => reportFailure('启动失败', err));
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async () => {
    closeSplash();
    if (llama) llama.stop();
    if (api) await api.close().catch(() => {});
  });
}
