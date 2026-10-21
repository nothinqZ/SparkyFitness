import Toybox.Lang;
import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.Timer;
import Toybox.Attention;
import Toybox.Time;

// Rest countdown after a logged set, as in Hevy: UP / DOWN add or take 15 s,
// a short buzz 10 s before the end, a full alert (vibration, and a tone
// where available) at zero, then it counts into overtime. Shows the heart
// rate in its zone colour and the next set. SELECT or BACK ends the rest.
// In a live workout the rest follows the phone's (PhoneLink.followRest) and
// ±15 s / ending it here are sent to the phone.
class RestView extends WatchUi.View {

    const ADJUST_SECONDS = 15;
    const WARN_SECONDS = 10;

    private var _session as WorkoutSession;
    private var _endsAt as Number;
    private var _total as Number;
    private var _timer as Timer.Timer;
    private var _warned as Boolean = false;
    private var _alerted as Boolean = false;

    function initialize(session as WorkoutSession, seconds as Number) {
        View.initialize();
        _session = session;
        _total = seconds;
        _endsAt = Time.now().value() + seconds;
        _timer = new Timer.Timer();
    }

    function onShow() as Void {
        _timer.start(method(:tick), 1000, true);
        getApp().phone.restView = self;
    }

    function onHide() as Void {
        _timer.stop();
        var link = getApp().phone;
        if (link.restView == self) {
            link.restView = null;
        }
    }

    // The phone's rest ends at `endsAt` (epoch s): adopt it, unless the two
    // clocks merely disagree by a moment.
    function followPhone(endsAt as Number) as Void {
        var delta = endsAt - _endsAt;
        if (delta > 2 || delta < -2) {
            _total += delta;
            if (_total < 1) {
                _total = 1;
            }
            _endsAt = endsAt;
            if (remaining() > WARN_SECONDS) {
                _warned = false;
            }
            if (remaining() > 0) {
                _alerted = false;
            }
            WatchUi.requestUpdate();
        }
    }

    // The phone skipped the rest: leave without telling it again.
    function closeFromPhone() as Void {
        _session.markSetStart();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }

    // Tells the phone about a change made here (0 = rest ended).
    private function sendToPhone(previousEnd as Number, newEnd as Number) as Void {
        if (!_session.isLive()) {
            return;
        }
        getApp().phone.enqueue({ "t" => "rest", "sid" => _session.data["live"], "pre" => previousEnd,
            "re" => newEnd, "c" => Store.newUuid() });
    }

    // +15 s / -15 s; never below zero remaining.
    function adjust(direction as Number) as Void {
        var now = Time.now().value();
        var previousEnd = _endsAt;
        _endsAt += direction * ADJUST_SECONDS;
        if (_endsAt < now) {
            _endsAt = now;
        }
        _total += direction * ADJUST_SECONDS;
        if (_total < 1) {
            _total = 1;
        }
        // A longer rest gets its warnings again.
        if (remaining() > WARN_SECONDS) {
            _warned = false;
        }
        if (remaining() > 0) {
            _alerted = false;
        }
        sendToPhone(previousEnd, _endsAt);
        WatchUi.requestUpdate();
    }

    function finish() as Void {
        if (remaining() > 0) {
            sendToPhone(_endsAt, 0);
        }
        _session.markSetStart();
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }

    function tick() as Void {
        var left = remaining();
        if (!_warned && left <= WARN_SECONDS && left > 0) {
            _warned = true;
            if (Attention has :vibrate) {
                Attention.vibrate([new Attention.VibeProfile(60, 150)]);
            }
        }
        if (!_alerted && left <= 0) {
            _alerted = true;
            if (Attention has :vibrate) {
                Attention.vibrate([new Attention.VibeProfile(100, 400), new Attention.VibeProfile(0, 200),
                    new Attention.VibeProfile(100, 400)]);
            }
            if (Attention has :playTone) {
                Attention.playTone(Attention.TONE_ALERT_HI);
            }
        }
        WatchUi.requestUpdate();
    }

    function remaining() as Number {
        return _endsAt - Time.now().value();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var left = remaining();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // Progress ring, turning green in the last seconds.
        var radius = (w < h ? w : h) / 2 - 6;
        dc.setPenWidth(8);
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(w / 2, h / 2, radius);
        if (left > 0 && _total > 0) {
            var degrees = 360 * left / _total;
            if (degrees > 360) {
                degrees = 360;
            }
            dc.setColor(left <= WARN_SECONDS ? Graphics.COLOR_GREEN : Graphics.COLOR_ORANGE,
                Graphics.COLOR_TRANSPARENT);
            dc.drawArc(w / 2, h / 2, radius, Graphics.ARC_CLOCKWISE, 90, 90 - degrees);
        }

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.17, Graphics.FONT_SMALL, WatchUi.loadResource(Rez.Strings.Rest) as String,
            Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(left > 0 ? Graphics.COLOR_WHITE : Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        var text = left >= 0 ? SparkyLogic.formatClock(left) : "+" + SparkyLogic.formatClock(-left);
        dc.drawText(w / 2, h * 0.40, Graphics.FONT_NUMBER_MEDIUM, text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // The ±15 s keys, beside the clock.
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.86, h * 0.33, Graphics.FONT_XTINY, "+15", Graphics.TEXT_JUSTIFY_RIGHT);
        dc.drawText(w * 0.86, h * 0.45, Graphics.FONT_XTINY, "-15", Graphics.TEXT_JUSTIFY_RIGHT);

        var hr = WorkoutView.currentHeartRate();
        if (hr != null) {
            dc.setColor(WorkoutView.zoneColor(hr), Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.54, Graphics.FONT_TINY, hr + " bpm", Graphics.TEXT_JUSTIFY_CENTER);
        }

        var next = _session.nextPlannedSet();
        if (next != null) {
            dc.setColor(WorkoutView.setColor(next), Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.67, Graphics.FONT_XTINY,
                WorkoutView.setLabel(_session, next) + " · " + (_session.current()["name"] as String),
                Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.67 + dc.getFontHeight(Graphics.FONT_XTINY), Graphics.FONT_SMALL,
                WorkoutView.describeSet(next, Store.weightUnit()), Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.72, Graphics.FONT_XTINY, WatchUi.loadResource(Rez.Strings.Skip) as String,
                Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}

class RestDelegate extends WatchUi.BehaviorDelegate {

    private var _view as RestView;

    function initialize(view as RestView) {
        BehaviorDelegate.initialize();
        _view = view;
    }

    function onPreviousPage() as Boolean {
        _view.adjust(1);
        return true;
    }

    function onNextPage() as Boolean {
        _view.adjust(-1);
        return true;
    }

    function onSelect() as Boolean {
        _view.finish();
        return true;
    }

    function onBack() as Boolean {
        _view.finish();
        return true;
    }
}
