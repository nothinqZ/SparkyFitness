import Toybox.Lang;
import Toybox.Graphics;
import Toybox.WatchUi;
import Toybox.Sensor;
import Toybox.Timer;
import Toybox.Time;
import Toybox.UserProfile;

// The workout, modelled on Garmin's own strength activity and Hevy: data
// pages you scroll through, one press to log a set.
//
// Pages (UP / DOWN or swipe up / down, dots on the right):
//   0 Set       exercise, set kind, the target, last time, a ring with one
//               segment per set, heart rate and workout time
//   1 Data      Garmin-style fields: time, heart rate (zone colour), set time,
//               calories, sets done, volume
//   2 Overview  every exercise with its progress; SELECT picks one
//
//   SELECT             log the set as shown (one press), then rest
//   tap                change reps / weight first, then log
//   swipe left/right   next / previous exercise
//   MENU (long UP)     exercises, undo last set
//   BACK               continue, finish or discard
class WorkoutView extends WatchUi.View {

    // Colours of set kinds, shared with the set editor and rest screen.
    static const COLOR_WARMUP = 0x55AAFF;
    static const COLOR_DROP = 0xAA66FF;
    static const COLOR_FAILURE = 0xFF5555;
    // Heart-rate zones 0-5, as Garmin colours them.
    static const ZONE_COLORS = [0x777777, 0x8C8C8C, 0x3399FF, 0x33CC33, 0xFF9900, 0xFF3333];

    static const PAGE_SET = 0;
    static const PAGE_DATA = 1;
    static const PAGE_OVERVIEW = 2;
    static const PAGE_COUNT = 3;

    var page as Number = PAGE_SET;
    private var _session as WorkoutSession;
    // Redraws for the clock and heart rate while the view is on screen.
    private var _timer as Timer.Timer or Null = null;

    function initialize(session as WorkoutSession) {
        View.initialize();
        _session = session;
    }

    function onShow() as Void {
        MainMenu.visible = false;
        if (_session.isLive()) {
            getApp().phone.liveViewOpen = true;
            getApp().phone.liveSession = _session;
        }
        var timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
        _timer = timer;
    }

    function onHide() as Void {
        getApp().phone.liveViewOpen = false;
        getApp().phone.liveSession = null;
        var timer = _timer;
        if (timer != null) {
            timer.stop();
            _timer = null;
        }
    }

    function onTick() as Void {
        WatchUi.requestUpdate();
    }

    function turnPage(delta as Number) as Void {
        page = (page + delta + PAGE_COUNT) % PAGE_COUNT;
        WatchUi.requestUpdate();
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        // A live workout follows the phone: sets logged there show up here.
        _session.refresh();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        if (page == PAGE_DATA) {
            drawDataPage(dc);
        } else if (page == PAGE_OVERVIEW) {
            drawOverviewPage(dc);
        } else {
            drawSetPage(dc);
        }
        drawPageDots(dc);
    }

    // --- Page 0: the set ------------------------------------------------------

    private function drawSetPage(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var cx = w / 2;
        var unit = Store.weightUnit();
        var ex = _session.current();

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
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.20, name.length() > 16 ? Graphics.FONT_TINY : Graphics.FONT_SMALL,
            name, Graphics.TEXT_JUSTIFY_CENTER);

        drawFooter(dc, w, h);

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
        dc.drawText(cx, h * 0.33, Graphics.FONT_TINY, progress, Graphics.TEXT_JUSTIFY_CENTER);

        // The target for the next set, large: "8 x 100 kg".
        if (plan != null) {
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.51, Graphics.FONT_LARGE, describeSet(plan, unit),
                Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
        }

