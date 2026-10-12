# NotchBuddy Feature Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 10 new features (media player, control center, Bluetooth, system stats, Pomodoro, stopwatch, weather, background effects, clipboard detection, battery alerts) to the Tauri Windows app, organized into tab groups with a dashboard.

**Architecture:** Hybrid Rust + PowerShell backend. Rust for SMTC media, system stats, weather, clipboard, battery. PowerShell for brightness, volume, night light, DND, memory boost, Bluetooth. Frontend is hand-rolled TypeScript (no framework) with Canvas 2D. New IslandView cases for each feature, tab group navigation, dashboard with widget grid.

**Tech Stack:** Tauri 2, Rust (`windows` crate), TypeScript, Canvas 2D, PowerShell workers, WebAudio API.

**Spec:** docs/superpowers/specs/2026-10-08-notch-buddy-features-design.md

## Global Constraints

- Windows-first: target Windows 10/11, Tauri 2
- No new npm runtime dependencies (only `@tauri-apps/api`)
- No new crates unless absolutely necessary
- PowerShell workers: stdin/stdout JSON protocol, watchdog timer, auto-restart
- All polling stops when island is hidden (0% CPU when hidden)
- Bot (Mochi) stays visible and reacts to all new states
- Existing features (chat, file drop, hooks, integrations) must not break
- Bundle identifier: `fr.louisraille.coucou` (never change)
- Pill IDs are stable contract values (never rename)

---

### Task 1: Foundation — New IslandView Cases & Tab Groups

**Files:**
- Modify: `windows/src/core/layout.ts` — add new view layouts
- Modify: `windows/src/core/state.ts` — add new state fields
- Modify: `windows/src/views/views.ts` — add new view cases + tab group navigation
- Modify: `windows/src/island/fsm.ts` — no changes needed (FSM stays same)
- Modify: `windows/src/style.css` — add tab group styles

**Interfaces:**
- Consumes: existing `IslandView` enum, `VIEW_LAYOUTS`, `AppState`
- Produces: `IslandView` cases: `dashboard`, `media`, `controlCenter`, `bluetooth`, `stats`, `pomodoro`, `stopwatch`, `weather`; `ViewGroup` type: `'agents' | 'media' | 'system' | 'tools'`; `AppState` fields: `media`, `stats`, `volume`, `brightness`, `bluetooth`, `battery`, `clipboard`, `timer`, `weather`

- [ ] **Step 1: Add new IslandView cases to layout.ts**

In `windows/src/core/layout.ts`, add to `IslandView` type:
```typescript
export type IslandView =
  | 'overview' | 'chat' | 'approval' | 'question' | 'error' | 'finished'
  | 'upload' | 'uploading' | 'choose' | 'mail' | 'searching' | 'result'
  | 'note' | 'settings' | 'wardrobe' | 'recap'
  | 'dashboard' | 'media' | 'controlCenter' | 'bluetooth' | 'stats'
  | 'pomodoro' | 'stopwatch' | 'weather';
```

Add `ViewGroup` type:
```typescript
export type ViewGroup = 'agents' | 'media' | 'system' | 'tools';
```

Add view layouts for each new view in `VIEW_LAYOUTS`:
```typescript
dashboard:     { height: 300, botX: 60,  botY: 80,  botDiameter: 48, layout: 'full' },
media:         { height: 200, botX: 60,  botY: 60,  botDiameter: 40, layout: 'full' },
controlCenter: { height: 220, botX: 60,  botY: 60,  botDiameter: 40, layout: 'full' },
bluetooth:     { height: 240, botX: 60,  botY: 60,  botDiameter: 40, layout: 'full' },
stats:         { height: 200, botX: 60,  botY: 60,  botDiameter: 40, layout: 'full' },
pomodoro:     { height: 260, botX: 60,  botY: 60,  botDiameter: 40, layout: 'full' },
stopwatch:     { height: 160, botX: 60,  botY: 60,  botDiameter: 40, layout: 'full' },
weather:       { height: 180, botX: 60,  botY: 60,  botDiameter: 40, layout: 'full' },
```

- [ ] **Step 2: Add new state fields to state.ts**

In `windows/src/core/state.ts`, add to `State` class:
```typescript
media: { track: string; artist: string; albumArt: string; playing: boolean; position: number; duration: number; sourceApp: string } | null = null;
stats: { cpu: number; ram: number; netRx: number; netTx: number } = { cpu: 0, ram: 0, netRx: 0, netTx: 0 };
volume: { level: number; muted: boolean } = { level: 0, muted: false };
brightness: { level: number } = { level: 0 };
bluetooth: { devices: Array<{ name: string; type: string; battery: number; connected: boolean }> } = { devices: [] };
battery: { level: number; charging: boolean; timeRemaining: number } = { level: 100, charging: false, timeRemaining: 0 };
clipboard: { lastUrl: string } = { lastUrl: '' };
timer: { mode: 'focus' | 'break' | 'stopwatch'; running: boolean; remaining: number; tasks: Array<{ text: string; done: boolean }> } = { mode: 'focus', running: false, remaining: 25 * 60, tasks: [] };
weather: { temp: number; condition: string; humidity: number; wind: number } = { temp: 0, condition: '', humidity: 0, wind: 0 };
viewGroup: ViewGroup = 'agents';
```

