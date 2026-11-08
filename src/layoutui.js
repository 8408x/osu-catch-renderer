// The Layout tab and dragging on the preview. Owns the layout object (saved in localStorage); main.js hands it to
// drawFrame. Pure UI: nothing here draws a frame.

import { PRESETS, parseLayoutFile, layoutFileText, layoutToCode, layoutFromCode, WIDGETS, AUTHORS, styleInfo, ORDER, MIN_SCALE, MAX_SCALE, defaultLayout, normalizeLayout, rectOf, hitTest, clampPosition, snapPosition } from './layout.js?v=20261109s';
import { initAvatar } from './avatar.js?v=20261109s';

const ICONS = {
  github: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.71 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>',
  twitter: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M12.2 1.5h2.2L9.6 7l5.6 7.5h-4.4L7.4 9.9 3.4 14.5H1.2l5.2-5.9L1 1.5h4.5l3.1 4.2zm-.8 11.7h1.2L4.7 2.7H3.4z"/></svg>',
  discord: '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M13.5 3.3A13 13 0 0 0 10.3 2.3l-.2.4a12 12 0 0 0-4.2 0l-.2-.4a13 13 0 0 0-3.2 1C.6 6.3.1 9.2.3 12a13 13 0 0 0 4 2l.8-1.3-1.3-.6.3-.2a9.300 9.300 0 0 0 7.800 0l.3.2-1.300.6.8 1.300a13 13 0 0 0 4-2c.3-3.200-.5-6.100-2.200-8.700zM5.700 10.300c-.8 0-1.400-.7-1.400-1.600s.6-1.600 1.400-1.600 1.400.7 1.400 1.600-.6 1.600-1.400 1.600zm4.600 0c-.8 0-1.400-.7-1.400-1.600s.6-1.600 1.400-1.600 1.400.7 1.400 1.600-.6 1.600-1.400 1.600z"/></svg>',
};

/** "Design by <author>" followed by small icon links for the author's GitHub, X/Twitter and Discord, when known. */
function creditLine(st) {
  const el = document.createElement('span');
  el.append(document.createTextNode(`Design: ${st.credit} `));
  const links = AUTHORS[st.author] ?? {};
  for (const kind of ['github', 'twitter', 'discord']) {
    if (!links[kind]) continue;
    const a = document.createElement('a');
    a.href = links[kind];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'iconlink';
    a.title = `${st.author} on ${kind === 'twitter' ? 'X / Twitter' : kind[0].toUpperCase() + kind.slice(1)}`;
    a.setAttribute('aria-label', a.title);
    a.innerHTML = ICONS[kind];
    el.append(a);
  }
  return el;
}

const KEY = 'ocr.layout', PKEY = 'ocr.presets';
const loadPresets = () => { try { const o = JSON.parse(localStorage.getItem(PKEY)); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };
const savePresets = (o) => { try { localStorage.setItem(PKEY, JSON.stringify(o)); } catch { /* storage blocked */ } };
const load = () => { try { return normalizeLayout(JSON.parse(localStorage.getItem(KEY))); } catch { return defaultLayout(); } };
const save = (l) => { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage blocked */ } };

/**
 * @param {object} o
 * @param {HTMLCanvasElement} o.canvas the preview canvas
 * @param {HTMLElement} o.pane the Layout tab's body
 * @param {() => boolean} o.editable true when the Custom style is on and the HUD is shown and nothing is rendering
 * @param {() => void} o.redraw repaint the preview
 */
