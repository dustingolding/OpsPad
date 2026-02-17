# OpsPad (Tauri + React + TypeScript)

This folder contains the OpsPad app project.

Repo docs live at:

- `README.md`
- `docs/USER_GUIDE.md`
- `docs/TROUBLESHOOTING.md`
- `docs/SECURITY.md`
- `docs/DECISIONS.md`

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## Development

Prereqs:

- Node.js `>= 20.19` (or `>= 22.12`) (Vite 7 requirement)
- Rust toolchain (stable)
- Windows only: Visual Studio Build Tools (MSVC)
- macOS only: Xcode (or Xcode Command Line Tools)

Run dev (Windows):

```powershell
.\dev.ps1
```

Run dev (macOS):

```bash
./dev.sh
```

## Build / Package

Build bundles (Windows):

```powershell
.\build.ps1
```

Build bundles (macOS):

```bash
./build.sh
```
