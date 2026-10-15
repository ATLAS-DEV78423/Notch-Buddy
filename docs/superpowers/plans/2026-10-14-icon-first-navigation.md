# Icon-first island navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace text-heavy island navigation with accessible icon-first routes while making Home and Agents distinct and preserving all existing destination behavior.

**Architecture:** Keep the existing vanilla TypeScript DOM flow and `State.setView` routing. Add a small navigation metadata table in `views.ts`, render it as compact icon buttons in the header popover, and use the existing `ICONS` SVG path registry plus CSS materials for styling. Dashboard widgets remain unchanged as secondary shortcuts.

**Tech Stack:** Vanilla TypeScript, DOM helpers in `windows/src/views/dom.ts`, SVG path icons in `windows/src/views/icons.ts`, CSS in `windows/src/style.css` and `windows/src/app-materials.css`, Vite, TypeScript, Node smoke tests.

**Spec:** `docs/superpowers/specs/2026-10-14-icon-first-navigation-design.md`

## Global Constraints

- Preserve the current views, state, actions, animations, and keyboard behavior.
- Do not rewrite Media, Bluetooth, Control Center, or Stats behavior.
- Do not change native bridge commands or Rust pollers.
- Do not add dependencies or replace the vanilla TypeScript DOM architecture.
- Keep full destination names in `aria-label`, `title`, and focus-visible affordances.
- Keep dashboard widgets as working shortcuts to their existing views.
- Preserve unrelated existing working-tree changes.

---

### Task 1: Add the missing navigation glyphs and metadata

**Files:**
- Modify: `windows/src/views/icons.ts`
- Modify: `windows/src/views/views.ts` near `GROUPS` and the header builder

**Interfaces:**
- Produces a navigation item shape used by the header renderer: `{ view: IslandViewName, label: string, icon: keyof typeof ICONS }`.
- Produces icon paths for Agents, Control Center, Bluetooth, Stats, Stopwatch, and Weather while reusing existing `house`, `bubble`, `plus`, `gear`, `timer`, and media paths.

- [ ] **Step 1: Record the existing navigation contract before editing**

Confirm the current destinations in `GROUPS` are:

```ts
Home: ["dashboard"]
Agents: ["overview", /* existing agent states */]
Media: ["media"]
System: ["controlCenter", "bluetooth", "stats"]
Tools: ["pomodoro", "stopwatch", "weather"]
```

Do not rename view IDs or alter the state union.

- [ ] **Step 2: Add only the missing SVG paths**

Extend `ICONS` with small 24×24 paths for:

```ts
agent
sliders
bluetooth
chart
stopwatch
cloudSun
```

Keep them as solid/simple paths compatible with the existing `svg()` helper; do not add an icon package.

- [ ] **Step 3: Add explicit destination metadata**

Add a local `NAV_ITEMS` map/table in `views.ts` so the renderer does not infer icons from display text:

```ts
type NavIcon = keyof typeof ICONS;
type NavItem = { view: IslandViewName; label: string; icon: NavIcon };

const NAV_ITEMS: Partial<Record<IslandViewName, NavItem>> = {
  dashboard: { view: "dashboard", label: "Home", icon: "house" },
  overview: { view: "overview", label: "Agents", icon: "agent" },
  media: { view: "media", label: "Media", icon: "mediaPlay" },
  controlCenter: { view: "controlCenter", label: "Control Center", icon: "sliders" },
  bluetooth: { view: "bluetooth", label: "Bluetooth", icon: "bluetooth" },
  stats: { view: "stats", label: "Stats", icon: "chart" },
  pomodoro: { view: "pomodoro", label: "Pomodoro", icon: "timer" },
  stopwatch: { view: "stopwatch", label: "Stopwatch", icon: "stopwatch" },
  weather: { view: "weather", label: "Weather", icon: "cloudSun" },
};
```

Use the exact existing `IslandViewName` and `ICONS` types so a missing destination fails TypeScript compilation.

- [ ] **Step 4: Run the typecheck before rendering changes**

Run from `windows/`:

```text
npx tsc --noEmit
```

Expected: PASS; the new paths and metadata compile without changing runtime behavior.

---

### Task 2: Convert the header to icon-first navigation

**Files:**
- Modify: `windows/src/views/views.ts` inside `buildHeader`

**Interfaces:**
- Consumes: `NAV_ITEMS`, `GROUPS`, `groupOfView`, `State.setView`, and the existing `go()` helper.
- Produces: icon-only direct actions for Home, Agents, Ask, Drop, Settings, and Sound; icon-only grouped navigation buttons for Home, Media, System, and Tools destinations.

- [ ] **Step 1: Make Home and Agents distinct direct actions**

Replace the current Overview house action with:

```ts
const tabHome = h(
  "button",
  { class: "tab", "aria-label": "Home", title: "Home", onclick: () => go("dashboard") },
  svg(ICONS.house, 13),
);
const tabAgents = h(
  "button",
  { class: "tab", "aria-label": "Agents", title: "Agents", onclick: () => go("overview") },
  svg(ICONS.agent, 13),
);
```

