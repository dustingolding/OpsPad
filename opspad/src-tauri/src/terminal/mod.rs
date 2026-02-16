mod portable_pty_backend;
pub mod session_manager;

use std::sync::Arc;

use serde::Serialize;
use tauri::AppHandle;

use crate::arch::{shell, ssh};
use crate::terminal::portable_pty_backend::PortablePtySessionManager;
use crate::terminal::session_manager::{SpawnSpec, TerminalKind, TerminalSessionManager, WriteMeta};

#[derive(Clone, Debug)]
pub struct SessionId(pub String);

#[derive(Debug)]
pub enum TerminalError {
    NotFound,
    Backend(String),
}

impl std::fmt::Display for TerminalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TerminalError::NotFound => write!(f, "terminal session not found"),
            TerminalError::Backend(msg) => write!(f, "terminal backend error: {msg}"),
        }
    }
}

impl std::error::Error for TerminalError {}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalDataEvent {
    pub session_id: String,
    pub data: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitEvent {
    pub session_id: String,
}

pub struct TerminalManager {
    backend: Arc<dyn TerminalSessionManager>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            backend: Arc::new(PortablePtySessionManager::new()),
        }
    }

    /// Spawn a local interactive shell.
    ///
    /// `environment_tag` is stored as non-secret session metadata (in-memory only).
    pub fn open_local(
        &self,
        app: AppHandle,
        environment_tag: Option<String>,
        initial_cols: Option<u16>,
        initial_rows: Option<u16>,
    ) -> Result<SessionId, TerminalError> {
        let sh = shell::default_shell_command();
        self.spawn_process(
            app,
            SpawnSpec {
                kind: TerminalKind::Local,
                environment_tag: environment_tag.unwrap_or_else(|| "LOCAL".to_string()),
                initial_cols,
                initial_rows,
                program: sh.program,
                args: sh.args,
            },
        )
    }

    /// Spawn an SSH interactive session (system `ssh`).
    ///
    /// SSH is treated like any other spawned process: `spawn(program, args)`.
    pub fn open_ssh(
        &self,
        app: AppHandle,
        user: String,
        host: String,
        port: Option<u16>,
        identity_file: Option<String>,
        extra_args: Vec<String>,
        environment_tag: Option<String>,
        initial_cols: Option<u16>,
        initial_rows: Option<u16>,
    ) -> Result<SessionId, TerminalError> {
        let program = ssh::ssh_program_checked().map_err(TerminalError::Backend)?;
        let mut args = Vec::<String>::new();

        // Force TTY allocation for interactive sessions.
        args.push("-tt".to_string());

        if let Some(p) = port {
            args.push("-p".to_string());
            args.push(p.to_string());
        }

        if let Some(id) = identity_file {
            if !id.trim().is_empty() {
                args.push("-i".to_string());
                args.push(id);
            }
        }

        // Allow advanced flags via DB-stored non-secret metadata later.
        args.extend(extra_args.into_iter());

        args.push(format!("{user}@{host}"));

        self.spawn_process(
            app,
            SpawnSpec {
                kind: TerminalKind::Ssh,
                environment_tag: environment_tag.unwrap_or_else(|| "UNKNOWN".to_string()),
                initial_cols,
                initial_rows,
                program,
                args,
            },
        )
    }

    fn spawn_process(&self, app: AppHandle, spec: SpawnSpec) -> Result<SessionId, TerminalError> {
        self.backend.spawn(app, spec).map(SessionId)
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), TerminalError> {
        self.backend.write(session_id, data, WriteMeta::default())
    }

    pub fn write_with_meta(
        &self,
        session_id: &str,
        data: &str,
        meta: WriteMeta,
    ) -> Result<(), TerminalError> {
        self.backend.write(session_id, data, meta)
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), TerminalError> {
        self.backend.resize(session_id, cols, rows)
    }

    pub fn close(&self, session_id: &str) -> Result<(), TerminalError> {
        self.backend.close(session_id)
    }
}