- [ ] **Step 3: Add tab group navigation to views.ts**

In `windows/src/views/views.ts`, add group tab rendering in the header:
```typescript
const GROUPS: { id: ViewGroup; label: string; views: IslandView[] }[] = [
  { id: 'agents', label: 'Agents', views: ['overview', 'chat', 'approval', 'question', 'error', 'finished', 'upload', 'uploading', 'choose', 'mail', 'searching', 'result', 'note', 'settings', 'wardrobe', 'recap'] },
  { id: 'media', label: 'Media', views: ['media'] },
  { id: 'system', label: 'System', views: ['controlCenter', 'bluetooth', 'stats'] },
  { id: 'tools', label: 'Tools', views: ['pomodoro', 'stopwatch', 'weather'] },
];
```

Add `setViewGroup(group: ViewGroup)` to State. Add `getViewsForGroup(group)` helper.

- [ ] **Step 4: Add stub views for all 9 new views**

Create stub render functions in `views.ts`:
```typescript
function renderDashboardView(): HTMLElement { return h('div', { class: 'view-dashboard' }, 'Dashboard'); }
function renderMediaView(): HTMLElement { return h('div', { class: 'view-media' }, 'Media'); }
function renderControlCenterView(): HTMLElement { return h('div', { class: 'view-control-center' }, 'Control Center'); }
function renderBluetoothView(): HTMLElement { return h('div', { class: 'view-bluetooth' }, 'Bluetooth'); }
function renderStatsView(): HTMLElement { return h('div', { class: 'view-stats' }, 'Stats'); }
function renderPomodoroView(): HTMLElement { return h('div', { class: 'view-pomodoro' }, 'Pomodoro'); }
function renderStopwatchView(): HTMLElement { return h('div', { class: 'view-stopwatch' }, 'Stopwatch'); }
function renderWeatherView(): HTMLElement { return h('div', { class: 'view-weather' }, 'Weather'); }
```

Wire them into the view dispatcher switch.

- [ ] **Step 5: Add tab group styles to style.css**

```css
.tab-groups { display: flex; gap: 4px; }
.tab-group { padding: 4px 10px; border-radius: 8px; font-size: 11px; color: #8E939C; cursor: pointer; }
.tab-group.active { background: #1D1F23; color: #F5F6F8; }
.sub-view-pills { display: flex; gap: 4px; margin-top: 4px; }
.sub-view-pill { padding: 2px 8px; border-radius: 6px; font-size: 10px; color: #6B7079; cursor: pointer; }
.sub-view-pill.active { background: #1D1F23; color: #F5F6F8; }
```

- [ ] **Step 6: Build and verify**

Run: `cd windows && npm run build`
Expected: Compiles without errors. Island shows new tab groups in header. Clicking groups switches views (stubs).

- [ ] **Step 7: Commit**

```bash
git add windows/src/core/layout.ts windows/src/core/state.ts windows/src/views/views.ts windows/src/style.css
git commit -m "feat: add new island view cases, tab groups, and stub views"
```

---

### Task 2: Dashboard View — Widget Grid

**Files:**
- Modify: `windows/src/views/views.ts` — replace dashboard stub with full widget grid
- Modify: `windows/src/style.css` — add dashboard widget styles

**Interfaces:**
- Consumes: `AppState.media`, `AppState.stats`, `AppState.timer`, `AppState.weather`, `AppState.battery`, `AppState.bluetooth`
- Produces: `DashboardView` with widget tap → navigate to full view

- [ ] **Step 1: Create dashboard widget grid**

Replace `renderDashboardView` in `views.ts`:
```typescript
function renderDashboardView(): HTMLElement {
  const mediaWidget = h('div', { class: 'widget', onclick: () => State.setView('media') },
    h('div', { class: 'widget-title' }, 'Media'),
    State.media ? h('div', { class: 'widget-media' },
      h('img', { src: State.media.albumArt, class: 'widget-album-art' }),
      h('div', {}, State.media.track, h('br'), State.media.artist)
    ) : h('div', { class: 'widget-empty' }, 'No media playing')
  );
  // ... similar for stats, timer, weather, battery, bluetooth widgets
  return h('div', { class: 'dashboard-grid' }, mediaWidget, statsWidget, timerWidget, weatherWidget, batteryWidget, bluetoothWidget);
}
```

