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
          e: 'entry-1',
          n: 'Brustpresse',
          s: [
            ['11', 12, 75, 90, 1, 10, 77.5, 'w', 0],
            ['12', 8, 100, 120, 0, null, null, null, 0],
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
    expect(message.x[0]!.s[0]).toEqual([
      '11',
      12,
      75,
      90,
      0,
      null,
      null,
      'w',
      0,
    ]);
  });
});

describe('buildGarminPlanMessage extras', () => {
  it('adds superset group, last session and the weight step when known', () => {
    const superset = {
      ...plan,
      exercises: [{ ...plan.exercises[0]!, supersetRun: 1 }],
    } as unknown as WatchWorkoutStartPayload;
    const message = buildGarminPlanMessage(superset, {
      session: {
        exercises: [
          {
            id: 'entry-1',
            exercise_id: 'ex-9',
            sets: [],
            exercise_snapshot: { equipment: ['Barbell'] },
          },
        ],
      } as never,
      prSetIds: { '12': true },
      completedSetIds: {},
      activeSetId: null,
      rest: { state: 'ready', endsAt: null } as never,
      previousSessionSets: {
        'ex-9': [
          { setNumber: 1, setType: 'warmup', reps: 12, weight: 60 },
          { setNumber: 2, setType: 'normal', reps: 8, weight: 97.5 },
        ],
      } as never,
      exerciseConfigs: {
        'entry-1': { increment_type: 'weight', increment_value: 5 },
      },
    });
    expect(message.x[0]!.s[1]![8]).toBe(1);
    expect(message.x[0]).toMatchObject({
      bb: 1,
      ss: 1,
      p: [
        [12, 60, 'w'],
        [8, 97.5, null],
      ],
      st: 5,
    });
  });

  it('leaves the extras out when there is nothing to say', () => {
    const message = buildGarminPlanMessage(plan, {
      session: null,
      completedSetIds: {},
      activeSetId: null,
      rest: { state: 'ready', endsAt: null } as never,
      exerciseConfigs: {
        'entry-1': { increment_type: 'reps', increment_value: 1 },
      },
    });
    expect(message.x[0]).not.toHaveProperty('ss');
    expect(message.x[0]).not.toHaveProperty('p');
    expect(message.x[0]).not.toHaveProperty('st');
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
    expect(
      parseGarminWatchMessage({
        t: 'add',
        sid: 's',
        e: 'entry-1',
        r: 6,
        w: 80,
        c: 'c4',
      })
    ).toEqual({
      t: 'add',
      sid: 's',
      e: 'entry-1',
      r: 6,
      w: 80,
      rpe: null,
      at: undefined,
      c: 'c4',
    });
    expect(
      parseGarminWatchMessage({ t: 'rest', sid: 's', pre: 100, re: 0, c: 'c5' })
    ).toEqual({ t: 'rest', sid: 's', pre: 100, re: 0, c: 'c5' });
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
