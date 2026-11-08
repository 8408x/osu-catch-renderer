// Skin loading for osu!catch: reads an .osk (zip) or the bundled default skin and answers
// "which image should I draw for fruit-apple / fruit-drop / fruit-catcher-idle ...".
//
// Lookup rules follow osu!stable/lazer legacy skins:
//   - `name@2x.png` is preferred over `name.png`; a @2x image is drawn at half its pixel size.
//   - file names are case-insensitive and may sit in a sub-folder of the .osk.
//   - an element the skin does not provide falls back to the bundled default skin.
//   - skin.ini [Colours] Combo1..Combo8 are used when the beatmap defines no combo colours.

import { unzipSync } from '../vendor/fflate.mjs';
import { MOD_SKIN_NAMES } from './mods.js?v=20261109q';

export const DEFAULT_SKIN_FILES = [
  'fruit-apple', 'fruit-apple-overlay', 'fruit-grapes', 'fruit-grapes-overlay',
  'fruit-orange', 'fruit-orange-overlay', 'fruit-pear', 'fruit-pear-overlay',
  'fruit-bananas', 'fruit-bananas-overlay', 'fruit-drop',
  'fruit-catcher-idle', 'fruit-catcher-kiai', 'fruit-catcher-fail',
  'lazer-explosion-1', 'lazer-explosion-2',   // hit lighting: lazer always uses the default skin's scoreboard-explosion images
  ...[...'0123456789'].map((d) => `score-${d}`), 'score-comma', 'score-dot', 'score-percent', 'score-x', // HUD numbers
].map((n) => `${n}@2x.png`);

/** HUD number glyphs a font prefix needs (osu!'s `score-0` ... `score-x`; skins can rename the prefix in skin.ini). */
export const GLYPH_SUFFIXES = [...'0123456789', 'comma', 'dot', 'percent', 'x'];
export const glyphNames = (prefix) => GLYPH_SUFFIXES.map((g) => `${prefix}-${g}`);

const WANTED = /\.(png|jpe?g)$/i;
// hitsound files a skin may bring: normal-hitnormal.wav, soft-slidertick2.ogg, catch-banana.wav ...
const GLYPH_FILE = /^[a-z0-9_]+-(?:[0-9]|comma|dot|percent|x)(?:@2x)?\.(?:png|jpe?g)$/i;   // HUD numbers under any font prefix
const HUD_FILE = /^(?:scorebar-(?:bg|colour(?:-0)?|ki|kidanger2?)|inputoverlay-(?:key|background)|selection-mod-[a-z0-9]+)(?:@2x)?\.(?:png|jpe?g)$/i;   // HP bar parts and key counter
const SAMPLE_FILE = /^((normal|soft|drum)-(hitnormal|hitwhistle|hitfinish|hitclap|slidertick)\d*|metronomelow|catch-banana)\.(wav|mp3|ogg)$/i;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Parse the bits of skin.ini we use. */
export function parseSkinIni(text) {
  const ini = { name: '', version: 1, colours: [], hyperDash: null, hyperDashFruit: null, hyperDashAfterImage: null, hyperDashAfterImageAlpha: 1,
    scorePrefix: 'score', comboPrefix: 'score', scoreOverlap: 0, comboOverlap: 0 };
  let section = '';
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    if (line.startsWith('[') && line.endsWith(']')) { section = line.slice(1, -1).toLowerCase(); continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).split('//')[0].trim();
    if (section === 'general') {
      if (/^name$/i.test(key)) ini.name = val;
      else if (/^version$/i.test(key)) ini.version = val.toLowerCase() === 'latest' ? 2.7 : parseFloat(val) || 1;
    } else if (section === 'fonts') {
      const k = key.toLowerCase();
      if (k === 'scoreprefix' && val) ini.scorePrefix = val.replace(/\\/g, '/').split('/').pop();
      else if (k === 'comboprefix' && val) ini.comboPrefix = val.replace(/\\/g, '/').split('/').pop();
      else if (k === 'scoreoverlap') ini.scoreOverlap = parseInt(val, 10) || 0;
      else if (k === 'combooverlap') ini.comboOverlap = parseInt(val, 10) || 0;
    } else if ((section === 'colours' || section === 'catchthebeat') && /^hyperdash(fruit|afterimage)?$/i.test(key)) {   // skins put these under [CatchTheBeat] (lazer reads that) or [Colours]
      const rgb = val.split(',').map((v) => parseInt(v, 10));
      if (rgb.length >= 3 && rgb.slice(0, 3).every((v) => Number.isFinite(v))) {
        const name = key.toLowerCase();
        ini[name === 'hyperdash' ? 'hyperDash' : name === 'hyperdashfruit' ? 'hyperDashFruit' : 'hyperDashAfterImage'] =
          rgb.slice(0, 3).map((v) => Math.min(255, Math.max(0, v)));
        if (name === 'hyperdashafterimage' && rgb.length >= 4 && Number.isFinite(rgb[3])) ini.hyperDashAfterImageAlpha = Math.min(255, Math.max(0, rgb[3])) / 255;
      }
    } else if (section === 'colours' && /^combo[1-8]$/i.test(key)) {
      const rgb = val.split(',').map((v) => parseInt(v, 10));
      if (rgb.length >= 3 && rgb.slice(0, 3).every((v) => Number.isFinite(v))) {
        ini.colours[parseInt(key.slice(5), 10) - 1] = rgb.slice(0, 3).map((v) => Math.min(255, Math.max(0, v)));
      }
    }
  }
  ini.colours = ini.colours.filter(Boolean);
  return ini;
}

