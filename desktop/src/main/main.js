'use strict';
/**
 * Electron 主进程：拉起 llama-server + 本地 API 服务，再开窗口加载 UI。
 * 开发：`npm start`（内部走 release/web 或 vite dev server）
 * 打包：`npm run dist:*`
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const { resolvePaths } = require('./paths');
const { LlamaServer, resolveBinary } = require('./llama');
const { VectorStore } = require('./store');
const { createApiServer } = require('./api');
const { downloadModel, modelUrl } = require('./download');

const isDev = !app.isPackaged;
let mainWindow = null;
let setupWindow = null;
let llama = null;
let api = null;
let paths = null;
let uiUrl = null;

function resolveAppPaths() {
  const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..', 'resources');
  const web = app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.join(__dirname, '..', '..', '..', 'release', 'web');
  return resolvePaths({
    resources,
    web,
    data: path.join(app.getPath('userData'), 'data'),
    logs: path.join(app.getPath('userData'), 'logs'),
  });
}

function createWindow(url) {
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

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });

  mainWindow.loadURL(url);
  if (process.env.DEBUG_DESKTOP) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 640,
    height: 420,
    resizable: false,
    backgroundColor: '#09090b',
    autoHideMenuBar: true,
    title: '首次启动 · 准备模型',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  setupWindow.loadFile(path.join(__dirname, '..', 'setup', 'setup.html'));
  return setupWindow;
}

async function startStack() {
  llama = new LlamaServer({
    runtimeDir: paths.runtimeDir,
    modelFile: paths.modelFile,
    logsDir: paths.logs,
  });

  if (!fs.existsSync(paths.modelFile) || !resolveBinary(paths.runtimeDir)) {
    return startSetupFlow();
  }

  await llama.start();
  const store = new VectorStore(paths);
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
  console.log('[app] ui at', url);
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
  await startStack();
});

ipcMain.handle('desktop:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
  arch: process.arch,
  dataDir: paths ? paths.data : '',
  modelFile: paths ? paths.modelFile : '',
  packaged: app.isPackaged,
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

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    paths = resolveAppPaths();
    console.log('[app] paths', paths);
    buildMenu();
    try {
      await startStack();
    } catch (err) {
      console.error('[app] startup failed', err);
      dialog.showErrorBox(
        '启动失败',
        `${err.message}\n\n日志：${paths.logs}\n运行时：${paths.runtimeDir}\n模型：${paths.modelFile}`,
      );
      app.quit();
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length > 0) return;
      // 服务仍在跑（macOS 关窗不退进程）：直接重开窗口，别重复拉起 llama
      if (uiUrl) createWindow(uiUrl);
      else startStack();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', async () => {
    if (llama) llama.stop();
    if (api) await api.close().catch(() => {});
  });
}