- [ ] **Step 2: Add dashboard styles**

```css
.dashboard-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 12px; }
.widget { background: #1D1F23; border-radius: 12px; padding: 10px; cursor: pointer; transition: transform 0.15s; }
.widget:hover { transform: scale(1.02); }
.widget-title { font-size: 10px; color: #8E939C; margin-bottom: 6px; text-transform: uppercase; }
```

- [ ] **Step 3: Build and verify**

Run: `cd windows && npm run build`
Expected: Dashboard shows widget grid. Widgets display current state (empty/default values). Tapping navigates to full view.

- [ ] **Step 4: Commit**

```bash
git add windows/src/views/views.ts windows/src/style.css
git commit -m "feat: dashboard view with widget grid"
```

---

### Task 3: Media Player — SMTC Integration (Rust)

**Files:**
- Create: `windows/src-tauri/src/media.rs`
- Modify: `windows/src-tauri/src/lib.rs` — add media module + Tauri commands
- Modify: `windows/src-tauri/Cargo.toml` — add `windows` crate features for SMTC

**Interfaces:**
- Consumes: Windows SMTC API
- Produces: Tauri commands: `media_play_pause()`, `media_next()`, `media_prev()`, `media_seek(position: f64)`; Tauri events: `media-state`, `media-changed`

- [ ] **Step 1: Add SMTC dependencies to Cargo.toml**

In `windows/src-tauri/Cargo.toml`, ensure `windows` crate has needed features:
```toml
windows = { version = "0.61", features = ["Win32_Media_Control", "Win32_System_Com", "Win32_Foundation"] }
```

- [ ] **Step 2: Create media.rs with SMTC integration**

```rust
use tauri::{AppHandle, Emitter};
use windows::Win32::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSession,
};
use windows::Win32::System::Com::*;

#[derive(serde::Serialize, Clone)]
struct MediaState {
    track: String,
    artist: String,
    album_art: String,
    playing: bool,
    position: f64,
    duration: f64,
    source_app: String,
}

async fn get_session_manager() -> Result<GlobalSystemMediaTransportControlsSessionManager> {
    GlobalSystemMediaTransportControlsSessionManager::RequestAsync()?.await
}

fn session_state(session: &GlobalSystemMediaTransportControlsSession) -> MediaState {
    // Extract track info from session
    // ...
}

#[tauri::command]
async fn media_play_pause(app: AppHandle) -> Result<()> {
    let manager = get_session_manager().await?;
    let session = manager.GetCurrentSession()?;
    session.TryTogglePlayPauseAsync()?;
    Ok(())
}

#[tauri::command]
async fn media_next(app: AppHandle) -> Result<()> { /* ... */ }

#[tauri::command]
async fn media_prev(app: AppHandle) -> Result<()> { /* ... */ }

#[tauri::command]
async fn media_seek(app: AppHandle, position: f64) -> Result<()> { /* ... */ }

pub fn setup_media(app: &AppHandle) {
    // Spawn background task that polls SMTC for changes
    // Emit `media-state` events on change
}
```

- [ ] **Step 3: Wire media module into lib.rs**

In `windows/src-tauri/src/lib.rs`:
```rust
mod media;
// In setup():
media::setup_media(&app);
// In invoke_handler:
media_play_pause, media_next, media_prev, media_seek,
```

- [ ] **Step 4: Build and verify**

Run: `cd windows/src-tauri && cargo build`
Expected: Compiles. SMTC session manager initializes.

- [ ] **Step 5: Commit**

```bash
git add windows/src-tauri/src/media.rs windows/src-tauri/src/lib.rs windows/src-tauri/Cargo.toml
git commit -m "feat: SMTC media session integration in Rust"
```

---

### Task 4: Media Player — Frontend View

**Files:**
- Modify: `windows/src/views/views.ts` — replace media stub with full player
- Modify: `windows/src/style.css` — add media player styles
- Modify: `windows/src/core/bridge.ts` — add media event listeners

**Interfaces:**
- Consumes: `AppState.media`, Tauri commands `media_play_pause`, `media_next`, `media_prev`, `media_seek`
- Produces: `MediaView` with album art, track info, controls, progress bar

- [ ] **Step 1: Add media event listeners to bridge.ts**

```typescript
listen('media-state', (state) => { State.media = state; State.notify(); });
listen('media-changed', () => { /* fetch new state */ });
```

- [ ] **Step 2: Create full media player view**

