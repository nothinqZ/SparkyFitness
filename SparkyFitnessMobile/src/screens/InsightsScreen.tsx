import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { FitnessFinding, InsightsReportResponse } from '@workspace/shared';

import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import SegmentedControl from '../components/SegmentedControl';
import StatusView from '../components/StatusView';
import { useFindingColor } from '../components/TodayInsightCard';
import { useInsightsReport, useInsightsToday } from '../hooks/useInsights';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { formatLocalizedNumber } from '../localization/i18n';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import type { RootStackScreenProps } from '../types/navigation';
import { formatLocalizedDate } from '../utils/insightDates';
import {
  confidenceLabel,
  evidenceLine,
  findingKindLabel,
  findingText,
  metricLabel,
} from '../utils/insightText';

type Tab = 'today' | 'week' | 'month';

/**
 * Insights (personal edition): today's findings with their evidence, and
 * weekly / monthly reports against the period before. Everything shown is
 * computed by deterministic rules on the server; only the summary on the
 * Today tab may be worded by the user's AI service, and it says so.
 */
const InsightsScreen: React.FC<RootStackScreenProps<'Insights'>> = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();
  const [tab, setTab] = useState<Tab>('today');

  const header = useScreenHeader({
    title: t('screens.insights', { defaultValue: 'Insights' }),
    left: { kind: 'back' },
  });

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={
          usesNativeHeader ? 'automatic' : 'never'
        }
      >
        <SegmentedControl<Tab>
          segments={[
            {
              key: 'today',
              label: t('insights.tabs.today', { defaultValue: 'Today' }),
            },
            {
              key: 'week',
              label: t('insights.tabs.week', { defaultValue: 'Week' }),
            },
            {
              key: 'month',
              label: t('insights.tabs.month', { defaultValue: 'Month' }),
            },
          ]}
          activeKey={tab}
          onSelect={setTab}
        />
        <View className="h-4" />
        {tab === 'today' ? <TodayTab /> : <ReportTab period={tab} />}
      </ScrollView>
    </View>
  );
};

function TodayTab() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useInsightsToday();
  if (isLoading) return <StatusView loading inline />;
  if (isError || !data) return <InsightsError onRetry={() => void refetch()} />;
  return (
    <View>
      <Text className="text-text-muted text-xs mb-3">
        {t('insights.today.dataThrough', {
          defaultValue: 'Data through {{date}}',
          date: formatLocalizedDate(data.dataThrough),
        })}
      </Text>
      {data.summary && (
        <View className="bg-surface rounded-xl p-4 mb-4 shadow-sm">
          <Text className="text-text-primary text-base">
            {data.summary.text}
          </Text>
          <Text className="text-text-muted text-xs mt-2">
            {t('insights.today.aiWorded', {
              defaultValue: 'Worded by your AI service from the findings above',
            })}
          </Text>
        </View>
      )}
      {data.findings.length === 0 ? (
        <Text className="text-text-secondary text-sm mb-4">
          {t('insights.none', {
            defaultValue:
              'Nothing stands out. Your recent data looks unremarkable.',
          })}
        </Text>
      ) : (
        data.findings.map((finding) => (
          <FindingCard
            key={finding.id + JSON.stringify(finding.params)}
            finding={finding}
          />
        ))
      )}
      <MissingNote missing={data.missing} />
      <Text className="text-text-muted text-xs mt-2">
        {t('insights.disclaimer', {
          defaultValue:
            'Computed from your logged and measured data with fixed rules. Not medical advice.',
        })}
      </Text>
    </View>
  );
}

function InsightsError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <StatusView
      inline
      icon="alert-circle"
      iconTone="danger"
      title={t('insights.error', {
        defaultValue: 'Insights could not be loaded.',
      })}
      action={{
        label: t('common.retry', { defaultValue: 'Retry' }),
        onPress: onRetry,
      }}
    />
  );
}

function FindingCard({ finding }: { finding: FitnessFinding }) {
  const { t } = useTranslation();
  const color = useFindingColor();
  const text = findingText(t, finding);
  return (
    <View
      testID={`finding-${finding.id}`}
      className="bg-surface rounded-xl p-4 mb-3 shadow-sm"
    >
      <View className="flex-row justify-between mb-1">
        <Text
          className="text-xs font-semibold"
          style={{ color: color(finding) }}
        >
          {findingKindLabel(t, finding.kind)}
        </Text>
        <Text className="text-text-muted text-xs">
          {confidenceLabel(t, finding.confidence)}
        </Text>
      </View>
      <Text className="text-text-primary text-base font-semibold">
        {text.title}
      </Text>
      {text.detail !== '' && (
        <Text className="text-text-secondary text-sm mt-0.5">
          {text.detail}
        </Text>
      )}
      <View className="mt-2">
        {finding.evidence.map((e) => (
          <Text key={e.metric + e.period} className="text-text-muted text-xs">
            {evidenceLine(t, e)}
          </Text>
        ))}
      </View>
    </View>
  );
}

function MissingNote({ missing }: { missing: string[] }) {
  const { t } = useTranslation();
  if (missing.length === 0) return null;
  return (
    <Text className="text-text-muted text-xs mb-2">
      {t('insights.missing', {
        defaultValue: 'Not enough recent data for: {{list}}',
        list: missing.map((m) => metricLabel(t, m)).join(', '),
      })}
    </Text>
  );
}

