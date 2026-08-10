/**
 * Allowed IntelliVerseX appIds for Postiz Organization.appId.
 * Keep in sync with Intelliverse-X-Webfrontend src/lib/app-registry.ts APP_IDS.
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