Replace `renderMediaView` in `views.ts`:
```typescript
function renderMediaView(): HTMLElement {
  if (!State.media) return h('div', { class: 'view-media-empty' }, 'No media playing');
  const m = State.media;
  return h('div', { class: 'view-media' },
    h('img', { src: m.albumArt, class: 'media-album-art' }),
    h('div', { class: 'media-info' },
      h('div', { class: 'media-track' }, m.track),
      h('div', { class: 'media-artist' }, m.artist),
      h('div', { class: 'media-progress' },
        h('div', { class: 'media-progress-fill', style: `width: ${(m.position / m.duration) * 100}%` })
      ),
      h('div', { class: 'media-controls' },
        h('button', { onclick: () => invoke('media_prev') }, '⏮'),
        h('button', { onclick: () => invoke('media_play_pause') }, m.playing ? '⏸' : '▶'),
        h('button', { onclick: () => invoke('media_next') }, '⏭')
      )
    )
  );
}
```

- [ ] **Step 3: Add media player styles**

```css
.view-media { display: flex; gap: 12px; padding: 16px; align-items: center; }
.media-album-art { width: 120px; height: 120px; border-radius: 12px; }
.media-track { font-size: 14px; font-weight: 600; color: #F5F6F8; }
.media-artist { font-size: 12px; color: #8E939C; }
.media-progress { height: 4px; background: #1D1F23; border-radius: 2px; margin: 8px 0; }
.media-progress-fill { height: 100%; background: #3B9EFF; border-radius: 2px; }
.media-controls { display: flex; gap: 8px; }
.media-controls button { background: #1D1F23; border: none; border-radius: 8px; padding: 6px 12px; color: #F5F6F8; cursor: pointer; }
```

- [ ] **Step 4: Build and verify**

Run: `cd windows && npm run build`
Expected: Media view shows album art, track info, controls. Controls invoke Tauri commands.

- [ ] **Step 5: Commit**

```bash
git add windows/src/views/views.ts windows/src/style.css windows/src/core/bridge.ts
git commit -m "feat: media player frontend view"
```

---

### Task 5: System Stats — CPU/RAM/Network (Rust)

**Files:**
- Create: `windows/src-tauri/src/system_stats.rs`
- Modify: `windows/src-tauri/src/lib.rs` — add system_stats module

**Interfaces:**
- Consumes: Windows performance counters
- Produces: Tauri event `system-stats` with `{ cpu, ram, netRx, netTx }`

- [ ] **Step 1: Create system_stats.rs**

```rust
use tauri::{AppHandle, Emitter};
use std::time::Duration;

#[derive(serde::Serialize, Clone)]
struct SystemStats {
    cpu: f32,
    ram: f32,
    net_rx: f64,
    net_tx: f64,
}

pub fn setup_system_stats(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            // Poll CPU, RAM, network every 2 seconds
            // Emit `system-stats` event
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}
```

- [ ] **Step 2: Wire into lib.rs**

```rust
mod system_stats;
// In setup():
system_stats::setup_system_stats(&app);
```

- [ ] **Step 3: Build and verify**

Run: `cd windows/src-tauri && cargo build`
Expected: Compiles. Stats polling thread starts.

- [ ] **Step 4: Commit**

```bash
git add windows/src-tauri/src/system_stats.rs windows/src-tauri/src/lib.rs
git commit -m "feat: system stats polling (CPU/RAM/network)"
```

---

### Task 6: System Stats — Frontend View

**Files:**
- Modify: `windows/src/views/views.ts` — replace stats stub
- Modify: `windows/src/style.css` — add stats styles
- Modify: `windows/src/core/bridge.ts` — add stats event listener

**Interfaces:**
- Consumes: `AppState.stats`
- Produces: `StatsView` with animated bars

- [ ] **Step 1: Add stats event listener**

```typescript
listen('system-stats', (stats) => { State.stats = stats; State.notify(); });
```

- [ ] **Step 2: Create stats view**

```typescript
function renderStatsView(): HTMLElement {
  const s = State.stats;
  return h('div', { class: 'view-stats' },
    h('div', { class: 'stat-row' },
      h('span', { class: 'stat-label' }, 'CPU'),
      h('div', { class: 'stat-bar' }, h('div', { class: 'stat-fill', style: `width: ${s.cpu}%` })),
      h('span', { class: 'stat-value' }, `${s.cpu.toFixed(0)}%`)
    ),
    // ... similar for RAM, network
  );
}
```

- [ ] **Step 3: Add styles**

```css
.view-stats { padding: 16px; }
.stat-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.stat-label { font-size: 11px; color: #8E939C; width: 30px; }
.stat-bar { flex: 1; height: 6px; background: #1D1F23; border-radius: 3px; }
.stat-fill { height: 100%; background: #3B9EFF; border-radius: 3px; transition: width 0.3s; }
.stat-value { font-size: 11px; color: #F5F6F8; width: 35px; text-align: right; }
```

- [ ] **Step 4: Build and verify**

Run: `cd windows && npm run build`
Expected: Stats view shows animated bars with current values.

- [ ] **Step 5: Commit**

