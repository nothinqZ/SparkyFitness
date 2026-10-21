/**
 * Prefer Garmin for activities that Apple Health sends back through HealthKit.
 *
 * The raw HealthKit row remains stored and automatically becomes visible again
 * if its matching Garmin activity disappears. Active Calories is a daily
 * summary, not a workout, and is intentionally never filtered here.
 */
export function preferredExerciseClause(alias: string): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('Invalid internal SQL alias');
  return `(lower(coalesce(${alias}.source, '')) <> 'healthkit'
    OR ${alias}.exercise_name = 'Active Calories'
    OR NOT (
      EXISTS (
        SELECT 1 FROM exercise_entries garmin_primary
        WHERE garmin_primary.user_id = ${alias}.user_id
          AND lower(coalesce(garmin_primary.source, '')) = 'garmin'
          AND garmin_primary.exercise_preset_entry_id IS NULL
          AND garmin_primary.entry_date = ${alias}.entry_date
          AND abs(coalesce(garmin_primary.duration_minutes, -1) - coalesce(${alias}.duration_minutes, -2)) < 0.000001
          AND abs(coalesce(garmin_primary.calories_burned, -1) - coalesce(${alias}.calories_burned, -2)) < 0.000001
      )
      OR EXISTS (
        SELECT 1
        FROM exercise_preset_entries garmin_session
        JOIN exercise_entry_activity_details garmin_detail
          ON garmin_detail.exercise_preset_entry_id = garmin_session.id
         AND lower(garmin_detail.provider_name) = 'garmin'
         AND garmin_detail.detail_type = 'full_activity_data'
        WHERE garmin_session.user_id = ${alias}.user_id
          AND garmin_session.entry_date = ${alias}.entry_date
          AND abs(coalesce((garmin_detail.detail_data #>> '{activity,duration}')::numeric, -1) - coalesce(${alias}.duration_minutes, -2)) < 0.000001
          AND abs(coalesce(
            nullif(garmin_detail.detail_data #>> '{activity,active_calories}', '')::numeric,
            nullif(garmin_detail.detail_data #>> '{activity,calories}', '')::numeric
              - nullif(garmin_detail.detail_data #>> '{activity,bmrCalories}', '')::numeric,
            -1
          ) - coalesce(${alias}.calories_burned, -2)) < 0.000001
      )
    ))`;
}

/** Hide device summary rows from lists of actual workout sessions. */
export function visibleWorkoutClause(alias: string): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('Invalid internal SQL alias');
  return `(${preferredExerciseClause(alias)} AND ${alias}.exercise_name IS DISTINCT FROM 'Active Calories')`;
}
