// Caught objects on the catcher's plate, following osu!lazer's Catcher:
//   - a caught fruit lands at its offset from the catcher centre and, when it overlaps something already on the
//     plate, is nudged sideways and upward until it has room (computePositionInStack, taken from osu!stable),
//   - droplets and bananas never stay: they fly off right away (the "explode" animation),
//   - the last object of a combo clears the plate: everything explodes when that object was caught (bananas
//     always explode), or drops when it was missed.
// Everything is computed once per (scene, replay); `plateAt` then answers "what is where at time t".

import { LegacyRandom } from './rng.js?v=20261109a';

const OBJECT_RADIUS = 64;
const FIELD_H = 384;
const PLATE_Y = -5;                 // caughtObjectContainer.Y: fruit sit 5 px above the catcher's top
const SCALE_ON_PLATE = 0.5;         // caught_fruit_scale_adjust
const LENIENCE_ADJUST = 10 / OBJECT_RADIUS;
export const DROP_LIFE_MS = 750;    // both animations fade out over 750 ms

const sine = { out: (p) => Math.sin((p * Math.PI) / 2), in: (p) => 1 - Math.cos((p * Math.PI) / 2) };
const clamp01 = (p) => Math.min(1, Math.max(0, p));

/**
 * @param {{objects:object[], fruitScale:number, catcherScale:number}} scene after catch evaluation (caught / offset set)
 * @param {{xAt:(t:number)=>number}} track
 * @returns {{entries:object[], prefixEnd:number[]}}
 */
export function buildPlate(scene, track) {
  const rng = new LegacyRandom(4242);                   // lazer uses an unseeded RNG; any fixed seed does
  const nextSingle = (lo, hi) => lo + rng.nextDouble() * (hi - lo);
  const entries = [];
  let onPlate = [];

  const leave = (e, t, anim) => {
    e.removedT = t;
    e.anim = anim;
    e.dropX = track.xAt(t) + e.px;                      // dropped objects stay where they were, in field space
  };
  const clearPlate = (t, anim) => {
    for (const e of onPlate) leave(e, t, anim);
    onPlate = [];
  };

  for (const o of scene.objects) {
    const t = o.t;
    if (o.caught) {
      const k = o.kind === 'tiny' ? 0.5 : 1;   // DrawablePalpableCatchHitObject.DisplaySize: tiny droplets are half size
      const adjusted = OBJECT_RADIUS * 2 * scene.fruitScale * k * LENIENCE_ADJUST;
      const limit = adjusted * adjusted;
      let px = o.offset, py = 0;
      for (let guard = 0; guard < 500 && onPlate.some((f) => (f.px - px) ** 2 + (f.py - py) ** 2 < limit); guard++) {
        px += nextSingle(-adjusted, adjusted);
        py -= nextSingle(0, 5);
      }
      const e = { obj: o, px, py, placedT: t, removedT: Infinity, anim: null, dropX: 0 };
      entries.push(e);
      onPlate.push(e);
      if (o.kind !== 'fruit') {                         // droplets and bananas do not stay on the plate
        onPlate.pop();
        leave(e, t, 'explode');
      }
    }
    if (o.lastInCombo) {
      // CatchJudgement.ShouldExplodeFor: a hit explodes, a miss drops; bananas always explode
      clearPlate(t, o.caught || o.kind === 'banana' ? 'explode' : 'drop');
    }
  }

  // entries are in placement order; prefixEnd lets plateAt skip the ones that are already gone
  const prefixEnd = [];
  let m = -Infinity;
  for (const e of entries) {
    m = Math.max(m, e.removedT + DROP_LIFE_MS);
    prefixEnd.push(m);
  }
  return { entries, prefixEnd, catcherScale: scene.catcherScale };
}

/**
 * What to draw for the plate at time t, oldest first (later ones draw on top).
 * @returns {{obj:object, x:number, y:number, alpha:number, onPlate:boolean}[]}   x is a field x (catcher centre for fruit on the plate)
 */
