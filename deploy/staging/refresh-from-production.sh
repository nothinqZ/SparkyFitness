#!/usr/bin/env bash
# Nightly refresh of fitness-next from the production SparkyFitness.
#
# Production (the normal Sparky) stays the system where training is logged;
# fitness-next is the personal edition next to it for analysis and testing.
# This replaces fitness-next's database with a fresh copy every night,
# keeps paired watches (KEEP_WATCH_PAIRING), and keeps only the latest dump.
# Anything entered in fitness-next itself is overwritten.
#
# Installed as a systemd user timer: systemd-user/fitness-next-refresh.*
set -euo pipefail
cd "$(dirname "$0")"
export DUMP_DIR="${DUMP_DIR:-/data/docker/sparky-next-refresh}"
export KEEP_WATCH_PAIRING=1
mkdir -p "$DUMP_DIR"
chmod 700 "$DUMP_DIR"
rm -f "$DUMP_DIR"/source.dump "$DUMP_DIR"/watch_*.csv
./import-from-production.sh
