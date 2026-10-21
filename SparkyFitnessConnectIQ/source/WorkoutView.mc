import Toybox.Lang;
import Toybox.Graphics;
import Toybox.WatchUi;

// One exercise at a time: name, set progress, the planned target, last time's
// values and a progressive-overload suggestion.
//   SELECT / tap       log the next set
//   UP / DOWN / swipe  previous / next exercise
//   MENU (long UP)     jump to an exercise, undo last set
//   BACK               finish, discard or continue
class WorkoutView extends WatchUi.View {

    private var _session as WorkoutSession;

    function initialize(session as WorkoutSession) {
        View.initialize();
        _session = session;
    }

    function onShow() as Void {
        MainMenu.visible = false;
        if (_session.isLive()) {
            getApp().phone.liveViewOpen = true;
        }
    }

    function onHide() as Void {
        getApp().phone.liveViewOpen = false;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        // A live workout follows the phone: sets logged there show up here.
        _session.refresh();
        var w = dc.getWidth();
        var h = dc.getHeight();
        var unit = Store.weightUnit();
        var ex = _session.current();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.10, Graphics.FONT_XTINY,
            (_session.exerciseIndex() + 1) + "/" + _session.exerciseCount(),
            Graphics.TEXT_JUSTIFY_CENTER);

        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.20, Graphics.FONT_SMALL, ex["name"] as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        var logged = _session.loggedCount();
        var planned = _session.plannedCount();
        var setLabel = WatchUi.loadResource(Rez.Strings.Set) as String;
        var progress = planned > 0
            ? setLabel + " " + (logged < planned ? logged + 1 : planned) + "/" + planned
            : setLabel + " " + (logged + 1);
        if (_session.isExerciseComplete()) {
            progress = WatchUi.loadResource(Rez.Strings.Done) as String;
            dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        } else {
            dc.setColor(Graphics.COLOR_ORANGE, Graphics.COLOR_TRANSPARENT);
        }
        dc.drawText(w / 2, h * 0.36, Graphics.FONT_MEDIUM, progress, Graphics.TEXT_JUSTIFY_CENTER);

        var plan = _session.nextPlannedSet();
        if (plan != null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.52, Graphics.FONT_SMALL, describeSet(plan, unit),
                Graphics.TEXT_JUSTIFY_CENTER);
        }

        var previous = ex["previous"] as Array or Null;
        if (previous != null && previous.size() > 0) {
            var idx = logged < previous.size() ? logged : previous.size() - 1;
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w / 2, h * 0.66, Graphics.FONT_XTINY,
                (WatchUi.loadResource(Rez.Strings.Last) as String) + " " + describeSet(previous[idx] as Dictionary, unit),
                Graphics.TEXT_JUSTIFY_CENTER);
            var suggestion = SparkyLogic.suggestWeight(
                plan == null ? null : plan["reps"] as Number or Null, previous, unit);
            if (suggestion != null) {
                dc.setColor(Graphics.COLOR_BLUE, Graphics.COLOR_TRANSPARENT);
                dc.drawText(w / 2, h * 0.76, Graphics.FONT_XTINY,
                    (WatchUi.loadResource(Rez.Strings.Suggest) as String) + " " + SparkyLogic.formatWeight(suggestion) + " " + unit,
                    Graphics.TEXT_JUSTIFY_CENTER);
            }
        }
    }

    static function describeSet(set as Dictionary, unit as String) as String {
        var reps = set["reps"] as Number or Null;
        var weight = set["weight"] as Float or Number or Null;
        var text = reps == null ? "-" : reps.toString();
        if (weight != null && (weight as Float or Number).toFloat() > 0.0) {
            text += " × " + SparkyLogic.formatWeight(SparkyLogic.toDisplayWeight(weight as Float or Number, unit)) + " " + unit;
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
