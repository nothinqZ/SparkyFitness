import Toybox.Lang;
import Toybox.Application;
import Toybox.WatchUi;

class SparkyApp extends Application.AppBase {

    var sync as SyncClient;
    var recorder as Recorder;
    var phone as PhoneLink;

    function initialize() {
        AppBase.initialize();
        sync = new SyncClient();
        recorder = new Recorder();
        phone = new PhoneLink();
    }

    function onStart(state as Dictionary or Null) as Void {
        Store.migrate();
        phone.start();
        // Upload anything left from earlier workouts and refresh the plan.
        sync.sync(method(:onBackgroundSync));
    }

    function onStop(state as Dictionary or Null) as Void {
        phone.stop();
        // The active session is already persisted set by set. Keep a running
        // recording only if a workout is still active; it resumes nothing
        // after exit, so save it rather than lose the heart-rate data.
        if (recorder.isRecording()) {
            recorder.save();
        }
    }

    function onBackgroundSync(ok as Boolean) as Void {
        MainMenu.refreshIfVisible();
    }

    function onSettingsChanged() as Void {
        sync.sync(method(:onBackgroundSync));
    }

    function getInitialView() as [WatchUi.Views] or [WatchUi.Views, WatchUi.InputDelegates] {
        return MainMenu.build();
    }
}

function getApp() as SparkyApp {
    return Application.getApp() as SparkyApp;
}
