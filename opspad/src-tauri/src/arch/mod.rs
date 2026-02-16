//! Architectural seams to keep the codebase portable as we add macOS support.
//!
//! This module is intentionally "plumbing only": interfaces + platform-neutral helpers.

pub mod paths;
pub mod shell;
pub mod ssh;
pub mod vault;

