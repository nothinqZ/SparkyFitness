import type { WatchWorkoutStartPayload } from '../../modules/watch-connectivity';
import {
  buildGarminPlanMessage,
  parseGarminWatchMessage,
} from '../../src/utils/garminWatchPlan';

const plan = {
  sessionId: 'session-1',
  workoutName: 'Torso A',
  exercises: [
    {
      exerciseEntryId: 'entry-1',
      name: 'Brustpresse',
      supersetRun: null,
      bodyweight: false,
      sets: [
        {
          setId: '11',
          targetReps: 12,
          targetWeightKg: 75,
          restSeconds: 90,
          setType: 'warmup',
        },
        {
          setId: '12',
          targetReps: 8,
          targetWeightKg: 100,
          restSeconds: 120,
          setType: 'normal',
        },
      ],
    },
  ],
  setOrder: ['11', '12'],
} as unknown as WatchWorkoutStartPayload;

describe('buildGarminPlanMessage', () => {
  it('sends targets, done sets with their logged values and the running rest', () => {
    const message = buildGarminPlanMessage(plan, {
      session: {
        exercises: [
          {
            sets: [
              { id: 11, reps: 10, weight: 77.5 },
              { id: 12, reps: null, weight: null },
            ],
          },
        ],
      } as never,
      completedSetIds: { '11': 1_700_000_000_000 },
      activeSetId: '12',
      rest: { state: 'resting', endsAt: 1_700_000_090_400 } as never,
    });

    expect(message).toEqual({
      t: 'plan',
      sid: 'session-1',
      n: 'Torso A',
      x: [
        {
          n: 'Brustpresse',
          s: [
            ['11', 12, 75, 90, 1, 10, 77.5],
            ['12', 8, 100, 120, 0, null, null],
          ],
        },
      ],
      a: '12',
      re: 1_700_000_090,
    });
  });

  it('sends no rest deadline when not resting', () => {
    const message = buildGarminPlanMessage(plan, {
      session: null,
      completedSetIds: {},
      activeSetId: '11',
      rest: { state: 'paused', endsAt: null } as never,
    });
    expect(message.re).toBeNull();
    expect(message.x[0]!.s[0]).toEqual(['11', 12, 75, 90, 0, null, null]);
  });
});

describe('parseGarminWatchMessage', () => {
  it('accepts the watch messages and normalises numbers and ids', () => {
    expect(parseGarminWatchMessage({ t: 'hello' })).toEqual({ t: 'hello' });
    expect(
      parseGarminWatchMessage({
        t: 'set',
        sid: 's',
        id: 12,
        r: 8,
        w: 100.0,
        at: 5,
        c: 'c1',
      })
    ).toEqual({
      t: 'set',
      sid: 's',
      id: '12',
      r: 8,
      w: 100,
      rpe: null,
      at: 5,
      c: 'c1',
    });
    expect(parseGarminWatchMessage({ t: 'start', p: '17', c: 'c2' })).toEqual({
      t: 'start',
      p: 17,
      at: undefined,
      c: 'c2',
    });
    expect(parseGarminWatchMessage({ t: 'finish', sid: 's', c: 'c3' })).toEqual(
      {
        t: 'finish',
        sid: 's',
        c: 'c3',
      }
    );
  });

  it('rejects anything malformed', () => {
    expect(parseGarminWatchMessage(null)).toBeNull();
    expect(parseGarminWatchMessage('hello')).toBeNull();
    expect(parseGarminWatchMessage({ t: 'delete' })).toBeNull();
    expect(parseGarminWatchMessage({ t: 'set', sid: 's', id: 1 })).toBeNull();
    expect(parseGarminWatchMessage({ t: 'start', p: 'x', c: 'c' })).toBeNull();
    expect(parseGarminWatchMessage({ t: 'finish', c: 'c' })).toBeNull();
  });
});
