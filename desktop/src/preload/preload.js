'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// preload 同时服务三个页面：主窗口、首次启动向导、启动动画。
// 只放行明确需要的通道，Node 能力一概不暴露。
contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  openData: () => ipcRenderer.invoke('desktop:openData'),
  openLogs: () => ipcRenderer.invoke('desktop:openLogs'),

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