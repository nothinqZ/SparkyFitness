import { getClient } from '../db/poolManager.js';

// Read-only queries behind /api/v2/performance. Every query runs on the
// target user's RLS client, so family members with the reports permission
// see exactly what the policies allow and nothing else.

export interface RunQueryRow {
  date: string;
  distance: string | number;
  duration_minutes: string | number;
  avg_heart_rate: string | number | null;
}

export interface DailyValueRow {
  date: string;
  value: string | number;
}

export interface HealthMetricsRow {
  date: string;
  resting_heart_rate: number | null;
  vo2_max: string | number | null;
  race_prediction_5k_seconds: number | null;
  race_prediction_10k_seconds: number | null;
  race_prediction_half_marathon_seconds: number | null;
  race_prediction_marathon_seconds: number | null;
  acute_training_load: string | number | null;
  chronic_training_load: string | number | null;
  acwr_ratio: string | number | null;
  training_readiness_score: number | null;
  recovery_time_hours: string | number | null;
  body_battery_highest: number | null;
  body_battery_lowest: number | null;
  body_battery_charged: number | null;
  body_battery_drained: number | null;
  avg_stress_level: number | null;
  total_steps: number | null;
  step_goal: number | null;
  source_provider: string;
}

export interface SleepQueryRow {
  date: string;
  bedtime: Date | string;
  duration_in_seconds: number;
  time_asleep_in_seconds: number | null;
  sleep_score: number | null;
  avg_overnight_hrv: string | number | null;
}

export interface StrengthSetRow {
  date: string;
  exercise_id: string | null;
  exercise_name: string;
  weight: string | number;
  reps: number;
  /** JSON-ish text like ["quadriceps","glutes"]; null for custom exercises. */
  primary_muscles: string | null;
}

// Runs: running by category or by name (word boundaries, as in
// exerciseStatsService: "crunch" is not a run), with distance and time.
const RUN_FILTER = `distance > 0 AND duration_minutes > 0
  AND (LOWER(COALESCE(category, '')) = 'running'
       OR LOWER(COALESCE(exercise_name, '')) ~* '\\m(run(ning|s)?|jog(ging)?|treadmill)\\M')
  AND LOWER(COALESCE(exercise_name, '')) !~* '\\m(crunch|strength)\\M'`;

async function withClient<T>(
  userId: string,
  authenticatedUserId: string,
  fn: (
    query: (sql: string, params: unknown[]) => Promise<unknown[]>
  ) => Promise<T>
): Promise<T> {
  const client = await getClient(userId, authenticatedUserId);
  try {
    return await fn(
      async (sql, params) => (await client.query(sql, params)).rows
    );
  } finally {
    client.release();
  }
}

async function getRuns(
  userId: string,
  authUserId: string,
  start: string,
  end: string
) {
  return withClient(userId, authUserId, (q) =>
    q(
      `SELECT TO_CHAR(entry_date, 'YYYY-MM-DD') AS date, distance, duration_minutes, avg_heart_rate
       FROM exercise_entries
       WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3 AND ${RUN_FILTER}
       ORDER BY entry_date, entry_time NULLS LAST`,
      [userId, start, end]
    )
  ) as Promise<RunQueryRow[]>;
}

/** Garmin's per-activity training load, summed per day. */
async function getDailyTrainingLoad(
  userId: string,
  authUserId: string,
  start: string,
  end: string
) {
  return withClient(userId, authUserId, (q) =>
    q(
      `SELECT TO_CHAR(entry_date, 'YYYY-MM-DD') AS date, SUM(training_load) AS value
       FROM exercise_entries
       WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3 AND training_load > 0
       GROUP BY entry_date ORDER BY entry_date`,
      [userId, start, end]
    )
  ) as Promise<DailyValueRow[]>;
}

/** One row per day; Garmin preferred when several providers wrote that day. */
async function getHealthMetrics(
  userId: string,
  authUserId: string,
  start: string,
  end: string
) {
  return withClient(userId, authUserId, (q) =>
    q(
      `SELECT DISTINCT ON (entry_date)
              TO_CHAR(entry_date, 'YYYY-MM-DD') AS date, resting_heart_rate, vo2_max,
              race_prediction_5k_seconds, race_prediction_10k_seconds,
              race_prediction_half_marathon_seconds, race_prediction_marathon_seconds,
              acute_training_load, chronic_training_load, acwr_ratio,
              training_readiness_score, recovery_time_hours,
              body_battery_highest, body_battery_lowest, body_battery_charged,
              body_battery_drained, avg_stress_level, total_steps, step_goal,
              source_provider
       FROM daily_health_metrics
       WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3
       ORDER BY entry_date, (source_provider = 'garmin') DESC, updated_at DESC NULLS LAST`,
      [userId, start, end]
    )
  ) as Promise<HealthMetricsRow[]>;
}

/** Main sleep per night (longest), any source. */
async function getSleep(
  userId: string,
  authUserId: string,
  start: string,
  end: string
) {
  return withClient(userId, authUserId, (q) =>
    q(
      `SELECT DISTINCT ON (entry_date)
              TO_CHAR(entry_date, 'YYYY-MM-DD') AS date, bedtime, duration_in_seconds,
              time_asleep_in_seconds, sleep_score, avg_overnight_hrv
       FROM sleep_entries
       WHERE user_id = $1 AND entry_date BETWEEN $2 AND $3
       ORDER BY entry_date, COALESCE(time_asleep_in_seconds, duration_in_seconds) DESC`,
      [userId, start, end]
    )
  ) as Promise<SleepQueryRow[]>;
}

/**
 * Weighted working sets (weight and reps > 0). Bodyweight-modality exercises
 * are left out: their load depends on body weight, which the volume and e1RM
 * here do not model.
 */
async function getStrengthSets(
  userId: string,
  authUserId: string,
  start: string,
  end: string
) {
  return withClient(userId, authUserId, (q) =>
    q(
      `SELECT TO_CHAR(e.entry_date, 'YYYY-MM-DD') AS date, e.exercise_id, e.exercise_name,
              s.weight, s.reps, e.primary_muscles
       FROM exercise_entry_sets s
       JOIN exercise_entries e ON e.id = s.exercise_entry_id
       WHERE e.user_id = $1 AND e.entry_date BETWEEN $2 AND $3
         AND s.weight > 0 AND s.reps > 0
         AND COALESCE(e.modality, '') <> 'bodyweight_reps'
         AND LOWER(COALESCE(s.set_type, '')) NOT LIKE 'warm%'`,
      [userId, start, end]
    )
  ) as Promise<StrengthSetRow[]>;
}

export default {
  getRuns,
  getDailyTrainingLoad,
  getHealthMetrics,
  getSleep,
  getStrengthSets,
};
