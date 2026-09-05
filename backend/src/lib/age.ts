export const MINIMUM_REGISTRATION_AGE = 18;

/**
 * Calendar-accurate age in whole years as of `at`, computed in UTC so the
 * result doesn't shift with the server's local timezone.
 */
export function calculateAge(dateOfBirth: Date, at: Date = new Date()): number {
  let age = at.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDiff = at.getUTCMonth() - dateOfBirth.getUTCMonth();
  const dayDiff = at.getUTCDate() - dateOfBirth.getUTCDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    age -= 1;
  }

  return age;
}

export function meetsMinimumAge(dateOfBirth: Date, at: Date = new Date()): boolean {
  return calculateAge(dateOfBirth, at) >= MINIMUM_REGISTRATION_AGE;
}
