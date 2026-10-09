# Motion & Visual Polish — Design Spec

Date: 2026-10-09 · Status: approved (design presented in chat, user approved 2026-10-09)
Surfaces: island (main window) + settings window · Platform: Tauri 2 (Windows target)

## Goals

- **A — motion quality**: make every existing interaction butter-smooth. Keep the current
  look exactly; fix the jank sources, unify the motion system, polish micro-interactions.
- **B — visual polish**: tighten spacing / typography / colors / shadows toward the
  `docs/SPEC.md` + Mac-app quality bar. Same design language, no redesign.
- `prefers-reduced-motion` respected (OS setting only).
- Zero % CPU when the island is hidden must still hold after every change.

## Non-goals

- No visual redesign, no new views, no new features, no GSAP, no new dependencies.
- No changes to the macOS Swift app. No changes to `Reference Only/`.
- Pill IDs, Tauri commands, Rust backends untouched.

## Decisions (confirmed with user)

1. **No GSAP.** `core/anim.ts` is extended; the three duplicated easing sets
   (`anim.ts`, `greeting.ts`, `upload/sequence.ts`) are consolidated into `anim.ts`.
2. **Island + settings window** both in scope; one shared token set.
3. **Reduced motion**: OS `prefers-reduced-motion` only, no manual toggle.
4. **react-bits / lenis**: not used (ideas-only / low value). No new runtime deps.

## 1. Motion architecture — one system, one clock

- `core/anim.ts` becomes the single easing source: `Ease` set, `cubicBezier` solver,
  `Spring` (SwiftUI-equivalent), `Tracked`, `closeCurve`, plus a `stagger` helper and a
  module-level `prefersReduced` flag.
- `greeting.ts` and `upload/sequence.ts` import their easings from `anim.ts`
  (eliminates the `c1 = 1.7` vs `1.70158` drift).
- Signature curves (SPEC §4 / Mac app values — the law):
  - Island open: spring `response 0.5, dampingFraction 0.72`
    (≈ `cubic-bezier(.32,1.22,.42,1)`), radius follows.
  - Island close: `0.34s cubic-bezier(.45,0,.2,1)`, no overshoot.
  - Content out: `160ms` ease-in (opacity + blur 8 + scale .97).
  - Content in: `300ms` starting `120ms` after the container starts growing.
  - Stagger: `35ms` per item (mini pills, view rows).
  - View switch: active `.4s spring (damping .8)`, inactive `.16s ease-in`.
  - Hover: `200ms` spring, damping `0.7`. Press: `80–120ms` out, spring back.
- **Reduced motion**: `matchMedia('(prefers-reduced-motion: reduce)')` consulted by
  JS (springs snap, tweens → ~0.01s) and by one CSS block (transitions → 0.01s,
  infinite keyframes frozen via `animation: none`, blur/scale enter effects dropped).
  Media-query changes are re-checked live.
- The single rAF clock in `island.ts` stays the only structural-motion driver.

## 2. Jank fixes (exploration pain points → fixes)

| # | Pain point | Fix |
|---|---|---|
| 1 | Island animates `width`/`height` at 60 Hz (layout + full-panel repaint) | `contain: layout style paint` on `#island` and `#island-clip`; children already absolute so the panel's internal layout stays cheap. Keep the spring — it is the SPEC motion. |
| 2 | `liveView()` does `replaceChildren(rebuild)` on every notify (dashboard, stopwatch, weather, bluetooth, banners, compact status) | Patch in place: stable element handles created once, fields updated per sync (same pattern media/stats views already use). Kills DOM churn, image re-decodes, hover-state loss. |
| 3 | View crossfade gap (out 160 ms / in delayed 160 ms → blank frame) | Overlap the handoff: outgoing fades 160 ms, incoming starts at 120 ms with 300 ms fade+scale. No blink. |
| 4 | `#bot-glow` radial-gradient string rebuilt every frame | Pre-render the glow sprite to an offscreen canvas once per size/color change; `drawImage` per frame. |
| 5 | Canvas backing stores reallocated mid-spring (`#bot-canvas`, `#bg-canvas`) | Debounce backing-store resize until the geometry spring settles (or 2 consecutive frames at the same size). |
| 6 | Ticker not in the frame-loop busy gate (queued steps can stall mid-flight) | Add `Ticker.animating` to the keep-alive set in `island.ts`. |
| 7 | Slider reads `getBoundingClientRect()` during drag | Cache the track rect on pointerdown. |
| 8 | Media/stats progress fills animate `width` (layout property) | `transform: scaleX()` with `transform-origin: left` — compositor-only. |
| 9 | No `contain` / `content-visibility` anywhere | `contain` on `#island` + views; `content-visibility: auto` on long integration lists. |
| 10 | Duplicated tokens (style.css vs settings.css; `#3b9eff` literals) | One shared token source; accent as a single CSS custom property. |

