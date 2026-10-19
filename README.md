# Netdisk Cleaner

免费开源的网盘清理工具：检测被和谐的违规文件、扫描重复文件、批量清理。本地运行，数据不出机。

Free & open-source Baidu Netdisk cleaner: detect harmonized (blocked) files, find duplicates, and batch-clean them. Runs locally — your cookies and data never leave your machine.

## 功能特性

- **和谐文件检测**：通过下载直链可达性判定，精准识别无法下载的文件（含元数据正常但无法获取直链的文件）
- **重复文件扫描**：按 大小+MD5 内容级判重，智能推荐保留项，一键清理冗余
- **账号管理**：浏览器自动登录（推荐）或手动粘贴 Cookie，支持多账号、代理
- **文件浏览**：网页端浏览网盘目录，直接删除/移动文件
- **违规记录**：检测结果持久化，支持导出 CSV、一键删除违规文件
- **搜索与分页**：违规记录、重复文件分组、历史扫描、文件浏览均支持关键词搜索与翻页
- **删除进度**：大批量删除实时进度反馈，任务式异步执行
- **抗限流**：自动识别限流信号（含 errno 8001），指数退避等待恢复，不死磕不误判

## 快速开始

### 环境要求

- Windows / macOS / Linux
- Node.js ≥ 16（Windows 用户也可以直接把 `node.exe` 放到程序目录）

### 安装运行

```bash
npm install
npm start
```

然后浏览器访问 http://localhost:37471

Windows 用户也可以双击 `start.bat`（自动检测环境、启动并打开浏览器），`stop.bat` 停止。

### 打包成 exe（可选）

**方式一：pkg 单文件（轻量，命令行）**

```bash
npm install -g pkg
npm run build
# 产物在 dist/baidu-pan-cleaner.exe
```

**方式二：Electron 桌面应用（推荐，有图形界面）**

```bash
npm install --save-dev electron electron-builder
npm run dist
# 产物在 dist/NetdiskCleaner-portable.exe（便携版，数据目录跟随 exe）
```

## 使用文档

| 文档 | 说明 |
|---|---|
| [docs/accounts.md](docs/accounts.md) | 账号添加：浏览器自动登录 / 手动 Cookie / 代理 |
| [docs/violation-check.md](docs/violation-check.md) | 和谐文件检测：原理、参数、结果处理 |
| [docs/duplicates.md](docs/duplicates.md) | 重复文件扫描：判重原理、智能保留、清理 |
| [docs/file-manager.md](docs/file-manager.md) | 文件浏览与违规记录管理 |
| [docs/api.md](docs/api.md) | HTTP API 参考（供二次开发） |
| [docs/faq.md](docs/faq.md) | 常见问题：限流、错误码、误判排查 |

## 技术栈

- 后端：Node.js + Express，百度网盘 Web API
- 前端：原生 HTML/CSS/JS，无构建步骤
- 存储：JSON 文件（`data/data.json`，运行时自动生成）
- 登录：puppeteer-core 调起本机 Chrome/Edge 完成扫码/账号登录

## 检测原理速览

**和谐判定**：通过 `/api/download?type=dlink` 批量请求下载直链（签名素材由服务端下发）。正常文件返回直链；不可下载文件返回 `errno=-1` 或在批量响应中被省略。配合"参照文件健康检查"区分限流与真违规，单文件连续复核才落判，避免误报。

**重复判定**：文件列表接口返回的 MD5（大文件为秒传切片 MD5）+ 文件大小联合判重，零额外请求，不触发下载限流。

## 免责声明

本项目仅供学习与技术交流，不得用于任何商业用途或非法用途。请遵守相关法律法规及百度网盘用户协议，勿用于批量下载、传播侵权内容或干扰服务正常运行。本项目调用的接口可能随服务方策略调整而失效，不保证长期可用。使用本项目产生的一切后果由使用者自行承担，作者不承担任何责任。项目与百度公司无任何关联，「百度」「百度网盘」等商标归原权利人所有。

## License

[MIT](LICENSE)
