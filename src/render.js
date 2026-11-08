// Draws one frame of the catch playfield onto a 2D canvas context, using skin textures.
// Pure function of (scene, replay track, skin, time): the same code drives the live preview
// and the offline MP4 export, so what you preview is what gets encoded.
//
// Sizes and placement follow osu!lazer's legacy catch skin:
//   - fruit / droplet sprite = texture size (@2x halved) x the beatmap's fruit scale (from CS)
//   - droplets use 0.8x and tiny droplets 0.4x of that; sprites are capped at 160 px
//   - catcher sprite = texture size x 0.35 x catcher scale, hung from the plate line 16 px down

import { FIELD_W, FIELD_H } from './catch.js?v=20261110a';
import { hyperAmount, catcherStateAt, TRAIL_LIFE_MS, AFTERIMAGE_LIFE_MS } from './catcher.js?v=20261110a';
import { hudAt, scoreShownAt } from './score.js?v=20261110a';
import { plateAt, explosionsAt } from './plate.js?v=20261110a';
import { drawArgonHud, drawArgonPart } from './argon.js?v=20261110a';
import { healthAt } from './health.js?v=20261110a';
import { livePp } from './pp.js?v=20261110a';
import { keysAt } from './keys.js?v=20261110a';
import { ORDER, rectOf, fullRectOf, WIDGETS, styleInfo } from './layout.js?v=20261110a';
import { lookFor, styleData } from './styles.js?v=20261110a';
import { drawModIcons, drawModBadges } from './mods.js?v=20261110a';
import { drawFlashlight } from './flashlight.js?v=20261110a';

const ZONE = 120;  // room below the field for the catcher, in field units
const PAD = 12;
const MISS_FADE_MS = 250;          // DrawableCatchHitObject: FadeOut(250) on a miss
const HYPER_GLOW_SCALE = 1.2, HYPER_GLOW_ALPHA = 0.7; // LegacyCatchHitObjectPiece.hyperSprite
const BANANA_END_SCALE = 0.6;
const MAX_SPRITE = 160;
const FRUIT_NAMES = ['pear', 'grapes', 'apple', 'orange']; // chosen by (index in beatmap) % 4
const CAUGHT_SCALE = 0.5;                                   // lazer: caught_fruit_scale_adjust

export function layout(W, H, overlay = false) {
  if (overlay) {                                          // full-screen look: field from the top, catcher plate at ~86% of the height
    const s = (H * 0.861) / FIELD_H;
    return { s, ox: (W - FIELD_W * s) / 2, oy: 0 };
  }
  const s = H / (FIELD_H + ZONE + PAD * 2);
  return { s, ox: (W - FIELD_W * s) / 2, oy: PAD * s };
}

