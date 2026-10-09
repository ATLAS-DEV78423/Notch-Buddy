// Weather — current conditions from wttr.in (no API key). One background
// thread fetches every 30 minutes and emits `weather-update`. Parks on the
// shared PollGate like the other pollers, so a hidden island makes no network
// calls at all.

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::island::{PollGate, WINDOW_LABEL};
use crate::log;

const INTERVAL: Duration = Duration::from_secs(1800);
const TIMEOUT: Duration = Duration::from_secs(10);

/// `weather-update` payload — field names match `State.weather` on the island.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WeatherData {
    temp: f32,
    condition: String,
    humidity: u32,
    wind: f32,
}

// wttr.in `?format=j1` — every numeric field arrives as a string.

#[derive(serde::Deserialize)]
struct WttrCurrent {
    #[serde(rename = "temp_C")]
    temp_c: String,
    humidity: String,
    #[serde(rename = "windspeedKmph")]
    windspeed_kmph: String,
    #[serde(rename = "weatherDesc")]
    weather_desc: Vec<WttrDesc>,
}

#[derive(serde::Deserialize)]
struct WttrDesc {
    value: String,
}

#[derive(serde::Deserialize)]
struct WttrRoot {
    current_condition: Vec<WttrCurrent>,
}

/// wttr.in can be slow or rate-limited: the client times out, failures are
/// logged and the last reading stays on screen. Unparsable fields fall back
/// rather than failing the whole reading.
fn fetch() -> Option<WeatherData> {
    let client = reqwest::Client::builder().timeout(TIMEOUT).build().ok()?;
    let body: WttrRoot = tauri::async_runtime::block_on(async {
        client
            .get("https://wttr.in/?format=j1")
            .send()
            .await?
            .error_for_status()?
            .json()
            .await
    })
    .inspect_err(|e| log::line(format!("weather: {e}")))
    .ok()?;
    let now = body.current_condition.first()?;
    Some(WeatherData {
        temp: now.temp_c.parse().unwrap_or(0.0),
        condition: now
            .weather_desc
            .first()
            .map(|d| d.value.clone())
            .unwrap_or_default(),
        humidity: now.humidity.parse().unwrap_or(0),
        wind: now.windspeed_kmph.parse().unwrap_or(0.0),
    })
}

pub fn setup_weather(app: &AppHandle, gate: Arc<PollGate>) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            gate.wait_until_active();
            while gate.is_active() {
                // Tray → Pause stops the network call, like the integration pollers.
                if !crate::integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) {
                    if let Some(data) = fetch() {
                        let _ = app.emit_to(WINDOW_LABEL, "weather-update", &data);
                    }
                }
                // Sleep in short steps: hiding the island parks the loop right
                // away instead of waiting out the whole 30 minutes.
                for _ in 0..(INTERVAL.as_secs() / 30) {
                    if !gate.is_active() {
                        break;
                    }
                    std::thread::sleep(Duration::from_secs(30));
                }
            }
        }
    });
}
