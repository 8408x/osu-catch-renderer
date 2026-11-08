// The player's picture for the Player card looks: loaded from the osu! servers by user id, or uploaded by hand.

const KEY = 'ocr.userid';
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

function fromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => resolve(img);
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('not an image')); };
    img.src = url;
  });
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
    try { set(await fromFile(f), `Using ${f.name}.`); } catch (err) { say(`That file could not be used: ${err.message}.`); }
  });
  $('avatarclear').addEventListener('click', () => { $('avatarid').value = ''; try { localStorage.removeItem(KEY); } catch { /* ignore */ } set(null, ''); });
  if ($('avatarid').value) load();                    // the saved id is tried again on the next visit
}
