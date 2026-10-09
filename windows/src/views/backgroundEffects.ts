// Background effects — nine Canvas 2D animations drawn behind the island
// content, clipped to the island shape by #island-clip. Visual direction ported
// from Reference Only/Dynamic_island/src/components/background/BackgroundEffects.jsx.
//
// The selection and the accent colour live in localStorage (`coucou.bgEffect`,
// `coucou.accentColor` — written by the settings window) and are re-read live
// through `storage` events. The animation clock only advances inside
// drawBackground, so a stopped frame loop or a paused music session freezes the
// effects for free.

import { State } from "../core/state";

export type BackgroundEffect =
  | "off"
  | "visualizer"
  | "waves"
  | "synthwave"
  | "fireflies"
  | "holographic"
  | "topographic"
  | "albumGlow"
  | "ambient"
  | "rgb";

const BG_KEY = "coucou.bgEffect";
const ACCENT_KEY = "coucou.accentColor";
const DEFAULT_ACCENT = "#3b9eff";

const EFFECT_IDS: readonly string[] = [
  "off", "visualizer", "waves", "synthwave", "fireflies",
  "holographic", "topographic", "albumGlow", "ambient", "rgb",
];

function readEffect(): BackgroundEffect {
  try {
    const v = localStorage.getItem(BG_KEY);
    if (v != null && EFFECT_IDS.includes(v)) return v as BackgroundEffect;
  } catch {
    /* no storage, no saved effect */
  }
  return "off";
}

function readAccent(): string {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    if (v != null && /^#[0-9a-f]{6}$/i.test(v)) return v;
  } catch {
    /* no storage, no saved accent */
  }
  return DEFAULT_ACCENT;
}

let effect = readEffect();
let accent = readAccent();

function applyAccent(): void {
  document.documentElement.style.setProperty("--accent", accent);
}

applyAccent();

// The settings window writes the same keys from its own webview; `storage` only
// fires in the *other* windows, which is exactly the cross-window change we want.
window.addEventListener("storage", (e) => {
  if (e.key === BG_KEY) {
    effect = readEffect();
  } else if (e.key === ACCENT_KEY) {
    accent = readAccent();
    applyAccent();
    accentPalette = null;
  } else {
    return;
  }
  State.notify();
});

/** The island frame loop reads the selection through this. */
export function backgroundEffect(): BackgroundEffect {
  return effect;
}

// ── Colours ──────────────────────────────────────────────────────────────────

type RGB = [number, number, number];

function readHexInto(hex: string, out: RGB): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    out[0] = 59;
    out[1] = 158;
    out[2] = 255;
    return out;
  }
  const v = parseInt(m[1], 16);
  out[0] = (v >> 16) & 255;
  out[1] = (v >> 8) & 255;
  out[2] = v & 255;
  return out;
}

const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

/** Port of the reference's hue rotation — builds companion colours from one accent. */
function shiftHue(hex: string, deg: number): string {
  const [r0, g0, b0] = readHexInto(hex, [0, 0, 0]).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r0, g0, b0);
  const min = Math.min(r0, g0, b0);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r0 ? (g0 - b0) / d + (g0 < b0 ? 6 : 0) : max === g0 ? (b0 - r0) / d + 2 : (r0 - g0) / d + 4;
    h *= 60;
  }
  h = (h + deg + 360) % 360;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  const to = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}

/** [accent, +40°, −30°] — recomputed only when the accent setting changes. */
let accentPalette: string[] | null = null;
function accentColors(): string[] {
  if (accentPalette == null) accentPalette = [accent, shiftHue(accent, 40), shiftHue(accent, -30)];
  return accentPalette;
}

/** Album-art palette, sampled once per track change onto a 16×16 offscreen canvas. */
const album = { art: "", pending: "", colors: [] as string[] };

