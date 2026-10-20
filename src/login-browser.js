/**
 * 浏览器自动登录模块
 * 打开本机 Edge/Chrome 显示百度登录页，登录完成后自动抓取完整 Cookie
 * （包含 ndus 等手动复制容易遗漏的关键凭证）
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

// 登录用的独立浏览器数据目录
// 注意：打包后 __dirname 位于 asar/pkg 快照内（虚拟路径，外部进程不可写），
// 必须解析到真实可写目录，否则浏览器进程启动即失败
function getLoginProfileDir() {
    if (process.env.CLEANER_DATA_DIR) {
        return path.join(process.env.CLEANER_DATA_DIR, 'data', 'login-profile');
    }
    if (process.pkg) {
        return path.join(path.dirname(process.execPath), 'data', 'login-profile');
    }
    return path.join(__dirname, '..', 'data', 'login-profile');
}

// 查找本机可用的浏览器
function findBrowser() {
    const candidates = [
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe'),
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    ].filter(Boolean);

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class BrowserLoginSession {
    constructor() {
        this.browser = null;
        this.status = 'idle'; // idle | waiting | success | failed | cancelled
        this.message = '';
        this.cookies = '';
        this.timer = null;
        this.startedAt = 0;
        this.finalizing = false;
    }

    async start() {
        this.cleanupTimer();
        await this.closeBrowser();

        const executablePath = findBrowser();
        if (!executablePath) {
            this.status = 'failed';
            this.message = '未找到 Edge 或 Chrome 浏览器';
            return false;
        }

        this.status = 'waiting';
        this.message = '请在打开的浏览器窗口中登录百度账号';
        this.cookies = '';
        this.startedAt = Date.now();
        this.finalizing = false;

        try {
            this.browser = await puppeteer.launch({
                executablePath,
                headless: false,
                defaultViewport: null,
                args: [
                    '--start-maximized',
                    '--disable-blink-features=AutomationControlled',
                    // 使用独立用户数据目录，不影响日常浏览器
                    `--user-data-dir=${getLoginProfileDir()}`
                ]
            });

            const pages = await this.browser.pages();
            this.page = pages[0] || await this.browser.newPage();
            await this.page.goto('https://pan.baidu.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

            // 浏览器被用户手动关闭时
            this.browser.on('disconnected', () => {
                if (this.status === 'waiting') {
                    this.status = 'cancelled';
                    this.message = '浏览器窗口已关闭';
                    this.cleanupTimer();
                }
            });

            // 轮询检测登录完成
            this.timer = setInterval(() => this.checkLogin(), 2000);
            return true;
        } catch (e) {
            this.status = 'failed';
            this.message = '启动浏览器失败: ' + e.message;
            await this.closeBrowser();
            return false;
        }
    }

    // 抓取所有百度域 Cookie
    async harvestCookies() {
        const client = await this.page.createCDPSession();
        try {
            const { cookies } = await client.send('Network.getAllCookies');
            const map = new Map();
            for (const c of cookies) {
                if (c.domain && c.domain.includes('baidu.com') && c.name) {
                    map.set(c.name, c.value);
                }
            }
            return map;
        } finally {
            await client.detach().catch(() => {});
        }
    }

    async checkLogin() {
        if (this.status !== 'waiting' || this.finalizing) return;

        // 超时 5 分钟
        if (Date.now() - this.startedAt > 5 * 60 * 1000) {
            this.status = 'failed';
            this.message = '登录超时（5分钟）';
            this.cleanupTimer();
            await this.closeBrowser();
            return;
        }

        try {
            if (!this.browser || !this.browser.connected) return;

            const jar = await this.harvestCookies();
            if (!jar.has('BDUSS') || !jar.get('BDUSS')) return;

            // 检测到登录，进入收尾流程（只执行一次）
            this.finalizing = true;
            this.cleanupTimer();
            this.message = '登录成功，正在获取网盘凭证...';
            await this.finalize(jar);
        } catch (e) {
            // 页面导航中可能报错，忽略继续轮询
        }
    }

    async finalize(jar) {
        try {
            // 访问一次网盘主页，让 pan.baidu.com 域下发 ndus 等 cookie
            const url = this.page.url();
            if (!url.includes('pan.baidu.com/disk')) {
                await this.page.goto('https://pan.baidu.com/disk/main', {
                    waitUntil: 'networkidle2',
                    timeout: 45000
                }).catch(() => {});
            }

            // 最多等 15 秒让 ndus 写入（不刷新页面，只轮询）
            let cookies = jar;
            for (let i = 0; i < 15; i++) {
                await sleep(1000);
                try {
                    cookies = await this.harvestCookies();
                    if (cookies.has('ndus') || cookies.has('csrfToken')) break;
                } catch (e) {}
            }

            this.cookies = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
            this.status = 'success';
            this.message = '登录成功';

            // 成功后延迟关闭浏览器
            setTimeout(() => this.closeBrowser(), 1500);
        } catch (e) {
            // 即使收尾失败，也用已有cookie尝试
            this.cookies = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
            this.status = 'success';
            this.message = '登录成功';
            setTimeout(() => this.closeBrowser(), 1500);
        }
    }

    cleanupTimer() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    async closeBrowser() {
        try {
            if (this.browser && this.browser.connected) {
                await this.browser.close();
            }
        } catch (e) {}
        this.browser = null;
        this.page = null;
    }

    async cancel() {
        this.cleanupTimer();
        if (this.status === 'waiting') {
            this.status = 'cancelled';
            this.message = '已取消';
        }
        await this.closeBrowser();
    }

    getStatus() {
        return {
            status: this.status,
            message: this.message,
            cookies: this.status === 'success' ? this.cookies : ''
        };
    }
}

// 单例
const loginSession = new BrowserLoginSession();

module.exports = { loginSession };
