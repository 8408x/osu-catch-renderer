// The "CPOL" look: the real tosu overlays AccuracyPP, ArtistTitleDifficulty and Combo (v1.0.2), rendered by the
// browser itself. Their stylesheet (assets/tosu/main.css) is used untouched and their markup is rebuilt here with the
// values tosu would feed them (the Vue templates become plain HTML), then each overlay is drawn to an image through an
// SVG <foreignObject> and cached. The overlay's pieces change rarely (timer ring, catches), so only a few hundred images
// are needed for a whole song. Chromium, Edge and Firefox can rasterise this; where it is not possible the caller falls
// back to the canvas drawing.

import { hudAt } from './score.js?v=20261109z';
import { livePp } from './pp.js?v=20261109z';
import { countUp } from './countup.js?v=20261109z';

const CIRCUMFERENCE = 30 * Math.PI * 2;                 // the progress ring's circle, as in the overlay's App.js
const OSU_GRADE = ['SSH', 'SS', 'SH', 'S', 'A', 'B', 'C', 'D', 'F', ''];   // lib/consts.js

/** Size (px) of each overlay's browser source and how it is placed in the frame (relative to a 1080 p high frame). */
export const PLACEMENT = {
  title: { w: 800, h: 90, k: 1.222 },                  // Resolution 800x90
  acc: { w: 340, h: 80, k: 1.7 },                      // Resolution 170x75; widened so the longest "100.00% SSH" line is not clipped
  combo: { w: 420, h: 44, k: 1.7 },
  pp: { w: 190, h: 100, k: 1.222 },                    // InGame3 v1.004 by Dartandr, Resolution 190x100: the pp counter under the map details                    // Resolution 350x40, widened for "(1234)" after the total
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pad = (n) => String(n).padStart(2, '0');
export const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`; };

const MOD_LABELS = [[1, 'NF'], [2, 'EZ'], [8, 'HD'], [16, 'HR'], [32, 'SD'], [64, 'DT'], [128, 'RX'], [256, 'HT'], [1024, 'FL']];
/** tosu's `mods` token, e.g. "HD,DT". */
export function modsToken(mods) {
  const list = MOD_LABELS.filter(([bit]) => mods & bit).map(([, n]) => n);
  if (mods & 512) { const i = list.indexOf('DT'); if (i >= 0) list[i] = 'NC'; else list.push('NC'); }
  return list.length ? list.join(',') : 'NM';   // tosu names no mods "NM"
}

/** osu! grade as tosu names it (SSH / SS / SH / S / A / B / C / D). */
export function gradeToken(acc, mods) {
  const base = acc >= 1 ? 'SS' : acc >= 0.98 ? 'S' : acc >= 0.94 ? 'A' : acc >= 0.9 ? 'B' : acc >= 0.85 ? 'C' : 'D';
  const hidden = (mods & (8 | 1024)) && base.startsWith('S');
  return OSU_GRADE[{ SS: hidden ? 0 : 1, S: hidden ? 2 : 3, A: 4, B: 5, C: 6, D: 7 }[base]];
}

const runMaxCache = new WeakMap();
/** Best combo reached by time t (the overlay's `currentMaxCombo`). */
function bestComboSoFar(hud, t) {
  let run = runMaxCache.get(hud);
  if (!run) {
    run = [];
    let m = 0;
    for (const e of hud.timeline) { m = Math.max(m, e.combo); run.push(m); }
    runMaxCache.set(hud, run);
  }
  const tl = hud.timeline;
  let lo = -1, hi = tl.length;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tl[mid].t <= t + 1e-4) lo = mid; else hi = mid; }
  return lo >= 0 ? run[lo] : 0;
}

/** The token values the three overlays read, at beatmap time t. */
export function tosuTokens(scene, t) {
  const v = scene.hud ? hudAt(scene.hud, t) : { combo: 0, acc: 1, nMiss: 0, t: -Infinity };
  const objs = scene.objects;
  const first = objs[0]?.t ?? 0, last = objs[objs.length - 1]?.t ?? 1;
  const pct = Math.min(1, Math.max(0, (t - first) / Math.max(1, last - first)));
  const meta = scene.meta ?? {};
  const mods = scene.mods ?? 0;
  return {
    time: mmss(t),
    pct,
    titleRoman: meta.title ?? '',
    artistUnicode: meta.artistUnicode ?? meta.artist ?? '',
    creator: meta.creator ?? '',
    diffName: meta.version ?? '',
    mods: modsToken(mods),
    acc: (v.acc * 100).toFixed(2),
    grade: gradeToken(v.acc, mods),
    ppIfMapEndsNow: scene.diff && scene.hud ? Math.round(livePp(scene.diff, scene, v, t)) : 0,
    ppShown: scene.diff && scene.hud ? countUp((at) => livePp(scene.diff, scene, hudAt(scene.hud, at), at), t) : 0,   // InGame3 counts up to two decimals
    ppIfRestFced: scene.diff ? Math.round(scene.maxPp) : 0,
    combo: v.combo,
    maxCombo: scene.diff?.maxCombo ?? 0,
    currentMaxCombo: scene.hud ? bestComboSoFar(scene.hud, t) : 0,
    fcing: (v.nMiss ?? 0) === 0,
  };
}

// ---------- markup: index.html of each overlay with the Vue bindings filled in ----------
export function titleHtml(k, coverUrl) {
  const offset = ((1 - k.pct) * CIRCUMFERENCE).toFixed(3);
  const cover = coverUrl
    ? `background-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.6)),url(${coverUrl}); background-size: 90px 90px;`
    : 'background-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.1), rgba(0, 0, 0, 0.6));';
  return `<div class="overlay"><div class="overlay-playing"><div class="beatmap">
