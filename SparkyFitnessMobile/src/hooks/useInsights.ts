import { useQuery } from '@tanstack/react-query';
import { getAppLocale } from '../localization';
import {
  fetchInsightsReport,
  fetchInsightsToday,
} from '../services/api/insightsApi';

export const insightsTodayQueryKey = (lang: string) =>
  ['insightsToday', lang] as const;
export const insightsReportQueryKey = (
  period: 'week' | 'month',
  date?: string
) => ['insightsReport', period, date ?? 'last'] as const;

/** The findings only change with the nightly data, so they stay fresh for long. */
const INSIGHTS_STALE_MS = 30 * 60 * 1000;

export function useInsightsToday(enabled: boolean = true) {
  const lang = getAppLocale();
  const query = useQuery({
    queryKey: insightsTodayQueryKey(lang),
    queryFn: () => fetchInsightsToday(lang),
    staleTime: INSIGHTS_STALE_MS,
    enabled,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useInsightsReport(period: 'week' | 'month', date?: string) {
  const query = useQuery({
    queryKey: insightsReportQueryKey(period, date),
    queryFn: () => fetchInsightsReport(period, date),
    staleTime: INSIGHTS_STALE_MS,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}
