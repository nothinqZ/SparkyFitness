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
 * reps, weightKg, type, pr (0/1)]. Reps/weight are the logged values of a
 * done set; type is a GarminSetType code, null for a normal working set; pr
 * marks a set the phone detected as a personal record.
 */
export type GarminPlanSet = [
  string,
  number | null,
  number | null,
  number,
  0 | 1,
  number | null,
  number | null,
  GarminSetType | null,
  0 | 1,
];

/** Set types the watch shows differently: warm-up, drop set, to failure. */
export type GarminSetType = 'w' | 'd' | 'f';

const SET_TYPE_CODES: Record<string, GarminSetType> = {
  warmup: 'w',
  drop: 'd',
  dropset: 'd',
  failure: 'f',
};

/** One exercise of the plan. */
export interface GarminPlanExercise {
  /** Exercise entry id, for sets added on the watch. */
  e: string;
  n: string;
  s: GarminPlanSet[];
  /** 1 for a barbell exercise: the watch shows plates per side. */
  bb?: 1;
  /** Superset group (0 = A, 1 = B, ...) when the exercise is in one. */
  ss?: number;
  /** Last session's sets as [reps, weightKg, type] for "last time" and the overload hint. */
  p?: [number | null, number | null, GarminSetType | null][];
  /**
   * Weight step from the exercise's progression settings, in the user's
   * weight unit (the unit the watch displays), e.g. 5 for a machine.
   */
  st?: number;
}

/** Previous sessions are cut to this many sets to keep the message small. */
const MAX_PREVIOUS_SETS = 8;

export interface GarminPlanMessage {
  t: 'plan';
  /** Live session id; the watch reports sets against it. */
  sid: string;
  /** Workout name. */
  n: string;
  /** Exercises in workout order. */
  x: GarminPlanExercise[];
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
  /**
   * A correction of a set the watch already logged (made during the rest):
   * the phone updates the completed set instead of ignoring it.
   */
  fix?: boolean;
  /** Client id generated on the watch, to drop a repeated delivery. */
  c: string;
}

export type GarminWatchMessage =
  | { t: 'hello' }
  | GarminWatchSetMessage
  | GarminWatchAddMessage
  | GarminWatchRestMessage
  | { t: 'start'; p: number; at?: number; c: string }
  | { t: 'finish'; sid: string; c: string };

/** A set logged on the watch beyond the plan: the phone adds and completes it. */
export interface GarminWatchAddMessage {
  t: 'add';
  sid: string;
  /** Exercise entry id from the plan. */
  e: string;
  r?: number | null;
  w?: number | null;
  rpe?: number | null;
  at?: number;
  c: string;
}

/**
 * ±15 s or skip on the watch's rest: the rest's end before (`pre`) and
 * after (`re`, 0 = skipped), epoch seconds.
 */
export interface GarminWatchRestMessage {
  t: 'rest';
  sid: string;
  pre: number;
  re: number;
  c: string;
}

const MESSAGE_TYPES = new Set([
  'hello',
  'set',
  'add',
  'rest',
  'start',
  'finish',
]);

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
        ...(record.fix === 1 || record.fix === true ? { fix: true } : {}),
        c: record.c,
      };
    case 'add':
      if (
        typeof record.sid !== 'string' ||
        typeof record.e !== 'string' ||
        typeof record.c !== 'string'
      ) {
        return null;
      }
      return {
        t: 'add',
        sid: record.sid,
        e: record.e,
        r: finiteOrNull(record.r),
        w: finiteOrNull(record.w),
        rpe: finiteOrNull(record.rpe),
        at: finiteOrNull(record.at) ?? undefined,
        c: record.c,
      };
    case 'rest': {
      const pre = finiteOrNull(record.pre);
      const re = finiteOrNull(record.re);
      if (
        typeof record.sid !== 'string' ||
        pre == null ||
        re == null ||
        typeof record.c !== 'string'
      ) {
        return null;
      }
      return { t: 'rest', sid: record.sid, pre, re, c: record.c };
    }
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
  > &
    Partial<
      Pick<
        ActiveWorkoutState,
        'previousSessionSets' | 'exerciseConfigs' | 'prSetIds'
      >
    >
): GarminPlanMessage {
  const exerciseIdByEntry = new Map<string, string>();
  const barbellEntries = new Set<string>();
  for (const exercise of state.session?.exercises ?? []) {
    exerciseIdByEntry.set(String(exercise.id), String(exercise.exercise_id));
    if (
      exercise.exercise_snapshot?.equipment?.some(
        (item) => item.toLowerCase() === 'barbell'
      )
    ) {
      barbellEntries.add(String(exercise.id));
    }
  }
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
    x: plan.exercises.map((exercise) => {
      const entry: GarminPlanExercise = {
        e: exercise.exerciseEntryId,
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
            SET_TYPE_CODES[set.setType ?? ''] ?? null,
            state.prSetIds?.[set.setId] ? 1 : 0,
          ];
        }),
      };
      if (barbellEntries.has(exercise.exerciseEntryId)) entry.bb = 1;
      if (exercise.supersetRun != null) entry.ss = exercise.supersetRun;
      const exerciseId = exerciseIdByEntry.get(exercise.exerciseEntryId);
      const previous =
        exerciseId != null
          ? state.previousSessionSets?.[exerciseId]
          : undefined;
      if (previous != null && previous.length > 0) {
        entry.p = previous
          .slice(0, MAX_PREVIOUS_SETS)
          .map((set) => [
            set.reps ?? null,
            set.weight ?? null,
            SET_TYPE_CODES[set.setType ?? ''] ?? null,
          ]);
      }
      const config = state.exerciseConfigs?.[exercise.exerciseEntryId];
      if (
        config?.increment_type === 'weight' &&
        config.increment_value != null &&
        config.increment_value > 0
      ) {
        entry.st = config.increment_value;
      }
      return entry;
    }),
    a: state.activeSetId,
    re:
      state.rest.state === 'resting' && state.rest.endsAt != null
        ? Math.round(state.rest.endsAt / 1000)
        : null,
  };
}
