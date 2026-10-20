// Recognises a Garmin Connect activity as the recording of a session that the
// SparkyFitness Connect IQ app already uploaded, so the Garmin import can link
// the two instead of logging the workout a second time.
//
// Garmin Connect does not carry our session id: Connect IQ can only add custom
// FIT developer fields, and the activity summary the import reads does not
// return them. The match is therefore time based: same user, a strength-type
// activity, and a start within MATCH_WINDOW_MS of the watch session's start.

export const MATCH_WINDOW_MS = 10 * 60 * 1000;

// What a Connect IQ app recording SPORT_TRAINING / SUB_SPORT_STRENGTH_TRAINING
// shows up as, plus the generic types older firmware falls back to.
const MATCHABLE_TYPE_KEYS = new Set([
  'strength_training',
  'training',
  'indoor_cardio',
  'other',
]);

export interface GarminActivityForMatch {
  activityId?: number | string;
  startTimeGMT?: string;
  startTimeLocal?: string;
  activityType?: { typeKey?: string };
}

export interface WatchSessionForMatch {
  id: string;
  started_at: Date | string;
  started_at_local: string | null;
  linked_garmin_activity_id: string | null;
}

// Garmin reports "YYYY-MM-DD HH:MM:SS" with no offset; startTimeGMT is UTC and
// startTimeLocal is wall-clock time. Both parse as UTC here, which is correct
// for GMT and gives a consistent scale for local-vs-local comparisons.
function parseGarminTimestamp(value: string | undefined | null): number | null {
  if (!value) return null;
  const normalized = value.trim().replace(' ', 'T');
  const withZone = /[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? null : ms;
}

export function isMatchableActivityType(
  activity: GarminActivityForMatch
): boolean {
  const typeKey = activity.activityType?.typeKey;
  return !typeKey || MATCHABLE_TYPE_KEYS.has(typeKey);
}

/**
 * Picks the watch session that the Garmin activity most likely recorded, or
 * null. A session already linked to a different Garmin activity is never
 * reused, so two activities cannot both collapse into one session.
 */
export function findMatchingWatchSession<T extends WatchSessionForMatch>(
  activity: GarminActivityForMatch,
  candidates: readonly T[]
): T | null {
  if (!isMatchableActivityType(activity)) return null;
  const activityId =
    activity.activityId !== undefined && activity.activityId !== null
      ? String(activity.activityId)
      : null;
  // A session already linked to this very activity (an earlier sync of the
  // same range) always wins; re-matching by time could pick a different
  // session with the same start and break the link on every re-sync.
  if (activityId) {
    const linked = candidates.find(
      (c) => c.linked_garmin_activity_id === activityId
    );
    if (linked) return linked;
  }

  const gmtStart = parseGarminTimestamp(activity.startTimeGMT);
  const localStart = parseGarminTimestamp(activity.startTimeLocal);

  let best: T | null = null;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (
      candidate.linked_garmin_activity_id &&
      candidate.linked_garmin_activity_id !== activityId
    ) {
      continue;
    }
    let delta: number | null = null;
    if (gmtStart !== null) {
      const start = new Date(candidate.started_at).getTime();
      if (!Number.isNaN(start)) delta = Math.abs(start - gmtStart);
    } else if (localStart !== null && candidate.started_at_local) {
      const start = parseGarminTimestamp(candidate.started_at_local);
      if (start !== null) delta = Math.abs(start - localStart);
    }
    if (delta !== null && delta <= MATCH_WINDOW_MS && delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

/**
 * UTC search range for candidate sessions around a batch of activities, or
 * null when no activity in the batch could be a watch session (a sync of only
 * runs and rides then costs no extra query).
 */
export function candidateSearchRange(
  activities: readonly GarminActivityForMatch[]
): { from: string; to: string } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const activity of activities) {
    if (!isMatchableActivityType(activity)) continue;
    // Local time can be up to 14h away from UTC; widen the range so the
    // local-time fallback still sees every possible candidate.
    const gmt = parseGarminTimestamp(activity.startTimeGMT);
    const local = parseGarminTimestamp(activity.startTimeLocal);
    const slack = gmt !== null ? 0 : 14 * 60 * 60 * 1000;
    const point = gmt ?? local;
    if (point === null) continue;
    min = Math.min(min, point - slack);
    max = Math.max(max, point + slack);
  }
  if (!Number.isFinite(min)) return null;
  return {
    from: new Date(min - MATCH_WINDOW_MS).toISOString(),
    to: new Date(max + MATCH_WINDOW_MS).toISOString(),
  };
}