/** Read the files we care about out of an .osk. Returns Map(lowercased basename -> Uint8Array). */
export function readOsk(bytes) {
  let entries;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        const base = f.name.split('/').pop().toLowerCase();
        return !f.name.endsWith('/') && f.originalSize <= MAX_FILE_BYTES &&
          (base === 'skin.ini' || (base.startsWith('fruit-') && WANTED.test(base)) || SAMPLE_FILE.test(base) || GLYPH_FILE.test(base) || HUD_FILE.test(base));
      },
    });
  } catch {
    throw new Error('This does not look like a valid .osk skin (it is not a zip file).');
  }
  const files = new Map();
  for (const [name, data] of Object.entries(entries)) {
    const base = name.split('/').pop().toLowerCase();
    // a file at the zip root wins over the same name inside a sub-folder
    if (!files.has(base) || !name.includes('/')) files.set(base, data);
  }
  return files;
}

/**
 * A skin: lookup of textures by element name.
 * @param {Map<string, Uint8Array>} files lowercased basename -> bytes
 * @param {{decode:(bytes:Uint8Array)=>Promise<any>, createCanvas:(w:number,h:number)=>any}} env
 */
export class Skin {
  constructor(files, env, { label = 'skin', fallback = null } = {}) {
    this.files = files;
    this.env = env;
    this.label = label;
    this.fallback = fallback;
    this.cache = new Map();     // name -> Promise<texture|null>
    this.resolved = new Map();  // name -> texture (filled as promises settle)
    this.tintCache = new Map();
    this.ini = { name: '', version: 1, colours: [], hyperDash: null, hyperDashFruit: null, hyperDashAfterImage: null, scorePrefix: 'score', comboPrefix: 'score', scoreOverlap: 0, comboOverlap: 0 };
    if (files.has('skin.ini')) {
      try { this.ini = parseSkinIni(new TextDecoder().decode(files.get('skin.ini'))); } catch { /* keep defaults */ }
    }
  }

  get colours() { return this.ini.colours; }

  /** HUD number fonts: file name prefix and spacing, from skin.ini [Fonts] (osu! default: `score`). */
  get fonts() {
    const i = this.ini;
    return { scorePrefix: i.scorePrefix, comboPrefix: i.comboPrefix, scoreOverlap: i.scoreOverlap, comboOverlap: i.comboOverlap };
  }

  /** Hyperdash colours as lazer resolves them: catcher / trails, fruit glow, after-image. Default red. */
  get hyperColours() {
    const RED = [255, 0, 0];
    const dash = this.ini.hyperDash || RED;
    return { dash, fruit: this.ini.hyperDashFruit || dash, afterImage: this.ini.hyperDashAfterImage || dash, afterImageAlpha: this.ini.hyperDashAfterImageAlpha ?? 1 };
  }

  /** Names of fruit elements (without extension) this skin itself provides. */
  provided() {
    const out = new Set();
    for (const f of this.files.keys()) {
      const m = /^(fruit-.+?)(?:-\d+)?(?:@2x)?\.(?:png|jpe?g)$/.exec(f);
      if (m) out.add(m[1]);
    }
    return out;
  }

