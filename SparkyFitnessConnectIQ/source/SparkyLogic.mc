import Toybox.Lang;
import Toybox.Time;
import Toybox.Time.Gregorian;
import Toybox.Math;

// Pure functions with no UI or device state, so they can be unit tested
// (test/SparkyLogicTest.mc). Weights are kilograms everywhere except where a
// function says it converts for display.
module SparkyLogic {

    const KG_PER_LB = 0.45359237;

    // Outcome of one upload attempt, decided from the HTTP status (or the
    // negative Connect IQ transport error code).
    enum {
        UPLOAD_DONE,      // stored on the server (created or duplicate)
        UPLOAD_REJECTED,  // the server will never accept this payload
        UPLOAD_AUTH,      // key revoked/wrong or URL wrong: stop until settings change
        UPLOAD_RETRY      // transient: phone offline, timeout, 5xx, rate limit
    }

    function classifyUploadResponse(code as Number) as Number {
        if (code == 200 || code == 201) {
            return UPLOAD_DONE;
        }
        if (code == 400 || code == 409 || code == 413 || code == 422) {
            return UPLOAD_REJECTED;
        }
        if (code == 401 || code == 403 || code == 404) {
            return UPLOAD_AUTH;
        }
        return UPLOAD_RETRY;
    }

    // RFC 4122 version 4 UUID from 16 random bytes.
    function uuidFromBytes(bytes as ByteArray) as String {
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        var out = "";
        for (var i = 0; i < 16; i++) {
            if (i == 4 || i == 6 || i == 8 || i == 10) {
                out += "-";
            }
            out += bytes[i].format("%02x");
        }
        return out;
    }

    function pad2(n as Number) as String {
        return n.format("%02d");
    }

    // "2026-10-20T06:00:00.000Z"
    function isoUtc(moment as Time.Moment) as String {
        var i = Gregorian.utcInfo(moment, Time.FORMAT_SHORT);
        return Lang.format("$1$-$2$-$3$T$4$:$5$:$6$.000Z", [
            (i.year as Number).format("%04d"), pad2(i.month as Number), pad2(i.day as Number),
            pad2(i.hour as Number), pad2(i.min as Number), pad2(i.sec as Number)
        ]);
    }

    // Wall-clock time without offset, the shape Garmin uses for startTimeLocal.
    function isoLocal(moment as Time.Moment) as String {
        var i = Gregorian.info(moment, Time.FORMAT_SHORT);
        return Lang.format("$1$-$2$-$3$T$4$:$5$:$6$", [
            (i.year as Number).format("%04d"), pad2(i.month as Number), pad2(i.day as Number),
            pad2(i.hour as Number), pad2(i.min as Number), pad2(i.sec as Number)
        ]);
    }

    function localDay(moment as Time.Moment) as String {
        return isoLocal(moment).substring(0, 10) as String;
    }

    function toDisplayWeight(kg as Float or Number or Null, unit as String) as Float {
        if (kg == null) {
            return 0.0;
        }
        var value = kg.toFloat();
        return unit.equals("lbs") ? value / KG_PER_LB : value;
    }

    function toKg(display as Float or Number, unit as String) as Float {
        var value = display.toFloat();
        return unit.equals("lbs") ? value * KG_PER_LB : value;
    }

    // Weight step for the picker in display units.
    function weightStep(unit as String) as Float {
        return unit.equals("lbs") ? 5.0 : 2.5;
    }

    function roundToStep(value as Float, step as Float) as Float {
        return (Math.round(value / step) * step).toFloat();
    }

    function formatWeight(display as Float) as String {
        var rounded = Math.round(display * 10.0) / 10.0;
        if (rounded == Math.floor(rounded)) {
            return rounded.toNumber().toString();
        }
        return rounded.format("%.1f");
    }

    // Progressive overload hint for a set, in display units, or null when
    // there is nothing to go on. Rule: if every previous set reached the
    // planned reps, add one weight step; otherwise repeat last time's weight.
    // This is a suggestion shown next to the plan, never applied silently.
    function suggestWeight(
        plannedReps as Number or Null,
        previousSets as Array or Null,
        unit as String
    ) as Float or Null {
        if (previousSets == null || previousSets.size() == 0) {
            return null;
        }
        var heaviest = 0.0;
        var allHit = true;
        for (var i = 0; i < previousSets.size(); i++) {
            var set = previousSets[i] as Dictionary;
            var w = set["weight"];
            var r = set["reps"];
            if (w != null && (w as Float or Number).toFloat() > heaviest) {
                heaviest = (w as Float or Number).toFloat();
            }
            if (plannedReps != null && (r == null || (r as Number) < plannedReps)) {
                allHit = false;
            }
        }
        if (heaviest <= 0.0) {
            return null;
        }
        var display = toDisplayWeight(heaviest, unit);
        var step = weightStep(unit);
        if (allHit && plannedReps != null) {
            display += step;
        }
        return roundToStep(display, step);
    }

