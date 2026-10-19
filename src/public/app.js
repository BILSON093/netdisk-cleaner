// ========== 工具函数 ==========

const API = {
    async get(url) {
        const res = await fetch(url);
        return res.json();
    },
    async post(url, data) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.json();
    },
    async delete(url) {
        const res = await fetch(url, { method: 'DELETE' });
        return res.json();
    }
};

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

function formatSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN');
}

function getFileIcon(filename, isdir) {
    if (isdir) return '<span class="file-icon folder-icon">📁</span>';
    const ext = filename.split('.').pop().toLowerCase();
    const icons = {
        'mp4': '🎬', 'mkv': '🎬', 'avi': '🎬', 'mov': '🎬', 'wmv': '🎬', 'flv': '🎬',
        'mp3': '🎵', 'wav': '🎵', 'flac': '🎵', 'aac': '🎵', 'ogg': '🎵',
        'jpg': '🖼️', 'jpeg': '🖼️', 'png': '🖼️', 'gif': '🖼️', 'bmp': '🖼️', 'webp': '🖼️',
        'zip': '📦', 'rar': '📦', '7z': '📦', 'tar': '📦', 'gz': '📦',
        'pdf': '📕', 'doc': '📘', 'docx': '📘', 'txt': '📄', 'md': '📄',
        'exe': '⚙️', 'msi': '⚙️', 'apk': '📱',
        'iso': '💿'
    };
    return '<span class="file-icon">' + (icons[ext] || '📄') + '</span>';
}

// ========== 标签页切换 ==========

document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        const tab = item.dataset.tab;
        
        // 更新导航
        document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        
        // 更新内容
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById('tab-' + tab).classList.add('active');
        
        // 特殊处理
        if (tab === 'accounts') loadAccounts();
        if (tab === 'violations') loadViolations();
        if (tab === 'dupes') loadDupeScans();
        if (tab === 'files') {
            loadFileAccounts();
        }
    });
});

// ========== 模态框 ==========

function openModal(id) {
    document.getElementById(id).classList.add('show');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('show');
}

document.querySelectorAll('.modal-close, .modal-overlay, [data-modal]').forEach(el => {
    el.addEventListener('click', (e) => {
        if (e.target.dataset.modal) {
            closeModal(e.target.dataset.modal);
        } else if (el.classList.contains('modal-overlay') || el.classList.contains('modal-close')) {
            const modal = el.closest('.modal');
            if (modal) closeModal(modal.id);
        }
    });
});

// ========== 账号管理 ==========

let accounts = [];

async function loadAccounts() {
    const res = await API.get('/api/accounts');
    if (res.success) {
        accounts = res.data;
        renderAccounts();
        updateAccountSelects();
    }
}

function renderAccounts() {
    const container = document.getElementById('accounts-list');
    
    if (accounts.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">👤</div>
                <p>暂无账号，点击上方按钮添加</p>
                <p class="empty-hint">需要提供百度网盘 Cookies 进行登录</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = accounts.map(acc => `
        <div class="account-card">
            <div class="account-card-header">
                <div style="display: flex; gap: 12px; align-items: center;">
                    <div class="account-avatar">${(acc.name || 'U').charAt(0).toUpperCase()}</div>
                    <div class="account-info">
                        <h4>${escapeHtml(acc.name)}</h4>
                        <p>${escapeHtml(acc.baidu_name || acc.netdisk_name || '未获取到用户名')}</p>
                    </div>
                </div>
                <div class="account-actions">
                    <button class="btn btn-sm btn-outline" onclick="verifyAccount(${acc.id})">验证</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteAccount(${acc.id})">删除</button>
                </div>
            </div>
            <div class="account-card-footer">
                <span>${acc.proxy ? '代理已设置' : '无代理'}</span>
                <span>添加于 ${formatDate(acc.created_at)}</span>
            </div>
        </div>
    `).join('');
}

function updateAccountSelects() {
    const options = accounts.map(acc =>
        `<option value="${acc.id}">${escapeHtml(acc.name)}</option>`
    ).join('');

    // 操作类下拉：无有效选择时默认选中第一个账号，避免每次切页重选
    const autoSelects = ['check-account', 'file-account', 'dupe-account'];
    autoSelects.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value;
        const firstOption = select.querySelector('option');
        select.innerHTML = firstOption.outerHTML + options;
        if (current && accounts.some(a => a.id == current)) {
            select.value = current;
        } else if (accounts.length > 0) {
            select.value = accounts[0].id;
            select.dispatchEvent(new Event('change'));
        }
    });

    // 筛选类下拉：保留「全部账号」等占位选择，仅刷新选项
    const filterSelects = ['violation-account-filter'];
    filterSelects.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const current = select.value;
        const firstOption = select.querySelector('option');
        select.innerHTML = firstOption.outerHTML + options;
        if (current && accounts.some(a => a.id == current)) {
            select.value = current;
        }
    });
}

document.getElementById('btn-add-account').addEventListener('click', () => {
    document.getElementById('account-cookies').value = '';
    document.getElementById('account-name').value = '';
    document.getElementById('account-proxy').value = '';
    resetBrowserLoginUI();
    openModal('modal-add-account');
});

document.getElementById('btn-save-account').addEventListener('click', async () => {
    const cookies = document.getElementById('account-cookies').value.trim();
    const name = document.getElementById('account-name').value.trim();
    const proxy = document.getElementById('account-proxy').value.trim();

    if (!cookies) {
        showToast('请输入 Cookies', 'error');
        return;
    }

    await addAccountWithCookies(cookies, name, proxy);
});

