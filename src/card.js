// The title cards that can open and close an exported video (and show in the preview): who played what, and how it went.
// Pure drawing; encode.js and the preview ask for one frame at a time and main.js hands over the scene.
// Three looks: 'lazer' (the loading screen and results screen of osu!lazer), 'stable' (osu!stable's loading
// screen and ranking panel) and 'simple' (a plain centred card). Layouts follow those screens; no artwork is copied.

import { getAvatar, getProfile, getBoard } from './avatar.js?v=20261110o';
import { styleData } from './styles.js?v=20261110o';
import { hudAt } from './score.js?v=20261110o';
import { modEntries } from './mods.js?v=20261110o';

const SANS = '"Exo 2", "Torus", system-ui, "Segoe UI", sans-serif';
const MONO = '"JetBrains Mono", ui-monospace, "SFMono-Regular", Consolas, monospace';
const FONT = (w, px, fam = SANS) => `${w} ${px}px ${fam}`;

export const CARD_STYLES = ['lazer', 'stable', 'simple'];

const accuracy = (p) => { const n = (p?.n300 ?? 0) + (p?.n100 ?? 0) + (p?.n50 ?? 0), tot = n + (p?.nKatu ?? 0) + (p?.nMiss ?? 0); return tot ? (n / tot) * 100 : 0; };
const commas = (n) => Math.round(n).toLocaleString('en-US');
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const ease = (p) => 1 - (1 - clamp01(p)) ** 3;
const finalPpCache = new WeakMap();
const finalPp = (scene) => {
  if (!finalPpCache.has(scene)) { let v = 0; try { v = styleData(scene, scene.endTime, null, null).pp || 0; } catch { /* no pp for this map */ } finalPpCache.set(scene, v); }
  return finalPpCache.get(scene);
};

/** A fade in over the first 15% and a fade out over the last 15% of the card. */
export const cardFade = (p) => Math.min(1, p / 0.15, (1 - p) / 0.15);

// ---------- small helpers ----------

const MOD_COLOUR = { i: '#ff6666', r: '#b2ff66', a: '#66ccff' };
const modList = (mods) => modEntries(mods ?? 0).map((e) => ({ name: e.code, kind: e.kind }));

/** osu!catch ranks by accuracy; Hidden/Flashlight turn S and SS silver. */
export function rankOf(acc, mods = 0) {
  const base = acc >= 100 ? 'SS' : acc >= 98 ? 'S' : acc >= 94 ? 'A' : acc >= 90 ? 'B' : acc >= 85 ? 'C' : 'D';
  const silver = (mods & (8 | 1024)) && (base === 'SS' || base === 'S');
  return { letter: base, silver: !!silver };
}
const RANK_COLOUR = { SS: '#ffd23f', S: '#ffd23f', A: '#7bd639', B: '#38a9ff', C: '#b980ff', D: '#ff5c5c' };
const rankColour = (r) => (r.silver ? '#dfe5f2' : RANK_COLOUR[r.letter]);

const STAR_STOPS = [[0.1, [66, 144, 251]], [1.25, [79, 192, 255]], [2, [79, 255, 213]], [2.5, [124, 255, 79]], [3.3, [246, 240, 92]], [4.2, [255, 128, 104]], [4.9, [255, 78, 111]], [5.8, [198, 69, 184]], [6.7, [101, 99, 222]], [7.7, [24, 21, 142]], [9, [0, 0, 0]]];
/** lazer's difficulty spectrum: a star rating to a colour. */
export function starColour(s) {
  const x = Math.max(STAR_STOPS[0][0], Math.min(STAR_STOPS[STAR_STOPS.length - 1][0], s || 0));
  for (let i = 1; i < STAR_STOPS.length; i++) {
    if (x <= STAR_STOPS[i][0]) {
      const [a, ca] = STAR_STOPS[i - 1], [b, cb] = STAR_STOPS[i], k = (x - a) / (b - a);
      return `rgb(${ca.map((v, j) => Math.round(v + (cb[j] - v) * k)).join(',')})`;
    }
  }
  return '#000';
}

function rr(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h); }
function fitText(ctx, s, maxW) { let t = String(s ?? ''); if (ctx.measureText(t).width <= maxW) return t; while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1); return `${t}…`; }

