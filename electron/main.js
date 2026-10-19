const { app, BrowserWindow } = require('electron');
const path = require('path');

// 便携模式：数据目录跟随 exe（打包后）或项目目录（开发时），与网页版同样「数据不出机」
if (app.isPackaged) {
    process.env.CLEANER_DATA_DIR = path.dirname(app.getPath('exe'));
} else {
    process.env.CLEANER_DATA_DIR = app.getAppPath();
}

const { startServer } = require('../src/main');

let mainWindow = null;

async function createWindow() {
    // 端口 0 = 系统随机分配，避免与已运行的网页版实例冲突
    const { port } = await startServer(0);

    mainWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        minWidth: 960,
        minHeight: 640,
        autoHideMenuBar: true,
        title: 'Netdisk Cleaner',
        backgroundColor: '#0f1420',
        webPreferences: {
            // 页面只需访问本地 Express，不开 Node 集成
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadURL(`http://localhost:${port}`);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(createWindow);

// 所有窗口关闭即退出（Windows 下不驻留）
app.on('window-all-closed', () => {
    app.quit();
});
