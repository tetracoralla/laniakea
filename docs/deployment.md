# 网页发布

## GitHub Pages

公开仓库：<https://github.com/tetracoralla/laniakea>

网页地址：<https://tetracoralla.github.io/laniakea/>

`.github/workflows/deploy-pages.yml` 在 `main` 更新时执行依赖安装、前端测试和构建，然后发布 `dist/`。Vite 使用相对资源路径，因此应用可以在 GitHub Pages 的 `/laniakea/` 子路径运行。

项目不依赖外部 CDN、账号、数据库或应用服务器。浏览器文档使用 IndexedDB，Service Worker 只缓存应用外壳以便离线重新打开。

## 首次公开发布（已完成）

1. 创建公开仓库 `tetracoralla/laniakea`，默认分支为 `main`。
2. 推送已经通过验证的提交。
3. 在仓库 Settings → Pages 中选择 GitHub Actions 作为来源。
4. 等待 `Deploy to GitHub Pages` 工作流完成。
5. 在正式 HTTPS 地址执行下面的发布验收。

当前公开版不附带 macOS 安装包。本地构建仍采用临时签名；待 Apple Developer 签名和公证流程完成后，再提供可供普通用户安装的桌面包。

## 发布验收

- 在 1440px 桌面和横向平板宽度打开应用，确认画布与工具栏可用。
- 新建 A、编辑、再新建 B、编辑，切回 A 后刷新页面，确认两张图及各自视口仍在。
- 导入 Markdown，修改后另存为 Markdown，确认内容可再次导入。
- 导出完整备份，在另一浏览器配置中恢复，确认所有文档和视口均存在。
- 同时打开两个标签页编辑同一张图，确认旧标签页不能静默覆盖新版本。
- 在线成功打开一次后断网重启，确认应用外壳和已有浏览器文档可用。
- 确认网页版没有唤醒快捷键、访达路径或桌面草稿移动等无效操作。

第一版正式支持桌面浏览器和横向平板，不宣称手机端完整编辑体验。
