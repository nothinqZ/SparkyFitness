// End-to-end check of GET /api/v2/performance/overview against a running
// server and its real database. Signs up a throwaway user over the API,
// seeds 70 days of runs, strength sets, sleep, health metrics, food and
// weight directly in SQL, then validates the response shape and values.
// Never point it at a production database.
//
//   SPARKY_E2E_BASE_URL=http://localhost:3010 npx tsx scripts/e2e/performanceOverview.e2e.ts
import assert from 'node:assert/strict';
import pg from 'pg';
import { performanceOverviewResponseSchema } from '@workspace/shared';

const BASE = process.env.SPARKY_E2E_BASE_URL ?? 'http://localhost:3010';
const ORIGIN = process.env.SPARKY_E2E_ORIGIN ?? 'http://localhost:3004';
const END = '2026-10-20';

const day = (offset: number) =>
  new Date(Date.parse(`${END}T00:00:00Z`) - offset * 86_400_000)
    .toISOString()
    .slice(0, 10);

const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
  body: JSON.stringify({
    email: `e2e-perf-${Date.now()}@example.test`,
    password: 'E2e-password-123!',
    name: 'perf',
  }),
});
assert.equal(signUp.status, 200);
const userId = ((await signUp.json()) as { user: { id: string } }).user.id;
const cookie = signUp.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');

const db = new pg.Client({
  host: process.env.SPARKY_FITNESS_DB_HOST,
  port: Number(process.env.SPARKY_FITNESS_DB_PORT ?? 5432),
  user: process.env.SPARKY_FITNESS_DB_USER,
  password: process.env.SPARKY_FITNESS_DB_PASSWORD,
  database: process.env.SPARKY_FITNESS_DB_NAME,
});
await db.connect();
try {
  await db.query('BEGIN');
  for (let i = 0; i < 70; i++) {
    const d = day(i);
    // Health metrics: RHR 50 for the baseline, 58 in the last week (elevated).
    await db.query(
      `INSERT INTO daily_health_metrics (user_id, entry_date, source_provider, resting_heart_rate,
         vo2_max, race_prediction_5k_seconds, race_prediction_marathon_seconds, acwr_ratio,
         acute_training_load, chronic_training_load, training_readiness_score)
       VALUES ($1, $2, 'garmin', $3, 52, 1260, 12000, $4, 300, 280, $5)`,
      [
        userId,
        d,
        i < 7 ? 58 : 50 + (i % 2),
        i === 0 ? 1.07 : null,
        i === 0 ? 64 : null,
      ]
    );
    // Sleep: 7.5 h, bedtime 23:00 UTC, HRV 60 baseline / 45 last week.
    const bed = new Date(Date.parse(`${d}T00:00:00Z`) - 3600_000).toISOString();
    const wake = new Date(Date.parse(bed) + 7.5 * 3600_000).toISOString();
    await db.query(
      `INSERT INTO sleep_entries (user_id, entry_date, bedtime, wake_time, duration_in_seconds,
         time_asleep_in_seconds, sleep_score, source, avg_overnight_hrv)
       VALUES ($1, $2, $3, $4, 27000, 27000, 80, 'garmin', $5)`,
      [userId, d, bed, wake, i < 7 ? 45 : 60 + (i % 3)]
    );
  }
  // Runs: 5 km in 25:00 every Monday-ish, last one a 10 km in 50:00.
  for (const [offset, km, min] of [
    [1, 10, 50],
    [8, 5, 25],
    [15, 5, 25],
    [22, 5, 26],
  ] as const) {
    await db.query(
      `INSERT INTO exercise_entries (user_id, entry_date, exercise_name, category, duration_minutes,
         calories_burned, distance, avg_heart_rate, training_load, source)
       VALUES ($1, $2, 'Running', 'running', $3, 400, $4, 150, 120, 'garmin')`,
      [userId, day(offset), min, km]
    );
  }
  // A walk must not count as a run; a crunch must not either.
  await db.query(
    `INSERT INTO exercise_entries (user_id, entry_date, exercise_name, category, duration_minutes,
       calories_burned, distance, source)
     VALUES ($1, $2, 'Walking', 'cardio', 60, 200, 5, 'garmin'),
            ($1, $2, 'Bicycle Crunch', 'cardio', 5, 20, 0, 'manual')`,
    [userId, day(2)]
  );
  // Strength: squat 100x5 (e1RM 116.7), 3 sets; and a warm-up that is ignored.
  const squat = await db.query(
    `INSERT INTO exercise_entries (user_id, entry_date, exercise_name, category, duration_minutes,
       calories_burned, modality, source)
     VALUES ($1, $2, 'Back Squat', 'strength', 30, 150, 'weight_reps', 'manual') RETURNING id`,
    [userId, day(3)]
  );
  for (const [n, type, w, r] of [
    [1, 'Warm-up', 60, 10],
    [2, 'Working Set', 100, 5],
    [3, 'Working Set', 100, 5],
    [4, 'Working Set', 95, 6],
  ] as const) {
    await db.query(
      `INSERT INTO exercise_entry_sets (exercise_entry_id, set_number, set_type, weight, reps)
       VALUES ($1, $2, $3, $4, $5)`,
      [squat.rows[0].id, n, type, w, r]
    );
  }
  // Weight: 80 -> 78.6 over 15 days (-0.1 kg/day).
  for (let i = 0; i < 15; i++) {
    await db.query(
      'INSERT INTO check_in_measurements (user_id, entry_date, weight) VALUES ($1, $2, $3)',
      [userId, day(14 - i), 80 - i * 0.1]
    );
  }
  // Food: one entry, 2 servings of 300 kcal / 25 g protein.
  await db.query(
    `INSERT INTO food_entries (user_id, entry_date, meal_type_id, quantity, unit, serving_size,
       food_name, calories, protein, carbs, fat)
     VALUES ($1, $2, (SELECT id FROM meal_types ORDER BY sort_order NULLS LAST LIMIT 1),
             2, 'serving', 1, 'Oats', 300, 25, 40, 8)`,
    [userId, day(0)]
  );
  await db.query('COMMIT');
} catch (error) {
  await db.query('ROLLBACK');
  throw error;
} finally {
  await db.end();
}