function drawCover(ctx, W, H, bg, { dim = 0.6, blur = 0, tint = null } = {}) {
  ctx.fillStyle = '#07080d'; ctx.fillRect(0, 0, W, H);
  if (bg) {
    const bw = bg.width || bg.naturalWidth || bg.videoWidth, bh = bg.height || bg.naturalHeight || bg.videoHeight;
    if (bw && bh) {
      const k = Math.max(W / bw, H / bh) * (blur ? 1.06 : 1);
      ctx.save();
      if (blur) { try { ctx.filter = `blur(${blur}px)`; } catch { /* no canvas filters here */ } }
      ctx.drawImage(bg, W / 2 - (bw * k) / 2, H / 2 - (bh * k) / 2, bw * k, bh * k);
      ctx.restore();
    }
  }
  ctx.fillStyle = `rgba(6,7,12,${dim})`; ctx.fillRect(0, 0, W, H);
  if (tint) { const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, tint[0]); g.addColorStop(1, tint[1]); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
}

function avatarCircle(ctx, cx, cy, r, img, name, ring = 'rgba(255,255,255,0.85)', lw = 4) {
  ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.clip();
  if (img?.naturalWidth) { const k = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight); ctx.drawImage(img, cx - (img.naturalWidth * k) / 2, cy - (img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k); }
  else { ctx.fillStyle = '#ff6b8a'; ctx.fillRect(cx - r, cy - r, 2 * r, 2 * r); ctx.font = FONT(800, r); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText((name || '?').slice(0, 1).toUpperCase(), cx, cy + r * 0.35); }
  ctx.restore();
  ctx.strokeStyle = ring; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
}

function modPills(ctx, x, y, list, u, align = 'center') {
  if (!list.length) return;
  const w = 86 * u, h = 44 * u, gap = 12 * u, total = list.length * w + (list.length - 1) * gap;
  let px = align === 'center' ? x - total / 2 : x;
  for (const { name, kind } of list) {
    const col = MOD_COLOUR[kind] ?? '#c68cff';
    rr(ctx, px, y, w, h, 12 * u); ctx.fillStyle = 'rgba(18,18,28,0.9)'; ctx.fill();
    ctx.lineWidth = 3 * u; ctx.strokeStyle = col; ctx.stroke();
    ctx.font = FONT(800, 24 * u); ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.fillText(name, px + w / 2, y + h * 0.68);
    px += w + gap;
  }
}