async function addAccountWithCookies(cookies, name, proxy) {
    const btn = document.getElementById('btn-save-account');
    btn.disabled = true;
    btn.textContent = '添加中...';

    try {
        const res = await API.post('/api/accounts', { cookies, name, proxy });
        if (res.success) {
            showToast('账号添加成功', 'success');
            closeModal('modal-add-account');
            loadAccounts();
            return true;
        } else {
            showToast(res.message || '添加失败', 'error');
            return false;
        }
    } catch (e) {
        showToast('添加失败: ' + e.message, 'error');
        return false;
    } finally {
        btn.disabled = false;
        btn.textContent = '确认添加';
    }
}

// ==================== 浏览器自动登录 ====================

let browserLoginTimer = null;

function resetBrowserLoginUI() {
    document.getElementById('browser-login-status').style.display = 'none';
    document.getElementById('btn-browser-login').disabled = false;
    if (browserLoginTimer) {
        clearInterval(browserLoginTimer);
        browserLoginTimer = null;
    }
}

document.getElementById('btn-browser-login').addEventListener('click', async () => {
    const btn = document.getElementById('btn-browser-login');
    const statusBox = document.getElementById('browser-login-status');
    const statusText = document.getElementById('browser-login-text');

    try {
        const res = await API.post('/api/login/browser/start', {});
        if (!res.success) {
            showToast(res.message || '启动浏览器失败', 'error');
            return;
        }
    } catch (e) {
        showToast('启动浏览器失败: ' + e.message, 'error');
        return;
    }

    btn.disabled = true;
    statusBox.style.display = 'flex';
    statusText.textContent = '请在打开的浏览器中登录百度账号...';

    // 轮询登录状态
    browserLoginTimer = setInterval(async () => {
        try {
            const res = await API.get('/api/login/browser/status');
            const s = res.data;

            if (s.status === 'success') {
                resetBrowserLoginUI();
                statusText.textContent = '登录成功，正在添加账号...';

                const name = document.getElementById('account-name').value.trim();
                const proxy = document.getElementById('account-proxy').value.trim();
                const ok = await addAccountWithCookies(s.cookies, name, proxy);
                if (!ok) {
                    // 添加失败时把cookie填入文本框便于排查
                    document.getElementById('account-cookies').value = s.cookies;
                }
            } else if (s.status === 'failed' || s.status === 'cancelled') {
                resetBrowserLoginUI();
                showToast(s.message || '登录未完成', 'error');
            }
        } catch (e) {
            // 网络抖动忽略
        }
    }, 2000);
});

document.getElementById('btn-browser-login-cancel').addEventListener('click', async () => {
    resetBrowserLoginUI();
    try {
        await API.post('/api/login/browser/cancel', {});
    } catch (e) {}
});

async function verifyAccount(id) {
    showToast('验证中...', 'info');
    try {
        const res = await API.post(`/api/accounts/${id}/verify`, {});
        if (res.success) {
            showToast('账号有效', 'success');
            loadAccounts();
        } else {
            showToast(res.message || '验证失败', 'error');
        }
    } catch (e) {
        showToast('验证失败: ' + e.message, 'error');
    }
}

