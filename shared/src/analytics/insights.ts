// Deterministic fitness insights over the performance overview
// (Performance.api.zod.ts): findings for the "Today" card, series for the
// compare view and period reports. No model decides anything here; an LLM
// may only word the findings afterwards (services/insightsService.ts).
//
// Every finding says what kind of statement it is:
//   observation  something measurable stands out, nothing more is claimed
//   hypothesis   a possible explanation, explicitly not established
//   finding      solid: measured directly (e.g. a best lift)
// Rules stay silent when the data is too thin rather than guess.

import type { PerformanceOverviewResponse } from '../schemas/api/Performance.api.zod.ts';
import type { DatedValue } from './performance.ts';

export type FindingKind = 'observation' | 'hypothesis' | 'finding';
export type FindingArea =
  | 'recovery'
  | 'load'
  | 'strength'
  | 'sleep'
  | 'body'
  | 'nutrition'
  | 'consistency';
export type FindingSeverity = 'info' | 'notice' | 'warning';
export type FindingTone = 'positive' | 'neutral' | 'caution';
export type Confidence = 'low' | 'medium' | 'high';
export type EvidenceSource = 'measured' | 'device' | 'estimated' | 'logged';

export interface FindingEvidence {
  /** Metric key, also used for the label on the clients. */
  metric: string;
  value: number | string;
  unit?: string;
  /** Human period, e.g. "7d", "60d", "2026-10-01..2026-10-21". */
  period: string;
  source: EvidenceSource;
}

export interface FitnessFinding {
  /** Stable rule id; clients look up their text as `insights.rules.<id>`. */
  id: string;
  area: FindingArea;
  kind: FindingKind;
  severity: FindingSeverity;
  tone: FindingTone;
  /** Values the localized texts interpolate. */
  params: Record<string, number | string>;
  evidence: FindingEvidence[];
  confidence: Confidence;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  warning: 3,
  notice: 2,
  info: 1,
};
const CONFIDENCE_RANK: Record<Confidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};
// Within a severity, what matters most for today's training decision;
// confidence breaks ties within an area.
const AREA_RANK: Record<FindingArea, number> = {
  recovery: 7,
  load: 6,
  strength: 5,
  sleep: 4,
  consistency: 3,
  nutrition: 2,
  body: 1,
};

const DAY_MS = 86_400_000;
const dayIndex = (date: string): number =>
  Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
const round = (v: number, digits = 1): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const mean = (values: readonly number[]): number | null =>
  values.length === 0
    ? null
    : values.reduce((a, b) => a + b, 0) / values.length;

/** Last-N-days slice of a dated series ending at `asOf`. */
function lastDays<T extends { date: string }>(
  series: readonly T[],
  asOf: string,
  days: number
): T[] {
  const end = dayIndex(asOf);
  return series.filter((p) => {
    const i = dayIndex(p.date);
    return i <= end && i > end - days;
  });
}

// --- Findings -----------------------------------------------------------

