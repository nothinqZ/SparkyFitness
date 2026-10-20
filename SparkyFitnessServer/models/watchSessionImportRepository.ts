import type { PoolClient } from 'pg';
import { getClient } from '../db/poolManager.js';

export interface WatchSessionImportRow {
  id: string;
  user_id: string;
  client_session_id: string;
  device_id: string;
  device_model: string | null;
  app_version: string | null;
  payload_sha256: string;
  exercise_preset_entry_id: string | null;
  started_at: Date;
  ended_at: Date;
  started_at_local: string | null;
  linked_garmin_activity_id: string | null;
  linked_at: Date | null;
  created_at: Date;
}

export interface WatchSessionClaim {
  userId: string;
  clientSessionId: string;
  deviceId: string;
  deviceModel: string | null;
  appVersion: string | null;
  payloadSha256: string;
  startedAt: string;
  endedAt: string;
  startedAtLocal: string | null;
}

const SELECT_COLUMNS = `id, user_id, client_session_id, device_id, device_model,
  app_version, payload_sha256, exercise_preset_entry_id, started_at, ended_at,
  to_char(started_at_local, 'YYYY-MM-DD"T"HH24:MI:SS') AS started_at_local,
  linked_garmin_activity_id, linked_at, created_at`;

/**
 * Inserts the idempotency record for an upload. Returns null when a row for
 * the same (user, client_session_id) already exists, which is how concurrent
 * retries of one upload are told apart from the first attempt.
 */
async function claimWatchSession(
  claim: WatchSessionClaim
): Promise<WatchSessionImportRow | null> {
  const client = await getClient(claim.userId);
  try {
    const result = await client.query(
      `INSERT INTO watch_session_imports
         (user_id, client_session_id, device_id, device_model, app_version,
          payload_sha256, started_at, ended_at, started_at_local)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (user_id, client_session_id) DO NOTHING
       RETURNING ${SELECT_COLUMNS}`,
      [
        claim.userId,
        claim.clientSessionId,
        claim.deviceId,
        claim.deviceModel,
        claim.appVersion,
        claim.payloadSha256,
        claim.startedAt,
        claim.endedAt,
        claim.startedAtLocal,
      ]
    );
    return (result.rows[0] as WatchSessionImportRow | undefined) ?? null;
  } finally {
    client.release();
  }
}

async function getWatchSessionByClientId(
  userId: string,
  clientSessionId: string
): Promise<WatchSessionImportRow | null> {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT ${SELECT_COLUMNS} FROM watch_session_imports
       WHERE user_id = $1 AND client_session_id = $2`,
      [userId, clientSessionId]
    );
    return (result.rows[0] as WatchSessionImportRow | undefined) ?? null;
  } finally {
    client.release();
  }
}

async function attachPresetEntry(
  userId: string,
  importId: string,
  exercisePresetEntryId: string
): Promise<void> {
  const client = await getClient(userId);
  try {
    await client.query(
      `UPDATE watch_session_imports SET exercise_preset_entry_id = $3
       WHERE user_id = $1 AND id = $2`,
      [userId, importId, exercisePresetEntryId]
    );
  } finally {
    client.release();
  }
}

/** Releases a claim whose workout could not be created, so a retry can succeed. */
async function releaseClaim(userId: string, importId: string): Promise<void> {
  const client = await getClient(userId);
  try {
    await client.query(
      `DELETE FROM watch_session_imports
       WHERE user_id = $1 AND id = $2 AND exercise_preset_entry_id IS NULL`,
      [userId, importId]
    );
  } finally {
    client.release();
  }
}

/**
 * Watch sessions whose start lies within `windowMinutes` of the given range.
 * Runs on the Garmin import's transaction client so it sees the same snapshot.
 */
async function findCandidatesForGarminImportWithClient(
  client: PoolClient,
  userId: string,
  fromIso: string,
  toIso: string
): Promise<WatchSessionImportRow[]> {
  const result = await client.query(
    `SELECT ${SELECT_COLUMNS} FROM watch_session_imports
     WHERE user_id = $1
       AND exercise_preset_entry_id IS NOT NULL
       AND started_at BETWEEN $2::timestamptz AND $3::timestamptz
     ORDER BY started_at ASC`,
    [userId, fromIso, toIso]
  );
  return result.rows as WatchSessionImportRow[];
}

async function linkGarminActivityWithClient(
  client: PoolClient,
  userId: string,
  importId: string,
  garminActivityId: string
): Promise<void> {
  await client.query(
    `UPDATE watch_session_imports
     SET linked_garmin_activity_id = $3, linked_at = NOW()
     WHERE user_id = $1 AND id = $2`,
    [userId, importId, garminActivityId]
  );
}

async function getSyncStatus(userId: string) {
  const client = await getClient(userId);
  try {
    const totals = await client.query(
      `SELECT COUNT(*)::int AS sessions_total,
              COUNT(linked_garmin_activity_id)::int AS sessions_linked_to_garmin,
              MAX(created_at) AS last_upload_at
       FROM watch_session_imports WHERE user_id = $1`,
      [userId]
    );
    const devices = await client.query(
      `SELECT DISTINCT ON (device_id) device_id, device_model, app_version,
              created_at AS last_seen_at
       FROM watch_session_imports WHERE user_id = $1
       ORDER BY device_id, created_at DESC`,
      [userId]
    );
    return { totals: totals.rows[0], devices: devices.rows };
  } finally {
    client.release();
  }
}

export interface PreviousExercisePerformanceRow {
  exercise_id: string;
  entry_date: string;
  set_number: number;
  reps: number | null;
  weight: string | number | null;
}

/** Sets of the most recent logged entry for each of the given exercises. */
async function getPreviousPerformance(
  userId: string,
  exerciseIds: string[]
): Promise<PreviousExercisePerformanceRow[]> {
  if (exerciseIds.length === 0) return [];
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `WITH latest AS (
         SELECT DISTINCT ON (ee.exercise_id) ee.id, ee.exercise_id, ee.entry_date
         FROM exercise_entries ee
         WHERE ee.user_id = $1
           AND ee.exercise_id = ANY($2::uuid[])
           AND EXISTS (SELECT 1 FROM exercise_entry_sets s
                       WHERE s.exercise_entry_id = ee.id)
         ORDER BY ee.exercise_id, ee.entry_date DESC, ee.created_at DESC
       )
       SELECT l.exercise_id, to_char(l.entry_date, 'YYYY-MM-DD') AS entry_date,
              s.set_number, s.reps, s.weight
       FROM latest l
       JOIN exercise_entry_sets s ON s.exercise_entry_id = l.id
       ORDER BY l.exercise_id, s.set_number`,
      [userId, exerciseIds]
    );
    return result.rows as PreviousExercisePerformanceRow[];
  } finally {
    client.release();
  }
}

export default {
  claimWatchSession,
  getWatchSessionByClientId,
  attachPresetEntry,
  releaseClaim,
  findCandidatesForGarminImportWithClient,
  linkGarminActivityWithClient,
  getSyncStatus,
  getPreviousPerformance,
};
