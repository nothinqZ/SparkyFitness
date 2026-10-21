import express from 'express';
import {
  createRouteBodySchema,
  importGpxRouteBodySchema,
  parseGpx,
  routeFromActivityBodySchema,
  serializeGpx,
  updateRouteBodySchema,
} from '@workspace/shared';
import { fitRouteName } from '../../utils/routePrep.js';
import requireSelfActor from '../../middleware/requireSelfMiddleware.js';
import {
  ActivityHasNoRouteError,
  createRoute,
  deleteRoute,
  getActivityTrack,
  getRoute,
  InvalidRouteError,
  listRoutes,
  RouteLimitError,
  updateRoute,
} from '../../models/routeRepository.js';

/**
 * A person's saved routes. Owner-only: where someone runs is personal, so a
 * delegated context is refused outright.
 */
const router = express.Router();

router.use(requireSelfActor);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Maps the repository's domain errors onto responses; false if not one. */
function sendRouteError(res: express.Response, error: unknown): boolean {
  if (error instanceof InvalidRouteError) {
    res.status(400).json({ error: error.message });
    return true;
  }
  if (error instanceof RouteLimitError) {
    res.status(409).json({ error: 'Route limit reached' });
    return true;
  }
  if (error instanceof ActivityHasNoRouteError) {
    res.status(404).json({ error: 'That activity has no GPS track' });
    return true;
  }
  return false;
}

/**
 * @swagger
 * /v2/routes:
 *   get:
 *     summary: List saved routes
 *     description: Returns summaries (no points or cues) newest first.
 *     tags: [Exercise]
 *     responses:
 *       200:
 *         description: 'The routes: `{ routes: RouteSummary[] }`.'
 *   post:
 *     summary: Save a route from a list of points
 *     description: >
 *       The track is thinned for storage; distance and climb are measured on
 *       the full track.
 *     tags: [Exercise]
 *     responses:
 *       201:
 *         description: The saved route.
 *       400:
 *         description: Invalid body, or shorter than 10 m.
 *       409:
 *         description: The person has reached the route limit.
 */
router.get('/', async (req, res, next) => {
  try {
    const routes = await listRoutes(req.userId, req.authenticatedUserId);
    res.json({ routes });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const parsed = createRouteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.format(),
      });
    }
    const route = await createRoute(
      req.userId,
      { ...parsed.data, source: 'drawn' },
      req.authenticatedUserId
    );
    res.status(201).json({ route });
  } catch (error) {
    if (!sendRouteError(res, error)) next(error);
  }
});

/**
 * @swagger
 * /v2/routes/import-gpx:
 *   post:
 *     summary: Save a route from the text of a GPX file
 *     tags: [Exercise]
 *     responses:
 *       201:
 *         description: The saved route.
 *       400:
 *         description: Invalid body, no track in the file, or shorter than 10 m.
 */
router.post('/import-gpx', async (req, res, next) => {
  try {
    const parsed = importGpxRouteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.format(),
      });
    }
    const gpx = parseGpx(parsed.data.gpx);
    if (gpx.points.length < 2) {
      return res
        .status(400)
        .json({ error: 'The file has no track or route points' });
    }
    const route = await createRoute(
      req.userId,
      {
        name: fitRouteName(parsed.data.name ?? gpx.name ?? 'Imported route'),
        activity: parsed.data.activity,
        points: gpx.points,
        source: 'gpx',
      },
      req.authenticatedUserId
    );
    res.status(201).json({ route });
  } catch (error) {
    if (!sendRouteError(res, error)) next(error);
  }
});

/**
 * @swagger
 * /v2/routes/from-activity/{exerciseEntryId}:
 *   post:
 *     summary: Save the GPS track of a recorded activity as a route
 *     tags: [Exercise]
 *     responses:
 *       201:
 *         description: The saved route.
 *       404:
 *         description: The activity is not the person's or has no GPS track.
 */
router.post('/from-activity/:exerciseEntryId', async (req, res, next) => {
  try {
    const { exerciseEntryId } = req.params;
    if (!isUuid(exerciseEntryId)) {
      return res.status(400).json({ error: 'Invalid activity id' });
    }
    const parsed = routeFromActivityBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.format(),
      });
    }
    const track = await getActivityTrack(
      req.userId,
      exerciseEntryId,
      req.authenticatedUserId
    );
    if (!track || track.points.length < 2) {
      throw new ActivityHasNoRouteError();
    }
    const route = await createRoute(
      req.userId,
      {
        name: fitRouteName(parsed.data.name ?? track.name ?? 'Recorded route'),
        activity: parsed.data.activity ?? 'run',
        points: track.points,
        source: 'activity',
        sourceExerciseEntryId: exerciseEntryId,
      },
      req.authenticatedUserId
    );
    res.status(201).json({ route });
  } catch (error) {
    if (!sendRouteError(res, error)) next(error);
  }
});

/**
 * @swagger
 * /v2/routes/{id}:
 *   get:
 *     summary: Get a saved route with its points and cues
 *     tags: [Exercise]
 *     responses:
 *       200:
 *         description: The route.
 *       404:
 *         description: Not found.
 *   patch:
 *     summary: Rename a route or change its activity
 *     tags: [Exercise]
 *     responses:
 *       200:
 *         description: The updated route.
 *       404:
 *         description: Not found.
 *   delete:
 *     summary: Delete a route
 *     tags: [Exercise]
 *     responses:
 *       204:
 *         description: Deleted.
 *       404:
 *         description: Not found.
 */
router.get('/:id', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(404).json({ error: 'Route not found' });
    }
    const route = await getRoute(
      req.userId,
      req.params.id,
      req.authenticatedUserId
    );
    if (!route) return res.status(404).json({ error: 'Route not found' });
    res.json({ route });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(404).json({ error: 'Route not found' });
    }
    const parsed = updateRouteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request body',
        details: parsed.error.format(),
      });
    }
    const route = await updateRoute(
      req.userId,
      req.params.id,
      parsed.data,
      req.authenticatedUserId
    );
    if (!route) return res.status(404).json({ error: 'Route not found' });
    res.json({ route });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(404).json({ error: 'Route not found' });
    }
    const deleted = await deleteRoute(
      req.userId,
      req.params.id,
      req.authenticatedUserId
    );
    if (!deleted) return res.status(404).json({ error: 'Route not found' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /v2/routes/{id}/gpx:
 *   get:
 *     summary: Download a route as a GPX file
 *     tags: [Exercise]
 *     responses:
 *       200:
 *         description: The GPX file.
 *         content:
 *           application/gpx+xml: {}
 *       404:
 *         description: Not found.
 */
router.get('/:id/gpx', async (req, res, next) => {
  try {
    if (!isUuid(req.params.id)) {
      return res.status(404).json({ error: 'Route not found' });
    }
    const route = await getRoute(
      req.userId,
      req.params.id,
      req.authenticatedUserId
    );
    if (!route) return res.status(404).json({ error: 'Route not found' });
    const filename =
      route.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 60) || 'route';
    // `attachment` encodes the name (an ASCII fallback plus `filename*`), so a
    // route named in Chinese or Cyrillic downloads instead of failing on a
    // header value Node refuses. It sets the type from the extension, so the
    // type is set after it.
    res
      .attachment(`${filename}.gpx`)
      .type('application/gpx+xml')
      .send(serializeGpx(route.name, route.points));
  } catch (error) {
    next(error);
  }
});

export default router;
