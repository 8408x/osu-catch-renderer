// Hitsounds, following osu!lazer:
//   1. every fruit / droplet / banana gets the list of samples it plays when caught (bank, name, volume, custom
//      sample index), built from the .osu hit object fields and the timing point active at that moment
//      (ConvertHitObjectParser + LegacyBeatmapDecoder.applySamples),
//   2. each sample is looked up as a file: the beatmap's own files, then the user's skin, then osu!'s defaults,
//   3. the caught objects are mixed into the video's audio at their hit time, panned by x position and
//      pitched by the mod rate (DT / NC faster and higher, HT lower).

const BANKS = [null, 'normal', 'soft', 'drum'];
const HIT_NORMAL = 1, HIT_WHISTLE = 2, HIT_FINISH = 4, HIT_CLAP = 8;
const BANANA_BASE_FREQ = 0.77, BANANA_FREQ_STEP = 0.006;  // DrawableBanana.PlaySamples
const MIN_SAMPLE_VOLUME = 5;                              // DrawableHitObject.MINIMUM_SAMPLE_VOLUME
const POSITIONAL_LEVEL = 0.2;                             // OsuSetting.PositionalHitsoundsLevel default

const int = (v, d = 0) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };

/** ConvertHitObjectParser.readCustomSampleBanks */
export function readBanks(str, info, banksOnly = false) {
  if (!str) return;
  const s = String(str).split(':');
  const fix = (n) => (n >= 0 && n <= 3 ? n : 1);                       // undefined bank values count as normal
  const bank = fix(int(s[0]));
  const add = fix(int(s[1]));
  info.bankNormal = BANKS[bank];
  info.bankAdd = BANKS[add] || info.bankNormal;
  if (banksOnly) return;
  if (s.length > 2) info.index = int(s[2]);
  if (s.length > 3) info.volume = Math.max(0, int(s[3]));
  info.file = s.length > 4 && s[4] ? s[4] : null;
}

const newInfo = () => ({ bankNormal: null, bankAdd: null, index: 0, volume: 0, file: null });

/** ConvertHitObjectParser.convertSoundType */
export function convertSoundType(type, info) {
  const out = [];
  if (!info.file) out.push({ name: 'hitnormal', bank: info.bankNormal, volume: info.volume, index: info.index, file: null });
  else out.push({ name: 'hitnormal', bank: 'normal', volume: info.volume, index: 1, file: info.file });
  const add = (name) => out.push({ name, bank: info.bankAdd, volume: info.volume, index: info.index, file: null });
  if (type & HIT_FINISH) add('hitfinish');
  if (type & HIT_WHISTLE) add('hitwhistle');
  if (type & HIT_CLAP) add('hitclap');
  return out;
}

/** Sample points (one per timing line) and SampleControlPoint.ApplyTo. */
export function makeSamplePoints(bm) {
  const pts = bm.timingPoints
    .map((p, i) => ({ time: p.time, i, bank: BANKS[p.sampleSet] || 'normal', index: p.sampleIndex || 0, volume: p.volume ?? 100 }))
    .sort((a, b) => a.time - b.time || a.i - b.i);
  const fallback = { bank: 'normal', index: 0, volume: 100 };
  return {
    at(t) {
      if (!pts.length) return fallback;
      let lo = -1, hi = pts.length;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid].time <= t) lo = mid; else hi = mid; }
      return lo >= 0 ? pts[lo] : pts[0];
    },
    apply(samples, t) {
      const tp = this.at(t);
      return samples.map((s) => ({
        ...s,
        bank: s.bank || tp.bank,
        volume: s.volume > 0 ? s.volume : tp.volume,
        index: s.index >= 1 ? s.index : tp.index,
      }));
    },
  };
}

/** Samples for the objects of one parsed hit object. `spanDuration` is only needed for juice streams. */
export function makeSampler(bm) {
  const points = makeSamplePoints(bm);
  return {
    circle(h) {
      const info = newInfo();
      readBanks(h.sampleStr, info);
      return points.apply(convertSoundType(h.hitSound, info), h.time + 5);
    },
    spinner(h) {
      const info = newInfo();
      readBanks(h.sampleStr, info);
      return points.apply(convertSoundType(h.hitSound, info), h.endTime + 5);
    },
    /** @returns {{body: object[], nodes: object[][], droplets: object[]}} */
    stream(h, spanDuration) {
      const bodyInfo = newInfo();
      readBanks(h.sampleStr, bodyInfo, true);
      const nodes = h.slides + 1;
      const sounds = (h.edgeSounds || '').split('|');
      const sets = (h.edgeSets || '').split('|');
      const out = [];
      for (let i = 0; i < nodes; i++) {
        const info = { ...bodyInfo };
        if (h.edgeSets && i < sets.length) { readBanks(sets[i], info); info.file = null; }
        const type = h.edgeSounds && i < sounds.length && sounds[i] !== '' ? int(sounds[i], h.hitSound) : h.hitSound;
        out.push(points.apply(convertSoundType(type, info), h.time + i * spanDuration + 5));
      }
      const body = points.apply(convertSoundType(h.hitSound, bodyInfo), h.time + 6);
      return { body, nodes: out, droplets: body.map((s) => ({ ...s, name: 'slidertick' })) };
    },
  };
}

