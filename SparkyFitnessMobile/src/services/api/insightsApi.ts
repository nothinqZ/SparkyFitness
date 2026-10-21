import type {
  InsightsReportResponse,
  InsightsTodayResponse,
} from '@workspace/shared';
import { apiFetch } from './apiClient';

const SERVICE = 'Insights API';

/** Server: SparkyFitnessServer/routes/v2/insightsRoutes.ts */
export const fetchInsightsToday = (
  lang: string
): Promise<InsightsTodayResponse> =>
  apiFetch<InsightsTodayResponse>({
    endpoint: `/api/v2/insights/today?summary=1&lang=${encodeURIComponent(lang)}`,
    serviceName: SERVICE,
    operation: 'fetch today insights',
    // The optional AI wording can take a few seconds.
    timeoutMs: 45_000,
  });

export const fetchInsightsReport = (
  period: 'week' | 'month',
  date?: string
): Promise<InsightsReportResponse> =>
  apiFetch<InsightsReportResponse>({
    endpoint: `/api/v2/insights/report?period=${period}${date ? `&date=${date}` : ''}`,
    serviceName: SERVICE,
    operation: 'fetch insights report',
  });
