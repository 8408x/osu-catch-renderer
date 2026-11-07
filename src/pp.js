// osu!catch difficulty and performance (pp), ported from osu!lazer (CatchDifficultyCalculator, Movement skill and
// MovementEvaluator, CatchPerformanceCalculator). Used for the live pp counter:
//   - star rating is recomputed as the map is "played", the way lazer's CalculateTimed does (one attribute set after
//     each top-level hit object: fruit, juice stream or banana shower),
//   - the live pp then combines that star rating with the judgements made so far,
//   - the second number is the pp of a perfect play of the whole map with the same mods.

const NORMALIZED_HALF_CATCHER_WIDTH = 41;
const PLAYER_POSITIONING_ERROR = 16;
const DIRECTION_CHANGE_BONUS = 21;
const DIFFICULTY_MULTIPLIER = 4.59;
const STRAIN_DECAY_BASE = 0.2, DECAY_WEIGHT = 0.94, SECTION_LENGTH = 750;

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
const difficultyRange = (v, min, mid, max) =>
  v > 5 ? mid + ((max - mid) * (v - 5)) / 5 : v < 5 ? mid - ((mid - min) * (5 - v)) / 5 : mid;

/** The mods' clock rate (DT / NC 1.5, HT 0.75). */
export function clockRateOf(mods) {
  if (mods & (64 | 512)) return 1.5;
  if (mods & 256) return 0.75;
  return 1;
}

// ---------- difficulty ----------

/** CatchDifficultyHitObject for every fruit / big droplet after the first (bananas and tiny droplets are skipped). */
function difficultyObjects(scene, clockRate) {
  const palpable = scene.objects.filter((o) => o.kind === 'fruit' || o.kind === 'droplet');
  let half = scene.catchWidth * 0.5;                              // Catcher.CalculateCatchWidth(difficulty) / 2
  half *= 1 - Math.max(0, scene.cs - 5.5) * 0.0625;
  const scaling = NORMALIZED_HALF_CATCHER_WIDTH / half;
  const out = [];
  for (let i = 1; i < palpable.length; i++) {
    const base = palpable[i], last = palpable[i - 1];
    const index = out.length;
    const prev = index === 0 ? null : out[index - 1];
    const normalizedPosition = base.x * scaling;
    const lastNormalizedPosition = last.x * scaling;
    const lastPlayerPosition = prev ? prev.playerPosition : lastNormalizedPosition;
    let playerPosition = clamp(
      lastPlayerPosition,
      normalizedPosition - (NORMALIZED_HALF_CATCHER_WIDTH - PLAYER_POSITIONING_ERROR),
      normalizedPosition + (NORMALIZED_HALF_CATCHER_WIDTH - PLAYER_POSITIONING_ERROR),
    );
    const distanceMoved = playerPosition - lastPlayerPosition;
    const exactDistanceMoved = normalizedPosition - lastPlayerPosition;
    if (last.hyper) playerPosition = normalizedPosition;
    out.push({
      base, last, index, clockRate,
      startTime: base.t / clockRate,
      deltaTime: (base.t - last.t) / clockRate,
      strainTime: Math.max(40, (base.t - last.t) / clockRate),
      playerPosition, distanceMoved, exactDistanceMoved,
      lastHyper: !!last.hyper, lastDistToHyper: last.distToHyper ?? 0,
    });
  }
  return out;
}

