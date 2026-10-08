// Windows System Media Transport Controls (SMTC) — the Rust side of the media
// player. One background poller reads the current session (track, artist,
// album art, playing state, position) and emits `media-state` whenever it
// changes and `media-changed` whenever the track or source app switches. The
// four commands reach for the same session; with no session — nothing plays —
// they return a friendly error instead of failing.

use tauri::AppHandle;

#[cfg(windows)]
mod imp {
    use std::cell::Cell;
    use std::sync::Mutex;
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

    use crate::island::WINDOW_LABEL;

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
    /// for the same song.
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
        let uri = fetch_thumbnail(props).unwrap_or_default();
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

    pub fn poll_once(app: &AppHandle) {
        let state = current_state();
        let track = state
            .as_ref()
            .map(|s| (s.track.clone(), s.artist.clone(), s.source_app.clone()));
        let mut watch = WATCH.lock().unwrap();
        if state != watch.last {
            let _ = app.emit_to(WINDOW_LABEL, "media-state", &state);
            watch.last = state;
        }
        if track != watch.track {
            let _ = app.emit_to(WINDOW_LABEL, "media-changed", ());
            watch.track = track;
        }
    }

    pub fn setup(app: &AppHandle) {
        let app = app.clone();
        std::thread::spawn(move || {
            ensure_com();
            loop {
                std::thread::sleep(Duration::from_secs(1));
                poll_once(&app);
            }
        });
    }
}

#[cfg(not(windows))]
mod imp {
    use tauri::AppHandle;

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
    pub fn setup(_app: &AppHandle) {}
    pub fn poll_once(_app: &AppHandle) {}
}

#[tauri::command]
pub async fn media_play_pause(app: AppHandle) -> Result<(), String> {
    imp::play_pause()?;
    // Refresh now: the play/pause glyph must flip with the click, not a second later.
    imp::poll_once(&app);
    Ok(())
}

#[tauri::command]
pub async fn media_next(app: AppHandle) -> Result<(), String> {
    imp::next()?;
    imp::poll_once(&app);
    Ok(())
}

#[tauri::command]
pub async fn media_prev(app: AppHandle) -> Result<(), String> {
    imp::prev()?;
    imp::poll_once(&app);
    Ok(())
}

#[tauri::command]
pub async fn media_seek(app: AppHandle, position: f64) -> Result<(), String> {
    imp::seek(position)?;
    imp::poll_once(&app);
    Ok(())
}

pub fn setup_media(app: &AppHandle) {
    imp::setup(app);
}
