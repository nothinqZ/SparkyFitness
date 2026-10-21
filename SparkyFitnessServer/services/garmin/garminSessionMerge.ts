/** Local extension: one diary session, Sparky sets plus Garmin activity report.
 * All calls run in the import transaction, under the per-user advisory lock.
 * No estimated exercise-level allocation of session calories or heart rate.
 */
import type { PoolClient } from 'pg';
type QueryClient = Pick<PoolClient, 'query'>;

type SessionData = {
  activity: {
    activityId?: string | number;
    startTimeLocal?: string;
    activityType?: { typeKey?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
const LINK = 'garmin_activity_link';

export async function lockGarminImport(client: QueryClient, userId: string) {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
    `garmin-import:${userId}`,
  ]);
}

export async function mergeGarminSession(
  client: QueryClient,
  userId: string,
  data: SessionData,
  allowDateMatch: boolean
): Promise<string | null> {
  const activityId = String(data.activity?.activityId ?? '');
  const day = data.activity?.startTimeLocal?.slice(0, 10);
  if (
    !activityId ||
    !day ||
    data.activity?.activityType?.typeKey !== 'strength_training'
  )
    return null;
  const links = await client.query(
    `SELECT p.id FROM exercise_entry_activity_details d
    JOIN exercise_preset_entries p ON p.id=d.exercise_preset_entry_id
    WHERE d.created_by_user_id=$1 AND p.user_id=$1 AND p.source='sparky'
      AND d.provider_name='garmin' AND d.detail_type=$2 AND d.detail_data->>'activityId'=$3`,
    [userId, LINK, activityId]
  );
  if (links.rowCount! > 1) throw new Error('Ambiguous Garmin activity link');
  let target = links.rows[0]?.id as string | undefined;
  if (!target && allowDateMatch) {
    // Require exactly one native strength session, including sessions already
    // linked elsewhere. Never grab the remaining one on a multi-workout day.
    const candidates = await client.query(
      `SELECT p.id FROM exercise_preset_entries p
      WHERE p.user_id=$1 AND p.source='sparky' AND p.entry_date=$2
      AND EXISTS (SELECT 1 FROM exercise_entries e
        JOIN exercises x ON x.id=e.exercise_id
        JOIN exercise_entry_sets s ON s.exercise_entry_id=e.id
        WHERE e.exercise_preset_entry_id=p.id AND x.modality='weight_reps'
          AND s.reps IS NOT NULL)`,
      [userId, day]
    );
    if (candidates.rowCount === 1) target = candidates.rows[0].id;
  }
  if (!target) return null;
  const existing = await client.query(
    `SELECT detail_data->>'activityId' AS activity_id
    FROM exercise_entry_activity_details WHERE created_by_user_id=$1 AND exercise_preset_entry_id=$2
    AND provider_name='garmin' AND detail_type=$3`,
    [userId, target, LINK]
  );
  if (existing.rows.some((r) => r.activity_id !== activityId)) return null;
  if (!existing.rowCount) {
    await client.query(
      `INSERT INTO exercise_entry_activity_details
      (exercise_preset_entry_id,provider_name,detail_type,detail_data,created_by_user_id)
      VALUES ($1,'garmin',$2,$3::jsonb,$4)`,
      [target, LINK, JSON.stringify({ activityId }), userId]
    );
  }
  // Replace the report, not the user's exercises, sets, notes, IDs or template.
  await client.query(
    `DELETE FROM exercise_entry_activity_details WHERE created_by_user_id=$1
    AND exercise_preset_entry_id=$2 AND provider_name='garmin' AND detail_type='full_activity_data'`,
    [userId, target]
  );
  await client.query(
    `INSERT INTO exercise_entry_activity_details
    (exercise_preset_entry_id,provider_name,detail_type,detail_data,created_by_user_id)
    VALUES ($1,'garmin','full_activity_data',$2::jsonb,$3)`,
    [target, JSON.stringify(data), userId]
  );
  return target;
}

/** Archive every dependent row before removing a proven duplicate. Raw reports
 * remain available on the canonical session; archive can reconstruct the old row.
 */
export async function reconcileGarminDuplicates(
  client: QueryClient,
  userId: string,
  startDate: string,
  endDate: string
) {
  const old = await client.query(
    `SELECT p.id,p.entry_date::text AS day,d.detail_data,
      (SELECT count(DISTINCT x.detail_data->'activity'->>'activityId')
       FROM exercise_preset_entries q JOIN exercise_entry_activity_details x ON x.exercise_preset_entry_id=q.id
       WHERE q.user_id=p.user_id AND q.entry_date=p.entry_date AND q.source='garmin'
       AND x.detail_type='full_activity_data' AND x.detail_data->'activity'->'activityType'->>'typeKey'='strength_training') AS activities
    FROM exercise_preset_entries p JOIN exercise_entry_activity_details d ON d.exercise_preset_entry_id=p.id
    WHERE p.user_id=$1 AND p.source='garmin' AND p.entry_date BETWEEN $2 AND $3
    AND d.provider_name='garmin' AND d.detail_type='full_activity_data' ORDER BY p.entry_date,p.id`,
    [userId, startDate, endDate]
  );
  const merged: Array<{ date: string; source: string; target: string }> = [];
  for (const row of old.rows) {
    const target = await mergeGarminSession(
      client,
      userId,
      row.detail_data,
      Number(row.activities) === 1
    );
    if (!target) continue;
    const archive = await client.query(
      `SELECT jsonb_build_object(
      'archive_format','sparky_garmin_duplicate_v1',
      'session',to_jsonb(p),
      'entries',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]') FROM exercise_entries e WHERE e.exercise_preset_entry_id=p.id),
      'sets',(SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') FROM exercise_entry_sets s JOIN exercise_entries e ON e.id=s.exercise_entry_id WHERE e.exercise_preset_entry_id=p.id),
      'details',(SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') FROM exercise_entry_activity_details d WHERE d.exercise_preset_entry_id=p.id OR d.exercise_entry_id IN (SELECT id FROM exercise_entries WHERE exercise_preset_entry_id=p.id)),
      'laps',(SELECT coalesce(jsonb_agg(to_jsonb(l)),'[]') FROM exercise_entry_laps l JOIN exercise_entries e ON e.id=l.exercise_entry_id WHERE e.exercise_preset_entry_id=p.id),
      'hr_zones',(SELECT coalesce(jsonb_agg(to_jsonb(z)),'[]') FROM exercise_entry_hr_zones z JOIN exercise_entries e ON e.id=z.exercise_entry_id WHERE e.exercise_preset_entry_id=p.id),
      'gps',(SELECT coalesce(jsonb_agg(to_jsonb(g)),'[]') FROM exercise_entry_gps_points g JOIN exercise_entries e ON e.id=g.exercise_entry_id WHERE e.exercise_preset_entry_id=p.id)
    ) AS data FROM exercise_preset_entries p WHERE p.id=$1 AND p.user_id=$2`,
      [row.id, userId]
    );
    await client.query(
      `INSERT INTO exercise_entry_activity_details
      (exercise_preset_entry_id,provider_name,detail_type,detail_data,created_by_user_id)
      VALUES ($1,'garmin','full_workout_data',$2::jsonb,$3)`,
      [target, JSON.stringify(archive.rows[0].data), userId]
    );
    await client.query(
      "DELETE FROM exercise_preset_entries WHERE id=$1 AND user_id=$2 AND source='garmin'",
      [row.id, userId]
    );
    merged.push({ date: row.day, source: row.id, target });
  }
  return merged;
}
