// The Custom style's layout: which widgets are shown, where, and how big.
// A position is the widget's top-left corner as a fraction of the frame (so a layout is the same at any resolution),
// and a scale multiplies the widget's natural size. Pure data and arithmetic, no drawing.

const K = 1.222;      // the tosu overlays are drawn 1.222x (or 1.7x) larger than their browser-source size

/**
 * The widgets and the looks each can take. A style has a natural size in px on a 1080 p high frame (`w` x `h`), the
 * overlay it recreates (`credit`) and `tosu: true` when the real tosu overlay is rendered instead of canvas drawing.
 * `at` is where a widget sits by default (px on a 1920x1080 frame). The first style of each widget is its default.
 */
export const WIDGETS = {
  title: {
    label: 'Map details', at: [6, 8], on: true,
    styles: [
      { id: 'cpol', label: 'CPOL', credit: 'ArtistTitleDifficulty, author unknown', w: 800 * K, h: 90 * K, tosu: true },
      { id: 'kerli1', label: 'Kerli 1', credit: 'Kerli 1 by Dartandr', w: 794, h: 124 },
      { id: 'recomfortaa', label: 'reComfortaa', credit: 'reComfortaa by Dartandr', w: 900, h: 130 },
      { id: 'mapdisplay', label: 'Map Display', credit: 'Map Display, author unknown', w: 1040, h: 86 },
    ],
  },
  pp: {
    label: 'pp counter', at: [6, 8 + 90 * K + 4], on: true,
    styles: [
      { id: 'ingame3', label: 'InGame3', credit: 'InGame3 by Dartandr', w: 190 * K, h: 100 * K, tosu: true },
      { id: 'ingame1', label: 'InGame1', credit: 'InGame1 by Dartandr', w: 260, h: 150 },
      { id: 'triangles', label: 'Triangles', credit: 'Triangles Lazer PP by uwuclxdy', w: 200, h: 90 },
      { id: 'vertigo', label: 'Vertigo', credit: 'vertigo by zeronic', w: 170, h: 220 },
    ],
  },
  acc: {
    label: 'Accuracy and rank', at: [1920 - 8 - 340 * 1.7, 0], on: true,
    styles: [{ id: 'cpol', label: 'CPOL', credit: 'AccuracyPP, author unknown', w: 340 * 1.7, h: 80 * 1.7, tosu: true }],
  },
  combo: {
    label: 'Combo', at: [4, 1080 - 12 - 44 * 1.7], on: true,
    styles: [{ id: 'cpol', label: 'CPOL', credit: 'Combo, author unknown', w: 420 * 1.7, h: 44 * 1.7, tosu: true }],
  },
  keys: {
    label: 'Key presses', at: [1920 - 56 - 8, 540 - (4 * 56 + 3 * 10) / 2 + 36], on: true,
    styles: [
      { id: 'boxes', label: 'Boxes', credit: 'this site', w: 56, h: 3 * 56 + 2 * 10 },
      { id: 'bars', label: 'Bars', credit: 'KeyOverlay by HosizoraN', w: 190, h: 190 },
    ],
  },
  hits: {
    label: 'Hit counts', at: [1920 - 420 - 90, 1080 - 130], on: false,
    styles: [
      { id: 'plain', label: 'Plain', credit: 'this site', w: 420, h: 84 },
      { id: 'hitcounts', label: 'HitCounts', credit: 'HitCounts, author unknown', w: 350, h: 44 },
      { id: 'kerli2', label: 'Kerli 2', credit: 'Kerli 2 by Dartandr', w: 360, h: 240 },
      { id: 'classic', label: 'Classic', credit: 'classic by Dartandr', w: 330, h: 44 },
    ],
  },
  progress: {
    label: 'Progress bar', at: [(1920 - 720) / 2, 14], on: false,
    styles: [{ id: 'bar', label: 'Bar', credit: 'this site', w: 720, h: 28 }],
  },
};

/** Draw and hit-test order, back to front. */
export const ORDER = ['title', 'pp', 'acc', 'combo', 'hits', 'progress', 'keys'];

export const styleInfo = (id, styleId) => WIDGETS[id].styles.find((x) => x.id === styleId) ?? WIDGETS[id].styles[0];

export const MIN_SCALE = 0.4, MAX_SCALE = 3;

export function defaultLayout() {
  const out = {};
  for (const id of ORDER) {
    const d = WIDGETS[id];
    out[id] = { on: d.on, x: d.at[0] / 1920, y: d.at[1] / 1080, s: 1, style: d.styles[0].id };
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
      style: WIDGETS[id].styles.some((x) => x.id === r.style) ? r.style : base[id].style,
    };
  }
  return base;
}

/** [x, y, w, h] of a widget in a W x H frame. */
export function rectOf(id, cfg, W, H) {
  const u = H / 1080, c = cfg[id], st = styleInfo(id, c.style);
  return [c.x * W, c.y * H, st.w * c.s * u, st.h * c.s * u];
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
