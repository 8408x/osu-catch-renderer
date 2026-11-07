// Canvas drawings for the Custom style's widget looks. Each look recreates the layout of a community tosu overlay
// (credited in layout.js and CREDITS.md) in this site's own code; no overlay code or images are copied. A draw function
// works in the style's natural size (see layout.js): the caller translates and scales the canvas to fit.

import { tosuTokens } from './tosu.js?v=20261108s';
import { hudAt } from './score.js?v=20261108s';
import { healthAt } from './health.js?v=20261108s';
import { livePp, ppAtAccuracy } from './pp.js?v=20261108s';
import { keysAt } from './keys.js?v=20261108s';

const SANS = '"Exo 2", "Torus", "Segoe UI", system-ui, -apple-system, sans-serif';
const MONO = '"Roboto Mono", ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';
const GREEN = '#43c957', BLUE = '#5b63e6', RED = '#e24b57', PURPLE = '#7a35c9';

const fmt1 = (n) => String(Number((n ?? 0).toFixed(1)));
const clock = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

/** Everything a look can show at time t. */
export function styleData(scene, t, bg, keys) {
  const tok = tosuTokens(scene, t);
  const v = scene.hud ? hudAt(scene.hud, t) : { n300: 0, n100: 0, n50: 0, nMiss: 0, combo: 0, maxCombo: 0 };
  const m = scene.meta ?? {};
  return {
    tok, v, bg, t, scene,
    health: scene.health ? Math.max(0, Math.min(1, healthAt(scene.health, t))) : 1,
    player: scene.player ?? '',
    key: keys ? keysAt(keys, t) : null,
    pp: tok.ppIfMapEndsNow, ppFc: tok.ppIfRestFced,
    title: m.title ?? '', artist: m.artistUnicode ?? m.artist ?? '', diff: m.version ?? '', mapper: m.creator ?? '',
    cs: m.cs ?? 0, ar: m.ar ?? 0, od: m.od ?? 0, hp: m.hp ?? 0, bpm: m.bpm ?? 0, length: m.lengthMs ?? 0, stars: scene.diff?.star ?? 0,
    progress: tok.pct,
    elapsed: Math.max(0, t - (scene.objects[0]?.t ?? 0)),
    total: Math.max(0, (scene.objects[scene.objects.length - 1]?.t ?? 0) - (scene.objects[0]?.t ?? 0)),
  };
}

function rr(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Text that shrinks (then gets an ellipsis) until it fits in maxW. */
function fit(ctx, text, maxW, size, weight = 700, family = SANS, min = 0.62) {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (ctx.measureText(text).width > maxW && s > size * min) { s -= 1; ctx.font = `${weight} ${s}px ${family}`; }
  if (ctx.measureText(text).width <= maxW) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) out = out.slice(0, -1);
  return `${out}…`;
}

