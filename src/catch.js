// Builds the osu!catch "scene" (every fruit / droplet with its hit time and x position)
// from a parsed beatmap, following osu!lazer's JuiceStream / SliderEventGenerator logic,
// and works out which objects a given replay caught.

import { createPath } from './slider.js?v=20261110a';
import { LegacyRandom, statelessInt, statelessSingle } from './rng.js?v=20261110a';
import { buildCatcherFx } from './catcher.js?v=20261110a';
import { buildHud, compareWithReplay } from './score.js?v=20261110a';
import { buildHealth } from './health.js?v=20261110a';
import { buildDifficulty, maxPerformance } from './pp.js?v=20261110a';
import { buildPlate } from './plate.js?v=20261110a';
import { makeSampler, bananaSamples } from './hitsounds.js?v=20261110a';

export const FIELD_W = 512;
export const FIELD_H = 384;

const BASE_SIZE = 106.75;          // Catcher.BASE_SIZE
const ALLOWED_CATCH_RANGE = 0.8;   // Catcher.ALLOWED_CATCH_RANGE
const OBJECT_RADIUS = 64;          // CatchHitObject.OBJECT_RADIUS
const TAIL_LENIENCY = -36;         // SliderEventGenerator.TAIL_LENIENCY

export const DEFAULT_COLOURS = [[255, 192, 0], [0, 202, 0], [18, 124, 255], [242, 24, 57]];

const BANANA_COLOURS = [[255, 240, 0], [255, 192, 0], [214, 221, 28]]; // Banana.getBananaColour

const MOD_EZ = 2, MOD_HR = 16, MOD_DT = 64, MOD_HT = 256, MOD_NC = 512;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const difficultyRange = (v, min, mid, max) =>
  v > 5 ? mid + ((max - mid) * (v - 5)) / 5 : v < 5 ? mid - ((mid - min) * (5 - v)) / 5 : mid;

/** Combo colours: the beatmap's own, else the skin's skin.ini, else osu!'s defaults. */
export function resolveColours(bm, skin) {
  if (bm.colours.length) return bm.colours;
  if (skin && skin.colours.length) return skin.colours;
  return DEFAULT_COLOURS;
}

/** Playback speed implied by the mods (DT/NC 1.5x, HT 0.75x). */
export function modRate(mods) {
  if (mods & (MOD_DT | MOD_NC)) return 1.5;
  if (mods & MOD_HT) return 0.75;
  return 1;
}

// Timing: beat length of the active red line and slider-velocity multiplier of the active green line.
function makeTimingLookup(points) {
  const sorted = points.map((p, i) => ({ ...p, i })).sort((a, b) => a.time - b.time || a.i - b.i);
  const firstRed = sorted.find((p) => p.uninherited);
  let beatLength = firstRed ? firstRed.beatLength : 1000;
  let sv = 1;
  const states = sorted.map((p) => {
    if (p.uninherited) { beatLength = p.beatLength; sv = 1; } // a red line resets the velocity multiplier
    else sv = 100 / clamp(-p.beatLength, 10, 1000);
    return { time: p.time, beatLength, sv, kiai: !!p.kiai };
  });
  const initial = { beatLength: firstRed ? firstRed.beatLength : 1000, sv: 1, kiai: false };
  return {
    at(t) {
      let lo = -1, hi = states.length;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (states[mid].time <= t) lo = mid; else hi = mid;
      }
      return lo >= 0 ? states[lo] : initial;
    },
  };
}

