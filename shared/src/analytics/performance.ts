// Performance analytics shared by the server (/api/v2/performance) and the
// clients. Pure functions over plain rows, no I/O.
//
// Every figure the dashboard shows is labelled with where it came from:
//   "measured"   - recorded by a device or the user (resting HR, HRV, a run)
//   "device"     - computed by the wearable vendor (Garmin VO2max, race
//                  predictions, acute/chronic load)
//   "estimated"  - computed here by the formulas below
// Formulas and their limits are documented in docs/src/features/performance-analytics.md.

export type Provenance = "measured" | "device" | "estimated";

export interface DatedValue {
  date: string; // YYYY-MM-DD
  value: number;
}

const DAY_MS = 86_400_000;

function dayIndex(date: string): number {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

function isoDay(index: number): string {
  return new Date(index * DAY_MS).toISOString().slice(0, 10);
}

function mean(values: number[]): number | null {
  return values.length
    ? values.reduce((a, b) => a + b, 0) / values.length
    : null;
}

function stdDev(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) return null;
  const variance =
    values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

const round = (v: number, digits = 1) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

// --- Running -------------------------------------------------------------------

export interface RunRow {
  date: string;
  distanceKm: number;
  durationMinutes: number;
  avgHeartRate?: number | null;
}

/** Seconds per km, or null for a run without distance or time. */
export function paceSecondsPerKm(
  run: Pick<RunRow, "distanceKm" | "durationMinutes">,
): number | null {
  if (!(run.distanceKm > 0) || !(run.durationMinutes > 0)) return null;
  return (run.durationMinutes * 60) / run.distanceKm;
}

/** Monday (UTC calendar) of the ISO week containing `date`. */
export function isoWeekStart(date: string): string {
  const idx = dayIndex(date);
  const weekday = (new Date(idx * DAY_MS).getUTCDay() + 6) % 7; // Mon=0
  return isoDay(idx - weekday);
}

export interface WeeklyRunSummary {
  weekStart: string;
  distanceKm: number;
  runs: number;
  durationMinutes: number;
  /** Distance-weighted average pace, seconds per km. */
  avgPaceSecondsPerKm: number | null;
}

/**
 * Weekly mileage and pace. Weeks without runs between the first and last run
 * are included with zeros, so a chart shows breaks as breaks.
 */
export function weeklyRunSummaries(
  runs: readonly RunRow[],
): WeeklyRunSummary[] {
  const valid = runs.filter((r) => r.distanceKm > 0 && r.durationMinutes > 0);
  if (!valid.length) return [];
  const byWeek = new Map<string, { d: number; t: number; n: number }>();
  for (const r of valid) {
    const w = isoWeekStart(r.date);
    const acc = byWeek.get(w) ?? { d: 0, t: 0, n: 0 };
    acc.d += r.distanceKm;
    acc.t += r.durationMinutes;
    acc.n += 1;
    byWeek.set(w, acc);
  }
  const weeks = [...byWeek.keys()].sort();
  const out: WeeklyRunSummary[] = [];
  for (
    let i = dayIndex(weeks[0]!);
    i <= dayIndex(weeks[weeks.length - 1]!);
    i += 7
  ) {
    const w = isoDay(i);
    const acc = byWeek.get(w);
    out.push({
      weekStart: w,
      distanceKm: acc ? round(acc.d, 2) : 0,
      runs: acc?.n ?? 0,
      durationMinutes: acc ? round(acc.t, 1) : 0,
      avgPaceSecondsPerKm:
        acc && acc.d > 0 ? round((acc.t * 60) / acc.d, 0) : null,
    });
  }
  return out;
}

/**
 * Riegel's endurance model: T2 = T1 × (D2 / D1)^1.06.
 * Valid roughly for efforts between 3 km and the marathon; it over-predicts
 * for runners whose endurance lags their speed, and is meaningless for easy
 * runs, so the caller should feed it best efforts only.
 */
export function riegelPredictSeconds(
  distanceKm: number,
  timeSeconds: number,
  targetKm: number,
  exponent = 1.06,
): number {
  return timeSeconds * (targetKm / distanceKm) ** exponent;
}

export const RACE_DISTANCES_KM = {
  "5k": 5,
  "10k": 10,
  half_marathon: 21.0975,
  marathon: 42.195,
} as const;
export type RaceDistance = keyof typeof RACE_DISTANCES_KM;

/** Shortest runs used for predictions: shorter efforts extrapolate badly. */
export const MIN_PREDICTION_RUN_KM = 3;

/**
 * Race-time estimates from the fastest predicting run per target distance.
 * Only runs of at least MIN_PREDICTION_RUN_KM count; returns null per target
 * when there is no such run.
 */
export function predictRaceTimes(
  runs: readonly RunRow[],
): Record<
  RaceDistance,
  { seconds: number; basedOn: { date: string; distanceKm: number } } | null
> {
  const eligible = runs.filter(
    (r) => r.distanceKm >= MIN_PREDICTION_RUN_KM && r.durationMinutes > 0,
  );
  const result = {} as Record<
    RaceDistance,
    { seconds: number; basedOn: { date: string; distanceKm: number } } | null
  >;
  for (const [key, km] of Object.entries(RACE_DISTANCES_KM) as [
    RaceDistance,
    number,
  ][]) {
    let best: {
      seconds: number;
      basedOn: { date: string; distanceKm: number };
    } | null = null;
    for (const r of eligible) {
      const seconds = riegelPredictSeconds(
        r.distanceKm,
        r.durationMinutes * 60,
        km,
      );
      if (!best || seconds < best.seconds) {
        best = {
          seconds: Math.round(seconds),
          basedOn: { date: r.date, distanceKm: r.distanceKm },
        };
      }
    }
    result[key] = best;
  }
  return result;
}

// --- Training load -----------------------------------------------------------------

export interface LoadPoint {
  date: string;
  acute: number;
  chronic: number;
  /** acute / chronic; null while the chronic window holds no load. */
  ratio: number | null;
}

/**
 * Acute:chronic workload ratio with rolling means: acute = mean daily load of
 * the last 7 days, chronic = mean of the last 28 days (days without training
 * count as 0). Input loads are summed per day. Output covers every day from
 * `from` to `to`. Until 28 days have passed since the first recorded load the
 * chronic window is mostly empty and the ratio would be inflated, so `ratio`
 * is null there (acute and chronic are still reported).
 */
export function acuteChronicLoad(
  loads: readonly DatedValue[],
  from: string,
  to: string,
): LoadPoint[] {
  const perDay = new Map<number, number>();
  for (const l of loads) {
    if (!(l.value > 0)) continue;
    const i = dayIndex(l.date);
    perDay.set(i, (perDay.get(i) ?? 0) + l.value);
  }
  const firstLoadDay = perDay.size ? Math.min(...perDay.keys()) : Infinity;
  const out: LoadPoint[] = [];
  const start = dayIndex(from);
  const end = dayIndex(to);
  for (let i = start; i <= end; i++) {
    let acute = 0;
    let chronic = 0;
    for (let k = 0; k < 28; k++) {
      const v = perDay.get(i - k) ?? 0;
      chronic += v;
      if (k < 7) acute += v;
    }
    const a = acute / 7;
    const c = chronic / 28;
    out.push({
      date: isoDay(i),
      acute: round(a, 1),
      chronic: round(c, 1),
      ratio: c > 0 && i - firstLoadDay >= 27 ? round(a / c, 2) : null,
    });
  }
  return out;
}

export type LoadZone = "low" | "optimal" | "high" | "very_high";

/** Commonly cited ACWR bands (Gabbett 2016): <0.8, 0.8–1.3, 1.3–1.5, >1.5. */
export function classifyAcwr(ratio: number | null): LoadZone | null {
  if (ratio === null) return null;
  if (ratio < 0.8) return "low";
  if (ratio <= 1.3) return "optimal";
  if (ratio <= 1.5) return "high";
  return "very_high";
}

// --- Recovery ------------------------------------------------------------------

export interface BaselineStatus {
  /** Mean of the last 7 days with data. */
  recent: number | null;
  /** Mean and standard deviation of the 60 days before the recent window. */
  baseline: number | null;
  baselineStdDev: number | null;
  /** (recent - baseline) / sd; null without enough history (14 values). */
  zScore: number | null;
  status: "below" | "within" | "above" | "insufficient_data";
}

/**
 * Personal baseline in the style of HRV4Training/Garmin: compares the last
 * 7 days with the preceding 60. "within" means less than one standard
 * deviation away. Needs at least 14 baseline values and 3 recent ones.
 */
export function baselineStatus(
  series: readonly DatedValue[],
  asOf: string,
): BaselineStatus {
  const end = dayIndex(asOf);
  const recent: number[] = [];
  const history: number[] = [];
  for (const p of series) {
    const i = dayIndex(p.date);
    if (!Number.isFinite(p.value)) continue;
    if (i <= end && i > end - 7) recent.push(p.value);
    else if (i <= end - 7 && i > end - 67) history.push(p.value);
  }
  const r = mean(recent);
  const b = mean(history);
  const sd = stdDev(history);
  if (
    r === null ||
    b === null ||
    sd === null ||
    history.length < 14 ||
    recent.length < 3
  ) {
    return {
      recent: r === null ? null : round(r),
      baseline: b === null ? null : round(b),
      baselineStdDev: sd === null ? null : round(sd),
      zScore: null,
      status: "insufficient_data",
    };
  }
  const z = sd > 0 ? (r - b) / sd : 0;
  return {
    recent: round(r),
    baseline: round(b),
    baselineStdDev: round(sd),
    zScore: round(z, 2),
    status: z < -1 ? "below" : z > 1 ? "above" : "within",
  };
}

export interface SleepRow {
  date: string;
  /** ISO timestamp of going to bed. */
  bedtime: string;
  durationSeconds: number;
  timeAsleepSeconds?: number | null;
}

/**
 * Sleep regularity: circular standard deviation of bedtime (minutes), so
 * 23:30 and 00:30 are one hour apart rather than 23. Lower is more regular;
 * under ~30 minutes is commonly considered consistent.
 */
export function sleepConsistency(rows: readonly SleepRow[], timeZone = "UTC") {
  const minutes: number[] = [];
  const durations: number[] = [];
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (const r of rows) {
    const t = Date.parse(r.bedtime);
    if (Number.isNaN(t)) continue;
    const [h, m] = fmt.format(new Date(t)).split(":").map(Number);
    minutes.push(h! * 60 + m!);
    const slept = r.timeAsleepSeconds ?? r.durationSeconds;
    if (slept > 0) durations.push(slept / 3600);
  }
  if (minutes.length < 3) {
    return {
      nights: minutes.length,
      bedtimeStdDevMinutes: null,
      meanBedtimeMinutes: null,
      avgSleepHours: mean(durations),
    };
  }
  const angles = minutes.map((m) => (m / 1440) * 2 * Math.PI);
  const s = angles.reduce((a, x) => a + Math.sin(x), 0) / angles.length;
  const c = angles.reduce((a, x) => a + Math.cos(x), 0) / angles.length;
  const rLen = Math.min(1, Math.sqrt(s * s + c * c));
  const circularSd = Math.sqrt(-2 * Math.log(rLen)) * (1440 / (2 * Math.PI));
  let meanAngle = Math.atan2(s, c);
  if (meanAngle < 0) meanAngle += 2 * Math.PI;
  const avg = mean(durations);
  return {
    nights: minutes.length,
    bedtimeStdDevMinutes: round(circularSd, 0),
    meanBedtimeMinutes: Math.round((meanAngle / (2 * Math.PI)) * 1440) % 1440,
    avgSleepHours: avg === null ? null : round(avg, 2),
  };
}

/**
 * A 0-100 readiness estimate from whatever signals exist, each mapped to
 * 0-100 and averaged with equal weight:
 *   HRV         50 + 20 × z (higher HRV than baseline = better)
 *   resting HR  50 − 20 × z (higher RHR than baseline = worse)
 *   sleep       last night's sleep / 8 h × 100, capped at 100
 *   load        100 for ACWR 0.8-1.3, falling linearly to 0 at 2.0
 * It is a heuristic for orientation, not a validated score; the dashboard
 * labels it "estimated" and shows Garmin's training readiness next to it
 * when available.
 */
export function recoveryEstimate(input: {
  hrv?: BaselineStatus | null;
  restingHr?: BaselineStatus | null;
  lastNightSleepHours?: number | null;
  acwr?: number | null;
}): { score: number; components: Record<string, number> } | null {
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  const components: Record<string, number> = {};
  if (input.hrv?.zScore != null)
    components["hrv"] = clamp(50 + 20 * input.hrv.zScore);
  if (input.restingHr?.zScore != null)
    components["restingHr"] = clamp(50 - 20 * input.restingHr.zScore);
  if (input.lastNightSleepHours != null && input.lastNightSleepHours > 0) {
    components["sleep"] = clamp((input.lastNightSleepHours / 8) * 100);
  }
  if (input.acwr != null) {
    const r = input.acwr;
    components["load"] =
      r >= 0.8 && r <= 1.3
        ? 100
        : r < 0.8
          ? clamp(100 - (0.8 - r) * 100)
          : clamp(100 - ((r - 1.3) / 0.7) * 100);
  }
  const values = Object.values(components);
  if (values.length < 2) return null;
  const rounded = Object.fromEntries(
    Object.entries(components).map(([k, v]) => [k, Math.round(v)]),
  );
  return { score: Math.round(mean(values)!), components: rounded };
}

// --- Trends ----------------------------------------------------------------------

/**
 * Least-squares slope per 7 days (e.g. kg/week for body weight), or null with
 * fewer than 3 points or a span under 7 days.
 */
export function weeklyTrend(series: readonly DatedValue[]): number | null {
  const pts = series.filter((p) => Number.isFinite(p.value));
  if (pts.length < 3) return null;
  const xs = pts.map((p) => dayIndex(p.date));
  if (Math.max(...xs) - Math.min(...xs) < 7) return null;
  const mx = mean(xs)!;
  const my = mean(pts.map((p) => p.value))!;
  let num = 0;
  let den = 0;
  pts.forEach((p, i) => {
    num += (xs[i]! - mx) * (p.value - my);
    den += (xs[i]! - mx) ** 2;
  });
  return den === 0 ? null : round((num / den) * 7, 2);
}

/** Trailing moving average over `window` calendar days (inclusive). */
export function movingAverage(
  series: readonly DatedValue[],
  window = 7,
): DatedValue[] {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((p) => {
    const end = dayIndex(p.date);
    const vals = sorted.filter((q) => {
      const i = dayIndex(q.date);
      return i <= end && i > end - window;
    });
    return { date: p.date, value: round(mean(vals.map((q) => q.value))!, 2) };
  });
}
