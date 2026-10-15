// Dropped files are copied into %LOCALAPPDATA%\Coucou\inbox so the original is
// never touched and the copy survives the drag source going away.
// The inbox is swept of anything older than a week, as on macOS.

use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::settings;

const KEEP_FOR: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// Shared ceiling for binary attachments sent to any chat provider.
pub const MAX_ATTACHMENT_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

pub fn inbox_dir() -> PathBuf {
    settings::local_dir().join("inbox")
}

pub fn ingest(source: &str) -> Result<DroppedFile, String> {
    let dir = inbox_dir();
    crate::platform::ensure_private_dir(&settings::local_dir()).map_err(|e| e.to_string())?;
    ingest_into(source, &dir)
}

fn ingest_into(source: &str, dir: &Path) -> Result<DroppedFile, String> {
    let src = Path::new(source);
    let meta = std::fs::metadata(src).map_err(|e| format!("cannot read {source}: {e}"))?;
    if !meta.is_file() {
        return Err("Only regular files can be dropped. Folders are not supported.".into());
    }
    let mut input = std::fs::File::open(src).map_err(|e| format!("cannot read {source}: {e}"))?;
    if !input.metadata().map_err(|e| format!("cannot read {source}: {e}"))?.is_file() {
        return Err("Only regular files can be dropped. Folders are not supported.".into());
    }

    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());

    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = src.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    let (dest, output) = reserve_destination(dir, &name, &stem, &ext)?;
    let size = copy_into(&mut input, output, &dest)?;
    sweep(dir, src);

    Ok(DroppedFile {
        name,
        path: dest.to_string_lossy().to_string(),
        size,
    })
}

fn copy_into(input: &mut impl Read, mut output: std::fs::File, dest: &Path) -> Result<u64, String> {
    let copy_result = (|| -> io::Result<u64> {
        let size = io::copy(input, &mut output)?;
        output.flush()?;
        Ok(size)
    })();
    match copy_result {
        Ok(size) => {
            // Age the inbox copy from ingestion, never from the source's timestamp.
            let _ = output.set_modified(SystemTime::now());
            drop(output);
            Ok(size)
        }
        Err(error) => {
            drop(output);
            if let Err(cleanup) = std::fs::remove_file(dest) {
                return Err(format!("cannot copy: {error}; cannot remove incomplete destination: {cleanup}"));
            }
            Err(format!("cannot copy: {error}"))
        }
    }
}

fn reserve_destination(
    dir: &Path,
    name: &str,
    stem: &str,
    ext: &str,
) -> Result<(PathBuf, std::fs::File), String> {
    let candidates = std::iter::once(dir.join(name)).chain(
        (2..1000).map(|i| dir.join(format!("{stem} ({i}){ext}"))),
    );

    for candidate in candidates {
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&candidate)
        {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("cannot create destination: {error}")),
        }
    }

    Err("cannot create destination: all file name suffixes are in use".into())
}

fn validate_inbox_file_in(path: &str, inbox: &Path) -> bool {
    let Ok(canonical_inbox) = std::fs::canonicalize(inbox) else { return false };
    let path = Path::new(path);
    // Reject arbitrary paths before doing filesystem queries on the supplied path.
    if path.parent() != Some(inbox) && path.parent() != Some(canonical_inbox.as_path()) {
        return false;
    }
    let Ok(path) = std::fs::canonicalize(path) else { return false };
    if path.parent() != Some(canonical_inbox.as_path()) || !path.is_file() {
        return false;
    }
    let Ok(file) = std::fs::File::open(path) else { return false };
    file.metadata().map(|meta| meta.is_file()).unwrap_or(false)
}

/// Checks only readable regular files directly inside the canonical inbox.
pub fn validate_inbox_file(path: &str) -> bool {
    validate_inbox_file_in(path, &inbox_dir())
}

