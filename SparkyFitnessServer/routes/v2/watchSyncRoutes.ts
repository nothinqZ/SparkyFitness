import express from 'express';
import {
  isDayString,
  todayInZone,
  watchSessionUploadSchema,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import { loadUserTimezone } from '../../utils/timezoneLoader.js';
import watchSyncService, {
  MAX_MANIFEST_WORKOUTS,
} from '../../services/watchSyncService.js';

// Endpoints for the SparkyFitness Connect IQ watch app. The watch authenticates
// with a regular Better Auth API key (Settings > API Keys), sent as
// `Authorization: Bearer <key>`; revoking the key in Settings unpairs the watch.
// Those keys carry Better Auth's per-key rate limit. A read-only key can fetch
// the manifest but is refused on upload by `authenticate`.
//
// The watch always acts as its owner, never on behalf of a family member, so
// these routes use the authenticated user id and ignore context switching.

const router = express.Router();
router.use(authenticate);

function ownerId(req: express.Request): string {
  return String(req.authenticatedUserId ?? req.userId);
}

/**
 * @swagger
 * /v2/watch/manifest:
 *   get:
 *     summary: Workouts for the Connect IQ watch app
 *     tags: [Fitness & Workouts]
 *     description: |
 *       Workout presets with their planned sets, ordered so presets scheduled by
 *       an active plan in the next 7 days come first, plus the last logged sets
 *       of every exercise for "previous" values on the watch.
 *     parameters:
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *         description: First day of the schedule window. Defaults to today in the user's timezone.
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 30 }
 *         description: Maximum number of workouts (default 30).
 *     responses:
 *       200: { description: Manifest. }
 *       400: { description: Invalid date. }
 *       401: { description: Unauthorized. }
 */
router.get('/manifest', async (req, res, next) => {
  try {
    const userId = ownerId(req);
    let date = typeof req.query.date === 'string' ? req.query.date : null;
    if (date !== null && !isDayString(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const limitRaw = req.query.limit;
    const limit =
      typeof limitRaw === 'string' ? Number.parseInt(limitRaw, 10) : NaN;
    if (
      limitRaw !== undefined &&
      (!Number.isInteger(limit) || limit < 1 || limit > MAX_MANIFEST_WORKOUTS)
    ) {
      return res
        .status(400)
        .json({ error: `limit must be 1-${MAX_MANIFEST_WORKOUTS}` });
    }
    date ??= todayInZone(await loadUserTimezone(userId));
    const manifest = await watchSyncService.buildManifest(
      userId,
      date,
      Number.isInteger(limit) ? limit : MAX_MANIFEST_WORKOUTS
    );
    res.set('Cache-Control', 'no-store');
    res.json(manifest);
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /v2/watch/sessions:
 *   post:
 *     summary: Upload a workout session logged on the watch
 *     tags: [Fitness & Workouts]
 *     description: |
 *       Idempotent on `client_session_id`. The first upload creates the workout
 *       (201, status `created`); repeating the identical payload returns 200 with
 *       status `duplicate` and the original workout id. Reusing the id for a
 *       different payload is refused with 409.
 *     responses:
 *       200: { description: Already imported. }
 *       201: { description: Imported. }
 *       400: { description: Invalid payload. }
 *       401: { description: Unauthorized. }
 *       403: { description: Read-only API key. }
 *       409: { description: client_session_id reused for different content. }
 */
router.post('/sessions', async (req, res, next) => {
  try {
    const parsed = watchSessionUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid watch session payload.',
        details: parsed.error.flatten(),
      });
    }
    const userId = ownerId(req);
    const result = await watchSyncService.importSession(
      userId,
      userId,
      parsed.data
    );
    res.status(result.status === 'created' ? 201 : 200).json(result);
  } catch (error) {
    const status = (error as { status?: number })?.status;
    if (status && status >= 400 && status < 500) {
      return res.status(status).json({ error: (error as Error).message });
    }
    next(error);
  }
});

/**
 * @swagger
 * /v2/watch/status:
 *   get:
 *     summary: Watch sync status
 *     tags: [Fitness & Workouts]
 *     responses:
 *       200: { description: Upload counts, Garmin links and known devices. }
 *       401: { description: Unauthorized. }
 */
router.get('/status', async (req, res, next) => {
  try {
    res.json(await watchSyncService.getSyncStatus(ownerId(req)));
  } catch (error) {
    next(error);
  }
});

export default router;
