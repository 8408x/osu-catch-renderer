// osu!lazer's default ("Argon") gameplay HUD, drawn on the canvas. Layout, sizes and behaviour follow ppy/osu:
//   ArgonSkin (positions), ArgonCounterTextComponent (segmented digits + wireframes), ArgonScoreCounter,
//   ArgonAccuracyCounter, ArgonPerformancePointsCounter, ArgonComboCounter, ArgonHealthDisplay (+ the ArgonBarPath
//   shader for its shape), ArgonWedgePiece, ArgonSongProgress.
// Everything is laid out in osu!'s virtual 768-unit-high screen and scaled to the frame. Approximations: the labels
// and times use the system UI font instead of Torus, the key boxes are a plain stand-in (replays only store x and
// dash), and the HP bar's tube is built from a few strokes instead of the real distance shader.

import { hudAt, scoreShownAt } from './score.js?v=20261107i';
import { healthAt } from './health.js?v=20261107i';
import { livePp } from './pp.js?v=20261107i';
import { keysAt } from './keys.js?v=20261107i';

const FILES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'dot', 'percentage', 'x', 'wireframes'];
const GLYPH_SCALE = 0.125;                       // TexturedCharacterGlyph(..., 0.125f): 240 px textures -> 30 units
const GLYPH_H = 30;
const SPACING = -2;
const LABEL_FONT = '700 12px "Segoe UI", system-ui, -apple-system, sans-serif';
const INFO_FONT = '700 18px "Segoe UI", system-ui, -apple-system, sans-serif';
const BLUE0 = '#99ddff';                         // OsuColour.Blue0, the label colour
const WIREFRAME_ALPHA = 0.25;
const outQuint = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 5);
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/** Load the Argon digit images. @returns {Promise<{img: Map<string, any>, createCanvas: Function, tinted: Map}>} */
export async function loadArgonFonts(env, fetchBytes, base = 'assets/argon/') {
  const img = new Map();
  await Promise.all(FILES.map(async (n) => { img.set(n, await env.decode(await fetchBytes(`${base}argon-counter-${n}.png`))); }));
  return { img, createCanvas: env.createCanvas, tinted: new Map() };
}

const glyphKey = (c) => (c === '.' ? 'dot' : c === '%' ? 'percentage' : c);
const glyphW = (G, c) => (G.img.get(glyphKey(c))?.width ?? 240) * GLYPH_SCALE;
const advance = (G, c) => glyphW(G, c) + SPACING;
const textWidth = (G, str) => [...str].reduce((a, c) => a + advance(G, c), 0);

/** A copy of one glyph tinted a flat colour (cached). */
function tintedGlyph(G, key, colour) {
  const id = `${key}|${colour}`;
  let c = G.tinted.get(id);
  if (!c) {
    const src = G.img.get(key);
    c = G.createCanvas(src.width, src.height);
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = colour;
    g.fillRect(0, 0, c.width, c.height);
    G.tinted.set(id, c);
  }
  return c;
}

/** Draw segmented digits with their left edge at x, top at y. `mix` blends toward `colour` (0..1). */
function drawDigits(ctx, G, str, x, y, { alpha = 1, wire = false, colour = null, mix = 0 } = {}) {
  let cx = x;
  for (const c of str) {
    const key = wire && c !== '.' ? 'wireframes' : glyphKey(c);
    const im = G.img.get(key);
    if (im) {
      const w = im.width * GLYPH_SCALE, h = im.height * GLYPH_SCALE;
      ctx.globalAlpha = alpha * (colour && mix > 0 ? 1 - mix : 1);
      ctx.drawImage(im, cx, y, w, h);
      if (colour && mix > 0) {
        ctx.globalAlpha = alpha * mix;
        ctx.drawImage(tintedGlyph(G, key, colour), cx, y, w, h);
      }
    }
    cx += advance(G, c);
  }
  ctx.globalAlpha = 1;
}

/**
 * ArgonCounterTextComponent: a wireframe template behind the text, both right-aligned at `right` (or left-aligned at
 * `left`). Returns the width used.
 */
function drawCounter(ctx, G, text, template, { left, right, top, scale = 1, colour, mix }) {
  const w = Math.max(textWidth(G, text), textWidth(G, template));
  const x0 = right !== undefined ? right - w * scale : left;
  ctx.save();
  ctx.translate(x0, top);
  ctx.scale(scale, scale);
  const wTemplate = textWidth(G, template), wText = textWidth(G, text);
  drawDigits(ctx, G, template, w - wTemplate, 0, { alpha: WIREFRAME_ALPHA, wire: true });
  drawDigits(ctx, G, text, w - wText, 0, { colour, mix });
  ctx.restore();
  return w * scale;
}

function label(ctx, text, x, y, scale = 1) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.font = LABEL_FONT;
  ctx.fillStyle = BLUE0;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(text, 2.5, 1);
  ctx.restore();
}

