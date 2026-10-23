import type { ExerciseSessionResponse } from '@workspace/shared';
import type { WorkoutPreset } from '../../src/types/workoutPresets';
import {
  nextPlanSession,
  presetExerciseLine,
  shortRoutineName,
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

describe('next plan session', () => {
  const presets = [{ id: 7, name: 'Torso B – Rücken', exercises: [] }];
  it('takes the session a sequential plan is on', () => {
    const next = nextPlanSession(
      [
        {
          schedule_type: 'weekly',
          next_assignment: { workout_preset_id: '7' },
        },
        {
          schedule_type: 'sequential',
          next_assignment: { id: '42', workout_preset_id: '7' },
          sequence_position: { current: 3, total: 16 },
        },
      ] as never,
      presets as never
    );
    expect(next?.name).toBe('Torso B – Rücken');
    expect(next?.position).toEqual({ current: 3, total: 16 });
    expect(nextPlanSession([], presets as never)).toBeNull();
  });

  it('shortens a routine name for a sentence', () => {
    expect(shortRoutineName('Torso B – Schulter-/Rücken-Fokus')).toBe(
      'Torso B'
    );
    expect(shortRoutineName('OK A - Brust-Priorität')).toBe('OK A');
    expect(shortRoutineName('Push')).toBe('Push');
  });
});
