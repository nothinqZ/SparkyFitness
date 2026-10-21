# SparkyFitness Personal Edition

A thin fork of SparkyFitness v1.8.0 (branch `personal`) that adds a Garmin
watch app for strength training, a performance dashboard, a SideStore build of
the iPhone app and a self-hosted iOS release server. Upstream code is changed
only where these features hook in, so upstream releases can be merged with
few conflicts.

## What this fork adds

| Area | Where | Status |
| --- | --- | --- |
| Watch sync API (manifest, idempotent session upload, sync status) | `SparkyFitnessServer/routes/v2/watchSyncRoutes.ts`, `services/watchSyncService.ts`, migration `20261020100000_*` | Unit + e2e tested against PostgreSQL |
| Watch pairing by code (API key minted on confirm, collected once) | `routes/v2/watchPairingRoutes.ts`, `services/watchPairingService.ts`, migration `20261020110000_*` | Unit + e2e tested |
| Garmin dedup: a watch-logged workout recorded by Garmin is linked, not imported twice | `services/watch/garminWatchLink.ts`, hook in `services/garmin/garminActivityProcessor.ts` | Unit + e2e tested (incl. re-sync) |
| Performance analytics API | `routes/v2/performanceRoutes.ts`, `shared/src/analytics/performance.ts` | Unit (hand-calculated) + e2e tested |
| Paired watches: list and unpair, re-pairing revokes the old key | `routes/v2/watchPairingRoutes.ts` (`/devices`), `models/watchDeviceRepository.ts`, migration `20261021100000_*` | Unit tested |
| Web: Settings > Garmin watch (pair, status, unpair) | `SparkyFitnessFrontend/src/pages/Settings/GarminWatchSettings.tsx` | Unit tested |
| Mobile: Settings > Garmin watch (pair, paired watches, unpair, status) | `SparkyFitnessMobile/src/screens/GarminWatchSettingsScreen.tsx` | Unit tested |
| Live workout sync phone <-> Garmin watch over Bluetooth (Connect IQ Mobile SDK, no internet) | `SparkyFitnessMobile/modules/garmin-connectiq`, `src/hooks/useGarminWatchBridge.ts`, `SparkyFitnessConnectIQ/source/PhoneLink.mc` | JS unit tested; native module built in CI only, **not yet run on a device** |
| Web: `/performance` desktop dashboard | `SparkyFitnessFrontend/src/pages/Performance/` | Unit tested, rendered at 2560 px light/dark |
| Mobile: Library > Performance | `SparkyFitnessMobile/src/screens/PerformanceScreen.tsx` | Unit tested |
| Mobile: `sideload` variant (single App ID, free-Apple-ID entitlements, custom bundle id) | `SparkyFitnessMobile/app.sideload.js`, `plugins/withSideloadEntitlements.ts` | Config tests + Linux `expo prebuild` verified |
| iOS CI: unsigned (ad-hoc signed) IPA, structure check, GitHub release | `.github/workflows/ios-sideload.yml`, `scripts/ios/validate_ipa.py` | actionlint clean, validator tested; **workflow not run yet** |
| iOS release server + AltSource | `deploy/ios-release-server/` | Tested in Docker (publish, serve, rollback) |
| Garmin Connect IQ app "Sparky Strength" | `SparkyFitnessConnectIQ/` | Compiles with SDK 9.2.0 (compile-check device); **not run on a watch or in the simulator** |

Already in upstream and reused, not rebuilt: workout logger (sets, reps,
weight, RPE/RIR, rest timers, previous values, progression, templates and
plans), training calendar, exercise statistics and PRs, sleep/HRV/stress/body
battery reports, Garmin import of activities, steps, heart rate, resting HR,
HRV, sleep, stress, body battery, VO2max, weight/body composition, training
status/readiness/load and race predictions, with chunked incremental sync.

## Data integrity

- **Watch uploads** carry a UUID generated on the watch (`client_session_id`).
  The server claims it with `INSERT … ON CONFLICT DO NOTHING` before creating
  the workout: retries return the original workout (200 `duplicate`),
  concurrent retries create exactly one, the same id with different content is
  refused (409). The watch also refuses to queue a session twice.
- **Garmin import**: Garmin does not return the watch's session id, so a
  strength-type Garmin activity starting within 10 minutes of an uploaded
  session is linked to it (activity id stored, Garmin summary attached to the
  workout) and not imported. A session linked to an activity stays linked on
  every re-sync; one activity can link one session.
- **Provenance**: watch workouts have source `sparky watch`; analytics label
  every value as measured, device-computed or estimated.

## Security

- Watch credentials are ordinary Better Auth API keys (per-key rate limit,
  revocable in Settings > API Key Management, read-only keys cannot upload).
- Only `/api/v2/watch/pairing/start` and `/poll` are reachable without
  credentials; both are rate limited per IP, store only a hash of the poll
  token and expire after 10 minutes. Confirming a code needs a signed-in user
  and is rate limited per user. The key waits AES-GCM encrypted
  (`SPARKY_FITNESS_API_ENCRYPTION_KEY`) until collected once.
- New tables have row-level security (`watch_session_imports` owner-only;
  `watch_pairing_requests` system-only).
- The release server has no upload endpoint; it pulls from GitHub and
  verifies SHA-256. No secrets are in the repository or the IPA.