/** MovementEvaluator.EvaluateDifficultyOf */
function evaluate(objs, cur) {
  const last = cur.index >= 1 ? objs[cur.index - 1] : null;
  const lastLast = cur.index >= 2 ? objs[cur.index - 2] : null;
  const speed = cur.clockRate;
  const weightedStrainTime = cur.strainTime + 13 + 3 / speed;
  let distanceAddition = Math.abs(cur.distanceMoved) ** 1.3 / 510;
  const sqrtStrain = Math.sqrt(weightedStrainTime);
  let edgeDashBonus = 0;

  if (Math.abs(cur.distanceMoved) > 0.1) {
    if (cur.index >= 1 && Math.abs(last.distanceMoved) > 0.1 && sign(cur.distanceMoved) !== sign(last.distanceMoved)) {
      const bonusFactor = Math.min(50, Math.abs(cur.distanceMoved)) / 50;
      const antiflowFactor = Math.max(Math.min(70, Math.abs(last.distanceMoved)) / 70, 0.38);
      distanceAddition += (DIRECTION_CHANGE_BONUS / Math.sqrt(last.strainTime + 16)) * bonusFactor * antiflowFactor
        * Math.max(1 - (weightedStrainTime / 1000) ** 3, 0);
    }
    distanceAddition += (12.5 * Math.min(Math.abs(cur.distanceMoved), NORMALIZED_HALF_CATCHER_WIDTH * 2))
      / (NORMALIZED_HALF_CATCHER_WIDTH * 6) / sqrtStrain;
  }

  let linearSpacingCount = 0;
  for (let i = 0; i < Math.min(cur.index, 10); i++) {
    const prevObj = objs[cur.index - 1 - i];
    if (sign(cur.distanceMoved) !== sign(prevObj.distanceMoved) || cur.distanceMoved === 0 || prevObj.distanceMoved === 0) break;
    const currentSpacing = Math.abs(cur.distanceMoved / cur.strainTime);
    const prevSpacing = Math.abs(prevObj.distanceMoved / prevObj.strainTime);
    const relativeDifference = Math.abs(currentSpacing / prevSpacing - 1);
    if (relativeDifference > 0.05) break;
    linearSpacingCount++;
  }
  distanceAddition *= 0.7 ** linearSpacingCount;

  if (cur.lastDistToHyper <= 20) {
    if (!cur.lastHyper) edgeDashBonus += 5.7;
    distanceAddition *= 1 + edgeDashBonus * ((20 - cur.lastDistToHyper) / 20)
      * (Math.min(cur.strainTime * speed, 265) / 265) ** 1.5;     // edge dashes are easier at lower ms values
  }

  if (cur.index >= 2 && Math.abs(cur.exactDistanceMoved) <= NORMALIZED_HALF_CATCHER_WIDTH * 2
    && cur.exactDistanceMoved === -last.exactDistanceMoved && last.exactDistanceMoved === -lastLast.exactDistanceMoved
    && cur.strainTime === last.strainTime && last.strainTime === lastLast.strainTime) distanceAddition = 0;

  return distanceAddition / weightedStrainTime;
}

/** The Movement skill (a StrainDecaySkill) fed object by object; `star()` is the star rating so far. */
function newMovementSkill(objs) {
  let currentStrain = 0, sectionPeak = 0, sectionEnd = 0;
  const peaks = [];
  const decay = (ms) => STRAIN_DECAY_BASE ** (ms / 1000);
  return {
    process(cur) {
      if (cur.index === 0) sectionEnd = Math.ceil(cur.startTime / SECTION_LENGTH) * SECTION_LENGTH;
      while (cur.startTime > sectionEnd) {
        peaks.push(sectionPeak);
        sectionPeak = currentStrain * decay(sectionEnd - objs[cur.index - 1].startTime);   // CalculateInitialStrain
        sectionEnd += SECTION_LENGTH;
      }
      currentStrain *= decay(cur.deltaTime);
      currentStrain += evaluate(objs, cur);
      sectionPeak = Math.max(currentStrain, sectionPeak);
    },
    star() {
      let difficulty = 0, weight = 1;
      const all = [...peaks, sectionPeak].filter((p) => p > 0).sort((a, b) => b - a);
      for (const p of all) { difficulty += p * weight; weight *= DECAY_WEIGHT; }
      return Math.sqrt(difficulty) * DIFFICULTY_MULTIPLIER;
    },
  };
}

/**
 * Star rating and max combo after each top-level hit object, plus the final ones.
 * @param {{objects:object[], mods:number, cs:number, ar:number, catchWidth:number}} scene (objects carry x, t, kind, idx, hyper, distToHyper)
 * @returns {{steps:{t:number, star:number, maxCombo:number}[], star:number, maxCombo:number}}
 */
export function buildDifficulty(scene) {
  const clockRate = clockRateOf(scene.mods ?? 0);
  const objs = difficultyObjects(scene, clockRate);
  const skill = newMovementSkill(objs);

  // top-level hit objects in order: end time and how many combo objects they add
  const groups = new Map();
  for (const o of scene.objects) {
    const g = groups.get(o.idx) ?? { idx: o.idx, end: -Infinity, combo: 0 };
    g.end = Math.max(g.end, o.t);
    if (o.kind === 'fruit' || o.kind === 'droplet') g.combo++;
    groups.set(o.idx, g);
  }
  const ordered = [...groups.values()].sort((a, b) => a.idx - b.idx);

  const steps = [];
  let next = 0, maxCombo = 0;
  for (const g of ordered) {
    maxCombo += g.combo;
    while (next < objs.length && objs[next].base.t <= g.end) skill.process(objs[next++]);
    steps.push({ t: g.end, star: skill.star(), maxCombo });
  }
  while (next < objs.length) skill.process(objs[next++]);
  return { steps, star: skill.star(), maxCombo };
}

// ---------- performance ----------