function juiceStreamObjects(h, bm, timing) {
  const { beatLength, sv } = timing.at(h.time);
  const path = createPath(h.curveType, h.points, h.pixelLength);
  const length = Math.min(100000, path.distance);

  const velocity = (100 * bm.sliderMultiplier * sv) / beatLength; // px per ms
  const scoringDistance = 100 * bm.sliderMultiplier * sv;
  let tickDistance = clamp(scoringDistance / bm.sliderTickRate, 0, length);
  if (!(velocity > 0) || !(length > 0)) {
    const single = [{ t: h.time, x: clamp(h.x, 0, FIELD_W), kind: 'fruit', node: 0 }];
    single.spanDuration = 0;
    return single;
  }

  const spans = h.slides;
  const spanDuration = path.distance / velocity;
  const start = h.time;
  const minDistanceFromEnd = velocity * 10;

  // --- SliderEventGenerator.Generate ---
  const events = [{ type: 'head', time: start, progress: 0 }];
  for (let span = 0; span < spans; span++) {
    const spanStart = start + span * spanDuration;
    const reversed = span % 2 === 1;
    if (tickDistance !== 0) {
      const ticks = [];
      for (let d = tickDistance, n = 0; d <= length && n < 10000; d += tickDistance, n++) {
        if (d >= length - minDistanceFromEnd) break;
        const p = d / length;
        ticks.push({ type: 'tick', time: spanStart + (reversed ? 1 - p : p) * spanDuration, progress: p });
      }
      if (reversed) ticks.reverse();
      events.push(...ticks);
    }
    if (span < spans - 1) events.push({ type: 'repeat', time: spanStart + spanDuration, progress: (span + 1) % 2 });
  }
  const totalDuration = spans * spanDuration;
  const finalSpanStart = start + (spans - 1) * spanDuration;
  const lastTickTime = Math.max(start + totalDuration / 2, finalSpanStart + spanDuration + TAIL_LENIENCY);
  let lastTickProgress = (lastTickTime - finalSpanStart) / spanDuration;
  if (spans % 2 === 0) lastTickProgress = 1 - lastTickProgress;
  events.push({ type: 'legacyLastTick', time: lastTickTime, progress: lastTickProgress });
  events.push({ type: 'tail', time: start + totalDuration, progress: spans % 2 });

  // --- JuiceStream.CreateNestedHitObjects ---
  const xAt = (p) => clamp(h.x + path.positionAt(p).x, 0, FIELD_W);
  const out = [];
  out.spanDuration = spanDuration;
  let node = 0;                                   // nodes (head / repeats / tail) carry the edge samples in order
  let last = null;
  for (const e of events) {
    if (last) {
      const since = Math.trunc(e.time) - Math.trunc(last.time);
      if (since > 80) {
        let between = since;
        while (between > 100) between /= 2;
        for (let t = between; t < since; t += between) {
          out.push({
            t: last.time + t,
            // lazer keeps the raw (unclamped) path position; only the final x is clamped
            x: h.x + path.positionAt(last.progress + (t / since) * (e.progress - last.progress)).x,
            kind: 'tiny',
          });
        }
      }
    }
    last = e; // includes legacyLastTick, like lazer
    if (e.type === 'tick') out.push({ t: e.time, x: xAt(e.progress), kind: 'droplet' });
    else if (e.type === 'head' || e.type === 'tail' || e.type === 'repeat') out.push({ t: e.time, x: xAt(e.progress), kind: 'fruit', node: node++ });
  }
  return out;
}

const f32 = Math.fround;

/** BananaShower.createBananas: float32 spacing loop, one banana per step. */
function bananaTimes(h) {
  const startTime = Math.trunc(h.time), endTime = Math.trunc(h.endTime);
  let spacing = f32(h.endTime - h.time);
  while (spacing > 100) spacing = f32(spacing / 2);
  if (!(spacing > 0)) return [];
  const out = [];
  for (let time = f32(startTime); time <= endTime && out.length < 100000; time = f32(time + spacing)) out.push(time);
  return out;
}

/** CatchBeatmapProcessor.applyHardRockOffset (returns the new XOffset, and updates `st`). */
function hardRockOffset(x, time, st, rng) {
  let pos = x;
  if (st.lastPosition == null || st.lastPosition === 0) { st.lastPosition = pos; st.lastTime = time; return 0; }
  const diff = pos - st.lastPosition;
  const timeDiff = Math.trunc(time - st.lastTime);
  if (timeDiff > 1000) { st.lastPosition = pos; st.lastTime = time; return 0; }
  if (diff === 0) {
    const right = rng.nextBool();
    const rand = Math.min(20, rng.nextRange(0, Math.max(0, timeDiff / 4)));
    if (right) pos = pos + rand <= FIELD_W ? pos + rand : pos - rand;
    else pos = pos - rand >= 0 ? pos - rand : pos + rand;
    return pos - x;
  }
  if (Math.abs(diff) < timeDiff / 3) {
    if (diff > 0) { if (pos + diff < FIELD_W) pos += diff; }
    else if (pos + diff > 0) pos += diff;
  }
  st.lastPosition = pos; st.lastTime = time;
  return pos - x;
}

/**
 * CatchBeatmapProcessor.initialiseHyperDash: a fruit / droplet is a "hyper" when the catcher could not
 * reach the next one at dash speed. Sets `hyper` (target = next object) on those objects.
 */
function initialiseHyperDash(objects, catcherScale) {
  const list = objects.filter((o) => o.kind === 'fruit' || o.kind === 'droplet');
  const half = (BASE_SIZE * catcherScale) / 2; // = CalculateCatchWidth / 2 / ALLOWED_CATCH_RANGE
  let lastDirection = 0, lastExcess = half;
  for (let i = 0; i < list.length - 1; i++) {
    const cur = list[i], next = list[i + 1];
    cur.hyper = null;
    const dir = next.x > cur.x ? 1 : -1;
    const timeToNext = Math.trunc(next.t) - Math.trunc(cur.t) - 1000 / 60 / 4;
    const distToNext = Math.abs(next.x - cur.x) - (lastDirection === dir ? lastExcess : half);
    const d = f32(timeToNext * 1.0 - distToNext);
    if (d < 0) { cur.hyper = next; cur.distToHyper = 0; lastExcess = half; }
    else { cur.distToHyper = d; lastExcess = clamp(d, 0, half); }
    lastDirection = dir;
  }
}

