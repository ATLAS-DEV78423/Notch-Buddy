// Declared motion tokens (spec §4): one home for every spring config the
// shell geometry uses — no magic numbers scattered in components.
import type { SpringCfg } from "./spring";

export const SHELL_WIDTH: SpringCfg = { k: 400, c: 31 };
export const SHELL_HEIGHT: SpringCfg = { k: 450, c: 29 };
export const SHELL_Y: SpringCfg = { k: 550, c: 45, m: 0.8, restDelta: 0.001 };
export const SHELL_RADIUS: SpringCfg = { k: 1000, c: 40 };
export const DEFAULT: SpringCfg = { k: 500, c: 30 };
