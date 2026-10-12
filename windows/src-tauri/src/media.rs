// Windows System Media Transport Controls (SMTC) — the Rust side of the media
// player. One background poller reads the current session (track, artist,
// album art, playing state, position) and emits `media-state` whenever it
// changes and `media-changed` whenever the track or source app switches. The
// four commands reach for the same session; with no session — nothing plays —
// they return a friendly error instead of failing.

use std::sync::Arc;
use tauri::AppHandle;

use crate::island::PollGate;

#[cfg(windows)]
mod imp {
    use std::cell::Cell;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use serde::Serialize;
    use tauri::{AppHandle, Emitter};
    use windows::core::Interface;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession, GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionMediaProperties,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStream};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    use crate::island::{PollGate, WINDOW_LABEL};

    #[derive(Serialize, Clone, PartialEq)]
    #[serde(rename_all = "camelCase")]
    struct MediaState {
        track: String,
        artist: String,
        album_art: String,
        playing: bool,
        /// Seconds.
        position: f64,
        /// Seconds.
        duration: f64,
        source_app: String,
    }

    /// The poller and the commands share this so a button press refreshes the
    /// island immediately instead of waiting up to a second for the next tick.
    struct Watch {
        last: Option<MediaState>,
        track: Option<(String, String, String)>,
    }

    static WATCH: Mutex<Watch> = Mutex::new(Watch { last: None, track: None });

    /// SMTC is WinRT: the calling thread must be COM-initialised. Tokio worker
    /// threads are not, once per thread is enough, and the init stays for the
    /// thread's life (uninitialising a pooled thread would race other tasks).
    fn ensure_com() {
        thread_local! {
            static INIT: Cell<bool> = const { Cell::new(false) };
        }
        INIT.with(|done| {
            if !done.get() {
                // S_FALSE (already MTA) and RPC_E_CHANGED_MODE (already STA)
                // are both fine to ignore: the thread can call WinRT either way.
                unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                }
                done.set(true);
            }
        });
    }

    fn ticks_to_secs(ticks: i64) -> f64 {
        ticks.max(0) as f64 / 10_000_000.0
    }

    /// Runs `f` with the current SMTC session. Everything stays on the calling
    /// thread (the async ops are completed with the blocking `.get()`), so the
    /// COM init above covers every call it makes.
    fn with_session<T>(f: impl FnOnce(&GlobalSystemMediaTransportControlsSession) -> Result<T, String>) -> Result<T, String> {
        ensure_com();
        let manager = session_manager()?;
        let session = manager
            .GetCurrentSession()
            .map_err(|_| "No media is playing".to_string())?;
        f(&session)
    }

    fn session_manager() -> Result<GlobalSystemMediaTransportControlsSessionManager, String> {
        GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())
    }

    /// SMTC's Try* methods answer "the player accepted the request" through an
    /// async bool; `.get()` blocks this thread until that answer lands.
    fn accept(accepted: bool) -> Result<(), String> {
        if accepted {
            Ok(())
        } else {
            Err("The media player refused the request".to_string())
        }
    }

    pub fn play_pause() -> Result<(), String> {
        with_session(|s| {
            let op = s.TryTogglePlayPauseAsync().map_err(|e| e.to_string())?;
            accept(op.get().map_err(|e| e.to_string())?)
        })
    }

    pub fn next() -> Result<(), String> {
        with_session(|s| {
            let op = s.TrySkipNextAsync().map_err(|e| e.to_string())?;
            accept(op.get().map_err(|e| e.to_string())?)
        })
    }

    pub fn prev() -> Result<(), String> {
        with_session(|s| {
            let op = s.TrySkipPreviousAsync().map_err(|e| e.to_string())?;
            accept(op.get().map_err(|e| e.to_string())?)
        })
    }

    /// `position` is in seconds; SMTC wants 100-nanosecond ticks.
    pub fn seek(position: f64) -> Result<(), String> {
        let ticks = (position.max(0.0) * 10_000_000.0) as i64;
        with_session(|s| {
            let op = s.TryChangePlaybackPositionAsync(ticks).map_err(|e| e.to_string())?;
            accept(op.get().map_err(|e| e.to_string())?)
        })
    }

    fn current_state() -> Option<MediaState> {
        let manager = session_manager().ok()?;
        let session = manager.GetCurrentSession().ok()?;
        let info = session.GetPlaybackInfo().ok()?;
        let timeline = session.GetTimelineProperties().ok()?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;

        let playing = info.PlaybackStatus().ok()? == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
        let start = timeline.StartTime().map(|t| t.Duration).unwrap_or(0);
        let end = timeline.EndTime().map(|t| t.Duration).unwrap_or(0);
        let max_seek = timeline.MaxSeekTime().map(|t| t.Duration).unwrap_or(0);
        // Some players leave EndTime at 0 and only fill MaxSeekTime.
        let duration = if end > start { end - start } else { max_seek };

        Some(MediaState {
            track: props.Title().ok()?.to_string(),
            artist: props.Artist().unwrap_or_default().to_string(),
            album_art: read_thumbnail(&props),
            playing,
            position: ticks_to_secs(timeline.Position().map(|t| t.Duration).unwrap_or(0)),
            duration: ticks_to_secs(duration),
            source_app: session.SourceAppUserModelId().unwrap_or_default().to_string(),
        })
    }

    /// Album art as a data URI, cached per (title, artist): re-reading the
    /// thumbnail stream every poll would push image bytes around every second
    /// for the same song. Failures are not cached — a transient error would
    /// otherwise mean no art for the rest of the track.
    fn read_thumbnail(props: &GlobalSystemMediaTransportControlsSessionMediaProperties) -> String {
        static CACHE: Mutex<Option<(String, String, String)>> = Mutex::new(None);
        let Ok(title) = props.Title() else { return String::new() };
        let title = title.to_string();
        let artist = props.Artist().unwrap_or_default().to_string();
        {
            let cache = CACHE.lock().unwrap();
            if let Some((t, a, uri)) = cache.as_ref() {
                if *t == title && *a == artist {
                    return uri.clone();
                }
            }
        }
        let Some(uri) = fetch_thumbnail(props) else { return String::new() };
        *CACHE.lock().unwrap() = Some((title, artist, uri.clone()));
        uri
    }

    fn fetch_thumbnail(props: &GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
        let thumb = props.Thumbnail().ok()?;
        let stream = thumb.OpenReadAsync().ok()?.get().ok()?;
        let mime = stream
            .ContentType()
            .ok()
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "image/jpeg".to_string());
        let stream: IRandomAccessStream = stream.cast().ok()?;
        let size = stream.Size().ok()?;
        // Cap at 5 MB: anything bigger is not worth pushing over IPC every track change.
        if size == 0 || size > 5 * 1024 * 1024 {
            return None;
        }
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size as u32).ok()?.get().ok()?;
        let mut bytes = vec![0u8; size as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(format!("data:{mime};base64,{}", crate::claude::base64_for(&bytes)))
    }

    /// Returns whether a session exists — the watcher backs off when nothing plays.
    pub fn poll_once(app: &AppHandle) -> bool {
        ensure_com();
        let state = current_state();
        let has_session = state.is_some();
        let track = state
            .as_ref()
            .map(|s| (s.track.clone(), s.artist.clone(), s.source_app.clone()));
        let mut watch = WATCH.lock().unwrap();
        let track_changed = track != watch.track;
        if state != watch.last {
            // Album art is a base64 data URI, often hundreds of KB: only ship it
            // when the track changed; the 1 Hz position tick gets an empty string.
            let emit = match &state {
                Some(s) if !track_changed => Some(MediaState { album_art: String::new(), ..s.clone() }),
                other => other.clone(),
            };
            let _ = app.emit_to(WINDOW_LABEL, "media-state", &emit);
            watch.last = state;
        }
        if track_changed {
            let _ = app.emit_to(WINDOW_LABEL, "media-changed", ());
            watch.track = track;
        }
        has_session
    }

    /// Parks on the same gate as the cursor poll: a hidden island costs nothing.
    /// With no session the loop drops to one lookup every 5 s until a player
    /// appears.
    pub fn setup(app: &AppHandle, gate: Arc<PollGate>) {
        let app = app.clone();
        std::thread::spawn(move || {
            ensure_com();
            loop {
                gate.wait_until_active();
                while gate.is_active() {
                    let period = if poll_once(&app) { 1 } else { 5 };
                    std::thread::sleep(Duration::from_secs(period));
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

    pub fn play_pause() -> Result<(), String> {
        Err("Media controls are Windows-only".to_string())
    }
    pub fn next() -> Result<(), String> {
        Err("Media controls are Windows-only".to_string())
    }
    pub fn prev() -> Result<(), String> {
        Err("Media controls are Windows-only".to_string())
    }
    pub fn seek(_position: f64) -> Result<(), String> {
        Err("Media controls are Windows-only".to_string())
    }
    pub fn setup(_app: &AppHandle, _gate: Arc<PollGate>) {}
    pub fn poll_once(_app: &AppHandle) -> bool {
        false
    }
}

/// The SMTC round-trip completes with the blocking `.get()`; a hung player
/// must not pin a tokio worker (that runtime also serves chat and approvals),
/// so every command body runs on the blocking pool — same as system_control.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn media_play_pause(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        imp::play_pause()?;
        // Refresh now: the play/pause glyph must flip with the click, not a second later.
        let _ = imp::poll_once(&app);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn media_next(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        imp::next()?;
        let _ = imp::poll_once(&app);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn media_prev(app: AppHandle) -> Result<(), String> {
    blocking(move || {
        imp::prev()?;
        let _ = imp::poll_once(&app);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn media_seek(app: AppHandle, position: f64) -> Result<(), String> {
    blocking(move || {
        imp::seek(position)?;
        let _ = imp::poll_once(&app);
        Ok(())
    })
    .await
}

pub fn setup_media(app: &AppHandle, gate: Arc<PollGate>) {
    imp::setup(app, gate);
}