/** The map picture cropped to fill a rounded rectangle, darkened for text. */
function cover(ctx, bg, x, y, w, h, r, dark = 0.5, blur = 0) {
  ctx.save();
  rr(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = '#20222c';
  ctx.fillRect(x, y, w, h);
  const bw = bg?.videoWidth || bg?.width, bh = bg?.videoHeight || bg?.height;
  if (bw && bh) {
    const k = Math.max(w / bw, h / bh);
    if (blur && 'filter' in ctx) ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(bg, x + (w - bw * k) / 2, y + (h - bh * k) / 2, bw * k, bh * k);
    ctx.filter = 'none';
  }
  ctx.fillStyle = `rgba(0,0,0,${dark})`;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

const text = (ctx, s, x, y, { size = 20, weight = 700, family = SANS, fill = '#fff', align = 'left', shadow = true, maxW = 0 } = {}) => {
  if (maxW) { s = fit(ctx, s, maxW, size, weight, family, 0.5); size = Number(/(\d+(?:\.\d+)?)px/.exec(ctx.font)[1]); }
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.textAlign = align;
  ctx.fillStyle = fill;
  ctx.shadowColor = shadow ? 'rgba(0,0,0,0.55)' : 'transparent';
  ctx.shadowBlur = shadow ? 4 : 0;
  ctx.fillText(s, x, y);
  ctx.shadowBlur = 0;
};

/** "00123" with the leading zeros dimmed, as a vertigo-style counter. */
function paddedNumber(ctx, n, cx, y, digits, size) {
  const str = String(Math.max(0, Math.round(n))).padStart(digits, '0');
  const lead = str.length - String(Math.max(0, Math.round(n))).length;
  ctx.font = `600 ${size}px ${MONO}`;
  const cw = ctx.measureText('0').width, x0 = cx - (cw * str.length) / 2;
  ctx.textAlign = 'left';
  [...str].forEach((ch, i) => { ctx.fillStyle = i < lead ? 'rgba(255,255,255,0.28)' : '#fff'; ctx.fillText(ch, x0 + i * cw, y); });
}


/** pp over the whole map (about 90 samples) and the moments of the misses, worked out once per scene for the graph looks. */
const ppSeries = new WeakMap();
function seriesOf(scene) {
  let s = ppSeries.get(scene);
  if (s) return s;
  const objs = scene.objects, first = objs[0]?.t ?? 0, last = objs[objs.length - 1]?.t ?? 1;
  const pts = [], misses = [];
  if (scene.diff && scene.hud) {
    for (let i = 0; i <= 90; i++) {
      const ts = first + ((last - first) * i) / 90;
      pts.push(livePp(scene.diff, scene, hudAt(scene.hud, ts), ts));
    }
    let prev = 0;
    for (const e of scene.hud.timeline) { if ((e.nMiss ?? 0) > prev) { prev = e.nMiss; if (misses.length < 60) misses.push((e.t - first) / Math.max(1, last - first)); } }
  }
  s = { pts, misses, max: Math.max(1, scene.maxPp ?? 0, ...pts) };
  ppSeries.set(scene, s);
  return s;
}

const grouped = (n) => String(Math.max(0, Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const ring = (ctx, cx, cy, r, f, colour = '#fff') => {      // a clock-style pie: an outline with a filling wedge
  ctx.strokeStyle = colour; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = colour; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r - 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * f); ctx.closePath(); ctx.fill();
};
/** A rounded corner patch (pink into purple) hugging one corner of the box, as the VictimCrasherOverlay uses. */
function blob(ctx, W, H, corner) {
  ctx.save();
  ctx.translate(corner.includes('r') ? W : 0, corner.includes('b') ? H : 0);
  ctx.scale(corner.includes('r') ? -1 : 1, corner.includes('b') ? -1 : 1);
  const g = ctx.createLinearGradient(0, corner.includes('b') ? H : 0, 0, corner.includes('b') ? 0 : H);
  g.addColorStop(0, '#ff7a8a'); g.addColorStop(1, '#8a2fa8');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W, 0); ctx.bezierCurveTo(W * 0.92, H * 0.5, W * 0.55, H, 0, H); ctx.closePath(); ctx.fill();
  ctx.restore();
}

const LOOKS = {
  title: {
    // paradox by mofuries: a round cover, artist and title, the difficulty with its length, and a row of stat chips
    paradox(ctx, d, W, H) {
      ctx.save(); ctx.beginPath(); ctx.arc(52, 52, 50, 0, Math.PI * 2); ctx.clip();
      cover(ctx, d.bg, 2, 2, 100, 100, 0, 0.25);
      ctx.restore();
      text(ctx, d.artist, 118, 34, { size: 22, weight: 300, fill: 'rgba(255,255,255,0.85)', maxW: W - 130 });
      text(ctx, d.title, 118, 72, { size: 33, weight: 500, maxW: W - 130 });
      ctx.fillStyle = 'rgba(28,24,48,0.85)'; rr(ctx, 118, 84, 168, 28, 14); ctx.fill();
      text(ctx, `${d.diff} (${clock(d.length)})`, 130, 105, { size: 18, weight: 500, shadow: false, maxW: 148 });
      text(ctx, `// ${d.mapper}`, 300, 105, { size: 20, weight: 400, maxW: W - 310 });
      [['CS', fmt1(d.cs)], ['AR', fmt1(d.ar)], ['★', d.stars.toFixed(2)], ['OD', fmt1(d.od)], ['HP', fmt1(d.hp)]].forEach(([label, v], i) => {
        const x = 6 + i * 108, star = label === '★', w = star ? 150 : 100;
        const xx = i > 2 ? x + 50 : x;
        ctx.fillStyle = star ? '#2a39e0' : 'rgba(34,30,56,0.85)'; rr(ctx, xx, 126, w - (star ? 0 : 6), 36, 9); ctx.fill();
        text(ctx, `${label} ${v}`, xx + (w - (star ? 0 : 6)) / 2, 152, { size: 22, weight: star ? 700 : 400, align: 'center', shadow: false });
      });
    },
    // VictimCrasherOverlay: the top-left patch with the player's name
    victim(ctx, d, W, H) {
      blob(ctx, W, H, 'tl');
      text(ctx, 'player:', 16, 46, { size: 20, weight: 600 });
      text(ctx, d.player || d.title, 16, 84, { size: 36, weight: 800, maxW: W - 90 });
    },
    // Kerli 1 by Dartandr: the title over four underlined difficulty values
    kerli1(ctx, d, W, H) {
      cover(ctx, d.bg, 0, 0, W, H, 14, 0.5);
      text(ctx, `${d.artist} - ${d.title}`, W / 2, 50, { maxW: W - 60, size: 38, align: 'center' });
      const stats = [[`CS: ${fmt1(d.cs)}`, '#a8963a'], [`AR: ${fmt1(d.ar)}`, '#43a047'], [`OD: ${fmt1(d.od)}`, '#2fa4b8'], [`HP: ${fmt1(d.hp)}`, '#c2336e']];
      stats.forEach(([label, colour], i) => {
        const cx = W * (0.17 + i * 0.22);
        text(ctx, label, cx, 94, { size: 27, align: 'center' });
        ctx.fillStyle = colour;
        rr(ctx, cx - 52, 104, 104, 7, 3.5); ctx.fill();
      });
    },
    // reComfortaa by Dartandr: a soft pill with the title, then difficulty and mapper
    recomfortaa(ctx, d, W, H) {
      cover(ctx, d.bg, 0, 0, W, H, H / 2, 0.45, 5);
      text(ctx, `${d.title} - ${d.artist}`, W / 2, 66, { maxW: W - 100, size: 42, weight: 400, align: 'center' });
      const parts = [['difficulty ', 400], [d.diff, 800], ['  ♥  ', 400, '#ff5c8a'], ['mapper ', 400], [d.mapper, 800]];
      ctx.font = `400 24px ${SANS}`;
      const widths = parts.map(([s, wt]) => { ctx.font = `${wt} 24px ${SANS}`; return ctx.measureText(s).width; });
      const total = widths.reduce((a, b) => a + b, 0), scale = Math.min(1, (W - 140) / total);
      let x = W / 2 - (total * scale) / 2;
      parts.forEach(([s, wt, fill], i) => { text(ctx, s, x, 104, { size: 24 * scale, weight: wt, fill: fill ?? 'rgba(255,255,255,0.92)' }); x += widths[i] * scale; });
    },
    // Map Display (author unknown): a white bar with the map in a dark capsule in the middle
    mapdisplay(ctx, d, W, H) {
      ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 6;
      ctx.fillStyle = '#f3f3f6'; rr(ctx, 0, 0, W, H, H / 2); ctx.fill();
      ctx.shadowBlur = 0;
      const cx = 250, cw = W - 500;
      cover(ctx, d.bg, cx, 5, cw, H - 10, (H - 10) / 2, 0.55);
      text(ctx, `${d.artist} - ${d.title}`, W / 2, 38, { maxW: cw - 50, size: 26, align: 'center' });
      text(ctx, `mapper ${d.mapper}    difficulty ${d.diff}`, W / 2, 62, { maxW: cw - 50, size: 16, weight: 500, align: 'center', fill: 'rgba(255,255,255,0.85)' });
      const ink = '#55565e';
      text(ctx, `length ${clock(d.length)}`, 44, 37, { size: 19, weight: 500, fill: ink, shadow: false });
      text(ctx, `bpm ${Math.round(d.bpm)}`, 44, 62, { size: 19, weight: 500, fill: ink, shadow: false });
      text(ctx, `CS ${fmt1(d.cs)} / AR ${fmt1(d.ar)} / OD ${fmt1(d.od)}`, W - 44, 37, { size: 19, weight: 500, fill: ink, align: 'right', shadow: false });
      text(ctx, `Star Rating ${(d.stars || 0).toFixed(2)}`, W - 44, 62, { size: 19, weight: 500, fill: ink, align: 'right', shadow: false });
    },
  },

  pp: {
    // InGame1 by Dartandr: pp over three counts, each with a coloured dot
    ingame1(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(0,0,0,0.62)'; rr(ctx, 0, 0, W, H, 12); ctx.fill();
      ctx.font = `700 60px ${SANS}`;
      const num = String(d.pp), nw = ctx.measureText(num).width;
      ctx.font = `700 44px ${SANS}`;
      const pw = ctx.measureText('pp').width, x0 = W / 2 - (nw + pw) / 2;
      text(ctx, num, x0, 62, { size: 60, align: 'left', shadow: false });
      text(ctx, 'pp', x0 + nw + 2, 62, { size: 44, align: 'left', fill: PURPLE, shadow: false });
      [[d.v.n300, GREEN], [d.v.n100, BLUE], [d.v.nMiss, RED]].forEach(([n, colour], i) => {
        const cx = W * (0.19 + i * 0.31);
        text(ctx, String(n), cx, 120, { size: 34, align: 'center', shadow: false });
        ctx.fillStyle = colour; rr(ctx, cx - 14, 130, 28, 7, 3.5); ctx.fill();
      });
    },
    // Triangles Lazer PP by uwuclxdy: a plain "110 PP" on black
    triangles(ctx, d, W, H) {
      ctx.fillStyle = '#000'; rr(ctx, 0, 0, W, H, 8); ctx.fill();
      ctx.font = `300 58px ${SANS}`;
      const num = String(d.pp), nw = ctx.measureText(num).width;
      ctx.font = `700 26px ${SANS}`;
      const pw = ctx.measureText('PP').width, x0 = W / 2 - (nw + pw + 8) / 2;
      text(ctx, num, x0, 62, { size: 58, weight: 300, shadow: false });
      text(ctx, 'PP', x0 + nw + 8, 62, { size: 26, shadow: false });
    },
    // PP counter (author unknown): a pill with the map picture, the hit segments on the left and the pp on the right
    ppcounter(ctx, d, W, H) {
      cover(ctx, d.bg, 0, 0, W, H, H / 2, 0.45);
      const segs = [[d.v.n100, 'rgba(50,205,50,0.67)'], [d.v.n50, 'rgba(138,43,226,0.67)'], [d.v.nMiss, 'rgba(255,69,0,0.67)']];
      const sw = 78;
      ctx.save();
      rr(ctx, 0, 0, W, H, H / 2); ctx.clip();
      segs.forEach(([n, fill], i) => {
        ctx.fillStyle = fill;
        ctx.beginPath(); ctx.rect(i * sw, 0, sw, H);
        ctx.fill();
        text(ctx, String(n), i * sw + sw / 2, H / 2 + 7, { size: 22, weight: 700, align: 'center', shadow: false });
      });
      ctx.restore();
      text(ctx, `${d.pp}pp`, W - 40, H / 2 + 14, { size: 40, weight: 700, align: 'right' });
    },
    // simple pp counter by Inlayo: white pp on a translucent black rounded box
    simplepp(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(0,0,0,0.67)'; rr(ctx, 0, 0, W, H, 15); ctx.fill();
      text(ctx, `${d.pp}pp`, W / 2, H / 2 + 17, { size: 50, weight: 400, align: 'center', maxW: W - 16, shadow: false });
    },
    // PP by Belikhun: the pp so far, a graph of pp over the map, a dashed "pp if fc" line and the misses
    ppbelikhun(ctx, d, W, H) {
      const sr = seriesOf(d.scene), now = d.scene.diff && d.scene.hud ? livePp(d.scene.diff, d.scene, d.v, d.t) : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; rr(ctx, 0, 0, W, H, 14); ctx.fill();
      text(ctx, 'pp', 22, 40, { size: 28, weight: 300, shadow: false });
      text(ctx, now.toFixed(2), 20, 112, { size: 76, weight: 300, shadow: false, maxW: W - 40 });
      const gx = 24, gy = 128, gw = W - 24 - 70, gh = 100, pct = d.progress, top = sr.max * 1.05;
      const X = (f) => gx + gw * f, Y = (v) => gy + gh - (gh * v) / top;
      ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fillRect(gx, gy, gw + 40, gh);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(gx, gy + gh * 0.45, gw + 40, gh * 0.55);
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(gx - 4, gy, 4, gh);
      const n = Math.max(1, Math.round(pct * 90)), upto = sr.pts.slice(0, n + 1);
      if (upto.length > 1) {
        const grad = ctx.createLinearGradient(0, gy, 0, gy + gh);
        grad.addColorStop(0, 'rgba(76,184,255,0.55)'); grad.addColorStop(1, 'rgba(76,184,255,0)');
        ctx.beginPath(); ctx.moveTo(X(0), gy + gh);
        upto.forEach((v, i) => ctx.lineTo(X(i / 90), Y(v)));
        ctx.lineTo(X((upto.length - 1) / 90), gy + gh); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
        ctx.beginPath(); upto.forEach((v, i) => (i ? ctx.lineTo(X(i / 90), Y(v)) : ctx.moveTo(X(i / 90), Y(v))));
        ctx.strokeStyle = '#4cb8ff'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
        ctx.fillStyle = '#4cb8ff'; ctx.beginPath(); ctx.arc(X((upto.length - 1) / 90), Y(upto[upto.length - 1]), 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = 'rgba(255,143,163,0.55)';
      for (const m of sr.misses) if (m <= pct) ctx.fillRect(X(m) - 1, gy, 2, gh);
      const fcY = Y(d.ppFc || sr.max);
      ctx.setLineDash([5, 4]); ctx.strokeStyle = '#e2b0ff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(gx, fcY); ctx.lineTo(gx + gw + 36, fcY); ctx.stroke(); ctx.setLineDash([]);
      [[d.ppFc, '#e2b0ff', fcY], [Math.round(now), '#4cb8ff', Y(now)]].forEach(([v, c, y]) => {
        ctx.fillStyle = c; ctx.fillRect(gx + gw + 4, y - 10, 62, 20);
        text(ctx, String(v), gx + gw + 35, y + 5, { size: 14, weight: 500, fill: '#000', align: 'center', shadow: false });
      });
      [['miss', '#ff8fa3', 24], ['pp if fc', '#e2b0ff', 96], ['pp', '#4cb8ff', 196]].forEach(([label, c, x]) => {
        ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, H - 22, 6, 0, Math.PI * 2); ctx.fill();
        text(ctx, label, x + 12, H - 17, { size: 14, weight: 400, fill: c, shadow: false });
      });
    },
    // PP Blossom by rosekki: the title, a row of map stats and the pp a full combo would give at 100% down to 95%
    ppblossom(ctx, d, W, H) {
      const pill = (y, h, w) => { ctx.fillStyle = 'rgba(24,24,26,0.88)'; rr(ctx, (W - w) / 2, y, w, h, h / 2); ctx.fill(); };
      pill(0, 58, W);
      text(ctx, `${d.artist} - ${d.title}`, W / 2, 26, { size: 17, weight: 700, align: 'center', maxW: W - 40, shadow: false });
      text(ctx, `Difficulty: ${d.diff} - Mapped by ${d.mapper}`, W / 2, 46, { size: 12, weight: 400, fill: 'rgba(255,255,255,0.8)', align: 'center', maxW: W - 40, shadow: false });
      pill(68, 34, W - 24);
      const stats = [`★ ${d.stars.toFixed(2)}`, `♩ ${Math.round(d.bpm)}`, `⏱ ${clock(d.length)}`, `AR ${fmt1(d.ar)}`, `CS ${fmt1(d.cs)}`, `HP ${fmt1(d.hp)}`];
      stats.forEach((s2, i) => text(ctx, s2, 12 + (W - 24) * ((i + 0.5) / stats.length) + 0, 91, { size: 12, weight: 600, align: 'center', shadow: false }));
      ctx.fillStyle = 'rgba(24,24,26,0.88)'; rr(ctx, 24, 114, W - 48, H - 114, 20); ctx.fill();
      const rows = d.scene.diff ? [100, 99, 98, 97, 96, 95] : [];
      rows.forEach((a, i) => {
        const y = 150 + i * 31;
        text(ctx, `${a}%`, 52, y, { size: 19, weight: 800, shadow: false });
        text(ctx, '→', W / 2, y, { size: 16, weight: 400, fill: 'rgba(255,255,255,0.55)', align: 'center', shadow: false });
        text(ctx, `${Math.round(ppAtAccuracy(d.scene, d.scene.diff, a / 100))}pp`, W - 52, y, { size: 19, weight: 800, align: 'right', shadow: false });
      });
    },
    // InGame2 by Dartandr: a thin progress bar over three counts with coloured dots, and the pp
    ingame2(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(8,8,10,0.86)'; rr(ctx, 0, 0, W, H, 12); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; rr(ctx, 14, 12, W - 28, 5, 2.5); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)'; rr(ctx, 14, 12, Math.max(5, (W - 28) * d.progress), 5, 2.5); ctx.fill();
      [[d.v.n100, GREEN], [d.v.n50, BLUE], [d.v.nMiss, RED]].forEach(([n, c], i) => {
        const cx = 40 + i * 58;
        text(ctx, String(n), cx, 62, { size: 28, align: 'center', shadow: false });
        ctx.fillStyle = c; rr(ctx, cx - 9, 72, 18, 5, 2.5); ctx.fill();
      });
      ctx.font = '800 40px ' + SANS; ctx.textAlign = 'right';
      const pw = (() => { ctx.font = '800 22px ' + SANS; return ctx.measureText('pp').width; })();
      text(ctx, 'pp', W - 16, 66, { size: 22, fill: PURPLE, align: 'right', shadow: false, weight: 800 });
      text(ctx, String(d.pp), W - 16 - pw - 2, 66, { size: 44, align: 'right', shadow: false, weight: 800, maxW: W - 220 });
    },
    // OldClassic by Dartandr: the map picture with its title over a black bar with "267 PP" and the 100 / 50 / MISS counts
    oldclassic(ctx, d, W, H) {
      ctx.save(); rr(ctx, 0, 0, W, H, 8); ctx.clip();
      cover(ctx, d.bg, 0, 0, W, H * 0.58, 0, 0.45);
      text(ctx, `${d.artist} - ${d.title}`.toUpperCase(), W / 2, H * 0.34, { size: 30, weight: 800, align: 'center', maxW: W - 24 });
      ctx.fillStyle = '#050505'; ctx.fillRect(0, H * 0.5, W, H * 0.5);
      text(ctx, `${d.pp} PP`, 20, H * 0.5 + 62, { size: 54, weight: 900, shadow: false, maxW: 215 });
      [['100', d.v.n100], ['50', d.v.n50], ['MISS', d.v.nMiss]].forEach(([label, n], i) => {
        const cx = 290 + i * 80;
        text(ctx, label, cx, H * 0.5 + 34, { size: 18, weight: 600, fill: 'rgba(255,255,255,0.45)', align: 'center', shadow: false });
        text(ctx, String(n), cx, H * 0.5 + 74, { size: 32, weight: 800, align: 'center', shadow: false });
      });
      ctx.restore();
    },
    // SimpleOverlay by HosizoraN: the pp in large type with the four hit counts under it
    simpleoverlay(ctx, d, W, H) {
      text(ctx, `${Math.round(d.pp)}pp`, 4, 56, { size: 62, weight: 600, maxW: W - 8 });
      [d.v.n300, d.v.n100, d.v.n50, d.v.nMiss].forEach((n, i) => text(ctx, String(n), 8 + i * 76, 102, { size: 30, weight: 600 }));
    },
    // Souei-Overlay: the pp as a blue-tagged chip on the bottom bar
    soueipp(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(8,8,10,0.92)'; rr(ctx, 0, 0, W, H, H / 2); ctx.fill();
      text(ctx, d.scene.diff && d.scene.hud ? livePp(d.scene.diff, d.scene, d.v, d.t).toFixed(2) : '0', 20, H * 0.68, { size: 24, weight: 700, shadow: false, maxW: W - 70 });
      text(ctx, 'pp', W - 18, H * 0.68, { size: 22, weight: 700, fill: '#4f6bff', align: 'right', shadow: false });
    },
    // VictimCrasherOverlay: the pp in the bottom-right patch
    victim(ctx, d, W, H) {
      blob(ctx, W, H, 'br');
      text(ctx, String(Math.round(d.pp)), W - 78, H - 24, { size: 52, weight: 800, align: 'right', maxW: W - 130 });
      text(ctx, 'PP', W - 18, H - 24, { size: 24, weight: 800, align: 'right' });
    },
    // vertigo by zeronic: two outlined boxes, pp if the rest is a full combo and pp now
    vertigo(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(32,32,38,0.88)'; rr(ctx, 0, 0, W, H, 24); ctx.fill();
      [[d.ppFc, 'ppfc', 14], [d.pp, 'pp', 118]].forEach(([n, label, y]) => {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2.5;
        rr(ctx, 14, y, W - 28, 66, 10); ctx.stroke();
        paddedNumber(ctx, n, W / 2, y + 45, 5, 34);
        text(ctx, label, W - 18, y + 90, { size: 19, weight: 500, family: MONO, fill: 'rgba(255,255,255,0.4)', align: 'right', shadow: false });
      });
    },
  },

  acc: {
    // paradox by mofuries: the top-right panel with the grade ring, score, accuracy and pp, and the hit counts
    paradox(ctx, d, W, H) {
      ctx.save(); rr(ctx, 0, 0, W, H, 12); ctx.clip();
      cover(ctx, d.bg, 0, 0, W, H, 0, 0.6);
      ctx.restore();
      ring(ctx, 56, H / 2, 38, d.progress, '#8b7dff');
      ctx.fillStyle = '#17b8c4'; rr(ctx, 36, H / 2 - 17, 40, 34, 17); ctx.fill();
      text(ctx, (d.tok.grade || 'S').replace(/H$/, ''), 56, H / 2 + 9, { size: 26, weight: 800, align: 'center', shadow: false });
      text(ctx, grouped(d.v.score).replace(/ /g, '.'), 112, 44, { size: 36, weight: 600, maxW: 270 });
      text(ctx, `${d.tok.acc}%`, 112, 88, { size: 30, weight: 500 });
      text(ctx, `${Math.round(d.pp)}PP`, 270, 88, { size: 30, weight: 500, maxW: 120 });
      [[`100: ${d.v.n100}`, 410, 36], [`50: ${d.v.n50}`, 410, 78], [`miss: ${d.v.nMiss}`, 410, 100]].forEach(([t2, x, y], i) => text(ctx, t2, x, y, { size: i === 2 ? 20 : 24, weight: 400, fill: i === 2 ? '#ff6b6b' : '#fff', shadow: false }));
    },
    // SimpleOverlay by HosizoraN: the accuracy, centred
    simple(ctx, d, W, H) {
      text(ctx, `${d.tok.acc}%`, W / 2, H * 0.78, { size: 38, weight: 600, align: 'center', maxW: W - 8 });
    },
    // Souei-Overlay: a clock-style progress ring and the accuracy
    souei(ctx, d, W, H) {
      ring(ctx, 28, H / 2, 20, d.progress);
      text(ctx, `${d.tok.acc}%`, W - 6, H / 2 + 12, { size: 34, weight: 300, align: 'right', maxW: W - 70 });
    },
    // VictimCrasherOverlay: the top-right patch with score, accuracy and the mods
    victim(ctx, d, W, H) {
      blob(ctx, W, H, 'tr');
      text(ctx, grouped(d.v.score), W - 16, 52, { size: 36, weight: 800, align: 'right', maxW: W - 60 });
      text(ctx, `${d.tok.acc} %`, W - 16, 86, { size: 26, weight: 700, align: 'right' });
      text(ctx, 'Mods', W - 16, 114, { size: 18, weight: 600, align: 'right' });
    },
    // Rank and Accuracy by Belikhun: a dark panel with the rank and the accuracy, each over a small label
    rankacc(ctx, d, W, H) {
      const grade = d.tok.grade || '', acc = Number(d.tok.acc) || 0;
      const colour = /^SS?H?$/.test(grade) ? (grade.includes('S') && grade.length > 1 && grade[0] === 'S' && grade[1] === 'S' ? '#f6f6f6' : '#f6c21c') : grade === 'A' ? '#88b400' : grade === 'B' ? '#44aadd' : grade === 'C' ? '#ff66aa' : grade ? '#dd2d44' : '#485e74';
      [[0, 'rank'], [W / 2 + 6, 'accuracy']].forEach(([x, label], i) => {
        ctx.fillStyle = 'rgba(33,33,33,0.9)'; rr(ctx, x, 0, W / 2 - 6, H, 8); ctx.fill();
        text(ctx, label, x + 16, 28, { size: 16, weight: 400, fill: 'rgba(255,255,255,0.8)', shadow: false });
        text(ctx, i === 0 ? (grade || '---') : `${acc.toFixed(2)}%`, x + 16, 82, { size: 40, weight: 900, fill: i === 0 ? colour : '#fff', maxW: W / 2 - 38, shadow: false });
      });
      const bx = W / 2 + 22, bw = W / 2 - 38;
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; rr(ctx, bx, 110, bw, 10, 5); ctx.fill();
      ctx.fillStyle = '#44aadd'; rr(ctx, bx, 110, Math.max(10, bw * Math.max(0, Math.min(1, (acc - 80) / 20))), 10, 5); ctx.fill();
    },
  },
  hits: {
    // this site's own four labelled counters: fruits, droplets, tiny droplets, misses
    plain(ctx, d, W, H) {
      const cells = [['fruits', d.v.n300, '#7ee0a0'], ['drops', d.v.n100, '#6fc3ff'], ['tiny', d.v.n50, '#c8a2ff'], ['miss', d.v.nMiss, '#ff7b8f']];
      ctx.fillStyle = 'rgba(10,12,18,0.55)'; rr(ctx, 0, 0, W, H, H * 0.2); ctx.fill();
      const cw = W / cells.length;
      cells.forEach(([label, n, colour], i) => {
        const cx = cw * (i + 0.5);
        text(ctx, String(n), cx, H * 0.56, { size: H * 0.42, family: MONO, align: 'center', shadow: false });
        ctx.fillStyle = colour; ctx.fillRect(cx - cw * 0.24, H * 0.7, cw * 0.48, Math.max(2, H * 0.05));
        text(ctx, label, cx, H * 0.92, { size: H * 0.15, weight: 500, family: MONO, fill: 'rgba(255,255,255,0.7)', align: 'center', shadow: false });
      });
    },
    // HitCounts (author unknown): bold coloured digits in a row
    hitcounts(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; rr(ctx, 0, 0, W, H, 6); ctx.fill();
      const items = [[String(d.v.n300), '#9af59a'], [String(d.v.n100), '#8f8ff5'], [String(d.v.nMiss), '#f26d7d'], [`${d.v.n50}t`, '#b4b4bc']];
      ctx.font = `700 34px ${MONO}`;
      const gap = 26, ws = items.map(([s]) => ctx.measureText(s).width), total = ws.reduce((a, b) => a + b, 0) + gap * (items.length - 1);
      let x = W - 14 - total;
      items.forEach(([s, fill], i) => { text(ctx, s, x, 34, { size: 34, family: MONO, fill, shadow: false }); x += ws[i] + gap; });
    },
    // Kerli 2 by Dartandr: combo pills over three big counts with colour bars
    kerli2(ctx, d, W, H) {
      [[d.v.combo, 10], [d.v.maxCombo, W - 160 - 10]].forEach(([n, x]) => {
        ctx.fillStyle = 'rgba(16,16,20,0.9)'; rr(ctx, x, 6, 160, 66, 16); ctx.fill();
        text(ctx, String(n), x + 80, 54, { size: 44, align: 'center', shadow: false });
      });
      [[d.v.n300, GREEN], [d.v.n100, BLUE], [d.v.nMiss, RED]].forEach(([n, colour], i) => {
        const cx = W * (0.17 + i * 0.33);
        text(ctx, String(n), cx, 150, { size: 40, align: 'center' });
        ctx.fillStyle = colour; rr(ctx, cx - 44, 172, 88, 11, 5.5); ctx.fill();
      });
    },
    // Souei-Overlay: four counts, each over a short coloured tick
    soueicounts(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(20,20,22,0.82)'; rr(ctx, 0, 0, W, H, 8); ctx.fill();
      [[d.v.n300, '#3ddc4b'], [d.v.n100, '#ffd23f'], [d.v.n50, '#ff3b3b'], [d.v.nMiss, '#8a8a90']].forEach(([n, c], i) => {
        const cx = 30 + i * 60;
        ctx.fillStyle = c; rr(ctx, cx - 15, 7, 30, 3.5, 1.75); ctx.fill();
        text(ctx, String(n), cx, H - 12, { size: 26, weight: 600, align: 'center', shadow: false });
      });
    },
    // VictimCrasherOverlay: "16 x100 / 0 x50 / 0 x miss" in the bottom-right patch
    victim(ctx, d, W, H) {
      [[d.v.n100, 'x 100'], [d.v.n50, 'x 50'], [d.v.nMiss, 'x miss']].forEach(([n, label], i) => {
        const y = H - 120 + i * 32;
        text(ctx, String(n), W - 84, y, { size: 28, weight: 700, align: 'right' });
        text(ctx, label, W - 78, y, { size: 16, weight: 600, fill: 'rgba(255,255,255,0.8)' });
      });
    },
    // classic by Dartandr: "0x100  0x50  0xMiss" in a dark pill
    classic(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; rr(ctx, 0, 0, W, H, 10); ctx.fill();
      [`${d.v.n100}x100`, `${d.v.n50}x50`, `${d.v.nMiss}xMiss`].forEach((s, i) => text(ctx, s, W * (0.18 + i * 0.32), 29, { size: 21, align: 'center', shadow: false }));
    },
  },

  combo: {
    // paradox by mofuries: a very large combo, bottom-left
    paradox(ctx, d, W, H) {
      text(ctx, `${d.v.combo}x`, 4, H - 6, { size: 84, weight: 700, maxW: W - 8 });
    },
    // SimpleOverlay by HosizoraN and Souei-Overlay: a big bold "33x"
    simple(ctx, d, W, H) {
      text(ctx, `${d.v.combo}x`, 4, H - 8, { size: 62, weight: 800, maxW: W - 8 });
    },
    // VictimCrasherOverlay: the bottom-left patch with a COMBO label
    victim(ctx, d, W, H) {
      blob(ctx, W, H, 'bl');
      text(ctx, 'COMBO', 56, H - 82, { size: 16, weight: 700 });
      text(ctx, String(d.v.combo), 14, H - 14, { size: 60, weight: 800, maxW: W - 70 });
    },
  },

  score: {
    // SimpleOverlay by HosizoraN: the score in groups of three, centred
    simple(ctx, d, W, H) {
      text(ctx, grouped(d.v.score), W / 2, H - 10, { size: 52, weight: 600, align: 'center', maxW: W - 8 });
    },
    // Souei-Overlay: the score as eight light digits
    souei(ctx, d, W, H) {
      text(ctx, String(Math.round(d.v.score)).padStart(8, '0'), W - 4, H - 8, { size: 40, weight: 300, align: 'right', maxW: W - 8 });
    },
  },

  health: {
    // VictimCrasherOverlay: a yellow-orange bar across the top labelled "Health"
    victim(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
      const g = ctx.createLinearGradient(0, 0, W, 0); g.addColorStop(0, '#e68a00'); g.addColorStop(1, '#ffc928');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W * d.health, H);
      text(ctx, 'Health', W / 2, H - 4, { size: H - 5, weight: 600, align: 'center', shadow: false });
    },
  },

  progress: {
    // paradox by mofuries: a thin line over the BPM
    paradox(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(0, 4, W, 4);
      ctx.fillStyle = '#9a7bff'; ctx.fillRect(0, 4, W * d.progress, 4);
      text(ctx, String(Math.round(d.bpm)), W / 2, 62, { size: 44, weight: 500, align: 'center' });
      text(ctx, 'BPM', W / 2, 88, { size: 18, weight: 400, fill: 'rgba(255,255,255,0.8)', align: 'center' });
    },
    // SimpleOverlay by HosizoraN and Souei-Overlay: a thin white bar that fills, with a dot at the end
    simple(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; rr(ctx, 0, H / 2 - 2.5, W, 5, 2.5); ctx.fill();
      ctx.fillStyle = '#fff'; rr(ctx, 0, H / 2 - 2.5, Math.max(5, W * d.progress), 5, 2.5); ctx.fill();
      ctx.beginPath(); ctx.arc(Math.max(5, W * d.progress), H / 2, 6, 0, Math.PI * 2); ctx.fill();
    },
  },

  keys: {
    // KeyOverlay by HosizoraN: a count, a bar that lights while held, and the key's name
    bars(ctx, d, W, H) {
      const rows = [['L', d.key?.left], ['R', d.key?.right], ['DASH', d.key?.dash]];
      rows.forEach(([label, k], i) => {
        const y = 6 + i * 62, down = !!k?.down;
        ctx.fillStyle = down ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)'; rr(ctx, 6, y + 4, 60, 46, 9); ctx.fill();
        text(ctx, String(k?.count ?? 0), 36, y + 40, { size: 32, align: 'center', shadow: false });
        ctx.fillStyle = down ? '#ffe14d' : 'rgba(255,255,255,0.55)'; rr(ctx, 78, y, 11, 54, 5.5); ctx.fill();
        text(ctx, label, 104, y + 40, { size: label.length > 1 ? 30 : 38, weight: 600, fill: down ? '#fff' : 'rgba(255,255,255,0.7)', shadow: false });
      });
    },
  },

};

/** The draw function for a canvas look, or undefined (tosu looks and the key boxes are drawn elsewhere). */
export const lookFor = (widget, style) => LOOKS[widget]?.[style];
