// The Custom style's layout: which widgets are shown, where, and how big.
// A position is the widget's top-left corner as a fraction of the frame (so a layout is the same at any resolution),
// and a scale multiplies the widget's natural size. Pure data and arithmetic, no drawing.

/** Where to find each overlay author. Only links I have confirmed; add `twitter` / `discord` URLs here when known. */
export const AUTHORS = {
  Dartandr: { github: 'https://github.com/Dartandr' },
  uwuclxdy: { github: 'https://github.com/uwuclxdy' },
  zeronic: { github: 'https://github.com/just-zeronic' },
  HosizoraN: { github: 'https://github.com/HosizoraN' },
  ppy: { github: 'https://github.com/ppy/osu', twitter: 'https://x.com/ppy', discord: 'https://discord.gg/ppy' },
  peppy: { github: 'https://github.com/peppy', twitter: 'https://x.com/ppy' },
};

const K = 1.222;
const V = 1080 / 768;   // osu!'s HUD is laid out for a 768 unit high screen      // the tosu overlays are drawn 1.222x (or 1.7x) larger than their browser-source size

/**
 * The widgets and the looks each can take. A style has a natural size in px on a 1080 p high frame (`w` x `h`), the
 * overlay it recreates (`credit`) and `tosu: true` when the real tosu overlay is rendered instead of canvas drawing.
 * `at` is where a widget sits by default (px on a 1920x1080 frame). The first style of each widget is its default.
 */
/** Fractions [left, top, right, bottom] of a look's natural box that hold nothing visible (tosu overlays are drawn
 *  into a larger browser-source box). A widget's position, size and outline all describe the visible part. */
export const padOf = (st) => st.pad ?? [0, 0, 0, 0];

