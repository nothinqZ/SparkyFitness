import Toybox.Lang;
import Toybox.Application;
import Toybox.Application.Storage;
import Toybox.Application.Properties;
import Toybox.Cryptography;
import Toybox.System;
import Toybox.Time;

// Everything the app keeps between launches lives in Application.Storage, so a
// workout survives the app being closed, the watch rebooting or the phone
// being out of range. The active session is saved after every logged set.
module Store {

    const KEY_MANIFEST = "manifest";
    const KEY_ACTIVE = "active";
    const KEY_QUEUE = "queue";
    const KEY_FAILED = "failed";
    const KEY_DEVICE_ID = "deviceId";
    const KEY_LAST_SYNC = "lastSync";
    const KEY_LAST_ERROR = "lastError";
    // API key obtained by pairing (PairingView). Takes precedence over the
    // apiKey app setting, which only store-installed apps can edit.
    const KEY_PAIRED_API_KEY = "pairedApiKey";

    // Uploads that the server rejected for good are kept for inspection, but
    // only the most recent few, so they cannot fill the storage.
    const MAX_FAILED = 5;

    function newUuid() as String {
        return SparkyLogic.uuidFromBytes(Cryptography.randomBytes(16));
    }

    function deviceId() as String {
        var id = Storage.getValue(KEY_DEVICE_ID);
        if (id == null) {
            id = newUuid();
            Storage.setValue(KEY_DEVICE_ID, id);
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
        Storage.setValue(KEY_PAIRED_API_KEY, key);
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

    function manifest() as Dictionary or Null {
        return Storage.getValue(KEY_MANIFEST) as Dictionary or Null;
    }

    function setManifest(m as Dictionary) as Void {
        Storage.setValue(KEY_MANIFEST, m);
    }

    function workouts() as Array {
        var m = manifest();
        if (m == null || m["workouts"] == null) {
            return [] as Array;
        }
        return m["workouts"] as Array;
    }

    function weightUnit() as String {
        var m = manifest();
        return m != null && "lbs".equals(m["weight_unit"]) ? "lbs" : "kg";
    }

    function activeSession() as Dictionary or Null {
        return Storage.getValue(KEY_ACTIVE) as Dictionary or Null;
    }

    function saveActiveSession(s as Dictionary) as Void {
        Storage.setValue(KEY_ACTIVE, s);
    }

    function clearActiveSession() as Void {
        Storage.deleteValue(KEY_ACTIVE);
    }

    function queue() as Array {
        var q = Storage.getValue(KEY_QUEUE);
        return q == null ? [] as Array : q as Array;
    }

    function enqueue(upload as Dictionary) as Void {
        var q = queue();
        // Idempotent on the client side as well: never queue a session twice.
        for (var i = 0; i < q.size(); i++) {
            if ((q[i] as Dictionary)["client_session_id"].equals(upload["client_session_id"])) {
                return;
            }
        }
        q.add(upload);
        Storage.setValue(KEY_QUEUE, q);
    }

    function dequeueHead() as Void {
        var q = queue();
        if (q.size() > 0) {
            Storage.setValue(KEY_QUEUE, q.slice(1, null));
        }
    }

    function moveHeadToFailed(code as Number) as Void {
        var q = queue();
        if (q.size() == 0) {
            return;
        }
        var failed = Storage.getValue(KEY_FAILED);
        var list = failed == null ? [] as Array : failed as Array;
        list.add({ "code" => code, "session" => q[0] });
        if (list.size() > MAX_FAILED) {
            list = list.slice(list.size() - MAX_FAILED, null);
        }
        Storage.setValue(KEY_FAILED, list);
        dequeueHead();
    }

    function markSynced() as Void {
        Storage.setValue(KEY_LAST_SYNC, Time.now().value());
        Storage.deleteValue(KEY_LAST_ERROR);
    }

    function lastSync() as Number or Null {
        return Storage.getValue(KEY_LAST_SYNC) as Number or Null;
    }

    function setLastError(message as String) as Void {
        Storage.setValue(KEY_LAST_ERROR, message);
    }

    function lastError() as String or Null {
        return Storage.getValue(KEY_LAST_ERROR) as String or Null;
    }

    function deviceModel() as String or Null {
        var settings = System.getDeviceSettings();
        return settings has :partNumber ? settings.partNumber : null;
    }
}