```bash
git add windows/src/views/views.ts windows/src/style.css windows/src/core/bridge.ts
git commit -m "feat: system stats frontend view"
```

---

### Task 7: Control Center — PowerShell Worker

**Files:**
- Create: `windows/src-tauri/src/system_control.ps1`
- Modify: `windows/src-tauri/src/lib.rs` — spawn PS worker, handle commands

**Interfaces:**
- Consumes: Tauri commands `get_volume`, `set_volume(level)`, `toggle_mute`, `get_brightness`, `set_brightness(level)`, `toggle_night_light`, `toggle_dnd`, `memory_boost`
- Produces: Tauri events `volume-changed`, `brightness-changed`

- [ ] **Step 1: Create system_control.ps1**

Port from reference repo `system_control.ps1`:
- Volume get/set/mute via `IAudioEndpointVolume` COM
- Brightness get/set via `WmiMonitorBrightness`
- Night Light toggle via registry
- DND toggle via WNF
- Memory boost via `EmptyWorkingSet`
- stdin/stdout JSON protocol

- [ ] **Step 2: Wire into lib.rs**

```rust
#[tauri::command]
async fn get_volume() -> Result<f32> { /* spawn PS, parse output */ }

#[tauri::command]
async fn set_volume(level: f32) -> Result<()> { /* ... */ }

// ... etc for all commands
```

- [ ] **Step 3: Build and verify**

Run: `cd windows/src-tauri && cargo build`
Expected: Compiles. PS worker spawns on first command.

- [ ] **Step 4: Commit**

```bash
git add windows/src-tauri/src/system_control.ps1 windows/src-tauri/src/lib.rs
git commit -m "feat: control center PowerShell worker"
```

---

### Task 8: Control Center — Frontend View

**Files:**
- Modify: `windows/src/views/views.ts` — replace control center stub
- Modify: `windows/src/style.css` — add slider styles

**Interfaces:**
- Consumes: `AppState.volume`, `AppState.brightness`, Tauri commands
- Produces: `ControlCenterView` with sliders + toggles

- [ ] **Step 1: Create control center view**

```typescript
function renderControlCenterView(): HTMLElement {
  return h('div', { class: 'view-control-center' },
    h('div', { class: 'cc-row' },
      h('span', {}, 'Volume'),
      h('div', { class: 'cc-slider', onpointerdown: startDrag },
        h('div', { class: 'cc-slider-fill', style: `width: ${State.volume.level * 100}%` })
      ),
      h('button', { onclick: () => invoke('toggle_mute') }, State.volume.muted ? '🔇' : '🔊')
    ),
    // ... brightness, night light, DND
  );
}
```

- [ ] **Step 2: Add styles**

```css
.view-control-center { padding: 16px; }
.cc-row { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.cc-slider { flex: 1; height: 6px; background: #1D1F23; border-radius: 3px; cursor: pointer; }
.cc-slider-fill { height: 100%; background: #3B9EFF; border-radius: 3px; }
```

- [ ] **Step 3: Build and verify**

Run: `cd windows && npm run build`
Expected: Control center shows sliders and toggles. Dragging slider invokes Tauri commands.

- [ ] **Step 4: Commit**

```bash
git add windows/src/views/views.ts windows/src/style.css
git commit -m "feat: control center frontend view"
```

---

### Task 9: Bluetooth — PowerShell Worker

**Files:**
- Create: `windows/src-tauri/src/bluetooth.ps1`
- Modify: `windows/src-tauri/src/lib.rs` — add BT commands

**Interfaces:**
- Consumes: Tauri commands `get_bt_devices`, `bt_connect(name)`, `bt_disconnect(name)`
- Produces: Tauri events `bt-devices`, `bt-device-event`

- [ ] **Step 1: Create bluetooth.ps1**

Port from reference repo:
- Enumerate paired audio devices via WinRT
- Connect/disconnect via `IKsControl`
- Battery levels via `cfgmgr32.dll`

- [ ] **Step 2: Wire into lib.rs**

```rust
#[tauri::command]
async fn get_bt_devices() -> Result<Vec<BtDevice>> { /* ... */ }

#[tauri::command]
async fn bt_connect(name: String) -> Result<()> { /* ... */ }
```

- [ ] **Step 3: Build and verify**

Run: `cd windows/src-tauri && cargo build`
Expected: Compiles.

- [ ] **Step 4: Commit**

```bash
git add windows/src-tauri/src/bluetooth.ps1 windows/src-tauri/src/lib.rs
git commit -m "feat: bluetooth PowerShell worker"
```

---

### Task 10: Bluetooth — Frontend View

**Files:**
- Modify: `windows/src/views/views.ts` — replace bluetooth stub
- Modify: `windows/src/style.css` — add BT styles

**Interfaces:**
- Consumes: `AppState.bluetooth`, Tauri commands
- Produces: `BluetoothView` with device list

