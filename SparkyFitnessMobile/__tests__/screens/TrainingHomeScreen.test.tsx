import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import TrainingHomeScreen from '../../src/screens/TrainingHomeScreen';
import { useWorkoutPresets } from '../../src/hooks';
import { useExerciseHistory } from '../../src/hooks/useExerciseHistory';
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
jest.mock('../../src/components/PerformanceTodayCard', () => () => null);
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
});