async function deleteAccount(id) {
    if (!confirm('确定要删除这个账号吗？')) return;
    
    try {
        const res = await API.delete(`/api/accounts/${id}`);
        if (res.success) {
            showToast('删除成功', 'success');
            loadAccounts();
        } else {
            showToast(res.message || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

// ========== 检测功能 ==========

let currentTaskId = null;
let progressTimer = null;
let selectedDir = '/';

// 检测后操作切换
document.querySelectorAll('input[name="check-action"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
        const moveGroup = document.getElementById('move-path-group');
        moveGroup.style.display = e.target.value === 'move' ? 'block' : 'none';
    });
});

document.getElementById('btn-start-check').addEventListener('click', startCheck);
document.getElementById('btn-pause-check').addEventListener('click', togglePause);
document.getElementById('btn-stop-check').addEventListener('click', stopCheck);

async function startCheck() {
    const accountId = document.getElementById('check-account').value;
    if (!accountId) {
        showToast('请先选择账号', 'error');
        return;
    }
    
    const dir = document.getElementById('check-dir').value.trim() || '/';
    const delay = document.getElementById('check-delay').value;
    const includeKeywords = document.getElementById('check-include').value;
    const excludeKeywords = document.getElementById('check-exclude').value;

    const action = document.querySelector('input[name="check-action"]:checked').value;
    const autoDelete = action === 'delete';
    const movePath = action === 'move' ? document.getElementById('check-move-path').value.trim() : '';

    const btn = document.getElementById('btn-start-check');
    btn.disabled = true;

    try {
        const res = await API.post('/api/check/start', {
            accountId,
            dir,
            delay,
            includeKeywords,
            excludeKeywords,
            autoDelete,
            movePath
        });
        
        if (res.success) {
            currentTaskId = res.data.taskId;
            showToast('检测任务已启动', 'success');
            
            // 显示进度区域
            document.getElementById('progress-card').style.display = 'block';
            document.getElementById('btn-pause-check').style.display = 'inline-flex';
            document.getElementById('btn-stop-check').style.display = 'inline-flex';
            btn.style.display = 'none';
            
            // 开始轮询进度
            startProgressPolling();
        } else {
            showToast(res.message || '启动失败', 'error');
            btn.disabled = false;
        }
    } catch (e) {
        showToast('启动失败: ' + e.message, 'error');
        btn.disabled = false;
    }
}

function startProgressPolling() {
    if (progressTimer) clearInterval(progressTimer);
    
    progressTimer = setInterval(async () => {
        if (!currentTaskId) return;
        
        try {
            const res = await API.get(`/api/check/progress/${currentTaskId}`);
            if (res.success) {
                updateProgressUI(res.data.progress, res.data.results);
                
                if (!res.data.progress.isRunning) {
                    clearInterval(progressTimer);
                    showToast('检测完成', 'success');
                    
                    document.getElementById('btn-start-check').style.display = 'inline-flex';
                    document.getElementById('btn-pause-check').style.display = 'none';
                    document.getElementById('btn-stop-check').style.display = 'none';
                    document.getElementById('btn-start-check').disabled = false;
                    
                    // 刷新违规记录
                    loadViolations();
                }
            }
        } catch (e) {
            console.error('获取进度失败:', e);
        }
    }, 1000);
}

function updateProgressUI(progress, results) {
    document.getElementById('progress-fill').style.width = progress.percent + '%';
    document.getElementById('stat-total').textContent = progress.total;
    document.getElementById('stat-checked').textContent = progress.checked;
    document.getElementById('stat-violation').textContent = progress.violation;
    document.getElementById('stat-normal').textContent = progress.normal;
    document.getElementById('stat-failed').textContent = progress.failed;
    
    // 更新暂停按钮文字
    const pauseBtn = document.getElementById('btn-pause-check');
    pauseBtn.innerHTML = progress.isPaused ? '<span>▶️</span> 继续' : '<span>⏸️</span> 暂停';
    
    // 更新违规文件预览列表
    const tbody = document.getElementById('violation-preview-body');
    if (results && results.length > 0) {
        tbody.innerHTML = results.slice(0, 20).map(f => `
            <tr>
                <td class="filename-cell" title="${escapeHtml(f.filename)}">${escapeHtml(f.filename)}</td>
                <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</td>
                <td>${formatSize(f.size || 0)}</td>
                <td>${escapeHtml(f.reason || '')}</td>
                <td><span class="status-badge danger">${getStatusText(f.status)}</span></td>
            </tr>
        `).join('');
    }
}

function getStatusText(status) {
    const map = {
        'violation': '违规',
        'deleted': '已删除',
        'moved': '已移动',
        'delete_failed': '删除失败',
        'move_failed': '移动失败',
        'normal': '正常',
        'failed': '检测失败',
        'pending': '待检测'
    };
    return map[status] || status;
}

async function togglePause() {
    if (!currentTaskId) return;
    
    const btn = document.getElementById('btn-pause-check');
    const isPaused = btn.innerHTML.includes('继续');
    
    try {
        if (isPaused) {
            await API.post(`/api/check/resume/${currentTaskId}`, {});
            showToast('已继续', 'success');
        } else {
            await API.post(`/api/check/pause/${currentTaskId}`, {});
            showToast('已暂停', 'warning');
        }
    } catch (e) {
        showToast('操作失败: ' + e.message, 'error');
    }
}

async function stopCheck() {
    if (!currentTaskId) return;
    if (!confirm('确定要停止检测吗？')) return;
    
    try {
        await API.post(`/api/check/stop/${currentTaskId}`, {});
        showToast('已停止', 'warning');
    } catch (e) {
        showToast('操作失败: ' + e.message, 'error');
    }
}

// ========== 目录选择 ==========

let dirSelectCurrentPath = '/';
let dirSelectAccountId = null;

document.getElementById('btn-select-dir').addEventListener('click', () => {
    const accountId = document.getElementById('check-account').value;
    if (!accountId) {
        showToast('请先选择账号', 'error');
        return;
    }
    dirSelectAccountId = accountId;
    dirSelectCurrentPath = document.getElementById('check-dir').value.trim() || '/';
    openModal('modal-select-dir');
    loadDirSelectList();
});

document.getElementById('btn-confirm-dir').addEventListener('click', () => {
    document.getElementById('check-dir').value = dirSelectCurrentPath;
    closeModal('modal-select-dir');
});

async function loadDirSelectList() {
    if (!dirSelectAccountId) return;
    
    updateDirNav();
    
    const tbody = document.getElementById('dir-select-body');
    tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted">加载中...</td></tr>';
    
    try {
        const res = await API.get(`/api/files?accountId=${dirSelectAccountId}&dir=${encodeURIComponent(dirSelectCurrentPath)}&num=200`);
        if (res.success) {
            const dirs = (res.data.list || []).filter(f => f.isdir === 1);
            
            if (dirs.length === 0 && dirSelectCurrentPath === '/') {
                tbody.innerHTML = '<tr><td colspan="2" class="text-center text-muted">根目录下没有文件夹</td></tr>';
                return;
            }
            
            let html = '';
            if (dirSelectCurrentPath !== '/') {
                html += `
                    <tr>
                        <td colspan="2">
                            <span class="file-icon">⬆️</span>
                            <a href="javascript:void(0)" onclick="goToParentDir()">返回上级</a>
                        </td>
                    </tr>
                `;
            }
            
            if (dirs.length === 0) {
                html += '<tr><td colspan="2" class="text-center text-muted">此目录下没有子文件夹</td></tr>';
            } else {
                html += dirs.map(dir => `
                    <tr>
                        <td>
                            <span class="file-icon folder-icon">📁</span>
                            <a href="javascript:void(0)" onclick="enterDir('${escapeJs(dir.path)}')">${escapeHtml(dir.server_filename)}</a>
                        </td>
                        <td>
                            <button class="btn btn-sm btn-primary" onclick="selectDir('${escapeJs(dir.path)}')">选择此目录</button>
                        </td>
                    </tr>
                `).join('');
            }
            
            tbody.innerHTML = html;
        } else {
            tbody.innerHTML = `<tr><td colspan="2" class="text-center text-danger">${escapeHtml(res.message)}</td></tr>`;
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="2" class="text-center text-danger">加载失败: ${escapeHtml(e.message)}</td></tr>`;
    }
}

function updateDirNav() {
    const nav = document.getElementById('dir-select-nav');
    const parts = dirSelectCurrentPath.split('/').filter(Boolean);
    
    let html = '<span class="path-item" onclick="navigateToDir(\'/\')">根目录</span>';
    let currentPath = '';
    
    parts.forEach(part => {
        currentPath += '/' + part;
        html += `<span class="path-separator">/</span>`;
        html += `<span class="path-item" onclick="navigateToDir('${escapeJs(currentPath)}')">${escapeHtml(decodeURIComponent(part))}</span>`;
    });
    
    nav.innerHTML = html;
}

function navigateToDir(path) {
    dirSelectCurrentPath = path;
    loadDirSelectList();
}

function enterDir(path) {
    dirSelectCurrentPath = path;
    loadDirSelectList();
}

function goToParentDir() {
    const parts = dirSelectCurrentPath.split('/').filter(Boolean);
    parts.pop();
    dirSelectCurrentPath = '/' + parts.join('/');
    if (dirSelectCurrentPath === '/') dirSelectCurrentPath = '/';
    loadDirSelectList();
}

function selectDir(path) {
    document.getElementById('check-dir').value = path;
    closeModal('modal-select-dir');
    showToast('已选择目录: ' + path, 'success');
}

// ========== 删除任务（带进度）==========

// 启动删除任务并轮询进度，进度实时显示在按钮上
async function runDeleteWithProgress(url, body, btn, onDone) {
    btn.disabled = true;
    const originalHtml = btn.innerHTML;
    try {
        const res = await API.post(url, body);
        if (!res.success) {
            showToast(res.message || '删除失败', 'error');
            return;
        }
        if (!res.data.taskId) {
            showToast(res.data.message || '没有待删除的文件', 'info');
            return;
        }
        const taskId = res.data.taskId;

        while (true) {
            await new Promise(s => setTimeout(s, 800));
            try {
                const p = await API.get(`/api/delete/progress/${taskId}`);
                if (!p.success) break;
                const d = p.data;
                btn.innerHTML = `<span>🗑️</span> 删除中 ${d.processed}/${d.total}${d.failed ? `（失败 ${d.failed}）` : ''}`;
                if (d.done) {
                    showToast(`删除完成：成功 ${d.deleted} 个${d.failed ? `，失败 ${d.failed} 个` : ''}`,
                        d.failed > 0 ? 'warning' : 'success');
                    break;
                }
            } catch (e) {
                break;
            }
        }
        onDone && onDone();
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

// ========== 违规记录 ==========

let violationsPage = 1;
const violationsPageSize = 50;

async function loadViolations() {
    const accountId = document.getElementById('violation-account-filter').value;
    const keyword = document.getElementById('violation-search').value.trim();
    let url = `/api/violations?page=${violationsPage}&pageSize=${violationsPageSize}`;
    if (accountId) url += `&accountId=${accountId}`;
    if (keyword) url += `&keyword=${encodeURIComponent(keyword)}`;

    try {
        const res = await API.get(url);
        if (res.success) {
            renderViolations(res.data.records);
            renderPagination(res.data.total, res.data.page, res.data.pageSize);
        }
    } catch (e) {
        showToast('加载失败: ' + e.message, 'error');
    }
}

function renderViolations(records) {
    const tbody = document.getElementById('violations-body');
    
    if (records.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">暂无记录</td></tr>';
        return;
    }
    
    tbody.innerHTML = records.map(r => `
        <tr>
            <td><input type="checkbox" class="violation-check" data-id="${r.id}"></td>
            <td class="filename-cell" title="${escapeHtml(r.filename)}">${getFileIcon(r.filename, r.is_dir)}${escapeHtml(r.filename)}</td>
            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</td>
            <td>${formatSize(r.size || 0)}</td>
            <td>${escapeHtml(r.reason || '')}</td>
            <td><span class="status-badge ${r.status === 'normal' ? 'success' : 'danger'}">${getStatusText(r.status)}</span></td>
            <td>${formatDate(r.created_at)}</td>
            <td>
                <div class="action-btns">
                    <button class="action-btn danger" onclick="deleteViolation(${r.id})">删除记录</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function renderPagination(total, page, pageSize) {
    const totalPages = Math.ceil(total / pageSize);
    const container = document.getElementById('violations-pagination');

    if (totalPages <= 1) {
        container.innerHTML = total > 0 ? `<span style="color: var(--text-tertiary);">共 ${total} 条</span>` : '';
        return;
    }
    
    let html = `<button ${page <= 1 ? 'disabled' : ''} onclick="goToViolationsPage(${page - 1})">上一页</button>`;
    
    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    
    for (let i = start; i <= end; i++) {
        html += `<button class="${i === page ? 'active' : ''}" onclick="goToViolationsPage(${i})">${i}</button>`;
    }
    
    html += `<button ${page >= totalPages ? 'disabled' : ''} onclick="goToViolationsPage(${page + 1})">下一页</button>`;
    html += `<span style="margin-left: 10px; color: var(--text-tertiary);">共 ${total} 条</span>`;
    
    container.innerHTML = html;
}

function goToViolationsPage(page) {
    violationsPage = page;
    loadViolations();
}

document.getElementById('violation-account-filter').addEventListener('change', () => {
    violationsPage = 1;
    loadViolations();
});

// 搜索框防抖：输入停顿 300ms 后触发查询
let violationSearchTimer = null;
document.getElementById('violation-search').addEventListener('input', () => {
    clearTimeout(violationSearchTimer);
    violationSearchTimer = setTimeout(() => {
        violationsPage = 1;
        loadViolations();
    }, 300);
});

document.getElementById('check-all-violations').addEventListener('change', (e) => {
    document.querySelectorAll('.violation-check').forEach(cb => {
        cb.checked = e.target.checked;
    });
});

document.getElementById('btn-export-violations').addEventListener('click', () => {
    const accountId = document.getElementById('violation-account-filter').value;
    const keyword = document.getElementById('violation-search').value.trim();
    let url = `/api/violations/export?format=csv`;
    if (accountId) url += `&accountId=${accountId}`;
    if (keyword) url += `&keyword=${encodeURIComponent(keyword)}`;
    window.open(url, '_blank');
});

// 一键删除违规文件（从网盘删除，移入回收站）
document.getElementById('btn-delete-violation-files').addEventListener('click', async (e) => {
    const accountId = document.getElementById('violation-account-filter').value;
    if (!accountId) {
        showToast('请先在左上角筛选出要操作的账号', 'error');
        return;
    }

    const selected = [...document.querySelectorAll('.violation-check:checked')].map(cb => cb.dataset.id);
    const scope = selected.length > 0 ? `选中的 ${selected.length} 个` : '该账号下全部未删除的';
    if (!confirm(`确定要从百度网盘中删除${scope}违规文件吗？\n\n文件将移入网盘回收站，回收站清空后不可恢复！`)) return;

    await runDeleteWithProgress('/api/violations/delete-files', { accountId, ids: selected }, e.currentTarget, loadViolations);
});

document.getElementById('btn-clear-violations').addEventListener('click', async () => {
    if (!confirm('确定要清空所有违规记录吗？此操作不可恢复！')) return;
    
    const accountId = document.getElementById('violation-account-filter').value;
    try {
        const res = await API.post('/api/violations/clear', { accountId });
        if (res.success) {
            showToast('已清空', 'success');
            loadViolations();
        } else {
            showToast(res.message || '操作失败', 'error');
        }
    } catch (e) {
        showToast('操作失败: ' + e.message, 'error');
    }
});

async function deleteViolation(id) {
    if (!confirm('确定删除这条记录吗？')) return;
    
    try {
        const res = await API.delete(`/api/violations/${id}`);
        if (res.success) {
            showToast('已删除', 'success');
            loadViolations();
        } else {
            showToast(res.message || '删除失败', 'error');
        }
    } catch (e) {
        showToast('删除失败: ' + e.message, 'error');
    }
}

// ========== 文件浏览 ==========

let currentFilePath = '/';
let currentFileAccount = null;
let fileListPage = 1;         // 文件浏览当前页
const FILE_LIST_SIZE = 100;   // 文件浏览每页条数

function loadFileAccounts() {
    const select = document.getElementById('file-account');
    if (select.options.length <= 1) {
        // 还没加载账号
        loadAccounts();
    }
}

document.getElementById('file-account').addEventListener('change', (e) => {
    currentFileAccount = e.target.value;
    currentFilePath = '/';
    if (currentFileAccount) {
        loadFileList();
    }
});

async function loadFileList(page = 1) {
    if (!currentFileAccount) return;
    fileListPage = page;

    updateFilePathNav();

    const tbody = document.getElementById('files-body');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">加载中...</td></tr>';

    try {
        const res = await API.get(`/api/files?accountId=${currentFileAccount}&dir=${encodeURIComponent(currentFilePath)}&num=${FILE_LIST_SIZE}&page=${page}`);
        if (res.success) {
            const files = res.data.list || [];

            let html = '';
            if (page === 1 && currentFilePath !== '/') {
                html += `
                    <tr>
                        <td colspan="4">
                            <span class="file-icon">⬆️</span>
                            <a href="javascript:void(0)" onclick="goToFileParent()">返回上级</a>
                        </td>
                    </tr>
                `;
            }

            if (files.length === 0 && page === 1) {
                html += `<tr><td colspan="4" class="text-center text-muted">${currentFilePath === '/' ? '网盘为空' : '此目录为空'}</td></tr>`;
            } else {
                // 文件夹在前（单页内排序）
                const dirs = files.filter(f => f.isdir === 1);
                const fileList = files.filter(f => f.isdir === 0);

                html += dirs.map(f => `
                    <tr>
                        <td>
                            <a href="javascript:void(0)" onclick="enterFileDir('${escapeJs(f.path)}')">
                                ${getFileIcon(f.server_filename, 1)}${escapeHtml(f.server_filename)}
                            </a>
                        </td>
                        <td>-</td>
                        <td>${formatDate(f.server_mtime * 1000)}</td>
                        <td>
                            <div class="action-btns">
                                <button class="action-btn" onclick="checkThisFile('${escapeJs(f.path)}')">检测此目录</button>
                            </div>
                        </td>
                    </tr>
                `).join('');

                html += fileList.map(f => `
                    <tr>
                        <td>${getFileIcon(f.server_filename, 0)}${escapeHtml(f.server_filename)}</td>
                        <td>${formatSize(f.size)}</td>
                        <td>${formatDate(f.server_mtime * 1000)}</td>
                        <td>-</td>
                    </tr>
                `).join('');
            }

            tbody.innerHTML = html;

            // 网盘接口无总数，用 has_more 判断是否还有下一页
            const hasMore = res.data.has_more === 1 || files.length >= FILE_LIST_SIZE;
            renderFilesPagination(page, hasMore);
        } else {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">${escapeHtml(res.message)}</td></tr>`;
            document.getElementById('files-pagination').innerHTML = '';
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">加载失败: ${escapeHtml(e.message)}</td></tr>`;
        document.getElementById('files-pagination').innerHTML = '';
    }
}

function renderFilesPagination(page, hasMore) {
    const container = document.getElementById('files-pagination');
    if (page <= 1 && !hasMore) {
        container.innerHTML = '';
        return;
    }
    container.innerHTML =
        `<button ${page <= 1 ? 'disabled' : ''} onclick="loadFileList(${page - 1})">上一页</button>` +
        `<button class="active">${page}</button>` +
        `<button ${!hasMore ? 'disabled' : ''} onclick="loadFileList(${page + 1})">下一页</button>`;
}

function updateFilePathNav() {
    const nav = document.getElementById('path-nav');
    const parts = currentFilePath.split('/').filter(Boolean);
    
    let html = '<span class="path-item" onclick="navigateToFileDir(\'/\')">根目录</span>';
    let currentPath = '';
    
    parts.forEach(part => {
        currentPath += '/' + part;
        html += `<span class="path-separator">/</span>`;
        html += `<span class="path-item" onclick="navigateToFileDir('${escapeJs(currentPath)}')">${escapeHtml(decodeURIComponent(part))}</span>`;
    });
    
    nav.innerHTML = html;
}

function navigateToFileDir(path) {
    currentFilePath = path;
    loadFileList();
}

function enterFileDir(path) {
    currentFilePath = path;
    loadFileList();
}

function goToFileParent() {
    const parts = currentFilePath.split('/').filter(Boolean);
    parts.pop();
    currentFilePath = '/' + parts.join('/');
    if (currentFilePath === '//') currentFilePath = '/';
    loadFileList();
}

function checkThisFile(path) {
    // 切换到检测标签页并设置目录
    document.querySelector('.nav-item[data-tab="check"]').click();
    document.getElementById('check-dir').value = path;
    showToast('已切换到检测页面，目录已设置', 'success');
}

// ========== 重复文件扫描 ==========

let dupeTaskId = null;
let dupePollTimer = null;
let dupeCurrentScan = null;   // 当前查看的扫描快照 {id, account_id, ...}
let dupeGroupsPage = 1;       // 结果分组当前页
const DUPE_PAGE_SIZE = 50;    // 每页渲染的分组数
let dupeKeyword = '';         // 结果分组搜索词
let dupeCheckedPaths = new Set(); // 勾选待删的文件路径（跨页/搜索保持）
let dupeHistoryList = [];     // 历史扫描列表缓存
let dupeHistoryPage = 1;      // 历史扫描当前页
const DUPE_HISTORY_SIZE = 10; // 历史扫描每页条数

document.getElementById('btn-start-dupes').addEventListener('click', async () => {
    const accountId = document.getElementById('dupe-account').value;
    const dir = document.getElementById('dupe-dir').value.trim() || '/';
    if (!accountId) {
        showToast('请选择账号', 'error');
        return;
    }

    const res = await API.post('/api/dupes/scan', { accountId, dir });
    if (!res.success) {
        showToast(res.message || '启动扫描失败', 'error');
        return;
    }

    dupeTaskId = res.data.taskId;
    document.getElementById('btn-start-dupes').style.display = 'none';
    document.getElementById('btn-stop-dupes').style.display = '';
    document.getElementById('dupe-progress-card').style.display = '';
    document.getElementById('dupe-stat-scanned').textContent = '0';
    showToast('扫描已开始', 'success');

    dupePollTimer = setInterval(pollDupeProgress, 1000);
});

document.getElementById('btn-stop-dupes').addEventListener('click', async () => {
    if (!dupeTaskId) return;
    await API.post(`/api/dupes/stop/${dupeTaskId}`);
    showToast('已停止扫描', 'info');
});

async function pollDupeProgress() {
    if (!dupeTaskId) return;
    const res = await API.get(`/api/dupes/progress/${dupeTaskId}`);
    if (!res.success) {
        stopDupePolling();
        return;
    }
    const p = res.data;
    document.getElementById('dupe-stat-scanned').textContent = p.total;
    document.getElementById('dupe-current-dir').textContent = p.isRunning ? `正在收集: ${p.currentDir}` : '';

    if (!p.isRunning) {
        stopDupePolling();
        loadDupeScans();
        if (!p.isStopped && p.savedScanId) {
            showToast(`扫描完成：${p.stats.groups} 组重复，可释放 ${formatSize(p.stats.reclaimable)}`, 'success');
            viewDupeScan(p.savedScanId);
        } else if (p.isStopped) {
            showToast('扫描已停止', 'info');
        }
    }
}

function stopDupePolling() {
    if (dupePollTimer) clearInterval(dupePollTimer);
    dupePollTimer = null;
    dupeTaskId = null;
    document.getElementById('btn-start-dupes').style.display = '';
    document.getElementById('btn-stop-dupes').style.display = 'none';
}

// 历史扫描列表（前端分页）
async function loadDupeScans() {
    const accountId = document.getElementById('dupe-account').value;
    const url = accountId ? `/api/dupes/scans?accountId=${accountId}` : '/api/dupes/scans';
    const res = await API.get(url);

    if (!res.success) {
        document.getElementById('dupe-history-body').innerHTML = '<tr><td colspan="6" class="text-center text-muted">暂无扫描记录</td></tr>';
        document.getElementById('dupe-history-pagination').innerHTML = '';
        return;
    }
    dupeHistoryList = res.data;
    renderDupeHistory();
}

function renderDupeHistory() {
    const body = document.getElementById('dupe-history-body');
    const pagination = document.getElementById('dupe-history-pagination');

    if (dupeHistoryList.length === 0) {
        body.innerHTML = '<tr><td colspan="6" class="text-center text-muted">暂无扫描记录</td></tr>';
        pagination.innerHTML = '';
        return;
    }

    const totalPages = Math.ceil(dupeHistoryList.length / DUPE_HISTORY_SIZE);
    if (dupeHistoryPage > totalPages) dupeHistoryPage = totalPages;
    const offset = (dupeHistoryPage - 1) * DUPE_HISTORY_SIZE;
    const pageItems = dupeHistoryList.slice(offset, offset + DUPE_HISTORY_SIZE);

    body.innerHTML = pageItems.map(s => `
        <tr>
            <td>${formatDate(s.created_at)}</td>
            <td class="filename-cell" title="${escapeHtml(s.dir)}">${escapeHtml(s.dir)}</td>
            <td>${s.total_files}</td>
            <td>${s.stats.groups}</td>
            <td>${formatSize(s.stats.reclaimable)}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="viewDupeScan(${s.id})">查看</button>
                <button class="btn btn-sm btn-danger" onclick="removeDupeScan(${s.id})">删除</button>
            </td>
        </tr>
    `).join('');

    if (totalPages <= 1) {
        pagination.innerHTML = `<span style="color: var(--text-tertiary);">共 ${dupeHistoryList.length} 条</span>`;
        return;
    }
    const p = dupeHistoryPage;
    let html = `<button ${p <= 1 ? 'disabled' : ''} onclick="goToDupeHistoryPage(${p - 1})">上一页</button>`;
    const start = Math.max(1, p - 2);
    const end = Math.min(totalPages, p + 2);
    for (let i = start; i <= end; i++) {
        html += `<button class="${i === p ? 'active' : ''}" onclick="goToDupeHistoryPage(${i})">${i}</button>`;
    }
    html += `<button ${p >= totalPages ? 'disabled' : ''} onclick="goToDupeHistoryPage(${p + 1})">下一页</button>`;
    html += `<span style="margin-left: 10px; color: var(--text-tertiary);">共 ${dupeHistoryList.length} 条</span>`;
    pagination.innerHTML = html;
}

function goToDupeHistoryPage(page) {
    dupeHistoryPage = page;
    renderDupeHistory();
}

document.getElementById('dupe-account').addEventListener('change', () => {
    dupeHistoryPage = 1;
    loadDupeScans();
});

async function removeDupeScan(id) {
    if (!confirm('删除这条扫描记录？（不会删除网盘文件）')) return;
    const res = await API.delete(`/api/dupes/scans/${id}`);
    if (res.success) {
        showToast('已删除', 'success');
        document.getElementById('dupe-results').style.display = 'none';
        dupeCurrentScan = null;
        dupeCheckedPaths = new Set();
        loadDupeScans();
    }
}

// 查看某次扫描的完整结果
// keepSelection=true 时保留当前勾选（删除后刷新用），否则重置为默认勾选
async function viewDupeScan(id, keepSelection = false) {
    const res = await API.get(`/api/dupes/scans/${id}`);
    if (!res.success) {
        showToast(res.message || '加载失败', 'error');
        return;
    }
    dupeCurrentScan = res.data;

    if (!keepSelection) {
        // 默认勾选：每组除「推荐保留」外未删除的文件
        dupeCheckedPaths = new Set();
        for (const g of dupeCurrentScan.groups) {
            g.files.forEach((f, fi) => {
                if (fi !== 0 && !f.deleted) dupeCheckedPaths.add(f.path);
            });
        }
        dupeGroupsPage = 1;
        dupeKeyword = '';
        document.getElementById('dupe-search').value = '';
    } else {
        // 已删除的文件从勾选集中移除
        for (const g of dupeCurrentScan.groups) {
            for (const f of g.files) {
                if (f.deleted) dupeCheckedPaths.delete(f.path);
            }
        }
    }

    renderDupeResults();
}

// 当前过滤后的分组列表
function getFilteredDupeGroups() {
    if (!dupeCurrentScan) return [];
    const kw = dupeKeyword.toLowerCase();
    if (!kw) return dupeCurrentScan.groups;
    return dupeCurrentScan.groups.filter(g =>
        g.files.some(f =>
            (f.filename || '').toLowerCase().includes(kw) ||
            (f.path || '').toLowerCase().includes(kw)
        )
    );
}

function renderDupeResults() {
    const scan = dupeCurrentScan;
    if (!scan) return;

    document.getElementById('dupe-results').style.display = '';
    document.getElementById('dupe-stat-groups').textContent = scan.stats.groups;
    document.getElementById('dupe-stat-files').textContent = scan.stats.files;
    document.getElementById('dupe-stat-reclaim').textContent = formatSize(scan.stats.reclaimable);

    const container = document.getElementById('dupe-groups');
    const filtered = getFilteredDupeGroups();

    if (filtered.length === 0) {
        container.innerHTML = `<div class="card"><p class="text-muted text-center">${dupeKeyword ? '没有匹配的重复组' : '没有发现重复文件'}</p></div>`;
        renderDupePagination(0);
        updateDupeCheckedCount();
        return;
    }

    // 分页（只渲染当前页的分组，避免大数据量卡死页面）
    const totalPages = Math.ceil(filtered.length / DUPE_PAGE_SIZE);
    if (dupeGroupsPage > totalPages) dupeGroupsPage = totalPages;
    const offset = (dupeGroupsPage - 1) * DUPE_PAGE_SIZE;
    const pageGroups = filtered.slice(offset, offset + DUPE_PAGE_SIZE);

    container.innerHTML = pageGroups.map((g, pi) => {
        const gi = offset + pi;
        return `
        <div class="card dupe-group">
            <div class="dupe-group-header">
                <span>#${gi + 1} ${escapeHtml(g.files[0].filename)}</span>
                <span class="text-muted">${formatSize(g.size)} × ${g.count}，可释放 ${formatSize(g.size * (g.count - 1))}</span>
            </div>
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th style="width:40px;">删除</th>
                            <th>文件</th>
                            <th>路径</th>
                            <th>修改时间</th>
                            <th>标记</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${g.files.map((f, fi) => {
                            const isKeep = fi === 0;
                            return `
                            <tr class="${f.deleted ? 'dupe-row-deleted' : ''}">
                                <td>
                                    <input type="checkbox" class="dupe-check" data-path="${escapeHtml(f.path)}"
                                        ${dupeCheckedPaths.has(f.path) && !f.deleted ? 'checked' : ''} ${f.deleted ? 'disabled' : ''}>
                                </td>
                                <td class="filename-cell" title="${escapeHtml(f.path)}">${getFileIcon(f.filename, 0)} ${escapeHtml(f.filename)}</td>
                                <td class="filename-cell" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</td>
                                <td>${f.mtime ? formatDate(f.mtime * 1000) : '-'}</td>
                                <td>
                                    ${f.deleted ? '<span class="badge badge-success">已删除</span>' : ''}
                                    ${isKeep && !f.deleted ? '<span class="badge badge-primary">推荐保留</span>' : ''}
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>`;
    }).join('');

    renderDupePagination(filtered.length);
    updateDupeCheckedCount();
}

function renderDupePagination(filteredCount) {
    const container = document.getElementById('dupe-pagination');
    const totalPages = Math.ceil(filteredCount / DUPE_PAGE_SIZE);

    if (totalPages <= 1) {
        container.innerHTML = filteredCount > 0 ? `<span style="color: var(--text-tertiary);">共 ${filteredCount} 组</span>` : '';
        return;
    }

    const page = dupeGroupsPage;
    let html = `<button ${page <= 1 ? 'disabled' : ''} onclick="goToDupePage(${page - 1})">上一页</button>`;

    const start = Math.max(1, page - 2);
    const end = Math.min(totalPages, page + 2);
    for (let i = start; i <= end; i++) {
        html += `<button class="${i === page ? 'active' : ''}" onclick="goToDupePage(${i})">${i}</button>`;
    }

    html += `<button ${page >= totalPages ? 'disabled' : ''} onclick="goToDupePage(${page + 1})">下一页</button>`;
    html += `<span style="margin-left: 10px; color: var(--text-tertiary);">共 ${filteredCount} 组</span>`;

    container.innerHTML = html;
}

function goToDupePage(page) {
    dupeGroupsPage = page;
    renderDupeResults();
    document.getElementById('dupe-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// 搜索过滤（防抖）
let dupeSearchTimer = null;
document.getElementById('dupe-search').addEventListener('input', (e) => {
    clearTimeout(dupeSearchTimer);
    dupeSearchTimer = setTimeout(() => {
        dupeKeyword = e.target.value.trim();
        dupeGroupsPage = 1;
        renderDupeResults();
    }, 300);
});

// 勾选变化（事件委托）：勾选状态存入 Set，翻页/搜索后不丢失
document.getElementById('dupe-groups').addEventListener('change', (e) => {
    if (!e.target.classList.contains('dupe-check')) return;
    const path = e.target.dataset.path;
    if (e.target.checked) {
        dupeCheckedPaths.add(path);
    } else {
        dupeCheckedPaths.delete(path);
    }
    updateDupeCheckedCount();
});

function updateDupeCheckedCount() {
    document.getElementById('dupes-checked-count').textContent = dupeCheckedPaths.size;
    document.getElementById('btn-dupes-delete').style.display = dupeCheckedPaths.size > 0 ? '' : 'none';
}

// 一键删除选中的重复文件
document.getElementById('btn-dupes-delete').addEventListener('click', async (e) => {
    if (!dupeCurrentScan) return;

    const paths = [...dupeCheckedPaths];
    if (paths.length === 0) return;

    // 每组至少保留1个未勾选的，防误删整组（基于完整数据校验，不受分页影响）
    for (const g of dupeCurrentScan.groups) {
        const alive = g.files.filter(f => !f.deleted);
        if (alive.length > 0 && alive.every(f => dupeCheckedPaths.has(f.path))) {
            showToast('每组至少要保留 1 个文件，请取消某组的一个勾选', 'error');
            return;
        }
    }

    if (!confirm(`确定删除选中的 ${paths.length} 个重复文件？\n文件将移入网盘回收站。`)) return;

    const scanId = dupeCurrentScan.id;
    const accountId = dupeCurrentScan.account_id;
    await runDeleteWithProgress('/api/dupes/delete', { accountId, scanId, paths }, e.currentTarget, () => {
        viewDupeScan(scanId, true);   // 刷新标记，保留剩余勾选
    });
});

// ========== 辅助函数 ==========

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function escapeJs(str) {
    return str.replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

// ========== 初始化 ==========

window.addEventListener('DOMContentLoaded', () => {
    loadAccounts();
});
