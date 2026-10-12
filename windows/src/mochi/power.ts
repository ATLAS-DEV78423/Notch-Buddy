// Battery poses use the existing native samples; no new polling loop.
import { State } from "../core/state";
import { react, setCondition } from "./reactions";

export function startPowerWatch(): () => void {
  let full: boolean | null = null;
  let applying = false;
  const apply = () => {
    if (applying) return;
    applying = true;
    try {
      const { level, charging, known } = State.battery;
      const valid = known !== false && Number.isFinite(level) && level >= 0 && level <= 100;
      const exhausted = valid && !charging && level <= 10;
      setCondition("battery-exhausted", exhausted);
      setCondition("battery-drained", valid && !charging && level <= 15 && !exhausted);
      setCondition("battery-charging", valid && charging && level < 100);
      const isFull = valid && level >= 100;
      setCondition("battery-full", isFull);
      if (valid) {
        if (isFull && full === false) react("battery-full");
        full = isFull;
      }
    } finally { applying = false; }
  };
  apply();
  return State.subscribe(apply);
}
