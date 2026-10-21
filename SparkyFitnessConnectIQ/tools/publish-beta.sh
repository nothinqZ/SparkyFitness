#!/usr/bin/env bash
# Builds the store package and publishes it as a new version of the
# Connect IQ beta app, without a browser at hand:
#
#   tools/publish-beta.sh 0.6.1
#
# The upload runs on the Windows PC that holds the signed-in Edge profile
# (tools/ciq-upload: sign in once with the .bat, upload.py fills Garmin's
# "Upload New Version" form). Garmin offers no upload API, so this drives its
# web form; if Garmin changes the form, upload.py needs adjusting.
#
# Variables: CIQ_SDK CIQ_HOME CIQ_KEY SPARKY_SERVER_URL (as for build.sh),
# UPLOAD_HOST [arato@192.168.2.21], UPLOAD_KEY [~/.ssh/id_ed25519]
set -euo pipefail
VERSION="${1:?usage: tools/publish-beta.sh <version>}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UPLOAD_HOST="${UPLOAD_HOST:-arato@192.168.2.21}"
UPLOAD_KEY="${UPLOAD_KEY:-$HOME/.ssh/id_ed25519}"
SSH=(ssh -o BatchMode=yes -i "$UPLOAD_KEY")

if ! grep -q "const APP_VERSION = \"$VERSION\";" "$APP_DIR/source/SyncClient.mc"; then
  echo "APP_VERSION in source/SyncClient.mc is not $VERSION" >&2
  exit 1
fi
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT
OUT_DIR="$OUT_DIR" "$APP_DIR/tools/build.sh" all --package --release | grep -E "BUILD|ERROR"
PACKAGE="SparkyStrength-$VERSION.iq"
cp "$OUT_DIR/SparkyStrength.iq" "$OUT_DIR/$PACKAGE"
scp -o BatchMode=yes -i "$UPLOAD_KEY" "$OUT_DIR/$PACKAGE" "$UPLOAD_HOST:sparky-ciq-upload/packages/"
"${SSH[@]}" "$UPLOAD_HOST" "cd %USERPROFILE%\\sparky-ciq-upload && venv\\Scripts\\python.exe upload.py packages\\$PACKAGE $VERSION"
