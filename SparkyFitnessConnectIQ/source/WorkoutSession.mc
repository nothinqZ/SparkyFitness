import Toybox.Lang;
import Toybox.Time;
import Toybox.WatchUi;

// The workout in progress. State is a plain Dictionary so it can be written to
// Application.Storage as-is after every change; this class only wraps it.
//
// Shape:
// { "client_session_id", "workout_preset_id", "name", "entry_date",
//   "started_at", "started_at_local", "ex_idx",
//   "exercises" => [ { "exercise_id", "name", "planned" => [..manifest sets..],
//                      "previous" => [..] or null, "logged" => [ {reps, weight,
//                      rpe, rest_time, completed_at} ] } ] }
//
// A live session mirrors the phone's workout (PhoneLink): `data` is rebuilt
// from Store.live() by refresh(), carries "live" => session id, its planned
// sets carry "id" and "done", and logging a set sends it to the phone
// instead of building an upload. The phone owns saving it.
class WorkoutSession {

    var data as Dictionary;
    // When the current set began (epoch s): after the last rest, or when the
    // workout was opened. Shown as "set time" like Garmin's set timer.
    var setStartedAt as Number;

    function initialize(data as Dictionary) {
        self.data = data;
        setStartedAt = Time.now().value();
    }

    function markSetStart() as Void {
        setStartedAt = Time.now().value();
    }

    // The phone's live workout, or null when there is none.
    static function live() as WorkoutSession or Null {
        var plan = Store.live();
        return plan == null ? null : new WorkoutSession(SparkyLogic.sessionFromLive(plan, null));
    }

    function isLive() as Boolean {
        return data["live"] != null;
    }

    // Picks up a newer plan from the phone, keeping the exercise on screen.
    function refresh() as Void {
        if (!isLive()) {
            return;
        }
        var plan = Store.live();
        if (plan != null && (data["live"] as String).equals(plan["sid"])) {
            data = SparkyLogic.sessionFromLive(plan, data["ex_idx"] as Number);
        }
    }

    static function start(workout as Dictionary) as WorkoutSession {
        var now = Time.now();
        var exercises = [] as Array;
        var source = workout["exercises"] as Array;
        for (var i = 0; i < source.size(); i++) {
            var ex = source[i] as Dictionary;
            var previous = ex["previous"] as Dictionary or Null;
            exercises.add({
                "exercise_id" => ex["exercise_id"],
                "name" => ex["name"],
                "planned" => ex["sets"],
                "previous" => previous == null ? null : previous["sets"],
                "logged" => []
            });
        }
        var session = new WorkoutSession({
            "client_session_id" => Store.newUuid(),
            "workout_preset_id" => workout["workout_preset_id"],
            "name" => workout["name"],
            "entry_date" => SparkyLogic.localDay(now),
            "started_at" => SparkyLogic.isoUtc(now),
            "started_at_local" => SparkyLogic.isoLocal(now),
            "ex_idx" => 0,
            "exercises" => exercises
        });
        session.save();
        return session;
    }

    function save() as Void {
        if (isLive()) {
            return;
        }
        if (!Store.saveActiveSession(data)) {
            Store.setLastError("Watch storage full, workout not saved");
        }
    }

    function exercises() as Array {
        return data["exercises"] as Array;
    }

    function exerciseIndex() as Number {
        return data["ex_idx"] as Number;
    }

    function exerciseCount() as Number {
        return exercises().size();
    }

    function current() as Dictionary {
        return exercises()[exerciseIndex()] as Dictionary;
    }

    function moveExercise(delta as Number) as Void {
        var n = exerciseCount();
        if (n == 0) {
            return;
        }
        data["ex_idx"] = (exerciseIndex() + delta + n) % n;
        save();
    }

    function selectExercise(index as Number) as Void {
        if (index >= 0 && index < exerciseCount()) {
            data["ex_idx"] = index;
            save();
        }
    }

    function loggedCount() as Number {
        return (current()["logged"] as Array).size();
    }

    function plannedCount() as Number {
        var planned = current()["planned"] as Array or Null;
        return planned == null ? 0 : planned.size();
    }

    // Planned set for the next set to log; extra sets beyond the plan repeat
    // the last planned one.
    function nextPlannedSet() as Dictionary or Null {
        var planned = current()["planned"] as Array or Null;
        if (planned == null || planned.size() == 0) {
            return null;
        }
        if (isLive()) {
            // The phone may log sets out of order: the next is the first open.
            for (var i = 0; i < planned.size(); i++) {
                if ((planned[i] as Dictionary)["done"] != true) {
                    return planned[i] as Dictionary;
                }
            }
            return null;
        }
        var idx = loggedCount();
        if (idx >= planned.size()) {
            idx = planned.size() - 1;
        }
        return planned[idx] as Dictionary;
    }