## 3. Micro-interactions (hand-rolled, shared helpers)

- **Press**: every `.btn`, `.pill`, tab, switch, list row gets the unified press
  spring (scale 0.94–0.96, 80–120 ms out, spring back). Today only `.btn:active` has it.
- **Hover**: shared hover lift/tint spring on pills, cards, rows (200 ms, damping 0.7).
- **Enter**: view content staggers in (35 ms per row, opacity + translateY 8 px) on view
  switch; dashboard widgets stagger on first build.
- **Controls**: switch thumb spring + state-color crossfade; slider handle subtle scale
  while dragging; toggle flips crossfade their state color.

## 4. Visual polish (B — same language, tighter)

Values from the Mac app / SPEC §5 (the quality bar):

- **Typography**: body 13; big line 15 semibold −0.01 em; who/labels 12;
  buttons 12.5 medium; fine print 11; header icons 13–14; code 12 SF Mono;
  ticker current 14 medium, others 13.
- **Spacing**: 8 top / 34 header / 98 content / 10 bottom rhythm; 10 px horizontal
  padding; content inset 36 top / 10 sides-bottom.
- **Colors**: card `#141518`; text `#F5F6F8` / `#9398A1` / `#6B7079`; tab active bg
  `#1D1F23`; primary button `#F5F6F8` on `#0B0C0E`.
- **State colors**: working `#3B9EFF`, thinking `#A78BFA`, searching `#6366F1`,
  approval `#F5A524`, error `#F4505E`, finished `#34D399`, ratelimit `#F59E0B`,
  dizzy `#F472B6`, sleeping `#94A3B8`.
- **Surfaces**: card border `1px rgba(255,255,255,.035)`, radius 20.
- **Glow**: radial, opacity 0.15 (idle/sleep) else 0.65, radius ×1.1, blur 6,
  gradient stop 0.62.

Known Mac-vs-spec deltas resolved as: **keep current Windows values** (expanded
corner 22, compact width) — no visual redesign.

## 5. Settings window parity

- Import the shared token set (kills the divergent `settings.css` subset).
- Section open/close transitions; control hover/press states; same radii and type ramp.

## 6. Testing & acceptance

- **Unit** (`cargo test` unchanged side; TS checked by `tsc`):
  - `anim.ts` spring/easing determinism (fixed inputs → expected values, incl.
    reduced-motion snap), `closeCurve` endpoint, stagger math.
  - Token parity: every custom property in `settings.css` exists in the shared set.
- **Integration** (headless island boot, dev build):
  - View-switch matrix: every view → every view; assert no blank frame longer than
    one frame and no layout thrash (no `width`/`height` writes on child subtrees
    during island resize).
  - Reduced-motion matrix: with the media query forced, all transitions ≤ 20 ms,
    infinite animations disabled.
  - 0 % CPU while hidden re-measured (Task 20 method: rAF count + CPU while parked).
- **E2E manual checklist** (release gate):
  - Open/close ×50 — watch for stutter; every tab-group tab switch.
  - Slider drags, toggle flips, switch presses, pill hovers.
  - Banner show/dismiss; compact status strip; compact ↔ expanded.
  - Settings window open/close, section toggles, control states.
  - Greeting choreography; upload drop sequence; ticker queue under load.
- **Perf gates**: open/close frame time p95 < 8 ms (devtools); no forced reflow
  warnings; 0 % CPU hidden; `npm run build` + `cargo build` + `cargo test --lib` green.

## 7. Constraints (project rules)

- No new npm/crate dependencies; hand-rolled TypeScript; CSS transitions/keyframes
  compositor-first; 0 % CPU when hidden (PollGate) must survive every change.
- Pill IDs stable; never restyle shipped views beyond this spec; secrets untouched.
- Bundle identifier `fr.louisraille.NotchBuddy` untouched.
