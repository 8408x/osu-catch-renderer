// osu! storyboards: the .osb file and the storyboard lines of a difficulty's [Events] section.
// Supported: Sprite and Animation objects, the Background / Fail / Pass / Foreground / Overlay layers, the commands
// F S V R M MX MY C and P (H V A), all 35 easings, and Loop (L) groups. Trigger (T) groups are skipped.
// Times are map time in ms, positions are in the 640x480 storyboard space (widescreen maps use 854x480).

const LAYERS = ['background', 'fail', 'pass', 'foreground', 'overlay'];
const ORIGINS = {
  topleft: [0, 0], centre: [0.5, 0.5], centreleft: [0, 0.5], topright: [1, 0], bottomcentre: [0.5, 1],
  topcentre: [0.5, 0], custom: [0, 0], centreright: [1, 0.5], bottomleft: [0, 1], bottomright: [1, 1],
};
const ORIGIN_BY_INDEX = ['topleft', 'centre', 'centreleft', 'topright', 'bottomcentre', 'topcentre', 'custom', 'centreright', 'bottomleft', 'bottomright'];
const MAX_COMMANDS = 400000;            // a safety net against loops with absurd counts

// ---------- easing (the osu! Easing enum order) ----------
const c1 = 1.70158, c3 = c1 + 1, c4 = (2 * Math.PI) / 3, c5 = (2 * Math.PI) / 4.5;
const bounceOut = (x) => {
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};
const elasticOut = (x) => (x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1);
const inOut = (f) => (x) => (x < 0.5 ? f(2 * x) / 2 : 1 - f(2 * (1 - x)) / 2);
export const EASINGS = [
  (x) => x,                                                                       // 0 None
  (x) => 1 - (1 - x) * (1 - x),                                                   // 1 Out (quad)
  (x) => x * x,                                                                   // 2 In (quad)
  (x) => x * x,                                                                   // 3 InQuad
  (x) => 1 - (1 - x) * (1 - x),                                                   // 4 OutQuad
  inOut((x) => x * x),                                                            // 5 InOutQuad
  (x) => x ** 3,                                                                  // 6 InCubic
  (x) => 1 - (1 - x) ** 3,                                                        // 7 OutCubic
  inOut((x) => x ** 3),                                                           // 8 InOutCubic
  (x) => x ** 4,                                                                  // 9 InQuart
  (x) => 1 - (1 - x) ** 4,                                                        // 10 OutQuart
  inOut((x) => x ** 4),                                                           // 11 InOutQuart
  (x) => x ** 5,                                                                  // 12 InQuint
  (x) => 1 - (1 - x) ** 5,                                                        // 13 OutQuint
  inOut((x) => x ** 5),                                                           // 14 InOutQuint
  (x) => 1 - Math.cos((x * Math.PI) / 2),                                         // 15 InSine
  (x) => Math.sin((x * Math.PI) / 2),                                             // 16 OutSine
  (x) => -(Math.cos(Math.PI * x) - 1) / 2,                                        // 17 InOutSine
  (x) => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),                                // 18 InExpo
  (x) => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),                                // 19 OutExpo
  (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2), // 20 InOutExpo
  (x) => 1 - Math.sqrt(1 - x * x),                                                // 21 InCirc
  (x) => Math.sqrt(1 - (x - 1) ** 2),                                             // 22 OutCirc
  (x) => (x < 0.5 ? (1 - Math.sqrt(1 - (2 * x) ** 2)) / 2 : (Math.sqrt(1 - (-2 * x + 2) ** 2) + 1) / 2), // 23 InOutCirc
  (x) => 1 - elasticOut(1 - x),                                                   // 24 InElastic
  elasticOut,                                                                     // 25 OutElastic
  (x) => Math.pow(2, -10 * x) * Math.sin((0.5 * x - 0.75) * c4) + 1,             // 26 OutElasticHalf
  (x) => Math.pow(2, -10 * x) * Math.sin((0.25 * x - 0.75) * c4) + 1,            // 27 OutElasticQuarter
  (x) => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? -(Math.pow(2, 20 * x - 10) * Math.sin((20 * x - 11.125) * c5)) / 2 : (Math.pow(2, -20 * x + 10) * Math.sin((20 * x - 11.125) * c5)) / 2 + 1), // 28 InOutElastic
  (x) => c3 * x ** 3 - c1 * x * x,                                                // 29 InBack
  (x) => 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2,                               // 30 OutBack
  (x) => (x < 0.5 ? ((2 * x) ** 2 * ((c1 * 1.525 + 1) * 2 * x - c1 * 1.525)) / 2 : ((2 * x - 2) ** 2 * ((c1 * 1.525 + 1) * (x * 2 - 2) + c1 * 1.525) + 2) / 2), // 31 InOutBack
  (x) => 1 - bounceOut(1 - x),                                                    // 32 InBounce
  bounceOut,                                                                      // 33 OutBounce
  (x) => (x < 0.5 ? (1 - bounceOut(1 - 2 * x)) / 2 : (1 + bounceOut(2 * x - 1)) / 2), // 34 InOutBounce
];