## Deploy (your homelab)

Nothing in this repository touches your running stack. To switch to it:

1. **Build the images** from this fork:

   ```bash
   cd /repos/sparkyfitness-personal
   docker build --build-arg PNPM_PACKAGE_IMPORT_METHOD=hardlink \
     -f docker/Dockerfile.backend  -t sparkyfitness-server:personal .
   docker build --build-arg PNPM_PACKAGE_IMPORT_METHOD=hardlink \
     -f docker/Dockerfile.frontend -t sparkyfitness-frontend:personal .
   ```

   The build argument works around `ERR_PNPM_EAGAIN` while pnpm copies from
   its store, which happens on the homelab's overlayfs/containerd Docker; the
   images were built and smoke-tested there this way.

2. **Back up the database** first (migrations add three tables):

   ```bash
   docker exec sparkyfitness-db pg_dump -U "$POSTGRES_USER" -Fc sparkyfitness_db > sparky-before-personal.dump
   ```

3. **Point the compose file at the new images.** In
   `/repos/homeserver/apps/sparkyfitness/docker-compose.yml` set
   `APPS_SPARKYFITNESS_SPARKYFITNESS_SERVER_IMAGE=sparkyfitness-server:personal`
   and `…_FRONTEND_IMAGE=sparkyfitness-frontend:personal`.

4. **Resolve the patch overlays.** That compose file bind-mounts files from
   `patches/` over the server image. Two of them replace files this fork
   changes:
   - `patches/SparkyFitnessServer.ts` (route mounting; this fork adds the
     watch, pairing and performance routes and the pairing allowlist),
   - `patches/garminActivityProcessor.ts` (this fork adds the watch dedup).
   Keeping those mounts silently removes the new features. Port your patch
   changes into the fork (preferred: commit them on `personal`) or re-apply
   the fork's hunks to your patch files. Note the overlays were written for
   v1.7.3 while the stack currently runs v1.8.0.

5. `docker compose up -d`, then check the logs for
   `Successfully applied migration: 20261020100000_create_watch_session_imports.sql`,
   `…110000_create_watch_pairing_requests.sql` and
   `20261021100000_create_watch_devices.sql`.

The watch and the iPhone reach the server through your reverse proxy or
Tailscale; both need HTTPS with a certificate the phone trusts.

## iPhone (SideStore, free Apple ID)

1. Push this repository to GitHub (a fork of CodeWithCJ/SparkyFitness).
   Optional: repository variable `SIDELOAD_BUNDLE_ID` (default
   `com.sparkyfitness.personal`).
2. Actions > **iOS sideload IPA** > Run workflow, or tag a release:

   ```bash
   git tag -a sideload-v1.8.0-1 -m "First personal build"
   git push origin sideload-v1.8.0-1
   ```

3. Deploy the release server (`deploy/ios-release-server/README.md`), add its
   `source.json` in SideStore and install SparkyFitness. Or download the IPA
   artifact and open it in SideStore directly.
4. If SideStore refuses an entitlement, run the workflow with
   *Strip HealthKit background delivery* checked.

The sideload build has no home-screen widget, Live Activities or Apple Watch
app: each would need another App ID, and a free Apple ID has three.

## Garmin watch

See `SparkyFitnessConnectIQ/README.md`. In short:

```bash
cd SparkyFitnessConnectIQ
export CIQ_SDK=~/connectiq-sdk CIQ_HOME=$HOME CIQ_KEY=~/developer_key.der
SPARKY_SERVER_URL=https://fitness.<tailnet>.ts.net tools/build.sh fenix7   # your model
# copy bin/SparkyStrength-fenix7.prg to GARMIN/APPS/ on the watch (USB)
```

Then on the watch: Sparky Strength > Pair watch, and enter the code in the
iPhone app under Settings > Garmin watch (or on the web under Settings >
Developer & Integrations > Garmin watch).

## Tests

```bash
# server (from SparkyFitnessServer/)
pnpm run validate && pnpm run test:ci
# end-to-end against a throwaway server + database (never production):
SPARKY_E2E_BASE_URL=http://localhost:3010 node ../scripts/e2e/watch-sync.e2e.mjs
SPARKY_E2E_BASE_URL=http://localhost:3010 npx tsx scripts/e2e/performanceOverview.e2e.ts
npx tsx scripts/e2e/garminWatchLink.e2e.ts <user-id>
# web, mobile
(cd SparkyFitnessFrontend && pnpm run validate && pnpm run test:ci)
(cd SparkyFitnessMobile && pnpm run validate && pnpm run test:ci)
# python tools
python3 -m unittest discover -s scripts/ios
python3 -m unittest discover -s deploy/ios-release-server/tests
```

## Known limitations

- The iOS workflow has not run yet (no GitHub access from the build host);
  first runs often surface Xcode/CocoaPods version issues.
- The IPA has not been installed through SideStore yet.
- The watch app has not run on hardware or in the simulator (needs Garmin
  device definitions from the SDK Manager, which require a Garmin login).
- Garmin Connect shows watch-recorded sessions as generic strength activities
  without exercise sets; set details live in SparkyFitness.
- Watch/Garmin matching is time based (±10 minutes).
- `de` mobile locale: six placeholder errors inherited from upstream v1.8.0
  (`pnpm run i18n:audit`); locales are machine-synced upstream.
