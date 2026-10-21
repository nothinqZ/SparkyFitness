import Toybox.Lang;
import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.Sensor;
import Toybox.Timer;

// One exercise at a time: name, set progress, the planned target, last time's
// values and a progressive-overload suggestion.
//   SELECT / tap       log the next set
//   UP / DOWN / swipe  previous / next exercise
//   MENU (long UP)     jump to an exercise, undo last set
//   BACK               finish, discard or continue
class WorkoutView extends WatchUi.View {

    // Colours of set kinds, shared with the set editor.
    static const COLOR_WARMUP = 0x55AAFF;
    static const COLOR_DROP = 0xAA66FF;
    static const COLOR_FAILURE = 0xFF5555;

    private var _session as WorkoutSession;
    // Redraws for the live heart rate while the view is on screen.
    private var _timer as Timer.Timer or Null = null;

    function initialize(session as WorkoutSession) {
        View.initialize();
        _session = session;
    }

    function onShow() as Void {
        MainMenu.visible = false;
        if (_session.isLive()) {
            getApp().phone.liveViewOpen = true;
        }
        var timer = new Timer.Timer();
        timer.start(method(:onTick), 2000, true);
        _timer = timer;
    }

    function onHide() as Void {
        getApp().phone.liveViewOpen = false;
        var timer = _timer;
        if (timer != null) {
            timer.stop();
            _timer = null;
        }
    }

    function onTick() as Void {
        WatchUi.requestUpdate();
    }

    // "Aufwärmen 1/2", "Satz 2/3", "Drop-Satz 1/1" for the next set.
    static function setLabel(session as WorkoutSession, next as Dictionary) as String {
        var type = next["type"];
        var name = WatchUi.loadResource(Rez.Strings.Set) as String;
        if ("w".equals(type)) {
            name = WatchUi.loadResource(Rez.Strings.WarmUp) as String;
        } else if ("d".equals(type)) {
            name = WatchUi.loadResource(Rez.Strings.DropSet) as String;
        } else if ("f".equals(type)) {
            name = WatchUi.loadResource(Rez.Strings.ToFailure) as String;
        }
        var planned = session.current()["planned"] as Array or Null;
        if (planned == null) {
            return name;
        }
        var counter = SparkyLogic.setCounter(planned, next);
        return name + " " + counter[0] + "/" + counter[1];
    }

    static function setColor(next as Dictionary or Null) as Number {
        var type = next == null ? null : next["type"];
        if ("w".equals(type)) {
            return COLOR_WARMUP;
        }
        if ("d".equals(type)) {
            return COLOR_DROP;
        }
        if ("f".equals(type)) {
            return COLOR_FAILURE;
        }
        return Graphics.COLOR_ORANGE;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        // A live workout follows the phone: sets logged there show up here.
        _session.refresh();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var unit = Store.weightUnit();
        var ex = _session.current();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        drawSetRing(dc, w, h);

        // Exercise counter, and a green dot while the phone is connected.
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.11, Graphics.FONT_XTINY,
            (_session.exerciseIndex() + 1) + "/" + _session.exerciseCount(),
            Graphics.TEXT_JUSTIFY_CENTER);
        if (_session.isLive()) {
            dc.setColor(PhoneLink.phoneConnected() ? Graphics.COLOR_GREEN : Graphics.COLOR_DK_GRAY,
                Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(cx + dc.getTextWidthInPixels("00/00", Graphics.FONT_XTINY) / 2 + 10,
                (h * 0.11 + dc.getFontHeight(Graphics.FONT_XTINY) / 2).toNumber(), 5);
        }

        var name = ex["name"] as String;
        var nameFont = name.length() > 16 ? Graphics.FONT_TINY : Graphics.FONT_SMALL;
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.21, nameFont, name, Graphics.TEXT_JUSTIFY_CENTER);

        // Live heart rate at the bottom, when the sensor has a reading.
        var info = Sensor.getInfo();
        if (info has :heartRate && info.heartRate != null) {
            dc.setColor(COLOR_FAILURE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.84, Graphics.FONT_TINY, info.heartRate + " bpm",
                Graphics.TEXT_JUSTIFY_CENTER);
        }

        var logged = _session.loggedCount();
        if (_session.isExerciseComplete()) {
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.48, Graphics.FONT_MEDIUM,
                WatchUi.loadResource(Rez.Strings.Done) as String,
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
            return;
        }

        var plan = _session.nextPlannedSet();
        var progress = plan != null
            ? setLabel(_session, plan)
            : (WatchUi.loadResource(Rez.Strings.Set) as String) + " " + (logged + 1);
        var group = ex["superset"];
        if (group instanceof Number) {
            progress = (WatchUi.loadResource(Rez.Strings.Superset) as String) + " "
                + SparkyLogic.supersetLetter(group) + " · " + progress;
        }
        dc.setColor(setColor(plan), Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.34, Graphics.FONT_TINY, progress, Graphics.TEXT_JUSTIFY_CENTER);

