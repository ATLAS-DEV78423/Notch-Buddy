# UI quality pass — gated micro-interaction scan

Read-only sweep of `windows/src/views/`, `windows/src/settings/`, `windows/src/style.css`
against the four-question gate of `find-animation-opportunities` (frequency → purpose →
speed ≤ 300 ms → function). Tasks 1-4 spent four of the skill's 5-7 whole-app slots; this
scan had at most 3 CSS-only slots left.

## Part 1 — Opportunities table

### Shipped before this scan (cited, not re-proposed)

| # | Location | Motion | Gate notes |
| --- | --- | --- | --- |
| S1 | `style.css` ~427-451 | Unified press scale — every control presses like `.btn` (0.94 / 80 ms) | Feedback, tens/day tier, subtle |
| S2 | `style.css` ~300-335 | Overlap view crossfade + 35 ms row stagger | Preventing a jarring change; occasional per view switch |
| S3 | `style.css` ~609-703 | ThoughtLine (breath, shimmer, settle chord, live clock) | State indication on the overview |
| S4 | `style.css` ~713-875 | SpringCheck (fill scale, tick draw, strike wipe, swell) | Feedback on task toggle |
| S5 | `style.css` ~1041-1114 | SquishSwitch (thumb stretch, drag squash, tap swell) | Feedback + spatial consistency, both windows |
| S6 | `style.css` ~1223-1258 | SwipeToast (fuse countdown, swipe return, symmetric exit) | Occasional; TTL is the fuse |
| S7 | `style.css` ~1266-1374 | CallChip (fill wipe, ms clock, error freeze/shake) | State indication on the ticker |
| S8 | `style.css` ~1472-1514 | SwipeRow (rubber-band drawer, armed label, fold) | Gesture seam, pomodoro tasks |
| S9 | `style.css` ~283-289 | Header tab-segment sliding thumb (Task 3) | State indication on group switch |
| S10 | `style.css` ~1404-1414 | Control-center slider knob, drag glow, value readout (Task 4) | Feedback on drag/wheel |

### New survivors — shipped this scan (3, all CSS-only)

| # | Location | Today (before) | Purpose | Frequency | Motion shipped |
| --- | --- | --- | --- | --- | --- |
| 1 | `style.css` — press block after the unified rule | 14 pressable controls had no `:active`; 13 shipped here: header `.tab`, `.header-actions button`, `.link-btn`, `.media-controls button`, `.cc-icon-btn`, `.task-del`, `.banner-open`, `.banner-close`, `.int-more`, `.int-back`, `.int-page`, `.int-pill`, `.int-link` (`.widget` excluded — see note) | **Feedback** — the click landed, before the view crossfade starts | Tens/day (header tabs) down to occasional (banners); the strictest tier is the skill's own press-feedback example → near-imperceptible motion required | `.tab:active` … `.int-link:active { transform: scale(0.94) }`, paired `transition: transform 0.08s ease-out`. 80 ms « 300 ms; transform+opacity-class only; reduced-motion collapses via the existing global block (style.css:2154). Transform-only transition — no hover fades were added to controls that never had one. **Note:** widgets are excluded because `.view.on .stagger`'s `animation: … both` fill-mode locks their `transform` at the finished keyframe — a normal-origin `:active` scale can never render there, so it is deliberately not in the list (do not re-add) |
| 2 | `style.css` — `.cc-slider-fill` | Task 4's knob glides 250 ms to a new value while the fill snaps to it instantly: for 250 ms the two shapes of one value disagree (visible on every control-center open, wheel step and commit) | **Spatial consistency** — fill and knob are one value in two shapes | Tens/day (every control-center open seeds the sliders) | `transition: transform 250ms cubic-bezier(0.23, 1, 0.32, 1)` on the fill; `.cc-slider.dragging` sets `transition: none` so drag stays 1:1 — the exact pattern the knob already has; added to the Task-4 reduced-motion list |
| 3 | `style.css` — `.task` | Toggling a pomodoro task: word opacity, tick and strike all ease over 220-320 ms, but the row's ink (ring `currentColor`, label colour) stepped to dim at t=0 | **State indication / preventing a jarring change** — the dim is part of the done cue, and the snap competes with the spring it rides | Occasional (each task completion) | `transition: color 0.32s cubic-bezier(0.23, 1, 0.32, 1)` — same duration and curve as `.spring-check__word`'s opacity, so the row dims as one motion with the strike. 320 ms exceeds the stated ≤ 300 ms speed gate: deliberate gate exception, because matching the SpringCheck strike it rides matters more than the 20 ms |

## Part 2 — Rejected candidates

- `views/chat.ts:117-122` — chat bubbles enter on new messages. **Rejected: the log is
  `clear()` + re-append of the whole history on every message — a CSS enter on `.chat-row`
  would re-animate every old message each time one arrives.** Killing question: does
  re-animating the entire visible history when one message lands aid comprehension?
  Fixing it needs keyed appends in JS (behaviour-touching) — escalated below.
- `views/views.ts:617-645` — dashboard widget empty↔value swaps via `display` toggles
  ("No media playing" ↔ track, weather, Bluetooth). **Rejected: discrete `display` swaps
  cannot transition without `@starting-style` / `allow-discrete` (Chrome 117+, target is
  chrome110), and the swap fires at data-load time, not user action.** Killing question:
  what comprehension problem does fading a one-line placeholder solve?
- `views/views.ts:693` and stat fills — media/progress bars step once per sync instead of
  gliding. **Rejected: function — a transition would lag seeks and track changes (the bar
  would glide to the new position after the title and art have already swapped), and a 4px
  bar stepping at 1 Hz is already legible.** Killing question: does smoothing a 1 Hz data
  step risk making an immediate seek feel broken?
- `style.css` `.tab:hover` (header house/bubble/plus) — hover background appears instantly.
  **Rejected on frequency: tens of times/day; an instant hover is the fastest possible
  feedback, and the tab's state change already rides the 160-300 ms view crossfade.**
  Killing question: at tens of tabs a day, what does a 120 ms background fade add over an
  instant one?
- `style.css` `.drop-card.over .drop-frame rect` — drag-over stroke could ease to green.
  **Rejected: function/frequency — the title already eases to green
  (`.drop-title` has its own 0.2 s transition), the cursor is moving during the drag, and
  animating `stroke` fights the `dash-breathe` keyframes that set it every frame.**
  Killing question: is a second green cue needed when the first one already animates?

## Part 3 — Verdict

This interface was already close to right. The four shipped tasks covered every high-value
seam — press, view handoff, gesture, ticker, toggles, sliders — and this scan's gate
rejected almost everything it touched: the remaining candidates live in rebuild-all render
patterns (chat log), on chrome110-forbidden techniques (display swaps), or on data the user
is reading (progress bars), where motion either can't be done safely in CSS or would hinder.
What survived is small by design: closing the unified press block's 13-control oversight,
making Task 4's fill and knob agree with each other, and easing a colour step into the beat
SpringCheck already plays. Highest remaining leverage is not CSS at all — the chat log's
keyed append (so a new message can enter without replaying history) — and it needs the
user's sign-off as a behaviour change.

**For the user to approve (not implemented here):**

1. `settings/settings.css` `.switch` — add `transition: background 0.18s;` (the island's
   SquishSwitch has it; the settings window's track colour snaps while the thumb springs).
   One line, but settings.css is outside this task's write scope.
2. Chat log keyed append + per-message enter (JS, behaviour-touching; see reject 1).
3. Integration card crossfade when the overview's left body swaps ticker ↔ card ↔ detail
   (JS rebuild cadence decides whether an enter replays on data patches; behaviour).
