import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import GarminConnectIQ from '../../modules/garmin-connectiq';
import { addLog } from '../services/LogService';
import { getActiveServerConfigId } from '../services/storage';
import {
  useActiveWorkoutStore,
  type ActiveSetPatch,
  type ActiveWorkoutState,
} from '../stores/activeWorkoutStore';
import { useGarminWatchStore } from '../stores/garminWatchStore';
import {
  buildGarminPlanMessage,
  parseGarminWatchMessage,
  type GarminPhoneMessage,
  type GarminWatchSetMessage,
} from '../utils/garminWatchPlan';
import { boundedWatchCompletedAt } from '../utils/watchTelemetryAttribution';
import {
  buildWorkoutCelebration,
  type WorkoutCelebration,
} from '../utils/workoutCelebration';
import { isTempSetId } from '../utils/workoutSession';
import { queryClient } from './queryClient';
import { saveActiveWorkoutSession } from './useActiveWorkoutAutosave';
import { buildWatchWorkoutStartPayload } from './useStartLiveWorkout';
import type { StartLiveWorkoutArgs } from './useStartLiveWorkout';
import { useWatchPresetStarter } from './useWatchWorkoutStart';

/** URL scheme Garmin Connect returns to after device selection (app.json). */
export const GARMIN_URL_SCHEME = 'sparkyfitness-ciq';

/** A start request older than this was queued on the watch too long. */
const START_REQUEST_MAX_AGE_S = 120;
/** Coalesces bursts of store changes (a set completion touches several). */
const PUBLISH_DEBOUNCE_MS = 400;
const MAX_REMEMBERED_CLIENT_IDS = 200;

/**
 * The plan to show on the watch for the current store state, or null when
 * there is no live preset workout or a set still has a temporary id (a set
 * logged on the watch under that id would match nothing once the autosave
 * swaps in the server id).
 */
function currentPlan(
  state: ActiveWorkoutState,
  t: Parameters<typeof buildWatchWorkoutStartPayload>[1]
): GarminPhoneMessage | null {
  const { session, sessionId } = state;
  if (session == null || sessionId == null || session.type !== 'preset') {
    return null;
  }
  if (
    session.exercises.some((exercise) =>
      exercise.sets.some((set) => isTempSetId(set.id))
    )
  ) {
    return null;
  }
  const plan = buildWatchWorkoutStartPayload(
    session,
    t,
    state.watchArmedAt ?? state.startedAt ?? Date.now()
  );
  return buildGarminPlanMessage(plan, state);
}

/**
 * Applies a set logged on the Garmin watch to the live workout the same way
 * the Apple Watch bridge does: the wearer's values first (completion only
 * fills fields that are still empty), then the store's own `completeSet`,
 * which owns rest timers, PR detection and autosave dirtying, then an
 * immediate save because the phone screen may not be open.
 */
export async function applyGarminSet(
  message: GarminWatchSetMessage
): Promise<void> {
  const state = useActiveWorkoutStore.getState();
  if (state.sessionId !== message.sid) {
    addLog(
      `Garmin set ignored: no matching active session (${message.sid})`,
      'WARNING'
    );
    return;
  }
  if (!state.steps.some((step) => step.setId === message.id)) {
    addLog(`Garmin set ignored: unknown set ${message.id}`, 'WARNING');
    return;
  }
  if (state.completedSetIds[message.id] != null) return;
  const patch: ActiveSetPatch = {};
  if (message.w != null) patch.weight = message.w;
  if (message.r != null) patch.reps = message.r;
  if (message.rpe != null) patch.rpe = message.rpe;
  if (Object.keys(patch).length > 0) state.updateSetField(message.id, patch);
  const completedAt =
    message.at != null ? new Date(message.at * 1000).toISOString() : null;
  state.completeSet(
    message.id,
    boundedWatchCompletedAt(completedAt, state.startedAt, Date.now())
  );
  await saveActiveWorkoutSession(queryClient);
}

/**
 * Ends the live workout because the wearer finished it on the watch, like the
 * phone's own Finish: save, snapshot the completion screen, clear. A failed
 * save keeps the workout open so the phone's Finish can retry it.
 */
export async function finishFromGarmin(
  sessionId: string
): Promise<WorkoutCelebration | null | undefined> {
  if (useActiveWorkoutStore.getState().sessionId !== sessionId)
    return undefined;
  const outcome = await saveActiveWorkoutSession(queryClient);
  if (outcome === 'failed') {
    addLog(
      `Garmin finish kept the phone workout open: saving session ${sessionId} failed`,
      'WARNING'
    );
    return undefined;
  }
  const celebration = buildWorkoutCelebration(useActiveWorkoutStore.getState());
  useActiveWorkoutStore.getState().clearWorkout();
  return celebration;
}

/**
 * Keeps the Sparky Strength Connect IQ app on a Garmin watch in step with the
 * phone's live workout over Bluetooth (no internet needed), the Garmin
 * counterpart of `useWatchWorkoutBridge` + `useWatchPlanSync`.
 *
 * Phone → watch: the plan with resolved targets, done sets and the running
 * rest, sent whenever it changes, when the watch connects and when the watch
 * app says hello; `end` when the workout is finished or discarded here.
 * Watch → phone: logged sets, start requests for a saved workout, finish.
 *
 * Also owns the SDK start-up and Garmin Connect's device-selection reply,
 * which arrives through the `sparkyfitness-ciq://` URL scheme.
 */
