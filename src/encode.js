// Offline MP4 export: draw frame -> VideoFrame -> WebCodecs VideoEncoder -> mp4-muxer,
// plus an optional audio track: Float32 PCM -> AudioData -> AudioEncoder (AAC, else Opus) -> mp4-muxer.
// The clock is a fixed timestep (frame i = i / fps), so rendering is not tied to real time
// and the output has perfectly even frame timing.

import { Muxer, StreamTarget } from '../vendor/mp4-muxer.mjs';
import { SAMPLE_RATE } from './audio.js?v=20261109v';

// Tried in order; the first one this browser can encode wins.
const CANDIDATES = [
  { label: 'H.264', codec: 'avc1.64002A', mux: 'avc' },     // High, level 4.2 (1080p60)
  { label: 'H.264', codec: 'avc1.4D002A', mux: 'avc' },     // Main
  { label: 'H.264', codec: 'avc1.640033', mux: 'avc' },     // High, level 5.1 (1440p+)
  { label: 'VP9', codec: 'vp09.00.50.08', mux: 'vp9' },
  { label: 'AV1', codec: 'av01.0.09M.08', mux: 'av1' },
];

// AAC plays everywhere (Windows Movies & TV, editors, phones); Opus-in-MP4 is the fallback for browsers
// whose AudioEncoder has no AAC (e.g. Linux Chromium).
const AUDIO_CANDIDATES = [
  { label: 'AAC', codec: 'mp4a.40.2', mux: 'aac' },
  { label: 'Opus', codec: 'opus', mux: 'opus' },
];
const AUDIO_BITRATE = 192_000;
const AUDIO_CHUNK = 4096; // sample frames per AudioData (a multiple of AAC's 1024)

export function webCodecsAvailable() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

export function audioEncodingAvailable() {
  return typeof AudioEncoder !== 'undefined' && typeof AudioData !== 'undefined';
}

export async function pickCodec({ width, height, fps, bitrate }) {
  for (const c of CANDIDATES) {
    const config = { codec: c.codec, width, height, bitrate, framerate: fps };
    if (c.mux === 'avc') config.avc = { format: 'avc' };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      if (supported) return { ...c, config };
    } catch { /* try the next one */ }
  }
  return null;
}

export async function pickAudioCodec({ sampleRate = SAMPLE_RATE, channels = 2, bitrate = AUDIO_BITRATE } = {}) {
  if (!audioEncodingAvailable()) return null;
  for (const c of AUDIO_CANDIDATES) {
    const config = { codec: c.codec, sampleRate, numberOfChannels: channels, bitrate };
    try {
      const { supported } = await AudioEncoder.isConfigSupported(config);
      if (supported) return { ...c, config };
    } catch { /* try the next one */ }
  }
  return null;
}

const yieldToUI = () => new Promise((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => resolve();
  ch.port2.postMessage(0);
});

async function encodeAudioTrack({ channels, sampleRate }, picked, muxer, signal, onProgress) {
  let error = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: (e) => { error = e; },
  });
  enc.configure(picked.config);
  const n = channels[0].length;
  try {
    for (let pos = 0, i = 0; pos < n; pos += AUDIO_CHUNK, i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (error) throw error;
      const frames = Math.min(AUDIO_CHUNK, n - pos);
      const buf = new Float32Array(frames * 2); // planar: all of L, then all of R
      buf.set(channels[0].subarray(pos, pos + frames), 0);
      buf.set(channels[1].subarray(pos, pos + frames), frames);
      const data = new AudioData({
        format: 'f32-planar', sampleRate, numberOfFrames: frames, numberOfChannels: 2,
        timestamp: Math.round((pos / sampleRate) * 1e6), data: buf,
      });
      enc.encode(data);
      data.close();
      while (enc.encodeQueueSize > 20) {
        if (error) throw error;
        await new Promise((resolve) => enc.addEventListener('dequeue', resolve, { once: true }));
      }
      if (i % 50 === 0) { onProgress?.(pos / n); await yieldToUI(); }
    }
    await enc.flush();
    if (error) throw error;
  } finally {
    if (enc.state !== 'closed') enc.close();
  }
}

/**
 * @param {object} o
 * @param {HTMLCanvasElement|OffscreenCanvas} o.canvas canvas that drawAt() paints on (even width/height)
 * @param {(timeMs:number)=>void|Promise<void>} o.drawAt paints the frame for beatmap time `timeMs`
 * @param {number} o.startTime beatmap time of the first frame (ms)
 * @param {number} o.endTime beatmap time to stop at (ms)
 * @param {number} [o.rate] playback rate (DT = 1.5): video seconds = map seconds / rate
 * @param {number} [o.fps]
 * @param {number} [o.bitrate] bits per second
 * @param {(durationSec:number)=>Promise<{channels:Float32Array[], sampleRate:number}>} [o.makeAudio]
 *   optional: returns the music for the whole video (2 channels, exactly duration * sampleRate samples)
 * @param {(p:number)=>void} [o.onProgress] 0..1
 * @param {(text:string)=>void} [o.onStatus] stage text ("Preparing music…")
 * @param {AbortSignal} [o.signal]
 * @param {number} [o.introSec] seconds of title card before the gameplay (silent)
 * @param {number} [o.outroSec] seconds of result card after it (silent)
 * @param {(kind:'intro'|'outro', progress:number)=>void|Promise<void>} [o.drawCard] paints a title card frame
 */
