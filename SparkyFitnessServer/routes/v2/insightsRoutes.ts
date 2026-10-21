import express from 'express';
import {
  insightsReportQuerySchema,
  insightsTodayQuerySchema,
} from '@workspace/shared';
import onBehalfOfMiddleware from '../../middleware/onBehalfOfMiddleware.js';
import checkPermissionMiddleware from '../../middleware/checkPermissionMiddleware.js';
import insightsService from '../../services/insightsService.js';

// Fitness insights (personal edition): deterministic findings for the
// "Today" card and weekly/monthly reports. Same access as the performance
// and reports pages.
const router = express.Router();
router.use(onBehalfOfMiddleware);
router.use(checkPermissionMiddleware('reports'));

function badRequest(res: express.Response, error: { flatten: () => unknown }) {
  return res
    .status(400)
    .json({ error: 'Validation error', details: error.flatten() });
}

/**
 * @swagger
 * /v2/insights/today:
 *   get:
 *     summary: Findings for today, ranked, with evidence and an optional AI-worded summary
 *     tags: [Reports & Analytics]
 *     parameters:
 *       - in: query
 *         name: summary
 *         schema: { type: string, enum: ["0", "1"] }
 *       - in: query
 *         name: lang
 *         schema: { type: string }
 *     responses:
 *       200: { description: Findings, missing signals and readiness. }
 */
router.get('/today', async (req, res, next) => {
  try {
    const parsed = insightsTodayQuerySchema.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error);
    res.json(
      await insightsService.getToday(
        String(req.userId),
        String(req.authenticatedUserId ?? req.userId),
        { summary: parsed.data.summary, lang: parsed.data.lang }
      )
    );
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /v2/insights/report:
 *   get:
 *     summary: Weekly or monthly report compared with the period before
 *     tags: [Reports & Analytics]
 *     parameters:
 *       - in: query
 *         name: period
 *         schema: { type: string, enum: [week, month] }
 *       - in: query
 *         name: date
 *         schema: { type: string, format: date }
 *     responses:
 *       200: { description: Totals, previous totals, bests and findings. }
 */
router.get('/report', async (req, res, next) => {
  try {
    const parsed = insightsReportQuerySchema.safeParse(req.query);
    if (!parsed.success) return badRequest(res, parsed.error);
    res.json(
      await insightsService.getReport(
        String(req.userId),
        String(req.authenticatedUserId ?? req.userId),
        { period: parsed.data.period, date: parsed.data.date }
      )
    );
  } catch (error) {
    next(error);
  }
});

export default router;
