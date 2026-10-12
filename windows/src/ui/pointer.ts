// Gesture maths shared by the React Bits ports (SwipeRow, SwipeToast,
// SquishSwitch). Each reference component re-declared these privately; this is
// the single copy, with no framework attached.

/** Pointer velocity in px/s, from a short [time, position] history. */
export function velocityOf(hist: [number, number][]): number {
  if (hist.length < 2) return 0;
  const [t0, y0] = hist[0];
  const [t1, y1] = hist[hist.length - 1];
  // A finger (or cursor) that paused before release has no velocity left.
  return performance.now() - t1 > 100 ? 0 : ((y1 - y0) / Math.max(1, t1 - t0)) * 1000;
}

/** How much of an over-drag a surface keeps past its travel. */
export const rubber = (over: number, dim: number, c = 0.55) =>
  (over * dim * c) / (dim + c * Math.abs(over));

/** iOS `project`: where a release would coast to under deceleration. */
export const project = (v: number) => ((v / 1000) * 0.998) / (1 - 0.998);