/**
 * @param {ReturnType<import('./osu.js').parseOsu>} bm
 * @param {number} mods replay mod bitflags
 */
export function buildScene(bm, mods = 0) {
  let cs = bm.cs;
  let ar = bm.ar;
  if (mods & MOD_HR) { cs = Math.min(cs * 1.3, 10); ar = Math.min(ar * 1.4, 10); }
  if (mods & MOD_EZ) { cs *= 0.5; ar *= 0.5; }

  const preempt = Math.trunc(difficultyRange(ar, 1800, 1200, 450));
  const catcherScale = 1 - (0.7 * (cs - 5)) / 5;          // Catcher scale
  const fruitScale = catcherScale / 2;                       // CatchHitObject.Scale
  const fruitRadius = OBJECT_RADIUS * fruitScale;
  const catchWidth = BASE_SIZE * catcherScale * ALLOWED_CATCH_RANGE;

  const timing = makeTimingLookup(bm.timingPoints);
  const sampler = makeSampler(bm);

  // Each object keeps `combo` (raw combo number; colour = combo % colours.length, so the colour
  // list can change later with the skin) and `idx` (index of its top-level hit object, which picks
  // pear/grapes/apple/orange as idx % 4 and is shared by a juice stream's nested objects).
  // Walk order matters: lazer's shared LegacyRandom(1337) is consumed object by object.
  const rng = new LegacyRandom(1337);
  const hr = !!(mods & MOD_HR);
  const hrState = { lastPosition: null, lastTime: 0 };
  const flat = [];        // palpable objects in lazer's GetPalpableObjects order (before the stable sort)
  let comboIndex = 0;
  let forceNewCombo = false;
  let first = true;
  let idx = 0;
  let prevLast = null;    // last palpable object of the previous hit object: gets `lastInCombo` when a new combo starts
  for (const h of bm.hitObjects) {
    const myIdx = idx++;                                          // banana showers count too
    if (h.kind === 'shower') {
      forceNewCombo = true;
      const showerSamples = sampler.spinner(h);
      let bananaIndex = 0;
      prevLast = null;
      for (const time of bananaTimes(h)) {
        const x = clamp(f32(rng.nextDouble() * FIELD_W), 0, FIELD_W);
        rng.next(); rng.next(); rng.next();                       // stable's banana type / rotation / colour draws
        const seed = Math.trunc(time);
        const rgb = BANANA_COLOURS[statelessInt(3, seed)];
        flat.push(prevLast = {
          t: time, x, kind: 'banana', rgb, idx: myIdx, combo: comboIndex,
          startScale: 0.6 + 1.6 * statelessSingle(seed, 3),
          startAngle: 180 * (statelessSingle(seed, 1) * 2 - 1),
          endAngle: 180 * (statelessSingle(seed, 2) * 2 - 1),
          samples: bananaSamples(showerSamples, bananaIndex++),
        });
      }
      if (prevLast) prevLast.lastInCombo = true;                 // BananaShower.LastInCombo is always true
      continue;
    }
    if ((h.newCombo || forceNewCombo) && !first) {
      comboIndex += 1 + h.comboSkip;
      if (prevLast) prevLast.lastInCombo = true;                 // UpdateComboInformation: lastObj.LastInCombo = true
    }
    forceNewCombo = false;
    first = false;

    if (h.kind === 'fruit') {
      const ox = clamp(h.x, 0, FIELD_W);
      const off = hr ? hardRockOffset(ox, h.time, hrState, rng) : 0;
      flat.push(prevLast = { t: h.time, x: clamp(ox + off, 0, FIELD_W), kind: 'fruit', combo: comboIndex, idx: myIdx, samples: sampler.circle(h) });
    } else if (h.kind === 'stream') {
      const last = h.points[h.points.length - 1];
      hrState.lastPosition = clamp(h.x, 0, FIELD_W) + last.x; hrState.lastTime = h.time;
      const nested = juiceStreamObjects(h, bm, timing);
      const sounds = sampler.stream(h, nested.spanDuration);
      nested.sort((a, b) => a.t - b.t);                           // HitObject.nestedHitObjects.Sort
      for (const o of nested) {
        let x = o.x;
        if (o.kind === 'tiny') x = clamp(x + Math.min(Math.max(rng.nextRange(-20, 20), -o.x), FIELD_W - o.x), 0, FIELD_W);
        else if (o.kind === 'droplet') rng.next();                // stable's droplet rotation draw
        const samples = o.kind === 'fruit' ? sounds.nodes[Math.min(o.node, sounds.nodes.length - 1)]
          : o.kind === 'droplet' ? sounds.droplets : [];
        flat.push(prevLast = { ...o, x, combo: comboIndex, idx: myIdx, samples });
      }
    }
  }
  const objects = flat.slice().sort((a, b) => a.t - b.t);        // stable, like OrderBy(StartTime)
  initialiseHyperDash(objects, catcherScale);
  for (const o of objects) o.kiai = timing.at(o.t + 1).kiai;   // HitObject: EffectPointAt(StartTime + 1)
  // spin seed: RandomSingle(1) = StatelessRNG(seed = (int) start time, series 1), used for fruit tilt and droplet spin
  for (const o of objects) if (o.kind !== 'banana') o.rot0 = statelessSingle(Math.trunc(o.t), 1);

  const firstT = objects.length ? objects[0].t : 0;
  const lastT = objects.length ? objects[objects.length - 1].t : 0;

  return {
    cs, ar, preempt, fruitRadius, fruitScale, catcherScale, catchWidth,
    rate: modRate(mods),
    mods,
    hp: Math.min(10, (mods & MOD_HR ? bm.hp * 1.4 : mods & MOD_EZ ? bm.hp * 0.5 : bm.hp)),
    breaks: bm.breaks ?? [],
    colours: resolveColours(bm, null),
    objects,
    startTime: firstT - preempt - 500,
    endTime: lastT + 1500,
    meta: {
      title: bm.title, artist: bm.artist, artistUnicode: bm.artistUnicode || bm.artist, version: bm.version, creator: bm.creator,
      cs, ar, hp: Math.min(10, (mods & MOD_HR ? bm.hp * 1.4 : mods & MOD_EZ ? bm.hp * 0.5 : bm.hp)),
      od: Math.min(10, (mods & MOD_HR ? (bm.od ?? 0) * 1.4 : mods & MOD_EZ ? (bm.od ?? 0) * 0.5 : (bm.od ?? 0))),
      bpm: (() => { const tp = bm.timingPoints.find((x) => x.uninherited && x.beatLength > 0); return tp ? (60000 / tp.beatLength) * modRate(mods) : 0; })(),
      lengthMs: (lastT - firstT) / modRate(mods),
    },
  };
}

