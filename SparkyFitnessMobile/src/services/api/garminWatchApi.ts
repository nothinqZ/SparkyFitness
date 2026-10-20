import type {
  WatchPairedDevicesResponse,
  WatchPairingClaimResponse,
} from '@workspace/shared';
import { apiFetch } from './apiClient';

const SERVICE = 'Garmin Watch API';

// Pairing and unpairing of the Sparky Strength Connect IQ watch app.
// Server: SparkyFitnessServer/routes/v2/watchPairingRoutes.ts

export const claimWatchPairing = (
  pairingCode: string
): Promise<WatchPairingClaimResponse> =>
  apiFetch<WatchPairingClaimResponse>({
    endpoint: '/api/v2/watch/pairing/claim',
    serviceName: SERVICE,
    operation: 'confirm watch pairing',
    method: 'POST',
    body: { pairing_code: pairingCode },
  });

export const fetchPairedWatches = (): Promise<WatchPairedDevicesResponse> =>
  apiFetch<WatchPairedDevicesResponse>({
    endpoint: '/api/v2/watch/pairing/devices',
    serviceName: SERVICE,
    operation: 'fetch paired watches',
  });

export const unpairWatch = (apiKeyId: string): Promise<void> =>
  apiFetch<void>({
    endpoint: `/api/v2/watch/pairing/devices/${encodeURIComponent(apiKeyId)}`,
    serviceName: SERVICE,
    operation: 'unpair watch',
    method: 'DELETE',
  });
