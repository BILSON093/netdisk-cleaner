const { BaiduPanAPI } = require('./baidu-api');

class ViolationChecker {
    constructor(account, options = {}) {
        this.account = account;
        this.api = new BaiduPanAPI(account.cookies, account.proxy);
        this.api.bdstoken = account.bdstoken || '';

        this.dir = options.dir || '/';
        this.includeKeywords = options.includeKeywords || [];
        this.excludeKeywords = options.excludeKeywords || [];
        this.delay = options.delay || 2000;
        this.batchSize = options.batchSize || 10;
        this.autoDelete = options.autoDelete || false;
        this.movePath = options.movePath || '';

        this.isRunning = false;
        this.isPaused = false;
        this.isStopped = false;

        this.totalFiles = 0;
        this.checkedFiles = 0;
        this.violationFiles = [];
        this.normalFiles = [];
        this.failedFiles = [];

        this.allFiles = [];
        this._refCursor = 0;      // 参照文件轮询游标（从已判定正常的文件里取，避免重复请求同一 fid）
        this.rateLimitHits = 0;

        // 限流优化标记：首次触发限流后进入保守模式，delay ×1.5
        // 批次结束后重置（避免永远保持慢节奏）
        this._rateLimitedDetected = false;
        // 待移动/删除的违规文件队列（检测完统一批量执行，避免与检测请求交叉叠加触发风控）
        this._pendingActions = [];

        // 回调：实时持久化（由 main.js 注入）
        // onViolation(record) 每检出一个违规立即调用（实时写库）
        // onProgress({counts, lastFile}) 每检测一个文件调用（调用方自行节流）
        this.onViolation = typeof options.onViolation === 'function' ? options.onViolation : null;
        this.onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

        // 断点续检水位线：{dir, name}，按"目录路径 + 文件名"字典序定位
        // 严格小于水位线的文件视为已检测，直接跳过
        this.resumeWatermark = options.resumeWatermark || null;
        this._skippedByWatermark = 0;
        this._passedWatermark = !this.resumeWatermark;   // 无水位线时从一开始就保留
    }

    // 关键词过滤
    filterByKeywords(filename) {
        const name = filename.toLowerCase();

        // 包含关键词过滤
        if (this.includeKeywords.length > 0) {
            const hasInclude = this.includeKeywords.some(kw =>
                name.includes(kw.toLowerCase())
            );
            if (!hasInclude) return false;
        }

        // 排除关键词过滤
        if (this.excludeKeywords.length > 0) {
            const hasExclude = this.excludeKeywords.some(kw =>
                name.includes(kw.toLowerCase())
            );
            if (hasExclude) return false;
        }

        return true;
    }

    // 收集所有文件（确定性顺序：目录内按 server_filename 字典序，子目录与文件混排递归）
    // 这样水位线 (dir, name) 可以稳定定位"上次检测到哪里"
    // 水位线过滤在递归最深层做（全局 _passedWatermark 标志，遇到严格大于水位线的文件即翻转）
    async collectFiles(dir = '/') {
        try {
            let page = 1;
            const num = 100;
            const localItems = [];   // 本目录所有项目（文件 + 子目录占位符，混排）

            while (true) {
                if (this.isStopped) break;

                const result = await this.api.getFileList(dir, page, num);
                if (!result.list || result.list.length === 0) break;

                // 全部项目按 server_filename 字典序排序（文件与子目录混排，保证全局遍历顺序确定）
                const sorted = [...result.list].sort((a, b) =>
                    String(a.server_filename).localeCompare(String(b.server_filename), 'zh-CN')
                );

                for (const item of sorted) {
                    if (item.isdir === 1) {
                        localItems.push({ __isSubdir: true, path: item.path });
                    } else if (this.filterByKeywords(item.server_filename)) {
                        localItems.push(item);
                    }
                }

                if (!result.has_more) break;
                page++;
                await this.sleep(200);
            }

            // 按混排顺序处理：子目录递归、文件入 allFiles
            for (const item of localItems) {
                if (this.isStopped) break;

                if (item.__isSubdir) {
                    await this.collectFiles(item.path);
                    continue;
                }

                // 水位线过滤：跳过严格不大于 (wm.dir, wm.name) 的文件
                if (!this._passedWatermark) {
                    const wm = this.resumeWatermark;
                    const cmpDir = String(dir).localeCompare(String(wm.dir), 'zh-CN');
                    const cmpName = String(item.server_filename).localeCompare(String(wm.name), 'zh-CN');
                    if (cmpDir > 0 || (cmpDir === 0 && cmpName > 0)) {
                        this._passedWatermark = true;
                    } else {
                        this._skippedByWatermark++;
                        continue;
                    }
                }

                this.allFiles.push(item);
                this.totalFiles = this.allFiles.length + this._skippedByWatermark;
            }
        } catch (e) {
            console.error(`收集目录文件失败 ${dir}:`, e.message);
        }
    }

