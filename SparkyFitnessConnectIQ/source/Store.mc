import Toybox.Lang;
import Toybox.Application;
import Toybox.Application.Storage;
import Toybox.Application.Properties;
import Toybox.Cryptography;
import Toybox.System;
import Toybox.Time;
import Toybox.WatchUi;

// Everything the app keeps between launches lives in Application.Storage, so a
// workout survives the app being closed, the watch rebooting or the phone
// being out of range. The active session is saved after every logged set.
module Store {

    const KEY_ACTIVE = "active";
    const KEY_DEVICE_ID = "deviceId";
    const KEY_LAST_SYNC = "lastSync";
    const KEY_LAST_ERROR = "lastError";
    // API key obtained by pairing (PairingView). Takes precedence over the
    // apiKey app setting, which only store-installed apps can edit.
    const KEY_PAIRED_API_KEY = "pairedApiKey";

    // A single Storage value may hold at most 32 KB, and a real manifest or a
    // few queued workouts easily exceed that (a 45 KB manifest crashed the app
    // on every start). So nothing that grows with the plan or the queue is
    // stored as one value: each workout, queued upload and failed upload gets
    // its own key, and a small index value lists them.
    const KEY_WORKOUT_INDEX = "workoutIndex";
    const WORKOUT_PREFIX = "workout_";
    const KEY_WEIGHT_UNIT = "weightUnit";
    const KEY_QUEUE_IDS = "queueIds";
    const QUEUE_PREFIX = "queued_";
    const KEY_FAILED_INDEX = "failedIndex";
    // Live workout from the phone (PhoneLink) and messages waiting for it.
    // Both stay small: one workout plan, and outbox entries of ~150 bytes,
    // capped at MAX_OUTBOX.
    const KEY_LIVE = "live";
    const KEY_OUTBOX = "outbox";
    const FAILED_PREFIX = "failed_";
    // Single-value layouts of version 0.1.0, migrated or dropped on start.
    const LEGACY_MANIFEST = "manifest";
    const LEGACY_QUEUE = "queue";
    const LEGACY_FAILED = "failed";

    // Uploads that the server rejected for good are kept for inspection, but
    // only the most recent few, so they cannot fill the storage.
    const MAX_FAILED = 5;
    // A full workout of logged sets plus slack; far below the 32 KB limit.
    const MAX_OUTBOX = 120;

    // Storage.setValue throws when the value is too large or the object store
    // is full. An uncaught exception ends the app, so every write goes
    // through here and reports failure instead.
    function trySet(key as String, value as Application.PropertyValueType) as Boolean {
        try {
            Storage.setValue(key, value);
            return true;
        } catch (e) {
            return false;
        }
    }

    // Moves data written by 0.1.0 into the per-key layout. Called once per
    // app start before the first sync.
    function migrate() as Void {
        if (Storage.getValue(LEGACY_MANIFEST) != null) {
            // Refetched on the next sync; the old value may be partial.
            Storage.deleteValue(LEGACY_MANIFEST);
        }
        var legacy = Storage.getValue(LEGACY_QUEUE);
        if (legacy != null) {
            var q = legacy as Array;
            var all = true;
            for (var i = 0; i < q.size(); i++) {
                all = enqueue(q[i] as Dictionary) && all;
            }
            // Keep the old queue if any session could not be moved.
            if (all) {
                Storage.deleteValue(LEGACY_QUEUE);
            }
        }
        Storage.deleteValue(LEGACY_FAILED);
    }

    function newUuid() as String {
        return SparkyLogic.uuidFromBytes(Cryptography.randomBytes(16));
    }

    function deviceId() as String {
        var id = Storage.getValue(KEY_DEVICE_ID);
        if (id == null) {
            id = newUuid();
            trySet(KEY_DEVICE_ID, id);
        }
        return id as String;
    }

    function serverUrl() as String or Null {
        return SparkyLogic.normalizeBaseUrl(Properties.getValue("serverUrl") as String or Null);
    }

