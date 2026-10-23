import type {
  ExerciseRecentSessionSet,
  PresetSessionResponse,
} from '@workspace/shared';
import {
  previousWorkingVolumeKg,
  volumeChangeByEntry,
} from '../../src/utils/workoutComparison';

const set = (
  weight: number | null,
  reps: number | null,
  setType: string | null = 'normal'
) => ({ setNumber: 1, setType, weight, reps }) as ExerciseRecentSessionSet;

describe('workout comparison', () => {
  it('sums last session working sets only', () => {
    expect(
      previousWorkingVolumeKg([set(40, 10, 'warmup'), set(80, 8), set(80, 6)])
    ).toBe(1120);
    expect(previousWorkingVolumeKg([set(null, 12)])).toBeNull();
    expect(previousWorkingVolumeKg(undefined)).toBeNull();
  });

  it('compares each entry with its exercise last time', () => {
    const session = {
      exercises: [
        { id: 'a', exercise_id: 'bench' },
        { id: 'b', exercise_id: 'pullup' },
        { id: 'c', exercise_id: 'new' },
      ],
    } as unknown as PresetSessionResponse;
    const change = volumeChangeByEntry(
      session,
      [
        { entryId: 'a', volumeKg: 1240 },
        { entryId: 'b', volumeKg: 0 },
        { entryId: 'c', volumeKg: 500 },
      ],
      { bench: [set(80, 8), set(80, 6)], pullup: [set(null, 10)] }
    );
    expect(change).toEqual({ a: 120 });
  });
});
