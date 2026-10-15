// Small append-only log at %LOCALAPPDATA%\Coucou\coucou.log (Windows) or
// ~/.local/share/coucou/coucou.log (Linux) — the equivalent of nbLog() in
// HookServer.swift. Nothing leaves the machine.

use std::fs::{File, OpenOptions};
use std::io::Write;
#[cfg(windows)]
use std::io::{Seek, SeekFrom};
use std::sync::Mutex;

use crate::{platform, settings};

const MAX_BYTES: u64 = 1_000_000;

struct AppendLog {
    file: File,
    len: u64,
}

static LOG: Mutex<Option<AppendLog>> = Mutex::new(None);

pub fn line(message: impl AsRef<str>) {
    let t = platform::local_time();
    let stamp = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        t.year, t.month, t.day, t.hour, t.minute, t.second
    );
    let mut record = format!("{stamp} {}\n", message.as_ref());
    if record.len() as u64 > MAX_BYTES {
        const SUFFIX: &str = "… [truncated]\n";
        let mut end = MAX_BYTES as usize - SUFFIX.len();
        while !record.is_char_boundary(end) { end -= 1; }
        record.truncate(end);
        record.push_str(SUFFIX);
    }
    let mut log = LOG.lock().unwrap_or_else(|e| e.into_inner());
    let result = (|| -> std::io::Result<()> {
        if log.is_none() {
            let dir = settings::local_dir();
            platform::ensure_private_dir(&dir)?;
            let mut options = OpenOptions::new();
            options.create(true).append(true);
            // Windows append-only access cannot truncate; the mutex owns this
            // writer's EOF position instead, including after rotation.
            #[cfg(windows)]
            options.append(false).write(true);
            #[cfg(unix)]
            std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
            let file = options.open(dir.join("coucou.log"))?;
            #[cfg(windows)]
            let mut file = file;
            #[cfg(windows)]
            file.seek(SeekFrom::End(0))?;
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
            }
            let len = file.metadata()?.len();
            *log = Some(AppendLog { file, len });
        }
        let log = log.as_mut().unwrap();
        // shortcut: sole writer, add file identity checks if external rotation is supported.
        if log.len.saturating_add(record.len() as u64) > MAX_BYTES {
            // Truncate the same private file, retaining Unix mode and Windows ACL.
            log.file.set_len(0)?;
            #[cfg(windows)]
            log.file.seek(SeekFrom::Start(0))?;
            log.len = 0;
        }
        // No user-space buffering: complete lines are serialized under the lock.
        log.file.write_all(record.as_bytes())?;
        log.len += record.len() as u64;
        Ok(())
    })();
    if result.is_err() {
        // Retry once on the next diagnostic, never spin or recurse into logging.
        *log = None;
    }
}
