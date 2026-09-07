# Laniakea 图标

2026-09-07 用户批准金色星系流线方案。偏心汇聚的金白光束与深靛背景是本版
识别特征，沿用批准稿的形状、配色与光感，不重新抽象为圆点连接或生物状团块。

- `approved-concept.png`：用户批准的原始提案，由 imagegen 根据用户提供的
  超星系群可视化参考生成；用于确认设计，不直接打包。
- `app-icon.png`：1024 × 1024 RGBA 生产母版，去掉提案外围浅灰展示底，保留
  原稿图像内容，规范为方形图标和透明留白。
- `app-icon-maskable.png`：供系统裁切的深色不透明母版。

运行 `npm run build:icons` 从母版导出桌面图标、网页 favicon、Apple touch icon
和 PWA 图标。导出使用仓库已有的 Tauri CLI，不依赖图像生成服务。原先的圆点 SVG
已移除，避免不同入口继续显示旧品牌；不把包含位图的容器伪称为矢量源文件。
Tauri 同时生成既有目录中的其他平台资源，这不代表新增平台运行支持。

背景参考：[Laniakea 可视化制作说明](https://blogs.nature.com/blog/under-the-covers-nature-revealed-4-september-2014/)。
参考的流线表达星系速度场；本图标是经用户批准的艺术抽象，不是科学数据图。
