import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text, View } from 'react-native';
import { useCSSVariable } from 'uniwind';
import type { FitnessFinding } from '@workspace/shared';

import { useInsightsToday } from '../hooks/useInsights';
import { formatLocalizedDate } from '../utils/insightDates';
import { findingKindLabel, findingText } from '../utils/insightText';

/** Accent for a finding: caution orange, positive green, neutral muted. */
export function useFindingColor(): (finding: FitnessFinding) => string {
  const [caution, positive, neutral] = useCSSVariable([
    '--color-cat-orange',
    '--color-icon-success',
    '--color-text-secondary',
  ]) as [string, string, string];
  return (finding) =>
    finding.tone === 'caution'
      ? caution
      : finding.tone === 'positive'
        ? positive
        : neutral;
}

/**
 * "Today": the most important finding of the deterministic insight rules
 * (shared/src/analytics/insights.ts), with up to two more, and the AI-worded
 * summary when the user has an AI service. Tapping opens Insights.
 * Renders nothing when there is nothing worth saying.
 */
const TodayInsightCard: React.FC<{ onPress: () => void }> = ({ onPress }) => {
  const { t } = useTranslation();
  const { data } = useInsightsToday();
  const color = useFindingColor();
  if (!data || data.findings.length === 0) return null;
  const [top, ...rest] = data.findings;
  const main = findingText(t, top!);

  return (
    <Pressable
      testID="today-insight-card"
      accessibilityRole="button"
      onPress={onPress}
      className="bg-surface rounded-2xl border border-border-subtle p-5 mb-3 active:opacity-80"
    >
      <View className="flex-row justify-between items-center mb-2">
        <Text className="text-text-secondary text-xs font-bold uppercase tracking-wide">
          {t('insights.today.title', { defaultValue: 'What matters today' })}
        </Text>
        <Text className="text-text-muted text-xs">
          {t('insights.today.dataThrough', {
            defaultValue: 'Data through {{date}}',
            date: formatLocalizedDate(data.dataThrough),
          })}
        </Text>
      </View>

      <View className="flex-row items-start">
        <View
          className="w-1 rounded-full mr-3 self-stretch"
          style={{ backgroundColor: color(top!) }}
        />
        <View className="flex-1">
          <Text
            className="text-xs font-semibold mb-0.5"
            style={{ color: color(top!) }}
          >
            {findingKindLabel(t, top!.kind)}
          </Text>
          <Text className="text-text-primary text-xl font-bold leading-7">
            {main.title}
          </Text>
          {main.detail !== '' && (
            <Text className="text-text-secondary text-sm mt-0.5">
              {main.detail}
            </Text>
          )}
        </View>
      </View>

      {data.summary && (
        <View className="mt-4 bg-raised rounded-xl p-3">
          <Text className="text-text-primary text-sm">{data.summary.text}</Text>
          <Text className="text-text-muted text-xs mt-1">
            {t('insights.today.aiWorded', {
              defaultValue: 'Worded by your AI service from the findings above',
            })}
          </Text>
        </View>
      )}

      {rest.slice(0, 2).map((finding) => (
        <View
          key={finding.id + JSON.stringify(finding.params)}
          className="flex-row items-center mt-2"
        >
          <View
            className="w-2 h-2 rounded-full mr-2"
            style={{ backgroundColor: color(finding) }}
          />
          <Text
            className="flex-1 text-text-secondary text-sm"
            numberOfLines={1}
          >
            {findingText(t, finding).title}
          </Text>
        </View>
      ))}
    </Pressable>
  );
};

export default TodayInsightCard;
