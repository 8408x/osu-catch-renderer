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
  const cnt = { n300: 0, n100: 0, n50: 0, nKatu: 0, nMiss: 0 };
  const totals = { fruits: 0, droplets: 0, tiny: 0, tinyMiss: 0, miss: 0, bananas: 0, bananasCaught: 0 };
  for (const o of scene.objects) {
    if (o.kind === 'banana') {
      totals.bananas++;
      if (o.caught) totals.bananasCaught++;
      const last = timeline[timeline.length - 1];
      timeline.push({ ...(last ?? { combo: 0, maxCombo: 0, acc: 1, bumpT: -Infinity, ...cnt }), t: o.t, ...sc.judge(o, combo) });
      continue;
    }
    o.comboBefore = combo;                         // JudgementResult.ComboAtJudgement: the combo prior to this result
    judged++;
    if (o.caught) hits++;
    if (o.kind === 'tiny') {
      if (o.caught) { totals.tiny++; cnt.n50++; } else { totals.tinyMiss++; cnt.nKatu++; }
    } else if (o.caught) {
      combo++;
      if (combo > maxCombo) maxCombo = combo;
      bumpT = o.t;
      if (o.kind === 'fruit') { totals.fruits++; cnt.n300++; } else { totals.droplets++; cnt.n100++; }
    } else {
      combo = 0;
      totals.miss++;
      cnt.nMiss++;
    }
    timeline.push({ t: o.t, combo, maxCombo, acc: hits / judged, bumpT, ...cnt, ...sc.judge(o, combo) });
  }
  totals.maxCombo = maxCombo;
  totals.accuracy = judged ? hits / judged : 1;
  totals.score = timeline.length ? timeline[timeline.length - 1].score : 0;
  return { timeline, totals };
}

// ---------- score (osu!stable's classic ScoreV1, the same numbers the replay file and the online board use) ----------
//   every hit adds  hit + hit * max(0, comboBefore - 1) * stars * modMultiplier / 25   (rounded down), with
//   hit = 300 fruit, 100 droplet, 10 tiny droplet (tiny droplets and bananas do not feed the combo bonus), 1100 banana,
//   stars = round((HP + OD + CS + clamp(objects / drainSeconds * 8, 0, 16)) / 38 * 5) from the map's own (unmodded) values.
export const SCORE_ROLL_MS = 1000;                       // the legacy score counter rolls up over 1 s (OutQuad)
const outQuad = (p) => 1 - (1 - p) * (1 - p);

/** osu!stable's score multiplier for the replay's mod flags (catch). */
export function scoreMultiplier(mods) {
  let m = 1;
  if (mods & 2) m *= 0.5;                                // EZ
  if (mods & 1) m *= 0.5;                                // NF
  if (mods & 256) m *= 0.3;                              // HT
  if (mods & 16) m *= 1.12;                              // HR
  if (mods & (64 | 512)) m *= 1.12;                      // DT / NC
  if (mods & 8) m *= 1.06;                               // HD
  if (mods & 1024) m *= 1.12;                            // FL
  return m;
}

/** DifficultyPeppyStars: scene.legacy = { hp, od, cs, objects, drainMs } from the unmodded map. */
export function peppyStars(l) {
  if (!l) return 3;
  const drain = Math.max(1, (l.drainMs ?? 0) / 1000);
  return Math.round((l.hp + l.od + l.cs + Math.min(16, Math.max(0, (l.objects / drain) * 8))) / 38 * 5);
}

function newScorer(scene) {
  const mult = peppyStars(scene.legacy) * scoreMultiplier(scene.mods ?? 0);
  let total = 0;
  let shown = 0, lastT = -Infinity, from = 0;            // rolling display state
  const display = (t) => from + (shown - from) * outQuad(Math.min(1, Math.max(0, (t - lastT) / SCORE_ROLL_MS)));
  return {
    /** Apply one judgement; returns the exact score after it and the value the counter was showing just before. */
    judge(o, comboAfter) {
      if (o.caught) {
        if (o.kind === 'banana') total += 1100;
        else if (o.kind === 'tiny') total += 10;
        else {
          const hit = o.kind === 'fruit' ? 300 : 100, before = comboAfter - 1;
          total += hit + Math.floor((hit * Math.max(0, before - 1) * mult) / 25);
        }
      }
      from = display(o.t); lastT = o.t; shown = total;
      return { score: total, scoreFrom: from };
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
  return lo >= 0 ? tl[lo] : { t: -Infinity, combo: 0, maxCombo: 0, acc: 1, bumpT: -Infinity, score: 0, scoreFrom: 0, n300: 0, n100: 0, n50: 0, nKatu: 0, nMiss: 0 };
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
  // A difference of a call or two is what frame timing in the original play can cause (the game judges each
  // object on a display frame), so it is reported as "near" rather than as a real mismatch.
  const gap = (a, b) => (Number.isFinite(b) ? Math.abs(a - b) : 0);
  const counts = gap(totals.fruits, replay.n300) <= 2 && gap(totals.droplets, replay.n100) <= 2 && gap(totals.tiny, replay.n50) <= 2
    && gap(totals.tinyMiss, replay.nKatu) <= 2 && gap(totals.miss, replay.nMiss) <= 2;
  const comboOk = gap(totals.maxCombo, replay.maxCombo) === 0 || gap(totals.miss, replay.nMiss) > 0;
  return { ok: diffs.length === 0, near: diffs.length > 0 && counts && comboOk, diffs };
}
