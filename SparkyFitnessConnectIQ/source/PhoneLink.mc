import Toybox.Lang;
import Toybox.Communications;
import Toybox.Graphics;
import Toybox.System;
import Toybox.Time;
import Toybox.Timer;
import Toybox.WatchUi;

// Bluetooth link to the SparkyFitness iPhone app (Connect IQ Mobile SDK on
// the phone, modules/garmin-connectiq). Needs no internet: messages go
// watch <-> phone directly, so a workout runs in step on both in a gym
// without mobile data.
//
// Phone -> watch: "plan" (the live workout with targets and done sets),
// "end" (finished or discarded on the phone), "none" (no live workout).
// Watch -> phone: "hello" (send me the plan), "set", "start", "finish".
// Message format: SparkyFitnessMobile/src/utils/garminWatchPlan.ts.
//
// Outgoing messages wait in Store's outbox until the phone acknowledges
// them, so a set logged while the phone is out of reach is sent later.
class PhoneLink {

    const RETRY_MS = 15000;

    private var _sending as Boolean = false;
    private var _timer as Timer.Timer or Null = null;
    // Until when (epoch s) the watch waits for the phone to start a workout
    // it asked for (StartWaitView).
    var awaitingStartUntil as Number or Null = null;
    // True while a live WorkoutView is on screen, so "end" can leave it.
    var liveViewOpen as Boolean = false;

    function initialize() {
    }

    function start() as Void {
        if (!(Communications has :registerForPhoneAppMessages)) {
            return;
        }
        Communications.registerForPhoneAppMessages(method(:onMessage));
        sendNow({ "t" => "hello" });
        flush();
        var timer = new Timer.Timer();
        timer.start(method(:onTick), RETRY_MS, true);
        _timer = timer;
    }

    function stop() as Void {
        var timer = _timer;
        if (timer != null) {
            timer.stop();
            _timer = null;
        }
    }

    static function phoneConnected() as Boolean {
        return System.getDeviceSettings().phoneConnected;
    }

    function onTick() as Void {
        flush();
    }

    function onMessage(message as Communications.PhoneAppMessage) as Void {
        var data = message.data;
        if (!(data instanceof Dictionary)) {
            return;
        }
        var type = data["t"];
        if ("plan".equals(type)) {
            var plan = SparkyLogic.mergePendingSets(data as Dictionary, Store.pendingLiveSets());
            Store.setLive(plan);
            if (awaitingStartUntil != null) {
                awaitingStartUntil = null;
                openLiveWorkout(true);
            }
        } else if ("end".equals(type) || "none".equals(type)) {
            var hadLive = Store.live() != null;
            Store.clearLive();
            if (hadLive) {
                onLiveEnded();
            }
        }
        MainMenu.refreshIfVisible();
        WatchUi.requestUpdate();
        // The phone is reachable now; send anything still waiting.
        flush();
    }

    // Queues a message for the phone and tries to send it.
    function enqueue(message as Dictionary) as Boolean {
        var ok = Store.enqueueOutbox(message);
        flush();
        return ok;
    }

    function flush() as Void {
        if (_sending) {
            return;
        }
        var box = Store.outbox();
        if (box.size() == 0) {
            return;
        }
        _sending = true;
        Communications.transmit(box[0], null, new PhoneLinkListener(self, true));
    }

    function onSent(fromOutbox as Boolean, ok as Boolean) as Void {
        if (!fromOutbox) {
            return;
        }
        _sending = false;
        if (ok) {
            Store.dequeueOutbox();
            flush();
        }
    }

    // Fire-and-forget, for "hello": nothing is lost if it does not arrive.
    private function sendNow(message as Dictionary) as Void {
        Communications.transmit(message, null, new PhoneLinkListener(self, false));
    }

    // Shows the phone's live workout; `replace` swaps the view on screen.
    function openLiveWorkout(replace as Boolean) as Void {
        var session = WorkoutSession.live();
        if (session == null) {
            return;
        }
        var app = getApp();
        app.recorder.start(session.data["name"] as String);
        MainMenu.visible = false;
        if (replace) {
            WatchUi.switchToView(new WorkoutView(session), new WorkoutDelegate(session), WatchUi.SLIDE_LEFT);
        } else {
            WatchUi.pushView(new WorkoutView(session), new WorkoutDelegate(session), WatchUi.SLIDE_LEFT);
        }
    }

    // The phone finished or discarded the workout: keep the recording and go
    // back to the start menu.
    private function onLiveEnded() as Void {
        var app = getApp();
        if (app.recorder.isRecording()) {
            app.recorder.save();
        }
        if (liveViewOpen) {
            liveViewOpen = false;
            var built = MainMenu.build();
            WatchUi.switchToView(built[0], built[1], WatchUi.SLIDE_RIGHT);
        }
    }
}

class PhoneLinkListener extends Communications.ConnectionListener {

    private var _link as PhoneLink;
    private var _fromOutbox as Boolean;

    function initialize(link as PhoneLink, fromOutbox as Boolean) {
        ConnectionListener.initialize();
        _link = link;
        _fromOutbox = fromOutbox;
    }

    function onComplete() as Void {
        _link.onSent(_fromOutbox, true);
    }

    function onError() as Void {
        _link.onSent(_fromOutbox, false);
    }
}

// Shown after asking the phone to start a workout. Opens the phone's live
// workout as soon as its plan arrives; after PhoneLink's wait runs out (phone
// app not running), starts the workout on the watch alone instead.
class StartWaitView extends WatchUi.View {

    private var _workout as Dictionary;
    private var _timer as Timer.Timer or Null = null;

    function initialize(workout as Dictionary) {
        View.initialize();
        _workout = workout;
    }

    function onShow() as Void {
        var timer = new Timer.Timer();
        timer.start(method(:onTick), 1000, true);
        _timer = timer;
    }

    function onHide() as Void {
        var timer = _timer;
        if (timer != null) {
            timer.stop();
            _timer = null;
        }
    }

    function onTick() as Void {
        var link = getApp().phone;
        var until = link.awaitingStartUntil;
        if (until == null) {
            return;
        }
        if (Time.now().value() > until) {
            link.awaitingStartUntil = null;
            var session = WorkoutSession.start(_workout);
            getApp().recorder.start(_workout["name"] as String);
            WatchUi.switchToView(new WorkoutView(session), new WorkoutDelegate(session), WatchUi.SLIDE_LEFT);
        }
    }

    function onUpdate(dc as Graphics.Dc) as Void {
        dc.setColor(Graphics.COLOR_BLACK, Graphics.COLOR_BLACK);
        dc.clear();
        dc.setColor(Graphics.COLOR_WHITE, Graphics.COLOR_TRANSPARENT);
        dc.drawText(dc.getWidth() / 2, dc.getHeight() / 2, Graphics.FONT_SMALL,
            WatchUi.loadResource(Rez.Strings.StartingOnPhone) as String,
            Graphics.TEXT_JUSTIFY_CENTER | Graphics.TEXT_JUSTIFY_VCENTER);
    }
}

class StartWaitDelegate extends WatchUi.BehaviorDelegate {

    function initialize() {
        BehaviorDelegate.initialize();
    }

    function onBack() as Boolean {
        getApp().phone.awaitingStartUntil = null;
        var built = MainMenu.build();
        WatchUi.switchToView(built[0], built[1], WatchUi.SLIDE_RIGHT);
        return true;
    }
}
