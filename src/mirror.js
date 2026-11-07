// Fetching a beatmap set (.osz) for a replay from community osu! mirrors, so nobody has to find and
// pick the files by hand.
//
// Why mirrors and not osu.ppy.sh: the official API needs a client secret (cannot live in a web page) and
// downloads there need a login. Mirrors are public. The replay only stores the MD5 of the .osu file, so:
//   1. look the MD5 up on a mirror to learn the beatmap SET id (or take a set id/link the user typed),
//   2. download that set as .osz from the first mirror that works,
//   3. the caller then matches the right difficulty by MD5 (readOsz/findDifficulty), which also proves
//      the download is really the map that was played.
//
// A mirror only works from a web page if it sends CORS headers. That cannot be checked from the build
// environment, so every step reports exactly what went wrong and the next mirror is tried.

import { readOsz, findDifficulty } from './osz.js?v=20261108z';

const MAX_BYTES = 300 * 1024 * 1024;
const LOOKUP_IDLE_MS = 12_000;
const DOWNLOAD_IDLE_MS = 30_000; // no data for this long -> give up on that mirror

/**
 * Mirror list, in the order they are tried.
 *  - hinai: md5 lookup from https://mirror.hinamizawa.ai/docs/beatmap-info, download routes from its front page
 *    (`{id}n` = without video).
 *  - osu.direct: download route as used by its own client configuration; its md5 lookup route is not confirmed.
 *  - catboy.best: routes written from memory and NOT verified (its docs could not be read); harmless if wrong.
 */
export const MIRRORS = [
  {
    name: 'mirror.hinamizawa.ai',
    lookup: (md5) => `https://mirror.hinamizawa.ai/v3/osu/beatmaps/md5/${md5}`,
    downloads: (id) => [`https://mirror.hinamizawa.ai/api/v1/hinai/d/${id}n`, `https://mirror.hinamizawa.ai/api/v1/hinai/d/${id}`],
  },
  {
    name: 'osu.direct',
    lookup: null,
    downloads: (id) => [`https://osu.direct/api/d/${id}`],
  },
  {
    name: 'catboy.best',
    lookup: (md5) => `https://catboy.best/api/v2/md5/${md5}`,
    downloads: (id) => [`https://catboy.best/d/${id}n`, `https://catboy.best/d/${id}`],
  },
];

export class MirrorError extends Error {
  constructor(message, attempts) {
    super(message);
    this.name = 'MirrorError';
    this.attempts = attempts;
  }
}

/** A beatmap set id from what the user typed: "123456" or an osu.ppy.sh/beatmapsets/123456 link. null = empty, NaN = not valid. */
export function parseSetId(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/^\d{1,9}$/.test(s)) return Number(s) > 0 ? Number(s) : NaN;
  const m = /osu\.ppy\.sh\/(?:beatmapsets|s)\/(\d{1,9})/i.exec(s);
  return m && Number(m[1]) > 0 ? Number(m[1]) : NaN;
}

const SET_ID_KEYS = ['beatmapset_id', 'beatmapsetId', 'BeatmapSetID', 'beatmapSetId', 'set_id', 'setId', 'SetID', 'parent_set_id'];

/** Find the beatmap SET id in a lookup response whose exact shape we do not control (several mirrors, wrapped or not). */
export function extractSetId(json, depth = 0) {
  if (json == null || typeof json !== 'object' || depth > 3) return null;
  if (Array.isArray(json)) return extractSetId(json[0], depth + 1);
  for (const k of SET_ID_KEYS) {
    const v = Number(json[k]);
    if (Number.isInteger(v) && v > 0) return v;
  }
  if (json.beatmapset && typeof json.beatmapset === 'object') {
    const v = Number(json.beatmapset.id);
    if (Number.isInteger(v) && v > 0) return v;
  }
  for (const k of ['data', 'beatmap', 'result', 'beatmaps']) {
    if (json[k]) { const r = extractSetId(json[k], depth + 1); if (r) return r; }
  }
  return null;
}

// ---------- one request with an idle timeout and cancellation ----------

function guarded(signal, idleMs) {
  const ctl = new AbortController();
  let timedOut = false;
  let timer;
  const arm = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; ctl.abort(); }, idleMs); };
  const onAbort = () => ctl.abort();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  arm();
  return {
    signal: ctl.signal,
    touch: arm,
    get timedOut() { return timedOut; },
    done() { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); },
  };
}

class TooBig extends Error {}

