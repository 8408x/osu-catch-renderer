// Combo and accuracy over time, following osu!lazer's catch rules:
//   - fruits and droplets (big ones) count for combo: a catch adds 1, a miss resets it to 0,
//   - tiny droplets count for accuracy but never for combo (a missed tiny droplet keeps the combo),
//   - bananas are bonus: they affect neither combo nor accuracy,
//   - accuracy = caught / judged over fruits + droplets + tiny droplets (every object weighs the same;
//     lazer's CatchScoreProcessor gives them all 300 base points, to match stable).
// Objects are judged at their hit time, in the order of scene.objects.

/**
 * @param {{objects:{t:number, kind:string, caught:boolean}[]}} scene after evaluateCatches()
 * @returns {{timeline:{t:number, combo:number, maxCombo:number, acc:number, bumpT:number}[], totals:object}}
 */
export function buildHud(scene) {
  const timeline = [];
  let combo = 0, maxCombo = 0, hits = 0, judged = 0, bumpT = -Infinity;
  const sc = newScorer(scene);
  const totals = { fruits: 0, droplets: 0, tiny: 0, tinyMiss: 0, miss: 0, bananas: 0, bananasCaught: 0 };
  for (const o of scene.objects) {
    if (o.kind === 'banana') {
      totals.bananas++;
      if (o.caught) totals.bananasCaught++;
      const last = timeline[timeline.length - 1];
      timeline.push({ ...(last ?? { combo: 0, maxCombo: 0, acc: 1, bumpT: -Infinity }), t: o.t, ...sc.judge(o, combo) });
      continue;
    }
    o.comboBefore = combo;                         // JudgementResult.ComboAtJudgement: the combo prior to this result
    judged++;
    if (o.caught) hits++;
    if (o.kind === 'tiny') {
      if (o.caught) totals.tiny++; else totals.tinyMiss++;
    } else if (o.caught) {
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      bumpT = o.t;
      if (o.kind === 'fruit') totals.fruits++; else totals.droplets++;
    } else {
      combo = 0;
      totals.miss++;
    }
    timeline.push({ t: o.t, combo, maxCombo, acc: hits / judged, bumpT, ...sc.judge(o, combo) });
  }
  totals.maxCombo = maxCombo;
  totals.accuracy = judged ? hits / judged : 1;
  totals.score = timeline.length ? timeline[timeline.length - 1].score : 0;
  return { timeline, totals };
}

// ---------- score (lazer's standardised score, as CatchScoreProcessor computes it) ----------
//   total = (600k + 400k * (1 - tinyShare)) * comboProgress + 400k * tinyShare * tinyHitFraction + 200 per banana,
//   where comboProgress = combo-weighted score so far / combo-weighted score of a perfect run, and tinyShare is the
//   share of tiny droplets among fruits + tiny droplets. The result is multiplied by the mods' multiplier.
const COMBO_CAP = 200, COMBO_BASE = 4;
const log4 = (v) => Math.log(v) / Math.log(COMBO_BASE);
const comboWeight = (n) => Math.min(Math.max(0.5, log4(n)), log4(COMBO_CAP));
export const SCORE_ROLL_MS = 1000;                       // the legacy score counter rolls up over 1 s (OutQuad)
const outQuad = (p) => 1 - (1 - p) * (1 - p);

/** Mod multiplier (CatchScoreMultiplierCalculator) for the replay's mod flags. */
export function scoreMultiplier(mods) {
  let m = 1;
  if (mods & 2) m *= 0.5;                                // EZ
  if (mods & 1) m *= 0.5;                                // NF
  if (mods & 256) m *= 0.3;                              // HT (0.75x)
  if (mods & 16) m *= 1.12;                              // HR
  if (mods & (64 | 512)) m *= 1.1;                       // DT / NC (1.5x)
  if (mods & 8) m *= 1.06;                               // HD
  if (mods & 1024) m *= 1.12;                            // FL
  if (mods & 128) m *= 0.1;                              // RX
  return m;
}

function newScorer(scene) {
  let fruits = 0, tinies = 0, perfect = 0, n = 0;
  for (const o of scene.objects) {
    if (o.kind === 'tiny') tinies++;
    else if (o.kind !== 'banana') {
      if (o.kind === 'fruit') fruits++;
      perfect += (o.kind === 'fruit' ? 300 : 100) * comboWeight(++n);
    }
  }
  const tinyShare = tinies + fruits ? tinies / (tinies + fruits) : 0;
  const mult = scoreMultiplier(scene.mods ?? 0);
  let portion = 0, tinyHit = 0, bonus = 0;
  let shown = 0, lastT = -Infinity, from = 0;            // rolling display state
  const display = (t) => from + (shown - from) * outQuad(Math.min(1, Math.max(0, (t - lastT) / SCORE_ROLL_MS)));
  return {
    /** Apply one judgement; returns the exact score after it and the value the counter was showing just before. */
    judge(o, comboAfter) {
      if (o.kind === 'banana') { if (o.caught) bonus += 200; }
      else if (o.kind === 'tiny') { if (o.caught) tinyHit++; }
      else {
        if (o.caught) portion += (o.kind === 'fruit' ? 300 : 100) * comboWeight(comboAfter);
      }
      const comboProgress = perfect > 0 ? portion / perfect : 1;
      const raw = (1000000 - 400000 + 400000 * (1 - tinyShare)) * comboProgress
        + 400000 * tinyShare * (tinies ? tinyHit / tinies : 0) + bonus;
      const score = Math.round(Math.round(raw) * mult);
      from = display(o.t); lastT = o.t; shown = score;
      return { score, scoreFrom: from };
    },
  };
}

/** The score the counter shows at time t (it rolls towards the latest value). */
export function scoreShownAt(v, t) {
  const age = (t - v.t) / SCORE_ROLL_MS;
  if (!(v.t > -Infinity)) return 0;
  return Math.round(v.scoreFrom + (v.score - v.scoreFrom) * outQuad(Math.min(1, Math.max(0, age))));
}

/** HUD values at beatmap time t (nothing judged yet: combo 0, accuracy 100%). */
export function hudAt(hud, t) {
  const tl = hud.timeline;
  let lo = -1, hi = tl.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tl[mid].t <= t + 1e-4) lo = mid; else hi = mid;
  }
  return lo >= 0 ? tl[lo] : { t: -Infinity, combo: 0, maxCombo: 0, acc: 1, bumpT: -Infinity, score: 0, scoreFrom: 0 };
}

/**
 * Compare our result with the counts stored in the replay file (osu!catch: n300 = fruits, n100 = droplets,
 * n50 = tiny droplets caught, nKatu = tiny droplets missed, nMiss = fruits and droplets missed).
 * @returns {{ok:boolean, diffs:string[]}}
 */
export function compareWithReplay(totals, replay) {
  const rows = [
    ['fruits caught', totals.fruits, replay.n300],
    ['droplets caught', totals.droplets, replay.n100],
    ['tiny droplets caught', totals.tiny, replay.n50],
    ['tiny droplets missed', totals.tinyMiss, replay.nKatu],
    ['misses', totals.miss, replay.nMiss],
    ['max combo', totals.maxCombo, replay.maxCombo],
  ];
  const diffs = rows.filter(([, ours, theirs]) => Number.isFinite(theirs) && ours !== theirs)
    .map(([name, ours, theirs]) => `${name}: ${ours} here, ${theirs} in the replay`);
  return { ok: diffs.length === 0, diffs };
}
