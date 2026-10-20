import { apiCall } from '@/api/api';
import type { PerformanceOverviewResponse } from '@workspace/shared';

// Server: routes/v2/performanceRoutes.ts
export const getPerformanceOverview = (params: {
  end?: string;
  days: number;
}): Promise<PerformanceOverviewResponse> =>
  apiCall('/v2/performance/overview', {
    method: 'GET',
    params: { days: params.days, ...(params.end ? { end: params.end } : {}) },
  });
