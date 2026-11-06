import { parseOsr, modsToString, MODE, MOD } from './osr.js?v=20261107k';
import { parseOsu } from './osu.js?v=20261107k';
import { buildScene, evaluateCatches, resolveColours } from './catch.js?v=20261107k';
import { compareWithReplay } from './score.js?v=20261107k';
import { nightcoreBeats } from './nightcore.js?v=20261107k';
import { ReplayTrack } from './replay.js?v=20261107k';
import { drawFrame, loadOverlayFonts } from './render.js?v=20261107k';
import { loadArgonFonts } from './argon.js?v=20261107k';
import { TosuOverlays } from './tosu.js?v=20261107k';
import { exportMp4, webCodecsAvailable } from './encode.js?v=20261107k';
import { VERSION } from './version.js?v=20261107k';
import { md5 } from './md5.js?v=20261107k';
import { loadDefaultSkin, loadOskSkin, describeSkin } from './skin.js?v=20261107k';
import { readOsz, findDifficulty, findAudio, findImage, findVideo } from './osz.js?v=20261107k';
import { BackgroundVideo } from './bgvideo.js?v=20261107k';
import { buildKeys } from './keys.js?v=20261107k';
import { prepareAudio, SAMPLE_RATE } from './audio.js?v=20261107k';
import { fetchSetForReplay, parseSetId } from './mirror.js?v=20261107k';
import { collectHitsounds, mixHitsounds } from './hitsounds.js?v=20261107k';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');

const state = {
  replay: null, osuBytes: null, beatmap: null, beatmapFrom: null, // beatmapFrom: 'file' (picked .osu) | 'osz' (matched in the .osz)
  scene: null, track: null, t: 0,
  loadErrors: { osr: null, osu: null, audio: null },
  defaultSkin: null, skin: null, skinMsgs: [],
  previewAudio: null,   // { scene, key, buffer } soundtrack of the preview, rebuilt when settings change
  defaultSounds: null,  // Map(file name -> bytes) of the bundled hitsounds, loaded on the first export
  osz: null,        // { difficulties, audio, images, name } from a loaded .osz
  bgFile: null,     // { name, bytes } when a background image was chosen by hand
  tosu: null,       // the real tosu overlays (CPOL look), rendered through SVG foreignObject
  argon: null,      // digit images of the osu!lazer (Argon) HUD
  bgv: null, bgvKey: '', // the beatmap's background video (BackgroundVideo) and what it was loaded from
  bg: null, bgKey: '', // decoded background (ImageBitmap) and what it was decoded from
  keys: null,       // inferred key presses of the replay
  audioFile: null,  // { name, bytes } when a plain song file was chosen
  decoded: null,    // { key: bytes, channels } cache of the decoded music
};

const skinEnv = {
  decode: (bytes) => createImageBitmap(new Blob([bytes])),
  createCanvas: (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h }),
};
let playing = false;
let playFrom = 0;
let playClock = 0;
let abort = null;
let resultUrl = null;

// ---------- messages ----------
function showMessages(list) {
  const box = $('msgs');
  box.replaceChildren();
  for (const [cls, text] of list) {
    const p = document.createElement('p');
    p.className = cls;
    p.textContent = text;
    box.append(p);
  }
}

const fmtTime = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// ---------- drawing ----------
function size() {
  const [w, h] = $('res').value.split('x').map(Number);
  return { w, h };
}

/** What to paint behind the playfield at time t: the video frame when it is on and ready, else the still picture. */
function backgroundFor(t) {
  if (!$('showbg').checked) { state.bgv?.sync(t, false); return null; }
  if (state.bgv && $('showvideo').checked && state.bgv.sync(t, playing, state.scene?.rate ?? 1)) return state.bgv.el;
  return state.bg;
}

