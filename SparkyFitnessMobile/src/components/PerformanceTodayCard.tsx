import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import type { PerformanceOverviewResponse } from '@workspace/shared';
import { usePerformanceOverview } from '../hooks/usePerformance';
import { formatLocalizedNumber } from '../localization';

type Overview = PerformanceOverviewResponse;

function trainingMessage(
  data: Overview
): 'recover' | 'steady' | 'ready' | 'unknown' {
  const score =
    data.recovery.readiness.estimated?.score ?? data.recovery.readiness.device;
  if (
    data.load.current?.zone === 'very_high' ||
    (score !== null && score !== undefined && score < 40)
  )
    return 'recover';
  if (score === null || score === undefined) return 'unknown';
  if (score >= 70 && data.load.current?.zone !== 'high') return 'ready';
  return 'steady';
}

const Stat: React.FC<{ label: string; value: string; detail?: string }> = ({
  label,
  value,
  detail,
}) => (
  <View className="flex-1 min-w-[22%] mb-2">
    <Text className="text-text-secondary text-xs">{label}</Text>
    <Text className="text-text-primary text-base font-semibold">{value}</Text>
    {detail ? <Text className="text-text-muted text-xs">{detail}</Text> : null}
  </View>
);

/** Garmin's day summary (Body Battery, stress, steps, recovery time). */
const DayStats: React.FC<{
  today: NonNullable<Overview['today']>;
}> = ({ today }) => {
  const { t } = useTranslation();
  const n = (v: number | null) =>
    v === null ? '–' : formatLocalizedNumber(Math.round(v));
  return (
    <View
      className="flex-row flex-wrap border-t border-border-subtle pt-3 mb-2"
      testID="performance-day-stats"
    >
      <Stat
        label={t('performance.today.bodyBattery', {
          defaultValue: 'Body Battery',
        })}
        value={n(today.bodyBatteryHighest)}
        detail={
          today.bodyBatteryLowest !== null
            ? t('performance.today.bodyBatteryLow', {
                defaultValue: 'low {{value}}',
                value: n(today.bodyBatteryLowest),
              })
            : undefined
        }
      />
      <Stat
        label={t('performance.today.stress', { defaultValue: 'Stress' })}
        value={n(today.avgStress)}
        detail={t('performance.today.average', { defaultValue: 'average' })}
      />
      <Stat
        label={t('performance.today.steps', { defaultValue: 'Steps' })}
        value={n(today.steps)}
        detail={
          today.stepGoal !== null
            ? t('performance.today.stepGoal', {
                defaultValue: 'of {{value}}',
                value: n(today.stepGoal),
              })
            : undefined
        }
      />
      <Stat
        label={t('performance.today.recovery', { defaultValue: 'Recovery' })}
        value={
          today.recoveryTimeHours === null
            ? '–'
            : `${n(today.recoveryTimeHours)} h`
        }
        detail="Garmin"
      />
    </View>
  );
};

const PerformanceTodayCard: React.FC<{ onPress: () => void }> = ({
  onPress,
}) => {
  const { t } = useTranslation();
  const { data, isLoading, isError } = usePerformanceOverview(30);
  const score =
    data?.recovery.readiness.estimated?.score ??
    data?.recovery.readiness.device;
  const source = data?.recovery.readiness.estimated ? 'estimated' : 'device';
  const message = data ? trainingMessage(data) : 'unknown';
  const loadZone =
    data?.load.current?.zone === 'very_high'
      ? t('performance.zone.veryHigh', { defaultValue: 'Very high (> 1.5)' })
      : data?.load.current?.zone === 'high'
        ? t('performance.zone.high', { defaultValue: 'High (1.3–1.5)' })
        : data?.load.current?.zone === 'optimal'
          ? t('performance.zone.optimal', { defaultValue: 'Optimal (0.8–1.3)' })
          : data?.load.current?.zone === 'low'
            ? t('performance.zone.low', { defaultValue: 'Low (< 0.8)' })
            : '–';
  const guidance = {
    recover: t('performance.today.recover', {
      defaultValue:
        'Take it easier today. Recovery or recent load calls for caution.',
    }),
    steady: t('performance.today.steady', {
      defaultValue: 'A steady training day. Adjust intensity to how you feel.',
    }),
    ready: t('performance.today.ready', {
      defaultValue:
        'Good conditions for a planned session. Listen to your body.',
    }),
    unknown: t('performance.today.unknown', {
      defaultValue: 'Not enough recovery data for a daily assessment yet.',
    }),
  }[message];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('performance.today.open', {
        defaultValue: 'Open performance cockpit',
      })}
      onPress={onPress}
      className="bg-surface rounded-xl p-4 mb-3 shadow-sm"
    >
      <View className="flex-row justify-between items-center mb-2">
        <Text className="text-text-primary text-lg font-bold">
          {t('performance.today.title', {
            defaultValue: 'Your training today',
          })}
        </Text>
        <Text className="text-accent-primary text-sm font-semibold">
          {t('performance.today.details', { defaultValue: 'Details ›' })}
        </Text>
      </View>
      {isLoading ? (
        <Text className="text-text-secondary text-sm">
          {t('performance.today.loading', {
            defaultValue: 'Loading performance…',
          })}
        </Text>
      ) : isError ? (
        <Text className="text-text-secondary text-sm">
          {t('performance.today.unavailable', {
            defaultValue:
              'Performance data unavailable. Tap to retry in the cockpit.',
          })}
        </Text>
      ) : (
        <>
          <View className="flex-row items-baseline mb-2">
            <Text className="text-text-primary text-3xl font-bold">
              {score === null || score === undefined
                ? '–'
                : formatLocalizedNumber(Math.round(score))}
            </Text>
            <Text className="text-text-secondary text-sm ml-2">
              {t('performance.kpi.readiness', { defaultValue: 'Readiness' })}
              {score !== null && score !== undefined
                ? ` · ${
                    source === 'estimated'
                      ? t('performance.provenance.estimated', {
                          defaultValue: 'Estimated',
                        })
                      : t('performance.provenance.device', {
                          defaultValue: 'Device',
                        })
                  }`
                : ''}
            </Text>
          </View>
          <Text className="text-text-primary text-sm mb-3">{guidance}</Text>
          {data?.today && <DayStats today={data.today} />}
          <View className="flex-row flex-wrap">
            <Text className="text-text-secondary text-xs mr-4">
              {t('performance.today.load', { defaultValue: 'Load' })}:{' '}
              {loadZone}
            </Text>
            <Text className="text-text-secondary text-xs mr-4">
              {t('performance.today.hrv', { defaultValue: 'HRV' })}:{' '}
              {data?.recovery.hrv.status.recent != null
                ? t('performance.today.hrvValue', {
                    defaultValue: '{{value}} ms',
                    value: data.recovery.hrv.status.recent,
                  })
                : '–'}
            </Text>
            <Text className="text-text-secondary text-xs">
              {t('performance.today.sleep', {
                defaultValue: 'Sleep (average)',
              })}
              :{' '}
              {data?.recovery.sleep.avgSleepHours == null
                ? '–'
                : t('performance.today.sleepValue', {
                    defaultValue: '{{value}} h',
                    value: formatLocalizedNumber(
                      data.recovery.sleep.avgSleepHours,
                      { maximumFractionDigits: 1 }
                    ),
                  })}
            </Text>
          </View>
        </>
      )}
    </Pressable>
  );
};

export default PerformanceTodayCard;