<div class="cover">
<div class="image" style="${cover}"></div>
<svg width="90" height="90"><rect width="90" height="90" class="darken"></rect><circle cx="45" cy="45" r="30" class="remaining"></circle><circle cx="45" cy="45" r="30" class="progress" style="stroke-dashoffset: ${offset}px"></circle></svg>
<div><span class="progress-text">${esc(k.time)}</span></div>
</div>
<div class="meta">
<div class="text"><div class="titles"><span class="title">${esc(k.titleRoman)}</span></div>
<span class="artist">${esc(k.artistUnicode)} - <span class="subtitle">${esc(k.creator)}</span></span></div>
<div><span class="difficulty">${esc(k.diffName)}</span> + <span class="mods">${esc(k.mods)}</span></div>
</div></div></div></div>`;
}

export function accHtml(k) {
  return `<div class="overlay"><div class="overlay-playing"><div class="performance">
<div class="acc"><span class="text">${esc(k.acc)}% <span class="rank">${esc(k.grade)}</span></span></div>
</div></div></div>`;
}

/** InGame3's pp counter: the live pp, and the "if FC" bubble that appears once there is a miss. */
export function ppHtml(k) {
  return `<div class="base" id="base"><div class="pp"><span id="pp">${k.ppShown.toFixed(2)}</span>pp</div></div>`
    + `<div class="ifFcpp" style="opacity:${k.fcing ? 0 : 1}"><span id="ifFcpp">${k.ppIfRestFced}</span>pp</div>`;
}

export function comboHtml(k) {
  const cur = k.fcing ? '' : ` <span class="subtext">(${k.currentMaxCombo})</span>`;
  return `<div class="overlay"><div class="overlay-playing"><div class="combo"><span class="text">${k.combo}<span class="subtext">/${k.maxCombo} Combo${cur}</span></span></div></div></div>`;
}

/** The three cache keys: what each overlay shows right now. */
function keysOf(k) {
  return {
    title: [k.time, Math.round(k.pct * 400), k.titleRoman, k.artistUnicode, k.creator, k.diffName, k.mods].join('|'),
    acc: [k.acc, k.grade].join('|'),
    pp: [k.ppShown.toFixed(2), k.fcing ? '' : k.ppIfRestFced].join('|'),
    combo: [k.combo, k.maxCombo, k.fcing ? '' : k.currentMaxCombo].join('|'),
  };
}

const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export class TosuOverlays {
  /** @param {string} css the overlays' stylesheet, fonts already inlined */
  constructor(css, ppCss = '') {
    this.css = css;
    this.ppCss = ppCss;
    this.cache = new Map();                              // `${name}#${key}` -> ImageBitmap
    this.pending = new Map();                            // same keys -> Promise
    this.last = {};                                      // newest finished image per overlay, shown while a new one renders
    this.coverUrl = '';
    this.coverFor = null;
    this.version = 0;                                    // bumped when the cover changes, part of the title key
    this.onReady = null;
    this.failed = false;
  }

  /** Fetch the stylesheet and the three Roboto Mono weights and build the overlay renderer. */
  static async load(bytesOf, base = 'assets/') {
    const css = new TextDecoder().decode(await bytesOf(`${base}tosu/main.css`));
    const weights = [[400, 'regular'], [600, '600'], [700, '700']];
    const faces = [];
    for (const [w, n] of weights) {
      try {
        const bytes = await bytesOf(`${base}fonts/roboto-mono-v23-latin-${n}.woff2`);
        faces.push(`@font-face{font-family:'Roboto Mono';font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${b64(bytes)}) format('woff2');}`);
      } catch { /* the 500 weight is not bundled; the overlay does not use it */ }
    }
    // the overlays' own @font-face rules point at files we do not serve; drop them and keep everything else verbatim
    const rest = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@font-face\s*\{[^}]*\}/g, '').replace(/(^|\n)body\s*\{/, '$1.tosu-body {');
    let ppCss = '';
    try {   // InGame3 (pp counter): its stylesheet and the rounded font it names "Custom-Font"
      const ig = new TextDecoder().decode(await bytesOf(`${base}tosu/ingame3.css`));
      const font = await bytesOf(`${base}fonts/MPLUSRounded1c-ExtraBold-latin.woff2`);
      ppCss = `@font-face{font-family:'Custom-Font';src:url(data:font/woff2;base64,${b64(font)}) format('woff2');}\n${ig}`;
    } catch { /* without it the pp counter falls back to the AccuracyPP-less layout (no pp shown by tosu overlays) */ }
    return new TosuOverlays(`${faces.join('')}\n${rest}`, ppCss);
  }

  /** Give the title overlay the map's picture, cropped square like tosu's `backgroundImage?crop=1`. */
  setCover(bitmap) {
    if (bitmap === this.coverFor) return;
    this.coverFor = bitmap;
    this.version++;
    this.coverUrl = '';
    if (!bitmap || !bitmap.width) return;
    const c = document.createElement('canvas');
    c.width = c.height = 270;
    const g = c.getContext('2d');
    const k = Math.max(270 / bitmap.width, 270 / bitmap.height);
    g.drawImage(bitmap, (270 - bitmap.width * k) / 2, (270 - bitmap.height * k) / 2, bitmap.width * k, bitmap.height * k);
    this.coverUrl = c.toDataURL('image/jpeg', 0.88);
  }

  svgFor(name, k) {
    const { w, h, k: scale } = PLACEMENT[name];
    const body = name === 'title' ? titleHtml(k, this.coverUrl) : name === 'acc' ? accHtml(k) : name === 'pp' ? ppHtml(k) : comboHtml(k);
    const css = name === 'pp' ? this.ppCss : this.css;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">`
      + `<foreignObject x="0" y="0" width="${w}" height="${h}"><div xmlns="http://www.w3.org/1999/xhtml" class="tosu-body" style="width:${w}px;height:${h}px;position:relative;overflow:hidden;">`
      + `<style>${css.replace(/&/g, '&amp;').replace(/</g, '&lt;')}\n.tosu-body *{transition:none !important;}</style>${body}</div></foreignObject></svg>`;
  }

  request(name, k, key) {
    const id = `${name}#${this.version}#${key}`;
    if (this.cache.has(id)) return Promise.resolve(this.cache.get(id));
    if (this.pending.has(id)) return this.pending.get(id);
    const job = (async () => {
      const img = new Image();
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(this.svgFor(name, k))}`;
      await img.decode();
      // keep the decoded <img> itself: drawing it keeps the canvas clean, whereas createImageBitmap() of an SVG with a
      // foreignObject marks the bitmap (and any canvas it is drawn on) as tainted, which makes VideoFrame() throw on export
      this.cache.set(id, img);
      if (this.cache.size > 600) this.cache.delete(this.cache.keys().next().value);
      this.last[name] = img;
      return img;
    })().catch((err) => { this.failed = true; throw err; }).finally(() => this.pending.delete(id));
    this.pending.set(id, job);
    return job;
  }

  /** Render (and wait for) the three overlays for beatmap time t. Used by the exporter before every frame. */
  async prepare(scene, t) {
    const k = tosuTokens(scene, t), keys = keysOf(k);
    await Promise.all((this.ppCss ? ['title', 'acc', 'pp', 'combo'] : ['title', 'acc', 'combo']).map((n) => this.request(n, k, keys[n])));
  }

  /**
   * Draw the overlays from the cache. Whatever is not ready yet is requested and the newest earlier image stands in;
   * `onReady` fires when something new arrives. Returns false when overlays cannot be rendered at all.
   */
  draw(ctx, W, H, scene, t, place = null, alphaOf = null) {
    if (this.failed) return false;
    const k = tosuTokens(scene, t), keys = keysOf(k), u = H / 1080;
    const at = {
      title: (p) => [6 * u, 8 * u, p.w * p.k * u, p.h * p.k * u],
      pp: (p) => [6 * u, (8 + PLACEMENT.title.h * PLACEMENT.title.k + 4) * u, p.w * p.k * u, p.h * p.k * u],
      acc: (p) => [W - 8 * u - p.w * p.k * u, 0, p.w * p.k * u, p.h * p.k * u],
      combo: (p) => [4 * u, H - 12 * u - p.h * p.k * u, p.w * p.k * u, p.h * p.k * u],
    };
    for (const name of (this.ppCss ? ['title', 'acc', 'pp', 'combo'] : ['title', 'acc', 'combo'])) {
      const id = `${name}#${this.version}#${keys[name]}`;
      let img = this.cache.get(id);
      if (!img) {
        this.request(name, k, keys[name]).then(() => this.onReady?.(), () => this.onReady?.());
        img = this.last[name];
      }
      const rect = place ? place(name) : at[name](PLACEMENT[name]);   // `place` (the Custom layout) can move or hide each overlay
      if (img && rect) {
        ctx.globalAlpha = alphaOf ? alphaOf(name) : 1;
        ctx.drawImage(img, rect[0], rect[1], rect[2], rect[3]);
        ctx.globalAlpha = 1;
      }
    }
    return true;
  }
}