function recoveryFindings(o: PerformanceOverviewResponse): FitnessFinding[] {
  const hrv = o.recovery.hrv.status;
  const rhr = o.recovery.restingHr.status;
  const hrvLow = hrv.status === 'below' && hrv.zScore !== null;
  const rhrHigh = rhr.status === 'above' && rhr.zScore !== null;
  const evidence: FindingEvidence[] = [];
  if (hrvLow) {
    evidence.push(
      {
        metric: 'hrv',
        value: hrv.recent!,
        unit: 'ms',
        period: '7d',
        source: 'measured',
      },
      {
        metric: 'hrvBaseline',
        value: hrv.baseline!,
        unit: 'ms',
        period: '60d',
        source: 'measured',
      }
    );
  }
  if (rhrHigh) {
    evidence.push(
      {
        metric: 'restingHr',
        value: rhr.recent!,
        unit: 'bpm',
        period: '7d',
        source: 'measured',
      },
      {
        metric: 'restingHrBaseline',
        value: rhr.baseline!,
        unit: 'bpm',
        period: '60d',
        source: 'measured',
      }
    );
  }
  if (hrvLow && rhrHigh) {
    // Two independent signals agreeing: worth naming as a possible cause,
    // still not a diagnosis.
    return [
      {
        id: 'recovery.strained',
        area: 'recovery',
        kind: 'hypothesis',
        severity: 'warning',
        tone: 'caution',
        params: {
          hrv: hrv.recent!,
          hrvBaseline: hrv.baseline!,
          restingHr: rhr.recent!,
          restingHrBaseline: rhr.baseline!,
        },
        evidence,
        confidence: 'medium',
      },
    ];
  }
  if (hrvLow) {
    return [
      {
        id: 'recovery.hrv_low',
        area: 'recovery',
        kind: 'observation',
        severity: hrv.zScore! <= -1.5 ? 'warning' : 'notice',
        tone: 'caution',
        params: {
          hrv: hrv.recent!,
          hrvBaseline: hrv.baseline!,
          z: hrv.zScore!,
        },
        evidence,
        confidence: 'medium',
      },
    ];
  }
  if (rhrHigh) {
    return [
      {
        id: 'recovery.resting_hr_high',
        area: 'recovery',
        kind: 'observation',
        severity: 'notice',
        tone: 'caution',
        params: { restingHr: rhr.recent!, restingHrBaseline: rhr.baseline! },
        evidence,
        confidence: 'medium',
      },
    ];
  }
  return [];
}

function loadFindings(o: PerformanceOverviewResponse): FitnessFinding[] {
  const current = o.load.current;
  if (!current) return [];
  const source: EvidenceSource =
    current.provenance === 'device' ? 'device' : 'estimated';
  const evidence: FindingEvidence[] = [
    {
      metric: 'loadRatio',
      value: round(current.ratio, 2),
      period: '7d/28d',
      source,
    },
  ];
  if (current.zone === 'very_high' || current.zone === 'high') {
    return [
      {
        id: current.zone === 'very_high' ? 'load.very_high' : 'load.high',
        area: 'load',
        kind: 'observation',
        severity: current.zone === 'very_high' ? 'warning' : 'notice',
        tone: 'caution',
        params: { ratio: round(current.ratio, 2) },
        evidence,
        confidence: source === 'device' ? 'high' : 'medium',
      },
    ];
  }
  if (current.zone === 'low') {
    return [
      {
        id: 'load.low',
        area: 'load',
        kind: 'observation',
        severity: 'info',
        tone: 'neutral',
        params: { ratio: round(current.ratio, 2) },
        evidence,
        confidence: source === 'device' ? 'high' : 'medium',
      },
    ];
  }
  return [];
}

/** Minimum points and span before a lift's trend is judged at all. */
const STALL_MIN_SESSIONS = 5;
const STALL_MIN_SPAN_DAYS = 21;
/** A lift not trained for this long is paused, not stalling. */
const STALL_MAX_IDLE_DAYS = 14;
/** More stalls than this become one summary finding. */
const STALL_MAX_SINGLE = 2;
const PROGRESS_MIN_GAIN = 0.05;