- [ ] **Step 1: Create bluetooth view**

```typescript
function renderBluetoothView(): HTMLElement {
  return h('div', { class: 'view-bluetooth' },
    State.bluetooth.devices.map(d =>
      h('div', { class: 'bt-device' },
        h('span', { class: 'bt-name' }, d.name),
        h('span', { class: 'bt-battery' }, `${d.battery}%`),
        h('button', { onclick: () => invoke(d.connected ? 'bt_disconnect' : 'bt_connect', d.name) }, d.connected ? 'Disconnect' : 'Connect')
      )
    )
  );
}
```

- [ ] **Step 2: Add styles**

```css
.view-bluetooth { padding: 16px; }
.bt-device { display: flex; align-items: center; gap: 8px; padding: 8px; background: #1D1F23; border-radius: 8px; margin-bottom: 6px; }
```

- [ ] **Step 3: Build and verify**

Run: `cd windows && npm run build`
Expected: Bluetooth view shows device list.

- [ ] **Step 4: Commit**

```bash
git add windows/src/views/views.ts windows/src/style.css
git commit -m "feat: bluetooth frontend view"
```

---

### Task 11: Pomodoro Timer

**Files:**
- Modify: `windows/src/views/views.ts` — replace pomodoro stub
- Modify: `windows/src/style.css` — add timer styles
- Modify: `windows/src/core/state.ts` — add timer logic

**Interfaces:**
- Consumes: `AppState.timer`
- Produces: `PomodoroView` with timer + task list

- [ ] **Step 1: Add timer logic to state.ts**

```typescript
function tickTimer() {
  if (State.timer.running && State.timer.remaining > 0) {
    State.timer.remaining--;
    if (State.timer.remaining === 0) {
      State.timer.running = false;
      // Play chime, show notification
    }
    State.notify();
  }
}
setInterval(tickTimer, 1000);
```

- [ ] **Step 2: Create pomodoro view**

```typescript
function renderPomodoroView(): HTMLElement {
  const t = State.timer;
  const mins = Math.floor(t.remaining / 60);
  const secs = t.remaining % 60;
  return h('div', { class: 'view-pomodoro' },
    h('div', { class: 'timer-display' }, `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`),
    h('div', { class: 'timer-controls' },
      h('button', { onclick: () => { t.running = !t.running; State.notify(); } }, t.running ? 'Pause' : 'Start'),
      h('button', { onclick: () => { t.running = false; t.remaining = 25 * 60; State.notify(); } }, 'Reset')
    ),
    h('div', { class: 'task-list' },
      t.tasks.map((task, i) => h('div', { class: 'task' },
        h('input', { type: 'checkbox', checked: task.done, onchange: () => { task.done = !task.done; State.notify(); } }),
        h('span', {}, task.text)
      ))
    )
  );
}
```

- [ ] **Step 3: Add styles**

```css
.view-pomodoro { padding: 16px; text-align: center; }
.timer-display { font-size: 48px; font-weight: 700; color: #F5F6F8; font-variant-numeric: tabular-nums; }
```

- [ ] **Step 4: Build and verify**

Run: `cd windows && npm run build`
Expected: Timer counts down. Start/Pause/Reset work.

- [ ] **Step 5: Commit**

```bash
git add windows/src/views/views.ts windows/src/style.css windows/src/core/state.ts
git commit -m "feat: pomodoro timer"
```

---

### Task 12: Stopwatch

**Files:**
- Modify: `windows/src/views/views.ts` — replace stopwatch stub
- Modify: `windows/src/style.css` — add stopwatch styles

**Interfaces:**
- Consumes: `AppState.timer` (mode: 'stopwatch')
- Produces: `StopwatchView`

- [ ] **Step 1: Create stopwatch view**

```typescript
function renderStopwatchView(): HTMLElement {
  const t = State.timer;
  const mins = Math.floor(t.remaining / 60);
  const secs = t.remaining % 60;
  return h('div', { class: 'view-stopwatch' },
    h('div', { class: 'timer-display' }, `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`),
    h('div', { class: 'timer-controls' },
      h('button', {}, t.running ? 'Pause' : 'Start'),
      h('button', {}, 'Reset')
    )
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `cd windows && npm run build`
Expected: Stopwatch counts up.

- [ ] **Step 3: Commit**

```bash
git add windows/src/views/views.ts windows/src/style.css
git commit -m "feat: stopwatch"
```

---

### Task 13: Weather

**Files:**
- Create: `windows/src-tauri/src/weather.rs`
- Modify: `windows/src-tauri/src/lib.rs` — add weather module
- Modify: `windows/src/views/views.ts` — replace weather stub
- Modify: `windows/src/style.css` — add weather styles

**Interfaces:**
- Consumes: wttr.in API
- Produces: Tauri event `weather-update`, `WeatherView`

- [ ] **Step 1: Create weather.rs**

```rust
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone)]
struct WeatherData {
    temp: f32,
    condition: String,
    humidity: u32,
    wind: f32,
}