    // Upload body for a finished session, following the server's
    // watchSessionUploadSchema. Exercises without a logged set are left out;
    // returns null when nothing was logged at all.
    function buildUpload(
        session as Dictionary,
        endedAt as String,
        deviceId as String,
        deviceModel as String or Null,
        appVersion as String
    ) as Dictionary or Null {
        var exercises = session["exercises"] as Array;
        var outExercises = [] as Array;
        for (var i = 0; i < exercises.size(); i++) {
            var ex = exercises[i] as Dictionary;
            var logged = ex["logged"] as Array;
            if (logged.size() == 0) {
                continue;
            }
            var sets = [] as Array;
            for (var s = 0; s < logged.size(); s++) {
                var set = logged[s] as Dictionary;
                var out = {
                    "set_number" => s + 1,
                    "reps" => set["reps"],
                    "weight" => set["weight"],
                    "completed_at" => set["completed_at"]
                } as Dictionary;
                if (set["rpe"] != null) {
                    out["rpe"] = set["rpe"];
                }
                if (set["rest_time"] != null) {
                    out["rest_time"] = set["rest_time"];
                }
                sets.add(out);
            }
            outExercises.add({
                "exercise_id" => ex["exercise_id"],
                "sort_order" => i,
                "sets" => sets
            });
        }
        if (outExercises.size() == 0) {
            return null;
        }
        return {
            "client_session_id" => session["client_session_id"],
            "device_id" => deviceId,
            "device_model" => deviceModel,
            "app_version" => appVersion,
            "workout_preset_id" => session["workout_preset_id"],
            "name" => session["name"],
            "entry_date" => session["entry_date"],
            "started_at" => session["started_at"],
            "ended_at" => endedAt,
            "started_at_local" => session["started_at_local"],
            "exercises" => outExercises
        };
    }

    // Copies only the given keys whose value is not null.
    function pick(source as Dictionary, keys as Array) as Dictionary {
        var out = {} as Dictionary;
        for (var i = 0; i < keys.size(); i++) {
            var v = source[keys[i]];
            if (v != null) {
                out[keys[i]] = v;
            }
        }
        return out;
    }

    function pickEach(source as Array or Null, keys as Array) as Array {
        var out = [] as Array;
        if (source != null) {
            for (var i = 0; i < source.size(); i++) {
                out.add(pick(source[i] as Dictionary, keys));
            }
        }
        return out;
    }

    // A manifest workout reduced to the fields the watch reads, so each one
    // fits comfortably into a single Storage value (32 KB at most) and into
    // the active session that is rewritten after every set. Same shape as
    // the manifest, minus category, set type, duration and set numbers.
    function compactWorkout(workout as Dictionary) as Dictionary {
        var exercises = [] as Array;
        var source = workout["exercises"] as Array or Null;
        if (source != null) {
            for (var i = 0; i < source.size(); i++) {
                var ex = source[i] as Dictionary;
                var out = {
                    "exercise_id" => ex["exercise_id"],
                    "name" => ex["name"],
                    "sets" => pickEach(ex["sets"] as Array or Null, ["reps", "weight", "rest_time"])
                } as Dictionary;
                var previous = ex["previous"] as Dictionary or Null;
                if (previous != null) {
                    out["previous"] = {
                        "sets" => pickEach(previous["sets"] as Array or Null, ["reps", "weight"])
                    };
                }
                exercises.add(out);
            }
        }
        var compact = pick(workout, ["workout_preset_id", "name", "scheduled_date"]);
        compact["exercises"] = exercises;
        return compact;
    }

    // Start-menu entry for a compacted workout.
    function workoutSummary(workout as Dictionary) as Dictionary {
        var summary = pick(workout, ["name", "scheduled_date"]);
        summary["exercises"] = (workout["exercises"] as Array).size();
        return summary;
    }

    // Seconds as "m:ss".
    function formatClock(seconds as Number) as String {
        if (seconds < 0) {
            seconds = 0;
        }
        return Lang.format("$1$:$2$", [seconds / 60, pad2(seconds % 60)]);
    }

    // Normalised base URL: trims whitespace and trailing slashes.
    function normalizeBaseUrl(url as String or Null) as String or Null {
        if (url == null) {
            return null;
        }
        var s = url as String;
        while (s.length() > 0 && (s.substring(s.length() - 1, s.length()) as String).equals("/")) {
            s = s.substring(0, s.length() - 1) as String;
        }
        if (s.length() == 0) {
            return null;
        }
        return s;
    }
}
