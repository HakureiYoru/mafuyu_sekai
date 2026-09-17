# v6.1：移动端横屏支持

继续使用同一战役、1600×900 视野、60Hz 固定模拟、v6 成绩与 profile:v3。新增输入和布局，不新增主动技能、独立主循环或手机专属数值。

工作区并行完成的[中途精英血量调整](validation/elite-hp-2026-09-18.md)一并保留，两种输入设备使用相同配置；该调节与移动适配分开记录。

## 输入

`TouchInputState` 不依赖浏览器，使用模拟时钟；`TouchInputController` 按 pointerId 追踪手指，接管浮动摇杆、按钮及画布点击。15% 死区后线性映射，模拟保留移动幅度。触屏动作和键鼠均输出 `InputAction`，独立 `dashDirection` 保留静止冲刺的方向记忆且不修改瞄准。

多指普通抬手只释放对应操作；cancel、异常丢失捕获、失焦和隐藏时清空并暂停。手势不进入 React 逐帧状态，摇杆视觉由事件更新 CSS。摇杆与按钮阻止触摸滚动，菜单和选卡保留纵向滚动，选卡另有移动阈值保护。

自动模式按 coarse pointer 与 hover:none 检测，在开局固定；菜单或暂停设置可更换。移动端检测不依赖 UA。旧设置补齐 controlMode:auto、touchFrameRate:60，已有画质优先；仅无画质偏好时使用轻量默认。

## 自动战斗

从现有空间网格查询与当前视野相交的存活、可伤单位，按碰撞边缘距离排序；每 0.1 秒评估，持有至少 0.35 秒，候选近 25% 才切换。死亡、清场移除、离屏、不可伤立即失效。点击部件优先，其他取最近中心，空白取消手动锁定；多指及拖动不能产生锁定。

85 热量进入散热，35 恢复，保留跨暂停迟滞；80 热量冷凝弹仓先有机会触发。仅在有目标且自动开火开启时射击，现有贯穿炮窗口优先于散热、过热。停火只抑制主炮与自动贯穿炮。暂停、选卡、失焦和转屏清空慢移、目标与待触发动作，停火偏好保留至重开。

## 布局与运行

手机上下各 44px HUD，左右独立触控区域，中央战场等比适配，不把控件压在弹幕上。使用 visualViewport 尺寸、viewport-fit:cover 和 safe-area-inset；不旋转页面。通讯固定紧凑双头像，完整构筑放暂停与选卡。竖屏可以使用菜单、设置和选卡，但不能开始或恢复模拟；选完最后一张也要横屏后点击继续。

低／中／高移动像素预算分别 960×540、1280×720、1600×900，DPR ≤1.5。RenderGate 仅限制真正的渲染提交到 30／60 FPS，FixedClock 每次 RAF 继续按 60Hz 推进；诊断分别报告 renderFps 与 simulationHz。不减少危险实体或改变模拟速度。

音频下载与渲染加载解耦；开始／继续手势同步创建或恢复 AudioContext，晚到资源逐个幂等解码。暂停阻止延迟解码或恢复异步操作重启音乐。音频不可用时保留静音游戏。全屏和锁向失败不会阻塞开局。

## 依据与验证边界

- [WebKit：刘海安全区](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)：viewport-fit 和 env(safe-area-inset-*)。
- [MDN：Pointer Events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)：多指捕获、取消及兼容鼠标事件。
- [MDN：AudioContext 状态](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state)：处理 suspended/interrupted，允许点击继续恢复。
- [MDN：方向锁定](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock)：仅作为可选增强。

浏览器仿真验证布局、输入和生命周期，不证明手机 GPU、发热或系统手势表现。iPhone Safari 与中档安卓 Chrome 真机均待接入；详细结果见验证记录。
