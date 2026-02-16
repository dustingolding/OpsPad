use std::path::PathBuf;

use tauri::Manager;

/// All filesystem paths should be resolved via Tauri app directories.
///
/// This keeps storage locations consistent and cross-platform.
pub fn app_data_dir(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    app.path().app_data_dir()
}

pub fn app_log_dir(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    app.path().app_log_dir()
}
