import { vi, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error TS7016 supertest typing
import request from 'supertest';
import express from 'express';
import errorHandler from '../middleware/errorHandler.js';

vi.mock('../middleware/authMiddleware.js', () => ({
  authenticate: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = 'family-member';
    req.authenticatedUserId = 'owner';
    next();
  },
}));
vi.mock('../utils/timezoneLoader.js', () => ({
  loadUserTimezone: vi.fn().mockResolvedValue('UTC'),
}));
vi.mock('../services/watchSyncService.js', () => ({
  default: {
    buildManifest: vi.fn(),
    importSession: vi.fn(),
    getSyncStatus: vi.fn(),
  },
}));

import watchSyncService from '../services/watchSyncService.js';
import watchSyncRoutes from '../routes/v2/watchSyncRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/v2/watch', watchSyncRoutes);
app.use(errorHandler);

const validBody = {
  client_session_id: '33333333-3333-4333-8333-333333333333',
  device_id: 'fenix-1',
  name: 'Push Day',
  entry_date: '2026-10-20',
  started_at: '2026-10-20T06:00:00.000Z',
  ended_at: '2026-10-20T07:00:00.000Z',
  exercises: [
    {
      exercise_id: '11111111-1111-4111-8111-111111111111',
      sort_order: 0,
      sets: [{ set_number: 1, reps: 5, weight: 100 }],
    },
  ],
};

beforeEach(() => vi.clearAllMocks());

describe('GET /api/v2/watch/manifest', () => {
  it('builds the manifest for the authenticated owner, not a switched context', async () => {
    vi.mocked(watchSyncService.buildManifest).mockResolvedValue({
      schema_version: 1,
      generated_at: 'x',
      weight_unit: 'kg',
      default_rest_seconds: 90,
      workouts: [],
    });
    const res = await request(app).get(
      '/api/v2/watch/manifest?date=2026-10-20'
    );
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(watchSyncService.buildManifest).toHaveBeenCalledWith(
      'owner',
      '2026-10-20'
    );
  });

  it('rejects malformed dates', async () => {
    const res = await request(app).get(
      '/api/v2/watch/manifest?date=20.10.2026'
    );
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/v2/watch/sessions', () => {
  it('returns 201 for a new session and 200 for a duplicate', async () => {
    vi.mocked(watchSyncService.importSession)
      .mockResolvedValueOnce({
        status: 'created',
        client_session_id: validBody.client_session_id,
        exercise_preset_entry_id: '44444444-4444-4444-8444-444444444444',
      })
      .mockResolvedValueOnce({
        status: 'duplicate',
        client_session_id: validBody.client_session_id,
        exercise_preset_entry_id: '44444444-4444-4444-8444-444444444444',
      });
    const first = await request(app)
      .post('/api/v2/watch/sessions')
      .send(validBody);
    const second = await request(app)
      .post('/api/v2/watch/sessions')
      .send(validBody);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.body.status).toBe('duplicate');
    expect(watchSyncService.importSession).toHaveBeenCalledWith(
      'owner',
      'owner',
      expect.objectContaining({
        client_session_id: validBody.client_session_id,
      })
    );
  });

  it.each([
    ['missing idempotency key', { ...validBody, client_session_id: undefined }],
    [
      'end before start',
      { ...validBody, ended_at: '2026-10-20T05:00:00.000Z' },
    ],
    ['no exercises', { ...validBody, exercises: [] }],
    [
      'negative weight',
      {
        ...validBody,
        exercises: [
          { ...validBody.exercises[0], sets: [{ set_number: 1, weight: -5 }] },
        ],
      },
    ],
    ['unknown field', { ...validBody, user_id: 'someone-else' }],
  ])('rejects %s with 400', async (_label, body) => {
    const res = await request(app).post('/api/v2/watch/sessions').send(body);
    expect(res.statusCode).toBe(400);
    expect(watchSyncService.importSession).not.toHaveBeenCalled();
  });

  it('maps a conflict from the service to 409', async () => {
    vi.mocked(watchSyncService.importSession).mockRejectedValue(
      Object.assign(new Error('conflict'), { status: 409 })
    );
    const res = await request(app)
      .post('/api/v2/watch/sessions')
      .send(validBody);
    expect(res.statusCode).toBe(409);
  });
});
