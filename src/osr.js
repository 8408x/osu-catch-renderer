// Parser for osu! replay (.osr) files.
// Format: https://osu.ppy.sh/wiki/en/Client/File_formats/Osr_%28file_format%29
// Frame handling mirrors osu!lazer's LegacyScoreDecoder (skip frames, negative deltas).

export const MODE = { STD: 0, TAIKO: 1, CATCH: 2, MANIA: 3 };

export const MOD = {
  NF: 1, EZ: 2, TD: 4, HD: 8, HR: 16, SD: 32, DT: 64, RX: 128,
  HT: 256, NC: 512, FL: 1024, AUTO: 2048, SO: 4096, AP: 8192, PF: 16384,
};

const MOD_NAMES = Object.entries(MOD);

export function modsToString(mods) {
  let list = MOD_NAMES.filter(([, bit]) => mods & bit).map(([name]) => name);
  if (list.includes('NC')) list = list.filter((n) => n !== 'DT'); // NC sets the DT bit too
  if (list.includes('PF')) list = list.filter((n) => n !== 'SD');
  return list.length ? list.join('') : 'NM';
}

class Reader {
  constructor(buffer) {
    this.u8 = new Uint8Array(buffer);
    this.dv = new DataView(buffer);
    this.p = 0;
  }
  need(n) {
    if (this.p + n > this.u8.length) throw new Error('This file is truncated or is not a valid .osr replay.');
  }
  byte() { this.need(1); return this.dv.getUint8(this.p++); }
  short() { this.need(2); const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
  int() { this.need(4); const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
  long() { this.need(8); const v = this.dv.getBigInt64(this.p, true); this.p += 8; return v; }
  bytes(n) { this.need(n); const v = this.u8.subarray(this.p, this.p + n); this.p += n; return v; }
  uleb() {
    let result = 0, shift = 0, b;
    do { b = this.byte(); result += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80);
    return result;
  }
  string() {
    const marker = this.byte();
    if (marker === 0) return '';
    if (marker !== 0x0b) throw new Error('Unexpected string marker in replay header.');
    return new TextDecoder().decode(this.bytes(this.uleb()));
  }
}

/** Decompress the LZMA replay payload with the vendored LZMA-JS decoder (global `LZMA`). */
export function lzmaDecompress(bytes) {
  const LZMA = globalThis.LZMA;
  if (!LZMA) return Promise.reject(new Error('LZMA decoder is not loaded (vendor/lzma-d-min.js).'));
  return new Promise((resolve, reject) => {
    try {
      LZMA.decompress(bytes, (result, error) => {
        if (error) return reject(error instanceof Error ? error : new Error(String(error)));
        resolve(typeof result === 'string' ? result : new TextDecoder().decode(Uint8Array.from(result, (b) => b & 255)));
      });
    } catch (e) { reject(e); }
  });
}

/** Turn the decompressed "w|x|y|z," text into frames: { t (ms), x, dash }. */
export function parseReplayFrames(text) {
  let time = 0;
  let seed = null;
  const raw = [];
  for (const chunk of text.split(',')) {
    const f = chunk.split('|');
    if (f.length < 4) continue;
    if (f[0] === '-12345') { seed = parseInt(f[3], 10); continue; } // RNG seed frame (used by HR offsets)
    let diff = parseInt(f[0], 10);
    if (!Number.isFinite(diff)) diff = Math.round(parseFloat(f[0]));
    time += diff;
    raw.push({ t: time, x: parseFloat(f[1]), y: parseFloat(f[2]), z: parseInt(f[3], 10) || 0 });
  }

  // Quirks handled the same way lazer does (stable's ReplayWatcher behaviour).
  if (raw.length >= 2 && raw[1].t < raw[0].t) { raw[1].t = raw[0].t; raw[0].t = 0; }
  if (raw.length >= 3 && raw[0].t > raw[2].t) raw[0].t = raw[1].t = raw[2].t;
  const isSkipFrame = (f) => f.x === 256 && f.y === -500;
  if (raw.length >= 2 && isSkipFrame(raw[1])) raw.splice(1, 1);
  if (raw.length >= 1 && isSkipFrame(raw[0])) raw.splice(0, 1);

  const frames = [];
  for (const f of raw) {
    if (frames.length && f.t < frames[frames.length - 1].t) continue; // never go backwards in time
    frames.push({ t: f.t, x: f.x, dash: f.z === 1 });
  }
  return { frames, seed };
}

/**
 * @param {ArrayBuffer} buffer contents of the .osr file
 * @param {{decompress?: (bytes: Uint8Array) => Promise<string>}} [opts]
 */
export async function parseOsr(buffer, { decompress = lzmaDecompress } = {}) {
  const r = new Reader(buffer);
  const mode = r.byte();
  const version = r.int();
  const beatmapMd5 = r.string();
  const player = r.string();
  const replayMd5 = r.string();
  const n300 = r.short(), n100 = r.short(), n50 = r.short();
  const nGeki = r.short(), nKatu = r.short(), nMiss = r.short();
  const score = r.int();
  const maxCombo = r.short();
  const perfect = r.byte() === 1;
  const mods = r.int();
  r.string(); // life bar graph
  const ticks = r.long();
  const dataLength = r.int();
  const data = r.bytes(dataLength);

  const date = new Date(Number((ticks - 621355968000000000n) / 10000n));
  const text = await decompress(data);
  const { frames, seed } = parseReplayFrames(text);

  return {
    mode, version, beatmapMd5, player, replayMd5,
    n300, n100, n50, nGeki, nKatu, nMiss,
    score, maxCombo, perfect, mods, date, frames, seed,
  };
}