    function apiKey() as String or Null {
        var paired = Storage.getValue(KEY_PAIRED_API_KEY) as String or Null;
        if (paired != null && paired.length() > 0) {
            return paired;
        }
        var key = Properties.getValue("apiKey") as String or Null;
        if (key == null || key.length() == 0) {
            return null;
        }
        return key;
    }

    function setPairedApiKey(key as String) as Void {
        trySet(KEY_PAIRED_API_KEY, key);
        Storage.deleteValue(KEY_LAST_ERROR);
    }

    // Forget the paired key, e.g. after the server answered 401 because the
    // key was revoked in SparkyFitness.
    function clearPairedApiKey() as Void {
        Storage.deleteValue(KEY_PAIRED_API_KEY);
    }

    function hasServerUrl() as Boolean {
        return serverUrl() != null;
    }

    function isConfigured() as Boolean {
        return serverUrl() != null && apiKey() != null;
    }

    function defaultRestSeconds() as Number {
        var v = Properties.getValue("defaultRestSeconds");
        return v instanceof Number && v > 0 ? v as Number : 90;
    }

    function recordActivity() as Boolean {
        var v = Properties.getValue("recordActivity");
        return v instanceof Boolean ? v as Boolean : true;
    }

    // Stores a downloaded manifest, one compacted workout per key. Returns
    // false when some workouts did not fit; the ones that did stay usable.
    function setManifest(m as Dictionary) as Boolean {
        var incoming = m["workouts"] as Array;
        var oldCount = workouts().size();
        var index = [] as Array;
        for (var i = 0; i < incoming.size(); i++) {
            var compact = SparkyLogic.compactWorkout(incoming[i] as Dictionary);
            if (trySet(WORKOUT_PREFIX + index.size(), compact)) {
                index.add(SparkyLogic.workoutSummary(compact));
            }
        }
        for (var j = index.size(); j < oldCount; j++) {
            Storage.deleteValue(WORKOUT_PREFIX + j);
        }
        var stored = trySet(KEY_WORKOUT_INDEX, index);
        trySet(KEY_WEIGHT_UNIT, "lbs".equals(m["weight_unit"]) ? "lbs" : "kg");
        return stored && index.size() == incoming.size();
    }

    // Start-menu entries: [{ "name", "exercises" (count), "scheduled_date" }].
    function workouts() as Array {
        var index = Storage.getValue(KEY_WORKOUT_INDEX);
        return index == null ? [] as Array : index as Array;
    }

    function workout(i as Number) as Dictionary or Null {
        return Storage.getValue(WORKOUT_PREFIX + i) as Dictionary or Null;
    }

    function weightUnit() as String {
        return "lbs".equals(Storage.getValue(KEY_WEIGHT_UNIT)) ? "lbs" : "kg";
    }

    // --- Live workout from the phone ---------------------------------------

    function live() as Dictionary or Null {
        return Storage.getValue(KEY_LIVE) as Dictionary or Null;
    }

    function setLive(plan as Dictionary) as Boolean {
        return trySet(KEY_LIVE, plan);
    }

    function clearLive() as Void {
        Storage.deleteValue(KEY_LIVE);
    }

    function outbox() as Array {
        var box = Storage.getValue(KEY_OUTBOX);
        return box == null ? [] as Array : box as Array;
    }

    // Returns false when the outbox is full or cannot be stored.
    function enqueueOutbox(message as Dictionary) as Boolean {
        var box = outbox();
        if (box.size() >= MAX_OUTBOX) {
            return false;
        }
        box.add(message);
        return trySet(KEY_OUTBOX, box);
    }

    function dequeueOutbox() as Void {
        var box = outbox();
        if (box.size() > 0) {
            trySet(KEY_OUTBOX, box.slice(1, null));
        }
    }

    // Sets logged on the watch that the phone has not received yet, as
    // setId => [reps, weightKg] (see SparkyLogic.mergePendingSets).
    function pendingLiveSets() as Dictionary {
        var pending = {} as Dictionary;
        var box = outbox();
        for (var i = 0; i < box.size(); i++) {
            var message = box[i] as Dictionary;
            if ("set".equals(message["t"])) {
                pending[message["id"]] = [message["r"], message["w"]];
            }
        }
        return pending;
    }

