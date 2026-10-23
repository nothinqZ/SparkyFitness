import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { PresetSessionResponse } from '@workspace/shared';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import TodayReadinessCard from '../components/TodayReadinessCard';
import Button from '../components/ui/Button';
import { useWorkoutPresets, useRefetchOnFocus } from '../hooks';
import { useActiveWorkoutPlans } from '../hooks/useActiveWorkoutPlan';
import { useExerciseHistory } from '../hooks/useExerciseHistory';
import { useTrainingConsistency } from '../hooks/useTrainingConsistency';
import { useStartLiveWorkout } from '../hooks/useStartLiveWorkout';
import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import { formatLocalizedNumber } from '../localization';
import type { TabParamList, RootStackParamList } from '../types/navigation';
import type { WorkoutPreset } from '../types/workoutPresets';
import { formatLocalizedDate } from '../utils/insightDates';
import {
  buildPresetLiveExerciseConfigs,
  buildPresetStartExercisesPayload,
} from '../utils/workoutSession';
import {
  nextPlanSession,
  recentWorkouts,
  shortRoutineName,
  weekSummary,
  presetExerciseLine,
  type NextPlanSession,
} from '../utils/trainingHome';

type Props = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, 'Dashboard'>,
  NativeStackScreenProps<RootStackParamList>
>;

const ROUTINES_SHOWN = 6;

/**
 * Training-first home of the personal build, modelled on Hevy: today's
 * readiness in one card (as Garmin Connect's morning report), one button to
 * start, routines as cards that start with a tap, and the last workouts.
 * Nutrition and the other daily trackers stay in the official app.
 */
const TrainingHomeScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const padding = useActiveWorkoutBarPadding();
  const activeSessionId = useActiveWorkoutStore((s) => s.sessionId);
  const { presets, isLoading: presetsLoading, refetch } = useWorkoutPresets();
  const { sessions, refetch: refetchHistory } = useExerciseHistory();
  const { plans, refetch: refetchPlans } = useActiveWorkoutPlans();
  const { data: consistency } = useTrainingConsistency();
  const streak = consistency?.weeklyStreak.current ?? 0;
  const { startLiveWorkout, isStarting } = useStartLiveWorkout(navigation);
  const [refreshing, setRefreshing] = React.useState(false);

  useRefetchOnFocus(refetch, true);

  React.useLayoutEffect(() => {
    const title = t('navigation.training', { defaultValue: 'Training' });
    navigation.setOptions({ title });
  }, [navigation, t]);

  const recent = useMemo(() => recentWorkouts(sessions, 5), [sessions]);
  const week = useMemo(() => weekSummary(sessions, new Date()), [sessions]);
  const next = useMemo(() => nextPlanSession(plans, presets), [plans, presets]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([refetch(), refetchHistory(), refetchPlans()]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchHistory, refetchPlans]);

  const startPreset = useCallback(
    (preset: WorkoutPreset) => {
      void startLiveWorkout({
        name: preset.name,
        exercises: buildPresetStartExercisesPayload(preset),
        exerciseConfigs: buildPresetLiveExerciseConfigs(preset),
        sourcePresetId: preset.id,
        workoutFormat: preset.workout_format ?? 'standard',
        timeCapSeconds: preset.time_cap_seconds ?? null,
      });
    },
    [startLiveWorkout]
  );

  // A plan session starts like its routine, tagged with the plan
  // assignment so Sparky moves the plan on to the next session.
  const startPlanSession = useCallback(
    (session: NextPlanSession) => {
      const assignmentId = Number(session.assignment.id);
      void startLiveWorkout({
        name: session.name,
        exercises: buildPresetStartExercisesPayload(session.preset).map(
          (exercise) => ({
            ...exercise,
            workout_plan_assignment_id: assignmentId,
          })
        ),
        exerciseConfigs: buildPresetLiveExerciseConfigs(session.preset),
        sourcePresetId: session.preset.id,
        workoutPlanAssignmentId: assignmentId,
        workoutFormat: session.preset.workout_format ?? 'standard',
        timeCapSeconds: session.preset.time_cap_seconds ?? null,
      });
    },
    [startLiveWorkout]
  );

  const openSession = useCallback(
    (session: PresetSessionResponse) => {
      navigation.navigate('WorkoutDetail', { session });
    },
    [navigation]
  );

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 24 + padding }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      <TodayReadinessCard
        nextRoutine={next ? shortRoutineName(next.name) : null}
        onPress={() => navigation.navigate('Performance')}
      />

      {activeSessionId !== null ? (
        <Button
          variant="primary"
          className="mb-4"
          onPress={() => navigation.navigate('ActiveWorkout')}
        >
          {t('trainingHome.resume', { defaultValue: 'Resume workout' })}
        </Button>
      ) : next ? (
        <View className="bg-surface rounded-2xl p-4 mb-4" testID="next-up-card">
          <Text className="text-text-secondary text-xs">
            {next.position
              ? t('trainingHome.nextUpPosition', {
                  defaultValue: 'Up next · session {{current}} of {{total}}',
                  current: next.position.current,
                  total: next.position.total,
                })
              : t('trainingHome.nextUp', { defaultValue: 'Up next' })}
          </Text>
          <Text className="text-text-primary text-lg font-semibold mt-0.5">
            {next.name}
          </Text>
          <Text className="text-text-muted text-sm" numberOfLines={2}>
            {presetExerciseLine(next.preset)}
          </Text>
          <Button
            variant="primary"
            className="mt-3"
            disabled={isStarting}
            onPress={() => startPlanSession(next)}
          >
            {t('trainingHome.startNamed', {
              defaultValue: 'Start {{name}}',
              name: shortRoutineName(next.name),
            })}
          </Button>
          <Pressable
            accessibilityRole="button"
            className="items-center pt-3"
            onPress={() => navigation.navigate('PresetSearch')}
          >
            <Text className="text-accent-primary text-sm">
              {t('trainingHome.other', { defaultValue: 'Other workout' })}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Button
          variant="primary"
          className="mb-4"
          disabled={isStarting}
          onPress={() => navigation.navigate('PresetSearch')}
        >
          {t('trainingHome.start', { defaultValue: 'Start workout' })}
        </Button>
      )}

      <SectionTitle
        title={t('trainingHome.thisWeek', { defaultValue: 'This week' })}
        action={t('trainingHome.progress', { defaultValue: 'Progress' })}
        onAction={() => navigation.navigate('ExerciseStatistics')}
      />
      <Pressable
        accessibilityRole="button"
        onPress={() => navigation.navigate('ExerciseStatistics')}
        className="flex-row justify-between bg-surface rounded-xl p-4 mb-4"
        testID="training-home-week"
      >
        <WeekStat
          label={t('trainingHome.weekWorkouts', {
            defaultValue: 'Workouts',
          })}
          value={formatLocalizedNumber(week.workouts)}
        />
        <WeekStat
          label={t('trainingHome.weekSets', { defaultValue: 'Sets' })}
          value={formatLocalizedNumber(week.sets)}
        />
        <WeekStat
          label={t('trainingHome.weekStreak', { defaultValue: 'Week streak' })}
          value={formatLocalizedNumber(streak)}
        />
      </Pressable>

      <SectionTitle
        title={t('trainingHome.routines', { defaultValue: 'Routines' })}
        action={t('trainingHome.allRoutines', { defaultValue: 'All' })}
        onAction={() => navigation.navigate('WorkoutPresetsLibrary')}
      />
      {presetsLoading ? (
        <ActivityIndicator className="my-4" />
      ) : presets.length === 0 ? (
        <Text className="text-text-muted text-sm mb-4">
          {t('trainingHome.noRoutines', {
            defaultValue:
              'No routines yet. Create one under All, then start it here with one tap.',
          })}
        </Text>
      ) : (
        <View className="gap-3 mb-4">
          {presets.slice(0, ROUTINES_SHOWN).map((preset) => (
            <View
              key={preset.id}
              className="bg-surface rounded-xl p-4"
              testID="training-home-routine"
            >
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  navigation.navigate('WorkoutPresetDetail', { preset })
                }
              >
                <Text className="text-text-primary text-base font-semibold">
                  {preset.name}
                </Text>
                <Text
                  className="text-text-muted text-sm mt-0.5"
                  numberOfLines={2}
                >
                  {presetExerciseLine(preset)}
                </Text>
              </Pressable>
              <Button
                variant="secondary"
                className="mt-3"
                disabled={isStarting || activeSessionId !== null}
                onPress={() => startPreset(preset)}
              >
                {t('trainingHome.startRoutine', {
                  defaultValue: 'Start routine',
                })}
              </Button>
            </View>
          ))}
        </View>
      )}

      <SectionTitle
        title={t('trainingHome.recent', { defaultValue: 'Recent workouts' })}
      />
      {recent.length === 0 ? (
        <Text className="text-text-muted text-sm">
          {t('trainingHome.noRecent', {
            defaultValue: 'Your finished workouts show up here.',
          })}
        </Text>
      ) : (
        <View className="bg-surface rounded-xl">
          {recent.map((w, i) => (
            <Pressable
              key={w.session.id}
              accessibilityRole="button"
              testID="training-home-recent"
              onPress={() => openSession(w.session)}
              className={`px-4 py-3 ${i < recent.length - 1 ? 'border-b border-border-subtle' : ''}`}
            >
              <Text className="text-text-primary text-base font-semibold">
                {w.session.name}
              </Text>
              <Text className="text-text-muted text-sm mt-0.5">
                {[
                  w.session.entry_date
                    ? formatLocalizedDate(w.session.entry_date, {
                        weekday: 'short',
                        day: 'numeric',
                        month: 'short',
                      })
                    : null,
                  t('trainingHome.minutes', {
                    defaultValue: '{{count}} min',
                    count: Math.round(w.session.total_duration_minutes),
                  }),
                  t('trainingHome.sets', {
                    defaultValue: '{{count}} sets',
                    count: w.sets,
                  }),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const WeekStat: React.FC<{ label: string; value: string }> = ({
  label,
  value,
}) => (
  <View className="flex-1 items-center">
    <Text className="text-text-primary text-xl font-semibold">{value}</Text>
    <Text className="text-text-muted text-xs text-center">{label}</Text>
  </View>
);

const SectionTitle: React.FC<{
  title: string;
  action?: string;
  onAction?: () => void;
}> = ({ title, action, onAction }) => (
  <View className="flex-row items-center justify-between mb-2">
    <Text className="text-text-primary text-lg font-semibold">{title}</Text>
    {action && onAction ? (
      <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8}>
        <Text className="text-accent-primary text-sm">{action}</Text>
      </Pressable>
    ) : null}
  </View>
);

export default TrainingHomeScreen;
