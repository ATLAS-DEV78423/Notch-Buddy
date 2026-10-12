// Icon-only Apple-style battery. Percentages are accessible labels/tooltips,
// never visible text. Windows supplies Battery Saver independently of charge.
import { h, svg } from "../views/dom";

export type BatteryTier = "full" | "healthy" | "low" | "critical" | "charging";
export function batteryTier(level: number, charging: boolean, lowPower = false): BatteryTier {
  if (charging) return "charging";
  if (lowPower) return "low";
  if (level <= 20) return "critical";
  return level >= 100 ? "full" : "healthy";
}
const COLORS: Record<BatteryTier, string> = {
  full: "#F5F6F8", healthy: "#F5F6F8", low: "#FFD60A",
  critical: "#FF453A", charging: "#32D74B",
};
export interface BatteryIconOptions { width?: number }
export interface BatteryIcon {
  el: HTMLElement;
  set(level: number, charging: boolean, lowPower?: boolean): void;
}
export function createBatteryIcon({ width = 26 }: BatteryIconOptions = {}): BatteryIcon {
  const height = Math.round(width * 0.5);
  const nubWidth = Math.max(2, Math.round(width * 0.075));
  const track = h("div", { class: "bat-track" });
  track.style.cssText = `width:${width - nubWidth}px;height:${height}px;border-radius:${height * 0.3}px;padding:1.5px`;
  const fill = h("div", { class: "bat-fill" });
  fill.style.borderRadius = `${Math.max(1, height * 0.3 - 2)}px`;
  track.append(fill);
  const nub = h("div", { class: "bat-nub" });
  nub.style.cssText = `width:${nubWidth}px;height:${height * 0.4}px;border-radius:0 ${nubWidth}px ${nubWidth}px 0`;
  const bolt = svg("M13.5 2 5 13h6l-1 9 9-12h-6l.5-8z", Math.max(10, height - 2));
  bolt.classList.add("bat-bolt");
  const el = h("div", { class: "bat-glyph", role: "img" }, track, nub, bolt);
  let lastTier: BatteryTier | null = null;
  let lastLevel = -1;
  return {
    el,
    set(level, charging, lowPower = false) {
      if (!Number.isFinite(level) || level < 0) {
        el.dataset.tier = "unknown";
        fill.style.transform = "scaleX(0)";
        bolt.style.opacity = "0";
        el.title = "Battery status unavailable";
        el.setAttribute("aria-label", el.title);
        lastLevel = -1;
        lastTier = null;
        return;
      }
      const percent = Math.min(100, Math.max(0, level));
      const tier = batteryTier(percent, charging, lowPower);
      if (percent !== lastLevel) {
        fill.style.transform = `scaleX(${percent / 100})`;
        lastLevel = percent;
      }
      if (tier !== lastTier) {
        fill.style.backgroundColor = COLORS[tier];
        el.dataset.tier = tier;
        if (lastTier !== null) {
          el.classList.remove("bat-pulse");
          void el.offsetWidth;
          el.classList.add("bat-pulse");
        }
        lastTier = tier;
      }
      bolt.style.opacity = charging ? "1" : "0";
      el.title = `${charging ? "Charging" : lowPower ? "Battery Saver" : "Battery"} — ${Math.round(percent)}%`;
      el.setAttribute("aria-label", el.title);
    },
  };
}

export interface BatteryWithLabelOptions { width?: number; showPercent?: boolean }
/** The battery as it ships: icon-only — the tier colour and the fill carry the
 *  state, the number lives in the tooltip. `showPercent: true` additionally
 *  renders a live "NN%" label beside the glyph for dense lists that need it. */
export function batteryWithLabel(
  level: number,
  charging: boolean,
  { width = 22, showPercent = false }: BatteryWithLabelOptions = {},
): BatteryIcon {
  const icon = createBatteryIcon({ width });
  // Seed once so the glyph (and the label below) are right before the caller's
  // first sync() — the compact strip builds at 100 % and patches a tick later.
  icon.set(level, charging);
  if (!showPercent) return icon;
  const label = h("span", { class: "bat-label" });
  label.textContent = Number.isFinite(level) && level >= 0 ? `${Math.round(level)}%` : "";
  const el = h("span", { class: "bat-with-label" }, icon.el, label);
  const set = icon.set.bind(icon);
  return {
    el,
    set(l, c, lowPower) {
      set(l, c, lowPower);
      label.textContent = Number.isFinite(l) && l >= 0 ? `${Math.round(l)}%` : "";
    },
  };
}
