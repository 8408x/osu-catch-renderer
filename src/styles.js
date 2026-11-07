// Canvas drawings for the Custom style's widget looks. Each look recreates the layout of a community tosu overlay
// (credited in layout.js and CREDITS.md) in this site's own code; no overlay code or images are copied. A draw function
// works in the style's natural size (see layout.js): the caller translates and scales the canvas to fit.

import { tosuTokens } from './tosu.js?v=20261107y';
import { hudAt } from './score.js?v=20261107y';
import { keysAt } from './keys.js?v=20261107y';

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
    tok, v, bg, t,
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

const LOOKS = {
  title: {
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

  hits: {
    // this site's own four counters
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
    // classic by Dartandr: "0x100  0x50  0xMiss" in a dark pill
    classic(ctx, d, W, H) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; rr(ctx, 0, 0, W, H, 10); ctx.fill();
      [`${d.v.n100}x100`, `${d.v.n50}x50`, `${d.v.nMiss}xMiss`].forEach((s, i) => text(ctx, s, W * (0.18 + i * 0.32), 29, { size: 21, align: 'center', shadow: false }));
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

  progress: {
    bar(ctx, d, W, H) {
      const barH = Math.max(3, H * 0.2), by = H - barH;
      ctx.fillStyle = 'rgba(255,255,255,0.25)'; rr(ctx, 0, by, W, barH, barH / 2); ctx.fill();
      ctx.fillStyle = '#fff'; rr(ctx, 0, by, Math.max(barH, W * Math.min(1, d.progress)), barH, barH / 2); ctx.fill();
      text(ctx, clock(d.elapsed), 0, H * 0.5, { size: H * 0.5, family: MONO, weight: 600 });
      text(ctx, clock(d.total), W, H * 0.5, { size: H * 0.5, family: MONO, weight: 600, fill: 'rgba(255,255,255,0.7)', align: 'right' });
    },
  },
};

/** The draw function for a canvas look, or undefined (tosu looks and the key boxes are drawn elsewhere). */
export const lookFor = (widget, style) => LOOKS[widget]?.[style];
