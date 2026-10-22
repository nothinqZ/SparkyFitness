import Toybox.Lang;
import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.System;

// Edits one set on a single screen: a set that differs from the target
// (tap the set screen) or, with `amend`, the set just logged (tap during
// the rest). A set done as planned needs none of this: START on the set
// screen logs it straight away (logAndRest). The reps are large in the middle
// and UP / DOWN change them right away, since reps are what usually differ.
// Tap the weight, swipe sideways or press MENU to change the weight instead
// (and back). RPE is only asked when the "Ask for RPE" setting is on; then
// START moves on to it and logs from there.
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
    // Correcting the set logged last instead of logging a new one.
    var amend as Boolean;

    function initialize(session as WorkoutSession, amend as Boolean) {
        View.initialize();
        self.session = session;
        self.amend = amend;
        unit = Store.weightUnit();
        var last = amend ? session.lastLogged() : null;
        var defaults = last != null ? last : session.defaultsForNextSet();
        if (last != null && last["rpe"] != null) {
            rpe = SparkyLogic.toFloatOrNull(last["rpe"]);
        }
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

    // Reps <-> weight.
    function toggleField() as Void {
        field = field == FIELD_WEIGHT ? FIELD_REPS : FIELD_WEIGHT;
        WatchUi.requestUpdate();
    }

    function selectField(f as Number) as Void {
        field = f;
        WatchUi.requestUpdate();
    }

    // START: log, or first ask for RPE when that setting is on.
    function confirm() as Void {
        if (field != FIELD_RPE && Store.askRpe()) {
            field = FIELD_RPE;
            WatchUi.requestUpdate();
            return;
        }
        commit();
    }

    function commit() as Void {
        var kg = SparkyLogic.toKg(weight, unit);
        var r = rpe == null ? null : (rpe as Float);
        if (amend) {
            // Back to the rest that is still running.
            session.amendLastSet(reps, kg, r);
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            return;
        }
        // Back to the set screen first, so the rest returns there.
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        logAndRest(session, reps, kg, r);
    }

    // Logs a set, then rests before the next one. A drop set follows
    // straight on without a rest, as in Hevy. Called from the set screen.
    static function logAndRest(session as WorkoutSession, reps as Number, weightKg as Float,
            rpe as Float or Null) as Void {
        var rest = session.restSecondsForNextSet();
        session.logSet(reps, weightKg, rpe, rest);
        var next = session.nextPlannedSet();
        if (next != null && "d".equals(next["type"])) {
            session.markSetStart();
            WatchUi.requestUpdate();
            return;
        }
        var timer = new RestView(session, rest);
        WatchUi.pushView(timer, new RestDelegate(timer), WatchUi.SLIDE_UP);
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        // "Aufwärmen 1/2 · Bankdrücken", in the set kind's colour.
        var next = amend ? null : session.nextPlannedSet();
        var label = amend ? WatchUi.loadResource(Rez.Strings.Correct) as String
            : next == null
                ? (WatchUi.loadResource(Rez.Strings.Set) as String) + " " + (session.loggedCount() + 1)
                : WorkoutView.setLabel(session, next);
        var accent = next == null ? Graphics.COLOR_ORANGE : WorkoutView.setColor(next);
        dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.10, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.17, Graphics.FONT_XTINY,
            (amend ? session.lastLoggedName() : session.current()["name"]) as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        if (field == FIELD_RPE) {
            drawValue(dc, cx, h * 0.47, rpe == null ? "-" : SparkyLogic.formatWeight(rpe as Float),
                WatchUi.loadResource(Rez.Strings.Rpe) as String, true);
        } else {
            drawValue(dc, cx, h * 0.40, reps.toString(),
                WatchUi.loadResource(Rez.Strings.Reps) as String, field == FIELD_REPS);
            drawWeight(dc, w, h, field == FIELD_WEIGHT);
        }

        // +/- beside UP and DOWN (left side of the Forerunner 265).
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w * 0.09, h * 0.42, Graphics.FONT_SMALL, "+",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.drawText(w * 0.15, h * 0.66, Graphics.FONT_SMALL, "-",
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        // The check beside START (upper right).
        var kx = (w * 0.83).toNumber();
        var ky = (h * 0.27).toNumber();
        dc.setColor(accent, Graphics.COLOR_TRANSPARENT);
        dc.fillCircle(kx, ky, 18);
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(4);
        dc.drawLine(kx - 8, ky, kx - 2, ky + 6);
        dc.drawLine(kx - 2, ky + 6, kx + 9, ky - 6);

        if (field != FIELD_RPE) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.86, Graphics.FONT_XTINY,
                WatchUi.loadResource(Rez.Strings.TapWeight) as String, Graphics.TEXT_JUSTIFY_CENTER);
        }
    }

    // A value with its label; the one the keys change is white on a pill.
    private function drawValue(dc as Graphics.Dc, x as Number, y as Float, value as String,
            label as String, active as Boolean) as Void {
        var font = Graphics.FONT_NUMBER_HOT;
        var height = dc.getFontHeight(font);
        if (active) {
            var boxW = dc.getWidth() * 0.44;
            dc.setColor(0x262626, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(x - boxW / 2, y - height / 2 - 4, boxW, height + 8, 16);
        }
        dc.setColor(active ? Graphics.COLOR_WHITE : Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, font, value, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y + height / 2 + 4, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_CENTER);
    }

    // The weight line, and plates per side for a barbell.
    private function drawWeight(dc as Graphics.Dc, w as Number, h as Number, active as Boolean) as Void {
        var cx = w / 2;
        var y = h * 0.68;
        var text = SparkyLogic.formatWeight(weight) + " " + unit;
        if (active) {
            var boxW = w * 0.52;
            var boxH = dc.getFontHeight(Graphics.FONT_MEDIUM) + 6;
            dc.setColor(0x262626, Graphics.COLOR_TRANSPARENT);
            dc.fillRoundedRectangle(cx - boxW / 2, y - boxH / 2, boxW, boxH, 12);
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
            dc.setPenWidth(2);
            dc.drawRoundedRectangle(cx - boxW / 2, y - boxH / 2, boxW, boxH, 12);
        }
        dc.setColor(active ? Graphics.COLOR_WHITE : Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, y, Graphics.FONT_MEDIUM, text, Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        if (session.current()["barbell"] == true) {
            var plates = SparkyLogic.platesPerSide(weight, unit);
            var hint = plates.size() == 0
                ? WatchUi.loadResource(Rez.Strings.BarOnly) as String
                : (WatchUi.loadResource(Rez.Strings.PerSide) as String) + " " + SparkyLogic.formatPlates(plates);
            dc.setColor(WorkoutView.COLOR_WARMUP, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, y + dc.getFontHeight(Graphics.FONT_MEDIUM) / 2 + 2, Graphics.FONT_XTINY, hint,
                Graphics.TEXT_JUSTIFY_CENTER);
        }
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
        _view.confirm();
        return true;
    }

    // MENU (hold UP) switches between reps and weight.
    function onMenu() as Boolean {
        _view.toggleField();
        return true;
    }

    function onSwipe(event as WatchUi.SwipeEvent) as Boolean {
        var direction = event.getDirection();
        if (direction == WatchUi.SWIPE_LEFT || direction == WatchUi.SWIPE_RIGHT) {
            _view.toggleField();
            return true;
        }
        return false;
    }

    // Tapping the lower half edits the weight, the upper half the reps.
    function onTap(event as WatchUi.ClickEvent) as Boolean {
        var y = event.getCoordinates()[1];
        var h = System.getDeviceSettings().screenHeight;
        _view.selectField(y > h * 0.56 ? _view.FIELD_WEIGHT : _view.FIELD_REPS);
        return true;
    }

    function onBack() as Boolean {
        if (_view.field == _view.FIELD_RPE) {
            _view.selectField(_view.FIELD_REPS);
            return true;
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
        return true;
    }
}
