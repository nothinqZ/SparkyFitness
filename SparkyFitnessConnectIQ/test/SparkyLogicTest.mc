import Toybox.Lang;
import Toybox.Test;
import Toybox.Time;

// Run in the Connect IQ simulator: monkeyc --unit-test, then
// `monkeydo <prg> <device> -t` (see tools/build.sh).

(:test)
function testClassifyUploadResponse(logger as Logger) as Boolean {
    Test.assertEqual(SparkyLogic.classifyUploadResponse(201), SparkyLogic.UPLOAD_DONE);
    // 200 is the server's "duplicate": already stored, drop it from the queue.
    Test.assertEqual(SparkyLogic.classifyUploadResponse(200), SparkyLogic.UPLOAD_DONE);
    Test.assertEqual(SparkyLogic.classifyUploadResponse(409), SparkyLogic.UPLOAD_REJECTED);
    Test.assertEqual(SparkyLogic.classifyUploadResponse(400), SparkyLogic.UPLOAD_REJECTED);
    Test.assertEqual(SparkyLogic.classifyUploadResponse(401), SparkyLogic.UPLOAD_AUTH);
    Test.assertEqual(SparkyLogic.classifyUploadResponse(404), SparkyLogic.UPLOAD_AUTH);
    Test.assertEqual(SparkyLogic.classifyUploadResponse(500), SparkyLogic.UPLOAD_RETRY);
    Test.assertEqual(SparkyLogic.classifyUploadResponse(429), SparkyLogic.UPLOAD_RETRY);
    // Connect IQ transport errors: phone unreachable, timeout.
    Test.assertEqual(SparkyLogic.classifyUploadResponse(-104), SparkyLogic.UPLOAD_RETRY);
    Test.assertEqual(SparkyLogic.classifyUploadResponse(-300), SparkyLogic.UPLOAD_RETRY);
    return true;
}

(:test)
function testUuidFromBytes(logger as Logger) as Boolean {
    var bytes = new [16]b;
    for (var i = 0; i < 16; i++) {
        bytes[i] = 0xff;
    }
    var uuid = SparkyLogic.uuidFromBytes(bytes);
    Test.assertEqual(uuid, "ffffffff-ffff-4fff-bfff-ffffffffffff");
    Test.assertEqual(uuid.length(), 36);
    return true;
}

(:test)
function testIsoUtc(logger as Logger) as Boolean {
    // 2026-10-20T06:00:00Z
    var moment = new Time.Moment(1792476000);
    Test.assertEqual(SparkyLogic.isoUtc(moment), "2026-10-20T06:00:00.000Z");
    return true;
}

(:test)
function testWeightConversion(logger as Logger) as Boolean {
    Test.assertEqual(SparkyLogic.formatWeight(SparkyLogic.toDisplayWeight(100, "kg")), "100");
    Test.assertEqual(SparkyLogic.formatWeight(SparkyLogic.toDisplayWeight(100, "lbs")), "220.5");
    Test.assertEqual(SparkyLogic.formatWeight(SparkyLogic.toKg(225, "lbs")), "102.1");
    Test.assertEqual(SparkyLogic.formatWeight(102.5), "102.5");
    return true;
}

(:test)
function testSuggestWeight(logger as Logger) as Boolean {
    var hit = [{ "reps" => 5, "weight" => 100.0 }, { "reps" => 5, "weight" => 100.0 }];
    var missed = [{ "reps" => 5, "weight" => 100.0 }, { "reps" => 3, "weight" => 100.0 }];
    // All planned reps reached last time: one step heavier.
    Test.assertEqual(SparkyLogic.suggestWeight(5, hit, "kg"), 102.5);
    // Missed reps: repeat the weight.
    Test.assertEqual(SparkyLogic.suggestWeight(5, missed, "kg"), 100.0);
    Test.assertEqual(SparkyLogic.suggestWeight(5, null, "kg"), null);
    Test.assertEqual(SparkyLogic.suggestWeight(5, [{ "reps" => 10, "weight" => null }], "kg"), null);
    return true;
}

(:test)
function testBuildUploadSkipsEmptyExercises(logger as Logger) as Boolean {
    var session = {
        "client_session_id" => "33333333-3333-4333-8333-333333333333",
        "workout_preset_id" => 7,
        "name" => "Push",
        "entry_date" => "2026-10-20",
        "started_at" => "2026-10-20T06:00:00.000Z",
        "started_at_local" => "2026-10-20T08:00:00",
        "exercises" => [
            { "exercise_id" => "a", "logged" => [] },
            { "exercise_id" => "b", "logged" => [
                { "reps" => 5, "weight" => 60.0, "completed_at" => "t1", "rpe" => 8.0 },
                { "reps" => 5, "weight" => 60.0, "completed_at" => "t2" }
            ] }
        ]
    };
    var upload = SparkyLogic.buildUpload(session, "2026-10-20T07:00:00.000Z", "dev", null, "0.1.0") as Dictionary;
    var exercises = upload["exercises"] as Array;
    Test.assertEqual(exercises.size(), 1);
    var ex = exercises[0] as Dictionary;
    Test.assertEqual(ex["exercise_id"], "b");
    var sets = ex["sets"] as Array;
    Test.assertEqual(sets.size(), 2);
    Test.assertEqual((sets[0] as Dictionary)["rpe"], 8.0);
    Test.assert(!(sets[1] as Dictionary).hasKey("rpe"));
    Test.assertEqual((sets[1] as Dictionary)["set_number"], 2);
    Test.assertEqual(upload["ended_at"], "2026-10-20T07:00:00.000Z");

    session["exercises"] = [{ "exercise_id" => "a", "logged" => [] }];
    Test.assertEqual(SparkyLogic.buildUpload(session, "x", "dev", null, "0.1.0"), null);
    return true;
}

