import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  API_KEY_SCOPE_PERMISSIONS,
  garminProductName,
  WATCH_PAIRING_CODE_ALPHABET,
  type WatchPairedDevicesResponse,
  type WatchPairingClaimResponse,
  type WatchPairingPollResponse,
  type WatchPairingStartRequest,
  type WatchPairingStartResponse,
} from '@workspace/shared';
import { auth } from '../auth.js';
import { log } from '../config/logging.js';
import { encrypt, decrypt, ENCRYPTION_KEY } from '../security/encryption.js';
import watchPairingRepository from '../models/watchPairingRepository.js';
import watchDeviceRepository from '../models/watchDeviceRepository.js';
import watchSessionImportRepository from '../models/watchSessionImportRepository.js';

export const PAIRING_TTL_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_SECONDS = 5;
// Upper bound on open handshakes server-wide; pairing is a rare, manual act.
const MAX_PENDING = 50;

interface ServiceError extends Error {
  status: number;
}
const serviceError = (status: number, message: string): ServiceError =>
  Object.assign(new Error(message), { status });

export function generatePairingCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) {
    code +=
      WATCH_PAIRING_CODE_ALPHABET[
        randomInt(WATCH_PAIRING_CODE_ALPHABET.length)
      ];
  }
  return code;
}

export function hashPollToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function start(
  request: WatchPairingStartRequest
): Promise<WatchPairingStartResponse> {
  await watchPairingRepository.deleteExpired();
  if ((await watchPairingRepository.countPending()) >= MAX_PENDING) {
    throw serviceError(429, 'Too many pairing requests. Try again later.');
  }
  const pollToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  for (let attempt = 0; attempt < 5; attempt++) {
    const pairingCode = generatePairingCode();
    const inserted = await watchPairingRepository.insertRequest({
      pairingCode,
      pollTokenSha256: hashPollToken(pollToken),
      deviceId: request.device_id,
      deviceModel: request.device_model ?? null,
      expiresAt,
    });
    if (inserted) {
      return {
        pairing_code: pairingCode,
        poll_token: pollToken,
        expires_at: expiresAt.toISOString(),
        poll_interval_seconds: POLL_INTERVAL_SECONDS,
      };
    }
  }
  throw serviceError(503, 'Could not allocate a pairing code.');
}

async function poll(pollToken: string): Promise<WatchPairingPollResponse> {
  const tokenHash = hashPollToken(pollToken);
  const ready = await watchPairingRepository.takeReadyKey(tokenHash);
  if (ready) {
    const key = await decrypt(
      ready.api_key_encrypted,
      ready.api_key_iv,
      ready.api_key_tag,
      ENCRYPTION_KEY
    );
    if (!key) {
      throw serviceError(500, 'Pairing key could not be decrypted.');
    }
    return { status: 'paired', api_key: key };
  }
  const row = await watchPairingRepository.findByPollToken(tokenHash);
  if (!row) {
    throw serviceError(404, 'Pairing request not found or expired.');
  }
  return { status: 'pending' };
}

interface CreatedApiKey {
  id: string;
  key: string;
  name: string;
}

async function claim(
  pairingCode: string,
  userId: string
): Promise<WatchPairingClaimResponse> {
  const row = await watchPairingRepository.claim(pairingCode, userId);
  if (!row) {
    throw serviceError(404, 'Unknown or expired pairing code.');
  }
  const name =
    `Garmin watch ${row.device_model ?? row.device_id.slice(0, 8)}`.slice(
      0,
      255
    );
  try {
    // Same server API the Settings > API Keys route uses. No expiry: the
    // watch cannot renew a key by itself; revoke it in Settings to unpair.
    // @ts-expect-error createApiKey comes from the api-key plugin and is not on the inferred type.
    const created = (await auth.api.createApiKey({
      body: {
        userId,
        name,
        expiresIn: null,
        permissions: API_KEY_SCOPE_PERMISSIONS.full,
      },
    })) as CreatedApiKey;
    const encrypted = await encrypt(created.key, ENCRYPTION_KEY);
    await watchPairingRepository.storeKey(row.id, created.id, {
      encryptedText: encrypted.encryptedText as string,
      iv: encrypted.iv as string,
      tag: encrypted.tag as string,
    });
    log(
      'info',
      `[watchPairing] User ${userId} paired watch ${row.device_id} as key ${created.id}`
    );
    try {
      const revoked = await watchDeviceRepository.registerKey(
        userId,
        created.id,
        row.device_id,
        row.device_model
      );
      if (revoked.length > 0) {
        log(
          'info',
          `[watchPairing] Revoked earlier key(s) ${revoked.join(', ')} of watch ${row.device_id}`
        );
      }
    } catch (error) {
      // The pairing itself worked; the key is still listed by its name.
      log(
        'warn',
        `[watchPairing] Could not record watch ${row.device_id} for key ${created.id}: ${(error as Error).message}`
      );
    }
    return { paired: true, api_key_id: created.id, api_key_name: created.name };
  } catch (error) {
    await watchPairingRepository.unclaim(row.id).catch(() => undefined);
    throw error;
  }
}

const toIso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Paired watches of the user with their last request and last upload. */
async function listDevices(
  userId: string
): Promise<WatchPairedDevicesResponse> {
  const [keys, status] = await Promise.all([
    watchDeviceRepository.listByUser(userId),
    watchSessionImportRepository.getSyncStatus(userId),
  ]);
  const uploads = status.devices as Array<{
    device_id: string;
    device_model: string | null;
    app_version: string | null;
    last_seen_at: unknown;
  }>;
  return {
    devices: keys.map((key) => {
      // Keys paired before watch_devices existed only carry the model in
      // their name ("Garmin watch <model>"), so match their uploads by model.
      const model =
        key.device_model ?? key.name?.replace(/^Garmin watch /, '') ?? null;
      const upload = uploads.find((u) =>
        key.device_id
          ? u.device_id === key.device_id
          : model !== null && u.device_model === model
      );
      return {
        api_key_id: key.api_key_id,
        name: key.name ?? '',
        device_id: key.device_id,
        device_model: garminProductName(model),
        paired_at: toIso(key.paired_at) ?? '',
        last_used_at: toIso(key.last_used_at),
        last_upload_at: toIso(upload?.last_seen_at),
        app_version: upload?.app_version ?? null,
      };
    }),
  };
}

/** Unpairs a watch by revoking its key; the watch then offers pairing again. */
async function unpair(userId: string, apiKeyId: string): Promise<void> {
  if (!(await watchDeviceRepository.deleteKey(userId, apiKeyId))) {
    throw serviceError(404, 'Paired watch not found.');
  }
  log('info', `[watchPairing] User ${userId} unpaired watch key ${apiKeyId}`);
}

export default { start, poll, claim, listDevices, unpair };
