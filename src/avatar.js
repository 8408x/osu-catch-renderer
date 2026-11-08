// The player's picture for the Player card looks: loaded from the osu! servers by user id, or uploaded by hand.

const KEY = 'ocr.userid', IMG_KEY = 'ocr.avatarimg';
/** The site's own lookup Worker (the address is public; the osu! secret lives only in Cloudflare). */
const DEFAULT_LOOKUP = 'https://osu-lookup.asianrbx.workers.dev';
let redrawFn = () => {};
let profile = null;                                   // { username, country_code, rank, ... } from the lookup Worker
let custom = false;                                   // the picture was uploaded by hand, so a lookup must not replace it
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
    if (!custom) { try { current = await loadImage(`${base}/avatar/${j.id}`); } catch { /* keep the picture that was already set */ } }
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

/** An uploaded file, shrunk to at most 256 px and returned as a data URL (small enough to keep in the browser, and safe for the export canvas). */
async function fromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const src = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('not an image')); i.src = url; });
    const k = Math.min(1, 256 / Math.max(src.naturalWidth, src.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(src.naturalWidth * k)); c.height = Math.max(1, Math.round(src.naturalHeight * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

/** Wire the inputs in the layout pane. */
export function initAvatar(redraw) {
  redrawFn = redraw;
  const $ = (id) => document.getElementById(id);
  const say = (m) => { $('avatarmsg').textContent = m; };
  const set = (img, msg) => { current = img; say(msg); redraw(); };
  try { $('avatarid').value = localStorage.getItem(KEY) ?? ''; } catch { /* storage unavailable */ }

  const load = async () => {
    const id = $('avatarid').value.trim();
    try { localStorage.setItem(KEY, id); } catch { /* ignore */ }
    custom = false; try { localStorage.removeItem(IMG_KEY); } catch { /* ignore */ }
    if (!id) { set(null, ''); return; }
    if (!/^\d{1,10}$/.test(id)) { say('A user id is a number, like 2 (the digits at the end of the profile link).'); return; }
    say('Loading…');
    try { set(await fromId(id), 'Loaded.'); }
    catch { set(null, 'Could not load that picture here. Upload one instead.'); }
  };
  $('avatarload').addEventListener('click', load);
  $('avatarid').addEventListener('keydown', (e) => { if (e.key === 'Enter') load(); });
  $('avatarpick').addEventListener('click', () => $('avatarfile').click());
  $('avatarfile').addEventListener('change', async () => {
    const f = $('avatarfile').files?.[0]; $('avatarfile').value = '';
    if (!f) return;
    try {
      const data = await fromFile(f);
      custom = true; try { localStorage.setItem(IMG_KEY, data); } catch { /* too big or blocked: it just will not be remembered */ }
      set(await loadImage(data), `Using ${f.name} (kept in this browser).`);
    } catch (err) { say(`That file could not be used: ${err.message}.`); }
  });
  $('avatarclear').addEventListener('click', () => { $('avatarid').value = ''; custom = false; try { localStorage.removeItem(KEY); localStorage.removeItem(IMG_KEY); } catch { /* ignore */ } set(null, ''); });
  let saved = null; try { saved = localStorage.getItem(IMG_KEY); } catch { /* ignore */ }
  if (saved) loadImage(saved).then((img) => { custom = true; set(img, 'Using your uploaded picture.'); }, () => {});   // an uploaded picture comes back on the next visit
  else if ($('avatarid').value) load();              // the saved id is tried again on the next visit
}

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