let exporting = false;     // while the exporter owns the canvas (and the background video), preview redraws stand aside
function drawAt(t, fromExport = false) {
  if (exporting && !fromExport) return;
  const { width: W, height: H } = canvas;
  if (!state.scene) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0a0b10';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#98a2bd';
    ctx.font = `${Math.round(H / 28)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('Load a replay and its beatmap to preview', W / 2, H / 2);
    ctx.textAlign = 'start';
    return;
  }
  drawFrame(ctx, W, H, state.scene, state.track, t, {
    skin: state.skin,
    showCatchWidth: $('showwidth').checked,
    showHud: $('showhud').checked,
    hitLighting: $('showlight').checked,
    style: $('hudstyle').value,
    argon: state.argon,
    tosu: state.tosu,
    bg: backgroundFor(t),
    bgDim: Math.min(100, Math.max(0, Number($('bgdim').value) || 0)) / 100,
    keys: state.keys,
  });
}

function setSize() {
  const { w, h } = size();
  canvas.width = w;
  canvas.height = h;
  drawAt(state.t);
}

// ---------- loading ----------

/** With an .osz loaded and no .osu picked by hand, use the difficulty whose hash matches the replay. */
function syncBeatmapWithOsz(msgs) {
  if (state.beatmapFrom === 'file') return;
  const clear = () => { if (state.beatmapFrom === 'osz') { state.beatmap = null; state.osuBytes = null; state.beatmapFrom = null; } };
  if (!state.osz || !state.replay) return clear();

  const d = findDifficulty(state.osz, state.replay.beatmapMd5);
  if (!d) {
    clear();
    msgs.push(['warn', `None of the ${state.osz.difficulties.length} difficulties in ${state.osz.name} match this replay (a different song, or the map was updated since). Pick the .osu by hand instead.`]);
    return;
  }
  if (state.osuBytes !== d.bytes) {
    try {
      state.beatmap = parseOsu(new TextDecoder().decode(d.bytes));
      state.osuBytes = d.bytes;
      state.beatmapFrom = 'osz';
    } catch (err) {
      clear();
      msgs.push(['err', `Could not read ${d.name} from the .osz: ${err.message}`]);
      return;
    }
  }
  msgs.push(['dim', `Difficulty picked from the .osz by matching the replay: ${d.name}`]);
}

/** The music to use, if any: { bytes, name } | { error } | null */
function currentMusic() {
  if (state.audioFile) return state.audioFile;
  if (state.osz) {
    if (!state.beatmap) return null;
    const bytes = findAudio(state.osz, state.beatmap.audioFilename);
    return bytes ? { bytes, name: state.beatmap.audioFilename } : { error: `${state.osz.name} has no audio file named "${state.beatmap.audioFilename}".` };
  }
  return null;
}

function refresh() {
  stopPreview();
  state.scene = null;
  state.track = null;
  const msgs = [];

  for (const err of Object.values(state.loadErrors)) if (err) msgs.push(['err', err]);
  syncBeatmapWithOsz(msgs);
  const { replay, beatmap } = state;

  if (replay) {
    msgs.push(['ok', `Replay: ${replay.player}, ${modsToString(replay.mods)}, ${replay.frames.length} frames, max combo ${replay.maxCombo}`]);
    if (replay.mode !== MODE.CATCH) {
      msgs.push(['err', `This replay is not osu!catch (game mode ${replay.mode}).`]);
    }
  }
  if (beatmap) {
    msgs.push(['ok', `Beatmap: ${beatmap.artist} - ${beatmap.title} [${beatmap.version}] (CS ${beatmap.cs}, AR ${beatmap.ar})`]);
    if (beatmap.mode !== 0 && beatmap.mode !== MODE.CATCH) {
      msgs.push(['err', 'This beatmap is not osu!catch (or an osu!standard map, which can be converted).']);
    }
  }

  const ready = replay && beatmap && replay.mode === MODE.CATCH && (beatmap.mode === 0 || beatmap.mode === MODE.CATCH);
  if (ready) {
    if (state.osuBytes && md5(state.osuBytes) !== replay.beatmapMd5) {
      msgs.push(['warn', 'This .osu file does not match the beatmap hash stored in the replay. You probably picked the wrong difficulty or a different version of the map.']);
    }
    const scene = buildScene(beatmap, replay.mods);
    if (!scene.objects.length) {
      msgs.push(['err', 'No fruits found in this beatmap.']);
    } else {
      scene.colours = resolveColours(beatmap, state.skin);
      state.scene = scene;
      state.track = new ReplayTrack(replay.frames);
      state.keys = buildKeys(replay.frames);
      const { caught, total, bananas, bananasCaught, hud } = evaluateCatches(scene, state.track);
      msgs.push(['dim', `${scene.objects.length} objects, ${caught}/${total} fruits and droplets${bananas ? ` and ${bananasCaught}/${bananas} bananas` : ''} caught in this replay (rough check against the real result).`]);
      const cmp = compareWithReplay(hud, state.replay);
      msgs.push(cmp.ok ? ['ok', "The catches match the replay's own counts (fruits, droplets, misses, max combo)."]
        : ['warn', `Our catch check differs from the replay's own counts, so the HUD may be off: ${cmp.diffs.join('; ')}.`]);
      state.t = scene.startTime;
    }
  } else if (replay && beatmap) {
    // an error message above already explains it
  } else {
    msgs.push(['dim', 'Choose the replay and a beatmap (.osu, or a whole .osz) to continue.']);
  }

  const music = currentMusic();
  if (music?.error) msgs.push(['warn', `No music: ${music.error}`]);
  else if (music) msgs.push(['ok', `Music: ${music.name}${state.osz && !state.audioFile ? ` (from ${state.osz.name})` : ''}`]);
  else if (state.osz && !beatmap) msgs.push(['dim', 'Music will be taken from the .osz once the replay is matched to a difficulty.']);
  $('usemusic').disabled = !music?.bytes;
  $('mirrorbtn').disabled = !state.replay;

  msgs.push(...state.skinMsgs);

  if (!webCodecsAvailable()) {
    msgs.push(['err', 'This browser has no WebCodecs video encoder, so MP4 export is unavailable. Use a current Chrome or Edge.']);
  }

  showMessages(msgs);
  const sc = state.scene;
  $('seek').disabled = !sc;
  $('play').disabled = !sc;
  $('export').disabled = !sc || !webCodecsAvailable();
  if (sc) {
    $('seek').min = String(Math.floor(sc.startTime));
    $('seek').max = String(Math.ceil(sc.endTime));
    $('seek').value = String(Math.floor(state.t));
  }
  drawAt(state.t);
  updateClock();
  loadBackground();
  loadBackgroundVideo();
}

