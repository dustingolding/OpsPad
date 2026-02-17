# OpsPad Architectural Decisions

This file records the current architectural choices for OpsPad. When decisions change, this doc should be updated.

## Desktop MVP, Cross-Platform (Windows + macOS)

- Windows is the MVP platform, but macOS is supported for development/builds.
- Packaging is handled by `tauri build` on both platforms (Windows bundles; macOS `.app` + `.dmg`).
- Code signing/notarization is not configured by default (see release workflow notes).

## Terminal UI: xterm.js

Decision:

- Use xterm.js in the frontend for terminal rendering and input.

Rationale:

- Avoid implementing a custom terminal emulator.
- Mature ecosystem; common for Tauri terminal apps.

## PTY Backend: portable-pty

Decision:

- Use `portable-pty` to spawn local shells and SSH subprocesses behind a PTY.
- Keep the PTY implementation behind a Rust abstraction (`TerminalSessionManager`), so we can swap implementations later without changing Tauri commands or the UI.

Rationale:

- Provides interactive terminal behavior (typing, resize) across platforms.
- Avoids leaking `portable-pty` types through the rest of the codebase.

## Terminal Process Model (MVP)

Decision:

- Treat "local shell" and "ssh" as just different spawned processes behind the same PTY pipeline.

Rationale:

- Keeps the architecture portable across Windows/macOS.
- Makes it easier to add future session types without rewriting the pipeline.

## SSH Engine: system ssh binary (MVP)

Decision:

- Spawn the system `ssh` binary for SSH sessions (no password injection).

Rationale:

- Lowest-risk path for a stable interactive SSH on Windows.
- Avoid early complexity of a native Rust SSH client.

Non-goals for MVP:

- Password injection into `ssh`.
- Full `~/.ssh/config` import (can be added later).

## Secrets: OS Keyring Only (MVP)

Decision:

- Store secrets only in the OS keyring via Rust `keyring` (Windows Credential Manager, macOS Keychain).
- Do not store secrets in SQLite.

Rationale:

- Fastest secure path; OS-protected secrets.
- Avoid building a custom encrypted vault for MVP.

Future:

- Add additional vault providers (encrypted vault, org-managed secrets) behind a `VaultProvider` interface.

## Data: SQLite for metadata

Decision:

- Store non-secret metadata (hosts, commands, runbook) in SQLite under the Tauri app data directory.

Rationale:

- Simple, local-first persistence; good fit for desktop.

## CommandDock: local-first persistence and execution

Decision:

- Persist CommandDock content locally in SQLite.
- Execution is via "Paste" and "Run" into the active terminal session.
- Parameter prompts use `{name}` placeholders.

Rationale:

- Keeps execution consistent across local + SSH sessions.
- Avoids complex remote execution plumbing in MVP.

## Session Metadata Persistence (Non-Replay)

Decision:

- Persist lightweight session preferences to SQLite (environment tag, terminal size, last CommandDock-run command template).
- Do not replay sessions on restart.

Rationale:

- Improves usability without trying to reconstruct interactive state.
- Keeps persistence non-secret and local-first.

## Tauri v2 IPC Capabilities

Decision:

- Restrict IPC permissions to only what the UI needs (custom `opspad-default` commands plus core event listen).

Rationale:

- Reduces the attack surface of the app's IPC channel.