Keep Ask, Drop, Settings, and Sound as icon-only buttons with their existing handlers.

- [ ] **Step 2: Render grouped navigation as icon buttons**

For each group, render only the destinations represented by `NAV_ITEMS`. Each button must:

```ts
h(
  "button",
  {
    class: "nav-icon",
    type: "button",
    "aria-label": item.label,
    title: item.label,
    "aria-current": item.view === State.view ? "page" : "false",
    onclick: () => go(item.view),
  },
  svg(ICONS[item.icon], 15),
)
```

Keep the existing group switching behavior and close the `<details>` popover after navigation.

- [ ] **Step 3: Keep group labels compact but not redundant**

Use the existing group segmentation as the grouping context. Do not repeat full page names beside every icon. The group control may retain its current group label if needed for orientation, but page destinations inside it must be icon-only.

- [ ] **Step 4: Update active-state syncing**

Sync `tabHome` when `State.view === "dashboard"`, sync `tabAgents` for the Agents group/agent views, and update each `nav-icon` button's `aria-current` and active class from `State.view`.

The Home action must no longer be marked active for `overview`, and the Agents action must no longer depend on the house icon.

- [ ] **Step 5: Build and inspect the generated DOM contract**

Run:

```text
npx tsc --noEmit
```

Expected: PASS. Inspect the source diff to confirm no existing destination handler was removed.

---

### Task 3: Style the icon navigation grid

**Files:**
- Modify: `windows/src/style.css` in the header navigation section
- Modify: `windows/src/app-materials.css` only if shared hover/focus materials need a small override

**Interfaces:**
- Consumes: `.nav-icon`, `.tab`, `.tab.on`, `.header-nav-popover`, and existing reduced-motion/focus styles.
- Produces: compact, Apple-like icon grid with visible hover, pressed, active, and keyboard-focus states.

- [ ] **Step 1: Replace text-pill layout rules with a compact grid**

Style the navigation destination container as a wrapping grid/flex row and make each destination a square icon button:

```css
.sub-view-pills {
  display: grid;
  grid-template-columns: repeat(4, 30px);
  gap: 6px;
}

.nav-icon {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 10px;
  color: var(--dim-2);
  background: transparent;
}

.nav-icon:hover,
.nav-icon.active {
  color: var(--ink);
  background: var(--surface-3, #20252d);
}
```

Use the existing material variables and motion curve; do not introduce a second visual system.

- [ ] **Step 2: Preserve accessibility states**

Ensure `.nav-icon:focus-visible` gets the existing accent outline and that `title` remains available for mouse users. Do not hide labels from assistive technology; labels stay in `aria-label`.

- [ ] **Step 3: Add reduced-motion coverage**

Include `.nav-icon` in the existing reduced-motion transition override if the selector does not already cover it.

- [ ] **Step 4: Check for layout overflow**

Run:

```text
npm run build
```

Expected: PASS. Confirm the popover remains within the 720px island and no header action is pushed off the right edge.

---

### Task 4: Run behavior checks and review the final diff

**Files:**
- Test: existing `windows/scripts/test-agent-carousel.mjs`
- Verify: `windows/src/views/views.ts`, `windows/src/views/icons.ts`, `windows/src/style.css`, `windows/src/app-materials.css`

- [ ] **Step 1: Run the existing carousel regression test**

Run from `windows/`:

```text
npm run test:carousel
```

Expected: PASS.

- [ ] **Step 2: Run the production build**

Run:

```text
npm run build
```

Expected: TypeScript and Vite production build both PASS.

- [ ] **Step 3: Check formatting and unintended changes**

Run from the repository root:

```text
git diff --check
git status --short
git diff -- windows/src/views/views.ts windows/src/views/icons.ts windows/src/style.css windows/src/app-materials.css docs/superpowers/specs/2026-10-14-icon-first-navigation-design.md docs/superpowers/plans/2026-10-14-icon-first-navigation.md
```

Expected: no whitespace errors; unrelated pre-existing modifications remain untouched.

- [ ] **Step 4: Manual smoke checklist**

With the island open, verify:

1. Home icon opens the dashboard.
2. Agents icon opens the agent overview.
3. Ask and Drop still open their existing views.
4. Navigate shows icon-only destinations for Media, Control Center, Bluetooth,
   Stats, Pomodoro, Stopwatch, and Weather.
5. Hovering/focusing an icon exposes the full destination name.
6. Existing dashboard widgets still open the same destinations.
7. Pressed, active, and reduced-motion states remain readable.

Do not claim the visual smoke check passed unless the running app or preview was actually opened.

---

## Plan self-review

- Spec coverage: Home, Agents, icon-only destinations, accessibility labels,
  duplicate-route cleanup, dashboard shortcuts, and build/test verification are
  covered by Tasks 1–4.
- Placeholder scan: no incomplete or unspecified implementation step remains.
- Type consistency: `NavIcon`, `NavItem`, `NAV_ITEMS`, `IslandViewName`, and
  `ICONS` are defined before their consumers; all view IDs match the existing
  union and registry.
- Scope check: only the shared header/navigation presentation changes; page
  behavior and native integrations remain out of scope.