/**
 * Mark each object as caught or missed for this replay (Catcher.CanCatch at the object's hit time),
 * then work out the catcher's hyperdash timeline and trails (scene.fx).
 * Bananas are counted separately from fruits and droplets.
 */
export function evaluateCatches(scene, track, shiftMs = 0) {
  const half = scene.catchWidth / 2;
  scene.judgeShift = shiftMs;
  let caught = 0, total = 0, bananas = 0, bananasCaught = 0;
  for (const o of scene.objects) {
    // Replay frames are whole milliseconds and the game judges at a whole-millisecond clock, so
    // an object at 22383.4 ms is checked against the catcher at 22383 ms, not an in-between spot.
    const cx = track.xAt(Math.floor(o.t) + shiftMs);
    o.caught = o.x >= cx - half && o.x <= cx + half;
    o.offset = o.x - cx;
    if (o.kind === 'banana') { bananas++; if (o.caught) bananasCaught++; }
    else if (o.kind !== 'tiny') { total++; if (o.caught) caught++; }
  }
  scene.fx = buildCatcherFx(scene, track);
  scene.hud = buildHud(scene);
  scene.health = buildHealth(scene);
  scene.diff = buildDifficulty(scene);
  scene.maxPp = maxPerformance(scene, scene.diff);
  scene.plate = buildPlate(scene, track);
  return { caught, total, bananas, bananasCaught, hud: scene.hud.totals };
}


/**
 * Some replays are recorded a few milliseconds off the map's clock (the player's own timing offset), which
 * flips the close calls. When the plain check differs from the replay's counts, try small shifts and return
 * the smallest one that makes every count match exactly; 0 when none does (so replays that already match
 * or can't be explained are left alone).
 */
export function findJudgeShift(scene, track, replay, maxShift = 20) {
  const half = scene.catchWidth / 2;
  const totalsAt = (shift) => {
    for (const o of scene.objects) o.caught = o.x >= track.xAt(Math.floor(o.t) + shift) - half && o.x <= track.xAt(Math.floor(o.t) + shift) + half;
    return buildHud(scene).totals;
  };
  if (compareWithReplay(totalsAt(0), replay).ok) return 0;
  for (let d = 1; d <= maxShift; d++) for (const sh of [d, -d]) if (compareWithReplay(totalsAt(sh), replay).ok) return sh;
  return 0;
}
