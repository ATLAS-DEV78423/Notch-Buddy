// Battery — level, charging state and remaining time from the Windows power
// API. One background poller emits `battery-status` every 30 s.
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
        /// Windows Battery Saver, distinct from merely having low charge.
        low_power: bool,
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
            low_power: status.SystemStatusFlag == 1,
            time_remaining: if status.BatteryLifeTime == u32::MAX { 0 } else { status.BatteryLifeTime },
        })
    }

    pub fn setup(app: &AppHandle, gate: Arc<PollGate>) {
        let app = app.clone();
        std::thread::spawn(move || {
            loop {
                let generation = gate.wait_until_active();
                while gate.is_current(generation) {
                    // Emit every tick, not only on change: the first emit races JS
                    // listener registration, so a never-changing reading (AC at
                    // 100%) would leave State.battery stale all session. The
                    // frontend edge logic is diff-based, periodic emits are safe.
                    if let Some(now) = read() {
                        if gate.is_current(generation) {
                            let _ = app.emit_to(WINDOW_LABEL, "battery-status", &now);
                        }
                    }
                    if !gate.wait_interval(generation, Duration::from_secs(30)) { break; }
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