// ---------- parsing ----------
const unquote = (s) => s.trim().replace(/^"|"$/g, '');
const num = (s, d = 0) => { const v = parseFloat(s); return Number.isFinite(v) ? v : d; };
const layerIndex = (s) => { const n = parseInt(s, 10); if (Number.isInteger(n) && String(n) === s.trim()) return n; return Math.max(0, LAYERS.indexOf(s.trim().toLowerCase())); };
const originOf = (s) => { const n = parseInt(s, 10); const name = String(n) === s.trim() ? ORIGIN_BY_INDEX[n] : s.trim().toLowerCase(); return ORIGINS[name] ?? ORIGINS.topleft; };

/** Normalised asset path: lower case, forward slashes, no leading ./ */
export const assetKey = (p) => p.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase();

/** Numbers of one command line after `E,easing,start,end,`; returns the start values and the end values. */
function commandValues(type, parts) {
  const per = { F: 1, S: 1, R: 1, MX: 1, MY: 1, M: 2, V: 2, C: 3 }[type];
  if (!per) return null;
  const vals = parts.map((p) => num(p));
  const a = vals.slice(0, per);
  if (a.length < per) return null;
  const b = vals.length >= per * 2 ? vals.slice(per, per * 2) : a;
  return { a, b };
}

function pushCommand(list, type, easing, start, end, parts) {
  if (type === 'P') {
    const flag = (parts[0] || '').trim().toUpperCase();
    if (flag !== 'H' && flag !== 'V' && flag !== 'A') return;
    list.push({ type: 'P', flag, start, end });
    return;
  }
  const v = commandValues(type, parts);
  if (!v) return;
  list.push({ type, easing, start, end, a: v.a, b: v.b });
}

/**
 * @param {string[]} texts the .osb text and/or .osu text (only the [Events] section of each is read)
 * @returns {{sprites: object[], widescreen: boolean}}
 */