    // Defaults for the set editor: the last set logged in this session, else
    // the plan, else last time's values. Weight in kg.
    // Values the log screen starts with, field by field: the plan's target
    // (the phone's resolved one, so warm-up ramps and progression are in),
    // else what was logged last in this exercise, else last session. With a
    // plan this makes most sets a single press.
    function defaultsForNextSet() as Dictionary {
        var plan = nextPlannedSet();
        var logged = current()["logged"] as Array;
        var last = logged.size() > 0 ? logged[logged.size() - 1] as Dictionary : null;
        var previous = current()["previous"] as Array or Null;
        var before = previous != null && previous.size() > 0 ? previous[0] as Dictionary : null;
        return {
            "reps" => firstValue("reps", [plan, last, before], 8),
            "weight" => firstValue("weight", [plan, last, before], 0.0)
        };
    }

    private function firstValue(key as String, sources as Array, fallback) {
        for (var i = 0; i < sources.size(); i++) {
            var source = sources[i] as Dictionary or Null;
            if (source != null && source[key] != null) {
                return source[key];
            }
        }
        return fallback;
    }

    function restSecondsForNextSet() as Number {
        var plan = nextPlannedSet();
        if (plan != null && plan["rest_time"] instanceof Number && (plan["rest_time"] as Number) > 0) {
            return plan["rest_time"] as Number;
        }
        return Store.defaultRestSeconds();
    }

    function logSet(reps as Number, weightKg as Float, rpe as Float or Null, restSeconds as Number) as Void {
        if (isLive()) {
            logLiveSet(reps, weightKg, rpe);
            advanceAfterLog();
            return;
        }
        var entry = {
            "reps" => reps,
            "weight" => weightKg,
            "completed_at" => SparkyLogic.isoUtc(Time.now()),
            "rest_time" => restSeconds
        } as Dictionary;
        if (rpe != null) {
            entry["rpe"] = rpe;
        }
        // Without the phone the watch only knows last session, so it can say
        // "stronger than last time", not "record".
        if (SparkyLogic.beatsLastTime(current()["previous"] as Array or Null, reps, weightKg)) {
            PhoneLink.celebrate(WatchUi.loadResource(Rez.Strings.BeatLastTime) as String);
        }
        (current()["logged"] as Array).add(entry);
        // Undo must find this set after the view moved on to the next exercise.
        data["last_ex"] = exerciseIndex();
        advanceAfterLog();
        save();
    }

    function hasOpenSet(ex as Dictionary) as Boolean {
        var planned = ex["planned"] as Array or Null;
        if (planned == null || planned.size() == 0) {
            return false;
        }
        if (isLive()) {
            for (var i = 0; i < planned.size(); i++) {
                if ((planned[i] as Dictionary)["done"] != true) {
                    return true;
                }
            }
            return false;
        }
        return (ex["logged"] as Array).size() < planned.size();
    }

    // After a set: in a superset, go to the next exercise of the same group
    // that still has a set (A1 -> B1 -> A2 ...); otherwise, once the
    // exercise is done, go to the next exercise with a set left.
    private function advanceAfterLog() as Void {
        var list = exercises();
        var n = list.size();
        var idx = exerciseIndex();
        var group = current()["superset"];
        if (group != null) {
            for (var step = 1; step < n; step++) {
                var j = (idx + step) % n;
                var ex = list[j] as Dictionary;
                if (group == ex["superset"] && hasOpenSet(ex)) {
                    data["ex_idx"] = j;
                    return;
                }
            }
        }
        if (hasOpenSet(current())) {
            return;
        }
        for (var step = 1; step < n; step++) {
            var j = (idx + step) % n;
            if (hasOpenSet(list[j] as Dictionary)) {
                data["ex_idx"] = j;
                return;
            }
        }
    }

    // Weight step of the current exercise in display units: its own from
    // Sparky's progression settings when known, else the default.
    function weightStep(unit as String) as Float {
        var step = current()["step"];
        if (step instanceof Float && step > 0.0) {
            return step as Float;
        }
        return SparkyLogic.weightStep(unit);
    }