/** Decode the background (picked file, else the .osz's own image for this difficulty) and redraw when it is ready. */
async function loadBackground() {
  let name = '', bytes = null;
  if (state.bgFile) { name = state.bgFile.name; bytes = state.bgFile.bytes; }
  else if (state.osz && state.beatmap?.background) {
    bytes = findImage(state.osz, state.beatmap.background);
    name = `${state.osz.name}:${state.beatmap.background}`;
  }
  const key = bytes ? `${name}|${bytes.length}` : '';
  if (key === state.bgKey) return;
  state.bgKey = key;
  state.bg = null;
  state.tosu?.setCover(null);
  if (bytes) {
    try {
      const bmp = await createImageBitmap(new Blob([bytes]));
      if (state.bgKey === key) { state.bg = bmp; state.tosu?.setCover(bmp); }
    } catch { /* unreadable image: no background */ }
  }
  drawAt(state.t);
}

/** Load the beatmap's background video from the .osz (the picture stays as the fallback). */
async function loadBackgroundVideo() {
  const v = state.beatmap?.video;
  const bytes = v && state.osz ? findVideo(state.osz, v.file) : null;
  const key = bytes ? `${state.osz.name}:${v.file}|${v.offset}|${bytes.length}` : '';
  if (key === state.bgvKey) return;
  state.bgvKey = key;
  state.bgv?.dispose();
  state.bgv = null;
  $('showvideo').disabled = true;
  setVideoNote('');
  if (!bytes) { if (v && state.osz) setVideoNote(`The map has a video (${v.file}) but it is not in the .osz, so the picture is used.`); return; }
  setVideoNote(`Loading the background video (${(bytes.length / 1e6).toFixed(0)} MB)…`);
  const bgv = await BackgroundVideo.create(bytes, v.file, v.offset);
  if (state.bgvKey !== key) { bgv?.dispose(); return; }
  if (!bgv) { setVideoNote(`This browser cannot play the map's video (${v.file}), so the picture is used. Chrome and Edge play mp4 and webm.`); return; }
  state.bgv = bgv;
  bgv.onFrame = () => { if (!playing) drawAt(state.t); };
  $('showvideo').disabled = false;
  setVideoNote(`Background video: ${v.file} (${bgv.duration.toFixed(0)} s, starts at ${(v.offset / 1000).toFixed(1)} s)`);
  drawAt(state.t);
}

function setVideoNote(text) { const el = $('videonote'); if (el) el.textContent = text; }

function updateClock() {
  const sc = state.scene;
  $('clock').textContent = sc ? `${fmtTime(state.t - sc.startTime)} / ${fmtTime(sc.endTime - sc.startTime)}` : '0:00';
}

