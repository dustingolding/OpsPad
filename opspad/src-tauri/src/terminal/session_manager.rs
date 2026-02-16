use tauri::AppHandle;

use crate::terminal::TerminalError;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TerminalKind {
    Local,
    Ssh,
}

#[derive(Clone, Debug)]
pub struct SpawnSpec {
    pub kind: TerminalKind,
    pub environment_tag: String,
    pub initial_cols: Option<u16>,
    pub initial_rows: Option<u16>,
    pub program: String,
    pub args: Vec<String>,
}

#[derive(Clone, Debug, Default)]
pub struct WriteMeta {
    /// Where the write came from (e.g. "user", "commanddock").
    ///
    /// This is used only for non-secret in-memory session metadata tracking.
    pub origin: Option<String>,
}

pub trait TerminalSessionManager: Send + Sync {
    fn spawn(&self, app: AppHandle, spec: SpawnSpec) -> Result<String, TerminalError>;
    fn write(&self, session_id: &str, data: &str, meta: WriteMeta) -> Result<(), TerminalError>;
    fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), TerminalError>;
    fn close(&self, session_id: &str) -> Result<(), TerminalError>;
}
