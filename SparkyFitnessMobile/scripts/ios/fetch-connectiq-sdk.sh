#!/usr/bin/env bash
# Downloads Garmin's Connect IQ Mobile SDK for iOS (ConnectIQ.xcframework)
# into modules/garmin-connectiq/ios/vendor/ for the Garmin watch bridge.
#
# The SDK is Garmin's, under Garmin's Connect IQ license, and is not
# committed to this repository; CI runs this before `expo prebuild`. A
# build without it still works, the Garmin watch connection is then
# unavailable. The commit is pinned so builds are reproducible.
set -euo pipefail

REPO=https://github.com/garmin/connectiq-companion-app-sdk-ios.git
COMMIT=f0d29ff691d700a132d86205ed9bb091e336c2f7 # 2026-01-15
cd "$(dirname "$0")/../.."
DEST=modules/garmin-connectiq/ios/vendor

if [ -d "$DEST/ConnectIQ.xcframework" ]; then
  echo "Connect IQ SDK already present in $DEST"
  exit 0
fi
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git -c advice.detachedHead=false clone --quiet --filter=blob:none --no-checkout "$REPO" "$TMP/sdk"
git -C "$TMP/sdk" checkout --quiet "$COMMIT"
test -f "$TMP/sdk/ConnectIQ.xcframework/Info.plist"
mkdir -p "$DEST"
cp -R "$TMP/sdk/ConnectIQ.xcframework" "$DEST/"
echo "Connect IQ SDK $COMMIT -> $DEST/ConnectIQ.xcframework"
