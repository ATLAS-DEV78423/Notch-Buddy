#!/usr/bin/env python3
"""Native std-only tests/benchmarks of the production gate and logger, no user logs.

Usage: python3 windows/scripts/test-backend-poll-log.py [test|bench] [--baseline]
Legacy adapters model the old caller sleep/check sequence for before measurements.
Generated sources, test logs and binaries live only in a temporary directory.
"""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "src-tauri/src"
RUSTC = shutil.which("rustc") or str(Path.home() / ".cargo/bin/rustc")
baseline = "--baseline" in sys.argv
def production(name):
    if baseline:
        return subprocess.check_output(["git", "show", f"HEAD:windows/src-tauri/src/{name}"], cwd=ROOT.parent, text=True)
    return (SOURCE / name).read_text(encoding="utf-8")

gate_source = production("island.rs")
log_source = production("log.rs")
def function(source, signature):
    start = source.index(signature)
    opening = source.index("{", start)
    depth = 1
    end = opening + 1
    while depth:
        depth += (source[end] == "{") - (source[end] == "}")
        end += 1
    return source[start:end]

stats_setup = function(production("system_stats.rs"), "pub fn setup(app:")
# Real production baseline loop; only the OS sample/emitter and 2 s timer are replaced.
stats_setup = stats_setup.replace("Duration::from_secs(2)", "Duration::from_millis(80)")
stats_fixture = r'''
mod stats_fixture {
    use super::*;
    use std::sync::atomic::AtomicU64;
    static VALUE: AtomicU64 = AtomicU64::new(0);
    static READS: Mutex<Option<std::sync::mpsc::Sender<u64>>> = Mutex::new(None);
    const WINDOW_LABEL: &str = "island";
    #[derive(Clone)]
    pub struct AppHandle(std::sync::mpsc::Sender<u64>);
    impl AppHandle {
        fn emit_to(&self, _: &str, _: &str, stats: &u64) -> Result<(), ()> {
            self.0.send(*stats).map_err(|_| ())
        }
    }
    fn read() -> Option<u64> {
        let value = VALUE.load(Ordering::Relaxed);
        let _ = READS.lock().unwrap().as_ref().unwrap().send(value);
        Some(value)
    }
    fn stats_between(prev: &u64, now: &u64) -> Option<u64> { Some(now.saturating_sub(*prev)) }
    STATS_SETUP
    #[test]
    fn real_stats_loop_rebaselines_after_quick_hide_reveal() {
        let gate = Arc::new(PollGate::new()); gate.set_active(true);
        let (read_tx, read_rx) = std::sync::mpsc::channel();
        *READS.lock().unwrap() = Some(read_tx);
        let (emit_tx, emit_rx) = std::sync::mpsc::channel();
        setup(&AppHandle(emit_tx), gate.clone());
        assert_eq!(read_rx.recv_timeout(Duration::from_millis(300)).unwrap(), 0);
        gate.set_active(false); VALUE.store(100, Ordering::Relaxed); gate.set_active(true);
        assert_eq!(read_rx.recv_timeout(Duration::from_millis(300)).unwrap(), 100);
        // First delivered rate must use two samples from the new visible session.
        assert_eq!(emit_rx.recv_timeout(Duration::from_millis(300)).unwrap(), 0);
        gate.set_active(false);
        // Allow an already-admitted sample to finish, then observe a whole parked interval.
        std::thread::sleep(Duration::from_millis(30));
        while read_rx.try_recv().is_ok() {}
        while emit_rx.try_recv().is_ok() {}
        assert!(read_rx.recv_timeout(Duration::from_millis(120)).is_err());
        assert!(emit_rx.try_recv().is_err());
    }
}
'''.replace("STATS_SETUP", stats_setup)
clipboard_source = production("clipboard.rs")
clipboard_setup = function(clipboard_source, "pub fn setup(app:").replace("Duration::from_secs(1)", "Duration::from_millis(30)")
clipboard_read = "fn read_text() -> Result<Option<String>, ()> { mock_read() }" if "fn read_text() -> Result" in clipboard_source else "fn read_text() -> Option<String> { mock_read().ok().flatten() }"
clipboard_fixture = r'''
mod clipboard_fixture {
    use super::*;
    use std::sync::atomic::{AtomicU32, AtomicUsize};
    static SEQ: AtomicU32 = AtomicU32::new(1);
    static COUNT: AtomicUsize = AtomicUsize::new(0);
    static TEXT: AtomicBool = AtomicBool::new(true);
    static READS: Mutex<Option<std::sync::mpsc::Sender<()>>> = Mutex::new(None);
    const WINDOW_LABEL: &str = "island";
    struct ClipboardUrl { url: String }
    #[derive(Clone)]
    pub struct AppHandle(std::sync::mpsc::Sender<String>);
    impl AppHandle {
        fn emit_to(&self, _: &str, _: &str, payload: ClipboardUrl) -> Result<(), ()> {
            self.0.send(payload.url).map_err(|_| ())
        }
    }
    #[allow(non_snake_case)]
    unsafe fn GetClipboardSequenceNumber() -> u32 { SEQ.load(Ordering::Relaxed) }
    fn mock_read() -> Result<Option<String>, ()> {
        let busy = COUNT.fetch_add(1, Ordering::Relaxed) == 0;
        let result = if busy { Err(()) } else { Ok(TEXT.load(Ordering::Relaxed).then(|| "https://example.test".to_string())) };
        let _ = READS.lock().unwrap().as_ref().unwrap().send(());
        result
    }
    CLIPBOARD_READ
    IS_URL
    CLIPBOARD_SETUP
    #[test]
    fn busy_clipboard_retries_but_non_text_is_not_reread_each_tick() {
        let gate = Arc::new(PollGate::new()); gate.set_active(true);
        let (read_tx, read_rx) = std::sync::mpsc::channel();
        *READS.lock().unwrap() = Some(read_tx);
        let (emit_tx, emit_rx) = std::sync::mpsc::channel();
        setup(&AppHandle(emit_tx), gate.clone());
        assert_eq!(emit_rx.recv_timeout(Duration::from_millis(300)).unwrap(), "https://example.test");
        read_rx.recv().unwrap(); read_rx.recv().unwrap();
        TEXT.store(false, Ordering::Relaxed); SEQ.store(2, Ordering::Relaxed);
        read_rx.recv_timeout(Duration::from_millis(300)).unwrap();
        assert!(read_rx.recv_timeout(Duration::from_millis(120)).is_err());
        assert_eq!(COUNT.load(Ordering::Relaxed), 3);
        assert!(emit_rx.try_recv().is_err()); gate.set_active(false);
    }
}
'''.replace("CLIPBOARD_READ", clipboard_read).replace("IS_URL", function(clipboard_source, "fn is_url(")).replace("CLIPBOARD_SETUP", clipboard_setup)
gate_source = gate_source[gate_source.index("/// Wakes / parks"):gate_source.index("pub fn window")]
modern = "wait_interval" in gate_source
adapters = """
fn epoch(g: &PollGate) -> u64 { g.wait_until_active() }
fn current(g: &PollGate, e: u64) -> bool { g.is_current(e) }
fn interval(g: &PollGate, e: u64, d: Duration) -> bool { g.wait_interval(e, d) }
fn weather_wait(g: &PollGate, e: u64) -> usize {
    interval(g, e, Duration::from_millis(600)); 1
}
""" if modern else """
fn epoch(g: &PollGate) -> u64 { g.wait_until_active(); 0 }
fn current(g: &PollGate, _: u64) -> bool { g.is_active() }
fn interval(g: &PollGate, _: u64, d: Duration) -> bool {
    std::thread::sleep(d); g.is_active()
}
// Exactly the old weather short-step wait, scaled 30 s -> 10 ms (60 steps).
fn weather_wait(g: &PollGate, _: u64) -> usize {
    let mut wakes = 0;
    for _ in 0..60 { if !g.is_active() { break; } std::thread::sleep(Duration::from_millis(10)); wakes += 1; }
    wakes
}
"""
gate_tests = r'''
#[test]
fn hidden_parks_and_reveal_wakes_all() {
    let gate = Arc::new(PollGate::new());
    let (tx, rx) = std::sync::mpsc::channel();
    for _ in 0..6 {
        let g = gate.clone(); let tx = tx.clone();
        std::thread::spawn(move || { epoch(&g); tx.send(()).unwrap(); });
    }
    assert!(rx.recv_timeout(Duration::from_millis(100)).is_err());
    gate.set_active(true);
    for _ in 0..6 { rx.recv_timeout(Duration::from_millis(300)).unwrap(); }
}
#[test]
fn hide_interrupts_long_deadline() {
    let gate = Arc::new(PollGate::new()); gate.set_active(true);
    let e = epoch(&gate); let g = gate.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        tx.send(interval(&g, e, Duration::from_secs(2))).unwrap();
    });
    std::thread::sleep(Duration::from_millis(40)); gate.set_active(false);
    assert_eq!(rx.recv_timeout(Duration::from_millis(300)), Ok(false));
    worker.join().unwrap();
}
#[test]
fn quick_hide_reveal_invalidates_stats_baseline() {
    let gate = PollGate::new(); gate.set_active(true);
    let baseline_epoch = epoch(&gate);
    gate.set_active(false); gate.set_active(true);
    assert!(!current(&gate, baseline_epoch), "old stats baseline survives hide/reveal");
    assert!(!interval(&gate, baseline_epoch, Duration::from_secs(2)));
    assert!(current(&gate, epoch(&gate)));
}
#[test]
fn duplicate_active_and_spurious_notifications_preserve_deadline() {
    let gate = Arc::new(PollGate::new()); gate.set_active(true);
    let e = epoch(&gate); let g = gate.clone();
    let start = Instant::now();
    let worker = std::thread::spawn(move || interval(&g, e, Duration::from_millis(180)));
    for _ in 0..25 {
        std::thread::sleep(Duration::from_millis(10));
        gate.set_active(true); gate.cv.notify_all();
    }
    assert!(worker.join().unwrap());
    // A separate observation checks an early return rather than timing join after notifications.
    let g = gate.clone(); let (tx, rx) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        let start = Instant::now(); interval(&g, e, Duration::from_millis(180));
        tx.send(start.elapsed()).unwrap();
    });
    for _ in 0..10 { gate.cv.notify_all(); gate.set_active(true); std::thread::sleep(Duration::from_millis(5)); }
    let elapsed = rx.recv_timeout(Duration::from_millis(300)).unwrap();
    assert!(elapsed >= Duration::from_millis(180));
    assert!(elapsed < Duration::from_millis(300), "duplicate calls restarted the deadline");
    assert!(current(&gate, e)); assert!(start.elapsed() >= Duration::from_millis(180));
    worker.join().unwrap();
}
#[test]
fn cancelled_wait_does_not_read_or_emit_hidden() {
    let gate = Arc::new(PollGate::new()); gate.set_active(true);
    let e = epoch(&gate); let g = gate.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        if interval(&g, e, Duration::from_millis(80)) { tx.send("read+emit").unwrap(); }
    });
    gate.set_active(false);
    worker.join().unwrap(); assert!(rx.try_recv().is_err());
}
fn main() {
    let gate = Arc::new(PollGate::new()); gate.set_active(true);
    let e = epoch(&gate); let g = gate.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    let worker = std::thread::spawn(move || {
        tx.send(()).unwrap();
        interval(&g, e, Duration::from_millis(200));
    });
    rx.recv().unwrap(); std::thread::sleep(Duration::from_millis(2));
    let start = Instant::now(); gate.set_active(false); worker.join().unwrap();
    println!("cancel_200ms_wait_us={}", start.elapsed().as_micros());
    gate.set_active(true);
    let e = epoch(&gate); let g = gate.clone();
    let worker = std::thread::spawn(move || weather_wait(&g, e));
    println!("scaled_weather_wait_wakes={}", worker.join().unwrap());
    gate.set_active(false);
    // Real hidden wait stays parked; parent controls the end without a polling timer.
    let g = gate.clone(); let worker = std::thread::spawn(move || { epoch(&g); });
    std::thread::sleep(Duration::from_millis(200)); gate.set_active(true); worker.join().unwrap();
}
'''
log_harness = r'''
use std::sync::atomic::{AtomicUsize, Ordering};
static ENSURES: AtomicUsize = AtomicUsize::new(0);
mod settings {
    pub fn local_dir() -> std::path::PathBuf { std::env::var_os("BACKEND_TEST_LOG_DIR").unwrap().into() }
}
mod platform {
    pub struct LocalTime { pub year: u32, pub month: u32, pub day: u32, pub hour: u32, pub minute: u32, pub second: u32 }
    pub fn local_time() -> LocalTime { LocalTime { year: 2026, month: 10, day: 14, hour: 12, minute: 34, second: 56 } }
    pub fn ensure_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
        crate::ENSURES.fetch_add(1, crate::Ordering::Relaxed);
        std::fs::create_dir_all(dir)?;
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
        }
        Ok(())
    }
}
mod log { include!("LOG_SOURCE"); }
fn path() -> std::path::PathBuf { settings::local_dir().join("coucou.log") }
#[test]
fn rotation_caps_size_and_keeps_newest_line() {
    log::line("a".repeat(999_970));
    log::line("newest-important-diagnostic");
    assert!(std::fs::metadata(path()).unwrap().len() <= 1_000_000);
    assert!(std::fs::read_to_string(path()).unwrap().ends_with("newest-important-diagnostic\n"));
}
#[test]
fn concurrent_lines_are_complete_and_serialized() {
    let mut workers = vec![];
    for i in 0..8 { workers.push(std::thread::spawn(move || {
        for j in 0..50 { log::line(format!("{i}:{j}:{}", "x".repeat(256))); }
    })); }
    for w in workers { w.join().unwrap(); }
    let content = std::fs::read_to_string(path()).unwrap();
    let lines: Vec<_> = content.lines().collect(); assert_eq!(lines.len(), 400);
    let mut seen = std::collections::HashSet::new();
    for line in lines {
        assert!(line.starts_with("2026-10-14 12:34:56 "));
        let body = &line[20..]; let parts: Vec<_> = body.split(':').collect();
        assert_eq!(parts.len(), 3); assert_eq!(parts[2], "x".repeat(256));
        assert!(seen.insert((parts[0].to_string(), parts[1].to_string())));
    }
}
#[test]
fn failed_initialization_retries_on_next_diagnostic() {
    std::fs::remove_dir_all(settings::local_dir()).unwrap();
    std::fs::write(settings::local_dir(), "not a directory").unwrap();
    log::line("cannot open");
    std::fs::remove_file(settings::local_dir()).unwrap();
    log::line("recovered");
    assert!(std::fs::read_to_string(path()).unwrap().ends_with("recovered\n"));
}
#[cfg(unix)]
#[test]
fn private_file_and_directory_permissions() {
    use std::os::unix::fs::PermissionsExt;
    log::line("private diagnostic");
    assert_eq!(std::fs::metadata(path()).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::metadata(settings::local_dir()).unwrap().permissions().mode() & 0o777, 0o700);
}
fn main() {
    let start = std::time::Instant::now();
    for i in 0..2000 { log::line(format!("fixed-input diagnostic {i:04}")); }
    println!("lines=2000 ensures={} elapsed_us={} bytes={}",
        ENSURES.load(Ordering::Relaxed), start.elapsed().as_micros(), std::fs::metadata(path()).unwrap().len());
}
'''

