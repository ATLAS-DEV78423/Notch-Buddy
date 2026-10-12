# Notch-Buddy v0.4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all Pip/content UI collisions, make every reaction animation visible via a priority queue, add a folder-holding prop for clipboard files, and add OpenAI-compatible provider support (OpenAI/NVIDIA/OpenRouter/OpenCode) to Pip's chat alongside Claude.

**Architecture:** Vanilla TS + Canvas frontend (`windows/src`), Tauri 2 Rust backend (`windows/src-tauri`). Three independent workstreams run in parallel (A: CSS/layout fixes; B: pure queue module + reactions.ts integration; C: Rust chat client + settings UI), then D (folder prop) lands after B since both touch `reactions.ts`.

**Tech Stack:** TypeScript 5.6 + Vite 6, Tauri 2 / Rust, no test framework (repo has none) — checks are `npm run build`, `cargo check`, one assert-based script for the queue, and the `?reactions=1` dev harness.

**Spec:** `docs/superpowers/specs/2026-10-12-notch-buddy-v0.4-design.md` — the plan argues from the spec; executors read both.

## Global Constraints

- Only `windows/` tree; never touch `NotchBuddy/` (Swift) or `docs/` HTML.
- No new npm or cargo dependencies.
- Secrets only via `secrets.rs` keychain; never on disk, never to the frontend.
- Pill IDs, existing view styling, and existing CSS selectors stay as-is (fixes add insets/rows, no restyles).
- Every task ends with `npm run build` passing from `windows/` (Rust tasks: `cargo check` from `windows/src-tauri` also required).
- Parallel-safe rule: dispatch A, B, C together only if they touch disjoint files — A: `style.css` (+read-only views audit, edits only where collisions found); B: `src/mochi/reaction-queue.ts`, `src/mochi/reactions.ts`, `scripts/check-queue.mjs`; C: `src-tauri/src/*`, `src/settings/main.ts`. D must wait for B.

---

### Task A1: Session view clears Pip

**Files:**
- Modify: `windows/src/style.css` (`.session` rule at :1600)

**Interfaces:**
- Consumes: none (pure CSS).
- Produces: `.session` gains a left inset so all rows clear Pip's canvas box (x≈19–116 in overview). No other task depends on it.

- [ ] **Step 1: Apply the inset**

Change:

```css
.session { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
```

to:

```css
.session { display: flex; flex-direction: column; gap: 6px; min-width: 0; padding-left: 108px; }
```

108px matches `.int-card` (style.css:2416) and `.who` (style.css:543).

- [ ] **Step 2: Build**

Run: `npm run build` (workdir `windows/`)
Expected: PASS (tsc + vite, no output errors).

- [ ] **Step 3: Visual check**

Run `npm run tauri dev`, open an agent session (Agents tab). Expect: step chips, cmd/diff viewer, "Waiting for the first step…", and Allow/Deny row all fully visible right of Pip. If any session sub-row (approval row especially) still touches Pip, extend the padding to that row's own class — same 108px value.

---

### Task A2: Full-view collision audit + fixes

