# Mafuyu Sekai: Neon Remake

## Web
- 新入口：Next.js 页面 `/`（`npm run dev` 后打开 http://localhost:3000）。
- 仍保留独立静态版：`/dx.html`（位于 `public/dx.html`，也可直接访问 http://localhost:3000/dx.html）。
- 首次点击 “ENGAGE” 会初始化音频，请允许浏览器播放声音。

## 资源
- 图像：`public/assets/images/*.png`
- 背景音乐：`public/assets/music/bg.mp3`
- 射击音效：`public/sound/shot.wav`

## 操作
- 移动：W/A/S/D
- 瞄准射击：鼠标移动 + 左键
- 战术冲刺：R 或鼠标右键
- 清屏炸弹：Space

## 开发与部署
- 安装依赖：`npm install`
- 开发：`npm run dev`
- 构建：`npm run build`
- 生产预览：`npm start`
- 部署 Vercel：`vercel --prod`（默认使用 Next.js 输出）
- Electron 启动入口指向 `public/dx.html`，如需桌面版可按需添加 Electron 依赖。