function loadAlbumColors(art: string) {
  if (album.pending === art) return;
  album.pending = art;
  album.art = art;
  album.colors = [];
  const img = new Image();
  img.onload = () => {
    if (album.pending !== art) return; // superseded by a newer track
    try {
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 16;
      const g = c.getContext("2d", { willReadFrequently: true });
      if (!g) return;
      g.drawImage(img, 0, 0, 16, 16);
      const d = g.getImageData(0, 0, 16, 16).data;
      const cnt = new Uint32Array(64);
      const sr = new Uint32Array(64);
      const sg = new Uint32Array(64);
      const sb = new Uint32Array(64);
      for (let i = 0; i < d.length; i += 4) {
        const r = d[i];
        const gg = d[i + 1];
        const b = d[i + 2];
        const l = (r * 299 + gg * 587 + b * 114) / 1000;
        if (l < 30 || l > 244) continue; // skip near-black / near-white
        const bin = ((r >> 6) * 4 + (gg >> 6)) * 4 + (b >> 6);
        cnt[bin]++;
        sr[bin] += r;
        sg[bin] += gg;
        sb[bin] += b;
      }
      const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
        16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
        32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
        48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63];
      order.sort((a, b) => cnt[b] - cnt[a]);
      const picked: string[] = [];
      for (const bin of order) {
        if (picked.length === 3) break;
        if (cnt[bin] === 0) continue;
        const n = cnt[bin];
        picked.push(
          `#${[sr[bin] / n, sg[bin] / n, sb[bin] / n]
            .map((v) => Math.round(v).toString(16).padStart(2, "0"))
            .join("")}`,
        );
      }
      const pad = accentColors();
      while (picked.length < 3) picked.push(pad[picked.length]);
      album.colors = picked;
      State.notify(); // apply once the palette lands
    } catch {
      /* unreadable art: keep the accent fallback */
    }
  };
  img.src = art;
}

/**
 * The three colours every effect paints with: album-art derived while art is
 * available, the accent and its companions otherwise. Returns a cached array —
 * no allocation per frame.
 */
export function backgroundColors(): string[] {
  const art = State.media?.albumArt;
  if (art) {
    if (album.art !== art) loadAlbumColors(art);
    if (album.colors.length === 3) return album.colors;
  }
  return accentColors();
}

// ── Draw dispatch ────────────────────────────────────────────────────────────

let clock = 0;
let lastNow = 0;
let lastKey = "";

const palBuf: RGB[] = [
  [0, 0, 0],
  [0, 0, 0],
  [0, 0, 0],
];
function palette(colors: string[]): RGB[] {
  for (let i = 0; i < 3; i++) readHexInto(colors[i] ?? colors[0] ?? DEFAULT_ACCENT, palBuf[i]);
  return palBuf;
}

/**
 * Paints one frame of the selected effect in logical pixels. The clock only
 * advances while music is playing (a live session that is paused holds the
 * frame; no media session at all runs free), and never advances while the
 * island's frame loop is stopped — hidden island, no cost.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  fx: BackgroundEffect,
  width: number,
  height: number,
  colors: string[],
) {
  if (fx === "off" || width < 4 || height < 4) return;
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000));
  lastNow = now;
  const key = `${fx}|${width}x${height}|${colors[0] ?? ""}`;
  const paused = State.media != null && !State.media.playing;
  if (paused && key === lastKey) return; // music paused: hold the last frame
  if (!paused) clock += dt;
  lastKey = key;
  const t = clock;

  ctx.clearRect(0, 0, width, height);
  const pal = palette(colors);
  switch (fx) {
    case "visualizer":
      drawVisualizer(ctx, width, height, pal, t);
      break;
    case "waves":
      drawWaves(ctx, width, height, pal, t);
      break;
    case "synthwave":
      drawSynthwave(ctx, width, height, t);
      break;
    case "fireflies":
      drawFireflies(ctx, width, height, t);
      break;
    case "holographic":
      drawHolographic(ctx, width, height, t);
      break;
    case "topographic":
      drawTopographic(ctx, width, height, pal, t);
      break;
    case "albumGlow":
      drawAlbumGlow(ctx, width, height, pal, t);
      break;
    case "ambient":
      drawAmbient(ctx, width, height, pal, t);
      break;
    case "rgb":
      drawRgb(ctx, width, height, t);
      break;
  }
}

// ── Shared bits ──────────────────────────────────────────────────────────────

/** Deterministic pseudo-random so layouts stay stable between runs. */
const rand = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