function strengthFindings(
  o: PerformanceOverviewResponse,
  asOf: string
): FitnessFinding[] {
  const out: FitnessFinding[] = [];
  const windowDays = dayIndex(o.range.end) - dayIndex(o.range.start) + 1;
  for (const lift of o.strength.topLifts) {
    const trend = lift.trend;
    // Best of the window set within the last three days: measured, solid.
    if (dayIndex(asOf) - dayIndex(lift.bestDate) <= 2 && trend.length >= 2) {
      out.push({
        id: 'strength.best_in_window',
        area: 'strength',
        kind: 'finding',
        severity: 'notice',
        tone: 'positive',
        params: {
          exercise: lift.exerciseName,
          e1rm: lift.bestE1rmKg,
          days: windowDays,
        },
        evidence: [
          {
            metric: 'e1rm',
            value: lift.bestE1rmKg,
            unit: 'kg',
            period: `${windowDays}d`,
            source: 'estimated',
          },
        ],
        confidence: 'high',
      });
      continue;
    }
    if (trend.length < STALL_MIN_SESSIONS) continue;
    const span = dayIndex(trend.at(-1)!.date) - dayIndex(trend[0]!.date);
    if (span < STALL_MIN_SPAN_DAYS) continue;
    const idle =
      dayIndex(asOf) - dayIndex(trend.at(-1)!.date) > STALL_MAX_IDLE_DAYS;
    const recent = trend.slice(-3).map((p) => p.value);
    const earlier = trend.slice(0, -3).map((p) => p.value);
    const recentBest = Math.max(...recent);
    const earlierBest = Math.max(...earlier);
    const firstMean = mean(trend.slice(0, 3).map((p) => p.value))!;
    const lastMean = mean(recent)!;
    if (recentBest <= earlierBest) {
      if (idle) continue;
      const since = trend.find((p) => p.value === earlierBest)!.date;
      const weeks = Math.max(
        1,
        Math.round((dayIndex(asOf) - dayIndex(since)) / 7)
      );
      if (weeks < 3) continue;
      out.push({
        id: 'strength.stall',
        area: 'strength',
        kind: 'hypothesis',
        severity: 'notice',
        tone: 'caution',
        params: { exercise: lift.exerciseName, weeks, best: earlierBest },
        evidence: [
          {
            metric: 'e1rm',
            value: earlierBest,
            unit: 'kg',
            period: `since ${since}`,
            source: 'estimated',
          },
          {
            metric: 'sessions',
            value: trend.length,
            period: `${windowDays}d`,
            source: 'logged',
          },
        ],
        confidence: trend.length >= 8 ? 'medium' : 'low',
      });
    } else if (firstMean > 0 && lastMean / firstMean - 1 >= PROGRESS_MIN_GAIN) {
      out.push({
        id: 'strength.progress',
        area: 'strength',
        kind: 'observation',
        severity: 'info',
        tone: 'positive',
        params: {
          exercise: lift.exerciseName,
          percent: Math.round((lastMean / firstMean - 1) * 100),
          weeks: Math.round(span / 7),
        },
        evidence: [
          {
            metric: 'e1rm',
            value: round(lastMean),
            unit: 'kg',
            period: 'last 3 sessions',
            source: 'estimated',
          },
          {
            metric: 'e1rmStart',
            value: round(firstMean),
            unit: 'kg',
            period: 'first 3 sessions',
            source: 'estimated',
          },
        ],
        confidence: trend.length >= 8 ? 'medium' : 'low',
      });
    }
  }
  return collapseStalls(out);
}

/**
 * Many lifts without a new best at once usually share one cause (a lighter
 * phase, less training); one summary says that better than a list.
 */
function collapseStalls(findings: FitnessFinding[]): FitnessFinding[] {
  const stalls = findings.filter((f) => f.id === 'strength.stall');
  if (stalls.length <= STALL_MAX_SINGLE) return findings;
  const byWeeks = [...stalls].sort(
    (a, b) => Number(b.params['weeks']) - Number(a.params['weeks'])
  );
  const summary: FitnessFinding = {
    id: 'strength.stall_many',
    area: 'strength',
    kind: 'hypothesis',
    severity: 'notice',
    tone: 'caution',
    params: {
      count: stalls.length,
      exercises: byWeeks
        .slice(0, 3)
        .map((f) => String(f.params['exercise']))
        .join(', '),
      weeks: Math.min(...stalls.map((f) => Number(f.params['weeks']))),
    },
    evidence: byWeeks.map((f) => ({
      metric: `e1rm:${String(f.params['exercise'])}`,
      value: Number(f.params['best']),
      unit: 'kg',
      period: `${String(f.params['weeks'])} wk`,
      source: 'estimated' as const,
    })),
    confidence: stalls.some((f) => f.confidence === 'medium')
      ? 'medium'
      : 'low',
  };
  return [...findings.filter((f) => f.id !== 'strength.stall'), summary];
}

const SHORT_SLEEP_HOURS = 6.5;
const IRREGULAR_BEDTIME_MINUTES = 75;

