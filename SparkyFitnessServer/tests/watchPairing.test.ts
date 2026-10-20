import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS7016 supertest typing
import request from 'supertest';
import express from 'express';
import { WATCH_PAIRING_CODE_ALPHABET } from '@workspace/shared';

vi.mock('../config/logging.js', () => ({ log: vi.fn() }));
vi.mock('../auth.js', () => ({
  auth: { api: { createApiKey: vi.fn() } },
}));
vi.mock('../security/encryption.js', () => ({
  ENCRYPTION_KEY: 'k',
  encrypt: vi.fn(async (text: string) => ({
    encryptedText: `enc(${text})`,
    iv: 'iv',
    tag: 'tag',
  })),
  decrypt: vi.fn(async (text: string) => text.replace(/^enc\((.*)\)$/, '$1')),
}));
vi.mock('../models/watchPairingRepository.js', () => ({
  default: {
    deleteExpired: vi.fn(),
    countPending: vi.fn(),
    insertRequest: vi.fn(),
    claim: vi.fn(),
    storeKey: vi.fn(),
    unclaim: vi.fn(),
    findByPollToken: vi.fn(),
    takeReadyKey: vi.fn(),
  },
}));
vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ) => {
    if (req.headers.authorization !== 'Bearer session') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.userId = 'family-member';
    req.authenticatedUserId = 'owner';
    next();
  },
}));

import { auth } from '../auth.js';
import repo from '../models/watchPairingRepository.js';
import watchPairingService, {
  generatePairingCode,
  hashPollToken,
} from '../services/watchPairingService.js';
import watchPairingRoutes from '../routes/v2/watchPairingRoutes.js';
import { fixedWindowRateLimit } from '../utils/fixedWindowRateLimiter.js';

const app = express();
app.use(express.json());
app.use('/api/v2/watch/pairing', watchPairingRoutes);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(repo.countPending).mockResolvedValue(0);
});

describe('generatePairingCode', () => {
  it('uses 8 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i++) {
      const code = generatePairingCode();
      expect(code).toHaveLength(8);
      for (const ch of code) expect(WATCH_PAIRING_CODE_ALPHABET).toContain(ch);
    }
  });
});