        // The target for the next set, large: "8 x 100 kg".
        if (plan != null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.53, Graphics.FONT_LARGE, describeSet(plan, unit),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        var previous = ex["previous"] as Array or Null;
        if (previous != null && previous.size() > 0) {
            var idx = logged < previous.size() ? logged : previous.size() - 1;
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.66, Graphics.FONT_XTINY,
                (WatchUi.loadResource(Rez.Strings.Last) as String) + " " + describeSet(previous[idx] as Dictionary, unit),
                Graphics.TEXT_JUSTIFY_CENTER);
            var suggestion = "w".equals(plan == null ? null : plan["type"]) ? null
                : SparkyLogic.suggestWeight(
                    plan == null ? null : SparkyLogic.toInt(plan["reps"]),
                    SparkyLogic.workingSets(previous), unit);
            if (suggestion != null) {
                dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(cx, h * 0.76, Graphics.FONT_XTINY,
                    (WatchUi.loadResource(Rez.Strings.Suggest) as String) + " " + SparkyLogic.formatWeight(suggestion) + " " + unit,
                    Graphics.TEXT_JUSTIFY_CENTER);
            }
        }
    }

    // One segment per planned set around the edge: done green, next orange,
    // open grey. A plain ring when the exercise has no planned sets.
    private function drawSetRing(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var radius = (w < h ? w : h) / 2 - 5;
        dc.setPenWidth(6);
        var planned = _session.current()["planned"] as Array or Null;
        var count = planned == null ? 0 : planned.size();
        if (count == 0) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawCircle(w / 2, h / 2, radius);
            return;
        }
        var logged = _session.loggedCount();
        var next = _session.nextPlannedSet();
        var gap = count > 1 ? 4 : 0;
        var span = 360 / count;
        for (var i = 0; i < count; i++) {
            var set = (planned as Array)[i] as Dictionary;
            var done = _session.isLive() ? set["done"] == true : i < logged;
            // Warm-ups stay recognisable around the ring: a dimmer blue.
            var color = done ? Graphics.COLOR_GREEN
                : (set == next ? setColor(set)
                    : ("w".equals(set["type"]) ? 0x1F4466 : Graphics.COLOR_DK_GRAY));
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            var from = 90 - i * span - gap / 2;
            var to = 90 - (i + 1) * span + gap / 2;
            dc.drawArc(w / 2, h / 2, radius, Graphics.ARC_CLOCKWISE, from, to);
        }
    }

    static function describeSet(set as Dictionary, unit as String) as String {
        var reps = SparkyLogic.toInt(set["reps"]);
        var weight = SparkyLogic.toFloatOrNull(set["weight"]);
        var text = reps == null ? "-" : reps.toString();
        if (weight != null && weight > 0.0) {
            text += " × " + SparkyLogic.formatWeight(SparkyLogic.toDisplayWeight(weight, unit)) + " " + unit;
        }
        return text;
    }
}

class WorkoutDelegate extends WatchUi.BehaviorDelegate {

    private var _session as WorkoutSession;

    function initialize(session as WorkoutSession) {
        BehaviorDelegate.initialize();
        _session = session;
    }

    function onSelect() as Boolean {
        var editor = new SetEditorView(_session);
        WatchUi.pushView(editor, new SetEditorDelegate(editor), WatchUi.SLIDE_UP);
        return true;
    }

    function onNextPage() as Boolean {
        _session.moveExercise(1);
        WatchUi.requestUpdate();
        return true;
    }

    function onPreviousPage() as Boolean {
        _session.moveExercise(-1);
        WatchUi.requestUpdate();
        return true;
    }

    function onMenu() as Boolean {
        var menu = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.Exercises) as String });
        var exercises = _session.exercises();
        for (var i = 0; i < exercises.size(); i++) {
            var ex = exercises[i] as Dictionary;
            menu.addItem(new WatchUi.MenuItem(ex["name"] as String,
                (ex["logged"] as Array).size() + " / " + (ex["planned"] == null ? 0 : (ex["planned"] as Array).size()),
                i, null));
        }
        if (!_session.isLive()) {
            menu.addItem(new WatchUi.MenuItem("Undo last set", null, :undo, null));
        }
        WatchUi.pushView(menu, new ExerciseMenuDelegate(_session), WatchUi.SLIDE_UP);
        return true;
    }

    function onBack() as Boolean {
        var menu = new WatchUi.Menu2({ :title => _session.data["name"] as String });
        menu.addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.Continue) as String, null, :continue, null));
        menu.addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.Finish) as String, null, :finish, null));
        menu.addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.Discard) as String, null, :discard, null));
        WatchUi.pushView(menu, new FinishMenuDelegate(_session), WatchUi.SLIDE_UP);
        return true;
    }
}

class ExerciseMenuDelegate extends WatchUi.Menu2InputDelegate {

    private var _session as WorkoutSession;

    function initialize(session as WorkoutSession) {
        Menu2InputDelegate.initialize();
        _session = session;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :undo) {
            _session.undoLastSet();
        } else {
            _session.selectExercise(id as Number);
        }
        WatchUi.popView(WatchUi.SLIDE_DOWN);
    }
}

class FinishMenuDelegate extends WatchUi.Menu2InputDelegate {

    private var _session as WorkoutSession;

    function initialize(session as WorkoutSession) {
        Menu2InputDelegate.initialize();
        _session = session;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :continue) {
            WatchUi.popView(WatchUi.SLIDE_DOWN);
            return;
        }
        var app = getApp();
        if (id == :finish) {
            var queued = _session.finishAndQueue();
            if (queued) {
                app.recorder.save();
            } else {
                app.recorder.discard();
            }
            app.sync.sync(null);
        } else {
            _session.discard();
            app.recorder.discard();
        }
        // Back to the start menu, rebuilt without the finished workout.
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        var built = MainMenu.build();
        WatchUi.switchToView(built[0], built[1], WatchUi.SLIDE_RIGHT);
    }
}
