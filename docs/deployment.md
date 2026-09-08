# 网页发布

## GitHub Pages

公开仓库：<https://github.com/tetracoralla/laniakea>

网页地址：<https://tetracoralla.github.io/laniakea/>

`.github/workflows/deploy-pages.yml` 在 `main` 更新时执行依赖安装、前端测试和构建，然后发布 `dist/`。Vite 使用相对资源路径，因此应用可以在 GitHub Pages 的 `/laniakea/` 子路径运行。

项目不依赖外部 CDN、账号、数据库或应用服务器。浏览器文档使用 IndexedDB，Service Worker 只缓存应用外壳以便离线重新打开。

源码仓库从官方 npm registry 精确锁定
`@openadam/graph-view-compiler@0.5.0`；`npm ci` 不依赖开发者电脑上的相邻仓库或
仓库内临时 tarball。
网页、Tauri 桌面包和 Codex Plugin 都会把该运行时代码打进自身产物，普通用户不需要
单独安装 Node 或图引擎。Flow 数据格式与业务代码不因共享包升级而改变。依赖检查会同时
验证 manifest、lockfile、官方 registry 地址、不可变包摘要、安装版本、人工走廊契约和
三个公开入口，避免回退到镜像、相邻仓库或未经审核的包内容。

## 首次公开发布（已完成）

1. 创建公开仓库 `tetracoralla/laniakea`，默认分支为 `main`。
2. 推送已经通过验证的提交。
3. 在仓库 Settings → Pages 中选择 GitHub Actions 作为来源。
4. 等待 `Deploy to GitHub Pages` 工作流完成。
5. 在正式 HTTPS 地址执行下面的发布验收。

当前公开版不附带桌面安装包。macOS 的交付路线是网页直下 DMG；不需要提交 Mac App Store。Developer ID 签名和公证用于网站下载后的系统信任，与应用商店审核是不同的流程。本地临时签名可验证构建与运行，但不能证明普通用户下载后能顺利首次打开。

源码、网页版与 Codex Plugin 的版本可以先通过普通 GitHub Release 发布，不把缺少
签名的本地 `.app` 或 DMG 作为 Release 资产。`.github/workflows/release-macos.yml`
只接受人工触发：当一个 Release tag 已存在并且 Apple Developer 凭据已配置时，
它才会为该同版本 Release 构建、验证并上传通用架构 DMG。这样源码发布不会制造
一个注定失败的签名任务，桌面二进制也仍然保持凭据、签名、公证和 Gatekeeper
检查全部失败关闭。

## 桌面候选包

`0.3.6` 是本轮尚未发布的候选版本。`.github/workflows/desktop-candidates.yml`
在 PR 或人工触发时构建 macOS 通用 DMG 和 Windows x64 NSIS 安装程序，只存为
工作流产物，不创建 Release、不替换公开资产。Windows 使用自动合并的
`src-tauri/tauri.windows.conf.json`，按当前用户安装，包含 WebView2 离线安装器，
无需用户另外找运行时。Windows ARM 原生包与 Linux 包尚未提供。

本地 macOS 构建与包内容检查：

```bash
npm ci
npm run check:regression
npm run desktop:build -- --bundles dmg
node scripts/checkMacDmg.mjs src-tauri/target/release/bundle/dmg/*.dmg
node scripts/writeArtifactChecksums.mjs src-tauri/target/release/bundle/dmg/*.dmg
```

默认仅构建本机架构；通用包需安装两个 Rust macOS target 并增加
`--target universal-apple-darwin`。产物附 `.sha256` 和 `.build.json`，后者记录
版本、提交、源码是否有未提交改动和产物摘要。公开工作流拒绝脏源码；本地候选如实
记录，不把摘要当作发行者签名或运行验证。

Windows runner 执行相同开发回归，构建后在临时目录静默安装，核对版本与许可资源，
验证窗口出现和关闭后进程退出。这不覆盖输入、保存、重开及升级保留数据；这些真实
Windows 流程仍是首次公开 Windows 包前待取得的证据。工作流成功也不代表安装程序
已具备发行者签名。发布时逐平台写明已验证的系统/架构与签名状态，附同批校验和，
不覆盖已有版本资产。

原生许可清单根据目标平台从锁定依赖图生成。macOS 包含两个架构的依赖并集，Windows
包含 x64 MSVC 依赖；缺少原始许可文本、补充文件摘要或来源不符均使构建失败。
可用 `LANIAKEA_NOTICE_TARGETS=x86_64-pc-windows-msvc npm run build:desktop-notices`
单独检查 Windows 许可图，但该命令不证明 Windows 编译或运行成功。

分发机制参考：[Tauri Windows 安装程序](https://v2.tauri.app/distribute/windows-installer/)、
[Apple：安全打开 Mac App](https://support.apple.com/en-gb/102445)。

## 发布验收

### 本机安装与开发隔离

桌面日常入口是 `/Applications/Laniakea.app`。用 `npm run desktop:build -- --bundles app`
生成完整应用后，退出旧应用、备份旧包，再将生成的 `.app` 复制到 Applications；不要把
源码目录下的构建结果或开发服务器当作日常入口。应用包含前端与图引擎，运行不需要
源码、Node、`node_modules` 或 Vite。每次安装更新使用新的版本号，并核对安装包字节
及实际启动路径，不能只凭相同的版本文字判断是否已更新。

现有 `com.openadam.origin` 标识保持不变，以延续草稿、最近文档、恢复与快捷键设置。
应用内部状态留在系统 Application Support 目录，用户自己的 Markdown 留在其选择的
目录；替换 `.app` 不删除或迁移这些内容。构建、安装备份、用户文档是不同目录。
当前本机构建仍为临时签名，不能作为已公证的公开 macOS 安装包发布。

Agent Host 使用带文件摘要的独立组件包，以及它管理的 Node 和宿主投影，不从源码
目录启动 MCP。Laniakea 是 Host 兼容发行内置组件时，用 Host 的发行更新入口更新，
不能通过私有组件导入覆盖同名组件。更新应保留其他组件的版本、校验摘要和活动工具集，
仅追加用户需要的 Laniakea。组件存在、启用和实际工具调用成功须分别确认；接入修改后
新建 Agent 任务加载新工具，已打开任务不保证热更新。

人和 Agent 通过同一份明确路径的 Markdown 交接。Agent 更新前读取 revision，再带该
revision 提交；应用仍打开旧版本时不会自动合并，继续保存应报告冲突并保留磁盘版本。
可重新打开文件读取 Agent 结果，或把应用内未提交的修改另存为副本。根思维图可读写；
Map/Flow 子空间仍只有有界只读预览，不宣称支持 Agent 编辑子空间。

### 网页检查

- 在 1440px 桌面和横向平板宽度打开应用，确认画布与工具栏可用。
- 新建 A、编辑、再新建 B、编辑，切回 A 后刷新页面，确认两张图及各自视口仍在。
- 导入 Markdown，修改后另存为 Markdown，确认内容可再次导入。
- 导出完整备份，在另一浏览器配置中恢复，确认所有文档和视口均存在。
- 同时打开两个标签页编辑同一张图，确认旧标签页不能静默覆盖新版本。
- 在线成功打开一次后断网重启，确认应用外壳和已有浏览器文档可用。
- 确认网页版没有唤醒快捷键、访达路径或桌面草稿移动等无效操作。

第一版正式支持桌面浏览器和横向平板，不宣称手机端完整编辑体验。
