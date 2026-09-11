import type { Difficulty } from './types';

/** Difficulty is chosen before a run and never changes while an attack is committed. */
export const DIFFICULTIES = {
  normal: { label: '普通', enemyHp: 1, bossHp: 1, enemySpeed: 1, bulletSpeed: 1, damage: 1,
    spawnInterval: 1, attackSlots: 3, commitGap: 0.28, score: 1, eliteChance: 1 },
  hard: { label: '困难', enemyHp: 1.5, bossHp: 1.35, enemySpeed: 1.3, bulletSpeed: 1.28, damage: 2,
    spawnInterval: 0.78, attackSlots: 4, commitGap: 0.18, score: 1.5, eliteChance: 1.5 },
} as const;

export const difficultyConfig = (difficulty: Difficulty = 'normal') => DIFFICULTIES[difficulty];
