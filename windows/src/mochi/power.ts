// Battery conditions for Mochi (Task 5). Spec §4.2 asked for a new Rust power
// command; controller-approved deviation: the JS Battery Status API that
// WebView2/Chromium already ships. Zero Rust, zero new crates. Where the API is
// missing the module is a no-op and battery reactions simply never fire.

import { react, setCondition } from "./reactions";

/** The Battery Status API is absent from lib.dom — declare the slice we use. */
interface Battery extends EventTarget {
  readonly level: number;
  readonly charging: boolean;
}

type BatteryNavigator = Navigator & { getBattery?: () => Promise<Battery> };

/**
 * Watches the system battery and drives Mochi's battery conditions. Returns a
 * stop fn removing the listeners. No-op where getBattery is unavailable.
 */
export function startPowerWatch(): () => void {
  const nav = navigator as BatteryNavigator;
  const getBattery = nav.getBattery;
  if (typeof getBattery !== "function") return () => {};

  let full = false;
  const apply = (b: Battery): void => {
    const percent = Math.round(b.level * 100);
    setCondition("battery-drained", percent < 20 && !b.charging);
    setCondition("battery-charging", b.charging && percent < 100);
    const isFull = (b.charging && percent === 100) || percent === 100;
    setCondition("battery-full", isFull);
    // The proud flex: one-shot on each false→true transition, never per event.
    if (isFull && !full) react("battery-full");
    full = isFull;
  };

  let stop = (): void => {};
  void getBattery.call(nav).then((b) => {
    apply(b); // once initially, before any change event can land
    const on = () => apply(b);
    b.addEventListener("levelchange", on);
    b.addEventListener("chargingchange", on);
    stop = () => {
      b.removeEventListener("levelchange", on);
      b.removeEventListener("chargingchange", on);
    };
  });
  return () => stop();
}
