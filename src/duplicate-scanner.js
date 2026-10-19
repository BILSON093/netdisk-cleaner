const { BaiduPanAPI } = require('./baidu-api');

// 重复文件扫描器
// 判重依据：大小 + MD5（列表接口自带，无需下载、不触发 download 接口限流）
// 扫描过程全在内存，完成后由调用方一次性落盘
class DuplicateScanner {
    constructor(account, options = {}) {
        this.account = account;
        this.api = new BaiduPanAPI(account.cookies, account.proxy);
        this.api.bdstoken = account.bdstoken || '';

        this.dir = options.dir || '/';

        this.isRunning = false;
        this.isStopped = false;

        this.totalFiles = 0;    // 已收集的有效文件数（排除目录和0字节）
        this.currentDir = '';   // 正在收集的目录（用于进度展示）
        this.groups = [];       // 重复组
        this.stats = { groups: 0, files: 0, reclaimable: 0 };

        this._files = [];
    }

    // 递归收集文件（复用列表接口，每100个文件1次请求）
    async collect(dir) {
        let page = 1;
        const num = 100;
        this.currentDir = dir;

        while (!this.isStopped) {
            let result;
            try {
                result = await this.api.getFileList(dir, page, num);
            } catch (e) {
                console.error(`收集目录失败 ${dir}:`, e.message);
                break;
            }
            if (!result.list || result.list.length === 0) break;

            for (const item of result.list) {
                if (this.isStopped) break;
                if (item.isdir === 1) {
                    await this.collect(item.path);
                    this.currentDir = dir;
                } else if (item.size > 0 && item.md5) {
                    // 0字节文件无 md5 且无意义，排除
                    this._files.push({
                        path: item.path,
                        filename: item.server_filename,
                        size: item.size,
                        md5: item.md5,
                        fs_id: item.fs_id,
                        mtime: item.server_mtime || 0
                    });
                    this.totalFiles = this._files.length;
                }
            }

            if (!result.has_more) break;
            page++;
            await this.sleep(150); // 列表接口限流阈值宽，150ms 足够
        }
    }

    // 按 大小+MD5 分组，≥2 个的为重复组
    // 组内按 修改时间升序、路径长度升序 排序 → files[0] 为推荐保留
    buildGroups() {
        const map = new Map();
        for (const f of this._files) {
            const key = `${f.size}_${f.md5}`;
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(f);
        }

        this.groups = [...map.values()]
            .filter(files => files.length > 1)
            .map(files => {
                files.sort((a, b) => (a.mtime - b.mtime) || (a.path.length - b.path.length));
                return {
                    size: files[0].size,
                    md5: files[0].md5,
                    count: files.length,
                    files   // files[0] = 推荐保留（最早修改，并列取路径最短）
                };
            })
            // 按可释放空间降序，大头排前面
            .sort((a, b) => b.size * (b.count - 1) - a.size * (a.count - 1));

        this.stats = {
            groups: this.groups.length,
            files: this.groups.reduce((s, g) => s + g.count - 1, 0),           // 冗余文件总数（每组减保留的1个）
            reclaimable: this.groups.reduce((s, g) => s + g.size * (g.count - 1), 0)
        };
    }

    async start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.isStopped = false;

        try {
            await this.api.ensureToken();
            console.log(`开始扫描重复文件，目录: ${this.dir}`);
            await this.collect(this.dir);
            console.log(`收集完成，共 ${this.totalFiles} 个文件，开始分组判重`);
            if (!this.isStopped) {
                this.buildGroups();
                console.log(`判重完成: ${this.stats.groups} 组重复，可释放 ${Math.round(this.stats.reclaimable / 1024 / 1024)}MB`);
            }
        } catch (e) {
            console.error('重复文件扫描出错:', e);
        } finally {
            this.isRunning = false;
        }
    }

    stop() {
        this.isStopped = true;
    }

    getProgress() {
        return {
            total: this.totalFiles,
            currentDir: this.currentDir,
            isRunning: this.isRunning,
            isStopped: this.isStopped,
            stats: this.stats
        };
    }

    // 输出可持久化的结果（删除状态由 db 层维护）
    getResults() {
        return {
            stats: this.stats,
            groups: this.groups.map(g => ({
                size: g.size,
                md5: g.md5,
                count: g.count,
                files: g.files.map(f => ({
                    path: f.path, filename: f.filename, size: f.size,
                    mtime: f.mtime, fs_id: f.fs_id, deleted: false
                }))
            }))
        };
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { DuplicateScanner };