type Totals = InsightsReportResponse['totals'];

function ReportTab({ period }: { period: 'week' | 'month' }) {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useInsightsReport(period);
  if (isLoading) return <StatusView loading inline />;
  if (isError || !data) return <InsightsError onRetry={() => void refetch()} />;
  const cur = data.totals;
  const prev = data.previous;
  const weightChange =
    cur.weightStart !== null && cur.weightEnd !== null
      ? cur.weightEnd - cur.weightStart
      : null;
  const rows: {
    label: string;
    value: (x: Totals) => number | null;
    unit?: string;
    digits?: number;
  }[] = [
    {
      label: t('insights.report.strengthDays', {
        defaultValue: 'Strength days',
      }),
      value: (x) => x.strengthDays,
    },
    {
      label: t('insights.report.sets', { defaultValue: 'Sets' }),
      value: (x) => x.strengthSets,
    },
    {
      label: t('insights.report.volume', { defaultValue: 'Volume' }),
      value: (x) => x.strengthVolumeKg,
      unit: 'kg',
    },
    {
      label: t('insights.report.runs', { defaultValue: 'Runs' }),
      value: (x) => x.runs,
    },
    {
      label: t('insights.report.distance', {
        defaultValue: 'Running distance',
      }),
      value: (x) => x.runDistanceKm,
      unit: 'km',
      digits: 1,
    },
    {
      label: t('insights.report.sleep', { defaultValue: 'Sleep per night' }),
      value: (x) => x.avgSleepHours,
      unit: 'h',
      digits: 1,
    },
    {
      label: t('insights.report.hrv', { defaultValue: 'HRV' }),
      value: (x) => x.avgHrv,
      unit: 'ms',
    },
    {
      label: t('insights.report.restingHr', {
        defaultValue: 'Resting heart rate',
      }),
      value: (x) => x.avgRestingHr,
      unit: 'bpm',
    },
    {
      label: t('insights.report.calories', {
        defaultValue: 'Calories per day',
      }),
      value: (x) => x.avgCalories,
      unit: 'kcal',
    },
    {
      label: t('insights.report.protein', { defaultValue: 'Protein per day' }),
      value: (x) => x.avgProtein,
      unit: 'g',
    },
  ];
  return (
    <View>
      <Text className="text-text-primary text-lg font-bold mb-1">
        {formatLocalizedDate(data.start)} –{' '}
        {formatLocalizedDate(data.end, {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
        })}
      </Text>
      <Text className="text-text-muted text-xs mb-3">
        {t('insights.report.compared', {
          defaultValue: 'Compared with the period before',
        })}
      </Text>
      <View className="bg-surface rounded-xl p-4 mb-4 shadow-sm">
        {rows.map((row) => {
          const now = row.value(cur);
          const before = row.value(prev);
          return (
            <View key={row.label} className="flex-row justify-between py-1.5">
              <Text className="text-text-secondary text-sm">{row.label}</Text>
              <Text className="text-text-primary text-sm font-semibold">
                {now === null
                  ? '–'
                  : `${formatLocalizedNumber(now, { maximumFractionDigits: row.digits ?? 0 })}${row.unit ? ` ${row.unit}` : ''}`}
                <Text className="text-text-muted font-normal">
                  {delta(now, before, row.digits ?? 0)}
                </Text>
              </Text>
            </View>
          );
        })}
        {weightChange !== null && (
          <View className="flex-row justify-between py-1.5">
            <Text className="text-text-secondary text-sm">
              {t('insights.report.weightChange', {
                defaultValue: 'Weight change',
              })}
            </Text>
            <Text className="text-text-primary text-sm font-semibold">
              {`${weightChange > 0 ? '+' : ''}${formatLocalizedNumber(weightChange, { maximumFractionDigits: 1 })} kg`}
            </Text>
          </View>
        )}
      </View>

      {data.bests.length > 0 && (
        <View className="bg-surface rounded-xl p-4 mb-4 shadow-sm">
          <Text className="text-text-primary text-base font-bold mb-2">
            {t('insights.report.bests', {
              defaultValue: 'Best lifts of the last 90 days',
            })}
          </Text>
          {data.bests.map((b) => (
            <View key={b.exercise} className="flex-row justify-between py-1">
              <Text
                className="text-text-secondary text-sm flex-1"
                numberOfLines={1}
              >
                {b.exercise}
              </Text>
              <Text className="text-text-primary text-sm font-semibold">
                {t('insights.report.bestValue', {
                  defaultValue: '{{value}} kg · {{date}}',
                  value: formatLocalizedNumber(b.e1rmKg, {
                    maximumFractionDigits: 1,
                  }),
                  date: formatLocalizedDate(b.date),
                })}
              </Text>
            </View>
          ))}
        </View>
      )}

      {data.findings.map((finding) => (
        <FindingCard
          key={finding.id + JSON.stringify(finding.params)}
          finding={finding}
        />
      ))}
      <MissingNote missing={data.missing} />
    </View>
  );
}

/** "  (+3)" against the period before, or nothing. */
function delta(
  now: number | null,
  before: number | null,
  digits: number
): string {
  if (now === null || before === null) return '';
  const d = now - before;
  if (Math.abs(d) < 10 ** -digits / 2) return '  (±0)';
  return `  (${d > 0 ? '+' : ''}${formatLocalizedNumber(d, { maximumFractionDigits: digits })})`;
}

export default InsightsScreen;
