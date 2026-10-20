#!/usr/bin/env bash
# Build the Connect IQ app inside a Java container, so nothing but Docker is
# needed on the host.
#
#   CIQ_SDK=/path/to/connectiq-sdk-lin-9.2.0 \
#   CIQ_HOME=/path/to/home-with-.Garmin \
#   CIQ_KEY=/path/to/developer_key.der \
#   SPARKY_SERVER_URL=https://fitness.example.ts.net \
#   tools/build.sh <device> [--test] [--package] [--release]
#
# <device>   A device id installed under $CIQ_HOME/.Garmin/ConnectIQ/Devices
#            (install real devices with Garmin's SDK Manager, which needs a free
#            Garmin developer account). "sparkygeneric" is a compile-check
#            device created by tools/make-check-device.sh: it validates syntax,
#            types and API usage against the SDK, but is not real hardware.
# --test     Build with unit tests (:test) for the simulator.
# --package  Build an .iq store/sideload package for all manifest products.
# --release  Strip debug info.
#
# Generate a developer key once (keep it private; Garmin ties app updates to it):
#   openssl genrsa -out developer_key.pem 4096
#   openssl pkcs8 -topk8 -inform PEM -outform DER -in developer_key.pem \
#     -out developer_key.der -nocrypt
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${1:?usage: tools/build.sh <device> [--test] [--package] [--release]}"
shift
: "${CIQ_SDK:?set CIQ_SDK to the extracted Connect IQ SDK directory}"
: "${CIQ_HOME:?set CIQ_HOME to the directory containing .Garmin/ConnectIQ/Devices}"
: "${CIQ_KEY:?set CIQ_KEY to your developer_key.der}"
OUT_DIR="${OUT_DIR:-$APP_DIR/bin}"
JAVA_IMAGE="${JAVA_IMAGE:-eclipse-temurin:21-jre}"

EXTRA=()
NAME="SparkyStrength-$DEVICE"
for arg in "$@"; do
  case "$arg" in
    --test) EXTRA+=(--unit-test); NAME="$NAME-test" ;;
    --release) EXTRA+=(--release) ;;
    --package) EXTRA+=(--package-app); NAME="SparkyStrength" ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$OUT_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -r "$APP_DIR/." "$WORK/app"
rm -rf "$WORK/app/bin"

# The server URL is not a secret, but it is personal: inject it into the
# build copy instead of the committed properties.xml. The API key is never
# baked in; the watch pairs itself (PairingView).
if [ -n "${SPARKY_SERVER_URL:-}" ]; then
  case "$SPARKY_SERVER_URL" in
    https://*) ;;
    *) echo "SPARKY_SERVER_URL must start with https:// (the phone refuses plain HTTP)" >&2; exit 2 ;;
  esac
  python3 - "$WORK/app/resources/settings/properties.xml" "$SPARKY_SERVER_URL" <<'PY'
import sys, xml.sax.saxutils as s
path, url = sys.argv[1], sys.argv[2]
text = open(path).read()
text = text.replace('<property id="serverUrl" type="string"></property>',
                    '<property id="serverUrl" type="string">%s</property>' % s.escape(url))
open(path, "w").write(text)
PY
fi

# The compile-check device is not a Garmin product; add it to a copy of the
# manifest only, never to the committed one.
if [ "$DEVICE" = "sparkygeneric" ]; then
  sed -i 's#<iq:products>#<iq:products>\n            <iq:product id="sparkygeneric"/>#' "$WORK/app/manifest.xml"
fi

if [[ " ${EXTRA[*]-} " == *" --package-app "* ]]; then
  OUTPUT="/out/$NAME.iq"
  DEVICE_ARGS=()
else
  OUTPUT="/out/$NAME.prg"
  DEVICE_ARGS=(-d "$DEVICE")
fi

# monkeyc writes bin/default.jungle into the SDK, so it cannot be mounted
# read-only.
set +e
docker run --rm -u "$(id -u):$(id -g)" \
  -e HOME=/ciqhome -e JAVA_TOOL_OPTIONS=-Duser.home=/ciqhome \
  -v "$CIQ_SDK:/sdk" -v "$CIQ_HOME:/ciqhome" -v "$CIQ_KEY:/key.der:ro" \
  -v "$WORK/app:/app" -v "$OUT_DIR:/out" \
  "$JAVA_IMAGE" \
  /sdk/bin/monkeyc -f /app/monkey.jungle -o "$OUTPUT" -y /key.der \
  "${DEVICE_ARGS[@]}" -w -l 2 "${EXTRA[@]}" >"$WORK/log" 2>&1
STATUS=$?
set -e
grep -v '^Picked up JAVA_TOOL_OPTIONS' "$WORK/log" || true
if [ "$STATUS" -ne 0 ]; then
  echo "monkeyc failed ($STATUS)" >&2
  exit "$STATUS"
fi
echo "built $OUT_DIR/$(basename "$OUTPUT")"
