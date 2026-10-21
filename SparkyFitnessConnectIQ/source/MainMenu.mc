import Toybox.Lang;
import Toybox.WatchUi;
import Toybox.Time;
import Toybox.Time.Gregorian;

// Start screen: resume the active workout, pick a workout from the synced
// manifest, or sync now. The sync item's sub-label shows queue and sync state.
module MainMenu {

    var visible as Boolean = false;

    function syncStatus() as String {
        if (!Store.isConfigured()) {
            return WatchUi.loadResource(Rez.Strings.NotConfigured) as String;
        }
        var parts = "";
        var queued = Store.queueSize();
        if (queued > 0) {
            parts = (WatchUi.loadResource(Rez.Strings.Queue) as String) + ": " + queued + " · ";
        }
        var error = Store.lastError();
        if (error != null) {
            return parts + error;
        }
        var last = Store.lastSync();
        var when = WatchUi.loadResource(Rez.Strings.Never) as String;
        if (last != null) {
            var info = Gregorian.info(new Time.Moment(last), Time.FORMAT_SHORT);
            when = Lang.format("$1$:$2$", [info.hour, SparkyLogic.pad2(info.min as Number)]);
        }
        return parts + (WatchUi.loadResource(Rez.Strings.Synced) as String) + " " + when;
    }

    function build() as [WatchUi.Views, WatchUi.InputDelegates] {
        var menu = new WatchUi.Menu2({ :title => WatchUi.loadResource(Rez.Strings.AppName) as String });
        var active = Store.activeSession();
        var live = Store.live();
        if (live != null) {
            menu.addItem(new WatchUi.MenuItem(live["n"] as String,
                WatchUi.loadResource(Rez.Strings.LiveOnPhone) as String, :live, null));
        }
        if (Store.hasServerUrl() && Store.apiKey() == null) {
            menu.addItem(new WatchUi.MenuItem(
                WatchUi.loadResource(Rez.Strings.PairWatch) as String,
                Store.serverUrl(), :pair, null));
        }
        if (active != null) {
            menu.addItem(new WatchUi.MenuItem(
                WatchUi.loadResource(Rez.Strings.Resume) as String,
                active["name"] as String, :resume, null));
        } else {
            var workouts = Store.workouts();
            for (var i = 0; i < workouts.size(); i++) {
                var w = workouts[i] as Dictionary;
                var sub = (w["exercises"] as Number) + " " + (WatchUi.loadResource(Rez.Strings.Exercises) as String);
                if (w["scheduled_date"] != null) {
                    sub = (w["scheduled_date"] as String).substring(5, 10) + " · " + sub;
                }
                menu.addItem(new WatchUi.MenuItem(w["name"] as String, sub, i, null));
            }
            if (workouts.size() == 0) {
                menu.addItem(new WatchUi.MenuItem(
                    WatchUi.loadResource(Rez.Strings.NoWorkouts) as String, null, :none, null));
            }
        }
        menu.addItem(new WatchUi.MenuItem(
            WatchUi.loadResource(Rez.Strings.SyncNow) as String, syncStatus(), :sync, null));
        return [menu, new MainMenuDelegate()];
    }

    function refreshIfVisible() as Void {
        if (visible) {
            var built = build();
            WatchUi.switchToView(built[0], built[1], WatchUi.SLIDE_IMMEDIATE);
        }
    }
}

class MainMenuDelegate extends WatchUi.Menu2InputDelegate {

    function initialize() {
        Menu2InputDelegate.initialize();
        MainMenu.visible = true;
    }

    function onSelect(item as WatchUi.MenuItem) as Void {
        var id = item.getId();
        if (id == :sync) {
            getApp().sync.sync(method(:onSynced));
            return;
        }
        if (id == :none) {
            return;
        }
        if (id == :live) {
            getApp().phone.openLiveWorkout(false);
            return;
        }
        if (id == :pair) {
            MainMenu.visible = false;
            WatchUi.pushView(new PairingView(), new PairingDelegate(), WatchUi.SLIDE_LEFT);
            return;
        }
        var session;
        if (id == :resume) {
            var active = Store.activeSession();
            if (active == null) {
                return;
            }
            session = new WorkoutSession(active);
        } else {
            var workout = Store.workout(id as Number);
            if (workout == null) {
                return;
            }
            // With the phone in reach, start it there so both run the same
            // workout; StartWaitView falls back to the watch alone.
            if (PhoneLink.phoneConnected() && Store.live() == null
                    && workout["workout_preset_id"] != null) {
                var link = getApp().phone;
                link.enqueue({ "t" => "start", "p" => workout["workout_preset_id"],
                    "at" => Time.now().value(), "c" => Store.newUuid() });
                link.awaitingStartUntil = Time.now().value() + 15;
                MainMenu.visible = false;
                WatchUi.pushView(new StartWaitView(workout), new StartWaitDelegate(), WatchUi.SLIDE_LEFT);
                return;
            }
            session = WorkoutSession.start(workout);
            getApp().recorder.start(workout["name"] as String);
        }
        MainMenu.visible = false;
        WatchUi.pushView(new WorkoutView(session), new WorkoutDelegate(session), WatchUi.SLIDE_LEFT);
    }

    function onSynced(ok as Boolean) as Void {
        MainMenu.refreshIfVisible();
    }

    function onBack() as Void {
        MainMenu.visible = false;
        WatchUi.popView(WatchUi.SLIDE_RIGHT);
    }
}
