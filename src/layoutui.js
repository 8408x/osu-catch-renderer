// The Layout tab and dragging on the preview. Owns the layout object (saved in localStorage); main.js hands it to
// drawFrame. Pure UI: nothing here draws a frame.

import { WIDGETS, ORDER, MIN_SCALE, MAX_SCALE, defaultLayout, normalizeLayout, rectOf, hitTest, clampPosition, snapPosition } from './layout.js?v=20261107x';

const KEY = 'ocr.layout';
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
      <h3>Widgets</h3>
      <p class="note" id="layoutnote" style="margin:0 0 10px"></p>
      <div id="widgetlist" class="widgetlist"></div>
    </div>
    <div class="group" id="widgetprops">
      <h3 id="propstitle">Selected</h3>
      <label class="slider"><span>Size</span><output id="scaleout"></output>
        <input id="widgetscale" type="range" min="${Math.round(MIN_SCALE * 100)}" max="${Math.round(MAX_SCALE * 100)}" step="5" value="100">
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
    $('widgetscale').value = String(Math.round(c.s * 100));
    $('scaleout').textContent = `${Math.round(c.s * 100)}%`;
    $('widgetprops').style.opacity = c.on ? '1' : '0.5';
  };
  const changed = () => { save(layout); sync(); redraw(); };

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
