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
  const totals = { fruits: 0, droplets: 0, tiny: 0, tinyMiss: 0, miss: 0, bananas: 0, bananasCaught: 0 };
  for (const o of scene.objects) {
    if (o.kind === 'banana') { totals.bananas++; if (o.caught) totals.bananasCaught++; continue; }
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
    timeline.push({ t: o.t, combo, maxCombo, acc: hits / judged, bumpT });
  }
  totals.maxCombo = maxCombo;
  totals.accuracy = judged ? hits / judged : 1;
  return { timeline, totals };
}

/** HUD values at beatmap time t (nothing judged yet: combo 0, accuracy 100%). */
export function hudAt(hud, t) {
  const tl = hud.timeline;
  let lo = -1, hi = tl.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tl[mid].t <= t + 1e-4) lo = mid; else hi = mid;
  }
  return lo >= 0 ? tl[lo] : { t: -Infinity, combo: 0, maxCombo: 0, acc: 1, bumpT: -Infinity };
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