function sleepFindings(
  o: PerformanceOverviewResponse,
  asOf: string
): FitnessFinding[] {
  const week = lastDays(o.recovery.sleep.series, asOf, 7);
  const out: FitnessFinding[] = [];
  if (week.length >= 4) {
    const avg = mean(week.map((n) => n.hours))!;
    if (avg < SHORT_SLEEP_HOURS) {
      out.push({
        id: 'sleep.short',
        area: 'sleep',
        kind: 'observation',
        severity: avg < 6 ? 'warning' : 'notice',
        tone: 'caution',
        params: { hours: round(avg), nights: week.length },
        evidence: [
          {
            metric: 'sleepHours',
            value: round(avg),
            unit: 'h',
            period: '7d',
            source: 'measured',
          },
        ],
        confidence: week.length >= 6 ? 'high' : 'medium',
      });
    }
  }
  const sd = o.recovery.sleep.bedtimeStdDevMinutes;
  if (
    sd !== null &&
    o.recovery.sleep.nights >= 10 &&
    sd > IRREGULAR_BEDTIME_MINUTES
  ) {
    out.push({
      id: 'sleep.irregular',
      area: 'sleep',
      kind: 'observation',
      severity: 'info',
      tone: 'neutral',
      params: { minutes: Math.round(sd) },
      evidence: [
        {
          metric: 'bedtimeStdDev',
          value: Math.round(sd),
          unit: 'min',
          period: `${o.recovery.sleep.nights} nights`,
          source: 'measured',
        },
      ],
      confidence: 'medium',
    });
  }
  return out;
}

function consistencyFindings(
  o: PerformanceOverviewResponse,
  asOf: string
): FitnessFinding[] {
  const weeks = o.strength.weekly;
  if (weeks.length < 3) return [];
  // The current ISO week is incomplete unless it is Sunday; compare the
  // last complete week with the four before it.
  const day = new Date(`${asOf}T00:00:00Z`).getUTCDay();
  const complete = day === 0 ? weeks : weeks.slice(0, -1);
  if (complete.length < 3) return [];
  const last = complete.at(-1)!;
  const before = complete.slice(-5, -1);
  const usual = mean(before.map((w) => w.sets));
  if (usual === null || usual < 6) return [];
  const ratio = last.sets / usual;
  if (ratio < 0.5) {
    return [
      {
        id: 'consistency.drop',
        area: 'consistency',
        kind: 'observation',
        severity: 'notice',
        tone: 'caution',
        params: {
          sets: last.sets,
          usual: Math.round(usual),
          week: last.weekStart,
        },
        evidence: [
          {
            metric: 'weeklySets',
            value: last.sets,
            period: `week ${last.weekStart}`,
            source: 'logged',
          },
          {
            metric: 'weeklySetsUsual',
            value: Math.round(usual),
            period: `${before.length} weeks before`,
            source: 'logged',
          },
        ],
        confidence: before.length >= 4 ? 'high' : 'medium',
      },
    ];
  }
  if (ratio > 1.5) {
    return [
      {
        id: 'consistency.spike',
        area: 'consistency',
        kind: 'observation',
        severity: 'info',
        tone: 'neutral',
        params: {
          sets: last.sets,
          usual: Math.round(usual),
          week: last.weekStart,
        },
        evidence: [
          {
            metric: 'weeklySets',
            value: last.sets,
            period: `week ${last.weekStart}`,
            source: 'logged',
          },
          {
            metric: 'weeklySetsUsual',
            value: Math.round(usual),
            period: `${before.length} weeks before`,
            source: 'logged',
          },
        ],
        confidence: before.length >= 4 ? 'high' : 'medium',
      },
    ];
  }
  return [];
}

/** g protein per kg body weight below which the day is flagged. */
const PROTEIN_LOW_G_PER_KG = 1.4;