    async waitIfPaused() {
        while (this.isPaused && !this.isStopped) {
            await this.sleep(300);
        }
    }

    // 频率限制类错误码（8001 = "操作频率太快了"）
    isRateLimitErrno(errno) {
        return errno === -7 || errno === -8 || errno === 112 || errno === 429 ||
            errno === 414 || errno === 31034 || errno === 8001;
    }

    // 账号是否可用（轮询已判定正常的文件做参照）。返回 true=健康
    // 轮询不同的参照文件，避免因反复请求同一 fid 触发单文件限流
    async accountHealthy() {
        const pool = this.normalFiles;
        if (pool.length === 0) return true; // 尚无参照文件，乐观
        const f = pool[this._refCursor % pool.length];
        this._refCursor++;
        try {
            const r = await this.api.downloadDlink([f.fs_id]);
            if (r.errno === 113) { await this.api.refreshSign().catch(() => {}); return false; }
            // 健康 = errno 0 且确实返回了 dlink
            return r.errno === 0 && r.hasDlink;
        } catch (e) {
            return false;
        }
    }

    // 触发限流后指数退避（可被 stop 打断）
    async rateLimitBackoff() {
        // 首次限流触发全局保守模式：后续所有检测间隔 ×1.5
        this._rateLimitedDetected = true;
        this.rateLimitHits++;
        const wait = Math.min(60000, 5000 * this.rateLimitHits);
        console.log(`触发频率限制，暂停 ${Math.round(wait / 1000)}s 后重试（保守模式已开启）`);
        this.isPaused = true;
        for (let t = 0; t < wait; t += 1000) {
            if (this.isStopped) break;
            await this.sleep(1000);
        }
        this.isPaused = false;
    }

    // 动态检测间隔：基础值 × 保守模式系数（限流后 1.5，正常 1.0）
    getDelay() {
        return this.delay * (this._rateLimitedDetected ? 1.5 : 1);
    }

    // 请求一组 fid（含重试、限流、sign 失效处理）。返回 {errno}
    // 限流退避不消耗重试预算（单独计数，最多等 20 轮，等过限流期）
    async downloadWithRetry(files) {
        let lastErrno = null;
        let rlWaits = 0;
        for (let attempt = 0; attempt < 10; attempt++) {
            if (this.isStopped) return { errno: 'stopped' };
            await this.waitIfPaused();
            await this.sleep(this.getDelay());

            let r;
            try {
                r = await this.api.downloadDlink(files.map(f => f.fs_id));
            } catch (e) {
                r = { errno: 'err' };
            }

            const e = r.errno;
            if (e === 0) return r;
            if (e === 113) { await this.api.refreshSign().catch(() => {}); continue; }
            if (this.isRateLimitErrno(e)) {
                if (++rlWaits > 20) return { errno: e };   // 限流太久仍未恢复，放弃本批
                attempt--;                                  // 限流不计入重试次数
                await this.rateLimitBackoff();
                continue;
            }
            if (e === 2) { await this.sleep(2000); continue; }
            if (e === -1) {
                // 可能含违规，也可能是限流：账号不健康则退避重试
                if (await this.accountHealthy()) return r;
                if (++rlWaits > 20) return { errno: e };
                attempt--;
                await this.rateLimitBackoff();
                continue;
            }
            lastErrno = e;
            await this.sleep(2000);
        }
        return { errno: lastErrno == null ? 'unknown' : lastErrno };
    }

