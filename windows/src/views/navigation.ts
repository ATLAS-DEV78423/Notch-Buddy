import type { IslandViewName, ViewGroup } from "../core/layout";
import type { ICONS } from "./icons";

export interface NavigationItem {
  view: IslandViewName;
  label: string;
  icon: keyof typeof ICONS;
  group: ViewGroup;
}

export const NAV_ITEMS: readonly NavigationItem[] = [
  { view: "dashboard", label: "Home", icon: "house", group: "home" },
  { view: "overview", label: "Agents", icon: "agent", group: "agents" },
  { view: "media", label: "Media", icon: "music", group: "media" },
  { view: "controlCenter", label: "Control Center", icon: "sliders", group: "system" },
  { view: "bluetooth", label: "Bluetooth", icon: "bluetooth", group: "system" },
  { view: "stats", label: "Stats", icon: "chart", group: "system" },
  { view: "pomodoro", label: "Pomodoro", icon: "timer", group: "tools" },
  { view: "stopwatch", label: "Stopwatch", icon: "stopwatch", group: "tools" },
  { view: "weather", label: "Weather", icon: "cloudSun", group: "tools" },
];

export function navigationIsActive(item: NavigationItem, view: IslandViewName): boolean {
  return item.view === view;
}
