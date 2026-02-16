use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Host {
    pub id: String,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub environment_tag: String,
    pub identity_file: Option<String>,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostCreate {
    pub label: String,
    pub hostname: String,
    pub port: Option<u16>,
    pub username: String,
    pub environment_tag: String,
    pub identity_file: Option<String>,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostUpdate {
    pub id: String,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub environment_tag: String,
    pub identity_file: Option<String>,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockCommand {
    pub id: String,
    pub title: String,
    pub command: String,
    pub requires_confirm: bool,
    pub color: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DockCommandCreate {
    pub title: String,
    pub command: String,
    pub requires_confirm: Option<bool>,
    pub color: Option<String>,
}

pub struct Db {
    conn: Mutex<Connection>,
}

impl Db {
    pub fn open(app: &tauri::AppHandle) -> rusqlite::Result<(Self, PathBuf)> {
        let dir = app.path().app_data_dir().map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )))
        })?;
        std::fs::create_dir_all(&dir).map_err(|e| {
            rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(
                std::io::ErrorKind::Other,
                e.to_string(),
            )))
        })?;

        let path = dir.join("opspad.db");
        let conn = Connection::open(&path)?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        // Only seed demo data in debug builds. Release builds should start empty and
        // rely on real user-managed hosts.
        #[cfg(debug_assertions)]
        db.maybe_seed_demo_hosts()?;
        db.maybe_seed_commanddock()?;
        Ok((db, path))
    }

    fn migrate(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute_batch(
            r#"
            create table if not exists hosts (
              id text primary key,
              label text not null,
              hostname text not null,
              port integer not null,
              username text not null,
              environment_tag text not null,
              identity_file text null
            );

            create table if not exists dock_commands (
              id text primary key,
              title text not null,
              command text not null,
              requires_confirm integer not null default 0
            );

            create table if not exists dock_runbook (
              id integer primary key check (id = 1),
              markdown text not null
            );

            create table if not exists dock_history (
              id text primary key,
              created_at integer not null,
              scope text null,
              environment_tag text not null,
              command_text text not null,
              source_command_id text null,
              source_command_title text null,
              source_command_template text null
            );

            -- Maps an in-flight runtime terminal session id -> a stable "scope" string.
            -- Used to update persisted preferences without requiring session replay.
            create table if not exists terminal_session_scopes (
              session_id text primary key,
              scope text not null,
              created_at integer not null
            );

            -- Persisted, non-secret terminal/session preferences by scope.
            -- Scope examples:
            -- - "local"
            -- - "ssh:<host_id>"
            create table if not exists terminal_prefs (
              scope text primary key,
              environment_tag text not null,
              cols integer null,
              rows integer null,
              last_dock_command_id text null,
              last_dock_command_title text null,
              last_dock_command_template text null,
              updated_at integer not null
            );
            "#,
        )?;

        // Add sortable ordering columns for drag-and-drop ordering (SQLite can't do ADD COLUMN IF NOT EXISTS).
        if !Self::column_exists(&conn, "hosts", "sort_order")? {
            conn.execute("alter table hosts add column sort_order integer null", [])?;
            // Best-effort backfill using existing environment+label order.
            conn.execute_batch(
                r#"
                with ordered as (
                  select id, row_number() over (order by environment_tag asc, label asc) as rn
                  from hosts
                )
                update hosts
                set sort_order = (select rn from ordered where ordered.id = hosts.id);
                "#,
            ).ok();
        }

        if !Self::column_exists(&conn, "hosts", "color")? {
            conn.execute("alter table hosts add column color text null", [])?;
        }

        if !Self::column_exists(&conn, "dock_commands", "sort_order")? {
            conn.execute("alter table dock_commands add column sort_order integer null", [])?;
            conn.execute_batch(
                r#"
                with ordered as (
                  select id, row_number() over (order by title asc) as rn
                  from dock_commands
                )
                update dock_commands
                set sort_order = (select rn from ordered where ordered.id = dock_commands.id);
                "#,
            ).ok();
        }

        if !Self::column_exists(&conn, "dock_commands", "color")? {
            conn.execute("alter table dock_commands add column color text null", [])?;
        }

        Ok(())
    }

    fn column_exists(conn: &Connection, table: &str, column: &str) -> rusqlite::Result<bool> {
        let mut stmt = conn.prepare(&format!("pragma table_info({table})"))?;
        let mut rows = stmt.query([])?;
        while let Some(r) = rows.next()? {
            let name: String = r.get(1)?;
            if name == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn maybe_seed_commanddock(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");

        let runbook_count: i64 =
            conn.query_row("select count(1) from dock_runbook", [], |r| r.get(0))?;
        if runbook_count == 0 {
            conn.execute(
                "insert into dock_runbook (id, markdown) values (1, ?1)",
                params![
                    "# On-call quick checks\n- Verify environment label before running anything.\n- Prefer read-only commands first.\n- For PROD, require confirmation for destructive ops.\n"
                ],
            )?;
        }

        let cmd_count: i64 =
            conn.query_row("select count(1) from dock_commands", [], |r| r.get(0))?;
        if cmd_count == 0 {
            let demo = [
                ("Tail service logs", "journalctl -u {service} -f", 0i64),
                ("List pods", "kubectl get pods -n {ns}", 0i64),
                (
                    "Restart deployment (danger)",
                    "kubectl rollout restart deploy/{name} -n {ns}",
                    1i64,
                ),
            ];
            let mut i = 0i64;
            for (title, command, requires_confirm) in demo {
                i += 1;
                conn.execute(
                    "insert into dock_commands (id, title, command, requires_confirm, sort_order, color) values (?1, ?2, ?3, ?4, ?5, null)",
                    params![Uuid::new_v4().to_string(), title, command, requires_confirm, i],
                )?;
            }
        }

        Ok(())
    }

    #[cfg(debug_assertions)]
    fn maybe_seed_demo_hosts(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let count: i64 = conn.query_row("select count(1) from hosts", [], |r| r.get(0))?;
        if count > 0 {
            return Ok(());
        }

        let demo = [
            ("ops-bastion", "10.0.1.10", 22u16, "ubuntu", "DEV"),
            ("payments-api", "10.9.0.12", 22u16, "ubuntu", "STAGE"),
            ("prod-db-primary", "10.1.2.3", 22u16, "ubuntu", "PROD"),
        ];

        let mut i = 0i64;
        for (label, hostname, port, username, env) in demo {
            i += 1;
            conn.execute(
                "insert into hosts (id, label, hostname, port, username, environment_tag, identity_file, sort_order, color) values (?1, ?2, ?3, ?4, ?5, ?6, null, ?7, null)",
                params![Uuid::new_v4().to_string(), label, hostname, port as u32, username, env, i],
            )?;
        }
        Ok(())
    }

    pub fn hosts_list(&self) -> rusqlite::Result<Vec<Host>> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let mut stmt = conn.prepare(
            "select id, label, hostname, port, username, environment_tag, identity_file, color from hosts order by sort_order asc nulls last, environment_tag asc, label asc",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(Host {
                id: r.get(0)?,
                label: r.get(1)?,
                hostname: r.get(2)?,
                port: r.get::<_, u32>(3)? as u16,
                username: r.get(4)?,
                environment_tag: r.get(5)?,
                identity_file: r.get(6)?,
                color: r.get(7)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn hosts_create(&self, input: HostCreate) -> rusqlite::Result<Host> {
        let host = Host {
            id: Uuid::new_v4().to_string(),
            label: input.label,
            hostname: input.hostname,
            port: input.port.unwrap_or(22),
            username: input.username,
            environment_tag: input.environment_tag,
            identity_file: input.identity_file,
            color: input.color,
        };

        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let next: i64 = conn
            .query_row("select coalesce(max(sort_order), 0) + 1 from hosts", [], |r| r.get(0))
            .unwrap_or(1);
        conn.execute(
            "insert into hosts (id, label, hostname, port, username, environment_tag, identity_file, sort_order, color) values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                host.id,
                host.label,
                host.hostname,
                host.port as u32,
                host.username,
                host.environment_tag,
                host.identity_file,
                next,
                host.color
            ],
        )?;
        Ok(host)
    }

    pub fn hosts_delete(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute("delete from hosts where id = ?1", params![id])?;
        Ok(())
    }

    pub fn hosts_update(&self, input: HostUpdate) -> rusqlite::Result<Host> {
        let host = Host {
            id: input.id,
            label: input.label,
            hostname: input.hostname,
            port: input.port,
            username: input.username,
            environment_tag: input.environment_tag,
            identity_file: input.identity_file,
            color: input.color,
        };

        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute(
            "update hosts set label = ?2, hostname = ?3, port = ?4, username = ?5, environment_tag = ?6, identity_file = ?7, color = ?8 where id = ?1",
            params![
                host.id,
                host.label,
                host.hostname,
                host.port as u32,
                host.username,
                host.environment_tag,
                host.identity_file,
                host.color
            ],
        )?;

        Ok(host)
    }

    pub fn hosts_reorder(&self, ids: &[String]) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let tx = conn.unchecked_transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "update hosts set sort_order = ?2 where id = ?1",
                params![id, (i as i64) + 1],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn dock_commands_list(&self) -> rusqlite::Result<Vec<DockCommand>> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let mut stmt = conn.prepare(
            "select id, title, command, requires_confirm, color from dock_commands order by sort_order asc nulls last, title asc",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(DockCommand {
                id: r.get(0)?,
                title: r.get(1)?,
                command: r.get(2)?,
                requires_confirm: r.get::<_, i64>(3)? != 0,
                color: r.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn dock_commands_create(&self, input: DockCommandCreate) -> rusqlite::Result<DockCommand> {
        let cmd = DockCommand {
            id: Uuid::new_v4().to_string(),
            title: input.title,
            command: input.command,
            requires_confirm: input.requires_confirm.unwrap_or(false),
            color: input.color,
        };
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let next: i64 = conn
            .query_row("select coalesce(max(sort_order), 0) + 1 from dock_commands", [], |r| r.get(0))
            .unwrap_or(1);
        conn.execute(
            "insert into dock_commands (id, title, command, requires_confirm, sort_order, color) values (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                cmd.id,
                cmd.title,
                cmd.command,
                if cmd.requires_confirm { 1i64 } else { 0i64 },
                next,
                cmd.color
            ],
        )?;
        Ok(cmd)
    }

    pub fn dock_commands_update(&self, input: DockCommand) -> rusqlite::Result<DockCommand> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute(
            "update dock_commands set title = ?2, command = ?3, requires_confirm = ?4, color = ?5 where id = ?1",
            params![
                input.id,
                input.title,
                input.command,
                if input.requires_confirm { 1i64 } else { 0i64 },
                input.color
            ],
        )?;
        Ok(input)
    }

    pub fn dock_commands_delete(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute("delete from dock_commands where id = ?1", params![id])?;
        Ok(())
    }

    pub fn dock_commands_reorder(&self, ids: &[String]) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let tx = conn.unchecked_transaction()?;
        for (i, id) in ids.iter().enumerate() {
            tx.execute(
                "update dock_commands set sort_order = ?2 where id = ?1",
                params![id, (i as i64) + 1],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    pub fn dock_runbook_get(&self) -> rusqlite::Result<String> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let md: String = conn.query_row(
            "select markdown from dock_runbook where id = 1",
            [],
            |r| r.get(0),
        )?;
        Ok(md)
    }

    pub fn dock_runbook_set(&self, markdown: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute(
            "insert into dock_runbook (id, markdown) values (1, ?1)\n            on conflict(id) do update set markdown = excluded.markdown",
            params![markdown],
        )?;
        Ok(())
    }

    pub fn dock_history_add(
        &self,
        scope: Option<&str>,
        environment_tag: &str,
        command_text: &str,
        source_command_id: Option<&str>,
        source_command_title: Option<&str>,
        source_command_template: Option<&str>,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute(
            "insert into dock_history (id, created_at, scope, environment_tag, command_text, source_command_id, source_command_title, source_command_template)\n             values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                Uuid::new_v4().to_string(),
                Self::now_epoch_secs(),
                scope,
                environment_tag,
                command_text,
                source_command_id,
                source_command_title,
                source_command_template
            ],
        )?;

        // Keep history bounded (latest 300).
        conn.execute_batch(
            r#"
            delete from dock_history
            where id in (
              select id from dock_history
              order by created_at desc
              limit -1 offset 300
            );
            "#,
        )
        .ok();
        Ok(())
    }

    pub fn dock_history_list(&self, limit: i64) -> rusqlite::Result<Vec<(String, i64, String, String)>> {
        // Returns: (id, created_at, environment_tag, command_text)
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let mut stmt = conn.prepare(
            "select id, created_at, environment_tag, command_text from dock_history order by created_at desc limit ?1",
        )?;
        let rows = stmt.query_map(params![limit], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn dock_history_delete(&self, id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute("delete from dock_history where id = ?1", params![id])?;
        Ok(())
    }

    pub fn dock_history_clear(&self) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute("delete from dock_history", [])?;
        Ok(())
    }

    fn now_epoch_secs() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
    }

    pub fn terminal_session_scope_set(&self, session_id: &str, scope: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute(
            "insert into terminal_session_scopes (session_id, scope, created_at) values (?1, ?2, ?3)\n            on conflict(session_id) do update set scope = excluded.scope",
            params![session_id, scope, Self::now_epoch_secs()],
        )?;
        Ok(())
    }

    pub fn terminal_session_scope_get(&self, session_id: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let mut stmt = conn.prepare("select scope from terminal_session_scopes where session_id = ?1")?;
        let mut rows = stmt.query(params![session_id])?;
        if let Some(row) = rows.next()? {
            let s: String = row.get(0)?;
            return Ok(Some(s));
        }
        Ok(None)
    }

    pub fn terminal_session_scope_delete(&self, session_id: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute("delete from terminal_session_scopes where session_id = ?1", params![session_id])?;
        Ok(())
    }

    pub fn terminal_prefs_touch(&self, scope: &str, environment_tag: &str) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute(
            "insert into terminal_prefs (scope, environment_tag, cols, rows, last_dock_command_id, last_dock_command_title, last_dock_command_template, updated_at)\n            values (?1, ?2, null, null, null, null, null, ?3)\n            on conflict(scope) do update set environment_tag = excluded.environment_tag, updated_at = excluded.updated_at",
            params![scope, environment_tag, Self::now_epoch_secs()],
        )?;
        Ok(())
    }

    pub fn terminal_prefs_update_size(&self, scope: &str, cols: u16, rows: u16) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute(
            "insert into terminal_prefs (scope, environment_tag, cols, rows, last_dock_command_id, last_dock_command_title, last_dock_command_template, updated_at)\n            values (?1, 'UNKNOWN', ?2, ?3, null, null, null, ?4)\n            on conflict(scope) do update set cols = excluded.cols, rows = excluded.rows, updated_at = excluded.updated_at",
            params![scope, cols as i64, rows as i64, Self::now_epoch_secs()],
        )?;
        Ok(())
    }

    pub fn terminal_prefs_update_last_command(
        &self,
        scope: &str,
        dock_command_id: Option<&str>,
        dock_command_title: Option<&str>,
        dock_command_template: Option<&str>,
    ) -> rusqlite::Result<()> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        conn.execute(
            "insert into terminal_prefs (scope, environment_tag, cols, rows, last_dock_command_id, last_dock_command_title, last_dock_command_template, updated_at)\n            values (?1, 'UNKNOWN', null, null, ?2, ?3, ?4, ?5)\n            on conflict(scope) do update set last_dock_command_id = excluded.last_dock_command_id,\n              last_dock_command_title = excluded.last_dock_command_title,\n              last_dock_command_template = excluded.last_dock_command_template,\n              updated_at = excluded.updated_at",
            params![
                scope,
                dock_command_id,
                dock_command_title,
                dock_command_template,
                Self::now_epoch_secs()
            ],
        )?;
        Ok(())
    }

    pub fn terminal_prefs_get_size(&self, scope: &str) -> rusqlite::Result<Option<(u16, u16)>> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let mut stmt = conn.prepare("select cols, rows from terminal_prefs where scope = ?1")?;
        let mut rows = stmt.query(params![scope])?;
        if let Some(row) = rows.next()? {
            let cols: Option<i64> = row.get(0)?;
            let rws: Option<i64> = row.get(1)?;
            if let (Some(c), Some(r)) = (cols, rws) {
                if c > 0 && r > 0 {
                    return Ok(Some((c as u16, r as u16)));
                }
            }
        }
        Ok(None)
    }

    pub fn terminal_prefs_get_env(&self, scope: &str) -> rusqlite::Result<Option<String>> {
        let conn = self.conn.lock().expect("poisoned sqlite lock");
        let mut stmt = conn.prepare("select environment_tag from terminal_prefs where scope = ?1")?;
        let mut rows = stmt.query(params![scope])?;
        if let Some(row) = rows.next()? {
            let env: String = row.get(0)?;
            return Ok(Some(env));
        }
        Ok(None)
    }
}