export function parseStoryboard(texts, { widescreen = false } = {}) {
  const sprites = [];
  let budget = MAX_COMMANDS;
  for (const text of texts) {
    if (!text) continue;
    let inEvents = false, cur = null, loop = null, skipping = false;
    const closeLoop = () => {
      if (!loop || !cur) { loop = null; return; }
      const { start, count, cmds } = loop;
      if (cmds.length && count > 0) {
        const lo = Math.min(...cmds.map((c) => c.start)), hi = Math.max(...cmds.map((c) => c.end));
        const dur = Math.max(1, hi - lo);
        for (let i = 0; i < count && budget > 0; i++) {
          for (const c of cmds) { cur.cmds.push({ ...c, start: start + i * dur + c.start, end: start + i * dur + c.end }); budget--; }
        }
      }
      loop = null;
    };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/\s+$/, '');
      if (line.startsWith('[')) { closeLoop(); inEvents = line === '[Events]'; cur = null; continue; }
      if (!inEvents || !line.trim() || line.startsWith('//')) continue;
      const depth = line.match(/^[ _]*/)[0].length;
      const parts = line.trim().split(',');
      if (depth === 0) {
        closeLoop(); skipping = false;
        const kind = parts[0];
        if (kind === 'Sprite' && parts.length >= 6) {
          cur = { layer: layerIndex(parts[1]), origin: originOf(parts[2]), file: unquote(parts[3]), x: num(parts[4], 320), y: num(parts[5], 240), anim: null, cmds: [] };
          sprites.push(cur);
        } else if (kind === 'Animation' && parts.length >= 8) {
          cur = { layer: layerIndex(parts[1]), origin: originOf(parts[2]), file: unquote(parts[3]), x: num(parts[4], 320), y: num(parts[5], 240),
            anim: { count: Math.max(1, parseInt(parts[6], 10) || 1), delay: Math.max(1, num(parts[7], 100)), once: /once/i.test(parts[8] || '') }, cmds: [] };
          sprites.push(cur);
        } else { cur = null; }                                   // Background / Video / Break / Sample lines
        continue;
      }
      if (!cur) continue;
      const type = parts[0];
      if (depth === 1) {
        closeLoop(); skipping = false;
        if (type === 'L') { loop = { start: num(parts[1]), count: parseInt(parts[2], 10) || 0, cmds: [] }; continue; }
        if (type === 'T') { skipping = true; continue; }          // trigger groups are not supported
        if (budget-- <= 0) continue;
        const start = num(parts[2]), end = parts[3] === '' || parts[3] === undefined ? start : num(parts[3]);
        pushCommand(cur.cmds, type, parseInt(parts[1], 10) || 0, start, end, parts.slice(4));
      } else if (loop && !skipping) {
        const start = num(parts[2]), end = parts[3] === '' || parts[3] === undefined ? start : num(parts[3]);
        pushCommand(loop.cmds, type, parseInt(parts[1], 10) || 0, start, end, parts.slice(4));
      }
    }
    closeLoop();
  }
  for (const s of sprites) prepare(s);
  return { sprites: sprites.filter((s) => s.lifeEnd > s.lifeStart), widescreen };
}

/** Group a sprite's commands by type, sorted by start time, and find the sprite's lifetime. */
function prepare(s) {
  const by = {};
  let lo = Infinity, hi = -Infinity;
  for (const c of s.cmds) {
    (by[c.type] ??= []).push(c);
    if (c.start < lo) lo = c.start;
    if (c.end > hi) hi = c.end;
  }
  for (const k of Object.keys(by)) by[k].sort((p, q) => p.start - q.start);
  s.by = by;
  s.opaque = /\.jpe?g$/i.test(s.file);                       // JPEG has no alpha: a sprite of one hides what is beneath it
  s.lifeStart = lo;
  s.lifeEnd = hi;
  // a sprite whose last command is a never-ending parameter / fade stays visible to the end of the map
  s.cmds = null;
}

// ---------- evaluation ----------
function valueOf(list, t, def) {
  if (!list) return def;
  // last command that has started
  let lo = 0, hi = list.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].start <= t) lo = mid + 1; else hi = mid; }
  if (lo === 0) return list[0].a;
  const c = list[lo - 1];
  if (t >= c.end || c.end <= c.start) return c.b;
  const k = EASINGS[c.easing]?.((t - c.start) / (c.end - c.start)) ?? (t - c.start) / (c.end - c.start);
  return c.a.map((v, i) => v + (c.b[i] - v) * k);
}

function flagOn(list, flag, t) {
  if (!list) return false;
  for (const c of list) if (c.flag === flag && t >= c.start && (t <= c.end || c.end <= c.start)) return true;
  return false;
}

