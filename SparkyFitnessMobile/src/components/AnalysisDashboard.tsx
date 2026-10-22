import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import {
  COMPARE_METRICS,
  metricSeries,
  type CompareMetric,
  type PerformanceOverviewResponse,
} from '@workspace/shared';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import { metricLabel } from '../utils/insightText';
import CompareCard from './CompareCard';

type Pair = { a: CompareMetric; b: CompareMetric };

/** The user's small, device-local collection of repeatable metric comparisons. */
const AnalysisDashboard: React.FC<{
  overview: PerformanceOverviewResponse;
}> = ({ overview }) => {
  const { t } = useTranslation();
  const saved = useAppPreferencesStore((state) => state.analysisComparisons);
  const add = useAppPreferencesStore((state) => state.addAnalysisComparison);
  const remove = useAppPreferencesStore(
    (state) => state.removeAnalysisComparison
  );
  const available = useMemo(
    () =>
      [
        ...COMPARE_METRICS,
        ...overview.strength.topLifts.map(
          (lift) =>
            `e1rm:${lift.exerciseId ?? lift.exerciseName}` as CompareMetric
        ),
      ].filter((metric) => metricSeries(overview, metric).length > 0),
    [overview]
  );
  const [chosen, setChosen] = useState<Pair>({ a: 'sleepHours', b: 'hrv' });
  const first = available.includes(chosen.a) ? chosen.a : available[0];
  const second =
    available.includes(chosen.b) && chosen.b !== first
      ? chosen.b
      : available.find((metric) => metric !== first);
  if (!first || !second) return null;
  const current = { a: first, b: second };
  const alreadySaved = saved.some(
    (pair) => pair.a === first && pair.b === second
  );
  const isFull = saved.length >= 4;

  return (
    <View>
      <Text className="text-text-primary text-xl font-bold mb-1">
        {t('insights.dashboard.title', { defaultValue: 'Your analysis board' })}
      </Text>
      <Text className="text-text-secondary text-sm mb-4">
        {t('insights.dashboard.description', {
          defaultValue:
            'Compare two signals over the selected period. Save up to four comparisons for later.',
        })}
      </Text>
      <CompareCard
        overview={overview}
        selection={current}
        onSelectionChange={setChosen}
      />
      <Pressable
        testID="save-comparison"
        accessibilityRole="button"
        accessibilityState={{ disabled: alreadySaved || isFull }}
        disabled={alreadySaved || isFull}
        onPress={() => add(first, second)}
        className={`items-center rounded-xl py-3 mb-5 ${alreadySaved || isFull ? 'bg-raised' : 'bg-accent-primary'}`}
      >
        <Text
          className={`text-sm font-semibold ${alreadySaved || isFull ? 'text-text-muted' : 'text-white'}`}
        >
          {alreadySaved
            ? t('insights.dashboard.saved', { defaultValue: 'Saved' })
            : isFull
              ? t('insights.dashboard.full', {
                  defaultValue: 'Remove a saved comparison first',
                })
              : t('insights.dashboard.save', {
                  defaultValue: 'Save comparison',
                })}
        </Text>
      </Pressable>
      {saved.length > 0 && (
        <Text className="text-text-primary text-base font-bold mb-3">
          {t('insights.dashboard.pinned', {
            defaultValue: 'Saved comparisons',
          })}
        </Text>
      )}
      {saved.map((pair) => (
        <View key={`${pair.a}-${pair.b}`}>
          <CompareCard
            overview={overview}
            selection={pair}
            readOnly
            title={`${metricLabel(t, pair.a)} · ${metricLabel(t, pair.b)}`}
            testID={`saved-comparison-${pair.a}-${pair.b}`}
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => remove(pair.a, pair.b)}
            className="self-end px-3 py-2 -mt-4 mb-4"
          >
            <Text className="text-text-secondary text-sm">
              {t('insights.dashboard.remove', {
                defaultValue: 'Remove comparison',
              })}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
};

export default AnalysisDashboard;