export const WIDGETS = {
  title: {
    label: 'Map details', at: [6, 8], on: true,
    styles: [
      { id: 'cpol', label: 'ArtistTitleDifficulty', credit: 'ArtistTitleDifficulty by unknown', w: 800 * K, h: 90 * K, tosu: true, pad: [0, 0, 0.27, 0] },
      { id: 'kerli1', label: 'Kerli 1', credit: 'Kerli 1 by Dartandr', author: 'Dartandr', w: 794, h: 124 },
      { id: 'recomfortaa', label: 'reComfortaa', credit: 'reComfortaa by Dartandr', author: 'Dartandr', w: 900, h: 130 },
      { id: 'mapdisplay', label: 'Map Display', credit: 'Map Display by unknown', w: 1040, h: 86 },
    ],
  },
  pp: {
    label: 'pp counter', at: [6, 8 + 90 * K + 4], on: true,
    styles: [
      { id: 'ingame3', label: 'InGame3', credit: 'InGame3 by Dartandr', author: 'Dartandr', w: 190 * K, h: 100 * K, tosu: true, pad: [0, 0, 0.26, 0.4] },
      { id: 'ingame1', label: 'InGame1', credit: 'InGame1 by Dartandr', author: 'Dartandr', w: 260, h: 150 },
      { id: 'triangles', label: 'Triangles Lazer PP', credit: 'Triangles Lazer PP by uwuclxdy', author: 'uwuclxdy', w: 200, h: 90 },
      { id: 'vertigo', label: 'vertigo', credit: 'vertigo by zeronic', author: 'zeronic', w: 170, h: 220 },
      { id: 'argon', label: 'osu!lazer (Argon)', credit: 'osu!lazer (Argon skin) by ppy and contributors', author: 'ppy', system: 'argon', w: 75 * V, h: 31 * V },
    ],
  },
  acc: {
    label: 'Accuracy and rank', at: [1920 - 8 - 340 * 1.7, 0], on: true,
    styles: [
      { id: 'cpol', label: 'AccuracyPP', credit: 'AccuracyPP by unknown', w: 340 * 1.7, h: 80 * 1.7, tosu: true, pad: [0.5, 0.12, 0, 0.5] },
      { id: 'argon', label: 'osu!lazer (Argon)', credit: 'osu!lazer (Argon skin) by ppy and contributors', author: 'ppy', system: 'argon', w: 138 * V, h: 40 * V },
      { id: 'stable', label: 'osu!stable', credit: 'osu!stable default HUD by peppy', author: 'peppy', system: 'stable', w: 176, h: 35 },
    ],
  },
  combo: {
    label: 'Combo', at: [4, 1080 - 12 - 44 * 1.7], on: true,
    styles: [
      { id: 'cpol', label: 'Combo', credit: 'Combo by unknown', w: 420 * 1.7, h: 44 * 1.7, tosu: true, pad: [0, 0.3, 0.4, 0.1] },
      { id: 'argon', label: 'osu!lazer (Argon)', credit: 'osu!lazer (Argon skin) by ppy and contributors', author: 'ppy', system: 'argon', w: 186 * V, h: 56 * V },
      { id: 'stable', label: 'osu!stable', credit: 'osu!stable default HUD by peppy', author: 'peppy', system: 'stable', w: 320, h: 84 },
    ],
  },
  score: {
    label: 'Score', at: [1920 - 8 - 356, 150], on: false,
    styles: [
      { id: 'argon', label: 'osu!lazer (Argon)', credit: 'osu!lazer (Argon skin) by ppy and contributors', author: 'ppy', system: 'argon', w: 180 * V, h: 23 * V },
      { id: 'stable', label: 'osu!stable', credit: 'osu!stable default HUD by peppy', author: 'peppy', system: 'stable', w: 336, h: 61 },
    ],
  },
  health: {
    label: 'Health bar', at: [20, 260], on: false,
    styles: [
      { id: 'argon', label: 'osu!lazer (Argon)', credit: 'osu!lazer (Argon skin) by ppy and contributors', author: 'ppy', system: 'argon', w: 351 * V, h: 50 * V },
      { id: 'stable', label: 'osu!stable', credit: 'osu!stable default HUD by peppy', author: 'peppy', system: 'stable', w: 494, h: 30 },
    ],
  },
  keys: {
    label: 'Key presses', at: [1920 - 56 - 8, 540 - (4 * 56 + 3 * 10) / 2 + 36], on: true,
    styles: [
      { id: 'boxes', label: 'Boxes (this site)', credit: 'this site', w: 56, h: 3 * 56 + 2 * 10 },
      { id: 'bars', label: 'KeyOverlay', credit: 'KeyOverlay by HosizoraN', author: 'HosizoraN', w: 182, h: 186 },
      { id: 'argon', label: 'osu!lazer (Argon)', credit: 'osu!lazer (Argon skin) by ppy and contributors', author: 'ppy', system: 'argon', w: 146 * V, h: 56 * V },
      { id: 'stable', label: 'osu!stable', credit: 'osu!stable default HUD by peppy', author: 'peppy', system: 'stable', w: 61, h: 266 },
    ],
  },
  hits: {
    label: 'Hit counts', at: [1920 - 420 - 90, 1080 - 130], on: false,
    styles: [
      { id: 'plain', label: 'Plain (this site)', credit: 'this site', w: 420, h: 84 },
      { id: 'hitcounts', label: 'HitCounts', credit: 'HitCounts by unknown', w: 350, h: 44 },
      { id: 'kerli2', label: 'Kerli 2', credit: 'Kerli 2 by Dartandr', author: 'Dartandr', w: 360, h: 190 },
      { id: 'classic', label: 'classic', credit: 'classic by Dartandr', author: 'Dartandr', w: 330, h: 44 },
    ],
  },
  progress: {
    label: 'Progress bar', at: [(1920 - 720) / 2, 14], on: false,
    styles: [
      { id: 'bar', label: 'Bar (this site)', credit: 'this site', w: 720, h: 28 },
      { id: 'argon', label: 'osu!lazer (Argon)', credit: 'osu!lazer (Argon skin) by ppy and contributors', author: 'ppy', system: 'argon', w: 700 * V, h: 38 * V },
      { id: 'stable', label: 'osu!stable (pie)', credit: 'osu!stable default HUD by peppy', author: 'peppy', system: 'stable', w: 30, h: 30 },
    ],
  },
};

/** Draw and hit-test order, back to front. */
export const ORDER = ['title', 'pp', 'acc', 'combo', 'score', 'health', 'hits', 'progress', 'keys'];

export const styleInfo = (id, styleId) => WIDGETS[id].styles.find((x) => x.id === styleId) ?? WIDGETS[id].styles[0];

export const MIN_SCALE = 0.4, MAX_SCALE = 3;

export function defaultLayout() {
  const out = {};
  for (const id of ORDER) {
    const d = WIDGETS[id];
    const st = d.styles[0], [pl, pt] = padOf(st);
    out[id] = { on: d.on, x: (d.at[0] + pl * st.w) / 1920, y: (d.at[1] + pt * st.h) / 1080, s: 1, style: st.id };
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

/** [x, y, w, h] of a widget's visible part in a W x H frame (its outline and hit box). */
export function rectOf(id, cfg, W, H) {
  const u = H / 1080, c = cfg[id], st = styleInfo(id, c.style), [l, t, r, b] = padOf(st), k = c.s * u;
  return [c.x * W, c.y * H, st.w * (1 - l - r) * k, st.h * (1 - t - b) * k];
}

/** [x, y, w, h] of the whole box a look is drawn into: the visible part plus its empty margins. */
export function fullRectOf(id, cfg, W, H) {
  const u = H / 1080, c = cfg[id], st = styleInfo(id, c.style), [l, t] = padOf(st), k = c.s * u;
  return [c.x * W - l * st.w * k, c.y * H - t * st.h * k, st.w * k, st.h * k];
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
