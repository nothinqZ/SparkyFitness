#!/usr/bin/env bash
# Creates "sparkygeneric", a compile-check device definition for monkeyc in
# $CIQ_HOME/.Garmin/ConnectIQ/Devices. Garmin's real device definitions need
# the SDK Manager and a Garmin developer login; this one lets CI and machines
# without that login type-check and compile the app against the SDK's API.
# It describes a plain 260x260 round watch on Connect IQ 5.0. It cannot run
# in the simulator and says nothing about how the app fits a real watch.
set -euo pipefail
: "${CIQ_HOME:?set CIQ_HOME}"
DIR="$CIQ_HOME/.Garmin/ConnectIQ/Devices/sparkygeneric"
mkdir -p "$DIR"
cat >"$DIR/compiler.json" <<'JSON'
{
  "deviceId": "sparkygeneric",
  "displayName": "Sparky generic compile-check device (not real hardware)",
  "deviceFamily": "round-260x260",
  "worldWidePartNumber": "006-SPARKY-00",
  "partNumbers": [
    {
      "number": "006-SPARKY-00",
      "connectIQVersion": "5.0.0",
      "firmwareVersion": 1000,
      "languages": [
        { "code": "eng", "fontSet": "ww" },
        { "code": "deu", "fontSet": "ww" }
      ]
    }
  ],
  "orientation": "portrait",
  "bitsPerPixel": 16,
  "resolution": { "width": 260, "height": 260 },
  "appTypes": [{ "type": "watchApp", "memoryLimit": 786432 }],
  "launcherIcon": { "width": 70, "height": 70 },
  "imageFormats": ["png"]
}
JSON
echo "created $DIR/compiler.json"
