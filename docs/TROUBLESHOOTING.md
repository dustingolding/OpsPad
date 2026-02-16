# OpsPad Troubleshooting

## App issues

### Terminal won’t accept typing / cursor doesn’t move

Symptoms:

- You can click in the terminal but keystrokes do nothing.

Checks:

- Click inside the terminal pane once to focus it.
- If you see `[opspad] write failed: ...` in the terminal, it usually indicates a backend invoke/permission issue.

Fixes:

- Ensure you’re running a current installer build (MSI) and not an older one.
- If developing, run via `opspad/dev.ps1` to ensure MSVC + PATH are set.

### SSH won’t connect

Checks:

- Verify the host is reachable from your machine.
- Verify `ssh` works in a normal terminal:

```powershell
ssh user@host -p 22 -i C:\path\to\key
```

Fixes:

- Confirm the identity file path is correct.
- Confirm your key is accepted by the server.
- OpsPad uses the system `ssh` binary; ensure Windows OpenSSH is installed.

### Error: ssh binary not found

If OpsPad reports that it cannot find `ssh`:

- Install the Windows OpenSSH client, or
- Set the environment variable `OPSPAD_SSH` to the full path of `ssh.exe`.

### SSH session shows “Connection to X closed” and stays there

This can happen if the SSH process exited but the UI didn’t switch tabs.

Fixes:

- Install the newest build. OpsPad uses child-process exit detection to close SSH tabs and return to a local tab.

## Build / packaging issues (Windows)

### `pnpm` not recognized

If `pnpm` is not on PATH in your current shell:

- Use `corepack`:

```powershell
corepack pnpm -v
corepack pnpm install
corepack pnpm tauri build
```

- Or use `opspad/dev.ps1` and `opspad/build.ps1` which set PATH.

### Visual Studio build tools not found

The scripts expect `VsDevCmd.bat` at:

- `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat`

Fix:

- Install Visual Studio Build Tools 2022 (Desktop development with C++).

### WebView2 missing

Symptoms:

- App launches but shows a blank window, or fails to start on some machines.

Fix:

- Install Microsoft Edge WebView2 Runtime.

### Tauri build fails with `icons/icon.ico not found`

Fix:

- Ensure `opspad/src-tauri/icons/icon.ico` exists (required for Windows resource generation).

### MSI installs but doesn’t update

Fix:

- MSI upgrades are version-based. Ensure the app version was bumped and you’re installing the newest MSI.
