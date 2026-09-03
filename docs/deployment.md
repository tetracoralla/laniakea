# 网页发布

## GitHub Pages

公开仓库：<https://github.com/tetracoralla/laniakea>

网页地址：<https://tetracoralla.github.io/laniakea/>

`.github/workflows/deploy-pages.yml` 在 `main` 更新时执行依赖安装、前端测试和构建，然后发布 `dist/`。Vite 使用相对资源路径，因此应用可以在 GitHub Pages 的 `/laniakea/` 子路径运行。

项目不依赖外部 CDN、账号、数据库或应用服务器。浏览器文档使用 IndexedDB，Service Worker 只缓存应用外壳以便离线重新打开。

源码仓库从官方 npm registry 精确锁定
`@openadam/graph-view-compiler@0.4.0`；`npm ci` 不依赖开发者电脑上的相邻仓库。
网页、Tauri 桌面包和 Codex Plugin 都会把该运行时代码打进自身产物，普通用户不需要
单独安装 Node 或图引擎。Flow 数据格式与业务代码不因共享包升级而改变。依赖检查会同时
验证 manifest、lockfile、registry 来源、安装版本和三个公开入口，避免回退到本地路径或
未发布版本。

## 首次公开发布（已完成）

1. 创建公开仓库 `tetracoralla/laniakea`，默认分支为 `main`。
2. 推送已经通过验证的提交。
3. 在仓库 Settings → Pages 中选择 GitHub Actions 作为来源。
4. 等待 `Deploy to GitHub Pages` 工作流完成。
5. 在正式 HTTPS 地址执行下面的发布验收。

当前公开版不附带 macOS 安装包。本地构建仍采用临时签名；待 Apple Developer 签名和公证流程完成后，再提供可供普通用户安装的桌面包。

源码、网页版与 Codex Plugin 的版本可以先通过普通 GitHub Release 发布，不把缺少
签名的本地 `.app` 或 DMG 作为 Release 资产。`.github/workflows/release-macos.yml`
只接受人工触发：当一个 Release tag 已存在并且 Apple Developer 凭据已配置时，
它才会为该同版本 Release 构建、验证并上传通用架构 DMG。这样源码发布不会制造
一个注定失败的签名任务，桌面二进制也仍然保持凭据、签名、公证和 Gatekeeper
检查全部失败关闭。

## 发布验收

- 在 1440px 桌面和横向平板宽度打开应用，确认画布与工具栏可用。
- 新建 A、编辑、再新建 B、编辑，切回 A 后刷新页面，确认两张图及各自视口仍在。
- 导入 Markdown，修改后另存为 Markdown，确认内容可再次导入。
- 导出完整备份，在另一浏览器配置中恢复，确认所有文档和视口均存在。
- 同时打开两个标签页编辑同一张图，确认旧标签页不能静默覆盖新版本。
- 在线成功打开一次后断网重启，确认应用外壳和已有浏览器文档可用。
- 确认网页版没有唤醒快捷键、访达路径或桌面草稿移动等无效操作。

第一版正式支持桌面浏览器和横向平板，不宣称手机端完整编辑体验。
