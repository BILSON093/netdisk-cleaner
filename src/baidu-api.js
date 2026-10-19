const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');

class BaiduPanAPI {
    constructor(cookies, proxy = '') {
        this.cookies = cookies;
        this.bdstoken = '';
        this.signData = null;
        this.proxy = proxy;
        this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        
        // 创建axios实例
        const axiosConfig = {
            timeout: 30000,
            headers: {
                'User-Agent': this.userAgent,
                'Cookie': cookies,
                'Referer': 'https://pan.baidu.com/',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'zh-CN,zh;q=0.9',
            }
        };

        // 代理设置
        if (proxy) {
            if (proxy.startsWith('socks://') || proxy.startsWith('socks5://')) {
                axiosConfig.httpsAgent = new SocksProxyAgent(proxy);
                axiosConfig.httpAgent = new SocksProxyAgent(proxy);
            } else if (proxy.startsWith('http://') || proxy.startsWith('https://')) {
                axiosConfig.httpsAgent = new HttpsProxyAgent(proxy);
                axiosConfig.httpAgent = new HttpsProxyAgent(proxy);
            }
        }

        this.client = axios.create(axiosConfig);
    }

    // 生成 logid：base64(BAIDUID + ":FG=1")
    generateLogid() {
        const match = this.cookies.match(/BAIDUID=([^;:]+)/i);
        if (!match) return '';
        return Buffer.from(match[1] + ':FG=1').toString('base64');
    }

    // 获取用户信息
    async getUserInfo() {
        try {
            const url = `https://pan.baidu.com/api/loginStatus?clienttype=0&app_id=250528&web=1&channel=chunlei`;
            const response = await this.client.get(url);
            
            if (response.data && response.data.errno === 0) {
                return response.data;
            }
            return null;
        } catch (e) {
            console.error('获取用户信息失败:', e.message);
            return null;
        }
    }

    // 获取bdstoken
    async getBdstoken() {
        // 方法1: 从 loginStatus 的 login_info 获取（最可靠）
        try {
            const url = `https://pan.baidu.com/api/loginStatus?clienttype=0&app_id=250528&web=1&channel=chunlei`;
            const response = await this.client.get(url);
            if (response.data && response.data.errno === 0 &&
                response.data.login_info && response.data.login_info.bdstoken) {
                this.bdstoken = response.data.login_info.bdstoken;
                return this.bdstoken;
            }
        } catch (e) {
            console.error('loginStatus 获取bdstoken失败:', e.message);
        }

        // 方法2: 从gettemplatevariable获取
        try {
            const url = `https://pan.baidu.com/api/gettemplatevariable?clienttype=0&app_id=250528&web=1&fields=[%22bdstoken%22]`;
            const response = await this.client.get(url);

            if (response.data && response.data.errno === 0 && response.data.result && response.data.result.bdstoken) {
                this.bdstoken = response.data.result.bdstoken;
                return this.bdstoken;
            }
        } catch (e) {
            console.error('gettemplatevariable 获取bdstoken失败:', e.message);
        }

        // 方法3: 从cookie中提取
        const match = this.cookies.match(/BDSTOKEN=([^;]+)/i);
        if (match) {
            this.bdstoken = match[1];
            return this.bdstoken;
        }

        console.error('未能获取bdstoken，请检查Cookies是否完整有效');
        return '';
    }

    // 验证会话是否真的能访问数据接口（loginStatus 不够严格，用 list 实测）
    async validateSession() {
        try {
            await this.ensureToken();
            const logid = this.generateLogid();
            let url = `https://pan.baidu.com/api/list?order=time&desc=1&showempty=0&web=1&page=1&num=1&dir=%2F&t=${Math.random()}&channel=chunlei&app_id=250528&bdstoken=${this.bdstoken}&clienttype=0`;
            if (logid) url += `&logid=${encodeURIComponent(logid)}`;
            const response = await this.client.get(url);
            if (response.data && response.data.errno === 0) {
                return { valid: true };
            }
            return { valid: false, errno: response.data && response.data.errno, message: (response.data && response.data.errmsg) || '身份验证失败' };
        } catch (e) {
            return { valid: false, message: e.message };
        }
    }