const rr = (ctx, x, y, w, h, r) => {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// ---------- wedges behind the score (ArgonWedgePiece: 380x72, shear 0.8, corner radius 10) ----------
function drawWedge(ctx, x, y) {
  ctx.save();
  ctx.transform(1, 0, 0.8, 1, x, y);              // shear along x about the top-left corner
  const g = ctx.createLinearGradient(0, 0, 0, 72);
  g.addColorStop(0, 'rgba(102,204,255,0)');
  g.addColorStop(1, 'rgba(102,204,255,0.25)');
  ctx.fillStyle = g;
  rr(ctx, 0, 0, 380, 72, 10);
  ctx.fill();
  ctx.restore();
}

// ---------- health bar (ArgonHealthDisplay at (50, 20), width 300, bar height 30; path from the ArgonBarPath shader) ----------
const HB = { x: 50, y: 20, w: 300, h: 50, r: 10 };
const HB_P = [[10, 10], [220, 10], [250, 40], [290, 40]];
const HB_LEN = 210 + Math.hypot(30, 30) + 40;

function healthPath(ctx) {
  ctx.beginPath();
  ctx.moveTo(HB.x + HB_P[0][0], HB.y + HB_P[0][1]);
  ctx.arcTo(HB.x + HB_P[1][0], HB.y + HB_P[1][1], HB.x + HB_P[2][0], HB.y + HB_P[2][1], 14);
  ctx.arcTo(HB.x + HB_P[2][0], HB.y + HB_P[2][1], HB.x + HB_P[3][0], HB.y + HB_P[3][1], 14);
  ctx.lineTo(HB.x + HB_P[3][0], HB.y + HB_P[3][1]);
}

/** Stroke the part [from, to] (0..1) of the health path. */
function strokeHealth(ctx, from, to, width, style, additive) {
  if (to <= from) return;
  ctx.save();
  if (additive) ctx.globalCompositeOperation = 'lighter';
  healthPath(ctx);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([(to - from) * HB_LEN, HB_LEN * 2]);
  ctx.lineDashOffset = -from * HB_LEN;
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.stroke();
  ctx.restore();
}

function drawHealth(ctx, scene, t) {
  if (!scene.health) return;
  const hp = clamp(healthAt(scene.health, t), 0, 1);
  // the empty tube: a white rim around a dark, translucent inside
  strokeHealth(ctx, 0, 1, 20, 'rgba(255,255,255,0.85)', false);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  strokeHealth(ctx, 0, 1, 17.5, 'rgba(34,36,46,0.92)', false);
  strokeHealth(ctx, 0, 1, 10, 'rgba(18,19,26,0.8)', false);
  ctx.restore();
  // damage: after a miss the lost part stays red for a moment (the real bar holds it 500 ms)
  const before = clamp(healthAt(scene.health, t - 350), 0, 1);
  if (before - hp > 0.02) strokeHealth(ctx, hp, before, 20, 'rgba(255,93,93,0.85)', true);
  if (hp > 0) {
    strokeHealth(ctx, 0, hp, 20, 'rgba(126,215,253,0.28)', true);          // glow
    strokeHealth(ctx, 0, hp, 12, '#ffffff', true);                         // bar
  }
  // the short line joining the bar to the screen edge (BoxElement 45x3, corner radius 0.5)
  ctx.fillStyle = '#fff';
  rr(ctx, 0, HB.y + HB.r - 1.5, 45, 3, 1.5);
  ctx.fill();
}

// ---------- the counters ----------
function drawScore(ctx, G, v, t) {
  const digits = String(scoreShownAt(v, t));
  drawCounter(ctx, G, digits, '#'.repeat(Math.max(6, digits.length)), { right: 250, top: 50 });
}

function drawAccuracy(ctx, G, acc, vw) {
  const [whole, frac] = (acc * 100).toFixed(2).split('.');
  const right = vw - 20, top = 20;
  const wholeW = Math.max(textWidth(G, whole), textWidth(G, '###'));
  const fracW = Math.max(textWidth(G, `.${frac}`), textWidth(G, '.##')) * 0.5;
  const pctW = textWidth(G, '%');
  const x0 = right - (wholeW + fracW + pctW);
  label(ctx, 'ACCURACY', x0, top);
  drawCounter(ctx, G, whole, '###', { right: x0 + wholeW, top: top + 12 });
  drawCounter(ctx, G, `.${frac}`, '.##', { left: x0 + wholeW, top: top + 12 * 2 + 4, scale: 0.5 });
  drawCounter(ctx, G, '%', '#', { left: x0 + wholeW + fracW, top: top + 12 });
}

function drawPerformance(ctx, G, scene, v, t, vw) {
  if (!scene.diff) return;
  const text = String(Math.round(v ? livePp(scene.diff, scene, v, t) : 0));
  const k = 0.8, right = vw - 20, top = 20 + 12 + GLYPH_H + 10;
  const tpl = '#'.repeat(Math.max(3, text.length));
  const w = Math.max(textWidth(G, text), textWidth(G, tpl));
  label(ctx, 'PP', right - w * k, top, k);
  drawCounter(ctx, G, text, tpl, { right, top: top + 12 * k, scale: k });
}

function drawCombo(ctx, G, scene, v, t, vh) {
  const k = 1.3, bottom = vh - 66, left = 36;
  const text = `${v.combo}x`;
  const tl = scene.hud?.timeline ?? [];
  // bump on a gain, shrink and flash red on a miss (ArgonComboCounter)
  let scale = 1, mix = 0, red = '#ff0000';
  const age = t - v.bumpT;
  const idx = tl.indexOf(v);
  const missed = v.combo === 0 && idx > 0 && tl[idx - 1].combo > 1;
  if (missed) {
    const a = (t - v.t) / 2000;
    if (a >= 0 && a < 1) { scale = 1 - 0.2 * (1 - outQuint(a)); mix = 1 - outQuint(a); }
  } else if (age >= 0 && age < 500) {
    scale = 1 + 0.1 * (1 - outQuint(age / 500));
  }
  const compH = 12 + GLYPH_H;
  const top = bottom - compH * k;
  ctx.save();
  ctx.translate(left, top);
  ctx.scale(k, k);
  label(ctx, 'COMBO', 0, 0);
  ctx.translate(0, 12);
  ctx.scale(scale, scale);
  drawCounter(ctx, G, text, '#'.repeat(text.length), { left: 0, top: 0, colour: red, mix });
  ctx.restore();
}

// ---------- song progress (bottom, 90% wide) with a small density graph, times, and a stand-in key counter ----------
const timeStr = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function drawProgress(ctx, scene, t, vw, vh) {
  const objs = scene.objects;
  if (!objs.length) return;
  const start = objs[0].t, end = objs[objs.length - 1].t;
  const w = vw * 0.9, x = (vw - w) / 2, barH = 10, bottom = vh - 10;
  const p = clamp((t - start) / Math.max(1, end - start), 0, 1);

  // density graph (additive), a stand-in for the difficulty graph
  const bins = Math.max(10, Math.floor(w / 6));
  const count = new Array(bins).fill(0);
  for (const o of objs) count[Math.min(bins - 1, Math.floor(((o.t - start) / Math.max(1, end - start)) * bins))]++;
  const peak = Math.max(1, ...count);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  const bw = w / bins;
  for (let i = 0; i < bins; i++) {
    const h = 6 + (count[i] / peak) * 22;
    ctx.fillRect(x + i * bw + 0.5, bottom - barH - h, bw - 1, h);
  }
  ctx.restore();

  // bar: dim track, light fill
  ctx.fillStyle = 'rgba(51,51,51,0.75)';
  rr(ctx, x, bottom - barH, w, barH, 5);
  ctx.fill();
  if (p > 0) {
    ctx.fillStyle = '#e6e6e6';
    rr(ctx, x, bottom - barH, Math.max(barH, w * p), barH, 5);
    ctx.fill();
  }

  // elapsed (left) and remaining (right)
  ctx.font = INFO_FONT;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillText(timeStr(Math.max(0, t - start)), x, bottom - barH - 4);
  ctx.textAlign = 'right';
  ctx.fillText(`-${timeStr(Math.max(0, end - Math.max(t, start)))}`, x + w, bottom - barH - 4);
  ctx.textAlign = 'left';
}

function drawKeys(ctx, keys, t, vw, vh) {
  if (!keys) return;
  const ks = keysAt(keys, t);
  const items = [['L', ks.left], ['R', ks.right], ['D', ks.dash]];
  const w = 46, h = 56, gap = 4;
  const right = vw - 36, top = vh - 66 - 36 - h;
  items.forEach(([name, k], i) => {
    const x = right - (items.length - i) * w - (items.length - 1 - i) * gap;
    ctx.fillStyle = k.down ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.35)';
    rr(ctx, x, top, w, h, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    rr(ctx, x, top, w, h, 6);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = k.down ? '#111' : '#fff';
    ctx.font = INFO_FONT;
    ctx.fillText(String(k.count), x + w / 2, top + h / 2 + 4);
    ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = k.down ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)';
    ctx.fillText(name, x + w / 2, top + h - 8);
  });
  ctx.textAlign = 'left';
}

/** Draw the whole Argon HUD over the frame. `G` comes from loadArgonFonts(). */
export function drawArgonHud(ctx, W, H, scene, t, G, { keys = null } = {}) {
  if (!G || !scene.hud) return;
  const s = H / 768, vw = W / s, vh = 768;
  const v = hudAt(scene.hud, t);
  ctx.save();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.globalAlpha = 1;
  drawWedge(ctx, -50, 15);
  drawWedge(ctx, -46, 20);
  drawHealth(ctx, scene, t);
  drawScore(ctx, G, v, t);
  drawAccuracy(ctx, G, v.acc, vw);
  drawPerformance(ctx, G, scene, v, t, vw);
  drawCombo(ctx, G, scene, v, t, vh);
  drawProgress(ctx, scene, t, vw, vh);
  drawKeys(ctx, keys, t, vw, vh);
  ctx.restore();
}
