/** 1:23:45 for an hour or more, 23:45 below. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '–';
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const KM_PER_MILE = 1.609344;

/** Pace from s/km as "4:52 /km" or, for miles, "7:50 /mi". */
export function formatPace(
  secondsPerKm: number | null | undefined,
  unit: 'km' | 'miles' = 'km'
): string {
  if (secondsPerKm === null || secondsPerKm === undefined) return '–';
  const perUnit = unit === 'miles' ? secondsPerKm * KM_PER_MILE : secondsPerKm;
  return `${formatDuration(perUnit)} /${unit === 'miles' ? 'mi' : 'km'}`;
}

export function convertDistance(km: number, unit: 'km' | 'miles'): number {
  return unit === 'miles' ? km / KM_PER_MILE : km;
}

/** Minutes after midnight as HH:MM. */
export function formatClockMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '–';
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
