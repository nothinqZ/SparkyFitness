import { preferredSleepClause } from './sleepSourcePolicy.js';
import { getClient } from '../db/poolManager.js';
import { todayInZone, addDays } from '@workspace/shared';
/**
 * Get sleep history for calculations
 * @param {string} userId
 * @param {number} days - Number of days to look back
 * @returns {Promise<Array>} Sleep entries with timestamps and durations
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSleepHistory(userId: any, days = 90, timezone = 'UTC') {
  const client = await getClient(userId);
  try {
    const cutoffDate = addDays(todayInZone(timezone), -days);
    const result = await client.query(
      `SELECT
        se.entry_date AS date,
        se.duration_in_seconds,
        se.bedtime,
        se.wake_time,
        COALESCE(
          (SELECT SUM(ss.duration_in_seconds) FROM sleep_entry_stages ss WHERE ss.entry_id = se.id AND ss.stage_type = 'deep'), 0
        ) / 60.0 AS "deepSleepMinutes",
        COALESCE(
          (SELECT SUM(ss.duration_in_seconds) FROM sleep_entry_stages ss WHERE ss.entry_id = se.id AND ss.stage_type = 'rem'), 0
        ) / 60.0 AS "remSleepMinutes",
        COALESCE(
          (SELECT SUM(ss.duration_in_seconds) FROM sleep_entry_stages ss WHERE ss.entry_id = se.id AND ss.stage_type = 'light'), 0
        ) / 60.0 AS "lightSleepMinutes",
        COALESCE(
          (SELECT SUM(ss.duration_in_seconds) FROM sleep_entry_stages ss WHERE ss.entry_id = se.id AND ss.stage_type = 'awake'), 0
        ) / 60.0 AS "awakeMinutes",
        se.duration_in_seconds / 3600.0 AS "sleepDurationHours",
        se.time_asleep_in_seconds / 3600.0 AS "timeAsleepHours",
        EXTRACT(EPOCH FROM se.bedtime) * 1000 AS "sleepStartTimestampGMT",
        EXTRACT(EPOCH FROM se.wake_time) * 1000 AS "sleepEndTimestampGMT",
        se.record_timezone,
        se.record_utc_offset_minutes,
        se.sleep_score AS "sleepScore"
      FROM sleep_entries se
      WHERE se.user_id = $1 AND ${preferredSleepClause('se')}
        AND se.entry_date >= $2
        AND se.duration_in_seconds > 0
      ORDER BY se.entry_date DESC`,
      [userId, cutoffDate]
    );
    return result.rows;
  } finally {
    client.release();
  }
}
/**
 * Get user's sleep science profile
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getSleepProfile(userId: any) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT
        baseline_sleep_need,
        sleep_need_method,
        sleep_need_confidence,
        sleep_need_based_on_days,
        sleep_need_last_calculated,
        sd_workday_hours,
        sd_freeday_hours,
        social_jetlag_hours
      FROM profiles
      WHERE id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}
/**
 * Update baseline sleep need in profile
 * @param {string} userId
 * @param {Object} params
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateBaselineSleepNeed(userId: any, params: any) {
  const client = await getClient(userId);
  try {
    await client.query(
      `UPDATE profiles SET
        baseline_sleep_need = $1,
        sleep_need_method = 'mctq_corrected',
        sleep_need_confidence = $2,
        sleep_need_based_on_days = $3,
        sleep_need_last_calculated = NOW(),
        sd_workday_hours = $4,
        sd_freeday_hours = $5,
        social_jetlag_hours = $6
      WHERE id = $7`,
      [
        params.baselineNeed,
        params.confidence,
        params.basedOnDays,
        params.sdWorkday,
        params.sdFreeday,
        params.socialJetlag,
        userId,
      ]
    );
  } finally {
    client.release();
  }
}
/**
 * Save MCTQ calculation record
 * @param {string} userId
 * @param {Object} data
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function saveCalculation(userId: any, data: any) {
  const client = await getClient(userId);
  try {
    await client.query(
      `INSERT INTO sleep_need_calculations (
        user_id, method, calculated_need, confidence, based_on_days,
        sd_workday, sd_freeday, sd_week, social_jetlag_hours,
        mid_sleep_workday, mid_sleep_freeday, mid_sleep_corrected,
        workdays_count, freedays_count, data_start_date, data_end_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        userId,
        data.method,
        data.calculatedNeed,
        data.confidence,
        data.basedOnDays,
        data.sdWorkday,
        data.sdFreeday,
        data.sdWeek,
        data.socialJetlag,
        data.midSleepWorkday,
        data.midSleepFreeday,
        data.midSleepCorrected,
        data.workdaysCount,
        data.freedaysCount,
        data.dataStartDate,
        data.dataEndDate,
      ]
    );
  } finally {
    client.release();
  }
}
/**
 * Upsert day classification cache
 * @param {string} userId
 * @param {number} dayOfWeek - 0-6 (Sun-Sat)
 * @param {Object} data
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertDayClassification(userId: any, dayOfWeek: any, data: any) {
  const client = await getClient(userId);
  try {
    await client.query(
      `INSERT INTO day_classification_cache
        (user_id, day_of_week, classified_as, mean_wake_hour, variance_minutes, sample_count)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id, day_of_week) DO UPDATE SET
        classified_as = EXCLUDED.classified_as,
        mean_wake_hour = EXCLUDED.mean_wake_hour,
        variance_minutes = EXCLUDED.variance_minutes,
        sample_count = EXCLUDED.sample_count,
        last_updated = NOW()`,
      [
        userId,
        dayOfWeek,
        data.classifiedAs,
        data.meanWakeHour,
        data.varianceMinutes,
        data.sampleCount,
      ]
    );
  } finally {
    client.release();
  }
}
/**
 * Get day classifications for user
 * @param {string} userId
 * @returns {Promise<Array>}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDayClassifications(userId: any) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT day_of_week, classified_as, mean_wake_hour, variance_minutes, sample_count
      FROM day_classification_cache
      WHERE user_id = $1
      ORDER BY day_of_week`,
      [userId]
    );
    return result.rows;
  } finally {
    client.release();
  }
}
/**
 * Get MCTQ stats from view
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMCTQStats(userId: any) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `WITH v_mctq_analysis AS (
SELECT se.user_id,
    se.entry_date AS date,
    EXTRACT(dow FROM se.entry_date) AS day_of_week,
        CASE
            WHEN dcc.classified_as IS NOT NULL THEN dcc.classified_as
            WHEN EXTRACT(dow FROM se.entry_date) = ANY (ARRAY[0::numeric, 6::numeric]) THEN 'freeday'::character varying
            ELSE 'workday'::character varying
        END AS day_type,
    se.duration_in_seconds::numeric / 3600.0 AS tst_hours,
        CASE
            WHEN se.bedtime IS NOT NULL AND se.wake_time IS NOT NULL THEN (se.bedtime + (se.wake_time - se.bedtime) / 2::double precision)::time without time zone
            ELSE NULL::time without time zone
        END AS mid_sleep,
    se.bedtime,
    se.wake_time,
        CASE
            WHEN se.wake_time IS NOT NULL THEN EXTRACT(hour FROM se.wake_time) + EXTRACT(minute FROM se.wake_time) / 60.0
            ELSE NULL::numeric
        END AS wake_hour
   FROM sleep_entries se
     LEFT JOIN day_classification_cache dcc ON se.user_id = dcc.user_id AND EXTRACT(dow FROM se.entry_date) = dcc.day_of_week::numeric
  WHERE se.bedtime IS NOT NULL AND se.wake_time IS NOT NULL AND se.duration_in_seconds > 0 AND se.user_id = $1 AND ${preferredSleepClause('se')}
), preferred_stats AS (
WITH recent_data AS (
         SELECT v_mctq_analysis.user_id,
            v_mctq_analysis.day_type,
            v_mctq_analysis.tst_hours,
            v_mctq_analysis.mid_sleep,
            v_mctq_analysis.wake_hour
           FROM v_mctq_analysis
          WHERE v_mctq_analysis.date >= (CURRENT_DATE - '90 days'::interval) AND v_mctq_analysis.tst_hours IS NOT NULL AND v_mctq_analysis.tst_hours >= 3::numeric AND v_mctq_analysis.tst_hours <= 14::numeric
        ), workday_stats AS (
         SELECT recent_data.user_id,
            avg(recent_data.tst_hours) AS sd_workday,
            avg(EXTRACT(hour FROM recent_data.mid_sleep) + EXTRACT(minute FROM recent_data.mid_sleep) / 60.0) AS msw_hour,
            count(*) AS workday_count
           FROM recent_data
          WHERE recent_data.day_type::text = 'workday'::text
          GROUP BY recent_data.user_id
        ), freeday_stats AS (
         SELECT recent_data.user_id,
            avg(recent_data.tst_hours) AS sd_freeday,
            avg(EXTRACT(hour FROM recent_data.mid_sleep) + EXTRACT(minute FROM recent_data.mid_sleep) / 60.0) AS msf_hour,
            count(*) AS freeday_count
           FROM recent_data
          WHERE recent_data.day_type::text = 'freeday'::text
          GROUP BY recent_data.user_id
        )
 SELECT COALESCE(w.user_id, f.user_id) AS user_id,
    round(w.sd_workday, 2) AS sd_workday,
    round(f.sd_freeday, 2) AS sd_freeday,
    round((5::numeric * COALESCE(w.sd_workday, 7::numeric) + 2::numeric * COALESCE(f.sd_freeday, 8::numeric)) / 7::numeric, 2) AS sd_week,
        CASE
            WHEN f.sd_freeday > w.sd_workday THEN round(f.sd_freeday - (f.sd_freeday - (5::numeric * w.sd_workday + 2::numeric * f.sd_freeday) / 7::numeric) / 2::numeric, 2)
            ELSE round((5::numeric * COALESCE(w.sd_workday, 7::numeric) + 2::numeric * COALESCE(f.sd_freeday, 8::numeric)) / 7::numeric, 2)
        END AS sleep_need_ideal,
    round(abs(COALESCE(f.msf_hour, 4::numeric) - COALESCE(w.msw_hour, 3::numeric)), 2) AS social_jetlag_hours,
    w.workday_count,
    f.freeday_count,
        CASE
            WHEN COALESCE(w.workday_count, 0::bigint) >= 40 AND COALESCE(f.freeday_count, 0::bigint) >= 16 THEN 'high'::text
            WHEN COALESCE(w.workday_count, 0::bigint) >= 20 AND COALESCE(f.freeday_count, 0::bigint) >= 8 THEN 'medium'::text
            ELSE 'low'::text
        END AS confidence
   FROM workday_stats w
     FULL JOIN freeday_stats f ON w.user_id = f.user_id
) SELECT * FROM preferred_stats WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}
/**
 * Get latest calculation record
 * @param {string} userId
 * @returns {Promise<Object|null>}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getLatestCalculation(userId: any) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT * FROM sleep_need_calculations
      WHERE user_id = $1
      ORDER BY calculated_at DESC
      LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}
/**
 * Upsert daily sleep need
 * @param {string} userId
 * @param {string} targetDate
 * @param {Object} breakdown
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function upsertDailyNeed(userId: any, targetDate: any, breakdown: any) {
  const client = await getClient(userId);
  try {
    await client.query(
      `INSERT INTO daily_sleep_need
        (user_id, target_date, baseline_need, strain_addition, debt_addition,
         nap_subtraction, total_need, training_load_score, current_debt_hours,
         nap_minutes, recovery_score_yesterday)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (user_id, target_date) DO UPDATE SET
        baseline_need = EXCLUDED.baseline_need,
        strain_addition = EXCLUDED.strain_addition,
        debt_addition = EXCLUDED.debt_addition,
        nap_subtraction = EXCLUDED.nap_subtraction,
        total_need = EXCLUDED.total_need,
        training_load_score = EXCLUDED.training_load_score,
        current_debt_hours = EXCLUDED.current_debt_hours,
        nap_minutes = EXCLUDED.nap_minutes,
        recovery_score_yesterday = EXCLUDED.recovery_score_yesterday,
        calculated_at = NOW()`,
      [
        userId,
        targetDate,
        breakdown.baseline_need,
        breakdown.strain_addition,
        breakdown.debt_addition,
        breakdown.nap_subtraction,
        breakdown.total_need,
        breakdown.training_load_score,
        breakdown.current_debt_hours,
        breakdown.nap_minutes,
        breakdown.recovery_score_yesterday,
      ]
    );
  } finally {
    client.release();
  }
}
/**
 * Get daily need for date
 * @param {string} userId
 * @param {string} targetDate
 * @returns {Promise<Object|null>}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDailyNeed(userId: any, targetDate: any) {
  const client = await getClient(userId);
  try {
    const result = await client.query(
      `SELECT * FROM daily_sleep_need
      WHERE user_id = $1 AND target_date = $2`,
      [userId, targetDate]
    );
    return result.rows[0] || null;
  } finally {
    client.release();
  }
}
export { getSleepHistory };
export { getSleepProfile };
export { updateBaselineSleepNeed };
export { saveCalculation };
export { upsertDayClassification };
export { getDayClassifications };
export { getMCTQStats };
export { getLatestCalculation };
export { upsertDailyNeed };
export { getDailyNeed };
export default {
  getSleepHistory,
  getSleepProfile,
  updateBaselineSleepNeed,
  saveCalculation,
  upsertDayClassification,
  getDayClassifications,
  getMCTQStats,
  getLatestCalculation,
  upsertDailyNeed,
  getDailyNeed,
};
