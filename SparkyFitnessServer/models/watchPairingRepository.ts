import { getSystemClient } from '../db/poolManager.js';

// Pairing requests are created and polled by a watch that has no credentials
// yet, so every query runs on the system connection; RLS keeps the table
// invisible to the regular app role. Each query is scoped explicitly.

export interface WatchPairingRow {
  id: string;
  pairing_code: string;
  device_id: string;
  device_model: string | null;
  status: 'pending' | 'claimed';
  user_id: string | null;
  api_key_id: string | null;
  api_key_encrypted: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  expires_at: Date;
}

async function deleteExpired(): Promise<void> {
  const client = await getSystemClient();
  try {
    await client.query(
      'DELETE FROM watch_pairing_requests WHERE expires_at < NOW()'
    );
  } finally {
    client.release();
  }
}

async function countPending(): Promise<number> {
  const client = await getSystemClient();
  try {
    const result = await client.query(
      `SELECT COUNT(*)::int AS n FROM watch_pairing_requests
       WHERE status = 'pending' AND expires_at >= NOW()`
    );
    return Number(result.rows[0]?.n ?? 0);
  } finally {
    client.release();
  }
}

/** Returns false when the code collides with an existing one (caller retries). */
async function insertRequest(input: {
  pairingCode: string;
  pollTokenSha256: string;
  deviceId: string;
  deviceModel: string | null;
  expiresAt: Date;
}): Promise<boolean> {
  const client = await getSystemClient();
  try {
    const result = await client.query(
      `INSERT INTO watch_pairing_requests
         (pairing_code, poll_token_sha256, device_id, device_model, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        input.pairingCode,
        input.pollTokenSha256,
        input.deviceId,
        input.deviceModel,
        input.expiresAt,
      ]
    );
    return result.rowCount === 1;
  } finally {
    client.release();
  }
}

/** Atomically moves a pending, unexpired request to claimed by `userId`. */
async function claim(
  pairingCode: string,
  userId: string
): Promise<WatchPairingRow | null> {
  const client = await getSystemClient();
  try {
    const result = await client.query(
      `UPDATE watch_pairing_requests
       SET status = 'claimed', user_id = $2
       WHERE pairing_code = $1 AND status = 'pending' AND expires_at >= NOW()
       RETURNING *`,
      [pairingCode, userId]
    );
    return (result.rows[0] as WatchPairingRow | undefined) ?? null;
  } finally {
    client.release();
  }
}

async function storeKey(
  id: string,
  apiKeyId: string,
  encrypted: { encryptedText: string; iv: string; tag: string }
): Promise<void> {
  const client = await getSystemClient();
  try {
    await client.query(
      `UPDATE watch_pairing_requests
       SET api_key_id = $2, api_key_encrypted = $3, api_key_iv = $4, api_key_tag = $5
       WHERE id = $1`,
      [id, apiKeyId, encrypted.encryptedText, encrypted.iv, encrypted.tag]
    );
  } finally {
    client.release();
  }
}

/** Undo a claim whose key could not be minted, so the code can be retried. */
async function unclaim(id: string): Promise<void> {
  const client = await getSystemClient();
  try {
    await client.query(
      `UPDATE watch_pairing_requests SET status = 'pending', user_id = NULL
       WHERE id = $1 AND api_key_id IS NULL`,
      [id]
    );
  } finally {
    client.release();
  }
}

async function findByPollToken(
  pollTokenSha256: string
): Promise<WatchPairingRow | null> {
  const client = await getSystemClient();
  try {
    const result = await client.query(
      `SELECT * FROM watch_pairing_requests
       WHERE poll_token_sha256 = $1 AND expires_at >= NOW()`,
      [pollTokenSha256]
    );
    return (result.rows[0] as WatchPairingRow | undefined) ?? null;
  } finally {
    client.release();
  }
}

/**
 * Deletes a claimed request whose key is ready and returns it. DELETE ...
 * RETURNING hands the key to exactly one of several concurrent polls.
 */
async function takeReadyKey(
  pollTokenSha256: string
): Promise<WatchPairingRow | null> {
  const client = await getSystemClient();
  try {
    const result = await client.query(
      `DELETE FROM watch_pairing_requests
       WHERE poll_token_sha256 = $1 AND status = 'claimed'
         AND api_key_encrypted IS NOT NULL
       RETURNING *`,
      [pollTokenSha256]
    );
    return (result.rows[0] as WatchPairingRow | undefined) ?? null;
  } finally {
    client.release();
  }
}

export default {
  deleteExpired,
  countPending,
  insertRequest,
  claim,
  storeKey,
  unclaim,
  findByPollToken,
  takeReadyKey,
};
