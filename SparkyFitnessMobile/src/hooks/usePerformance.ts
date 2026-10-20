import { useQuery } from '@tanstack/react-query';
import {
  fetchPerformanceOverview,
  fetchWatchSyncStatus,
} from '../services/api/performanceApi';

export const performanceQueryKey = (days: number) =>
  ['performanceOverview', days] as const;
export const watchSyncStatusQueryKey = ['watchSyncStatus'] as const;

export function usePerformanceOverview(days: number) {
  const query = useQuery({
    queryKey: performanceQueryKey(days),
    queryFn: () => fetchPerformanceOverview(days),
    staleTime: 5 * 60 * 1000,
  });
  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useWatchSyncStatus() {
  const query = useQuery({
    queryKey: watchSyncStatusQueryKey,
    queryFn: fetchWatchSyncStatus,
    staleTime: 60 * 1000,
  });
  return { data: query.data, isError: query.isError };
}
