# v6.0.0 动态数字缓存修复

2026-09-17，最终数字绘制产物 `assets/index-D-qbO7oo.js`，`renderer-L3-BJonv.js`。

## 原因与复现

此前的 30 分钟验证在 19.5 分钟作为诊断停止，不能记作完成的长跑。游戏对象、DOM 与监听器没有越界，但检查 PixiJS 8.20.1 源码发现：`AbstractTextSystem.decreaseReferenceCount` 在引用归零后归还纹理，却将 `_activeTextures[textKey]` 设成 `null`，没有删除键。键包含完整文本，持续变化的累计伤害可能留下无界的空键历史。游戏的“文字对象数”无法覆盖这类元数据。

只读 CPU 复现使用实际 `AbstractTextSystem.getManagedTexture/decreaseReferenceCount`，只用桩替代纹理创建与归还，没有 DOM/GPU：10,000 个不同数字得到 10,000 次归还、0 个活纹理、10,000 个残留键。CanvasTextMetrics 的测量缓存本身是 1,000 项 LRU；它不是这次问题来源。

## 修复边界

动态伤害、经验／共鸣经验损失、治疗、血药数量、炸弹、等级、符卡和子机计数改为 `BitmapText`。一个预装字体供所有数字标签共享，使用公开 `BitmapFontManager.install/uninstall`，没有访问或改写 Pixi 私有缓存，也没有修改依赖文件。[Pixi BitmapText 官方说明](https://pixijs.com/8.x/guides/components/scene-objects/text/bitmap)

字符集严格限定为 ASCII U+0020–U+007E，加 `−血药恢复共鸣经验符卡击破子机接入第波炸弹已满额转为换补给` 中的独立字符。包含科学计数法需要的字符；未来未登记字符转成 `?`，不会悄悄扩张图集。所有当前实际事件模板都检查了没有替换问号。固定中文短消息继续使用 `Text`；战场 HUD 的波数和分数由 React 展示，不经过 Pixi 整串文本缓存。

字体保留 Segoe UI／微软雅黑、粗体与暗色描边；数字颜色通过 tint 处理，不按每种伤害建立字体。19／21／26px 三档字号、36 个浮字对象上限、同目标合并、优先级、淡出、减弱动态与重开重用逻辑均保留。字体按渲染器生命周期引用计数，最后一位使用者释放时卸载。BitmapText 的布局缓存为 Pixi 自带 1,000 项 LRU，字形集合不随伤害文本数量扩张。

## 验证

- 15 项 `effects.test.ts` 通过：10,000 个不同伤害复用同一个 BitmapText；混合中文数字全路径；原有分数伤害、命中合并、优先级；字体安装／释放幂等。类型、lint、生产构建通过。
- 新产物四项浏览器回归通过，37.1 秒：真实全模块低画质战斗浮字、十个精英预告、浮字选项、20 次重开。查看了 [数字与中文计数实拍](v6.0.0-bitmap-damage.png)，字形与描边清楚，无缺字和浏览器错误。
- 完整 49 项流程和原三场性能记录保留其原产物标识；本次没有改变战斗模拟或敌人配置，只针对数字表现与纹理生命周期回归。
- 最终 Lv100 构筑 GPU 补测通过：RTX 3060 Laptop、1080p 中画质、3 秒预热＋30 秒墙钟，P95／P99 5.7／5.7ms，模拟推进 30 秒，无浏览器错误。100ms 采样峰值为 83 敌人、59 敌弹、115 我弹、28 模块场。单独记录在 [performance-text-v6.0.0.json](performance-text-v6.0.0.json)，附 [全构筑实拍](v6.0.0-full-build-100-late-squads-bitmap.png)，没有覆盖原三场报告或截图。新的 30 分钟长跑由主发布记录另行登记。
