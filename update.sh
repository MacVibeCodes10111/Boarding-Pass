#!/bin/bash
# ============================================================================
# Boarding Pass — apply an update on a Mac
#
#   bash ~/Downloads/boarding-pass-vX.Y-mac/boarding-pass/update.sh
#
# Copies this version into ~/Documents/boarding-pass (keeping the packages and
# the build already there, so it's quick), then builds and installs the app.
# Also works for a first install. Your careers are kept.
# ============================================================================
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Documents/boarding-pass"
OLD="$HOME/Documents/tas-mac" # the folder's name before v2.27
if [ ! -d "$DEST" ] && [ -d "$OLD" ]; then
  mv "$OLD" "$DEST"
  echo "Renamed $OLD to $DEST (the game is now called Boarding Pass)"
fi
if [ "$HERE" != "$DEST" ]; then
  mkdir -p "$DEST"
  # Everything in this update, without touching the downloaded packages or the build
  rsync -a --exclude node_modules --exclude src-tauri/target "$HERE/" "$DEST/"
  # The game code exactly as in this version (files removed in it are removed there too)
  rsync -a --delete "$HERE/src/" "$DEST/src/"
  echo "Copied this version into $DEST"
fi
exec bash "$DEST/install.sh"
