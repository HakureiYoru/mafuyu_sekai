# Mafuyu Sekai: Neon Remake (Web)

当前版本已完全移植为 HTML5/Canvas 单文件，入口在 `dx.html`，直接使用原项目素材（贴图、BGM、音效）。

## 快速运行
1. 直接在浏览器打开 `dx.html`；如需本地服务器可执行 `npx serve .` 后访问 `/dx.html`。
2. 首次点击 “ENGAGE” 会初始化音频上下文，请允许页面播放声音。

## 资源映射
- 背景/角色/敌人/子弹/血包：`assets/images/bg.png`、`player.png`、`enemy.png`、`bullet.png`、`health.png`
- 背景音乐：`assets/music/bg.mp3`
- 射击音效：`sound/shot.wav`

## 操作
- 移动：W/A/S/D
- 瞄准射击：鼠标移动 + 左键
- 战术冲刺：R 或鼠标右键
- 清屏炸弹：Space

旧的 Python 版代码已移除，仅保留素材与新的 Web 架构。
