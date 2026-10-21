import { createHash } from 'node:crypto';
import {
  deriveFindings,
  missingSignals,
  periodBests,
  periodTotals,
  type FitnessFinding,
  type InsightsReportResponse,
  type InsightsTodayResponse,
  todayInZone,
} from '@workspace/shared';
import { log } from '../config/logging.js';
import chatRepository from '../models/chatRepository.js';
import globalSettingsRepository from '../models/globalSettingsRepository.js';
import {
  dispatchAiRequest,
  type JsonSchemaNode,
  type ProviderConfig,
} from '../ai/providerDispatch.js';
import { resolveAiNetworkPolicy } from '../utils/outboundUrlPolicy.js';
import { loadUserTimezone } from '../utils/timezoneLoader.js';
import performanceService, { shiftDay } from './performanceService.js';

// Fitness insights for the personal edition: the "Today" card and period
// reports. All statements come from the deterministic rules in
// shared/src/analytics/insights.ts; an AI service, when the user has one,
// only words them (summary), and the clients render each finding from its
// rule id either way.

/** Days of history the findings look at (baselines need ~60 + 7). */
const INSIGHT_WINDOW_DAYS = 90;
/** Upper bound for an AI-worded summary; anything longer is dropped. */
const MAX_SUMMARY_CHARS = 420;

// AI summaries are cached per user, day, language and findings, so the card
// costs one model call per day at most (the data changes nightly).
const summaryCache = new Map<string, string>();
const MAX_CACHE = 200;

function findingsHash(findings: FitnessFinding[]): string {
  return createHash('sha256')
    .update(JSON.stringify(findings.map((f) => [f.id, f.params])))
    .digest('hex')
    .slice(0, 16);
}

const SUMMARY_SCHEMA: JsonSchemaNode = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
  additionalProperties: false,
};

export function buildSummaryPrompt(
  findings: FitnessFinding[],
  missing: string[],
  lang: string
): string {
  const language = lang.toLowerCase().startsWith('de') ? 'German' : 'English';
  return [
    `Write at most two short sentences in ${language} for a fitness app's "today" card.`,
    'Use ONLY the findings below. Do not add numbers, causes or advice that are not in them.',
    'Keep the epistemic status: an "observation" is only noticed, a "hypothesis" is only possible (say so), a "finding" is established.',
    'No medical claims. Address the user informally (du in German). Lead with the first finding.',
    missing.length > 0
      ? `Data that is missing and must not be guessed: ${missing.join(', ')}.`
      : '',
    'Findings (most important first):',
    JSON.stringify(
      findings.slice(0, 4).map((f) => ({
        rule: f.id,
        kind: f.kind,
        tone: f.tone,
        values: f.params,
        evidence: f.evidence,
      }))
    ),
    'Answer as JSON: {"summary": "..."}',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * The user's own AI service words the findings, or null: no service, user
 * AI disabled by the admin, a failure, or an implausible answer. Never
 * throws; the card works without it.
 */
async function aiSummary(
  userId: string,
  asOf: string,
  findings: FitnessFinding[],
  missing: string[],
  lang: string
): Promise<string | null> {
  if (findings.length === 0) return null;
  const key = `${userId}|${asOf}|${lang}|${findingsHash(findings)}`;
  const cached = summaryCache.get(key);
  if (cached) return cached;
  try {
    if (!(await globalSettingsRepository.isUserAiConfigAllowed())) return null;
    const setting = await chatRepository.getActiveAiServiceSetting(userId);
    if (!setting) return null;
    const aiService = await chatRepository.getAiServiceSettingForBackend(
      setting.id,
      userId
    );
    if (!aiService) return null;
    const provider: ProviderConfig = {
      service_type: aiService.service_type,
      api_key: aiService.api_key ?? undefined,
      model_name: aiService.model_name ?? undefined,
      custom_url: aiService.custom_url ?? undefined,
    };
    const result = await dispatchAiRequest({
      provider,
      networkPolicy: await resolveAiNetworkPolicy(aiService, false),
      prompt: buildSummaryPrompt(findings, missing, lang),
      jsonSchema: SUMMARY_SCHEMA,
      schemaName: 'insight_summary',
      temperature: 0.2,
    });
    if (!result.ok) {
      log(
        'warn',
        `[insights] AI summary failed (${result.category}): ${result.detail}`
      );
      return null;
    }
    const text = (result.json as { summary?: unknown } | null)?.summary;
    if (typeof text !== 'string') return null;
    const trimmed = text.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_SUMMARY_CHARS) return null;
    if (summaryCache.size >= MAX_CACHE) {
      summaryCache.delete(summaryCache.keys().next().value as string);
    }
    summaryCache.set(key, trimmed);
    return trimmed;
  } catch (error) {
    log('warn', `[insights] AI summary error: ${(error as Error).message}`);
    return null;
  }
}

export function clearSummaryCache(): void {
  summaryCache.clear();
}

async function getToday(
  targetUserId: string,
  authenticatedUserId: string,
  options: { summary: boolean; lang?: string }
): Promise<InsightsTodayResponse> {
  const overview = await performanceService.getOverview(
    targetUserId,
    authenticatedUserId,
    { days: INSIGHT_WINDOW_DAYS }
  );
  const asOf = overview.range.end;
  const findings = deriveFindings(overview, asOf);
  const missing = missingSignals(overview, asOf);
  const summary = options.summary
    ? await aiSummary(
        targetUserId,
        asOf,
        findings,
        missing,
        options.lang ?? 'en'
      )
    : null;
  return {
    asOf,
    dataThrough: lastDataDay(overview) ?? asOf,
    findings,
    missing,
    readiness: {
      estimated: overview.recovery.readiness.estimated?.score ?? null,
      components: overview.recovery.readiness.estimated?.components ?? {},
      device: overview.recovery.readiness.device,
    },
    summary: summary ? { text: summary, source: 'ai' } : null,
  };
}

/** Latest day with any measured or logged value. */
function lastDataDay(
  overview: Awaited<ReturnType<typeof performanceService.getOverview>>
): string | null {
  const dates = [
    overview.recovery.hrv.series.at(-1)?.date,
    overview.recovery.restingHr.series.at(-1)?.date,
    overview.recovery.sleep.series.at(-1)?.date,
    overview.body.weight.at(-1)?.date,
    overview.nutrition.daily.filter((d) => d.calories > 0).at(-1)?.date,
  ].filter((d): d is string => typeof d === 'string');
  return dates.length === 0 ? null : dates.sort().at(-1)!;
}

/** Monday of the ISO week containing `date`. */
function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return shiftDay(date, -((d.getUTCDay() + 6) % 7));
}

