import Toybox.Lang;
import Toybox.Communications;
import Toybox.WatchUi;

const APP_VERSION = "0.3.0";

// Talks to the SparkyFitness server through the paired phone (Connect IQ web
// requests are proxied by the Garmin Connect app, so the server must be
// reachable from the phone over HTTPS with a valid certificate).
//
// sync(): uploads queued sessions one at a time, oldest first, then refreshes
// the workout manifest. A transient failure stops the round and leaves the
// queue untouched; the next sync (app start, workout end, "Sync now") retries.
class SyncClient {

    // Manifest size the watch asks for; keeps the JSON within app memory.
    const MANIFEST_LIMIT = 12;

    private var _busy as Boolean = false;
    private var _onDone as Method or Null = null;

    function initialize() {
    }

    function isBusy() as Boolean {
        return _busy;
    }

    // onDone(ok as Boolean) is called once when the round ends.
    function sync(onDone as Method or Null) as Void {
        if (_busy) {
            return;
        }
        if (!Store.isConfigured()) {
            Store.setLastError(WatchUi.loadResource(Rez.Strings.NotConfigured) as String);
            if (onDone != null) {
                onDone.invoke(false);
            }
            return;
        }
        _busy = true;
        _onDone = onDone;
        uploadNext();
    }

    private function authHeaders(json as Boolean) as Dictionary {
        var h = { "Authorization" => "Bearer " + Store.apiKey() } as Dictionary;
        if (json) {
            h["Content-Type"] = Communications.REQUEST_CONTENT_TYPE_JSON;
        }
        return h;
    }

    private function uploadNext() as Void {
        var head = Store.queueHead();
        if (head == null) {
            fetchManifest();
            return;
        }
        Communications.makeWebRequest(
            Store.serverUrl() + "/api/v2/watch/sessions",
            head,
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => authHeaders(true),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onUploadResponse)
        );
    }

    function onUploadResponse(code as Number, data as Dictionary or String or Null) as Void {
        var outcome = SparkyLogic.classifyUploadResponse(code);
        if (outcome == SparkyLogic.UPLOAD_DONE) {
            Store.dequeueHead();
            uploadNext();
        } else if (outcome == SparkyLogic.UPLOAD_REJECTED) {
            // Retrying cannot help; park it so later sessions still upload.
            Store.moveHeadToFailed(code);
            Store.setLastError("Upload rejected (" + code + ")");
            uploadNext();
        } else if (outcome == SparkyLogic.UPLOAD_AUTH) {
            authFailed(code);
        } else {
            Store.setLastError("Offline, will retry (" + code + ")");
            finish(false);
        }
    }

    private function fetchManifest() as Void {
        Communications.makeWebRequest(
            Store.serverUrl() + "/api/v2/watch/manifest",
            { "limit" => MANIFEST_LIMIT },
            {
                :method => Communications.HTTP_REQUEST_METHOD_GET,
                :headers => authHeaders(false),
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onManifestResponse)
        );
    }

    function onManifestResponse(code as Number, data as Dictionary or String or Null) as Void {
        if (code == 200 && data instanceof Dictionary && data["workouts"] != null) {
            if (Store.setManifest(data as Dictionary)) {
                Store.markSynced();
                finish(true);
            } else {
                // Workouts that fit are still usable; say that some are missing.
                Store.setLastError("Watch storage full, some workouts missing");
                finish(false);
            }
        } else if (code == 401) {
            authFailed(code);
        } else {
            Store.setLastError("Manifest failed (" + code + ")");
            finish(false);
        }
    }

    // 401 means the key was revoked or is wrong: drop a paired key so the
    // start menu offers pairing again. Queued sessions stay on the watch.
    private function authFailed(code as Number) as Void {
        if (code == 401) {
            Store.clearPairedApiKey();
        }
        Store.setLastError("Check server URL / API key (" + code + ")");
        finish(false);
    }

    private function finish(ok as Boolean) as Void {
        _busy = false;
        var cb = _onDone;
        _onDone = null;
        if (cb != null) {
            cb.invoke(ok);
        }
        WatchUi.requestUpdate();
    }
}