export function initLayoutEditor({ canvas, pane, editable, redraw }) {
  const layout = load();
  const ui = { selected: 'title', hover: null, x: null, y: null, tabOpen: false };

  // ---- the pane ----
  pane.innerHTML = `
    <div class="group">
      <h3>Layouts</h3>
      <label class="field"><span>Load a layout</span><select id="presetsel"></select></label>
      <div class="row">
        <input type="text" id="presetname" placeholder="Name to save the current layout as" maxlength="40" style="flex:1;min-width:0">
        <button type="button" class="ghost small" id="presetsave">Save</button>
      </div>
      <div class="row">
        <button type="button" class="ghost small" id="presetdel">Delete saved</button>
        <button type="button" class="ghost small" id="presetexport">Export file</button>
        <button type="button" class="ghost small" id="presetimport">Import file</button>
        <button type="button" class="ghost small" id="presetshare">Copy share link</button>
        <input type="file" id="presetfile" accept=".json,application/json" hidden>
      </div>
      <p class="note" id="presetmsg" style="margin:6px 0 0"></p>
    </div>
    <div class="group">
      <h3>Player picture</h3>
      <div class="row">
        <input type="text" id="avatarid" inputmode="numeric" placeholder="osu! user id" maxlength="10" style="flex:1;min-width:0">
        <button type="button" class="ghost small" id="avatarload">Load</button>
      </div>
      <div class="row">
        <button type="button" class="ghost small" id="avatarpick">Upload picture</button>
        <button type="button" class="ghost small" id="avatarclear">Remove</button>
        <input type="file" id="avatarfile" accept="image/*" hidden>
      </div>
      <p class="note" id="avatarmsg" style="margin:6px 0 0">Shown by the Player card looks. The id is the number at the end of your osu! profile link.</p>
      <p class="note" id="lookupmsg" style="margin:6px 0 0"></p>
      <span id="lookupwho" hidden></span>
    </div>
    <div class="group">
      <h3>Widgets</h3>
      <p class="note" id="layoutnote" style="margin:0 0 10px"></p>
      <div id="widgetlist" class="widgetlist"></div>
    </div>
    <div class="group" id="widgetprops">
      <h3 id="propstitle">Selected</h3>
      <div class="field" id="stylefield"><span>Look</span>
        <div class="dd" id="lookdd"><button type="button" id="lookbtn" aria-haspopup="listbox" aria-expanded="false"></button><ul id="looklist" role="listbox" hidden></ul></div>
      </div>
      <p class="note credit" id="stylecredit" style="margin:4px 0 10px"></p>
      <label class="slider"><span>Size</span><output id="scaleout"></output>
        <input id="widgetscale" type="range" min="${Math.round(MIN_SCALE * 100)}" max="${Math.round(MAX_SCALE * 100)}" step="5" value="100">
      </label>
      <label class="slider"><span>Opacity</span><output id="alphaout"></output>
        <input id="widgetalpha" type="range" min="10" max="100" step="5" value="100">
      </label>
      <div class="row">
        <button type="button" class="ghost small" id="centerx">Centre across</button>
        <button type="button" class="ghost small" id="resetone">Reset this one</button>
      </div>
    </div>
    <div class="row"><button type="button" class="ghost" id="resetall">Reset the whole layout</button></div>
    <p class="note">Drag a widget on the preview, or select it here and nudge it with the arrow keys (Shift = bigger steps). Hold Alt while dragging to turn off snapping.</p>`;
  const $ = (id) => pane.querySelector(`#${id}`);
  const list = $('widgetlist');

  const rows = {};
  for (const id of ORDER) {
    const row = document.createElement('div');
    row.className = 'widgetrow';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = `wshow-${id}`;
    box.setAttribute('aria-label', `Show ${WIDGETS[id].label}`);
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.textContent = WIDGETS[id].label;
    row.append(box, pick);
    list.append(row);
    rows[id] = { row, box, pick };
    box.addEventListener('change', () => { layout[id].on = box.checked; if (box.checked) ui.selected = id; changed(); });
    pick.addEventListener('click', () => { ui.selected = id; sync(); redraw(); });
  }

  const sync = () => {
    const ok = editable();
    $('layoutnote').textContent = ok ? '' : 'Choose the Custom style and keep the HUD on (Look tab) to arrange widgets.';
    for (const id of ORDER) {
      rows[id].box.checked = layout[id].on;
      rows[id].row.classList.toggle('sel', id === ui.selected);
    }
    const c = layout[ui.selected];
    $('propstitle').textContent = WIDGETS[ui.selected].label;
    const st = styleInfo(ui.selected, c.style), many = WIDGETS[ui.selected].styles.length > 1;
    $('lookbtn').textContent = st.label;
    $('lookbtn').disabled = !many;
    $('looklist').hidden = true;
    $('lookbtn').setAttribute('aria-expanded', 'false');
    $('looklist').replaceChildren(...WIDGETS[ui.selected].styles.map((x) => {
      const li = document.createElement('li');
      li.role = 'option';
      li.tabIndex = 0;
      li.setAttribute('aria-selected', String(x.id === c.style));
      li.innerHTML = `<b>${x.label}</b><small>${x.author ? `by ${x.author}` : (x.credit.endsWith('unknown') ? 'author unknown' : 'made for this site')}</small>`;
      const pick = () => { c.style = x.id; fitStyle(); changed(); $('lookbtn').focus(); };
      li.addEventListener('click', pick);
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      return li;
    }));
    $('stylecredit').replaceChildren(creditLine(st));
    $('widgetscale').value = String(Math.round(c.s * 100));
    $('scaleout').textContent = `${Math.round(c.s * 100)}%`;
    $('widgetalpha').value = String(Math.round(c.a * 100));
    $('alphaout').textContent = `${Math.round(c.a * 100)}%`;
    $('widgetprops').style.opacity = c.on ? '1' : '0.5';
  };
  const changed = () => { save(layout); sync(); redraw(); };

  // ---- saved layouts, built-in layouts, and layout files ----
  const saved = loadPresets();
  initAvatar(redraw);
  const say = (m) => { $('presetmsg').textContent = m; };
  const fillPresets = (pick = '') => {
    const sel = $('presetsel');
    sel.replaceChildren(new Option('Choose…', ''), ...PRESETS.map((p) => new Option(p.name, `b:${p.id}`)),
      ...Object.keys(saved).map((n) => new Option(`${n} (saved)`, `s:${n}`)));
    sel.value = pick;
    $('presetdel').disabled = !pick.startsWith('s:');
  };
  const applyLayout = (l) => { Object.assign(layout, normalizeLayout(l)); ui.selected = ORDER.find((id) => layout[id].on) ?? ORDER[0]; changed(); };
  $('presetsel').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v.startsWith('b:')) applyLayout(PRESETS.find((p) => p.id === v.slice(2)).build());
    else if (v.startsWith('s:') && saved[v.slice(2)]) applyLayout(saved[v.slice(2)]);
    $('presetdel').disabled = !v.startsWith('s:');
    say(v ? `Loaded ${v.slice(2)}.` : '');
  });
  $('presetsave').addEventListener('click', () => {
    const name = $('presetname').value.trim();
    if (!name) { say('Type a name first.'); return; }
    saved[name] = JSON.parse(JSON.stringify(layout));
    savePresets(saved);
    $('presetname').value = '';
    fillPresets(`s:${name}`);
    say(`Saved ${name}.`);
  });
  $('presetdel').addEventListener('click', () => {
    const v = $('presetsel').value;
    if (!v.startsWith('s:')) return;
    delete saved[v.slice(2)];
    savePresets(saved);
    fillPresets();
    say('Deleted.');
  });
  $('presetexport').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([layoutFileText(layout)], { type: 'application/json' }));
    a.download = 'catch-layout.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say('Exported catch-layout.json.');
  });
  $('presetimport').addEventListener('click', () => $('presetfile').click());
  $('presetfile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const l = parseLayoutFile(await f.text());
    if (!l) { say('That file is not a layout.'); return; }
    applyLayout(l);
    say(`Imported ${f.name}.`);
  });
  $('presetshare').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#layout=${layoutToCode(layout)}`;
    try { await navigator.clipboard.writeText(url); say('Link copied. Anyone who opens it gets this layout.'); }
    catch { window.prompt('Copy this link:', url); say('Share this link to give someone this layout.'); }
  });
  fillPresets();
  // a shared link brings its layout along: #layout=...
  const shared = /[#&]layout=([\w-]+)/.exec(location.hash);
  if (shared) {
    const l = layoutFromCode(shared[1]);
    if (l) { Object.assign(layout, l); ui.selected = ORDER.find((id) => layout[id].on) ?? ORDER[0]; save(layout); sync(); const hs = document.getElementById('hudstyle'); if (hs && hs.value !== 'overlay') hs.value = 'custom'; say('Loaded the layout from the link you opened.'); }
    else say('That link\'s layout could not be read.');
  }

  // keep the widget's top-left where it was; only pull it back if the new look would leave the frame
  const fitStyle = () => {
    const c = layout[ui.selected], r = rectOf(ui.selected, layout, canvas.width, canvas.height);
    // keep the whole widget inside the frame when it fits
    c.x = Math.max(0, Math.min(c.x, 1 - r[2] / canvas.width));
    c.y = Math.max(0, Math.min(c.y, 1 - r[3] / canvas.height));
  };
  const toggleList = (open) => {
    const list = $('looklist'), btn = $('lookbtn');
    if (btn.disabled) return;
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  $('lookbtn').addEventListener('click', () => toggleList($('looklist').hidden));
  document.addEventListener('pointerdown', (e) => { if (!$('lookdd').contains(e.target)) toggleList(false); });
  $('lookdd').addEventListener('keydown', (e) => { if (e.key === 'Escape') { toggleList(false); $('lookbtn').focus(); } });
  $('widgetscale').addEventListener('input', (e) => {
    const c = layout[ui.selected];
    const before = rectOf(ui.selected, layout, canvas.width, canvas.height);
    c.s = Number(e.target.value) / 100;
    const after = rectOf(ui.selected, layout, canvas.width, canvas.height);
    // grow around the centre, so the widget does not creep towards one corner
    c.x += (before[0] + before[2] / 2 - (after[0] + after[2] / 2)) / canvas.width;
    c.y += (before[1] + before[3] / 2 - (after[1] + after[3] / 2)) / canvas.height;
    changed();
  });
  $('widgetalpha').addEventListener('input', (e) => { layout[ui.selected].a = Number(e.target.value) / 100; changed(); });
  $('centerx').addEventListener('click', () => {
    const [, , w] = rectOf(ui.selected, layout, canvas.width, canvas.height);
    layout[ui.selected].x = 0.5 - w / canvas.width / 2;
    changed();
  });
  $('resetone').addEventListener('click', () => { Object.assign(layout[ui.selected], defaultLayout()[ui.selected]); changed(); });
  $('resetall').addEventListener('click', () => { Object.assign(layout, defaultLayout()); changed(); });

  // ---- dragging on the preview ----
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return [((e.clientX - r.left) * canvas.width) / r.width, ((e.clientY - r.top) * canvas.height) / r.height];
  };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!editable() || e.button !== 0) return;
    const [px, py] = point(e);
    const id = hitTest(layout, canvas.width, canvas.height, px, py);
    if (!id) { ui.selected = ui.selected; return; }
    const [x, y] = rectOf(id, layout, canvas.width, canvas.height);
    drag = { id, dx: px - x, dy: py - y };
    ui.selected = id;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    sync();
    redraw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!editable()) { if (ui.hover) { ui.hover = null; redraw(); } canvas.style.cursor = ''; return; }
    const [px, py] = point(e);
    if (drag) {
      const W = canvas.width, H = canvas.height;
      let x = (px - drag.dx) / W, y = (py - drag.dy) / H;
      ui.x = ui.y = null;
      if (!e.altKey) { const [sx, sy, g] = snapPosition(drag.id, layout, x, y, W, H); x = sx; y = sy; ui.x = g.x; ui.y = g.y; }
      [x, y] = clampPosition(drag.id, layout, x, y, W, H);
      layout[drag.id].x = x;
      layout[drag.id].y = y;
      redraw();
      return;
    }
    const id = hitTest(layout, canvas.width, canvas.height, px, py);
    canvas.style.cursor = id ? 'grab' : '';
    if (id !== ui.hover) { ui.hover = id; redraw(); }
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    ui.x = ui.y = null;
    canvas.style.cursor = '';
    save(layout);
    redraw();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { if (!drag && ui.hover) { ui.hover = null; redraw(); } });

  // arrow keys nudge the selected widget while the Layout tab is open
  document.addEventListener('keydown', (e) => {
    if (!ui.tabOpen || !editable() || !e.key.startsWith('Arrow')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' && t.type !== 'checkbox' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const step = (e.shiftKey ? 0.01 : 0.002);
    const c = layout[ui.selected];
    if (e.key === 'ArrowLeft') c.x -= step;
    else if (e.key === 'ArrowRight') c.x += step;
    else if (e.key === 'ArrowUp') c.y -= step;
    else c.y += step;
    [c.x, c.y] = clampPosition(ui.selected, layout, c.x, c.y, canvas.width, canvas.height);
    e.preventDefault();
    save(layout);
    redraw();
  });

  // outlines show while the Layout tab is open, and for the widget under the pointer otherwise
  const tab = document.getElementById('tab-layout');
  const watch = () => { ui.tabOpen = tab?.getAttribute('aria-selected') === 'true'; sync(); redraw(); };
  if (tab) new MutationObserver(watch).observe(tab, { attributes: true, attributeFilter: ['aria-selected'] });
  ui.tabOpen = tab?.getAttribute('aria-selected') === 'true';
  sync();

  return {
    layout,
    /** What drawFrame should outline, or null when nothing is being arranged. */
    guides() {
      if (!editable()) return null;
      if (!ui.tabOpen && !drag && !ui.hover) return null;
      return { selected: ui.tabOpen || drag ? ui.selected : null, hover: ui.hover, x: ui.x, y: ui.y, all: ui.tabOpen };
    },
    refresh: sync,
  };
}
