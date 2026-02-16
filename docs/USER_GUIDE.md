# OpsPad User Guide

## Overview

OpsPad is an SSH workspace with a built-in CommandDock. The center panel is a tabbed terminal workspace. Tabs can be local terminals or SSH sessions.

## Terminal Tabs

- Click `+` to open a new local terminal tab.
- Each tab represents a real session.
- Click `x` on a tab to close it.
- Drag tabs to reorder them.

## Active Context Badge

The top-right badge shows the environment of the active tab:

- `LOCAL` for local terminals
- `DEV` / `STAGE` / `PROD` for SSH sessions (from the host's environment tag)

### Local Terminal

Local terminals run your default shell (Windows: PowerShell). Type commands as you would in a normal terminal.

### SSH Sessions

1. Add a host in the Hosts panel (left), or select an existing host.
2. Click the host row to connect.
3. OpsPad opens or activates a tab for that host.

Notes:

- MVP uses the system `ssh` program (OpenSSH).
- Key-based auth is expected for MVP.
- If you type `exit` in an SSH session, OpsPad switches you back to a local tab and the SSH tab becomes disconnected (it can be reconnected by clicking the host again).

## Hosts (Left Panel)

### Add a Host

1. Click `+` (bottom-right of the Hosts panel).
2. Fill in:
   - Label
   - Hostname
   - Port
   - Username
   - Environment
   - Identity file (optional)
3. Click `Create`.

### Host Filter (Search + Tags)

The filter supports free-text search, plus simple `key:value` tokens:

- `tag:prod` or `env:prod`
- `user:ubuntu`
- `host:192.168.1.10`
- `label:k3s`
- `port:22`
- `key:id_ed25519` (identity file path contains)

### Edit a Host

1. Click `Edit` on a host row.
2. Update fields.
3. Click `Save`.

### Delete a Host

1. Click `-` (bottom-right of the Hosts panel) to enter delete mode.
2. Click `x` on a host row.
3. Confirm deletion.

### Reorder Hosts

- Drag the handle (`⋮⋮`) to reorder hosts.
- Note: reordering is disabled while the filter/search box is non-empty.

### Minimize/Expand Hosts Pane

- Click `<` / `>` in the Hosts panel header to minimize/expand the pane.

## Credentials (OS Keyring)

OpsPad stores secrets in the OS keyring (Windows Credential Manager for MVP). Secrets are not stored in SQLite.

In the host editor, you can optionally store an SSH key passphrase:

1. Open `Edit` on a host.
2. In "Credentials (OS keyring)", enter a passphrase.
3. Click `Save passphrase`.

Notes:

- MVP does not automatically inject passphrases into `ssh`.
- Use `Reveal` to view a stored passphrase (when available), and `Clear` to remove it.

## CommandDock (Right Panel)

CommandDock stores a runbook (markdown) and reusable commands.

### Runbook

- Click `Edit` on the Runbook card to update markdown.
- Click `Save` to persist.

### Commands

- Click `+` (bottom-right of CommandDock) to create a command (title, command text, and optional confirm).
- Each command row supports:
  - `Paste`: pastes the command into the active terminal tab.
  - `Run`: sends the command plus Enter to the active terminal tab.
  - `Edit`: edit the command.

### Delete Commands

1. Click `-` (bottom-right of CommandDock) to enter delete mode.
2. Click `x` on a command row.
3. Confirm deletion.

### Reorder Commands

- Drag the handle (`⋮⋮`) to reorder commands.
- Note: reordering is disabled while the search box is non-empty.

### History

CommandDock includes a History view that shows commands previously executed via CommandDock "Run".

- Use `History` in the CommandDock header to switch views.
- From history you can:
  - `Paste` a previous command into the active terminal
  - `Save` it into CommandDock commands
  - `x` to delete an entry (or `Clear` to wipe history)

### Parameterized Commands

If a command contains `{placeholders}` (example: `kubectl get pods -n {ns}`), OpsPad will prompt you for values when you click `Paste` or `Run`.

- Values are substituted into the command before sending to the terminal.
- OpsPad remembers the last values you used for that command (stored locally, non-secret).

### Production Guardrail

If the active context badge shows `PROD`, OpsPad will ask for confirmation before running commands (even if a command is not marked as dangerous).
