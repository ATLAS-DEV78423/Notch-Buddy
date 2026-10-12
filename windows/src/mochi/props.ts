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

/** Folder: ink-outline body + lighter front flap + glint, with two grip
 *  blobs at the lower edges — resting hands are hidden, so the folder
 *  carries its own "held" read (spec D). */
export function drawFolder(
  x: CanvasRenderingContext2D, R: number, _rx: number, _ry: number,
) {
  x.save();
  const w = R * 1.1, h = R * 0.82;
  const fy = R * 0.28;                       // sits low, in front of the body
  x.fillStyle = INK;
  x.beginPath();
  x.roundRect(-w / 2, fy - h / 2, w * 0.42, h * 0.18, R * 0.06);   // back tab
  x.fill();
  x.beginPath();
  x.roundRect(-w / 2, fy - h * 0.36, w, h, R * 0.1);               // body
  x.fill();
  x.fillStyle = "rgba(255,255,255,0.14)";
  x.beginPath();
  x.roundRect(-w / 2 + R * 0.05, fy - h * 0.1, w - R * 0.1, h * 0.42, R * 0.08); // front flap
  x.fill();
  x.fillStyle = "rgba(255,255,255,0.8)";
  x.beginPath();
  x.ellipse(-w * 0.3, fy - h * 0.2, R * 0.07, R * 0.05, -0.5, 0, Math.PI * 2);   // glint
  x.fill();
  x.fillStyle = INK;
  for (const sd of [-1, 1]) {                                      // grips
    x.beginPath();
    x.ellipse(sd * (w / 2 + R * 0.04), fy + h * 0.18, R * 0.14, R * 0.11, 0, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}
