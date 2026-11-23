/* preload.js — 向渲染进程暴露最小的桌面能力（contextIsolation: true，渲染进程没有 Node 权限）
   游戏不联网、不抓取真实数据。 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gameAPI', {
  // 退出应用（调用前由界面先存档）
  quit: () => ipcRenderer.send('quit-app'),
  // 弹出系统保存对话框并写文件 → {ok, path} | {ok:false, canceled} | {ok:false, error}
  saveRecord: (filename, content) => ipcRenderer.invoke('save-record', { filename, content })
});
