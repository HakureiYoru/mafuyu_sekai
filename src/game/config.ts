import type { EnemyType } from './types';
import { DEFAULT_GAME_SETTINGS } from './settings';
export const STEP = 1 / 60;
export const VIEW = { width: 1600, height: 900 } as const;
export const WORLD = { width: 4000, height: 4000 } as const;
export const MINIBOSS_ENCOUNTER = { wave: 3, time: 8, warning: 1.6, xp: 260, hardXp: 360, holdAdds: 24, hardHoldAdds: 32, holdSpawnInterval: 2.8, hardHoldSpawnInterval: 2 } as const;
export const BALANCE = {
  player: { speed: 300, focusSpeed: 180, focusSpread: 0.5, radius: 18, hitRadius: 7, hp: 5, bombs: 3, maxBombs: 5, bombOverflowXp: 30, hitInvincible: 40 / 60 },
  dash: { speed: 1080, duration: 0.18, cooldown: 2.6, inputBuffer: 0.14, window: 4, damage: 40, targets: 180, beamLength: 2400, beamWidth: 88, beamDuration: 0.32 },
  command: { duration: 4, cooldown: 8, tolerance: 48, rangeGrace: 0.3 },
  companion: { max: 3, supplyWaves: [2, 3, 4], orbitRadius: 92, orbitSpeed: 1.25, damage: 3, interval: 0.6, range: 560, bulletSpeed: 1050, surplusXp: 30 },
  ai: { maxCommitments: 3, commitGap: 0.28, mineSpacing: 110, mineSafeDistance: 150, hazards: 12 },
  weapon: { damage: 2, intervals: [10, 9, 9, 8, 8, 7, 7, 6, 6, 6], counts: [1, 1, 2, 2, 3, 3, 3, 4, 5, 5], speeds: [900, 1080, 960, 1080, 960, 1080, 900, 960, 960, 1200], spreads: [0, 0, 0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4], homingRange: 300 },
  heat: { max: 100, rate: 25, delay: 0.15, cooling: 50, lock: 1.2, unlock: 35 },
  special: { level: 4, cooldown: 3, windup: 0.3, damage: 10, speed: 600, range: 220 },
  xp: { pickup: 10, thresholds: [140, 220, 320, 440, 580, 740, 920, 1120, 1340], loss: 0.25, cap: 10 },
  spawn: { intervals: [0.95, 0.85, 0.78, 0.72, 0.65], warning: 0.8, waveDuration: 40, storyWaves: 5, endlessBossInterval: 10, clearXp: [40, 60, 80, 100, 120] },
  drops: { supply: 0.0375, minelayerSupply: 0.075, coolant: 0.2, bomb: 0.05, miniBomb: 0.08, hp: 0.1, blackHole: 0.002 },
  bomb: { size: 750, damage: 80, invincible: 2 },
  limits: { enemies: 180, mines: 70, bullets: 4096, playerReserve: 512, pickupCells: 80 },
} as const;
export const ENEMIES: Record<EnemyType, { hp: number; speed: number; radius: number; color: number; label: string }> = {
  basic: { hp: 6, speed: 115, radius: 30, color: 0xff6584, label: '空洞' },
  dasher: { hp: 18, speed: 155, radius: 36, color: 0xffcb69, label: '突进' },
  sniper: { hp: 28, speed: 60, radius: 36, color: 0xc99dff, label: '狙击' },
  sprayer: { hp: 60, speed: 45, radius: 70, color: 0x69caff, label: '扫射' },
  minelayer: { hp: 36, speed: 100, radius: 55, color: 0x95e4ab, label: '布雷' },
  mine: { hp: 1, speed: 0, radius: 35, color: 0xff684f, label: '地雷' },
  boss: { hp: 700, speed: 30, radius: 160, color: 0xc7adff, label: 'MAFUYU' },
  miniboss: { hp: 1200, speed: 240, radius: 64, color: 0xff956b, label: 'ECHO / 游猎回声' },
  shield: { hp: 90, speed: 125, radius: 38, color: 0xffd18c, label: '镜盾卫' },
  weaver: { hp: 60, speed: 90, radius: 38, color: 0xd2a3ff, label: '幕门织者' },
  returner: { hp: 50, speed: 140, radius: 32, color: 0xff9aad, label: '折返投手' },
  sampler: { hp: 55, speed: 115, radius: 34, color: 0xffba77, label: '轨迹采样者' },
  repairer: { hp: 65, speed: 110, radius: 34, color: 0xaed18c, label: '中继修复者' },
  carrier: { hp: 42, speed: 155, radius: 32, color: 0xff889c, label: '裂核载体' },
  palisade: { hp: 2000, speed: 200, radius: 88, color: 0xf1bd78, label: 'PALISADE / 门阵枢纽' },
  reprise: { hp: 2400, speed: 220, radius: 78, color: 0xd7a2ff, label: 'REPRISE / 复奏体' },
  arm: { hp: 100, speed: 0, radius: 24, color: 0xffc27c, label: '门阵发射臂' },
  node: { hp: 130, speed: 0, radius: 25, color: 0xc4a5ff, label: '折光节点' },
  core: { hp: 4, speed: 0, radius: 12, color: 0xff9d87, label: '碎核' },
};
export const DEFAULT_SETTINGS = DEFAULT_GAME_SETTINGS;
export const QUALITY = { low: { particles: 300, scale: 0.75, stars: 35 }, medium: { particles: 900, scale: 1, stars: 65 }, high: { particles: 1600, scale: 1.25, stars: 100 } } as const;
export const ASSET_URLS = Object.fromEntries(['player', 'enemy', 'bullet', 'health', 'bg'].map(key => [key, `${import.meta.env.BASE_URL}assets/images/${key}.png`])) as Record<'player' | 'enemy' | 'bullet' | 'health' | 'bg', string>;
export function xpNeeded(level: number) { return BALANCE.xp.thresholds[Math.min(8, Math.max(0, level - 1))]; }
