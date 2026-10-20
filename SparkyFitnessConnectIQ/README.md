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

| Screen | Control | Action |
| --- | --- | --- |
| Start menu | select | Start the workout / resume the active one / sync now |
| Exercise | SELECT / tap | Log the next set |
| Exercise | UP / DOWN / swipe | Previous / next exercise |
| Exercise | MENU (hold UP) | Jump to an exercise, undo the last set |
| Exercise | BACK | Continue / finish and save / discard |
| Set editor | UP / DOWN | Change reps, then weight, then RPE ("-" = none) |
| Set editor | SELECT | Next field; on RPE: log the set and start the rest timer |
| Rest timer | any key | Back to the exercise |

The exercise screen shows the planned set, last time's set ("Last") and a
progressive-overload hint ("Try"): one weight step (2.5 kg / 5 lb) heavier
when every set last time reached the planned reps, otherwise the same weight.
It is a hint only; the editor starts from the plan.

## Pairing (device credentials)

The watch pairs itself; no key has to be typed:

1. Build the app with your server URL (`SPARKY_SERVER_URL=https://… tools/build.sh …`).
   The URL is not secret but personal, so it is injected into the build, not
   committed.
2. On the watch: **Sparky Strength → Pair watch**. It shows a code like
   `K7QM-2XPA` (valid 10 minutes).
3. In SparkyFitness (web): **Settings → Garmin watch**, enter the code,
   **Pair**.
4. The server creates an API key named "Garmin watch <model>" for your account.
   The watch collects it once (the server keeps it encrypted until then) and
   stores it on the watch.

To unpair, delete that key under **Settings → API Key Management**. The watch
gets 401, forgets the key, offers "Pair watch" again and keeps its queued
sessions until it is paired again.

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

## Status

- Compiles and type-checks with Connect IQ SDK 9.2.0 (`sparkygeneric`).
- Unit tests (`test/SparkyLogicTest.mc`) compile; they run only in the
  Garmin simulator with a real device definition — **not run yet**.
- The upload format is pinned by a server-side contract test
  (`SparkyFitnessServer/tests/watchSyncContract.test.ts`, fixture in
  `test/fixtures/upload.json`).
- **Not verified on real hardware**: layout on your watch's screen, memory
  with a large manifest, ActivityRecording on your firmware, phone-proxied
  HTTPS to your server.
