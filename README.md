# OpsPad

OpsPad is an SSH workspace (Tauri 2 + Rust backend + React/TypeScript frontend) with a built-in command notebook ("CommandDock"). It provides:

- Interactive local terminal tabs (PTY-backed).
- Interactive SSH tabs using the system `ssh` binary (key-based auth for MVP).
- A Host Manager persisted to SQLite (no secrets in SQLite).
- OS keyring-backed secret storage (Windows Credential Manager / macOS Keychain).
- CommandDock persisted to SQLite, with click-to-paste/run and `{param}` prompts.

This repo is Windows MVP today, but builds and packaging are supported on macOS as well.

## Repo Layout

- `opspad/`: the actual application project (Tauri 2).
- `BUILD.md`: build/implementation notes and guardrails.

## What's Implemented Today

- Terminal tabs are real sessions (local + SSH), and are closeable.
- Local terminal:
  - Rust PTY backend (`portable-pty`)
  - xterm.js frontend (`@xterm/xterm`)
- SSH:
  - Spawns the system SSH client (`ssh` from PATH; Windows fallback to `%SystemRoot%\\System32\\OpenSSH\\ssh.exe`)
  - PTY-backed interactive IO (resize + typing)
- Host Manager:
  - SQLite persistence in Tauri app data dir
  - Add/Edit/Delete
  - Clicking a host opens/activates an SSH tab (no reconnect on tab switching)
- Vault:
  - OS keyring via Rust `keyring` crate (no secrets in SQLite)
  - Host SSH key passphrase storage in keyring (MVP: no automatic passphrase injection into `ssh`)
- CommandDock:
  - SQLite persistence (commands + runbook)
  - Paste/Run targets the active terminal tab
  - Parameterized commands: `{name}` placeholders prompt for values before Paste/Run
  - Guardrail: if active context is `PROD`, OpsPad asks for confirmation before running commands
- Tauri IPC:
  - Locked down to only needed permissions (core event listen + `opspad-default`)

## Documentation Policy (Locked In)

When new features/enhancements are added, we will update:

- `README.md`
- `docs/USER_GUIDE.md`
- `docs/TROUBLESHOOTING.md`
- `docs/SECURITY.md`
- `docs/DECISIONS.md`

## Development

Prereqs (Windows):

- Node.js (installed in `C:\\Program Files\\nodejs`)
- Rust toolchain (stable)
- Visual Studio Build Tools (MSVC)
- WebView2 Runtime (typically already installed on Win 10/11)

Prereqs (macOS):

- Xcode (or Xcode Command Line Tools)
- Node.js `>= 20.19` (or `>= 22.12`) (Vite 7 requirement)
- Rust toolchain (stable) via rustup

Install deps:

```powershell
cd .\\opspad
corepack enable
pnpm i
```

Install deps (macOS):

```bash
cd ./opspad
npx -y pnpm@9.15.4 install
```

Run dev:

```powershell
cd .\\opspad
.\dev.ps1
```

Run dev (macOS):

```bash
cd ./opspad
./dev.sh
```

Notes:

- `dev.ps1` runs Visual Studio `VsDevCmd.bat` and sets PATH so `cargo`, `node`, and `pnpm` are available.
- You can also run without the script if your environment already has the MSVC toolchain + PATH set.

## Build / Package

Build the Windows bundles (MSI + NSIS + standalone exe):

```powershell
cd .\\opspad
.\build.ps1
```

Or:

```powershell
cd .\\opspad
corepack pnpm tauri build
```

Build macOS bundles (`.app` + `.dmg`):

```bash
cd ./opspad
./build.sh
```

Outputs (paths may vary by version):

- Standalone exe: `opspad/src-tauri/target/release/opspad.exe`
- MSI: `opspad/src-tauri/target/release/bundle/msi/OpsPad_*_x64_en-US.msi`
- NSIS: `opspad/src-tauri/target/release/bundle/nsis/OpsPad_*_x64-setup.exe`
- macOS app bundle: `opspad/src-tauri/target/release/bundle/macos/OpsPad.app`
- macOS dmg: `opspad/src-tauri/target/release/bundle/dmg/OpsPad_*_aarch64.dmg`

## CI (GitHub Actions)

This repo builds on GitHub Actions for both Windows and macOS:

- PR/push build: `.github/workflows/ci-build.yml` (unsigned)
  - Uploads build artifacts from `opspad/src-tauri/target/release/bundle/**`
- Release build: `.github/workflows/release-tauri.yml`
  - Intended for signed/notarized release artifacts (signing secrets not configured by default)

## macOS Build (Future Support)

OpsPad is being kept portable for future macOS support, but macOS bundles must be built on macOS (you cannot build a `.app`/`.dmg` from Windows).

On a Mac:

```bash
cd opspad
corepack enable
pnpm i
pnpm tauri build
```

Artifacts will be under `opspad/src-tauri/target/release/bundle/` (for example, a `.app` and possibly a `.dmg` depending on bundle targets).

## User Docs

- `docs/USER_GUIDE.md`
- `docs/TROUBLESHOOTING.md`
- `docs/SECURITY.md`
- `docs/DECISIONS.md`

