import { h, svg, clear } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import type { IslandViewName, ViewGroup } from "../core/layout";
import type { ViewActions, ViewHost } from "./views";
import { NAV_ITEMS, navigationIsActive } from "./navigation";

const GROUPS: { id: ViewGroup; views: IslandViewName[] }[] = [
  { id: "home", views: ["dashboard"] },
  { id: "agents", views: [
    "overview", "empty", "approval", "question", "error", "finished", "confused",
    "upload", "uploading", "choose", "mail", "prompt", "searching", "result",
    "note", "settings", "greeting",
  ] },
  { id: "media", views: ["media"] },
  { id: "system", views: ["controlCenter", "bluetooth", "stats"] },
  { id: "tools", views: ["pomodoro", "stopwatch", "weather"] },
];

function groupOfView(view: IslandViewName): ViewGroup {
  return GROUPS.find((g) => g.views.includes(view))?.id ?? "agents";
}

export function buildHeader(actions: ViewActions): ViewHost {
  const tabHome = h("button", { class: "tab", "aria-label": "Home", title: "Home", "data-tooltip": "Home", onclick: () => go("dashboard") }, svg(ICONS.house, 13));
  const tabAgents = h("button", { class: "tab", "aria-label": "Agents", title: "Agents", "data-tooltip": "Agents", onclick: () => go("overview") }, svg(ICONS.agent, 13));
  const tabChat = h("button", { class: "tab", "aria-label": "Ask", title: "Ask", "data-tooltip": "Ask", onclick: () => go("prompt") }, svg(ICONS.bubble, 13));
  const tabDrop = h("button", { class: "tab", "aria-label": "Drop", title: "Drop", "data-tooltip": "Drop", onclick: () => go("upload") }, svg(ICONS.plus, 13));

  const gearBtn = h("button", { "aria-label": "Settings", title: "Settings", "data-tooltip": "Settings", onclick: () => go("settings") }, svg(ICONS.gear, 14));
  const soundBtn = h("button", { "aria-label": State.settings.soundEnabled ? "Mute sounds" : "Unmute sounds", "aria-pressed": String(!State.settings.soundEnabled), title: State.settings.soundEnabled ? "Mute sounds" : "Unmute sounds", "data-tooltip": State.settings.soundEnabled ? "Mute sounds" : "Unmute sounds", onclick: () => actions.toggleSound() }, svg(ICONS.speakerOn, 14));

  let nav: HTMLDetailsElement | null = null;
  let previousView = State.view;
  const navSummary = h("summary", {
    class: "header-nav-summary",
    "aria-label": "Navigate",
    title: "Navigate",
    "data-tooltip": "Navigate",
  }, svg(ICONS.navGrid, 14));
  const popover = h("div", { class: "header-nav-popover" });
  function closeNavigation() {
    if (!nav?.open) return;
    const restoreFocus = popover.contains(document.activeElement);
    nav.open = false;
    if (restoreFocus) navSummary.focus();
  }
  function go(v: IslandViewName) {
    closeNavigation();
    actions.blip();
    // setView animates geometry; the expansion action would play another blip.
    if (v === "overview" || v === "dashboard") State.setAgentExpanded(false);
    State.setViewGroup(groupOfView(v));
    actions.setView(v);
  }

  const navButtons = new Map<IslandViewName, HTMLElement>();
  const navGrid = h("nav", { class: "nav-grid", "aria-label": "Pages" });
  for (const item of NAV_ITEMS) {
    const button = h("button", {
      class: "nav-icon-button",
      type: "button",
      "aria-label": item.label,
      title: item.label,
      "data-tooltip": item.label,
      "data-group": item.group,
      onclick: () => go(item.view),
    }, svg(ICONS[item.icon], 16));
    navButtons.set(item.view, button);
    navGrid.append(button);
  }
  popover.append(navGrid);
  nav = h("details", { class: "header-nav" }, navSummary, popover);
  document.addEventListener("keydown", (event) => {
    // Tab traverses the open grid instead of the island's detail-collapse shortcut.
    if (event.key === "Tab" && nav?.open) event.stopPropagation();
    if (event.key === "Escape" && nav?.open) {
      event.preventDefault();
      event.stopPropagation();
      nav.open = false;
      navSummary.focus();
    }
  }, true);
  document.addEventListener("pointerdown", (event) => {
    if (nav?.open && !nav.contains(event.target as Node)) closeNavigation();
  });

  const el = h(
    "div",
    { id: "header" },
    h("div", { class: "tabs" }, tabHome, tabAgents, tabChat, tabDrop),
    nav,
    h("div", { class: "header-actions" }, gearBtn, soundBtn),
  );

  return {
    el,
    sync() {
      const v = State.view;
      if (v !== previousView) closeNavigation();
      previousView = v;
      const group = groupOfView(v);
      const agentActive = group === "agents" && v !== "prompt" && v !== "upload" && v !== "uploading" && v !== "settings";
      const setCurrent = (button: HTMLElement, active: boolean) => {
        button.classList.toggle("on", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      };
      setCurrent(tabHome, v === "dashboard");
      setCurrent(tabAgents, agentActive);
      setCurrent(tabChat, v === "prompt");
      setCurrent(tabDrop, v === "upload" || v === "uploading");
      setCurrent(gearBtn, v === "settings");
      for (const item of NAV_ITEMS) {
        const button = navButtons.get(item.view)!;
        const active = navigationIsActive(item, v);
        button.classList.toggle("active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
      clear(gearBtn);
      gearBtn.append(svg(v === "settings" ? ICONS.gearFill : ICONS.gear, 14));
      clear(soundBtn);
      soundBtn.append(svg(State.settings.soundEnabled ? ICONS.speakerOn : ICONS.speakerOff, 14));
      soundBtn.title = State.settings.soundEnabled ? "Mute sounds" : "Unmute sounds";
      soundBtn.setAttribute("data-tooltip", soundBtn.title);
      soundBtn.setAttribute("aria-label", State.settings.soundEnabled ? "Mute sounds" : "Unmute sounds");
      soundBtn.setAttribute("aria-pressed", String(!State.settings.soundEnabled));
      el.style.opacity = v === "confused" ? "0" : "1";
    },
  };
}
