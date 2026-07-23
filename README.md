# 原点

一个私密、本地、键盘驱动的思维展开器。打开后直接从中心主题开始，用 `Tab` 和 `Enter` 快速铺开结构，不需要账号、知识库或云端服务。

![原点主界面](docs/design/origin-browser-final.jpg)

## 当前能力

- 从左到右的稳定树形自动布局
- 键盘创建、导航、提升层级、重排、折叠和删除节点
- 统一命令注册表与 `⌘K` 命令面板
- 最近 100 次结构/文本操作的撤销与重做
- 节点搜索与定位
- Markdown 导入、整图/分支复制、Markdown 文件导出
- 可读的 `.mindmap.json` 原生文件导出
- 独立本地文件自动保存、原子替换、最近 8 份备份与损坏恢复
- 鼠标/触控板平移、缩放、适应内容与聚焦节点
- 空白画布框选、Shift/Command 增减选择与批量删除、复制、折叠
- Tauri 2 macOS 桌面外壳
- `⇧⌘M` 全局唤醒并聚焦主窗口

## 运行

```bash
npm install
npm run desktop:dev
```

只运行浏览器开发版本：

```bash
npm run dev
```

构建 macOS 应用与 DMG：

```bash
npm run desktop:build
```

当前产物用于本机运行，采用本地临时签名，尚未使用 Apple Developer 证书签名或公证；分发到其他 Mac 前需要补正式签名与 notarization。

## 高频快捷键

| 操作 | 快捷键 |
| --- | --- |
| 创建同级节点 | `Enter` |
| 创建子节点 | `Tab` |
| 提升一级 | `Shift+Tab` |
| 编辑节点 | 直接输入或按空格 |
| 完成编辑 / 节点内换行 | `Enter` / `Shift+Enter` |
| 删除节点及子树 | `Delete` 或 `Backspace` |
| 选择父/子/同级节点 | 方向键 |
| 扩展选择 | `Shift` + 方向键 |
| 全选可见节点 / 清除选择 | `⌘A` / `Esc` |
| 框选 / 平移画布 | 空白拖动 / `Space` + 拖动 |
| 移动同级顺序 | `⌘↑` / `⌘↓` |
| 折叠或展开 | `⌘/` |
| 撤销 / 重做 | `⌘Z` / `⇧⌘Z` |
| 搜索节点 | `⌘F` |
| 复制当前分支为 Markdown | `⇧⌘C` |
| 打开命令面板 | `⌘K` |
| 全局唤醒应用 | `⇧⌘M` |

桌面版主文件保存在 macOS 的应用数据目录
`~/Library/Application Support/com.openadam.origin/current.mindmap.json`。
写入失败时顶栏会明确显示“保存失败，重试”；应用不会把失败误报为已保存。
每次替换主文件前会保留上一份有效内容，损坏文件会移入 `recovery`
目录，最近 8 份有效版本位于 `backups` 目录。

## 验证

```bash
npm run test
npm run build
cd src-tauri && cargo test
```

产品与交互模型见 [`docs/product-model.md`](docs/product-model.md)，视觉概念见 [`docs/design/origin-primary-screen.png`](docs/design/origin-primary-screen.png)。
