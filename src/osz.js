// Reading a beatmap set (.osz = zip): the difficulties (.osu) and the song audio.

import { unzipSync } from '../vendor/fflate.mjs';
import { md5 } from './md5.js';

const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus)$/i;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const MAX_OSU_BYTES = 8 * 1024 * 1024;

/**
 * @param {Uint8Array} bytes contents of the .osz
 * @returns {{difficulties: {name:string, bytes:Uint8Array, md5:string}[], audio: Map<string, Uint8Array>}}
 *   audio is keyed by lowercased file name (without folders)
 */
export function readOsz(bytes) {
  let entries;
  try {
    entries = unzipSync(bytes, {
      // skip videos, backgrounds and anything else: only .osu files and audio are decompressed
      filter: (f) => {
        const base = f.name.split('/').pop();
        if (f.name.endsWith('/')) return false;
        if (/\.osu$/i.test(base)) return f.originalSize <= MAX_OSU_BYTES;
        return AUDIO_EXT.test(base) && f.originalSize <= MAX_AUDIO_BYTES;
      },
    });
  } catch {
    throw new Error('This does not look like a valid .osz (it is not a zip file).');
  }

  const difficulties = [];
  const audio = new Map();
  for (const [name, data] of Object.entries(entries)) {
    const base = name.split('/').pop();
    if (/\.osu$/i.test(base)) difficulties.push({ name: base, bytes: data, md5: md5(data) });
    else if (!audio.has(base.toLowerCase()) || !name.includes('/')) audio.set(base.toLowerCase(), data);
  }
  if (!difficulties.length) throw new Error('No .osu difficulties found in this .osz.');
  return { difficulties, audio };
}

/** The difficulty whose file hash matches the beatmap hash stored in the replay. */
export function findDifficulty(osz, beatmapMd5) {
  const want = (beatmapMd5 || '').toLowerCase();
  return osz.difficulties.find((d) => d.md5 === want) || null;
}

/** Audio file of the set for a beatmap's `AudioFilename` (case-insensitive, folders ignored). */
export function findAudio(osz, audioFilename) {
  if (!audioFilename) return null;
  return osz.audio.get(audioFilename.split(/[\\/]/).pop().toLowerCase()) || null;
}
