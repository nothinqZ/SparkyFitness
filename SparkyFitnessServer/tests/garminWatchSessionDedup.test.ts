import { vi, beforeEach, describe, it, expect } from 'vitest';

// A strength workout logged with the SparkyFitness watch app reaches Garmin
// Connect as a recorded activity, and the next Garmin sync sees it. It must be
// linked to the watch workout, not imported as a second workout.

const { clientQuery, fakeClient } = vi.hoisted(() => {
  const clientQuery = vi.fn();
  return {
    clientQuery,
    fakeClient: { query: clientQuery, release: vi.fn() },
  };
});

vi.mock('../db/poolManager.js', () => ({
  getClient: vi.fn().mockResolvedValue(fakeClient),
}));
vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../models/exerciseEntry.js', () => ({
  default: {
    deleteExerciseEntriesByEntrySourceAndDateWithClient: vi.fn(),
    _createExerciseEntryWithClient: vi.fn(),
  },
}));
vi.mock('../models/exercisePresetEntryRepository.js', () => ({
  default: {
    deleteExercisePresetEntriesByEntrySourceAndDateWithClient: vi.fn(),
    createExercisePresetEntryWithClient: vi.fn(),
  },
}));
vi.mock('../models/workoutPresetRepository.js', () => ({
  default: { getWorkoutPresetByName: vi.fn(), createWorkoutPreset: vi.fn() },
}));
vi.mock('../models/activityDetailsRepository.js', () => ({
  default: { _createActivityDetailWithClient: vi.fn() },
}));
vi.mock('../models/workoutTelemetryRepository.js', () => ({
  _bulkInsertExerciseEntryLapsWithClient: vi.fn(),
  _bulkInsertExerciseEntryGpsPointsWithClient: vi.fn(),
  _bulkInsertExerciseEntryHrZonesWithClient: vi.fn(),
}));
vi.mock('../services/garmin/garminExerciseMapper.js', () => ({
  getOrCreateGarminExercise: vi
    .fn()
    .mockResolvedValue({ id: 'exercise-1', name: 'strength' }),
}));

import exerciseEntryRepository from '../models/exerciseEntry.js';
import activityDetailsRepository from '../models/activityDetailsRepository.js';
import { processActivitiesAndWorkouts } from '../services/garmin/garminActivityProcessor.js';

const watchRow = {
  id: 'import-1',
  client_session_id: '33333333-3333-4333-8333-333333333333',
  exercise_preset_entry_id: 'preset-entry-1',
  started_at: new Date('2026-10-20T06:00:00Z'),
  started_at_local: '2026-10-20T08:00:00',
  linked_garmin_activity_id: null,
};

const strengthActivity = {
  activity: {
    activityId: 777,
    activityName: 'Strength',
    startTimeGMT: '2026-10-20 06:01:10',
    startTimeLocal: '2026-10-20 08:01:10',
    activityType: { typeKey: 'strength_training' },
    calories: 250,
    duration: 3600,
  },
};

const unrelatedStrength = {
  activity: {
    ...strengthActivity.activity,
    activityId: 778,
    startTimeGMT: '2026-10-20 17:00:00',
    startTimeLocal: '2026-10-20 19:00:00',
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  clientQuery.mockImplementation(async (sql: string) =>
    /FROM watch_session_imports/.test(sql)
      ? { rows: [{ ...watchRow }] }
      : { rows: [] }
  );
  vi.mocked(
    exerciseEntryRepository._createExerciseEntryWithClient
  ).mockResolvedValue({ entry: { id: 'entry-1' }, operation: 'created' });
});

describe('Garmin import of watch-recorded sessions', () => {
  it('links the matching activity and imports only the unrelated one', async () => {
    const result = await processActivitiesAndWorkouts(
      'user-1',
      { activities: [strengthActivity, unrelatedStrength] },
      '2026-10-20',
      '2026-10-20',
      'UTC'
    );

    expect(result).toEqual({ processedEntries: 2 });
    // Only the unrelated activity becomes a Garmin diary entry.
    expect(
      exerciseEntryRepository._createExerciseEntryWithClient
    ).toHaveBeenCalledTimes(1);

    const statements = clientQuery.mock.calls.map((c) => String(c[0]));
    const linkCall = clientQuery.mock.calls.find((c) =>
      /SET linked_garmin_activity_id/.test(String(c[0]))
    );
    expect(linkCall?.[1]).toEqual(['user-1', 'import-1', '777']);
    expect(
      statements.some((s) =>
        /DELETE FROM exercise_entry_activity_details/.test(s)
      )
    ).toBe(true);
    expect(
      activityDetailsRepository._createActivityDetailWithClient
    ).toHaveBeenCalledWith(
      fakeClient,
      expect.objectContaining({
        exercise_preset_entry_id: 'preset-entry-1',
        provider_name: 'garmin',
        detail_type: 'linked_watch_activity',
      })
    );
    expect(statements[0]).toBe('BEGIN');
    expect(statements.at(-1)).toBe('COMMIT');
  });
});
