# Sparky Strength — Garmin Connect IQ app

A watch app for logging strength workouts on a Garmin watch, with
SparkyFitness as the source of truth:

1. Workouts are built in SparkyFitness (workout presets, optionally scheduled
   by a workout plan).
2. The watch downloads them (`GET /api/v2/watch/manifest`), including the last
   logged sets of every exercise.
3. You log sets on the watch: reps, weight, optional RPE, with a rest timer
   that vibrates when the rest is over. Everything is stored on the watch
   after every set, so logging works offline and survives the app closing.
4. When you finish, the session is queued and uploaded through the phone
   (`POST /api/v2/watch/sessions`). Uploads are idempotent: every session
   carries a UUID generated on the watch, so a retry never creates a second
   workout.
5. Optionally the app also records a Garmin activity (heart rate, calories,
   one lap per set). When the Garmin integration later imports that activity,
   SparkyFitness links it to the uploaded workout instead of counting it twice.

## What Garmin Connect shows

The recorded activity appears in Garmin Connect as a strength activity with
heart rate and laps. **It does not contain Garmin-native exercise sets.**
Connect IQ apps cannot write the FIT messages Garmin's own strength app uses
for sets, so exercises, reps and weights exist only in SparkyFitness. You can
turn recording off in the app settings.

## Controls

Modelled on Garmin's own strength activity (data pages, deliberate set confirmation)
and Hevy (last values, set types, ±15 s rest).

| Screen | Control | Action |
| --- | --- | --- |
| Start menu | select | Start the workout / open the phone's live workout / resume / sync now |
| Workout | UP / DOWN / swipe up-down | Pages: Set · Data (time, heart rate in zone colour, time since rest, calories, sets, volume) · Exercises |
| Workout | swipe left / right | Next / previous exercise |
| Workout, Set or Data page | SELECT / tap | Review the next set; no set is logged yet |
| Workout, Exercises page | SELECT | Pick an exercise |
| Workout | MENU (hold UP) | Jump to an exercise, undo the last set |
| Workout | BACK | Continue / finish and save (shows a summary) / discard |
| Log set | Physical START | Confirm and log the shown values; touching the display only selects a field |
| Log set | UP / DOWN | Edit: reps, then weight (exercise's own step), then RPE ("-" = none) |
| Rest | UP / DOWN | +15 s / -15 s |
| Rest | Physical START / BACK | End the rest; touching the display does nothing |
| Rest | MENU (hold UP) | Correct the last logged set without ending the rest |

The set page shows the set kind (warm-ups and drop sets counted and coloured
apart), the target, last time and an overload hint, a ring with one segment
per set, and heart rate and workout time. In a superset the watch moves to
the next exercise of the group after each set; otherwise to the next
exercise once one is done. A drop set follows without a rest. The rest
buzzes 10 s before the end and alerts at zero.

## Pairing (device credentials)

The watch pairs itself; no key has to be typed:

1. Build the app with your server URL (`SPARKY_SERVER_URL=https://… tools/build.sh …`).
   The URL is not secret but personal, so it is injected into the build, not
   committed.
2. On the watch: **Sparky Strength → Pair watch**. It shows a code like
   `K7QM-2XPA` (valid 10 minutes).
3. In the SparkyFitness iPhone app: **Settings → Garmin watch**, enter the
   code, **Pair**. The web app has the same under **Settings → Developer &
   Integrations → Garmin watch**.
4. The server creates an API key named "Garmin watch <model>" for your account
   and records it as this watch's key (`watch_devices`). The watch collects it
   once (the server keeps it encrypted until then) and stores it on the watch.
   Pairing the same watch again revokes its previous key.

To unpair, use **Unpair** next to the watch on the same screen (or delete the
key under **Settings → API Key Management**). The watch gets 401, forgets the
key, offers "Pair watch" again and keeps its queued sessions until it is
paired again.

Store-installed builds can alternatively take a key in the app settings
(Garmin Connect app → Device → Activities & Apps → Sparky Strength →
Settings); a paired key takes precedence.

Keys are rate limited per key by the server. A read-only key can download
workouts but cannot upload them. The unauthenticated pairing endpoints are
rate limited per IP, codes come from a 32-character alphabet without
look-alike characters (40 bits), and confirming a code needs a signed-in
account (rate limited per user).

### Network requirements

Connect IQ web requests go through the Garmin Connect app on the phone. The
server must therefore be reachable from the phone, over **HTTPS with a
certificate the phone trusts** (plain HTTP and self-signed certificates are
refused by the phone). Tailscale works if the phone runs Tailscale: use the
MagicDNS name with a certificate from `tailscale cert` or `tailscale serve`.

## Live sync with the iPhone app (Bluetooth, no internet)

A workout runs in step on watch and phone, like the Apple Watch integration,
over Bluetooth through the Connect IQ Mobile SDK (`source/PhoneLink.mc` here,
`SparkyFitnessMobile/modules/garmin-connectiq` and
`src/hooks/useGarminWatchBridge.ts` on the phone). No internet is needed in
the gym; the phone only has to be in Bluetooth range.

- Started on the phone: opening Sparky Strength shows it at the top of the
  start menu ("Running on the phone"), with the phone's resolved targets.
- Started on the watch with the phone connected: the watch asks the phone to
  start it and waits up to 15 s for its plan, then shows it; otherwise it
  starts on the watch alone (uploaded later, as before).
- A set logged on the watch goes to the phone's live workout (rest timer, PR
  detection, saving); sets logged on the phone show as done on the watch.
- Finish on the watch finishes on the phone; finishing or discarding on the
  phone ends it on the watch. Undo and adding sets stay on the phone.
- Messages wait in an outbox on the watch until the phone acknowledges them.

