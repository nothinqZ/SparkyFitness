import type { PoolClient } from 'pg';
import { log } from '../../config/logging.js';
import activityDetailsRepository from '../../models/activityDetailsRepository.js';
import watchSessionImportRepository, {
  type WatchSessionImportRow,
} from '../../models/watchSessionImportRepository.js';
import {
  candidateSearchRange,
  findMatchingWatchSession,
  type GarminActivityForMatch,
} from './watchSessionMatcher.js';

const LINKED_DETAIL_TYPE = 'linked_watch_activity';

/**
 * Per-import helper for the Garmin activity processor. Loads the watch
 * sessions that could match the batch once, then answers per activity whether
 * it is the Garmin recording of a watch session. A match is linked (activity id
 * stored on the import row, Garmin summary attached to the watch workout) and
 * the caller skips creating a separate Garmin entry for it.
 */
export async function createGarminWatchLinker(
  client: PoolClient,
  userId: string,
  activities: readonly GarminActivityForMatch[]
) {
  const range = candidateSearchRange(activities);
  const candidates: WatchSessionImportRow[] = range
    ? await watchSessionImportRepository.findCandidatesForGarminImportWithClient(
        client,
        userId,
        range.from,
        range.to
      )
    : [];

  return async function linkIfWatchSession(
    activity: GarminActivityForMatch,
    rawActivityData: unknown
  ): Promise<boolean> {
    if (candidates.length === 0) return false;
    const match = findMatchingWatchSession(activity, candidates);
    if (!match || !match.exercise_preset_entry_id) return false;

    const activityId = String(activity.activityId ?? '');
    if (activityId && match.linked_garmin_activity_id !== activityId) {
      await watchSessionImportRepository.linkGarminActivityWithClient(
        client,
        userId,
        match.id,
        activityId
      );
      match.linked_garmin_activity_id = activityId;
    }
    // Replace rather than append: every Garmin re-sync of the range sees the
    // same activity again.
    await client.query(
      `DELETE FROM exercise_entry_activity_details
       WHERE exercise_preset_entry_id = $1 AND provider_name = 'garmin'
         AND detail_type = $2`,
      [match.exercise_preset_entry_id, LINKED_DETAIL_TYPE]
    );
    await activityDetailsRepository._createActivityDetailWithClient(client, {
      exercise_preset_entry_id: match.exercise_preset_entry_id,
      provider_name: 'garmin',
      detail_type: LINKED_DETAIL_TYPE,
      detail_data: rawActivityData,
      created_by_user_id: userId,
    });
    log(
      'info',
      `[garminWatchLink] Garmin activity ${activityId} is watch session ${match.client_session_id}; linked instead of imported.`
    );
    return true;
  };
}