function nutritionFindings(
  o: PerformanceOverviewResponse,
  asOf: string
): FitnessFinding[] {
  const days = lastDays(o.nutrition.daily, asOf, 7).filter(
    (d) => d.calories > 0
  );
  const weight =
    o.body.weightAverage7d.at(-1)?.value ?? o.body.weight.at(-1)?.value;
  if (days.length < 5 || !weight) return [];
  const protein = mean(days.map((d) => d.protein))!;
  const perKg = protein / weight;
  if (perKg >= PROTEIN_LOW_G_PER_KG) return [];
  return [
    {
      id: 'nutrition.protein_low',
      area: 'nutrition',
      kind: 'observation',
      severity: 'info',
      tone: 'caution',
      params: {
        grams: Math.round(protein),
        perKg: round(perKg, 1),
        days: days.length,
      },
      evidence: [
        {
          metric: 'protein',
          value: Math.round(protein),
          unit: 'g',
          period: '7d',
          source: 'logged',
        },
        {
          metric: 'weight',
          value: round(weight),
          unit: 'kg',
          period: '7d',
          source: 'measured',
        },
      ],
      // Logged food is only as complete as the logging.
      confidence: days.length >= 7 ? 'medium' : 'low',
    },
  ];
}

const WEIGHT_TREND_NOTABLE_KG_PER_WEEK = 0.5;

function bodyFindings(o: PerformanceOverviewResponse): FitnessFinding[] {
  const trend = o.body.trendKgPerWeek;
  if (trend === null || Math.abs(trend) < WEIGHT_TREND_NOTABLE_KG_PER_WEEK)
    return [];
  const readings = o.body.weight.length;
  if (readings < 6) return [];
  return [
    {
      id: trend < 0 ? 'body.weight_falling' : 'body.weight_rising',
      area: 'body',
      kind: 'observation',
      severity: 'info',
      tone: 'neutral',
      params: { kgPerWeek: round(Math.abs(trend), 2) },
      evidence: [
        {
          metric: 'weightTrend',
          value: round(trend, 2),
          unit: 'kg/wk',
          period: `${readings} readings`,
          source: 'measured',
        },
      ],
      confidence: readings >= 14 ? 'high' : 'medium',
    },
  ];
}

export function compareFindings(a: FitnessFinding, b: FitnessFinding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    AREA_RANK[b.area] - AREA_RANK[a.area] ||
    CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
  );
}

/**
 * All findings for the overview, most important first. `asOf` is the day
 * the statements are about (usually the overview's end).
 */
export function deriveFindings(
  overview: PerformanceOverviewResponse,
  asOf: string = overview.range.end
): FitnessFinding[] {
  const all = [
    ...recoveryFindings(overview),
    ...loadFindings(overview),
    ...strengthFindings(overview, asOf),
    ...sleepFindings(overview, asOf),
    ...consistencyFindings(overview, asOf),
    ...nutritionFindings(overview, asOf),
    ...bodyFindings(overview),
  ];
  // Less training already explains missing new bests: the stall is then a
  // side note, not the headline.
  const trainedLess = all.some(
    (f) => f.id === 'consistency.drop' || f.id === 'load.low'
  );
  return all
    .map((f) =>
      trainedLess &&
      (f.id === 'strength.stall' || f.id === 'strength.stall_many')
        ? { ...f, severity: 'info' as const }
        : f
    )
    .sort(compareFindings);
}

/** What the data cannot say today, so the card can be honest about it. */
export function missingSignals(
  overview: PerformanceOverviewResponse,
  asOf: string = overview.range.end
): string[] {
  const missing: string[] = [];
  if (overview.recovery.hrv.status.status === 'insufficient_data')
    missing.push('hrv');
  if (overview.recovery.restingHr.status.status === 'insufficient_data')
    missing.push('restingHr');
  if (lastDays(overview.recovery.sleep.series, asOf, 7).length < 4)
    missing.push('sleep');
  if (
    lastDays(overview.nutrition.daily, asOf, 7).filter((d) => d.calories > 0)
      .length < 5
  ) {
    missing.push('nutrition');
  }
  if (overview.body.weight.length < 6) missing.push('weight');
  return missing;
}

// --- Compare view --------------------------------------------------------