One-time setup on the phone: Settings → Garmin watch → Live sync → Connect
with Garmin Connect (picks the watch in Garmin Connect). Message format:
`SparkyFitnessMobile/src/utils/garminWatchPlan.ts`.

## Storage on the watch

A single `Application.Storage` value may hold at most 32 KB. Version 0.1.0
stored the whole manifest as one value; a real 45 KB manifest made
`Storage.setValue` throw and the app crashed (IQ! icon) on every start after
pairing. Since 0.1.1 nothing that grows is stored as one value:

- each workout is compacted (`SparkyLogic.compactWorkout`: only reps, weight
  and rest per set) and stored under its own key, with a small index for the
  start menu;
- queued and failed uploads are stored one per key, listed by id;
- every write goes through `Store.trySet`, which reports failure instead of
  ending the app. A finished workout is removed from the watch only once it is
  in the queue.

`Store.migrate()` moves a 0.1.0 queue into the new layout on start.

## Sync behaviour

| Server answer | Watch behaviour |
| --- | --- |
| 201 created / 200 duplicate | Removed from the queue |
| 400 / 409 / 413 / 422 | Moved to a "failed" list (last 5 kept), queue continues |
| 401 | Paired key dropped, "Pair watch" offered again; queue kept |
| 403 / 404 | Queue kept, sync stops: fix URL or key |
| 429 / 5xx / phone offline / timeout | Queue kept, retried on next sync |

Sync runs on app start, after finishing a workout, after changing settings and
from "Sync now".

## Building

Requirements: Docker. Everything else runs in containers.

```bash
# 1. Connect IQ SDK (public download, no login):
curl -LO https://developer.garmin.com/downloads/connect-iq/sdks/connectiq-sdk-lin-9.2.0-2026-06-09-92a1605b2.zip
unzip connectiq-sdk-lin-9.2.0-*.zip -d ~/connectiq-sdk

# 2. A developer key (once; keep it, Garmin ties app updates to it):
openssl genrsa -out developer_key.pem 4096
openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem \
  -out developer_key.der -nocrypt

export CIQ_SDK=~/connectiq-sdk CIQ_HOME=$HOME CIQ_KEY=$PWD/developer_key.der
```

**Compile check without a Garmin account** (what CI and the initial
development used):

```bash
tools/make-check-device.sh            # creates the "sparkygeneric" definition
tools/build.sh sparkygeneric          # app
tools/build.sh sparkygeneric --test   # app with unit tests
```

`sparkygeneric` is not a real watch. It proves the code compiles and
type-checks against the SDK API, nothing about layout or memory on a device.

**Build for your watch** (needs a free Garmin developer account):

```bash
# Install the device definitions with Garmin's SDK Manager (GUI):
#   https://developer.garmin.com/connect-iq/sdk/  → SDK Manager → Devices
tools/build.sh fenix7                 # .prg for side-loading to that watch
tools/build.sh fenix7 --test          # unit tests, run in the simulator:
#   $CIQ_SDK/bin/connectiq &  then  $CIQ_SDK/bin/monkeydo bin/SparkyStrength-fenix7-test.prg fenix7 -t
tools/build.sh all --package --release  # .iq package for every manifest product
```

If your watch is not in `manifest.xml`, add its product id there.

### Installing on the watch

Side-load the `.prg`: connect the watch by USB (MTP; on Linux e.g.
`jmtpfs` or `gio mount`), copy the file to `GARMIN/APPS/`, disconnect. The app
appears under Activities & Apps. Side-loaded apps cannot be configured from
the Garmin Connect app, which is why the server URL is set at build time and
the key comes from pairing.

### Installing without USB: Connect IQ Store beta

A beta app in the Connect IQ Store is visible only to the Garmin account that
uploaded it, needs no store review, and installs and updates through the
Garmin Connect app like any store app (settings can then also be edited there).

```bash
SPARKY_SERVER_URL=https://… tools/build.sh all --package --release
# -> bin/SparkyStrength.iq
```

The app is built for the Forerunner 265 only (`manifest.xml`); `PRODUCTS`
can still limit a package to installed device definitions. Upload the `.iq` at
https://apps.garmin.com/developer as a **beta app**, signed in with the same
Garmin account the watch uses, then install it from the Connect IQ section
of the Garmin Connect app. Keep the developer key: every update must be signed
with the same key.

New versions can be published without a browser at hand:
`tools/publish-beta.sh <version>` builds the package and uploads it from the
Windows PC that holds a signed-in Edge profile (`tools/ciq-upload`: sign in
once with the `.bat`, which opens a plain, non-automated Edge because
Garmin's sign-in rejects automated browsers; `upload.py` then fills the
"Upload New Version" form headlessly). "Upload and publish" publishes the
version; the store listing is left as it is. Garmin offers no upload API, so
if Garmin changes the form, `upload.py` needs adjusting.

The watch reports its product name ("Forerunner 265") from
`resources-fr265/strings`; a new product needs its own folder there.

## Status

- Compiles and type-checks with Connect IQ SDK 9.2.0 (`sparkygeneric`).
- Unit tests (`test/SparkyLogicTest.mc`) compile; they run only in the
  Garmin simulator with a real device definition — **not run yet**.
- The upload format is pinned by a server-side contract test
  (`SparkyFitnessServer/tests/watchSyncContract.test.ts`, fixture in
  `test/fixtures/upload.json`).
- Pairing and manifest download verified on a Forerunner 265 with 0.1.0,
  which then crashed storing a 45 KB manifest (fixed in 0.1.1, see *Storage on
  the watch*).
- Phone-proxied HTTPS to the server works (pairing over Garmin Connect).
- **Not verified on real hardware**: layout on your watch's screen, logging a
  workout and its upload, ActivityRecording on your firmware.