$('osr').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  state.replay = null;
  state.loadErrors.osr = null;
  if (file) {
    try {
      state.replay = await parseOsr(await file.arrayBuffer());
    } catch (err) {
      state.loadErrors.osr = `Could not read the replay: ${err.message}`;
    }
  }
  refresh();
});

$('osu').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  state.beatmap = null;
  state.osuBytes = null;
  state.beatmapFrom = null;
  state.loadErrors.osu = null;
  if (file) {
    try {
      const buf = await file.arrayBuffer();
      state.osuBytes = new Uint8Array(buf);
      state.beatmap = parseOsu(new TextDecoder().decode(buf));
      state.beatmapFrom = 'file';
    } catch (err) {
      state.loadErrors.osu = `Could not read the beatmap: ${err.message}`;
    }
  }
  refresh();
});

$('audio').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  state.osz = null;
  state.audioFile = null;
  state.decoded = null;
  state.loadErrors.audio = null;
  if (file) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (/\.(osz|zip)$/i.test(file.name)) state.osz = { ...readOsz(bytes), name: file.name };
      else state.audioFile = { name: file.name, bytes };
    } catch (err) {
      state.loadErrors.audio = `Could not read ${file.name}: ${err.message}`;
    }
  }
  refresh();
});

// ---------- download the map from a mirror ----------
let mirrorAbort = null;

$('mirrorbtn').addEventListener('click', async () => {
  if (mirrorAbort) { mirrorAbort.abort(); return; }           // the button doubles as "Cancel"
  if (!state.replay) return;
  const status = $('mirrorstatus');

  const typed = parseSetId($('mirrorid').value);
  if (Number.isNaN(typed)) {
    status.textContent = 'That is not a beatmap set link or ID. Use a link like https://osu.ppy.sh/beatmapsets/123456, or just the number.';
    return;
  }

  mirrorAbort = new AbortController();
  $('mirrorbtn').textContent = 'Cancel download';
  $('mirrorid').disabled = true;
  status.textContent = 'Starting…';
  try {
    const res = await fetchSetForReplay({
      md5: state.replay.beatmapMd5,
      setId: typed,
      signal: mirrorAbort.signal,
      onStatus: (text) => { status.textContent = text; },
      onProgress: (got, total, mirror) => {
        status.textContent = `Downloading the map from ${mirror}… ${(got / 1e6).toFixed(1)}${total ? ` / ${(total / 1e6).toFixed(1)}` : ''} MB`;
      },
    });
    state.osz = { ...res.osz, name: `set ${res.setId}` };
    state.audioFile = null;
    state.decoded = null;
    state.loadErrors.audio = null;
    $('audio').value = '';
    status.textContent = `Got beatmap set ${res.setId} from ${res.mirror} (${(res.bytes.length / 1e6).toFixed(1)} MB).`
      + (res.matched ? '' : ' It has no difficulty with exactly this replay\'s hash, so it may be a newer version of the map than the one you played.');
  } catch (err) {
    status.textContent = err.name === 'AbortError' ? 'Download cancelled.' : err.message;
  } finally {
    mirrorAbort = null;
    $('mirrorbtn').textContent = 'Download from mirror';
    $('mirrorid').disabled = false;
    refresh();
  }
});

const DEFAULT_SOUND_FILES = ['normal', 'soft', 'drum'].flatMap((b) => ['hitnormal', 'hitwhistle', 'hitfinish', 'hitclap', 'slidertick'].map((n) => `${b}-${n}.wav`))
  .concat('catch-banana.wav', ...['kick', 'clap', 'hat', 'finish'].map((n) => `nightcore-${n}.wav`));

async function loadDefaultSounds() {
  if (state.defaultSounds) return state.defaultSounds;
  const files = new Map();
  await Promise.all(DEFAULT_SOUND_FILES.map(async (f) => { files.set(f, await bytesOf(`assets/default-sounds/${f}`)); }));
  state.defaultSounds = files;
  return files;
}

/** One short sample to 48 kHz stereo floats. */
async function decodeClip(bytes) {
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE);
  const buf = await ctx.decodeAudioData(bytes.slice().buffer);
  return { channels: [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)], sampleRate: SAMPLE_RATE };
}