const TAU = Math.PI * 2;

/** Iridescent wheel used by the holographic and rgb effects. */
function conicRainbow(ctx: CanvasRenderingContext2D, angle: number, cx: number, cy: number) {
  const g = ctx.createConicGradient(angle, cx, cy);
  const stops = ["#ff9ad5", "#9be7ff", "#b8ffb0", "#fff3a1", "#c8a6ff", "#ff9ad5"];
  for (let i = 0; i < stops.length; i++) g.addColorStop(i / (stops.length - 1), stops[i]);
  return g;
}

// ── Visualizer: slim spectrum along the bottom ───────────────────────────────

// No raw audio stream exists in this app, so the bars are a tasteful
// time-based approximation of a spectrum (per-bar envelope + two oscillators).
const VIZ_N = 32;
const VIZ_BARS = Array.from({ length: VIZ_N }, (_, i) => {
  const x = i / (VIZ_N - 1);
  const env =
    (0.5 + 0.5 * Math.sin(Math.PI * Math.min(1, x * 1.1 + 0.06))) * (0.65 + rand(i) * 0.4);
  return {
    env: Math.min(1, env),
    sp: 3.2 + rand(i + 40) * 5.5,
    ph: rand(i + 80) * TAU,
    sp2: 7 + rand(i + 120) * 9,
    ph2: rand(i + 160) * TAU,
  };
});

