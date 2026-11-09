// The player's picture for the Player card looks: loaded from the osu! servers by user id, or uploaded by hand.


/** The site's own lookup Worker (the address is public; the osu! secret lives only in Cloudflare). */
const DEFAULT_LOOKUP = 'https://osu-lookup.asianrbx.workers.dev';
let redrawFn = () => {};
let profile = null;                                   // { username, country_code, rank, ... } from the lookup Worker
export const online = { player: null, board: null };   // what the lookups did, for the Logs: { tone: 'ok' | 'warn' | 'dim', text }
let onOnline = () => {};
const setOnline = (k, tone, text) => { online[k] = { tone, text }; onOnline(); };
let current = null;                                   // an HTMLImageElement that is safe to draw into the export canvas

export const getAvatar = () => current;
export const getProfile = () => profile;
const lookupBase = () => DEFAULT_LOOKUP;

/** Look the replay's player up through the user's own Worker: sets the profile (rank, country) and the picture. */
export async function lookupPlayer(name) {
  const base = lookupBase();
  profile = null;
  current = null;                                        // never keep the previous player's picture
  if (!base || !name) { online.player = null; redrawFn(); return; }
  const msg = document.getElementById('lookupmsg');
  const say = (m) => { if (msg) msg.textContent = m; };
  say(`Looking up ${name}…`);
  setOnline('player', 'dim', `Player: looking up ${name}…`);
  try {
    const res = await fetch(`${base}/user?name=${encodeURIComponent(name)}`);
    const j = await res.json().catch(() => null);
    if (!res.ok) {
      if (res.status === 404) throw new Error(`${name} was not found as an osu! player (renamed, restricted or a different spelling), so there is no picture or rank for them`);
      throw new Error(j?.error || `the lookup answered ${res.status}`);
    }
    if (!j || j.id == null) throw new Error('the lookup Worker is out of date: re-paste worker/osu-lookup.js in Cloudflare');
    profile = j;
    current = await loadPicture(`${base}/avatar/${j.id}`);
    say(`Found ${j.username}${j.rank ? ` (#${j.rank.toLocaleString('en-US')})` : ''}.`);
    setOnline('player', current ? 'ok' : 'warn', `Player: ${j.username}${j.rank ? ` (#${j.rank.toLocaleString('en-US')})` : ''}${current ? '' : ', but the picture could not be loaded'}`);
    redrawFn();
    const extra = (key, src) => src && loadImage(src).then((img) => { if (profile === j) { j[key] = img; redrawFn(); } }, () => {});   // the flag and the profile banner are optional
    extra('flagImg', j.country_code && `${base}/flag/${j.country_code}`);
    extra('coverImg', j.cover_url && `${base}/cover?u=${encodeURIComponent(j.cover_url)}`);
  } catch (err) {
    say(`Lookup failed: ${err.message}`);
    setOnline('player', 'warn', `Player: ${String(err.message).replace(/^Failed to fetch$/, 'could not reach the lookup Worker (offline or blocked)')}`);
  }
  redrawFn();
}

/** The picture as a still 256x256 canvas (an animated picture can draw blank on some browsers), retried a few times; null when it never loads. */
async function loadPicture(src) {
  for (let i = 0; i < 3; i++) {
    try {
      const img = await loadImage(i ? `${src}${src.includes('?') ? '&' : '?'}r=${i}` : src);
      await img.decode?.().catch(() => {});
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const k = Math.max(256 / img.naturalWidth, 256 / img.naturalHeight);
      c.getContext('2d').drawImage(img, (256 - img.naturalWidth * k) / 2, (256 - img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k);
      c.naturalWidth = c.naturalHeight = 256;                // the drawing code reads these like an image's
      return c;
    } catch { await new Promise((r) => setTimeout(r, 400 * (i + 1))); }
  }
  return null;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';                      // an image the server will not share fails here instead of tainting the export canvas
    img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('empty')));
    img.onerror = () => reject(new Error('blocked or not found'));
    img.src = src;
  });
}

/** The osu! avatar server first, then the same picture through wsrv.nl, a free image proxy that allows other sites to use its images. */
async function fromId(id) {
  const sources = [`https://a.ppy.sh/${id}`, `https://wsrv.nl/?url=${encodeURIComponent(`a.ppy.sh/${id}`)}&w=256&h=256&fit=cover`];
  let last;
  for (const src of sources) {
    try { return await loadImage(src); } catch (err) { last = err; }
  }
  throw last;
}

/** Hand the page's repaint function to this module (lookups call it when a profile or picture arrives). */
export function initAvatar(redraw, onStatus = () => {}) { redrawFn = redraw; onOnline = onStatus; }

let board = null;                                     // { beatmap_id, scores: [...] } for the loaded replay's map, or null
export const getBoard = () => board;
/** The map's real osu!catch leaderboard (top 50) through the lookup Worker; resolves to the board or null, and says why in #boardmsg. */
export async function loadBoard(md5, beatmapId = 0) {
  board = null;
  const msg = document.getElementById('boardmsg');
  const say = (m) => { if (msg) msg.textContent = m; };
  if (!md5) { say(''); online.board = null; redrawFn(); return null; }
  say('Loading the leaderboard…');
  setOnline('board', 'dim', 'Leaderboard: loading…');
  try {
    const res = await fetch(`${lookupBase()}/scores?checksum=${md5}${beatmapId ? `&id=${beatmapId}` : ''}`);
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error(j?.error || `the lookup answered ${res.status}`);
    if (!Array.isArray(j?.scores)) throw new Error('the lookup Worker is out of date: re-paste worker/osu-lookup.js in Cloudflare');
    board = j;
    say(`Leaderboard loaded: ${j.scores.length} scores.`);
    const note = j.same_version === false ? ' (the map has been updated since this replay, so it shows the newest version\'s scores)' : '';
    setOnline('board', j.scores.length ? 'ok' : 'warn', j.scores.length ? `Leaderboard: ${j.scores.length} scores${j.list ? ` from ${j.list}` : ''}${j.zero_debug ? ` [no old score: ${j.zero_debug}]` : ''}${j.v1 ? ` (${j.v1} with exact old-style scores)` : j.v1_note ? ` (old-style scores unavailable: ${j.v1_note})` : j.v1 === undefined ? ' (the Worker has not updated yet: no old-style scores)' : ''}${j.status ? ` (${j.status} map)` : ''}${note}` : `Leaderboard: this ${j.status || ''} map has no osu!catch scores`.replace('  ', ' '));
    // no profile for the player (the user lookup failed)? Their own entry on this board still gives an id and a country
    const who = document.getElementById('lookupwho')?.dataset.name?.toLowerCase();
    const mine = who && !profile ? j.scores.find((x) => x.username.toLowerCase() === who) : null;
    if (mine) {
      profile = { id: mine.user_id, username: mine.username, country_code: mine.country_code, rank: null };
      current = await loadPicture(`${lookupBase()}/avatar/${mine.user_id}`); if (current) { setOnline('player', 'ok', `Player: ${mine.username}, found on the leaderboard (the profile lookup itself failed, so no rank)`); }
    }
  } catch (err) {
    say(`No leaderboard: ${err.message}.`);
    setOnline('board', 'warn', `Leaderboard: ${String(err.message).replace(/^Failed to fetch$/, 'could not reach the lookup Worker (offline or blocked)')}`);
  }
  redrawFn();
  return board;
}