(:test)
function testNormalizeBaseUrl(logger as Logger) as Boolean {
    Test.assertEqual(SparkyLogic.normalizeBaseUrl("https://fit.example.ts.net//"), "https://fit.example.ts.net");
    Test.assertEqual(SparkyLogic.normalizeBaseUrl(""), null);
    Test.assertEqual(SparkyLogic.normalizeBaseUrl(null), null);
    return true;
}

(:test)
function testCompactWorkout(logger as Logger) as Boolean {
    var workout = {
        "workout_preset_id" => 17,
        "name" => "Torso A",
        "scheduled_date" => null,
        "exercises" => [{
            "exercise_id" => "67facb5a-6d9d-45ac-8ddf-300325c19c31",
            "name" => "Brustpresse",
            "category" => "Chest",
            "sort_order" => 0,
            "sets" => [{ "set_number" => 1, "set_type" => "warmup", "reps" => 12,
                         "weight" => 75, "duration" => null, "rest_time" => 90 }],
            "previous" => { "entry_date" => "2026-10-11",
                            "sets" => [{ "set_number" => 1, "reps" => 15, "weight" => 50 }] }
        }, {
            "exercise_id" => "10adaa4e-6024-4fc8-a3b4-cbd154521f9e",
            "name" => "Rudern",
            "sets" => [],
            "previous" => null
        }]
    };
    var compact = SparkyLogic.compactWorkout(workout);
    Test.assertEqual(compact["workout_preset_id"], 17);
    Test.assert(!compact.hasKey("scheduled_date"));
    var exercises = compact["exercises"] as Array;
    Test.assertEqual(exercises.size(), 2);
    var first = exercises[0] as Dictionary;
    Test.assert(!first.hasKey("category"));
    var set = (first["sets"] as Array)[0] as Dictionary;
    Test.assertEqual(set.size(), 3);
    Test.assertEqual(set["reps"], 12);
    Test.assertEqual(set["rest_time"], 90);
    var previous = ((first["previous"] as Dictionary)["sets"] as Array)[0] as Dictionary;
    Test.assertEqual(previous.size(), 2);
    Test.assertEqual(previous["weight"], 50);
    Test.assert(!(exercises[1] as Dictionary).hasKey("previous"));

    var summary = SparkyLogic.workoutSummary(compact);
    Test.assertEqual(summary["name"], "Torso A");
    Test.assertEqual(summary["exercises"], 2);
    return true;
}

(:test)
function testLivePlan(logger as Logger) as Boolean {
    var plan = {
        "t" => "plan", "sid" => "s1", "n" => "Torso A", "a" => "12",
        "x" => [
            { "n" => "Bench", "s" => [["11", 12, 75, 90, 1, 10, 77.5], ["12", 8, 100, 120, 0, null, null]] },
            { "n" => "Row", "s" => [["21", 10, 60, 90, 0, null, null]] }
        ]
    };
    var session = SparkyLogic.sessionFromLive(plan, null);
    Test.assertEqual(session["live"], "s1");
    // The exercise holding the phone's active set is shown first.
    Test.assertEqual(session["ex_idx"], 0);
    var bench = (session["exercises"] as Array)[0] as Dictionary;
    Test.assertEqual((bench["logged"] as Array).size(), 1);
    Test.assertEqual(((bench["planned"] as Array)[1] as Dictionary)["id"], "12");

    // A set logged on the watch but not yet confirmed stays done in a newer plan.
    Test.assert(SparkyLogic.markLiveSetDone(plan, "21", 10, 62.5));
    Test.assert(!SparkyLogic.markLiveSetDone(plan, "99", 1, 1));
    var fresh = {
        "sid" => "s1", "n" => "Torso A", "a" => null,
        "x" => [{ "n" => "Row", "s" => [["21", 10, 60, 90, 0, null, null]] }]
    };
    SparkyLogic.mergePendingSets(fresh, { "21" => [10, 62.5] });
    var row = ((fresh["x"] as Array)[0] as Dictionary)["s"] as Array;
    Test.assertEqual((row[0] as Array)[4], 1);
    Test.assertEqual((row[0] as Array)[6], 62.5);
    // Kept exercise index survives a refresh.
    Test.assertEqual(SparkyLogic.sessionFromLive(plan, 1)["ex_idx"], 1);
    return true;
}
