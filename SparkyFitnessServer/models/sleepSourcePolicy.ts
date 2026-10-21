/** Prefer Garmin only for an exact duplicate interval. Keep both raw sources. */
export function preferredSleepClause(alias: string): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('Invalid internal SQL alias');
  return `(lower(coalesce(${alias}.source, '')) <> 'healthkit' OR NOT EXISTS (
    SELECT 1 FROM sleep_entries garmin_primary
    WHERE garmin_primary.user_id = ${alias}.user_id
      AND lower(garmin_primary.source) = 'garmin'
      AND garmin_primary.entry_date = ${alias}.entry_date
      AND garmin_primary.bedtime = ${alias}.bedtime
      AND garmin_primary.wake_time = ${alias}.wake_time
  ))`;
}
