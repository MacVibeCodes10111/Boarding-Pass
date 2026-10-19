# Boarding Pass

A small airline manager game for Mac and Windows. Start an airline at a hub, buy or lease aircraft, build a schedule, and watch your flights taxi, take off and fly on a live world map, among thousands of other airlines' aircraft, in 2D or in 3D.

Join the Discord! **[Discord](https://discord.gg/zCk6hcFkzf)**:

Version 2.28. Free to play. See [Credits and licences](#credits-and-licences).

## Download

Get the latest version from **[Releases](https://github.com/MacVibeCodes10111/Boarding-Pass/releases/latest)**:

- **Mac** (Apple-chip and Intel, macOS 11 or later): the `.dmg`. Open it and drag Boarding Pass into Applications.
- **Windows** (64-bit): the `…x64-setup.exe` installer.

The downloads aren't code-signed, so the first time you open the game, macOS or Windows asks whether to trust it. The release notes say what to click. After that, the game updates itself: see [What's new](#whats-new). You can also build the game yourself, as below.

## What's new

Version 2.28:

- **The game updates itself.** When a new version is out, the game offers it a few seconds after it starts. Click **Update now** and it saves your career, downloads and installs the update, and restarts. Updates are signed, and the game only installs one signed with the Boarding Pass release key. If you have 2.27 or earlier, download 2.28 from Releases by hand once.

Version 2.27:

- The game is now called **Boarding Pass**. Careers saved under its old name carry over.
- A **Credits and licences** screen, from the home screen and the Map layers menu, and map credits on the map.
- The satellite view uses EOX Sentinel-2 imagery, with place names from CARTO and OpenStreetMap.
- One-click builds: `update.sh` on a Mac, `build-windows.bat` on Windows, and automatic releases on GitHub.

## Build it yourself on a Mac

1. Download this repository: the green **Code** button, then **Download ZIP**. Unzip it in Downloads.
2. Open **Terminal** (Cmd+Space, type Terminal, press Enter) and paste:

   ```
   bash ~/Downloads/Boarding-Pass-main/update.sh
   ```

This copies the game to `~/Documents/boarding-pass`, checks Apple's developer tools, Node.js and Rust (installing Rust if it's missing), builds the game and puts **Boarding Pass** in Applications. If Apple's tools or Node.js are missing, it says so and opens the right page; install that, open a new Terminal window and run the same command again.

The first build takes about 20–30 minutes. Updates are much quicker.

## Build it yourself on Windows

1. Install, once:
   - [Node.js](https://nodejs.org/en/download) (LTS)
   - [Rust](https://rustup.rs) (run `rustup-init.exe` with the default choices)
   - [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/), with **Desktop development with C++** ticked
2. Download this repository (green **Code** button, **Download ZIP**) and unzip it somewhere, for example in Documents.
3. Double-click **`build-windows.bat`** in that folder.

It checks the tools, builds the game, and opens the folder with:

- `boarding-pass.exe`, the game itself (runs on its own), and
- `bundle\nsis\Boarding Pass_…_x64-setup.exe`, an installer with a Start menu entry.

The first build takes 5–15 minutes. Windows may warn that the app is from an unknown publisher, because it isn't code-signed; choose **More info → Run anyway**.

## Update to a new version

- **Downloaded from Releases (2.28 or later):** nothing to do. The game offers each new version when it starts.
- **Built yourself:** the game offers new versions too; updating replaces your build with the official download. Or rebuild it yourself:
  - **Mac:** download the new version and run its `update.sh` the same way. It keeps what's already built, so it's quick, and your careers are kept.
  - **Windows:** replace the folder's contents with the new version (keep `node_modules` and `src-tauri\target` to make it quicker) and double-click `build-windows.bat` again.

## Playing

- The game needs the internet for the map.
- Your careers save themselves every minute and live in the app, not in this folder. To move a career between computers: **Menu → Export save file**, then **Import save file** on the home screen of the other computer.
- **3D view** (Map layers → 3D aircraft):
  - Tilt and turn: right-drag on Windows, two-finger click and drag (or Control-drag) on a Mac.
  - Raise or lower the camera: hold the middle mouse button and drag, or Alt-drag (Option-drag on a Mac).

## For developers

- `npm install`, then `npm run tauri dev` opens the game with live reload.
- `npm run check` runs the TypeScript check.
- The game code is in `src/`: game logic in `src/game/`, screens in `src/components/`, shared UI in `src/ui/`.

## Credits and licences

Boarding Pass's own code is © 2026 Ermek Baker-Niffka under the [MIT licence](LICENSE). The game is built on:

- **Maps:** © [CARTO](https://carto.com/attributions) basemaps; map data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
- **Satellite imagery:** EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2024), under CC BY-NC-SA 4.0, used for non-commercial purposes only.
- **Map engine:** [MapLibre GL JS](https://maplibre.org) (BSD 3-Clause).
- **Airports, runways and navaids:** [OurAirports](https://ourairports.com/data/) (public domain).
- **Other airlines' routes:** [OpenFlights](https://openflights.org/data) (ODbL 1.0). The schedules worked out from them are made available under the same licence.
- **Software:** React (MIT), Tauri (MIT / Apache 2.0).

Full licence texts are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Because some of the maps and data are licensed for non-commercial use only, Boarding Pass is free and must stay free: no sales, ads or paid features.

Boarding Pass is not affiliated with, endorsed or sponsored by any airline, aircraft maker or airport. Airline, aircraft and airport names are used only to identify them and belong to their owners. Everything in the game is simulated: not for navigation.
