// The Flashlight mod (CatchModFlashlight): everything outside a circle around the catcher is black.
// Radius 203.125 playfield units at combo < 100, x0.885 from 100, x0.770 from 200, x1.538 during breaks;
// the radius glides to its target at 1.154 * default size per second (osu!stable's 0.1 per frame at 60 fps).

export const FL_DEFAULT = 203.125;
const SPEED = 1.154 / 1000;                       // fraction of the default size per ms
const comboScale = (c) => (c >= 200 ? 0.77 : c >= 100 ? 0.885 : 1);

const cache = new WeakMap();

/** Time-ordered targets [{t, size}] from the combo timeline and the break periods. */
function targets(scene) {
  const ev = [];
  const tl = scene.hud?.timeline ?? [];
  for (const e of tl) ev.push({ t: e.t, combo: e.combo });
  const breaks = scene.breaks ?? [];
  const out = [];
  let combo = 0;
  const all = [...ev.map((e) => ({ t: e.t, k: 'c', v: e.combo })),
    ...breaks.flatMap((b) => [{ t: b.start, k: 'b', v: 1 }, { t: b.end, k: 'b', v: 0 }])].sort((a, b) => a.t - b.t);
  let inBreak = 0;
  for (const e of all) {
    if (e.k === 'c') combo = e.v; else inBreak = e.v;
    out.push({ t: e.t, size: FL_DEFAULT * comboScale(combo) * (inBreak ? 1.538 : 1) });
  }
  return out;
}

/** Flashlight radius at time t (playfield units). */
export function flashlightRadius(scene, t) {
  let tg = cache.get(scene);
  if (!tg) { tg = targets(scene); cache.set(scene, tg); }
  let size = FL_DEFAULT, at = -Infinity;            // the tween's current value and the time it was last updated
  for (let i = 0; i < tg.length && tg[i].t <= t; i++) {
    const to = tg[i].t;
    const next = tg[i + 1] && tg[i + 1].t <= t ? tg[i + 1].t : t;
    const target = tg[i].size;
    const step = SPEED * FL_DEFAULT * (next - to);
    size = Math.abs(target - size) <= step ? target : size + Math.sign(target - size) * step;
    at = next;
  }
  return size;
}

/** Black out the playfield around a soft circle at (cx, cy); call inside the playfield transform. */
export function drawFlashlight(ctx, scene, t, cx, cy) {
  const r = flashlightRadius(scene, t);
  const g = ctx.createRadialGradient(cx, cy, r * 0.62, cx, cy, r * 1.0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(-4000, -4000, 8000, 8000);
  ctx.restore();
}
