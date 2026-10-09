// Control center — volume, brightness, Night light, Do not disturb and memory
// boost, answered by a PowerShell worker (system_control.ps1) that is spawned
// on the first command, not at boot. One JSON request per line in, one JSON
// response per line out; between commands the worker sleeps in a blocking
// ReadLine, so nothing polls and a hidden island costs nothing. A dead or
// wedged worker is killed and forgotten — the next command starts a fresh one —
// and every failure comes back as a friendly error instead of taking the app
// down.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::island::WINDOW_LABEL;

/// Matches `AppState.volume`: `level` is 0..1, how the island renders it.
#[derive(Serialize, Clone)]
pub struct VolumeState {
    pub level: f32,
    pub muted: bool,
}

/// Matches `AppState.brightness`: `level` is 0..1.
#[derive(Serialize, Clone)]
pub struct BrightnessState {
    pub level: f32,
}

/// The worker round-trip is blocking I/O; Tauri's async runtime must not pay
/// for it, so every command runs on the blocking pool.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod imp {
    use std::io::{BufRead, BufReader, Write};
    use std::process::{Child, ChildStdin, Command, Stdio};
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    use serde_json::{json, Value};

    use super::{BrightnessState, VolumeState};

    /// The first command also pays for the PowerShell start-up and the C#
    /// compile (Add-Type), so it gets a wider deadline than the rest.
    const FIRST_TIMEOUT: Duration = Duration::from_secs(20);
    const TIMEOUT: Duration = Duration::from_secs(10);
    const SCRIPT: &str = include_str!("system_control.ps1");

    struct Worker {
        child: Child,
        stdin: ChildStdin,
        rx: Receiver<String>,
    }

    impl Worker {
        fn exited(&mut self) -> bool {
            matches!(self.child.try_wait(), Ok(Some(_)))
        }

        fn kill(&mut self) {
            let _ = self.child.kill();
        }
    }

    static WORKER: Mutex<Option<Worker>> = Mutex::new(None);

    fn spawn() -> Result<Worker, String> {
        let script = std::env::temp_dir().join("coucou_system_control.ps1");
        // Rewrite only when the embedded copy moved on (a new app build);
        // respawning must not fight a dying worker over the same file.
        if std::fs::read(&script)
            .map(|old| old.as_slice() != SCRIPT.as_bytes())
            .unwrap_or(true)
        {
            std::fs::write(&script, SCRIPT)
                .map_err(|e| format!("could not write the control worker script: {e}"))?;
        }
        let mut cmd = Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
            "-NoLogo",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
        ])
        .arg(&script)
        .arg("-ParentPid")
        .arg(std::process::id().to_string())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
        crate::platform::no_console(&mut cmd);
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("could not start PowerShell: {e}"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "PowerShell stdin unavailable".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "PowerShell stdout unavailable".to_string())?;
        let (tx, rx) = mpsc::channel();
        // The worker only writes when it answers a command; this thread hands
        // lines over and ends when the pipe closes.
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Ok(Worker { child, stdin, rx })
    }

    /// One request in, one response out. On any failure the worker is killed
    /// and dropped, so the next command starts a clean one.
    fn ask(request: Value) -> Result<Value, String> {
        let mut guard = WORKER.lock().unwrap_or_else(|e| e.into_inner());
        let (mut worker, spawned) = match guard.take() {
            Some(mut w) => {
                if w.exited() {
                    w.kill();
                    (spawn()?, true)
                } else {
                    (w, false)
                }
            }
            None => (spawn()?, true),
        };
        let timeout = if spawned { FIRST_TIMEOUT } else { TIMEOUT };
        match exchange(&mut worker, request, timeout) {
            Ok(value) => {
                *guard = Some(worker);
                Ok(value)
            }
            Err(err) => {
                worker.kill();
                Err(err)
            }
        }
    }

    fn exchange(worker: &mut Worker, request: Value, timeout: Duration) -> Result<Value, String> {
        let line = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        let write = writeln!(worker.stdin, "{line}").and_then(|_| worker.stdin.flush());
        if let Err(err) = write {
            return Err(format!("the control worker is not responding ({err})"));
        }
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("the control worker timed out".to_string());
            }
            match worker.rx.recv_timeout(left) {
                // The worker answers exactly once per request; anything that
                // is not that answer (stray output) is skipped, not trusted.
                Ok(text) => {
                    if let Ok(value) = serde_json::from_str::<Value>(&text) {
                        if value.get("ok").is_some() {
                            return Ok(value);
                        }
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    return Err("the control worker timed out".to_string())
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("the control worker stopped".to_string())
                }
            }
        }
    }

    fn checked(response: Value) -> Result<Value, String> {
        if response["ok"].as_bool() == Some(false) {
            return Err(response["error"]
                .as_str()
                .unwrap_or("the control worker failed")
                .to_string());
        }
        Ok(response)
    }

    /// The worker speaks 0..100 (the reference protocol); the island speaks 0..1.
    fn level(response: &Value) -> Result<f32, String> {
        let raw = response["level"]
            .as_f64()
            .ok_or_else(|| "the control worker sent no level".to_string())?;
        Ok((raw / 100.0).clamp(0.0, 1.0) as f32)
    }

    fn volume_of(response: &Value) -> Result<VolumeState, String> {
        Ok(VolumeState {
            level: level(response)?,
            muted: response["muted"].as_bool().unwrap_or(false),
        })
    }

    pub fn volume() -> Result<VolumeState, String> {
        volume_of(&checked(ask(json!({ "cmd": "get_volume" }))?)?)
    }

    pub fn set_volume(requested: f32) -> Result<VolumeState, String> {
        let percent = (requested.clamp(0.0, 1.0) * 100.0).round() as i32;
        volume_of(&checked(ask(json!({ "cmd": "set_volume", "level": percent }))?)?)
    }

    pub fn toggle_mute() -> Result<VolumeState, String> {
        volume_of(&checked(ask(json!({ "cmd": "toggle_mute" }))?)?)
    }

    pub fn brightness() -> Result<BrightnessState, String> {
        Ok(BrightnessState {
            level: level(&checked(ask(json!({ "cmd": "get_brightness" }))?)?)?,
        })
    }

    pub fn set_brightness(requested: f32) -> Result<BrightnessState, String> {
        let percent = (requested.clamp(0.0, 1.0) * 100.0).round() as i32;
        Ok(BrightnessState {
            level: level(&checked(ask(json!({ "cmd": "set_brightness", "level": percent }))?)?)?,
        })
    }

    pub fn toggle_night_light() -> Result<bool, String> {
        checked(ask(json!({ "cmd": "toggle_night_light" }))?)?["nightLight"]
            .as_bool()
            .ok_or_else(|| "the control worker sent no Night light state".to_string())
    }

    pub fn toggle_dnd() -> Result<bool, String> {
        checked(ask(json!({ "cmd": "toggle_dnd" }))?)?["dnd"]
            .as_bool()
            .ok_or_else(|| "the control worker sent no Do not disturb state".to_string())
    }

    pub fn memory_boost() -> Result<u64, String> {
        checked(ask(json!({ "cmd": "memory_boost" }))?)?["freedMb"]
            .as_u64()
            .ok_or_else(|| "the control worker sent no result".to_string())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// The whole path in one shot: lazy spawn, JSON request, JSON
        /// response, parse — against the real worker on this machine.
        #[test]
        fn worker_answers_get_volume() {
            let state = volume().expect("the PowerShell worker should answer");
            assert!((0.0..=1.0).contains(&state.level));
        }

        /// A worker-side failure must arrive as a plain Err, never a panic.
        #[test]
        fn unknown_command_is_a_friendly_error() {
            let response = ask(json!({ "cmd": "nope" })).expect("a response");
            let err = checked(response).unwrap_err();
            assert!(err.contains("unknown command"), "got: {err}");
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{BrightnessState, VolumeState};

    fn unsupported() -> String {
        "System control is Windows-only".to_string()
    }

    pub fn volume() -> Result<VolumeState, String> {
        Err(unsupported())
    }
    pub fn set_volume(_requested: f32) -> Result<VolumeState, String> {
        Err(unsupported())
    }
    pub fn toggle_mute() -> Result<VolumeState, String> {
        Err(unsupported())
    }
    pub fn brightness() -> Result<BrightnessState, String> {
        Err(unsupported())
    }
    pub fn set_brightness(_requested: f32) -> Result<BrightnessState, String> {
        Err(unsupported())
    }
    pub fn toggle_night_light() -> Result<bool, String> {
        Err(unsupported())
    }
    pub fn toggle_dnd() -> Result<bool, String> {
        Err(unsupported())
    }
    pub fn memory_boost() -> Result<u64, String> {
        Err(unsupported())
    }
}

#[tauri::command]
pub async fn get_volume() -> Result<VolumeState, String> {
    blocking(imp::volume).await
}

#[tauri::command]
pub async fn set_volume(app: AppHandle, level: f32) -> Result<(), String> {
    let state = blocking(move || imp::set_volume(level)).await?;
    // The island mirrors the click through the event, not a second round-trip.
    let _ = app.emit_to(WINDOW_LABEL, "volume-changed", &state);
    Ok(())
}

#[tauri::command]
pub async fn toggle_mute(app: AppHandle) -> Result<bool, String> {
    let state = blocking(imp::toggle_mute).await?;
    let _ = app.emit_to(WINDOW_LABEL, "volume-changed", &state);
    Ok(state.muted)
}

#[tauri::command]
pub async fn get_brightness() -> Result<BrightnessState, String> {
    blocking(imp::brightness).await
}

#[tauri::command]
pub async fn set_brightness(app: AppHandle, level: f32) -> Result<(), String> {
    let state = blocking(move || imp::set_brightness(level)).await?;
    let _ = app.emit_to(WINDOW_LABEL, "brightness-changed", &state);
    Ok(())
}

#[tauri::command]
pub async fn toggle_night_light() -> Result<bool, String> {
    blocking(imp::toggle_night_light).await
}

#[tauri::command]
pub async fn toggle_dnd() -> Result<bool, String> {
    blocking(imp::toggle_dnd).await
}

#[tauri::command]
pub async fn memory_boost() -> Result<u64, String> {
    blocking(imp::memory_boost).await
}