export function plateAt(plate, t, catcherX) {
  const { entries, prefixEnd, catcherScale } = plate;
  const out = [];
  let lo = 0, hi = entries.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (prefixEnd[mid] > t) hi = mid; else lo = mid + 1; }
  for (let i = lo; i < entries.length; i++) {
    const e = entries[i];
    if (e.placedT > t) break;
    const baseY = FIELD_H + PLATE_Y + e.py;
    if (t < e.removedT) { out.push({ obj: e.obj, x: catcherX + e.px, y: baseY, alpha: 1, onPlate: true }); continue; }
    const age = t - e.removedT;
    if (age >= DROP_LIFE_MS) continue;
    const alpha = 1 - age / DROP_LIFE_MS;
    if (e.anim === 'drop') {
      out.push({ obj: e.obj, x: e.dropX, y: baseY + 75 * sine.in(clamp01(age / DROP_LIFE_MS)), alpha, onPlate: false });
    } else {
      // up 50 over 250 ms (OutSine), then down to +50 over 500 ms (InSine); sideways x6 of the offset over 1 s
      const dy = age < 250 ? -50 * sine.out(age / 250) : -50 + 100 * sine.in(clamp01((age - 250) / 500));
      const originalX = e.px / catcherScale;
      out.push({ obj: e.obj, x: e.dropX + originalX * 6 * clamp01(age / 1000), y: baseY + dy, alpha, onPlate: false });
    }
  }
  return out;
}

// ---------- hit lighting (LegacyHitExplosion) ----------

const EXPLOSION1_MS = 300, EXPLOSION1_GROW_MS = 160;
const EXPLOSION2_MS = 700, EXPLOSION2_GROW_MS = 500;
const CATCH_MARGIN = (1 - 0.8) / 2;                // (1 - ALLOWED_CATCH_RANGE) / 2
const outQuad = (p) => 1 - (1 - clamp01(p)) ** 2;
const lerp = (a, b, p) => a + (b - a) * p;
export const EXPLOSION_LIFE_MS = Math.max(EXPLOSION1_MS, EXPLOSION2_MS);

/**
 * The hit explosions alive at time t. Every caught object lights up once, at its catch time. Fruit get the
 * wide flash (`flash`, scaled by the combo) plus the soft glow; droplets and bananas only the glow.
 * Sizes are multipliers of the two texture sizes; `offset` is in the catcher's own (scaled) units.
 * @returns {{obj:object, offset:number, flash:null|{alpha:number,sx:number,sy:number}, glow:{alpha:number,sx:number,sy:number}}[]}
 */
export function explosionsAt(plate, scene, t) {
  const { entries } = plate;
  const out = [];
  let lo = 0, hi = entries.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (entries[mid].placedT < t - EXPLOSION_LIFE_MS) lo = mid + 1; else hi = mid; }
  const half = scene.catchWidth / 2;
  for (let i = lo; i < entries.length; i++) {
    const e = entries[i];
    if (e.placedT > t) break;
    const age = t - e.placedT;
    const o = e.obj;
    const offset = Math.min(Math.max(e.px, -half + CATCH_MARGIN * 3), half - CATCH_MARGIN * 3);
    let flash = null;
    if (o.kind === 'fruit' && age < EXPLOSION1_MS) {
      const sc = Math.min(1.125, Math.max(0.35, (o.comboBefore ?? 0) / 200));
      const p = outQuad(age / EXPLOSION1_GROW_MS);
      flash = { alpha: 1 - age / EXPLOSION1_MS, sx: lerp(1, 16 * sc, p), sy: lerp(0.9, 1.1, p) };
    }
    const glow = age < EXPLOSION2_MS
      ? { alpha: 1 - age / EXPLOSION2_MS, sx: 0.9, sy: lerp(1, 1.3, outQuad(age / EXPLOSION2_GROW_MS)) } : null;
    if (flash || glow) out.push({ obj: o, offset, flash, glow });
  }
  return out;
}