function drawVisualizer(ctx: CanvasRenderingContext2D, w: number, h: number, pal: RGB[], t: number) {
  const base = h * 0.94;
  const maxH = h * 0.4;
  const gap = 4;
  const inner = w * 0.9;
  const bw = (inner - gap * (VIZ_N - 1)) / VIZ_N;
  const x0 = (w - inner) / 2;

  const glow = ctx.createRadialGradient(w / 2, h, 0, w / 2, h, w * 0.45);
  glow.addColorStop(0, rgba(pal[0], 0.26));
  glow.addColorStop(1, rgba(pal[0], 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const grad = ctx.createLinearGradient(0, base, 0, base - maxH);
  grad.addColorStop(0, rgba(pal[0], 0.95));
  grad.addColorStop(0.6, rgba(pal[1], 0.8));
  grad.addColorStop(1, rgba(pal[1], 0));
  ctx.fillStyle = grad;
  for (let i = 0; i < VIZ_N; i++) {
    const b = VIZ_BARS[i];
    const slow = 0.5 + 0.5 * Math.sin(t * b.sp + b.ph);
    const fast = 0.5 + 0.5 * Math.sin(t * b.sp2 + b.ph2);
    const bh = Math.max(3, Math.min(maxH, b.env * (0.28 + 0.52 * slow + 0.22 * fast) * maxH));
    ctx.beginPath();
    ctx.roundRect(x0 + i * (bw + gap), base - bh, bw, bh, bw / 2);
    ctx.fill();
  }
}

// ── Waves: three layered tides ───────────────────────────────────────────────

const TIDES = [
  { y: 0.38, amp: 0.05, humps: 2.6, sp: 0.33, col: 2, a: 0.35 },
  { y: 0.52, amp: 0.045, humps: 2.1, sp: -0.48, col: 0, a: 0.45 },
  { y: 0.66, amp: 0.04, humps: 1.7, sp: 0.79, col: 1, a: 0.55 },
] as const;

function drawWaves(ctx: CanvasRenderingContext2D, w: number, h: number, pal: RGB[], t: number) {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "rgba(0,0,0,0)");
  bg.addColorStop(1, rgba(pal[0], 0.12));
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const step = 8;
  for (const tide of TIDES) {
    const yBase = h * tide.y;
    const amp = h * tide.amp;
    const k = (TAU * tide.humps) / w;
    const phase = t * tide.sp * TAU * 0.28;
    ctx.fillStyle = rgba(pal[tide.col], tide.a);
    ctx.beginPath();
    const n = Math.ceil(w / step);
    for (let i = 0; i <= n; i++) {
      const x = Math.min(w, i * step);
      const y = yBase + Math.sin(x * k + phase) * amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.fill();
  }
}

// ── Synthwave: retro sun and neon grid ──────────────────────────────────────

function drawSynthwave(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const hz = h * 0.54;
  const sky = ctx.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, "#0b0620");
  sky.addColorStop(0.62, "#2a0b3d");
  sky.addColorStop(1, "#5b1250");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hz);
  ctx.fillStyle = "#0b0620";
  ctx.fillRect(0, hz, w, h - hz);

  const glow = ctx.createRadialGradient(w / 2, hz, 0, w / 2, hz, w * 0.42);
  glow.addColorStop(0, "rgba(255,64,180,0.5)");
  glow.addColorStop(1, "rgba(255,64,180,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, hz - h * 0.3, w, h * 0.3);

  const d = Math.min(w * 0.34, 150, h * 0.52);
  const r = d / 2;
  const cx = w / 2;
  const cy = hz - r;
  const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.8);
  halo.addColorStop(0, "rgba(255,90,150,0.4)");
  halo.addColorStop(1, "rgba(255,90,150,0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, hz);

  const sun = ctx.createLinearGradient(0, cy - r, 0, cy + r);
  sun.addColorStop(0, "#ffe45e");
  sun.addColorStop(0.45, "#ff8a3d");
  sun.addColorStop(1, "#ff2d95");
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = sun;
  ctx.fillRect(cx - r, cy - r, d, d);
  // Cut-out stripes: repaint each gap with the sky, which is a pure vertical
  // gradient, so the sun looks banded exactly like the reference mask.
  const gaps: Array<[number, number]> = [
    [0.5, 0.55],
    [0.64, 0.69],
    [0.77, 0.83],
    [0.89, 0.96],
  ];
  ctx.fillStyle = sky;
  for (const [a, b] of gaps) ctx.fillRect(cx - r - 1, cy - r + a * d, d + 2, (b - a) * d);
  ctx.restore();

  // Perspective grid
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = "rgba(255,60,200,0.75)";
  ctx.beginPath();
  for (let i = -10; i <= 10; i++) {
    ctx.moveTo(cx, hz);
    ctx.lineTo(cx + i * 72, h);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(80,220,255,0.7)";
  ctx.beginPath();
  const rows = 9;
  for (let j = 0; j < rows; j++) {
    const p = (((j + t * 0.6) % rows) + rows) % rows / rows;
    const y = hz + p * p * (h - hz);
    if (y <= hz + 0.5) continue;
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  const fade = ctx.createLinearGradient(0, hz, 0, hz + (h - hz) * 0.55);
  fade.addColorStop(0, "rgba(11,6,32,0.98)");
  fade.addColorStop(1, "rgba(11,6,32,0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, hz, w, h - hz);
}

// ── Fireflies: drifting sparks of light ─────────────────────────────────────

const FLIES = Array.from({ length: 22 }, (_, i) => ({
  fx: rand(i),
  fy: rand(i + 7),
  s: 2.5 + rand(i + 13) * 3,
  dx: (rand(i + 21) - 0.5) * 0.16,
  dy: (rand(i + 29) - 0.5) * 0.2,
  sp: 7 + rand(i + 37) * 9,
  ph: rand(i + 51) * TAU,
  tw: 1.6 + rand(i + 43) * 2.6,
  ph2: rand(i + 60) * TAU,
  warm: rand(i + 3) > 0.5,
}));
const FLY_WARM = "rgb(255,214,107)";
const FLY_COOL = "rgb(231,255,138)";

function drawFireflies(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const base = ctx.createRadialGradient(w / 2, h * 1.05, 0, w / 2, h * 1.05, w * 0.6);
  base.addColorStop(0, "rgba(40,70,30,0.4)");
  base.addColorStop(1, "rgba(40,70,30,0)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  for (const f of FLIES) {
    const x = (f.fx + f.dx * Math.sin((TAU / f.sp) * t + f.ph)) * w;
    const y = (f.fy + f.dy * Math.sin((TAU / (f.sp * 1.4)) * t + f.ph * 1.7)) * h;
    const a = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin((TAU / f.tw) * t + f.ph2));
    const col = f.warm ? FLY_WARM : FLY_COOL;
    const rr = f.s * 4;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, rr);
    glow.addColorStop(0, f.warm ? "rgba(255,214,107,0.55)" : "rgba(231,255,138,0.55)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = a;
    ctx.fillStyle = glow;
    ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, f.s / 1.7), 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ── Holographic: iridescent foil sheen ──────────────────────────────────────

function drawHolographic(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w / 2;
  const cy = h / 2;

  ctx.globalAlpha = 0.62;
  ctx.fillStyle = conicRainbow(ctx, t * 0.12, cx, cy);
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  // Fine diagonal weave
  const L = Math.hypot(w, h);
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(2.18);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let x = -L; x <= L; x += 7) {
    ctx.moveTo(x, -L);
    ctx.lineTo(x, L);
  }
  ctx.stroke();

  // Sweeping sheen band
  const bx = ((t * 0.13) % 1.6) * w - 0.3 * w - cx;
  const bw = w * 0.35;
  const sheen = ctx.createLinearGradient(bx - bw, 0, bx + bw, 0);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0.3)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.rotate(-0.5);
  ctx.fillStyle = sheen;
  ctx.fillRect(-L, -L, L * 2, L * 2);
  ctx.restore();

  const dark = ctx.createLinearGradient(0, 0, 0, h);
  dark.addColorStop(0, "rgba(0,0,0,0.3)");
  dark.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, w, h);
}

// ── Topographic: slow contour lines ─────────────────────────────────────────

function topoSet(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  cx: number,
  cy: number,
  spacing: number,
  col: RGB,
  alpha: number,
  wob: number,
  t: number,
) {
  const maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + spacing * 2;
  ctx.strokeStyle = rgba(col, alpha);
  ctx.lineWidth = 1;
  for (let r = spacing * 0.7; r < maxR; r += spacing) {
    ctx.beginPath();
    const N = 36;
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * TAU;
      const rr = Math.max(
        1,
        r + wob * (6 * Math.sin(3 * th + r * 0.07 + t * 0.5) + 4 * Math.sin(5 * th - r * 0.05 - t * 0.3)),
      );
      const x = cx + rr * Math.cos(th);
      const y = cy + rr * Math.sin(th);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
}

function drawTopographic(ctx: CanvasRenderingContext2D, w: number, h: number, pal: RGB[], t: number) {
  const s = Math.max(0.4, Math.min(1.5, h / 160));
  topoSet(
    ctx, w, h,
    w * 0.32 + 8 * s * Math.sin(t * 0.13),
    h * 0.42 + 6 * s * Math.sin(t * 0.09 + 1),
    11 * s, pal[0], 0.55, s, t,
  );
  topoSet(
    ctx, w, h,
    w * 0.76 + 7 * s * Math.sin(t * 0.11 + 3),
    h * 0.7 + 5 * s * Math.sin(t * 0.07 + 2),
    15 * s, pal[1], 0.35, s * 0.8, t,
  );
  const vig = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
}

// ── Album glow: pulsing centre light in the track's colours ─────────────────

function drawAlbumGlow(ctx: CanvasRenderingContext2D, w: number, h: number, pal: RGB[], t: number) {
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.7);
  const cx = w / 2;
  const cy = h * 0.58;
  const r = Math.max(w, h) * (0.55 + 0.08 * pulse);
  const main = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  main.addColorStop(0, rgba(pal[0], 0.5 + 0.18 * pulse));
  main.addColorStop(0.55, rgba(pal[0], 0.16));
  main.addColorStop(1, rgba(pal[0], 0));
  ctx.fillStyle = main;
  ctx.fillRect(0, 0, w, h);

  const sat = (col: RGB, x: number, y: number, rr: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, rgba(col, a));
    g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  };
  sat(pal[1], w * (0.22 + 0.06 * Math.sin(t * 0.4)), h * (0.8 + 0.1 * Math.sin(t * 0.3 + 2)), Math.min(w, h) * 0.6, 0.3);
  sat(pal[2], w * (0.78 + 0.05 * Math.sin(t * 0.33 + 4)), h * (0.2 + 0.08 * Math.sin(t * 0.45)), Math.min(w, h) * 0.5, 0.25);

  const shade = ctx.createLinearGradient(0, 0, 0, h * 0.45);
  shade.addColorStop(0, "rgba(0,0,0,0.35)");
  shade.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h * 0.45);
}

