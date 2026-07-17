/* preload.js — 桥接渲染进程和主进程，安全暴露 IPC */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('marketAPI', {
  fetch: (url, options) => ipcRenderer.invoke('fetch-url', url, options),
  fetchJSON: async (url) => {
    const raw = await ipcRenderer.invoke('fetch-url', url, null);
    return JSON.parse(raw);
  }
});
