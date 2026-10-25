import type { PerformanceOverviewResponse } from '@workspace/shared';

/**
 * Readiness as Garmin Connect shows it: one 0-100 score in four bands, the
 * factors behind it each with its own status, and one sentence for the day.
 * Status colours are the same everywhere (good / fair / poor), see
 * STATUS_TOKENS.
 */
export type ReadinessLevel = 'high' | 'moderate' | 'low' | 'poor';
export type FactorStatus = 'good' | 'fair' | 'poor';
export type ReadinessFactor = 'sleep' | 'hrv' | 'restingHr' | 'load';
export type DayAdvice = 'train' | 'steady' | 'easy' | 'unknown';

/** Theme colour of each status, for text and gauge alike. */
export const STATUS_TOKENS: Record<FactorStatus, string> = {
  good: '--color-text-success',
  fair: '--color-text-warning',
  poor: '--color-text-danger',
};

/** Garmin's training readiness bands. */
export function readinessLevel(score: number): ReadinessLevel {
  if (score >= 75) return 'high';
  if (score >= 50) return 'moderate';
  if (score >= 25) return 'low';
  return 'poor';
}

export function levelStatus(level: ReadinessLevel): FactorStatus {
  return level === 'high' ? 'good' : level === 'moderate' ? 'fair' : 'poor';
}

/** A factor's 0-100 contribution as a status. */
export function factorStatus(value: number): FactorStatus {
  if (value >= 67) return 'good';
  if (value >= 34) return 'fair';
  return 'poor';
}

const FACTOR_ORDER: ReadinessFactor[] = ['sleep', 'hrv', 'restingHr', 'load'];

export interface ReadinessView {
  score: number;
  level: ReadinessLevel;
  source: 'estimated' | 'device';
  factors: { key: ReadinessFactor; value: number; status: FactorStatus }[];
  advice: DayAdvice;
  /** The weakest factor, when it is what holds the day back. */
  limiting: ReadinessFactor | null;
  /** A score without current-day wearable data is context, not today's advice. */
  current: boolean;
  missingFactors: ReadinessFactor[];
}

export function readinessView(
  data: PerformanceOverviewResponse
): ReadinessView | null {
  const estimated = data.recovery.readiness.estimated;
  const deviceScore =
    data.today?.date === data.range.end ? data.today.trainingReadiness : null;
  const score = estimated?.score ?? deviceScore;
  if (score === null || score === undefined) return null;
  const factors = FACTOR_ORDER.flatMap((key) => {
    const value = estimated?.components[key];
    return value === undefined
      ? []
      : [{ key, value, status: factorStatus(value) }];
  });
  const current = Boolean(
    data.today?.date && data.today.date === data.range.end
  );
  const missingFactors = FACTOR_ORDER.filter(
    (key) => !factors.some((factor) => factor.key === key)
  );
  const level = readinessLevel(score);
  const overloaded = data.load.current?.zone === 'very_high';
  const advice: DayAdvice =
    !current || (estimated != null && factors.length < 2)
      ? 'unknown'
      : overloaded || level === 'poor' || level === 'low'
        ? 'easy'
        : level === 'high'
          ? 'train'
          : 'steady';
  const weakest = [...factors].sort((a, b) => a.value - b.value)[0];
  return {
    score,
    level,
    source: estimated ? 'estimated' : 'device',
    factors,
    current,
    missingFactors,
    advice,
    limiting:
      advice !== 'train' && weakest && weakest.status !== 'good'
        ? weakest.key
        : overloaded
          ? 'load'
          : null,
  };
}