    // 单文件复核：账号健康前提下多次一致返回非0 才判为违规
    // 限流/暂停不消耗复核轮次（总轮次上限 30 防死循环）
    async confirmHarmonized(file) {
        let consistentNeg = 0;
        let guard = 0;
        for (let i = 0; i < 6 && guard < 30; i++) {
            guard++;
            if (this.isStopped) return null;
            await this.waitIfPaused();
            if (!(await this.accountHealthy())) {
                i--;
                consistentNeg = 0;
                await this.rateLimitBackoff();
                continue;
            }
            await this.sleep(this.getDelay());

            let r;
            try { r = await this.api.downloadDlink([file.fs_id]); } catch (e) { r = { errno: 'err' }; }

            if (r.errno === 0 && r.hasDlink) return false;          // 实为正常
            if (r.errno === 113) { i--; await this.api.refreshSign().catch(() => {}); consistentNeg = 0; continue; }
            if (this.isRateLimitErrno(r.errno)) { i--; consistentNeg = 0; await this.rateLimitBackoff(); continue; }
            if (r.errno === 0 && !r.hasDlink) {                     // errno 0 但 dlink 空 → 不可下载
                consistentNeg++;
                if (consistentNeg >= 2) return true;
                continue;
            }
            if (r.errno === -1) {                                   // 账号健康下的 -1 → 不可下载
                consistentNeg++;
                if (consistentNeg >= 2) return true;
                continue;
            }
            consistentNeg = 0;
        }
        return null; // 无法确认 → 归为失败，避免误报
    }

    // 统一上报进度（每检测一个文件调用一次，由调用方节流）
    _emitProgress(file) {
        const dir = (file.path || '').slice(0, (file.path || '').lastIndexOf('/')) || '/';
        this._lastProcessedFile = { dir, name: file.server_filename };
        if (!this.onProgress) return;
        try {
            this.onProgress({
                counts: {
                    total: this.totalFiles,
                    checked: this.checkedFiles,
                    violation: this.violationFiles.length,
                    normal: this.normalFiles.length,
                    failed: this.failedFiles.length
                },
                lastFile: this._lastProcessedFile
            });
        } catch (e) { /* 回调异常不影响检测 */ }
    }

    async recordNormal(file) {
        this.normalFiles.push({
            fs_id: file.fs_id, filename: file.server_filename, path: file.path,
            size: file.size, is_dir: file.isdir, reason: '正常', code: 0, status: 'normal'
        });
        this.checkedFiles++;
        this._emitProgress(file);
    }

    async recordViolation(file) {
        const status = await this.handleViolationFile(file);
        const record = {
            fs_id: file.fs_id, filename: file.server_filename, path: file.path,
            size: file.size, is_dir: file.isdir,
            reason: '文件违规（无法获取下载直链）', code: -1, status
        };
        this.violationFiles.push(record);
        this.checkedFiles++;
        // 实时落库（由 main.js 注入，立即写 violationRecords + 累加 task 计数）
        if (this.onViolation) {
            try { this.onViolation(record); } catch (e) { /* 回调异常不影响检测 */ }
        }
        this._emitProgress(file);
    }

    async recordFailed(file, reason) {
        this.failedFiles.push({
            fs_id: file.fs_id, filename: file.server_filename, path: file.path,
            size: file.size, is_dir: file.isdir, reason: reason || '检测失败', code: -1, status: 'failed'
        });
        this.checkedFiles++;
        this._emitProgress(file);
    }