        var previous = ex["previous"] as Array or Null;
        if (previous != null && previous.size() > 0) {
            var idx = logged < previous.size() ? logged : previous.size() - 1;
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.62, Graphics.FONT_XTINY,
                (WatchUi.loadResource(Rez.Strings.Last) as String) + " " + describeSet(previous[idx] as Dictionary, unit),
                Graphics.TEXT_JUSTIFY_CENTER);
        }

        // What comes after this exercise, so the plan is never a guess.
        var after = _session.nextExerciseName();
        if (after != null) {
            dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(cx, h * 0.70, Graphics.FONT_XTINY,
                (WatchUi.loadResource(Rez.Strings.Next) as String) + ": " + after,
                Graphics.TEXT_JUSTIFY_CENTER);
        }
        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(cx, h * 0.89, Graphics.FONT_XTINY,
            WatchUi.loadResource(Rez.Strings.LogHint) as String, Graphics.TEXT_JUSTIFY_CENTER);
    }

    // Heart rate (zone colour) and workout time along the bottom.
    private function drawFooter(dc as Graphics.Dc, w as Number, h as Number) as Void {
        var y = h * 0.80;
        var hr = currentHeartRate();
        if (hr != null) {
            dc.setColor(zoneColor(hr), Graphics.COLOR_TRANSPARENT);
            dc.drawText(w * 0.36, y, Graphics.FONT_TINY, hr + " bpm", Graphics.TEXT_JUSTIFY_CENTER);
        }
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(hr != null ? w * 0.66 : w / 2, y, Graphics.FONT_TINY,
            SparkyLogic.formatClock(getApp().recorder.elapsedSeconds()), Graphics.TEXT_JUSTIFY_CENTER);
    }

    // One segment per planned set around the edge: done green, next in its
    // kind's colour, open warm-ups dim blue, other open sets grey.
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
            var color = done ? Graphics.COLOR_GREEN
                : (set == next ? setColor(set)
                    : ("w".equals(set["type"]) ? 0x1F4466 : Graphics.COLOR_DK_GRAY));
            dc.setColor(color, Graphics.COLOR_TRANSPARENT);
            var from = 90 - i * span - gap / 2;
            var to = 90 - (i + 1) * span + gap / 2;
            dc.drawArc(w / 2, h / 2, radius, Graphics.ARC_CLOCKWISE, from, to);
        }
    }

    // --- Page 1: Garmin-style data fields --------------------------------------

    private function drawDataPage(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var recorder = getApp().recorder;
        var hr = currentHeartRate();
        var totals = SparkyLogic.setTotals(_session.exercises());
        var calories = recorder.calories();

        // Big workout time on top, as on Garmin's strength screen.
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.12, Graphics.FONT_XTINY,
            WatchUi.loadResource(Rez.Strings.Elapsed) as String, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.27, Graphics.FONT_NUMBER_MILD,
            SparkyLogic.formatClock(recorder.elapsedSeconds()),
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);

        dc.setColor(Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(1);
        dc.drawLine(w * 0.12, h * 0.40, w * 0.88, h * 0.40);
        dc.drawLine(w * 0.12, h * 0.63, w * 0.88, h * 0.63);
        dc.drawLine(w / 2, h * 0.40, w / 2, h * 0.86);

        drawField(dc, w * 0.30, h * 0.43, WatchUi.loadResource(Rez.Strings.HeartRate) as String,
            hr == null ? "--" : hr.toString(), hr == null ? Graphics.COLOR_WHITE : zoneColor(hr));
        drawField(dc, w * 0.70, h * 0.43, WatchUi.loadResource(Rez.Strings.SetTime) as String,
            SparkyLogic.formatClock(Time.now().value() - _session.setStartedAt), Graphics.COLOR_WHITE);
        drawField(dc, w * 0.30, h * 0.66, WatchUi.loadResource(Rez.Strings.Calories) as String,
            calories == null ? "--" : calories.toString(), Graphics.COLOR_WHITE);
        drawField(dc, w * 0.70, h * 0.66, WatchUi.loadResource(Rez.Strings.Sets) as String,
            totals[0] + "/" + totals[1], Graphics.COLOR_WHITE);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.88, Graphics.FONT_XTINY,
            (WatchUi.loadResource(Rez.Strings.Volume) as String) + " "
                + SparkyLogic.formatVolume(SparkyLogic.volumeKg(_session.exercises()), Store.weightUnit()),
            Graphics.TEXT_JUSTIFY_CENTER);
    }

    private function drawField(dc as Graphics.Dc, x as Float, y as Float, label as String,
            value as String, color as Number) as Void {
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y, Graphics.FONT_XTINY, label, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(color, Graphics.COLOR_TRANSPARENT);
        dc.drawText(x, y + dc.getFontHeight(Graphics.FONT_XTINY), Graphics.FONT_MEDIUM, value,
            Graphics.TEXT_JUSTIFY_CENTER);
    }

    // --- Page 2: all exercises ---------------------------------------------------

    private function drawOverviewPage(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        var list = _session.exercises();
        var current = _session.exerciseIndex();
        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.10, Graphics.FONT_XTINY,
            WatchUi.loadResource(Rez.Strings.Overview) as String, Graphics.TEXT_JUSTIFY_CENTER);

        // Up to five rows around the current exercise.
        var rows = 5;
        var first = current - 2;
        if (first > list.size() - rows) {
            first = list.size() - rows;
        }
        if (first < 0) {
            first = 0;
        }
        var rowHeight = (h * 0.13).toNumber();
        var top = (h * 0.21).toNumber();
        for (var r = 0; r < rows && first + r < list.size(); r++) {
            var i = first + r;
            var ex = list[i] as Dictionary;
            var planned = ex["planned"] as Array or Null;
            var total = planned == null ? 0 : planned.size();
            var done = (ex["logged"] as Array).size();
            var y = top + r * rowHeight;
            var complete = total > 0 && !_session.hasOpenSet(ex);
            if (i == current) {
                dc.setColor(0x262626, Graphics.COLOR_TRANSPARENT);
                dc.fillRoundedRectangle(w * 0.10, y - 2, w * 0.80, rowHeight - 4, 10);
            }
            dc.setColor(complete ? Graphics.COLOR_GREEN : (i == current ? Graphics.COLOR_WHITE : Graphics.COLOR_LT_GRAY),
                Graphics.COLOR_TRANSPARENT);
            var name = ex["name"] as String;
            if (name.length() > 15) {
                name = name.substring(0, 14) + "…";
            }
            dc.drawText(w * 0.16, y, Graphics.FONT_XTINY, name, Graphics.TEXT_JUSTIFY_LEFT);
            dc.drawText(w * 0.84, y, Graphics.FONT_XTINY, complete ? "✓" : done + "/" + total,
                Graphics.TEXT_JUSTIFY_RIGHT);
        }
    }

    // Page position dots on the right edge.
    private function drawPageDots(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        for (var i = 0; i < PAGE_COUNT; i++) {
            dc.setColor(i == page ? Graphics.COLOR_WHITE : Graphics.COLOR_DK_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.fillCircle(w - 22, h / 2 + (i - 1) * 14, i == page ? 4 : 3);
        }
    }

    // --- Shared helpers -------------------------------------------------------

    static function currentHeartRate() as Number or Null {
        var info = Sensor.getInfo();
        return info has :heartRate ? info.heartRate : null;
    }

    static function zoneColor(hr as Number) as Number {
        var zones = null;
        if (Toybox has :UserProfile && UserProfile has :getHeartRateZones) {
            zones = UserProfile.getHeartRateZones(UserProfile.HR_ZONE_SPORT_GENERIC);
        }
        return ZONE_COLORS[SparkyLogic.heartRateZone(hr, zones)] as Number;
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
    private var _view as WorkoutView;

    function initialize(session as WorkoutSession, view as WorkoutView) {
        BehaviorDelegate.initialize();
        _session = session;
        _view = view;
    }

    function onSelect() as Boolean {
        if (_view.page == WorkoutView.PAGE_OVERVIEW) {
            return onMenu();
        }
        if (!quickLog()) {
            openEditor();
        }
        return true;
    }

    // START logs the set as shown: the target, or what was logged last.
    // The editor opens instead when there is nothing to confirm, or when
    // RPE is to be asked.
    private function quickLog() as Boolean {
        if (Store.askRpe() || _session.nextPlannedSet() == null) {
            return false;
        }
        var defaults = _session.defaultsForNextSet();
        var reps = SparkyLogic.toInt(defaults["reps"]);
        var weight = SparkyLogic.toFloatOrNull(defaults["weight"]);
        if (reps == null) {
            return false;
        }
        SetEditorView.logAndRest(_session, reps, weight == null ? 0.0 : weight, null);
        return true;
    }

    private function openEditor() as Void {
        var editor = new SetEditorView(_session, false);
        WatchUi.pushView(editor, new SetEditorDelegate(editor), WatchUi.SLIDE_UP);
    }

    // Tapping the set screen changes the set before logging it.
    function onTap(event as WatchUi.ClickEvent) as Boolean {
        if (_view.page != WorkoutView.PAGE_SET) {
            return false;
        }
        openEditor();
        return true;
    }

    function onNextPage() as Boolean {
        _view.turnPage(1);
        return true;
    }

    function onPreviousPage() as Boolean {
        _view.turnPage(-1);
        return true;
    }

    // Swiping sideways changes the exercise; up/down stays with the pages.
    function onSwipe(event as WatchUi.SwipeEvent) as Boolean {
        var direction = event.getDirection();
        if (direction == WatchUi.SWIPE_LEFT) {
            _session.moveExercise(1);
        } else if (direction == WatchUi.SWIPE_RIGHT) {
            _session.moveExercise(-1);
        } else {
            return false;
        }
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
            menu.addItem(new WatchUi.MenuItem(WatchUi.loadResource(Rez.Strings.UndoLast) as String, null, :undo, null));
        }
        WatchUi.pushView(menu, new ExerciseMenuDelegate(_session, _view), WatchUi.SLIDE_UP);
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
    private var _view as WorkoutView;

    function initialize(session as WorkoutSession, view as WorkoutView) {
        Menu2InputDelegate.initialize();
        _session = session;
        _view = view;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :undo) {
            _session.undoLastSet();
        } else {
            _session.selectExercise(id as Number);
            // Picking an exercise means working on it: back to the set page.
            _view.page = WorkoutView.PAGE_SET;
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
            // Read Garmin's figures before the recording is saved and closed.
            var summary = SummaryView.capture(_session);
            var queued = _session.finishAndQueue();
            if (queued) {
                app.recorder.save();
            } else {
                app.recorder.discard();
            }
            app.sync.sync(null);
            WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
            WatchUi.switchToView(new SummaryView(summary), new SummaryDelegate(), WatchUi.SLIDE_UP);
            return;
        }
        _session.discard();
        app.recorder.discard();
        // Back to the start menu, rebuilt without the finished workout.
        WatchUi.popView(WatchUi.SLIDE_IMMEDIATE);
        var built = MainMenu.build();
        WatchUi.switchToView(built[0], built[1], WatchUi.SLIDE_RIGHT);
    }
}

