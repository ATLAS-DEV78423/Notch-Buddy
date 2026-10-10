<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="Notch-Buddy icon">

# Notch-Buddy for Windows

**Pip doesn't get a notch on a PC — so it lives at the top of your screen instead.**

Approve Claude Code permissions, watch your session work, drop a file, chat with Claude, keep an eye on your services — without leaving what you're doing.

![Windows 10/11](https://img.shields.io/badge/Windows-10%2F11-0078D4?logo=windows)
![Tauri 2](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)
![Rust](https://img.shields.io/badge/Rust-backend-000?logo=rust)
![Code: MIT](https://img.shields.io/badge/code-MIT-green)

</div>

<img src="screenshots/greeting.png" width="640" alt="Pip waving hello at launch">

---

## Install

Grab `Coucou-Windows-0.2.0-setup.exe` (or the `.msi`) from
[Releases](https://github.com/ATLAS-DEV78423/Notch-Buddy/releases/tag/windows-v0.2.0)
and run it — current-user install, no admin prompt. The installer is not
code-signed yet, so SmartScreen warns: click **More info → Run anyway**.
Microsoft Defender may also flag it (`Trojan:Win32/Wacatac.H!ml`, a known false
positive reported to Microsoft); if it does, choose **Allow**. Prefer not to?
[Build it yourself](#build-it-yourself) — it takes a few minutes.

## Using it

<img src="screenshots/compact.png" width="292" alt="The compact island, with the integration pills as mini Pips">
<img src="screenshots/overview.png" width="640" alt="The overview: the focused integration on the left, the other pills on the right">
<img src="screenshots/approval.png" width="640" alt="A Claude Code permission request, with Deny and Allow">
<img src="screenshots/chat.png" width="640" alt="Chatting with Claude from the island">
<img src="screenshots/drop.png" width="640" alt="Pip turned into a box, waiting for a file">

| What you do | What happens |
|---|---|
| Move the mouse to the very top-centre of the screen | Pip peeks out |
| Click the small island | It opens |
| Click Pip | It gets annoyed. Three times in a row and it goes dizzy |
| Rest the pointer on Pip for two seconds | Hearts |
| Drag a file onto the island | Pip turns into a box, swallows it, then offers to answer questions about it |
| `Esc` | Closes the island |
| Tray icon | Open, Settings…, Pause, Quit |

Everything else happens on its own: a Claude Code permission request opens the
island with **Deny / Allow**, a finished session shows what it did, and
your integrations sit in the coloured pills next to Pip.

## New in 0.2.0

The island is now a set of tab groups — **Home, Agents, Media, System, Tools** — with a
dashboard of live widgets as the default view. Sessions, approvals, chat and file drop
are unchanged, one tab over.

| Where | What |
|---|---|
| Media tab | what's playing (any app with Windows media controls), play/pause/next/previous/seek, album art |
| System tab | CPU, memory and network live; volume, brightness, night light, Do Not Disturb and a memory boost; Bluetooth devices you can connect |
| Tools tab | pomodoro (25/5, with a notification when a block ends) and a stopwatch |
| Dashboard (Home) | system stats, battery, weather and your running timers at a glance |
| Anywhere | copy a URL and a banner offers to open it; a banner warns when the battery is low or full |
| Settings… | nine animated island backgrounds and an accent colour |
| Compact mode | a mini status strip — media, timer, battery — while the island is collapsed |

Weather comes from wttr.in (no key, no account), fetched about every 30 minutes and only
while the island is open. Pip reacts to what's going on: agent activity, battery, timers
and media all give him something to say.

Everything polls only while the island is visible: hidden, the app sits at 0 % CPU.

## Claude Code

<img src="screenshots/settings.png" width="562" alt="The settings window">

Open **Settings… → Claude Code → Install hooks…**. You get the exact diff of what
will change in `%USERPROFILE%\.claude\settings.json`, the path of the dated backup
that will be taken, and nothing is written until you click. Your own hooks are
never touched, and uninstalling removes only Notch-Buddy's entries.

The relay is a tiny executable, `coucou-hook.exe`, copied to
`%LOCALAPPDATA%\Coucou\bin\` at launch. It is given 300 ms to reach Notch-Buddy and
exits cleanly if the app is closed, slow or crashed — **a Claude Code session is
never blocked or slowed down by Notch-Buddy.** If nobody answers a permission request
in time, Notch-Buddy stays quiet and Claude Code asks in the terminal as usual.

It works from any terminal — Windows Terminal, PowerShell, VS Code, Git Bash.

## Chat and keys

**Settings… → Claude** takes your Anthropic API key. Keys live in the **Windows
Credential Manager**, never on disk and never in the interface — the island can
only ask whether a key exists. Same for every integration key.

No telemetry. The only network requests Notch-Buddy makes are to the services you
configure yourself — plus wttr.in for the optional weather widget (no key, no account,
about every 30 minutes, only while the island is open).

## Build it yourself

You need [Rust](https://rustup.rs), [Node 20+](https://nodejs.org), and the
**MSVC build tools** (Visual Studio Build Tools with "Desktop development with
C++"). WebView2 ships with Windows 10/11.

```powershell
cd windows
npm install
npm run tauri dev      # live-reloading development build
npm run pack           # builds the installer and drops it in windows/release/
```

`npm run dev` alone serves the front end in an ordinary browser, which is enough
to work on the island's looks. It also serves `dev/upload-preview.html`, which
replays the whole file-drop choreography on a loop — the one part of the UI that
otherwise needs a real drag from Explorer to see. Neither page ships in the app.

`npm run pack` leaves two files in `windows/release/`, the same names the release
workflow publishes:

```
Coucou-Windows-X.Y.Z-setup.exe    the versioned installer
Coucou-Windows-setup.exe          the same file under the rolling name
```

Installing is optional — `target/release/coucou.exe` runs on its own. There is no
window in the taskbar and no console: the island at the top of the screen and the
Pip in the notification area are the whole app, and Quit lives in its menu.

The 28 sounds are the macOS app's own files; they are never duplicated in this
folder. The path is declared once, in `SOUNDS_DIR` at the top of
`vite.config.ts` — when they move to `shared/sounds/`, change that one line.

The app icon and the tray icon are drawn in code, like Pip itself:

```powershell
npm run icons          # regenerates src-tauri/icons from scripts/gen-icons.mjs
```

### Layout

```
windows/
  src/                 island front end (TypeScript, no framework)
    mochi/             Pip and the launch greeting, in Canvas 2D
    island/            state machine, hooks, integrations
    views/             every island view
    settings/          the settings window
  src-tauri/           Rust backend: window, named pipe, Claude API, pollers
  hook/                coucou-hook.exe, the Claude Code relay
  scripts/             icon generator
```

### Log

`%LOCALAPPDATA%\Coucou\coucou.log` — hook events, permission decisions, poller
problems. It stays on your machine.

## Supported agents

The relay (`coucou-hook.exe`) works with any tool that can run a command on hook events. Pass `--agent <name>` to create a named pill.

| Agent | How to connect | Config file |
|---|---|---|
| Claude Code | **Settings → Claude Code → Install hooks** | `%USERPROFILE%\.claude\settings.json` |
| Gemini CLI | `--agent gemini` positional arg | `%USERPROFILE%\.gemini\settings.json` |
| Antigravity | `--agent antigravity` positional arg | `%USERPROFILE%\.config\antigravity\hooks.json` |
| Cursor | hooks installed automatically | `%USERPROFILE%\.claude\settings.json` |
| Codex | `--agent codex` positional arg | `%USERPROFILE%\.codex\hooks.json` |
| Copilot CLI | `--agent copilot` positional arg + camelCase events | `%USERPROFILE%\.copilot\hooks\coucou.json` |
| Muse Code | `--agent muse` positional arg | `%USERPROFILE%\.config\muse\settings.json` |
| Hermes | **Settings → Hermes → Install hooks** | `%USERPROFILE%\.hermes\config.yaml` |
| OpenCode | **Settings → OpenCode Plugin → Install** | `%USERPROFILE%\.config\opencode\plugins\coucou.js` |
| Any other | `--agent <name>` positional arg | your tool's hook config |

Amp is not yet supported on Windows or Linux. Its integration uses a plugin that calls `/bin/sh` with macOS-specific paths; the plugin installer lives in the Mac app only.

## What's different from the Mac version

- No notch, so the island lives at the top centre of the screen and retracts into
  the top edge instead of hiding in a notch.
- Permission approval works from **any** terminal; the Mac build only listens to
  VS Code sessions.
- Not in this version: sending a file by email, dragging Pip onto a window to
  attach it as context, and jumping to a specific terminal window — "Open
  terminal" opens the working folder in VS Code when `code` is on your `PATH`.
- Cal.com shows the next bookings as a list rather than the Mac's calendar.

## Linux

The same app builds for Linux: everything that differs lives in
`src-tauri/src/platform/`, and the relay's transport in `hook/src/unix.rs`.

```bash
sudo apt install build-essential pkg-config \
  libwebkit2gtk-4.1-dev libgtk-layer-shell-dev libayatana-appindicator3-dev \
  librsvg2-dev libssl-dev libdbus-1-dev patchelf \
  gstreamer1.0-plugins-base gstreamer1.0-plugins-good
npm install
npm run tauri dev      # live-reloading development build
npm run pack           # AppImage, .deb and .rpm in windows/release/
```

What changes on Linux:

- **The island** is a gtk-layer-shell overlay anchored to the top edge, over any
  top panel, on compositors that support it: COSMIC, KDE Plasma, Hyprland, Sway
  and other wlroots compositors. GNOME has no layer-shell, so there the island
  is a regular window. `COUCOU_LAYER_SHELL=0` forces that mode anywhere.
- **Click-through** is the window's input region, kept equal to the island
  shape, so the compositor sends every other click to what is underneath.
- **Pip's eyes** follow the pointer only while it is over the island: Wayland
  gives no app the cursor position anywhere else.
- **Claude Code hooks** go through `~/.local/share/coucou/bin/coucou-hook` and a
  Unix socket at `$XDG_RUNTIME_DIR/coucou.sock`. Both ends check that the other
  runs as the same user.
- **Keys** live in the Secret Service (GNOME Keyring, KWallet).
- **Files**: preferences in `~/.config/coucou/`, the log at
  `~/.local/share/coucou/coucou.log`.
- What the Windows build leaves out, this one does too: sending a file by
  email, dragging Pip onto a window, and jumping to a specific terminal
  window — "Open terminal" opens the folder in VS Code.

## Credits

The Windows and Linux build is a [Tauri 2](https://tauri.app) app (Rust + WebView2)
with a [Vite](https://vitejs.dev) + [TypeScript](https://www.typescriptlang.org/)
front end.

Two open-source projects shaped the island's look and feel, and both are credited
in full in [../NOTICE.md](../NOTICE.md):

- **React Bits** ([reactbits.dev](https://reactbits.dev), [DavidHDev/react-bits](https://github.com/DavidHDev/react-bits)) —
  six micro-interactions were ported into this app's own TypeScript in `src/ui/`:
  ThoughtLine, CallChip, SpringCheck, SquishSwitch, SwipeToast and SwipeRow.
- **bloom** ([SehajveerSingh2005/bloom](https://github.com/SehajveerSingh2005/bloom)) —
  the reactive-motion *feel* of the island shell and Mochi (per-property,
  interruptible springs) was inspired by bloom. The spring integrator here is a
  small hand-rolled reimplementation, not bloom's code.
