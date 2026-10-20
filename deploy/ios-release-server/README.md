# iOS release server (SideStore / AltStore source)

Self-hosted distribution of the SparkyFitness sideload IPA:

```
git tag sideload-v1.8.0-1 && git push origin sideload-v1.8.0-1
  → GitHub Actions (.github/workflows/ios-sideload.yml) builds and checks the IPA
  → GitHub release with IPA, .sha256 and release.json
  → release-publisher (this stack) polls GitHub, verifies SHA-256 + IPA structure
  → stores releases/<version>-<build>/, regenerates source.json
  → SideStore refreshes the source and offers the update
```

The homelab pulls; nothing pushes into it. There is no upload endpoint and CI
holds no credentials for your network.

## Components

| Service | Role |
| --- | --- |
| `release-web` | nginx, read-only, serves `source.json`, `index.html`, `icon.png`, `releases/**`. Binds to `127.0.0.1:8088` by default. |
| `release-publisher` | Python (stdlib only) CLI + GitHub poller. Validates IPAs with `scripts/ios/validate_ipa.py`, keeps `state.json` (history), writes the public files atomically. |

Data lives in the `release-data` volume:
`state.json` (history, not served) and `public/` (served).

## Deploy

```bash
cd deploy/ios-release-server
cp .env.example .env          # set PUBLIC_BASE_URL, GITHUB_REPO (and BUNDLE_ID if changed)
docker compose up -d --build
docker compose logs -f release-publisher
```

`PUBLIC_BASE_URL` must be HTTPS: iOS refuses plain HTTP for the source and
the downloads.

### Behind an existing reverse proxy

Point a vhost at `127.0.0.1:8088` (or put `release-web` on the proxy's Docker
network and drop the `ports:` mapping). Examples:

```caddy
apps.example.com {
    reverse_proxy 127.0.0.1:8088
}
```

```nginx
location / {
    proxy_pass http://127.0.0.1:8088;
    proxy_set_header Host $host;
}
```

Traefik: labels on `release-web` with `loadbalancer.server.port=8080`.

### Tailscale only (not on the internet)

If the phone runs Tailscale:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:8088
# PUBLIC_BASE_URL=https://<host>.<tailnet>.ts.net
```

`tailscale serve` provides a valid certificate for the MagicDNS name. SideStore
can then only refresh the source while the phone is connected to the tailnet;
installed apps keep working without it.

## On the iPhone

1. Install SideStore (see sidestore.io) and sign in with your Apple ID.
2. Open `PUBLIC_BASE_URL` in Safari and tap **Add to SideStore**, or in
   SideStore: **Sources → + →** `https://…/source.json`.
3. Install SparkyFitness from the source. SideStore signs it with your Apple
   ID on the phone.
4. Free Apple ID: apps must be refreshed within 7 days (SideStore does this
   in the background when its pairing/VPN setup is active) and at most 3 apps
   can be active. The sideload build is a single App ID; it has no widgets,
   Live Activities or Apple Watch app (those would each need another App ID).
5. Updates appear in SideStore when a new version/build is in the source.

## Operating

```bash
dc() { docker compose run --rm release-publisher "$@"; }

dc list                              # history, * = current
dc rollback                          # withdraw the newest, previous becomes current
dc rollback --to 1.8.0-41            # withdraw everything newer than that
dc restore 1.8.0-42                  # make a withdrawn release available again
dc prune --keep 5                    # delete old IPA files (current is always kept)
dc watch-github --once               # poll GitHub now

# Publish an IPA by hand (e.g. a workflow artifact):
docker compose run --rm -v "$PWD/SparkyFitness-1.8.0-42.ipa:/in/app.ipa:ro" \
  release-publisher publish /in/app.ipa --notes "Fix rest timer" \
  --sha256 "$(cut -d' ' -f1 SparkyFitness-1.8.0-42.ipa.sha256)"
```

Rollback removes newer versions from `source.json`; their files stay on disk
so `restore` is instant. A phone that already installed the bad build keeps
it: in SideStore open SparkyFitness → **Version History** and install the
previous version.

Every publish:

- refuses an IPA that fails the structural check (one app, bundle id equal to
  `BUNDLE_ID`, arm64 device binary, embedded JS bundle, no extensions),
- refuses a SHA-256 that differs from the release's `.sha256` asset and
  `release.json`,
- is idempotent for the same version+build and refuses the same version+build
  with different content.

`source.json` lists each version with `size`, `sha256`, `minOSVersion` and
the app's `appPermissions` (entitlements read from the IPA's ad-hoc signature,
privacy strings from Info.plist), which SideStore/AltStore 2 compare with the
installed app.

## Tests

```bash
python3 -m unittest discover -s deploy/ios-release-server/tests
python3 -m unittest discover -s scripts/ios
```

## Security notes

- `release-web` is read-only, has no write path, serves nothing outside
  `public/` (no `state.json`, no dotfiles) and drops capabilities.
- `release-publisher` runs as an unprivileged user with a read-only root
  filesystem; it only makes outbound HTTPS requests to api.github.com.
- `GITHUB_TOKEN` is only needed for a private repository; use a fine-grained
  token limited to read-only Contents on that repository.
- The IPA contains no secrets: the server URL is entered in the app.
