import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { performanceKeys } from '@/api/keys/performance';
import {
  getInsightsReport,
  getInsightsToday,
} from '@/api/Insights/insightsService';
import { useActiveUser } from '@/contexts/ActiveUserContext';

// Findings only change with new data (fitness-next: the nightly copy), so a
// long stale time keeps the optional AI wording from being re-requested.
const STALE_MS = 30 * 60 * 1000;

export const useInsightsToday = () => {
  const { t, i18n } = useTranslation();
  const { activeUserId } = useActiveUser();
  const lang = i18n.language ?? 'en';
  return useQuery({
    queryKey: performanceKeys.insightsToday(activeUserId ?? undefined, lang),
    queryFn: () => getInsightsToday(lang),
    enabled: !!activeUserId,
    staleTime: STALE_MS,
    meta: {
      errorMessage: t('insights.error', 'Insights could not be loaded.'),
    },
  });
};

export const useInsightsReport = (period: 'week' | 'month') => {
  const { t } = useTranslation();
  const { activeUserId } = useActiveUser();
  return useQuery({
    queryKey: performanceKeys.insightsReport(activeUserId ?? undefined, period),
    queryFn: () => getInsightsReport(period),
    enabled: !!activeUserId,
    staleTime: STALE_MS,
    meta: {
      errorMessage: t('insights.error', 'Insights could not be loaded.'),
    },
  });
};
