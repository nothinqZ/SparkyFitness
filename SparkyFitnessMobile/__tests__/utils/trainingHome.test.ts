import type { ExerciseSessionResponse } from '@workspace/shared';
import type { WorkoutPreset } from '../../src/types/workoutPresets';
import {
  presetExerciseLine,
  recentWorkouts,
  weekStart,
  weekSummary,
} from '../../src/utils/trainingHome';

const workout = (
  id: string,
  date: string,
  sets: number[],
  minutes = 60
): ExerciseSessionResponse =>
  ({
    type: 'preset',
    id,
    entry_date: date,
    name: `Workout ${id}`,
    total_duration_minutes: minutes,
    exercises: sets.map((n) => ({
      sets: Array.from({ length: n }, () => ({})),
    })),
  }) as unknown as ExerciseSessionResponse;

const run = (date: string): ExerciseSessionResponse =>
  ({
    type: 'individual',
    id: `run-${date}`,
    entry_date: date,
  }) as unknown as ExerciseSessionResponse;

describe('training home', () => {
  it('lists strength workouts only, newest first as served, with set counts', () => {
    const list = recentWorkouts(
      [
        workout('a', '2026-10-21', [3, 4]),
        run('2026-10-20'),
        workout('b', '2026-10-19', [5]),
      ],
      5
    );
    expect(list.map((w) => [w.session.id, w.sets])).toEqual([
      ['a', 7],
      ['b', 5],
    ]);
    expect(recentWorkouts([workout('a', '2026-10-21', [1])], 0)).toEqual([]);
  });

  it('starts the week on Monday', () => {
    expect(weekStart(new Date(2026, 9, 22))).toBe('2026-10-19'); // Thursday
    expect(weekStart(new Date(2026, 9, 19))).toBe('2026-10-19'); // Monday
    expect(weekStart(new Date(2026, 9, 25))).toBe('2026-10-19'); // Sunday
  });

  it('sums this week since Monday', () => {
    const summary = weekSummary(
      [
        workout('a', '2026-10-21', [3, 4], 55.4),
        workout('b', '2026-10-19', [5], 40),
        workout('c', '2026-10-18', [9], 70),
        run('2026-10-20'),
      ],
      new Date(2026, 9, 22)
    );
    expect(summary).toEqual({ workouts: 2, sets: 12, minutes: 95 });
  });

  it('previews a routine by its first exercises', () => {
    const preset = {
      exercises: ['Bench', 'Row', 'Squat', 'Curl', 'Dip'].map((n) => ({
        exercise_name: n,
      })),
    } as unknown as WorkoutPreset;
    expect(presetExerciseLine(preset)).toBe('Bench, Row, Squat +2');
    expect(presetExerciseLine(preset, 5)).toBe('Bench, Row, Squat, Curl, Dip');
  });
});
