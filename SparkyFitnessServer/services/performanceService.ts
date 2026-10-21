import {
  acuteChronicLoad,
  baselineStatus,
  classifyAcwr,
  epleyOneRepMaxKg,
  isoWeekStart,
  movingAverage,
  paceSecondsPerKm,
  predictRaceTimesRiegel,
  recoveryEstimate,
  sleepConsistency,
  todayInZone,
  weeklyRunSummaries,
  weeklyTrend,
  type DatedValue,
  type PerformanceOverviewResponse,
  type RunRow,
} from '@workspace/shared';
import performanceRepository, {
  type HealthMetricsRow,
} from '../models/performanceRepository.js';
import reportRepository from '../models/reportRepository.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';

const DAY_MS = 86_400_000;
// Chronic load needs 27 days before the range; baselines need 60 before the
// last week.
const LOAD_LOOKBACK_DAYS = 27;
const BASELINE_LOOKBACK_DAYS = 67;
const TOP_LIFTS = 6;

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

const inRange = (date: string, start: string, end: string) =>
  date >= start && date <= end;

const avg = (values: number[]) =>
  values.length
    ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10
    : null;

/**
 * The wearable summary for `end` (Garmin Connect's "My Day"): that day's
 * metrics row, falling back to the day before when the device has not synced
 * today yet. Last night's sleep comes from the sleep entry dated `end`.
 */
export function buildToday(
  metricRows: readonly HealthMetricsRow[],
  sleepByDate: ReadonlyMap<string, { hours: number; score: number | null }>,
  end: string
): PerformanceOverviewResponse['today'] {
  const row =
    metricRows.find((m) => m.date === end) ??
    metricRows.find((m) => m.date === shiftDay(end, -1));
  const sleep = sleepByDate.get(end);
  if (!row && !sleep) return null;
  return {
    date: row?.date ?? end,
    bodyBatteryHighest: num(row?.body_battery_highest),
    bodyBatteryLowest: num(row?.body_battery_lowest),
    bodyBatteryCharged: num(row?.body_battery_charged),
    bodyBatteryDrained: num(row?.body_battery_drained),
    avgStress: num(row?.avg_stress_level),
    steps: num(row?.total_steps),
    stepGoal: num(row?.step_goal),
    restingHr: num(row?.resting_heart_rate),
    trainingReadiness: num(row?.training_readiness_score),
    recoveryTimeHours: num(row?.recovery_time_hours),
    sleepHours: sleep?.hours ?? null,
    sleepScore: sleep?.score ?? null,
  };
}

export function summarizeStrength(
  sets: ReadonlyArray<{
    date: string;
    exercise_id: string | null;
    exercise_name: string;
    weight: string | number;
    reps: number;
  }>
): PerformanceOverviewResponse['strength'] {
  const weekly = new Map<
    string,
    { volumeKg: number; sets: number; days: Set<string> }
  >();
  const lifts = new Map<
    string,
    {
      exerciseId: string | null;
      exerciseName: string;
      bestE1rmKg: number;
      bestDate: string;
      sets: number;
      byDay: Map<string, number>;
    }
  >();
  for (const s of sets) {
    const weight = Number(s.weight);
    const reps = Number(s.reps);
    const week = isoWeekStart(s.date);
    const w = weekly.get(week) ?? { volumeKg: 0, sets: 0, days: new Set() };
    w.volumeKg += weight * reps;
    w.sets += 1;
    w.days.add(s.date);
    weekly.set(week, w);

    // Epley is unreliable beyond ~10 reps; those sets count for volume only.
    if (reps > 10) continue;
    const e1rm = epleyOneRepMaxKg(weight, reps);
    const key = s.exercise_id ?? s.exercise_name.toLowerCase();
    const lift = lifts.get(key) ?? {
      exerciseId: s.exercise_id,
      exerciseName: s.exercise_name,
      bestE1rmKg: 0,
      bestDate: s.date,
      sets: 0,
      byDay: new Map<string, number>(),
    };
    lift.sets += 1;
    if (e1rm > lift.bestE1rmKg) {
      lift.bestE1rmKg = e1rm;
      lift.bestDate = s.date;
    }
    lift.byDay.set(s.date, Math.max(lift.byDay.get(s.date) ?? 0, e1rm));
    lifts.set(key, lift);
  }
  return {
    provenance: 'estimated',
    weekly: [...weekly.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekStart, w]) => ({
        weekStart,
        volumeKg: Math.round(w.volumeKg),
        sets: w.sets,
        days: w.days.size,
      })),
    topLifts: [...lifts.values()]
      .sort((a, b) => b.sets - a.sets || b.bestE1rmKg - a.bestE1rmKg)
      .slice(0, TOP_LIFTS)
      .map((l) => ({
        exerciseId: l.exerciseId,
        exerciseName: l.exerciseName,
        bestE1rmKg: Math.round(l.bestE1rmKg * 10) / 10,
        bestDate: l.bestDate,
        sets: l.sets,
        trend: [...l.byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([date, value]) => ({
            date,
            value: Math.round(value * 10) / 10,
          })),
      })),
  };
}

