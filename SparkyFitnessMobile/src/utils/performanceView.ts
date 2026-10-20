// Formatting for PerformanceScreen. Durations and paces in seconds; distances
// in km from the server, converted for display.

const KM_PER_MILE = 1.609344;

export function formatDurationSeconds(
  seconds: number | null | undefined
): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '–';
  }
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0');
  return h > 0
    ? `${h}:${mm}:${String(s).padStart(2, '0')}`
    : `${mm}:${String(s).padStart(2, '0')}`;
}

export function formatPacePerUnit(
  secondsPerKm: number | null | undefined,
  unit: 'km' | 'miles'
): string {
  if (secondsPerKm === null || secondsPerKm === undefined) return '–';
  const perUnit = unit === 'miles' ? secondsPerKm * KM_PER_MILE : secondsPerKm;
  return `${formatDurationSeconds(perUnit)} /${unit === 'miles' ? 'mi' : 'km'}`;
}

export function distanceFromKm(km: number, unit: 'km' | 'miles'): number {
  return unit === 'miles' ? km / KM_PER_MILE : km;
}

/** Average pace of a set of runs: total time over total distance. */
export function averagePace(totals: {
  distanceKm: number;
  durationMinutes: number;
}): number | null {
  return totals.distanceKm > 0
    ? (totals.durationMinutes * 60) / totals.distanceKm
    : null;
}

export type Tone = 'good' | 'warning' | 'danger' | 'muted';

export function acwrTone(zone: string | null | undefined): Tone {
  if (!zone) return 'muted';
  if (zone === 'optimal') return 'good';
  if (zone === 'very_high') return 'danger';
  return 'warning';
}

export function baselineTone(status: string, higherIsBetter: boolean): Tone {
  if (status === 'insufficient_data') return 'muted';
  if (status === 'within') return 'good';
  const bad = higherIsBetter ? 'below' : 'above';
  return status === bad ? 'danger' : 'good';
}