function dateText(d) {
  const t = d instanceof Date ? d : new Date(d);
  if (!Number.isFinite(t.getTime())) return '';
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The combo over the whole map: a small area chart, cached per scene. */
const comboCache = new WeakMap();
function comboSeries(scene, n = 200) {
  if (comboCache.has(scene)) return comboCache.get(scene);
  const out = [];
  if (scene.hud) { const a = scene.startTime, b = scene.endTime; for (let i = 0; i <= n; i++) out.push(hudAt(scene.hud, a + ((b - a) * i) / n).combo || 0); }
  comboCache.set(scene, out);
  return out;
}

// ---------- the online leaderboard ----------

/** The rows to show: the top of the board, and the replay's own score at the place it takes (or already holds). */
function boardRows(scene, n = 9) {
  const b = getBoard(), pl = scene.play ?? {};
  if (!b?.scores?.length) return null;
  const list = b.scores.map((x) => ({ ...x }));
  const name = (scene.player || '').toLowerCase(), acc = accuracy(pl) / 100;
  // The replay file's score comes from stable's scoring, the board's from lazer's, so scores cannot be compared.
  // The replay counts as on the board only when the same player has a score with the same combo and accuracy.
  const mi = list.findIndex((x) => String(x.username).toLowerCase() === name && x.max_combo === (pl.maxCombo ?? -1) && Math.abs((x.accuracy ?? 0) - acc) < 0.0006);
  if (mi >= 0) {
    list[mi].mine = true;
    return mi < n ? list.slice(0, n) : [...list.slice(0, n - 1), list[mi]];
  }
  const me = { username: scene.player || 'You', score: pl.score ?? 0, accuracy: acc, max_combo: pl.maxCombo ?? 0, mine: true, rank: null };
  return [...list.slice(0, n - 1), me];
}

function drawBoard(ctx, x, y, w, h, u, scene) {
  const rows = boardRows(scene);
  rr(ctx, x, y, w, h, 26 * u); ctx.fillStyle = 'rgba(21,19,30,0.86)'; ctx.fill();
  ctx.textAlign = 'left'; ctx.font = FONT(600, 26 * u); ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fillText('GLOBAL RANKING', x + 32 * u, y + 50 * u);
  if (!rows) { ctx.font = FONT(500, 28 * u); ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillText('No leaderboard for this map', x + 32 * u, y + 110 * u); return; }
  const top = y + 74 * u, rh = (h - 90 * u) / Math.max(rows.length, 1);
  rows.forEach((r, i) => {
    const ry = top + i * rh, cy = ry + rh / 2;
    if (r.mine) { rr(ctx, x + 14 * u, ry + 2 * u, w - 28 * u, rh - 4 * u, 12 * u); ctx.fillStyle = 'rgba(255,102,170,0.28)'; ctx.fill(); ctx.strokeStyle = '#ff66aa'; ctx.lineWidth = 2 * u; ctx.stroke(); }
    const fs = Math.min(26 * u, rh * 0.52);
    ctx.textAlign = 'left'; ctx.font = FONT(700, fs); ctx.fillStyle = r.rank && r.rank <= 3 ? ['#ffd23f', '#dfe5f2', '#ffa05a'][r.rank - 1] : 'rgba(255,255,255,0.7)';
    ctx.fillText(r.rank ? `#${r.rank}` : '—', x + 32 * u, cy + fs * 0.35);
    ctx.fillStyle = '#fff'; ctx.font = FONT(r.mine ? 800 : 600, fs);
    const nameX = x + 110 * u, scoreR = x + w - 32 * u, accR = scoreR - 390 * u;
    ctx.fillText(fitText(ctx, r.username, accR - nameX - 130 * u), nameX, cy + fs * 0.35);
    ctx.textAlign = 'right'; ctx.font = FONT(500, fs * 0.9); ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(`${((r.accuracy ?? 0) * 100).toFixed(2)}%`, accR, cy + fs * 0.33);
    ctx.fillText(`${commas(r.max_combo ?? 0)}x`, accR + 130 * u, cy + fs * 0.33);
    ctx.font = FONT(800, fs, MONO); ctx.fillStyle = '#fff'; ctx.fillText(r.score > 0 ? commas(r.score) : '\u2014', scoreR, cy + fs * 0.33);
  });
}

// ---------- lazer ----------

function lazerIntro(ctx, W, H, o) {
  const { scene, bg, progress } = o, u = H / 1080, cx = W / 2, m = scene.meta ?? {}, pr = getProfile() ?? {};
  drawCover(ctx, W, H, bg, { dim: 0.62, blur: 14 * u });
  const rise = (1 - ease(progress / 0.35)) * 26 * u;
  ctx.save(); ctx.translate(0, rise);
  const title = m.titleUnicode || m.title || '', artist = m.artistUnicode || m.artist || '';
  ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 16 * u;
  ctx.font = FONT(800, 92 * u); ctx.fillStyle = '#fff'; ctx.fillText(fitText(ctx, title, W * 0.8), cx, 430 * u);
  ctx.font = FONT(500, 46 * u); ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillText(fitText(ctx, artist, W * 0.7), cx, 498 * u);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(cx - 120 * u, 540 * u, 240 * u, 3 * u);
  // the difficulty: a star rating chip, then the difficulty name
  const stars = scene.diff?.star ?? 0, sc = starColour(stars);
  ctx.font = FONT(700, 34 * u); const diffName = fitText(ctx, m.version || '', W * 0.45);
  const chipW = 150 * u, nameW = ctx.measureText(diffName).width, gap = 18 * u, total = chipW + gap + nameW, x0 = cx - total / 2, by = 585 * u, bh = 56 * u;
  rr(ctx, x0, by, chipW, bh, bh / 2); ctx.fillStyle = sc; ctx.fill();
  ctx.fillStyle = stars >= 6.5 ? '#ffd966' : '#1a1a24'; ctx.font = FONT(800, 30 * u); ctx.textAlign = 'center';
  ctx.fillText(`★ ${stars.toFixed(2)}`, x0 + chipW / 2, by + bh * 0.68);
  ctx.font = FONT(700, 34 * u); ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.fillText(diffName, x0 + chipW + gap, by + bh * 0.7);
  ctx.textAlign = 'center'; ctx.font = FONT(500, 32 * u); ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`mapped by ${m.creator || ''}`, cx, 690 * u);
  modPills(ctx, cx, 735 * u, modList(scene.mods), u);
  ctx.restore();
  // who is being watched, and a loading bar like the game's
  const ay = 905 * u;
  avatarCircle(ctx, cx - 250 * u, ay, 46 * u, getAvatar(), scene.player, 'rgba(255,255,255,0.8)', 3 * u);
  ctx.textAlign = 'left'; ctx.font = FONT(700, 40 * u); ctx.fillStyle = '#fff'; ctx.fillText(fitText(ctx, scene.player || 'Player', 520 * u), cx - 185 * u, ay - 2 * u);
  const sub = ['Replay', pr.country_code, pr.rank ? `#${commas(pr.rank)}` : ''].filter(Boolean).join('  ·  ');
  ctx.font = FONT(500, 28 * u); ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fillText(sub, cx - 185 * u, ay + 36 * u);
  const bw = 520 * u, bx = cx - bw / 2, byy = H - 70 * u;
  ctx.fillStyle = 'rgba(255,255,255,0.14)'; rr(ctx, bx, byy, bw, 6 * u, 3 * u); ctx.fill();
  ctx.fillStyle = '#ff66aa'; rr(ctx, bx, byy, Math.max(6 * u, bw * clamp01(progress / 0.9)), 6 * u, 3 * u); ctx.fill();
}