export function useGarminWatchBridge(
  start: (args: StartLiveWorkoutArgs) => Promise<void>,
  onWatchFinished: (celebration: WorkoutCelebration | null) => void
): void {
  const { t } = useTranslation();
  const { run: runStart } = useWatchPresetStarter(start);
  const runStartRef = useRef(runStart);
  const onFinishedRef = useRef(onWatchFinished);
  const tRef = useRef(t);
  useEffect(() => {
    runStartRef.current = runStart;
    onFinishedRef.current = onWatchFinished;
    tRef.current = t;
  });

  useEffect(() => {
    const sdk = GarminConnectIQ;
    if (sdk == null || !sdk.isAvailable()) return;
    let disposed = false;
    // What the watch was last sent, so only a change goes out. Null forces
    // the next publish (after a failed send, a connect, or a hello).
    let lastSent: string | null = null;
    let lastSessionId: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handledClientIds: string[] = [];
    const store = useGarminWatchStore.getState();

    const send = async (message: GarminPhoneMessage): Promise<boolean> => {
      try {
        return (
          (await sdk.sendMessage(
            message as unknown as Record<string, unknown>
          )) > 0
        );
      } catch (error) {
        addLog(`Garmin send failed: ${String(error)}`, 'WARNING');
        return false;
      }
    };

    const publish = async (force: boolean): Promise<void> => {
      if (disposed) return;
      const state = useActiveWorkoutStore.getState();
      let message = currentPlan(state, tRef.current);
      if (message == null) {
        if (state.sessionId != null && state.session != null) {
          // Live, but waiting for server ids; the next change publishes.
          return;
        }
        message =
          lastSessionId != null
            ? { t: 'end', sid: lastSessionId }
            : { t: 'none' };
      }
      const key = JSON.stringify(message);
      if (!force && key === lastSent) return;
      const ok = await send(message);
      lastSent = ok ? key : null;
      if (ok) lastSessionId = message.t === 'plan' ? message.sid : null;
    };

    const schedulePublish = (): void => {
      if (timer != null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void publish(false);
      }, PUBLISH_DEBOUNCE_MS);
    };

    const rememberClientId = (clientId: string): boolean => {
      if (handledClientIds.includes(clientId)) return false;
      handledClientIds.push(clientId);
      if (handledClientIds.length > MAX_REMEMBERED_CLIENT_IDS) {
        handledClientIds.shift();
      }
      return true;
    };

    const handleMessage = async (raw: unknown): Promise<void> => {
      const message = parseGarminWatchMessage(raw);
      if (message == null) return;
      if (message.t === 'hello') {
        await publish(true);
        return;
      }
      if (!rememberClientId(message.c)) return;
      if (message.t === 'set') {
        await applyGarminSet(message);
        return;
      }
      if (message.t === 'start') {
        if (
          message.at != null &&
          Date.now() / 1000 - message.at > START_REQUEST_MAX_AGE_S
        ) {
          addLog('Garmin start request ignored: too old', 'DEBUG');
          return;
        }
        const serverId = await getActiveServerConfigId();
        if (serverId == null) return;
        await runStartRef.current({ presetId: String(message.p), serverId });
        return;
      }
      const celebration = await finishFromGarmin(message.sid);
      if (celebration !== undefined) onFinishedRef.current(celebration);
    };

    const handleUrl = async (url: string | null): Promise<void> => {
      if (url == null || !url.startsWith(`${GARMIN_URL_SCHEME}://`)) return;
      const devices = await sdk.handleUrl(url);
      useGarminWatchStore.getState().setDevices(devices);
      lastSent = null;
      void publish(true);
    };

    const messageSub = sdk.addListener('onMessage', (event) => {
      void handleMessage(event.message);
    });
    const statusSub = sdk.addListener('onDeviceStatus', (event) => {
      useGarminWatchStore
        .getState()
        .setDeviceStatus(event.deviceId, event.status);
      if (event.status === 'connected') {
        lastSent = null;
        void publish(true);
      }
    });
    const urlSub = Linking.addEventListener('url', (event) => {
      void handleUrl(event.url);
    });
    const unsubscribeStore = useActiveWorkoutStore.subscribe((state, prev) => {
      if (
        state.session === prev.session &&
        state.sessionId === prev.sessionId &&
        state.completedSetIds === prev.completedSetIds &&
        state.activeSetId === prev.activeSetId &&
        state.rest === prev.rest
      ) {
        return;
      }
      schedulePublish();
    });

    void (async () => {
      const ok = await sdk.initialize(GARMIN_URL_SCHEME);
      if (disposed || !ok) return;
      store.setReady(true);
      store.setDevices(await sdk.getDevices());
      await handleUrl(await Linking.getInitialURL());
      void publish(true);
    })();

    return () => {
      disposed = true;
      if (timer != null) clearTimeout(timer);
      messageSub.remove();
      statusSub.remove();
      urlSub.remove();
      unsubscribeStore();
    };
  }, []);
}