/** Mix the hitsounds of every caught object into the video's audio. Lookup order: beatmap files, skin, osu! defaults. */
async function addHitsounds(channels, sc, volume) {
  const sources = [];
  if (state.osz) sources.push({ label: 'beatmap', layer: 'beatmap', files: state.osz.audio });
  if (state.skin && state.skin !== state.defaultSkin) sources.push({ label: 'skin', layer: 'skin', files: state.skin.files });
  sources.push({ label: 'default', layer: 'default', files: await loadDefaultSounds() });
  const { events, missing } = await collectHitsounds(sc, { sources, decode: decodeClip });
  mixHitsounds(channels, events, { startTime: sc.startTime, rate: sc.rate, sampleRate: SAMPLE_RATE, volume });
  if (missing.length) console.warn('Hitsound files not found or not decodable:', missing);
}

/** The Nightcore drum loop (NC only): looked up in the user's skin first, then osu!'s defaults. */
async function addNightcoreBeat(channels, sc, volume) {
  const bm = state.beatmap;
  if (!bm) return;
  const beats = nightcoreBeats(bm, sc.startTime, sc.endTime);
  const sources = [];
  if (state.skin && state.skin !== state.defaultSkin) sources.push(state.skin.files);
  sources.push(await loadDefaultSounds());
  const clips = {};
  for (const name of new Set(beats.map((b) => b.sample))) {
    for (const files of sources) {
      const bytes = ['.wav', '.mp3', '.ogg'].map((e) => files.get(`nightcore-${name}${e}`)).find(Boolean);
      if (bytes) { try { clips[name] = await decodeClip(bytes); } catch { /* try the next source */ } }
      if (clips[name]) break;
    }
  }
  const events = beats.filter((b) => clips[b.sample]).map((b) => ({ t: b.t, x: 256, buf: clips[b.sample], gain: 1, freq: 1 }));
  mixHitsounds(channels, events, { startTime: sc.startTime, rate: sc.rate, sampleRate: SAMPLE_RATE, volume });
}

/** The video's soundtrack (song + hitsounds), exactly as the export encodes it. The preview plays the same thing. */
async function buildAudio(sc, durationSec, { useMusic, useHits, volume, hitVolume, nightcore, music, status }) {
  let channels;
  if (useMusic) {
    const song = await decodeMusic(music.bytes);
    channels = prepareAudio(song, { startTime: sc.startTime, durationSec, rate: sc.rate, nightcore, volume: Number.isFinite(volume) ? volume : 1 });
  } else {
    const n = Math.round(durationSec * SAMPLE_RATE);
    channels = [new Float32Array(n), new Float32Array(n)];
  }
  if (useHits) {
    status?.('Mixing hitsounds…');
    await addHitsounds(channels, sc, Number.isFinite(hitVolume) ? hitVolume : 1);
    if (nightcore) await addNightcoreBeat(channels, sc, Number.isFinite(hitVolume) ? hitVolume : 1);
  }
  return { channels, sampleRate: SAMPLE_RATE };
}

/** Decode the song to 48 kHz stereo floats (cached). The browser decodes mp3 / ogg / wav / m4a / flac. */
async function decodeMusic(bytes) {
  if (state.decoded?.key === bytes) return state.decoded.channels;
  const ctx = new OfflineAudioContext(2, 1, SAMPLE_RATE); // decodeAudioData resamples to the context's rate
  let buf;
  try {
    buf = await ctx.decodeAudioData(bytes.slice().buffer);
  } catch {
    throw new Error('This browser could not decode the music file. Try an mp3 or ogg file in Chrome or Edge.');
  }
  const channels = [buf.getChannelData(0), buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0)];
  state.decoded = { key: bytes, channels };
  return channels;
}

// ---------- skin ----------
const bytesOf = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

function applySkin(skin, msgs) {
  state.skin = skin;
  state.skinMsgs = msgs;
  if (state.scene) state.scene.colours = resolveColours(state.beatmap, skin);
  refreshKeepingPosition();
}

function refreshKeepingPosition() {
  const t = state.t;
  const had = !!state.scene;
  refresh();
  if (had && state.scene) {
    state.t = Math.min(Math.max(t, state.scene.startTime), state.scene.endTime);
    $('seek').value = String(Math.floor(state.t));
    drawAt(state.t);
    updateClock();
  }
}

