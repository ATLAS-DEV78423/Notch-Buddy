# Icon-first island navigation

**Date:** 2026-10-14

## Goal

Make the Windows island navigation compact and visually coherent by using icons
as the primary affordance for every navigable destination. Preserve the current
views, state, actions, animations, and keyboard behavior.

## Approved scope

- Keep the existing compact top-bar actions for Ask, Drop, Settings, and Sound.
- Make Home open the dashboard rather than the agent overview.
- Add a distinct Agents top-bar action for the agent carousel.
- Replace text-heavy navigation destinations with icon-only controls.
- Cover existing destinations: Home, Agents, Media, Control Center, Bluetooth,
  Stats, Pomodoro, Stopwatch, Weather, Ask, Drop, and Settings.
- Keep full names in `aria-label`, `title`, and focus-visible tooltips so icon-only
  controls remain discoverable and accessible.
- Keep dashboard widgets as working shortcuts to their existing views.

## Out of scope

- Rewriting the underlying Media, Bluetooth, Control Center, or Stats behavior.
- Changing native bridge commands or Rust pollers.
- Adding dependencies or replacing the vanilla TypeScript DOM architecture.
- Redesigning the separate Settings window in this change.

## Navigation model

The header has direct icon actions for Home, Agents, Ask, Drop, Settings, and
Sound. The Navigate control opens a grouped icon grid:

- Home: Dashboard
- Agents: Agent overview/session surface
- Media: Media player
- System: Control Center, Bluetooth, Stats
- Tools: Pomodoro, Stopwatch, Weather

Each destination has one canonical icon button in the navigation surface. The
dashboard may still route to the same destinations through its existing widgets.

## Implementation details

- Extend the existing `ICONS` collection with only the missing glyphs needed by
  the navigation grid.
- Reuse `buildHeader`, `GROUPS`, `groupOfView`, `viewLabel`, and the existing
  `State.setView` flow instead of introducing a router or new state.
- Use semantic buttons with `aria-label`, `title`, and `aria-current`/active
  styling as appropriate.
- Keep the current group selection and close-on-navigation behavior.
- Use CSS grid/flex for the icon grid and existing motion tokens/materials for
  hover, press, focus, and reduced-motion states.

## Acceptance criteria

1. Clicking the Home icon opens the dashboard.
2. Clicking the Agents icon opens the agent overview without requiring a text
   label.
3. Navigate shows icon-only destinations for every existing Home, Media,
   System, and Tools page.
4. Hover/focus exposes each destination's full name and keyboard focus remains
   visible.
5. Existing dashboard widget routes and page actions still work.
6. TypeScript/build checks pass, and the existing carousel test remains green.

## Verification

Run from `windows/`:

```text
npm run test:carousel
npm run build
```

Also inspect the final diff and run `git diff --check`.
