import type {
  PerformanceOverviewResponse,
  WatchSyncStatusResponse,
} from '@workspace/shared';
import { apiFetch } from './apiClient';

const SERVICE = 'Performance API';

/** Server: SparkyFitnessServer/routes/v2/performanceRoutes.ts */
export const fetchPerformanceOverview = (
  days: number
): Promise<PerformanceOverviewResponse> =>
  apiFetch<PerformanceOverviewResponse>({
    endpoint: `/api/v2/performance/overview?days=${days}`,
    serviceName: SERVICE,
    operation: 'fetch performance overview',
  });

/** Uploads from the Sparky Strength Connect IQ watch app. */
export const fetchWatchSyncStatus = (): Promise<WatchSyncStatusResponse> =>
  apiFetch<WatchSyncStatusResponse>({
    endpoint: '/api/v2/watch/status',
    serviceName: SERVICE,
    operation: 'fetch watch sync status',
  });
