export const performanceKeys = {
  all: ['performance'] as const,
  overview: (
    userId: string | undefined,
    end: string | undefined,
    days: number
  ) => [...performanceKeys.all, 'overview', userId, end, days] as const,
};