pub fn setup_weather(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            // Fetch from wttr.in every 30 min
            // Emit `weather-update`
            std::thread::sleep(Duration::from_secs(1800));
        }
    });
}
```

- [ ] **Step 2: Create weather view**

```typescript
function renderWeatherView(): HTMLElement {
  const w = State.weather;
  return h('div', { class: 'view-weather' },
    h('div', { class: 'weather-temp' }, `${w.temp}°`),
    h('div', { class: 'weather-condition' }, w.condition),
    h('div', { class: 'weather-details' }, `Humidity: ${w.humidity}%`, h('br'), `Wind: ${w.wind} km/h`)
  );
}
```

- [ ] **Step 3: Build and verify**

Run: `cd windows && npm run build`
Expected: Weather view shows current conditions.

- [ ] **Step 4: Commit**

```bash
git add windows/src-tauri/src/weather.rs windows/src-tauri/src/lib.rs windows/src/views/views.ts windows/src/style.css
git commit -m "feat: weather widget"
```

---

### Task 14: Clipboard URL Detection

**Files:**
- Create: `windows/src-tauri/src/clipboard.rs`
- Modify: `windows/src-tauri/src/lib.rs` — add clipboard module
- Modify: `windows/src/views/views.ts` — add clipboard banner
- Modify: `windows/src/style.css` — add banner styles

**Interfaces:**
- Consumes: `GetClipboardSequenceNumber` Win32 API
- Produces: Tauri event `clipboard-url`

- [ ] **Step 1: Create clipboard.rs**

```rust
use tauri::{AppHandle, Emitter};

pub fn setup_clipboard(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut last_seq = 0;
        loop {
            // Poll GetClipboardSequenceNumber every 1s
            // If changed, read clipboard, check if URL
            // Emit `clipboard-url` if URL detected
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}
```

- [ ] **Step 2: Add clipboard banner to views.ts**

```typescript
function renderClipboardBanner(): HTMLElement {
  if (!State.clipboard.lastUrl) return h('div');
  return h('div', { class: 'clipboard-banner' },
    h('span', {}, 'URL copied'),
    h('a', { href: State.clipboard.lastUrl, target: '_blank' }, 'Open')
  );
}
```

- [ ] **Step 3: Build and verify**

Run: `cd windows && npm run build`
Expected: Copying a URL shows banner in island.

- [ ] **Step 4: Commit**

```bash
git add windows/src-tauri/src/clipboard.rs windows/src-tauri/src/lib.rs windows/src/views/views.ts windows/src/style.css
git commit -m "feat: clipboard URL detection"
```

---

### Task 15: Battery Alerts

**Files:**
- Create: `windows/src-tauri/src/battery.rs`
- Modify: `windows/src-tauri/src/lib.rs` — add battery module
- Modify: `windows/src/views/views.ts` — add battery alert

**Interfaces:**
- Consumes: Windows battery API
- Produces: Tauri event `battery-status`

- [ ] **Step 1: Create battery.rs**

```rust
use tauri::{AppHandle, Emitter};

#[derive(serde::Serialize, Clone)]
struct BatteryStatus {
    level: u32,
    charging: bool,
    time_remaining: u32,
}

pub fn setup_battery(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            // Poll battery status every 30s
            // Emit `battery-status`
            std::thread::sleep(Duration::from_secs(30));
        }
    });
}
```

- [ ] **Step 2: Add battery alert to views.ts**

```typescript
function renderBatteryAlert(): HTMLElement {
  if (State.battery.level > 20 || State.battery.charging) return h('div');
  return h('div', { class: 'battery-alert' }, `Battery low: ${State.battery.level}%`);
}
```

- [ ] **Step 3: Build and verify**

Run: `cd windows && npm run build`
Expected: Low battery shows alert.

- [ ] **Step 4: Commit**

```bash
git add windows/src-tauri/src/battery.rs windows/src-tauri/src/lib.rs windows/src/views/views.ts
git commit -m "feat: battery alerts"
```

---

### Task 16: Background Effects

**Files:**
- Create: `windows/src/views/backgroundEffects.ts`
- Modify: `windows/src/island/island.ts` — integrate background canvas
- Modify: `windows/src/style.css` — add background canvas styles

**Interfaces:**
- Consumes: `AppState.settings.backgroundEffect`, `AppState.media`
- Produces: Canvas-based background animations

- [ ] **Step 1: Create backgroundEffects.ts**

```typescript
export type BackgroundEffect = 'off' | 'visualizer' | 'waves' | 'synthwave' | 'fireflies' | 'holographic' | 'topographic' | 'albumGlow' | 'ambient' | 'rgb';

