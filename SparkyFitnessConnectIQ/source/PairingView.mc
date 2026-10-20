import Toybox.Lang;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.Timer;
import Toybox.WatchUi;

// Pairs the watch with a SparkyFitness account without typing a key:
// 1. POST /api/v2/watch/pairing/start -> 8-character code + secret poll token
// 2. The code is shown here; the user enters it in SparkyFitness
//    (Settings > Garmin watch).
// 3. The watch polls /pairing/poll until the server hands out the new API key
//    (once), stores it and returns to the start menu.
class PairingView extends WatchUi.View {

    private var _code as String or Null = null;
    private var _pollToken as String or Null = null;
    private var _message as String = "...";
    private var _timer as Timer.Timer;
    private var _intervalMs as Number = 5000;
    private var _inFlight as Boolean = false;

    function initialize() {
        View.initialize();
        _timer = new Timer.Timer();
    }

    function onShow() as Void {
        MainMenu.visible = false;
        if (_pollToken == null) {
            startPairing();
        } else {
            _timer.start(method(:poll), _intervalMs, true);
        }
    }

    function onHide() as Void {
        _timer.stop();
    }

    private function startPairing() as Void {
        var url = Store.serverUrl();
        if (url == null) {
            _message = WatchUi.loadResource(Rez.Strings.NotConfigured) as String;
            WatchUi.requestUpdate();
            return;
        }
        Communications.makeWebRequest(
            url + "/api/v2/watch/pairing/start",
            { "device_id" => Store.deviceId(), "device_model" => Store.deviceModel() },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onStarted)
        );
    }

    function onStarted(code as Number, data as Dictionary or String or Null) as Void {
        if (code == 201 && data instanceof Dictionary) {
            _code = data["pairing_code"] as String;
            _pollToken = data["poll_token"] as String;
            var interval = data["poll_interval_seconds"];
            if (interval instanceof Number && interval > 0) {
                _intervalMs = (interval as Number) * 1000;
            }
            _message = WatchUi.loadResource(Rez.Strings.PairHint) as String;
            _timer.start(method(:poll), _intervalMs, true);
        } else {
            _message = "Pairing failed (" + code + ")";
        }
        WatchUi.requestUpdate();
    }

    function poll() as Void {
        if (_inFlight || _pollToken == null) {
            return;
        }
        _inFlight = true;
        Communications.makeWebRequest(
            Store.serverUrl() + "/api/v2/watch/pairing/poll",
            { "poll_token" => _pollToken },
            {
                :method => Communications.HTTP_REQUEST_METHOD_POST,
                :headers => { "Content-Type" => Communications.REQUEST_CONTENT_TYPE_JSON },
                :responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_JSON
            },
            method(:onPolled)
        );
    }

    function onPolled(code as Number, data as Dictionary or String or Null) as Void {
        _inFlight = false;
        if (code == 200 && data instanceof Dictionary && data["api_key"] != null) {
            _timer.stop();
            Store.setPairedApiKey(data["api_key"] as String);
            _message = WatchUi.loadResource(Rez.Strings.Paired) as String;
            _code = null;
            WatchUi.requestUpdate();
            getApp().sync.sync(method(:onSynced));
        } else if (code == 404) {
            // Expired (10 minutes) or already collected: start over.
            _timer.stop();
            _pollToken = null;
            _code = null;
            startPairing();
        }
        // 202 (still waiting) and transient errors: keep polling.
    }

    function onSynced(ok as Boolean) as Void {
        var built = MainMenu.build();
        WatchUi.switchToView(built[0], built[1], WatchUi.SLIDE_RIGHT);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.15, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.PairWatch) as String, Graphics.TEXT_JUSTIFY_CENTER);
        var code = _code;
        if (code != null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.42, Graphics.FONT_MEDIUM,
                code.substring(0, 4) + "-" + code.substring(4, 8),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.62, Graphics.FONT_XTINY, _message, Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class PairingDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onBack() as Boolean {
        var built = MainMenu.build();
        WatchUi.switchToView(built[0], built[1], WatchUi.SLIDE_RIGHT);
        return true;
    }
}
