// Reading a beatmap set (.osz = zip): the difficulties (.osu) and the song audio.

import { unzipSync } from '../vendor/fflate.mjs';
import { md5 } from './md5.js?v=20261108u';

const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus)$/i;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const IMAGE_EXT = /\.(jpe?g|png)$/i;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|ogv|mkv|avi|flv|wmv)$/i;
const MAX_VIDEO_BYTES = 300 * 1024 * 1024;
const MAX_OSU_BYTES = 8 * 1024 * 1024;
const MAX_STORYBOARD_IMAGES = 1500;

/**
 * @param {Uint8Array} bytes contents of the .osz
 * @returns {{difficulties: {name:string, bytes:Uint8Array, md5:string}[], audio: Map<string, Uint8Array>, images: Map<string, Uint8Array>, videos: Map<string, Uint8Array>, files: Map<string, Uint8Array>, osb: Uint8Array|null}}
 *   audio is keyed by lowercased file name (without folders)
 */
export function readOsz(bytes) {
  let entries;
  try {
    entries = unzipSync(bytes, {
      // only .osu files, audio, background images and background videos are decompressed
      filter: (f) => {
        const base = f.name.split('/').pop();
        if (f.name.endsWith('/')) return false;
        if (/\.(osu|osb)$/i.test(base)) return f.originalSize <= MAX_OSU_BYTES;
        if (IMAGE_EXT.test(base)) return f.originalSize <= MAX_IMAGE_BYTES;
        if (VIDEO_EXT.test(base)) return f.originalSize <= MAX_VIDEO_BYTES;
        return AUDIO_EXT.test(base) && f.originalSize <= MAX_AUDIO_BYTES;
      },
    });
  } catch {
    throw new Error('This does not look like a valid .osz (it is not a zip file).');
  }

  const difficulties = [];
  const audio = new Map();
  const images = new Map();
  const videos = new Map();
  const files = new Map();                 // every image by its full path (lower case, forward slashes): storyboard folders reuse file names
  let osb = null;
  for (const [name, data] of Object.entries(entries)) {
    const base = name.split('/').pop();
    if (IMAGE_EXT.test(base) && files.size < MAX_STORYBOARD_IMAGES) files.set(name.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase(), data);
    if (/\.osb$/i.test(base)) osb = data;
    else if (/\.osu$/i.test(base)) difficulties.push({ name: base, bytes: data, md5: md5(data) });
    else if (VIDEO_EXT.test(base)) { if (!videos.has(base.toLowerCase()) || !name.includes('/')) videos.set(base.toLowerCase(), data); }
    else if (IMAGE_EXT.test(base)) { if (!images.has(base.toLowerCase()) || !name.includes('/')) images.set(base.toLowerCase(), data); }
    else if (!audio.has(base.toLowerCase()) || !name.includes('/')) audio.set(base.toLowerCase(), data);
  }
  if (!difficulties.length) throw new Error('No .osu difficulties found in this .osz.');
  return { difficulties, audio, images, videos, files, osb };
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

/** Background image of the set for a beatmap's [Events] background name (case-insensitive, folders ignored). */
export function findImage(osz, filename) {
  if (!filename || !osz.images) return null;
  return osz.images.get(filename.split(/[\\/]/).pop().toLowerCase()) || null;
}

/** Background video of the set for a beatmap's [Events] video name (case-insensitive, folders ignored). */
export function findVideo(osz, filename) {
  if (!filename || !osz.videos) return null;
  return osz.videos.get(filename.split(/[\\/]/).pop().toLowerCase()) || null;
}
