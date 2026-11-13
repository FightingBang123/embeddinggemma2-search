'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  info: () => ipcRenderer.invoke('desktop:info'),
  openData: () => ipcRenderer.invoke('desktop:openData'),
  openLogs: () => ipcRenderer.invoke('desktop:openLogs'),

  setup: {
    onState: (cb) => ipcRenderer.on('setup:state', (_e, state) => cb(state)),
    onProgress: (cb) => ipcRenderer.on('setup:progress', (_e, p) => cb(p)),
    onDone: (cb) => ipcRenderer.on('setup:done', (_e, r) => cb(r)),
    download: () => ipcRenderer.invoke('setup:download'),
    continue: () => ipcRenderer.invoke('setup:continue'),
  },
});
