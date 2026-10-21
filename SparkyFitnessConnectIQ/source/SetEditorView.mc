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
        var defaultReps = SparkyLogic.toInt(defaults["reps"]);
        reps = defaultReps == null ? 8 : defaultReps;
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
        var next = session.nextPlannedSet();
        var timer = new RestView(rest,
            next == null ? null : WorkoutView.describeSet(next, unit));
        WatchUi.switchToView(timer, new RestDelegate(), WatchUi.SLIDE_UP);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        // "Satz 2 · Bankdrücken" so it is clear what is being logged.
        var title = (WatchUi.loadResource(Rez.Strings.Set) as String) + " " + (session.loggedCount() + 1)
            + " · " + (session.current()["name"] as String);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.09, Graphics.FONT_XTINY, title, Graphics.TEXT_JUSTIFY_CENTER);

        drawField(dc, w, (h * 0.21).toNumber(), WatchUi.loadResource(Rez.Strings.Reps) as String,
            reps.toString(), field == FIELD_REPS);
        drawField(dc, w, (h * 0.45).toNumber(), WatchUi.loadResource(Rez.Strings.Weight) as String,
            SparkyLogic.formatWeight(weight) + " " + unit, field == FIELD_WEIGHT);
        drawField(dc, w, (h * 0.69).toNumber(), WatchUi.loadResource(Rez.Strings.Rpe) as String,
            rpe == null ? "-" : SparkyLogic.formatWeight(rpe as Float), field == FIELD_RPE);
    }

    // The field being edited sits on a highlighted pill; the others are dim.
    private function drawField(dc as Graphics.Dc, w as Number, y as Number, label as String,
            value as String, active as Boolean) as Void {
        var x = w / 2;
        var labelHeight = dc.getFontHeight(Graphics.FONT_XTINY);
        var valueFont = active ? Graphics.FONT_MEDIUM : Graphics.FONT_SMALL;
        if (active) {
            var boxWidth = (w * 0.62).toNumber();
            var boxHeight = labelHeight + dc.getFontHeight(valueFont) + 6;
            dc.setColor(0x262626, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(x - boxWidth / 2, y - 3, boxWidth, boxHeight, 12);
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
            dc.drawRoundedRectangle(x - boxWidth / 2, y - 3, boxWidth, boxHeight, 12);
        }
        dc.setColor(active ? Graphics.COLOR_ORANGE : Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(active ? Graphics.COLOR_WHITE : Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y + labelHeight, valueFont, value, Graphics.TEXT_JUSTIFY_CENTER);
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