// End-of-workout summary, like Garmin's: duration, sets, volume, average
// heart rate and calories. Any key returns to the start menu.
class SummaryView extends WatchUi.View {

    private var _summary as Dictionary;

    static function capture(session as WorkoutSession) as Dictionary {
        var recorder = getApp().recorder;
        var totals = SparkyLogic.setTotals(session.exercises());
        return {
            "name" => session.data["name"],
            "duration" => recorder.elapsedSeconds(),
            "sets" => totals[0],
            "volume" => SparkyLogic.volumeKg(session.exercises()),
            "hr" => recorder.averageHeartRate(),
            "kcal" => recorder.calories()
        };
    }

    function initialize(summary as Dictionary) {
        View.initialize();
        _summary = summary;
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        var w = dc.getWidth();
        var h = dc.getHeight();
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(Graphics.COLOR_GREEN, Graphics.COLOR_TRANSPARENT);
        dc.setPenWidth(6);
        dc.drawCircle(w / 2, h / 2, (w < h ? w : h) / 2 - 5);

        dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.12, Graphics.FONT_XTINY,
            WatchUi.loadResource(Rez.Strings.Summary) as String, Graphics.TEXT_JUSTIFY_CENTER);
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(w / 2, h * 0.21, Graphics.FONT_SMALL, _summary["name"] as String,
            Graphics.TEXT_JUSTIFY_CENTER);

