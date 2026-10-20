import { apiCall } from '@/api/api';
import type {
  WatchPairingClaimResponse,
  WatchSyncStatusResponse,
} from '@workspace/shared';

// Connect IQ watch app: pairing confirmation and sync status
// (server: routes/v2/watchPairingRoutes.ts, routes/v2/watchSyncRoutes.ts).

export const claimWatchPairing = (
  pairingCode: string
): Promise<WatchPairingClaimResponse> =>
  apiCall('/v2/watch/pairing/claim', {
    method: 'POST',
    body: { pairing_code: pairingCode },
  });

export const getWatchSyncStatus = (): Promise<WatchSyncStatusResponse> =>
  apiCall('/v2/watch/status', { method: 'GET' });