const res = await fetch(
  `${BASE}/api/v2/performance/overview?end=${END}&days=30`,
  {
    headers: { Cookie: cookie, Origin: ORIGIN },
  }
);
const body = await res.json();
assert.equal(res.status, 200, JSON.stringify(body));
const overview = performanceOverviewResponseSchema.parse(body);

assert.deepEqual(overview.range, { start: day(29), end: END, timezone: 'UTC' });
assert.equal(overview.running.totals.runs, 4, 'walk and crunch must not count');
assert.equal(overview.running.totals.distanceKm, 25);
assert.equal(overview.running.runs.at(-1)?.paceSecondsPerKm, 300);
// Riegel from the 10 km in 50:00 (best predictor for 10k): exactly 3000 s.
assert.equal(overview.running.predictions.estimated['10k'], 3000);
assert.equal(overview.running.predictions.device?.['5k'], 1260);
assert.equal(overview.running.vo2max.length, 30);

assert.equal(overview.strength.topLifts[0]?.exerciseName, 'Back Squat');
assert.equal(overview.strength.topLifts[0]?.sets, 3, 'warm-up excluded');
assert.equal(overview.strength.topLifts[0]?.bestE1rmKg, 116.7);
assert.equal(
  overview.strength.weekly.reduce((s, w) => s + w.volumeKg, 0),
  1570
);

assert.equal(overview.load.current?.provenance, 'device');
assert.equal(overview.load.current?.ratio, 1.07);
assert.equal(overview.load.current?.zone, 'optimal');
assert.equal(overview.load.estimated.length, 30);

assert.equal(overview.recovery.hrv.status.status, 'below');
assert.equal(overview.recovery.restingHr.status.status, 'above');
assert.equal(overview.recovery.sleep.avgSleepHours, 7.5);
assert.equal(overview.recovery.sleep.meanBedtimeMinutes, 23 * 60);
assert.equal(overview.recovery.sleep.bedtimeStdDevMinutes, 0);
assert.equal(overview.recovery.readiness.device, 64);
assert.ok(
  overview.recovery.readiness.estimated,
  'estimate from HRV, RHR, sleep, load'
);
assert.ok(
  overview.recovery.readiness.estimated.score < 50,
  'low HRV + high RHR lower it'
);

assert.equal(overview.nutrition.averages.days, 1);
assert.equal(overview.nutrition.averages.calories, 600);
assert.equal(overview.nutrition.averages.protein, 50);

assert.equal(overview.body.weight.length, 15);
assert.equal(overview.body.trendKgPerWeek, -0.7);

const bad = await fetch(`${BASE}/api/v2/performance/overview?days=1000`, {
  headers: { Cookie: cookie, Origin: ORIGIN },
});
assert.equal(bad.status, 400);
const anonymous = await fetch(`${BASE}/api/v2/performance/overview`);
assert.equal(anonymous.status, 401);

console.log('performance overview e2e: all checks passed');
