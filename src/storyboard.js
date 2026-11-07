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
export class Storyboard {
  /**
   * @param {{sprites: object[], widescreen: boolean}} data from parseStoryboard
   * @param {Map<string, any>} images assetKey -> decoded image
   * @param {(w:number,h:number)=>any} createCanvas
   */
  constructor(data, images, createCanvas) {
    this.sprites = data.sprites;
    this.widescreen = data.widescreen;
    this.images = images;
    this.createCanvas = createCanvas;
    this.scratch = null;
    this.byLayer = LAYERS.map((_, i) => this.sprites.filter((s) => (s.layer === 4 ? 4 : Math.min(3, s.layer)) === i || (i === 3 && s.layer > 4)));
  }

  /** Every file the storyboard may draw (animation frames expanded). */
  static neededFiles(data) {
    const out = new Set();
    for (const s of data.sprites) {
      if (!s.anim) { out.add(assetKey(s.file)); continue; }
      const m = s.file.match(/^(.*?)(\.[^.\\/]+)?$/);
      for (let i = 0; i < s.anim.count; i++) out.add(assetKey(`${m[1]}${i}${m[2] ?? ''}`));
    }
    return [...out];
  }

  imageOf(s, t) {
    if (!s.anim) return this.images.get(assetKey(s.file)) ?? null;
    const m = s.file.match(/^(.*?)(\.[^.\\/]+)?$/);
    let i = Math.floor((t - s.lifeStart) / s.anim.delay);
    i = s.anim.once ? Math.min(Math.max(i, 0), s.anim.count - 1) : ((i % s.anim.count) + s.anim.count) % s.anim.count;
    return this.images.get(assetKey(`${m[1]}${i}${m[2] ?? ''}`)) ?? null;
  }

  /** Draw the Background, Pass and Foreground layers (beneath the playfield). */
  drawUnder(ctx, W, H, t) { for (const li of [0, 2, 3]) this.drawLayer(ctx, W, H, t, li); }
  /** Draw the Overlay layer (above the playfield). */
  drawOver(ctx, W, H, t) { this.drawLayer(ctx, W, H, t, 4); }

  drawLayer(ctx, W, H, t, li) {
    const list = this.byLayer[li];
    if (!list.length) return;
    const k = H / 480;
    const ox = (W - 640 * k) / 2;                                // the 640 wide storyboard area centred; widescreen draws wider than it
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const s of list) {
      const st = spriteState(s, t);
      if (!st) continue;
      const img = this.imageOf(s, t);
      if (!img) continue;
      const iw = img.width, ih = img.height;
      ctx.globalAlpha = st.alpha;
      ctx.globalCompositeOperation = st.additive ? 'lighter' : 'source-over';
      const cx = ox + st.x * k, cy = st.y * k;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.translate(cx, cy);
      if (st.rot) ctx.rotate(st.rot);
      ctx.scale(st.sx * (st.flipH ? -1 : 1) * k, st.sy * (st.flipV ? -1 : 1) * k);
      const dx = -iw * s.origin[0], dy = -ih * s.origin[1];
      const tinted = st.r < 254.5 || st.g < 254.5 || st.b < 254.5;
      if (tinted) ctx.drawImage(this.tint(img, st), 0, 0, iw, ih, dx, dy, iw, ih);
      else ctx.drawImage(img, dx, dy);
    }
    ctx.restore();
  }

  /** The image multiplied by the sprite's colour, through one reusable scratch canvas. */
  tint(img, st) {
    const w = img.width, h = img.height;
    if (!this.scratch || this.scratch.width < w || this.scratch.height < h) this.scratch = this.createCanvas(Math.max(w, this.scratch?.width ?? 0), Math.max(h, this.scratch?.height ?? 0));
    const c = this.scratch, g = c.getContext('2d');
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = `rgb(${Math.round(st.r)},${Math.round(st.g)},${Math.round(st.b)})`;
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return c;                                                       // may be larger than the image: the caller draws its top-left iw x ih
  }
}
