import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import { usePerformanceOverview } from '../hooks/usePerformance';
import { formatLocalizedNumber } from '../localization';
import {
  STATUS_TOKENS,
  levelStatus,
  readinessView,
  type FactorStatus,
  type ReadinessFactor,
} from '../utils/readinessView';
import ReadinessGauge from './ReadinessGauge';

const STATUS_TEXT: Record<FactorStatus, string> = {
  good: 'text-text-success',
  fair: 'text-text-warning',
  poor: 'text-text-danger',
};

/**
 * Today's readiness as Garmin Connect's morning report: the score on a
 * gauge, one sentence for the day (with the routine that is due), the
 * factors behind it, and the watch's own day values.
 */
const TodayReadinessCard: React.FC<{
  nextRoutine: string | null;
  onPress?: () => void;
}> = ({ nextRoutine, onPress }) => {
  const { t } = useTranslation();
  const { data } = usePerformanceOverview(30);
  const [border] = useCSSVariable(['--color-border-subtle']) as [string];
  const view = data ? readinessView(data) : null;

  const factorLabel = (key: ReadinessFactor) =>
    ({
      sleep: t('readiness.factor.sleep', { defaultValue: 'Sleep' }),
      hrv: t('readiness.factor.hrv', { defaultValue: 'HRV' }),
      restingHr: t('readiness.factor.restingHr', {
        defaultValue: 'Resting heart rate',
      }),
      load: t('readiness.factor.load', { defaultValue: 'Training load' }),
    })[key];
  const statusLabel = (status: FactorStatus) =>
    ({
      good: t('readiness.status.good', { defaultValue: 'Good' }),
      fair: t('readiness.status.fair', { defaultValue: 'Fair' }),
      poor: t('readiness.status.poor', { defaultValue: 'Poor' }),
    })[status];

  let sentence: string;
  if (!view || view.advice === 'unknown') {
    sentence = t('readiness.advice.unknown', {
      defaultValue:
        'Not enough current recovery data for a training recommendation.',
    });
  } else if (view.advice === 'easy') {
    sentence = view.limiting
      ? t('readiness.advice.easyBecause', {
          defaultValue: 'Take it easier today: {{factor}} is low.',
          factor: factorLabel(view.limiting),
        })
      : t('readiness.advice.easy', {
          defaultValue: 'Take it easier today.',
        });
  } else if (nextRoutine) {
    sentence =
      view.advice === 'train'
        ? t('readiness.advice.trainRoutine', {
            defaultValue: 'Well recovered. {{routine}} is up next.',
            routine: nextRoutine,
          })
        : t('readiness.advice.steadyRoutine', {
            defaultValue:
              '{{routine}} is up next. Go by feel on the heavy sets.',
            routine: nextRoutine,
          });
  } else {
    sentence =
      view.advice === 'train'
        ? t('readiness.advice.train', {
            defaultValue: 'Well recovered for a hard session.',
          })
        : t('readiness.advice.steady', {
            defaultValue: 'A normal training day.',
          });
  }

  const today = data?.today;
  const chips = [
    today?.bodyBatteryHighest != null
      ? {
          label: t('performance.today.bodyBattery', {
            defaultValue: 'Body Battery',
          }),
          value: formatLocalizedNumber(Math.round(today.bodyBatteryHighest)),
        }
      : null,
    today?.sleepHours != null
      ? {
          label: t('readiness.chip.sleep', { defaultValue: 'Sleep' }),
          value: t('readiness.chip.hours', {
            defaultValue: '{{value}} h',
            value: formatLocalizedNumber(today.sleepHours, {
              maximumFractionDigits: 1,
            }),
          }),
        }
      : null,
    today?.restingHr != null
      ? {
          label: t('readiness.chip.restingHr', { defaultValue: 'Resting HR' }),
          value: formatLocalizedNumber(Math.round(today.restingHr)),
        }
      : null,
  ].filter((c): c is { label: string; value: string } => c !== null);

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      disabled={!onPress}
      onPress={onPress}
      className="bg-surface rounded-2xl p-4 mb-4"
      testID="today-readiness-card"
    >
      <View className="flex-row items-center">
        {view?.current && view.advice !== 'unknown' ? (
          <ReadinessGauge
            value={view.score}
            colorToken={STATUS_TOKENS[levelStatus(view.level)]}
            label={t('readiness.title', { defaultValue: 'Readiness' })}
            size={112}
          />
        ) : null}
        <View className="flex-1 ml-3">
          <Text className="text-text-secondary text-xs">
            {t('readiness.title', { defaultValue: 'Readiness' })}
            {view?.source === 'estimated'
              ? ` · ${t('performance.provenance.estimated', { defaultValue: 'Estimated' })}`
              : ''}
            {view?.source === 'estimated' &&
            view.current &&
            data?.today?.trainingReadiness != null
              ? ` · ${t('readiness.garmin', {
                  defaultValue: 'Garmin: {{value}}',
                  value: data.today.trainingReadiness,
                })}`
              : ''}
          </Text>
          {view?.current && view.advice !== 'unknown' ? (
            <Text
              className={`text-base font-semibold ${STATUS_TEXT[levelStatus(view.level)]}`}
            >
              {
                {
                  high: t('readiness.level.high', { defaultValue: 'High' }),
                  moderate: t('readiness.level.moderate', {
                    defaultValue: 'Moderate',
                  }),
                  low: t('readiness.level.low', { defaultValue: 'Low' }),
                  poor: t('readiness.level.poor', { defaultValue: 'Poor' }),
                }[view.level]
              }
            </Text>
          ) : null}
          <Text className="text-text-primary text-sm mt-1">{sentence}</Text>
        </View>
      </View>

      {view && !view.current ? (
        <Text className="text-text-muted text-xs mt-2">
          {t('readiness.stale', {
            defaultValue:
              'Latest wearable data: {{date}}. No current-day score yet.',
            date: data?.today?.date ?? '—',
          })}
        </Text>
      ) : null}
      {view?.current && view.missingFactors.length > 0 ? (
        <Text className="text-text-muted text-xs mt-2">
          {t('readiness.missingFactors', {
            defaultValue: 'Not available: {{factors}}',
            factors: view.missingFactors.map(factorLabel).join(', '),
          })}
        </Text>
      ) : null}

      {view && view.factors.length > 0 ? (
        <View
          className="mt-3"
          style={{ borderTopWidth: 1, borderColor: border }}
        >
          {view.factors.map((f) => (
            <View
              key={f.key}
              className="flex-row justify-between py-1.5"
              testID={`readiness-factor-${f.key}`}
            >
              <Text className="text-text-secondary text-sm">
                {factorLabel(f.key)}
              </Text>
              <Text className={`text-sm font-medium ${STATUS_TEXT[f.status]}`}>
                {statusLabel(f.status)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {chips.length > 0 ? (
        <View className="flex-row gap-2 mt-2">
          {chips.map((c) => (
            <View
              key={c.label}
              className="flex-1 bg-raised rounded-xl px-3 py-2"
            >
              <Text className="text-text-muted text-xs">{c.label}</Text>
              <Text className="text-text-primary text-base font-semibold">
                {c.value}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
};

export default TodayReadinessCard;
