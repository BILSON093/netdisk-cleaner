const fs = require('fs');
const path = require('path');

// 违规记录通用过滤：账号 / 任务 / 关键词（文件名或路径，不区分大小写）
function filterViolationRecords(records, { accountId, taskId, keyword } = {}) {
    let result = [...records];
    if (accountId) {
        result = result.filter(r => r.account_id == accountId);
    }
    if (taskId) {
        result = result.filter(r => r.task_id == taskId);
    }
    if (keyword) {
        const kw = String(keyword).toLowerCase();
        result = result.filter(r =>
            (r.filename || '').toLowerCase().includes(kw) ||
            (r.path || '').toLowerCase().includes(kw)
        );
    }
    result.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return result;
}

class AppDatabase {
    constructor(dataDir) {
        this.dataDir = dataDir;
        this.dbFile = path.join(dataDir, 'data.json');
        this.data = {
            accounts: [],
            violationRecords: [],
            checkTasks: [],
            dupeScans: [],
            settings: {},
            nextAccountId: 1,
            nextRecordId: 1,
            nextTaskId: 1,
            nextDupeScanId: 1
        };
        this.load();
    }

    load() {
        try {
            if (fs.existsSync(this.dbFile)) {
                const content = fs.readFileSync(this.dbFile, 'utf-8');
                const parsed = JSON.parse(content);
                this.data = { ...this.data, ...parsed };
            }
        } catch (e) {
            console.error('加载数据失败:', e.message);
        }
    }

