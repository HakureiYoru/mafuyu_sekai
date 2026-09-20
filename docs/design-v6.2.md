# v6.2：符卡节拍、街机榜与能量材质

## 符卡

`SpellBrain.beat` 统一控制 volley / drain / motion / recover。普通、困难分别在卡龄至少 6 / 5 秒后考虑首次身体动作，起手至少间隔 8 / 6.5 秒，预警 1.1 / 0.9 秒，收招 1.2 / 0.9 秒。每张卡完成一个小节才考虑动作；已承诺的弹墙按实际出界时间、折返弹按去程／停驻／回程出界时间排空。节点发射和激光也使用同一编排。无补发队列、不改血量弹速、不跨卡结算。

主要墙缝的物理净宽 112 / 88，唇边弹精确放置，后续门位只移动 68 / 82；正常及慢移均有余量。交错绝域两轮同轴弹墙后才换轴，前一组离场前不发垂直封路墙。七轮切片列车完整走完才换边；花庭和内外环的开口按批次变化。通路数据只描述几何，不清弹、不免伤、不画绿色安全位置。其他三位动作首领沿用 v6.1.2 收招设计。

## 联网边界

- `/api/run`：同源 POST，签发 24 小时 HMAC 凭证，绑定匿名身份、规则 `v6.2`、初始控制模式与难度。浏览器身份 Cookie 一年、HttpOnly、SameSite=Lax，线上 Secure。
- `/api/submit`：校验签名、身份、规则、格式、分数上限、有效战斗时长与服务器时间、结束状态；键鼠局可以升级归触屏，触屏凭证不可降为键鼠。LUA 原子比较个人最佳、写分、更新排序和记录 runId + 模式的幂等结果。低分不会覆盖高分；可以更新昵称。相同成绩保持原来的首次取得时间。
- `/api/leaderboard`：只返回前 100 名、本人名次、总人数。排序使用负分数与时间前缀成员，按分降序、同分首次取得时间升序。身份与凭证不出现在公开响应里。
- 每身份和 IP 分接口限流，IP 只保存 HMAC 摘要。配额不足、停用和网络失败返回可重试提示，不影响模拟和本地保存。

`LeaderboardClient` 与模拟解耦；Runtime 仅在真实结算生成冻结成绩，异步凭证晚到仍能关联正确局。剧情与无尽分别去重，继续无尽不覆盖剧情；菜单、调试、练习、指定种子和旧最高分不生成可上传结果。保留最近八个有效结果供重试；昵称单独记忆。没有设备指纹、注册账户或永久战力。

这是休闲榜：客户端决定玩法事实，签名与合理性校验不能证明没有修改客户端。不要将本榜宣传为严格反作弊竞赛。

## 部署

项目 `wenjun-hes-projects/mafuyu-sekai` 关联 Upstash `mafuyu-arcade`，选择 free，`autoUpgrade=false`、`prodPack=false`、`eviction=false`。生产和预览共享免费数据库但键前缀分别为 `arcade:v6.2:production` 和 `arcade:v6.2:preview`，凭证规则与成绩不能跨榜写入。凭据只在 Vercel 服务端环境中存在，随机签名密钥单独配置。

配置：`KV_REST_API_URL`、`KV_REST_API_TOKEN`、`LEADERBOARD_SIGNING_SECRET`；支持 Upstash 原生同义变量。不需要 Next.js，也不把密钥注入 Vite bundle。关联网功能可设 `LEADERBOARD_DISABLED=1`。无免费额度时自动降级失败提示，不自动付费。

本地 `npm run dev` 读取 `.env.local`，挂载与部署相同的 handler；`npm run preview` 只提供静态前端。`node scripts/verify-leaderboard.mjs` 通过本地开发服务器或 `ARCADE_TEST_URL` 指向的预览验证真实 Redis，并拒绝对正式域名写测试分。`scripts/review-v62.mjs` 保存预览截图，`scripts/compare-v62.mjs` 对比冻结基线和当前构建。

## 视觉

PixiJS 8.20.1 + pixi-filters 6.1.5。共享 `AttackMaterials` 的 MeshGeometry / GlProgram，最多复用 64 个本地光束网格；敌方先领取装饰网格，容量不足仅跳过装饰，不改弹体、预告或判定。36 个模块和 18 个进化映射到针、翼、晶、电、追踪、弯月、音符、连线和脉冲样式，伤害来源保持独立。

低画质只用明确几何；中画质流动束芯，高画质额外最多四个小范围炮口 GlowFilter。没有全屏模糊。减弱动态关闭流动与强脉冲，时间取模拟 elapsed，暂停不漂移。装饰粒子使用一个同图集 ParticleContainer，肖像残影独立使用普通 Sprite；均沿用有界对象池。敌弹核心、预警与玩家核心在装饰之上。五张原图未修改。

## 依据

- [Vercel Vite Functions](https://vercel.com/docs/frameworks/frontend/vite)
- [Upstash Vercel integration](https://upstash.com/docs/redis/howto/vercelintegration)
- [Pixi Mesh](https://pixijs.com/8.x/guides/components/scene-objects/mesh)、[ParticleContainer](https://pixijs.com/8.x/guides/components/scene-objects/particle-container)
- [pixi-filters 兼容表](https://github.com/pixijs/filters/blob/main/README.md)、[性能建议](https://pixijs.com/8.x/guides/concepts/performance-tips)
