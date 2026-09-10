# v2 基线

基线代码为 Git 提交 `bd37056`（v2.5.4），记录于 v3 实施前。

- `assets.sha256.json`：五张原始 PNG 的 SHA-256。v3 必须保持完全一致。
- `changelog-v2.json`：原始版本记录。
- `v2-menu.png` / `v2-battle.png`：1280×720 菜单和开局截图。
- `measurement-v2.json`：自动化 Chromium Headless 开局 300 帧测量。

旧版测量使用 **SwiftShader 软件渲染**，且仅覆盖开局低负载。它用于保存可追溯的起点，不能和 v3 在 D3D11 / RTX 3060 上的压力场景作性能倍数比较。

静态审计确认的旧版问题包括：每个 rAF 执行一次模拟、斜向速度多出 √2、全局帧余数带来的首发延迟、失焦残留键盘状态、重开残留 Boss 转场状态、穿透弹对同目标重复命中、按帧动态创建染色 Canvas，以及两份独立 HTML 界面。

复现：在仓库根目录运行 `node scripts/capture-baseline.mjs`。它从 Git 基线读取旧 HTML/JS/CSS，使用当前哈希不变的图片和音频，自动清理临时服务器。
