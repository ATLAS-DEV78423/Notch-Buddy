// Preferences, stored as plain JSON in settings.json under platform::config_dir().
// No secret ever lands here — API keys live in the OS keychain (see secrets.rs).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    pub hooks_installed: bool,
    /// Claude model used by the chat. Changeable in the settings window.
    /// Defaulted explicitly so a settings.json written by an older build still loads.
    #[serde(default = "default_model")]
    pub model: String,
    /// Chat provider: "anthropic" | "openai" | "nvidia" | "openrouter" | "opencode".
    #[serde(default = "default_chat_provider")]
    pub chat_provider: String,
    /// Provider id → model id. Empty means "use the provider's default".
    #[serde(default)]
    pub chat_models: HashMap<String, String>,
}

fn default_model() -> String {
    crate::claude::DEFAULT_MODEL.to_string()
}

fn default_chat_provider() -> String {
    "anthropic".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            active_integrations: vec![],
            screen: "primary".into(),
            autostart: false,
            hooks_installed: false,
            model: default_model(),
            chat_provider: default_chat_provider(),
            chat_models: HashMap::new(),
        }
    }
}

pub use crate::platform::{config_dir, local_dir};

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join(crate::platform::HOOK_EXE)
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Result<Settings, String> {
    load_from(&settings_path())
}

fn load_from(path: &std::path::Path) -> Result<Settings, String> {
    match std::fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<Settings>(&bytes)
            .map(migrate)
            .map_err(|err| format!("Can't parse {}: {err}; the file was left unchanged", path.display())),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(err) => Err(format!("Can't read {}: {err}; the file was left unchanged", path.display())),
    }
}

/// The notch lineup is now the standing agent roster (VS Code, Hermes,
/// OpenCode), so the integration Mochis left by the old shipped default are
/// cleared once. A customized list — anything other than exactly that old
/// default — is the user's choice and is left alone.
fn migrate(mut settings: Settings) -> Settings {
    const OLD_DEFAULT: [&str; 4] = [
        "integration_resend",
        "integration_n8n",
        "integration_vercel",
        "integration_github",
    ];
    if settings.active_integrations.len() == OLD_DEFAULT.len()
        && OLD_DEFAULT
            .iter()
            .all(|id| settings.active_integrations.iter().any(|x| x == id))
    {
        settings.active_integrations.clear();
    }
    settings
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    crate::platform::ensure_private_dir(&dir)?;
    save_at(&settings_path(), settings)
}

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(1);

fn save_at(path: &std::path::Path, settings: &Settings) -> std::io::Result<()> {
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let parent = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    std::fs::create_dir_all(parent)?;
    let suffix = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp = path.with_file_name(format!(".{}.tmp-{}-{suffix}", path.file_name().unwrap_or_default().to_string_lossy(), std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = options.open(&temp)?;
        file.write_all(&json)?;
        file.sync_all()?;
        drop(file);
        replace_atomically(&temp, path)?;
        sync_parent(parent)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

pub(crate) fn replace_atomically(temp: &std::path::Path, path: &std::path::Path) -> std::io::Result<()> {
    #[cfg(not(windows))]
    {
        std::fs::rename(temp, path)
    }
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        extern "system" {
            fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
        }
        const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
        const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
        let source: Vec<u16> = temp.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let target: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let ok = unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) };
        if ok == 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
    }
}

fn sync_parent(parent: &std::path::Path) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        std::fs::File::open(parent)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = parent;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_settings_are_reported_and_left_in_place() {
        let path = std::env::temp_dir().join(format!("coucou-settings-test-{}", std::process::id()));
        let original = br#"{ not json"#;
        std::fs::write(&path, original).unwrap();

        let error = load_from(&path).unwrap_err();
        assert!(error.contains("Can't parse"), "{error}");
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn settings_write_is_atomic_and_durable() {
        let dir = std::env::temp_dir().join(format!("coucou-settings-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("settings.json");
        let settings = Settings::default();

        save_at(&path, &settings).unwrap();
        let loaded: Settings = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(loaded.model, settings.model);
        let _ = std::fs::remove_dir_all(dir);
    }
}
