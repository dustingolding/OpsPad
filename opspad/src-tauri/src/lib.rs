// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[allow(dead_code)]
mod arch;
mod db;
mod terminal;

use std::sync::Arc;

use tauri::{Manager, State};

use crate::arch::vault;
use crate::db::{Db, DockCommand, DockCommandCreate, HostCreate, HostUpdate};
use crate::terminal::TerminalManager;
use base64::Engine as _;
use serde::Serialize;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

pub struct AppState {
    terminal: TerminalManager,
    db: Db,
    #[allow(dead_code)]
    vault: Box<dyn vault::VaultProvider>,
}

#[tauri::command]
fn hosts_list(state: State<'_, Arc<AppState>>) -> Result<Vec<db::Host>, String> {
    state.db.hosts_list().map_err(|e| e.to_string())
}

#[tauri::command]
fn hosts_create(state: State<'_, Arc<AppState>>, input: HostCreate) -> Result<db::Host, String> {
    state.db.hosts_create(input).map_err(|e| e.to_string())
}

#[tauri::command]
fn hosts_delete(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    state.db.hosts_delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn hosts_update(state: State<'_, Arc<AppState>>, input: HostUpdate) -> Result<db::Host, String> {
    state.db.hosts_update(input).map_err(|e| e.to_string())
}

#[tauri::command]
fn hosts_reorder(state: State<'_, Arc<AppState>>, ids: Vec<String>) -> Result<(), String> {
    state.db.hosts_reorder(&ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn dock_commands_list(state: State<'_, Arc<AppState>>) -> Result<Vec<db::DockCommand>, String> {
    state.db.dock_commands_list().map_err(|e| e.to_string())
}

#[tauri::command]
fn dock_commands_create(
    state: State<'_, Arc<AppState>>,
    input: DockCommandCreate,
) -> Result<db::DockCommand, String> {
    state.db.dock_commands_create(input).map_err(|e| e.to_string())
}

#[tauri::command]
fn dock_commands_update(state: State<'_, Arc<AppState>>, input: DockCommand) -> Result<db::DockCommand, String> {
    state.db.dock_commands_update(input).map_err(|e| e.to_string())
}

#[tauri::command]
fn dock_commands_delete(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    state.db.dock_commands_delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn dock_commands_reorder(state: State<'_, Arc<AppState>>, ids: Vec<String>) -> Result<(), String> {
    state.db.dock_commands_reorder(&ids).map_err(|e| e.to_string())
}

#[tauri::command]
fn dock_runbook_get(state: State<'_, Arc<AppState>>) -> Result<String, String> {
    state.db.dock_runbook_get().map_err(|e| e.to_string())
}

#[tauri::command]
fn dock_runbook_set(state: State<'_, Arc<AppState>>, markdown: String) -> Result<(), String> {
    state.db.dock_runbook_set(&markdown).map_err(|e| e.to_string())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DockHistoryItem {
    id: String,
    created_at: i64,
    environment_tag: String,
    command_text: String,
}

#[tauri::command]
fn dock_history_list(state: State<'_, Arc<AppState>>, limit: Option<i64>) -> Result<Vec<DockHistoryItem>, String> {
    let lim = limit.unwrap_or(200).clamp(1, 500);
    let rows = state.db.dock_history_list(lim).map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|(id, created_at, environment_tag, command_text)| DockHistoryItem {
            id,
            created_at,
            environment_tag,
            command_text,
        })
        .collect())
}

#[tauri::command]
fn dock_history_delete(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    state.db.dock_history_delete(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn dock_history_clear(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    state.db.dock_history_clear().map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_open_local(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    environment_tag: Option<String>,
) -> Result<String, String> {
    let env = environment_tag.unwrap_or_else(|| "LOCAL".to_string());
    let (initial_cols, initial_rows) = state
        .db
        .terminal_prefs_get_size("local")
        .map_err(|e| e.to_string())?
        .map(|(c, r)| (Some(c), Some(r)))
        .unwrap_or((None, None));
    let sid = state
        .terminal
        .open_local(app, Some(env.clone()), initial_cols, initial_rows)
        .map(|id| id.0)
        .map_err(|e| e.to_string())?;

    // Persist non-secret per-scope prefs and map the runtime session id -> scope.
    state.db.terminal_session_scope_set(&sid, "local").map_err(|e| e.to_string())?;
    state.db.terminal_prefs_touch("local", &env).map_err(|e| e.to_string())?;
    Ok(sid)
}

#[tauri::command]
fn terminal_open_ssh(
    app: tauri::AppHandle,
    state: State<'_, Arc<AppState>>,
    user: String,
    host: String,
    port: Option<u16>,
    identity_file: Option<String>,
    extra_args: Vec<String>,
    environment_tag: Option<String>,
    host_id: Option<String>,
) -> Result<String, String> {
    let env = environment_tag.unwrap_or_else(|| "UNKNOWN".to_string());
    let scope = if let Some(hid) = host_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        format!("ssh:{hid}")
    } else {
        let p = port.unwrap_or(22);
        format!("ssh:{user}@{host}:{p}")
    };

    let (initial_cols, initial_rows) = state
        .db
        .terminal_prefs_get_size(&scope)
        .map_err(|e| e.to_string())?
        .map(|(c, r)| (Some(c), Some(r)))
        .unwrap_or((None, None));

    let sid = state
        .terminal
        .open_ssh(
            app,
            user.clone(),
            host.clone(),
            port,
            identity_file,
            extra_args,
            Some(env.clone()),
            initial_cols,
            initial_rows,
        )
        .map(|id| id.0)
        .map_err(|e| e.to_string())?;

    state.db.terminal_session_scope_set(&sid, &scope).map_err(|e| e.to_string())?;
    state.db.terminal_prefs_touch(&scope, &env).map_err(|e| e.to_string())?;
    Ok(sid)
}

#[tauri::command]
fn terminal_write(
    state: State<'_, Arc<AppState>>,
    session_id: String,
    data: String,
    origin: Option<String>,
    dock_command_id: Option<String>,
    dock_command_title: Option<String>,
    dock_command_template: Option<String>,
) -> Result<(), String> {
    // Update persisted "last command" only for CommandDock-origin runs.
    if origin.as_deref() == Some("commanddock") {
        if let Ok(Some(scope)) = state.db.terminal_session_scope_get(&session_id) {
            let _ = state.db.terminal_prefs_update_last_command(
                &scope,
                dock_command_id.as_deref(),
                dock_command_title.as_deref(),
                dock_command_template.as_deref(),
            );

            // Also append to CommandDock history (local-only). This records only CommandDock "Run"
            // actions (not typed keystrokes).
            let mut cmd_text = data.clone();
            cmd_text = cmd_text.replace('\r', "").trim().to_string();
            if !cmd_text.is_empty() {
                let env = state
                    .db
                    .terminal_prefs_get_env(&scope)
                    .ok()
                    .flatten()
                    .unwrap_or_else(|| "UNKNOWN".to_string());
                let _ = state.db.dock_history_add(
                    Some(&scope),
                    &env,
                    &cmd_text,
                    dock_command_id.as_deref(),
                    dock_command_title.as_deref(),
                    dock_command_template.as_deref(),
                );
            }
        }
    }

    if origin.is_some() {
        state
            .terminal
            .write_with_meta(
                &session_id,
                &data,
                crate::terminal::session_manager::WriteMeta { origin },
            )
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    state.terminal.write(&session_id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn terminal_resize(state: State<'_, Arc<AppState>>, session_id: String, cols: u16, rows: u16) -> Result<(), String> {
    state
        .terminal
        .resize(&session_id, cols, rows)
        .map_err(|e| e.to_string())?;

    if let Ok(Some(scope)) = state.db.terminal_session_scope_get(&session_id) {
        let _ = state.db.terminal_prefs_update_size(&scope, cols, rows);
    }
    Ok(())
}

#[tauri::command]
fn terminal_close(state: State<'_, Arc<AppState>>, session_id: String) -> Result<(), String> {
    state
        .terminal
        .close(&session_id)
        .map_err(|e| e.to_string())?;
    let _ = state.db.terminal_session_scope_delete(&session_id);
    Ok(())
}

#[tauri::command]
fn terminal_mark_exited(state: State<'_, Arc<AppState>>, session_id: String) -> Result<(), String> {
    state.db.terminal_session_scope_delete(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_set_secret(state: State<'_, Arc<AppState>>, key: String, secret_b64: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(secret_b64.as_bytes())
        .map_err(|e| e.to_string())?;
    state
        .vault
        .set_secret(&key, &bytes)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn vault_get_secret(state: State<'_, Arc<AppState>>, key: String) -> Result<Option<String>, String> {
    let bytes = state.vault.get_secret(&key).map_err(|e| e.to_string())?;
    Ok(bytes.map(|b| base64::engine::general_purpose::STANDARD.encode(b)))
}

#[tauri::command]
fn vault_delete_secret(state: State<'_, Arc<AppState>>, key: String) -> Result<(), String> {
    state
        .vault
        .delete_secret(&key)
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let (db, _path) = Db::open(&app.handle()).map_err(|e| e.to_string())?;
            let vault = vault::default_vault_provider();
            let state = Arc::new(AppState {
                terminal: TerminalManager::new(),
                db,
                vault,
            });
            app.manage(state);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            hosts_list,
            hosts_create,
            hosts_delete,
            hosts_update,
            hosts_reorder,
            dock_commands_list,
            dock_commands_create,
            dock_commands_update,
            dock_commands_delete,
            dock_commands_reorder,
            dock_runbook_get,
            dock_runbook_set,
            dock_history_list,
            dock_history_delete,
            dock_history_clear,
            terminal_open_local,
            terminal_open_ssh,
            terminal_write,
            terminal_resize,
            terminal_close,
            terminal_mark_exited,
            vault_set_secret,
            vault_get_secret,
            vault_delete_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
