// The player's picture for the Player card looks: loaded from the osu! servers by user id, or uploaded by hand.

const KEY = 'ocr.userid';
let current = null;                                   // an HTMLImageElement that is safe to draw into the export canvas

export const getAvatar = () => current;

/** Try the osu! avatar server. crossOrigin keeps the canvas clean: an image the server will not share fails here instead of breaking the export. */
function fromId(id) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => (img.naturalWidth ? resolve(img) : reject(new Error('empty')));
    img.onerror = () => reject(new Error('blocked or not found'));
    img.src = `https://a.ppy.sh/${id}?${Date.now() % 100000}`;
  });
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
    try { set(await fromId(id), 'Loaded from the osu! servers.'); }
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
