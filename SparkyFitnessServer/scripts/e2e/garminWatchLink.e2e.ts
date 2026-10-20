// Runs the real Garmin activity processor against a real database to prove a
// watch-uploaded session is linked, not duplicated, when Garmin reports it.
// Needs the server's DB env and a user who already uploaded a watch session
// starting 2026-10-20T06:00:00Z (scripts/e2e/watch-sync.e2e.mjs creates one).
//
//   npx tsx scripts/e2e/garminWatchLink.e2e.ts <user-id>
import assert from 'node:assert/strict';
import { getSystemClient } from '../../db/poolManager.js';
import { processActivitiesAndWorkouts } from '../../services/garmin/garminActivityProcessor.js';

const userId = process.argv[2];
assert.ok(userId, 'usage: garminWatchLink.e2e.ts <user-id>');

const strength = {
  activity: {
    activityId: 9_000_001,
    activityName: 'Strength',
    startTimeGMT: '2026-10-20 06:01:30',
    startTimeLocal: '2026-10-20 08:01:30',
    activityType: { typeKey: 'strength_training' },
    duration: 2700,
    calories: 310,
    averageHR: 118,
  },
};
const run = {
  activity: {
    activityId: 9_000_002,
    activityName: 'Evening Run',
    startTimeGMT: '2026-10-20 17:00:00',
    startTimeLocal: '2026-10-20 19:00:00',
    activityType: { typeKey: 'running' },
    duration: 1800,
    distance: 5000,
    calories: 350,
  },
};

async function counts() {
  const client = await getSystemClient();
  try {
    const r = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM exercise_preset_entries WHERE user_id = $1) AS presets,
         (SELECT COUNT(*)::int FROM exercise_entries WHERE user_id = $1 AND source = 'garmin') AS garmin_entries,
         (SELECT COUNT(*)::int FROM watch_session_imports WHERE user_id = $1 AND linked_garmin_activity_id = '9000001') AS linked,
         (SELECT COUNT(*)::int FROM exercise_entry_activity_details d
            JOIN watch_session_imports w ON w.exercise_preset_entry_id = d.exercise_preset_entry_id
           WHERE w.user_id = $1 AND d.detail_type = 'linked_watch_activity') AS details`,
      [userId]
    );
    return r.rows[0];
  } finally {
    client.release();
  }
}

const before = await counts();
for (let i = 0; i < 2; i++) {
  // Twice: a re-sync of the same range must stay idempotent.
  await processActivitiesAndWorkouts(
    userId,
    { activities: [strength, run] },
    '2026-10-20',
    '2026-10-20',
    'Europe/Berlin'
  );
}
const after = await counts();
console.log({ before, after });
assert.equal(
  after.presets,
  before.presets,
  'strength activity created a second workout'
);
// The range is re-created on every sync, so the run exists exactly once.
assert.equal(after.garmin_entries, 1, 'run should be imported exactly once');
assert.equal(after.linked, 1);
assert.equal(after.details, 1);
console.log('garmin/watch link e2e: all checks passed');
process.exit(0);
