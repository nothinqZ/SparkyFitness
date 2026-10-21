import Toybox.Lang;
import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.Timer;
import Toybox.Attention;
import Toybox.Time;

// Rest countdown after a logged set. Vibrates (and beeps where available) at
// zero, then keeps counting into overtime. Any key returns to the exercise.
class RestView extends WatchUi.View {

    private var _endsAt as Number;
    private var _total as Number;
    private var _timer as Timer.Timer;
    private var _alerted as Boolean = false;
    // The next set's target ("8 × 100 kg"), or null after the last one.
    private var _next as String or Null;

    function initialize(seconds as Number, next as String or Null) {
        View.initialize();
        _next = next;
        _total = seconds;
        _endsAt = Time.now().value() + seconds;
        _timer = new Timer.Timer();
    }

    function onShow() as Void {
        _timer.start(method(:tick), 1000, true);
    }

    function onHide() as Void {
        _timer.stop();
    }

    function tick() as Void {
        if (!_alerted && remaining() <= 0) {
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

        // Progress ring.
        var radius = (w < h ? w : h) / 2 - 6;
        dc.setPenWidth(8);
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawCircle(w / 2, h / 2, radius);
        if (left > 0 && _total > 0) {
            var degrees = 360 * left / _total;
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.drawArc(w / 2, h / 2, radius, Graphics.ARC_CLOCKWISE, 90, 90 - degrees);
        }

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.25, Graphics.FONT_SMALL, WatchUi.loadResource(Rez.Strings.Rest) as String,
            Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(left > 0 ? Graphics.COLOR_WHITE : Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        var text = left >= 0 ? SparkyLogic.formatClock(left) : "+" + SparkyLogic.formatClock(-left);
        dc.drawText(w / 2, h / 2, Graphics.FONT_NUMBER_MEDIUM, text,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        if (_next != null) {
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.66, Graphics.FONT_XTINY,
                WatchUi.loadResource(Rez.Strings.Next) as String, Graphics.TEXT_JUSTIFY_CENTER);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.66 + dc.getFontHeight(Graphics.FONT_XTINY), Graphics.FONT_SMALL,
                _next as String, Graphics.TEXT_JUSTIFY_CENTER);
        } else {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.70, Graphics.FONT_XTINY, WatchUi.loadResource(Rez.Strings.Skip) as String,
                Graphics.TEXT_JUSTIFY_CENTER);
        }
    }
}

class RestDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onSelect() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }

    function onBack() as Boolean {
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
