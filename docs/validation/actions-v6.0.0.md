# v6 动作首领盲操作对照

18 组均出现真实受伤，18 组自然死亡；这只证明三种固定盲操作不能完全化解这些首领。

固定种子 60217，60Hz 原始生产模拟。每组最多 45 秒，死亡即停止；Lv1、5 HP，无装备、无子机、不开火、不冲刺、不炸弹、不设置无敌，保留正常受伤保护。隔离普通增援；断臂／半血仅在测量前通过真实伤害入口设置。

单向后退始于 y=700，持续按下直到真实世界边界 y=3982。必须分开阅读触边前与触边后命中，不能把边界堵住当成开放区域追击成功。

| 首领状态 | 难度 | 固定策略 | 受伤次数 | 位移动作 / 总起手 | 运行秒 | 结束状态 | 首次触边秒 / 触边前受伤 |
| --- | --- | --- | ---: | ---: | ---: | --- | --- |
| palisade-intact | normal | stationary | 5 | 2 / 3 | 8.883 | failed | — / 5 |
| palisade-intact | normal | fixed-circle | 5 | 5 / 6 | 14.617 | failed | — / 5 |
| palisade-intact | normal | single-retreat | 5 | 4 / 5 | 15.5 | failed | 10.95 / 2 |
| palisade-intact | hard | stationary | 3 | 1 / 2 | 5.283 | failed | — / 3 |
| palisade-intact | hard | fixed-circle | 3 | 3 / 4 | 9.45 | failed | — / 3 |
| palisade-intact | hard | single-retreat | 3 | 3 / 3 | 6.133 | failed | — / 3 |
| palisade-armless | normal | stationary | 5 | 1 / 1 | 4.95 | failed | — / 5 |
| palisade-armless | normal | fixed-circle | 5 | 5 / 5 | 10.517 | failed | — / 5 |
| palisade-armless | normal | single-retreat | 5 | 4 / 4 | 12.517 | failed | 10.95 / 2 |
| palisade-armless | hard | stationary | 3 | 1 / 1 | 3.217 | failed | — / 3 |
| palisade-armless | hard | fixed-circle | 3 | 2 / 2 | 3.6 | failed | — / 3 |
| palisade-armless | hard | single-retreat | 3 | 3 / 3 | 6.9 | failed | — / 3 |
| reprise-half | normal | stationary | 5 | 3 / 7 | 21.233 | failed | — / 5 |
| reprise-half | normal | fixed-circle | 5 | 3 / 7 | 20.95 | failed | — / 5 |
| reprise-half | normal | single-retreat | 5 | 4 / 7 | 33.933 | failed | 10.95 / 1 |
| reprise-half | hard | stationary | 3 | 2 / 5 | 12.617 | failed | — / 3 |
| reprise-half | hard | fixed-circle | 3 | 3 / 6 | 14.433 | failed | — / 3 |
| reprise-half | hard | single-retreat | 3 | 2 / 3 | 14.75 | failed | 10.95 / 2 |

本轮首跑曾发现普通断臂 PALISADE 被固定圆周完整躲过 45 秒、18 次动作，以及六组单向后退均直到触边才受伤，因此没有将首跑判为难度通过。原因是追赶在约 645 距离反复退回慢速、超出竖向可见起手范围；断臂后又只追当前位置或圆周切线。

修正让视野外追赶持续到可见距离，并对连续后退预告有限提前量拦截；断臂横切用已发生的速度变化估计转向趋势，转向率限于 ±1.4 rad/s，平滑后仅在起手时采样。普通／困难动作预警仍为 0.7／0.5 秒，预告后目标与方向不再变化，临时变向可以诱导落空。没有改变生命、伤害、弹速或增加无敌门槛。

[完整轨迹、命中来源和源码哈希](actions-v6.0.0.json)。自动对照不替代真人试玩或整局构筑平衡；死亡即止的短组也不等于观察了完整 45 秒所有组合。
