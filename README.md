# Mafuyu Sekai: Neon Remake

## Web 版
- 入口：`dx.html`（HTML5/Canvas 单文件）。
- 直接双击或浏览器打开；如需本地服务器，可运行 `npx serve .` 或 `python -m http.server 8000` 后访问 `/dx.html`。
- 首次点击 “ENGAGE” 会初始化音频，请允许页面播放声音。

## 资源映射
- 背景/角色/敌人/子弹/血包：`assets/images/bg.png`、`player.png`、`enemy.png`、`bullet.png`、`health.png`
- 背景音乐：`assets/music/bg.mp3`
- 射击音效：`sound/shot.wav`

## 操作
- 移动：W/A/S/D
- 瞄准射击：鼠标移动 + 左键
- 战术冲刺：R 或鼠标右键
- 清屏炸弹：Space

## 桌面版（Electron）
- 安装依赖：`npm install`（会拉取 `electron` 与 `electron-packager`）。
- 运行开发版：`npm start`。
- 打包 Windows 桌面版：`npm run pack`（输出到 `dist/`，默认 64 位；如需 32 位在命令后加 `--arch=ia32`）。
- 如需自定义图标，可将 `icon.ico` 放入 `assets/images/`，并在打包命令中追加 `--icon=assets/images/icon.ico`。

## 其他
- 旧的 Python 版已移除，仅保留素材与新的 Web/Electron 架构。 
