// Bluetooth — paired devices, connect/disconnect and battery levels, answered
// by a PowerShell worker (bluetooth.ps1) that is spawned on the first command,
// not at boot. One JSON request per line in, one JSON response per line out;
// between commands the worker sleeps in a blocking ReadLine, so nothing polls
// and a hidden island costs nothing. A dead or wedged worker is killed and
// forgotten — the next command starts a fresh one — and every failure comes
// back as a friendly error instead of taking the app down.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::island::WINDOW_LABEL;

/// One entry of `get_bt_devices`. `kind` is the icon hint ("headphones",
/// "speaker", …, or "" when nothing matches), detected from the name.
#[derive(Serialize, Clone)]
pub struct BtDevice {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String,
    /// -1 when the device is disconnected or reports no level.
    pub battery: i32,
    pub connected: bool,
}

/// The `get_bt_devices` payload.
#[derive(Serialize, Clone)]
pub struct BtDevices {
    pub devices: Vec<BtDevice>,
}

/// The `bt_connect` / `bt_disconnect` payload: `{ ok, error? }`.
#[derive(Serialize, Clone)]
pub struct BtAction {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// `bt-device-event`: a connect or disconnect this app asked for and the
/// worker saw land. External changes are not watched — see the worker's header.
#[derive(Serialize, Clone)]
pub struct BtDeviceEvent {
    #[serde(rename = "type")]
    pub kind: &'static str,
    pub name: String,
    pub battery: i32,
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

    use super::{BtAction, BtDevices, BtDevice};

