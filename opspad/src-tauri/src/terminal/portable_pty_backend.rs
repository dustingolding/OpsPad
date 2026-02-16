use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::{Arc, Mutex},
    thread,
    time::SystemTime,
};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use crate::terminal::{TerminalDataEvent, TerminalError, TerminalExitEvent};
use crate::terminal::session_manager::{SpawnSpec, TerminalSessionManager, WriteMeta};

#[derive(Debug)]
struct SessionMeta {
    environment_tag: String,
    cols: u16,
    rows: u16,
    last_commanddock_command: Option<String>,
    last_commanddock_at: Option<SystemTime>,
}

struct Session {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn portable_pty::MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    meta: Mutex<SessionMeta>,
}

#[derive(Default)]
pub struct PortablePtySessionManager {
    sessions: Arc<Mutex<HashMap<String, Arc<Session>>>>,
}

impl PortablePtySessionManager {
    pub fn new() -> Self {
        Self::default()
    }
}

impl TerminalSessionManager for PortablePtySessionManager {
    fn spawn(&self, app: AppHandle, spec: SpawnSpec) -> Result<String, TerminalError> {
        // Kind is currently used only by callers for UI/session bookkeeping.
        // Keep it in the API to avoid special-casing session types later.
        let _ = spec.kind;

        let rows = spec.initial_rows.unwrap_or(30);
        let cols = spec.initial_cols.unwrap_or(120);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::Backend(e.to_string()))?;

        let mut cmd = CommandBuilder::new(spec.program);
        cmd.args(spec.args);

        let mut child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| TerminalError::Backend(e.to_string()))?;
        let killer = child.clone_killer();

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| TerminalError::Backend(e.to_string()))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| TerminalError::Backend(e.to_string()))?;
        let master = pair.master;

        let session_id = Uuid::new_v4().to_string();
        let session = Arc::new(Session {
            writer: Mutex::new(writer),
            master: Mutex::new(master),
            killer: Mutex::new(killer),
            meta: Mutex::new(SessionMeta {
                environment_tag: spec.environment_tag,
                cols,
                rows,
                last_commanddock_command: None,
                last_commanddock_at: None,
            }),
        });

        self.sessions
            .lock()
            .expect("poisoned terminal sessions lock")
            .insert(session_id.clone(), session.clone());

        // Read loop: PTY -> tauri event.
        let app2 = app.clone();
        let session_id2 = session_id.clone();
        let sessions2 = self.sessions.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                let n = match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => n,
                    Err(_) => break,
                };
                let s = String::from_utf8_lossy(&buf[..n]).to_string();
                let _ = app2.emit(
                    "terminal:data",
                    TerminalDataEvent {
                        session_id: session_id2.clone(),
                        data: s,
                    },
                );
            }

            // On EOF/error: best-effort finalize. On Windows, PTY EOF isn't a reliable signal,
            // so we also finalize via a child wait thread below.
            let removed = {
                let mut map = sessions2.lock().expect("poisoned terminal sessions lock");
                map.remove(&session_id2).is_some()
            };
            if removed {
                let _ = app2.emit(
                    "terminal:exit",
                    TerminalExitEvent {
                        session_id: session_id2.clone(),
                    },
                );
            }
        });

        // Finalize on child exit (more reliable than PTY EOF on Windows).
        let app3 = app.clone();
        let session_id3 = session_id.clone();
        let sessions3 = self.sessions.clone();
        thread::spawn(move || {
            let _ = child.wait();
            let removed = {
                let mut map = sessions3.lock().expect("poisoned terminal sessions lock");
                map.remove(&session_id3).is_some()
            };
            if removed {
                let _ = app3.emit(
                    "terminal:exit",
                    TerminalExitEvent {
                        session_id: session_id3.clone(),
                    },
                );
            }
        });

        Ok(session_id)
    }

    fn write(&self, session_id: &str, data: &str, meta: WriteMeta) -> Result<(), TerminalError> {
        let session = self
            .sessions
            .lock()
            .expect("poisoned terminal sessions lock")
            .get(session_id)
            .cloned()
            .ok_or(TerminalError::NotFound)?;

        // Track "last command" only for structured CommandDock runs.
        // We do not attempt to infer typed commands from raw keystrokes to avoid capturing secrets.
        if meta.origin.as_deref() == Some("commanddock") {
            // Normalize to a reasonable size (in-memory only).
            let mut cmd = data.to_string();
            cmd = cmd.replace("\r", "").replace('\n', "");
            cmd = cmd.trim().to_string();
            if cmd.len() > 512 {
                cmd.truncate(512);
            }
            if !cmd.is_empty() {
                let mut m = session.meta.lock().expect("poisoned session meta lock");
                m.last_commanddock_command = Some(cmd);
                m.last_commanddock_at = Some(SystemTime::now());
            }
        }

        let mut w = session.writer.lock().expect("poisoned pty writer lock");
        w.write_all(data.as_bytes())
            .map_err(|e| TerminalError::Backend(e.to_string()))?;
        w.flush().ok();
        Ok(())
    }

    fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), TerminalError> {
        let session = self
            .sessions
            .lock()
            .expect("poisoned terminal sessions lock")
            .get(session_id)
            .cloned()
            .ok_or(TerminalError::NotFound)?;

        {
            let mut m = session.meta.lock().expect("poisoned session meta lock");
            m.cols = cols;
            m.rows = rows;
        }

        let master = session.master.lock().expect("poisoned pty master lock");
        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::Backend(e.to_string()))
    }

    fn close(&self, session_id: &str) -> Result<(), TerminalError> {
        let session = {
            let mut map = self.sessions.lock().expect("poisoned terminal sessions lock");
            map.remove(session_id)
        };

        let Some(session) = session else {
            return Err(TerminalError::NotFound);
        };

        // Best-effort terminate, but never block the UI thread on it.
        thread::spawn(move || {
            let _ = session.killer.lock().expect("poisoned killer lock").kill();
        });
        Ok(())
    }
}
