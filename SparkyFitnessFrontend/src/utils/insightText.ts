import type { TFunction } from 'i18next';
import type { FitnessFinding } from '@workspace/shared';

/** Locale-aware number, at most `digits` decimals. */
export function formatInsightNumber(
  value: number,
  locale: string,
  digits = 2
): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits,
  }).format(value);
}

/**
 * Words for the deterministic findings of `/api/v2/insights/*`
 * (shared/src/analytics/insights.ts). Same keys as the app's copy in
 * SparkyFitnessMobile/src/utils/insightText.ts; numbers are formatted for
 * the UI locale before they are interpolated.
 */
export interface FindingText {
  title: string;
  detail: string;
}

function localizedParams(
  params: FitnessFinding['params'],
  locale: string
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] =
      typeof value === 'number' ? formatInsightNumber(value, locale) : value;
  }
  return out;
}

export function findingText(
  t: TFunction,
  finding: FitnessFinding,
  locale: string
): FindingText {
  const p = localizedParams(finding.params, locale);
  switch (finding.id) {
    case 'recovery.strained':
      return {
        title: t(
          'insights.rules.recoveryStrained.title',
          'Recovery looks strained'
        ),
        detail: t(
          'insights.rules.recoveryStrained.detail',
          'HRV {{hrv}} ms against your usual {{hrvBaseline}} ms, resting heart rate {{restingHr}} against {{restingHrBaseline}} bpm. Possibly fatigue; a lighter day could fit.',
          p
        ),
      };
    case 'recovery.hrv_low':
      return {
        title: t('insights.rules.hrvLow.title', 'HRV below your normal range'),
        detail: t(
          'insights.rules.hrvLow.detail',
          '7-day average {{hrv}} ms, usually {{hrvBaseline}} ms.',
          p
        ),
      };
    case 'recovery.resting_hr_high':
      return {
        title: t(
          'insights.rules.restingHrHigh.title',
          'Resting heart rate raised'
        ),
        detail: t(
          'insights.rules.restingHrHigh.detail',
          '7-day average {{restingHr}} bpm, usually {{restingHrBaseline}} bpm.',
          p
        ),
      };
    case 'load.very_high':
      return {
        title: t('insights.rules.loadVeryHigh.title', 'Training load jumped'),
        detail: t(
          'insights.rules.loadVeryHigh.detail',
          'Acute to chronic load {{ratio}}, above 1.5.',
          p
        ),
      };
    case 'load.high':
      return {
        title: t('insights.rules.loadHigh.title', 'Training load raised'),
        detail: t(
          'insights.rules.loadHigh.detail',
          'Acute to chronic load {{ratio}}, between 1.3 and 1.5.',
          p
        ),
      };
    case 'load.low':
      return {
        title: t(
          'insights.rules.loadLow.title',
          'Training load below your level'
        ),
        detail: t(
          'insights.rules.loadLow.detail',
          'Acute to chronic load {{ratio}}, below 0.8.',
          p
        ),
      };
    case 'strength.best_in_window':
      return {
        title: t('insights.rules.bestInWindow.title', 'Best {{exercise}}', p),
        detail: t(
          'insights.rules.bestInWindow.detail',
          'Estimated 1RM {{e1rm}} kg, your best of the last {{days}} days.',
          p
        ),
      };
    case 'strength.stall':
      return {
        title: t(
          'insights.rules.stall.title',
          '{{exercise}} may be stalling',
          p
        ),
        detail: t(
          'insights.rules.stall.detail',
          'No better estimated 1RM than {{best}} kg for {{weeks}} weeks.',
          p
        ),
      };
    case 'strength.stall_many':
      return {
        title: t(
          'insights.rules.stallMany.title',
          '{{count}} lifts without a new best',
          p
        ),
        detail: t(
          'insights.rules.stallMany.detail',
          'For at least {{weeks}} weeks, e.g. {{exercises}}. Often a lighter phase or less training rather than a plateau.',
          p
        ),
      };
    case 'strength.progress':
      return {
        title: t(
          'insights.rules.progress.title',
          '{{exercise}} is climbing',
          p
        ),
        detail: t(
          'insights.rules.progress.detail',
          '+{{percent}} % estimated 1RM over {{weeks}} weeks.',
          p
        ),
      };
    case 'sleep.short':
      return {
        title: t('insights.rules.sleepShort.title', 'Little sleep'),
        detail: t(
          'insights.rules.sleepShort.detail',
          'Average {{hours}} h over the last {{nights}} nights.',
          p
        ),
      };
    case 'sleep.irregular':
      return {
        title: t('insights.rules.sleepIrregular.title', 'Irregular bedtime'),
        detail: t(
          'insights.rules.sleepIrregular.detail',
          'Bedtime varies by about {{minutes}} minutes.',
          p
        ),
      };
    case 'consistency.drop':
      return {
        title: t(
          'insights.rules.consistencyDrop.title',
          'Less training than usual'
        ),
        detail: t(
          'insights.rules.consistencyDrop.detail',
          'Week of {{week}}: {{sets}} sets, usually about {{usual}}.',
          p
        ),
      };
    case 'consistency.spike':
      return {
        title: t(
          'insights.rules.consistencySpike.title',
          'Much more training than usual'
        ),
        detail: t(
          'insights.rules.consistencySpike.detail',
          'Week of {{week}}: {{sets}} sets, usually about {{usual}}.',
          p
        ),
      };
    case 'nutrition.protein_low':
      return {
        title: t('insights.rules.proteinLow.title', 'Protein on the low side'),
        detail: t(
          'insights.rules.proteinLow.detail',
          'Average {{grams}} g ({{perKg}} g/kg) over {{days}} logged days.',
          p
        ),
      };
    case 'body.weight_falling':
      return {
        title: t('insights.rules.weightFalling.title', 'Weight going down'),
        detail: t(
          'insights.rules.weightFalling.detail',
          'About {{kgPerWeek}} kg per week.',
          p
        ),
      };
    case 'body.weight_rising':
      return {
        title: t('insights.rules.weightRising.title', 'Weight going up'),
        detail: t(
          'insights.rules.weightRising.detail',
          'About {{kgPerWeek}} kg per week.',
          p
        ),
      };
    default:
      // A rule the app does not know yet (newer server): say nothing wrong.
      return { title: finding.id, detail: '' };
  }
}

