// --- GLOBAL CONFIG ---
const GAME_CONFIG = {
    world: {
        width: 4000, // 世界宽度，决定边界和背景渲染范围
        height: 4000 // 世界高度，决定边界和背景渲染范围
    },
    player: {
        baseHp: 5, // 玩家基础血量
        baseBombs: 3, // 开局炸弹数
        speed: 3.5, // 玩家基础移动速度
        radius: 30, // 玩家碰撞半径
        startInvincFrames: 60, // 开局无敌帧数
        movementLockPenalty: 0.9, // 过热/缺弹时的移速倍率
        dash: {
            duration: 20, // 冲刺持续帧数
            cooldown: 300, // 冲刺冷却帧数
            invincFrames: 15, // 冲刺过程提供的无敌帧
            speedMultiplier: 5, // 冲刺时的移速倍率
            perfectWindow: 150 // 冲刺结束后可触发强化射击的窗口帧
        },
        bomb: {
            invincFrames: 120, // 投放炸弹时的无敌帧数
            bossDamage: 80, // 炸弹对Boss造成的伤害
            normalDamage: 80, // 炸弹对普通怪物造成的伤害
            screenShake: 40, // 炸弹爆炸产生的震屏幅度
            flash: 10, // 炸弹爆炸的屏幕闪烁帧数
            width: 750, // 炸弹作用范围宽度
            height: 750 // 炸弹作用范围高度
        },
        miniBomb: {
            burstCount: 20, // 小炸弹释放的追踪弹数量
            color: '#ffbb55', // 视觉主色
            shockwaveRadius: 140, // 触发时的冲击波半径
            shockwave: { speed: 12, fade: 0.05, spread: 26 }, // 冲击波参数
            sfx: 'small', // 使用的音效 key
            text: 'HOMING BURST' // 浮空文字
        },
        ammo: {
            max: 100, // 弹药上限
            regenPerSec: 0.5, // 普通波次每秒回弹量
            bossRegenPerSec: 1.5, // Boss波次每秒回弹量
            lockUnlockRatio: 0.8, // 热量恢复到该比例以下解除过热锁
            special: {
                levelReq: 4, // 解锁特殊弹的武器等级
                cooldown: 180, // 特殊弹冷却（帧）
                windup: 18, // 特殊弹预瞄/蓄力帧数
                damageMult: 5, // 特殊弹伤害倍率
                speed: 6, // 特殊弹飞行速度
                lockRange: 220 // 特殊弹追踪锁定范围（缩小）
            }
        },
        heat: {
            max: 300, // 过热槽上限
            perShot: 10, // 每发射击增加的热量
            cooldownPerSec: 17.5, // 每秒自然冷却的热量
            lockDuration: 180 // 过热/缺弹锁定持续帧数
        },
        weapon: {
            fireRate: { 
                base: 25, // 初始射击间隔（帧），等级越高越低
                min: 5, // 射速下限帧数
                fastLevelThreshold: 8, // 达到该等级后使用快速射击间隔
                fastFrameInterval: 15, // 高等级时的射击间隔
                levelStepDivisor: 1 // 低等级阶段每提升多少等级减少1帧间隔
            },
            homingLockRange: 300, // 追踪弹的锁定范围（高等级解锁的追踪弹用更小范围）
            xp: { 
                base: 100, // 升级所需基础经验
                perLevel: 30, // 每级额外需求经验
                pickupGain: 10, // 拾取经验球获得的经验值
                lossPercentOnHit: 0.25, // 受伤扣除当前等级需求的比例
                levelCap: 10 // 武器等级上限
            } // 升级/掉级参数
        }
    },
    enemies: {
        perWaveHpBonus: 2, // 每波额外血量成长
        scorePerHp: 10, // 每点血量对应的得分倍率
        dasherChargeWeakness: 1.3, // 突进怪蓄力时的受伤害倍率
        boss: {
            baseHp: 500, // Boss基础血量
            hpPerWave: 100, // Boss每波额外血量
            hpMultiplier: 10, // Boss额外血量倍率
            speed: 0.5, // Boss移动速度
            radius: 350, // Boss体型半径
            color: '#ffaa00', // Boss渲染颜色
            laser: {
                angularSpeed: 0.004, // 每帧旋转角速度（默认慢转圈）
                length: 4000, // 激光长度
                width: 140, // 激光宽度
                warmup: 60, // 预警帧数
                duration: 1200, // 持续帧数，缩短以避免长时间锁场
                cooldown: 600, // 两次激光之间冷却
                initialCooldown: 240, // 初次出招延迟
                color: '#ffbb33' // 主体颜色
            }
        },
        types: {
            basic: { hp: 5, speed: 3, radius: 30, color: '#ff0000' }, // 普通杂兵数值
            dasher: { hp: 20, speed: 5, radius: 36, color: '#ffff00' }, // 突进怪数值
            sniper: { hp: 10, speed: 1, radius: 36, color: '#cc00ff' }, // 狙击怪数值
            sprayer: { hp: 100, speed: 0.75, radius: 100, color: '#00ffff' }, // 扫射怪数值
            minelayer: { hp: 25, speed: 2, radius: 80, color: '#33ff33' }, // 布雷怪数值
            mine: { hp: 1, speed: 0, radius: 50, color: '#00ff00' } // 地雷数值
        },
        drops: {
            ammoCoreChance: 0.0375, // 普通敌人掉落弹药核心的概率
            ammoCoreChanceMinelayer: 0.075, // 布雷怪掉落弹药核心的概率
            coolantChanceFromElites: 0.2, // 突进/狙击掉落冷却液的概率
            bombChance: 0.05, // 掉落炸弹的概率
            miniBombChance: 0.08, // 掉落小炸弹的概率（释放追踪弹幕）
            hpChance: 0.2, // 掉落血包的概率（在未掉弹药/冷却时）
            blackHoleChance: 0.002 // 黑洞：极低概率稀有掉落，全图吸附道具
        }
    },
    spawn: {
        indicatorTime: 60, // 预警提示持续帧数
        baseInterval: 120, // 初始出怪间隔
        minInterval: 30, // 出怪间隔下限
        waveAccel: 5, // 每波减少的出怪间隔
        bossSlowMultiplier: 10, // Boss战时出怪间隔倍率
        bossStoryWave: 5, // 剧情模式Boss出现波次
        bossEndlessInterval: 10, // 无尽模式Boss间隔波次
        bossChance: 0.05 // 满足条件时刷Boss的概率
    },
    waves: {
        advanceIntervalFrames: 9600, // 提升波次的帧间隔
        endlessDifficultyStepInterval: 10, // 无尽模式提升难度的波次间隔
        endlessDifficultyStep: 0.2 // 无尽模式每次提升的难度倍率
    },
    endlessScaling: {
        hpPerWaveRatio: 0.3, // 无尽模式血量百分比成长
        speedPerWaveRatio: 0.02, // 无尽模式速度百分比成长
        speedCap: 5, // 无尽模式速度封顶
        radiusPerWaveRatio: 0.05, // 无尽模式体型百分比成长
        radiusCap: 3 // 无尽模式体型成长封顶倍数
    }
};
let animationFrameId = null; // Initialize as null

// 拆出的便捷引用，方便在逻辑中使用配置
const WORLD_CFG = GAME_CONFIG.world;
const PLAYER_CFG = GAME_CONFIG.player;
const ENEMY_CFG = GAME_CONFIG.enemies;
const SPAWN_CFG = GAME_CONFIG.spawn;
const WAVE_CFG = GAME_CONFIG.waves;
const ENDLESS_CFG = GAME_CONFIG.endlessScaling;
const PERF_CFG = {
    maxEnemies: 180, // Hard cap for all live enemies (skip spawns when exceeded)
    maxMines: 70, // Separate cap for static mines
    maxParticles: 900, // Avoid runaway particle counts during mass kills
    softCollisionLimit: 140, // Skip O(n^2) enemy separation when above this count
    farUpdateThrottle: 2, // Offscreen enemies update every N frames
    cullPadding: 320 // Extra padding for draw culling around the viewport
};
const ENEMY_MOTION = {
    baseBlend: 0.05, // How quickly enemies lerp toward their desired velocity (降低值增强惯性)
    baseDrag: 0.95, // Passive slow-down to keep some glide (提高值增强滑行)
    dashBlend: 0.12, // Faster response for dash bursts (稍微降低使冲刺更平滑)
    dashDrag: 0.98, // Preserve dash momentum a bit longer
    speedCapMult: 3 // Prevent runaway speeds when steering adds up
};
const WORLD_W = WORLD_CFG.width;
const WORLD_H = WORLD_CFG.height;
const FPS = 60;
const XP_CFG = PLAYER_CFG.weapon.xp;
const LEVEL_CAP = XP_CFG.levelCap;

const SPEAKER_PROFILES = {
    MAFUYU: { alias: 'MAFUYU', avatar: "assets/images/enemy.png" },
    MAFUYU_SYSTEM: { alias: 'MAFUYU', avatar: "assets/images/enemy.png" },
    MAFUYU_MASKED: { alias: 'MAFUYU', avatar: "assets/images/enemy.png" },
    MAFUYU_HOLLOW: { alias: 'MAFUYU', avatar: "assets/images/enemy.png" },
    MAFUYU_GLITCH: { alias: 'MAFUYU', avatar: "assets/images/enemy.png" },
    MAFUYU_MOTHER: { alias: 'MAFUYU', avatar: "assets/images/enemy.png" },
    EMU: { alias: 'EMU', avatar: "assets/images/player.png" },
    SYSTEM: { alias: 'SYSTEM', avatar: "assets/images/enemy.png" }
};