    /// The first command also pays for the PowerShell start-up, the C#
    /// compile (Add-Type) and the first WinRT query, so it gets a wider
    /// deadline than the rest; a connect waits up to 12 s (the reference's
    /// 30 × 400 ms poll) for the device to change state, plus two scans.
    const FIRST_TIMEOUT: Duration = Duration::from_secs(25);
    const TIMEOUT: Duration = Duration::from_secs(20);
    const SCRIPT: &str = include_str!("bluetooth.ps1");

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
        let script = std::env::temp_dir().join("coucou_bluetooth.ps1");
        // Rewrite only when the embedded copy moved on (a new app build);
        // respawning must not fight a dying worker over the same file.
        if std::fs::read(&script)
            .map(|old| old.as_slice() != SCRIPT.as_bytes())
            .unwrap_or(true)
        {
            std::fs::write(&script, SCRIPT)
                .map_err(|e| format!("could not write the bluetooth worker script: {e}"))?;
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
            return Err(format!("the bluetooth worker is not responding ({err})"));
        }
        let deadline = Instant::now() + timeout;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() {
                return Err("the bluetooth worker timed out".to_string());
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
                    return Err("the bluetooth worker timed out".to_string())
                }
                Err(RecvTimeoutError::Disconnected) => {
                    return Err("the bluetooth worker stopped".to_string())
                }
            }
        }
    }

    fn checked(response: Value) -> Result<Value, String> {
        if response["ok"].as_bool() == Some(false) {
            return Err(response["error"]
                .as_str()
                .unwrap_or("the bluetooth worker failed")
                .to_string());
        }
        Ok(response)
    }

    fn devices(response: &Value) -> Result<BtDevices, String> {
        let list = response["devices"]
            .as_array()
            .ok_or_else(|| "the bluetooth worker sent no devices".to_string())?;
        // One malformed entry costs one device, not the whole list.
        let devices = list
            .iter()
            .filter_map(|d| {
                Some(BtDevice {
                    name: d["name"].as_str()?.to_string(),
                    kind: d["type"].as_str().unwrap_or("").to_string(),
                    battery: d["battery"].as_i64().unwrap_or(-1) as i32,
                    connected: d["connected"].as_bool().unwrap_or(false),
                })
            })
            .collect();
        Ok(BtDevices { devices })
    }

    pub fn list() -> Result<BtDevices, String> {
        devices(&checked(ask(json!({ "cmd": "get_bt_devices" }))?)?)
    }

    /// A connect attempt never rejects: the caller always gets `{ ok, error? }`,
    /// plus the fresh device list when the worker answered, so the events below
    /// can show what changed.
    pub fn set(name: String, connect: bool) -> (BtAction, Option<BtDevices>) {
        let cmd = if connect { "bt_connect" } else { "bt_disconnect" };
        let response = match ask(json!({ "cmd": cmd, "name": name })) {
            Ok(value) => value,
            Err(err) => {
                return (
                    BtAction {
                        ok: false,
                        error: Some(err),
                    },
                    None,
                )
            }
        };
        let ok = response["ok"].as_bool() == Some(true);
        let error = if ok {
            None
        } else {
            Some(
                response["error"]
                    .as_str()
                    .unwrap_or("the bluetooth worker failed")
                    .to_string(),
            )
        };
        (BtAction { ok, error }, devices(&response).ok())
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// The whole path in one shot: lazy spawn, JSON request, JSON
        /// response, parse — against the real worker on this machine.
        #[test]
        fn worker_answers_get_bt_devices() {
            let list = list().expect("the PowerShell worker should answer");
            for device in &list.devices {
                assert!(!device.name.is_empty(), "a device without a name");
                assert!(device.battery >= -1, "battery out of range");
            }
        }

        /// A worker-side failure must arrive as a plain Err, never a panic.
        #[test]
        fn unknown_command_is_a_friendly_error() {
            let response = ask(json!({ "cmd": "nope" })).expect("a response");
            let err = checked(response).unwrap_err();
            assert!(err.contains("unknown command"), "got: {err}");
        }

        /// A connect attempt the worker refuses resolves as `{ ok: false, … }`
        /// with the device list still attached — never a panic, never a hang.
        #[test]
        fn connect_to_an_unknown_device_is_a_friendly_failure() {
            let (action, devices) = set("__no_such_device__".to_string(), true);
            assert!(!action.ok);
            assert!(action.error.is_some(), "a refusal must explain itself");
            let list = devices.expect("the refusal still carries the device list");
            assert!(list.devices.iter().all(|d| !d.name.is_empty()));
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::{BtAction, BtDevices};

    fn unsupported() -> String {
        "Bluetooth is Windows-only".to_string()
    }

    pub fn list() -> Result<BtDevices, String> {
        Err(unsupported())
    }

    pub fn set(_name: String, _connect: bool) -> (BtAction, Option<BtDevices>) {
        (
            BtAction {
                ok: false,
                error: Some(unsupported()),
            },
            None,
        )
    }
}

#[tauri::command]
pub async fn get_bt_devices() -> Result<BtDevices, String> {
    blocking(imp::list).await
}

#[tauri::command]
pub async fn bt_connect(app: AppHandle, name: String) -> Result<BtAction, String> {
    let wanted = name.clone();
    let (action, devices) = blocking(move || Ok(imp::set(name, true))).await?;
    report(&app, &wanted, true, &action, devices);
    Ok(action)
}

#[tauri::command]
pub async fn bt_disconnect(app: AppHandle, name: String) -> Result<BtAction, String> {
    let wanted = name.clone();
    let (action, devices) = blocking(move || Ok(imp::set(name, false))).await?;
    report(&app, &wanted, false, &action, devices);
    Ok(action)
}

/// The island updates the list from `bt-devices` and pops the alert from
/// `bt-device-event`; only a change that actually landed gets an event.
fn report(
    app: &AppHandle,
    name: &str,
    connect: bool,
    action: &BtAction,
    devices: Option<BtDevices>,
) {
    let list = match devices {
        Some(list) => list,
        None => return,
    };
    let _ = app.emit_to(WINDOW_LABEL, "bt-devices", &list);
    if !action.ok {
        return;
    }
    let battery = list
        .devices
        .iter()
        .find(|d| d.name == name)
        .map(|d| d.battery)
        .unwrap_or(-1);
    let _ = app.emit_to(
        WINDOW_LABEL,
        "bt-device-event",
        &BtDeviceEvent {
            kind: if connect { "connected" } else { "disconnected" },
            name: name.to_string(),
            battery,
        },
    );
}
