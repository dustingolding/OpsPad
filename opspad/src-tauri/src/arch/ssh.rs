/// Resolve the system `ssh` binary in a portable way.
///
/// MVP uses the OS-provided SSH client on PATH (Windows OpenSSH, macOS OpenSSH).
pub fn ssh_program() -> String {
    if let Ok(p) = std::env::var("OPSPAD_SSH") {
        let p = p.trim();
        if !p.is_empty() {
            return p.to_string();
        }
    }

    // Prefer PATH lookup when possible.
    if let Ok(p) = which::which("ssh") {
        return p.to_string_lossy().to_string();
    }

    // Fallback: bundled GUI apps can have a different PATH than a terminal.
    // We still use the system-provided ssh binary, just from standard locations.
    #[cfg(windows)]
    {
        use std::path::Path;
        if let Ok(root) = std::env::var("SystemRoot") {
            let openssh = Path::new(&root).join("System32").join("OpenSSH").join("ssh.exe");
            if openssh.exists() {
                return openssh.to_string_lossy().to_string();
            }
        }
    }

    "ssh".to_string()
}

/// Resolve ssh and return a user-friendly error if it's not available.
pub fn ssh_program_checked() -> Result<String, String> {
    let p = ssh_program();

    // If it's an absolute/relative path, ensure it exists. Otherwise, it is assumed to be on PATH.
    if p.contains('\\') || p.contains('/') {
        if std::path::Path::new(&p).exists() {
            return Ok(p);
        }
        return Err(format!("ssh binary not found at path: {p}"));
    }

    // If we fell back to the bare program name, double-check PATH.
    if which::which(&p).is_ok() {
        return Ok(p);
    }

    Err("ssh binary not found. Install OpenSSH client or set OPSPAD_SSH to a full path.".to_string())
}
