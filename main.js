const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    fullscreen: true,
    icon: path.join(__dirname, 'icons', 'icon-256.png'),
    title: 'K-line Simulator',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    backgroundColor: '#1a1a1a'
  });

  mainWindow.on('page-title-updated', (e) => e.preventDefault());
  mainWindow.loadFile('index.html');
}

// ── IPC: 主进程代理 HTTP 请求（绕过渲染进程 CORS 限制） ──
ipcMain.handle('fetch-url', async (_event, url, options) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000); // 10s 超时
    const resp = await fetch(url, {
      ...(options || {}),
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        ...(options?.headers || {})
      }
    });
    clearTimeout(timeout);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    return await resp.text();
  } catch (e) {
    console.error('[fetch-url] Error:', e.message);
    return null;
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
