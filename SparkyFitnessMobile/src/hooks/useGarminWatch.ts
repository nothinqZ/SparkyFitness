import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  claimWatchPairing,
  fetchPairedWatches,
  unpairWatch,
} from '../services/api/garminWatchApi';
import { watchSyncStatusQueryKey } from './usePerformance';

export const pairedWatchesQueryKey = ['pairedWatches'] as const;

export function usePairedWatches(enabled: boolean = true) {
  const query = useQuery({
    queryKey: pairedWatchesQueryKey,
    queryFn: fetchPairedWatches,
    staleTime: 60 * 1000,
    enabled,
  });
  return {
    devices: query.data?.devices,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

// Pairing and unpairing change both the device list and the upload status
// shown on the Performance screen.
function useInvalidateWatchQueries() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: pairedWatchesQueryKey });
    queryClient.invalidateQueries({ queryKey: watchSyncStatusQueryKey });
  };
}

export function useClaimWatchPairing() {
  const invalidate = useInvalidateWatchQueries();
  return useMutation({
    mutationFn: (pairingCode: string) => claimWatchPairing(pairingCode),
    onSuccess: invalidate,
  });
}

export function useUnpairWatch() {
  const invalidate = useInvalidateWatchQueries();
  return useMutation({
    mutationFn: (apiKeyId: string) => unpairWatch(apiKeyId),
    onSuccess: invalidate,
  });
}
