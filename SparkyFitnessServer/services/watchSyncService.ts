import { createHash } from 'node:crypto';
import type {
  WatchManifestResponse,
  WatchPlannedExercise,
  WatchPlannedWorkout,
  WatchSessionUpload,
  WatchSessionUploadResponse,
  WatchSyncStatusResponse,
} from '@workspace/shared';
import { log } from '../config/logging.js';
import exerciseService from './exerciseService.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import workoutPlanTemplateRepository, {
  type WorkoutPlanTemplateRow,
} from '../models/workoutPlanTemplateRepository.js';
import preferenceRepository from '../models/preferenceRepository.js';
import watchSessionImportRepository, {
  type PreviousExercisePerformanceRow,
} from '../models/watchSessionImportRepository.js';

export const WATCH_SESSION_SOURCE = 'sparky watch';
const MAX_MANIFEST_WORKOUTS = 30;
const DEFAULT_REST_SECONDS = 90;

interface ServiceError extends Error {
  status: number;
}

function serviceError(status: number, message: string): ServiceError {
  return Object.assign(new Error(message), { status });
}

interface PresetSetRow {
  set_number: number;
  set_type?: string | null;
  reps?: number | null;
  weight?: number | string | null;
  duration?: number | string | null;
  rest_time?: number | null;
}

interface PresetExerciseRow {
  exercise_id: string;
  exercise_name: string;
  category?: string | null;
  sets?: PresetSetRow[];
}

interface PresetRow {
  id: number;
  name: string;
  exercises?: PresetExerciseRow[];
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + days));
  return dt.toISOString().slice(0, 10);
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
}

/**
 * Preset ids an active plan schedules on `date`. Weekly plans schedule by
 * weekday; sequential plans expose their next assignments, which apply to
 * whatever day the user trains next and are reported for `date` itself.
 */
export function scheduledPresetIds(
  plans: readonly WorkoutPlanTemplateRow[],
  date: string,
  isFirstDay: boolean
): number[] {
  const ids: number[] = [];
  for (const plan of plans) {
    const assignments =
      plan.schedule_type === 'sequential'
        ? isFirstDay
          ? (plan.next_assignments ?? [])
          : []
        : (plan.assignments ?? []).filter(
            (a) => a.day_of_week === weekdayOf(date)
          );
    for (const assignment of assignments) {
      const presetId = toNumberOrNull(assignment.workout_preset_id);
      if (presetId !== null && !ids.includes(presetId)) ids.push(presetId);
    }
  }
  return ids;
}

export function groupPreviousPerformance(
  rows: readonly PreviousExercisePerformanceRow[]
): Map<string, WatchPlannedExercise['previous']> {
  const byExercise = new Map<string, WatchPlannedExercise['previous']>();
  for (const row of rows) {
    let entry = byExercise.get(row.exercise_id);
    if (!entry) {
      entry = { entry_date: row.entry_date, sets: [] };
      byExercise.set(row.exercise_id, entry);
    }
    entry.sets.push({
      set_number: row.set_number,
      reps: toNumberOrNull(row.reps),
      weight: toNumberOrNull(row.weight),
    });
  }
  return byExercise;
}

export function toPlannedWorkout(
  preset: PresetRow,
  scheduledDate: string | null,
  previous: Map<string, WatchPlannedExercise['previous']>
): WatchPlannedWorkout {
  return {
    workout_preset_id: preset.id,
    name: preset.name,
    scheduled_date: scheduledDate,
    exercises: (preset.exercises ?? []).map((exercise, index) => ({
      exercise_id: exercise.exercise_id,
      name: exercise.exercise_name,
      category: exercise.category ?? null,
      sort_order: index,
      sets: (exercise.sets ?? []).map((set) => ({
        set_number: set.set_number,
        set_type: set.set_type ?? null,
        reps: toNumberOrNull(set.reps),
        weight: toNumberOrNull(set.weight),
        duration: toNumberOrNull(set.duration),
        rest_time: toNumberOrNull(set.rest_time),
      })),
      previous: previous.get(exercise.exercise_id) ?? null,
    })),
  };
}

async function buildManifest(
  userId: string,
  today: string,
  days = 7
): Promise<WatchManifestResponse> {
  const scheduled = new Map<number, string>();
  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const plans =
      await workoutPlanTemplateRepository.getActiveWorkoutPlanForDate(
        userId,
        date
      );
    for (const id of scheduledPresetIds(plans, date, i === 0)) {
      if (!scheduled.has(id)) scheduled.set(id, date);
    }
  }

  const { presets } = (await workoutPresetRepository.getWorkoutPresets(
    userId,
    1,
    MAX_MANIFEST_WORKOUTS
  )) as { presets: PresetRow[] };
  const byId = new Map(presets.map((p) => [p.id, p]));
  // Scheduled presets may fall outside the first page; fetch them explicitly.
  for (const id of scheduled.keys()) {
    if (!byId.has(id)) {
      const preset = (await workoutPresetRepository.getWorkoutPresetById(
        id,
        userId
      )) as PresetRow | null;
      if (preset) byId.set(preset.id, preset);
    }
  }

  const ordered = [...byId.values()]
    .filter((p) => (p.exercises ?? []).length > 0)
    .sort((a, b) => {
      const da = scheduled.get(a.id) ?? '9999-12-31';
      const db = scheduled.get(b.id) ?? '9999-12-31';
      return da === db ? a.name.localeCompare(b.name) : da.localeCompare(db);
    })
    .slice(0, MAX_MANIFEST_WORKOUTS);

  const exerciseIds = [
    ...new Set(
      ordered.flatMap((p) => (p.exercises ?? []).map((e) => e.exercise_id))
    ),
  ];
  const previous = groupPreviousPerformance(
    await watchSessionImportRepository.getPreviousPerformance(
      userId,
      exerciseIds
    )
  );

  const prefs = (await preferenceRepository.getUserPreferences(userId)) as {
    default_weight_unit?: string | null;
  } | null;

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    weight_unit: prefs?.default_weight_unit === 'lbs' ? 'lbs' : 'kg',
    default_rest_seconds: DEFAULT_REST_SECONDS,
    workouts: ordered.map((p) =>
      toPlannedWorkout(p, scheduled.get(p.id) ?? null, previous)
    ),
  };
}

