// Audio preparation for the exported video. Pure DSP on Float32Array channels (no WebAudio needed),
// so it can be unit-tested in Node.
//
// Timeline: beatmap time 0 is audio time 0. The video starts at beatmap time `startTime`
// (usually a bit before the first fruit) and runs at `rate` x speed (DT = 1.5, HT = 0.75).
//   - DT / HT keep the pitch (time-stretch, WSOLA), like osu!stable.
//   - Nightcore (NC) speeds up and raises the pitch (plain resampling).

export const SAMPLE_RATE = 48000;

const FRAME = 2048;          // WSOLA frame length (samples); 50% overlap
const HOP = FRAME / 2;
const SEARCH = 512;          // +- samples searched for the best splice point
const DECIM = 4;             // coarse search runs on a 4x decimated mono signal

/** Copy `len` samples starting at `start` (may be negative / run past the end -> zeros). */
function slice(ch, start, len) {
  const out = new Float32Array(len);
  const from = Math.max(0, start);
  const to = Math.min(ch.length, start + len);
  if (to > from) out.set(ch.subarray(from, to), from - start);
  return out;
}

/** Linear-interpolation resampling: output is `rate` times faster (and higher pitched). */
export function resample(channels, rate, outLen) {
  return channels.map((ch) => {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const p = i * rate;
      const i0 = Math.floor(p);
      const f = p - i0;
      const a = i0 < ch.length ? ch[i0] : 0;
      const b = i0 + 1 < ch.length ? ch[i0 + 1] : 0;
      out[i] = a + (b - a) * f;
    }
    return out;
  });
}

/**
 * Pitch-preserving time-stretch with WSOLA (waveform-similarity overlap-add).
 * `rate` > 1 makes the audio shorter/faster, < 1 longer/slower. Output length is outLen samples.
 */
export function timeStretch(channels, rate, outLen) {
  const n = channels[0].length;
  const nch = channels.length;

  // mono mix for finding splice points (both channels use the same positions, so stereo stays aligned)
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / nch;
  const dn = Math.floor(n / DECIM);
  const dec = new Float32Array(dn);
  for (let j = 0; j < dn; j++) {
    let s = 0;
    for (let k = 0; k < DECIM; k++) s += mono[j * DECIM + k];
    dec[j] = s / DECIM;
  }

  const win = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME); // periodic Hann: 50% overlaps sum to 1
  const win0 = win.slice();
  for (let i = 0; i < HOP; i++) win0[i] = 1; // first frame: no fade-in

  const frames = Math.ceil(outLen / HOP) + 1;
  const out = channels.map(() => new Float32Array(frames * HOP + FRAME));
  const hopIn = HOP * rate;
  const overlapD = HOP / DECIM;

  const addFrame = (k, start, w) => {
    for (let c = 0; c < nch; c++) {
      const src = channels[c], dst = out[c], base = k * HOP;
      for (let i = 0; i < FRAME; i++) {
        const si = start + i;
        if (si >= n) break;
        if (si >= 0) dst[base + i] += src[si] * w[i];
      }
    }
  };

  let prev = 0;
  addFrame(0, 0, win0);
  for (let k = 1; k < frames; k++) {
    const nominal = Math.round(k * hopIn);
    if (nominal - SEARCH >= n) break; // past the end of the input
    const target = prev + HOP;        // where the previous frame would naturally continue
    const td = Math.floor(target / DECIM);

    // coarse search (decimated)
    let bestD = Math.round(nominal / DECIM), bestScore = -Infinity;
    const lo = Math.max(0, Math.floor((nominal - SEARCH) / DECIM));
    const hi = Math.min(dn - overlapD - 1, Math.ceil((nominal + SEARCH) / DECIM));
    if (td + overlapD < dn) {
      for (let sd = lo; sd <= hi; sd++) {
        let dot = 0, energy = 1e-9;
        for (let i = 0; i < overlapD; i++) { const v = dec[sd + i]; dot += dec[td + i] * v; energy += v * v; }
        const score = dot / Math.sqrt(energy);
        if (score > bestScore) { bestScore = score; bestD = sd; }
      }
    }

    // fine search around the coarse optimum at full resolution
    let best = bestD * DECIM, fineBest = -Infinity;
    for (let s = bestD * DECIM - DECIM; s <= bestD * DECIM + DECIM; s++) {
      if (s < 0 || s + HOP >= n || target + HOP >= n) continue;
      let dot = 0, energy = 1e-9;
      for (let i = 0; i < HOP; i += 2) { const v = mono[s + i]; dot += mono[target + i] * v; energy += v * v; }
      const score = dot / Math.sqrt(energy);
      if (score > fineBest) { fineBest = score; best = s; }
    }

    addFrame(k, best, win);
    prev = best;
  }

  return out.map((ch) => ch.slice(0, outLen));
}