/// Drops anything copied here more than a week ago. `ingest` stamps every copy
/// with the time it landed, so this really is the age of the copy and not the
/// age of whatever the user happened to drag in.
fn sweep(dir: &Path, source: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let source = std::fs::canonicalize(source).ok();
    let now = SystemTime::now();
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(copied) = meta.modified() else { continue };
        if now.duration_since(copied).map(|age| age > KEEP_FOR).unwrap_or(false) {
            // Re-dropping an old inbox file must not delete that source.
            if source.as_ref() == std::fs::canonicalize(entry.path()).ok().as_ref() {
                continue;
            }
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Barrier};
    use std::thread;

    fn temp_dir(label: &str) -> PathBuf {
        let id = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("coucou-{label}-{}-{id}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        dir
    }

    #[test]
    fn ingest_copies_and_never_overwrites() {
        let tmp = temp_dir("copy");
        let inbox = tmp.join("inbox");
        let source = tmp.join("note.txt");
        std::fs::write(&source, b"hello").unwrap();

        let first = ingest_into(source.to_str().unwrap(), &inbox).unwrap();
        assert_eq!(first.name, "note.txt");
        assert_eq!(first.size, 5);
        assert_eq!(std::fs::read(&first.path).unwrap(), b"hello");

        // A second drop of the same name must not clobber the first copy.
        std::fs::write(&source, b"second").unwrap();
        let second = ingest_into(source.to_str().unwrap(), &inbox).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(std::fs::read(&first.path).unwrap(), b"hello");
        assert_eq!(std::fs::read(&second.path).unwrap(), b"second");
        assert_eq!(std::fs::read(&source).unwrap(), b"second");

        // Folders are refused rather than silently ignored.
        assert!(ingest_into(tmp.to_str().unwrap(), &inbox).is_err());

        // Missing paths are refused without creating an inbox entry.
        let missing = tmp.join("missing.txt");
        assert!(ingest_into(missing.to_str().unwrap(), &inbox).is_err());
        assert_eq!(std::fs::read_dir(&inbox).unwrap().count(), 2);

        // An ancient source must not arrive already older than the sweep window.
        let old_source = tmp.join("ancient.txt");
        std::fs::write(&old_source, b"old").unwrap();
        let long_ago = SystemTime::now() - KEEP_FOR - Duration::from_secs(60 * 60);
        std::fs::File::options()
            .write(true)
            .open(&old_source)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        let aged = ingest_into(old_source.to_str().unwrap(), &inbox).unwrap();
        assert_eq!(std::fs::read(&old_source).unwrap(), b"old");
        assert!(
            Path::new(&aged.path).exists(),
            "a file copied just now was swept as if it were a week old"
        );
        let _ = std::fs::remove_file(&aged.path);

        let _ = std::fs::remove_file(&first.path);
        let _ = std::fs::remove_file(&second.path);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn concurrent_duplicate_drops_get_distinct_destinations() {
        let tmp = temp_dir("concurrent");
        let inbox = tmp.join("inbox");
        let source = Arc::new(tmp.join("same.txt"));
        let barrier = Arc::new(Barrier::new(16));
        std::fs::write(&*source, b"same content").unwrap();

        let handles: Vec<_> = (0..16)
            .map(|_| {
                let source = Arc::clone(&source);
                let inbox = inbox.clone();
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    ingest_into(source.to_str().unwrap(), &inbox).unwrap()
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|handle| handle.join().unwrap()).collect();

        let mut paths: Vec<_> = results.iter().map(|file| file.path.clone()).collect();
        paths.sort();
        paths.dedup();
        assert_eq!(paths.len(), results.len());
        for path in paths {
            assert_eq!(std::fs::read(path).unwrap(), b"same content");
        }
        assert_eq!(std::fs::read(&*source).unwrap(), b"same content");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn ingest_fails_when_all_suffixes_are_taken() {
        let tmp = temp_dir("saturated");
        let inbox = tmp.join("inbox");
        std::fs::create_dir_all(&inbox).unwrap();
        let source = tmp.join("same.txt");
        std::fs::write(&source, b"source").unwrap();
        std::fs::write(inbox.join("same.txt"), b"original").unwrap();
        for i in 2..1000 {
            std::fs::write(inbox.join(format!("same ({i}).txt")), b"occupied").unwrap();
        }

        let error = match ingest_into(source.to_str().unwrap(), &inbox) {
            Ok(_) => panic!("ingest unexpectedly found a free destination"),
            Err(error) => error,
        };
        assert!(error.contains("all file name suffixes are in use"));
        assert_eq!(std::fs::read(inbox.join("same.txt")).unwrap(), b"original");
        assert!(!inbox.join("same (1000).txt").exists());
        assert_eq!(std::fs::read(&source).unwrap(), b"source");
        assert_eq!(std::fs::read_dir(&inbox).unwrap().count(), 999);
        for i in 2..1000 {
            assert_eq!(std::fs::read(inbox.join(format!("same ({i}).txt"))).unwrap(), b"occupied");
        }
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn validate_inbox_file_restricts_to_readable_regular_children() {
        let tmp = temp_dir("validate");
        let inbox = tmp.join("inbox");
        std::fs::create_dir_all(&inbox).unwrap();
        let file = inbox.join("inside.txt");
        let folder = inbox.join("folder");
        let outside = tmp.join("outside.txt");
        std::fs::write(&file, b"inside").unwrap();
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(&outside, b"outside").unwrap();
        let nested = folder.join("nested.txt");
        std::fs::write(&nested, b"nested").unwrap();

        assert!(validate_inbox_file_in(file.to_str().unwrap(), &inbox));
        assert!(!validate_inbox_file_in(folder.to_str().unwrap(), &inbox));
        assert!(!validate_inbox_file_in(outside.to_str().unwrap(), &inbox));
        assert!(!validate_inbox_file_in(nested.to_str().unwrap(), &inbox));
        assert!(!validate_inbox_file_in(inbox.join("../outside.txt").to_str().unwrap(), &inbox));
        assert!(!validate_inbox_file_in(inbox.join("missing").to_str().unwrap(), &inbox));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn copy_error_removes_partial_destination() {
        struct FailingReader(bool);
        impl Read for FailingReader {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                if self.0 {
                    return Err(io::Error::new(io::ErrorKind::Other, "injected read failure"));
                }
                self.0 = true;
                buffer[0] = b'x';
                Ok(1)
            }
        }
        let tmp = temp_dir("failed-copy");
        let (dest, output) = reserve_destination(&tmp, "partial.txt", "partial", ".txt").unwrap();
        let error = copy_into(&mut FailingReader(false), output, &dest).unwrap_err();
        assert!(error.contains("injected read failure"));
        assert!(!dest.exists());
        assert_eq!(std::fs::read_dir(&tmp).unwrap().count(), 0);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn sweep_removes_expired_copies_but_preserves_source_and_recent_files() {
        let tmp = temp_dir("sweep");
        let source = tmp.join("source.txt");
        let expired = tmp.join("expired.txt");
        let recent = tmp.join("recent.txt");
        for path in [&source, &expired, &recent] {
            std::fs::write(path, b"keep source").unwrap();
        }
        for path in [&source, &expired] {
            std::fs::File::options().write(true).open(path).unwrap()
                .set_modified(SystemTime::now() - KEEP_FOR - Duration::from_secs(60)).unwrap();
        }
        let dropped = ingest_into(source.to_str().unwrap(), &tmp).unwrap();
        assert!(!expired.exists());
        assert!(recent.exists());
        assert_eq!(std::fs::read(&source).unwrap(), b"keep source");
        assert_eq!(std::fs::read(&dropped.path).unwrap(), b"keep source");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[cfg(unix)]
    #[test]
    fn validator_rejects_symlinks_outside_the_inbox() {
        let tmp = temp_dir("symlink");
        let inbox = tmp.join("inbox");
        std::fs::create_dir(&inbox).unwrap();
        let outside = tmp.join("outside.txt");
        std::fs::write(&outside, b"outside").unwrap();
        let link = inbox.join("link.txt");
        std::os::unix::fs::symlink(&outside, &link).unwrap();
        assert!(!validate_inbox_file_in(link.to_str().unwrap(), &inbox));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
