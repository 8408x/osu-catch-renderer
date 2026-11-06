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
import { hudAt, scoreShownAt } from './score.js';
import { plateAt, explosionsAt } from './plate.js';
import { healthAt } from './health.js';

const ZONE = 120;  // room below the field for the catcher, in field units
const PAD = 12;
const MISS_FADE_MS = 250;          // DrawableCatchHitObject: FadeOut(250) on a miss
const HYPER_GLOW_SCALE = 1.2, HYPER_GLOW_ALPHA = 0.7; // LegacyCatchHitObjectPiece.hyperSprite
const BANANA_END_SCALE = 0.6;
const MAX_SPRITE = 160;
const FRUIT_NAMES = ['pear', 'grapes', 'apple', 'orange']; // chosen by (index in beatmap) % 4
const CAUGHT_SCALE = 0.5;                                   // lazer: caught_fruit_scale_adjust

export function layout(W, H) {
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


// ---------- HUD (osu!'s legacy skin layout: combo bottom-left, accuracy top-right) ----------
const HUD_GLYPH = { ',': 'comma', '.': 'dot', '%': 'percent', x: 'x' };
const HUD_POP_MS = 300;

/** Glyph textures for a font prefix; falls back to osu!'s own `score` numbers when the skin renamed the prefix but lacks the images. */
function glyphFor(skin, prefix, ch) {
  const key = HUD_GLYPH[ch] ?? ch;
  return skin.get(`${prefix}-${key}`) ?? (prefix !== 'score' ? skin.get(`score-${key}`) : null);
}

/**
 * Draw a string of skin number glyphs. `anchor` 'left' | 'right' places the text's bottom edge (or top for
 * `fromTop`) at (x, y). Digits share the width of '5' when `fixed`, like osu!'s score font.
 */
function drawGlyphs(ctx, skin, prefix, text, x, y, k, { anchor = 'left', fromTop = false, fixed = false, overlap = 0, alpha = 1, additive = false } = {}) {
  const glyphs = [...text].map((ch) => glyphFor(skin, prefix, ch));
  if (glyphs.some((g) => !g)) return;
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
}

/** A plain health bar (the real skins' scorebar images are not used): dark track, fill that turns amber then red when low. */
function drawHealthBar(ctx, hp, x, y, w, h) {
  const r = h / 2;
  const pill = (px, pw) => {
    ctx.beginPath();
    ctx.moveTo(px + r, y);
    ctx.lineTo(px + pw - r, y);
    ctx.arc(px + pw - r, y + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(px + r, y + h);
    ctx.arc(px + r, y + r, r, Math.PI / 2, Math.PI * 1.5);
    ctx.closePath();
  };
  ctx.save();
  ctx.globalAlpha = 1;
  pill(x, w);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fill();
  const fillW = Math.max(0, Math.min(1, hp)) * w;
  if (fillW > 0) {
    ctx.save();
    pill(x, w);
    ctx.clip();
    ctx.fillStyle = hp > 0.5 ? '#ffffff' : hp > 0.25 ? '#ffc94d' : '#ff5555';
    ctx.fillRect(x, y, fillW, h);
    ctx.restore();
  }
  pill(x, w);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = Math.max(1, h / 7);
  ctx.stroke();
  ctx.restore();
}

function drawHud(ctx, W, H, scene, t, skin) {
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
  drawGlyphs(ctx, skin, scorePrefix, `${(v.acc * 100).toFixed(2)}%`, W - 17 * u, scoreH + 9 * u, 0.6 * 0.96 * u,
    { anchor: 'right', fromTop: true, fixed: true, overlap: scoreOverlap });

  // health bar, top left
  if (scene.health) drawHealthBar(ctx, healthAt(scene.health, t), 10 * u, 10 * u, 340 * u, 14 * u);

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
 * @param {{text?: string, text2?: string}} [info] optional overlay text
 * @param {{skin: import('./skin.js').Skin, showCatchWidth?: boolean}} opts
 */
export function drawFrame(ctx, W, H, scene, track, t, info = {}, opts = {}) {
  const { skin, showCatchWidth = false, showHud = false, hitLighting = false } = opts;
  const { s, ox, oy } = layout(W, H);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#11131c');
  bg.addColorStop(1, '#0a0b10');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.setTransform(s, 0, 0, s, ox, oy);
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  ctx.fillRect(0, 0, FIELD_W, FIELD_H + ZONE);
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 1.5 / s;
  ctx.strokeRect(0, 0, FIELD_W, FIELD_H + ZONE);

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

  if (showHud && skin) drawHud(ctx, W, H, scene, t, skin);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (info.text || info.text2) {
    const size = Math.max(11, Math.round(H / 42));
    ctx.font = `${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    if (info.text) ctx.fillText(info.text, size, size);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    if (info.text2) ctx.fillText(info.text2, size, size * 2.4);
  }
}
