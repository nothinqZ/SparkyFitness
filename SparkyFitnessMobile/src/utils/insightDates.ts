import { getAppLocale } from '../localization';

/** "21. Okt." / "Oct 21" for a YYYY-MM-DD day in the app locale. */
export function formatLocalizedDate(
  day: string,
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(getAppLocale(), {
    ...options,
    timeZone: 'UTC',
  });
}
