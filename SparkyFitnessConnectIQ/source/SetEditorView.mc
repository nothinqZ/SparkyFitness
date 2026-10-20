import Toybox.Lang;
import Toybox.Graphics;
import Toybox.WatchUi;

// Edits one set: reps, then weight, then RPE (optional, "-" skips it).
// UP/DOWN change the highlighted value, SELECT moves on and, after RPE, logs
// the set and starts the rest timer. BACK steps to the previous field.
class SetEditorView extends WatchUi.View {

    const FIELD_REPS = 0;
    const FIELD_WEIGHT = 1;
    const FIELD_RPE = 2;

    var session as WorkoutSession;
    var field as Number = 0;
    var reps as Number;
    var weight as Float;   // display units
    var rpe as Float or Null = null;
    var unit as String;

    function initialize(session as WorkoutSession) {
        View.initialize();
        self.session = session;
        unit = Store.weightUnit();
        var defaults = session.defaultsForNextSet();
        reps = defaults["reps"] == null ? 8 : (defaults["reps"] as Number);
        weight = SparkyLogic.roundToStep(
            SparkyLogic.toDisplayWeight(defaults["weight"] as Float or Number or Null, unit),
            SparkyLogic.weightStep(unit) / 2.0);
    }

    function adjust(direction as Number) as Void {
        if (field == FIELD_REPS) {
            reps = reps + direction;
            if (reps < 0) {
                reps = 0;
            }
        } else if (field == FIELD_WEIGHT) {
            weight = weight + direction * SparkyLogic.weightStep(unit);
            if (weight < 0.0) {
                weight = 0.0;
            }
        } else {
            // RPE: none, 5.0 ... 10.0 in half steps.
            if (rpe == null) {
                rpe = direction > 0 ? 7.0 : null;
            } else {
                var next = rpe + direction * 0.5;
                rpe = next < 5.0 ? null : (next > 10.0 ? 10.0 : next);
            }
        }
        WatchUi.requestUpdate();
    }

    function commit() as Void {
        var rest = session.restSecondsForNextSet();
        session.logSet(reps, SparkyLogic.toKg(weight, unit),
            rpe == null ? null : (rpe as Float), rest);
        getApp().recorder.lap();
        var timer = new RestView(rest);
        WatchUi.switchToView(timer, new RestDelegate(), WatchUi.SLIDE_UP);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.08, Graphics.FONT_XTINY, session.current()["name"] as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        drawField(dc, w / 2, (h * 0.22).toNumber(), WatchUi.loadResource(Rez.Strings.Reps) as String,
            reps.toString(), field == FIELD_REPS);
        drawField(dc, w / 2, (h * 0.46).toNumber(), WatchUi.loadResource(Rez.Strings.Weight) as String,
            SparkyLogic.formatWeight(weight) + " " + unit, field == FIELD_WEIGHT);
        drawField(dc, w / 2, (h * 0.70).toNumber(), WatchUi.loadResource(Rez.Strings.Rpe) as String,
            rpe == null ? "-" : SparkyLogic.formatWeight(rpe as Float), field == FIELD_RPE);
    }

    private function drawField(dc as Graphics.Dc, x as Number, y as Number, label as String,
            value as String, active as Boolean) as Void {
        dc.setColor(active ? Graphics.COLOR_ORANGE : Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(active ? Graphics.COLOR_WHITE : Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y + dc.getFontHeight(Graphics.FONT_XTINY), active ? Graphics.FONT_MEDIUM : Graphics.FONT_SMALL,
            value, Graphics.TEXT_JUSTIFY_CENTER);
    }
}

class SetEditorDelegate extends WatchUi.BehaviorDelegate {

    private var _view as SetEditorView;

    function initialize(view as SetEditorView) {
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
        if (_view.field < _view.FIELD_RPE) {
            _view.field += 1;
            WatchUi.requestUpdate();
        } else {
            _view.commit();
        }
        return true;
    }

    function onBack() as Boolean {
        if (_view.field > 0) {
            _view.field -= 1;
            WatchUi.requestUpdate();
            return true;
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