if "static LOG:" in log_source:
    log_harness = log_harness.replace('mod log { include!("LOG_SOURCE"); }', r'''
mod log {
    include!("LOG_SOURCE");
    #[cfg(test)]
    pub fn inject_read_only_handle() {
        // Fault injection changes only the temp fixture's cached descriptor.
        LOG.lock().unwrap().as_mut().unwrap().file = std::fs::File::open(crate::path()).unwrap();
    }
    #[cfg(test)]
    pub fn cached() -> bool { LOG.lock().unwrap().is_some() }
}
''')
    log_harness += r'''
#[test]
fn write_failure_discards_cache_and_recovers_on_next_line() {
    log::line("before failure"); log::inject_read_only_handle();
    log::line("failed write"); assert!(!log::cached());
    log::line("after recovery"); assert!(log::cached());
    let content = std::fs::read_to_string(path()).unwrap();
    assert!(content.contains("before failure\n"));
    assert!(content.ends_with("after recovery\n"));
    assert_eq!(ENSURES.load(Ordering::Relaxed), 2);
}
#[test]
fn rotation_failure_keeps_old_diagnostics_and_retries_later() {
    log::line("x".repeat(999_970)); log::inject_read_only_handle();
    let before = std::fs::read(path()).unwrap();
    log::line("rotation cannot truncate read-only handle");
    assert!(!log::cached()); assert_eq!(std::fs::read(path()).unwrap(), before);
    log::line("rotation recovered");
    assert!(std::fs::read_to_string(path()).unwrap().ends_with("rotation recovered\n"));
    assert!(std::fs::metadata(path()).unwrap().len() <= 1_000_000);
}
#[test]
fn oversize_utf8_diagnostic_is_capped_without_invalid_text() {
    log::line("🦀".repeat(300_000));
    let content = std::fs::read_to_string(path()).unwrap();
    assert!(content.len() <= 1_000_000);
    assert!(content.starts_with("2026-10-14 12:34:56 "));
    assert!(content.ends_with("… [truncated]\n"));
    log::line("next important diagnostic");
    assert!(std::fs::read_to_string(path()).unwrap().ends_with("next important diagnostic\n"));
}
#[test]
fn startup_uses_existing_length_for_rotation() {
    std::fs::write(path(), "old".repeat(333_334)).unwrap();
    log::line("startup diagnostic");
    assert_eq!(std::fs::read_to_string(path()).unwrap(), "2026-10-14 12:34:56 startup diagnostic\n");
}
'''

