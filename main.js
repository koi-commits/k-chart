const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    icon: path.join(__dirname, 'icons', 'icon-256.png'),
    title: 'K线策略游戏',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1a1a1a'
  });

  mainWindow.removeMenu(); // 去掉默认菜单栏（Windows/Linux），保留系统标题栏与关闭按钮
  mainWindow.on('page-title-updated', (e) => e.preventDefault());

  // F11 切换全屏；全屏时 Esc 退出全屏
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    } else if (input.key === 'Escape' && mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
      event.preventDefault();
    }
  });

  mainWindow.loadFile('index.html');
}

// 导出试玩记录：弹出系统保存对话框（默认目录="下载"文件夹，默认文件名由界面给出），用户选定后写入文件。
// 只会写入用户在对话框里亲自选定的路径；渲染进程不能指定路径。
ipcMain.handle('save-record', async (event, payload) => {
  try {
    const content = payload && payload.content;
    if (typeof content !== 'string' || content.length > 20 * 1024 * 1024) return { ok: false, error: '内容无效' };
    let name = path.basename(String((payload && payload.filename) || 'kline-game-record.json'));
    if (!/\.json$/i.test(name)) name += '.json';
    const win = BrowserWindow.fromWebContents(event.sender);
    const res = await dialog.showSaveDialog(win, {
      title: '导出本局记录',
      defaultPath: path.join(app.getPath('downloads'), name),
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    await fs.promises.writeFile(res.filePath, content, 'utf8');
    return { ok: true, path: res.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// 渲染进程已自行存档后调用：退出整个应用
ipcMain.on('quit-app', () => app.quit());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
