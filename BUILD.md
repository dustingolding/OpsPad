# BUILD.md - OpsPad (Tauri + Rust + xterm.js) - Codex Build & Implementation Plan
> Goal: Build **OpsPad** (Windows-first) - a secure SSH workspace with a **CommandDock** side panel (runbooks + reusable commands), using **Tauri 2**, **Rust**, **SQLite**, and **xterm.js**.
>
> Architectural guardrails:
> - **Do NOT** implement a terminal emulator from scratch (use **xterm.js**).
> - **Do NOT** store secrets in SQLite. Use OS secure store (Windows Credential Manager via keyring).
> - Keep MVP tight: SSH + Host Manager + CommandDock + Vault + Local DB + Tabbed terminal.

Cross-platform direction (locked in):
- Windows remains the MVP platform, but we are designing seams for future macOS support (no mac packaging yet).
- Vault: `VaultProvider` interface. MVP uses OS secure storage (Windows Credential Manager). Future macOS backend uses Keychain. No secrets in SQLite.
- Shells: default shell selection is platform-dependent (Windows: PowerShell, macOS: zsh) and must not hardcode absolute shell paths.
- Paths: all filesystem locations must use Tauri app directories (app data/log dirs), not OS-specific hardcoded paths.
- SSH: use the system `ssh` binary generically via PATH (allow override), not Windows-specific paths.
---
## 0) Prerequisites (Windows dev machine)
### Required
- Git
- Node.js LTS + a package manager (pnpm recommended)
- Rust toolchain (stable) + `cargo`
- Visual Studio Build Tools (C++ build tools)
- WebView2 runtime (typically already on Win 10/11)
- Tauri 2 tooling via `create-tauri-app` / `tauri` CLI (Tauri 2 is stable and uses a permissions/capabilities system-design around it) 
### Recommended
- `just` (task runner) or `make` equivalent
- `cargo-audit`, `cargo-deny`
- `sqlx-cli` (if using sqlx migrations)

## 0.1) Prerequisites (macOS build machine - future support)

OpsPad is Windows-first for MVP, but we keep the codebase portable for macOS. macOS bundles must be built on macOS (you cannot build a `.app`/`.dmg` on Windows).

Required on macOS:

- Xcode Command Line Tools (`xcode-select --install`)
- Rust toolchain (stable)
- Node.js + pnpm via corepack

Build on macOS:

```bash
cd opspad
corepack enable
pnpm i
pnpm tauri build
```
---
## 1) Repo bootstrap
### 1.1 Create the Tauri project
Use `create-tauri-app` per Tauri 2 docs. 
Example (PowerShell):
```powershell
mkdir OpsPad
cd OpsPad
pnpm create tauri-app@latest .
Choose:
-	Frontend framework: React (or Svelte/Vue; React assumed below)
-	Language: TypeScript
-	Template: default
-	Identifier: com.opspad.app
1.2 Install deps
pnpm install



2) High-level MVP implementation milestones
Milestone A - UI Shell + Navigation
Deliver:
-	3-panel layout: Hosts (left), Terminal tabs (center), CommandDock (right)
-	App routes/views:
o	HostsView
o	TerminalView
o	CommandDockView
o	SettingsView (vault lock, backups, theme, confirmations)
Acceptance:
-	App launches, shows empty host list + placeholder terminal + command panel.
________________________________________
Milestone B - Local Database (SQLite) + Data Model
Use SQLite for hosts/commands/notes metadata.
-	Recommended Rust DB layer: sqlx + SQLite (migrations) OR rusqlite (simpler).
Tables (MVP):
-	hosts
-	commands
-	command_versions (optional in MVP; strongly recommended)
-	notes
-	settings
Rules:
-	No secrets stored here (ever).
Acceptance:
-	CRUD for hosts + commands + notes works via Tauri commands.
-	Search by host/tag works.
________________________________________
Milestone C - Secure Vault (OS Credential Store)
Store:
-	Passwords (if allowed)
-	Private key passphrases (if needed)
-	Pinned tokens (future)
Implementation:
-	Use Rust keyring crate for OS secure store (Windows Credential Manager). 
-	Optionally use tauri-plugin-keyring wrapper to expose keyring methods to frontend. 
Rules:
-	Never log secrets.
-	Provide "Lock OpsPad" behavior: require OS auth (Windows Hello if enabled) before retrieving secrets.
Acceptance:
-	Can save/retrieve a host credential entry through the vault.
-	Vault entries are not visible in SQLite.
________________________________________
Milestone D - Terminal integration (xterm.js) + Local PTY smoke test
Before SSH, validate terminal pipeline locally:
-	Embed xterm.js in the webview.
-	Use portable-pty on Rust side to spawn a local shell and pipe IO.
Reference example project: tauri-terminal demonstrates xterm.js + portable-pty pattern. 
Acceptance:
-	A local terminal tab opens and runs cmd or powershell with interactive input/output.
________________________________________
Milestone E - SSH session engine + PTY + tab management
Option 1 (Recommended for MVP): Use system OpenSSH as a subprocess
-	Spawn ssh.exe with args
-	Pipe IO to xterm.js via PTY layer
Pros:
-	Fastest to ship on Windows
-	Stable behavior
Cons:
-	Less control over jump hosts / advanced features without parsing configs
Option 2 (Planned for v1.x/v2): Native Rust SSH via russh
-	Use russh for client + PTY interactive shell (requires selecting a crypto backend feature such as aws-lc-rs or ring). 
MVP acceptance (either option):
-	Open SSH session to a saved host
-	Interactive shell works (resize, backspace, arrows)
-	Multiple sessions in tabs
-	Host key verification at least via OpenSSH known_hosts (Option 1) or custom known_hosts store (Option 2)
________________________________________
Milestone F - CommandDock (runbooks + click-to-run)
Implement core differentiator:
-	Global command library + host-specific commands
-	Markdown notes per host
-	"Click to Paste" and "Click to Run"
-	Parameter prompts (simple JSON schema) for commands like:
o	kubectl logs {pod}
o	journalctl -u {service} -f
Safety:
-	Require confirmation for "dangerous" commands (flag on command)
-	Display environment badge (e.g., PRODUCTION) and warn if command context mismatched
Acceptance:
-	Create command -> appears in side panel
-	Click -> pastes into active terminal
-	"Run" executes in the active session after confirmation when required
________________________________________
Milestone G - Packaging (MSI) + Release build
Use tauri build to generate bundles/installers. 
Acceptance:
-	tauri build produces a Windows installer artifact
-	Clean install/uninstall
-	Data stored under user profile; vault remains in OS credential store

3) Concrete implementation steps (Codex checklist)
3.1 Frontend: xterm.js + app layout
Add deps:
pnpm add @xterm/xterm @xterm/addon-fit
Create components:
-	TerminalPane.tsx
-	HostsSidebar.tsx
-	CommandDock.tsx
TerminalPane responsibilities:
-	Create xterm instance
-	Fit addon on resize
-	Emit keystrokes to backend via Tauri invoke/event
-	Receive output stream via Tauri events
________________________________________
3.2 Backend: Rust command surface (Tauri 2)
Create a backend module structure:
-	src-tauri/src/db/
-	src-tauri/src/vault/
-	src-tauri/src/terminal/
-	src-tauri/src/ssh/
-	src-tauri/src/models/
Expose Tauri commands (MVP):
-	hosts_list, hosts_create, hosts_update, hosts_delete
-	commands_list, commands_create, commands_update, commands_delete
-	notes_get, notes_set
-	vault_set_secret, vault_get_secret, vault_delete_secret
-	terminal_open_local, terminal_write, terminal_resize, terminal_close
-	ssh_connect, ssh_disconnect (Option 1 uses subprocess)
Use Tauri 2 permission/capability config to restrict commands. 
________________________________________
3.3 Database setup
Pick one:
A) sqlx (recommended)
Add crates in src-tauri/Cargo.toml:
-	sqlx = { version = "...", features = ["sqlite", "runtime-tokio", "macros"] }
-	tokio
-	serde, serde_json
Create migrations:
-	src-tauri/migrations/0001_init.sql
Ensure DB path:
-	Use Tauri app data dir (per-user)
-	Example: %APPDATA%/OpsPad/opspad.db
B) rusqlite (simpler)
-	rusqlite, r2d2, r2d2_sqlite optional
Acceptance criteria:
-	Migrations run on startup
-	CRUD endpoints work
________________________________________
3.4 Vault (keyring)
Add crate:
-	keyring = "..." 
Vault conventions:
-	Service name: OpsPad
-	Account key format:
o	host:{host_id}:password
o	host:{host_id}:key_passphrase
-	Store only secrets; store metadata in SQLite if needed (e.g., "has_password": true)
________________________________________
3.5 Terminal pipeline (xterm.js <-> backend)
Backend should manage a per-tab "session id":
-	Maintain a map: session_id -> pty_handle
-	Emit output via tauri::event::emit to the frontend channel:
o	terminal:data:{session_id}
Start with local PTY to validate plumbing:
-	Windows: spawn powershell.exe or cmd.exe
-	Use portable-pty (Rust) as in known patterns. 
________________________________________
3.6 SSH connection (MVP using OpenSSH subprocess)
Implement:
-	ssh_connect(host_id):
o	Resolve host config from DB
o	If password auth:
ï‚§	Prefer key-based first; password is tricky to feed securely to ssh.exe
ï‚§	For MVP, require key auth OR use sshpass-like behavior is NOT acceptable on Windows
o	Use ssh.exe -tt user@host -p port
o	Pipe IO through PTY layer (or directly through stdin/stdout with careful handling)
Strong MVP recommendation:
-	Key-based auth only in v1.0 to avoid password injection complexity and security issues.
-	Add password auth later with native russh (v1.x) if required.
4) Dev workflow commands
Run dev
pnpm tauri dev
Build release
pnpm tauri build

5) Testing & Quality Gates
Unit tests (Rust)
-	DB migrations
-	CRUD logic
-	Vault set/get/delete (mock where needed)
Integration tests
-	Local PTY session opens
-	Terminal IO round-trip
-	CommandDock paste/run flows
Security checks
-	cargo audit
-	Ensure logs never include secrets
-	Validate Tauri permissions (only needed commands enabled)
6) MVP Definition (Do not exceed)
Included:
-	Host manager (CRUD, tags, env labels)
-	xterm.js terminal tabs
-	Local PTY validated
-	SSH connect via OpenSSH subprocess (key auth)
-	CommandDock: commands + markdown notes + click-to-paste/click-to-run
-	Vault: keyring integration
Excluded:
-	Cloud sync
-	AI features
-	Kubernetes UI panels
-	SFTP/file browser
-	Jump host UI (can be in advanced config later)
7) Repo structure (recommended)
OpsPad/
  src/
    components/
      HostsSidebar.tsx
      TerminalPane.tsx
      CommandDock.tsx
    pages/
      AppShell.tsx
      Settings.tsx
    lib/
      api.ts        # typed invoke wrappers
      types.ts
  src-tauri/
    src/
      main.rs
      models/
      db/
      vault/
      terminal/
      ssh/
    migrations/
      0001_init.sql
8) Notes for Codex (decision rules)
-	If any terminal rendering/pty issues occur: reproduce first with local PTY only before blaming SSH.
-	Keep secrets out of DB, config files, logs.
-	Prefer capabilities/permissions in Tauri 2 for least-privileged command exposure. 
-	Treat "production environment" labeling as a safety feature, not decoration.
9) References (for implementation patterns)
-	Tauri 2 Create Project docs 
-	Tauri 2 stable + permissions/capabilities 
-	tauri-terminal example (xterm.js + portable-pty) 
-	russh SSH library + docs 
-	Rust keyring secure store 
-	Tauri CLI build (tauri build) 