$('skin').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const skin = await loadOskSkin(new Uint8Array(await file.arrayBuffer()), skinEnv, state.defaultSkin, 'custom');
    const { own, fallback } = describeSkin(skin);
    const label = skin.ini.name || file.name.replace(/\.(osk|zip)$/i, '');
    if (!own.length) {
      e.target.value = '';
      state.skin = state.defaultSkin;
      applySkin(state.defaultSkin, [['warn', `"${label}" has no osu!catch images (fruit-*.png), so the default skin is still in use.`]]);
      return;
    }
    const ownIdle = own.includes('fruit-catcher-idle');
    const shown = (n) => !n.endsWith('-overlay') && // overlays follow their fruit
      !(ownIdle && /^fruit-catcher-(kiai|fail)$/.test(n));                    // a skin with its own idle catcher reuses it for those
    const ownShown = own.filter(shown), fbShown = fallback.filter(shown);
    const msgs = [['ok', `Skin: ${label} (${ownShown.length} of ${ownShown.length + fbShown.length} catch images from your skin)`]];
    if (fbShown.length) msgs.push(['dim', `Default osu! images used for: ${fbShown.map((n) => n.replace('fruit-', '')).join(', ')}`]);
    if (skin.colours.length) msgs.push(['dim', `Skin combo colours are used when the beatmap has none.`]);
    const sounds = [...skin.files.keys()].filter((k) => /\.(wav|mp3|ogg)$/.test(k)).length;
    if (sounds) msgs.push(['dim', `${sounds} hitsound file${sounds === 1 ? '' : 's'} from the skin are used for the video's hitsounds.`]);
    applySkin(skin, msgs);
  } catch (err) {
    e.target.value = '';
    applySkin(state.defaultSkin, [['err', `Could not load the skin: ${err.message}`]]);
  }
});

$('useDefault').addEventListener('click', () => {
  $('skin').value = '';
  applySkin(state.defaultSkin, []);
});

$('showwidth').addEventListener('change', () => drawAt(state.t));
$('showhud').addEventListener('change', () => drawAt(state.t));
$('showlight').addEventListener('change', () => drawAt(state.t));
for (const id of ['hudstyle', 'showbg', 'bgdim', 'showvideo']) $(id).addEventListener('input', () => drawAt(state.t));

$('bgfile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  state.bgFile = null;
  if (file) {
    try { state.bgFile = { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) }; } catch { /* ignore */ }
  }
  loadBackground();
});

// ---------- preview ----------
// With sound, the preview plays the same soundtrack the export would encode (song + hitsounds, built once
// and cached) through WebAudio, and the picture follows the audio clock so they stay in sync.
let audioCtx = null, previewSource = null, audioT0 = 0, playToken = 0;

function audioSettings() {
  const music = currentMusic();
  const useMusic = !!(music?.bytes && $('usemusic').checked);
  const useHits = $('usehits').checked;
  const pct = (id) => Math.min(100, Math.max(0, Number($(id).value))) / 100;
  return { music, useMusic, useHits, volume: pct('volume'), hitVolume: pct('hitvolume'), nightcore: !!(state.replay.mods & MOD.NC) };
}

async function previewBuffer(sc) {
  const o = audioSettings();
  if (!o.useMusic && !o.useHits) return null;
  const key = [o.useMusic && o.music.name, o.volume, o.useHits, o.hitVolume, state.skin?.label, state.osz?.name, o.nightcore].join('|');
  if (state.previewAudio?.scene === sc && state.previewAudio.key === key) return state.previewAudio.buffer;
  const dur = (sc.endTime - sc.startTime) / sc.rate / 1000;
  const { channels } = await buildAudio(sc, dur, { ...o, status: (t) => { $('status').textContent = t; } });
  const buffer = audioCtx.createBuffer(2, channels[0].length, SAMPLE_RATE);
  buffer.copyToChannel(channels[0], 0);
  buffer.copyToChannel(channels[1], 1);
  state.previewAudio = { scene: sc, key, buffer };
  return buffer;
}

function stopPreview() {
  playing = false;
  playToken++;
  if (previewSource) { try { previewSource.stop(); } catch { /* already stopped */ } previewSource.disconnect(); previewSource = null; }
  $('play').textContent = 'Play';
}

function tick(now) {
  if (!playing) return;
  const sc = state.scene;
  const elapsedMs = previewSource ? (audioCtx.currentTime - audioT0) * 1000 : now - playClock;
  state.t = playFrom + elapsedMs * sc.rate;
  if (state.t >= sc.endTime) { state.t = sc.endTime; stopPreview(); }
  $('seek').value = String(Math.floor(state.t));
  drawAt(state.t);
  updateClock();
  if (playing) requestAnimationFrame(tick);
}