/**
 * CatchPerformanceCalculator.
 * @param {{star:number, maxCombo:number}} attrs
 * @param {{n300:number, n100:number, n50:number, nKatu:number, nMiss:number, maxCombo:number}} s
 * @param {{mods:number, ar:number}} ctx `ar` is the approach rate after HR / EZ
 */
export function catchPerformance(attrs, s, ctx) {
  const mods = ctx.mods ?? 0;
  const scoreMaxCombo = clamp(s.maxCombo, 0, attrs.maxCombo);
  let value = (5 * Math.max(1, attrs.star / 0.0049) - 4) ** 2 / 100000;

  const totalComboHits = s.nMiss + s.n100 + s.n300;
  const lengthBonus = 0.95 + 0.3 * Math.min(1, totalComboHits / 2500)
    + (totalComboHits > 2500 ? Math.log10(totalComboHits / 2500) * 0.475 : 0);
  value *= lengthBonus;
  value *= 0.97 ** s.nMiss;
  if (attrs.maxCombo > 0) value *= Math.min(scoreMaxCombo ** 0.35 / attrs.maxCombo ** 0.35, 1);

  const preempt = difficultyRange(ctx.ar, 1800, 1200, 450) / clockRateOf(mods);
  const ar = preempt > 1200 ? -(preempt - 1800) / 120 : -(preempt - 1200) / 150 + 5;
  let arFactor = 1;
  if (ar > 9) arFactor += 0.1 * (ar - 9);
  if (ar > 10) arFactor += 0.1 * (ar - 10);
  else if (ar < 8) arFactor += 0.025 * (8 - ar);
  value *= arFactor;

  if (mods & 8) {                                                // Hidden
    if (ar <= 10) value *= 1.05 + 0.075 * (10 - ar);
    else value *= 1.01 + 0.04 * (11 - Math.min(11, ar));
  }
  if (mods & 1024) value *= 1.35 * lengthBonus;                  // Flashlight

  const totalHits = s.n50 + s.n100 + s.n300 + s.nMiss + s.nKatu;
  const accuracy = totalHits === 0 ? 0 : clamp((s.n50 + s.n100 + s.n300) / totalHits, 0, 1);
  value *= accuracy ** 5.5;
  if (mods & 1) value *= Math.max(0.9, 1 - 0.02 * s.nMiss);      // NoFail
  return value;
}

/** pp of a flawless play of the whole map. */
export function maxPerformance(scene, diff) {
  let n300 = 0, n100 = 0, n50 = 0;
  for (const o of scene.objects) {
    if (o.kind === 'fruit') n300++; else if (o.kind === 'droplet') n100++; else if (o.kind === 'tiny') n50++;
  }
  return catchPerformance({ star: diff.star, maxCombo: diff.maxCombo },
    { n300, n100, n50, nKatu: 0, nMiss: 0, maxCombo: diff.maxCombo }, { mods: scene.mods ?? 0, ar: scene.ar });
}

/** pp of a full-combo play of the whole map at a given accuracy (0..1): tiny droplets are lost first, then droplets. */
export function ppAtAccuracy(scene, diff, acc) {
  let n300 = 0, n100 = 0, n50 = 0;
  for (const o of scene.objects) {
    if (o.kind === 'fruit') n300++; else if (o.kind === 'droplet') n100++; else if (o.kind === 'tiny') n50++;
  }
  const total = n300 + n100 + n50;
  let lost = Math.max(0, total - Math.round(clamp(acc, 0, 1) * total));
  const tinyMiss = Math.min(lost, n50); lost -= tinyMiss;
  const dropMiss = Math.min(lost, n100); lost -= dropMiss;
  return catchPerformance({ star: diff.star, maxCombo: diff.maxCombo },
    { n300: n300 - lost, n100: n100 - dropMiss, n50: n50 - tinyMiss, nKatu: tinyMiss, nMiss: dropMiss + lost, maxCombo: Math.max(0, diff.maxCombo - dropMiss - lost) },
    { mods: scene.mods ?? 0, ar: scene.ar });
}

/** Live pp at time t, from the HUD entry (`v` = hudAt(...)) and the star rating after the latest top-level object. */
export function livePp(diff, scene, v, t) {
  const steps = diff.steps;
  let lo = -1, hi = steps.length;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (steps[mid].t <= t + 1e-4) lo = mid; else hi = mid; }
  if (lo < 0) return 0;
  const a = steps[lo];
  return catchPerformance(a, { n300: v.n300, n100: v.n100, n50: v.n50, nKatu: v.nKatu, nMiss: v.nMiss, maxCombo: v.maxCombo },
    { mods: scene.mods ?? 0, ar: scene.ar });
}
