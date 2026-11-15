'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// preload 同时服务三个页面：主窗口、首次启动向导、启动动画。
// 只放行明确需要的通道，Node 能力一概不暴露。

// 原生菜单只维护一个转发器，渲染进程重复挂载（StrictMode / 热更新）不会堆积监听。
// 窗口刚加载完时菜单动作可能先到，先存一条，等渲染进程挂上再补发。
let menuHandler = null;
let pendingMenu = null;
ipcRenderer.on('app:menu', (_e, payload) => {
  if (menuHandler) menuHandler(payload);
  else pendingMenu = payload;
});

contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  openData: () => ipcRenderer.invoke('desktop:openData'),
  openLogs: () => ipcRenderer.invoke('desktop:openLogs'),
  toggleFullscreen: () => ipcRenderer.invoke('desktop:toggleFullscreen'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  onMenu: (cb) => {
    menuHandler = cb;
    if (pendingMenu) {
      const payload = pendingMenu;
      pendingMenu = null;
      cb(payload);
    }
  },
  offMenu: () => {
    menuHandler = null;
  },

  splash: {
    onStatus: (cb) => ipcRenderer.on('splash:status', (_e, payload) => cb(payload)),
    onNotice: (cb) => ipcRenderer.on('splash:notice', (_e, payload) => cb(payload)),
  },

  setup: {
    onState: (cb) => ipcRenderer.on('setup:state', (_e, state) => cb(state)),
    onProgress: (cb) => ipcRenderer.on('setup:progress', (_e, p) => cb(p)),
    onDone: (cb) => ipcRenderer.on('setup:done', (_e, r) => cb(r)),
    download: () => ipcRenderer.invoke('setup:download'),
    continue: () => ipcRenderer.invoke('setup:continue'),
  },
});