    // Sets added on the watch beyond the plan, not yet received by the phone
    // (outbox "add" messages; see SparkyLogic.mergePendingAdds).
    function pendingLiveAdds() as Array {
        var adds = [] as Array;
        var box = outbox();
        for (var i = 0; i < box.size(); i++) {
            var message = box[i] as Dictionary;
            if ("add".equals(message["t"])) {
                adds.add(message);
            }
        }
        return adds;
    }

    function activeSession() as Dictionary or Null {
        return Storage.getValue(KEY_ACTIVE) as Dictionary or Null;
    }

    function saveActiveSession(s as Dictionary) as Boolean {
        return trySet(KEY_ACTIVE, s);
    }

    function clearActiveSession() as Void {
        Storage.deleteValue(KEY_ACTIVE);
    }

    function queueIds() as Array {
        var ids = Storage.getValue(KEY_QUEUE_IDS);
        return ids == null ? [] as Array : ids as Array;
    }

    function queueSize() as Number {
        return queueIds().size();
    }

    // Oldest queued upload, or null when the queue is empty.
    function queueHead() as Dictionary or Null {
        var ids = queueIds();
        while (ids.size() > 0) {
            var upload = Storage.getValue(QUEUE_PREFIX + ids[0]);
            if (upload != null) {
                return upload as Dictionary;
            }
            // Index entry without a payload: drop it rather than stall.
            ids = ids.slice(1, null);
            trySet(KEY_QUEUE_IDS, ids);
        }
        return null;
    }

    // Returns false when the upload could not be stored; the caller keeps
    // the workout in that case.
    function enqueue(upload as Dictionary) as Boolean {
        var id = upload["client_session_id"] as String;
        var ids = queueIds();
        // Idempotent on the client side as well: never queue a session twice.
        for (var i = 0; i < ids.size(); i++) {
            if (id.equals(ids[i])) {
                return true;
            }
        }
        if (!trySet(QUEUE_PREFIX + id, upload)) {
            return false;
        }
        ids.add(id);
        if (!trySet(KEY_QUEUE_IDS, ids)) {
            Storage.deleteValue(QUEUE_PREFIX + id);
            return false;
        }
        return true;
    }

    function dequeueHead() as Void {
        var ids = queueIds();
        if (ids.size() > 0) {
            Storage.deleteValue(QUEUE_PREFIX + ids[0]);
            trySet(KEY_QUEUE_IDS, ids.slice(1, null));
        }
    }

    function moveHeadToFailed(code as Number) as Void {
        var ids = queueIds();
        if (ids.size() == 0) {
            return;
        }
        var id = ids[0] as String;
        var upload = Storage.getValue(QUEUE_PREFIX + id);
        var failed = Storage.getValue(KEY_FAILED_INDEX);
        var list = failed == null ? [] as Array : failed as Array;
        if (upload != null && trySet(FAILED_PREFIX + id, upload)) {
            list.add({ "code" => code, "client_session_id" => id });
            while (list.size() > MAX_FAILED) {
                Storage.deleteValue(FAILED_PREFIX + ((list[0] as Dictionary)["client_session_id"] as String));
                list = list.slice(1, null);
            }
            trySet(KEY_FAILED_INDEX, list);
        }
        dequeueHead();
    }

    function markSynced() as Void {
        trySet(KEY_LAST_SYNC, Time.now().value());
        Storage.deleteValue(KEY_LAST_ERROR);
    }

    function lastSync() as Number or Null {
        return Storage.getValue(KEY_LAST_SYNC) as Number or Null;
    }

    function setLastError(message as String) as Void {
        trySet(KEY_LAST_ERROR, message);
    }

    function lastError() as String or Null {
        return Storage.getValue(KEY_LAST_ERROR) as String or Null;
    }

    // Product name such as "Forerunner 265" (resources-<device>), else the
    // part number for a product the app has no name for.
    function deviceModel() as String or Null {
        var name = WatchUi.loadResource(Rez.Strings.DeviceName) as String;
        if (name.length() > 0) {
            return name;
        }
        var settings = System.getDeviceSettings();
        return settings has :partNumber ? settings.partNumber : null;
    }
}