async function getOverview(
  targetUserId: string,
  authenticatedUserId: string,
  options: { end?: string; days: number }
): Promise<PerformanceOverviewResponse> {
  const timezone = await loadUserTimezone(targetUserId);
  const end = options.end ?? todayInZone(timezone);
  const start = shiftDay(end, -(options.days - 1));
  const earliest = shiftDay(
    start < shiftDay(end, -BASELINE_LOOKBACK_DAYS)
      ? start
      : shiftDay(end, -BASELINE_LOOKBACK_DAYS),
    -LOAD_LOOKBACK_DAYS
  );

  const [
    runRows,
    loadRows,
    metricRows,
    sleepRows,
    setRows,
    nutrition,
    weights,
  ] = await Promise.all([
    performanceRepository.getRuns(
      targetUserId,
      authenticatedUserId,
      start,
      end
    ),
    performanceRepository.getDailyTrainingLoad(
      targetUserId,
      authenticatedUserId,
      shiftDay(start, -LOAD_LOOKBACK_DAYS),
      end
    ),
    performanceRepository.getHealthMetrics(
      targetUserId,
      authenticatedUserId,
      earliest,
      end
    ),
    performanceRepository.getSleep(
      targetUserId,
      authenticatedUserId,
      earliest,
      end
    ),
    performanceRepository.getStrengthSets(
      targetUserId,
      authenticatedUserId,
      start,
      end
    ),
    reportRepository.getDailyNutritionTotalsRange(targetUserId, start, end),
    reportRepository.getBodyWeightReadings(targetUserId, start, end),
  ]);

  // --- running
  const runs: RunRow[] = runRows.map((r) => ({
    date: r.date,
    distanceKm: Number(r.distance),
    durationMinutes: Number(r.duration_minutes),
    avgHeartRate: num(r.avg_heart_rate),
  }));
  const estimatedPredictions = predictRaceTimesRiegel(runs);
  const latestDevicePrediction = [...metricRows]
    .reverse()
    .find(
      (m) => m.race_prediction_5k_seconds || m.race_prediction_marathon_seconds
    );
  const vo2max = metricRows
    .filter((m) => num(m.vo2_max) !== null && inRange(m.date, start, end))
    .map((m) => ({ date: m.date, value: num(m.vo2_max)! }));

  // --- load
  const estimatedLoad = acuteChronicLoad(
    loadRows.map((r) => ({ date: r.date, value: Number(r.value) })),
    start,
    end
  );
  const deviceLoad = metricRows
    .filter(
      (m) =>
        inRange(m.date, start, end) &&
        (num(m.acwr_ratio) !== null || num(m.acute_training_load) !== null)
    )
    .map((m) => ({
      date: m.date,
      acute: num(m.acute_training_load),
      chronic: num(m.chronic_training_load),
      ratio: num(m.acwr_ratio),
    }));
  const lastDevice = deviceLoad.at(-1);
  const lastEstimated = [...estimatedLoad]
    .reverse()
    .find((p) => p.ratio !== null);
  // Garmin's own ratio wins when it is recent (within 3 days of `end`).
  const current =
    lastDevice &&
    lastDevice.ratio !== null &&
    lastDevice.date >= shiftDay(end, -3)
      ? { ratio: lastDevice.ratio, provenance: 'device' as const }
      : lastEstimated && lastEstimated.ratio !== null
        ? { ratio: lastEstimated.ratio, provenance: 'estimated' as const }
        : null;

  // --- recovery
  const hrvSeries: DatedValue[] = sleepRows
    .filter((s) => num(s.avg_overnight_hrv) !== null)
    .map((s) => ({ date: s.date, value: num(s.avg_overnight_hrv)! }));
  const rhrSeries: DatedValue[] = metricRows
    .filter((m) => num(m.resting_heart_rate) !== null)
    .map((m) => ({ date: m.date, value: num(m.resting_heart_rate)! }));
  const hrvStatus = baselineStatus(hrvSeries, end);
  const rhrStatus = baselineStatus(rhrSeries, end);
  const sleepInRange = sleepRows.filter((s) => inRange(s.date, start, end));
  const sleepHours = sleepInRange.map((s) => ({
    date: s.date,
    hours:
      Math.round(
        ((s.time_asleep_in_seconds ?? s.duration_in_seconds) / 3600) * 100
      ) / 100,
    score: num(s.sleep_score),
  }));
  const consistency = sleepConsistency(
    sleepInRange.slice(-30).map((s) => ({
      date: s.date,
      bedtime: new Date(s.bedtime).toISOString(),
      durationSeconds: s.duration_in_seconds,
      timeAsleepSeconds: s.time_asleep_in_seconds,
    })),
    timezone
  );
  const lastNight = sleepHours.at(-1);
  const readinessDevice = [...metricRows]
    .reverse()
    .find(
      (m) => m.training_readiness_score !== null && m.date >= shiftDay(end, -1)
    );

  // --- nutrition
  const nutritionDaily = (nutrition as Array<Record<string, unknown>>).map(
    (row) => ({
      date:
        row.entry_date instanceof Date
          ? row.entry_date.toISOString().slice(0, 10)
          : String(row.entry_date).slice(0, 10),
      calories: Math.round(Number(row.calories) || 0),
      protein: Math.round((Number(row.protein) || 0) * 10) / 10,
      carbs: Math.round((Number(row.carbs) || 0) * 10) / 10,
      fat: Math.round((Number(row.fat) || 0) * 10) / 10,
    })
  );
  const logged = nutritionDaily.filter((d) => d.calories > 0);

  // --- body
  const weightSeries = weights
    .filter((w) => inRange(w.date, start, end))
    .map((w) => ({ date: w.date, value: Number(w.weightKg) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    range: { start, end, timezone },
    today: buildToday(
      metricRows,
      new Map(sleepHours.map((s) => [s.date, s])),
      end
    ),
    running: {
      provenance: 'measured',
      totals: {
        runs: runs.length,
        distanceKm:
          Math.round(runs.reduce((s, r) => s + r.distanceKm, 0) * 100) / 100,
        durationMinutes: Math.round(
          runs.reduce((s, r) => s + r.durationMinutes, 0)
        ),
      },
      weekly: weeklyRunSummaries(runs),
      runs: runs.map((r) => ({
        date: r.date,
        distanceKm: Math.round(r.distanceKm * 100) / 100,
        durationMinutes: Math.round(r.durationMinutes * 10) / 10,
        paceSecondsPerKm: (() => {
          const p = paceSecondsPerKm(r);
          return p === null ? null : Math.round(p);
        })(),
        avgHeartRate: r.avgHeartRate ?? null,
      })),
      predictions: {
        estimated: {
          '5k': estimatedPredictions['5k']?.seconds ?? null,
          '10k': estimatedPredictions['10k']?.seconds ?? null,
          half_marathon: estimatedPredictions.half_marathon?.seconds ?? null,
          marathon: estimatedPredictions.marathon?.seconds ?? null,
        },
        device: latestDevicePrediction
          ? {
              '5k': latestDevicePrediction.race_prediction_5k_seconds,
              '10k': latestDevicePrediction.race_prediction_10k_seconds,
              half_marathon:
                latestDevicePrediction.race_prediction_half_marathon_seconds,
              marathon: latestDevicePrediction.race_prediction_marathon_seconds,
            }
          : null,
        deviceDate: latestDevicePrediction?.date ?? null,
      },
      vo2max,
    },
    strength: summarizeStrength(setRows),
    load: {
      estimated: estimatedLoad,
      device: deviceLoad,
      current: current
        ? { ...current, zone: classifyAcwr(current.ratio)! }
        : null,
    },
    recovery: {
      hrv: {
        series: hrvSeries.filter((p) => inRange(p.date, start, end)),
        status: hrvStatus,
      },
      restingHr: {
        series: rhrSeries.filter((p) => inRange(p.date, start, end)),
        status: rhrStatus,
      },
      sleep: { series: sleepHours, ...consistency },
      readiness: {
        estimated: recoveryEstimate({
          hrv: hrvStatus,
          restingHr: rhrStatus,
          lastNightSleepHours: lastNight?.date === end ? lastNight.hours : null,
          acwr: current?.ratio ?? null,
        }),
        device: readinessDevice?.training_readiness_score ?? null,
      },
    },
    nutrition: {
      daily: nutritionDaily,
      averages: {
        days: logged.length,
        calories: avg(logged.map((d) => d.calories)),
        protein: avg(logged.map((d) => d.protein)),
        carbs: avg(logged.map((d) => d.carbs)),
        fat: avg(logged.map((d) => d.fat)),
      },
    },
    body: {
      weight: weightSeries,
      weightAverage7d: movingAverage(weightSeries, 7),
      trendKgPerWeek: weeklyTrend(weightSeries),
    },
  };
}

export default { getOverview };