    // Marks the next open set done here and sends it to the phone, which
    // completes it in its live workout (rest, PRs, saving). Every planned set
    // done means the phone has to add more; nothing is logged then.
    private function logLiveSet(reps as Number, weightKg as Float, rpe as Float or Null) as Void {
        var next = nextPlannedSet();
        var plan = Store.live();
        if (plan == null) {
            return;
        }
        if (next == null) {
            addLiveSet(plan, reps, weightKg, rpe);
            return;
        }
        var setId = next["id"] as String;
        SparkyLogic.markLiveSetDone(plan, setId, reps, weightKg);
        Store.setLive(plan);
        var message = {
            "t" => "set", "sid" => data["live"], "id" => setId, "r" => reps,
            "w" => weightKg, "at" => Time.now().value(), "c" => Store.newUuid()
        } as Dictionary;
        if (rpe != null) {
            message["rpe"] = rpe;
        }
        if (!getApp().phone.enqueue(message)) {
            Store.setLastError("Watch storage full, set not sent");
        }
        refresh();
    }

    // Every planned set is done: ask the phone to add one to this exercise
    // and complete it. Shown here at once; the phone's plan takes over.
    private function addLiveSet(plan as Dictionary, reps as Number, weightKg as Float,
            rpe as Float or Null) as Void {
        var entry = current()["entry"];
        if (entry == null) {
            return;
        }
        var message = {
            "t" => "add", "sid" => data["live"], "e" => entry, "r" => reps, "w" => weightKg,
            "at" => Time.now().value(), "c" => Store.newUuid()
        } as Dictionary;
        if (rpe != null) {
            message["rpe"] = rpe;
        }
        if (!getApp().phone.enqueue(message)) {
            Store.setLastError("Watch storage full, set not sent");
            return;
        }
        Store.setLive(SparkyLogic.mergePendingAdds(plan, [message]));
        refresh();
    }

    function undoLastSet() as Void {
        if (isLive()) {
            // Undo is the phone's: a set already sent cannot be withdrawn.
            return;
        }
        var last = data["last_ex"];
        if (last instanceof Number && last >= 0 && last < exerciseCount()) {
            data["ex_idx"] = last;
        }
        var logged = current()["logged"] as Array;
        if (logged.size() > 0) {
            current()["logged"] = logged.slice(0, logged.size() - 1);
            save();
        }
    }

    // The set logged last on the watch, for correcting it during the rest.
    // Null in a live workout: sets logged there belong to the phone.
    function lastLogged() as Dictionary or Null {
        var last = data["last_ex"];
        if (isLive() || !(last instanceof Number) || last < 0 || last >= exerciseCount()) {
            return null;
        }
        var logged = (exercises()[last] as Dictionary)["logged"] as Array;
        return logged.size() > 0 ? logged[logged.size() - 1] as Dictionary : null;
    }

    function lastLoggedName() as String {
        return (exercises()[data["last_ex"] as Number] as Dictionary)["name"] as String;
    }

    // Replaces reps, weight and RPE of the set logged last; its time and
    // rest stay.
    function amendLastSet(reps as Number, weightKg as Float, rpe as Float or Null) as Void {
        var entry = lastLogged();
        if (entry == null) {
            return;
        }
        entry["reps"] = reps;
        entry["weight"] = weightKg;
        if (rpe != null) {
            entry["rpe"] = rpe;
        } else {
            entry.remove("rpe");
        }
        save();
    }

    // The next other exercise with a set left, for "Next: ..." on screen.
    function nextExerciseName() as String or Null {
        var list = exercises();
        var n = list.size();
        var idx = exerciseIndex();
        for (var step = 1; step < n; step++) {
            var ex = list[(idx + step) % n] as Dictionary;
            if (hasOpenSet(ex)) {
                return ex["name"] as String;
            }
        }
        return null;
    }

    function isExerciseComplete() as Boolean {
        var planned = plannedCount();
        return planned > 0 && loggedCount() >= planned;
    }

    // Queue the finished workout for upload. Returns false when no set was
    // logged (nothing to save). The workout is removed from the watch only
    // once it is in the queue; if the queue cannot store it, it stays as the
    // active workout so it can be finished again after the next sync.
    function finishAndQueue() as Boolean {
        if (isLive()) {
            getApp().phone.enqueue({ "t" => "finish", "sid" => data["live"], "c" => Store.newUuid() });
            Store.clearLive();
            return true;
        }
        var upload = SparkyLogic.buildUpload(
            data,
            SparkyLogic.isoUtc(Time.now()),
            Store.deviceId(),
            Store.deviceModel(),
            APP_VERSION
        );
        if (upload == null) {
            Store.clearActiveSession();
            return false;
        }
        if (Store.enqueue(upload)) {
            Store.clearActiveSession();
        } else {
            Store.setLastError("Watch storage full, workout kept");
        }
        return true;
    }

    function discard() as Void {
        if (isLive()) {
            // Leaving the watch view; the workout keeps running on the phone.
            return;
        }
        Store.clearActiveSession();
    }
}
