// System stats — CPU, RAM and network throughput for the dashboard. One
// background thread polls Windows every two seconds and emits `system-stats`
// to the island. It parks on the same PollGate as the other pollers: a hidden
// island costs nothing.

use std::sync::Arc;
use tauri::AppHandle;

use crate::island::PollGate;

#[cfg(windows)]
mod imp {
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::GetSystemTimes;

    use crate::island::{PollGate, WINDOW_LABEL};

    /// `cpu` and `ram` are percentages, `net_rx` / `net_tx` are bytes per
    /// second. The event payload key names come from the camelCase rename.
    #[derive(Serialize, Clone)]
    #[serde(rename_all = "camelCase")]
    struct SystemStats {
        cpu: f32,
        ram: f32,
        net_rx: f64,
        net_tx: f64,
    }

    /// One raw reading; two of them a poll apart give the rates.
    struct Sample {
        at: Instant,
        /// (idle, total) CPU time in 100 ns ticks — total is kernel + user.
        cpu: (u64, u64),
        /// Cumulative octets over every interface.
        net: (u64, u64),
        ram: f32,
    }

    fn filetime(ft: FILETIME) -> u64 {
        ((ft.dwHighDateTime as u64) << 32) | ft.dwLowDateTime as u64
    }

    /// IF_TYPE_LOOPBACK: counting it would double every localhost transfer.
    const IF_TYPE_LOOPBACK: u32 = 24;

    fn net_octets() -> (u64, u64) {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        // SAFETY: GetIfTable2 allocates the table; FreeMibTable releases it.
        // The pointer is only dereferenced while the table exists.
        unsafe {
            if GetIfTable2(&mut table).is_err() || table.is_null() {
                return (0, 0);
            }
            let mut rx = 0u64;
            let mut tx = 0u64;
            for i in 0..(*table).NumEntries as usize {
                let row = &*(*table).Table.as_ptr().add(i);
                if row.Type == IF_TYPE_LOOPBACK {
                    continue;
                }
                rx = rx.saturating_add(row.InOctets);
                tx = tx.saturating_add(row.OutOctets);
            }
            FreeMibTable(table as *const _);
            (rx, tx)
        }
    }

    fn read() -> Sample {
        let mut idle = FILETIME::default();
        let mut kernel = FILETIME::default();
        let mut user = FILETIME::default();
        let cpu = unsafe {
            if GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).is_err() {
                (0, 0)
            } else {
                // Kernel time includes idle time.
                (filetime(idle), filetime(kernel) + filetime(user))
            }
        };

        let mut mem = MEMORYSTATUSEX {
            dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        let ram = unsafe { GlobalMemoryStatusEx(&mut mem) }
            .map(|_| mem.dwMemoryLoad as f32)
            .unwrap_or(0.0);

        Sample { at: Instant::now(), cpu, net: net_octets(), ram }
    }

    fn stats_between(prev: &Sample, now: &Sample) -> Option<SystemStats> {
        let dt = now.at.saturating_duration_since(prev.at).as_secs_f64();
        if dt <= 0.0 {
            return None;
        }
        // Counters only go forward; a reset (interface re-added) reads as no
        // traffic rather than a negative burst.
        let dtotal = now.cpu.1.saturating_sub(prev.cpu.1);
        let didle = now.cpu.0.saturating_sub(prev.cpu.0);
        let cpu = if dtotal == 0 {
            0.0
        } else {
            (100.0 * (1.0 - didle as f64 / dtotal as f64)).clamp(0.0, 100.0) as f32
        };
        Some(SystemStats {
            cpu,
            ram: now.ram,
            net_rx: now.net.0.saturating_sub(prev.net.0) as f64 / dt,
            net_tx: now.net.1.saturating_sub(prev.net.1) as f64 / dt,
        })
    }

    /// Parks on the shared gate: no polling, no emits while the island is
    /// hidden. The first tick after waking diffs against the pre-park sample,
    /// so the emitted rate is an average over the gap rather than a spike.
    pub fn setup(app: &AppHandle, gate: Arc<PollGate>) {
        let app = app.clone();
        std::thread::spawn(move || {
            loop {
                gate.wait_until_active();
                let mut prev = read();
                while gate.is_active() {
                    std::thread::sleep(Duration::from_secs(2));
                    let now = read();
                    if let Some(stats) = stats_between(&prev, &now) {
                        let _ = app.emit_to(WINDOW_LABEL, "system-stats", &stats);
                    }
                    prev = now;
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

pub fn setup_system_stats(app: &AppHandle, gate: Arc<PollGate>) {
    imp::setup(app, gate);
}
