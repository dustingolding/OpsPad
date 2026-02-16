use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct ShellCommand {
  pub program: String,
  pub args: Vec<String>,
}

impl ShellCommand {
    pub fn new(program: impl Into<String>, args: Vec<String>) -> Self {
        Self {
            program: program.into(),
            args,
        }
    }
}

fn find_in_path(program: &str) -> Option<String> {
  // Avoid hardcoding absolute paths; rely on PATH lookup.
  // This keeps us portable across Windows/macOS/Linux.
  which::which(program)
    .ok()
    .map(|p: PathBuf| p.to_string_lossy().to_string())
}

#[cfg(windows)]
fn try_known_windows_locations() -> Vec<String> {
  use std::path::Path;

  let mut out = Vec::new();

  // Prefer PowerShell 7 if installed.
  if let Ok(pf) = std::env::var("ProgramFiles") {
    let p = Path::new(&pf).join("PowerShell").join("7").join("pwsh.exe");
    if p.exists() {
      out.push(p.to_string_lossy().to_string());
    }
  }
  if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
    let p = Path::new(&pf86).join("PowerShell").join("7").join("pwsh.exe");
    if p.exists() {
      out.push(p.to_string_lossy().to_string());
    }
  }

  // Windows PowerShell (5.1) is typically under System32.
  if let Ok(root) = std::env::var("SystemRoot") {
    let p = Path::new(&root)
      .join("System32")
      .join("WindowsPowerShell")
      .join("v1.0")
      .join("powershell.exe");
    if p.exists() {
      out.push(p.to_string_lossy().to_string());
    }
  }

  out
}

/// Default shell for a new local terminal session.
///
/// Windows MVP: prefer `pwsh` (PowerShell 7) if available, else `powershell`.
/// macOS future: prefer `$SHELL`, else `zsh`.
pub fn default_shell_command() -> ShellCommand {
  #[cfg(windows)]
  {
    if let Some(p) = find_in_path("pwsh") {
      return ShellCommand::new(p, vec![]);
    }
    if let Some(p) = find_in_path("powershell") {
      return ShellCommand::new(p, vec![]);
    }
    // Bundled GUI apps can sometimes have a different PATH than an interactive shell.
    // As a fallback, try standard install locations derived from environment variables.
    for candidate in try_known_windows_locations() {
      return ShellCommand::new(candidate, vec![]);
    }
    // Last resort: program name and hope it's discoverable.
    return ShellCommand::new("powershell", vec![]);
  }

    #[cfg(not(windows))]
    {
        if let Ok(shell) = std::env::var("SHELL") {
            if !shell.trim().is_empty() {
                return ShellCommand::new(shell, vec![]);
            }
        }
        if let Some(p) = find_in_path("zsh") {
            return ShellCommand::new(p, vec![]);
        }
        ShellCommand::new("zsh", vec![])
    }
}
