// Battery conditions for Mochi (Task 5). Spec §4.2 asked for a new Rust power
// command; the Rust side already polls and publishes `battery-status`, which
// lands on `State.battery` (level is 0–100) — so the conditions ride that one
// proven source instead of the unverified WebView2 Battery Status API.

import { State } from "../core/state";
import { react, setCondition } from "./reactions";

/**
 * Subscribes to State and drives Mochi's battery conditions: applied once on
 * subscribe, then re-evaluated on every notify. Returns an unsubscribe fn.
 */
export function startPowerWatch(): () => void {
  let full: boolean | null = null; // null until the first real sample — no boot-time flex
  let applying = false;
  const apply = (): void => {
    // setCondition()/react() re-notify, which would re-enter this subscriber.
    if (applying) return;
    applying = true;
    const { level: percent, charging } = State.battery;
    setCondition("battery-drained", percent < 20 && !charging);
    setCondition("battery-charging", charging && percent < 100);
    const isFull = (charging && percent === 100) || percent === 100;
    setCondition("battery-full", isFull);
    // The proud flex: one-shot on each false→true transition, never per event.
    // The first sample only sets the baseline, so a boot-time default of 100 %
    // cannot fire a spurious flex.
    if (isFull && full === false) react("battery-full");
    full = isFull;
    applying = false;
  };

  apply(); // once initially
  return State.subscribe(apply);
}
