// Battery — level, charging state and remaining time from the Windows power
// API. One background poller emits `battery-status` whenever a reading changes.
// Parks on the shared PollGate like the other pollers: a hidden island costs
// nothing, and battery state only needs to be fresh while it can be seen.

use std::sync::Arc;
use tauri::AppHandle;

use crate::island::PollGate;

#[cfg(windows)]
mod imp {
    use std::sync::Arc;
    use std::time::Duration;

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    use crate::island::{PollGate, WINDOW_LABEL};

    /// `battery-status` payload — field names match `State.battery` on the
    /// island (`time_remaining` is camelCase-renamed to `timeRemaining`).
    #[derive(Serialize, Clone, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct BatteryStatus {
        level: u32,
        charging: bool,
        /// Seconds; 0 when Windows has no estimate.
        time_remaining: u32,
    }

    /// `None` on a desktop with no battery — the island keeps the last reading
    /// rather than inventing one.
    fn read() -> Option<BatteryStatus> {
        let mut status = SYSTEM_POWER_STATUS::default();
        // SAFETY: the struct is fully initialised before the call, which owns
        // the whole write.
        unsafe { GetSystemPowerStatus(&mut status).ok()? };
        const NO_BATTERY: u8 = 128;
        const UNKNOWN_PERCENT: u8 = 255;
        const CHARGING: u8 = 8;
        if status.BatteryFlag & NO_BATTERY != 0 || status.BatteryLifePercent == UNKNOWN_PERCENT {
            return None;
        }
        Some(BatteryStatus {
            level: status.BatteryLifePercent as u32,
            // AC online or the charging flag: either means the battery fills.
            charging: status.ACLineStatus == 1 || status.BatteryFlag & CHARGING != 0,
            time_remaining: status.BatteryLifeTime.max(0) as u32,
        })
    }

    pub fn setup(app: &AppHandle, gate: Arc<PollGate>) {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut last: Option<BatteryStatus> = None;
            loop {
                gate.wait_until_active();
                while gate.is_active() {
                    if let Some(now) = read() {
                        if last.as_ref() != Some(&now) {
                            let _ = app.emit_to(WINDOW_LABEL, "battery-status", &now);
                            last = Some(now);
                        }
                    }
                    std::thread::sleep(Duration::from_secs(30));
                }
            }
        });
    }
}

#[cfg(not(windows))]
mod imp {
    use std::sync::Arc;
    use tauri::AppHandle;

    use crate::island::PollGate;

    pub fn setup(_app: &AppHandle, _gate: Arc<PollGate>) {}
}

pub fn setup_battery(app: &AppHandle, gate: Arc<PollGate>) {
    imp::setup(app, gate);
}
