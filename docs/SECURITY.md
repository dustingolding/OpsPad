# OpsPad Security

This document describes what OpsPad stores, where it stores it, and what it avoids storing/logging.

## Storage Overview

### SQLite (non-secret metadata only)

OpsPad stores non-secret app data in a SQLite database located in the Tauri app data directory (per-user).

Currently stored in SQLite:

- Hosts:
  - label, hostname, port, username, environment tag
  - optional identity file path (reference only)
- CommandDock:
  - runbook markdown
  - commands (title, command text, requires-confirm flag)

Not stored in SQLite:

- passwords
- SSH private keys
- SSH key passphrases
- tokens

### OS Keyring (secrets)

OpsPad uses the OS keyring for secrets:

- Windows: Windows Credential Manager via Rust `keyring` crate.
- macOS: Keychain via Rust `keyring` crate.

Examples of key format:

- `host:<host_id>:ssh_key_passphrase`

## Logging

Guidelines:

- Do not log secrets.
- Do not log secret material embedded in commands.

Current behavior:

- Terminal output is displayed in the UI; OpsPad does not intentionally persist terminal streams as a feature.
- Any future logging/telemetry must remain local-only for MVP and must not include secrets.

## Session Metadata (Non-Secret)

OpsPad tracks a small amount of session metadata for usability and persists it to SQLite (non-secret):

- terminal size (cols/rows)
- environment tag (LOCAL/DEV/STAGE/PROD/etc.)
- last command executed via CommandDock "Run" (OpsPad does not try to infer typed commands from keystrokes to avoid capturing secrets)

What is persisted:

- The CommandDock command id/title/template (not typed keystrokes; not inferred shell history)
- Parameter values entered at run time are not persisted by OpsPad (only the template is).

## Command History

OpsPad stores a local-only CommandDock history of commands executed via CommandDock "Run" (not typed keystrokes).

Notes:

- History entries store the command text that was sent to the active terminal (which may include substituted parameter values).
- Do not use CommandDock history for secrets. Avoid putting passwords/tokens into commands or parameters.

## SSH Security Model (MVP)

- OpsPad spawns the system `ssh` binary for SSH sessions.
- Authentication is expected to be key-based for MVP.
- OpsPad does not inject passwords/passphrases into `ssh` in the MVP.

## Threat Model Notes (Practical)

OpsPad is a desktop app embedding a webview. Primary risks:

- Persisting secrets to disk (mitigated: OS keyring only).
- Accidentally logging secrets (mitigated by policy; review logs/features when added).
- Running destructive commands (mitigated by per-command confirm flag and future safety UX).
