import { getClient } from '../db/poolManager.js';

// Paired Connect IQ watches, one row per watch API key (see migration
// 20261021100000_create_watch_devices.sql). Every query runs as the key's
// owner; RLS scopes both watch_devices and api_key to the authenticated user,
// and each query also filters by owner explicitly.

// Keys paired before watch_devices existed have no row; pairing has always
// named them "Garmin watch <model>", so they are recognised by that name.
const LEGACY_NAME_PATTERN = 'Garmin watch %';

export interface WatchDeviceRow {
  api_key_id: string;
  name: string | null;
  device_id: string | null;
  device_model: string | null;
  paired_at: Date | string;
  last_used_at: Date | string | null;
}

/**
 * Records `apiKeyId` as the key of `deviceId` and revokes keys this watch was
 * paired with before: re-pairing a watch replaces its key instead of leaving
 * the old one valid. Returns the ids of the revoked keys.
 */
async function registerKey(
  userId: string,
  apiKeyId: string,
  deviceId: string,
  deviceModel: string | null
): Promise<string[]> {
  const client = await getClient(userId, userId);
  try {
    await client.query('BEGIN');
    const revoked = await client.query(
      `DELETE FROM api_key k
       USING watch_devices d
       WHERE d.api_key_id = k.id AND d.user_id = $1 AND d.device_id = $2
         AND k.reference_id = $1 AND k.id <> $3
       RETURNING k.id`,
      [userId, deviceId, apiKeyId]
    );
    await client.query(
      `INSERT INTO watch_devices (api_key_id, user_id, device_id, device_model)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (api_key_id) DO UPDATE
         SET device_id = EXCLUDED.device_id, device_model = EXCLUDED.device_model`,
      [apiKeyId, userId, deviceId, deviceModel]
    );
    await client.query('COMMIT');
    return (revoked.rows as { id: string }[]).map((r) => r.id);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function listByUser(userId: string): Promise<WatchDeviceRow[]> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      `SELECT k.id AS api_key_id, k.name, d.device_id, d.device_model,
              COALESCE(d.paired_at, k.created_at) AS paired_at,
              k.last_request AS last_used_at
       FROM api_key k
       LEFT JOIN watch_devices d ON d.api_key_id = k.id
       WHERE k.reference_id = $1
         AND (d.api_key_id IS NOT NULL OR k.name LIKE $2)
       ORDER BY paired_at DESC`,
      [userId, LEGACY_NAME_PATTERN]
    );
    return result.rows as WatchDeviceRow[];
  } finally {
    client.release();
  }
}

/**
 * Revokes one watch key of the user. Refuses keys that are not watch keys,
 * so this cannot be used to delete arbitrary API keys. Returns false when no
 * such watch key exists.
 */
async function deleteKey(userId: string, apiKeyId: string): Promise<boolean> {
  const client = await getClient(userId, userId);
  try {
    const result = await client.query(
      `DELETE FROM api_key k
       WHERE k.id = $2 AND k.reference_id = $1
         AND (EXISTS (SELECT 1 FROM watch_devices d WHERE d.api_key_id = k.id)
              OR k.name LIKE $3)
       RETURNING k.id`,
      [userId, apiKeyId, LEGACY_NAME_PATTERN]
    );
    return result.rowCount === 1;
  } finally {
    client.release();
  }
}

export default { registerKey, listByUser, deleteKey };
