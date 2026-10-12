// Semi-implicit Euler spring — the shell's geometry driver (spec §4).
// Pure math: no DOM, no clock; the caller passes frame dt in milliseconds.

export interface SpringCfg {
  k: number;
  c: number;
  m?: number;
  restDelta?: number;
}

export interface Spring {
  set(target: number, immediate?: boolean): void;
  /** Returns the new value; no-op when done. */
  step(dtMs: number): number;
  readonly done: boolean;
  readonly value: number;
  readonly target: number;
  readonly v: number;
}

class Engine implements Spring {
  value: number;
  target: number;
  v = 0;
  done = true;
  private readonly k: number;
  private readonly c: number;
  private readonly m: number;
  private readonly rd: number;

  constructor(from: number, cfg: SpringCfg) {
    this.value = from;
    this.target = from;
    this.k = cfg.k;
    this.c = cfg.c;
    this.m = cfg.m ?? 1;
    this.rd = cfg.restDelta ?? 0.01;
  }

  set(target: number, immediate = false): void {
    this.target = target;
    this.done = immediate; // an immediate snap is already at rest
    if (immediate) {
      this.value = target;
      this.v = 0;
    }
  }

  step(dtMs: number): number {
    if (this.done) return this.value;
    const dtSec = Math.min(dtMs, 32) / 1000;
    const acc = (-this.k * (this.value - this.target) - this.c * this.v) / this.m;
    this.v += acc * dtSec;
    this.value += this.v * dtSec;
    if (Math.abs(this.v) < this.rd && Math.abs(this.value - this.target) < this.rd) {
      this.value = this.target;
      this.v = 0;
      this.done = true;
    }
    return this.value;
  }
}

export function spring(from: number, cfg: SpringCfg): Spring {
  return new Engine(from, cfg);
}
