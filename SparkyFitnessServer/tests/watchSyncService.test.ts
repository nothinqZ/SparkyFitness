import { vi, beforeEach, describe, expect, it } from 'vitest';
import type { WatchSessionUpload } from '@workspace/shared';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../services/exerciseService.js', () => ({
  default: { createGroupedWorkoutSession: vi.fn() },
}));
vi.mock('../models/workoutPresetRepository.js', () => ({
  default: { getWorkoutPresets: vi.fn(), getWorkoutPresetById: vi.fn() },
}));
vi.mock('../models/workoutPlanTemplateRepository.js', () => ({
  default: { getActiveWorkoutPlanForDate: vi.fn() },
}));
vi.mock('../models/preferenceRepository.js', () => ({
  default: { getUserPreferences: vi.fn() },
}));
vi.mock('../models/watchSessionImportRepository.js', () => ({
  default: {
    claimWatchSession: vi.fn(),
    getWatchSessionByClientId: vi.fn(),
    attachPresetEntry: vi.fn(),
    releaseClaim: vi.fn(),
    getPreviousPerformance: vi.fn(),
    getSyncStatus: vi.fn(),
  },
}));

import exerciseService from '../services/exerciseService.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import workoutPlanTemplateRepository from '../models/workoutPlanTemplateRepository.js';
import preferenceRepository from '../models/preferenceRepository.js';
import watchRepo from '../models/watchSessionImportRepository.js';
import watchSyncService, {
  WATCH_SESSION_SOURCE,
  hashSessionPayload,
  scheduledPresetIds,
} from '../services/watchSyncService.js';

const EX_SQUAT = '11111111-1111-4111-8111-111111111111';
const EX_BENCH = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';
const ENTRY_ID = '44444444-4444-4444-8444-444444444444';

const upload = (
  overrides: Partial<WatchSessionUpload> = {}
): WatchSessionUpload => ({
  client_session_id: SESSION_ID,
  device_id: 'fenix-1',
  device_model: 'fenix7',
  app_version: '0.1.0',
  workout_preset_id: 7,
  name: 'Push Day',
  entry_date: '2026-10-20',
  started_at: '2026-10-20T06:00:00.000Z',
  ended_at: '2026-10-20T07:00:00.000Z',
  started_at_local: '2026-10-20T08:00:00',
  exercises: [
    {
      exercise_id: EX_SQUAT,
      sort_order: 0,
      sets: [
        { set_number: 1, reps: 5, weight: 100, rpe: 8 },
        { set_number: 2, reps: 5, weight: 100 },
        { set_number: 3, reps: 5, weight: 100 },
      ],
    },
    {
      exercise_id: EX_BENCH,
      sort_order: 1,
      sets: [{ set_number: 1, reps: 8, weight: 60 }],
    },
  ],
  ...overrides,
});

