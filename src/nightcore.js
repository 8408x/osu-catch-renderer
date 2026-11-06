// The Nightcore beat, following osu!lazer's ModNightcore.NightcoreBeatContainer (itself a port of osu!stable):
// with NC on, a drum loop of kick / clap / hat / finish samples plays on every half beat of the beatmap's
// timing points, in step with the sped-up song. The pattern repeats every 4 bars, with a "finish" cymbal
// on the first beat of each 4-bar segment.

const DIVISOR = 2;                  // beats are counted in half beats
const MIN_BEAT_LENGTH = 50;         // BeatSyncedContainer.MinimumBeatLength
const BARS_PER_SEGMENT = 4;

/** Uninherited timing points as the beat container sees them (last one wins when two share a time). */
export function beatSegments(bm) {
  const byTime = new Map();
  for (const p of bm.timingPoints) if (p.uninherited && p.beatLength > 0) byTime.set(p.time, p);
  const list = [...byTime.values()].sort((a, b) => a.time - b.time);
  return list.length ? list : [{ time: 0, beatLength: 1000, meter: 4, omitFirstBarLine: false }];
}

/**
 * Every Nightcore sample the game would play between startTime and endTime (beatmap time, ms).
 * @param {{timingPoints:object[], sliderTickRate:number}} bm
 * @returns {{t:number, sample:'kick'|'clap'|'hat'|'finish'}[]}
 */
export function nightcoreBeats(bm, startTime, endTime) {
  const segs = beatSegments(bm);
  const playHats = Math.abs(((bm.sliderTickRate ?? 1) % 2)) < 1e-9;   // stable: only when the tick rate is a multiple of 2
  const out = [];
  let firstBeat = null;
  let lastBeat = -1;

  const onBeat = (t, idx, seg) => {
    const numerator = seg.meter || 4;
    const segmentLength = numerator * DIVISOR * BARS_PER_SEGMENT;
    if (firstBeat === null || idx < firstBeat) firstBeat = idx < 0 ? 0 : Math.floor(idx / segmentLength) * segmentLength;
    if (idx < firstBeat) return;
    if (lastBeat === idx) return;
    lastBeat = idx;
    const inSegment = idx % segmentLength;
    if (inSegment === 0 && (idx > 0 || !seg.omitFirstBarLine)) out.push({ t, sample: 'finish' });
    if (numerator === 3) {
      const b = inSegment % 6;
      if (b === 0) out.push({ t, sample: 'kick' });
      else if (b === 3) out.push({ t, sample: 'clap' });
      else if (playHats) out.push({ t, sample: 'hat' });
    } else if (numerator === 4) {
      const b = inSegment % 4;
      if (b === 0) out.push({ t, sample: 'kick' });
      else if (b === 2) out.push({ t, sample: 'clap' });
      else if (playHats) out.push({ t, sample: 'hat' });
    }
  };

  for (let k = 0; k < segs.length; k++) {
    const seg = segs[k];
    const until = k + 1 < segs.length ? segs[k + 1].time : Infinity;   // the next timing point takes over from its own time
    if (until <= startTime) continue;
    let bl = seg.beatLength / DIVISOR;
    while (bl < MIN_BEAT_LENGTH) bl *= 2;
    const omit = seg.omitFirstBarLine ? 1 : 0;
    // the first segment is entered at startTime (mid-beat is fine), later ones at their own start
    const from = Math.max(startTime, seg.time);
    let j = Math.floor((from - seg.time) / bl);
    onBeat(from, j - omit, seg);                        // the container fires once as soon as it runs, then on every beat change
    for (j = j + 1; ; j++) {
      const t = seg.time + j * bl;
      if (t >= until || t > endTime) break;
      onBeat(t, j - omit, seg);
    }
  }
  return out.filter((e) => e.t >= startTime && e.t <= endTime);
}
