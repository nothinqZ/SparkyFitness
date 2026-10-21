import Toybox.Lang;
import Toybox.ActivityRecording;
import Toybox.Sensor;
import Toybox.Activity;
import Toybox.Time;

// Optional Garmin activity recording (setting "Record Garmin activity"). The
// recording gives Garmin Connect heart rate, calories and training load for
// the session. Garmin Connect will show it as a generic strength activity: a
// Connect IQ app cannot write native Garmin exercise sets, so the set details
// live in SparkyFitness only. No laps are written: Garmin announces every lap
// (on the watch or through Garmin Connect on the phone), which after each set
// was more noise than the per-set split was worth.
//
// SparkyFitness links the recorded activity back to the uploaded workout by
// start time during the Garmin import, so it is not counted twice.
class Recorder {

    private var _session as ActivityRecording.Session or Null = null;
    // When the workout started on the watch, for the elapsed time when no
    // activity is being recorded (setting off, or not supported).
    private var _startedAt as Number or Null = null;

    function initialize() {
    }

    function start(name as String) as Void {
        if (_startedAt == null) {
            _startedAt = Time.now().value();
        }
        if (!Store.recordActivity() || _session != null) {
            return;
        }
        if (!(Toybox has :ActivityRecording)) {
            return;
        }
        Sensor.setEnabledSensors([Sensor.SENSOR_HEARTRATE]);
        var label = name.length() > 15 ? name.substring(0, 15) as String : name;
        // The ActivityRecording sport constants are deprecated in favour of
        // Toybox.Activity ones on newer firmware, but they are the ones every
        // device back to API 3.2 understands.
        var session = ActivityRecording.createSession({
            :name => label,
            :sport => ActivityRecording.SPORT_TRAINING,
            :subSport => ActivityRecording.SUB_SPORT_STRENGTH_TRAINING
        });
        session.start();
        _session = session;
    }

    function isRecording() as Boolean {
        var session = _session;
        return session != null && session.isRecording();
    }

    // Workout time in seconds: Garmin's own activity timer while recording,
    // else the time since the workout was opened on the watch.
    function elapsedSeconds() as Number {
        if (isRecording()) {
            var info = Activity.getActivityInfo();
            if (info != null && info.timerTime != null) {
                return (info.timerTime as Number) / 1000;
            }
        }
        var started = _startedAt;
        return started == null ? 0 : Time.now().value() - started;
    }

    // Garmin's calorie and average heart-rate figures for the recording, or
    // null without one. These are the values Garmin Connect will show.
    function calories() as Number or Null {
        var info = isRecording() ? Activity.getActivityInfo() : null;
        return info == null ? null : info.calories;
    }

    function averageHeartRate() as Number or Null {
        var info = isRecording() ? Activity.getActivityInfo() : null;
        return info == null ? null : info.averageHeartRate;
    }

    function save() as Void {
        var session = _session;
        if (session != null) {
            if (session.isRecording()) {
                session.stop();
            }
            session.save();
            _session = null;
        }
        _startedAt = null;
    }

    function discard() as Void {
        var session = _session;
        if (session != null) {
            if (session.isRecording()) {
                session.stop();
            }
            session.discard();
            _session = null;
        }
        _startedAt = null;
    }
}
