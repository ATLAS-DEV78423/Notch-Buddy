# Changelog

## 0.3.0 — October 10, 2026

**Notch-Buddy for Windows 0.3.0** (`windows-v0.3.0`).

- **Pip becomes the living indicator** of system, media, agent and touch events. A per-property
  spring system drives the island shell (width, height, y and radius settle independently), and a
  reaction bus composes persistent conditions, session state and transient flashes onto Pip:
  brightness and volume glow, mute and theme flashes, battery drained/charging/full, session
  approval/done/error/ratelimit, media playing/paused/loud and track changes, plus tap-to-tickle
  and hold-to-nuzzle.
- **DOM choreography** — the pomodoro countdown rolls its digits, long ticker rows marquee with
  holds, and views enter and exit asymmetrically.
- **Hover-grace and event-peek** — a brief pointer exit no longer collapses the island, and a
  bounded event-peek force-reveals it for up to four seconds.
- A dev-only reaction harness is available on the island window with `?reactions=1`.
- **Fixes** — the island shell no longer leaks a pending event-peek deferral on interaction; the
  battery conditions ride the app's existing Rust battery source instead of an unverified WebView2
  API; session reactions now outrank media reactions as specified; the ported UI modules (pointer,
  springcheck, squishswitch, swipetoast, thoughtline) are tracked so a fresh clone builds.

## Rebrand — Notch-Buddy fork

