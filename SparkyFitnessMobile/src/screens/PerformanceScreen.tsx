import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type {
  PerformanceOverviewResponse,
  Provenance,
} from '@workspace/shared';

import { useScreenHeader } from '../hooks/useScreenHeader';
import {
  usePerformanceOverview,
  useWatchSyncStatus,
} from '../hooks/usePerformance';
import { usePreferences } from '../hooks/usePreferences';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import SegmentedControl from '../components/SegmentedControl';
import StatusView from '../components/StatusView';
import CompareCard from '../components/CompareCard';
import { weightFromKg } from '../utils/unitConversions';
import { getAppLocale } from '../localization';
import {
  acwrTone,
  averagePace,
  baselineTone,
  distanceFromKm,
  formatDurationSeconds,
  formatPacePerUnit,
  type Tone,
} from '../utils/performanceView';
import type { RootStackScreenProps } from '../types/navigation';

type PerformanceScreenProps = RootStackScreenProps<'Performance'>;
type Range = '30' | '90' | '180';

const TONE_CLASS: Record<Tone, string> = {
  good: 'text-text-success',
  warning: 'text-text-warning',
  // Text on a plain surface; text-text-danger is meant for danger fills.
  danger: 'text-text-danger-subtle',
  muted: 'text-text-secondary',
};