    // 获取文件列表
    async getFileList(dir = '/', page = 1, num = 100, order = 'time', desc = 1) {
        // bdstoken 为空时先获取
        if (!this.bdstoken) {
            await this.getBdstoken();
        }

        const logid = this.generateLogid();
        const buildUrl = () => {
            let url = `https://pan.baidu.com/api/list?order=${order}&desc=${desc}&showempty=0&web=1&page=${page}&num=${num}&dir=${encodeURIComponent(dir)}&t=${Math.random()}&channel=chunlei&web=1&app_id=250528&bdstoken=${this.bdstoken}&clienttype=0`;
            if (logid) url += `&logid=${encodeURIComponent(logid)}`;
            return url;
        };

        let lastErrno = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const response = await this.client.get(buildUrl());
                const data = response.data;

                if (data && data.errno === 0) {
                    const list = data.list || [];
                    return {
                        list,
                        total: data.total != null ? data.total : list.length,
                        has_more: list.length >= num
                    };
                }

                lastErrno = data ? data.errno : null;

                // errno -6: 身份验证失败 → 刷新 bdstoken 后重试一次
                if (lastErrno === -6 && attempt === 0) {
                    this.bdstoken = '';
                    await this.getBdstoken();
                    continue;
                }

                throw new Error(`获取文件列表失败: ${data ? JSON.stringify(data) : '未知错误'}`);
            } catch (e) {
                if (e.response) {
                    throw new Error(`获取文件列表失败: HTTP ${e.response.status}`);
                }
                throw e;
            }
        }

        throw new Error(`获取文件列表失败: errno=${lastErrno}`);
    }

    // 递归获取所有文件
    async getAllFiles(dir = '/', includeDirs = false) {
        const allFiles = [];
        let page = 1;
        const num = 100;

        while (true) {
            const result = await this.getFileList(dir, page, num);
            if (!result.list || result.list.length === 0) break;

            for (const item of result.list) {
                if (item.isdir === 1) {
                    if (includeDirs) {
                        allFiles.push(item);
                    }
                    // 递归子目录
                    try {
                        const subFiles = await this.getAllFiles(item.path, includeDirs);
                        allFiles.push(...subFiles);
                    } catch (e) {
                        console.error(`获取子目录失败 ${item.path}:`, e.message);
                    }
                } else {
                    allFiles.push(item);
                }
            }

            if (!result.has_more) break;
            page++;
        }

        return allFiles;
    }

    // 确保bdstoken存在
    async ensureToken() {
        if (!this.bdstoken) {
            await this.getBdstoken();
        }
        return this.bdstoken;
    }

    // 构造带logid的查询串
    logidQuery() {
        const logid = this.generateLogid();
        return logid ? `&logid=${encodeURIComponent(logid)}` : '';
    }

    // 删除文件
    async deleteFiles(filelist, path = '/') {
        try {
            await this.ensureToken();
            const filelistStr = JSON.stringify(filelist.map(f => {
                const filePath = f.path || (path + '/' + f.server_filename);
                return filePath;
            }));

            const url = `https://pan.baidu.com/api/filemanager?async=0&onnest=fail&opera=delete&bdstoken=${this.bdstoken}&channel=chunlei&web=1&app_id=250528${this.logidQuery()}&clienttype=0`;
            
            const response = await this.client.post(url, 
                `filelist=${encodeURIComponent(filelistStr)}`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    }
                }
            );

            if (response.data && response.data.errno === 0) {
                return { success: true, data: response.data };
            }
            
            return { success: false, errno: response.data?.errno, message: response.data?.errmsg || '删除失败' };
        } catch (e) {
            console.error('删除文件失败:', e.message);
            return { success: false, message: e.message };
        }
    }

    // 移动文件
    async moveFiles(filelist, destPath) {
        try {
            await this.ensureToken();
            const filelistStr = JSON.stringify(filelist.map(f => ({
                path: f.path,
                dest: destPath,
                newname: f.server_filename || ''
            })));

            const url = `https://pan.baidu.com/api/filemanager?async=0&onnest=fail&opera=move&bdstoken=${this.bdstoken}&channel=chunlei&web=1&app_id=250528${this.logidQuery()}&clienttype=0`;
            
            const response = await this.client.post(url, 
                `filelist=${encodeURIComponent(filelistStr)}`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    }
                }
            );

            if (response.data && response.data.errno === 0) {
                return { success: true, data: response.data };
            }
            
            return { success: false, errno: response.data?.errno, message: response.data?.errmsg || '移动失败' };
        } catch (e) {
            console.error('移动文件失败:', e.message);
            return { success: false, message: e.message };
        }
    }

    // 创建文件夹
    async createFolder(path, name) {
        try {
            await this.ensureToken();
            const url = `https://pan.baidu.com/api/create?a=commit&bdstoken=${this.bdstoken}&channel=chunlei&web=1&app_id=250528${this.logidQuery()}&clienttype=0`;
            
            const response = await this.client.post(url, 
                `path=${encodeURIComponent(path + '/' + name)}&isdir=1&size=0&block_list=[]&uploadid=&autoinit=1`,
                {
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                    }
                }
            );

            if (response.data && (response.data.errno === 0 || response.data.errno === -7)) {
                return { success: true, data: response.data };
            }
            
            return { success: false, errno: response.data?.errno, message: response.data?.errmsg || '创建失败' };
        } catch (e) {
            console.error('创建文件夹失败:', e.message);
            return { success: false, message: e.message };
        }
    }

    // ============ 和谐文件检测：直链可达性判定 ============
    // GET /api/download?type=dlink 提交一组 fid：
    //   errno 0            → 全部正常（返回 dlink）
    //   errno -1           → 组内含不可下载文件；也可能是限流，需结合参照文件判断
    //   errno 113          → sign 过期，需刷新
    //   errno -7/112/429/414 → 频率限制
    //   errno 2            → 瞬时错误，重试
    // sign 计算：base64(RC4(key=sign3, data=sign1))
    // 注：errno 0 时个别 fid 可能缺席于返回的 dlink 数组，缺席即视为不可下载
    rc4(key, data) {
        const a = [], p = [], v = key.length;
        for (let q = 0; q < 256; q++) { a[q] = key.substr(q % v, 1).charCodeAt(0); p[q] = q; }
        for (let u = 0, q = 0; q < 256; q++) { u = (u + p[q] + a[q]) % 256; const t = p[q]; p[q] = p[u]; p[u] = t; }
        let out = '';
        for (let i = 0, u = 0, q = 0; q < data.length; q++) {
            i = (i + 1) % 256; u = (u + p[i]) % 256;
            const t = p[i]; p[i] = p[u]; p[u] = t;
            out += String.fromCharCode(data.charCodeAt(q) ^ p[(p[i] + p[u]) % 256]);
        }
        return out;
    }

    // 刷新下载签名（签名素材由服务端下发）
    async refreshSign() {
        const logid = this.generateLogid();
        const url = `https://pan.baidu.com/api/gettemplatevariable?fields=[%22sign1%22,%22sign2%22,%22sign3%22,%22timestamp%22]&channel=chunlei&web=1&app_id=250528&bdstoken=${this.bdstoken}${logid ? '&logid=' + encodeURIComponent(logid) : ''}&clienttype=0`;
        const res = await this.client.get(url);
        const r = res.data && res.data.result;
        if (!r || !r.sign1 || !r.sign3) throw new Error('获取下载签名(sign)失败');
        const sign = Buffer.from(this.rc4(r.sign3, r.sign1), 'binary').toString('base64');
        this.signData = { sign, timestamp: r.timestamp, at: Date.now() };
        return this.signData;
    }

    async getSign() {
        if (!this.signData || Date.now() - this.signData.at > 5 * 60 * 1000) {
            await this.refreshSign();
        }
        return this.signData;
    }

    // 单次提交一组 fid（≤10），返回 {errno, hasDlink}
    async downloadDlink(fsIds) {
        await this.ensureToken();
        const sd = await this.getSign();
        const logid = this.generateLogid();
        const url = `https://pan.baidu.com/api/download?clienttype=0&app_id=250528&web=1&dp-logid=${logid}` +
            `&timestamp=${sd.timestamp}&type=dlink&vip=0&sign=${encodeURIComponent(sd.sign)}` +
            `&fidlist=${encodeURIComponent(JSON.stringify(fsIds))}`;
        const res = await this.client.get(url, { validateStatus: () => true, timeout: 30000 });
        const data = (res.data && typeof res.data === 'object') ? res.data : {};
        return { errno: data.errno, hasDlink: !!(data.dlink && data.dlink.length), raw: data };
    }

    // 单文件检测（兼容接口）。errno=-1 无法区分限流/违规，交由上层用参照文件复核
    async checkFileViolation(file) {
        try {
            const r = await this.downloadDlink([file.fs_id]);
            if (r.errno === 0) return { isViolation: false, reason: '正常', code: 0 };
            if (r.errno === -1) return { isViolation: null, reason: '无法获取直链(errno=-1)', code: -1, retry: true };
            return { isViolation: null, reason: `未知结果(errno=${r.errno})`, code: r.errno, retry: true };
        } catch (e) {
            return { isViolation: null, reason: '检测失败: ' + e.message, code: -1 };
        }
    }
}

module.exports = { BaiduPanAPI };