        var rows = [
            [Rez.Strings.Duration, SparkyLogic.formatClock(_summary["duration"] as Number)],
            [Rez.Strings.Sets, (_summary["sets"] as Number).toString()],
            [Rez.Strings.Volume, SparkyLogic.formatVolume(_summary["volume"] as Float, Store.weightUnit())],
            [Rez.Strings.AvgHeartRate, _summary["hr"] == null ? "--" : _summary["hr"] + " bpm"],
            [Rez.Strings.Calories, _summary["kcal"] == null ? "--" : (_summary["kcal"] as Number).toString()]
        ];
        var y = h * 0.36;
        var step = h * 0.10;
        for (var i = 0; i < rows.size(); i++) {
            var row = rows[i] as Array;
            dc.setColor(Graphics.COLOR_LT_GRAY, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w * 0.18, y + i * step, Graphics.FONT_TINY,
                WatchUi.loadResource(row[0] as ResourceId) as String, Graphics.TEXT_JUSTIFY_LEFT);
            dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
            dc.drawText(w * 0.82, y + i * step, Graphics.FONT_TINY, row[1] as String,
                Graphics.TEXT_JUSTIFY_RIGHT);
        }
    }
}

class SummaryDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    private function close() as Boolean {
        var built = MainMenu.build();
        WatchUi.switchToView(built[0], built[1], WatchUi.SLIDE_RIGHT);
        return true;
    }

    function onSelect() as Boolean {
        return close();
    }

    function onBack() as Boolean {
        return close();
    }
}
