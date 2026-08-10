/**
 * IntelliVerseX Organization.appId helpers.
 *
 * Two shapes:
 * - Brand (Admin/agency): foundrly, quizverse, … — used by /internal/brands/provision
 * - User (self-serve): user_<postizUserId> — set on register / login backfill
 *
 * Brand list keep in sync with Intelliverse-X-Webfrontend APP_REGISTRY.
 */
export const POSTIZ_APP_IDS = [
  'quizverse',
  'questx',
  'intelliverse',
  'toba',
  'contentx',
  'foundrly',
  'kioskx',
] as const;

export type PostizAppId = (typeof POSTIZ_APP_IDS)[number];

export function normalizeAppId(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

export function isValidPostizAppId(raw: string): raw is PostizAppId {
  return (POSTIZ_APP_IDS as readonly string[]).includes(normalizeAppId(raw));
}

/** Self-serve org scope: one Organization per Postiz user. */
export function userAppId(userId: string): string {
  const id = String(userId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '');
  return `user_${id}`;
}

export function isUserScopedAppId(raw: string | null | undefined): boolean {
  return Boolean(raw && String(raw).startsWith('user_'));
}

export function isBrandAppId(raw: string | null | undefined): boolean {
  return Boolean(raw && isValidPostizAppId(String(raw)));
}