    save() {
        try {
            fs.writeFileSync(this.dbFile, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch (e) {
            console.error('保存数据失败:', e.message);
        }
    }

    // ========== 账号管理 ==========

    getAccounts() {
        return this.data.accounts.map(a => ({
            id: a.id,
            name: a.name,
            baidu_name: a.baidu_name,
            netdisk_name: a.netdisk_name,
            uk: a.uk,
            proxy: a.proxy,
            bdstoken: a.bdstoken,
            created_at: a.created_at,
            updated_at: a.updated_at
        })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }

    getAccount(id) {
        return this.data.accounts.find(a => a.id == id) || null;
    }

    addAccount(account) {
        const now = new Date().toISOString();
        const newAccount = {
            id: this.data.nextAccountId++,
            name: account.name,
            cookies: account.cookies,
            bdstoken: account.bdstoken || '',
            proxy: account.proxy || '',
            baidu_name: account.baidu_name || '',
            netdisk_name: account.netdisk_name || '',
            uk: account.uk || '',
            created_at: now,
            updated_at: now
        };
        this.data.accounts.push(newAccount);
        this.save();
        return newAccount.id;
    }

    updateAccount(id, data) {
        const account = this.data.accounts.find(a => a.id == id);
        if (account) {
            Object.assign(account, data);
            account.updated_at = new Date().toISOString();
            this.save();
        }
        return account;
    }

    deleteAccount(id) {
        this.data.violationRecords = this.data.violationRecords.filter(r => r.account_id != id);
        this.data.checkTasks = this.data.checkTasks.filter(t => t.account_id != id);
        this.data.dupeScans = this.data.dupeScans.filter(s => s.account_id != id);
        this.data.accounts = this.data.accounts.filter(a => a.id != id);
        this.save();
    }

    // ========== 和谐文件记录 ==========

    addViolationRecord(record) {
        const now = new Date().toISOString();
        const newRecord = {
            id: this.data.nextRecordId++,
            account_id: record.accountId,
            task_id: record.taskId,
            filename: record.filename,
            path: record.path,
            fs_id: record.fs_id || '',
            size: record.size || 0,
            reason: record.reason || '',
            status: record.status || 'violation',
            is_dir: record.is_dir || 0,
            created_at: now
        };
        this.data.violationRecords.push(newRecord);
        this.save();
        return newRecord.id;
    }

    getViolationRecords({ accountId, taskId, keyword, page = 1, pageSize = 50 } = {}) {
        let records = filterViolationRecords(this.data.violationRecords, { accountId, taskId, keyword });

        const total = records.length;
        const offset = (page - 1) * pageSize;
        const paginated = records.slice(offset, offset + pageSize);

        return { records: paginated, total, page, pageSize };
    }

    getAllViolationRecords({ accountId, taskId, keyword } = {}) {
        return filterViolationRecords(this.data.violationRecords, { accountId, taskId, keyword });
    }

    deleteViolationRecord(id) {
        this.data.violationRecords = this.data.violationRecords.filter(r => r.id != id);
        this.save();
    }

    updateViolationRecord(id, data) {
        const record = this.data.violationRecords.find(r => r.id == id);
        if (record) {
            Object.assign(record, data);
            this.save();
        }
        return record;
    }

    clearViolationRecords({ accountId, taskId, onlySuccess = false } = {}) {
        this.data.violationRecords = this.data.violationRecords.filter(r => {
            if (accountId && r.account_id != accountId) return true;
            if (taskId && r.task_id != taskId) return true;
            if (onlySuccess && r.status !== 'success' && r.status !== 'deleted' && r.status !== 'moved') return true;
            return false;
        });
        this.save();
    }

    // ========== 检测任务 ==========

    addTask(task) {
        const now = new Date().toISOString();
        const newTask = {
            id: this.data.nextTaskId++,
            task_id: task.taskId,
            account_id: task.accountId,
            dir: task.dir || '/',
            total_files: task.totalFiles || 0,
            checked_files: task.checkedFiles || 0,
            violation_count: task.violationCount || 0,
            status: task.status || 'running',
            include_keywords: task.includeKeywords || '',
            exclude_keywords: task.excludeKeywords || '',
            created_at: now,
            finished_at: null
        };
        this.data.checkTasks.push(newTask);
        this.save();
        return newTask.id;
    }

    updateTask(taskId, data) {
        const task = this.data.checkTasks.find(t => t.task_id == taskId);
        if (task) {
            Object.assign(task, data);
            if (data.status === 'completed' || data.status === 'stopped') {
                task.finished_at = new Date().toISOString();
            }
            this.save();
        }
        return task;
    }

    getTasks(accountId) {
        let tasks = [...this.data.checkTasks];
        if (accountId) {
            tasks = tasks.filter(t => t.account_id == accountId);
        }
        tasks.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return tasks.slice(0, 50);
    }

    // ========== 重复文件扫描结果 ==========

    // 扫描完成一次性落盘（groups 内嵌文件清单，读取按批次整取）
    addDupeScan(scan) {
        const now = new Date().toISOString();
        const newScan = {
            id: this.data.nextDupeScanId++,
            task_id: scan.taskId,
            account_id: scan.accountId,
            dir: scan.dir || '/',
            total_files: scan.totalFiles || 0,
            stats: scan.stats || { groups: 0, files: 0, reclaimable: 0 },
            groups: scan.groups || [],
            status: scan.status || 'completed',
            created_at: now
        };
        this.data.dupeScans.push(newScan);

        // 每个账号只保留最近 10 次扫描，防止 data.json 无限膨胀
        const byAcc = this.data.dupeScans
            .filter(s => s.account_id == scan.accountId)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        if (byAcc.length > 10) {
            const dropIds = new Set(byAcc.slice(10).map(s => s.id));
            this.data.dupeScans = this.data.dupeScans.filter(s => !dropIds.has(s.id));
        }

        this.save();
        return newScan.id;
    }

    // 列表（不含 groups，避免每次加载整个快照）
    getDupeScans(accountId) {
        let scans = [...this.data.dupeScans];
        if (accountId) {
            scans = scans.filter(s => s.account_id == accountId);
        }
        return scans
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .map(s => ({
                id: s.id, task_id: s.task_id, account_id: s.account_id, dir: s.dir,
                total_files: s.total_files, stats: s.stats, status: s.status, created_at: s.created_at
            }));
    }

    // 完整快照（含 groups）
    getDupeScan(id) {
        return this.data.dupeScans.find(s => s.id == id) || null;
    }

    // 批量标记已删除的文件
    markDupeFilesDeleted(scanId, paths) {
        const scan = this.getDupeScan(scanId);
        if (!scan) return;
        const pathSet = new Set(paths);
        for (const g of scan.groups) {
            for (const f of g.files) {
                if (pathSet.has(f.path)) f.deleted = true;
            }
        }
        this.save();
    }

    deleteDupeScan(id) {
        this.data.dupeScans = this.data.dupeScans.filter(s => s.id != id);
        this.save();
    }

    // ========== 设置 ==========

    getSettings() {
        return { ...this.data.settings };
    }

    getSetting(key) {
        return this.data.settings[key] || null;
    }

    setSetting(key, value) {
        this.data.settings[key] = value;
        this.save();
    }

    close() {
        this.save();
    }
}

module.exports = { Database: AppDatabase };
