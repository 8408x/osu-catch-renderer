// Key overlay for the replay. An osu!catch replay stores only the catcher's x position and whether dash is held, so
// left / right are inferred: a direction counts as "held" while the catcher moves that way between two frames.
// The counts are therefore an estimate of the real key presses (each new run in a direction counts as one press).

const MOVE_EPS = 0.01;            // field units; below this the catcher is standing still
const GAP_MS = 40;                // a pause shorter than this between two moves in the same direction is still one press

/** Merge consecutive intervals of one key, giving the press intervals sorted by time. */
function pack(intervals) {
  const out = [];
  for (const [a, b] of intervals) {
    const last = out[out.length - 1];
    if (last && a - last[1] <= GAP_MS) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * @param {{t:number, x:number, dash:boolean}[]} frames replay frames, sorted by time
 * @returns {{left:number[][], right:number[][], dash:number[][]}} press intervals [start, end] in ms
 */
export function buildKeys(frames) {
  const left = [], right = [], dash = [];
  let dashStart = null;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (f.dash && dashStart === null) dashStart = f.t;
    if (!f.dash && dashStart !== null) { dash.push([dashStart, f.t]); dashStart = null; }
    if (i === 0) continue;
    const p = frames[i - 1];
    const dx = f.x - p.x;
    if (dx < -MOVE_EPS) left.push([p.t, f.t]);
    else if (dx > MOVE_EPS) right.push([p.t, f.t]);
  }
  if (dashStart !== null && frames.length) dash.push([dashStart, frames[frames.length - 1].t]);
  return { left: pack(left), right: pack(right), dash: pack(dash) };
}

/** State of one key at time t: is it down, and how many presses started so far. */
function keyAt(intervals, t) {
  let lo = 0, hi = intervals.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (intervals[mid][0] <= t) lo = mid + 1; else hi = mid; }
  const count = lo;                                   // presses that began at or before t
  const down = count > 0 && t < intervals[count - 1][1];
  return { down, count };
}

/** @returns {{left:{down:boolean,count:number}, right:{down:boolean,count:number}, dash:{down:boolean,count:number}}} */
export function keysAt(keys, t) {
  return { left: keyAt(keys.left, t), right: keyAt(keys.right, t), dash: keyAt(keys.dash, t) };
}
