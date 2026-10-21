export const performanceKeys = {
  all: ['performance'] as const,
  overview: (
    userId: string | undefined,
    end: string | undefined,
    days: number
  ) => [...performanceKeys.all, 'overview', userId, end, days] as const,
  insightsToday: (userId: string | undefined, lang: string) =>
    [...performanceKeys.all, 'insights', 'today', userId, lang] as const,
  insightsReport: (userId: string | undefined, period: 'week' | 'month') =>
    [...performanceKeys.all, 'insights', 'report', userId, period] as const,
};