    // ====== download 引擎：二分定位 + 复核（可识别软和谐） ======

    // 递归分类一组文件：0=全正常；否则对半拆分定位到单文件
    async classifyGroup(files) {
        if (this.isStopped || files.length === 0) return;

        const r = await this.downloadWithRetry(files);
        if (r.errno === 'stopped') return;

        if (r.errno === 0) {
            // errno 0 时 dlink 数组可能不全：缺席的 fid 即不可下载文件（dlink 条目带 fs_id 可直接定位）
            const dlinks = (r.raw && Array.isArray(r.raw.dlink)) ? r.raw.dlink : [];
            const okIds = new Set(dlinks.map(x => String(x.fs_id)));
            for (const f of files) {
                if (okIds.has(String(f.fs_id))) {
                    await this.recordNormal(f);
                } else {
                    // 缺席 → 疑似不可下载，单文件复核确认
                    const isHarm = await this.confirmHarmonized(f);
                    if (isHarm === true) await this.recordViolation(f);
                    else if (isHarm === false) await this.recordNormal(f);
                    else await this.recordFailed(f, '无法确认（疑似限流或异常）');
                }
            }
            this.rateLimitHits = 0;
            return;
        }

        if (files.length === 1) {
            const isHarm = await this.confirmHarmonized(files[0]);
            if (isHarm === true) await this.recordViolation(files[0]);
            else if (isHarm === false) await this.recordNormal(files[0]);
            else await this.recordFailed(files[0], '无法确认（疑似限流或异常）');
            return;
        }

        const mid = Math.ceil(files.length / 2);
        await this.classifyGroup(files.slice(0, mid));
        await this.classifyGroup(files.slice(mid));
    }

    // 处理违规文件（自动删除或移动）
    // 改动：不再同步调 API，只收集到 _pendingActions 队列
    // 原因：move/delete 与 downloadDlink 共享账号级限流窗口，边检测边移/删会叠加请求密度
    // 正确做法：检测请求全部完成后，再统一批量执行 move/delete（50个/批，风控极低）
    async handleViolationFile(file) {
        if (this.autoDelete || this.movePath) {
            this._pendingActions.push({ path: file.path });
            return this.autoDelete ? 'pending_delete' : (this.movePath ? 'pending_move' : 'violation');
        }
        return 'violation';
    }

    // 确保移动目标文件夹存在（createFolder 幂等，已存在时会失败但不影响 move 接口）
    async ensureMoveFolder() {
        if (!this.movePath) return;
        const parent = this.movePath.slice(0, this.movePath.lastIndexOf('/')) || '/';
        const name = this.movePath.slice(this.movePath.lastIndexOf('/') + 1);
        if (!name) return;
        try {
            await this.api.createFolder(parent, name);
        } catch (e) {
            // 文件夹可能已存在，忽略错误
            console.log('确保移动文件夹:', e.message);
        }
    }

    // 检测完成后统一批量执行移动/删除（与检测请求完全解耦，避免风控叠加）
    // move 走 filemanager?opera=move 接口，50个/批，风控极低
    async flushPendingActions() {
        if (this._pendingActions.length === 0) return;
        const items = this._pendingActions;
        this._pendingActions = [];
        const CHUNK = 50;
        console.log(`检测完成，统一批量处理 ${items.length} 个违规文件（${this.movePath ? '移动' : (this.autoDelete ? '删除' : '仅记录')}）`);
        try {
            if (this.movePath) {
                for (let i = 0; i < items.length; i += CHUNK) {
                    if (this.isStopped) break;
                    const chunk = items.slice(i, i + CHUNK);
                    const result = await this.api.moveFiles(chunk, this.movePath);
                    if (!result.success) {
                        // 批量失败时逐个重试
                        for (const it of chunk) {
                            if (this.isStopped) break;
                            await this.api.moveFiles([it], this.movePath);
                        }
                    }
                    if (i + CHUNK < items.length) await this.sleep(500);
                }
            } else if (this.autoDelete) {
                for (let i = 0; i < items.length; i += CHUNK) {
                    if (this.isStopped) break;
                    const chunk = items.slice(i, i + CHUNK);
                    await this.api.deleteFiles(chunk);
                    if (i + CHUNK < items.length) await this.sleep(500);
                }
            }
        } catch (e) {
            console.error('批量处理违规文件失败:', e.message);
        }
    }

