import type { TFunction } from 'i18next';
import type { FitnessFinding } from '@workspace/shared';
import { formatLocalizedNumber } from '../localization/i18n';

/**
 * Words for the deterministic findings of `/api/v2/insights/*`
 * (shared/src/analytics/insights.ts). Each rule id maps to its own static
 * keys, as the i18n audit requires; numbers are formatted for the app
 * locale before they are interpolated.
 */
export interface FindingText {
  title: string;
  detail: string;
}

function localizedParams(
  params: FitnessFinding['params']
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    out[key] =
      typeof value === 'number'
        ? formatLocalizedNumber(value, { maximumFractionDigits: 2 })
        : value;
  }
  return out;
}

export function findingText(
  t: TFunction,
  finding: FitnessFinding
): FindingText {
  const p = localizedParams(finding.params);
  switch (finding.id) {
    case 'recovery.strained':
      return {
        title: t('insights.rules.recoveryStrained.title', {
          defaultValue: 'Recovery looks strained',
        }),
        detail: t('insights.rules.recoveryStrained.detail', {
          defaultValue:
            'HRV {{hrv}} ms against your usual {{hrvBaseline}} ms, resting heart rate {{restingHr}} against {{restingHrBaseline}} bpm. Possibly fatigue; a lighter day could fit.',
          ...p,
        }),
      };
    case 'recovery.hrv_low':
      return {
        title: t('insights.rules.hrvLow.title', {
          defaultValue: 'HRV below your normal range',
        }),
        detail: t('insights.rules.hrvLow.detail', {
          defaultValue: '7-day average {{hrv}} ms, usually {{hrvBaseline}} ms.',
          ...p,
        }),
      };
    case 'recovery.resting_hr_high':
      return {
        title: t('insights.rules.restingHrHigh.title', {
          defaultValue: 'Resting heart rate raised',
        }),
        detail: t('insights.rules.restingHrHigh.detail', {
          defaultValue:
            '7-day average {{restingHr}} bpm, usually {{restingHrBaseline}} bpm.',
          ...p,
        }),
      };
    case 'load.very_high':
      return {
        title: t('insights.rules.loadVeryHigh.title', {
          defaultValue: 'Training load jumped',
        }),
        detail: t('insights.rules.loadVeryHigh.detail', {
          defaultValue: 'Acute to chronic load {{ratio}}, above 1.5.',
          ...p,
        }),
      };
    case 'load.high':
      return {
        title: t('insights.rules.loadHigh.title', {
          defaultValue: 'Training load raised',
        }),
        detail: t('insights.rules.loadHigh.detail', {
          defaultValue: 'Acute to chronic load {{ratio}}, between 1.3 and 1.5.',
          ...p,
        }),
      };
    case 'load.low':
      return {
        title: t('insights.rules.loadLow.title', {
          defaultValue: 'Training load below your level',
        }),
        detail: t('insights.rules.loadLow.detail', {
          defaultValue: 'Acute to chronic load {{ratio}}, below 0.8.',
          ...p,
        }),
      };
    case 'strength.best_in_window':
      return {
        title: t('insights.rules.bestInWindow.title', {
          defaultValue: 'Best {{exercise}}',
          ...p,
        }),
        detail: t('insights.rules.bestInWindow.detail', {
          defaultValue:
            'Estimated 1RM {{e1rm}} kg, your best of the last {{days}} days.',
          ...p,
        }),
      };
    case 'strength.stall':
      return {
        title: t('insights.rules.stall.title', {
          defaultValue: '{{exercise}} may be stalling',
          ...p,
        }),
        detail: t('insights.rules.stall.detail', {
          defaultValue:
            'No better estimated 1RM than {{best}} kg for {{weeks}} weeks.',
          ...p,
        }),
      };
    case 'strength.stall_many':
      return {
        title: t('insights.rules.stallMany.title', {
          defaultValue: '{{count}} lifts without a new best',
          ...p,
        }),
        detail: t('insights.rules.stallMany.detail', {
          defaultValue:
            'For at least {{weeks}} weeks, e.g. {{exercises}}. Often a lighter phase or less training rather than a plateau.',
          ...p,
        }),
      };
    case 'strength.progress':
      return {
        title: t('insights.rules.progress.title', {
          defaultValue: '{{exercise}} is climbing',
          ...p,
        }),
        detail: t('insights.rules.progress.detail', {
          defaultValue: '+{{percent}} % estimated 1RM over {{weeks}} weeks.',
          ...p,
        }),
      };
    case 'sleep.short':
      return {
        title: t('insights.rules.sleepShort.title', {
          defaultValue: 'Little sleep',
        }),
        detail: t('insights.rules.sleepShort.detail', {
          defaultValue: 'Average {{hours}} h over the last {{nights}} nights.',
          ...p,
        }),
      };
    case 'sleep.irregular':
      return {
        title: t('insights.rules.sleepIrregular.title', {
          defaultValue: 'Irregular bedtime',
        }),
        detail: t('insights.rules.sleepIrregular.detail', {
          defaultValue: 'Bedtime varies by about {{minutes}} minutes.',
          ...p,
        }),
      };
    case 'consistency.drop':
      return {
        title: t('insights.rules.consistencyDrop.title', {
          defaultValue: 'Less training than usual',
        }),
        detail: t('insights.rules.consistencyDrop.detail', {
          defaultValue:
            'Week of {{week}}: {{sets}} sets, usually about {{usual}}.',
          ...p,
        }),
      };
    case 'consistency.spike':
      return {
        title: t('insights.rules.consistencySpike.title', {
          defaultValue: 'Much more training than usual',
        }),
        detail: t('insights.rules.consistencySpike.detail', {
          defaultValue:
            'Week of {{week}}: {{sets}} sets, usually about {{usual}}.',
          ...p,
        }),
      };
    case 'nutrition.protein_low':
      return {
        title: t('insights.rules.proteinLow.title', {
          defaultValue: 'Protein on the low side',
        }),
        detail: t('insights.rules.proteinLow.detail', {
          defaultValue:
            'Average {{grams}} g ({{perKg}} g/kg) over {{days}} logged days.',
          ...p,
        }),
      };
    case 'body.weight_falling':
      return {
        title: t('insights.rules.weightFalling.title', {
          defaultValue: 'Weight going down',
        }),
        detail: t('insights.rules.weightFalling.detail', {
          defaultValue: 'About {{kgPerWeek}} kg per week.',
          ...p,
        }),
      };
    case 'body.weight_rising':
      return {
        title: t('insights.rules.weightRising.title', {
          defaultValue: 'Weight going up',
        }),
        detail: t('insights.rules.weightRising.detail', {
          defaultValue: 'About {{kgPerWeek}} kg per week.',
          ...p,
        }),
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
      return t('insights.kind.hypothesis', { defaultValue: 'Possible' });
    case 'finding':
      return t('insights.kind.finding', { defaultValue: 'Measured' });
    default:
      return t('insights.kind.observation', { defaultValue: 'Observation' });
  }
}

export function confidenceLabel(
  t: TFunction,
  confidence: FitnessFinding['confidence']
): string {
  switch (confidence) {
    case 'high':
      return t('insights.confidence.high', { defaultValue: 'high confidence' });
    case 'medium':
      return t('insights.confidence.medium', {
        defaultValue: 'medium confidence',
      });
    default:
      return t('insights.confidence.low', { defaultValue: 'low confidence' });
  }
}

/** Labels for evidence metrics, compare metrics and missing signals. */
export function metricLabel(t: TFunction, metric: string): string {
  if (metric.startsWith('e1rm:')) {
    return t('insights.metric.e1rmOf', {
      defaultValue: 'e1RM {{exercise}}',
      exercise: metric.slice(5),
    });
  }
  switch (metric) {
    case 'hrv':
      return t('insights.metric.hrv', { defaultValue: 'HRV' });
    case 'hrvBaseline':
      return t('insights.metric.hrvBaseline', { defaultValue: 'HRV, usual' });
    case 'restingHr':
      return t('insights.metric.restingHr', {
        defaultValue: 'Resting heart rate',
      });
    case 'restingHrBaseline':
      return t('insights.metric.restingHrBaseline', {
        defaultValue: 'Resting heart rate, usual',
      });
    case 'sleep':
    case 'sleepHours':
      return t('insights.metric.sleepHours', { defaultValue: 'Sleep' });
    case 'bedtimeStdDev':
      return t('insights.metric.bedtimeStdDev', {
        defaultValue: 'Bedtime spread',
      });
    case 'weight':
      return t('insights.metric.weight', { defaultValue: 'Weight' });
    case 'weightTrend':
      return t('insights.metric.weightTrend', { defaultValue: 'Weight trend' });
    case 'nutrition':
    case 'calories':
      return t('insights.metric.calories', { defaultValue: 'Calories' });
    case 'protein':
      return t('insights.metric.protein', { defaultValue: 'Protein' });
    case 'loadAcute':
      return t('insights.metric.loadAcute', { defaultValue: 'Acute load' });
    case 'loadRatio':
      return t('insights.metric.loadRatio', { defaultValue: 'Load ratio' });
    case 'strengthVolume':
      return t('insights.metric.strengthVolume', {
        defaultValue: 'Strength volume / week',
      });
    case 'strengthSets':
    case 'weeklySets':
      return t('insights.metric.strengthSets', { defaultValue: 'Sets / week' });
    case 'weeklySetsUsual':
      return t('insights.metric.weeklySetsUsual', {
        defaultValue: 'Sets / week, usual',
      });
    case 'runDistance':
      return t('insights.metric.runDistance', {
        defaultValue: 'Running km / week',
      });
    case 'vo2max':
      return t('insights.metric.vo2max', { defaultValue: 'VO2max' });
    case 'e1rm':
      return t('insights.metric.e1rm', { defaultValue: 'Estimated 1RM' });
    case 'e1rmStart':
      return t('insights.metric.e1rmStart', {
        defaultValue: 'Estimated 1RM, start',
      });
    case 'sessions':
      return t('insights.metric.sessions', { defaultValue: 'Sessions' });
    default:
      return metric;
  }
}

export function sourceLabel(t: TFunction, source: string): string {
  switch (source) {
    case 'device':
      return t('insights.source.device', { defaultValue: 'Garmin' });
    case 'estimated':
      return t('insights.source.estimated', { defaultValue: 'estimated' });
    case 'logged':
      return t('insights.source.logged', { defaultValue: 'logged' });
    default:
      return t('insights.source.measured', { defaultValue: 'measured' });
  }
}

/** "HRV 41 ms · 7d · measured" */
export function evidenceLine(
  t: TFunction,
  e: FitnessFinding['evidence'][number]
): string {
  const value =
    typeof e.value === 'number'
      ? formatLocalizedNumber(e.value, { maximumFractionDigits: 2 })
      : e.value;
  return [
    `${metricLabel(t, e.metric)} ${value}${e.unit ? ` ${e.unit}` : ''}`,
    e.period,
    sourceLabel(t, e.source),
  ].join(' · ');
}