// ── Ambient: drifting mesh blobs in the track's colours ─────────────────────

const BLOBS = [
  { fx: 0.1, fy: 0.1, ax: 0.12, ay: 0.1, sp: 0.45, ph: 0, rf: 0.5, col: 0, a: 0.55 },
  { fx: 0.9, fy: 0.5, ax: 0.1, ay: 0.12, sp: 0.33, ph: 2.1, rf: 0.45, col: 1, a: 0.5 },
  { fx: 0.5, fy: 1.0, ax: 0.14, ay: 0.08, sp: 0.27, ph: 4.0, rf: 0.4, col: 2, a: 0.45 },
] as const;

function drawAmbient(ctx: CanvasRenderingContext2D, w: number, h: number, pal: RGB[], t: number) {
  for (const b of BLOBS) {
    const x = w * (b.fx + b.ax * Math.sin(t * b.sp + b.ph));
    const y = h * (b.fy + b.ay * Math.sin(t * (b.sp * 0.8) + b.ph * 1.3));
    const rr = w * b.rf;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, rgba(pal[b.col], b.a));
    g.addColorStop(0.65, rgba(pal[b.col], 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
}

// ── RGB: neon border chase over a rainbow wash ──────────────────────────────

const RAINBOW = ["#ff3b3b", "#ffd23b", "#3bff6e", "#3bd9ff", "#3b6bff", "#c23bff", "#ff3b6e", "#ff3b3b"];

function rainbowConic(ctx: CanvasRenderingContext2D, angle: number, cx: number, cy: number) {
  const g = ctx.createConicGradient(angle, cx, cy);
  for (let i = 0; i < RAINBOW.length; i++) g.addColorStop(i / (RAINBOW.length - 1), RAINBOW[i]);
  return g;
}

function drawRgb(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  const cx = w / 2;
  const cy = h / 2;

  ctx.globalAlpha = 0.13;
  ctx.fillStyle = rainbowConic(ctx, t * 0.35, cx, cy);
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;

  // Frame follows the island's own corners: square on top, rounded at the bottom.
  const i0 = 3;
  const R = Math.max(1, Math.min((h > 60 ? 22 : 14) - i0, h / 2 - i0 - 1));
  ctx.beginPath();
  ctx.moveTo(i0, i0);
  ctx.lineTo(w - i0, i0);
  ctx.lineTo(w - i0, h - i0 - R);
  ctx.quadraticCurveTo(w - i0, h - i0, w - i0 - R, h - i0);
  ctx.lineTo(i0 + R, h - i0);
  ctx.quadraticCurveTo(i0, h - i0, i0, h - i0 - R);
  ctx.closePath();
  ctx.strokeStyle = rainbowConic(ctx, -t * 0.9, cx, cy);
  ctx.lineWidth = 6;
  ctx.globalAlpha = 0.22;
  ctx.stroke();
  ctx.lineWidth = 2.5;
  ctx.globalAlpha = 0.95;
  ctx.stroke();
  ctx.globalAlpha = 1;
}