export function findingKindLabel(
  t: TFunction,
  kind: FitnessFinding['kind']
): string {
  switch (kind) {
    case 'hypothesis':
      return t('insights.kind.hypothesis', 'Possible');
    case 'finding':
      return t('insights.kind.finding', 'Measured');
    default:
      return t('insights.kind.observation', 'Observation');
  }
}

export function confidenceLabel(
  t: TFunction,
  confidence: FitnessFinding['confidence']
): string {
  switch (confidence) {
    case 'high':
      return t('insights.confidence.high', 'high confidence');
    case 'medium':
      return t('insights.confidence.medium', 'medium confidence');
    default:
      return t('insights.confidence.low', 'low confidence');
  }
}

/** Labels for evidence metrics, compare metrics and missing signals. */
export function metricLabel(t: TFunction, metric: string): string {
  if (metric.startsWith('e1rm:')) {
    return t('insights.metric.e1rmOf', 'e1RM {{exercise}}', {
      exercise: metric.slice(5),
    });
  }
  switch (metric) {
    case 'hrv':
      return t('insights.metric.hrv', 'HRV');
    case 'hrvBaseline':
      return t('insights.metric.hrvBaseline', 'HRV, usual');
    case 'restingHr':
      return t('insights.metric.restingHr', 'Resting heart rate');
    case 'restingHrBaseline':
      return t(
        'insights.metric.restingHrBaseline',
        'Resting heart rate, usual'
      );
    case 'sleep':
    case 'sleepHours':
      return t('insights.metric.sleepHours', 'Sleep');
    case 'bedtimeStdDev':
      return t('insights.metric.bedtimeStdDev', 'Bedtime spread');
    case 'weight':
      return t('insights.metric.weight', 'Weight');
    case 'weightTrend':
      return t('insights.metric.weightTrend', 'Weight trend');
    case 'nutrition':
    case 'calories':
      return t('insights.metric.calories', 'Calories');
    case 'protein':
      return t('insights.metric.protein', 'Protein');
    case 'loadAcute':
      return t('insights.metric.loadAcute', 'Acute load');
    case 'loadRatio':
      return t('insights.metric.loadRatio', 'Load ratio');
    case 'strengthVolume':
      return t('insights.metric.strengthVolume', 'Strength volume / week');
    case 'strengthSets':
    case 'weeklySets':
      return t('insights.metric.strengthSets', 'Sets / week');
    case 'weeklySetsUsual':
      return t('insights.metric.weeklySetsUsual', 'Sets / week, usual');
    case 'runDistance':
      return t('insights.metric.runDistance', 'Running km / week');
    case 'vo2max':
      return t('insights.metric.vo2max', 'VO2max');
    case 'e1rm':
      return t('insights.metric.e1rm', 'Estimated 1RM');
    case 'e1rmStart':
      return t('insights.metric.e1rmStart', 'Estimated 1RM, start');
    case 'sessions':
      return t('insights.metric.sessions', 'Sessions');
    default:
      return metric;
  }
}

export function sourceLabel(t: TFunction, source: string): string {
  switch (source) {
    case 'device':
      return t('insights.source.device', 'Garmin');
    case 'estimated':
      return t('insights.source.estimated', 'estimated');
    case 'logged':
      return t('insights.source.logged', 'logged');
    default:
      return t('insights.source.measured', 'measured');
  }
}

/** "HRV 41 ms · 7d · measured" */
export function evidenceLine(
  t: TFunction,
  e: FitnessFinding['evidence'][number],
  locale: string
): string {
  const value =
    typeof e.value === 'number'
      ? formatInsightNumber(e.value, locale)
      : e.value;
  return [
    `${metricLabel(t, e.metric)} ${value}${e.unit ? ` ${e.unit}` : ''}`,
    e.period,
    sourceLabel(t, e.source),
  ].join(' · ');
}

/** "(+3)" against the period before, "(±0)" when equal, nothing without both. */
export function formatDelta(
  now: number | null,
  before: number | null,
  digits: number,
  locale: string
): string {
  if (now === null || before === null) return '';
  const d = now - before;
  if (Math.abs(d) < 10 ** -digits / 2) return '(±0)';
  return `(${d > 0 ? '+' : ''}${formatInsightNumber(d, locale, digits)})`;
}

/** Each series scaled to 0–100 of its own range, so both fit one axis. */
export function normalizeSeries(values: (number | null)[]): (number | null)[] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return values.map(() => null);
  const min = Math.min(...present);
  const span = Math.max(...present) - min;
  return values.map((v) =>
    v === null ? null : span === 0 ? 50 : ((v - min) / span) * 100
  );
}
