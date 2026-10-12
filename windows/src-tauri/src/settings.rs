// Preferences, stored as plain JSON in settings.json under platform::config_dir().
// No secret ever lands here — API keys live in the OS keychain (see secrets.rs).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

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

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice::<Settings>(&bytes)
            .map(migrate)
            .unwrap_or_default(),
        Err(_) => Settings::default(),
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
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}
