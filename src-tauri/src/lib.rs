// Boarding Pass shell (Mac, Windows; iPhone and iPad).
//
// Updates: the game asks `check_for_update` when it starts. That reads
// latest.json from the newest GitHub release (plugins.updater in
// tauri.conf.json) and, if there is a newer version, returns its number and
// notes. `install_update` then downloads it, checks its signature against the
// public key in tauri.conf.json, installs it and restarts the game.
#[cfg(desktop)]
mod updates {
    use std::sync::Mutex;

    use tauri::ipc::Channel;
    use tauri::{AppHandle, State};
    use tauri_plugin_updater::{Update, UpdaterExt};

    /// The update found by the last check, kept until it is installed.
    #[derive(Default)]
    pub struct PendingUpdate(Mutex<Option<Update>>);

    /// Returns `[new version, release notes]`, or nothing when the game is up to date.
    #[tauri::command]
    pub async fn check_for_update(
        app: AppHandle,
        pending: State<'_, PendingUpdate>,
    ) -> Result<Option<[String; 2]>, String> {
        let updater = app.updater().map_err(|e| e.to_string())?;
        let found = updater.check().await.map_err(|e| e.to_string())?;
        let info = found
            .as_ref()
            .map(|u| [u.version.clone(), u.body.clone().unwrap_or_default()]);
        *pending.0.lock().unwrap() = found;
        Ok(info)
    }

    /// Downloads and installs the update found by `check_for_update`, reporting
    /// `[bytes downloaded, total bytes (0 if unknown)]` as it goes, then restarts.
    #[tauri::command]
    pub async fn install_update(
        app: AppHandle,
        pending: State<'_, PendingUpdate>,
        on_progress: Channel<[u64; 2]>,
    ) -> Result<(), String> {
        let update = pending.0.lock().unwrap().take();
        let Some(update) = update else {
            return Err("No update is waiting to be installed.".into());
        };
        let mut downloaded: u64 = 0;
        update
            .download_and_install(
                |chunk, total| {
                    downloaded += chunk as u64;
                    let _ = on_progress.send([downloaded, total.unwrap_or(0)]);
                },
                || {},
            )
            .await
            .map_err(|e| e.to_string())?;
        app.restart();
    }
}

/// iPhone and iPad: the App Store updates the game, so there is never an update to install here.
#[cfg(mobile)]
mod updates {
    use tauri::ipc::Channel;

    #[tauri::command]
    pub async fn check_for_update() -> Result<Option<[String; 2]>, String> {
        Ok(None)
    }

    #[tauri::command]
    pub async fn install_update(_on_progress: Channel<[u64; 2]>) -> Result<(), String> {
        Err("Updates come from the App Store.".into())
    }
}

#[cfg(desktop)]
use tauri::Manager;
use updates::{check_for_update, install_update};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Only the desktop apps add plugins to it
    #[cfg_attr(mobile, allow(unused_mut))]
    let mut builder = tauri::Builder::default();
    // Cloud sign-in (v2.49): Google and Discord open in the system browser and
    // come back as boardingpass://auth?code=… . If the game is already running,
    // the link goes to it (single instance) and the game finishes the sign-in.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }));
    }
    #[cfg(desktop)]
    {
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .manage(updates::PendingUpdate::default());
    }
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![check_for_update, install_update])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
