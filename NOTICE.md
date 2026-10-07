# Notch-Buddy — fork notice and attribution

Notch-Buddy is a fork of **[Coucou](https://github.com/Louis-CFM/coucou)** by
**Louis Raillé**. It is an independent project, not affiliated with, endorsed by or
sponsored by the original author.

## What the original project is

Coucou is a notch and Dynamic Island companion that watches AI coding agent sessions —
Claude Code, Codex, Gemini CLI, Copilot CLI, Muse Code, Antigravity and others — and lets
you approve, answer and chat without leaving what you are doing. The original project and
its full history are at <https://github.com/Louis-CFM/coucou>.

## Licensing, in one place

| What | Licence | Who holds it |
|---|---|---|
| Source code (original) | MIT | © 2026 Louis Raillé |
| Source code (this fork's changes) | MIT | © 2026 ATLAS-DEV78423 |
| The names "Coucou" and "Mochi" | All rights reserved | © 2026 Louis Raillé |
| The Mochi character | All rights reserved | © 2026 Louis Raillé |
| The app icon and menu bar icon | All rights reserved | © 2026 Louis Raillé |
| The sounds | All rights reserved | © 2026 Louis Raillé |
| The images, GIFs and videos in `docs/media/` and `design/` | All rights reserved | © 2026 Louis Raillé |

The MIT notice for the original code is retained in [LICENSE](LICENSE) because the MIT
License requires it. The fork's own changes are covered by the same licence, under
ATLAS-DEV78423's copyright line.

## What this fork does and does not use

**This fork does not claim, and may not use, the reserved assets.** It ships under the name
Notch-Buddy with its own character name. The Coucou name, the Mochi character, the icon, the
sounds and the media remain the property of Louis Raillé and are described in
[LICENSE-ASSETS.md](LICENSE-ASSETS.md).

> **Before distributing this fork**, the reserved assets still present in this repository
> must be replaced with your own:
> - `NotchBuddy/Assets.xcassets/` — app icon and menu bar icon
> - `NotchBuddy/Resources/sounds/` — the 28 WAV files
> - `docs/media/` and `design/` — screenshots, GIFs and videos
> - `NotchBuddy/PhoneAssets.xcassets/` — the iPhone app icons
>
> Shipping those files under the Notch-Buddy name is not permitted by their licence.

## Built artifacts still carry the original names

This rebrand covers **documentation, licensing and attribution**. It does not rename the
build outputs, because those names are wired into the build and into things already
installed on disk. The following are unchanged on purpose:

| Thing | Value | Why it stays |
|---|---|---|
| macOS bundle name | `Coucou.app`, `Coucou.zip` | `PRODUCT_NAME: Coucou` in `NotchBuddy/project.yml` |
| Linux packages | `Coucou-Linux-*.AppImage` / `.deb` / `.rpm` | produced by `windows/scripts/pack.mjs` |
| Windows installer | `Coucou-Windows-*-setup.exe` | produced by the NSIS config |
| Bundle identifier | `fr.louisraille.NotchBuddy` | Keychain items, preferences and permissions are keyed to it |
| CloudKit container | `iCloud.fr.louisraille.Coucou` | the iPhone link depends on it |
| On-disk paths | `~/Library/Application Support/NotchBuddy/`, `%APPDATA%\Coucou`, `~/.config/coucou`, `nb.sock`, `coucou-hook` | every installed hook points at them |

Renaming any of these is a build change with real migration consequences for existing
installs, and is deliberately out of scope here. Until it is done, the README documents the
filenames the build actually produces.


## Contact

This fork: ATLAS-DEV78423.
Original project: Louis Raillé — <https://github.com/Louis-CFM/coucou/issues>.
