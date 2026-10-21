import { useCallback, useEffect, useRef } from 'react';
import WatchConnectivity, {
  type WatchWorkoutStartRequestedPayload,
} from '../../modules/watch-connectivity';
import { queryClient } from './queryClient';
import { workoutPresetsQueryKey } from './queryKeys';
import { fetchDailySummary } from '../services/api/dailySummaryApi';
import { fetchActiveWorkoutPlans } from '../services/api/workoutPlansApi';
import { getWorkoutPresetById } from '../services/api/workoutPresetsApi';
import { getActiveServerConfigId } from '../services/storage';
import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import type { WorkoutPresetsResponse } from '../types/workoutPresets';
import {
  buildPresetLiveExerciseConfigs,
  buildPresetStartExercisesPayload,
} from '../utils/workoutSession';
import { getTodayDate } from '../utils/dateUtils';
import {
  findDueAssignmentForPreset,
  getLoggedAssignmentIds,
  getUncompletedActivePlans,
} from '../utils/workoutPlanSchedule';
import type { StartLiveWorkoutArgs } from './useStartLiveWorkout';

type StartFn = (args: StartLiveWorkoutArgs) => Promise<void>;

/**
 * The phone side of "start this saved workout" from a watch: loads the
 * preset, links it to today's plan assignment when one is due, and starts it
 * like the phone's own preset list. A preset id the phone cannot load, one
 * from another server, or a second request while that preset is already live
 * is ignored. Shared by the Apple Watch (`useWatchWorkoutStart`) and the
 * Garmin watch (`useGarminWatchBridge`); each passes its own trigger.
 */
export function useWatchPresetStarter(start: StartFn): {
  run: (payload: WatchWorkoutStartRequestedPayload) => Promise<void>;
  /** Drops starts still in flight, e.g. when the trigger is switched off. */
  cancel: () => void;
} {
  const startRef = useRef(start);
  useEffect(() => {
    startRef.current = start;
  });
  const generationRef = useRef(0);
  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    []
  );

  const run = useCallback(
    async (payload: WatchWorkoutStartRequestedPayload) => {
      const generation = generationRef.current;
      const presetId = Number(payload.presetId);
      const serverId = payload.serverId;
      // A queued tap from before this field, or from another account, must
      // not start whatever preset now happens to have that id.
      if (!Number.isFinite(presetId) || !serverId) return;
      const activeServerId = await getActiveServerConfigId();
      if (generation !== generationRef.current || activeServerId !== serverId)
        return;
      const cached = queryClient.getQueryData<WorkoutPresetsResponse>(
        workoutPresetsQueryKey
      );
      let preset = cached?.presets.find((item) => item.id === presetId);
      if (preset == null) {
        try {
          preset = await getWorkoutPresetById(presetId);
        } catch {
          return;
        }
      }
      const live = useActiveWorkoutStore.getState();
      if (
        generation !== generationRef.current ||
        preset.exercises.length === 0 ||
        (await getActiveServerConfigId()) !== serverId ||
        generation !== generationRef.current ||
        (live.sessionId != null && live.sourcePresetId === preset.id)
      ) {
        return;
      }
      // A preset that is due today under an active plan counts toward that
      // plan, the same as starting it from the Diary, so the "Scheduled
      // Today" card clears. One already logged today is left unlinked.
      // Plans or the diary that fail to load just start it plain.
      let assignmentId: number | undefined;
      try {
        const today = getTodayDate();
        const [plans, dailySummary] = await Promise.all([
          fetchActiveWorkoutPlans(today),
          fetchDailySummary(today),
        ]);
        const due = findDueAssignmentForPreset(
          getUncompletedActivePlans(
            plans,
            getLoggedAssignmentIds(dailySummary.exerciseSessions)
          ),
          preset.id
        );
        if (due?.id) assignmentId = Number(due.id);
      } catch {
        // start without the plan link
      }
      if (generation !== generationRef.current) return;
      // The plan fetch can outlive the checks above. A server switch, a
      // hook restart, or a second start of this preset in that gap must
      // not start anyway.
      const liveAfter = useActiveWorkoutStore.getState();
      if (
        (await getActiveServerConfigId()) !== serverId ||
        generation !== generationRef.current ||
        (liveAfter.sessionId != null && liveAfter.sourcePresetId === preset.id)
      ) {
        return;
      }
      const exercises = buildPresetStartExercisesPayload(preset).map(
        (exercise) =>
          assignmentId == null
            ? exercise
            : { ...exercise, workout_plan_assignment_id: assignmentId }
      );
      await startRef.current({
        name: preset.name,
        exercises,
        workoutPlanAssignmentId: assignmentId,
        exerciseConfigs: buildPresetLiveExerciseConfigs(preset),
        sourcePresetId: preset.id,
        workoutFormat: preset.workout_format ?? 'standard',
        timeCapSeconds: preset.time_cap_seconds ?? null,
      });
    },
    []
  );

  const cancel = useCallback(() => {
    generationRef.current += 1;
  }, []);
  return { run, cancel };
}

/**
 * Starts a saved workout when the Apple Watch asks. The phone builds the
 * session the same way its own preset list does, then arms the watch with
 * the usual `workoutStart`.
 *
 * The listener stays up while the server is offline. A tap that arrives
 * then is kept and run once the connection is back, instead of being
 * dropped because nothing was listening. A second delivery while that
 * preset's session is already live is ignored, so a queued copy or the
 * watch's retry does not open the "workout in progress" prompt.
 */
export function useWatchWorkoutStart(
  enabled: boolean,
  connected: boolean,
  start: StartFn
): void {
  const { run, cancel } = useWatchPresetStarter(start);
  const connectedRef = useRef(connected);
  useEffect(() => {
    connectedRef.current = connected;
  });
  const pendingRef = useRef<WatchWorkoutStartRequestedPayload | null>(null);

  useEffect(() => {
    if (!enabled || !WatchConnectivity?.isSupported()) return;
    const watch = WatchConnectivity;
    const sub = watch.addListener('onWorkoutStartRequested', (payload) => {
      if (!connectedRef.current) {
        pendingRef.current = payload;
        return;
      }
      void run(payload);
    });
    return () => {
      cancel();
      sub.remove();
    };
  }, [enabled, run, cancel]);

  useEffect(() => {
    if (!enabled || !connected) return;
    const pending = pendingRef.current;
    if (pending == null) return;
    pendingRef.current = null;
    void run(pending);
  }, [enabled, connected, run]);
}
