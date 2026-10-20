import { apiCall } from '@/api/api';
import type {
  WatchPairedDevicesResponse,
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

export const getPairedWatches = (): Promise<WatchPairedDevicesResponse> =>
  apiCall('/v2/watch/pairing/devices', { method: 'GET' });

export const unpairWatch = (apiKeyId: string): Promise<void> =>
  apiCall(`/v2/watch/pairing/devices/${encodeURIComponent(apiKeyId)}`, {
    method: 'DELETE',
  });
