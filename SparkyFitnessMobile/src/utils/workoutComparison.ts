import type {
  ExerciseRecentSessionSet,
  PresetSessionResponse,
} from '@workspace/shared';
import { isWarmupSetType } from './workoutSession';

/**
 * Weighted volume (kg x reps) of last session's working sets, or null when
 * that session had no weighted set to compare with (bodyweight, timed).
 */
export function previousWorkingVolumeKg(
  sets: readonly ExerciseRecentSessionSet[] | null | undefined
): number | null {
  if (!sets || sets.length === 0) return null;
  let volume = 0;
  let weighted = false;
  for (const set of sets) {
    if (isWarmupSetType(set.setType)) continue;
    if (set.weight == null || set.reps == null) continue;
    weighted = true;
    volume += set.weight * set.reps;
  }
  return weighted ? volume : null;
}

/**
 * Change against last time per session entry, as Hevy's workout summary
 * shows it: today's volume minus last session's, for exercises with both.
 */
export function volumeChangeByEntry(
  session: PresetSessionResponse,
  rows: readonly { entryId: string; volumeKg: number }[],
  previousSessionSets: Record<string, ExerciseRecentSessionSet[]> | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!previousSessionSets) return out;
  for (const row of rows) {
    if (row.volumeKg <= 0) continue;
    const exerciseId = session.exercises.find(
      (e) => e.id === row.entryId
    )?.exercise_id;
    if (!exerciseId) continue;
    const before = previousWorkingVolumeKg(previousSessionSets[exerciseId]);
    if (before === null) continue;
    out[row.entryId] = row.volumeKg - before;
  }
  return out;
}
