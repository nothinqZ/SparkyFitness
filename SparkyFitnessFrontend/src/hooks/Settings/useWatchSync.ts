import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { apiKeyKeys, watchSyncKeys } from '@/api/keys/settings';
import {
  claimWatchPairing,
  getWatchSyncStatus,
} from '@/api/Settings/watchSyncService';

export const useWatchSyncStatusQuery = () => {
  const { t } = useTranslation();
  return useQuery({
    queryKey: watchSyncKeys.status(),
    queryFn: getWatchSyncStatus,
    meta: {
      errorMessage: t(
        'settings.garminWatch.statusError',
        'Failed to load watch sync status'
      ),
    },
  });
};

export const useClaimWatchPairingMutation = () => {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  return useMutation({
    mutationFn: (pairingCode: string) => claimWatchPairing(pairingCode),
    onSuccess: () => {
      // Pairing mints an API key; the API key list must show it.
      queryClient.invalidateQueries({ queryKey: apiKeyKeys.lists() });
      queryClient.invalidateQueries({ queryKey: watchSyncKeys.all });
    },
    meta: {
      successMessage: t(
        'settings.garminWatch.paired',
        'Watch paired. It finishes setup on its own within a few seconds.'
      ),
      errorMessage: t(
        'settings.garminWatch.pairError',
        'Pairing failed. Check the code on the watch; codes expire after 10 minutes.'
      ),
    },
  });
};
