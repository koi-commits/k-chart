const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

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

// 渲染进程已自行存档后调用：退出整个应用
ipcMain.on('quit-app', () => app.quit());

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
