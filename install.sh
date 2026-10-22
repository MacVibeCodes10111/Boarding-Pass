#!/bin/bash
# ============================================================================
# Boarding Pass — install or update on a Mac
#
#   bash install.sh
#
# Checks the tools, installs Rust if needed, downloads the other airlines'
# traffic data, builds the app and puts it in Applications. Run it again any
# time to update; your careers are kept.
# ============================================================================
set -e
cd "$(dirname "$0")"

APP_NAME="Boarding Pass"
# What the game was called before v2.27 (removed once the new one is in, if it is this game)
OLD_APP_NAME="TAS Airline Simulator"
# Only an app with this identifier is ever replaced (another app may share a similar name)
APP_ID="com.ebncr.airline-simulator"
say() { printf '\n\033[1;33m== %s\033[0m\n' "$1"; }
stop() { printf '\n\033[1;31m%s\033[0m\n\n' "$1"; exit 1; }

[ "$(uname)" = "Darwin" ] || stop "This installer is for a Mac."

# --- 1. Tools ---------------------------------------------------------------
say "1/5  Checking the tools"

if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install >/dev/null 2>&1 || true
  stop "Apple's developer tools aren't installed yet. A window has opened: click Install, wait for it to finish, then run this again:
    bash \"$PWD/install.sh\""
fi
echo "Apple developer tools: OK"

if ! command -v node >/dev/null 2>&1; then
  open "https://nodejs.org/en/download" || true
  stop "Node.js isn't installed. Download the LTS installer for macOS from nodejs.org (the page has opened), run it, then open a new Terminal window and run this again:
    bash \"$PWD/install.sh\""
fi
NODE_V="$(node -p 'process.versions.node')"
NODE_MAJOR="${NODE_V%%.*}"
NODE_MINOR="$(echo "$NODE_V" | cut -d. -f2)"
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 19 ]; } || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; } || [ "$NODE_MAJOR" -eq 21 ]; then
  open "https://nodejs.org/en/download" || true
  stop "Node.js $NODE_V is too old. Install the current LTS from nodejs.org (the page has opened), then open a new Terminal window and run this again."
fi
echo "Node.js $NODE_V: OK"

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
if ! command -v cargo >/dev/null 2>&1; then
  echo "Installing Rust (needed once, about 2 minutes)..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  . "$HOME/.cargo/env"
fi
echo "Rust $(rustc --version | cut -d' ' -f2): OK"

# --- 2. Airline route data ---------------------------------------------------
say "2/5  Checking the airline route data"
if [ -s public/data/network.json ]; then
  echo "network.json: OK"
else
  echo "public/data/network.json is missing. The game still works, with simpler route demand and no other airlines' traffic. Download the game again to get it."
fi

# --- 3. The game's packages --------------------------------------------------
say "3/5  Installing the game's packages (a few minutes the first time)"
npm install --no-audit --no-fund

# --- 4. Build ---------------------------------------------------------------
say "4/5  Building the app (5 to 15 minutes the first time, faster after)"
# The update files need the release key, which only GitHub has, so a home
# build skips them (src-tauri/tauri.local.conf.json).
npm run tauri build -- --config src-tauri/tauri.local.conf.json

BUILT="src-tauri/target/release/bundle/macos/$APP_NAME.app"
[ -d "$BUILT" ] || stop "The build finished but the app wasn't found at $BUILT. Copy the last 30 lines above and send them to Claude."

# --- 5. Install -------------------------------------------------------------
say "5/5  Putting the app in Applications"
DEST="/Applications"
if [ ! -w "$DEST" ]; then
  DEST="$HOME/Applications"
  mkdir -p "$DEST"
fi
TARGET="$DEST/$APP_NAME.app"
if [ -e "$TARGET" ]; then
  # Replace it only if it is this game (same identifier); never touch any other app
  OLD_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$TARGET/Contents/Info.plist" 2>/dev/null || true)"
  if [ "$OLD_ID" != "$APP_ID" ]; then
    stop "There is already a different app called \"$APP_NAME\" in $DEST. It has not been touched.
The new build is here, ready to open: $PWD/$BUILT"
  fi
  osascript -e "tell application id \"$APP_ID\" to quit" >/dev/null 2>&1 || true
  rm -rf "$TARGET" || stop "Couldn't replace the old $TARGET. Quit the game and run this again."
fi
ditto "$BUILT" "$TARGET"
echo "Installed: $TARGET"
# The same game under its old name: remove it (only if it really is this game)
for OLD in "/Applications/$OLD_APP_NAME.app" "$HOME/Applications/$OLD_APP_NAME.app"; do
  if [ -d "$OLD" ]; then
    OID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$OLD/Contents/Info.plist" 2>/dev/null || true)"
    if [ "$OID" = "$APP_ID" ]; then rm -rf "$OLD" && echo "Removed the old version under its previous name: $OLD"; fi
  fi
done

printf '\n\033[1;32mDone. %s is in %s and is opening now.\033[0m\n\n' "$APP_NAME" "$DEST"
open "$TARGET"
