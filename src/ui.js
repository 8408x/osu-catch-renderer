// Page chrome only: tabs, slider read-outs, message and result trays, file chips, drag and drop,
// remembered tab. It never touches rendering; main.js keeps owning every setting and id.
// Everything is wrapped so a failure here cannot stop the renderer from starting.

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(`ocr.${k}`); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(`ocr.${k}`, v); } catch { /* storage blocked */ } },
};

function initTabs() {
  const tabs = [...document.querySelectorAll('.tab')];
  const select = (tab, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const pane = $(t.getAttribute('aria-controls'));
      if (pane) pane.hidden = !on;
    }
    if (focus) tab.focus();
    store.set('tab', tab.id);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => select(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  select(tabs.find((t) => t.id === store.get('tab')) ?? tabs[0]);
  return select.bind(null);
}

function initReadouts() {
  for (const out of document.querySelectorAll('output[data-for]')) {
    const input = $(out.dataset.for);
    if (!input) continue;
    const show = () => { out.textContent = `${input.value}%`; };
    input.addEventListener('input', show);
    show();
  }
}

/** Remember the plain choices people set once (not files). Applied after main.js has attached its listeners. */
function restoreChoices() {
  for (const id of ['hudstyle', 'cardstyle', 'prevres', 'res', 'fps', 'mbps', 'bgdim', 'volume', 'hitvolume']) {
    const el = $(id);
    if (!el) continue;
    const saved = store.get(`v.${id}`);
    const valid = saved != null && saved !== '' && (!el.options || [...el.options].some((o) => o.value === saved));
    if (valid && el.value !== saved) {
      el.value = saved;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    el.addEventListener('change', () => store.set(`v.${id}`, el.value));
  }
}

function initTrays() {
  const pairs = [['msgbtn', 'msgtray'], ['setbtn', 'settings'], ['helpbtn', 'helptray']];
  const set = (btnId, trayId, open) => {
    const tray = $(trayId), btn = $(btnId);
    tray.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };
  for (const [b, t] of pairs) {
    $(b).addEventListener('click', () => {
      const open = $(t).hidden;
      for (const [b2, t2] of pairs) set(b2, t2, false);
      set(b, t, open);
    });
  }
  for (const x of document.querySelectorAll('[data-close]')) {
    x.addEventListener('click', () => { const p = pairs.find(([, t]) => t === x.dataset.close); if (p) set(p[0], p[1], false); });
  }
  document.addEventListener('pointerdown', (e) => {          // a click anywhere else closes the logs
    if (e.target.closest('.tray, #msgbtn, #setbtn, #helpbtn, .chip')) return;
    for (const [b, t] of pairs) if (!$(t).hidden) set(b, t, false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') for (const [b, t] of pairs) set(b, t, false);
    else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) { e.preventDefault(); $('helpbtn').click(); }
  });
  return set;
}

function initMessages(setTray) {
  const box = $('msgs'), count = $('msgcount'), chips = $('chips');
  const rank = { err: 3, warn: 2, ok: 1, dim: 0 };
  let seenErr = '';
  const update = () => {
    const ps = [...box.children];
    const shown = ps.filter((p) => !p.classList.contains('dim') || ps.length < 4);
    count.textContent = String(ps.filter((p) => p.classList.contains('err') || p.classList.contains('warn')).length || ps.length);
    const worst = ps.reduce((m, p) => Math.max(m, rank[[...p.classList].find((c) => c in rank)] ?? 0), 0);
    count.dataset.tone = worst >= 3 ? 'err' : worst === 2 ? 'warn' : '';
    void shown;

    // The four headline facts become chips under the stage; they open the full list.
    const want = ['Replay', 'Beatmap', 'Music', 'Skin'];
    const items = [];
    for (const key of want) {
      const p = ps.find((x) => x.textContent.startsWith(`${key}:`));
      if (p) items.push({ key, text: p.textContent.slice(key.length + 1).trim(), tone: p.classList.contains('err') ? 'err' : p.classList.contains('warn') ? 'warn' : 'ok' });
    }
    for (const p of ps) if (p.classList.contains('err') && !items.some((i) => i.text === p.textContent)) items.push({ key: 'Problem', text: p.textContent, tone: 'err' });
    chips.replaceChildren(...items.map((i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.tone = i.tone;
      b.title = i.text;
      const dot = document.createElement('i');
      const label = document.createElement('span');
      label.textContent = i.key;
      const val = document.createElement('b');
      val.textContent = i.text.length > 60 ? `${i.text.slice(0, 58)}…` : i.text;
      b.append(dot, label, val);
      b.addEventListener('click', () => setTray('msgbtn', 'msgtray', true));
      return b;
    }));

    // A new error is worth interrupting for; everything else waits behind the Logs button.
    const err = ps.find((p) => p.classList.contains('err'))?.textContent ?? '';
    if (err && err !== seenErr) setTray('msgbtn', 'msgtray', true);
    seenErr = err;
  };
  new MutationObserver(update).observe(box, { childList: true });
  update();
}

function initResults() {
  const box = $('result'), seg = $('viewseg'), count = $('resultcount');
  const view = $('resultview'), stage = document.querySelector('.stagewrap'), bar = $('transport');
  const show = (videos) => {
    view.hidden = !videos;
    stage.hidden = videos;
    bar.hidden = videos;
    $('viewprev').setAttribute('aria-pressed', String(!videos));
    $('viewvids').setAttribute('aria-pressed', String(videos));
  };
  const update = () => {
    const n = box.querySelectorAll('a.dl').length;
    const before = Number(count.textContent) || 0;
    count.textContent = String(n);
    seg.hidden = n === 0;
    if (n === 0) show(false);
    else if (n > before) show(true);                            // a new video: show it in place of the preview
  };
  $('viewprev').addEventListener('click', () => show(false));
  $('viewvids').addEventListener('click', () => show(true));
  new MutationObserver(update).observe(box, { childList: true });
  update();
}

function initStatus() {
  const s = $('status');
  new MutationObserver(() => { s.title = s.textContent; }).observe(s, { childList: true, characterData: true, subtree: true });
}

function initTheme() {
  const sel = $('theme'), root = document.documentElement, media = matchMedia('(prefers-color-scheme: light)');
  let saved = 'auto';
  try { const v = localStorage.getItem('ocr.theme'); if (['dark', 'light', 'sakura'].includes(v)) saved = v; } catch { /* storage blocked */ }
  const apply = () => { root.dataset.theme = saved === 'auto' ? (media.matches ? 'light' : 'dark') : saved; };
  sel.value = saved; apply();
  sel.addEventListener('change', () => {
    saved = sel.value; apply();
    try { saved === 'auto' ? localStorage.removeItem('ocr.theme') : localStorage.setItem('ocr.theme', saved); } catch { /* storage blocked */ }
  });
  media.addEventListener?.('change', () => { if (saved === 'auto') apply(); });
}

/** Settings panel extras: keyboard hints on or off (remembered). */
/** A little burst of fruit from the Render button when a video finishes (skipped with reduced motion). */
function initCelebrate() {
  window.addEventListener('ocr-done', () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce') return;
    const r = document.getElementById('export').getBoundingClientRect(), cols = ['#ff6b8a', '#9b6bd6', '#ffb04a', '#7ccf6a'];
    for (let i = 0; i < 18; i++) {
      const el = document.createElement('i'), a = (-Math.PI / 2) + (Math.random() - 0.5) * 2.4, d = 60 + Math.random() * 110;
      el.className = 'fx-fruit';
      el.style.cssText = `left:${r.left + r.width / 2}px;top:${r.top + r.height / 2}px;--c:${cols[i % 4]};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d + 70}px`;
      document.body.append(el);
      setTimeout(() => el.remove(), 1200);
    }
  });
}

/** Settings: a reduce-motion switch of the site's own (remembered); the device's own setting still applies too. */
function initCalm() {
  const box = $('calm');
  const apply = () => { if (box.checked) document.documentElement.dataset.motion = 'reduce'; else delete document.documentElement.dataset.motion; };
  box.checked = store.get('calm') === '1';
  apply();
  box.addEventListener('change', () => { apply(); store.set('calm', box.checked ? '1' : '0'); });
}

/** Each of the Look, Sound and Render tabs gets a button that puts that tab's own controls back to their starting values. */
function initResets() {
  for (const btn of document.querySelectorAll('[data-reset]')) {
    btn.addEventListener('click', () => {
      if (!confirm('Put every setting in this tab back to its default? Your files are not touched.')) return;
      for (const el of $(btn.dataset.reset).querySelectorAll('input, select, textarea')) {
        if (el.type === 'file' || el.disabled) continue;
        const before = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value;
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = el.defaultChecked;
        else if (el.tagName === 'SELECT') { const d = [...el.options].find((o) => o.defaultSelected) ?? el.options[0]; el.value = d.value; }
        else el.value = el.defaultValue;
        if ((el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value) !== before) {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  }
}

function initHints() {
  const box = $('hints');
  const apply = () => document.body.classList.toggle('nohints', !box.checked);
  box.checked = store.get('hints') !== '0';
  apply();
  box.addEventListener('change', () => { apply(); store.set('hints', box.checked ? '1' : '0'); });
}

function initKeys() {
  const seek = $('seek');
  const typing = (el) => { const tag = el?.tagName; return tag === 'INPUT' && el.type !== 'range' && el.type !== 'checkbox' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON'; };
  const jump = (to) => {
    const t = Math.max(+seek.min, Math.min(+seek.max, to));
    seek.value = String(Math.round(t));
    seek.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const fullscreen = () => {
    const wrap = $('stagewrap');
    if (document.fullscreenElement) document.exitFullscreen?.();
    else wrap.requestFullscreen?.().catch(() => {});
  };
  $('full').addEventListener('click', fullscreen);
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(document.activeElement)) return;
    if (e.code === 'Space' && !e.repeat) {
      const play = $('play');
      if (play && !play.disabled) { e.preventDefault(); play.click(); }
    } else if (e.code === 'KeyF' && !e.repeat) {
      e.preventDefault(); fullscreen();
    } else if (!seek.disabled && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.preventDefault();
      jump(+seek.value + (e.code === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1000 : 5000));
    } else if (!seek.disabled && e.code === 'Home') { e.preventDefault(); jump(+seek.min); }
    else if (!seek.disabled && e.code === 'End') { e.preventDefault(); jump(+seek.max); }
  });
  // the how-to card over the empty stage goes away once anything is loaded
  const guide = $('guide'), chips = $('chips');
  const sync = () => { guide.hidden = chips.children.length > 0; };
  new MutationObserver(sync).observe(chips, { childList: true });
  sync();
}

/** Drop files anywhere: each goes to the picker that understands it. */
function initDrop() {
  const veil = $('dropveil');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  const give = (input, files) => {
    if (!files.length || input.disabled) return;
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(f);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; veil.classList.add('on'); document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) { veil.classList.remove('on'); document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    veil.classList.remove('on'); document.body.classList.remove('dragging');
    const by = { osr: [], osu: [], osk: [], img: [], map: [] };
    for (const f of e.dataTransfer.files) {
      const n = f.name.toLowerCase();
      if (n.endsWith('.osr')) by.osr.push(f);
      else if (n.endsWith('.osu')) by.osu.push(f);
      else if (n.endsWith('.osk')) by.osk.push(f);
      else if (/\.(png|jpe?g)$/.test(n)) by.img.push(f);
      else by.map.push(f);                                     // .osz, .zip and songs
    }
    give($('osr'), by.osr);
    give($('osu'), by.osu.slice(0, 1));
    give($('skin'), by.osk.slice(0, 1));
    give($('bgfile'), by.img.slice(0, 1));
    give($('audio'), by.map.slice(0, 1));
    if (by.osr.length || by.osu.length || by.map.length) document.getElementById('tab-files')?.click();
    if (by.osu.length || by.map.length) { const d = $('audio')?.closest('details'); if (d) d.open = true; }   // so the files you dropped are visible
  });
}

try {
  const run = () => {
    initTabs();
    initReadouts();
    const setTray = initTrays();
    initMessages(setTray);
    initResults();
    initStatus();
    initKeys();
    initTheme();
    initHints();
    initCalm();
    initResets();
    initDrop();
    initCelebrate();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
  if (document.readyState === 'complete') restoreChoices(); else window.addEventListener('load', restoreChoices);
} catch (err) {
  console.warn('UI helpers failed to start:', err);
}