/** The sample list a banana plays: catch-banana at the shower's own volume, pitched by its index. */
export function bananaSamples(showerSamples, bananaIndex) {
  const n = showerSamples.find((s) => s.name === 'hitnormal') || { volume: 100, index: 0, bank: 'normal' };
  return [{ name: 'banana', bank: n.bank || 'normal', volume: n.volume, index: n.index, file: null, banana: bananaIndex }];
}

// ---------- finding the file for a sample ----------

const EXTS = ['.wav', '.mp3', '.ogg'];

function candidateNames(s) {
  if (s.banana !== undefined) return ['metronomelow', 'catch-banana'];
  const names = [];
  if (s.file) {
    const f = s.file.split(/[\\/]/).pop().toLowerCase();
    names.push(f, f.replace(/\.[^.]+$/, ''));
  }
  if (s.index >= 2) names.push(`${s.bank}-${s.name}${s.index}`);
  names.push(`${s.bank}-${s.name}`, s.name);
  return names;
}

/**
 * @param {object} sample from makeSampler
 * @param {{label:string, files:Map<string,Uint8Array>, layer:'beatmap'|'skin'|'default'}[]} sources in priority order
 * @returns {{label:string, file:string, bytes:Uint8Array}|null}
 */
export function findSampleFile(sample, sources) {
  const useBeatmap = sample.index >= 1;   // custom sample index 0 means "skin / default sounds only"
  for (const src of sources) {
    if (src.layer === 'beatmap' && !useBeatmap) continue;
    for (const name of candidateNames(sample)) {
      const tries = /\.(wav|mp3|ogg)$/.test(name) ? [name] : EXTS.map((e) => name + e);
      for (const f of tries) {
        const bytes = src.files.get(f);
        if (bytes) return { label: src.label, file: f, bytes };
      }
    }
  }
  return null;
}

// ---------- events and mixing ----------

/**
 * Resolve and decode the samples of every caught object.
 * @param {{objects:object[]}} scene after evaluateCatches()
 * @param {{sources:object[], decode:(bytes:Uint8Array)=>Promise<{channels:Float32Array[], sampleRate:number}|null>}} o
 * @returns {Promise<{events:object[], missing:string[]}>}
 */
export async function collectHitsounds(scene, { sources, decode }) {
  const cache = new Map();       // `${label}/${file}` -> decoded | null
  const missing = new Set();
  const events = [];
  for (const o of scene.objects) {
    if (!o.caught || !o.samples?.length) continue;
    for (const s of o.samples) {
      const found = findSampleFile(s, sources);
      if (!found) { missing.add(candidateNames(s).pop()); continue; }
      const key = `${found.label}/${found.file}`;
      if (!cache.has(key)) {
        let buf = null;
        try { buf = await decode(found.bytes); } catch { buf = null; }
        cache.set(key, buf);
      }
      const buf = cache.get(key);
      if (!buf) { missing.add(found.file); continue; }
      events.push({
        t: o.t, x: o.x, buf,
        gain: Math.max(s.volume, MIN_SAMPLE_VOLUME) / 100,
        freq: s.banana !== undefined ? BANANA_BASE_FREQ + s.banana * BANANA_FREQ_STEP : 1,
      });
    }
  }
  return { events, missing: [...missing] };
}

/** osu!framework balance: -1 = left, 1 = right; linear attenuation of the opposite channel. */
export function balanceFor(x, fieldWidth = 512) {
  return Math.round(POSITIONAL_LEVEL * 2 * (x / fieldWidth - 0.5) * 100) / 100;
}

/**
 * Add the hitsounds into `channels` (stereo Float32Arrays, the video's audio).
 * Beatmap time t plays at (t - startTime) / rate seconds; the mod rate also changes the sample's pitch.
 */
export function mixHitsounds(channels, events, { startTime, rate = 1, sampleRate, volume = 1 }) {
  const [L, R] = channels;
  const len = L.length;
  for (const e of events) {
    const src = e.buf.channels;
    const sl = src[0], sr = src[1] || src[0];
    const step = (e.freq * rate * e.buf.sampleRate) / sampleRate;   // source samples consumed per output sample
    const from = Math.round(((e.t - startTime) / rate / 1000) * sampleRate);
    const n = Math.ceil((sl.length - 1) / step);
    const pan = balanceFor(e.x);
    const gl = e.gain * volume * (pan > 0 ? 1 - pan : 1);
    const gr = e.gain * volume * (pan < 0 ? 1 + pan : 1);
    for (let k = 0; k < n; k++) {
      const d = from + k;
      if (d < 0) continue;
      if (d >= len) break;
      const p = k * step;
      const i0 = Math.floor(p), f = p - i0;
      const a = sl[i0], b = sl[i0 + 1] ?? a;
      const c = sr[i0], dd = sr[i0 + 1] ?? c;
      L[d] += (a + (b - a) * f) * gl;
      R[d] += (c + (dd - c) * f) * gr;
    }
  }
  for (const ch of channels) for (let i = 0; i < len; i++) ch[i] = ch[i] > 1 ? 1 : ch[i] < -1 ? -1 : ch[i];
}
