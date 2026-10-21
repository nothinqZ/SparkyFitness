import { apiCall } from '@/api/api';
import type {
  InsightsReportResponse,
  InsightsTodayResponse,
} from '@workspace/shared';

// Server: routes/v2/insightsRoutes.ts
export const getInsightsToday = (
  lang: string
): Promise<InsightsTodayResponse> =>
  apiCall('/v2/insights/today', {
    method: 'GET',
    params: { summary: '1', lang },
  });

export const getInsightsReport = (
  period: 'week' | 'month',
  date?: string
): Promise<InsightsReportResponse> =>
  apiCall('/v2/insights/report', {
    method: 'GET',
    params: { period, ...(date ? { date } : {}) },
  });