/** The visible state of a sprite at time t, or null. */
export function spriteState(s, t) {
  if (t < s.lifeStart || t > s.lifeEnd) return null;
  const f = valueOf(s.by.F, t, [1])[0];
  if (f <= 0.001) return null;
  const mv = valueOf(s.by.M, t, null);
  let x = mv ? mv[0] : s.x, y = mv ? mv[1] : s.y;
  const mx = valueOf(s.by.MX, t, null); if (mx) x = mx[0];
  const my = valueOf(s.by.MY, t, null); if (my) y = my[0];
  let sx = 1, sy = 1;
  const sc = valueOf(s.by.S, t, null); if (sc) sx = sy = sc[0];
  const vs = valueOf(s.by.V, t, null); if (vs) { sx = vs[0]; sy = vs[1]; }
  const rot = valueOf(s.by.R, t, [0])[0];
  const col = valueOf(s.by.C, t, [255, 255, 255]);
  const P = s.by.P;
  return {
    alpha: Math.min(1, f), x, y, sx, sy, rot, r: col[0], g: col[1], b: col[2],
    flipH: flagOn(P, 'H', t), flipV: flagOn(P, 'V', t), additive: flagOn(P, 'A', t),
  };
}

// ---------- drawing ----------
const TINT_CACHE_BYTES = 192 * 1024 * 1024;     // pre-tinted copies kept before the least recently used are dropped
const SMALL_TINT_PX = 128 * 128;                // small sprites get 16 tint levels per channel, large ones 256 (see tintKey)

/** Pre-tinted copies of images keyed by (image, quantised colour), least recently used dropped first. */
class TintCache {
  constructor(createCanvas) { this.createCanvas = createCanvas; this.entries = new Map(); this.ids = new WeakMap(); this.nextId = 0; this.bytes = 0; }

  get(bm, r, g, b) {
    let R, G, B;
    if (bm.width * bm.height <= SMALL_TINT_PX) { R = Math.round((r / 255) * 15) * 17; G = Math.round((g / 255) * 15) * 17; B = Math.round((b / 255) * 15) * 17; }   // tiny particles tween through many colours: few levels turn that into cache hits
    else { R = Math.round(r); G = Math.round(g); B = Math.round(b); }
    if (R >= 255 && G >= 255 && B >= 255) return bm;
    let id = this.ids.get(bm);
    if (id === undefined) { id = this.nextId++; this.ids.set(bm, id); }
    const key = `${id}:${R}:${G}:${B}`;
    const hit = this.entries.get(key);
    if (hit) { this.entries.delete(key); this.entries.set(key, hit); return hit.canvas; }
    const w = bm.width, h = bm.height;
    const canvas = this.createCanvas(w, h), g2 = canvas.getContext('2d');
    g2.drawImage(bm, 0, 0);
    g2.globalCompositeOperation = 'multiply';
    g2.fillStyle = `rgb(${R},${G},${B})`;
    g2.fillRect(0, 0, w, h);
    g2.globalCompositeOperation = 'destination-in';
    g2.drawImage(bm, 0, 0);
    const bytes = w * h * 4;
    this.entries.set(key, { canvas, bytes });
    this.bytes += bytes;
    for (const [k, e] of this.entries) {                       // Map keeps insertion order: the first keys are the oldest
      if (this.bytes <= TINT_CACHE_BYTES || this.entries.size <= 1) break;
      this.entries.delete(k);
      this.bytes -= e.bytes;
    }
    return canvas;
  }
}

/**
 * Largest scale each image is drawn at (over every sprite using it), so the decoder can shrink images
 * that never appear at full size. @returns {Map<string, number>} assetKey -> scale (>= 0.01)
 */