/**
 * Cut the song to the video's time range and speed, ready to encode.
 * @param {Float32Array[]} channels decoded song at SAMPLE_RATE (1 or 2 channels)
 * @param {object} o
 * @param {number} o.startTime beatmap time (ms) of video frame 0
 * @param {number} o.durationSec length of the video in seconds
 * @param {number} [o.rate] 1.5 for DT/NC, 0.75 for HT
 * @param {boolean} [o.nightcore] raise pitch with speed instead of preserving it
 * @param {number} [o.volume] 0..1
 * @returns {Float32Array[]} two channels, exactly round(durationSec * SAMPLE_RATE) samples
 */
export function prepareAudio(channels, { startTime, durationSec, rate = 1, nightcore = false, volume = 1, sampleRate = SAMPLE_RATE }) {
  const stereo = channels.length >= 2 ? [channels[0], channels[1]] : [channels[0], channels[0]];
  const outLen = Math.round(durationSec * sampleRate);
  const srcStart = Math.round((startTime / 1000) * sampleRate);

  let out;
  if (rate === 1) {
    out = stereo.map((ch) => slice(ch, srcStart, outLen));
  } else {
    const srcLen = Math.ceil(outLen * rate) + FRAME * 2;
    const seg = stereo.map((ch) => slice(ch, srcStart, srcLen));
    out = nightcore ? resample(seg, rate, outLen) : timeStretch(seg, rate, outLen);
  }

  // tiny fades at both ends so cutting mid-sound does not click
  const fin = Math.min(outLen, Math.round(0.003 * sampleRate));
  const fout = Math.min(outLen, Math.round(0.02 * sampleRate));
  for (const ch of out) {
    for (let i = 0; i < outLen; i++) ch[i] *= volume;
    for (let i = 0; i < fin; i++) ch[i] *= i / fin;
    for (let i = 0; i < fout; i++) ch[outLen - 1 - i] *= i / fout;
  }
  return out;
}

/**
 * Play `channels` (audio for the normal timeline) through a slow-motion warp (see warp.js): each slowed stretch is
 * time-stretched with its pitch kept, the rest is copied. The result is exactly round(seconds * sampleRate) long.
 */
export function warpAudio(channels, warp, sampleRate, seconds = warp.totalV / 1000) {
  const outLen = Math.round(seconds * sampleRate);
  const out = channels.map(() => new Float32Array(outLen));
  for (const sg of warp.segs) {
    const from = Math.round((sg.u0 / 1000) * sampleRate), n = Math.round(((sg.u1 - sg.u0) / 1000) * sampleRate);
    const at = Math.round((sg.v0 / 1000) * sampleRate), len = Math.round(((sg.u1 - sg.u0) / sg.speed / 1000) * sampleRate);
    let part;
    if (sg.speed === 1) part = channels.map((ch) => slice(ch, from, n));
    else {
      const src = channels.map((ch) => slice(ch, from, n + FRAME * 2));
      part = timeStretch(src, sg.speed, len);
    }
    const fade = Math.min(len >> 1, Math.round(0.002 * sampleRate));
    part.forEach((p, c) => {
      for (let i = 0; i < fade; i++) { const g = i / fade; p[i] *= g; p[len - 1 - i] *= g; }
      for (let i = 0; i < len && at + i < outLen; i++) out[c][at + i] += p[i];
    });
  }
  return out;
}