const Card: React.FC<{
  title: string;
  provenance?: Provenance[];
  children: React.ReactNode;
}> = ({ title, provenance, children }) => {
  const { t } = useTranslation();
  return (
    <View className="bg-surface rounded-xl p-4 mb-4 shadow-sm">
      <View className="flex-row justify-between items-center mb-3">
        <Text className="text-text-primary text-base font-bold">{title}</Text>
        {provenance && (
          <Text className="text-text-muted text-xs">
            {provenance
              .map(
                (p) =>
                  ({
                    measured: t('performance.provenance.measured', {
                      defaultValue: 'Measured',
                    }),
                    device: t('performance.provenance.device', {
                      defaultValue: 'Device',
                    }),
                    estimated: t('performance.provenance.estimated', {
                      defaultValue: 'Estimated',
                    }),
                  })[p]
              )
              .join(' · ')}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
};

const Row: React.FC<{
  label: string;
  value: string;
  tone?: Tone;
  last?: boolean;
}> = ({ label, value, tone, last }) => (
  <View
    className={`flex-row justify-between py-2 ${last ? '' : 'border-b border-border-subtle'}`}
  >
    <Text className="text-text-secondary text-sm">{label}</Text>
    <Text
      className={`text-sm font-semibold ${tone ? TONE_CLASS[tone] : 'text-text-primary'}`}
    >
      {value}
    </Text>
  </View>
);

const PerformanceScreen: React.FC<PerformanceScreenProps> = ({
  navigation,
}) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();
  const [range, setRange] = useState<Range>('90');
  const header = useScreenHeader({
    title: t('performance.title', { defaultValue: 'Performance' }),
    left: { kind: 'back' },
  });
  const { data, isLoading } = usePerformanceOverview(Number(range));
  const watch = useWatchSyncStatus();
  const { preferences } = usePreferences();
  const distUnit: 'km' | 'miles' =
    preferences?.default_distance_unit === 'miles' ? 'miles' : 'km';
  const weightUnit: 'kg' | 'lbs' =
    preferences?.default_weight_unit === 'lbs' ||
    preferences?.default_weight_unit === 'st_lbs'
      ? 'lbs'
      : 'kg';

  const baselineText = (status: string) =>
    ({
      below: t('performance.baseline.below', {
        defaultValue: 'Below baseline',
      }),
      within: t('performance.baseline.within', {
        defaultValue: 'Within baseline',
      }),
      above: t('performance.baseline.above', {
        defaultValue: 'Above baseline',
      }),
      insufficient_data: t('performance.baseline.insufficient', {
        defaultValue: 'Not enough history yet',
      }),
    })[status] ?? status;
  const zoneText = (zone: string) =>
    ({
      low: t('performance.zone.low', { defaultValue: 'Low (< 0.8)' }),
      optimal: t('performance.zone.optimal', {
        defaultValue: 'Optimal (0.8–1.3)',
      }),
      high: t('performance.zone.high', { defaultValue: 'High (1.3–1.5)' }),
      very_high: t('performance.zone.veryHigh', {
        defaultValue: 'Very high (> 1.5)',
      }),
    })[zone] ?? zone;

  const renderOverview = (d: PerformanceOverviewResponse) => {
    const vo2 = d.running.vo2max.at(-1);
    const races = [
      ['5k', '5 km'],
      ['10k', '10 km'],
      [
        'half_marathon',
        t('performance.halfMarathon', { defaultValue: 'Half marathon' }),
      ],
      ['marathon', t('performance.marathon', { defaultValue: 'Marathon' })],
    ] as const;
    return (
      <>
        <Card
          title={t('performance.kpi.readiness', { defaultValue: 'Readiness' })}
          provenance={['estimated', 'device']}
        >
          <Row
            label={t('performance.provenance.estimated', {
              defaultValue: 'Estimated',
            })}
            value={
              d.recovery.readiness.estimated
                ? String(d.recovery.readiness.estimated.score)
                : '–'
            }
          />
          <Row
            label={t('performance.readiness.garmin', {
              defaultValue: 'Garmin',
            })}
            value={
              d.recovery.readiness.device !== null
                ? String(d.recovery.readiness.device)
                : '–'
            }
          />
          <Row
            label={t('performance.kpi.acwr', {
              defaultValue: 'Load ratio (ACWR)',
            })}
            value={
              d.load.current
                ? `${d.load.current.ratio.toFixed(2)} · ${zoneText(d.load.current.zone)}`
                : '–'
            }
            tone={acwrTone(d.load.current?.zone)}
            last
          />
        </Card>

        <Card
          title={t('performance.sections.recovery', {
            defaultValue: 'Sleep & recovery',
          })}
          provenance={['measured']}
        >
          <Row
            label="HRV"
            value={
              d.recovery.hrv.status.recent !== null
                ? `${d.recovery.hrv.status.recent} ms · ${baselineText(d.recovery.hrv.status.status)}`
                : baselineText(d.recovery.hrv.status.status)
            }
            tone={baselineTone(d.recovery.hrv.status.status, true)}
          />
          <Row
            label={t('performance.restingHrShort', {
              defaultValue: 'Resting HR',
            })}
            value={
              d.recovery.restingHr.status.recent !== null
                ? `${d.recovery.restingHr.status.recent} bpm · ${baselineText(d.recovery.restingHr.status.status)}`
                : baselineText(d.recovery.restingHr.status.status)
            }
            tone={baselineTone(d.recovery.restingHr.status.status, false)}
          />
          <Row
            label={t('performance.kpi.sleep', { defaultValue: 'Sleep (avg)' })}
            value={
              d.recovery.sleep.avgSleepHours !== null
                ? `${d.recovery.sleep.avgSleepHours.toFixed(1)} h`
                : '–'
            }
          />
          <Row
            label={t('performance.bedtimeSpreadLabel', {
              defaultValue: 'Bedtime spread',
            })}
            value={
              d.recovery.sleep.bedtimeStdDevMinutes !== null
                ? `±${d.recovery.sleep.bedtimeStdDevMinutes} min`
                : '–'
            }
            last
          />
        </Card>

        <Card
          title={t('performance.sections.running', { defaultValue: 'Running' })}
          provenance={['measured', 'device']}
        >
          <Row
            label={t('performance.kpi.distance', {
              defaultValue: 'Running distance',
            })}
            value={`${distanceFromKm(d.running.totals.distanceKm, distUnit).toFixed(1)} ${distUnit === 'miles' ? 'mi' : 'km'} · ${d.running.totals.runs}×`}
          />
          <Row
            label={t('performance.kpi.pace', { defaultValue: 'Average pace' })}
            value={formatPacePerUnit(averagePace(d.running.totals), distUnit)}
          />
          <Row
            label={t('performance.kpi.vo2max', { defaultValue: 'VO2max' })}
            value={vo2 ? vo2.value.toFixed(1) : '–'}
            last
          />
        </Card>

        <Card
          title={t('performance.racePredictions', {
            defaultValue: 'Race predictions',
          })}
          provenance={['device', 'estimated']}
        >
          {races.map(([key, label], i) => (
            <Row
              key={key}
              label={label}
              value={`${formatDurationSeconds(d.running.predictions.device?.[key])}  ·  ~${formatDurationSeconds(d.running.predictions.estimated[key])}`}
              last={i === races.length - 1}
            />
          ))}
          <Text className="text-text-muted text-xs mt-2">
            {t('performance.raceLegend', {
              defaultValue: 'Garmin · ~Estimate (Riegel, best run ≥ 3 km)',
            })}
          </Text>
        </Card>

        {d.strength.topLifts.length > 0 && (
          <Card
            title={t('performance.topLifts', {
              defaultValue: 'Estimated 1RM by lift',
            })}
            provenance={['estimated']}
          >
            {d.strength.topLifts.map((lift, i) => (
              <Row
                key={lift.exerciseName}
                label={lift.exerciseName}
                value={`${weightFromKg(lift.bestE1rmKg, weightUnit).toFixed(1)} ${weightUnit}`}
                last={i === d.strength.topLifts.length - 1}
              />
            ))}
          </Card>
        )}

        <CompareCard overview={d} />

        <Card
          title={t('performance.sections.body', { defaultValue: 'Body' })}
          provenance={['estimated']}
        >
          <Row
            label={t('performance.kpi.weightTrend', {
              defaultValue: 'Weight trend',
            })}
            value={
              d.body.trendKgPerWeek !== null
                ? `${d.body.trendKgPerWeek > 0 ? '+' : ''}${weightFromKg(d.body.trendKgPerWeek, weightUnit).toFixed(2)} ${weightUnit}/${t('performance.weekShort', { defaultValue: 'wk' })}`
                : '–'
            }
          />
          <Row
            label={t('performance.calories', {
              defaultValue: 'Calories (kcal)',
            })}
            value={
              d.nutrition.averages.calories !== null
                ? String(Math.round(d.nutrition.averages.calories))
                : '–'
            }
          />
          <Row
            label={t('performance.proteinTitle', {
              defaultValue: 'Protein (g)',
            })}
            value={
              d.nutrition.averages.protein !== null
                ? String(Math.round(d.nutrition.averages.protein))
                : '–'
            }
            last
          />
        </Card>
      </>
    );
  };

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-4">
          <SegmentedControl
            segments={[
              { key: '30', label: t('ranges.30d', { defaultValue: '30d' }) },
              { key: '90', label: t('ranges.90d', { defaultValue: '90d' }) },
              {
                key: '180',
                label: t('performance.range180', { defaultValue: '180d' }),
              },
            ]}
            activeKey={range}
            onSelect={setRange}
          />
        </View>
        <TouchableOpacity
          testID="performance-open-insights"
          accessibilityRole="button"
          onPress={() => navigation.navigate('Insights')}
          className="bg-surface rounded-xl p-4 mb-4 shadow-sm flex-row justify-between items-center"
          activeOpacity={0.7}
        >
          <View className="flex-1">
            <Text className="text-text-primary text-base font-bold">
              {t('insights.entry.title', {
                defaultValue: 'Insights & reports',
              })}
            </Text>
            <Text className="text-text-secondary text-sm">
              {t('insights.entry.subtitle', {
                defaultValue: 'Today, last week and last month at a glance',
              })}
            </Text>
          </View>
          <Text className="text-text-muted text-lg">›</Text>
        </TouchableOpacity>
        {isLoading ? (
          <StatusView inline loading />
        ) : data ? (
          renderOverview(data)
        ) : (
          <StatusView
            inline
            icon="alert-circle"
            iconTone="danger"
            title={t('performance.loadError', {
              defaultValue: 'Failed to load performance data',
            })}
            subtitle={t('common.connectionRetry', {
              defaultValue: 'Please check your connection and try again.',
            })}
          />
        )}

        <Card
          title={t('performance.watchTitle', {
            defaultValue: 'Garmin watch (Sparky Strength)',
          })}
        >
          {watch.data ? (
            <>
              <Row
                label={t('performance.watchUploads', {
                  defaultValue: 'Workouts uploaded',
                })}
                value={String(watch.data.sessions_total)}
              />
              <Row
                label={t('performance.watchLinked', {
                  defaultValue: 'Linked to Garmin activities',
                })}
                value={String(watch.data.sessions_linked_to_garmin)}
              />
              <Row
                label={t('performance.watchLastUpload', {
                  defaultValue: 'Last upload',
                })}
                value={
                  watch.data.last_upload_at
                    ? new Date(watch.data.last_upload_at).toLocaleString(
                        getAppLocale(),
                        { dateStyle: 'medium', timeStyle: 'short' }
                      )
                    : '–'
                }
                last={watch.data.devices.length === 0}
              />
              {watch.data.devices.map((device, i) => (
                <Row
                  key={device.device_id}
                  label={device.device_model ?? device.device_id.slice(0, 8)}
                  value={device.app_version ? `v${device.app_version}` : ''}
                  last={i === watch.data!.devices.length - 1}
                />
              ))}
            </>
          ) : (
            <Text className="text-text-secondary text-sm">
              {watch.isError
                ? t('performance.watchUnavailable', {
                    defaultValue: 'Watch status unavailable on this server.',
                  })
                : t('performance.watchNone', {
                    defaultValue:
                      'Pair the watch in SparkyFitness web: Settings > Garmin watch.',
                  })}
            </Text>
          )}
        </Card>
      </ScrollView>
    </View>
  );
};

export default PerformanceScreen;
