// HP over time, following osu!lazer's CatchHealthProcessor (a LegacyDrainingHealthProcessor, which mimics stable):
//   - health starts at 100%, drains continuously from the first object to the last (not during breaks),
//   - the drain rate is found the way stable finds it: a simulated perfect run must stay above a floor and end above
//     another, otherwise the drain is lowered and the per-hit gains are boosted (HpMultiplierNormal),
//   - a caught fruit gives +3%, a big droplet +1.5%, a tiny droplet +0.15%, a banana +0.25% (all times the multiplier),
//   - a missed fruit or big droplet costs 3% (HP 0) to 20% (HP 10); a missed tiny droplet or banana costs nothing.
// Health is clamped to 0..1. We only show it; a replay that failed in the real game just ends at 0.

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const difficultyRange = (v, min, mid, max) =>
  v > 5 ? mid + ((max - mid) * (v - 5)) / 5 : v < 5 ? mid - ((mid - min) * (5 - v)) / 5 : mid;

const GAIN = { fruit: 0.03, droplet: 0.015, tiny: 0.0015, banana: 0.0025 };

/** Seconds-free port of LegacyDrainingHealthProcessor.ComputeDrainRate. Returns {drain, multiplier} (drain per ms). */
export function computeDrain(objects, hp, breaks, drainStart) {
  const lowestHpEver = difficultyRange(hp, 0.975, 0.8, 0.3);
  const lowestHpEnd = difficultyRange(hp, 0.99, 0.9, 0.4);
  const recoveryAvailable = difficultyRange(hp, 0.04, 0.02, 0);
  let multiplier = 1;
  let testDrop = 0.00025;
  if (!objects.length) return { drain: testDrop, multiplier };

  for (let guard = 0; guard < 100000; guard++) {
    let hpNow = 1, hpUncapped = 1, lowest = 1, lastTime = drainStart, br = 0, fail = false;
    const reduce = (a) => { hpUncapped = Math.max(0, hpUncapped - a); hpNow = Math.max(0, hpNow - a); };
    const increase = (o) => { const a = multiplier * GAIN[o.kind]; hpUncapped += a; hpNow = Math.max(0, Math.min(1, hpNow + a)); };

    for (const o of objects) {
      while (br < breaks.length && breaks[br].end <= o.t) { lastTime = o.t; br++; }
      reduce(testDrop * (o.t - lastTime));
      lastTime = o.t;
      if (hpNow < lowest) lowest = hpNow;
      if (hpNow <= lowestHpEver) { fail = true; testDrop *= 0.96; break; }
      increase(o);                                   // zero-length objects: no drain while they last, no overkill
    }
    if (!fail && hpNow < lowestHpEnd) { fail = true; testDrop *= 0.94; multiplier *= 1.01; }
    const recovery = (hpUncapped - 1) / Math.max(1, objects.length);
    if (!fail && recovery < recoveryAvailable) { fail = true; testDrop *= 0.96; multiplier *= 1.01; }
    if (!fail && !Number.isFinite(multiplier)) return { drain: 0, multiplier: 1 };
    if (!fail) return { drain: testDrop, multiplier };
  }
  return { drain: testDrop, multiplier };
}

/**
 * @param {{objects:{t:number, kind:string, caught:boolean}[], hp:number, breaks?:{start:number,end:number}[]}} scene after evaluateCatches()
 * @returns {{events:{t:number, hp:number}[], drain:number, multiplier:number, periods:number[][]}}
 */
export function buildHealth(scene) {
  const objs = scene.objects;
  const hp = scene.hp ?? 5;
  if (!objs.length) return { events: [], drain: 0, multiplier: 1, periods: [] };
  const drainStart = objs[0].t, endT = objs[objs.length - 1].t;

  // no-drain periods: from the last object before a break to the first object after it
  const noDrain = (scene.breaks ?? []).map((b) => {
    let from = -Infinity, to = Infinity;
    for (const o of objs) { if (o.t <= b.start) from = o.t; }
    for (const o of objs) { if (o.t >= b.end) { to = o.t; break; } }
    return [from, to];
  });
  // drain periods = [drainStart, endT] minus the no-drain ones
  let periods = [[drainStart, endT]];
  for (const [a, b] of noDrain) {
    periods = periods.flatMap(([s, e]) => (b <= s || a >= e) ? [[s, e]]
      : [[s, Math.min(e, a)], [Math.max(s, b), e]].filter(([x, y]) => y > x));
  }

  const { drain, multiplier } = computeDrain(objs, hp, scene.breaks ?? [], drainStart);
  const missCost = difficultyRange(hp, -0.03, -0.125, -0.2);
  const state = { drain, periods };
  let health = 1, lastT = drainStart;
  const events = [{ t: -Infinity, hp: 1 }];
  for (const o of objs) {
    health = Math.max(0, health - drain * drainTime(periods, lastT, o.t));
    lastT = o.t;
    if (o.caught) health = Math.min(1, health + multiplier * GAIN[o.kind]);
    else if (o.kind === 'fruit' || o.kind === 'droplet') health = Math.max(0, health + missCost);
    events.push({ t: o.t, hp: health });
  }
  return { events, ...state, multiplier };
}

/** Length of [a, b] that falls inside the drain periods. */
function drainTime(periods, a, b) {
  if (b <= a) return 0;
  let sum = 0;
  for (const [s, e] of periods) {
    if (s >= b) break;
    const lo = Math.max(a, s), hi = Math.min(b, e);
    if (hi > lo) sum += hi - lo;
  }
  return sum;
}

/** Health (0..1) at beatmap time t. Before the first object it is full. */
export function healthAt(h, t) {
  const ev = h.events;
  if (!ev.length) return 1;
  let lo = 0, hi = ev.length;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ev[mid].t <= t + 1e-4) lo = mid; else hi = mid; }
  const e = ev[lo];
  if (e.t === -Infinity) return 1;                // nothing judged yet (health only starts to drain at the first object)
  return clamp(e.hp - h.drain * drainTime(h.periods, e.t, t), 0, 1);
}
