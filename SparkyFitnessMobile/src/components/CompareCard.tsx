import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { CartesianChart } from 'victory-native';
import { useCSSVariable } from 'uniwind';
import {
  COMPARE_METRICS,
  MIN_COMPARE_PAIRS,
  compareMetrics,
  correlationStrength,
  metricSeries,
  type CompareMetric,
  type PerformanceOverviewResponse,
} from '@workspace/shared';

import { formatLocalizedNumber } from '../localization/i18n';
import { useChartFont, CHART_LABEL_FONT_SIZE } from './charts/chartFormatting';
import LineSeriesMark from './charts/LineSeriesMark';
import { formatLocalizedDate } from '../utils/insightDates';
import { metricLabel } from '../utils/insightText';

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

const MetricChips: React.FC<{
  options: { key: CompareMetric; label: string }[];
  selected: CompareMetric;
  color: string;
  testIDPrefix: string;
  onSelect: (key: CompareMetric) => void;
}> = ({ options, selected, color, testIDPrefix, onSelect }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    className="mb-2"
  >
    {options.map((o) => {
      const active = o.key === selected;
      return (
        <TouchableOpacity
          key={o.key}
          testID={`${testIDPrefix}-${o.key}`}
          onPress={() => onSelect(o.key)}
          accessibilityRole="button"
          accessibilityState={{ selected: active }}
          className={`px-3 py-1.5 rounded-full mr-2 ${active ? '' : 'bg-raised'}`}
          style={active ? { backgroundColor: color } : undefined}
        >
          <Text
            className={`text-xs font-medium ${active ? 'text-white' : 'text-text-secondary'}`}
          >
            {o.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </ScrollView>
);

/**
 * Compare two signals of the performance overview over the chosen range
 * (shared compareMetrics: weekly buckets when one side is weekly, Pearson r
 * only from MIN_COMPARE_PAIRS pairs). A correlation is an observation, and
 * the card says so.
 */
type CompareSelection = { a: CompareMetric; b: CompareMetric };

const CompareCard: React.FC<{
  overview: PerformanceOverviewResponse;
  selection?: CompareSelection;
  onSelectionChange?: (selection: CompareSelection) => void;
  readOnly?: boolean;
  title?: string;
  testID?: string;
}> = ({
  overview,
  selection,
  onSelectionChange,
  readOnly = false,
  title,
  testID = 'compare-card',
}) => {
  const { t } = useTranslation();
  const font = useChartFont(CHART_LABEL_FONT_SIZE);
  const [colorA, colorB, textMuted] = useCSSVariable([
    '--color-accent-primary',
    '--color-cat-orange',
    '--color-text-muted',
  ]) as [string, string, string];

  const options = useMemo(() => {
    const lifts = overview.strength.topLifts.map((l) => ({
      key: `e1rm:${l.exerciseId ?? l.exerciseName}` as CompareMetric,
      label: t('insights.metric.e1rmOf', {
        defaultValue: 'e1RM {{exercise}}',
        exercise: l.exerciseName,
      }),
    }));
    return [
      ...COMPARE_METRICS.map((m) => ({
        key: m as CompareMetric,
        label: metricLabel(t, m),
      })),
      ...lifts,
    ].filter((o) => metricSeries(overview, o.key).length > 0);
  }, [overview, t]);

  const pick = (preferred: CompareMetric, not?: CompareMetric) =>
    options.find((o) => o.key === preferred && o.key !== not)?.key ??
    options.find((o) => o.key !== not)?.key;
  const [a, setA] = useState<CompareMetric | undefined>(() =>
    pick('sleepHours')
  );
  const [b, setB] = useState<CompareMetric | undefined>(() => pick('hrv', a));
  // The range may drop a metric: fall back instead of comparing nothing.
  const metricA = selection
    ? selection.a
    : a && options.some((o) => o.key === a)
      ? a
      : pick('sleepHours');
  const metricB = selection
    ? selection.b
    : b && b !== metricA && options.some((o) => o.key === b)
      ? b
      : pick('hrv', metricA);

  const selectA = (next: CompareMetric) => {
    if (selection && metricB) onSelectionChange?.({ a: next, b: metricB });
    else setA(next);
  };
  const selectB = (next: CompareMetric) => {
    if (selection && metricA) onSelectionChange?.({ a: metricA, b: next });
    else setB(next);
  };

  const result = useMemo(
    () =>
      metricA && metricB ? compareMetrics(overview, metricA, metricB) : null,
    [overview, metricA, metricB]
  );
  const chartData = useMemo(() => {
    if (!result) return [];
    const na = normalizeSeries(result.points.map((p) => p.a));
    const nb = normalizeSeries(result.points.map((p) => p.b));
    return result.points.map((p, i) => ({ x: i, a: na[i]!, b: nb[i]! }));
  }, [result]);

  const labelOf = (key: CompareMetric | undefined) =>
    options.find((o) => o.key === key)?.label ?? '';

  if (!metricA || !metricB || (options.length < 2 && !selection)) return null;
  if (
    !result ||
    !options.some((o) => o.key === metricA) ||
    !options.some((o) => o.key === metricB)
  ) {
    if (!readOnly) return null;
    return (
      <View
        testID={testID}
        className="bg-surface rounded-2xl p-5 mb-3 border border-border-subtle"
      >
        <Text className="text-text-primary text-base font-bold">
          {title ?? t('insights.compare.title', { defaultValue: 'Compare' })}
        </Text>
        <Text className="text-text-muted text-sm mt-2">
          {t('insights.compare.noData', {
            defaultValue: 'Not enough data in this range.',
          })}
        </Text>
      </View>
    );
  }

  const strength = correlationStrength(result.correlation);
  const direction =
    result.correlation !== null && result.correlation < 0
      ? t('insights.compare.inverse', { defaultValue: 'opposite directions' })
      : t('insights.compare.same', { defaultValue: 'the same direction' });
  const strengthText =
    strength === 'strong'
      ? t('insights.compare.strong', { defaultValue: 'Strongly linked' })
      : strength === 'moderate'
        ? t('insights.compare.moderate', { defaultValue: 'Moderately linked' })
        : strength === 'weak'
          ? t('insights.compare.weak', { defaultValue: 'Weakly linked' })
          : t('insights.compare.noLink', { defaultValue: 'No clear link' });
  const bucket =
    result.bucket === 'week'
      ? t('insights.compare.weeks', { defaultValue: 'weeks' })
      : t('insights.compare.days', { defaultValue: 'days' });

  return (
    <View
      testID={testID}
      className="bg-surface rounded-2xl border border-border-subtle p-5 mb-3"
    >
      <Text className="text-text-primary text-base font-bold mb-3">
        {title ?? t('insights.compare.title', { defaultValue: 'Compare' })}
      </Text>
      {!readOnly && (
        <>
          <MetricChips
            options={options.filter((o) => o.key !== metricB)}
            selected={metricA}
            color={colorA}
            testIDPrefix="compare-a"
            onSelect={selectA}
          />
          <MetricChips
            options={options.filter((o) => o.key !== metricA)}
            selected={metricB}
            color={colorB}
            testIDPrefix="compare-b"
            onSelect={selectB}
          />
        </>
      )}

      {chartData.length >= 2 ? (
        <View style={{ height: 160 }} className="mt-1">
          <CartesianChart
            data={chartData}
            xKey="x"
            yKeys={['a', 'b']}
            domain={{ y: [0, 100] }}
            domainPadding={{ left: 8, right: 8, top: 8, bottom: 8 }}
            xAxis={{
              font,
              tickCount: 4,
              labelColor: textMuted,
              formatXLabel: (i) => {
                const p = result.points[Math.round(Number(i))];
                return p ? formatLocalizedDate(p.date) : '';
              },
            }}
          >
            {({ points }) => (
              <>
                <LineSeriesMark
                  points={points.a}
                  color={colorA}
                  strokeWidth={2}
                  curveType="linear"
                  connectMissingData
                />
                <LineSeriesMark
                  points={points.b}
                  color={colorB}
                  strokeWidth={2}
                  curveType="linear"
                  connectMissingData
                />
              </>
            )}
          </CartesianChart>
        </View>
      ) : (
        <Text className="text-text-muted text-sm my-4">
          {t('insights.compare.noData', {
            defaultValue: 'Not enough data in this range.',
          })}
        </Text>
      )}

      <View className="flex-row mt-2">
        <Text className="text-xs font-semibold mr-3" style={{ color: colorA }}>
          ● {labelOf(metricA)}
        </Text>
        <Text className="text-xs font-semibold" style={{ color: colorB }}>
          ● {labelOf(metricB)}
        </Text>
      </View>

      <Text
        testID="compare-result"
        className="text-text-primary text-sm font-semibold mt-3"
      >
        {result.pairs < MIN_COMPARE_PAIRS
          ? t('insights.compare.tooFew', {
              defaultValue:
                '{{pairs}} of {{min}} {{bucket}} with both values; too few to judge a link.',
              pairs: result.pairs,
              min: MIN_COMPARE_PAIRS,
              bucket,
            })
          : result.correlation === null
            ? t('insights.compare.flat', {
                defaultValue:
                  'No clear link: one of the values does not change ({{pairs}} {{bucket}}).',
                pairs: result.pairs,
                bucket,
              })
            : strength === 'none'
              ? t('insights.compare.resultNone', {
                  defaultValue:
                    '{{strength}} (r = {{r}}, {{pairs}} {{bucket}})',
                  strength: strengthText,
                  r: formatLocalizedNumber(result.correlation, {
                    maximumFractionDigits: 2,
                  }),
                  pairs: result.pairs,
                  bucket,
                })
              : t('insights.compare.result', {
                  defaultValue:
                    '{{strength}}, moving in {{direction}} (r = {{r}}, {{pairs}} {{bucket}})',
                  strength: strengthText,
                  direction,
                  r: formatLocalizedNumber(result.correlation, {
                    maximumFractionDigits: 2,
                  }),
                  pairs: result.pairs,
                  bucket,
                })}
      </Text>
      <Text className="text-text-muted text-xs mt-1">
        {t('insights.compare.disclaimer', {
          defaultValue:
            'Lines are scaled to their own range. A link is an observation, not a cause.',
        })}
      </Text>
    </View>
  );
};

export default CompareCard;