function fileScales(data) {
  const out = new Map();
  for (const s of data.sprites) {
    let k = 0;
    for (const c of s.by.S ?? []) k = Math.max(k, Math.abs(c.a[0]), Math.abs(c.b[0]));
    for (const c of s.by.V ?? []) k = Math.max(k, Math.abs(c.a[0]), Math.abs(c.a[1]), Math.abs(c.b[0]), Math.abs(c.b[1]));
    if (!s.by.S && !s.by.V) k = 1;
    k = Math.max(k, 0.01);
    for (const f of spriteFiles(s)) out.set(f, Math.max(out.get(f) ?? 0, k));
  }
  return out;
}

function spriteFiles(s) {
  if (!s.anim) return [assetKey(s.file)];
  const m = s.file.match(/^(.*?)(\.[^.\\/]+)?$/);
  return Array.from({ length: s.anim.count }, (_, i) => assetKey(`${m[1]}${i}${m[2] ?? ''}`));
}

/** Pixel size of a PNG or JPEG from its header, without decoding it; null for anything else. */
export function imageSize(bytes) {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16), height: dv.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const m = bytes[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) };
      i += 2 + dv.getUint16(i + 2);
    }
  }
  return null;
}

export class Storyboard {
  /**
   * @param {{sprites: object[], widescreen: boolean}} data from parseStoryboard
   * @param {Map<string, any>} images assetKey -> decoded image: a bitmap/canvas, or {bitmap, nw, nh} when the bitmap was decoded smaller than the file (nw x nh is the file's size)
   * @param {(w:number,h:number)=>any} createCanvas
   */
  constructor(data, images, createCanvas) {
    this.sprites = data.sprites;
    this.widescreen = data.widescreen;
    this.images = images;
    this.tints = new TintCache(createCanvas);
    this.items = [];                                             // reused every frame
    this.byLayer = LAYERS.map((_, i) => this.sprites.filter((s) => (s.layer === 4 ? 4 : Math.min(3, s.layer)) === i || (i === 3 && s.layer > 4)));
  }

  /** Every file the storyboard may draw (animation frames expanded). */
  static neededFiles(data) {
    const out = new Set();
    for (const s of data.sprites) for (const f of spriteFiles(s)) out.add(f);
    return [...out];
  }

  /**
   * Decode size per file: no wider than it can appear on a canvas `height` px high (the storyboard is 480 high),
   * and, if all of it is still above `budgetBytes`, everything scaled down further (but not below half).
   * @param {Map<string, {width:number, height:number}>} sizes native file sizes
   * @returns {Map<string, {width:number, height:number}>} bitmap size to decode each file at
   */
  static decodePlan(data, sizes, { height = 1080, budgetBytes = 256 * 1024 * 1024 } = {}) {
    const k = height / 480, scales = fileScales(data), plan = new Map();
    let total = 0;
    for (const [f, sz] of sizes) {
      const f2 = Math.min(1, ((scales.get(f) ?? 1) * k));      // drawn at most this fraction of its native size
      const w = Math.max(1, Math.ceil(sz.width * f2)), h = Math.max(1, Math.ceil(sz.height * f2));
      plan.set(f, { width: w, height: h });
      total += w * h * 4;
    }
    if (total > budgetBytes && budgetBytes > 0) {
      const k2 = Math.max(0.5, Math.sqrt(budgetBytes / total));
      for (const [f, p] of plan) plan.set(f, { width: Math.max(1, Math.ceil(p.width * k2)), height: Math.max(1, Math.ceil(p.height * k2)) });
    }
    return plan;
  }

  imageOf(s, t) {
    if (!s.anim) return this.images.get(assetKey(s.file)) ?? null;
    const m = s.file.match(/^(.*?)(\.[^.\\/]+)?$/);
    let i = Math.floor((t - s.lifeStart) / s.anim.delay);
    i = s.anim.once ? Math.min(Math.max(i, 0), s.anim.count - 1) : ((i % s.anim.count) + s.anim.count) % s.anim.count;
    return this.images.get(assetKey(`${m[1]}${i}${m[2] ?? ''}`)) ?? null;
  }

