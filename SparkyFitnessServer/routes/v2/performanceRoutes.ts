import express from 'express';
import { performanceOverviewQuerySchema } from '@workspace/shared';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import performanceService from '../../services/performanceService.js';

const router = express.Router();

// Same access as the reports pages: the owner, or a family member with the
// reports permission acting on their behalf.
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('reports'));

/**
 * @swagger
 * /v2/performance/overview:
 *   get:
 *     summary: Running, strength, load, recovery, nutrition and body trends
 *     tags: [AI & Insights]
 *     description: |
 *       Aggregates for the performance dashboard over `days` days ending at
 *       `end` (default: today in the user's timezone). Each block states
 *       whether its values are measured, computed by the device vendor, or
 *       estimated by SparkyFitness (docs/src/features/performance-analytics.md).
 *     parameters:
 *       - in: query
 *         name: end
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: days
 *         schema: { type: integer, minimum: 7, maximum: 366, default: 90 }
 *     responses:
 *       200: { description: Overview. }
 *       400: { description: Invalid query. }
 *       403: { description: No reports permission for the target user. }
 */
router.get('/overview', async (req, res, next) => {
  try {
    const parsed = performanceOverviewQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation error',
        details: parsed.error.flatten().fieldErrors,
      });
    }
    const overview = await performanceService.getOverview(
      String(req.userId),
      String(req.authenticatedUserId ?? req.userId),
      parsed.data
    );
    res.json(overview);
  } catch (error) {
    next(error);
  }
});

export default router;