  #find(name) {
    const n = name.toLowerCase();
    for (const [file, hd] of [[`${n}@2x.png`, true], [`${n}.png`, false], [`${n}@2x.jpg`, true], [`${n}.jpg`, false], [`${n}@2x.jpeg`, true], [`${n}.jpeg`, false],
      [`${n}-0@2x.png`, true], [`${n}-0.png`, false]]) { // animated skins: use the first frame
      if (this.files.has(file)) return { file, hd };
    }
    return null;
  }

  /** Decode every texture this skin provides (so drawing is synchronous later). */
  async preload(names) {
    await Promise.all(names.map((n) => this.texture(n, { own: true })));
    if (this.fallback) await this.fallback.preload(names);
  }

  /**
   * @returns {Promise<null | {img:any, w:number, h:number, name:string, from:string}>} w/h are in "osu pixels" (@2x halved)
   */
  async texture(name, { own = false } = {}) {
    const key = name.toLowerCase();
    let p = this.cache.get(key);
    if (!p) {
      const found = this.#find(name);
      p = found
        ? this.env.decode(this.files.get(found.file)).then(
          (img) => ({ img, w: img.width / (found.hd ? 2 : 1), h: img.height / (found.hd ? 2 : 1), name, from: this.label }),
          () => null, // unreadable image: treat as missing
        )
        : Promise.resolve(null);
      this.cache.set(key, p);
      p.then((r) => { if (r) this.resolved.set(key, r); });
    }
    const res = await p;
    if (res || own || !this.fallback) return res;
    return this.fallback.texture(name);
  }

  /** Synchronous lookup, valid for names passed to preload(). */
  get(name) {
    return this.resolved.get(name.toLowerCase()) ?? (this.fallback ? this.fallback.get(name) : null);
  }

  /** `img` multiplied by an RGB colour, cached per texture and colour. */
  tinted(tex, rgb) {
    const key = `${tex.name}|${rgb.join(',')}`;
    let c = this.tintCache.get(key);
    if (!c) {
      c = this.env.createCanvas(tex.img.width, tex.img.height);
      const g = c.getContext('2d');
      g.drawImage(tex.img, 0, 0);
      g.globalCompositeOperation = 'multiply';
      g.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'destination-in'; // restore the original transparency
      g.drawImage(tex.img, 0, 0);
      this.tintCache.set(key, c);
    }
    return c;
  }
}

const EXPLOSIONS = ['lazer-explosion-1', 'lazer-explosion-2'];
const ELEMENTS = [
  'fruit-pear', 'fruit-pear-overlay', 'fruit-grapes', 'fruit-grapes-overlay',
  'fruit-apple', 'fruit-apple-overlay', 'fruit-orange', 'fruit-orange-overlay',
  'fruit-drop', 'fruit-drop-overlay', 'fruit-bananas', 'fruit-bananas-overlay',
  'fruit-catcher-idle', 'fruit-catcher-kiai', 'fruit-catcher-fail',
];

/** Gameplay HUD images a skin may provide: HP bar parts and the key counter. */
export const HUD_ELEMENTS = [...MOD_SKIN_NAMES, 'scorebar-bg', 'scorebar-colour', 'scorebar-colour-0', 'scorebar-ki', 'scorebar-kidanger', 'scorebar-kidanger2', 'inputoverlay-key', 'inputoverlay-background'];

/** Bundled default skin. `fetchBytes(url)` returns a Uint8Array. */
export async function loadDefaultSkin(env, fetchBytes, baseUrl = 'assets/default-skin/') {
  const files = new Map();
  await Promise.all(DEFAULT_SKIN_FILES.map(async (f) => { files.set(f, await fetchBytes(baseUrl + f)); }));
  const skin = new Skin(files, env, { label: 'default' });
  await skin.preload([...ELEMENTS, ...EXPLOSIONS, ...glyphNames('score')]);
  return skin;
}

/** A user skin (.osk) layered on top of the default skin. */
export async function loadOskSkin(bytes, env, defaultSkin, label = 'custom') {
  const skin = new Skin(readOsk(bytes), env, { label, fallback: defaultSkin });
  await skin.preload([...ELEMENTS, ...EXPLOSIONS, ...HUD_ELEMENTS, ...glyphNames('score'), ...glyphNames(skin.ini.scorePrefix), ...glyphNames(skin.ini.comboPrefix)]);
  return skin;
}

/** For the UI: which of the main elements come from the user's skin and which fell back. */
export function describeSkin(skin) {
  const own = [], fell = [];
  for (const n of ELEMENTS) {
    if (n.endsWith('-overlay') && n === 'fruit-drop-overlay') continue;
    const t = skin.get(n);
    if (t && t.from === skin.label) own.push(n); else fell.push(n);
  }
  return { own, fallback: fell };
}
