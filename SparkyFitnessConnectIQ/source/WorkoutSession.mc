import Toybox.Lang;
import Toybox.Time;

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

    function initialize(data as Dictionary) {
        self.data = data;
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
    function defaultsForNextSet() as Dictionary {
        var logged = current()["logged"] as Array;
        if (logged.size() > 0) {
            var last = logged[logged.size() - 1] as Dictionary;
            return { "reps" => last["reps"], "weight" => last["weight"] };
        }
        var plan = nextPlannedSet();
        if (plan != null && (plan["reps"] != null || plan["weight"] != null)) {
            return { "reps" => plan["reps"], "weight" => plan["weight"] };
        }
        var previous = current()["previous"] as Array or Null;
        if (previous != null && previous.size() > 0) {
            var p = previous[0] as Dictionary;
            return { "reps" => p["reps"], "weight" => p["weight"] };
        }
        return { "reps" => 8, "weight" => 0.0 };
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
        (current()["logged"] as Array).add(entry);
        save();
    }

    // Marks the next open set done here and sends it to the phone, which
    // completes it in its live workout (rest, PRs, saving). Every planned set
    // done means the phone has to add more; nothing is logged then.
    private function logLiveSet(reps as Number, weightKg as Float, rpe as Float or Null) as Void {
        var next = nextPlannedSet();
        var plan = Store.live();
        if (next == null || plan == null) {
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

    function undoLastSet() as Void {
        if (isLive()) {
            // Undo is the phone's: a set already sent cannot be withdrawn.
            return;
        }
        var logged = current()["logged"] as Array;
        if (logged.size() > 0) {
            current()["logged"] = logged.slice(0, logged.size() - 1);
            save();
        }
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