    // 开始检测
    async start() {
        if (this.isRunning) return;

        this.isRunning = true;
        this.isStopped = false;
        this.isPaused = false;
        this.rateLimitHits = 0;
        this._refCursor = 0;
        this._rateLimitedDetected = false;   // 每次新检测批次重置保守模式
        this._pendingActions = [];

        try {
            // 准备令牌与下载签名
            await this.api.ensureToken();
            try { await this.api.refreshSign(); } catch (e) { console.error('获取下载签名失败:', e.message); }

            // 检测前先确保移动目标文件夹存在（幂等），避免中途创建增加请求密度
            if (this.movePath) await this.ensureMoveFolder();

            // 第一步：收集所有文件
            console.log(`开始收集文件，目录: ${this.dir}`);
            await this.collectFiles(this.dir);
            console.log(`收集完成，共 ${this.totalFiles} 个文件`);

            if (this.totalFiles === 0 || this.isStopped) {
                this.isRunning = false;
                return;
            }

            // 第二步：按目录分批检测
            const batch = this.batchSize;
            const byDir = new Map();
            for (const f of this.allFiles) {
                const d = f.path.slice(0, f.path.lastIndexOf('/')) || '/';
                if (!byDir.has(d)) byDir.set(d, []);
                byDir.get(d).push(f);
            }

            for (const files of byDir.values()) {
                if (this.isStopped) break;
                for (let i = 0; i < files.length; i += batch) {
                    if (this.isStopped) break;
                    await this.classifyGroup(files.slice(i, i + batch));
                }
            }

        } catch (e) {
            console.error('检测任务出错:', e);
        } finally {
            // 关键：检测请求窗口完全结束后，再统一批量执行 move/delete
            // 避免 move/delete 的 filemanager 请求与 downloadDlink 请求重叠，降低风控概率
            await this.flushPendingActions();
            this.isRunning = false;
            console.log(`检测完成: 总计 ${this.totalFiles}, 已检测 ${this.checkedFiles}, 违规 ${this.violationFiles.length}, 正常 ${this.normalFiles.length}, 失败 ${this.failedFiles.length}`);
        }
    }

    pause() {
        this.isPaused = true;
    }

    resume() {
        this.isPaused = false;
    }

    stop() {
        // 先把已收集的待处理文件 flush 掉，再标记停止
        // 这样即使中途停止，已检测出的违规文件也能被正常处理
        this.flushPendingActions().catch(() => {}).finally(() => {
            this.isStopped = true;
            this.isPaused = false;
        });
    }

    getProgress() {
        // 断点续检时 total 需要包含被水位线跳过的数量（否则前端显示进度会倒退）
        const total = this.allFiles.length + this._skippedByWatermark || this.totalFiles;
        return {
            total,
            checked: this.checkedFiles + this._skippedByWatermark,
            violation: this.violationFiles.length,
            normal: this.normalFiles.length,
            failed: this.failedFiles.length,
            skipped: this._skippedByWatermark,
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            isStopped: this.isStopped,
            lastFile: this._lastProcessedFile || null,
            percent: total > 0 ? Math.round(((this.checkedFiles + this._skippedByWatermark) / total) * 100) : 0
        };
    }

    getResults() {
        return this.violationFiles;
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { ViolationChecker };
