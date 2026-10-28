// Boarding Pass desktop shell.
//
// Updates: the game asks `check_for_update` when it starts. That reads
// latest.json from the newest GitHub release (plugins.updater in
// tauri.conf.json) and, if there is a newer version, returns its number and
// notes. `install_update` then downloads it, checks its signature against the
// public key in tauri.conf.json, installs it and restarts the game.
use std::sync::Mutex;

use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The update found by the last check, kept until it is installed.
#[derive(Default)]
struct PendingUpdate(Mutex<Option<Update>>);

/// Returns `[new version, release notes]`, or nothing when the game is up to date.
#[tauri::command]
async fn check_for_update(
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
async fn install_update(
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(PendingUpdate::default())
        .invoke_handler(tauri::generate_handler![check_for_update, install_update])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
