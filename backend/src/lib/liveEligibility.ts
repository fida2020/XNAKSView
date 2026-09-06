import { env } from '@/config/env';

export interface LiveEligibilityInput {
  ageVerified: boolean;
  accountCreatedAt: Date;
}

export interface LiveEligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Server-side, configurable LIVE eligibility gate — enforced on `POST /live`,
 * not just documented. Account standing (ACTIVE) is already enforced by
 * `requireAuth` before this ever runs, so it isn't re-checked here.
 *
 * Deliberately NOT implemented yet: follower/activity thresholds and a
 * prior-violation count — there is no data backing either today (no
 * follower-activity metric, no violation-tracking table), and faking a
 * threshold against a number that doesn't exist would be worse than not
 * checking it. Both are real extension points once that data exists (see
 * docs/STEP4_PROGRESS.md).
 */
export function checkLiveEligibility({ ageVerified, accountCreatedAt }: LiveEligibilityInput): LiveEligibilityResult {
  if (!ageVerified) {
    return { eligible: false, reason: 'Age verification is required to go LIVE' };
  }

  const minAccountAgeHours = env.LIVE_MIN_ACCOUNT_AGE_HOURS;
  if (minAccountAgeHours > 0) {
    const accountAgeHours = (Date.now() - accountCreatedAt.getTime()) / (60 * 60 * 1000);
    if (accountAgeHours < minAccountAgeHours) {
      return {
        eligible: false,
        reason: `Your account must be at least ${minAccountAgeHours} hour(s) old to go LIVE`,
      };
    }
  }

  return { eligible: true };
}