with tempfile.TemporaryDirectory(prefix="notch-backend-native-") as temp:
    temp = Path(temp)
    failures = 0
    fixture_log = temp / "production-log.rs"
    fixture_log.write_text(log_source, encoding="utf-8")
    log_harness = log_harness.replace("LOG_SOURCE", str(fixture_log).replace("\\", "\\\\"))
    gate = "use std::sync::atomic::{AtomicBool, Ordering};\nuse std::sync::{Arc, Condvar, Mutex};\nuse std::time::{Duration, Instant};\n#[derive(Default)] pub struct IslandRect;\n" + gate_source + adapters + gate_tests + stats_fixture + clipboard_fixture
    for name, source in [("gate", gate), ("log", log_harness)]:
        rs = temp / f"{name}.rs"
        rs.write_text(source, encoding="utf-8")
        binary = temp / name
        mode = sys.argv[1] if len(sys.argv) > 1 else "test"
        subprocess.run([RUSTC, "--edition=2021", "-Awarnings", "-O", *(["--test"] if mode == "test" else []), str(rs), "-o", str(binary)], check=True)
        print(f"{name}: {'baseline' if baseline else 'working tree'}", flush=True)
        if mode == "test":
            if name == "gate":
                result = subprocess.run([str(binary), "--nocapture"])
                failures += result.returncode != 0
            else:
                listed = subprocess.check_output([str(binary), "--list"], text=True)
                for line in listed.splitlines():
                    if not line.endswith(": test"): continue
                    case = line.removesuffix(": test")
                    directory = temp / case; directory.mkdir()
                    env = {**os.environ, "BACKEND_TEST_LOG_DIR": str(directory)}
                    failures += subprocess.run([str(binary), "--exact", case, "--nocapture"], env=env).returncode != 0
        else:
            for repeat in range(3):
                directory = temp / f"{name}-{repeat}"; directory.mkdir()
                env = {**os.environ, "BACKEND_TEST_LOG_DIR": str(directory)}
                subprocess.run([str(binary)], env=env, check=True)
            if shutil.which("strace"):
                directory = temp / f"{name}-strace"; directory.mkdir()
                subprocess.run(["strace", "-f", "-c", "-e", "trace=openat,newfstatat,statx,chmod,close,write,writev,clock_nanosleep,futex", str(binary)], env={**os.environ, "BACKEND_TEST_LOG_DIR": str(directory)}, check=True)
    sys.exit(bool(failures))