const claimRow = { id: 'claim-1', exercise_preset_entry_id: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('importSession', () => {
  it('creates the workout with watch provenance on first upload', async () => {
    vi.mocked(watchRepo.claimWatchSession).mockResolvedValue(claimRow as never);
    vi.mocked(exerciseService.createGroupedWorkoutSession).mockResolvedValue({
      id: ENTRY_ID,
    } as never);

    const result = await watchSyncService.importSession('u1', 'u1', upload());

    expect(result).toEqual({
      status: 'created',
      client_session_id: SESSION_ID,
      exercise_preset_entry_id: ENTRY_ID,
    });
    const [, , payload] = vi.mocked(exerciseService.createGroupedWorkoutSession)
      .mock.calls[0]!;
    expect(payload).toMatchObject({
      workout_preset_id: 7,
      source: WATCH_SESSION_SOURCE,
      entry_date: '2026-10-20',
    });
    // 60 minutes spread 3:1 by set count.
    expect(payload.exercises[0].duration_minutes).toBe(45);
    expect(payload.exercises[1].duration_minutes).toBe(15);
    expect(payload.exercises[0].entry_time).toBe('08:00');
    expect(payload.exercises[0].sets[0]).toMatchObject({
      reps: 5,
      weight: 100,
      rpe: 8,
      set_type: 'Working Set',
    });
    expect(watchRepo.attachPresetEntry).toHaveBeenCalledWith(
      'u1',
      'claim-1',
      ENTRY_ID
    );
  });

  it('answers a retried identical upload as duplicate without creating anything', async () => {
    vi.mocked(watchRepo.claimWatchSession).mockResolvedValue(null);
    vi.mocked(watchRepo.getWatchSessionByClientId).mockResolvedValue({
      payload_sha256: hashSessionPayload(upload()),
      exercise_preset_entry_id: ENTRY_ID,
    } as never);

    const result = await watchSyncService.importSession('u1', 'u1', upload());

    expect(result.status).toBe('duplicate');
    expect(result.exercise_preset_entry_id).toBe(ENTRY_ID);
    expect(exerciseService.createGroupedWorkoutSession).not.toHaveBeenCalled();
  });

  it('refuses a reused session id with different content (409)', async () => {
    vi.mocked(watchRepo.claimWatchSession).mockResolvedValue(null);
    vi.mocked(watchRepo.getWatchSessionByClientId).mockResolvedValue({
      payload_sha256: hashSessionPayload(upload({ name: 'Other' })),
      exercise_preset_entry_id: ENTRY_ID,
    } as never);

    await expect(
      watchSyncService.importSession('u1', 'u1', upload())
    ).rejects.toMatchObject({ status: 409 });
  });

  it('releases the claim when creating the workout fails, so a retry can succeed', async () => {
    vi.mocked(watchRepo.claimWatchSession).mockResolvedValue(claimRow as never);
    vi.mocked(watchRepo.releaseClaim).mockResolvedValue(undefined);
    vi.mocked(exerciseService.createGroupedWorkoutSession).mockRejectedValue(
      new Error('db down')
    );

    await expect(
      watchSyncService.importSession('u1', 'u1', upload())
    ).rejects.toThrow('db down');
    expect(watchRepo.releaseClaim).toHaveBeenCalledWith('u1', 'claim-1');
  });
});

describe('hashSessionPayload', () => {
  it('ignores key order and app version, but not content', () => {
    const a = upload();
    const reordered = {
      ...Object.fromEntries(Object.entries(a).reverse()),
      app_version: '9.9.9',
    } as WatchSessionUpload;
    expect(hashSessionPayload(reordered)).toBe(hashSessionPayload(a));
    expect(hashSessionPayload(upload({ name: 'Pull Day' }))).not.toBe(
      hashSessionPayload(a)
    );
  });
});

describe('scheduledPresetIds', () => {
  it('uses weekdays for weekly plans and next assignments for sequential ones', () => {
    const plans = [
      {
        id: 1,
        schedule_type: 'weekly' as const,
        // 2026-10-20 is a Tuesday (2).
        assignments: [
          { id: 1, day_of_week: 2, workout_preset_id: 10 },
          { id: 2, day_of_week: 3, workout_preset_id: 11 },
        ],
      },
      {
        id: 2,
        schedule_type: 'sequential' as const,
        next_assignments: [{ id: 3, workout_preset_id: 12 }],
      },
    ];
    expect(scheduledPresetIds(plans, '2026-10-20', true)).toEqual([10, 12]);
    expect(scheduledPresetIds(plans, '2026-10-21', false)).toEqual([11]);
  });
});

describe('buildManifest', () => {
  it('lists scheduled presets first with previous performance and unit', async () => {
    vi.mocked(
      workoutPlanTemplateRepository.getActiveWorkoutPlanForDate
    ).mockImplementation(async (_u, date) =>
      date === '2026-10-22'
        ? ([
            {
              id: 1,
              schedule_type: 'weekly',
              assignments: [{ id: 1, day_of_week: 4, workout_preset_id: 2 }],
            },
          ] as never)
        : ([] as never)
    );
    vi.mocked(workoutPresetRepository.getWorkoutPresets).mockResolvedValue({
      presets: [
        {
          id: 1,
          name: 'A Upper',
          exercises: [
            {
              exercise_id: EX_BENCH,
              exercise_name: 'Bench Press',
              sets: [
                { set_number: 1, reps: 8, weight: '60.00', rest_time: 120 },
              ],
            },
          ],
        },
        {
          id: 2,
          name: 'B Lower',
          exercises: [
            {
              exercise_id: EX_SQUAT,
              exercise_name: 'Squat',
              sets: [{ set_number: 1, reps: 5 }],
            },
          ],
        },
        { id: 3, name: 'Empty', exercises: [] },
      ],
    } as never);
    vi.mocked(watchRepo.getPreviousPerformance).mockResolvedValue([
      {
        exercise_id: EX_SQUAT,
        entry_date: '2026-10-15',
        set_number: 1,
        reps: 5,
        weight: '95.00',
      },
    ]);
    vi.mocked(preferenceRepository.getUserPreferences).mockResolvedValue({
      default_weight_unit: 'kg',
    } as never);

    const manifest = await watchSyncService.buildManifest('u1', '2026-10-20');

    expect(manifest.weight_unit).toBe('kg');
    expect(manifest.workouts.map((w) => w.name)).toEqual([
      'B Lower',
      'A Upper',
    ]);
    expect(manifest.workouts[0]!.scheduled_date).toBe('2026-10-22');
    expect(manifest.workouts[0]!.exercises[0]!.previous).toEqual({
      entry_date: '2026-10-15',
      sets: [{ set_number: 1, reps: 5, weight: 95 }],
    });
    expect(manifest.workouts[1]!.exercises[0]!.sets[0]).toMatchObject({
      weight: 60,
      rest_time: 120,
    });
  });
});
