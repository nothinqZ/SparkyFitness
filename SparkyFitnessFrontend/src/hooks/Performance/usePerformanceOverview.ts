import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { performanceKeys } from '@/api/keys/performance';
import { getPerformanceOverview } from '@/api/Performance/performanceService';
import { useActiveUser } from '@/contexts/ActiveUserContext';

export const usePerformanceOverview = (days: number, end?: string) => {
  const { t } = useTranslation();
  const { activeUserId } = useActiveUser();
  return useQuery({
    queryKey: performanceKeys.overview(activeUserId ?? undefined, end, days),
    queryFn: () => getPerformanceOverview({ days, end }),
    enabled: !!activeUserId,
    staleTime: 5 * 60 * 1000,
    meta: {
      errorMessage: t(
        'performance.loadError',
        'Failed to load performance data'
      ),
    },
  });
};