async function readBody(res, guard, onProgress) {
  const total = Number(res.headers.get('content-length')) || 0;
  if (total > MAX_BYTES) throw new TooBig();
  if (!res.body?.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (got > MAX_BYTES) { reader.cancel().catch(() => {}); throw new TooBig(); }
    guard.touch();
    onProgress?.(got, total);
  }
  const out = new Uint8Array(got);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

const httpProblem = (status) =>
  status === 404 ? 'not found on this mirror'
    : status === 429 ? 'rate limited (wait a minute and try again)'
      : `HTTP ${status}`;

/** @returns {Promise<{ok:true, bytes:Uint8Array} | {ok:false, problem:string}>} (throws only when the user cancelled) */
async function fetchBytes(fetchImpl, url, { signal, idleMs, onProgress }) {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const guard = guarded(signal, idleMs);
  try {
    const res = await fetchImpl(url, { signal: guard.signal });
    if (!res.ok) return { ok: false, problem: httpProblem(res.status) };
    return { ok: true, bytes: await readBody(res, guard, onProgress) };
  } catch (err) {
    if (signal?.aborted) throw err?.name === 'AbortError' ? err : new DOMException('Cancelled', 'AbortError');
    if (guard.timedOut) return { ok: false, problem: 'timed out' };
    if (err instanceof TooBig) return { ok: false, problem: 'file is too large' };
    if (err instanceof TypeError) return { ok: false, problem: 'could not connect (offline, or this mirror does not allow requests from web pages)' };
    return { ok: false, problem: err?.message || String(err) };
  } finally {
    guard.done();
  }
}

function summarize(attempts, headline) {
  const lines = attempts.map((a) => `${a.mirror} (${a.step}): ${a.problem}`);
  const allConnect = attempts.length > 0 && attempts.every((a) => /could not connect/.test(a.problem));
  const hint = allConnect
    ? ' If every mirror fails like this, they probably do not allow requests from web pages: download the .osz yourself and pick it in the Music box.'
    : '';
  return `${headline}\n${lines.join('\n')}${hint}`;
}

/**
 * Get the beatmap set for a replay.
 * @param {object} o
 * @param {string} o.md5 beatmap hash from the replay
 * @param {number|null} [o.setId] beatmap set id if the user typed one (skips the lookup)
 * @returns {Promise<{setId:number, bytes:Uint8Array, osz:ReturnType<typeof readOsz>, mirror:string, matched:boolean}>}
 *   `matched` is true when the set contains a difficulty with exactly the replay's hash.
 */
export async function fetchSetForReplay({
  md5, setId = null, mirrors = MIRRORS, fetchImpl = globalThis.fetch?.bind(globalThis),
  signal, onStatus, onProgress, lookupIdleMs = LOOKUP_IDLE_MS, downloadIdleMs = DOWNLOAD_IDLE_MS,
}) {
  if (!fetchImpl) throw new MirrorError('This browser cannot make web requests.', []);
  const attempts = [];
  const note = (mirror, step, problem) => attempts.push({ mirror: mirror.name, step, problem });

  let id = setId;
  if (!id) {
    const hash = String(md5 || '').toLowerCase();
    if (!/^[0-9a-f]{32}$/.test(hash)) throw new MirrorError('This replay does not contain a valid beatmap hash.', []);
    for (const m of mirrors) {
      if (!m.lookup) continue;
      onStatus?.(`Looking up the map on ${m.name}…`);
      const r = await fetchBytes(fetchImpl, m.lookup(hash), { signal, idleMs: lookupIdleMs });
      if (!r.ok) { note(m, 'lookup', r.problem); continue; }
      let json = null;
      try { json = JSON.parse(new TextDecoder().decode(r.bytes)); } catch { /* handled below */ }
      id = extractSetId(json);
      if (id) break;
      note(m, 'lookup', 'the answer did not contain a beatmap set id');
    }
    if (!id) {
      throw new MirrorError(summarize(attempts, 'Could not find this map by its hash. You can paste the beatmap set link (https://osu.ppy.sh/beatmapsets/…) and try again.'), attempts);
    }
  }

  for (const m of mirrors) {
    for (const url of m.downloads(id)) {
      onStatus?.(`Downloading the map from ${m.name}…`);
      const r = await fetchBytes(fetchImpl, url, { signal, idleMs: downloadIdleMs, onProgress: (got, total) => onProgress?.(got, total, m.name) });
      if (!r.ok) { note(m, 'download', r.problem); continue; }
      let osz;
      try { osz = readOsz(r.bytes); } catch (err) { note(m, 'download', `did not return a beatmap set (${err.message})`); continue; }
      return { setId: id, bytes: r.bytes, osz, mirror: m.name, matched: !!findDifficulty(osz, md5) };
    }
  }
  throw new MirrorError(summarize(attempts, `Found the map (set ${id}) but could not download it.`), attempts);
}