export function drawBackground(ctx: CanvasRenderingContext2D, effect: BackgroundEffect, width: number, height: number, colors: string[]) {
  switch (effect) {
    case 'visualizer': /* ... */ break;
    case 'waves': /* ... */ break;
    // ... etc
  }
}
```

- [ ] **Step 2: Integrate into island.ts**

Add a background canvas behind the content. Call `drawBackground` in the RAF loop.

- [ ] **Step 3: Build and verify**

Run: `cd windows && npm run build`
Expected: Background effects render behind content.

- [ ] **Step 4: Commit**

```bash
git add windows/src/views/backgroundEffects.ts windows/src/island/island.ts windows/src/style.css
git commit -m "feat: background effects (9 Canvas animations)"
```

---

### Task 17: Settings — New Options

**Files:**
- Modify: `windows/src/settings/main.ts` — add new settings sections
- Modify: `windows/src/settings/settings.css` — add styles

**Interfaces:**
- Consumes: `AppState.settings`
- Produces: Settings UI for background effect, accent color, widget toggles

- [ ] **Step 1: Add background effect picker**

```typescript
const effects: BackgroundEffect[] = ['off', 'visualizer', 'waves', 'synthwave', 'fireflies', 'holographic', 'topographic', 'albumGlow', 'ambient', 'rgb'];
// Render picker with preview
```

- [ ] **Step 2: Add accent color picker**

```typescript
const colors = ['#3B9EFF', '#A78BFA', '#6366F1', '#F5A524', '#F4505E', '#34D399', '#FACC15', '#EC4899', '#F5F6F8'];
// Render color swatches
```

- [ ] **Step 3: Build and verify**

Run: `cd windows && npm run build`
Expected: Settings window shows new options.

- [ ] **Step 4: Commit**

```bash
git add windows/src/settings/main.ts windows/src/settings/settings.css
git commit -m "feat: settings for background effects and accent colors"
```

---

### Task 18: Compact Mode Mini Status

**Files:**
- Modify: `windows/src/views/views.ts` — add compact status strip
- Modify: `windows/src/style.css` — add compact styles

**Interfaces:**
- Consumes: `AppState.media`, `AppState.timer`, `AppState.battery`
- Produces: Compact mode mini status

- [ ] **Step 1: Add compact status rendering**

```typescript
function renderCompactStatus(): HTMLElement {
  const parts = [];
  if (State.media?.playing) parts.push(h('span', { class: 'compact-media' }, `♪ ${State.media.track}`));
  if (State.timer.running) parts.push(h('span', { class: 'compact-timer' }, `${Math.floor(State.timer.remaining / 60)}:${(State.timer.remaining % 60).toString().padStart(2, '0')}`));
  parts.push(h('span', { class: 'compact-battery' }, `${State.battery.level}%`));
  return h('div', { class: 'compact-status' }, ...parts);
}
```

- [ ] **Step 2: Build and verify**

Run: `cd windows && npm run build`
Expected: Compact mode shows mini status.

- [ ] **Step 3: Commit**

```bash
git add windows/src/views/views.ts windows/src/style.css
git commit -m "feat: compact mode mini status"
```

---

### Task 19: Bot Reactions

**Files:**
- Modify: `windows/src/core/state.ts` — add bot state overrides for new features
- Modify: `windows/src/mochi/engine.ts` — add new reaction triggers

**Interfaces:**
- Consumes: `AppState.media`, `AppState.timer`, `AppState.battery`, `AppState.bluetooth`
- Produces: Bot state overrides

- [ ] **Step 1: Add bot reaction logic**

```typescript
function updateBotReaction() {
  if (State.media?.playing) State.stateOverride = 'working'; // dance
  else if (State.timer.running && State.timer.mode === 'focus') State.stateOverride = 'thinking';
  else if (State.battery.level <= 20) State.stateOverride = 'sleeping';
  else State.stateOverride = null;
}
```

- [ ] **Step 2: Build and verify**

Run: `cd windows && npm run build`
Expected: Bot reacts to media, timer, battery.

- [ ] **Step 3: Commit**

```bash
git add windows/src/core/state.ts windows/src/mochi/engine.ts
git commit -m "feat: bot reactions for new features"
```

---

### Task 20: Integration Testing & Polish

**Files:**
- Modify: any files that need fixes

**Interfaces:**
- Consumes: all previous tasks
- Produces: Working, polished feature set

- [ ] **Step 1: End-to-end test**

Run: `cd windows && npm run tauri dev`
Expected: All features work. No crashes. Bot reacts. Dashboard shows widgets. Tab groups navigate.

- [ ] **Step 2: Performance check**

Verify 0% CPU when hidden. All polling stops.

- [ ] **Step 3: Fix any issues found**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix: integration testing and polish"
```