- Forked from [Coucou](https://github.com/Louis-CFM/coucou) by Louis Raillé (MIT) and
  rebranded: **Coucou** → **Notch-Buddy**, **Mochi** → **Pip**. Documentation, licensing and
  attribution are updated — see [NOTICE.md](NOTICE.md).
- The original copyright is retained in [LICENSE](LICENSE), as the MIT License requires it to
  be. This fork's own changes are under © ATLAS-DEV78423.
- The Coucou name, the Mochi character, the icon, the sounds and the media remain
  © Louis Raillé and are **not** used by this fork. Those files are still in the repository
  and must be replaced before any distribution — [NOTICE.md](NOTICE.md) lists them.
- Build artifacts and on-disk identifiers were deliberately **not** renamed (`Coucou.app`,
  `Coucou.zip`, `Coucou-Linux-*`, `Coucou-Windows-*-setup.exe`, `fr.louisraille.NotchBuddy`,
  `iCloud.fr.louisraille.Coucou`, `nb.sock`, `coucou-hook`): existing installs and the build
  depend on them. See [NOTICE.md](NOTICE.md).
- **Everything below is the upstream Coucou changelog, unchanged.** Those releases were made
  by Louis Raillé under the Coucou name. This fork did not make them and does not rewrite
  them.

## 0.2.0 — October 8, 2026

- **Notch-Buddy for Windows 0.2.0** — the island becomes a full desktop companion
  (`windows-v0.2.0`). Download it from
  [Releases](https://github.com/ATLAS-DEV78423/Notch-Buddy/releases/tag/windows-v0.2.0).
- **The island is now a set of tab groups** — Home, Agents, Media, System, Tools — with a
  dashboard of live widgets as the default view (system stats, battery, weather, timers).
  Everything that was already there (sessions, approvals, chat, file drop, integrations)
  is unchanged, one tab over.
- **Media player** — see what's playing from any app that supports Windows media controls,
  with play/pause, next, previous and seek; album art when the player provides it
- **Control center** — volume, brightness, night light, Do Not Disturb and a memory-boost
  button in the island
- **System stats** — CPU, memory and network usage, live
- **Bluetooth** — list nearby devices and connect or disconnect them from the island
- **Pomodoro and stopwatch** — the 25/5 work–rest timer with a notification when a block
  ends, and a stopwatch
- **Weather** — current conditions from wttr.in (no key, no account), fetched about every
  30 minutes and only while the island is open
- **Battery alerts** — a banner when the battery is low or full; level and charging state
  on the dashboard and in compact mode
- **Clipboard** — copy a URL and a banner offers to open it
- **Background effects** — nine animated island backgrounds and an accent colour, pickable
  in Settings; Pip also reacts to what's going on (agent activity, battery, timers, media)
- **Compact mode** shows a mini status strip — media, timer, battery — while the island is
  collapsed
- Nothing polls while the island is hidden: 0 % CPU at rest (measured 0.00 %)

## 0.1.2 — October 8, 2026

- **Notch-Buddy for Windows 0.1.2** — the fork's first published Windows build
  (`windows-v0.1.2`). Download it from
  [Releases](https://github.com/ATLAS-DEV78423/Notch-Buddy/releases/tag/windows-v0.1.2).
- **The Hermes config path on Windows is fixed.** Hermes resolves its home as `$HERMES_HOME` if
  set, otherwise `%LOCALAPPDATA%\hermes` on Windows and `~/.hermes` on macOS and Linux. The
  installer used to write `~/.hermes/config.yaml` on every platform, so on Windows it reported
  success and Hermes never loaded the hooks. It now resolves the home the way Hermes does,
  verified with `hermes config path` *(Windows; macOS/Linux unchanged)*
- **Hermes sessions now carry their full lifecycle.** Coucou installs **seven** shell hooks —
  `pre_llm_call`, `pre_tool_call`, `post_tool_call`, `on_session_start`, `on_session_end`,
  `subagent_start`, `subagent_stop` — so a Hermes session creates its pill cleanly, shows subagent
  steps and clears on session end. Only `pre_tool_call` can block a tool, which is why it alone
  carries the `matcher` and the 130 s timeout *(macOS, Windows, Linux)*
- Hermes Agent sessions show up in the notch: see every step live, and approve or deny
  Hermes tool calls right from the island. Hermes' `pre_tool_call` hook can block, so a
  Deny from Coucou actually stops the tool. Install from Settings → Hermes; Coucou shows
  what will change in the Hermes config and backs it up before writing *(macOS, Windows, Linux)*
- OpenCode now works on Windows and Linux, not just macOS: the plugin installs to the same
  `~/.config/opencode/plugins/` path on every platform. OpenCode permissions are shown in
  the ticker and answered in OpenCode's own terminal — its plugin API cannot return a
  decision, so Coucou does not pretend to *(macOS, Windows, Linux)*
- OpenCode sessions show file diffs in the ticker, and every agent pill now uses its
  declared colour on Windows and Linux instead of a random one
- Hermes on Windows: the installer now writes `%LOCALAPPDATA%\hermes\config.yaml` — the path
  Hermes actually reads — instead of `~/.hermes/config.yaml`, and installs all seven shell
  hooks so a Hermes session gets its pill, its subagent steps and a clean teardown. The relay
  speaks Hermes' receipt shape on Windows too, so Deny from the island blocks a tool and a
  timeout blocks rather than silently allowing. Verified against Hermes v0.21.5 on Windows:
  `hermes hooks list` shows all seven, `hermes hooks doctor` reports them healthy, the deny,
  timeout and unreachable paths were exercised headless through the built relay (9 Rust tests +
  17 Tauri tests + macOS relay dialect tests pass), and a closed Coucou leaves Hermes untouched.
  Not yet verified: the live Allow/Deny card in the island against a real Hermes session, the
  ~115 s no-answer timeout, and a live pill/ticker. macOS is untested here (no Swift toolchain).

## 0.2.0 — October 6, 2026

- GitHub Copilot CLI and Muse Code sessions show up in the notch: see every step live and approve or deny permissions right from the island. Install from Settings → Agents → Copilot CLI / Muse Code, which shows what will change in your config and backs it up before writing *(GitHub build)* (#263)
- OpenCode sessions appear in the notch via a small JavaScript plugin: install it from Settings → Agents → OpenCode. Same installer flow — preview, backup, confirm. OpenCode never blocks on the plugin (fire-and-forget), so Coucou never slows it down *(macOS, GitHub build)* (#263)
- Amp sessions appear in the notch the same way, via a TypeScript plugin: Settings → Agents → Amp *(macOS, GitHub build)* (#263)
- Weekly recap: on Monday morning, the first time an agent starts working or your Mac wakes, Coucou shows a card for the past week — time spent, sessions, files and lines changed, commands run, permissions and questions, plus your top agent, top project, busiest day and longest session. Open it any time from the menu bar with "Weekly recap" (#264)
- Share your week as a 1080 × 1920 image with Mochi: copy it, save it or share it from the notch. A privacy toggle lets you hide project names before sharing (#264)
- Everything stays on your Mac: the recap reads from a local history file (12-week rolling window) that never leaves your machine. Clear it any time in Settings → General → Weekly recap (#264)
- Coucou now speaks English, 中文, हिन्दी, Español, العربية, Français, বাংলা, Português, Русский and Bahasa Indonesia. Pick your language in Settings → General → Language, independent of your system locale. Translations welcome — open a pull request (#268)

## 0.1.9 — October 6, 2026

- Services up close on the iPhone: tap a service and your Mac fetches live data from its API — Vercel, GitHub, Stripe, Resend, Cal.com, n8n and Notion. The keys never leave the Mac; the detail is written to your iCloud encrypted (#251)
- Act from the iPhone: Vercel (redeploy, promote to production, cancel a build), GitHub (re-run failed jobs, approve, squash and merge), n8n (activate, deactivate, retry a failed run). Each action runs only if it was offered on an item in the last detail the Mac published for that service, is used once, and must be less than 5 minutes old. Nothing that moves money or sends an email (#251)
- The Live Activity starts 20 seconds after the Mac locks, not immediately, so a quick lock and unlock doesn't spend one of iOS's hourly starts. It starts right away when an agent is waiting for a permission or has a question (#251)
- After unlocking, the Live Activity waits 30 seconds before ending, in case the Mac locks again — useful on a laptop that goes to sleep the moment you put it down (#251)
- If the iPhone has no update token yet (iOS held back the start), and an approval or question is waiting, the Mac starts the activity again once for that specific request (#251)
- Cal.com upcoming bookings work again: the API v2 expects `afterStart` / `beforeEnd`, not `start` / `end`, so the bookings page was empty (#251)

## 0.1.8 — October 5, 2026

- Coucou on iPhone: turn on Settings → General → iPhone (off by default) and your agent sessions show up live in the Coucou iPhone app and its widgets, through your own private iCloud. Project names, commands and questions are encrypted with your iCloud keys; turning it off deletes them (#209, #211, #212, #213)
- Allow or deny a permission from the iPhone: a notification with the command, Deny right from it, Allow behind Face ID. Your Mac only applies a decision meant for the exact request it is waiting on, and the request expires after 2 minutes. The iPhone keeps a history of your decisions (#220)
- Lock your Mac while an agent works and Mochi moves to your iPhone's Lock Screen and Dynamic Island, then comes back to the notch when you unlock. Turn it on under Settings → General → iPhone. It goes through a small relay that only sees the agent's name and state (#221)
- Mochi, the pills and the diff engine now live in a shared package used by both apps; nothing changes in the notch (#210)
- The iPhone sees more of what your Mac sees: every service Mochi (GitHub, Stripe, Vercel, Resend, Cal.com, n8n, Notion) with its latest items, and the last turn of each session with its commands and diffs, all encrypted with your iCloud keys. No API key ever leaves the Mac (#224)
- Send the next instruction to Claude Code from the iPhone (GitHub build, off by default): your Mac picks it up within 15 seconds and continues the session in its own folder (#224)
- Answer Claude's questions from the iPhone: your Mac applies an answer only if it matches the question still waiting (#241)
- The Live Activity counts the time since Mochi left, and shows Allow and Deny while a command waits for you (#232, #241)
- A new coucou sound for Mochi's greeting (#241)

## 0.1.7 — October 4, 2026

- Keyboard shortcuts from anywhere: ⌃⌥Space opens the chat, ⌃⌥A jumps to a waiting permission or question, ⌃⌥T brings your terminal forward, ⌃⌥] and ⌃⌥[ switch pills, ⌃⌥M mutes Mochi, ⌃⌥D sends him to the desktop and back, ⌃⌥G opens the wardrobe, and ⌃⌥W attaches the front window to the chat (GitHub build) (#205)
- In the open island: ⌘← ⌘→ and ⌘1–9 switch pills, ⌘↑ ⌘↓ and ⌘O move through a card's list, ⌘E opens the diff, ⌘↩ sends, ⌘K starts a new chat, ⌘P pins the island (#205)
- Every global shortcut can be changed or turned off in Settings → Shortcuts, which also flags combinations another app already uses. They need no Accessibility permission (#205)
- ⌘⇧N now opens and closes the island (#205)

## 0.1.6 — October 4, 2026

- Mochi on the desktop: drag him out of the notch and drop him anywhere on your desktop. He hangs out there, follows your cursor with his eyes, wears his outfit and dances to your music (#198)
- When Claude needs you, he flies back to the notch with the permission or the question, then returns to his spot once you answer. He does a happy jump when a task finishes (#198)
- Click him to poke him, right-click for the wardrobe, drop him on a window to attach it to the chat (GitHub build), and drop him on the notch or double-click him to bring him home (#198)
- He falls asleep when nothing is going on, and remembers his spot between launches (#198)

## 0.1.5 — October 4, 2026

- Dress Mochi up: right-click him to open the wardrobe and pick a party hat, beanie, crown, witch hat, Santa hat, bunny ears, bow, sunglasses, round glasses, scarf or pumpkin, all drawn in code (#195)
- Auto mode dresses Mochi for the seasons on his own (#195)
- Outfits follow his head in 3D, glasses stay on his eyes, soft parts react when you tap or move him, and outfits come and go with a transition. Only the main Mochi wears them (#195)
- A new launch greeting: Mochi drops into the island, bounces, slides to the side and waves hello with a quick little hand, then comes back, with a new soft whisper of a sound (#196)
- Mochi's body is no longer clipped at two corners during the greeting (#196)

## 0.1.4 — October 3, 2026

- See what Claude is editing, live: each file edit shows up in the session ticker with its +N −M lines, and a click opens the diff right in the notch (#177)
- When Claude finishes, the session card shows its final message instead of the last step, without the shimmer (#177, #179)
- GitHub pill: your open pull requests with their CI status, the pull requests waiting for your review, and the CI of the default branch of your recent repos. Click a row for the list, then an item to open it on github.com (#181)
- GitHub alerts: a badge and a sound when the CI of one of your pull requests turns red or green, when a default branch breaks, or when someone requests your review. Fast CI runs are caught too, and the card refreshes when you open it (#181, #185)
- Your GitHub contribution grid: the last 7 days in the GitHub card header, click it for the past 23 weeks, and click a day for its count (#187)
- The GitHub token needs read access to pull requests and CI: a classic token with the repo scope, or a fine-grained token with read access to Pull requests, Commit statuses and Actions (#181)
- The finished view no longer overflows the card (#179)

## 0.1.3 — October 3, 2026

- Answer Claude's questions from the notch: when Claude Code asks a multiple-choice question, pick an option or type your own answer right in the island, and Reply in terminal hands it back. Update your hooks in Settings to turn it on (#165) — thanks @Vega8991 for the idea (#94)
- Claude plan usage (GitHub build): turn on Settings → Agents → Plan usage to see your 5-hour and weekly limits in a small pill in the notch header, and click it for the details and reset times. Pro and Max plans; your current status line keeps working (#159)
- Chat with local models through Ollama or LM Studio, no API key needed: connect them in Settings → Chat → Local models. Answers stream in, and thinking blocks stay hidden (#156)
- Markdown in chat answers: bold, lists, headings, quotes, and code blocks with a copy button. Links open only when they are web links (#156)
- Apple Music (GitHub build): see what is playing in the notch, play, pause and skip on hover, and Mochi dances along (#144, #153)
- Settings are now organized in a sidebar (#153)
- The chat greets you by your own first name (#154)

## 0.1.2 — October 2, 2026

- Codex support (GitHub build): sessions show up live on the Codex pill, and permission requests get Allow and Deny in the notch. Install from Settings → Codex Hooks, then trust the hooks once with /hooks in Codex (#130) — thanks @lacatu5
- Cursor: Claude Code started in Cursor's terminal shows up on the Cursor pill, and you can answer its permission requests from the notch (#120).
- Pick your main coding tool in Settings → Active pills: VS Code, Cursor, Codex or Antigravity (Codex and Antigravity: GitHub build). It stays on and no longer takes one of the 4 slots (#120).
- The permission card stays in the notch until you answer it: the mouse no longer folds it, and reopening the island shows the request again (#117).
- The permission card also shows when the island is already open, and the pill you were on comes back once you answer (#120).

## 0.1.1 — October 2, 2026

- Declare the tools you use in Settings: Gemini CLI, Antigravity, Anthropic, Google AI and OpenAI pills join the existing ones (Cursor and Codex pills are coming soon), and you pick the main pill.
- Chat now supports Google AI (Gemini) and OpenAI in addition to Anthropic; switch provider and model by clicking the model name in the chat view, on macOS.
- Linux version: the Tauri app now builds for Linux too (AppImage, .deb, .rpm), with the island as a layer-shell overlay on Wayland and Claude Code hooks over a private Unix socket (#21) — thanks @Davy133
- Compact island on screens without a notch (#22) — thanks @Kamasoutra
- Only web links (http/https) open from the notch; other kinds of links from Claude or integrations are ignored (#16) — thanks @Cris1670
- Hook socket limited to your own user account, with size and time limits; logs no longer keep commands, n8n data or full URLs, and stay under 1 MB (#16) — thanks @Cris1670 and @Vignesh-Thangamariappan
- The island always reopens after folding, and Settings opens below it, resizable — thanks @rouderz
- Choose the Claude model for the chat in Settings; the list comes from your Anthropic account, and Claude Sonnet 4.6 stays the default — thanks @rouderz
- Windows build artifacts are now downloadable from a manual CI run — thanks @MysJofR
- Any agent can talk to Mochi: tag a hook payload with `coucou_agent` (e.g. `nb-hook --agent my-agent`) and it gets its own pill in the island (#7, #9) — thanks @lacatu5
- Gemini CLI and Antigravity (agy) hook support on macOS: install from Settings and their sessions show up in the island — thanks @corefusiion

## 0.1.0 — September 27, 2026

- First release: Mochi lives in your notch, breathing, blinking, with eyes that follow your cursor
- Claude Code sessions: live steps, approve permissions, answer questions, jump to the terminal
- Chat with Claude from the notch
- Drop a file on the notch to ask a question about it or send it by email
- Drag Mochi onto any window to attach it as context
- Integrations: Stripe, n8n, GitHub, Vercel, Resend, Notion, Cal.com
- 28 handcrafted sounds
- Hides when idle, peeks out when you hover
