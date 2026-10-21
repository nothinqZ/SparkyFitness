import { z } from 'zod';

// Fitness insights (personal edition): the "Today" card and period reports,
// built from deterministic rules in analytics/insights.ts. Server:
// SparkyFitnessServer/routes/v2/insightsRoutes.ts.

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const fitnessFindingSchema = z.object({
  id: z.string(),
  area: z.enum([
    'recovery',
    'load',
    'strength',
    'sleep',
    'body',
    'nutrition',
    'consistency',
  ]),
  kind: z.enum(['observation', 'hypothesis', 'finding']),
  severity: z.enum(['info', 'notice', 'warning']),
  tone: z.enum(['positive', 'neutral', 'caution']),
  params: z.record(z.string(), z.union([z.number(), z.string()])),
  evidence: z.array(
    z.object({
      metric: z.string(),
      value: z.union([z.number(), z.string()]),
      unit: z.string().optional(),
      period: z.string(),
      source: z.enum(['measured', 'device', 'estimated', 'logged']),
    })
  ),
  confidence: z.enum(['low', 'medium', 'high']),
});

export const insightsTodayQuerySchema = z.object({
  /** Ask the user's configured AI service to word the findings. */
  summary: z
    .enum(['0', '1', 'true', 'false'])
    .optional()
    .transform((v) => v === '1' || v === 'true'),
  lang: z.string().max(10).optional(),
});

export const insightsTodayResponseSchema = z.object({
  asOf: dateString,
  /** End of the data the findings are based on (fitness-next: last night's copy). */
  dataThrough: dateString,
  findings: z.array(fitnessFindingSchema),
  missing: z.array(z.string()),
  readiness: z.object({
    estimated: z.number().nullable(),
    components: z.record(z.string(), z.number()),
    device: z.number().nullable(),
  }),
  summary: z
    .object({
      text: z.string(),
      source: z.literal('ai'),
    })
    .nullable(),
});

export const insightsReportQuerySchema = z.object({
  period: z.enum(['week', 'month']).default('week'),
  /** Any day in the period; defaults to the last complete week / month. */
  date: dateString.optional(),
});

const periodTotals = z.object({
  strengthDays: z.number(),
  strengthSets: z.number(),
  strengthVolumeKg: z.number(),
  runs: z.number(),
  runDistanceKm: z.number(),
  avgSleepHours: z.number().nullable(),
  avgHrv: z.number().nullable(),
  avgRestingHr: z.number().nullable(),
  avgCalories: z.number().nullable(),
  avgProtein: z.number().nullable(),
  nutritionDays: z.number(),
  weightStart: z.number().nullable(),
  weightEnd: z.number().nullable(),
});

export const insightsReportResponseSchema = z.object({
  period: z.enum(['week', 'month']),
  start: dateString,
  end: dateString,
  totals: periodTotals,
  previous: periodTotals,
  /** Lifts whose best of the last 90 days fell into this period. */
  bests: z.array(
    z.object({ exercise: z.string(), e1rmKg: z.number(), date: dateString })
  ),
  findings: z.array(fitnessFindingSchema),
  missing: z.array(z.string()),
});

export type InsightsTodayQuery = z.infer<typeof insightsTodayQuerySchema>;
export type InsightsTodayResponse = z.infer<typeof insightsTodayResponseSchema>;
export type InsightsReportQuery = z.infer<typeof insightsReportQuerySchema>;
export type InsightsReportResponse = z.infer<
  typeof insightsReportResponseSchema
>;
