import express from 'express';
import {
  watchPairingClaimRequestSchema,
  watchPairingPollRequestSchema,
  watchPairingStartRequestSchema,
} from '@workspace/shared';
import { authenticate } from '../../middleware/authMiddleware.js';
import { fixedWindowRateLimit } from '../../utils/fixedWindowRateLimiter.js';
import watchPairingService from '../../services/watchPairingService.js';

// Pairing handshake for the Connect IQ watch app (see WatchSync.api.zod.ts).
// `start` and `poll` are called by a watch without credentials, so they are
// rate limited per IP; `claim` needs a signed-in user and is limited per user
// to make guessing a code impractical. `devices` lists and unpairs the
// signed-in user's watches for the web and mobile apps.

const router = express.Router();

const startLimit = fixedWindowRateLimit({ windowMs: 10 * 60_000, max: 10 });
const pollLimit = fixedWindowRateLimit({ windowMs: 60_000, max: 30 });
const claimLimit = fixedWindowRateLimit({
  windowMs: 10 * 60_000,
  max: 10,
  key: (req) => `user:${req.authenticatedUserId ?? req.ip}`,
});

function sendError(
  res: express.Response,
  error: unknown,
  next: express.NextFunction
) {
  const status = (error as { status?: number })?.status;
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({ error: (error as Error).message });
  }
  return next(error);
}

/**
 * @swagger
 * /v2/watch/pairing/start:
 *   post:
 *     summary: Start pairing a Connect IQ watch (no auth)
 *     tags: [Fitness & Workouts]
 *     responses:
 *       201: { description: Pairing code to show on the watch and a secret poll token. }
 *       400: { description: Invalid payload. }
 *       429: { description: Rate limited. }
 */
router.post('/start', startLimit, async (req, res, next) => {
  try {
    const parsed = watchPairingStartRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid pairing request.' });
    }
    res.status(201).json(await watchPairingService.start(parsed.data));
  } catch (error) {
    sendError(res, error, next);
  }
});

/**
 * @swagger
 * /v2/watch/pairing/poll:
 *   post:
 *     summary: Poll a pairing request (no auth; secret poll token)
 *     tags: [Fitness & Workouts]
 *     description: Returns 202 while waiting, then 200 with the API key exactly once.
 *     responses:
 *       200: { description: Paired; contains the API key. }
 *       202: { description: Not confirmed yet. }
 *       404: { description: Unknown, expired or already collected. }
 */
router.post('/poll', pollLimit, async (req, res, next) => {
  try {
    const parsed = watchPairingPollRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid poll request.' });
    }
    const result = await watchPairingService.poll(parsed.data.poll_token);
    res.status(result.status === 'paired' ? 200 : 202).json(result);
  } catch (error) {
    sendError(res, error, next);
  }
});

/**
 * @swagger
 * /v2/watch/pairing/claim:
 *   post:
 *     summary: Confirm a pairing code shown on the watch
 *     tags: [Fitness & Workouts]
 *     description: Creates an API key named after the watch for the signed-in user.
 *     responses:
 *       201: { description: Paired. }
 *       401: { description: Unauthorized. }
 *       404: { description: Unknown or expired code. }
 */
router.post('/claim', authenticate, claimLimit, async (req, res, next) => {
  try {
    const parsed = watchPairingClaimRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid pairing code.' });
    }
    // Bind the key to the signed-in account, never a switched family context.
    const userId = String(req.authenticatedUserId ?? req.userId);
    res
      .status(201)
      .json(await watchPairingService.claim(parsed.data.pairing_code, userId));
  } catch (error) {
    sendError(res, error, next);
  }
});

/**
 * @swagger
 * /v2/watch/pairing/devices:
 *   get:
 *     summary: List the signed-in user's paired watches
 *     tags: [Fitness & Workouts]
 *     responses:
 *       200: { description: Paired watches with last request and last upload. }
 *       401: { description: Unauthorized. }
 */
router.get('/devices', authenticate, async (req, res, next) => {
  try {
    // Watches belong to the signed-in account, never a switched family context.
    const userId = String(req.authenticatedUserId ?? req.userId);
    res.json(await watchPairingService.listDevices(userId));
  } catch (error) {
    sendError(res, error, next);
  }
});

/**
 * @swagger
 * /v2/watch/pairing/devices/{apiKeyId}:
 *   delete:
 *     summary: Unpair a watch (revokes its API key)
 *     tags: [Fitness & Workouts]
 *     parameters:
 *       - in: path
 *         name: apiKeyId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204: { description: Unpaired. }
 *       401: { description: Unauthorized. }
 *       404: { description: No watch with this key. }
 */
router.delete('/devices/:apiKeyId', authenticate, async (req, res, next) => {
  try {
    const userId = String(req.authenticatedUserId ?? req.userId);
    await watchPairingService.unpair(userId, String(req.params.apiKeyId));
    res.status(204).end();
  } catch (error) {
    sendError(res, error, next);
  }
});

export default router;
