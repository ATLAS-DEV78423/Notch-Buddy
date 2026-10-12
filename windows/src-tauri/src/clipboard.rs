// Clipboard URL detection — one background thread watches the clipboard for a
// copied http(s) URL and emits `clipboard-url` to the island. Cheap by design:
// `GetClipboardSequenceNumber` changes only when the clipboard actually
// changes, so the full clipboard read (which copies the whole content) happens
// on a real change, not every tick. Parks on the shared PollGate like the other
// pollers: a hidden island costs nothing.

use std::sync::Arc;
use tauri::AppHandle;

use crate::island::PollGate;

#[cfg(windows)]
mod imp {
    use std::sync::Arc;
    use std::time::Duration;

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::{HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    use crate::island::{PollGate, WINDOW_LABEL};

    #[derive(Serialize, Clone)]
    struct ClipboardUrl {
        url: String,
    }

    /// Reads the clipboard as text. OpenClipboard can fail whenever another
    /// app holds it — that is a normal race, not an error worth reporting.
    /// Every path out closes the clipboard again.
    fn read_text() -> Option<String> {
        unsafe {
            if OpenClipboard(None).is_err() {
                return None;
            }
            let text = read_text_open();
            let _ = CloseClipboard();
            text
        }
    }

    /// SAFETY: called with the clipboard open, so the handle it fetches stays
    /// valid until the matching CloseClipboard.
    unsafe fn read_text_open() -> Option<String> {
        let handle: HANDLE = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
        if handle.is_invalid() {
            return None;
        }
        // HGLOBAL is Copy and never freed here: clipboard memory belongs to
        // the clipboard, we only read through it.
        let hglobal = HGLOBAL(handle.0);
        let size = GlobalSize(hglobal);
        if size < 2 {
            return None;
        }
        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            return None;
        }
        // SAFETY: GlobalLock gives `size` readable bytes for as long as the
        // lock is held; UTF-16 units up to the first NUL are the string.
        let text = std::slice::from_raw_parts(ptr as *const u16, size / 2);
        let len = text.iter().position(|&u| u == 0).unwrap_or(text.len());
        let result = String::from_utf16(&text[..len]).ok();
        // The unlock result is always ignored: a single-lock object reports
        // ERROR_NOT_LOCKED once the count reaches zero, which is the normal case.
        let _ = GlobalUnlock(hglobal);
        result
    }

    /// `^https?://`, case-insensitive — the same rule as the reference.
    fn is_url(text: &str) -> bool {
        let b = text.as_bytes();
        let starts = |p: &[u8]| b.len() >= p.len() && b[..p.len()].eq_ignore_ascii_case(p);
        starts(b"http://") || starts(b"https://")
    }

    /// Parks on the shared gate: no polling, no reads while the island is
    /// hidden. Emits `clipboard-url` with `{ url }` on every change that
    /// carries a new http(s) URL.
    pub fn setup(app: &AppHandle, gate: Arc<PollGate>) {
        let app = app.clone();
        std::thread::spawn(move || {
            let mut last_seq = 0u32;
            let mut last_text = String::new();
            loop {
                gate.wait_until_active();
                while gate.is_active() {
                    let seq = unsafe { GetClipboardSequenceNumber() };
                    if seq != last_seq {
                        last_seq = seq;
                        if let Some(text) = read_text() {
                            if !text.is_empty() && text != last_text {
                                last_text = text;
                                if is_url(&last_text) {
                                    let _ = app
                                        .emit_to(WINDOW_LABEL, "clipboard-url", ClipboardUrl {
                                            url: last_text.clone(),
                                        });
                                }
                            }
                        }
                    }
                    std::thread::sleep(Duration::from_secs(1));
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

pub fn setup_clipboard(app: &AppHandle, gate: Arc<PollGate>) {
    imp::setup(app, gate);
}
