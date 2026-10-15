// SVG paths standing in for the SF Symbols used by the macOS island.
// Drawn on a 24×24 grid so they read at the same optical size.

export const ICONS = {
  // house.fill
  house: "M12 3.2 2.8 10.6V21h6.6v-5.4h5.2V21h6.6V10.6L12 3.2z",
  // bubble.left.fill
  bubble: "M12 3.6c-5 0-9 3.3-9 7.4 0 2.3 1.3 4.4 3.3 5.7-.2 1.2-.8 2.4-1.7 3.4 1.9-.2 3.6-.9 4.9-1.9 .8.2 1.6.3 2.5.3 5 0 9-3.3 9-7.5s-4-7.4-9-7.4z",
  // plus
  plus: "M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z",
  // gearshape
  gear: "M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm0 1.8a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2zM10.9 2h2.2l.35 2.1c.6.17 1.16.4 1.67.71l1.9-1 1.55 1.55-1 1.9c.3.5.54 1.07.7 1.67l2.13.35v2.2l-2.12.35c-.17.6-.4 1.16-.71 1.67l1 1.9-1.55 1.55-1.9-1c-.5.3-1.07.54-1.67.7L13.1 22h-2.2l-.35-2.12c-.6-.17-1.16-.4-1.67-.71l-1.9 1L5.43 18.6l1-1.9c-.3-.5-.54-1.07-.7-1.67L3.6 14.7v-2.2l2.12-.35c.17-.6.4-1.16.71-1.67l-1-1.9 1.55-1.55 1.9 1c.5-.3 1.07-.54 1.67-.7L10.9 2z",
  gearFill: "M10.9 2h2.2l.35 2.1c.6.17 1.16.4 1.67.71l1.9-1 1.55 1.55-1 1.9c.3.5.54 1.07.7 1.67l2.13.35v2.2l-2.12.35c-.17.6-.4 1.16-.71 1.67l1 1.9-1.55 1.55-1.9-1c-.5.3-1.07.54-1.67.7L13.1 22h-2.2l-.35-2.12c-.6-.17-1.16-.4-1.67-.71l-1.9 1L5.43 18.6l1-1.9c-.3-.5-.54-1.07-.7-1.67L3.6 14.7v-2.2l2.12-.35c.17-.6.4-1.16.71-1.67l-1-1.9 1.55-1.55 1.9 1c.5-.3 1.07-.54 1.67-.7L10.9 2zM12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6z",
  // speaker.wave.2
  speakerOn: "M11 4.5 6.5 8.2H3.4v7.6h3.1L11 19.5v-15zm3.2 3a5.3 5.3 0 0 1 0 9 .9.9 0 0 0 .9 1.55 7.1 7.1 0 0 0 0-12.1.9.9 0 0 0-.9 1.55zm2.6-3.1a8.9 8.9 0 0 1 0 15.2.9.9 0 0 0 .92 1.55 10.7 10.7 0 0 0 0-18.3.9.9 0 0 0-.92 1.55z",
  // speaker.slash
  speakerOff: "M11 4.5 6.5 8.2H3.4v7.6h3.1L11 19.5v-15zm3.6 4.1 1.27-1.27 2.33 2.33 2.33-2.33 1.27 1.27L19.47 11l2.33 2.33-1.27 1.27-2.33-2.33-2.33 2.33-1.27-1.27L16.93 11 14.6 8.6z",
  // arrow.up.right
  arrowUpRight: "M8.5 7h8.5v8.5h-2V10.4l-7.1 7.1-1.4-1.4 7.1-7.1H8.5V7z",
  // chevron.right
  chevronRight: "M9 5.5 15.5 12 9 18.5",
  chevronLeft: "M15 5.5 8.5 12 15 18.5",
  // checkmark
  check: "M5 12.5 9.5 17 19 7.5",
  // arrow.up (send)
  arrowUp: "M12 4.5 5.5 11l1.5 1.5 4-4V19.5h2V8.5l4 4L18.5 11 12 4.5z",
  // exclamationmark
  bang: "M11 4h2v10h-2V4zm0 12.2h2v2.2h-2v-2.2z",
  // xmark
  xmark: "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5z",
  // timer
  timer: "M12 4.2a7.8 7.8 0 1 0 0 15.6 7.8 7.8 0 0 0 0-15.6zm0 1.9a5.9 5.9 0 1 1 0 11.8 5.9 5.9 0 0 1 0-11.8zm-.95 2.3v4.2l3.3 2 .95-1.55-2.4-1.45V8.4h-1.85zM9.2 2h5.6v1.7H9.2V2z",
  // ellipsis
  ellipsis: "M6 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm6 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2zm6 0a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z",
  // star.fill
  star: "M12 3.2l2.6 5.55 5.9.82-4.3 4.3 1.05 6.13L12 17.1l-5.25 2.9L7.8 13.87 3.5 9.57l5.9-.82L12 3.2z",
  // sparkles (ThoughtLine's mark)
  sparkle: "M12 2.8l2.05 6.15L20.2 11l-6.15 2.05L12 19.2l-2.05-6.15L3.8 11l6.15-2.05L12 2.8z",
  // square.stack.fill
  stack: "M5 8h14v11.5H5V8zm1.8-3h10.4v1.6H6.8V5zm1.6-2.6h7.2V4H8.4V2.4z",
  // doc.text
  doc: "M6.5 2.6h7l4 4v14.8h-11V2.6zm6.6 1.6v3.3h3.3l-3.3-3.3zM8.6 11h6.8v1.5H8.6V11zm0 3.4h6.8v1.5H8.6v-1.5z",
  // ── Media transport (Apple-style: solid, optically weighted) ─────────────
  // backward.fill — a leading bar + left-pointing triangle.
  mediaPrev: "M6.2 5.4h2.4v13.2H6.2V5.4zm12 0v13.2L9.4 12l8.8-6.6z",
  // forward.fill
  mediaNext: "M17.8 5.4h-2.4v13.2h2.4V5.4zm-12 0v13.2L14.6 12 5.8 5.4z",
  // play.fill
  mediaPlay: "M7.6 4.6 19.2 12 7.6 19.4V4.6z",
  // pause.fill
  mediaPause: "M7.4 5.2h3.4v13.6H7.4V5.2zm5.8 0h3.4v13.6h-3.4V5.2z",
  // speaker.wave.2.fill-ish, for the media volume affordance
  mediaVolume: "M11 4.6 6.6 8.3H3.5v7.4h3.1L11 19.4v-14.8zm3.1 3.1a5.2 5.2 0 0 1 0 8.6.85.85 0 1 0 .86 1.47 6.9 6.9 0 0 0 0-11.54.85.85 0 0 0-.86 1.47zm2.5-3a8.7 8.7 0 0 1 0 14.6.85.85 0 1 0 .9 1.45 10.4 10.4 0 0 0 0-17.5.85.85 0 0 0-.9 1.45z",
  // ── Control centre (SF Symbols stand-ins) ──────────────────────────────────
  // moon.fill — the Do Not Disturb glyph.
  moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
  // sun.max.fill — the Night light glyph (a warm sun with eight rays).
  sunMax:
    "M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM11 2h2v3.1h-2V2zm0 16.9h2V22h-2v-3.1zM2 11h3.1v2H2v-2zm16.9 0H22v2h-3.1v-2zM4.93 3.51l1.42 1.42 2.2-2.2-1.42-1.42-2.2 2.2zm12.72 1.42 1.42-1.42 2.2 2.2-1.42 1.42-2.2-2.2zM19.07 17.65l-1.41-1.42-2.2 2.2 1.41 1.41 2.2-2.19zM6.35 19.07l-1.42-1.41-2.2 2.2 1.42 1.41 2.2-2.2z",
  // person.fill — the agent navigation glyph.
  agent: "M12 3.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM4.2 21a7.8 7.8 0 0 1 15.6 0H4.2z",
  // slider.horizontal.3 — compact filter controls.
  sliders: "M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h18v2H3v-2zM7 3h3v6H7V3zm7 6h3v6h-3V9zm-7 6h3v6H7v-6z",
  // bluetooth — filled Bluetooth mark.
  bluetooth: "M17.71 7.71 12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71L13.41 12l4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z",
  // chart.bar.fill — simple activity bars.
  chart: "M4 19h3V9H4v10zm6 0h4V5h-4v14zm7 0h3v-7h-3v7z",
  // stopwatch.fill — timer navigation glyph.
  stopwatch: "M9 2h6v2.1a8.4 8.4 0 1 1-6 0V2zm2 1.8v1.7h2V3.8h-2zm1 3.4a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8zm-.9 2.1h1.8v3.3l2.2 1.3-.9 1.5-3.1-1.9v-4.2zM18.5 5.1l1.4-1.4 1.4 1.4-1.4 1.4-1.4-1.4z",
  // cloud.sun.fill — weather navigation glyph.
  cloudSun: "M7.2 19.5a4.7 4.7 0 1 1 1.1-9.3 5.8 5.8 0 0 1 10.9 2.3A3.6 3.6 0 1 1 18 19.5H7.2zM6.8 8.8a3.2 3.2 0 1 1 4.8-3.7 4.9 4.9 0 0 0-3.8 3.6l-1 .1zM6.8 2.2h1.6v1.6H6.8V2.2zm-3 1.2 1.1-1.1L6 3.4 4.9 4.5 3.8 3.4zm-1.2 3h1.6V8H2.6V6.4z",
  // square.grid.3x3.fill — navigation grid glyph.
  navGrid: "M3 3h5v5H3V3zm6.5 0h5v5h-5V3zm6.5 0h5v5h-5V3zM3 9.5h5v5H3v-5zm6.5 0h5v5h-5v-5zm6.5 0h5v5h-5v-5zM3 16h5v5H3v-5zm6.5 0h5v5h-5v-5zm6.5 0h5v5h-5v-5z",
  // music.note — media navigation glyph.
  music: "M9 4.5 19 2v12.3a3.8 3.8 0 1 1-2-3.4V6.2l-6 1.5v9.6a3.8 3.8 0 1 1-2-3.4V4.5z",
} as const;
