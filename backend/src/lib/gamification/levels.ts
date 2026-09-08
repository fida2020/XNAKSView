import type { LevelThresholds } from '@/lib/gamification/config';

export interface LevelState {
  level: number;
  currentXP: number; // XP earned within `level`
  nextLevelXP: number; // XP needed to complete `level`; 0 once at the max configured level
}

/**
 * Pure function: given a lifetime XP total and the current threshold curve,
 * derives the level/current-XP/next-level-XP triple. Levels are 1-indexed;
 * `thresholds[i]` is the XP cost of completing level `i + 1`. Deliberately
 * has no side effects and touches no database — `xpEngine.ts` is the only
 * caller that persists the result, so this stays trivially unit-testable.
 */
export function computeLevelState(lifetimeXP: number, thresholds: LevelThresholds): LevelState {
  const curve = thresholds.thresholds;
  let level = 1;
  let remaining = Math.max(0, lifetimeXP);

  for (const cost of curve) {
    if (remaining < cost) {
      return { level, currentXP: remaining, nextLevelXP: cost };
    }
    remaining -= cost;
    level += 1;
  }

  // Reached (or exceeded) the max configured level — no further level-ups,
  // any leftover XP is simply banked as currentXP with no next threshold.
  return { level, currentXP: remaining, nextLevelXP: 0 };
}
