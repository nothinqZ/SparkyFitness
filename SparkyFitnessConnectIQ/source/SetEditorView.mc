import Toybox.Lang;
import Toybox.Graphics;
import Toybox.WatchUi;

// Logs one set. Opens on a summary of what will be logged (the target, or
// last set's values) so that one press logs it, as in Hevy; UP/DOWN start
// editing instead: reps, then weight, then RPE (optional, "-" skips it).
// While editing, UP/DOWN change the highlighted value, SELECT moves on and,
// after RPE, logs the set. BACK steps back, from the summary it cancels.
class SetEditorView extends WatchUi.View {

    const FIELD_SUMMARY = 0;
    const FIELD_REPS = 1;
    const FIELD_WEIGHT = 2;
    const FIELD_RPE = 3;

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
        if (field == FIELD_SUMMARY) {
            // The first UP/DOWN only switches to editing, starting with reps.
            field = FIELD_REPS;
        } else if (field == FIELD_REPS) {
            reps = reps + direction;
            if (reps < 0) {
                reps = 0;
            }
        } else if (field == FIELD_WEIGHT) {
            weight = weight + direction * session.weightStep(unit);
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

    // Logs the set, then rests before the next one. A drop set follows
    // straight on without a rest, as in Hevy.
    function commit() as Void {
        var rest = session.restSecondsForNextSet();
        session.logSet(reps, SparkyLogic.toKg(weight, unit),
            rpe == null ? null : (rpe as Float), rest);
        var next = session.nextPlannedSet();
        if (next != null && "d".equals(next["type"])) {
            session.markSetStart();
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            return;
        }
        var timer = new RestView(session, rest);
        WatchUi.switchToView(timer, new RestDelegate(timer), WatchUi.SLIDE_UP);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        // "Aufwärmen 1/2 · Bankdrücken" so it is clear what is being logged.
        var next = session.nextPlannedSet();
        var label = next == null
            ? (WatchUi.loadResource(Rez.Strings.Set) as String) + " " + (session.loggedCount() + 1)
            : WorkoutView.setLabel(session, next);
        var title = label + " · " + (session.current()["name"] as String);
        var accent = next == null ? Graphics.COLOR_ORANGE : WorkoutView.setColor(next);
        dc.setColor(next == null ? Graphics.COLOR_LT_GRAY : accent, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.09, Graphics.FONT_XTINY, title, Graphics.TEXT_JUSTIFY_CENTER);

        if (field == FIELD_SUMMARY) {
            drawSummary(dc, w, h, accent);
            return;
        }
        drawField(dc, w, (h * 0.21).toNumber(), WatchUi.loadResource(Rez.Strings.Reps) as String,
            reps.toString(), field == FIELD_REPS);
        drawField(dc, w, (h * 0.45).toNumber(), WatchUi.loadResource(Rez.Strings.Weight) as String,
            SparkyLogic.formatWeight(weight) + " " + unit, field == FIELD_WEIGHT);
        drawField(dc, w, (h * 0.69).toNumber(), WatchUi.loadResource(Rez.Strings.Rpe) as String,
            rpe == null ? "-" : SparkyLogic.formatWeight(rpe as Float), field == FIELD_RPE);
    }

    // What one press logs, large, with a check ring and the key hint.
    private function drawSummary(dc as Graphics.Dc, w as Number, h as Number, accent as Number) as Void {
        var cx = w / 2;
        dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(6);
        dc.drawCircle(cx, h / 2, (w < h ? w : h) / 2 - 5);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.33, Graphics.FONT_NUMBER_MEDIUM, reps.toString(),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.44, Graphics.FONT_XTINY, WatchUi.loadResource(Rez.Strings.Reps) as String,
            Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.55, Graphics.FONT_MEDIUM, SparkyLogic.formatWeight(weight) + " " + unit,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // Barbell: what goes on each side of the bar.
        if (session.current()["barbell"] == true) {
            var plates = SparkyLogic.platesPerSide(weight, unit);
            var text = plates.size() == 0
                ? WatchUi.loadResource(Rez.Strings.BarOnly) as String
                : (WatchUi.loadResource(Rez.Strings.PerSide) as String) + " " + SparkyLogic.formatPlates(plates);
            dc.setColor(WorkoutView.COLOR_WARMUP, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.64, Graphics.FONT_XTINY, text, Graphics.TEXT_JUSTIFY_CENTER);
        }

        // The check: a filled accent circle with a tick drawn as two lines.
        var cy = (h * 0.76).toNumber();
        dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(cx, cy, 20);
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(4);
        dc.drawLine(cx - 9, cy, cx - 2, cy + 7);
        dc.drawLine(cx - 2, cy + 7, cx + 10, cy - 7);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.84, Graphics.FONT_XTINY, WatchUi.loadResource(Rez.Strings.LogHint) as String,
            Graphics.TEXT_JUSTIFY_CENTER);
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
        if (_view.field == _view.FIELD_SUMMARY || _view.field == _view.FIELD_RPE) {
            _view.commit();
        } else {
            _view.field += 1;
            WatchUi.requestUpdate();
        }
        return true;
    }

    function onBack() as Boolean {
        if (_view.field > _view.FIELD_SUMMARY) {
            _view.field -= 1;
            WatchUi.requestUpdate();
            return true;
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
