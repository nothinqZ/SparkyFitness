import { z } from 'zod';

// GET /api/v2/performance/overview — the desktop performance dashboard.
// Every block says where its numbers come from (see analytics/performance.ts):
// "measured" by a device or the user, computed by the "device" vendor, or
// "estimated" here.

const provenance = z.enum(['measured', 'device', 'estimated']);
const dated = z.object({ date: z.string(), value: z.number() });

const baseline = z.object({
  recent: z.number().nullable(),
  baseline: z.number().nullable(),
  baselineStdDev: z.number().nullable(),
  zScore: z.number().nullable(),
  status: z.enum(['below', 'within', 'above', 'insufficient_data']),
});

const raceTimes = z.object({
  '5k': z.number().nullable(),
  '10k': z.number().nullable(),
  half_marathon: z.number().nullable(),
  marathon: z.number().nullable(),
});

// The latest day's wearable summary, as Garmin Connect's "My Day" shows it.
// All values are device-reported; null when the device did not send them.
const today = z.object({
  date: z.string(),
  bodyBatteryHighest: z.number().nullable(),
  bodyBatteryLowest: z.number().nullable(),
  bodyBatteryCharged: z.number().nullable(),
  bodyBatteryDrained: z.number().nullable(),
  avgStress: z.number().nullable(),
  steps: z.number().nullable(),
  stepGoal: z.number().nullable(),
  restingHr: z.number().nullable(),
  trainingReadiness: z.number().nullable(),
  recoveryTimeHours: z.number().nullable(),
  sleepHours: z.number().nullable(),
  sleepScore: z.number().nullable(),
});

const raceRange = z
  .object({ low: z.number(), high: z.number(), samples: z.number() })
  .nullable();

export const performanceOverviewQuerySchema = z.object({
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  days: z.coerce.number().int().min(7).max(366).default(90),
});

export const performanceOverviewResponseSchema = z.object({
  range: z.object({ start: z.string(), end: z.string(), timezone: z.string() }),
  today: today.nullable(),
  running: z.object({
    provenance: provenance,
    totals: z.object({
      runs: z.number(),
      distanceKm: z.number(),
      durationMinutes: z.number(),
    }),
    weekly: z.array(
      z.object({
        weekStart: z.string(),
        distanceKm: z.number(),
        runs: z.number(),
        durationMinutes: z.number(),
        avgPaceSecondsPerKm: z.number().nullable(),
      })
    ),
    runs: z.array(
      z.object({
        date: z.string(),
        distanceKm: z.number(),
        durationMinutes: z.number(),
        paceSecondsPerKm: z.number().nullable(),
        avgHeartRate: z.number().nullable(),
      })
    ),
    predictions: z.object({
      estimated: raceTimes,
      device: raceTimes.nullable(),
      deviceDate: z.string().nullable(),
      // Riegel band from the three best-predicting runs (estimated).
      estimatedRange: z.object({
        '5k': raceRange,
        '10k': raceRange,
        half_marathon: raceRange,
        marathon: raceRange,
      }),
    }),
    vo2max: z.array(dated),
    // Days with a hard run (fast, long or 75+ min), for hybrid hints.
    hardRunDates: z.array(z.string()),
  }),
  strength: z.object({
    provenance: provenance,
    // Days with a weighted leg exercise.
    legDays: z.array(z.string()),
    weekly: z.array(
      z.object({
        weekStart: z.string(),
        volumeKg: z.number(),
        sets: z.number(),
        /** Days with logged strength sets in that week. */
        days: z.number().optional(),
      })
    ),
    topLifts: z.array(
      z.object({
        exerciseId: z.string().nullable(),
        exerciseName: z.string(),
        bestE1rmKg: z.number(),
        bestDate: z.string(),
        sets: z.number(),
        trend: z.array(dated),
      })
    ),
  }),
  load: z.object({
    estimated: z.array(
      z.object({
        date: z.string(),
        acute: z.number(),
        chronic: z.number(),
        ratio: z.number().nullable(),
      })
    ),
    device: z.array(
      z.object({
        date: z.string(),
        acute: z.number().nullable(),
        chronic: z.number().nullable(),
        ratio: z.number().nullable(),
      })
    ),
    current: z
      .object({
        ratio: z.number(),
        zone: z.enum(['low', 'optimal', 'high', 'very_high']),
        provenance: provenance,
      })
      .nullable(),
    // Garmin-style status from load zone, VO2max trend and HRV (estimated).
    trainingStatus: z
      .object({
        status: z.enum([
          'productive',
          'maintaining',
          'recovery',
          'unproductive',
          'strained',
          'overreaching',
          'detraining',
        ]),
        provenance: z.literal('estimated'),
        vo2TrendPerWeek: z.number().nullable(),
      })
      .nullable(),
  }),
  recovery: z.object({
    hrv: z.object({ series: z.array(dated), status: baseline }),
    restingHr: z.object({ series: z.array(dated), status: baseline }),
    sleep: z.object({
      series: z.array(
        z.object({
          date: z.string(),
          hours: z.number(),
          score: z.number().nullable(),
        })
      ),
      nights: z.number(),
      bedtimeStdDevMinutes: z.number().nullable(),
      meanBedtimeMinutes: z.number().nullable(),
      avgSleepHours: z.number().nullable(),
    }),
    readiness: z.object({
      estimated: z
        .object({
          score: z.number(),
          components: z.record(z.string(), z.number()),
        })
        .nullable(),
      device: z.number().nullable(),
    }),
  }),
  nutrition: z.object({
    daily: z.array(
      z.object({
        date: z.string(),
        calories: z.number(),
        protein: z.number(),
        carbs: z.number(),
        fat: z.number(),
      })
    ),
    averages: z.object({
      days: z.number(),
      calories: z.number().nullable(),
      protein: z.number().nullable(),
      carbs: z.number().nullable(),
      fat: z.number().nullable(),
    }),
  }),
  body: z.object({
    weight: z.array(dated),
    weightAverage7d: z.array(dated),
    trendKgPerWeek: z.number().nullable(),
  }),
});

export type PerformanceOverviewQuery = z.infer<
  typeof performanceOverviewQuerySchema
>;
export type PerformanceOverviewResponse = z.infer<
  typeof performanceOverviewResponseSchema
>;