export const COMPARE_METRICS = [
  'hrv',
  'restingHr',
  'sleepHours',
  'weight',
  'calories',
  'protein',
  'loadAcute',
  'loadRatio',
  'strengthVolume',
  'strengthSets',
  'runDistance',
  'vo2max',
] as const;
export type CompareMetric = (typeof COMPARE_METRICS)[number] | `e1rm:${string}`;

/** Weekly metrics only exist per ISO week; daily ones are bucketed to weeks when compared with them. */
const WEEKLY_METRICS = new Set<string>([
  'strengthVolume',
  'strengthSets',
  'runDistance',
]);

export function isWeeklyMetric(metric: CompareMetric): boolean {
  return WEEKLY_METRICS.has(metric);
}

/** A metric's series out of the overview (dates are days or week starts). */
export function metricSeries(
  overview: PerformanceOverviewResponse,
  metric: CompareMetric
): DatedValue[] {
  if (metric.startsWith('e1rm:')) {
    const id = metric.slice(5);
    const lift = overview.strength.topLifts.find(
      (l) => (l.exerciseId ?? l.exerciseName) === id
    );
    return lift ? lift.trend : [];
  }
  switch (metric) {
    case 'hrv':
      return overview.recovery.hrv.series;
    case 'restingHr':
      return overview.recovery.restingHr.series;
    case 'sleepHours':
      return overview.recovery.sleep.series.map((n) => ({
        date: n.date,
        value: n.hours,
      }));
    case 'weight':
      return overview.body.weight;
    case 'calories':
      return overview.nutrition.daily
        .filter((d) => d.calories > 0)
        .map((d) => ({ date: d.date, value: d.calories }));
    case 'protein':
      return overview.nutrition.daily
        .filter((d) => d.calories > 0)
        .map((d) => ({ date: d.date, value: d.protein }));
    case 'loadAcute':
      return overview.load.estimated.map((p) => ({
        date: p.date,
        value: p.acute,
      }));
    case 'loadRatio':
      return overview.load.estimated
        .filter((p) => p.ratio !== null)
        .map((p) => ({ date: p.date, value: p.ratio! }));
    case 'strengthVolume':
      return overview.strength.weekly.map((w) => ({
        date: w.weekStart,
        value: w.volumeKg,
      }));
    case 'strengthSets':
      return overview.strength.weekly.map((w) => ({
        date: w.weekStart,
        value: w.sets,
      }));
    case 'runDistance':
      return overview.running.weekly.map((w) => ({
        date: w.weekStart,
        value: w.distanceKm,
      }));
    case 'vo2max':
      return overview.running.vo2max;
    default:
      return [];
  }
}

function weekStartOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function toWeekly(series: readonly DatedValue[]): DatedValue[] {
  const buckets = new Map<string, number[]>();
  for (const p of series) {
    const w = weekStartOf(p.date);
    buckets.set(w, [...(buckets.get(w) ?? []), p.value]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, value: mean(values)! }));
}

export interface ComparePoint {
  date: string;
  a: number | null;
  b: number | null;
}

export interface CompareResult {
  bucket: 'day' | 'week';
  points: ComparePoint[];
  /** Pearson correlation over the dates where both have a value; null below MIN_PAIRS. */
  correlation: number | null;
  pairs: number;
}

/** Pairs needed before a correlation is shown at all. */
export const MIN_COMPARE_PAIRS = 8;