  /** Draw the Background, Pass and Foreground layers (beneath the playfield). */
  drawUnder(ctx, W, H, t) { this.paint(ctx, W, H, t, [0, 2, 3]); }
  /** Draw the Overlay layer (above the playfield). */
  drawOver(ctx, W, H, t) { this.paint(ctx, W, H, t, [4]); }

  /**
   * Draw the given layers back to front. Sprites that cannot be seen are not drawn: almost transparent ones,
   * ones off the frame, and everything beneath the last opaque (JPEG, alpha 1, normal blend) sprite that covers the frame.
   */
  paint(ctx, W, H, t, layers) {
    const k = H / 480;
    const ox = (W - 640 * k) / 2;                                // the 640 wide storyboard area centred; widescreen draws wider than it
    const items = this.items;
    items.length = 0;
    for (const li of layers) {
      for (const s of this.byLayer[li]) {
        if (t < s.lifeStart || t > s.lifeEnd) continue;
        const st = spriteState(s, t);
        if (!st || st.alpha < 0.004) continue;
        const img = this.imageOf(s, t);
        if (!img) continue;
        const bm = img.bitmap ?? img;
        const iw = img.nw ?? bm.width, ih = img.nh ?? bm.height;
        const cx = ox + st.x * k, cy = st.y * k;
        const reach = Math.hypot(iw * Math.abs(st.sx), ih * Math.abs(st.sy)) * k;   // skip sprites whose bounding circle misses the frame
        if (cx + reach < 0 || cx - reach > W || cy + reach < 0 || cy - reach > H) continue;
        const fx = st.sx * (st.flipH ? -1 : 1) * k, fy = st.sy * (st.flipV ? -1 : 1) * k;
        if (fx === 0 || fy === 0) continue;
        const cos = Math.cos(st.rot), sin = Math.sin(st.rot);
        const dx = -iw * s.origin[0], dy = -ih * s.origin[1];
        items.push({ st, bm, iw, ih, cx, cy, fx, fy, cos, sin, dx, dy, opaque: s.opaque && st.alpha >= 0.995 && !st.additive && coversFrame(W, H, cx, cy, fx, fy, cos, sin, dx, dy, iw, ih) });
      }
    }
    let from = 0;
    for (let i = items.length - 1; i > 0; i--) if (items[i].opaque) { from = i; break; }
    if (from >= items.length) return;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    let alpha = 1, op = 'source-over';
    for (let i = from; i < items.length; i++) {
      const it = items[i], st = it.st;
      if (st.alpha !== alpha) { alpha = st.alpha; ctx.globalAlpha = alpha; }
      const o = st.additive ? 'lighter' : 'source-over';
      if (o !== op) { op = o; ctx.globalCompositeOperation = op; }
      ctx.setTransform(it.fx * it.cos, it.fx * it.sin, -it.fy * it.sin, it.fy * it.cos, it.cx, it.cy);
      const src = st.r < 254.5 || st.g < 254.5 || st.b < 254.5 ? this.tints.get(it.bm, st.r, st.g, st.b) : it.bm;
      ctx.drawImage(src, 0, 0, it.bm.width, it.bm.height, it.dx, it.dy, it.iw, it.ih);
    }
    ctx.restore();
    items.length = 0;                                            // do not keep the sprites' state alive between frames
  }
}

/** Whether a sprite's (rotated, scaled) texture box contains all four corners of the W x H frame. */
export function coversFrame(W, H, cx, cy, fx, fy, cos, sin, dx, dy, iw, ih) {
  for (let i = 0; i < 4; i++) {
    const px = (i & 1 ? W : 0) - cx, py = (i & 2 ? H : 0) - cy;
    const lx = (cos * px + sin * py) / fx, ly = (-sin * px + cos * py) / fy;     // the corner in the sprite's own pixel space
    if (lx < dx || lx > dx + iw || ly < dy || ly > dy + ih) return false;
  }
  return true;
}