/**
 * Start and end of the report period. Without a date: the last complete
 * week (Monday to Sunday) or calendar month before `today`.
 */
export function reportPeriod(
  period: 'week' | 'month',
  today: string,
  date?: string
): { start: string; end: string; previousStart: string; previousEnd: string } {
  if (period === 'week') {
    const start = date ? weekStart(date) : shiftDay(weekStart(today), -7);
    const end = shiftDay(start, 6);
    return {
      start,
      end,
      previousStart: shiftDay(start, -7),
      previousEnd: shiftDay(start, -1),
    };
  }
  const anchor = date ?? `${today.slice(0, 7)}-01`;
  let [y, m] = anchor.split('-').map(Number) as [number, number];
  if (!date) {
    // The month before the current one.
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const monthStart = (yy: number, mm: number) =>
    `${yy}-${String(mm).padStart(2, '0')}-01`;
  const start = monthStart(y, m);
  const next = m === 12 ? monthStart(y + 1, 1) : monthStart(y, m + 1);
  const prev = m === 1 ? monthStart(y - 1, 12) : monthStart(y, m - 1);
  return {
    start,
    end: shiftDay(next, -1),
    previousStart: prev,
    previousEnd: shiftDay(start, -1),
  };
}

function daysBetween(start: string, end: string): number {
  return (
    Math.round(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) /
        86_400_000
    ) + 1
  );
}

async function getReport(
  targetUserId: string,
  authenticatedUserId: string,
  options: { period: 'week' | 'month'; date?: string; today?: string }
): Promise<InsightsReportResponse> {
  const today =
    options.today ?? todayInZone(await loadUserTimezone(targetUserId));
  const p = reportPeriod(options.period, today, options.date);
  const [current, previous, longWindow] = await Promise.all([
    performanceService.getOverview(targetUserId, authenticatedUserId, {
      end: p.end,
      days: daysBetween(p.start, p.end),
    }),
    performanceService.getOverview(targetUserId, authenticatedUserId, {
      end: p.previousEnd,
      days: daysBetween(p.previousStart, p.previousEnd),
    }),
    performanceService.getOverview(targetUserId, authenticatedUserId, {
      end: p.end,
      days: INSIGHT_WINDOW_DAYS,
    }),
  ]);
  return {
    period: options.period,
    start: p.start,
    end: p.end,
    totals: periodTotals(current),
    previous: periodTotals(previous),
    bests: periodBests(longWindow, p.start, p.end),
    findings: deriveFindings(longWindow, p.end),
    missing: missingSignals(longWindow, p.end),
  };
}

export default { getToday, getReport };