$('play').addEventListener('click', async () => {
  if (playing) { stopPreview(); return; }
  const sc = state.scene;
  if (!sc) return;
  if (state.t >= sc.endTime) state.t = sc.startTime;
  playing = true;
  const token = ++playToken;
  $('play').textContent = 'Pause';
  let buffer = null;
  try {
    audioCtx ||= new AudioContext({ sampleRate: SAMPLE_RATE }); // created inside the click so the browser allows sound
    await audioCtx.resume();
    if (audioSettings().useMusic || audioSettings().useHits) {
      $('status').textContent = 'Preparing the sound…';
      buffer = await previewBuffer(sc);
      $('status').textContent = '';
    }
  } catch (err) {
    $('status').textContent = `Preview without sound: ${err.message}`;
    buffer = null;
  }
  if (!playing || token !== playToken) return;       // paused or seeked while the sound was being prepared
  playFrom = state.t;
  if (buffer) {
    previewSource = audioCtx.createBufferSource();
    previewSource.buffer = buffer;
    previewSource.connect(audioCtx.destination);
    audioT0 = audioCtx.currentTime;
    previewSource.start(0, Math.max(0, (state.t - sc.startTime) / sc.rate / 1000));
  }
  playClock = performance.now();
  requestAnimationFrame(tick);
});

$('seek').addEventListener('input', () => {
  stopPreview();
  state.t = Number($('seek').value);
  drawAt(state.t);
  updateClock();
});

$('res').addEventListener('change', setSize);

// ---------- export ----------
function setBusy(busy) {
  exporting = busy;
  $('export').disabled = busy || !state.scene;
  $('cancel').disabled = !busy;
  for (const id of ['osr', 'osu', 'audio', 'skin', 'useDefault', 'res', 'fps', 'mbps', 'volume', 'usehits', 'hitvolume', 'showwidth', 'showhud', 'showlight', 'hudstyle', 'showbg', 'bgdim', 'bgfile', 'play', 'seek']) $(id).disabled = busy;
  $('showvideo').disabled = busy || !state.bgv;
  $('usemusic').disabled = busy || !currentMusic()?.bytes;
  $('mirrorbtn').disabled = busy || !state.replay;
  $('mirrorid').disabled = busy;
}

const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'replay';