// Stable JSON: object keys sorted, so the hash does not depend on the order
// the watch serialised its dictionary in.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Hash of the workout content. App version is excluded: an app update between retries must not turn a retry into a conflict. */
export function hashSessionPayload(session: WatchSessionUpload): string {
  const { app_version: _appVersion, ...content } = session;
  return createHash('sha256').update(canonicalJson(content)).digest('hex');
}

async function importSession(
  userId: string,
  actingUserId: string,
  session: WatchSessionUpload
): Promise<WatchSessionUploadResponse> {
  const payloadSha256 = hashSessionPayload(session);
  const claim = await watchSessionImportRepository.claimWatchSession({
    userId,
    clientSessionId: session.client_session_id,
    deviceId: session.device_id,
    deviceModel: session.device_model ?? null,
    appVersion: session.app_version ?? null,
    payloadSha256,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    startedAtLocal: session.started_at_local ?? null,
  });

  if (!claim) {
    const existing =
      await watchSessionImportRepository.getWatchSessionByClientId(
        userId,
        session.client_session_id
      );
    if (existing && existing.payload_sha256 !== payloadSha256) {
      throw serviceError(
        409,
        'A different session was already uploaded with this client_session_id.'
      );
    }
    return {
      status: 'duplicate',
      client_session_id: session.client_session_id,
      exercise_preset_entry_id: existing?.exercise_preset_entry_id ?? null,
    };
  }

  const durationMinutes = Math.max(
    0,
    (Date.parse(session.ended_at) - Date.parse(session.started_at)) / 60_000
  );
  const totalSets = session.exercises.reduce((n, e) => n + e.sets.length, 0);

  try {
    const created = (await exerciseService.createGroupedWorkoutSession(
      userId,
      actingUserId,
      {
        workout_preset_id: session.workout_preset_id ?? null,
        entry_date: session.entry_date,
        name: session.name,
        notes: session.notes ?? null,
        source: WATCH_SESSION_SOURCE,
        exercises: session.exercises.map((exercise) => ({
          exercise_id: exercise.exercise_id,
          sort_order: exercise.sort_order,
          // Spread the session's wall time across exercises by set count, so
          // calorie estimates stay proportional to the work each one got.
          duration_minutes:
            totalSets > 0
              ? Math.round(
                  ((durationMinutes * exercise.sets.length) / totalSets) * 100
                ) / 100
              : 0,
          entry_time: session.started_at_local
            ? session.started_at_local.slice(11, 16)
            : null,
          sets: exercise.sets.map((set) => ({
            set_number: set.set_number,
            set_type: set.set_type ?? 'Working Set',
            reps: set.reps ?? null,
            weight: set.weight ?? null,
            duration: set.duration ?? null,
            rest_time: set.rest_time ?? null,
            rpe: set.rpe ?? null,
            rir: set.rir ?? null,
            completed_at: set.completed_at ?? null,
          })),
        })),
      }
    )) as { id: string };
    await watchSessionImportRepository.attachPresetEntry(
      userId,
      claim.id,
      created.id
    );
    log(
      'info',
      `[watchSync] Imported watch session ${session.client_session_id} for user ${userId} as ${created.id}`
    );
    return {
      status: 'created',
      client_session_id: session.client_session_id,
      exercise_preset_entry_id: created.id,
    };
  } catch (error) {
    await watchSessionImportRepository
      .releaseClaim(userId, claim.id)
      .catch((releaseError: unknown) =>
        log('error', '[watchSync] Failed to release claim:', releaseError)
      );
    throw error;
  }
}

async function getSyncStatus(userId: string): Promise<WatchSyncStatusResponse> {
  const { totals, devices } =
    await watchSessionImportRepository.getSyncStatus(userId);
  const toIso = (v: unknown) =>
    v ? new Date(v as string).toISOString() : null;
  return {
    last_upload_at: toIso(totals?.last_upload_at),
    sessions_total: Number(totals?.sessions_total ?? 0),
    sessions_linked_to_garmin: Number(totals?.sessions_linked_to_garmin ?? 0),
    devices: (devices as Array<Record<string, unknown>>).map((d) => ({
      device_id: String(d.device_id),
      device_model: (d.device_model as string | null) ?? null,
      app_version: (d.app_version as string | null) ?? null,
      last_seen_at: toIso(d.last_seen_at) ?? '',
    })),
  };
}

export default { buildManifest, importSession, getSyncStatus };
