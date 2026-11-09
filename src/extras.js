// Experimental extras drawn on top of the playfield. Everything here is optional and off by default; render.js calls
// these only when the matching switch in Settings > Experimental is on. Playfield coordinates (field units) unless noted.

import { FIELD_W, FIELD_H } from './catch.js?v=20261111m';
import { keysAt } from './keys.js?v=20261111m';

const FLASH_MS = 380;
const ERR_WINDOW_MS = 3000;
const TRAIL_MS = 650;

function lowerBound(objs, t) {
  let lo = 0, hi = objs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (objs[mid].t < t) lo = mid + 1; else hi = mid; }
  return lo;
}

const missCache = new WeakMap();
/** Times (ms) of every missed fruit or droplet, in order. Tiny droplets and bananas do not break the combo. */
export function missTimes(scene) {
  let m = missCache.get(scene);
  if (!m) { m = scene.objects.filter((o) => !o.caught && (o.kind === 'fruit' || o.kind === 'droplet')).map((o) => o.t); missCache.set(scene, m); }
  return m;
}

const kindScale = (o) => (o.kind === 'droplet' ? 0.8 : o.kind === 'tiny' ? 0.4 : 1);

/** Outlines of the objects falling in and of the catcher's plate: the area that decides every catch. */
export function drawHitboxes(ctx, scene, lo, hi, t, catcherX, s) {
  const objs = scene.objects;
  ctx.save();
  ctx.lineWidth = 2 / s;
  for (let i = hi - 1; i >= lo; i--) {
    const o = objs[i], rem = o.t - t;
    const y = FIELD_H * (1 - rem / scene.preempt);
    if (rem <= 0 && o.caught) continue;                       // a caught object has left the playfield
    const r = scene.fruitRadius * kindScale(o);
    ctx.strokeStyle = rem > 0 ? 'rgba(255,255,255,0.65)' : 'rgba(255,77,109,0.9)';
    ctx.beginPath(); ctx.arc(o.x, y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(o.x, y, 2 / s, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill();
  }
  const half = scene.catchWidth / 2;
  ctx.strokeStyle = '#4dd2ff'; ctx.fillStyle = 'rgba(77,210,255,0.14)';
  ctx.lineWidth = 2.5 / s;
  ctx.fillRect(catcherX - half, FIELD_H - 9, half * 2, 18);
  ctx.strokeRect(catcherX - half, FIELD_H - 9, half * 2, 18);
  ctx.beginPath(); ctx.moveTo(catcherX, FIELD_H - 14); ctx.lineTo(catcherX, FIELD_H + 14); ctx.stroke();
  ctx.restore();
}

/** A brief red wash over the whole picture right after a combo-breaking miss (screen space). */
export function drawMissFlash(ctx, W, H, scene, t) {
  const ms = missTimes(scene);
  let lo = 0, hi = ms.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ms[mid] <= t) lo = mid + 1; else hi = mid; }
  if (!lo) return;
  const age = t - ms[lo - 1];
  if (age < 0 || age > FLASH_MS) return;
  const a = 0.32 * (1 - age / FLASH_MS) ** 2;
  const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(255,40,70,0)');
  g.addColorStop(1, `rgba(255,40,70,${a * 2})`);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(255,40,70,${a * 0.35})`; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Left, dash and right keys, lit while held, with how many times each was pressed (an estimate: see keys.js). */
export function drawKeyPad(ctx, keys, t) {
  const ks = keysAt(keys, t);
  const size = 34, gap = 8, x0 = FIELD_W - (size * 3 + gap * 2) - 6, y0 = FIELD_H - 150;
  const defs = [['←', ks.left], ['DASH', ks.dash], ['→', ks.right]];
  ctx.save();
  ctx.textAlign = 'center';
  defs.forEach(([label, k], i) => {
    const x = x0 + i * (size + gap), lift = k.down ? 2 : 0;
    ctx.fillStyle = k.down ? 'rgba(255,107,157,0.92)' : 'rgba(255,255,255,0.09)';
    ctx.strokeStyle = k.down ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(x, y0 + lift, size, size, 7); ctx.fill(); ctx.stroke();
    ctx.fillStyle = k.down ? '#fff' : 'rgba(255,255,255,0.7)';
    ctx.font = `600 ${label === 'DASH' ? 9 : 16}px system-ui, sans-serif`;
    ctx.fillText(label, x + size / 2, y0 + lift + size / 2 + (label === 'DASH' ? 3 : 6));
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText(String(k.count), x + size / 2, y0 + size + 14);
  });
  ctx.restore();
}

/** Where the catcher has just been: a fading ribbon rising behind it. */
export function drawTrail(ctx, track, t) {
  ctx.save();
  for (let tau = 0; tau <= TRAIL_MS; tau += 16) {
    const k = 1 - tau / TRAIL_MS;
    ctx.fillStyle = `rgba(154,209,255,${0.45 * k * k})`;
    ctx.beginPath(); ctx.arc(track.xAt(t - tau), FIELD_H - 6 - tau * 0.16, 2 + 5 * k, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/** A hit-error style meter: every recent fruit and droplet as a tick, by how far from the middle of the plate it landed. */
export function drawCatchMeter(ctx, scene, t) {
  const objs = scene.objects, half = scene.catchWidth / 2;
  const w = 300, cx = FIELD_W / 2, y = 24, reach = (w / 2) * 0.72;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.07)';
  ctx.fillRect(cx - w / 2, y - 7, w, 14);
  ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, y - 11); ctx.lineTo(cx, y + 11);
  ctx.moveTo(cx - reach, y - 8); ctx.lineTo(cx - reach, y + 8);
  ctx.moveTo(cx + reach, y - 8); ctx.lineTo(cx + reach, y + 8);
  ctx.stroke();
  for (let i = lowerBound(objs, t - ERR_WINDOW_MS); i < objs.length && objs[i].t <= t; i++) {
    const o = objs[i];
    if (o.kind !== 'fruit' && o.kind !== 'droplet') continue;
    const age = t - o.t, rel = o.offset / half, a = 1 - age / ERR_WINDOW_MS;
    const x = cx + Math.max(-1.5, Math.min(1.5, rel)) * reach;
    ctx.fillStyle = !o.caught ? `rgba(255,77,109,${a})` : `hsla(${Math.round(120 - 80 * Math.min(1, Math.abs(rel)))},85%,60%,${a})`;
    ctx.fillRect(x - 1.5, y - 8, 3, 16);
  }
  ctx.restore();
}