function statRow(ctx, x, y, w, label, value, colour, u) {
  ctx.textAlign = 'left'; ctx.font = FONT(600, 30 * u); ctx.fillStyle = colour; ctx.fillText(label, x, y);
  ctx.textAlign = 'right'; ctx.font = FONT(800, 36 * u, MONO); ctx.fillStyle = '#fff'; ctx.fillText(value, x + w, y);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(x, y + 14 * u, w, 2 * u);
}

function lazerOutro(ctx, W, H, o) {
  const { scene, bg, progress } = o, u = H / 1080, m = scene.meta ?? {}, pl = scene.play ?? {}, pr = getProfile() ?? {};
  const acc = accuracy(pl), rank = rankOf(acc, scene.mods), rc = rankColour(rank), pp = finalPp(scene);
  drawCover(ctx, W, H, bg, { dim: 0.7, blur: 18 * u });
  const slide = (1 - ease(progress / 0.3)) * 60 * u;
  const px = W / 2 - 960 * u + 130 * u, py = 60 * u, pw = 640 * u, ph = 960 * u;
  ctx.save(); ctx.translate(0, slide);
  // the score panel
  rr(ctx, px, py, pw, ph, 34 * u); ctx.fillStyle = 'rgba(21,19,30,0.92)'; ctx.fill();
  ctx.save(); rr(ctx, px, py, pw, ph, 34 * u); ctx.clip();
  if (bg) { const bw = bg.width || bg.naturalWidth, bh = bg.height || bg.naturalHeight; if (bw && bh) { const k = Math.max(pw / bw, 250 * u / bh); ctx.drawImage(bg, px + pw / 2 - (bw * k) / 2, py + 125 * u - (bh * k) / 2, bw * k, bh * k); } }
  const hg = ctx.createLinearGradient(0, py, 0, py + 250 * u); hg.addColorStop(0, 'rgba(15,14,22,0.35)'); hg.addColorStop(1, 'rgba(21,19,30,0.96)'); ctx.fillStyle = hg; ctx.fillRect(px, py, pw, 250 * u);
  ctx.restore();
  ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8 * u;
  ctx.font = FONT(800, 38 * u); ctx.fillStyle = '#fff'; ctx.fillText(fitText(ctx, m.titleUnicode || m.title || '', pw - 70 * u), px + pw / 2, py + 150 * u);
  ctx.font = FONT(500, 28 * u); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(fitText(ctx, m.artistUnicode || m.artist || '', pw - 70 * u), px + pw / 2, py + 192 * u);
  ctx.font = FONT(600, 26 * u); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText(fitText(ctx, `[${m.version || ''}]  ·  mapped by ${m.creator || ''}`, pw - 70 * u), px + pw / 2, py + 232 * u);
  ctx.shadowBlur = 0;
  // the rank badge
  const rcy = py + 360 * u, rr0 = 96 * u;
  ctx.beginPath(); ctx.arc(px + pw / 2, rcy, rr0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(12,11,18,0.95)'; ctx.fill();
  ctx.lineWidth = 8 * u; ctx.strokeStyle = rc; ctx.stroke();
  ctx.save(); ctx.shadowColor = rc; ctx.shadowBlur = 28 * u; ctx.font = FONT(900, (rank.letter.length > 1 ? 104 : 124) * u); ctx.fillStyle = rc; ctx.textAlign = 'center'; ctx.fillText(rank.letter, px + pw / 2, rcy + 42 * u); ctx.restore();
  // score digits
  ctx.textAlign = 'center'; ctx.font = FONT(500, 24 * u); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText('TOTAL SCORE', px + pw / 2, py + 520 * u);
  ctx.font = FONT(800, 78 * u, MONO); ctx.fillStyle = '#fff'; ctx.fillText(commas(pl.score ?? 0), px + pw / 2, py + 592 * u);
  // accuracy / combo / pp
  const cols = [['ACCURACY', `${acc.toFixed(2)}%`], ['MAX COMBO', `${commas(pl.maxCombo ?? 0)}x`], ['PP', pp ? commas(pp) : '—']], cw = (pw - 90 * u) / 3;
  cols.forEach(([l, v], i) => { const x = px + 45 * u + i * cw + cw / 2; ctx.textAlign = 'center'; ctx.font = FONT(500, 22 * u); ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(l, x, py + 650 * u); ctx.font = FONT(800, 42 * u); ctx.fillStyle = '#fff'; ctx.fillText(v, x, py + 700 * u); });
  // the catch statistics, colours as in lazer's results
  const sx = px + 45 * u, sw = pw - 90 * u;
  statRow(ctx, sx, py + 752 * u, sw, 'Fruits', commas(pl.n300 ?? 0), '#66ccff', u);
  statRow(ctx, sx, py + 800 * u, sw, 'Large droplets', commas(pl.n100 ?? 0), '#9bff7a', u);
  statRow(ctx, sx, py + 848 * u, sw, 'Small droplets', commas(pl.n50 ?? 0), '#7fe6ff', u);
  statRow(ctx, sx, py + 896 * u, sw, 'Droplets missed', commas(pl.nKatu ?? 0), '#ffb44d', u);
  statRow(ctx, sx, py + 944 * u, sw, 'Misses', commas(pl.nMiss ?? 0), '#ff6a6a', u);
  ctx.restore();

  // the player and the combo graph, to the right
  const rx = px + pw + 60 * u, rw = W / 2 + 960 * u - 130 * u - rx;
  ctx.save(); ctx.translate(0, slide);
  const ay = py + 140 * u;
  avatarCircle(ctx, rx + 70 * u, ay, 70 * u, getAvatar(), scene.player, 'rgba(255,255,255,0.9)', 5 * u);
  ctx.textAlign = 'left'; ctx.font = FONT(800, 64 * u); ctx.fillStyle = '#fff'; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 10 * u;
  ctx.fillText(fitText(ctx, scene.player || 'Player', rw - 200 * u), rx + 170 * u, ay - 2 * u); ctx.shadowBlur = 0;
  const when = dateText(pl.date);
  const sub = [pr.country_code, pr.rank ? `#${commas(pr.rank)}` : '', when ? `played ${when}` : ''].filter(Boolean).join('  ·  ');
  ctx.font = FONT(500, 32 * u); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText(sub, rx + 170 * u, ay + 44 * u);
  modPills(ctx, rx, py + 250 * u, modList(scene.mods), u, 'left');
  // combo over the map, or the online leaderboard
  const gy = py + 350 * u, gh = 440 * u;
  if (o.board && getBoard()) { drawBoard(ctx, rx, gy, rw, gh + 150 * u, u, scene); ctx.restore(); return; }
  rr(ctx, rx, gy, rw, gh, 26 * u); ctx.fillStyle = 'rgba(21,19,30,0.86)'; ctx.fill();
  ctx.textAlign = 'left'; ctx.font = FONT(600, 26 * u); ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.fillText('COMBO', rx + 32 * u, gy + 50 * u);
  const series = comboSeries(scene), top = Math.max(1, ...series), gx0 = rx + 32 * u, gx1 = rx + rw - 32 * u, gy0 = gy + gh - 40 * u, gy1 = gy + 90 * u;
  if (series.length > 1) {
    ctx.beginPath(); ctx.moveTo(gx0, gy0);
    series.forEach((v, i) => ctx.lineTo(gx0 + ((gx1 - gx0) * i) / (series.length - 1), gy0 - ((gy0 - gy1) * v) / top));
    ctx.lineTo(gx1, gy0); ctx.closePath();
    const fg = ctx.createLinearGradient(0, gy1, 0, gy0); fg.addColorStop(0, 'rgba(255,102,170,0.55)'); fg.addColorStop(1, 'rgba(255,102,170,0.05)'); ctx.fillStyle = fg; ctx.fill();
    ctx.beginPath(); series.forEach((v, i) => { const x = gx0 + ((gx1 - gx0) * i) / (series.length - 1), y = gy0 - ((gy0 - gy1) * v) / top; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.strokeStyle = '#ff66aa'; ctx.lineWidth = 3 * u; ctx.stroke();
  }
  ctx.textAlign = 'right'; ctx.font = FONT(700, 26 * u); ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillText(`${commas(pl.maxCombo ?? top)}x max`, rx + rw - 32 * u, gy + 50 * u);
  ctx.restore();
}

// ---------- stable ----------

function stableIntro(ctx, W, H, o) {
  const { scene, bg, progress } = o, u = H / 1080, cx = W / 2, m = scene.meta ?? {};
  drawCover(ctx, W, H, bg, { dim: 0.42 });
  const vg = ctx.createRadialGradient(cx, H / 2, H * 0.25, cx, H / 2, H * 0.85); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.65)'); ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  const k = 1 + (1 - ease(progress / 0.5)) * 0.04;
  ctx.save(); ctx.translate(cx, H / 2); ctx.scale(k, k); ctx.translate(-cx, -H / 2);
  ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 14 * u;
  ctx.font = FONT(700, 70 * u); ctx.fillStyle = '#fff';
  ctx.fillText(fitText(ctx, `${m.artistUnicode || m.artist || ''} - ${m.titleUnicode || m.title || ''}`, W * 0.88), cx, 480 * u);
  ctx.font = FONT(600, 46 * u); ctx.fillStyle = '#ffd1e6'; ctx.fillText(fitText(ctx, `[${m.version || ''}]`, W * 0.8), cx, 548 * u);
  ctx.font = FONT(500, 36 * u); ctx.fillStyle = 'rgba(255,255,255,0.88)'; ctx.fillText(`Beatmap by ${m.creator || ''}`, cx, 612 * u);
  ctx.shadowBlur = 0;
  modPills(ctx, cx, 680 * u, modList(scene.mods), u);
  ctx.restore();
  ctx.textAlign = 'left'; ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 8 * u;
  ctx.font = FONT(600, 34 * u); ctx.fillStyle = '#fff'; ctx.fillText(`Replay by ${scene.player || 'Player'}`, 48 * u, 70 * u);
  ctx.shadowBlur = 0;
}

function stableOutro(ctx, W, H, o) {
  const { scene, bg, progress } = o, u = H / 1080, m = scene.meta ?? {}, pl = scene.play ?? {}, pr = getProfile() ?? {};
  const acc = accuracy(pl), rank = rankOf(acc, scene.mods), rc = rankColour(rank), pp = finalPp(scene);
  drawCover(ctx, W, H, bg, { dim: 0.55 });
  const slide = (1 - ease(progress / 0.3)) * -120 * u;
  ctx.save(); ctx.translate(slide, 0);
  // the dark ranking panel across the left
  const pw = W * 0.64;
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, pw, H);
  ctx.fillStyle = '#ff66aa'; ctx.fillRect(pw - 4 * u, 0, 4 * u, H);
  ctx.textAlign = 'left'; ctx.shadowBlur = 0;
  ctx.font = FONT(700, 44 * u); ctx.fillStyle = '#fff'; ctx.fillText(fitText(ctx, `${m.artistUnicode || m.artist || ''} - ${m.titleUnicode || m.title || ''} [${m.version || ''}]`, pw - 120 * u), 60 * u, 90 * u);
  ctx.font = FONT(500, 30 * u); ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillText(`Beatmap by ${m.creator || ''}`, 60 * u, 135 * u);
  const when = dateText(pl.date);
  ctx.fillText(`Played by ${scene.player || 'Player'}${pr.country_code ? ` (${pr.country_code}${pr.rank ? ` #${commas(pr.rank)}` : ''})` : ''}${when ? ` on ${when}` : ''}.`, 60 * u, 178 * u);
  // the score
  ctx.font = FONT(500, 28 * u); ctx.fillStyle = '#ff9fc9'; ctx.fillText('Total score', 60 * u, 270 * u);
  ctx.font = FONT(300, 120 * u); ctx.fillStyle = '#fff'; ctx.fillText(commas(pl.score ?? 0), 56 * u, 380 * u);
  // the hit grid: 2 columns like the ranking panel's 300 / 100 / 50 / geki / katu / miss
  const cells = [['Fruits', `${commas(pl.n300 ?? 0)}x`, '#66ccff'], ['Large droplets', `${commas(pl.n100 ?? 0)}x`, '#9bff7a'], ['Small droplets', `${commas(pl.n50 ?? 0)}x`, '#7fe6ff'], ['Small droplets missed', `${commas(pl.nKatu ?? 0)}x`, '#ffb44d'], ['Misses', `${commas(pl.nMiss ?? 0)}x`, '#ff6a6a']];
  const gx = 60 * u, gy = 450 * u, gw = (pw - 180 * u) / 2, gh = 96 * u;
  cells.forEach(([l, v, c], i) => {
    const x = gx + (i % 2) * (gw + 60 * u), y = gy + Math.floor(i / 2) * (gh + 22 * u);
    ctx.fillStyle = 'rgba(255,255,255,0.07)'; rr(ctx, x, y, gw, gh, 10 * u); ctx.fill();
    ctx.fillStyle = c; ctx.fillRect(x, y, 6 * u, gh);
    ctx.textAlign = 'left'; ctx.font = FONT(500, 26 * u); ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText(l, x + 28 * u, y + 38 * u);
    ctx.font = FONT(700, 48 * u); ctx.fillStyle = '#fff'; ctx.fillText(v, x + 28 * u, y + 82 * u);
  });
  const by = H - 150 * u;
  ctx.font = FONT(500, 28 * u); ctx.fillStyle = '#ff9fc9'; ctx.fillText('Max combo', 60 * u, by); ctx.fillText('Accuracy', 60 * u + 340 * u, by); if (pp) ctx.fillText('Performance', 60 * u + 680 * u, by);
  ctx.font = FONT(700, 66 * u); ctx.fillStyle = '#fff'; ctx.fillText(`${commas(pl.maxCombo ?? 0)}x`, 60 * u, by + 70 * u); ctx.fillText(`${acc.toFixed(2)}%`, 60 * u + 340 * u, by + 70 * u); if (pp) ctx.fillText(`${commas(pp)}pp`, 60 * u + 680 * u, by + 70 * u);
  ctx.restore();
  // the big rank letter on the right
  const rx = W * 0.64 + (W * 0.36) / 2, ry = H * 0.46;
  ctx.save(); ctx.translate(0, (1 - ease(progress / 0.35)) * 40 * u);
  ctx.textAlign = 'center'; ctx.shadowColor = rc; ctx.shadowBlur = 60 * u; ctx.font = FONT(900, (rank.letter.length > 1 ? 340 : 440) * u); ctx.fillStyle = rc; ctx.fillText(rank.letter, rx, ry + 150 * u);
  ctx.restore();
}

// ---------- simple (the plain centred card) ----------

function simpleCard(ctx, W, H, o) {
  const { kind, scene, bg } = o, u = H / 1080, cx = W / 2, m = scene.meta ?? {}, pl = scene.play ?? {}, pr = getProfile() ?? {}, img = getAvatar();
  drawCover(ctx, W, H, bg, { dim: 0.8 });
  const text = (s, y, px, weight, fill, maxW = W * 0.86) => {
    ctx.font = FONT(weight, px * u); ctx.textAlign = 'center'; ctx.fillStyle = fill;
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 8 * u; ctx.fillText(fitText(ctx, s, maxW), cx, y * u); ctx.shadowBlur = 0;
  };
  const r = (kind === 'intro' ? 120 : 84) * u, ay = (kind === 'intro' ? 330 : 230) * u;
  avatarCircle(ctx, cx, ay, r, img, scene.player);
  const ny = ay / u + (kind === 'intro' ? 215 : 160);
  text(scene.player || 'Player', ny, kind === 'intro' ? 92 : 70, 800, '#fff');
  const sub = [pr.country_code, pr.rank ? `#${commas(pr.rank)}` : ''].filter(Boolean).join('  ·  ');
  if (sub) text(sub, ny + 52, 38, 600, 'rgba(255,255,255,0.7)');
  if (kind === 'intro') {
    text(m.title || '', ny + 190, 62, 700, '#fff');
    text(m.artistUnicode || m.artist || '', ny + 245, 38, 500, 'rgba(255,255,255,0.75)');
    text(`[${m.version || ''}]  ·  mapped by ${m.creator || ''}`, ny + 300, 34, 500, 'rgba(255,255,255,0.6)');
  } else {
    text(`${m.artistUnicode || m.artist || ''} - ${m.title || ''} [${m.version || ''}]`, ny + 110, 34, 600, 'rgba(255,255,255,0.75)');
    const stats = [['Accuracy', `${accuracy(pl).toFixed(2)}%`], ['Max combo', `${commas(pl.maxCombo ?? 0)}x`], ['Score', commas(pl.score ?? 0)]];
    const pp = finalPp(scene); if (pp) stats.push(['pp', commas(pp)]);
    const bw = 300 * u, gap = 24 * u, total = stats.length * bw + (stats.length - 1) * gap, x0 = cx - total / 2, by = (ny + 175) * u;
    stats.forEach(([label, val], i) => {
      const x = x0 + i * (bw + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; rr(ctx, x, by, bw, 170 * u, 22 * u); ctx.fill();
      ctx.textAlign = 'center'; ctx.shadowBlur = 0;
      ctx.font = FONT(500, 30 * u); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(label, x + bw / 2, by + 52 * u);
      ctx.font = FONT(800, 62 * u); ctx.fillStyle = '#fff'; ctx.fillText(val, x + bw / 2, by + 125 * u);
    });
    text(`${commas(pl.n100 ?? 0)} droplets (x100)   ·   ${commas(pl.n50 ?? 0)} small (x50)   ·   ${commas(pl.nMiss ?? 0)} misses`, ny + 400, 34, 500, 'rgba(255,255,255,0.7)');
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{kind: 'intro'|'outro', scene: object, bg: ImageBitmap|HTMLImageElement|null, progress: number, style?: 'lazer'|'stable'|'simple'}} o progress 0..1 through the card
 */
export function drawCard(ctx, W, H, o) {
  const style = CARD_STYLES.includes(o.style) ? o.style : 'lazer';
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0; ctx.textAlign = 'left';
  // the whole card fades in and out; the opaque base keeps the video from flashing through
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = clamp01(cardFade(o.progress));
  const draw = style === 'simple' ? simpleCard : style === 'stable' ? (o.kind === 'intro' ? stableIntro : stableOutro) : (o.kind === 'intro' ? lazerIntro : lazerOutro);
  draw(ctx, W, H, o);
  ctx.restore();
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
}