function pearson(xs: readonly number[], ys: readonly number[]): number | null {
  const mx = mean(xs)!;
  const my = mean(ys)!;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Two metrics on one time axis. A weekly metric moves both onto weeks
 * (weekly means), otherwise they stay daily. The correlation is a plain
 * observation over the shared dates, never a statement about cause.
 */
export function compareMetrics(
  overview: PerformanceOverviewResponse,
  a: CompareMetric,
  b: CompareMetric
): CompareResult {
  const weekly = isWeeklyMetric(a) || isWeeklyMetric(b);
  let sa = metricSeries(overview, a);
  let sb = metricSeries(overview, b);
  if (weekly) {
    sa = isWeeklyMetric(a) ? sa : toWeekly(sa);
    sb = isWeeklyMetric(b) ? sb : toWeekly(sb);
  }
  const ma = new Map(sa.map((p) => [p.date, p.value]));
  const mb = new Map(sb.map((p) => [p.date, p.value]));
  const dates = [...new Set([...ma.keys(), ...mb.keys()])].sort();
  const points = dates.map((date) => ({
    date,
    a: ma.get(date) ?? null,
    b: mb.get(date) ?? null,
  }));
  const both = points.filter((p) => p.a !== null && p.b !== null);
  const correlation =
    both.length >= MIN_COMPARE_PAIRS
      ? pearson(
          both.map((p) => p.a!),
          both.map((p) => p.b!)
        )
      : null;
  return {
    bucket: weekly ? 'week' : 'day',
    points,
    correlation: correlation === null ? null : round(correlation, 2),
    pairs: both.length,
  };
}

/** Words for |r|, deliberately modest. */
export function correlationStrength(
  r: number | null
): 'none' | 'weak' | 'moderate' | 'strong' | null {
  if (r === null) return null;
  const a = Math.abs(r);
  return a < 0.2 ? 'none' : a < 0.4 ? 'weak' : a < 0.7 ? 'moderate' : 'strong';
}

// --- Period report -------------------------------------------------------

export interface PeriodTotals {
  strengthDays: number;
  strengthSets: number;
  strengthVolumeKg: number;
  runs: number;
  runDistanceKm: number;
  avgSleepHours: number | null;
  avgHrv: number | null;
  avgRestingHr: number | null;
  avgCalories: number | null;
  avgProtein: number | null;
  nutritionDays: number;
  weightStart: number | null;
  weightEnd: number | null;
}

function inWindow(date: string, start: string, end: string): boolean {
  return date >= start && date <= end;
}

export function periodTotals(o: PerformanceOverviewResponse): PeriodTotals {
  const { start, end } = o.range;
  const weeks = o.strength.weekly;
  const nutrition = o.nutrition.daily.filter(
    (d) => d.calories > 0 && inWindow(d.date, start, end)
  );
  const sleep = o.recovery.sleep.series.filter((n) =>
    inWindow(n.date, start, end)
  );
  const hrv = o.recovery.hrv.series.filter((p) => inWindow(p.date, start, end));
  const rhr = o.recovery.restingHr.series.filter((p) =>
    inWindow(p.date, start, end)
  );
  const weights = o.body.weight.filter((p) => inWindow(p.date, start, end));
  const avg = (vs: number[], d = 1) => {
    const m = mean(vs);
    return m === null ? null : round(m, d);
  };
  return {
    strengthDays: weeks.reduce((s, w) => s + (w.days ?? 0), 0),
    strengthSets: weeks.reduce((s, w) => s + w.sets, 0),
    strengthVolumeKg: weeks.reduce((s, w) => s + w.volumeKg, 0),
    runs: o.running.totals.runs,
    runDistanceKm: round(o.running.totals.distanceKm),
    avgSleepHours: avg(sleep.map((n) => n.hours)),
    avgHrv: avg(
      hrv.map((p) => p.value),
      0
    ),
    avgRestingHr: avg(
      rhr.map((p) => p.value),
      0
    ),
    avgCalories: avg(
      nutrition.map((d) => d.calories),
      0
    ),
    avgProtein: avg(
      nutrition.map((d) => d.protein),
      0
    ),
    nutritionDays: nutrition.length,
    weightStart: weights[0]?.value ?? null,
    weightEnd: weights.at(-1)?.value ?? null,
  };
}

export interface ReportBest {
  exercise: string;
  e1rmKg: number;
  date: string;
}

/** Lifts whose best of the window fell into the report period itself. */
export function periodBests(
  o: PerformanceOverviewResponse,
  start: string,
  end: string
): ReportBest[] {
  return o.strength.topLifts
    .filter((l) => inWindow(l.bestDate, start, end))
    .map((l) => ({
      exercise: l.exerciseName,
      e1rmKg: l.bestE1rmKg,
      date: l.bestDate,
    }))
    .sort((a, b) => b.e1rmKg - a.e1rmKg);
}
