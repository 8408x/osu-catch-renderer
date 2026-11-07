// The Custom style's layout: which widgets are shown, where, and how big.
// A position is the widget's top-left corner as a fraction of the frame (so a layout is the same at any resolution),
// and a scale multiplies the widget's natural size. Pure data and arithmetic, no drawing.

/**
 * Natural size of each widget in px on a 1080 p high frame (`w` x `h`, times `k` for the tosu overlays, which are
 * drawn larger than their browser-source size), and where it sits by default (px on a 1920x1080 frame).
 */
export const WIDGETS = {
  title: { label: 'Map details', w: 800, h: 90, k: 1.222, at: [6, 8], on: true },
  pp: { label: 'pp counter', w: 190, h: 100, k: 1.222, at: [6, 8 + 90 * 1.222 + 4], on: true },
  acc: { label: 'Accuracy and rank', w: 340, h: 80, k: 1.7, at: [1920 - 8 - 340 * 1.7, 0], on: true },
  combo: { label: 'Combo', w: 420, h: 44, k: 1.7, at: [4, 1080 - 12 - 44 * 1.7], on: true },
  keys: { label: 'Key presses', w: 56, h: 3 * 56 + 2 * 10, k: 1, at: [1920 - 56 - 8, 540 - (4 * 56 + 3 * 10) / 2 + 36], on: true },
  hits: { label: 'Hit counts', w: 420, h: 84, k: 1, at: [1920 - 420 - 90, 1080 - 130], on: false },
  progress: { label: 'Progress bar', w: 720, h: 28, k: 1, at: [(1920 - 720) / 2, 14], on: false },
};

/** Draw and hit-test order, back to front. */
export const ORDER = ['title', 'pp', 'acc', 'combo', 'hits', 'progress', 'keys'];

export const MIN_SCALE = 0.4, MAX_SCALE = 3;

export function defaultLayout() {
  const out = {};
  for (const id of ORDER) {
    const d = WIDGETS[id];
    out[id] = { on: d.on, x: d.at[0] / 1920, y: d.at[1] / 1080, s: 1 };
  }
  return out;
}

const num = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** Anything read back from storage becomes a complete, in-range layout. */
export function normalizeLayout(raw) {
  const base = defaultLayout();
  if (!raw || typeof raw !== 'object') return base;
  for (const id of ORDER) {
    const r = raw[id];
    if (!r || typeof r !== 'object') continue;
    base[id] = {
      on: typeof r.on === 'boolean' ? r.on : base[id].on,
      x: num(r.x, -0.5, 1.5, base[id].x),
      y: num(r.y, -0.5, 1.5, base[id].y),
      s: num(r.s, MIN_SCALE, MAX_SCALE, 1),
    };
  }
  return base;
}

/** [x, y, w, h] of a widget in a W x H frame. */
export function rectOf(id, cfg, W, H) {
  const d = WIDGETS[id], u = H / 1080, c = cfg[id];
  return [c.x * W, c.y * H, d.w * d.k * c.s * u, d.h * d.k * c.s * u];
}

/** The topmost shown widget under the point (px, py), or null. */
export function hitTest(cfg, W, H, px, py) {
  for (let i = ORDER.length - 1; i >= 0; i--) {
    const id = ORDER[i];
    if (!cfg[id].on) continue;
    const [x, y, w, h] = rectOf(id, cfg, W, H);
    if (px >= x && px <= x + w && py >= y && py <= y + h) return id;
  }
  return null;
}

/** Keep a dragged widget mostly on screen: at least a quarter of it stays inside the frame. */
export function clampPosition(id, cfg, x, y, W, H) {
  const [, , w, h] = rectOf(id, cfg, W, H);
  const minX = -0.75 * w / W, maxX = 1 - 0.25 * w / W;
  const minY = -0.75 * h / H, maxY = 1 - 0.25 * h / H;
  return [Math.min(maxX, Math.max(minX, x)), Math.min(maxY, Math.max(minY, y))];
}

const SNAP = 0.008;
/** Snap a dragged widget's edges and centre to the frame's edges and centre lines (and report which). */
export function snapPosition(id, cfg, x, y, W, H) {
  const [, , w, h] = rectOf(id, cfg, W, H);
  const fw = w / W, fh = h / H, guides = { x: null, y: null };
  const tryAxis = (pos, size, key) => {
    for (const [target, offset] of [[0, 0], [0.5, size / 2], [1, size]]) {
      if (Math.abs(pos + offset - target) < SNAP) { guides[key] = target; return target - offset; }
    }
    return pos;
  };
  return [tryAxis(x, fw, 'x'), tryAxis(y, fh, 'y'), guides];
}
