use std::fmt;

#[derive(Debug)]
pub enum VaultError {
    Unsupported,
    NotFound,
    Backend(String),
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            VaultError::Unsupported => write!(f, "vault operation unsupported on this platform"),
            VaultError::NotFound => write!(f, "secret not found"),
            VaultError::Backend(msg) => write!(f, "vault backend error: {msg}"),
        }
    }
}

impl std::error::Error for VaultError {}

pub trait VaultProvider: Send + Sync {
    fn set_secret(&self, key: &str, secret: &[u8]) -> Result<(), VaultError>;
    fn get_secret(&self, key: &str) -> Result<Option<Vec<u8>>, VaultError>;
    fn delete_secret(&self, key: &str) -> Result<(), VaultError>;
}

/// MVP vault provider.
///
/// Windows: Credential Manager
/// macOS (future): Keychain
///
/// We keep this behind a provider trait so we can later add a distinct
/// `EncryptedSqliteVault` without disturbing callers.
pub struct OsKeyringVault {
    service: String,
}

impl OsKeyringVault {
    pub fn new(service: impl Into<String>) -> Self {
        Self {
            service: service.into(),
        }
    }

    fn entry(&self, key: &str) -> Result<keyring::Entry, VaultError> {
        // keyring crate maps to the OS secure store (Windows Credential Manager, macOS Keychain).
        keyring::Entry::new(&self.service, key).map_err(|e| VaultError::Backend(e.to_string()))
    }
}

impl VaultProvider for OsKeyringVault {
    fn set_secret(&self, key: &str, secret: &[u8]) -> Result<(), VaultError> {
        self.entry(key)?
            .set_secret(secret)
            .map_err(|e| VaultError::Backend(e.to_string()))
    }

    fn get_secret(&self, key: &str) -> Result<Option<Vec<u8>>, VaultError> {
        match self.entry(key)?.get_secret() {
            Ok(bytes) => Ok(Some(bytes)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(VaultError::Backend(e.to_string())),
        }
    }

    fn delete_secret(&self, key: &str) -> Result<(), VaultError> {
        match self.entry(key)?.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(VaultError::Backend(e.to_string())),
        }
    }
}

/// Construct the MVP vault provider.
///
/// Callers should depend on the `VaultProvider` trait, not on the concrete type,
/// so we can swap/extend implementations later (macOS Keychain, encrypted vault, etc.).
pub fn default_vault_provider() -> Box<dyn VaultProvider> {
    Box::new(OsKeyringVault::new("OpsPad"))
}