describe('watchPairingService', () => {
  it('stores only the hash of the poll token and retries code collisions', async () => {
    vi.mocked(repo.insertRequest)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const res = await watchPairingService.start({ device_id: 'd1' });
    expect(repo.insertRequest).toHaveBeenCalledTimes(2);
    const stored = vi.mocked(repo.insertRequest).mock.calls[1]![0];
    expect(stored.pollTokenSha256).toBe(hashPollToken(res.poll_token));
    expect(stored.pollTokenSha256).not.toContain(res.poll_token);
    expect(res.poll_token.length).toBeGreaterThanOrEqual(43);
  });

  it('refuses new handshakes when too many are open', async () => {
    vi.mocked(repo.countPending).mockResolvedValue(50);
    await expect(
      watchPairingService.start({ device_id: 'd1' })
    ).rejects.toMatchObject({ status: 429 });
  });

  it('claims for the given user, mints a non-expiring full key and stores it encrypted', async () => {
    vi.mocked(repo.claim).mockResolvedValue({
      id: 'p1',
      device_id: 'abcdef123456',
      device_model: 'fenix7',
    } as never);
    vi.mocked(
      (auth.api as unknown as { createApiKey: () => unknown }).createApiKey
    ).mockResolvedValue({
      id: 'key-1',
      key: 'secret-key',
      name: 'Garmin watch fenix7',
    });

    const result = await watchPairingService.claim('ABCDEFGH', 'owner');

    expect(result).toEqual({
      paired: true,
      api_key_id: 'key-1',
      api_key_name: 'Garmin watch fenix7',
    });
    const createArgs = vi.mocked(
      (auth.api as unknown as { createApiKey: (a: unknown) => unknown })
        .createApiKey
    ).mock.calls[0]![0] as { body: Record<string, unknown> };
    expect(createArgs.body).toMatchObject({ userId: 'owner', expiresIn: null });
    expect(repo.storeKey).toHaveBeenCalledWith('p1', 'key-1', {
      encryptedText: 'enc(secret-key)',
      iv: 'iv',
      tag: 'tag',
    });
  });

  it('releases the claim when the key cannot be minted', async () => {
    vi.mocked(repo.claim).mockResolvedValue({
      id: 'p1',
      device_id: 'd',
      device_model: null,
    } as never);
    vi.mocked(
      (auth.api as unknown as { createApiKey: () => unknown }).createApiKey
    ).mockRejectedValue(new Error('auth down'));
    vi.mocked(repo.unclaim).mockResolvedValue(undefined);
    await expect(
      watchPairingService.claim('ABCDEFGH', 'owner')
    ).rejects.toThrow('auth down');
    expect(repo.unclaim).toHaveBeenCalledWith('p1');
  });

  it('hands out the key once, then reports pending or not found', async () => {
    vi.mocked(repo.takeReadyKey).mockResolvedValueOnce({
      api_key_encrypted: 'enc(secret-key)',
      api_key_iv: 'iv',
      api_key_tag: 'tag',
    } as never);
    expect(await watchPairingService.poll('t'.repeat(43))).toEqual({
      status: 'paired',
      api_key: 'secret-key',
    });

    vi.mocked(repo.takeReadyKey).mockResolvedValue(null);
    vi.mocked(repo.findByPollToken).mockResolvedValueOnce({
      status: 'pending',
    } as never);
    expect(await watchPairingService.poll('t'.repeat(43))).toEqual({
      status: 'pending',
    });

    vi.mocked(repo.findByPollToken).mockResolvedValueOnce(null);
    await expect(
      watchPairingService.poll('t'.repeat(43))
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe('watch pairing routes', () => {
  it('lets a watch start and poll without credentials', async () => {
    vi.mocked(repo.insertRequest).mockResolvedValue(true);
    const start = await request(app)
      .post('/api/v2/watch/pairing/start')
      .send({ device_id: 'd1', device_model: 'fenix7' });
    expect(start.statusCode).toBe(201);
    expect(start.body.pairing_code).toMatch(/^[A-Z2-9]{8}$/);

    vi.mocked(repo.takeReadyKey).mockResolvedValue(null);
    vi.mocked(repo.findByPollToken).mockResolvedValue({
      status: 'pending',
    } as never);
    const poll = await request(app)
      .post('/api/v2/watch/pairing/poll')
      .send({ poll_token: start.body.poll_token });
    expect(poll.statusCode).toBe(202);
  });

  it('requires a signed-in user to claim, binds to the authenticated account and normalises the code', async () => {
    const anonymous = await request(app)
      .post('/api/v2/watch/pairing/claim')
      .send({ pairing_code: 'ABCD-EFGH' });
    expect(anonymous.statusCode).toBe(401);

    vi.mocked(repo.claim).mockResolvedValue(null);
    const res = await request(app)
      .post('/api/v2/watch/pairing/claim')
      .set('Authorization', 'Bearer session')
      .send({ pairing_code: 'abcd-efgh' });
    expect(res.statusCode).toBe(404);
    expect(repo.claim).toHaveBeenCalledWith('ABCDEFGH', 'owner');
  });

  it('rejects malformed bodies', async () => {
    expect(
      (await request(app).post('/api/v2/watch/pairing/start').send({}))
        .statusCode
    ).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/v2/watch/pairing/poll')
          .send({ poll_token: 'short' })
      ).statusCode
    ).toBe(400);
  });
});

describe('fixedWindowRateLimit', () => {
  it('allows max requests per window and then answers 429 with Retry-After', async () => {
    let t = 0;
    const limited = express();
    limited.get(
      '/',
      fixedWindowRateLimit({ windowMs: 1000, max: 2, now: () => t }),
      (_req, res) => {
        res.send('ok');
      }
    );
    expect((await request(limited).get('/')).statusCode).toBe(200);
    expect((await request(limited).get('/')).statusCode).toBe(200);
    const blocked = await request(limited).get('/');
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBe('1');
    t = 1000;
    expect((await request(limited).get('/')).statusCode).toBe(200);
  });
});