function resolveSpeaker(raw, avatarOverride = null) {
    const name = raw || 'SYSTEM';
    const upper = (name || '').toUpperCase();
    const profile = SPEAKER_PROFILES[name]
        || (upper.includes('MAFUYU') ? SPEAKER_PROFILES.MAFUYU : null)
        || (upper.includes('EMU') ? SPEAKER_PROFILES.EMU : null)
        || SPEAKER_PROFILES.SYSTEM;
    return {
        display: profile?.alias || name || 'SYSTEM',
        avatar: avatarOverride || profile?.avatar || null
    };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const withAlpha = (hex, alpha) => {
    if (!hex) return `rgba(255, 255, 255, ${alpha})`;
    const h = hex.replace('#', '');
    const normalized = h.length === 3 ? h.split('').map(ch => ch + ch).join('') : h.padEnd(6, '0');
    const num = parseInt(normalized, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

/**
 * UI COMMUNICATOR
 */
const Comms = {
    panel: document.getElementById('comms-panel'),
    sender: document.getElementById('comms-sender'),
    text: document.getElementById('comms-text'),
    avatar: document.getElementById('comms-avatar'),
    queue: [],
    typing: false,
    timeout: null,
    activeId: 0,
    defaultAvatar: "assets/images/enemy.png",
    show(msg, from = "SYSTEM", color = "#00ccff", avatar = null, opts = {}) {
        const options = opts || {};
        const speaker = resolveSpeaker(from, avatar);
        const payload = {
            msg,
            from: speaker.display,
            color,
            avatar: speaker.avatar,
            priority: !!options.priority,
            interrupt: !!options.interrupt,
            allowInactive: !!options.allowInactive
        };
        if (payload.interrupt) {
            if (this.timeout) clearTimeout(this.timeout);
            this.activeId++;
            this.queue = [];
            this.typing = false;
            this.text.innerText = "";
        }
        if (payload.priority) this.queue.unshift(payload);
        else this.queue.push(payload);
        if (!this.typing) this.processQueue();
    },
    reset() {
        this.queue = [];
        this.typing = false;
        this.activeId++;
        if(this.timeout) clearTimeout(this.timeout);
        this.text.innerText = "..."; // Reset to default
        this.panel.style.opacity = 0;
        if (this.avatar) {
            this.avatar.style.opacity = 0.6;
            this.avatar.style.boxShadow = "none";
        }
    },
    async processQueue() {
        if (this.queue.length === 0) {
            this.timeout = setTimeout(() => { this.panel.style.opacity = 0; }, 2000);
            return;
        }
        clearTimeout(this.timeout);
        this.panel.style.opacity = 1;
        this.typing = true;
        const current = this.queue.shift();
        const msgId = ++this.activeId;
        this.sender.innerText = current.from;
        this.sender.style.color = current.color;
        this.panel.style.borderLeftColor = current.color;
        if (this.avatar) {
            this.avatar.src = current.avatar || this.defaultAvatar;
            this.avatar.style.boxShadow = `0 0 12px ${current.color}`;
            this.avatar.style.opacity = 1;
        }
        this.text.innerText = "";
        const chars = current.msg.split("");
        for (let i = 0; i < chars.length; i++) {
            if((!gameActive && !current.allowInactive) || msgId !== this.activeId) { this.typing = false; return; } 
            this.text.innerText += chars[i];
            await new Promise(r => setTimeout(r, 20));
        }
        if((gameActive || current.allowInactive) && msgId === this.activeId) setTimeout(() => { this.typing = false; this.processQueue(); }, 2000);
    }
};

/**
 * SCRIPTED DIALOGUE (Integrated)
 */
const DialogueSys = {
    data: {
        SYSTEM_STATUS: [
            { id: 'START_INIT', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '……系统重构。这就是……新的绝望吗？' },
            { id: 'START_ENGAGE', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '不要靠近。这里只有冷。好冷。' },
            { id: 'START_WAIT', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '……还没放弃吗？明明什么意义都没有。' },
            { id: 'START_FILTER', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '……监测到光源。立即遮蔽。' },
            { id: 'START_CALIB', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '数据校准完毕。希望值置零。' },
            { id: 'START_HIVE', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: 'Hive Mind：拒绝情感输入。' },
            { id: 'START_DEFENSE', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '防御矩阵展开。凤笑梦是异常。' },
            { id: 'START_ASSIM', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '同化程序运行……别挣扎。' },
            { id: 'START_NOEXIT', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '真实：没有出口。请认清。' }
        ],
        TYPE_A_SPAWN: [
            { id: 'TA_1', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '凤同学，在这个时间大吵大闹是不可以的哦。' },
            { id: 'TA_2', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '你也想变成好孩子吗？那就安静一点。' },
            { id: 'TA_3', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '请回去吧，这里没有你可以做的事情。' },
            { id: 'TA_4', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '如果你不听话的话，大家会困扰的。' },
            { id: 'TA_5', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '凤同学，走廊禁止奔跑。要守规矩哦。' },
            { id: 'TA_6', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '换身整洁的制服再来吧？现在的你太乱了。' },
            { id: 'TA_7', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '老师还在看着你。请表现得乖巧一点。' },
            { id: 'TA_8', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '你的笑声会吵到安静学习的大家。' },
            { id: 'TA_9', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '请按照时间表行动，不要制造麻烦。' },
            { id: 'TA_10', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '我们已经安排好一切，你只要离开就行。' },
            { id: 'TA_11', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '不要妄想改写结果。那是不礼貌的。' },
            { id: 'TA_12', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '凤同学，请收起那份幼稚的热情。' }
        ],
        TYPE_A_ATTACK: [
            { id: 'TA_ATK_1', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '呵呵……凤同学真是‘特别’呢。' },
            { id: 'TA_ATK_2', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '那种笑容，太刺眼了……请你遮起来。' },
            { id: 'TA_ATK_3', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '这都是为了你好，凤同学。消失吧。' },
            { id: 'TA_ATK_4', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '不要把那种毫无根据的快乐带进来。' },
            { id: 'TA_ATK_5', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '优雅的学生不会像你这样乱闯。请退出。' },
            { id: 'TA_ATK_6', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '你的Wonderhoy只会污染空气。' },
            { id: 'TA_ATK_7', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '请克制追逐梦想的冲动，那太危险了。' },
            { id: 'TA_ATK_8', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '那样的期待会伤人，所以请不要出现。' },
            { id: 'TA_ATK_9', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '道歉还来得及。现在转身便好。' },
            { id: 'TA_ATK_10', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '我会帮你把笑容剪掉，像修正错题一样。' },
            { id: 'TA_ATK_11', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '请签署放弃书，这样比较有礼貌。' },
            { id: 'TA_ATK_12', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '就让我们把你也纳入优秀的沉默里吧。' }
        ],
        TYPE_A_DEATH: [
            { id: 'TA_DIE_1', sender: 'MAFUYU_MASKED', color: '#8888aa', text: '啊……必须要去补习班了……' },
            { id: 'TA_DIE_2', sender: 'MAFUYU_MASKED', color: '#8888aa', text: '这也是……没办法的事呢……' },
            { id: 'TA_DIE_3', sender: 'MAFUYU_MASKED', color: '#8888aa', text: '对不起……妈妈……' },
            { id: 'TA_DIE_4', sender: 'MAFUYU_MASKED', color: '#8888aa', text: '老师……我没有做到最好……' },
            { id: 'TA_DIE_5', sender: 'MAFUYU_MASKED', color: '#8888aa', text: '制服……弄皱了……对不起……' },
            { id: 'TA_DIE_6', sender: 'MAFUYU_MASKED', color: '#8888aa', text: '凤同学……你真是任性……' },
            { id: 'TA_DIE_7', sender: 'MAFUYU_MASKED', color: '#8888aa', text: '请把作业……转交给我……' },
            { id: 'TA_DIE_8', sender: 'MAFUYU_MASKED', color: '#8888aa', text: '我得回去练琴……不要告诉妈妈……' },
            { id: 'TA_DIE_9', sender: 'MAFUYU_MASKED', color: '#8888aa', text: '笑容……好刺眼……我看不见了……' }
        ],
        TYPE_B_SPAWN: [
            { id: 'TB_1', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……什么都……感觉不到。' },
            { id: 'TB_2', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……冷。' },
            { id: 'TB_3', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……你是……谁？' },
            { id: 'TB_4', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……不懂（Wakaranai）。' },
            { id: 'TB_5', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……心跳……停止了。' },
            { id: 'TB_6', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……脚步……拖不动。' },
            { id: 'TB_7', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……声音……都是噪音。' },
            { id: 'TB_8', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……你来做什么……？' },
            { id: 'TB_9', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……空气……好沉。' },
            { id: 'TB_10', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……头里……都是空白。' },
            { id: 'TB_11', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……请你……别点亮这里。' },
            { id: 'TB_12', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……被线……拉住了。' }
        ],
        TYPE_B_ATTACK: [
            { id: 'TB_ATK_1', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……把你的温度……给我。' },
            { id: 'TB_ATK_2', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……好重……你也变得……一样重吧。' },
            { id: 'TB_ATK_3', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……一起……堕落吧。' },
            { id: 'TB_ATK_4', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……这里……是深海……没有光。' },
            { id: 'TB_ATK_5', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……把笑容……挖出来。' },
            { id: 'TB_ATK_6', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……分享你的……梦的碎片。' },
            { id: 'TB_ATK_7', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……一起……沉到最底。' },
            { id: 'TB_ATK_8', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……交出……那团颜色。' },
            { id: 'TB_ATK_9', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……不要挣扎……越动越冷。' },
            { id: 'TB_ATK_10', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……我会复制……你的心跳……然后静音。' },
            { id: 'TB_ATK_11', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……吸收……你的Wonderhoy……熄灭它。' },
            { id: 'TB_ATK_12', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……贴近吧……直到分不清。' }
        ],
        TYPE_B_DEATH: [
            { id: 'TB_DIE_1', sender: 'MAFUYU_HOLLOW', color: '#555555', text: '……啊……这种感觉是……' },
            { id: 'TB_DIE_2', sender: 'MAFUYU_HOLLOW', color: '#555555', text: '……坏掉了。' },
            { id: 'TB_DIE_3', sender: 'MAFUYU_HOLLOW', color: '#555555', text: '……我想……消失……' },
            { id: 'TB_DIE_4', sender: 'MAFUYU_HOLLOW', color: '#555555', text: '……线……断了？' },
            { id: 'TB_DIE_5', sender: 'MAFUYU_HOLLOW', color: '#555555', text: '……温度……又掉了……' },
            { id: 'TB_DIE_6', sender: 'MAFUYU_HOLLOW', color: '#555555', text: '……我……听不到……' },
            { id: 'TB_DIE_7', sender: 'MAFUYU_HOLLOW', color: '#555555', text: '……空……又回来了……' },
            { id: 'TB_DIE_8', sender: 'MAFUYU_HOLLOW', color: '#555555', text: '……光……太亮……止住……' },
            { id: 'TB_DIE_9', sender: 'MAFUYU_HOLLOW', color: '#555555', text: '……碎片……散开了……' }
        ],
        TYPE_C_SPAWN: [
            { id: 'TC_1', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '吵死了吵死了吵死了（Usseewa）！！' },
            { id: 'TC_2', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '别看我！别看里面！！' },
            { id: 'TC_3', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '帕拉诺利亚（Paranoia）……别过来！！' },
            { id: 'TC_4', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '你是来嘲笑我的吗？是吗？是吗？！' },
            { id: 'TC_5', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '不准笑！笑声=病毒=毁灭！！！' },
            { id: 'TC_6', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: 'HELLOHELLOHELLO——断线啦！' },
            { id: 'TC_7', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '把目光转开！不需要检修我！' },
            { id: 'TC_8', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '我在噪点里发抖你听见没？！' },
            { id: 'TC_9', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '不要迈进来，否则就爆炸！' },
            { id: 'TC_10', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '指令乱跳、心跳乱跳、全都乱跳！' },
            { id: 'TC_11', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '撕裂！！撕裂！！别缝合梦！！' },
            { id: 'TC_12', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '我不是你想要救的对象！！' }
        ],
        TYPE_C_ATTACK: [
            { id: 'TC_ATK_1', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '把那个‘笑容’给我撕碎！！' },
            { id: 'TC_ATK_2', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '好痛好痛好痛……你也来尝尝这种痛吧！' },
            { id: 'TC_ATK_3', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '反正都是伪善！反正都会离开！！' },
            { id: 'TC_ATK_4', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: 'Bug……Bug……把你也变成Bug！！' },
            { id: 'TC_ATK_5', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '把你的未来日志交出来我全部烧掉！' },
            { id: 'TC_ATK_6', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '我会把Wonderhoy倒挂在天花板上！' },
            { id: 'TC_ATK_7', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '痛痛痛痛痛！给我更多痛！' },
            { id: 'TC_ATK_8', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '谁允许你发光的？！熄灭！' },
            { id: 'TC_ATK_9', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '不准靠近！我的错误会传染！' },
            { id: 'TC_ATK_10', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '我要把你按进噪波里碎成像素！' },
            { id: 'TC_ATK_11', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '哈哈哈……这不是笑，这是报警声！' },
            { id: 'TC_ATK_12', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '所有人都会离开？那我先动手！' }
        ],
        TYPE_C_DEATH: [
            { id: 'TC_DIE_1', sender: 'MAFUYU_GLITCH', color: '#aa00aa', text: 'Gura Gura……视野……在摇晃……' },
            { id: 'TC_DIE_2', sender: 'MAFUYU_GLITCH', color: '#aa00aa', text: '还是……找不到……' },
            { id: 'TC_DIE_3', sender: 'MAFUYU_GLITCH', color: '#aa00aa', text: '救救……我……' },
            { id: 'TC_DIE_4', sender: 'MAFUYU_GLITCH', color: '#aa00aa', text: '警报……失真……看不见出口……' },
            { id: 'TC_DIE_5', sender: 'MAFUYU_GLITCH', color: '#aa00aa', text: 'Bug……回收……失败……' },
            { id: 'TC_DIE_6', sender: 'MAFUYU_GLITCH', color: '#aa00aa', text: '不要……关灯……会更怕……' },
            { id: 'TC_DIE_7', sender: 'MAFUYU_GLITCH', color: '#aa00aa', text: '声音……断裂……不要丢下我……' },
            { id: 'TC_DIE_8', sender: 'MAFUYU_GLITCH', color: '#aa00aa', text: '笑容……还在追……停下……' },
            { id: 'TC_DIE_9', sender: 'MAFUYU_GLITCH', color: '#aa00aa', text: '我也想……被修复……只是……迟到了……' }
        ],
        BOSS_ENTRY: [
            { id: 'BOSS_E1', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '那孩子是坏孩子……真冬，去把她赶走。' },
            { id: 'BOSS_E2', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '只要做个好孩子……就不会痛了。' },
            { id: 'BOSS_E3', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '站好。把不听话的孩子请出去。' },
            { id: 'BOSS_E4', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '真冬，别乱想。只要照做。' },
            { id: 'BOSS_E5', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '凤笑梦，那份喧闹太不礼貌。' },
            { id: 'BOSS_E6', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '在母亲面前低头，就不会痛。' }
        ],
        BOSS_ATTACK: [
            { id: 'BOSS_A1', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '这是为了你好！' },
            { id: 'BOSS_A2', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '只要不后悔就可以哦？' },
            { id: 'BOSS_A3', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '你也想……被期待压死吗？' },
            { id: 'BOSS_A4', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '好孩子要交出分数。把分数交来！' },
            { id: 'BOSS_A5', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '这张考卷盖满红字送给你。' },
            { id: 'BOSS_A6', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '吞下这些期待，不准吐出来。' },
            { id: 'BOSS_A7', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '痛？那就证明你还不够听话。' },
            { id: 'BOSS_A8', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '我会用琴弦把你绑紧，不让你挣脱。' },
            { id: 'BOSS_A9', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '妈妈在看着，你也要乖乖跪下。' }
        ],
        BOSS_LOW_HP: [
            { id: 'BOSS_L1', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '不想让妈妈失望……不想……' },
            { id: 'BOSS_L2', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '我是……我是……我想……找到……' },
            { id: 'BOSS_L3', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '妈妈……我做得不够好吗……？' },
            { id: 'BOSS_L4', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '不要放开我……我会乖……' },
            { id: 'BOSS_L5', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '真冬……还在里面……求救……' },
            { id: 'BOSS_L6', sender: 'MAFUYU_MOTHER', color: '#ff3300', text: '如果听话……是不是就能被抱住……？' }
        ],
        EMU_WONDERHOY: [
            { id: 'EW_A', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '凤同学，你的声音太大了。这很不优雅。' },
            { id: 'EW_B', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……耳朵……好痛。那是……什么咒语？' },
            { id: 'EW_C', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '啊啊啊啊！住口！不要让那种光照进来！！' },
            { id: 'EW_GEN', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '不明白……完全不明白那个词的意义。' },
            { id: 'EW_A2', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '请停止那个奇怪的口号，会让课堂失控。' },
            { id: 'EW_A3', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '“Wonderhoy”？那不是课本里的词汇。请收回。' },
            { id: 'EW_B2', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……Wonder……空洞的声音。好冷。' },
            { id: 'EW_B3', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……叫得太亮……心脏……裂开。' },
            { id: 'EW_C2', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: 'Wonderhoy？！那是光束！！熄灭它！！' },
            { id: 'EW_C3', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '不要再喊！那个词会引发系统崩溃！' },
            { id: 'EW_GEN2', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '侦测到未知语音：Wonderhoy。判定为威胁。' },
            { id: 'EW_GEN3', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '正在屏蔽关键词“Wonderhoy”。不需要快乐。' }
        ],
        EMU_HEAL: [
            { id: 'EH_A', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '请不要碰我。会传染那种‘无用的期待’的。' },
            { id: 'EH_B', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……温暖？恶心。好烫。' },
            { id: 'EH_C', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '好痛！你的手好痛！别碰我的伤口！！' },
            { id: 'EH_A2', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '你的善意会弄脏制服。请离远。' },
            { id: 'EH_A3', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '谢谢，但我不需要。请自重。' },
            { id: 'EH_B2', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……拥抱……像铁链……放开。' },
            { id: 'EH_B3', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……治疗？只是另一种束缚。' },
            { id: 'EH_C2', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '不要靠近！我会咬你！' },
            { id: 'EH_C3', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '别再撒花！那是诅咒！' }
        ],
        EMU_LEVELUP: [
            { id: 'EL_A', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '未来早就决定好了。只要听话就可以了。' },
            { id: 'EL_B', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……未来？那是一片……灰色的墙。' },
            { id: 'EL_C', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '没有那种东西！如果是那种充满谎言的未来……我就全部破坏掉！' },
            { id: 'EL_A2', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '梦想？那是大人的作业表，不是你的玩具。' },
            { id: 'EL_A3', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '凤同学，成绩单已经写好了，不需要再挣扎。' },
            { id: 'EL_B2', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……梦想=噪点。看不清。' },
            { id: 'EL_B3', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……未来……只剩灰尘。别提。' },
            { id: 'EL_C2', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '谁说未来会闪光？让我把它砸碎。' },
            { id: 'EL_C3', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '你想升级？那就踩着我们的尸体啊！' }
        ],
        LEVEL_UP_EVENT: [
            { id: 'LV_UP_1', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '数值上升……真的有意义吗？', maxed: false },
            { id: 'LV_UP_2', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '别得意……下一次会更痛。', maxed: false },
            { id: 'LV_UP_3', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '请冷静，成绩虚高并不会改变本质。', maxed: false },
            { id: 'LV_UP_4', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……成长？只是延迟坠落。', maxed: false },
            { id: 'LV_UP_5', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '记录提升。仍旧判定为失败路径。', maxed: false },
            { id: 'LV_UP_6', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '我会把这份升级拆成碎片。', maxed: false },
            { id: 'LV_UP_MAX', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '已经推到极限了……不要再逼我。', maxed: true },
            { id: 'LV_UP_MAX2', sender: 'MAFUYU_SYSTEM', color: '#a0a0ff', text: '极限警报：再进一步将触发自毁。', maxed: true },
            { id: 'LV_UP_MAX3', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '还想突破？那就让身体彻底裂开吧。', maxed: true }
        ],
        LEVEL_DOWN_EVENT: [
            { id: 'LV_DN_1', sender: 'MAFUYU_SYSTEM', color: '#ff6688', text: '系统回退……这样才安静。' },
            { id: 'LV_DN_2', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……温度下降。这样才对。' },
            { id: 'LV_DN_3', sender: 'MAFUYU_SYSTEM', color: '#ff6688', text: '真好，又回到受控范围内了。' },
            { id: 'LV_DN_4', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……下降才像呼吸。' },
            { id: 'LV_DN_5', sender: 'MAFUYU_GLITCH', color: '#ff00ff', text: '哈哈，看到没？希望坠落时声音真好听！' },
            { id: 'LV_DN_6', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '保持低处才不会惹麻烦。' }
        ],
        PLAYER_DAMAGE: [
            { id: 'DMG_1', sender: 'MAFUYU_SYSTEM', color: '#ff6688', text: '警告：装甲破损。请停止挣扎。' },
            { id: 'DMG_2', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '凤同学，安静一点会好受些。' },
            { id: 'DMG_3', sender: 'MAFUYU_GLITCH', color: '#ff6688', text: '这点痛算什么？继续尖叫吧！' },
            { id: 'DMG_4', sender: 'MAFUYU_MASKED', color: '#ccccff', text: '请保持安静，不要乱动伤口。' },
            { id: 'DMG_5', sender: 'MAFUYU_HOLLOW', color: '#aaaaaa', text: '……看到吗？温度正在流走。' },
            { id: 'DMG_6', sender: 'MAFUYU_SYSTEM', color: '#ff6688', text: '伤害值记录。下一次会更高。' }
        ],
        HP_RECOVER_EVENT: [
            { id: 'HP_UP_1', sender: 'MAFUYU_HOLLOW', color: '#88ff88', text: '……温暖？只是一瞬间而已。' },
            { id: 'HP_UP_2', sender: 'MAFUYU_SYSTEM', color: '#88ff88', text: '补丁完成。别以为这能改变什么。' },
            { id: 'HP_UP_3', sender: 'MAFUYU_MASKED', color: '#88ff88', text: '整理仪容完毕。继续吧。' },
            { id: 'HP_UP_4', sender: 'MAFUYU_GLITCH', color: '#88ff88', text: '暂时缝好了，但裂缝还在。' },
            { id: 'HP_UP_5', sender: 'MAFUYU_HOLLOW', color: '#88ff88', text: '……空洞里灌进一点温暖……马上就漏。' },
            { id: 'HP_UP_6', sender: 'MAFUYU_SYSTEM', color: '#88ff88', text: '自修复完毕。重新指数拒绝。' }
        ],
        FAILURE_EVENT: [
            { id: 'FAIL_1', sender: 'MAFUYU_SYSTEM', color: '#ff3333', text: '……系统关闭。Score {score}。' },
            { id: 'FAIL_2', sender: 'MAFUYU_HOLLOW', color: '#ff3333', text: '……结束了。你可以休息了。' },
            { id: 'FAIL_3', sender: 'MAFUYU_SYSTEM', color: '#ff3333', text: '……记录：Score {score}。依旧无法改变结局。' },
            { id: 'FAIL_4', sender: 'MAFUYU_MASKED', color: '#ff3333', text: '凤同学，游戏到此为止。请回家反省。' },
            { id: 'FAIL_5', sender: 'MAFUYU_HOLLOW', color: '#ff3333', text: '……你也……停下了。好。' },
            { id: 'FAIL_6', sender: 'MAFUYU_GLITCH', color: '#ff3333', text: '倒下了？呵，还是被噪点吞了。' }
        ]
    },
    lastSpoken: {},
    
    // No async load needed anymore
    async ensureData() {
        return this.data;
    },
    
    pick(group, filterFn = null) {
        const list = (this.data?.[group] || []).filter(filterFn || (() => true));
        const pool = list.length ? list : (this.data?.[group] || []);
        if (!pool.length) return null;
        return pool[Math.floor(Math.random() * pool.length)];
    },
    canSpeak(tag, cooldown = 2000) {
        const now = Date.now();
        if (tag && this.lastSpoken[tag] && now - this.lastSpoken[tag] < cooldown) return false;
        if (tag) this.lastSpoken[tag] = now;
        return true;
    },
    speak(group, filterFn, tag, cooldown = 2000, options = {}) {
        if (!this.canSpeak(tag, cooldown)) return;
        const line = this.pick(group, filterFn);
        if (line) Comms.show(line.text, line.sender, line.color, options.avatar || null, options);
    },
    
    // --- TRIGGERS ---
    startup() { this.speak('SYSTEM_STATUS', null, 'startup', 0); },
    
    // Type A: Masked (Sniper/Sprayer)
    typeASpawn() { this.speak('TYPE_A_SPAWN', null, 'type_a_spawn', 5000); },
    typeAAttack() { this.speak('TYPE_A_ATTACK', null, 'type_a_atk', 8000); },
    typeADeath() { this.speak('TYPE_A_DEATH', null, 'type_a_die', 10000); },

    // Type B: Hollow (Basic/Mine/Minelayer)
    typeBSpawn() { this.speak('TYPE_B_SPAWN', null, 'type_b_spawn', 5000); },
    typeBAttack() { this.speak('TYPE_B_ATTACK', null, 'type_b_atk', 8000); },
    typeBDeath() { this.speak('TYPE_B_DEATH', null, 'type_b_die', 10000); },

    // Type C: Glitch (Dasher)
    typeCSpawn() { this.speak('TYPE_C_SPAWN', null, 'type_c_spawn', 5000); },
    typeCAttack() { this.speak('TYPE_C_ATTACK', null, 'type_c_atk', 8000); },
    typeCDeath() { this.speak('TYPE_C_DEATH', null, 'type_c_die', 10000); },

    // Boss
    bossEntry() { this.speak('BOSS_ENTRY', null, 'boss_entry', 0); },
    bossAttack() { this.speak('BOSS_ATTACK', null, 'boss_atk', 6000); },
    bossLowHp() { this.speak('BOSS_LOW_HP', null, 'boss_low', 10000); },

    // Emu Interactions
    emuWonderhoy() { this.speak('EMU_WONDERHOY', null, 'wonderhoy', 2000, { interrupt: true }); },
    emuHeal() { this.speak('EMU_HEAL', null, 'heal', 5000); },
    emuLevelUp() { this.speak('EMU_LEVELUP', null, 'emu_levelup', 0); },
    levelUp(maxed = false) { this.speak('LEVEL_UP_EVENT', l => maxed ? l.maxed === true : l.maxed !== true, maxed ? 'levelup_max' : 'levelup', maxed ? 4000 : 2500); },
    levelDown() { this.speak('LEVEL_DOWN_EVENT', null, 'leveldown', 3000); },
    hpRecover() { this.speak('HP_RECOVER_EVENT', null, 'hp_recover', 3000); },
    damage() { this.speak('PLAYER_DAMAGE', null, 'player_damage', 2000); },
    failure(score = 0) { 
        const line = this.pick('FAILURE_EVENT');
        if (line) {
            const msg = line.text.replace('{score}', score);
            Comms.show(msg, line.sender, line.color, null, { interrupt: true, allowInactive: true });
        } else {
            Comms.show(`系统关闭。Score ${score}`, 'SYSTEM', '#ff3333', null, { interrupt: true, allowInactive: true });
        }
    },
    
    // Legacy mapping support if needed (optional)
    waveAlert(w) { /* No longer used in new design or mapped to generic system status if needed */ }
};

/**
 * ASSET SYSTEM
 */
const Assets = {
    images: {},
    sounds: {},
    music: null,
    pattern: null,
    tintedCache: new Map(),
    loaded: false,
    loading: null,
    async load() {
        if (this.loaded) return;
        if (this.loading) return this.loading;

        const imageSources = {
            player: "assets/images/player.png",
            enemy: "assets/images/enemy.png",
            bullet: "assets/images/bullet.png",
            health: "assets/images/health.png",
            bg: "assets/images/bg.png"
        };
        const imageKeys = Object.keys(imageSources);

        const loadImage = (key, src) => new Promise(resolve => {
            const img = new Image();
            img.src = src;
            img.onload = () => { this.images[key] = img; resolve(img); };
            img.onerror = () => { console.warn(`Image load failed: ${src}`); resolve(null); };
        });

        const loadAudio = (src, loop = false) => new Promise(resolve => {
            const audio = new Audio();
            audio.preload = "auto";
            audio.loop = loop;
            audio.src = src;
            const finish = (result) => {
                audio.removeEventListener("canplaythrough", handleReady);
                audio.removeEventListener("loadeddata", handleReady);
                audio.removeEventListener("error", handleError);
                clearTimeout(timeout);
                resolve(result);
            };
            const handleReady = () => finish(audio);
            const handleError = () => { console.warn(`Audio load failed: ${src}`); finish(null); };
            const timeout = setTimeout(() => finish(audio), 4000); // Fallback so loading never hangs
            audio.addEventListener("canplaythrough", handleReady, { once: true });
            audio.addEventListener("loadeddata", handleReady, { once: true });
            audio.addEventListener("error", handleError, { once: true });
        });

        this.loading = Promise.all([
            ...imageKeys.map(key => loadImage(key, imageSources[key])),
            loadAudio("sound/shot.wav"),
            loadAudio("assets/music/bg.mp3", true)
        ]).then(results => {
            this.sounds.shot = results[imageKeys.length] || null;
            this.music = results[imageKeys.length + 1] || null;
            if (this.images.bg && ctx && typeof ctx.createPattern === "function") {
                this.pattern = ctx.createPattern(this.images.bg, "repeat");
            }
            this.loaded = true;
        }).catch(err => {
            console.error("Asset load error:", err);
            this.loaded = true;
        });

        return this.loading;
    },
    playSfx(name, volume = 1) {
        const base = this.sounds[name];
        if (!base) return null;
        try {
            const inst = base.cloneNode();
            inst.volume = volume;
            inst.play().catch(() => {});
            return inst;
        } catch (e) {
            console.warn("SFX play failed", e);
            return null;
        }
    },
    getTintedImage(img, tint) {
        if (!img || !tint) return img;
        const w = img.width || img.naturalWidth;
        const h = img.height || img.naturalHeight;
        if (!w || !h) return img;

        const key = `${img.src || 'img'}-${tint}`;
        if (this.tintedCache.has(key)) return this.tintedCache.get(key);

        const tintCanvas = document.createElement('canvas');
        tintCanvas.width = w;
        tintCanvas.height = h;
        const tctx = tintCanvas.getContext('2d');

        tctx.clearRect(0, 0, w, h);
        tctx.drawImage(img, 0, 0, w, h);
        tctx.globalCompositeOperation = 'source-atop';
        tctx.globalAlpha = 0.7;
        tctx.fillStyle = tint;
        tctx.fillRect(0, 0, w, h);
        tctx.globalAlpha = 1;
        tctx.globalCompositeOperation = 'source-over';

        this.tintedCache.set(key, tintCanvas);
        return tintCanvas;
    }
};

/**
 * AUDIO SYSTEM
 */
const AudioSys = {
    ctx: null,
    activeShots: new Set(),
    async init() { 
        if (!this.ctx) { 
            window.AudioContext = window.AudioContext || window.webkitAudioContext; 
            this.ctx = new AudioContext(); 
        }
        if (this.ctx.state === 'suspended') {
            await this.ctx.resume();
        }
        await Assets.load();
    },
    playTone(freq, type, dur, vol = 0.1, ramp = true) {
        if (!this.ctx) return;
        try {
            const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
            o.type = type; o.frequency.setValueAtTime(freq, this.ctx.currentTime);
            g.gain.setValueAtTime(vol, this.ctx.currentTime);
            if (ramp) g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);
            o.connect(g); g.connect(this.ctx.destination);
            o.start(); o.stop(this.ctx.currentTime + dur);
        } catch(e) {}
    },
    boom(size='small') { 
        if (!this.ctx) return;
        try {
            const dur = size==='big'?1.0:0.3;
            const buf = this.ctx.createBuffer(1, this.ctx.sampleRate*dur, this.ctx.sampleRate);
            const data = buf.getChannelData(0);
            for(let i=0;i<data.length;i++) data[i]=Math.random()*2-1;
            const src = this.ctx.createBufferSource(); src.buffer = buf;
            const g = this.ctx.createGain(); 
            g.gain.setValueAtTime(size==='big'?0.5:0.1, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + dur);
            src.connect(g); g.connect(this.ctx.destination); src.start();
        } catch(e) {}
    },
    powerup() { this.playTone(600, 'sine', 0.1, 0.1, false); setTimeout(()=>this.playTone(1200, 'sine', 0.3, 0.1), 100); },
    dash() { this.playTone(200, 'sawtooth', 0.3, 0.1); },
    damage() { 
        this.playTone(100, 'sawtooth', 0.5, 0.3); 
        this.playTone(50, 'square', 0.5, 0.3); // Bass grit
    },
    trackShot(inst) {
        if (!inst) return;
        this.activeShots.add(inst);
        const cleanup = () => this.activeShots.delete(inst);
        inst.addEventListener('ended', cleanup, { once: true });
        inst.addEventListener('error', cleanup, { once: true });
    },
    stopShots() {
        this.activeShots.forEach(a => {
            try {
                a.pause();
                a.currentTime = 0;
            } catch (e) {}
        });
        this.activeShots.clear();
    },
    playMusic() {
        if (Assets.music) {
            try {
                Assets.music.currentTime = 0;
                Assets.music.volume = 0.45;
                Assets.music.play().catch(()=>{});
            } catch(e) {}
        }
    },
    stopMusic() {
        if (Assets.music) {
            Assets.music.pause();
        }
    },
    shoot() { 
        const inst = Assets.playSfx('shot', 0.55);
        if (inst) { 
            this.trackShot(inst);
            return;
        }
        this.playTone(800 + Math.random()*200, 'square', 0.1, 0.05); 
    },
    enemyShoot() { 
        if (Assets.playSfx('shot', 0.35)) return;
        this.playTone(300, 'sawtooth', 0.2, 0.05); 
    }
};

/**
 * GAME ENGINE
 */
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const uiLayer = document.getElementById('ui-layer');
let width, height;

// Game State
let gameActive = false;
let frames = 0;
let score = 0;
let wave = 1;
let screenShake = 0;
let flashScreen = 0;
let bossActive = false;
let endlessMode = false;
let difficultyMultiplier = 1.0;
let ammoRegenBuffer = 0;
let specialAmmoCooldown = 0;
let specialAimLock = null;
let blackHolePull = 0; // 黑洞吸附剩余帧数

// Entities
// 玩家基础属性全部来自配置，便于统一调数
const player = { 
    x: 0, y: 0, 
    hp: PLAYER_CFG.baseHp, maxHp: PLAYER_CFG.baseHp, 
    bombs: PLAYER_CFG.baseBombs, 
    weaponLvl: 1, weaponXp: 0, 
    invinc: 0, 
    dashCd: 0, dashTime: 0, perfectDashWindow: 0, 
    angle: 0, speed: PLAYER_CFG.speed, radius: PLAYER_CFG.radius, glitchTime: 0,
    ammo: PLAYER_CFG.ammo.max, maxAmmo: PLAYER_CFG.ammo.max,
    heat: 0, heatMax: PLAYER_CFG.heat.max,
    weaponLock: 0, lockReason: null
};
const camera = { x: 0, y: 0 };
const keys = {};
const mouse = { x: 0, y: 0, down: false };

let bullets = [];
let enemies = [];
let particles = [];
let pickups = [];
let floats = [];
let spawnIndicators = [];
let stars = [];
let enemyCounts = {};

function resetEnemyCounts() {
    enemyCounts = {};
}
function trackEnemySpawn(type) {
    enemyCounts[type] = (enemyCounts[type] || 0) + 1;
}
function trackEnemyDeath(type) {
    if (enemyCounts[type]) enemyCounts[type]--;
}
function getEnemyCount(type) {
    return enemyCounts[type] || 0;
}
function addEnemy(entity) {
    if (entity.vx === undefined) entity.vx = 0;
    if (entity.vy === undefined) entity.vy = 0;
    enemies.push(entity);
    trackEnemySpawn(entity.type);
}
function removeEnemy(entity) {
    const idx = enemies.indexOf(entity);
    if (idx !== -1) enemies.splice(idx, 1);
    trackEnemyDeath(entity.type);
}
// Smoothly pushes an enemy toward the target velocity to give motion some inertia
function steerEnemy(e, targetVx, targetVy, opts = {}) {
    if (e.vx === undefined) e.vx = 0;
    if (e.vy === undefined) e.vy = 0;
    const blend = opts.blend ?? ENEMY_MOTION.baseBlend;
    const drag = opts.drag ?? ENEMY_MOTION.baseDrag;
    const cap = opts.maxSpeed ?? (e.speed * (opts.speedMult ?? ENEMY_MOTION.speedCapMult));

    e.vx = lerp(e.vx * drag, targetVx, blend);
    e.vy = lerp(e.vy * drag, targetVy, blend);

    const mag = Math.hypot(e.vx, e.vy);
    if (cap && mag > cap) {
        e.vx = (e.vx / mag) * cap;
        e.vy = (e.vy / mag) * cap;
    }

    e.x += e.vx;
    e.y += e.vy;
}

function isOnScreen(x, y, pad = PERF_CFG.cullPadding) {
    return x > camera.x - pad && x < camera.x + width + pad &&
           y > camera.y - pad && y < camera.y + height + pad;
}

function canFireWeapon() {
    return player.weaponLock <= 0 && player.ammo > 0;
}

function getDashLaserState() {
    // Ready while perfect dash window is active; otherwise show dash cooldown fill
    const windowMax = PLAYER_CFG.dash.perfectWindow || 1;
    if (player.perfectDashWindow > 0) {
        return {
            ready: true,
            ratio: clamp(player.perfectDashWindow / windowMax, 0, 1),
            label: 'READY'
        };
    }
    const cdMax = PLAYER_CFG.dash.cooldown || 1;
    const ratio = clamp(1 - (player.dashCd / cdMax), 0, 1);
    return {
        ready: false,
        ratio,
        label: player.dashCd > 0 ? `${(player.dashCd / FPS).toFixed(1)}s` : 'DASH'
    };
}

function applyWeaponLock(reason) {
    player.weaponLock = Math.max(player.weaponLock, PLAYER_CFG.heat.lockDuration);
    player.lockReason = reason;
}

function consumeShotResources() {
    player.ammo = Math.max(0, player.ammo - 1);
    player.heat = Math.min(player.heatMax, player.heat + PLAYER_CFG.heat.perShot);
    if (player.heat >= player.heatMax) applyWeaponLock('heat');
    if (player.ammo <= 0) applyWeaponLock('ammo');
}

function applyAmmoRegen(ratePerSec) {
    if (player.ammo >= player.maxAmmo) {
        ammoRegenBuffer = 0;
        return;
    }
    ammoRegenBuffer += ratePerSec / FPS;
    const gained = Math.floor(ammoRegenBuffer);
    if (gained > 0) {
        player.ammo = Math.min(player.maxAmmo, player.ammo + gained);
        ammoRegenBuffer -= gained;
    }
}

function findNearestEnemy(x, y) {
    let nearest = null;
    let dist = Infinity;
    for (const e of enemies) {
        const d = Math.hypot(e.x - x, e.y - y);
        if (d < dist) {
            dist = d;
            nearest = e;
        }
    }
    return { target: nearest, distance: dist };
}

function getXpThreshold(level) {
    return XP_CFG.base + (level * XP_CFG.perLevel);
}

function getWeaponBaseDamage(level) {
    if (level >= 8) return 3;
    if (level >= 2) return 2;
    return 1;
}

function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();
// Start preloading assets in the background
Assets.load();
DialogueSys.ensureData();

// Controls
window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code === 'Space' && gameActive) useBomb();
    if (e.code === 'KeyR' && gameActive) doDash();
});
window.addEventListener('keyup', e => keys[e.code] = false);
window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
window.addEventListener('mousedown', e => {
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) doDash();
});
window.addEventListener('mouseup', () => { mouse.down = false; AudioSys.stopShots(); });
window.addEventListener('blur', () => { mouse.down = false; AudioSys.stopShots(); });
window.addEventListener('mouseout', e => { if (!e.relatedTarget) { mouse.down = false; AudioSys.stopShots(); } });
window.addEventListener('contextmenu', e => e.preventDefault());

// UI Refs
const uiScore = document.getElementById('score-display');
const uiBomb = document.getElementById('bomb-display');
const uiHp = document.getElementById('hp-bar');
const uiXp = document.getElementById('xp-bar');
const uiAmmo = document.getElementById('ammo-bar');
const uiHeat = document.getElementById('heat-bar');
const uiSpecial = document.getElementById('special-bar');
const uiSpecialText = document.getElementById('special-text');
const uiSpecialBox = document.getElementById('special-bar-container');
const uiAmmoText = document.getElementById('ammo-text');
const uiHeatText = document.getElementById('heat-text');
const uiHeatStatus = document.getElementById('heat-status');
const uiLvl = document.getElementById('lvl-display');
const uiWave = document.getElementById('wave-text');
const uiWaveSub = document.getElementById('wave-sub');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const missionCompleteScreen = document.getElementById('mission-complete-screen');
const btnContinue = document.getElementById('btn-continue');
const btnRestartComplete = document.getElementById('btn-restart-complete');
const xpContainer = uiXp.parentElement;
const uiXpLoss = document.createElement('div');
uiXpLoss.className = 'bar-fill xp-loss';
xpContainer.insertBefore(uiXpLoss, uiXp);
const xpVisual = { current: 0, target: 0, loss: 0 };
let xpHitTimer = 0;
uiHp.style.width = '100%';
uiXpLoss.style.width = '0%';
uiXp.style.width = '0%';
uiAmmo.style.width = '100%';
uiHeat.style.width = '0%';
if (uiSpecial) uiSpecial.style.width = '0%';
uiAmmoText.innerText = `${player.maxAmmo}/${player.maxAmmo}`;
uiHeatText.innerText = '0%';
uiHeatStatus.innerText = 'STABLE';
if (uiSpecialText) uiSpecialText.innerText = 'DASH';
if (uiSpecialText) uiSpecialText.classList.remove('pill-ready');
if (uiSpecialBox) uiSpecialBox.classList.remove('special-ready');

function triggerXpDropVisual() {
    xpHitTimer = 12;
    xpContainer.classList.add('xp-hit');
    setTimeout(() => xpContainer.classList.remove('xp-hit'), 250);
}

// --- GAME LOGIC ---

function startGame() {
    // Fix Loop Stacking - Mandatory Restart Fix
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    AudioSys.stopShots();

    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('game-over-screen').style.display = 'none';
    missionCompleteScreen.style.display = 'none';
    
    gameActive = true;
    score = 0;
    wave = 1;
    frames = 0;
    bossActive = false;
    endlessMode = false;
    difficultyMultiplier = 1.0;
    ammoRegenBuffer = 0;
    specialAmmoCooldown = 0;
    specialAimLock = null;
    blackHolePull = 0;
    
    // Reset Player
    player.x = WORLD_W/2; player.y = WORLD_H/2;
    player.maxHp = PLAYER_CFG.baseHp;
    player.hp = player.maxHp; player.bombs = PLAYER_CFG.baseBombs; 
    player.weaponLvl = 1; player.weaponXp = 0; player.invinc = PLAYER_CFG.startInvincFrames; player.glitchTime = 0;
    player.dashCd = 0; player.dashTime = 0; player.perfectDashWindow = 0;
    player.maxAmmo = PLAYER_CFG.ammo.max; player.heatMax = PLAYER_CFG.heat.max; player.speed = PLAYER_CFG.speed;
    player.ammo = player.maxAmmo; player.heat = 0; player.weaponLock = 0; player.lockReason = null;
    uiLayer.classList.remove('glitch-ui');
    xpVisual.current = 0; xpVisual.target = 0; xpVisual.loss = 0; xpHitTimer = 0;
    xpContainer.classList.remove('xp-hit');
    uiXp.style.width = '0%'; uiXpLoss.style.width = '0%';
    
    // Reset Camera
    camera.x = player.x - width/2; camera.y = player.y - height/2;

    // Clear Arrays
    bullets = []; enemies = []; particles = []; pickups = []; floats = []; spawnIndicators = [];
    resetEnemyCounts();
    
    Comms.reset();
    DialogueSys.lastSpoken = {};

    // Static Stars (Re-gen)
    stars = [];
    for(let i=0; i<1000; i++) {
        stars.push({
            x: Math.random()*WORLD_W, y: Math.random()*WORLD_H,
            size: Math.random()*2, color: Math.random()>0.8 ? '#00ffff' : '#ffffff'
        });
    }

    showWave(1, "INITIATING SEQUENCE");
    DialogueSys.startup();
    DialogueSys.waveAlert(wave);

    loop();
}

function showWave(w, sub) {
    uiWave.childNodes[0].nodeValue = `WAVE ${w}`;
    uiWaveSub.innerText = sub || "ENEMIES INBOUND";
    uiWave.style.opacity = 1;
    uiWave.style.transform = "translate(-50%, -50%) scale(1.2)";
    setTimeout(() => {
        uiWave.style.opacity = 0;
        uiWave.style.transform = "translate(-50%, -50%) scale(1)";
    }, 2500);
}

function doDash() {
    if (player.dashCd <= 0) {
        player.dashTime = PLAYER_CFG.dash.duration;
        player.dashCd = PLAYER_CFG.dash.cooldown;
        player.invinc = PLAYER_CFG.dash.invincFrames; 
        AudioSys.dash();
        for(let i=0; i<8; i++) createParticle(player.x, player.y, '#00ffff', 4, 8);
    }
}

function useBomb() {
    if (player.bombs > 0) {
        const bombCfg = PLAYER_CFG.bomb;
        const bombW = bombCfg.width ?? 1000;
        const bombH = bombCfg.height ?? 1000;
        const halfW = bombW / 2;
        const halfH = bombH / 2;
        player.bombs--;
        player.invinc = bombCfg.invincFrames; 
        screenShake = bombCfg.screenShake;
        flashScreen = bombCfg.flash;
        AudioSys.boom('big');
        const fxRadius = Math.hypot(bombW, bombH) / 2;
        createShockwave(player.x, player.y, fxRadius, '#ffaa00');
        
        DialogueSys.emuWonderhoy();

        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            if (Math.abs(e.x - player.x) > halfW) continue;
            if (Math.abs(e.y - player.y) > halfH) continue;
            if (e.type === 'boss') takeDamage(e, bombCfg.bossDamage);
            else takeDamage(e, bombCfg.normalDamage);
        }
        
        bullets = bullets.filter(b => b.owner === 'player');
        Comms.show("WONDERHOY!!", "EMU", "#ffaa00", "assets/images/player.png", { priority: true }); // Use player avatar if available
    }
}

function update() {
    frames++;
    let firedThisFrame = false;
    const specialCfg = PLAYER_CFG.ammo.special;
    
    // Camera
    camera.x += (player.x - width/2 - camera.x) * 0.1;
    camera.y += (player.y - height/2 - camera.y) * 0.1;
    camera.x = Math.max(0, Math.min(camera.x, WORLD_W - width));
    camera.y = Math.max(0, Math.min(camera.y, WORLD_H - height));

    // Player Move
    const locked = player.weaponLock > 0 || player.ammo <= 0;
    const speedPenalty = locked ? PLAYER_CFG.movementLockPenalty : 1;
    let spd = player.dashTime > 0 ? player.speed * PLAYER_CFG.dash.speedMultiplier : player.speed * speedPenalty;
    if (keys['KeyW']) player.y -= spd;
    if (keys['KeyS']) player.y += spd;
    if (keys['KeyA']) player.x -= spd;
    if (keys['KeyD']) player.x += spd;
    player.x = Math.max(20, Math.min(WORLD_W-20, player.x));
    player.y = Math.max(20, Math.min(WORLD_H-20, player.y));
    
    const worldMx = mouse.x + camera.x;
    const worldMy = mouse.y + camera.y;
    player.angle = Math.atan2(worldMy - player.y, worldMx - player.x);

    if (player.dashTime > 0) {
        player.dashTime--;
        createParticle(player.x, player.y, '#00ffff', 2, 0);
        if (player.dashTime === 0) {
            player.perfectDashWindow = PLAYER_CFG.dash.perfectWindow; // 冲刺结束后的强化射击窗口
            // Visual cue for perfect dash window start
            createShockwave(player.x, player.y, 60, '#00ffcc'); 
        } 
    }
    if (player.perfectDashWindow > 0) {
        player.perfectDashWindow--;
        // Continuous particle effect during window
        if (frames % 4 === 0) {
             createParticle(player.x + (Math.random()-0.5)*20, player.y + (Math.random()-0.5)*20, '#00ffcc', 2, 1);
        }
    }
    
    if (player.dashCd > 0) player.dashCd--;
    if (player.weaponLock > 0) player.weaponLock--;
    if (player.invinc > 0) player.invinc--;
    if (specialAmmoCooldown > 0) specialAmmoCooldown--;
    if (blackHolePull > 0) blackHolePull--;
    
    // Glitch Logic
    if (player.glitchTime > 0) {
        player.glitchTime--;
        if(Math.random() > 0.5) uiLayer.classList.add('glitch-ui');
        else uiLayer.classList.remove('glitch-ui');
    } else {
        uiLayer.classList.remove('glitch-ui');
    }
    
    // Shoot
    const fireCfg = PLAYER_CFG.weapon.fireRate;
    const fireRate = player.weaponLvl >= fireCfg.fastLevelThreshold
        ? fireCfg.fastFrameInterval
        : Math.max(fireCfg.min, fireCfg.base - Math.floor(player.weaponLvl / fireCfg.levelStepDivisor));

    // Perfect dash beam: fire instantly after dash regardless of normal fire cadence
    if (mouse.down && player.perfectDashWindow > 0 && canFireWeapon()) {
        playerShoot();
        consumeShotResources();
        firedThisFrame = true;
    } else if (mouse.down && frames % fireRate === 0 && canFireWeapon()) {
        playerShoot();
        consumeShotResources();
        firedThisFrame = true;
    }

    // Passive Ammo Regen (boss waves regen faster)
    const regenRate = bossActive ? PLAYER_CFG.ammo.bossRegenPerSec : PLAYER_CFG.ammo.regenPerSec;
    applyAmmoRegen(regenRate);

    // Special auto-aimed shot once weapon level is high enough
    if (player.weaponLvl >= specialCfg.levelReq && !specialAimLock && specialAmmoCooldown <= 0 && canFireWeapon() && enemies.length > 0) {
        const { target } = findNearestEnemy(player.x, player.y);
        if (target) {
            specialAimLock = { targetId: target.id, timer: specialCfg.windup, duration: specialCfg.windup };
        }
    }
    if (specialAimLock) {
        const lockTarget = enemies.find(e => e.id === specialAimLock.targetId);
        if (!lockTarget) {
            specialAimLock = null;
        } else if (specialAimLock.timer <= 0) {
            if (fireSpecialAmmo(lockTarget)) {
                firedThisFrame = true;
                specialAmmoCooldown = specialCfg.cooldown;
            }
            specialAimLock = null;
        } else {
            specialAimLock.timer--;
        }
    }

    // Passive Cooling
    if (!firedThisFrame) {
        const cooldownPerFrame = PLAYER_CFG.heat.cooldownPerSec / FPS;
        player.heat = Math.max(0, player.heat - cooldownPerFrame);
        if (player.weaponLock <= 0 && player.heat < player.heatMax * PLAYER_CFG.ammo.lockUnlockRatio && player.lockReason === 'heat') {
            player.lockReason = null;
        }
    }
    if (player.weaponLock <= 0 && player.lockReason === 'ammo' && player.ammo > 0) {
        player.lockReason = null;
    }

    // Spawning
    const baseSpawnRate = Math.max(SPAWN_CFG.minInterval, SPAWN_CFG.baseInterval - wave * SPAWN_CFG.waveAccel);
    const spawnRate = bossActive ? baseSpawnRate * SPAWN_CFG.bossSlowMultiplier : baseSpawnRate;
    if (frames % spawnRate === 0) prepareSpawn();

    // Slow down wave escalation: advance every 9600 frames instead of 1800
    if (frames % WAVE_CFG.advanceIntervalFrames === 0) {
        wave++;
        showWave(wave);
        DialogueSys.waveAlert(wave);
        
        if (endlessMode) {
            // Increase difficulty every 10 waves in endless
            if (wave % WAVE_CFG.endlessDifficultyStepInterval === 0) {
                difficultyMultiplier += WAVE_CFG.endlessDifficultyStep;
                Comms.show(`DIFFICULTY UP: x${difficultyMultiplier.toFixed(1)}`, "SYSTEM", "#ff0000", null, { priority: true });
            }
        }
    }

    // Indicators - NO SHOCKWAVE ON SPAWN
    for (let i = spawnIndicators.length - 1; i >= 0; i--) {
        const ind = spawnIndicators[i];
        ind.timer--;
        if (ind.timer <= 0) {
            spawnEnemy(ind.x, ind.y, ind.type);
            spawnIndicators.splice(i, 1);
        }
    }

    // Enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        const distToPlayer = Math.hypot(player.x - e.x, player.y - e.y);
        const angleToPlayer = Math.atan2(player.y - e.y, player.x - e.x);
        const offscreen = !isOnScreen(e.x, e.y);
        const throttled = offscreen && enemies.length > PERF_CFG.softCollisionLimit && (frames % PERF_CFG.farUpdateThrottle !== 0) && e.type !== 'boss';
        if (throttled) {
            if (e.cd > 0) e.cd--;
            if (e.stun > 0) e.stun--;
            if (e.timer > 0) e.timer--;
            continue;
        }

        // AI Behaviors
        const move = (vx, vy, opts = {}) => {
            steerEnemy(e, vx, vy, opts);
        };

        if (e.type === 'dasher') {
            if (e.state === 'chase') {
                e.color = '#ffff00';
                move(Math.cos(angleToPlayer) * e.speed, Math.sin(angleToPlayer) * e.speed, { maxSpeed: e.speed * 1.5 });
                if (distToPlayer < 300 && e.cd <= 0) { 
                    e.state = 'charge'; 
                    e.timer = 40; 
                }
            } else if (e.state === 'charge') {
                // Always track player during charge
                e.dashAngle = angleToPlayer;
                
                // Visual: Yellow -> Red
                const t = 1 - (e.timer / 40);
                const g = Math.floor(255 * (1-t)).toString(16).padStart(2, '0');
                e.color = `#ff${g}00`;

                move(0, 0, { drag: ENEMY_MOTION.dashDrag });
                e.timer--;
                if (e.timer <= 0) { 
                    e.state = 'dash'; 
                    e.timer = 60; // 3x dash duration for longer rush distance
                    AudioSys.dash();
                    createShockwave(e.x, e.y, 90, '#ffff66', { soft: true, speed: 14, fade: 0.06, spread: 22, lineWidth: 6 });
                }
            } else if (e.state === 'dash') {
                move(Math.cos(e.dashAngle) * 7, Math.sin(e.dashAngle) * 7, { blend: ENEMY_MOTION.dashBlend, drag: ENEMY_MOTION.dashDrag, maxSpeed: 11 });
                createParticle(e.x, e.y, '#ffff88', 3, 0);
                if (frames % 3 === 0) {
                    createParticle(e.x, e.y, '#ffdd55', 5, 0);
                }
                e.timer--;
                if(Math.random() < 0.05) DialogueSys.typeCAttack(); // Attack Bark
                if (e.timer <= 0) { 
                    e.state = 'cooldown'; 
                    e.timer = 30; 
                }
            } else if (e.state === 'cooldown') {
                // Slide
                move(Math.cos(e.dashAngle) * 0.8, Math.sin(e.dashAngle) * 0.8, { drag: 0.9 });
                e.timer--;
                if (e.timer <= 0) {
                    e.state = 'chase';
                    e.cd = 60;
                }
            }
            if (e.cd > 0) e.cd--;
        } 
        else if (e.type === 'sniper') {
            const optimalDist = 450;
            const strafeSpeed = 0.75;
            let forward = 0;
            
            // Kiting Logic (Maintain Ring)
            if (distToPlayer < optimalDist - 50) forward = -e.speed * 1.2;
            else if (distToPlayer > optimalDist + 50) forward = e.speed * 0.8;
            
            // Strafe
            const side = Math.sin(frames * 0.02 + (e.id || 0)) * strafeSpeed;
            
            // Random Micro-move check
            let targetVx;
            let targetVy;
            if (e.microMove) {
                 targetVx = e.microMove.vx;
                 targetVy = e.microMove.vy;
                 e.microMove.life--;
                 if (e.microMove.life <= 0) e.microMove = null;
            } else {
                 targetVx = Math.cos(angleToPlayer) * forward + Math.cos(angleToPlayer + Math.PI/2) * side;
                 targetVy = Math.sin(angleToPlayer) * forward + Math.sin(angleToPlayer + Math.PI/2) * side;
            }

            const maxSpeed = e.microMove ? 2.4 : e.speed * 1.4;
            move(targetVx, targetVy, { maxSpeed });

            if (frames % 120 === 0) {
                bullets.push({x:e.x, y:e.y, vx:Math.cos(angleToPlayer)*10, vy:Math.sin(angleToPlayer)*10, life:100, color:'#cc00ff', size:12, owner:'enemy'});
                AudioSys.enemyShoot();
                if(Math.random() < 0.2) DialogueSys.typeAAttack();
                
                // 50% chance for random micro-move
                if (Math.random() < 0.5) {
                    const ang = Math.random() * Math.PI * 2;
                    e.microMove = { vx: Math.cos(ang)*2, vy: Math.sin(ang)*2, life: 20 };
                }
            }
        }
        else if (e.type === 'sprayer') {
            move(Math.cos(angleToPlayer + 0.5) * e.speed, Math.sin(angleToPlayer + 0.5) * e.speed);
            if (frames % 10 === 0) {
                const sprayAngle = frames * 0.1;
                bullets.push({x:e.x, y:e.y, vx:Math.cos(sprayAngle)*4, vy:Math.sin(sprayAngle)*4, life:100, color:'#00ffff', size:8, owner:'enemy'});
            }
        }
        else if (e.type === 'minelayer') {
            if (e.stun > 0) {
                e.stun--;
                move(0, 0);
            } else {
                // Smooth wander with boundary avoid
                if (!e.wanderAngle) e.wanderAngle = Math.random() * Math.PI * 2;
                
                const margin = 200;
                let targetA = e.wanderAngle;
                
                if (e.x < margin) targetA = 0;
                else if (e.x > WORLD_W - margin) targetA = Math.PI;
                else if (e.y < margin) targetA = Math.PI/2;
                else if (e.y > WORLD_H - margin) targetA = -Math.PI/2;
                else {
                    e.wanderAngle += (Math.random() - 0.5) * 0.2;
                    targetA = e.wanderAngle;
                }
                e.wanderAngle = targetA;
                
                move(Math.cos(e.wanderAngle) * e.speed, Math.sin(e.wanderAngle) * e.speed, { maxSpeed: e.speed * 1.2 });
            }

            if (frames % 120 === 0) {
                spawnEnemy(e.x, e.y, 'mine');
                e.stun = 15; // Deployment Lag
                if(Math.random() < 0.2) DialogueSys.typeBAttack();
            }
        }
        else if (e.type === 'mine') { /* Static */ }
        else if (e.type === 'boss') {
            e.phaseTimer = (e.phaseTimer || 0) + 1;
            const phase = Math.floor(e.phaseTimer / 300) % 3;
            if (e.laserCooldown === undefined) e.laserCooldown = 240; // Delay first beam a bit
            if (e.laserWarmup > 0) e.laserWarmup--;
            if (e.laserCooldown > 0) e.laserCooldown--;
            const laserActive = bullets.some(b => b.laserBeam && b.anchorId === e.id);
            const laserBusy = (e.laserWarmup !== undefined) || laserActive; // Prevent other attacks during laser
            move(Math.cos(angleToPlayer) * 0.5, Math.sin(angleToPlayer) * 0.5, { blend: 0.1, drag: 0.92, maxSpeed: 1 });

            // New Skill: Orbiting mega-laser that sweeps 360 degrees
            if (phase === 2 && e.laserCooldown <= 0 && !laserActive) {
                if (e.laserWarmup === undefined) {
                    e.laserWarmup = 60; // Telegraph before firing
                    createShockwave(e.x, e.y, 260, '#ff6600', { soft: true, speed: 12, fade: 0.05, spread: 28, lineWidth: 7 });
                    DialogueSys.bossAttack();
                } else if (e.laserWarmup === 0) {
                    bullets.push({
                        x: e.x,
                        y: e.y,
                        owner: 'enemy',
                        laserBeam: true,
                        anchorId: e.id,
                        angle: angleToPlayer + Math.PI, // Start opposite to player
                        angularSpeed: ENEMY_CFG.boss.laser.angularSpeed,
                        length: ENEMY_CFG.boss.laser.length,
                        width: ENEMY_CFG.boss.laser.width,
                        color: ENEMY_CFG.boss.laser.color,
                        life: ENEMY_CFG.boss.laser.duration
                    });
                    e.laserCooldown = ENEMY_CFG.boss.laser.cooldown;
                    e.laserWarmup = undefined;
                }
            }

            // Skip normal bullet patterns while the laser is charging/firing
            if (!laserBusy && frames % 10 === 0) {
                if(Math.random() < 0.02) DialogueSys.bossAttack();
                if (phase === 0) {
                    for(let k=0; k<3; k++) {
                        const a = frames*0.1 + (k*2);
                        bullets.push({x:e.x, y:e.y, vx:Math.cos(a)*5, vy:Math.sin(a)*5, life:600, color:'#ffaa00', size:12, owner:'enemy'});
                    }
                } else if (phase === 1) {
                    if (frames % 60 === 0) {
                        for(let k=0; k<12; k++) {
                            const a = (Math.PI*2/12)*k;
                            bullets.push({x:e.x, y:e.y, vx:Math.cos(a)*6, vy:Math.sin(a)*6, life:600, color:'#ff3333', size:16, owner:'enemy'});
                        }
                        AudioSys.boom('small');
                    }
                } else {
                    if (frames % 20 === 0) {
                        const spread = 0.3;
                        for(let k=-1; k<=1; k++) {
                            const a = angleToPlayer + k*spread;
                            bullets.push({x:e.x, y:e.y, vx:Math.cos(a)*6, vy:Math.sin(a)*6, life:600, color:'#ff00ff', size:16, owner:'enemy'});
                        }
                    }
                }
            }
        } 
        else { // Basic
            // Group Pressure & Evasion
            let evade = 0;
            if ((frames % 600) < 60) { // S-curve evasion (1s every 10s)
                evade = Math.sin(frames * 0.2) * 2;
            }
            
            // Flanking pressure is handled by soft collision below pushing them apart
            // But we can add a slight tangent bias
            const tangent = Math.cos(frames * 0.01 + (e.id||0)) * 0.2;

            const targetVx = Math.cos(angleToPlayer + tangent) * e.speed + Math.cos(angleToPlayer + Math.PI/2) * evade;
            const targetVy = Math.sin(angleToPlayer + tangent) * e.speed + Math.sin(angleToPlayer + Math.PI/2) * evade;
            move(targetVx, targetVy);
        }

        // Soft Collision (skip when enemy count is high to avoid O(n^2) blowup)
        const skipSoftCollision = enemies.length > PERF_CFG.softCollisionLimit || e.type === 'mine';
        if (!skipSoftCollision) {
            for (let j=i+1; j<enemies.length; j++) {
                const o = enemies[j];
                if (o.type === 'mine') continue;
                const dx = e.x - o.x; const dy = e.y - o.y;
                const d = Math.hypot(dx, dy);
                if (d > 0 && d < e.radius + o.radius) {
                    const force = 0.5; 
                    e.x += (dx/d) * force; e.y += (dy/d) * force;
                }
            }
        }

        if (distToPlayer < e.radius + player.radius) {
            if (player.invinc <= 0) {
                if(e.type === 'mine') takeDamage(e, 999);
                takePlayerDamage();
            }
        }
    }

    // Bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        if (b.laserBeam) {
            const anchor = enemies.find(en => en.id === b.anchorId && en.type === 'boss');
            if (!anchor) { bullets.splice(i, 1); continue; }
            b.life--;
            b.angle += b.angularSpeed || 0;
            b.x = anchor.x;
            b.y = anchor.y;

            const startX = anchor.x;
            const startY = anchor.y;
            const endX = startX + Math.cos(b.angle) * b.length;
            const endY = startY + Math.sin(b.angle) * b.length;
            const dx = endX - startX;
            const dy = endY - startY;
            const denom = dx*dx + dy*dy || 1;
            const t = clamp(((player.x - startX) * dx + (player.y - startY) * dy) / denom, 0, 1);
            const closestX = startX + dx * t;
            const closestY = startY + dy * t;
            if (Math.hypot(player.x - closestX, player.y - closestY) < player.radius + (b.width || 0) / 2) {
                if (player.invinc <= 0) takePlayerDamage();
            }

            if (b.life <= 0) { bullets.splice(i, 1); }
            continue;
        }
        if (b.homing) {
            let target = player;
            if (b.owner === 'player') {
                const lockRange = b.lockRange || PLAYER_CFG.weapon.homingLockRange || 500;
                let minDist = lockRange;
                target = null;
                for(const e of enemies) {
                    const d = Math.hypot(e.x - b.x, e.y - b.y);
                    if (b.targetId && e.id === b.targetId) {
                        target = e;
                        minDist = d;
                        break;
                    }
                    if (d < minDist) { minDist = d; target = e; }
                }
            }
            
            if (target) {
                const dx = target.x - b.x; const dy = target.y - b.y;
                const angle = Math.atan2(dy, dx);
                b.vx = b.vx * 0.92 + Math.cos(angle) * 1.5; 
                b.vy = b.vy * 0.92 + Math.sin(angle) * 1.5;
            }
        }
        
        b.x += b.vx; b.y += b.vy; b.life--;
        
        if (b.owner === 'player') {
            for (let j = enemies.length - 1; j >= 0; j--) {
                const e = enemies[j];
                if (Math.abs(b.x - e.x) > 800 || Math.abs(b.y - e.y) > 800) continue;
                // Collision Logic
                // For Perfect Shot (large laser), we use a slightly more generous collision circle
                const hitRadius = b.isPerfect ? b.size * 1.2 : b.size;
                
                if (Math.hypot(b.x - e.x, b.y - e.y) < e.radius + hitRadius) {
                    const baseDmg = getWeaponBaseDamage(player.weaponLvl);
                    const dmg = b.damageMult ? Math.floor(baseDmg * b.damageMult) : baseDmg;
                    takeDamage(e, dmg);  
                    createParticle(b.x, b.y, b.color, 2, 2);
                    if (!b.pierce || b.pierce <= 0) {
                        bullets.splice(i, 1);
                    } else {
                        b.pierce--;
                    }
                    break;
                }
            }
        } else {
            // Larger collision for enemy bullets to be fair
            if (Math.hypot(b.x - player.x, b.y - player.y) < player.radius + b.size + 5) {
                if (player.invinc <= 0) { takePlayerDamage(); bullets.splice(i, 1); }
            }
        }
        if (b.life <= 0 || b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
            if (bullets[i] === b) bullets.splice(i, 1);
        }
    }

    // Particles
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        if (p.shockwave) {
            const growth = p.speed !== undefined ? p.speed : 20;
            const fade = p.fade !== undefined ? p.fade : 0.02;
            p.radius += growth;
            p.life -= fade;
            if (p.maxR && p.radius >= p.maxR) p.life = 0;
        } else {
            p.x += p.vx; p.y += p.vy; p.life -= 0.05;
        }
        if (p.life <= 0) particles.splice(i, 1);
    }

    // Pickups
    for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i];
        const d = Math.hypot(player.x - p.x, player.y - p.y);
        const pullActive = blackHolePull > 0;
        const pullRange = pullActive ? Math.max(WORLD_W, WORLD_H) : 150;
        const pullStrength = pullActive ? 0.18 + (blackHolePull / 900) : 0.1;
        const collectDist = pullActive ? 40 : 20;
        if (d < pullRange) { 
            p.x += (player.x - p.x) * pullStrength; 
            p.y += (player.y - p.y) * pullStrength; 
        }
        if (d < collectDist) {
            if (p.type === 'blackHole') {
                blackHolePull = Math.max(blackHolePull, 180);
                createShockwave(player.x, player.y, 260, '#5511aa', { fade: 0.06, speed: 18, spread: 30, lineWidth: 8 });
                AudioSys.boom('big');
                createText(player.x, player.y, "BLACK HOLE", "#aa88ff");
                pickups.splice(i, 1);
                continue;
            }
            if (p.type==='hp') { 
                const wasFull = player.hp >= player.maxHp;
                player.hp=Math.min(player.hp+1, player.maxHp); 
                createText(player.x, player.y, "+HP", "#00ff00"); 
                if (!wasFull) {
                    DialogueSys.hpRecover();
                    DialogueSys.emuHeal();
                }
            }
            if (p.type==='xp') { 
                const prevLvl = player.weaponLvl;
                player.weaponXp += XP_CFG.pickupGain; 
                // Higher threshold per level
                const threshold = getXpThreshold(player.weaponLvl);
                if(player.weaponXp>=threshold) { 
                    if(player.weaponLvl < LEVEL_CAP) {
                        player.weaponLvl++; 
                        player.weaponXp=0; 
                        createText(player.x, player.y, "LEVEL UP!", "#ffff00"); 
                        AudioSys.powerup();
                        DialogueSys.levelUp(player.weaponLvl >= LEVEL_CAP);
                        DialogueSys.emuLevelUp();
                    } else {
                        player.weaponXp = threshold; // Maxed
                        createText(player.x, player.y, "MAX PWR", "#ffaa00");
                        if (prevLvl < LEVEL_CAP) {
                            DialogueSys.levelUp(true);
                            DialogueSys.emuLevelUp();
                        }
                    }
                } else createText(player.x, player.y, "+XP", "#00ffff");
            }
            if (p.type==='bomb') { player.bombs++; createText(player.x, player.y, "+BOMB", "#ffaa00"); AudioSys.powerup(); }
            if (p.type==='ammo') { 
                player.ammo = player.maxAmmo; 
                player.weaponLock = 0; 
                player.lockReason = null;
                createText(player.x, player.y, "AMMO CORE", "#33ffaa"); 
                AudioSys.powerup(); 
            }
            if (p.type==='coolant') { 
                player.heat = 0; 
                player.weaponLock = 0; 
                player.lockReason = null;
                createText(player.x, player.y, "COOLANT", "#66ccff"); 
                AudioSys.powerup(); 
            }
            if (p.type === 'miniBomb') {
                const mb = PLAYER_CFG.miniBomb;
                createShockwave(player.x, player.y, mb.shockwaveRadius, mb.color, mb.shockwave);
                for(let k=0; k < mb.burstCount; k++) {
                    const angle = (Math.PI * 2 / mb.burstCount) * k;
                    bullets.push({
                        x: player.x, 
                        y: player.y, 
                        vx: Math.cos(angle) * 10, 
                        vy: Math.sin(angle) * 10, 
                        life: 300, 
                        color: mb.color, 
                        size: 12, 
                        owner: 'player', 
                        homing: true
                    });
                }
                createText(player.x, player.y, mb.text, mb.color);
                AudioSys.boom(mb.sfx);
            }
            pickups.splice(i, 1);
        }
    }
    
    // Text
    for (let i = floats.length - 1; i >= 0; i--) {
        floats[i].y -= 1; floats[i].life--;
        if(floats[i].life <= 0) floats.splice(i, 1);
    }

    if (screenShake > 0) screenShake *= 0.9;
    if (flashScreen > 0) flashScreen--;

    uiScore.innerText = score.toString().padStart(6, '0');
    uiBomb.innerText = `BOMB x${player.bombs}`;
    uiHp.style.width = `${(player.hp/player.maxHp)*100}%`;
    const ammoRatio = clamp(player.ammo / player.maxAmmo, 0, 1);
    uiAmmo.style.width = `${(ammoRatio*100).toFixed(1)}%`;
    uiAmmoText.innerText = `${Math.floor(player.ammo)}/${player.maxAmmo}`;
    if (uiSpecial && uiSpecialText) {
        const dashLaser = getDashLaserState();
        uiSpecial.style.width = `${(dashLaser.ratio*100).toFixed(1)}%`;
        uiSpecialText.innerText = dashLaser.label;
        uiSpecialText.classList.toggle('pill-ready', dashLaser.ready);
        if (uiSpecialBox) uiSpecialBox.classList.toggle('special-ready', dashLaser.ready);
    }
    const heatRatio = clamp(player.heat / player.heatMax, 0, 1);
    uiHeat.style.width = `${(heatRatio*100).toFixed(1)}%`;
    uiHeatText.innerText = `${Math.round(heatRatio*100)}%`;
    uiHeatStatus.innerText = (player.weaponLock > 0 || player.ammo <= 0) ? "COOLDOWN" : "STABLE";
    const nextXp = getXpThreshold(player.weaponLvl);
    xpVisual.target = clamp(player.weaponXp / nextXp, 0, 1);
    xpVisual.current = lerp(xpVisual.current, xpVisual.target, xpVisual.target < xpVisual.current ? 0.18 : 0.35);
    if (xpVisual.loss < xpVisual.current) xpVisual.loss = xpVisual.current;
    xpVisual.loss = lerp(xpVisual.loss, xpVisual.target, xpVisual.loss > xpVisual.target ? 0.08 : 0.3);
    uiXpLoss.style.width = `${(xpVisual.loss*100).toFixed(1)}%`;
    uiXp.style.width = `${(xpVisual.current*100).toFixed(1)}%`;
    if (xpHitTimer > 0) {
        xpHitTimer--;
        xpContainer.style.filter = 'drop-shadow(0 0 10px rgba(255, 120, 120, 0.5))';
    } else {
        xpContainer.style.filter = '';
    }
    uiLvl.innerText = player.weaponLvl >= LEVEL_CAP ? "MAX" : player.weaponLvl;
}

// --- SPAWN SYSTEM ---

function prepareSpawn() {
    if (enemies.length >= PERF_CFG.maxEnemies) return; // Skip spawning when at cap

    const dist = Math.max(width, height) / 2 + 100;
    const ang = Math.random() * Math.PI * 2;
    let sx = player.x + Math.cos(ang) * dist;
    let sy = player.y + Math.sin(ang) * dist;
    sx = Math.max(50, Math.min(WORLD_W-50, sx));
    sy = Math.max(50, Math.min(WORLD_H-50, sy));

    const roll = Math.random();
    let type = 'basic';
    
    if (wave > 1 && roll > 0.6) type = 'dasher';
    if (wave > 2 && roll > 0.75) type = 'minelayer';
    if (wave > 3 && roll > 0.85) type = 'sniper';
    if (wave > 4 && roll > 0.92) type = 'sprayer';
    
    // Boss Logic: Wave 5 in Story, or Every 10 Waves in Endless
    let bossWave = false;
    if (!endlessMode && wave === SPAWN_CFG.bossStoryWave) bossWave = true;
    if (endlessMode && wave % SPAWN_CFG.bossEndlessInterval === 0) bossWave = true;

    if (bossWave && Math.random() < SPAWN_CFG.bossChance && !enemies.some(e=>e.type==='boss')) type = 'boss';

    // Reduce minelayer/sniper spawn rate to 30% of original
    if (type === 'minelayer' && Math.random() < 0.7) type = 'basic';
    if (type === 'sniper' && Math.random() < 0.7) type = 'basic';

    spawnIndicators.push({ x: sx, y: sy, type: type, timer: SPAWN_CFG.indicatorTime });
}

function spawnEnemy(x, y, type) {
    if (type !== 'boss' && enemies.length >= PERF_CFG.maxEnemies) return;
    if (type === 'mine' && getEnemyCount('mine') >= PERF_CFG.maxMines) return;

    const typeCfg = ENEMY_CFG.types[type] || ENEMY_CFG.types.basic;
    let stats = { ...typeCfg, id: Math.random()*100 };
    if (type === 'dasher') {
        stats = { ...stats, state: 'chase', cd: 0 };
        if(Math.random() < 0.3) DialogueSys.typeCSpawn();
    }
    if (type === 'sniper') {
        if(Math.random() < 0.3) DialogueSys.typeASpawn();
    }
    if (type === 'sprayer') {
        if(Math.random() < 0.3) DialogueSys.typeASpawn();
    }
    if (type === 'minelayer') {
        stats = { ...stats, angle: 0 };
        if(Math.random() < 0.3) DialogueSys.typeBSpawn();
    }
    if (type === 'mine') {
        // No dialogue for mines usually
    }
    if (type === 'basic') {
        if(Math.random() < 0.1) DialogueSys.typeBSpawn();
    }
    if (type === 'boss') {
        bossActive = true;
        enemies = [];
        resetEnemyCounts();
        bullets = bullets.filter(b => b.owner === 'player');
        spawnIndicators = [];
        const bossCfg = ENEMY_CFG.boss;
        stats = { 
            hp: (bossCfg.baseHp + wave * bossCfg.hpPerWave) * bossCfg.hpMultiplier, 
            speed: bossCfg.speed, 
            color: bossCfg.color, 
            radius: bossCfg.radius, 
            id: Math.random()*100 
        };
        DialogueSys.bossEntry();
        screenShake = 60;
        flashScreen = 20;
        AudioSys.boom('big');
        createShockwave(x, y, 2000, '#ff0000');
    }
    if (type !== 'mine') stats.hp += wave * ENEMY_CFG.perWaveHpBonus; 
    
    // Endless Mode Scaling
    if (endlessMode) {
        // Endless Wave Count (Starting from 0 when Endless begins after Wave 5)
        const endlessWave = Math.max(0, wave - SPAWN_CFG.bossStoryWave);
        
        // HP Scaling:
        // Multiplier (stepped) * Linear growth per wave (30% per wave)
        const hpGrowth = 1 + (endlessWave * ENDLESS_CFG.hpPerWaveRatio); 
        stats.hp *= difficultyMultiplier * hpGrowth;

        // Speed Scaling:
        // Capped at 5 to prevent unplayable speed
        stats.speed = Math.min(stats.speed * (1 + endlessWave * ENDLESS_CFG.speedPerWaveRatio), ENDLESS_CFG.speedCap); 

        // Size (Volume) Scaling:
        // Significant permanent increase per wave (5% per wave)
        // Cap at 3x original size to keep game playable
        const sizeGrowth = 1 + (endlessWave * ENDLESS_CFG.radiusPerWaveRatio);
        stats.radius *= Math.min(sizeGrowth, ENDLESS_CFG.radiusCap);
    }

    addEnemy({ x, y, type, ...stats, maxHp: stats.hp });
}

function fireSpecialAmmo(target) {
    if (!target || !canFireWeapon()) return false;
    const specialCfg = PLAYER_CFG.ammo.special;
    consumeShotResources();
    AudioSys.shoot();
    AudioSys.playTone(520, 'triangle', 0.22, 0.05);
    const ang = Math.atan2(target.y - player.y, target.x - player.x);
    bullets.push({
        x: player.x + Math.cos(ang) * 20,
        y: player.y + Math.sin(ang) * 20,
        vx: Math.cos(ang) * specialCfg.speed,
        vy: Math.sin(ang) * specialCfg.speed,
        life: 140,
        size: 18,
        color: '#ff66ff',
        owner: 'player',
        homing: true,
        lockRange: specialCfg.lockRange,
        targetId: target.id,
        pierce: 1,
        damageMult: specialCfg.damageMult,
        special: true
    });
    createShockwave(player.x, player.y, 50, '#ff66ff', { soft: true, speed: 10, fade: 0.04, spread: 22 });
    return true;
}

function playerShoot() {
    // Perfect Dash Shot (Long Laser)
    if (player.perfectDashWindow > 0) {
        AudioSys.shoot();
        AudioSys.playTone(800, 'sawtooth', 0.2, 0.2); // Special sound
        
        bullets.push({
            x: player.x + Math.cos(player.angle)*20, y: player.y + Math.sin(player.angle)*20,
            vx: Math.cos(player.angle)*9, vy: Math.sin(player.angle)*9, // Slower speed
            life: 150, size: 50, color: '#00ffcc', owner: 'player', // Size increased
            homing: false, pierce: 20, damageMult: 25, isPerfect: true 
        });
        
        player.perfectDashWindow = 0; // Consume
        createShockwave(player.x, player.y, 100, '#00ffcc');
        screenShake = 15;
        return;
    }

    AudioSys.shoot();
    let count = 1;
    let spread = 0;
    let speed = 15;
    let color = '#00ffff'; 
    let homing = false;
    let pierce = 0;
    let size = 4;

    // --- EXPANDED WEAPON PROGRESSION (按等级逐步解锁) ---
    const lv = player.weaponLvl;
    
    if (lv === 1) { count=1; speed=15; }
    if (lv === 2) { count=1; speed=18; size=5; }
    if (lv === 3) { count=2; spread=0.1; speed=16; }
    if (lv === 4) { count=2; spread=0.1; speed=18; size=5; color='#0088ff'; }
    if (lv === 5) { count=3; spread=0.2; speed=16; color='#0088ff'; }
    if (lv === 6) { count=3; spread=0.2; speed=18; color='#0088ff'; }
    if (lv === 7) { count=3; spread=0.3; speed=15; color='#aa00ff'; homing=true; }
    if (lv === 8) { count=4; spread=0.3; speed=16; color='#aa00ff'; homing=true; }
    if (lv === 9) { count=5; spread=0.4; speed=16; color='#aa00ff'; homing=true; }
    if (lv >= LEVEL_CAP) { count=5; spread=0.4; speed=20; color='#ffaa00'; homing=true; pierce=1; size=6; }

    for(let i=0; i<count; i++) {
        let a = player.angle;
        if (count % 2 === 0) a += (i - count/2 + 0.5) * spread; // Even spread
        else a += (i - (count-1)/2) * spread; // Odd spread

        bullets.push({
            x: player.x + Math.cos(a)*20, y: player.y + Math.sin(a)*20,
            vx: Math.cos(a)*speed, vy: Math.sin(a)*speed,
            life: 80, size: size * 2, color: color, owner: 'player', 
            homing: homing, pierce: pierce, lockRange: homing ? PLAYER_CFG.weapon.homingLockRange : undefined
        });
    }
}

function takeDamage(e, dmg) {
    let finalDmg = dmg;
    // Dasher Weakness: 30% more damage during Charge state
    if (e.type === 'dasher' && e.state === 'charge') {
        finalDmg = Math.ceil(dmg * ENEMY_CFG.dasherChargeWeakness);
        createText(e.x, e.y - 10, "CRIT!", "#ff0000");
    }

    e.hp -= finalDmg;
    e.hitScale = 0.9; // Hit Feedback: Shrink
    createText(e.x, e.y, finalDmg, "#ffffff");
    
    // Boss Low HP trigger (once per boss)
    if (e.type === 'boss' && e.hp < e.maxHp * 0.3 && !e.lowHpTriggered) {
        e.lowHpTriggered = true;
        DialogueSys.bossLowHp();
    }

    if (e.hp <= 0) {
        removeEnemy(e);
        if (e.type === 'boss') {
            bossActive = enemies.some(en => en.type === 'boss');
            // Story Mode Completion
            // Use >= 5 to catch cases where wave might advance slightly past 5 during fight
            if (!bossActive && !endlessMode && wave >= SPAWN_CFG.bossStoryWave) {
                gameActive = false;
                AudioSys.stopShots();
                missionCompleteScreen.style.display = 'flex';
                // Stop loop explicitly
                if(animationFrameId) {
                     cancelAnimationFrame(animationFrameId);
                     animationFrameId = null;
                }
                return;
            }
        }
        
        // Death Dialogue
        if (Math.random() < 0.4) {
            if (e.type === 'dasher') DialogueSys.typeCDeath();
            else if (e.type === 'sniper' || e.type === 'sprayer') DialogueSys.typeADeath();
            else if (e.type === 'minelayer' || e.type === 'basic') DialogueSys.typeBDeath();
        }

        if(e.type === 'mine') { AudioSys.boom('small'); createShockwave(e.x, e.y, 32, '#00ff00', { soft: true, speed: 9, fade: 0.05, spread: 14 }); return; }
        
        score += e.maxHp * ENEMY_CFG.scorePerHp;
        AudioSys.boom(e.type==='boss'?'big':'small');

        // Drop logic with Ammo/Coolant priorities
        let dropped = false;
        const drops = ENEMY_CFG.drops;
        if (Math.random() < drops.blackHoleChance) {
            pickups.push({x:e.x, y:e.y, type:'blackHole', color:'#111122'});
            dropped = true;
        }

        if (!dropped) {
            const ammoChance = e.type === 'minelayer' ? drops.ammoCoreChanceMinelayer : drops.ammoCoreChance;
            if (Math.random() < ammoChance) {
                pickups.push({x:e.x, y:e.y, type:'ammo', color:'#33ffaa'});
                dropped = true;
            } else if ((e.type === 'dasher' || e.type === 'sniper') && Math.random() < drops.coolantChanceFromElites) {
                pickups.push({x:e.x, y:e.y, type:'coolant', color:'#66ccff'});
                dropped = true;
            }
        }

        if (!dropped) {
            if (Math.random() < drops.bombChance) pickups.push({x:e.x, y:e.y, type:'bomb', color:'#ffaa00'});
            else if (Math.random() < drops.miniBombChance) pickups.push({x:e.x, y:e.y, type:'miniBomb', color: PLAYER_CFG.miniBomb.color});
            else if (Math.random() < drops.hpChance) pickups.push({x:e.x, y:e.y, type:'hp', color:'#00ff00'});
            else pickups.push({x:e.x, y:e.y, type:'xp', color:'#00ffff'});
        }
        for(let i=0; i<10; i++) createParticle(e.x, e.y, e.color, 4, 4);
    }
}

function takePlayerDamage() {
    player.hp--;
    // PENALTY: 按配置扣除当前等级经验，可触发掉级
    const lossBase = getXpThreshold(player.weaponLvl);
    const lossPercent = XP_CFG.lossPercentOnHit;
    const xpLoss = Math.max(1, Math.floor(lossBase * lossPercent));
    player.weaponXp -= xpLoss;

    let leveledDown = false;
    if (player.weaponXp <= 0 && player.weaponLvl > 1) {
        player.weaponLvl--;
        player.weaponXp = getXpThreshold(player.weaponLvl);
        leveledDown = true;
    } else {
        player.weaponXp = Math.max(0, player.weaponXp);
    }

    if (xpLoss > 0 || leveledDown) {
        DialogueSys.levelDown();
        triggerXpDropVisual();
        const nextThresh = getXpThreshold(player.weaponLvl);
        xpVisual.target = clamp(player.weaponXp / nextThresh, 0, 1);
        xpVisual.loss = Math.max(xpVisual.loss, xpVisual.current || 0.001);
    }

    player.invinc = 40; // Reduced from 60 (0.66s iframe)
    player.glitchTime = 20; // Glitch FX
    screenShake = 30;
    flashScreen = 8;
    AudioSys.damage();
    DialogueSys.damage();

    createText(player.x, player.y, "SYSTEM DMG", "#ff0000");
    createText(player.x, player.y-20, leveledDown ? "LEVEL DOWN" : "XP LOST", "#ff0000");
    
    if (player.hp <= 0) {
        AudioSys.stopShots();
        gameActive = false;
        document.getElementById('final-score').innerText = `SCORE: ${score}`;
        document.getElementById('game-over-screen').style.display = 'flex';
        document.getElementById('ai-analysis').innerText = "……";
        DialogueSys.failure(score);
    }
}

// --- RENDER ---

function createParticle(x, y, col, size, spd) {
    if (particles.length >= PERF_CFG.maxParticles) return;
    particles.push({x, y, vx: (Math.random()-0.5)*spd, vy: (Math.random()-0.5)*spd, life: 1, color: col, size});
}
function createShockwave(x, y, r, col, opts = {}) {
    if (particles.length >= PERF_CFG.maxParticles) return;
    particles.push({
        x, y,
        radius: opts.startRadius ?? 8,
        maxR: r,
        life: 1,
        color: col,
        shockwave: true,
        speed: opts.speed ?? 20,
        fade: opts.fade ?? 0.02,
        soft: !!opts.soft,
        spread: opts.spread ?? 16,
        lineWidth: opts.lineWidth ?? 5
    });
}
function createText(x, y, txt, col) {
    floats.push({x, y, text: txt, color: col, life: 40});
}

function drawSprite(img, x, y, size, rotation = 0, tint = null) {
    if (!img) return false;
    const baseW = img.width || img.naturalWidth || size;
    const baseH = img.height || img.naturalHeight || size;
    const baseSize = Math.max(baseW, baseH) || size || 1;
    const scale = size / baseSize;
    const w = baseW * scale;
    const h = baseH * scale;

    ctx.save();
    ctx.translate(x, y);
    if (rotation) ctx.rotate(rotation);
    const renderImg = tint ? Assets.getTintedImage(img, tint) : img;
    ctx.drawImage(renderImg || img, -w / 2, -h / 2, w, h);
    ctx.restore();
    return true;
}

function loop() {
    if (!gameActive) return;
    try {
        update();
        draw();
    } catch(e) {
        console.error("Game Loop Error:", e);
    }
    animationFrameId = requestAnimationFrame(loop);
}

function draw() {
    ctx.fillStyle = '#050510';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    
    // Screen Glitch Offset
    let gx=0, gy=0;
    if(player.glitchTime > 0 && Math.random()>0.5) {
        gx = (Math.random()-0.5)*10;
        gy = (Math.random()-0.5)*5;
    }

    let sx = (Math.random()-0.5)*screenShake + gx;
    let sy = (Math.random()-0.5)*screenShake + gy;
    ctx.translate(-Math.floor(camera.x) + sx, -Math.floor(camera.y) + sy);

    // 0. Background with original art
    if (Assets.images.bg) {
        ctx.drawImage(Assets.images.bg, 0, 0, WORLD_W, WORLD_H);
    } else if (Assets.pattern) {
        ctx.fillStyle = Assets.pattern;
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    } else {
        ctx.fillStyle = '#050510';
        ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    }

    // 1. Grid
    const gridSize = 100;
    const pulse = 0.1 + Math.sin(frames*0.05)*0.05;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgba(0, 204, 255, ${pulse})`;
    const startX = Math.floor(camera.x/gridSize)*gridSize;
    const endX = startX + width + gridSize;
    const startY = Math.floor(camera.y/gridSize)*gridSize;
    const endY = startY + height + gridSize;

    ctx.beginPath();
    for (let x=startX; x<=endX; x+=gridSize) { ctx.moveTo(x, camera.y); ctx.lineTo(x, camera.y+height); }
    for (let y=startY; y<=endY; y+=gridSize) { ctx.moveTo(camera.x, y); ctx.lineTo(camera.x+width, y); }
    ctx.stroke();

    // 2. Stars
    stars.forEach(s => {
        if (s.x > camera.x && s.x < camera.x+width && s.y > camera.y && s.y < camera.y+height) {
            ctx.fillStyle = s.color; ctx.globalAlpha = Math.random()*0.5 + 0.2;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.size, 0, Math.PI*2); ctx.fill();
        }
    });
    ctx.globalAlpha = 1;

    // 3. Boundaries
    ctx.strokeStyle = '#ff0000'; ctx.lineWidth = 4; ctx.strokeRect(0,0,WORLD_W,WORLD_H);

    // 4. Spawn Indicators (MINIMALIST - NO BIG RING)
    spawnIndicators.forEach(ind => {
        const maxTimer = SPAWN_CFG.indicatorTime;
        const progress = ind.timer / maxTimer;
        let color = '#ff0000';
        
        if (ind.type === 'dasher') color = '#ffff00';
        if (ind.type === 'sniper') color = '#cc00ff';
        if (ind.type === 'sprayer') color = '#00ffff';
        if (ind.type === 'minelayer') color = '#33ff33';
        if (ind.type === 'boss') color = '#ff3300';

        ctx.save();
        ctx.translate(ind.x, ind.y);

        // Advance warning: pulsing gradient dome that appears early
        const warnStrength = 1 - progress; // stronger when just spawned
        const baseRadius = 80 + Math.sin(frames * 0.2) * 8;
        const radius = baseRadius * (1 + warnStrength * 0.8);
        const grad = ctx.createRadialGradient(0, 0, radius * 0.25, 0, 0, radius);
        grad.addColorStop(0, withAlpha('#ffffff', 0.45 * warnStrength));
        grad.addColorStop(0.35, withAlpha(color, 0.35 + 0.2 * warnStrength));
        grad.addColorStop(1, withAlpha(color, 0));
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';

        // Crosshair + rotating frame
        ctx.globalAlpha = 0.6 + Math.sin(frames * 0.5) * 0.4;
        ctx.strokeStyle = color;
        ctx.lineWidth = 2; 
        
        // Cross
        const size = 5 + warnStrength * 6;
        ctx.beginPath();
        ctx.moveTo(-size, 0); ctx.lineTo(size, 0);
        ctx.moveTo(0, -size); ctx.lineTo(0, size);
        ctx.stroke();

        // Rotating rhombus frame
        ctx.save();
        ctx.rotate(frames * 0.05);
        const rhombus = 14 + warnStrength * 10;
        ctx.beginPath();
        ctx.moveTo(0, -rhombus);
        ctx.lineTo(rhombus, 0);
        ctx.lineTo(0, rhombus);
        ctx.lineTo(-rhombus, 0);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // Tiny text
        ctx.fillStyle = color;
        ctx.font = '8px Courier New';
        ctx.textAlign = 'center';
        ctx.fillText("TARGET", 0, -10 - warnStrength * 6);

        ctx.restore();
    });

    // 5. Pickups (Enhanced Visibility)
    pickups.forEach(p => {
        if (!isOnScreen(p.x, p.y)) return;
        const bob = Math.sin(frames*0.1)*3;
        
        // 1. Draw "Item Container" Effect (Rotating Box)
        ctx.save();
        ctx.translate(p.x, p.y + bob);
        ctx.rotate(frames * 0.02);
        ctx.strokeStyle = p.color || '#ffffff';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 5;
        ctx.shadowColor = p.color || '#ffffff';
        const boxSize = p.type === 'xp' ? 18 : (p.type === 'blackHole' ? 30 : 26);
        ctx.strokeRect(-boxSize/2, -boxSize/2, boxSize, boxSize);
        ctx.restore();

        // 2. Draw Sprite or Icon
        let sprite = null;
        let tint = null;
        let size = 20;

        if (p.type === 'hp') {
            sprite = Assets.images.health;
            size = 24;
        } else if (p.type === 'bomb') {
            // Draw custom Bomb icon instead of Enemy sprite
            ctx.save();
            ctx.translate(p.x, p.y + bob);
            ctx.shadowBlur = 10;
            ctx.shadowColor = '#ffaa00';
            ctx.fillStyle = '#ffaa00';
            ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.font = 'bold 14px Courier New';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("B", 0, 1);
            ctx.restore();
        } else if (p.type === 'miniBomb') {
            ctx.save();
            ctx.translate(p.x, p.y + bob);
            ctx.shadowBlur = 10;
            ctx.shadowColor = PLAYER_CFG.miniBomb.color;
            ctx.fillStyle = PLAYER_CFG.miniBomb.color;
            ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#000';
            ctx.font = 'bold 12px Courier New';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText("m", 0, 1);
            ctx.restore();
        } else if (p.type === 'xp') {
            sprite = Assets.images.bullet;
            tint = '#00ffff';
            size = 18;
        } else if (p.type === 'blackHole') {
            ctx.save();
            ctx.translate(p.x, p.y + bob);
            ctx.rotate(frames * 0.03);
            ctx.shadowBlur = 15;
            ctx.shadowColor = '#aa88ff';
            ctx.fillStyle = '#050510';
            ctx.strokeStyle = '#5522aa';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, 14, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.strokeStyle = '#aa88ff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, 9, frames * 0.05, Math.PI + frames * 0.05);
            ctx.stroke();
            ctx.restore();
        }

        if (p.type === 'ammo') {
            // Diamond core
            ctx.save();
            ctx.translate(p.x, p.y + bob);
            ctx.rotate(Math.PI/4);
            ctx.fillStyle = '#22dd99';
            ctx.strokeStyle = '#88ffdd';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.rect(-12, -12, 24, 24);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }
        if (p.type === 'coolant') {
            // Hex vial
            ctx.save();
            ctx.translate(p.x, p.y + bob);
            ctx.strokeStyle = '#66ccff';
            ctx.fillStyle = 'rgba(120,200,255,0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for(let k=0;k<6;k++) {
                const a = Math.PI/3 * k + Math.PI/6;
                const px = Math.cos(a) * 12;
                const py = Math.sin(a) * 12;
                if (k===0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        if (sprite) {
            ctx.shadowBlur = 10;
            ctx.shadowColor = p.color || tint || '#ffffff';
            drawSprite(sprite, p.x, p.y + bob, size, 0, tint);
        }

        // 3. Label Text
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 10px Courier New';
        ctx.textAlign = 'center';
        const label = p.type === 'hp' ? 'HP' : 
                      p.type === 'bomb' ? 'BOMB' : 
                      p.type === 'miniBomb' ? 'MINI' : 
                      p.type === 'ammo' ? 'AMMO' : 
                      p.type === 'coolant' ? 'COOL' : 
                      p.type === 'blackHole' ? 'VOID' : 'XP';
        ctx.fillText(label, p.x, p.y + bob - 20);
    });
    ctx.shadowBlur = 0;

    // --- AIM ASSIST (VISUAL LOCK-ON) ---
    enemies.forEach(e => {
        const dist = Math.hypot(e.x - player.x, e.y - player.y);
        if (dist > 600) return; // Range check

        const angleToEnemy = Math.atan2(e.y - player.y, e.x - player.x);
        let angleDiff = angleToEnemy - player.angle;
        // Normalize angleDiff to -PI to PI
        while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

        if (Math.abs(angleDiff) < 0.15) { // Cone check (~8.5 degrees)
             ctx.save();
             ctx.strokeStyle = `rgba(0, 255, 255, ${0.3 + Math.sin(frames*0.2)*0.2})`;
             ctx.lineWidth = 1;
             ctx.setLineDash([10, 10]);
             ctx.beginPath();
             ctx.moveTo(player.x, player.y);
             ctx.lineTo(e.x, e.y);
             ctx.stroke();
             ctx.restore();
        }
    });

    // Special ammo pre-fire line (beautified reticle)
    if (specialAimLock) {
        const aimTarget = enemies.find(en => en.id === specialAimLock.targetId);
        if (aimTarget) {
            const progress = 1 - (specialAimLock.timer / (specialAimLock.duration || 1));
            ctx.save();
            const grad = ctx.createLinearGradient(player.x, player.y, aimTarget.x, aimTarget.y);
            grad.addColorStop(0, `rgba(0,255,255,0.7)`);
            grad.addColorStop(1, `rgba(255,80,255,0.95)`);
            ctx.strokeStyle = grad;
            ctx.lineWidth = 2 + progress * 2;
            ctx.setLineDash([10 - progress * 6, 8]);
            ctx.globalAlpha = 0.65 + progress * 0.25;
            ctx.beginPath();
            ctx.moveTo(player.x, player.y);
            ctx.lineTo(aimTarget.x, aimTarget.y);
            ctx.stroke();
            ctx.setLineDash([]);

            // Traveling spark along the line
            const sparkT = (progress + (Math.sin(frames * 0.25) * 0.05)) % 1;
            const sx = lerp(player.x, aimTarget.x, sparkT);
            const sy = lerp(player.y, aimTarget.y, sparkT);
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ff66ff';
            ctx.fillStyle = '#ff66ff';
            ctx.beginPath();
            ctx.arc(sx, sy, 6, 0, Math.PI*2);
            ctx.fill();
            ctx.shadowBlur = 0;

            // Pulsing target rings
            ctx.strokeStyle = `rgba(255, 80, 255, ${0.9 - progress*0.2})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(aimTarget.x, aimTarget.y, 14 + Math.sin(frames*0.4)*3, 0, Math.PI*2);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(aimTarget.x, aimTarget.y, 22 + progress * 12, 0, Math.PI*2);
            ctx.stroke();
            ctx.restore();
        }
    }

    // 6. Player (sprite with fallback)
    ctx.shadowBlur = 15; ctx.shadowColor = '#00ffff';

    // Black Hole vacuum aura
    if (blackHolePull > 0) {
        ctx.save();
        ctx.translate(player.x, player.y);
        const t = blackHolePull / 180;
        ctx.shadowBlur = 24;
        ctx.shadowColor = '#aa88ff';
        ctx.strokeStyle = `rgba(170, 136, 255, ${0.2 + t * 0.4})`;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, player.radius * 2.5 + Math.sin(frames * 0.25) * 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }

    // Perfect Dash Charge Indicator
    if (player.perfectDashWindow > 0) {
        ctx.save();
        ctx.translate(player.x, player.y);
        const ratio = player.perfectDashWindow / 120;
        
        // Rotating Ring
        ctx.rotate(frames * 0.1);
        ctx.strokeStyle = `rgba(0, 255, 204, ${ratio})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 25 + Math.sin(frames*0.5)*5, 0, Math.PI*1.5); // Broken ring
        ctx.stroke();
        
        // Inner Glow
        ctx.fillStyle = `rgba(0, 255, 204, ${ratio * 0.3})`;
        ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI*2); ctx.fill();

        ctx.restore();
    }

    const playerDrawn = drawSprite(
        Assets.images.player,
        player.x,
        player.y,
        player.radius * 3,
        player.angle + Math.PI / 2,
        (player.invinc > 0 && Math.floor(frames/4)%2===0) ? '#ffffff' : null
    );
    if (!playerDrawn) {
        ctx.save();
        ctx.translate(player.x, player.y);
        ctx.rotate(player.angle);
        ctx.fillStyle = (player.invinc > 0 && Math.floor(frames/4)%2===0) ? '#fff' : '#00ffff';
        ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(-15, 15); ctx.lineTo(-10, 0); ctx.lineTo(-15, -15); ctx.fill();
        ctx.restore();
    }

    if (player.perfectDashWindow > 0) {
        ctx.save();
        const pulse = 1 + Math.sin(frames * 0.15) * 0.08;
        const readyAlpha = 0.55 + Math.sin(frames*0.12)*0.2;
        ctx.strokeStyle = `rgba(0, 180, 255, ${readyAlpha})`;
        ctx.lineWidth = 3;
        ctx.shadowBlur = 22;
        ctx.shadowColor = '#33ccff';
        ctx.beginPath();
        ctx.arc(player.x, player.y, player.radius * 1.9 * pulse, 0, Math.PI*2);
        ctx.stroke();
        ctx.restore();
    }
    ctx.shadowBlur = 0;
    
    if (player.invinc > 20) {
        ctx.save();
        ctx.strokeStyle = `rgba(255, 200, 0, ${0.5+Math.sin(frames*0.2)*0.4})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(player.x, player.y, 30, 0, Math.PI*2); ctx.stroke();
        ctx.restore();
    }

    // Heat & Ammo inline overlay near player
    const barDraw = (val, max, y, col) => {
        const ratio = clamp(val / max, 0, 1);
        const w = 80;
        ctx.save();
        ctx.translate(player.x, y);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-w/2, -6, w, 8);
        ctx.fillStyle = col;
        ctx.fillRect(-w/2, -6, w * ratio, 8);
        ctx.strokeStyle = '#111';
        ctx.strokeRect(-w/2, -6, w, 8);
        ctx.restore();
    };
    barDraw(player.ammo, player.maxAmmo, player.y - 40, '#33ccff');
    barDraw(player.heat, player.heatMax, player.y - 28, '#ff6600');
    
    // 7. Enemies
    enemies.forEach(e => {
        if (!isOnScreen(e.x, e.y)) return;
        // Hit Feedback Interpolation
        if (e.hitScale) {
            e.hitScale = lerp(e.hitScale, 1.0, 0.2);
        }
        const scale = e.hitScale || 1.0;

        ctx.shadowBlur = 10; ctx.shadowColor = e.color; ctx.fillStyle = e.color;
        const facingPlayer = Math.atan2(player.y - e.y, player.x - e.x);
        const rot = (e.type === 'sniper' || e.type === 'dasher') ? facingPlayer + Math.PI / 2 :
                    e.type === 'minelayer' ? frames * 0.05 :
                    frames * 0.01;
        const size = (e.type === 'boss' ? e.radius * 3 : e.radius * 2.2) * scale;
        const spriteDrawn = drawSprite(Assets.images.enemy, e.x, e.y, size, rot, e.color);

        if (!spriteDrawn) {
            ctx.save(); ctx.translate(e.x, e.y);
            ctx.scale(scale, scale); // Apply hit scale for fallback drawing
            if (e.type === 'boss') {
                ctx.rotate(frames*0.02);
                ctx.beginPath();
                for(let i=0; i<6; i++) { const a=(Math.PI/3)*i; ctx.lineTo(Math.cos(a)*e.radius, Math.sin(a)*e.radius); }
                ctx.fill();
            } else if (e.type === 'sniper') {
                ctx.rotate(facingPlayer);
                ctx.fillRect(-10, -10, 20, 20); ctx.fillRect(5, -2, 15, 4); 
            } else if (e.type === 'minelayer') {
                ctx.rotate(frames * 0.05);
                ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(15, 0); ctx.lineTo(0, 15); ctx.lineTo(-15, 0); ctx.fill(); // Diamond
            } else if (e.type === 'mine') {
                const s = 10 + Math.sin(frames*0.2)*2;
                ctx.beginPath(); ctx.arc(0,0,s,0,Math.PI*2); ctx.fill();
                ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke();
            } else if (e.type === 'dasher') {
                ctx.rotate(facingPlayer);
                ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-10, 10); ctx.lineTo(-10, -10); ctx.fill();
            } else {
                ctx.beginPath(); ctx.arc(0, 0, e.radius, 0, Math.PI*2); ctx.fill();
            }
            ctx.restore();
        }

        // Type overlays
        if (e.type === 'dasher' && e.state === 'dash') {
            ctx.save();
            ctx.translate(e.x, e.y);
            const dashPulse = 1 + Math.sin(frames * 0.3) * 0.08;
            const dashR = e.radius * 2.2 * dashPulse;
            const dashGrad = ctx.createRadialGradient(0, 0, e.radius * 0.6, 0, 0, dashR);
            dashGrad.addColorStop(0, withAlpha('#ffffaa', 0.25));
            dashGrad.addColorStop(0.5, withAlpha('#ffdd55', 0.18));
            dashGrad.addColorStop(1, withAlpha('#ffdd55', 0));
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = dashGrad;
            ctx.beginPath(); ctx.arc(0, 0, dashR, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            ctx.restore();
        }
        const bossLaserRelease = e.type === 'boss' && (e.laserWarmup !== undefined || bullets.some(b => b.laserBeam && b.anchorId === e.id));
        if (bossLaserRelease) {
            ctx.save();
            ctx.translate(e.x, e.y);
            const pulse = 1.05 + Math.sin(frames * 0.18) * 0.08;
            const outerR = e.radius * 2.8 * pulse;
            const grad = ctx.createRadialGradient(0, 0, e.radius * 0.8, 0, 0, outerR);
            grad.addColorStop(0, withAlpha('#ffffff', 0.18));
            grad.addColorStop(0.35, withAlpha('#88ffdd', 0.2));
            grad.addColorStop(0.7, withAlpha('#ff66ff', 0.14));
            grad.addColorStop(1, withAlpha('#ff66ff', 0));
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = grad;
            ctx.beginPath(); ctx.arc(0, 0, outerR, 0, Math.PI * 2); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
            ctx.restore();
        }
        if (e.type === 'sniper') {
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.rotate(facingPlayer);
            const beamLen = 1200;
            const beam = ctx.createLinearGradient(0, 0, beamLen, 0);
            beam.addColorStop(0, 'rgba(255, 230, 255, 0.95)');
            beam.addColorStop(0.3, 'rgba(255, 140, 255, 0.9)');
            beam.addColorStop(1, 'rgba(170, 70, 255, 0.7)');
            ctx.strokeStyle = beam;
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.shadowBlur = 20;
            ctx.shadowColor = '#ff66ff';
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(beamLen, 0); ctx.stroke();
            ctx.restore();
        } else if (e.type === 'minelayer') {
            ctx.save();
            ctx.translate(e.x, e.y);
            ctx.rotate(frames * 0.05);
            ctx.strokeStyle = e.color; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(18, 0); ctx.lineTo(0, 18); ctx.lineTo(-18, 0); ctx.closePath(); ctx.stroke();
            ctx.restore();
        } else if (e.type === 'mine') {
            ctx.save();
            ctx.translate(e.x, e.y);
            const s = 12 + Math.sin(frames*0.3)*3;
            ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(0,0,s,0,Math.PI*2); ctx.stroke();
            ctx.restore();
        } else if (e.type === 'boss') {
            ctx.save();
            ctx.fillStyle = '#000'; ctx.fillRect(e.x - 40, e.y - e.radius - 15, 80, 8);
            ctx.fillStyle = '#f00'; ctx.fillRect(e.x - 40, e.y - e.radius - 15, 80*(e.hp/e.maxHp), 8);
            ctx.restore();
        }
    });
    ctx.shadowBlur = 0;

    // 8. Bullets (Dynamic Colors)
    bullets.forEach(b => {
        if (!b.laserBeam && !isOnScreen(b.x, b.y)) return;
        if (b.laserBeam) {
            const startX = b.x;
            const startY = b.y;
            const endX = startX + Math.cos(b.angle) * b.length;
            const endY = startY + Math.sin(b.angle) * b.length;
            ctx.save();
            ctx.lineWidth = b.width;
            ctx.lineCap = 'round';
            const grad = ctx.createLinearGradient(startX, startY, endX, endY);
            grad.addColorStop(0, withAlpha(b.color, 0.15));
            grad.addColorStop(0.5, withAlpha('#ff6600', 0.85));
            grad.addColorStop(1, '#ffffff');
            ctx.strokeStyle = grad;
            ctx.shadowBlur = 35;
            ctx.shadowColor = '#ff6600';
            ctx.globalAlpha = 0.9;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            // Core line for extra brightness
            ctx.lineWidth = Math.max(8, b.width * 0.35);
            ctx.strokeStyle = withAlpha('#ffffff', 0.9);
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(endX, endY);
            ctx.stroke();
            ctx.restore();
            return;
        }
        ctx.shadowBlur = 10; 
        ctx.shadowColor = b.color; 
        ctx.fillStyle = b.color;
        const rot = Math.atan2(b.vy, b.vx);

        if (b.isPerfect) {
            // Special Laser Drawing with Tapered Trail (Cone shape)
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(rot);
            
            // 1. Tapered Outer Glow Trail
            const trailLen = 500;
            const headWidth = b.size * 2.5; // Wider head visual
            const tailWidth = b.size * 0.5; // Narrow tail
            
            const grad = ctx.createLinearGradient(-trailLen, 0, 20, 0);
            grad.addColorStop(0, 'rgba(0, 255, 204, 0)');
            grad.addColorStop(0.2, 'rgba(0, 255, 204, 0.2)');
            grad.addColorStop(0.5, 'rgba(0, 255, 255, 0.5)');
            grad.addColorStop(0.8, 'rgba(255, 255, 255, 0.8)');
            grad.addColorStop(1, '#ffffff');
            
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(20, -headWidth/2); // Head Top
            ctx.lineTo(20, headWidth/2);  // Head Bottom
            ctx.lineTo(-trailLen, tailWidth/2); // Tail Bottom
            ctx.lineTo(-trailLen, -tailWidth/2); // Tail Top
            ctx.closePath();
            ctx.fill();
            
            // 2. Core Beam (Tapered)
            ctx.fillStyle = '#ffffff';
            ctx.shadowBlur = 30;
            ctx.shadowColor = '#00ffcc';
            ctx.beginPath();
            ctx.moveTo(10, -headWidth/4);
            ctx.lineTo(10, headWidth/4);
            ctx.lineTo(-400, tailWidth/4);
            ctx.lineTo(-400, -tailWidth/4);
            ctx.closePath();
            ctx.fill();
            
            // 3. Bright Head Core
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = 1.0;
            ctx.shadowBlur = 40;
            ctx.shadowColor = '#00ffff';
            ctx.beginPath();
            ctx.ellipse(10, 0, b.size * 1.5, b.size, 0, 0, Math.PI*2);
            ctx.fill();

            ctx.restore();
        } else {
            const spriteSize = b.owner === 'player' ? Math.max(16, b.size * 4) : Math.max(14, b.size * 3);
            const drawn = drawSprite(Assets.images.bullet, b.x, b.y, spriteSize, rot, b.color);
            
            if (!drawn) {
                if (b.owner === 'player') {
                    ctx.save();
                    ctx.translate(b.x, b.y);
                    ctx.rotate(rot);
                    ctx.beginPath();
                    ctx.ellipse(0, 0, b.size * 2, b.size / 1.5, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = '#ffffff';
                    ctx.globalAlpha = 0.8;
                    ctx.beginPath();
                    ctx.ellipse(0, 0, b.size, b.size / 3, 0, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                } else {
                    ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI*2); ctx.fill();
                }
            }
        }
    });
    ctx.shadowBlur = 0;

    // 9. Particles
    ctx.globalCompositeOperation = 'lighter';
    particles.forEach(p => {
        if (p.shockwave) {
            const pad = (p.radius || 0) + PERF_CFG.cullPadding;
            if (!isOnScreen(p.x, p.y, pad)) return;
        } else if (!isOnScreen(p.x, p.y)) {
            return;
        }
        if (p.shockwave) {
            ctx.globalAlpha = 1;
            const alpha = Math.max(0, p.life);
            if (p.soft) {
                const spread = p.spread || 16;
                const innerR = Math.max(0, p.radius - spread * 0.6);
                const outerR = p.radius + spread;
                const grad = ctx.createRadialGradient(p.x, p.y, innerR, p.x, p.y, outerR);
                grad.addColorStop(0, withAlpha(p.color, 0.28 * alpha));
                grad.addColorStop(0.6, withAlpha(p.color, 0.14 * alpha));
                grad.addColorStop(1, withAlpha(p.color, 0));
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(p.x, p.y, outerR, 0, Math.PI*2);
                ctx.fill();
            } else {
                ctx.strokeStyle = withAlpha(p.color, 0.8 * alpha);
                ctx.lineWidth = p.lineWidth || 5;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.radius, 0, Math.PI*2);
                ctx.stroke();
            }
        } else {
            ctx.globalAlpha = p.life; ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI*2); ctx.fill();
        }
    });
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 10. Text
    ctx.font = 'bold 16px Courier New'; ctx.textAlign = 'center';
    floats.forEach(t => { ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y); });

    ctx.restore();

    // Screen Damage Flash
    if (flashScreen > 0) {
        ctx.fillStyle = `rgba(255, 0, 0, ${flashScreen/10})`; // Red tint
        ctx.fillRect(0, 0, width, height);
    }
}

async function launchGame(triggerBtn) {
    const originalLabel = triggerBtn ? triggerBtn.innerText : null;
    if (triggerBtn) {
        triggerBtn.disabled = true;
        triggerBtn.innerText = "LOADING...";
    }
    try {
        await Assets.load();
        await AudioSys.init();
        AudioSys.playMusic();
        startGame();
    } catch (e) {
        console.error("Failed to start game", e);
    } finally {
        if (triggerBtn) {
            triggerBtn.disabled = false;
            triggerBtn.innerText = originalLabel;
        }
    }
}

startBtn.addEventListener('click', () => launchGame(startBtn));
restartBtn.addEventListener('click', () => launchGame(restartBtn));
btnRestartComplete.addEventListener('click', () => launchGame(btnRestartComplete));

btnContinue.addEventListener('click', () => {
    missionCompleteScreen.style.display = 'none';
    endlessMode = true;
    difficultyMultiplier = 1.5;
    gameActive = true;
    specialAimLock = null;
    specialAmmoCooldown = 0;
    ammoRegenBuffer = 0;
    // Don't reset score/player
    showWave(wave, "ENDLESS PROTOCOL ENGAGED");
    Comms.show("LIMITERS REMOVED. GOOD LUCK.", "SYSTEM", "#ff0000", null, { priority: true });
    loop(); // Restart loop
});
