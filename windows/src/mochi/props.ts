// Mochi props — small ink-coloured accessories drawn in body-local coordinates
// (origin = body centre, unsquashed). Parts vocabulary: ink fill + white glint,
// same as the badge and eye parts in engine.ts.

const INK = "rgb(26,20,18)";

/** Headphones: band arc hugging the body + one cup per side. */
export function drawHeadphones(
  x: CanvasRenderingContext2D, R: number, rx: number, ry: number,
) {
  x.save();
  x.strokeStyle = INK;
  x.lineWidth = R * 0.13;
  x.lineCap = "round";
  x.beginPath();
  x.ellipse(0, 0, rx * 1.03, ry * 1.05, 0, Math.PI * 1.02, Math.PI * 1.98);
  x.stroke();

  for (const sd of [-1, 1]) {
    const a = sd < 0 ? Math.PI * 1.02 : Math.PI * 1.98;
    const cx = rx * 1.03 * Math.cos(a);
    const cy = ry * 1.05 * Math.sin(a);
    x.fillStyle = INK;
    x.beginPath();
    x.ellipse(cx, cy, R * 0.12, R * 0.19, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "rgba(255,255,255,0.16)";
    x.beginPath();
    x.ellipse(cx, cy - R * 0.05, R * 0.05, R * 0.07, 0, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}
