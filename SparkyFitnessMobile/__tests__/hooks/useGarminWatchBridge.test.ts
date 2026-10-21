import {
  applyGarminSet,
  finishFromGarmin,
} from '../../src/hooks/useGarminWatchBridge';
import { saveActiveWorkoutSession } from '../../src/hooks/useActiveWorkoutAutosave';
import { useActiveWorkoutStore } from '../../src/stores/activeWorkoutStore';
import { buildWorkoutCelebration } from '../../src/utils/workoutCelebration';

jest.mock('../../src/hooks/useActiveWorkoutAutosave', () => ({
  saveActiveWorkoutSession: jest.fn(),
}));
jest.mock('../../src/utils/workoutCelebration', () => ({
  buildWorkoutCelebration: jest.fn(),
}));
jest.mock('../../src/stores/activeWorkoutStore', () => ({
  useActiveWorkoutStore: { getState: jest.fn() },
}));
jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));

const actions = {
  updateSetField: jest.fn(),
  completeSet: jest.fn(),
  clearWorkout: jest.fn(),
};
const liveState = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'session-1',
  startedAt: Date.now() - 60 * 60_000,
  steps: [{ setId: '11' }, { setId: '12' }],
  completedSetIds: {},
  ...actions,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(saveActiveWorkoutSession).mockResolvedValue('saved');
  jest
    .mocked(useActiveWorkoutStore.getState)
    .mockReturnValue(liveState() as never);
});

describe('applyGarminSet', () => {
  it('writes the watch values, completes the set and saves at once', async () => {
    const loggedAt = Math.floor((Date.now() - 5 * 60_000) / 1000) * 1000;
    await applyGarminSet({
      t: 'set',
      sid: 'session-1',
      id: '12',
      r: 8,
      w: 102.5,
      rpe: 8,
      at: loggedAt / 1000,
      c: 'c1',
    });
    expect(actions.updateSetField).toHaveBeenCalledWith('12', {
      reps: 8,
      weight: 102.5,
      rpe: 8,
    });
    expect(actions.completeSet).toHaveBeenCalledWith('12', loggedAt);
    expect(saveActiveWorkoutSession).toHaveBeenCalled();
  });

  it('ignores sets for another session, unknown sets and done sets', async () => {
    await applyGarminSet({ t: 'set', sid: 'other', id: '12', c: 'c' });
    await applyGarminSet({ t: 'set', sid: 'session-1', id: '99', c: 'c' });
    jest
      .mocked(useActiveWorkoutStore.getState)
      .mockReturnValue(liveState({ completedSetIds: { '12': 1 } }) as never);
    await applyGarminSet({
      t: 'set',
      sid: 'session-1',
      id: '12',
      r: 5,
      c: 'c',
    });
    expect(actions.completeSet).not.toHaveBeenCalled();
    expect(actions.updateSetField).not.toHaveBeenCalled();
    expect(saveActiveWorkoutSession).not.toHaveBeenCalled();
  });
});

describe('finishFromGarmin', () => {
  it('saves, snapshots the completion screen and clears', async () => {
    jest.mocked(buildWorkoutCelebration).mockReturnValue({ id: 'c' } as never);
    await expect(finishFromGarmin('session-1')).resolves.toEqual({ id: 'c' });
    expect(actions.clearWorkout).toHaveBeenCalled();
  });

  it('keeps the workout open when the save fails, and ignores other sessions', async () => {
    jest.mocked(saveActiveWorkoutSession).mockResolvedValue('failed');
    await expect(finishFromGarmin('session-1')).resolves.toBeUndefined();
    await expect(finishFromGarmin('other')).resolves.toBeUndefined();
    expect(actions.clearWorkout).not.toHaveBeenCalled();
  });
});
