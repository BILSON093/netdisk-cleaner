# HTTP API 参考

后端为 Express，默认监听 `http://localhost:37471`。所有响应为 JSON：`{ success: bool, data?: any, message?: string }`。

## 账号

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/accounts` | 账号列表（不含 Cookie） |
| POST | `/api/accounts` | 添加账号 `{ cookies, name?, proxy? }` |
| DELETE | `/api/accounts/:id` | 删除账号（连带其记录） |
| POST | `/api/login/browser/start` | 启动浏览器登录流程 |
| GET | `/api/login/browser/status` | 轮询登录状态 |

## 和谐检测

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/check/start` | 开始检测 `{ accountId, dir?, includeKeywords?, excludeKeywords?, delay?, autoDelete?, movePath? }` → `{ taskId }` |
| GET | `/api/check/progress/:taskId` | 实时进度 `{ total, checked, violation, normal, failed, isRunning, isPaused, results }` |
| POST | `/api/check/pause/:taskId` | 暂停/继续 |
| POST | `/api/check/stop/:taskId` | 停止 |
| GET | `/api/tasks?accountId=` | 历史任务（最近 50） |

## 违规记录

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/violations?accountId=&page=&pageSize=` | 分页查询 |
| POST | `/api/violations/delete-files` | 删除违规文件 `{ accountId, ids? }`，不传 ids 删全部未删 |
| DELETE | `/api/violations` | 清空记录 `{ accountId? }` |
| GET | `/api/violations/export?accountId=&format=csv` | 导出 CSV |

## 重复文件

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/dupes/scan` | 开始扫描 `{ accountId, dir? }` → `{ taskId }` |
| GET | `/api/dupes/progress/:taskId` | 进度 `{ total, currentDir, isRunning, isStopped, stats, savedScanId }` |
| POST | `/api/dupes/stop/:taskId` | 停止（结果不保存） |
| GET | `/api/dupes/scans?accountId=` | 历史扫描列表（不含分组明细） |
| GET | `/api/dupes/scans/:id` | 单次扫描完整结果（含 groups） |
| DELETE | `/api/dupes/scans/:id` | 删除扫描记录 |
| POST | `/api/dupes/delete` | 删除选中文件 `{ accountId, scanId, paths[] }`，自动更新快照标记 |

### 扫描快照结构

```json
{
  "id": 1, "account_id": 3, "dir": "/1/1", "total_files": 14006,
  "stats": { "groups": 143, "files": 144, "reclaimable": 94700000 },
  "groups": [{
    "size": 10426342, "md5": "...", "count": 2,
    "files": [{ "path": "...", "filename": "...", "size": 0, "mtime": 0, "fs_id": 0, "deleted": false }]
  }]
}
```

`groups[].files[0]` 为推荐保留项（最早修改，并列取路径最短）。

## 文件浏览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/files/list?accountId=&dir=&page=&num=` | 目录列表 |
| POST | `/api/files/delete` | 删除 `{ accountId, files[] }` |
| POST | `/api/files/move` | 移动 `{ accountId, files[], dest }` |
| POST | `/api/files/mkdir` | 新建目录 `{ accountId, path }` |

## 系统

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/settings` | 读取设置 |
| POST | `/api/settings` | 保存设置 |

## 关键错误码（百度侧）

| errno | 含义 |
|---|---|
| 0 | 成功 |
| -1 | download 接口：组内有和谐文件 / 通用错误 |
| -6 | 身份验证失败（Cookie 过期） |
| -9 | filemetas：文件不存在或无权访问 |
| 2 | 瞬时错误，重试即可 |
| 109 | 分享接口：文件违规 |
| 113 | 下载签名失效，需重新获取 |
| -7 / -8 / 112 / 429 / 414 / 31034 / 8001 | 频率限制 |