$('export').addEventListener('click', async () => {
  const sc = state.scene;
  if (!sc) return;
  stopPreview();
  if (resultUrl) { URL.revokeObjectURL(resultUrl); resultUrl = null; }
  $('result').replaceChildren();

  abort = new AbortController();
  setBusy(true);
  const started = performance.now();
  $('status').textContent = 'Starting…';
  let stage = 'Rendering…';

  const music = currentMusic();
  const useMusic = !!(music?.bytes && $('usemusic').checked);
  const volume = Math.min(100, Math.max(0, Number($('volume').value))) / 100;
  const nightcore = !!(state.replay.mods & MOD.NC);
  const useHits = $('usehits').checked;
  const hitVolume = Math.min(100, Math.max(0, Number($('hitvolume').value))) / 100;

  try {
    const res = await exportMp4({
      canvas,
      drawAt: async (t) => {
        if (state.bgv && $('showbg').checked && $('showvideo').checked && state.bgv.active(t)) await state.bgv.seek(t);
        if (state.tosu && $('hudstyle').value === 'overlay' && $('showhud').checked) { try { await state.tosu.prepare(sc, t); } catch { /* drawn by the canvas fallback */ } }
        drawAt(t, true);
      },
      startTime: sc.startTime,
      endTime: sc.endTime,
      rate: sc.rate,
      fps: Number($('fps').value),
      bitrate: Math.max(1, Number($('mbps').value) || 12) * 1e6,
      makeAudio: useMusic || useHits
        ? (durationSec) => buildAudio(sc, durationSec, { useMusic, useHits, volume, hitVolume, nightcore, music })
        : undefined,
      signal: abort.signal,
      onStatus: (text) => { stage = text; $('status').textContent = text; },
      onProgress: (p) => {
        $('bar').value = p;
        $('status').textContent = `${stage} ${(p * 100).toFixed(0)}%`;
      },
    });
    resultUrl = URL.createObjectURL(res.blob);
    const secs = ((performance.now() - started) / 1000).toFixed(1);
    const opusNote = /Opus/.test(res.codec) ? ' Audio is Opus (this browser cannot encode AAC): it plays in Chrome, Firefox and VLC, but some Windows apps and editors want AAC.' : '';
    $('status').textContent = `Done: ${res.frames} frames (${res.seconds.toFixed(1)} s of video, ${res.codec}${res.hasAudio ? '' : ', no music'}) in ${secs} s, ${(res.blob.size / 1e6).toFixed(1)} MB.${opusNote}`;

    const a = document.createElement('a');
    a.className = 'dl';
    a.href = resultUrl;
    a.download = `${safeName(`${state.replay.player} - ${sc.meta.title}`)}.mp4`;
    a.textContent = `Download ${a.download}`;
    const video = document.createElement('video');
    video.controls = true;
    video.src = resultUrl;
    $('result').append(a, video);
    // Inside a sandboxed host (a published artifact page) <a download> is blocked: use the host's save call there.
    try {
      const dl = await window.claude?.use?.('downloads');
      if (dl) {
        a.removeAttribute('href');
        a.removeAttribute('download');
        a.setAttribute('role', 'button');
        a.tabIndex = 0;
        a.style.cursor = 'pointer';
        const save = async () => {
          try { await dl.save({ filename: a.textContent.replace(/^Download /, ''), data: res.blob }); }
          catch (e) { if (e?.code !== 'declined') $('status').textContent = `Could not save the file: ${e?.message || e?.code || e}`; }
        };
        a.addEventListener('click', save);
        a.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); save(); } });
      }
    } catch { /* plain page: the normal download link stays */ }
  } catch (err) {
    $('status').textContent = err.name === 'AbortError' ? 'Cancelled.' : `Export failed: ${err.message}`;
  } finally {
    setBusy(false);
    $('bar').value = 0;
    abort = null;
    drawAt(state.t); // restore the preview frame
  }
});

$('cancel').addEventListener('click', () => abort?.abort());

setSize();
refresh();

// the bundled default skin loads in the background; the preview redraws once it is ready
$('skin').disabled = true;
$('useDefault').disabled = true;
loadDefaultSkin(skinEnv, bytesOf)
  .then((skin) => {
    state.defaultSkin = skin;
    $('skin').disabled = false;
    $('useDefault').disabled = false;
    if (!state.skin) applySkin(skin, []);
  })
  .catch((err) => {
    state.skinMsgs = [['err', `Could not load the default skin (${err.message}). Serve this folder over http://localhost, not file://.`]];
    refresh();
  });

// the real tosu overlays: load their stylesheet + font, redraw as images arrive
TosuOverlays.load(bytesOf).then((o) => {
  let queued = false;
  o.onReady = () => { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; drawAt(state.t); }); };
  o.setCover(state.bg);
  state.tosu = o;
  drawAt(state.t);
}).catch(() => {});

// digits for the osu!lazer HUD
loadArgonFonts(skinEnv, bytesOf).then((g) => { state.argon = g; drawAt(state.t); }).catch(() => {});

// Roboto Mono for the overlay text; redraw the preview once it has loaded.
loadOverlayFonts().then((ok) => { if (ok) drawAt(state.t); });

// ---- version line: what is running here, and whether the deployed page is newer ----
(async () => {
  const el = document.getElementById('ver');
  if (!el) return;
  const pageV = document.querySelector('meta[name="app-version"]')?.content ?? '?';
  const say = (text, cls = 'dim') => { el.textContent = text; el.className = cls; };
  say(pageV === VERSION ? `Version ${VERSION}` : `Version ${VERSION} (page ${pageV}: mixed cache, hard-refresh with Ctrl+F5)`, pageV === VERSION ? 'dim' : 'warn');
  try {
    const r = await fetch(`${location.pathname}?_=${Date.now()}`, { cache: 'no-store' });
    const latest = /<meta name="app-version" content="([^"]+)"/.exec(await r.text())?.[1];
    if (latest && latest !== VERSION) say(`Version ${VERSION}. A newer version (${latest}) is deployed: hard-refresh (Ctrl+F5 / Cmd+Shift+R).`, 'warn');
    else if (latest) say(`Version ${VERSION} (latest)`);
  } catch { /* offline or opened from disk: keep the plain line */ }
})();
