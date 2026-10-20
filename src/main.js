const express = require('express');
const path = require('path');
const fs = require('fs');
const { BaiduPanAPI } = require('./baidu-api');
const { Database } = require('./db');
const { ViolationChecker } = require('./violation-checker');
const { DuplicateScanner } = require('./duplicate-scanner');
const { loginSession } = require('./login-browser');

const app = express();
const PORT = process.env.PORT || 37471;

// 获取应用程序基础目录（打包后为exe所在目录）
function getAppDir() {
    // 显式指定数据目录（如 Electron 便携模式）
    if (process.env.CLEANER_DATA_DIR) {
        return process.env.CLEANER_DATA_DIR;
    }
    // pkg 环境下使用 exe 所在目录
    if (process.pkg) {
        return path.dirname(process.execPath);
    }
    return process.cwd();
}

// 数据目录
const dataDir = path.join(getAppDir(), 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// 初始化数据库
const db = new Database(dataDir);

// 存储活跃的API实例
const apiInstances = new Map();

// 存储检测任务
const checkTasks = new Map();

// 存储重复文件扫描任务（进行中）
const dupeTasks = new Map();

// 存储删除任务（违规文件删除 / 重复文件删除共用）
// taskId → { total, processed, deleted, failed, current, done }
const deleteTasks = new Map();

// 通用删除执行器：分批删除 + 失败逐个重试，实时更新进度
async function runDeleteTask(taskId, api, items, onSuccess, onFail) {
    const task = deleteTasks.get(taskId);
    const CHUNK = 50; // 网盘删除接口单批数量
    try {
        for (let i = 0; i < items.length; i += CHUNK) {
            const chunk = items.slice(i, i + CHUNK);
            const result = await api.deleteFiles(chunk.map(it => ({ path: it.path })));
            if (result.success) {
                onSuccess(chunk);
                task.deleted += chunk.length;
            } else {
                // 批量失败 → 逐个重试，定位失败项
                for (const it of chunk) {
                    const single = await api.deleteFiles([{ path: it.path }]);
                    if (single.success) {
                        onSuccess([it]);
                        task.deleted++;
                    } else {
                        onFail(it);
                        task.failed++;
                    }
                    task.current = it.path;
                    task.processed = task.deleted + task.failed;
                    await new Promise(s => setTimeout(s, 300));
                }
            }
            task.processed = task.deleted + task.failed;
            if (i + CHUNK < items.length) {
                await new Promise(s => setTimeout(s, 500));
            }
        }
    } catch (e) {
        task.error = e.message;
    } finally {
        task.done = true;
        task.current = '';
        // 完成后保留 10 分钟供前端查询，之后清理
        setTimeout(() => deleteTasks.delete(taskId), 600000);
    }
}

// 查询删除进度
app.get('/api/delete/progress/:taskId', (req, res) => {
    const task = deleteTasks.get(req.params.taskId);
    if (!task) {
        return res.json({ success: false, message: '任务不存在或已过期' });
    }
    res.json({ success: true, data: task });
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ========== 账号管理 ==========

// 获取账号列表
app.get('/api/accounts', (req, res) => {
    try {
        const accounts = db.getAccounts();
        res.json({ success: true, data: accounts });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 清洗Cookie字符串：去重、去除无效段、去除值两侧的引号
function cleanCookies(raw) {
    const parts = String(raw).split(';').map(s => s.trim()).filter(s => s && s.includes('='));
    const map = new Map();
    for (const p of parts) {
        const i = p.indexOf('=');
        const k = p.slice(0, i).trim();
        if (!k || k.toLowerCase() === 'undefined') continue;
        let v = p.slice(i + 1).trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        map.set(k, v);
    }
    return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ==================== 浏览器自动登录 ====================

// 启动浏览器登录
app.post('/api/login/browser/start', async (req, res) => {
    try {
        const ok = await loginSession.start();
        if (ok) {
            res.json({ success: true, message: '浏览器已打开，请登录百度账号' });
        } else {
            res.json({ success: false, message: loginSession.message });
        }
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 查询登录状态
app.get('/api/login/browser/status', (req, res) => {
    const s = loginSession.getStatus();
    res.json({ success: true, data: s });
});

// 取消登录
app.post('/api/login/browser/cancel', async (req, res) => {
    await loginSession.cancel();
    res.json({ success: true, message: '已取消' });
});

// ==================== 账号管理 ====================

// 添加账号
app.post('/api/accounts', async (req, res) => {
    try {
        const { name, proxy } = req.body;
        let { cookies } = req.body;
        if (!cookies) {
            return res.json({ success: false, message: '请提供Cookies' });
        }

        cookies = cleanCookies(cookies);

        const api = new BaiduPanAPI(cookies, proxy);
        const userInfo = await api.getUserInfo();

        if (!userInfo) {
            return res.json({ success: false, message: 'Cookies无效或登录失败' });
        }

        const bdstoken = await api.getBdstoken();

        // 用数据接口实测会话，避免 loginStatus 宽松校验造成的误判
        const session = await api.validateSession();
        if (!session.valid) {
            return res.json({
                success: false,
                message: `Cookies已失效或不完整（${session.message || '身份验证失败'}）。请退出百度网盘重新登录后，复制完整Cookie（需包含BDUSS、STOKEN、BAIDUID、ndus等）再试`
            });
        }

        const info = userInfo.login_info || userInfo;
        const accountName = name || info.netdisk_name || info.username || '未知用户';

        const accountId = db.addAccount({
            name: accountName,
            cookies: cookies,
            bdstoken: bdstoken || '',
            proxy: proxy || '',
            baidu_name: info.baidu_name || '',
            netdisk_name: info.netdisk_name || '',
            uk: info.uk || ''
        });

        res.json({ success: true, data: { id: accountId, name: accountName, bdstoken } });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 删除账号
app.delete('/api/accounts/:id', (req, res) => {
    try {
        db.deleteAccount(req.params.id);
        apiInstances.delete(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 验证账号
app.post('/api/accounts/:id/verify', async (req, res) => {
    try {
        const account = db.getAccount(req.params.id);
        if (!account) {
            return res.json({ success: false, message: '账号不存在' });
        }

        const api = new BaiduPanAPI(account.cookies, account.proxy);
        const userInfo = await api.getUserInfo();

        if (!userInfo) {
            return res.json({ success: false, message: 'Cookies已失效' });
        }

        const bdstoken = await api.getBdstoken();
        if (bdstoken && bdstoken !== account.bdstoken) {
            db.updateAccount(req.params.id, { bdstoken });
        }

        // 实测数据接口
        const session = await api.validateSession();
        if (!session.valid) {
            return res.json({
                success: false,
                message: `Cookies已失效或不完整（${session.message || '身份验证失败'}），请重新添加账号并粘贴最新的完整Cookie`
            });
        }

        res.json({ 
            success: true, 
            data: { 
                userInfo, 
                bdstoken,
                valid: true 
            } 
        });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 获取API实例
function getApi(accountId) {
    if (apiInstances.has(accountId)) {
        return apiInstances.get(accountId);
    }
    const account = db.getAccount(accountId);
    if (!account) {
        throw new Error('账号不存在');
    }
    const api = new BaiduPanAPI(account.cookies, account.proxy);
    api.bdstoken = account.bdstoken;
    apiInstances.set(accountId, api);
    return api;
}

// ========== 文件操作 ==========

// 获取文件列表
app.get('/api/files', async (req, res) => {
    try {
        const { accountId, dir = '/', page = 1, num = 100, order = 'time', desc = 1 } = req.query;
        const api = getApi(accountId);
        const result = await api.getFileList(dir, page, num, order, desc);
        res.json({ success: true, data: result });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 删除文件
app.post('/api/files/delete', async (req, res) => {
    try {
        const { accountId, filelist, path } = req.body;
        const api = getApi(accountId);
        const result = await api.deleteFiles(filelist, path);
        res.json({ success: true, data: result });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 移动文件
app.post('/api/files/move', async (req, res) => {
    try {
        const { accountId, filelist, destPath } = req.body;
        const api = getApi(accountId);
        const result = await api.moveFiles(filelist, destPath);
        res.json({ success: true, data: result });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 创建文件夹
app.post('/api/files/mkdir', async (req, res) => {
    try {
        const { accountId, path, name } = req.body;
        const api = getApi(accountId);
        const result = await api.createFolder(path, name);
        res.json({ success: true, data: result });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// ========== 和谐文件检测 ==========

// 探测检测接口（/api/download）当前是否可用：登录态 → 取真实文件 → 单次直链请求
app.post('/api/check/probe', async (req, res) => {
    try {
        const { accountId, dir = '/' } = req.body;
        const account = db.getAccount(accountId);
        if (!account) {
            return res.json({ success: false, message: '账号不存在' });
        }
        const api = getApi(accountId);

        // 1) 登录态
        const user = await api.getUserInfo();
        if (!user) {
            return res.json({ success: true, data: { ok: false, message: '登录状态异常，请重新验证账号 Cookies' } });
        }

        // 2) 取探测文件（检测目录下最多 10 个真实文件）
        let probeIds = [];
        try {
            const r = await api.getFileList(dir, 1, 10);
            probeIds = (r.list || []).filter(f => f.isdir !== 1).slice(0, 10).map(f => f.fs_id);
        } catch (e) {
            return res.json({ success: true, data: { ok: false, message: `获取文件列表失败: ${e.message}` } });
        }
        if (probeIds.length === 0) {
            return res.json({ success: true, data: { ok: false, message: '该目录下没有文件可用于探测，请换一个目录' } });
        }

        // 3) 单次调用 download 直链接口
        let r2;
        try {
            r2 = await api.downloadDlink(probeIds);
        } catch (e) {
            return res.json({ success: true, data: { ok: false, message: `直链接口请求异常: ${e.message}` } });
        }

        const e2 = r2.errno;
        if (e2 === 0) {
            const n = (r2.raw && Array.isArray(r2.raw.dlink)) ? r2.raw.dlink.length : 0;
            return res.json({
                success: true,
                data: n > 0
                    ? { ok: true, message: `检测接口正常（${n}/${probeIds.length} 个文件成功获取直链）` }
                    : { ok: true, message: '接口可访问，但本批文件均未返回直链（可能全部违规）' }
            });
        }
        if (e2 === 113) {
            await api.refreshSign().catch(() => {});
            return res.json({ success: true, data: { ok: false, message: '签名已过期，已自动刷新，请再点一次测试' } });
        }
        if ([-7, -8, 112, 429, 414, 31034, 8001].includes(e2)) {
            return res.json({ success: true, data: { ok: false, message: `检测接口被限流 (errno=${e2})，需等待恢复` } });
        }
        if (e2 === -1) {
            return res.json({ success: true, data: { ok: true, message: '接口可访问，但本批含无法获取直链的文件（可能含违规文件）' } });
        }
        return res.json({ success: true, data: { ok: false, message: `接口返回 errno=${e2}（${(r2.raw && r2.raw.errmsg) || '未知错误'}）` } });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 开始检测任务
app.post('/api/check/start', async (req, res) => {
    try {
        const { accountId, dir = '/', includeKeywords = '', excludeKeywords = '', delay = 1000, autoDelete = false, movePath = '' } = req.body;
        const account = db.getAccount(accountId);
        if (!account) {
            return res.json({ success: false, message: '账号不存在' });
        }

        const taskId = Date.now().toString();
        
        // 创建任务记录
        db.addTask({
            taskId,
            accountId,
            dir,
            includeKeywords,
            excludeKeywords,
            status: 'running'
        });

        const checker = new ViolationChecker(account, {
            dir,
            includeKeywords: includeKeywords ? includeKeywords.split(/[,，]/).filter(Boolean) : [],
            excludeKeywords: excludeKeywords ? excludeKeywords.split(/[,，]/).filter(Boolean) : [],
            delay: parseInt(delay) || 1000,
            autoDelete: !!autoDelete,
            movePath: movePath || ''
        });

        checkTasks.set(taskId, checker);

        // 开始检测
        checker.start().then(() => {
            // 检测完成，保存记录
            const results = checker.getResults();
            const progress = checker.getProgress();
            
            results.forEach(item => {
                db.addViolationRecord({
                    accountId,
                    taskId,
                    filename: item.filename,
                    path: item.path,
                    fs_id: item.fs_id,
                    size: item.size,
                    reason: item.reason,
                    status: item.status,
                    is_dir: item.is_dir
                });
            });

            // 更新任务状态
            db.updateTask(taskId, {
                status: 'completed',
                total_files: progress.total,
                checked_files: progress.checked,
                violation_count: progress.violation
            });
        }).catch(err => {
            console.error('检测任务出错:', err);
            db.updateTask(taskId, { status: 'error' });
        });

        res.json({ success: true, data: { taskId } });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 获取检测进度
app.get('/api/check/progress/:taskId', (req, res) => {
    try {
        const checker = checkTasks.get(req.params.taskId);
        if (!checker) {
            return res.json({ success: false, message: '任务不存在' });
        }
        const progress = checker.getProgress();
        const results = checker.getResults();
        res.json({ success: true, data: { progress, results } });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 暂停检测任务
app.post('/api/check/pause/:taskId', (req, res) => {
    try {
        const checker = checkTasks.get(req.params.taskId);
        if (!checker) {
            return res.json({ success: false, message: '任务不存在' });
        }
        checker.pause();
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 恢复检测任务
app.post('/api/check/resume/:taskId', (req, res) => {
    try {
        const checker = checkTasks.get(req.params.taskId);
        if (!checker) {
            return res.json({ success: false, message: '任务不存在' });
        }
        checker.resume();
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 停止检测任务
app.post('/api/check/stop/:taskId', (req, res) => {
    try {
        const taskId = req.params.taskId;
        const checker = checkTasks.get(taskId);
        if (!checker) {
            return res.json({ success: false, message: '任务不存在' });
        }
        checker.stop();
        
        // 保存已有结果
        const results = checker.getResults();
        const progress = checker.getProgress();
        const accountId = checker.account.id;
        
        results.forEach(item => {
            db.addViolationRecord({
                accountId,
                taskId,
                filename: item.filename,
                path: item.path,
                fs_id: item.fs_id,
                size: item.size,
                reason: item.reason,
                status: item.status,
                is_dir: item.is_dir
            });
        });
        
        db.updateTask(taskId, {
            status: 'stopped',
            total_files: progress.total,
            checked_files: progress.checked,
            violation_count: progress.violation
        });
        
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// ========== 和谐文件记录 ==========

// 获取和谐文件记录
app.get('/api/violations', (req, res) => {
    try {
        const { accountId, taskId, keyword, page = 1, pageSize = 50 } = req.query;
        const result = db.getViolationRecords({ accountId, taskId, keyword, page: parseInt(page), pageSize: parseInt(pageSize) });
        res.json({ success: true, data: result });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 删除和谐文件记录
app.delete('/api/violations/:id', (req, res) => {
    try {
        db.deleteViolationRecord(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 批量删除和谐文件记录
app.post('/api/violations/clear', (req, res) => {
    try {
        const { accountId, taskId, onlySuccess } = req.body;
        db.clearViolationRecords({ accountId, taskId, onlySuccess });
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 一键删除违规文件（从百度网盘删除，移入网盘回收站）— 任务式，前端轮询进度
app.post('/api/violations/delete-files', async (req, res) => {
    try {
        const { accountId, ids } = req.body;
        if (!accountId) {
            return res.json({ success: false, message: '请指定账号' });
        }
        const api = getApi(accountId);

        // 待删除记录：指定 ids，否则该账号下全部未删除的违规记录
        let records = db.getAllViolationRecords({ accountId });
        if (Array.isArray(ids) && ids.length > 0) {
            const idSet = new Set(ids.map(String));
            records = records.filter(r => idSet.has(String(r.id)));
        }
        records = records.filter(r => r.status !== 'deleted');

        if (records.length === 0) {
            return res.json({ success: true, data: { taskId: null, deleted: 0, failed: 0, message: '没有待删除的文件' } });
        }

        const taskId = 'del_' + Date.now();
        deleteTasks.set(taskId, { total: records.length, processed: 0, deleted: 0, failed: 0, current: '', done: false });

        runDeleteTask(
            taskId,
            api,
            records.map(r => ({ id: r.id, path: r.path })),
            (chunk) => chunk.forEach(it => db.updateViolationRecord(it.id, { status: 'deleted' })),
            (it) => db.updateViolationRecord(it.id, { status: 'delete_failed' })
        );

        res.json({ success: true, data: { taskId, total: records.length } });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 导出和谐文件记录
app.get('/api/violations/export', (req, res) => {
    try {
        const { accountId, taskId, keyword, format = 'csv' } = req.query;
        const records = db.getAllViolationRecords({ accountId, taskId, keyword });
        
        if (format === 'csv') {
            const header = '文件名,路径,大小,原因,状态,检测时间\n';
            const rows = records.map(r => 
                `"${r.filename}","${r.path}",${r.size},"${r.reason}","${r.status}","${r.created_at}"`
            ).join('\n');
            const csv = '\ufeff' + header + rows;
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename=violations.csv');
            res.send(csv);
        } else {
            res.json({ success: true, data: records });
        }
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// ========== 重复文件扫描 ==========

// 开始扫描
app.post('/api/dupes/scan', (req, res) => {
    try {
        const { accountId, dir = '/' } = req.body;
        const account = db.getAccount(accountId);
        if (!account) {
            return res.json({ success: false, message: '账号不存在' });
        }

        const taskId = Date.now().toString();
        const scanner = new DuplicateScanner(account, { dir });
        dupeTasks.set(taskId, scanner);

        scanner.start()
            .then(() => {
                // 扫完一次性落盘（被停止的不保存）
                if (!scanner.isStopped) {
                    const r = scanner.getResults();
                    scanner.savedScanId = db.addDupeScan({
                        taskId, accountId: account.id, dir,
                        totalFiles: scanner.totalFiles,
                        stats: r.stats, groups: r.groups
                    });
                }
            })
            .catch(e => console.error('重复文件扫描任务出错:', e))
            .finally(() => {
                setTimeout(() => dupeTasks.delete(taskId), 3600000);
            });

        res.json({ success: true, data: { taskId } });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 扫描进度
app.get('/api/dupes/progress/:taskId', (req, res) => {
    try {
        const scanner = dupeTasks.get(req.params.taskId);
        if (!scanner) {
            return res.json({ success: false, message: '任务不存在或已过期' });
        }
        const p = scanner.getProgress();
        res.json({ success: true, data: { ...p, savedScanId: scanner.savedScanId || null } });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 停止扫描
app.post('/api/dupes/stop/:taskId', (req, res) => {
    try {
        const scanner = dupeTasks.get(req.params.taskId);
        if (scanner) scanner.stop();
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 历史扫描列表（不含分组明细）
app.get('/api/dupes/scans', (req, res) => {
    try {
        const { accountId } = req.query;
        res.json({ success: true, data: db.getDupeScans(accountId) });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 单次扫描完整结果（含分组）
app.get('/api/dupes/scans/:id', (req, res) => {
    try {
        const scan = db.getDupeScan(req.params.id);
        if (!scan) {
            return res.json({ success: false, message: '扫描记录不存在' });
        }
        res.json({ success: true, data: scan });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 删除扫描记录
app.delete('/api/dupes/scans/:id', (req, res) => {
    try {
        db.deleteDupeScan(req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 删除选中的重复文件（移入网盘回收站），完成后更新快照中的已删标记 — 任务式
app.post('/api/dupes/delete', async (req, res) => {
    try {
        const { accountId, scanId, paths } = req.body;
        if (!accountId) {
            return res.json({ success: false, message: '请指定账号' });
        }
        if (!Array.isArray(paths) || paths.length === 0) {
            return res.json({ success: false, message: '没有待删除的文件' });
        }

        const api = getApi(accountId);
        const succeeded = [];

        const taskId = 'del_' + Date.now();
        deleteTasks.set(taskId, { total: paths.length, processed: 0, deleted: 0, failed: 0, current: '', done: false });

        runDeleteTask(
            taskId,
            api,
            paths.map(p => ({ path: p })),
            (chunk) => succeeded.push(...chunk.map(it => it.path)),
            () => {}
        ).then(() => {
            if (scanId && succeeded.length > 0) {
                db.markDupeFilesDeleted(scanId, succeeded);
            }
        });

        res.json({ success: true, data: { taskId, total: paths.length } });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// ========== 检测任务历史 ==========

app.get('/api/tasks', (req, res) => {
    try {
        const { accountId } = req.query;
        const tasks = db.getTasks(accountId);
        res.json({ success: true, data: tasks });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// ========== 系统设置 ==========

app.get('/api/settings', (req, res) => {
    try {
        const settings = db.getSettings();
        res.json({ success: true, data: settings });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

app.post('/api/settings', (req, res) => {
    try {
        const { key, value } = req.body;
        db.setSetting(key, value);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, message: e.message });
    }
});

// 启动服务器；port 传 0 时由系统分配随机端口（Electron 模式避免端口冲突）
function startServer(port = PORT) {
    return new Promise((resolve) => {
        const server = app.listen(port, () => {
            const actualPort = server.address().port;
            console.log(`========================================`);
            console.log(`  Netdisk Cleaner - 免费开源版`);
            console.log(`  服务器已启动: http://localhost:${actualPort}`);
            console.log(`  数据目录: ${dataDir}`);
            console.log(`========================================`);
            resolve({ server, port: actualPort });
        });
    });
}

// 直接运行（node src/main.js）时启动并自动打开浏览器；
// 被 Electron require 时由 electron/main.js 调用 startServer 并加载窗口
if (require.main === module) {
    startServer().then(({ port }) => {
        const { exec } = require('child_process');
        exec(`start http://localhost:${port}`, (err) => {
            if (err) console.log('请手动打开浏览器访问: http://localhost:' + port);
        });
    });
}

module.exports = { app, startServer };
