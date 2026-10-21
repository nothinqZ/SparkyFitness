import type { WatchWorkoutStartPayload } from '../../modules/watch-connectivity';
import type { ActiveWorkoutState } from '../stores/activeWorkoutStore';

/**
 * Messages between the phone and the Sparky Strength Connect IQ watch app,
 * sent over Bluetooth by the Connect IQ Mobile SDK (`modules/garmin-connectiq`).
 * Keys are short because every message crosses a slow BLE link and is parsed
 * in the watch's small memory. Weights are kilograms; times are epoch seconds.
 * The watch side is SparkyFitnessConnectIQ/source/PhoneLink.mc.
 */

/**
 * One set: [setId, targetReps, targetWeightKg, restSeconds, done (0/1),
 * reps, weightKg]. The last two are the logged values of a done set.
 */
export type GarminPlanSet = [
  string,
  number | null,
  number | null,
  number,
  0 | 1,
  number | null,
  number | null,
];

export interface GarminPlanMessage {
  t: 'plan';
  /** Live session id; the watch reports sets against it. */
  sid: string;
  /** Workout name. */
  n: string;
  /** Exercises in workout order: name and sets. */
  x: { n: string; s: GarminPlanSet[] }[];
  /** The set the phone is on, or null when every set is done. */
  a: string | null;
  /** End of the running rest, epoch seconds, or null. */
  re: number | null;
}

export type GarminPhoneMessage =
  GarminPlanMessage | { t: 'none' } | { t: 'end'; sid: string };

/** A set logged on the watch. */
export interface GarminWatchSetMessage {
  t: 'set';
  sid: string;
  /** Set id from the plan. */
  id: string;
  r?: number | null;
  w?: number | null;
  rpe?: number | null;
  /** When it was logged, epoch seconds. */
  at?: number;
  /** Client id generated on the watch, to drop a repeated delivery. */
  c: string;
}

export type GarminWatchMessage =
  | { t: 'hello' }
  | GarminWatchSetMessage
  | { t: 'start'; p: number; at?: number; c: string }
  | { t: 'finish'; sid: string; c: string };

const MESSAGE_TYPES = new Set(['hello', 'set', 'start', 'finish']);

/** Narrows an incoming SDK message; anything else is ignored by the caller. */
export function parseGarminWatchMessage(
  message: unknown
): GarminWatchMessage | null {
  if (message == null || typeof message !== 'object') return null;
  const record = message as Record<string, unknown>;
  if (typeof record.t !== 'string' || !MESSAGE_TYPES.has(record.t)) {
    return null;
  }
  switch (record.t) {
    case 'hello':
      return { t: 'hello' };
    case 'set':
      if (
        typeof record.sid !== 'string' ||
        record.id == null ||
        typeof record.c !== 'string'
      ) {
        return null;
      }
      return {
        t: 'set',
        sid: record.sid,
        id: String(record.id),
        r: finiteOrNull(record.r),
        w: finiteOrNull(record.w),
        rpe: finiteOrNull(record.rpe),
        at: finiteOrNull(record.at) ?? undefined,
        c: record.c,
      };
    case 'start': {
      const presetId = finiteOrNull(record.p);
      if (presetId == null || typeof record.c !== 'string') return null;
      return {
        t: 'start',
        p: presetId,
        at: finiteOrNull(record.at) ?? undefined,
        c: record.c,
      };
    }
    default:
      if (typeof record.sid !== 'string' || typeof record.c !== 'string') {
        return null;
      }
      return { t: 'finish', sid: record.sid, c: record.c };
  }
}

function finiteOrNull(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * The live workout as the watch shows it: the phone's plan with the same
 * resolved targets the Apple Watch gets (`buildWatchWorkoutStartPayload`), in
 * the phone's set order, plus which sets are done and with what values.
 */
export function buildGarminPlanMessage(
  plan: WatchWorkoutStartPayload,
  state: Pick<
    ActiveWorkoutState,
    'session' | 'completedSetIds' | 'activeSetId' | 'rest'
  >
): GarminPlanMessage {
  const logged = new Map<
    string,
    { reps: number | null; weight: number | null }
  >();
  for (const exercise of state.session?.exercises ?? []) {
    for (const set of exercise.sets) {
      logged.set(String(set.id), {
        reps: set.reps ?? null,
        weight: set.weight ?? null,
      });
    }
  }
  return {
    t: 'plan',
    sid: plan.sessionId,
    n: plan.workoutName,
    x: plan.exercises.map((exercise) => ({
      n: exercise.name,
      s: exercise.sets.map((set): GarminPlanSet => {
        const done = state.completedSetIds[set.setId] != null;
        const values = logged.get(set.setId);
        return [
          set.setId,
          set.targetReps ?? null,
          set.targetWeightKg ?? null,
          set.restSeconds ?? 0,
          done ? 1 : 0,
          done ? (values?.reps ?? null) : null,
          done ? (values?.weight ?? null) : null,
        ];
      }),
    })),
    a: state.activeSetId,
    re:
      state.rest.state === 'resting' && state.rest.endsAt != null
        ? Math.round(state.rest.endsAt / 1000)
        : null,
  };
}
