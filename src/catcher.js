// What the catcher does over time that depends on how the replay played out:
//   - animation state (idle / kiai / fail) from the last judged object,
//   - hyperdash state and the red tint transition (osu!lazer Catcher.SetHyperDashState),
//   - dash / hyperdash trails and the after-image (CatcherArea.UpdateAfterChildren).
// Everything is precomputed once per (scene, replay) so preview and export draw the same thing.

const HYPER_TRANSITION_MS = 180;     // Catcher.HYPER_DASH_TRANSITION_DURATION
const BASE_DASH_SPEED = 1.0;
const TRAIL_INTERVAL_MS = 16;        // CatcherArea trail_generation_interval
const FRAME_MS = 1000 / 60;          // nominal gameplay frame when sampling the replay
export const TRAIL_LIFE_MS = 800;       // dash / hyperdash trail fade
export const AFTERIMAGE_LIFE_MS = 1200;

const outQuint = (p) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 5);

function lowerBound(arr, key, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid][key] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * Hyperdash segments: after a hyper fruit is caught the catcher is "hyperdashing" until the next judged
 * object, or until the replay's catcher passes the target position, whichever comes first.
 * @returns {{start:number,end:number,tx:number}[]}
 */
export function computeHyperSegments(objects, track) {
  const segs = [];
  let seg = null;
  let lastStart = -Infinity;
  for (const o of objects) {
    if (o.kind === 'tiny') continue;                 // tiny droplets never change the hyperdash state
    if (o.t === lastStart) continue;                 // already started on this frame
    if (seg && seg.end === undefined) seg.end = o.t;
    seg = null;
    if (o.caught && o.hyper) {
      const cx = track.xAt(o.t);
      const target = o.hyper;
      const diff = target.x - cx;
      const speed = Math.abs(diff / Math.max(1, target.t - o.t - 1000 / 60)) / BASE_DASH_SPEED;
      if (speed > 1 && cx !== target.x) {
        seg = { start: o.t, end: undefined, tx: target.x, dir: Math.sign(diff) };
        segs.push(seg);
        lastStart = o.t;
      }
    }
  }
  if (seg && seg.end === undefined) seg.end = seg.start + 2000;
  for (const s of segs) {
    for (let t = s.start + 1; t < s.end; t++) {      // Catcher.Update: reaching the target ends the hyperdash
      const x = track.xAt(t);
      if ((s.dir > 0 && s.tx < x) || (s.dir < 0 && s.tx > x)) { s.end = t; break; }
    }
  }
  return segs;
}

/** Tint transitions (white <-> hyperdash colour) with their starting values, for hyperAmount(). */
function buildTransitions(segs) {
  const raw = [];
  for (let i = 0; i < segs.length; i++) {
    const chained = i > 0 && segs[i - 1].end >= segs[i].start;
    if (chained) raw.pop();                          // stays hyperdashing: no off / on pair
    else raw.push({ time: segs[i].start, to: 1 });
    raw.push({ time: segs[i].end, to: 0 });
  }
  let from = 0, prev = null;
  for (const tr of raw) {
    if (prev) from = prev.from + (prev.to - prev.from) * outQuint((tr.time - prev.time) / HYPER_TRANSITION_MS);
    tr.from = from;
    prev = tr;
  }
  return raw;
}

/** 0 = normal catcher colour, 1 = fully tinted with the hyperdash colour. */
export function hyperAmount(fx, t) {
  const tr = fx.transitions;
  const i = lowerBound(tr, 'time', t + 1e-6) - 1;
  if (i < 0) return 0;
  return tr[i].from + (tr[i].to - tr[i].from) * outQuint((t - tr[i].time) / HYPER_TRANSITION_MS);
}

export function isHyperDashing(fx, t) {
  const i = lowerBound(fx.segments, 'start', t + 1e-6) - 1;
  return i >= 0 && t < fx.segments[i].end;
}

/** Catcher animation state: set by each judged object (a missed banana changes nothing). */
export function catcherStateAt(fx, t) {
  const i = lowerBound(fx.states, 't', t + 1e-4) - 1;
  return i < 0 ? 'idle' : fx.states[i].state;
}

export function buildCatcherFx(scene, track) {
  const objects = scene.objects;
  const states = [];
  for (const o of objects) {
    if (o.caught) states.push({ t: o.t, state: o.kiai ? 'kiai' : 'idle' });
    else if (o.kind !== 'banana') states.push({ t: o.t, state: 'fail' });
  }
  const segments = computeHyperSegments(objects, track);
  const fx = { states, segments, transitions: buildTransitions(segments), trails: [] };

  // trails, sampled at a nominal 60 fps like a normal gameplay session
  const afterImageAt = new Set();
  segments.forEach((s, i) => { if (!(i > 0 && segments[i - 1].end >= s.start)) afterImageAt.add(s.start); });
  const trails = [];
  let lastTrail = -Infinity;
  const t0 = scene.startTime, t1 = scene.endTime;
  for (let t = t0; t <= t1; t += FRAME_MS) {
    const hyper = isHyperDashing(fx, t);
    const dashing = hyper || track.dashAt(t);
    const snap = (kind) => ({ t, kind, x: track.xAt(t), facing: track.facingAt(t), state: catcherStateAt(fx, t) });
    if (dashing && t - lastTrail >= TRAIL_INTERVAL_MS) { trails.push(snap(hyper ? 'hyper' : 'dash')); lastTrail = t; }
  }
  for (const s of afterImageAt) {
    trails.push({ t: s, kind: 'after', x: track.xAt(s), facing: track.facingAt(s), state: catcherStateAt(fx, s) });
  }
  trails.sort((a, b) => a.t - b.t);
  fx.trails = trails;
  return fx;
}