export async function exportMp4({ canvas, drawAt, startTime, endTime, rate = 1, fps = 60, bitrate = 12_000_000, makeAudio, onProgress, onStatus, signal, introSec = 0, outroSec = 0, drawCard }) {
  if (!webCodecsAvailable()) throw new Error('This browser has no WebCodecs video encoder. Use a current Chrome, Edge or Safari.');
  const { width, height } = canvas;
  if (width % 2 || height % 2) throw new Error('Video width and height must be even numbers.');

  const picked = await pickCodec({ width, height, fps, bitrate });
  if (!picked) throw new Error(`This browser cannot encode ${width}x${height} video at ${fps} fps. Try a lower resolution.`);

  // check audio support up front, before any slow work
  let audioPicked = null;
  if (makeAudio) {
    audioPicked = await pickAudioCodec();
    if (!audioPicked) throw new Error('This browser cannot encode audio. Use a current Chrome or Edge, or render without music.');
  }

  const mainFrames = Math.max(1, Math.ceil(((endTime - startTime) / rate / 1000) * fps));
  const introFrames = drawCard ? Math.round(introSec * fps) : 0, outroFrames = drawCard ? Math.round(outroSec * fps) : 0;
  const total = introFrames + mainFrames + outroFrames;
  const durationSec = mainFrames / fps;

  let audio = null;
  if (makeAudio) {
    onStatus?.('Preparing music…');
    await yieldToUI(); // let the status text paint; the DSP below blocks the page for a few seconds
    audio = await makeAudio(durationSec);
    if (introFrames || outroFrames) {                                        // silence under the cards: the music keeps its place under the gameplay
      const lead = Math.round((introFrames / fps) * audio.sampleRate), len = Math.round((total / fps) * audio.sampleRate);
      audio = { ...audio, channels: audio.channels.map((ch) => { const out = new Float32Array(len); out.set(ch.subarray(0, Math.max(0, Math.min(ch.length, len - lead))), lead); return out; }) };
    }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  }

  // Collect the file as separate 16 MB pieces instead of one growing ArrayBuffer: a long 1080p render is hundreds of
  // MB, and a single buffer that size (doubled while it grows) is what fails with "Array buffer allocation failed".
  const pieces = [];
  const muxer = new Muxer({
    target: new StreamTarget({ onData: (data, position) => pieces.push({ position, data: data.slice() }), chunked: true, chunkSize: 16 * 1024 * 1024 }),
    video: { codec: picked.mux, width, height, frameRate: fps },
    ...(audio ? { audio: { codec: audioPicked.mux, numberOfChannels: 2, sampleRate: audio.sampleRate } } : {}),
    fastStart: 'in-memory',
  });

  let encoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encoderError = e; },
  });
  encoder.configure(picked.config);

  const frameUs = 1e6 / fps;
  const videoShare = audio ? 0.94 : 1; // the audio pass is quick, it gets the last slice of the bar

  try {
    onStatus?.('Rendering…');
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (encoderError) throw encoderError;

      if (i < introFrames) await drawCard('intro', (i + 0.5) / introFrames);
      else if (i >= introFrames + mainFrames) await drawCard('outro', (i - introFrames - mainFrames + 0.5) / outroFrames);
      else await drawAt(startTime + ((i - introFrames) / fps) * 1000 * rate);

      const frame = new VideoFrame(canvas, { timestamp: Math.round(i * frameUs), duration: Math.round(frameUs) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();

      while (encoder.encodeQueueSize > 10) {
        if (encoderError) throw encoderError;
        await new Promise((resolve) => encoder.addEventListener('dequeue', resolve, { once: true }));
      }
      if (i % 10 === 0) { onProgress?.((i / total) * videoShare); await yieldToUI(); }
    }
    await encoder.flush();
    if (encoderError) throw encoderError;
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }

  if (audio) {
    onStatus?.('Encoding music…');
    await encodeAudioTrack(audio, audioPicked, muxer, signal, (p) => onProgress?.(videoShare + p * (1 - videoShare)));
  }

  muxer.finalize();
  onProgress?.(1);
  pieces.sort((a, b) => a.position - b.position);
  let at = 0;
  for (const piece of pieces) {
    if (piece.position !== at) throw new Error('Internal error: the MP4 pieces do not line up.');
    at += piece.data.byteLength;
  }
  return {
    blob: new Blob(pieces.map((x) => x.data), { type: 'video/mp4' }),
    codec: audio ? `${picked.label} + ${audioPicked.label}` : picked.label,
    frames: total,
    seconds: durationSec,
    hasAudio: !!audio,
  };
}
