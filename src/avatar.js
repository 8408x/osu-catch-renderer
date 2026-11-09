// The player's picture for the Player card looks: loaded from the osu! servers by user id, or uploaded by hand.


/** The site's own lookup Worker (the address is public; the osu! secret lives only in Cloudflare). */
const DEFAULT_LOOKUP = 'https://osu-lookup.asianrbx.workers.dev';
let redrawFn = () => {};
let profile = null;                                   // { username, country_code, rank, ... } from the lookup Worker
let current = null;                                   // an HTMLImageElement that is safe to draw into the export canvas

export const getAvatar = () => current;
export const getProfile = () => profile;
const lookupBase = () => DEFAULT_LOOKUP;

/** Look the replay's player up through the user's own Worker: sets the profile (rank, country) and the picture. */
export async function lookupPlayer(name) {
  const base = lookupBase();
  profile = null;
  if (!base || !name) { redrawFn(); return; }
  const msg = document.getElementById('lookupmsg');
  const say = (m) => { if (msg) msg.textContent = m; };
  say(`Looking up ${name}…`);
  try {
    const res = await fetch(`${base}/user?name=${encodeURIComponent(name)}`);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || res.status);
    profile = j;
    try { current = await loadImage(`${base}/avatar/${j.id}`); } catch { /* keep the picture that was already set */ }
    say(`Found ${j.username}${j.rank ? ` (#${j.rank.toLocaleString('en-US')})` : ''}.`);
    redrawFn();
    const extra = (key, src) => src && loadImage(src).then((img) => { if (profile === j) { j[key] = img; redrawFn(); } }, () => {});   // the flag and the profile banner are optional
    extra('flagImg', j.country_code && `${base}/flag/${j.country_code}`);
    extra('coverImg', j.cover_url && `${base}/cover?u=${encodeURIComponent(j.cover_url)}`);
  } catch (err) {
    say(`Lookup failed: ${err.message}`);
  }
  redrawFn();
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
export function initAvatar(redraw) { redrawFn = redraw; }

let board = null;                                     // { beatmap_id, scores: [...] } for the loaded replay's map, or null
export const getBoard = () => board;
/** The map's real osu!catch leaderboard (top 50) through the lookup Worker; resolves to the board or null, and says why in #boardmsg. */
export async function loadBoard(md5) {
  board = null;
  const msg = document.getElementById('boardmsg');
  const say = (m) => { if (msg) msg.textContent = m; };
  if (!md5) { say(''); redrawFn(); return null; }
  say('Loading the leaderboard…');
  try {
    const res = await fetch(`${lookupBase()}/scores?checksum=${md5}`);
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || res.status);
    board = j;
    say(`Leaderboard loaded: ${j.scores.length} scores.`);
  } catch (err) {
    say(`No leaderboard: ${err.message}. (If the Worker is old, re-paste worker/osu-lookup.js in Cloudflare.)`);
  }
  redrawFn();
  return board;
}