function lowerBound(objs, v) {
  let lo = 0, hi = objs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (objs[mid].t < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function spriteName(o) {
  return o.kind === 'fruit' ? FRUIT_NAMES[o.idx % 4] : o.kind === 'banana' ? 'bananas' : 'drop';
}

const outQuint = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 5);
const lerp = (a, b, p) => a + (b - a) * p;

function spriteScale(o, scene) {
  // CatchHitObject.Scale comes from CS; Droplet x0.8, TinyDroplet x0.4, Fruit and Banana x1 (a banana then lerps 0.6..2.2 -> 0.6 on top)
  const k = o.kind === 'fruit' || o.kind === 'banana' ? 1 : o.kind === 'droplet' ? 0.8 : 0.4;
  return scene.fruitScale * k;
}

const capSize = (tex) => Math.min(1, MAX_SPRITE / Math.max(tex.w, tex.h));

/** The overlay image for a fruit, only if it comes from the same skin as the fruit image itself
 *  (otherwise a custom fruit would get osu!'s default leaf / shine drawn on top of it). */
export function pickOverlay(skin, name, tex) {
  const ov = skin.get(`fruit-${name}-overlay`);
  return ov && ov.from === tex.from ? ov : null;
}

/** Fruit are tilted by a fixed random angle; droplets spin two full turns over their fall (DrawableFruit / DrawableDroplet). */
function spinDeg(o, scene, t) {
  if (o.kind === 'fruit') return (o.rot0 - 0.5) * 40;
  if (o.kind === 'banana') return 0;
  return o.rot0 * 20 + 720 * ((t - (o.t - scene.preempt)) / (scene.preempt + 2000));
}

/**
 * One fruit / droplet / banana. `o.hyper` objects get lazer's additive glow behind them.
 * Bananas fall while shrinking from a random size to 0.6x and rotating between two random angles;
 * `progress` (0 = spawn, 1 = reaches the catcher) drives both.
 */
function drawFruitSprite(ctx, skin, scene, o, cx, cy, extraScale, alpha, progress = 1, spin = 0) {
  const name = spriteName(o);
  const tex = skin.get(`fruit-${name}`);
  if (!tex) return;
  const isBanana = o.kind === 'banana';
  const rgb = isBanana ? o.rgb : scene.colours[o.combo % scene.colours.length];
  let k = spriteScale(o, scene) * extraScale;
  let angle = (spin * Math.PI) / 180;
  if (isBanana) {
    k *= Math.max(0, lerp(o.startScale, BANANA_END_SCALE, progress));
    angle = (lerp(o.startAngle, o.endAngle, progress) * Math.PI) / 180;
  }
  const cap = capSize(tex);
  const w = tex.w * cap * k, h = tex.h * cap * k;

  ctx.save();
  ctx.translate(cx, cy);
  if (angle) ctx.rotate(angle);
  if (o.hyper && !isBanana) {
    const g = HYPER_GLOW_SCALE;
    ctx.globalAlpha = alpha * HYPER_GLOW_ALPHA;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(skin.tinted(tex, skin.hyperColours.fruit), (-w * g) / 2, (-h * g) / 2, w * g, h * g);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = alpha;
  ctx.drawImage(skin.tinted(tex, rgb), -w / 2, -h / 2, w, h);
  const ov = pickOverlay(skin, name, tex);
  if (ov) {
    const ow = ov.w * capSize(ov) * k, oh = ov.h * capSize(ov) * k;
    ctx.drawImage(ov.img, -ow / 2, -oh / 2, ow, oh);
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

/**
 * Catcher image for a state. A state image is only used when it comes from the same skin as the idle
 * image, so a skin that has idle but no kiai/fail image keeps its own idle image instead of mixing
 * in the default skin's kiai/fail catcher.
 */
export function pickCatcherTexture(skin, state) {
  const idle = skin.get('fruit-catcher-idle');
  const st = skin.get(`fruit-catcher-${state}`);
  if (st && (!idle || st.from === idle.from)) return st;
  return idle || st || null;
}

/** Catcher sprite, optionally multiplied by a colour (hyperdash tint / trails), faded, scaled or drawn additively. */
function drawCatcher(ctx, skin, scene, x, state, facing, { rgb = null, alpha = 1, scale = 1, dy = 0, additive = false } = {}) {
  const tex = pickCatcherTexture(skin, state);
  if (!tex) return;
  const k = 0.35 * scene.catcherScale;
  const w = tex.w * k, h = tex.h * k;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (additive) ctx.globalCompositeOperation = 'lighter';
  ctx.translate(x, FIELD_H - 16 * k + dy);
  if (scale !== 1) ctx.scale(scale, scale);
  if (facing < 0) ctx.scale(-1, 1);
  ctx.drawImage(rgb ? skin.tinted(tex, rgb) : tex.img, -w / 2, 0, w, h);
  ctx.restore();
}

const mixRgb = (rgb, a) => rgb.map((c) => Math.round(255 + (c - 255) * (Math.round(a * 16) / 16)));

/** Dash / hyperdash trails and the hyperdash after-image (additive, drawn over the catcher like lazer). */
function drawTrails(ctx, skin, scene, fx, t) {
  const trails = fx.trails;
  let lo = 0, hi = trails.length;
  const from = t - AFTERIMAGE_LIFE_MS;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (trails[mid].t < from) lo = mid + 1; else hi = mid; }
  const { dash, afterImage, afterImageAlpha } = skin.hyperColours;
  for (let i = lo; i < trails.length && trails[i].t <= t; i++) {
    const e = trails[i];
    const age = t - e.t;
    if (e.kind === 'after') {
      const p = age / AFTERIMAGE_LIFE_MS;
      drawCatcher(ctx, skin, scene, e.x, e.state, e.facing, {
        rgb: afterImage, alpha: (1 - p) * afterImageAlpha, scale: lerp(0.95, 1.2, p * p), dy: -10 * p * p, additive: true,
      });
    } else if (age < TRAIL_LIFE_MS) {
      drawCatcher(ctx, skin, scene, e.x, e.state, e.facing, {
        rgb: e.kind === 'hyper' ? dash : null, alpha: 0.4 * (1 - outQuint(age / TRAIL_LIFE_MS)), additive: true,
      });
    }
  }
}


// ---------- background and the clean overlay ----------
const MONO = '"Roboto Mono", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

/** Load the bundled Roboto Mono (the font the tosu overlays use) so canvas text matches. Safe to call more than once. */
let fontsReady = null;
export function loadOverlayFonts(base = new URL('../assets/fonts/', import.meta.url)) {
  if (fontsReady) return fontsReady;
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return (fontsReady = Promise.resolve(false));
  const files = [[400, 'regular'], [600, '600'], [700, '700']];
  fontsReady = Promise.all(files.map(async ([weight, name]) => {
    const f = new FontFace('Roboto Mono', `url(${new URL(`roboto-mono-v23-latin-${name}.woff2`, base)})`, { weight: String(weight) });
    document.fonts.add(await f.load());
  })).then(() => true, () => false);
  return fontsReady;
}

let bgCache = null;                                        // the last still background, already scaled and dimmed for this frame size
function stillBackground(img, W, H, dim, makeCanvas) {
  if (bgCache && bgCache.img === img && bgCache.W === W && bgCache.H === H && bgCache.dim === dim) return bgCache.canvas;
  const canvas = makeCanvas ? makeCanvas(W, H) : (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : null);
  if (!canvas) return null;
  const g = canvas.getContext('2d');
  const iw = img.width, ih = img.height, k = Math.max(W / iw, H / ih);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
  g.fillStyle = `rgba(0,0,0,${Math.min(1, Math.max(0, dim))})`;
  g.fillRect(0, 0, W, H);
  bgCache = { img, W, H, dim, canvas };
  return canvas;
}

/** Cover-fit the beatmap background over the whole frame and darken it. */
function drawBackground(ctx, W, H, img, dim, makeCanvas) {
  const iw = img.videoWidth || img.width, ih = img.videoHeight || img.height;   // a <video> or an image
  if (!iw || !ih) return;
  if (!img.videoWidth && makeCanvas !== undefined) {
    const c = stillBackground(img, W, H, dim, makeCanvas);
    if (c) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(c, 0, 0); return; }
  }
  const k = Math.max(W / iw, H / ih);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.drawImage(img, (W - iw * k) / 2, (H - ih * k) / 2, iw * k, ih * k);
  ctx.fillStyle = `rgba(0,0,0,${Math.min(1, Math.max(0, dim))})`;
  ctx.fillRect(0, 0, W, H);
}

const roundRectPath = (ctx, x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/** Letter-spaced text (canvas letterSpacing is not available everywhere). */
function spacedText(ctx, text, x, y, spacing) {
  let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
  return cx - spacing;
}
const spacedWidth = (ctx, text, spacing) => [...text].reduce((a, ch) => a + ctx.measureText(ch).width + spacing, -spacing);

export const rankOf = (acc, mods) => {
  const base = acc >= 1 ? 'SS' : acc >= 0.98 ? 'S' : acc >= 0.94 ? 'A' : acc >= 0.9 ? 'B' : acc >= 0.85 ? 'C' : 'D';
  return base + ((mods & (8 | 1024)) && base.startsWith('S') ? 'H' : '');   // HD / FL turn S into SH, SS into SSH
};
const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

function drawOverlay(ctx, W, H, scene, t, { bg, keys, tosu, skin }) {
  const u = H / 1080;
  const v = scene.hud ? hudAt(scene.hud, t) : null;
  const meta = scene.meta ?? {};
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 6 * u;

  // the real tosu overlays when they can be rendered; otherwise the canvas copy below
  const usedTosu = tosu ? tosu.draw(ctx, W, H, scene, t) : false;
  if (!usedTosu) {
    // --- timer ring with the map thumbnail, top left ---
    const box = 110 * u;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, box, box); ctx.clip();
    if (bg && bg.width) {
      const k = Math.max(box / bg.width, box / bg.height);
      ctx.drawImage(bg, (box - bg.width * k) / 2, (box - bg.height * k) / 2, bg.width * k, bg.height * k);
    } else { ctx.fillStyle = '#20222c'; ctx.fillRect(0, 0, box, box); }
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, box, box);
    ctx.restore();
    const first = scene.objects[0]?.t ?? 0, last = scene.objects[scene.objects.length - 1]?.t ?? 1;
    const progress = Math.min(1, Math.max(0, (t - first) / Math.max(1, last - first)));
    ctx.shadowBlur = 0;
    ctx.lineWidth = 4 * u;
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath(); ctx.arc(box / 2, box / 2, box * 0.42, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(box / 2, box / 2, box * 0.42, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 6 * u;
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${19 * u}px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(mmss(t), box / 2, box / 2 + 7 * u);
    ctx.textAlign = 'left';

    // --- title, artist - mapper, difficulty pill and mods ---
    const tx = 128 * u;
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${29 * u}px ${MONO}`;
    ctx.fillText(meta.title ?? "", tx, 34 * u);
    ctx.font = `${21 * u}px ${MONO}`;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(`${meta.artist ?? ""} - ${meta.creator ?? ""}`, tx, 62 * u);
    const pillText = String(meta.version ?? '').toUpperCase();
    ctx.font = `800 ${12 * u}px ${MONO}`;
    const pw = spacedWidth(ctx, pillText, 3.4 * u) + 20 * u, ph = 26 * u, py = 78 * u;
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fff';
    roundRectPath(ctx, tx, py, pw, ph, 3 * u); ctx.fill();
    ctx.fillStyle = '#111';
    spacedText(ctx, pillText, tx + 10 * u, py + 17.5 * u, 3.4 * u);
    ctx.shadowBlur = 6 * u;
    const modText = modsLabel(scene.mods ?? 0);
    if (modText) {
      ctx.fillStyle = '#fff';
      ctx.font = `${20 * u}px ${MONO}`;
      ctx.fillText(`+ ${modText}`, tx + pw + 14 * u, py + 20 * u);
    }

    // --- accuracy + rank, then pp, top right ---
    const acc = v ? v.acc : 1;
    const rank = rankOf(acc, scene.mods ?? 0);
    const rx = W - 8 * u;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${58 * u}px ${MONO}`;
    const rankW = ctx.measureText(rank).width;
    ctx.fillText(rank, rx, 56 * u);
    ctx.font = `600 ${42 * u}px ${MONO}`;
    ctx.fillText(`${(acc * 100).toFixed(2)}%`, rx - rankW - 18 * u, 56 * u);
    if (scene.diff) {
      const pp = livePpOf(scene, v, t);
      const maxText = `/${Math.round(scene.maxPp)}pp`;
      ctx.font = `600 ${25 * u}px ${MONO}`;
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(maxText, rx, 108 * u);
      const mw = ctx.measureText(maxText).width;
      ctx.fillStyle = '#fff';
      ctx.font = `600 ${42 * u}px ${MONO}`;
      ctx.fillText(`${Math.round(pp)}pp`, rx - mw, 108 * u);
    }
    ctx.textAlign = 'left';

    // --- combo as current/total, bottom left ---
    const total = scene.diff?.maxCombo ?? 0;
    const combo = v ? v.combo : 0;
    const cy = H - 12 * u;
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${51 * u}px ${MONO}`;
    const cs = String(combo);
    ctx.fillText(cs, 4 * u, cy);
    let cx = 4 * u + ctx.measureText(cs).width;
    ctx.font = `600 ${34 * u}px ${MONO}`;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    const ts = `/${total}`;
    ctx.fillText(ts, cx, cy);
    cx += ctx.measureText(ts).width;
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(' Combo', cx, cy);
  }

  // --- key overlay, right edge: left, right, dash, and a spare box ---
  if (keys && skin?.get('inputoverlay-key')) {            // the skin's own key counter design
    ctx.shadowBlur = 0;
    drawStableKeys(ctx, W, H, skin, keys, t, H / 768);
  } else if (keys) {
    const size = 56 * u, gap = 10 * u, kx = W - size - 8 * u;
    const top = H * 0.5 - (4 * size + 3 * gap) / 2 + 36 * u;
    drawKeyColumn(ctx, keysAt(keys, t), kx, top, size, gap, u, true);
    ctx.textAlign = 'left';
  }
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

const MOD_LABELS = [[1, 'NF'], [2, 'EZ'], [8, 'HD'], [16, 'HR'], [32, 'SD'], [64, 'DT'], [128, 'RX'], [256, 'HT'], [1024, 'FL']];
function modsLabel(mods) {
  const list = MOD_LABELS.filter(([bit]) => mods & bit).map(([, n]) => n);
  if (mods & 512) { const i = list.indexOf('DT'); if (i >= 0) list[i] = 'NC'; else list.push('NC'); }
  return list.join(',');
}

function livePpOf(scene, v, t) {
  return v ? livePp(scene.diff, scene, v, t) : 0;
}

// ---------- osu!stable HUD: score and accuracy top-right with the progress pie, flat HP bar top-left, combo bottom-left ----------
const HUD_GLYPH = { ',': 'comma', '.': 'dot', '%': 'percent', x: 'x' };
const HUD_POP_MS = 300;

/** Glyph textures for a font prefix; falls back to osu!'s own `score` numbers when the skin renamed the prefix but lacks the images. */
function glyphFor(skin, prefix, ch) {
  const key = HUD_GLYPH[ch] ?? ch;
  const own = skin.get(`${prefix}-${key}`);
  if (own || prefix === 'score') return own;
  // a skin with its own (even blank, like `invis`) number font but no `x` draws no `x`, rather than osu!'s
  if (key === 'x' && skin.get(`${prefix}-0`)) return null;
  return skin.get(`score-${key}`);
}

/**
 * Draw a string of skin number glyphs. `anchor` 'left' | 'right' places the text's bottom edge (or top for
 * `fromTop`) at (x, y). Digits share the width of '5' when `fixed`, like osu!'s score font.
 */
function drawGlyphs(ctx, skin, prefix, text, x, y, k, { anchor = 'left', fromTop = false, fixed = false, overlap = 0, alpha = 1, additive = false } = {}) {
  const glyphs = [...text].map((ch) => glyphFor(skin, prefix, ch));
  if (glyphs.some((g) => !g)) {
    if (!(prefix !== 'score' && text.endsWith('x') && skin.get(`${prefix}-0`))) return;
    glyphs.pop(); text = text.slice(0, -1);
    if (glyphs.some((g) => !g)) return;
  }
  const five = glyphFor(skin, prefix, '5');
  const widths = glyphs.map((g, i) => (fixed && /[0-9]/.test(text[i]) && five ? five.w : g.w) * k - overlap * k);
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = anchor === 'right' ? x - total : x;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (additive) ctx.globalCompositeOperation = 'lighter';
  glyphs.forEach((g, i) => {
    const w = g.w * k, h = g.h * k;
    const gx = cx + (widths[i] + overlap * k - w) / 2;
    ctx.drawImage(g.img, gx, fromTop ? y : y - h, w, h);
    cx += widths[i];
  });
  ctx.restore();
  return total;
}

/** Stable's HP bar: a flat dark track with a thin light border, a fill that is white (amber, then red when low) and a round marker at its end. */
function drawHealthBar(ctx, hp, x, y, w, h) {
  hp = Math.max(0, Math.min(1, hp));
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = hp > 0.5 ? '#ffffff' : hp > 0.25 ? '#ffc94d' : '#ff5555';
  ctx.fillRect(x + 1, y + 1, Math.max(0, (w - 2) * hp), h - 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = Math.max(1, h / 9);
  ctx.strokeRect(x, y, w, h);
  ctx.beginPath();
  ctx.arc(x + 1 + (w - 2) * hp, y + h / 2, h * 0.75, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.globalAlpha = hp > 0 ? 1 : 0;
  ctx.fill();
  ctx.restore();
}

/** The song progress pie stable draws left of the accuracy. */
function drawProgressPie(ctx, cx, cy, r, p) {
  ctx.save();
  ctx.lineWidth = Math.max(1, r / 7.75);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (p > 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r * 0.8, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** A skin's own HP bar (scorebar-bg / -colour / -ki, kidanger at low health), laid out for the 768 px high screen like stable. Returns false when the skin has none. */
/** `scorebar-bg` as a bar: wide and short. Skins also use it as a full-screen overlay (playfield edge lines, a frame), which is not a bar. */
const barLikeBg = (bg, u) => !!bg && bg.w >= 16 && bg.h * u <= 120 && bg.w / bg.h >= 4;

function drawSkinHealth(ctx, skin, hp, u, widget = false) {
  let bg = skin.get('scorebar-bg'), fill = skin.get('scorebar-colour') ?? skin.get('scorebar-colour-0');   // some skins animate the fill (-0, -1, ...): the first frame stands in
  if (bg && bg.w < 16) bg = null;                        // a blank image is how a skin hides the bar: use the built-in bar instead
  if (fill && fill.w < 16) fill = null;
  if (!bg && !fill) return false;
  hp = Math.max(0, Math.min(1, hp));
  const OX = 4.8 * u, OY = 16 * u;                       // stable: the fill sits at (3, 10) of its 640x480 layout, x1.6
  ctx.save();
  ctx.globalAlpha = 1;
  if (widget && !barLikeBg(bg, u)) {                      // as a widget the overlay-style background is left out; a plain track keeps the bar readable
    if (fill) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(OX - 2 * u, OY - 2 * u, fill.w * u + 4 * u, fill.h * u + 4 * u); }
  } else if (bg) ctx.drawImage(bg.img, 0, 0, bg.w * u, bg.h * u);
  let endX = OX;
  if (fill && fill.w > 0) {
    const cw = fill.w * hp;
    if (cw > 0) ctx.drawImage(fill.img, 0, 0, fill.img.width * hp, fill.img.height, OX, OY, cw * u, fill.h * u);
    endX = OX + cw * u;
  }
  const ki = skin.get(hp < 0.25 ? 'scorebar-kidanger2' : hp < 0.5 ? 'scorebar-kidanger' : 'scorebar-ki');
  const mk = ki ?? skin.get('scorebar-ki');
  if (mk && hp > 0) ctx.drawImage(mk.img, endX - mk.w * u / 2, OY + (fill ? fill.h * u : 0) / 2 - mk.h * u / 2, mk.w * u, mk.h * u);
  ctx.restore();
  return true;
}

/** Stable's key counter on the right edge: one `inputoverlay-key` per key (K1, K2, dash, unused) with its press count. */
function drawStableKeys(ctx, W, H, skin, keys, t, u) {
  const ks = keysAt(keys, t);
  const key = skin.get('inputoverlay-key');
  const kw = (key?.w ?? 43) * u, kh = (key?.h ?? 46) * u, gap = 1.5 * u;
  const rows = [ks.left, ks.right, ks.dash, null];
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${13 * u}px "Roboto Mono", ui-monospace, sans-serif`;
  rows.forEach((k, i) => {
    const y = H * 0.4556 + i * (kh + gap) - kh / 2;
    ctx.globalAlpha = k?.down ? 1 : 0.6;
    if (key) ctx.drawImage(key.img, W - kw, y, kw, kh);
    else { ctx.fillStyle = k?.down ? '#4aa3ff' : '#1d5a99'; ctx.fillRect(W - kw, y + 4 * u, 4 * u, kh - 8 * u); }
    if (k) { ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.fillText(String(k.count), W - 21 * u, y + kh / 2); }
  });
  ctx.restore();
}

/** CatchModHidden: the fade starts 60% of the preempt before the catch and lasts 16% of it (linear). */
export function hiddenAlpha(rem, preempt) {
  const start = preempt * 0.6, dur = preempt * 0.16;
  return Math.max(0, Math.min(1, 1 - (start - rem) / dur));
}

function drawStableHud(ctx, W, H, scene, t, skin, keys) {
  const hud = scene.hud;
  if (!hud) return;
  const v = hudAt(hud, t);
  const u = H / 768;                                     // osu! lays its HUD out for a 768 px high screen
  const { comboPrefix, scorePrefix, comboOverlap, scoreOverlap } = skin.fonts;
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // score, top right (LegacyScoreCounter: scale 0.96, margin 10), eight digits like stable
  const zero = glyphFor(skin, scorePrefix, '0');
  const scoreH = zero ? zero.h * 0.96 * u : 0;
  drawGlyphs(ctx, skin, scorePrefix, String(scoreShownAt(v, t)).padStart(8, '0'), W - 10 * u, 0, 0.96 * u,
    { anchor: 'right', fromTop: true, fixed: true, overlap: scoreOverlap });

  // accuracy, right under the score (LegacyAccuracyCounter: scale 0.6 * 0.96, margin 9 / 17)
  const accW = drawGlyphs(ctx, skin, scorePrefix, `${(v.acc * 100).toFixed(2)}%`, W - 17 * u, scoreH + 9 * u, 0.6 * 0.96 * u,
    { anchor: 'right', fromTop: true, fixed: true, overlap: scoreOverlap }) ?? 150 * u;

  // mods: the skin's own icons, else small badges, under the accuracy
  if (scene.mods) {
    const top = scoreH + 9 * u + 0.6 * 0.96 * (zero ? zero.h : 40) * u + 12 * u;
    if (!drawModIcons(ctx, skin, scene.mods, W - 10 * u, top, 44 * u)) drawModBadges(ctx, scene.mods, W - 10 * u, top, 26 * u);
  }

  // progress pie, left of the accuracy
  const objs = scene.objects;
  if (objs.length) {
    const a = objs[0].t, b = objs[objs.length - 1].t;
    drawProgressPie(ctx, W - 17 * u - (accW || 150 * u) - 10 * u - 16.5 * u, scoreH + 9 * u + (zero ? 0.6 * 0.96 * zero.h * u : 24 * u) / 2, 15.5 * u, Math.min(1, Math.max(0, (t - a) / Math.max(1, b - a))));
  }

  // health bar, top left
  const hp = scene.health ? healthAt(scene.health, t) : 1;
  if (!drawSkinHealth(ctx, skin, hp, u) && scene.health) drawHealthBar(ctx, hp, 10 * u, 10 * u, 340 * u, 14 * u);

  if (keys) drawStableKeys(ctx, W, H, skin, keys, t, u);

  // combo, bottom left (LegacyDefaultComboCounter: scale 1.28, margin 10) with its additive pop-out
  if (v.combo > 0) {
    const text = `${v.combo}x`;
    const k = 1.28 * u;
    drawGlyphs(ctx, skin, comboPrefix, text, 10 * u, H - 10 * u, k, { overlap: comboOverlap });
    const age = t - v.bumpT;
    if (age >= 0 && age < HUD_POP_MS) {
      const p = age / HUD_POP_MS;
      drawGlyphs(ctx, skin, comboPrefix, text, 10 * u, H - 10 * u, k * (1 + 0.6 * (1 - p)), { overlap: comboOverlap, alpha: 0.65 * (1 - p), additive: true });
    }
  }
}

/** Hit lighting: lazer's LegacyHitExplosion, additive and tinted with the object's colour, riding on the catcher. */
function drawHitLighting(ctx, skin, scene, t, catcherX) {
  const one = skin.get('lazer-explosion-2'), two = skin.get('lazer-explosion-1');   // explosion1 uses scoreboard-explosion-2, explosion2 uses -1
  if (!one || !two || !scene.plate) return;
  const k = 0.5 * scene.catcherScale;                    // the explosion is scaled 0.5 inside the (scaled) catcher
  const beam = (tex, rgb, x, a, sx, sy) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x, FIELD_H);
    ctx.scale(k, k);
    ctx.rotate(-Math.PI / 2);                            // origin is the sprite's left-centre, rotated to point up
    ctx.scale(sx, sy);
    ctx.drawImage(skin.tinted(tex, rgb), 0, -tex.h / 2, tex.w, tex.h);
    ctx.restore();
  };
  for (const e of explosionsAt(scene.plate, scene, t)) {
    const rgb = e.obj.kind === 'banana' ? e.obj.rgb : scene.colours[e.obj.combo % scene.colours.length];
    const x = catcherX + e.offset * k;
    if (e.flash) beam(one, rgb, x, e.flash.alpha, e.flash.sx, e.flash.sy);
    if (e.glow) beam(two, rgb, x, e.glow.alpha, e.glow.sx, e.glow.sy);
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W canvas width in px
 * @param {number} H canvas height in px
 * @param {object} scene from buildScene() with evaluateCatches() already applied
 * @param {import('./replay.js').ReplayTrack} track
 * @param {number} t beatmap time in ms
 * @param {{skin: import('./skin.js').Skin, showCatchWidth?: boolean}} opts
 */
const sbBuffers = new WeakMap();
/** The reduced-size canvas the storyboard is drawn on, or null when the frame is already that small. */
function sbBuffer(ctx, makeCanvas, W, H, bgDim) {
  const bh = Math.min(H, bgDim >= 0.5 ? 360 : 720);
  if (bh >= H) return null;
  const bw = Math.round((W * bh) / H);
  let b = sbBuffers.get(ctx);
  if (!b || b.w !== bw || b.h !== bh) {
    const canvas = makeCanvas(bw, bh);
    b = { canvas, g: canvas.getContext('2d'), w: bw, h: bh };
    sbBuffers.set(ctx, b);
  }
  return b;
}


/** The left / right / dash boxes (and, with `spare`, an empty fourth), stacked down from (kx, top). */
function drawKeyColumn(ctx, ks, kx, top, size, gap, u, spare) {
  const specs = [{ k: ks.left, fill: '#ffe14d' }, { k: ks.right, fill: '#ffe14d' }, { k: ks.dash, fill: '#ff7ab8' }];
  if (spare) specs.push({ k: null, fill: '#8a8d96' });
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.textAlign = 'center';
  specs.forEach((sp, i) => {
    const y = top + i * (size + gap);
    if (!sp.k) { ctx.fillStyle = 'rgba(138,141,150,0.9)'; roundRectPath(ctx, kx, y, size, size, 7 * u); ctx.fill(); return; }
    if (sp.k.down) {
      ctx.fillStyle = sp.fill; roundRectPath(ctx, kx, y, size, size, 7 * u); ctx.fill();
      ctx.fillStyle = '#111';
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2 * u;
      roundRectPath(ctx, kx, y, size, size, 7 * u); ctx.stroke();
      ctx.fillStyle = '#fff';
    }
    ctx.font = `600 ${22 * u}px ${MONO}`;
    ctx.fillText(String(sp.k.count), kx + size / 2, y + size / 2 + 8 * u);
  });
  ctx.restore();
}

/** One piece of osu!stable's HUD in a box of `st.w` x `st.h` px (a 1080 p frame, so osu!'s 768 unit screen is x1.40625). */
function drawStableLook(ctx, id, st, scene, t, skin, keys) {
  const u = 1080 / 768, v = scene.hud ? hudAt(scene.hud, t) : null;
  if (!v) return;
  const { comboPrefix, scorePrefix, comboOverlap, scoreOverlap } = skin.fonts;
  if (id === 'score') {
    drawGlyphs(ctx, skin, scorePrefix, String(scoreShownAt(v, t)).padStart(8, '0'), st.w, -1.5, 0.96 * u, { anchor: 'right', fromTop: true, fixed: true, overlap: scoreOverlap });
  } else if (id === 'acc') {
    drawGlyphs(ctx, skin, scorePrefix, `${(v.acc * 100).toFixed(2)}%`, st.w, -1.7, 0.6 * 0.96 * u, { anchor: 'right', fromTop: true, fixed: true, overlap: scoreOverlap });
  } else if (id === 'combo') {
    if (v.combo <= 0) return;
    const text = `${v.combo}x`, k = 1.28 * u, age = t - v.bumpT;
    drawGlyphs(ctx, skin, comboPrefix, text, 0, st.h, k, { overlap: comboOverlap });
    if (age >= 0 && age < HUD_POP_MS) {
      const p = age / HUD_POP_MS;
      drawGlyphs(ctx, skin, comboPrefix, text, 0, st.h, k * (1 + 0.6 * (1 - p)), { overlap: comboOverlap, alpha: 0.65 * (1 - p), additive: true });
    }
  } else if (id === 'health') {
    const hp = scene.health ? healthAt(scene.health, t) : 1, bg = skin.get('scorebar-bg');
    const fill = skin.get('scorebar-colour') ?? skin.get('scorebar-colour-0');
    const barW = barLikeBg(bg, u) ? bg.w * u : fill && fill.w >= 16 ? fill.w * u + 9.6 * u : 0;
    ctx.save();
    const k = barW ? st.w / barW : 1;
    ctx.scale(k, k);
    if (!barW || !drawSkinHealth(ctx, skin, hp, u, true)) { ctx.restore(); drawHealthBar(ctx, hp, 2, 5, 340 * u, 14 * u); return; }
    ctx.restore();
  } else if (id === 'progress') {
    const objs = scene.objects;
    if (objs.length) drawProgressPie(ctx, st.w / 2, st.h / 2, 15.5 * u, Math.min(1, Math.max(0, (t - objs[0].t) / Math.max(1, objs[objs.length - 1].t - objs[0].t))));
  } else if (id === 'keys' && keys) {
    const key = skin.get('inputoverlay-key'), kw = (key?.w ?? 43) * u, kh = (key?.h ?? 46) * u;
    drawStableKeys(ctx, kw, kh / (2 * 0.4556), skin, keys, t, u);
  }
}

/** The Custom style: every widget the layout turns on, at its own place and size. */
function drawCustom(ctx, W, H, scene, t, { layout, tosu, keys, skin, bg, guides, argon }) {
  const u = H / 1080;
  const v = scene.hud ? hudAt(scene.hud, t) : null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 6 * u;
  const rect = (id) => (layout[id].on ? rectOf(id, layout, W, H) : null);
  const isTosu = (id) => !!styleInfo(id, layout[id].style).tosu;
  const sd = styleData(scene, t, bg, keys);

  // the tosu overlays (map details, pp, accuracy, combo) show only while their widget uses the tosu look; without
  // the overlay renderer the fixed canvas copy stands in when every one of them is on its tosu look
  const tosuOk = tosu ? tosu.draw(ctx, W, H, scene, t, (name) => (isTosu(name) && layout[name].on ? fullRectOf(name, layout, W, H) : null), (name) => layout[name].a ?? 1) : false;
  if (!tosuOk && ['title', 'pp', 'acc', 'combo'].every(isTosu)) drawOverlay(ctx, W, H, scene, t, { bg, keys: null, tosu: null, skin });

  // looks drawn natively, at the look's own size scaled to the widget's rectangle
  for (const id of ORDER) {
    const r = rect(id);
    if (!r || isTosu(id)) continue;
    const st = styleInfo(id, layout[id].style), look = lookFor(id, st.id);
    ctx.globalAlpha = layout[id].a ?? 1;
    if (st.system) {                                       // the osu!lazer (Argon) and osu!stable HUD pieces
      ctx.save();
      ctx.translate(r[0], r[1]);
      ctx.scale(r[2] / st.w, r[3] / st.h);
      ctx.shadowBlur = 0;
      ctx.textBaseline = 'alphabetic';
      if (st.system === 'argon') { ctx.scale(1080 / 768, 1080 / 768); drawArgonPart(ctx, argon, id, scene, t, keys); }
      else if (skin) drawStableLook(ctx, id, st, scene, t, skin, keys);
      ctx.restore();
      continue;
    }
    if (!look) continue;
    ctx.save();
    ctx.translate(r[0], r[1]);
    ctx.scale(r[2] / st.w, r[3] / st.h);
    ctx.textBaseline = 'alphabetic';
    look(ctx, sd, st.w, st.h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';

  if (guides) drawGuides(ctx, W, H, layout, guides, u);   // preview only: outlines while arranging
  ctx.shadowBlur = 0;
  ctx.shadowColor = 'transparent';
}

function drawGuides(ctx, W, H, layout, guides, u) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1, 2 * u);
  for (const id of ORDER) {
    if (!layout[id].on) continue;
    const [x, y, w, h] = rectOf(id, layout, W, H);
    const sel = id === guides.selected, hot = id === guides.hover;
    if (!guides.all && !sel && !hot) continue;
    ctx.setLineDash(sel ? [] : [6 * u, 5 * u]);
    ctx.strokeStyle = sel ? '#ff6b8a' : hot ? '#ffffff' : 'rgba(255,255,255,0.35)';
    ctx.strokeRect(x, y, w, h);
    if (sel || hot) {
      ctx.setLineDash([]);
      ctx.font = `600 ${13 * Math.max(0.8, u)}px system-ui, sans-serif`;
      const label = WIDGETS[id].label, tw = ctx.measureText(label).width + 12 * u;
      ctx.fillStyle = sel ? '#ff6b8a' : '#fff';
      ctx.fillRect(x, Math.max(0, y - 20 * u), tw, 20 * u);
      ctx.fillStyle = '#111';
      ctx.fillText(label, x + 6 * u, Math.max(0, y - 20 * u) + 14 * u);
    }
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(255,107,138,0.8)';
  ctx.lineWidth = Math.max(1, u);
  if (guides.x != null) { ctx.beginPath(); ctx.moveTo(guides.x * W, 0); ctx.lineTo(guides.x * W, H); ctx.stroke(); }
  if (guides.y != null) { ctx.beginPath(); ctx.moveTo(0, guides.y * H); ctx.lineTo(W, guides.y * H); ctx.stroke(); }
  ctx.restore();
}

const FC_MS = 1400;
/** The "FULL COMBO" splash (the Fullcombo overlay's job): plays as the last object lands when the combo was never broken. */
function drawFullCombo(ctx, W, H, scene, t) {
  const tl = scene.hud?.timeline;
  if (!tl?.length || !scene.objects.length) return;
  const end = tl[tl.length - 1];
  if ((end.nMiss ?? 0) > 0 || !(end.combo > 0)) return;
  const p = (t - scene.objects[scene.objects.length - 1].t) / FC_MS;
  if (p < 0 || p > 1) return;
  const u = H / 1080, cx = W / 2, cy = H * 0.42;
  const grow = Math.min(1, p / 0.22), back = 1 + 2.2 * (grow - 1) ** 3 + 1.2 * (grow - 1) ** 2;   // easeOutBack
  const alpha = Math.min(1, p / 0.08, (1 - p) / 0.28);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.max(0, alpha);
  const band = ctx.createLinearGradient(0, cy - 160 * u, 0, cy + 160 * u);
  band.addColorStop(0, 'rgba(255,215,90,0)'); band.addColorStop(0.5, 'rgba(255,215,90,0.22)'); band.addColorStop(1, 'rgba(255,215,90,0)');
  ctx.fillStyle = band; ctx.fillRect(0, cy - 160 * u, W, 320 * u);
  ctx.translate(cx, cy); ctx.scale(back, back);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${150 * u}px "Exo 2", "Torus", system-ui, sans-serif`;
  ctx.shadowColor = 'rgba(255,190,60,0.9)'; ctx.shadowBlur = 40 * u;
  ctx.fillStyle = '#fff4cc'; ctx.fillText('FULL COMBO', 0, 0);
  ctx.shadowBlur = 0;
  const sweep = -1.2 + 2.6 * p, w = ctx.measureText('FULL COMBO').width;           // a bright sheen sweeping across the letters
  const g = ctx.createLinearGradient((sweep - 0.25) * w, 0, (sweep + 0.25) * w, 0);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = g; ctx.fillText('FULL COMBO', 0, 0);
  ctx.restore();
  ctx.globalAlpha = 1;
}

export function drawFrame(ctx, W, H, scene, track, t, opts = {}) {
  const { fullCombo = false, skin, showCatchWidth = false, showHud = false, hitLighting = false, style = 'overlay', bg = null, bgDim = 0.8, keys = null, argon = null, tosu = null, sb = null, makeCanvas = null, layout: customLayout = null, guides = null } = opts;
  const overlay = true;                                    // both HUD styles use the full-height playfield
  const { s, ox, oy } = layout(W, H, overlay);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#11131c');
  grad.addColorStop(1, '#0a0b10');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const sbBuf = sb && makeCanvas ? sbBuffer(ctx, makeCanvas, W, H, bgDim) : null;
  if (sbBuf) {
    // The storyboard sits under a heavy dim, so it is drawn at a lower resolution and scaled up: the cost is
    // mostly fill rate, and this cuts the pixels it fills by 2 to 5 times with no visible loss behind the dim.
    const g = sbBuf.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#0d0f16';
    g.fillRect(0, 0, sbBuf.w, sbBuf.h);
    if (bg && bg.videoWidth) drawBackground(g, sbBuf.w, sbBuf.h, bg, 0);
    sb.drawUnder(g, sbBuf.w, sbBuf.h, t);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(sbBuf.canvas, 0, 0, W, H);
  } else if (bg && !(sb && !bg.videoWidth)) drawBackground(ctx, W, H, bg, sb ? 0 : bgDim, makeCanvas ?? null);   // a storyboard replaces the still background image (a video still plays under it)
  if (sb) {                                                // the storyboard's Background / Pass / Foreground layers, then the dim over all of it
    if (!sbBuf) sb.drawUnder(ctx, W, H, t);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(0,0,0,${Math.min(1, Math.max(0, bgDim))})`;
    ctx.fillRect(0, 0, W, H);
  }
  ctx.setTransform(s, 0, 0, s, ox, oy);

  const objs = scene.objects;
  const preempt = scene.preempt;
  const tail = MISS_FADE_MS;
  const catcherX = track.xAt(t);

  if (skin) {
    const lo = lowerBound(objs, t - tail);
    let hi = lo;
    while (hi < objs.length && objs[hi].t <= t + preempt) hi++;

    // fruit stacked on the plate, and those flying off it (drawn beneath the falling objects)
    if (scene.plate) {
      for (const p of plateAt(scene.plate, t, catcherX)) drawFruitSprite(ctx, skin, scene, p.obj, p.x, p.y, CAUGHT_SCALE, p.alpha, 1, spinDeg(p.obj, scene, p.obj.t));
    }

    const hidden = !!((scene.mods ?? 0) & 8);              // the Hidden mod: fruit fade out on the way down
    // draw later objects first so earlier ones sit on top
    for (let i = hi - 1; i >= lo; i--) {
      const o = objs[i];
      const rem = o.t - t;
      const progress = 1 - rem / preempt;
      if (rem > 0) {
        const a = hidden ? hiddenAlpha(rem, preempt) : 1;
        if (a > 0) drawFruitSprite(ctx, skin, scene, o, o.x, FIELD_H * progress, 1, a, progress, spinDeg(o, scene, t));
      } else if (!o.caught && !hidden) {
        // a miss keeps falling while it fades out over 250 ms (DrawableCatchHitObject, ArmedState.Miss)
        const a = 1 - -rem / MISS_FADE_MS;
        if (a > 0) drawFruitSprite(ctx, skin, scene, o, o.x, FIELD_H * progress, 1, a, progress, spinDeg(o, scene, t));
      }
    }

    const fx = scene.fx;
    const state = fx ? catcherStateAt(fx, t) : 'idle';
    const amount = fx ? hyperAmount(fx, t) : 0;
    drawCatcher(ctx, skin, scene, catcherX, state, track.facingAt(t), { rgb: amount > 0.001 ? mixRgb(skin.hyperColours.dash, amount) : null });
    if (fx) drawTrails(ctx, skin, scene, fx, t);
    if (hitLighting) drawHitLighting(ctx, skin, scene, t, catcherX);
    if ((scene.mods ?? 0) & 1024) drawFlashlight(ctx, scene, t, catcherX, FIELD_H);   // the Flashlight mod
  }

  if (sb) sb.drawOver(ctx, W, H, t);                       // the Overlay layer sits above the fruit
  ctx.setTransform(s, 0, 0, s, ox, oy);

  if (showCatchWidth) {
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 3 / s;
    ctx.beginPath();
    ctx.moveTo(catcherX - scene.catchWidth / 2, FIELD_H);
    ctx.lineTo(catcherX + scene.catchWidth / 2, FIELD_H);
    ctx.stroke();
  }

  if (showHud && style === 'argon') drawArgonHud(ctx, W, H, scene, t, argon, { keys });
  else if (showHud && style === 'stable' && skin) drawStableHud(ctx, W, H, scene, t, skin, keys);
  else if (showHud && customLayout && (style === 'custom' || style === 'overlay')) drawCustom(ctx, W, H, scene, t, { layout: customLayout, tosu, keys, skin, bg, guides, argon });
  else if (showHud) drawOverlay(ctx, W, H, scene, t, { bg, keys, tosu, skin });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (fullCombo) drawFullCombo(ctx, W, H, scene, t);
}