**Files:**
- Modify: `windows/src/style.css` (only where a collision is found), possibly `windows/src/core/layout.ts` (only if a view's `botX` is wrong)
- Reference: `windows/src/views/views.ts`, `windows/src/core/layout.ts:79-107`

**Interfaces:**
- Consumes: A1's inset pattern (100–108px).
- Produces: every view content-cleared of Pip; list of findings recorded in the final report.

- [ ] **Step 1: Compute Pip's box per view**

For each entry in `VIEW_LAYOUTS`: canvas spans `cx ± (botDiameter/0.6)/2` horizontally, `cy ± (botDiameter/0.6 + BOT_OVERHANG)/2` vertically (`BOT_OVERHANG = 40`, island.ts:28; canvas placement island.ts:949-963). Views with `botY != null` use fixed cy; others auto-centre (layout.ts:169-173).

- [ ] **Step 2: Walk each view's DOM/CSS and find content starting left of the canvas box**

Check: `overview` (session done in A1; pills right card ok), `empty`, `approval`, `question`, `error`, `finished`, `confused` (these render via `.session`/`.int-card` — already inset), `mail`, `prompt` (chat), `searching`, `result`, `note`, `settings`, `dashboard`, `media`, `controlCenter`, `bluetooth`, `stats`, `pomodoro`, `stopwatch`, `weather` (dashboard-grid already pads 100px), `upload`/`uploading`/`choose` (upload sequence owns geometry — verify only).

- [ ] **Step 3: Fix each collision found**

Pattern: give the content container `padding-left: 108px` (or 100px where the layout is grid-based, matching `.dashboard-grid` at style.css:1229). Never move Pip unless an inset would break the view — record such cases instead.

- [ ] **Step 4: Check secondary visuals**

- Pill mini-bots (`minibots.ts:25-53`, style.css:212-226): confirm not clipped by `.pill` overflow.
- `#bot-glow` (style.css:123-129): must sit under cards, not wash out text — verify z-order vs `.card-body { z-index: 1 }`.
- `.jump` button (z-index 2) vs Pip: ensure Pip's canvas never covers it (canvas is `pointer-events: none`, so check only visual overlap).

- [ ] **Step 5: Build + detector + visual pass**

Run: `npm run build` → PASS.
Run: `node C:\Users\Stanley\.agents\skills\impeccable\scripts\detect.mjs --json windows/src/style.css` → fix any findings it reports on changed rules (one batch).
Visual pass in `npm run tauri dev`: visit every tab (Home, Agents, Media, System, Tools).

---

### Task B1: Pure reaction queue + runnable check

**Files:**
- Create: `windows/src/mochi/reaction-queue.ts`
- Create: `windows/scripts/check-queue.mjs`

**Interfaces:**
- Consumes: none (zero-import module).
- Produces:
  - `export type Prio = 0 | 1 | 2` (0 = control, 1 = session, 2 = other)
  - `export function createQueue(cap = 5): Queue`
  - `Queue.enqueue(kind: string, prio: Prio, nowMs: number): void`
  - `Queue.dequeue(nowMs: number): { kind: string; prio: Prio } | null` — highest prio first, FIFO within prio, drops entries staler than 15 000 ms, applies cap on enqueue (drop oldest lowest-prio: oldest prio-2, else oldest prio-1, never prio-0 unless queue is all control)
  - `Queue.clear(): void`, `Queue.size(): number`
  - Re-enqueue of a kind already present = replace its timestamp/prio (dedupe).

- [ ] **Step 1: Write the queue**

```ts
// windows/src/mochi/reaction-queue.ts
// Pure priority queue for the reaction bus: control > session > other,
// FIFO within a class, dedupe by kind, capped, stale entries dropped.
// ponytail: single-process in-memory queue; per-view queues if we ever run two engines.

export type Prio = 0 | 1 | 2;
export interface Entry { kind: string; prio: Prio; atMs: number }

export const STALE_MS = 15_000;

export function createQueue(cap = 5) {
  let items: Entry[] = [];
  return {
    enqueue(kind: string, prio: Prio, nowMs: number) {
      const i = items.findIndex((e) => e.kind === kind);
      if (i >= 0) { items[i] = { kind, prio, atMs: nowMs }; return; }
      if (items.length >= cap) {
        // drop the oldest lowest-priority entry (never a control one unless full of them)
        let drop = -1;
        for (const p of [2, 1, 0] as const) {
          const j = items.findIndex((e) => e.prio === p);
          if (j >= 0) { drop = j; break; }
        }
        items.splice(drop, 1);
      }
      items.push({ kind, prio, atMs: nowMs });
    },
    dequeue(nowMs: number): { kind: string; prio: Prio } | null {
      items = items.filter((e) => nowMs - e.atMs < STALE_MS);
      if (items.length === 0) return null;
      let best = 0;
      for (let i = 1; i < items.length; i++) if (items[i].prio < items[best].prio) best = i;
      const [e] = items.splice(best, 1);
      return { kind: e.kind, prio: e.prio };
    },
    clear() { items = []; },
    size() { return items.length; },
  };
}
```

- [ ] **Step 2: Write the check script**

```js
// windows/scripts/check-queue.mjs — compiles the pure queue with tsc, runs asserts.
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert";

const out = mkdtempSync(join(tmpdir(), "rq-"));
try {
  execSync(`npx tsc src/mochi/reaction-queue.ts --outDir "${out}" --module esnext --target es2022 --skipLibCheck`, { stdio: "inherit" });
  const { createQueue, STALE_MS } = await import(join(out, "reaction-queue.js"));

  const q = createQueue(5);
  q.enqueue("other-a", 2, 1000);
  q.enqueue("session-x", 1, 1001);
  q.enqueue("control-y", 0, 1002);
  assert.equal(q.dequeue(1003).kind, "control-y");   // priority: control first
  assert.equal(q.dequeue(1004).kind, "session-x");   // then session
  assert.equal(q.dequeue(1005).kind, "other-a");     // then other

  const d = createQueue(5);
  d.enqueue("k", 2, 0); d.enqueue("k", 1, 10);       // dedupe refreshes, no dupe
  assert.equal(d.size(), 1);

  const c = createQueue(2);
  c.enqueue("a", 2, 0); c.enqueue("b", 2, 1); c.enqueue("c", 2, 2); // cap
  assert.equal(c.size(), 2);

  const s = createQueue(5);
  s.enqueue("old", 2, 0);
  assert.equal(s.dequeue(STALE_MS + 1), null);        // stale dropped

  const p = createQueue(5);
  p.enqueue("o", 2, 0); p.enqueue("ctl", 0, 1);
  p.enqueue("o2", 2, 2); p.enqueue("o3", 2, 3); p.enqueue("o4", 2, 4); p.enqueue("o5", 2, 5); // over cap
  assert.equal(p.size(), 5);
  assert.equal(p.dequeue(100000).prio, 0);            // control survived the cap

  console.log("queue checks OK");
} finally {
  rmSync(out, { recursive: true, force: true });
}
```

- [ ] **Step 3: Run the check — must pass**

Run: `node scripts/check-queue.mjs` (workdir `windows/`)
Expected: `queue checks OK`. Iterate on the queue implementation until it passes (failing asserts are the contract).

---

### Task B2: Integrate the queue into reactions.ts

**Files:**
- Modify: `windows/src/mochi/reactions.ts` (transient slot :81, `react()` :96-114, `tickReactions()` :167-179)

**Interfaces:**
- Consumes: `createQueue` from B1.
- Produces: `react()` now queues; side-effects fire at play time; `resolve()` untouched.

- [ ] **Step 1: Map kinds → priority**

```ts
import { createQueue } from "./reaction-queue";
const queue = createQueue(5);
function prioOf(kind: ReactionKind): 0 | 1 | 2 {
  if (CONTROL_KINDS.has(kind)) return 0;
  if (SESSION_KINDS.has(kind)) return 1;
  return 2;
}
```

(`CONTROL_KINDS`/`SESSION_KINDS` are defined at :124-136 — move their declarations above `react()` if needed for ordering.)

- [ ] **Step 2: react() enqueues; side-effects move to a `beginReaction()` helper**

```ts
function beginReaction(kind: ReactionKind, intensity?: number, color?: string): void {
  transient = { kind, until: performance.now() + REACTION_TTL[kind], intensity, color };
  switch (kind) {
    case "theme-sparkle": engine?.emit("star", 5); break;
    case "session-done": engine?.emit("heart", 5); break;
    case "battery-full": engine?.emit("spark", 1); break;
    case "session-ratelimit": engine?.emit("sweat", 1); engine?.emit("steam", 2); break;
    case "volume": engine?.emit("note", 1); break;
    case "nuzzle": engine?.emit("heart", 2); break;
    case "memory-freed": engine?.emit("spark", 4); engine?.squash(); break;
    case "dnd-wake": engine?.blink(); break;
  }
}

export function react(kind: ReactionKind, opts?: { intensity?: number; color?: string }): void {
  queue.enqueue(kind, prioOf(kind), performance.now());
  State.notify();
}
```

- [ ] **Step 3: tickReactions() dequeues when idle/expired**

In `tickReactions(nowMs)` before `resolve`:

```ts
if (transient && nowMs >= transient.until) transient = null;
if (!transient && !engine.busy) {
  const next = queue.dequeue(nowMs);
  if (next) beginReaction(next.kind as ReactionKind);
}
```

Keep the rest of `tickReactions` unchanged (pose/aura/prop/bob/badge/deadline application). If `engine.busy` proves to starve the queue for looping states (it is permanently true for looping configs, island.ts:864-869), replace `!engine.busy` with a simple `true` — the TTL expiry gate already serialises playback.

- [ ] **Step 4: Build**

Run: `npm run build` → PASS.

- [ ] **Step 5: Harness verification**

Run `npm run tauri dev` with `?reactions=1`. Click 6 transient chips rapidly (e.g. volume, night-light-on, session-done, track-change, mute-flash, memory-freed). Expected: they play **one after another** in control → session → other order; none is cut off mid-animation; repeated clicks of the same chip don't duplicate.

- [ ] **Step 6: Regression check**

Toggle DND on/off, night light on/off, start media — conditions still behave exactly as before (sleep pose while DND on, headphones while media plays).

---

### Task C1: Settings schema + keychain allow-list (Rust)

**Files:**
- Modify: `windows/src-tauri/src/settings.rs` (`Settings` struct :7-23)
- Modify: `windows/src-tauri/src/secrets.rs` (`KNOWN_KEYS` :9-19)

**Interfaces:**
- Produces: `Settings.chat_provider: String` (serde default `"anthropic"`), `Settings.chat_models: HashMap<String, String>` (serde default empty); keychain accepts `openai-api-key`, `nvidia-api-key`, `openrouter-api-key`, `opencode-api-key`.

- [ ] **Step 1: Extend Settings**

```rust
#[serde(default = "default_chat_provider")]
pub chat_provider: String,            // "anthropic" | "openai" | "nvidia" | "openrouter" | "opencode"
#[serde(default)]
pub chat_models: HashMap<String, String>,
```

with `fn default_chat_provider() -> String { "anthropic".into() }`. Add `use std::collections::HashMap;` if absent. Check `settings.rs` default construction (there is a `Default`/default literal) and add the fields there too.

- [ ] **Step 2: Extend KNOWN_KEYS**

```rust
"anthropic-api-key",
"openai-api-key",
"nvidia-api-key",
"openrouter-api-key",
"opencode-api-key",
```

- [ ] **Step 3: cargo check**

Run: `cargo check` (workdir `windows/src-tauri`)
Expected: no errors.

---

### Task C2: Multi-provider chat client (Rust)

**Files:**
- Modify: `windows/src-tauri/src/claude.rs`

**Interfaces:**
- Consumes: `secrets::get`, `Settings.chat_provider`/`chat_models` (passed in from C3).
- Produces: `pub async fn send(chat, provider: &str, model, query, context) -> Result<ChatReply, String>` — dispatches `provider == "anthropic"` → existing body unchanged; otherwise → `send_openai(...)`. `Chat` history keyed per provider.

- [ ] **Step 1: Per-provider history**

```rust
#[derive(Default)]
pub struct Chat {
    messages: Mutex<HashMap<String, Vec<Value>>>,  // provider → history
}
```

Update `reset/clear`, `is_empty`, `push`, `pop`, `snapshot` to take a `provider: &str` key (or store per-call). Keep semantics: `chat_reset` clears the whole map.

- [ ] **Step 2: Provider table**

```rust
struct OpenAiCompat { base: &'static str }
fn provider_cfg(p: &str) -> Option<OpenAiCompat> {
    Some(OpenAiCompat { base: match p {
        "openai"    => "https://api.openai.com/v1",
        "nvidia"    => "https://integrate.api.nvidia.com/v1",
        "openrouter"=> "https://openrouter.ai/api/v1",
        "opencode"  => "https://opencode.ai/zen/v1",
        _ => return None,
    }})
}
fn key_name(p: &str) -> &'static str { match p {
    "openai" => "openai-api-key", "nvidia" => "nvidia-api-key",
    "openrouter" => "openrouter-api-key", "opencode" => "opencode-api-key",
    _ => "anthropic-api-key",
} }
```

- [ ] **Step 3: send() dispatch**

At the top of `send()`: if `provider_cfg(provider)` is `Some(cfg)`, call `send_openai(chat, &cfg, key_name(provider), model, query, context).await` and return; else run the existing Anthropic body (unchanged, still using `secrets::get("anthropic-api-key")`).

- [ ] **Step 4: send_openai()**

```rust
async fn send_openai(chat: &Chat, cfg: &OpenAiCompat, secret: &str, model: &str,
                     query: String, context: Option<ChatContext>) -> Result<ChatReply, String> {
    let key = secrets::get(secret).ok_or_else(|| "API key missing. Open settings.".to_string())?;
    let p = /* provider string for history key — pass it through */;
    if chat.is_empty(&p) { /* push context message: images → {"type":"image_url","image_url":{"url":"data:<mime>;base64,..."}},
        text files ≤200_000 bytes → inline text; other → format!("File: {name}"); window → plain text */ }
    chat.push_str(&p, "user", &query);
    let body = json!({ "model": model, "max_tokens": 4096,
                       "messages": [ {"role":"system","content": SYSTEM_PROMPT}, chat.snapshot_openai(&p) ] });
    // POST {cfg.base}/chat/completions, header authorization: Bearer {key}
    // errors: same surfacing as claude.rs:180-190 with the provider name
    // on error: chat.pop(&p); on success: push assistant message, return choices[0].message.content
}
```

Reuse the existing `reqwest` call pattern from `call()` (claude.rs:160-193); images reuse `file_block()`-style extension sniffing but produce `image_url` data URIs (jpg/png/gif/webp), text reuse the `MAX_INLINE_TEXT` read.

- [ ] **Step 5: Unit tests**

Extend the `#[cfg(test)]` block: (a) image path produces a data-URI `image_url` message; (b) a >200 KB or binary non-image file degrades to `File: <name>`; (c) `provider_cfg` returns `None` for unknown → send() falls through to Anthropic.

- [ ] **Step 6: cargo check + tests**

Run: `cargo test` then `cargo check` (workdir `windows/src-tauri`) → PASS.

---

### Task C3: Wire chat_send + settings UI

**Files:**
- Modify: `windows/src-tauri/src/lib.rs` (`chat_send` :280, `save_settings`/`boot` as needed)
- Modify: `windows/src/settings/main.ts:260-341`

**Interfaces:**
- Consumes: C1 (`chat_provider`, `chat_models`), C2 (`send(chat, provider, model, …)`).
- Produces: island chat works on any provider; settings window has Provider/Key/Model rows.

- [ ] **Step 1: chat_send passes provider + model**

In `chat_send`: load settings, `let provider = settings.chat_provider.clone(); let model = settings.chat_models.get(&provider).unwrap_or(&settings.model).clone();` — keep `settings.model` as the legacy field Claude's select writes (see Step 2) so existing users lose nothing.

- [ ] **Step 2: settings UI section rewrite**

In `apiSection()` (settings/main.ts:268):

```ts
const PROVIDERS: [string, string, string, string][] = [
  // id, label, secret key name, default model placeholder
  ["anthropic", "Claude (Anthropic)", "anthropic-api-key", "claude-opus-5"],
  ["openai", "OpenAI", "openai-api-key", "gpt-4o"],
  ["nvidia", "NVIDIA NIM", "nvidia-api-key", "meta/llama-3.3-70b-instruct"],
  ["openrouter", "OpenRouter", "openrouter-api-key", "anthropic/claude-sonnet-4"],
  ["opencode", "OpenCode Zen", "opencode-api-key", "deepseek-v4-flash"],
];
```

- Provider `<select>` as the first row; `state.settings.chat_provider` on change → `save()` + re-render the section (rebinding key row + model control).
- Key row: existing field/save/clear logic, parameterised by the selected provider's key name; `refresh()` calls `Bridge.secretPresent(keyName)`.
- Model control: for `anthropic` keep the existing `MODELS` `<select>` writing `settings.model`; for others a text input seeded from `settings.chat_models[id] ?? placeholder`, `onchange` → `settings.chat_models[id] = value; save()`.
- Header label: `h("span", { text: providerLabel })` instead of hard-coded "Claude".
- No other styling changes — reuse `.row`, `.hint`, `.primary`, `.danger`, `statusDot`.

- [ ] **Step 3: bridge/settings typing**

Add `chat_provider: string` and `chat_models: Record<string, string>` to the `Settings` interface + `DEFAULT_SETTINGS` in `windows/src/core/state.ts:117-140` (frontend mirror; `chat_provider: "anthropic"`, `chat_models: {}`).

- [ ] **Step 4: Build + check**

Run: `npm run build` (workdir `windows/`) → PASS; `cargo check` (workdir `windows/src-tauri`) → PASS.

- [ ] **Step 5: Manual test**

`npm run tauri dev` → open Settings: switch provider to OpenAI, save a key, type a model, send a chat message from the island → reply arrives; switch back to Claude → previous behavior. Confirm key dot green/refreshed per provider.

---

### Task D1: Folder prop

**Files:**
- Modify: `windows/src/mochi/props.ts` (add `drawFolder`)
- Modify: `windows/src/mochi/engine.ts` (:10 import, :273 `prop`, :355 `setProp`, :872 draw branch)

**Interfaces:**
- Consumes: props.ts house style (`INK`, body-local coords, `R/rx/ry`).
- Produces: `drawFolder(x: CanvasRenderingContext2D, R: number, rx: number, ry: number): void`; `setProp(name: "headphones" | "folder" | null)`.

- [ ] **Step 1: drawFolder in props.ts**

```ts
/** Folder: rounded ink-outline folder body + lighter front flap + glint,
 *  with two small grip blobs at the lower edges (resting hands are hidden,
 *  so the folder carries its own "held" read — see spec D). */
export function drawFolder(
  x: CanvasRenderingContext2D, R: number, rx: number, ry: number,
) {
  x.save();
  const w = R * 1.1, h = R * 0.82;
  const fy = R * 0.28;                       // folder sits low, in front of the body
  // back flap tab
  x.fillStyle = INK;
  x.beginPath();
  x.roundRect(-w / 2, fy - h / 2, w * 0.42, h * 0.18, R * 0.06);
  x.fill();
  // body
  x.beginPath();
  x.roundRect(-w / 2, fy - h * 0.36, w, h, R * 0.1);
  x.fill();
  // front flap (slightly lighter for depth)
  x.fillStyle = "rgba(255,255,255,0.14)";
  x.beginPath();
  x.roundRect(-w / 2 + R * 0.05, fy - h * 0.1, w - R * 0.1, h * 0.42, R * 0.08);
  x.fill();
  // glint
  x.fillStyle = "rgba(255,255,255,0.8)";
  x.beginPath();
  x.ellipse(-w * 0.3, fy - h * 0.2, R * 0.07, R * 0.05, -0.5, 0, Math.PI * 2);
  x.fill();
  // grips
  x.fillStyle = INK;
  for (const sd of [-1, 1]) {
    x.beginPath();
    x.ellipse(sd * (w / 2 + R * 0.04), fy + h * 0.18, R * 0.14, R * 0.11, 0, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}
```

(Adjust to taste against `drawHeadphones`; `roundRect` availability is fine — Vite targets modern webview. If TS lib complains, use `x.rect` + `closePath`.)

- [ ] **Step 2: engine wiring**

```ts
import { drawHeadphones, drawFolder } from "./props";
private prop: "headphones" | "folder" | null = null;
setProp(name: "headphones" | "folder" | null) { this.prop = name; }
// in the draw path, next to engine.ts:872:
if (this.prop === "headphones") drawHeadphones(x, R, rx, ry);
else if (this.prop === "folder") drawFolder(x, R, rx, ry);
```

- [ ] **Step 3: Build** — `npm run build` → PASS.

---

### Task D2: Folder trigger + lifecycle

**Files:**
- Modify: `windows/src/mochi/reactions.ts:173`
- Modify: `windows/src/island/island.ts` (drop/consume/cancel paths — find all `State.droppedFile` writes)

**Interfaces:**
- Consumes: D1 `setProp`, `State.droppedFile` (exists, state.ts:188-193).
- Produces: folder visible exactly while `State.droppedFile` is set (and no media condition holds headphones).

- [ ] **Step 1: One-line trigger**

reactions.ts `tickReactions`:

```ts
engine.setProp(
  conds["media-playing"] || conds["media-paused"] ? "headphones"
  : State.droppedFile ? "folder" : null,
);
```

- [ ] **Step 2: Clear droppedFile where the file is consumed/cancelled**

Grep `droppedFile` across `windows/src`. Ensure: chat send consumes (clears after `Bridge.chatSend` picks up context), choose-view Cancel clears, a new drop replaces. Add `State.droppedFile = null; State.notify();` where a clear is missing.

- [ ] **Step 3: Build + visual**

`npm run build` → PASS. In `npm run tauri dev`: drag an image onto the island → swallow plays → `choose` view shows Pip holding the folder; Cancel → folder gone; send as chat context → folder gone.

---

### Task F1: Final verification (all tasks)

- [ ] **Step 1:** `npm run build` (windows/) → PASS
- [ ] **Step 2:** `cargo check` + `cargo test` (windows/src-tauri) → PASS
- [ ] **Step 3:** `node scripts/check-queue.mjs` (windows/) → `queue checks OK`
- [ ] **Step 4:** impeccable detector on all changed UI files → findings fixed in one batch
- [ ] **Step 5:** visual pass: every tab, session overlap gone, queue plays back-to-back reactions fully, folder hold on/off correct, settings provider switch works
- [ ] **Step 6:** final report to user — includes the spec's animation inventory (which actions have custom animations, which don't) and every UI fix made
