import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import TrainingHomeScreen from '../../src/screens/TrainingHomeScreen';
import { useWorkoutPresets } from '../../src/hooks';
import { useExerciseHistory } from '../../src/hooks/useExerciseHistory';
import { useActiveWorkoutPlans } from '../../src/hooks/useActiveWorkoutPlan';
import { initializeI18n } from '../../src/localization/i18n';

const mockStartLiveWorkout = jest.fn();

jest.mock('../../src/hooks', () => ({
  useWorkoutPresets: jest.fn(),
  useRefetchOnFocus: jest.fn(),
}));
jest.mock('../../src/hooks/useExerciseHistory', () => ({
  useExerciseHistory: jest.fn(),
}));
jest.mock('../../src/hooks/useStartLiveWorkout', () => ({
  useStartLiveWorkout: () => ({
    startLiveWorkout: mockStartLiveWorkout,
    isStarting: false,
  }),
}));
jest.mock('../../src/components/TodayReadinessCard', () => () => null);
jest.mock('../../src/hooks/useActiveWorkoutPlan', () => ({
  useActiveWorkoutPlans: jest.fn(),
}));
jest.mock('../../src/hooks/useTrainingConsistency', () => ({
  useTrainingConsistency: () => ({
    data: { weeklyStreak: { current: 6, longest: 9 } },
  }),
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));
jest.mock('../../src/utils/workoutSession', () => ({
  buildPresetStartExercisesPayload: () => [{ exercise_id: 'e1' }],
  buildPresetLiveExerciseConfigs: () => [],
}));

const preset = {
  id: 7,
  name: 'Push',
  workout_format: 'standard',
  time_cap_seconds: null,
  exercises: [
    { exercise_name: 'Bench Press' },
    { exercise_name: 'Overhead Press' },
  ],
};

const session = {
  type: 'preset',
  id: 's1',
  entry_date: '2026-10-21',
  name: 'Pull',
  total_duration_minutes: 52,
  exercises: [{ sets: [{}, {}, {}] }],
};

describe('TrainingHomeScreen', () => {
  const navigation = { navigate: jest.fn(), setOptions: jest.fn() };

  beforeAll(async () => {
    await initializeI18n('en');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useWorkoutPresets).mockReturnValue({
      presets: [preset],
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    } as never);
    jest.mocked(useActiveWorkoutPlans).mockReturnValue({
      plans: [],
      refetch: jest.fn(),
    } as never);
    jest.mocked(useExerciseHistory).mockReturnValue({
      sessions: [session],
      refetch: jest.fn(),
    } as never);
  });

  const renderScreen = () =>
    render(
      <TrainingHomeScreen
        {...({ navigation, route: { key: 'r', name: 'Dashboard' } } as never)}
      />
    );

  it('starts a routine with one tap', () => {
    const screen = renderScreen();
    expect(screen.getByText('Bench Press, Overhead Press')).toBeTruthy();
    fireEvent.press(screen.getByText('Start routine'));
    expect(mockStartLiveWorkout).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Push', sourcePresetId: 7 })
    );
  });

  it('opens the start sheet and recent workouts', () => {
    const screen = renderScreen();
    fireEvent.press(screen.getByText('Start workout'));
    expect(navigation.navigate).toHaveBeenCalledWith('PresetSearch');
    expect(screen.getByText(/52 min · 3 sets/)).toBeTruthy();
    fireEvent.press(screen.getByText('Pull'));
    expect(navigation.navigate).toHaveBeenCalledWith('WorkoutDetail', {
      session,
    });
    expect(navigation.setOptions).toHaveBeenCalledWith({ title: 'Training' });
  });

  it('offers the plan session that is due, tagged with its assignment', () => {
    jest.mocked(useActiveWorkoutPlans).mockReturnValue({
      plans: [
        {
          id: 'p1',
          plan_name: 'Torso/Limbs',
          schedule_type: 'sequential',
          next_assignment: {
            id: '42',
            workout_preset_id: '7',
            workout_preset_name: 'Torso B – Rücken-Fokus',
          },
          sequence_position: { current: 3, total: 16 },
        },
      ],
      refetch: jest.fn(),
    } as never);
    const screen = renderScreen();
    expect(screen.getByText('Up next · session 3 of 16')).toBeTruthy();
    fireEvent.press(screen.getByText('Start Torso B'));
    expect(mockStartLiveWorkout).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Torso B – Rücken-Fokus',
        workoutPlanAssignmentId: 42,
        exercises: [{ exercise_id: 'e1', workout_plan_assignment_id: 42 }],
      })
    );
    expect(screen.getByText('6')).toBeTruthy();
  });
});
