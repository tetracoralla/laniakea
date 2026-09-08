# Laniakea 图标

当前图标使用四条金色光带，以兼顾远看和小尺寸辨识度。
以 `approved-a.png` 为当前定稿：深靛底、偏心的细汇聚点，以及在图标边缘
被截断的四条光带。保持定稿的轮廓、比例、曲线、配色和留白；不能把光带
收成图标内部的尖端，不能改成三条，也不能擅自加厚汇聚处。

- `approved-a.png`：1254 × 1254 定稿原图，逐字节保留，不直接打包。
- `approved-concept.png`：此前细光丝星系方案的历史提案，已被 A 方案替代。
- `app-icon.png`：1024 × 1024 RGBA 生产母版，只处理原图四角的展示底和边缘
  透明度，再等比缩放并保留与既有桌面图标一致的透明外留白；不重绘内部图形。
- `app-icon-maskable.png`：把同一母版的透明区域填为深靛色，供系统裁切。

运行 `npm run build:icons` 从母版导出桌面图标、网页 favicon、Apple touch icon
和 PWA 图标。导出使用仓库已有的 Tauri CLI，不依赖图像生成服务。原先的圆点 SVG
已移除，避免不同入口继续显示旧品牌；不把包含位图的容器伪称为矢量源文件。
Tauri 同时生成既有目录中的其他平台资源，这不代表新增平台运行支持。

背景参考：[Laniakea 可视化制作说明](https://blogs.nature.com/blog/under-the-covers-nature-revealed-4-september-2014/)。
参考的流线表达星系速度场；历史提案与当前图标均为艺术抽象，不是科学数据图。
