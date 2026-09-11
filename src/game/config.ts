import type { EnemyType, GameSettings } from './types';
export const STEP = 1 / 60;
export const VIEW = { width: 1600, height: 900 } as const;
export const WORLD = { width: 4000, height: 4000 } as const;
export const MINIBOSS_ENCOUNTER = { wave: 3, time: 8, warning: 1.6, xp: 180, hardXp: 240 } as const;
export const BALANCE = {
  player: { speed: 300, focusSpeed: 180, focusSpread: 0.5, radius: 18, hp: 5, bombs: 3, hitInvincible: 40 / 60 },
  dash: { speed: 1080, duration: 0.18, cooldown: 2.6, inputBuffer: 0.14, window: 0.85, damage: 40, targets: 180, beamLength: 2400, beamWidth: 88, beamDuration: 0.32 },
  companion: { max: 3, supplyWaves: [2, 3, 4], orbitRadius: 92, orbitSpeed: 1.25, damage: 3, interval: 0.6, range: 560, bulletSpeed: 1050, surplusXp: 30 },
  ai: { maxCommitments: 3, commitGap: 0.28, mineSpacing: 110, mineSafeDistance: 150, hazards: 12 },
  weapon: { damage: 2, intervals: [10, 9, 9, 8, 8, 7, 7, 6, 6, 6], counts: [1, 1, 2, 2, 3, 3, 3, 4, 5, 5], speeds: [900, 1080, 960, 1080, 960, 1080, 900, 960, 960, 1200], spreads: [0, 0, 0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4], homingRange: 300 },
  ammo: { max: 120, delay: 0.25, regen: 20 },
  heat: { max: 100, rate: 25, delay: 0.15, cooling: 50, lock: 1.2, unlock: 35 },
  special: { level: 4, cooldown: 3, windup: 0.3, damage: 10, speed: 600, range: 220 },
  xp: { pickup: 10, thresholds: [140, 220, 320, 440, 580, 740, 920, 1120, 1340], loss: 0.25, cap: 10 },
  spawn: { intervals: [0.95, 0.85, 0.78, 0.72, 0.65], warning: 0.8, waveDuration: 40, storyWaves: 5, endlessBossInterval: 10, clearXp: [40, 60, 80, 100, 120] },
  boss: { hp: 1800, radius: 160, speed: 50, laserWarning: 2.2, laserLock: 2.2, laserWidth: 96, laserLength: 6000, laserDuration: 3.2, angularSpeed: 0.38, laserCooldown: 14, firstLaser: 8, addInterval: 7, maxAdds: 6, patternGap: 1.15 },
  drops: { ammo: 0.0375, minelayerAmmo: 0.075, coolant: 0.2, bomb: 0.05, miniBomb: 0.08, hp: 0.1, blackHole: 0.002 },
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
  boss: { hp: 1800, speed: 30, radius: 160, color: 0xc7adff, label: 'MAFUYU' },
  miniboss: { hp: 600, speed: 155, radius: 64, color: 0xff956b, label: 'ECHO / 游猎回声' },
};
export const DEFAULT_SETTINGS: GameSettings = { quality: 'medium', masterVolume: 0.7, musicVolume: 0.45, sfxVolume: 0.65, screenShake: 0.45, reducedMotion: false };
export const QUALITY = { low: { particles: 300, scale: 0.75, stars: 35 }, medium: { particles: 900, scale: 1, stars: 65 }, high: { particles: 1600, scale: 1.25, stars: 100 } } as const;
export const ASSET_URLS = Object.fromEntries(['player', 'enemy', 'bullet', 'health', 'bg'].map(key => [key, `${import.meta.env.BASE_URL}assets/images/${key}.png`])) as Record<'player' | 'enemy' | 'bullet' | 'health' | 'bg', string>;
export function xpNeeded(level: number) { return BALANCE.xp.thresholds[Math.min(8, Math.max(0, level - 1))]; }
