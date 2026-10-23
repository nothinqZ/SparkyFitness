import {
  applyGarminAdd,
  applyGarminRest,
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
  addSetToExercise: jest.fn(),
  adjustRest: jest.fn(),
  dismissRest: jest.fn(),
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

  it('applies a correction to a done set without completing it again', async () => {
    jest
      .mocked(useActiveWorkoutStore.getState)
      .mockReturnValue(liveState({ completedSetIds: { '12': 1 } }) as never);
    await applyGarminSet({
      t: 'set',
      sid: 'session-1',
      id: '12',
      r: 6,
      w: 100,
      fix: true,
      c: 'fix-1',
    });
    expect(actions.updateSetField).toHaveBeenCalledWith('12', {
      reps: 6,
      weight: 100,
    });
    expect(actions.completeSet).not.toHaveBeenCalled();
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

describe('applyGarminAdd', () => {
  it('adds a set to the exercise and completes it with the watch values', async () => {
    const before = liveState({
      session: { exercises: [{ id: 'entry-1', sets: [{ id: 11 }] }] },
    });
    const after = liveState({
      session: {
        exercises: [{ id: 'entry-1', sets: [{ id: 11 }, { id: -1 }] }],
      },
      steps: [{ setId: '11' }, { setId: '-1' }],
    });
    jest
      .mocked(useActiveWorkoutStore.getState)
      .mockReturnValueOnce(before as never)
      .mockReturnValue(after as never);
    await applyGarminAdd({
      t: 'add',
      sid: 'session-1',
      e: 'entry-1',
      r: 6,
      w: 80,
      c: 'c',
    });
    expect(actions.addSetToExercise).toHaveBeenCalledWith('entry-1');
    expect(actions.updateSetField).toHaveBeenCalledWith('-1', {
      reps: 6,
      weight: 80,
    });
    expect(actions.completeSet).toHaveBeenCalledWith('-1', undefined);
  });

  it('ignores unknown exercises and other sessions', async () => {
    jest
      .mocked(useActiveWorkoutStore.getState)
      .mockReturnValue(liveState({ session: { exercises: [] } }) as never);
    await applyGarminAdd({ t: 'add', sid: 'session-1', e: 'nope', c: 'c' });
    await applyGarminAdd({ t: 'add', sid: 'other', e: 'nope', c: 'c' });
    expect(actions.addSetToExercise).not.toHaveBeenCalled();
  });
});

describe('applyGarminRest', () => {
  const resting = (endsAtMs: number) =>
    liveState({ rest: { state: 'resting', endsAt: endsAtMs } });

  it('moves or skips the phone rest the watch saw', () => {
    jest
      .mocked(useActiveWorkoutStore.getState)
      .mockReturnValue(resting(100_000) as never);
    applyGarminRest({ t: 'rest', sid: 'session-1', pre: 100, re: 115, c: 'c' });
    expect(actions.adjustRest).toHaveBeenCalledWith(15);
    applyGarminRest({ t: 'rest', sid: 'session-1', pre: 100, re: 0, c: 'c' });
    expect(actions.dismissRest).toHaveBeenCalled();
  });

  it('leaves a different rest alone', () => {
    jest
      .mocked(useActiveWorkoutStore.getState)
      .mockReturnValue(resting(200_000) as never);
    applyGarminRest({ t: 'rest', sid: 'session-1', pre: 100, re: 115, c: 'c' });
    expect(actions.adjustRest).not.toHaveBeenCalled();
    expect(actions.dismissRest).not.toHaveBeenCalled();
  });
});
