import Toybox.Lang;
import Toybox.ActivityRecording;
import Toybox.Sensor;

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

    function initialize() {
    }

    function start(name as String) as Void {
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

    function save() as Void {
        var session = _session;
        if (session != null) {
            if (session.isRecording()) {
                session.stop();
            }
            session.save();
            _session = null;
        }
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
    }
}
