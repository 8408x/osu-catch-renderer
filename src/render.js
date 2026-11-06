// Draws one frame of the catch playfield onto a 2D canvas context, using skin textures.
// Pure function of (scene, replay track, skin, time): the same code drives the live preview
// and the offline MP4 export, so what you preview is what gets encoded.
//
// Sizes and placement follow osu!lazer's legacy catch skin:
//   - fruit / droplet sprite = texture size (@2x halved) x the beatmap's fruit scale (from CS)
//   - droplets use 0.8x and tiny droplets 0.4x of that; sprites are capped at 160 px
//   - catcher sprite = texture size x 0.35 x catcher scale, hung from the plate line 16 px down

import { FIELD_W, FIELD_H } from './catch.js';
import { hyperAmount, catcherStateAt, TRAIL_LIFE_MS, AFTERIMAGE_LIFE_MS } from './catcher.js';
import { hudAt } from './score.js';
import { plateAt, explosionsAt } from './plate.js';
import { drawArgonHud } from './argon.js';
import { livePp } from './pp.js';
import { keysAt } from './keys.js';

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
  const k = o.kind === 'fruit' ? 1 : o.kind === 'droplet' ? 0.8 : 0.4;
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
  const { dash, afterImage } = skin.hyperColours;
  for (let i = lo; i < trails.length && trails[i].t <= t; i++) {
    const e = trails[i];
    const age = t - e.t;
    if (e.kind === 'after') {
      const p = age / AFTERIMAGE_LIFE_MS;
      drawCatcher(ctx, skin, scene, e.x, e.state, e.facing, {
        rgb: afterImage, alpha: 1 - p, scale: lerp(0.95, 1.2, p * p), dy: -10 * p * p, additive: true,
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

/** Cover-fit the beatmap background over the whole frame and darken it. */
function drawBackground(ctx, W, H, img, dim) {
  const iw = img.width, ih = img.height;
  if (!iw || !ih) return;
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

function drawOverlay(ctx, W, H, scene, t, { bg, keys }) {
  const u = H / 1080;
  const v = scene.hud ? hudAt(scene.hud, t) : null;
  const meta = scene.meta ?? {};
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.shadowColor = 'rgba(0,0,0,0.65)';
  ctx.shadowBlur = 6 * u;

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

  // --- key overlay, right edge: left, right, dash, and a spare box ---
  if (keys) {
    const ks = keysAt(keys, t);
    const size = 56 * u, gap = 10 * u, kx = W - size - 8 * u;
    const top = H * 0.5 - (4 * size + 3 * gap) / 2 + 36 * u;
    const specs = [
      { k: ks.left, fill: '#ffe14d' }, { k: ks.right, fill: '#ffe14d' }, { k: ks.dash, fill: '#ff7ab8' }, { k: null, fill: '#8a8d96' },
    ];
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
export function drawFrame(ctx, W, H, scene, track, t, opts = {}) {
  const { skin, showCatchWidth = false, showHud = false, hitLighting = false, style = 'overlay', bg = null, bgDim = 0.8, keys = null, argon = null } = opts;
  const overlay = true;                                    // both HUD styles use the full-height playfield
  const { s, ox, oy } = layout(W, H, overlay);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#11131c');
  grad.addColorStop(1, '#0a0b10');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  if (bg) drawBackground(ctx, W, H, bg, bgDim);
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

    // draw later objects first so earlier ones sit on top
    for (let i = hi - 1; i >= lo; i--) {
      const o = objs[i];
      const rem = o.t - t;
      const progress = 1 - rem / preempt;
      if (rem > 0) {
        drawFruitSprite(ctx, skin, scene, o, o.x, FIELD_H * progress, 1, 1, progress, spinDeg(o, scene, t));
      } else if (!o.caught) {
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
  }

  if (showCatchWidth) {
    ctx.strokeStyle = '#ff4d6d';
    ctx.lineWidth = 3 / s;
    ctx.beginPath();
    ctx.moveTo(catcherX - scene.catchWidth / 2, FIELD_H);
    ctx.lineTo(catcherX + scene.catchWidth / 2, FIELD_H);
    ctx.stroke();
  }

  if (showHud && style === 'argon') drawArgonHud(ctx, W, H, scene, t, argon, { keys });
  else if (showHud) drawOverlay(ctx, W, H, scene, t, { bg, keys });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
