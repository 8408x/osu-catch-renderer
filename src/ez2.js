// EZ2CATCH: a hidden rhythm game. osu!catch's roots are the arcade game EZ2DJ's "EZ2CATCH" mode, so typing the name here
// goes the other way round: a five-key-and-turntable falling-note game. The beat and the chart are made up for this site.

const BPM = 140, BEAT = 60 / BPM, MEASURES = 20, LEAD = 2.4, FALL = 1.3;
const KEYS = ['ShiftLeft|ShiftRight|Space', 'KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK'];   // lane 0 is the turntable
const LABELS = ['SPACE', 'S', 'D', 'F', 'J', 'K'];
const WIN = { kool: 0.045, cool: 0.09, good: 0.135 };
const POINTS = { KOOL: 1000, COOL: 700, GOOD: 300 };
const COLORS = ['#ff4d8d', '#58c8ff', '#9d7bff', '#58c8ff', '#9d7bff', '#58c8ff'];

/** The chart: a repeatable pattern that gets denser, a turntable note every other measure, chords in the second half. */
export function makeChart() {
  let seed = 2026;
  const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  const notes = [];
  let last = -1;
  for (let m = 0; m < MEASURES; m++) {
    const dens = 0.3 + 0.42 * (m / (MEASURES - 1));
    for (let s = 0; s < 8; s++) {
      const t = (m * 4 + s / 2) * BEAT;
      if (s === 0 && m % 2 === 0) { notes.push({ t, lane: 0 }); continue; }
      if (m === 0 && s < 2) continue;
      if (rnd() < dens) {
        let lane;
        do lane = 1 + Math.floor(rnd() * 5); while (lane === last && rnd() < 0.85);
        last = lane;
        notes.push({ t, lane });
        if (m >= MEASURES / 2 && rnd() < 0.18) { const l2 = 1 + ((lane + 2 + Math.floor(rnd() * 3)) % 5); if (l2 !== lane) notes.push({ t, lane: l2 }); }
      }
    }
  }
  return notes.sort((a, b) => a.t - b.t || a.lane - b.lane).map((n) => ({ ...n, state: 0 }));   // state 0 waiting, 1 hit, 2 missed
}

export function openEz2() {
  if (document.getElementById('ez2')) return;
  const root = document.createElement('div');
  root.id = 'ez2'; root.setAttribute('role', 'dialog'); root.setAttribute('aria-label', 'EZ2CATCH mini game');
  root.style.cssText = 'position:fixed;inset:0;z-index:100;background:#05060f;touch-action:none;user-select:none;-webkit-user-select:none';
  const cv = document.createElement('canvas');
  cv.style.cssText = 'width:100%;height:100%;display:block';
  const close = document.createElement('button');
  close.type = 'button'; close.textContent = 'Close (Esc)';
  close.style.cssText = 'position:absolute;top:12px;right:12px;z-index:2';
  root.append(cv, close);
  document.body.append(root);
  const g = cv.getContext('2d');
  const lastFocus = document.activeElement;

  let W = 0, H = 0, dpr = 1;
  const fit = () => { dpr = Math.min(2, window.devicePixelRatio || 1); W = root.clientWidth; H = root.clientHeight; cv.width = W * dpr; cv.height = H * dpr; };
  fit();
  window.addEventListener('resize', fit);

  let ac = null, t0 = 0, notes = makeChart(), mode = 'title', raf = 0;
  let score = 0, combo = 0, maxCombo = 0, gauge = 50, counts = { KOOL: 0, COOL: 0, GOOD: 0, MISS: 0 };
  const flash = new Array(6).fill(-9), pop = { text: '', at: -9, lane: 0 }, held = new Set();
  const total = notes.length;
  const endAt = () => notes[notes.length - 1].t + 2.2;
  let frozen = null;                                         // the clock stops where it was when the audio is closed
  const now = () => (ac ? ac.currentTime - t0 : (frozen ?? -LEAD));

  // ---- sound: a little synthesized loop (kick, snare, hats, bass) scheduled up front on the audio clock ----
  const noiseBuf = () => { const b = ac.createBuffer(1, ac.sampleRate * 0.3, ac.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
  function schedule() {
    const out = ac.createGain(); out.gain.value = 0.55; out.connect(ac.destination);
    const nb = noiseBuf();
    const env = (node, at, peak, dur) => { const v = ac.createGain(); v.gain.setValueAtTime(0.0001, at); v.gain.exponentialRampToValueAtTime(peak, at + 0.005); v.gain.exponentialRampToValueAtTime(0.0001, at + dur); node.connect(v); v.connect(out); };
    const noise = (at, peak, dur, hp) => { const s = ac.createBufferSource(); s.buffer = nb; const f = ac.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; s.connect(f); env(f, at, peak, dur); s.start(at); s.stop(at + dur + 0.05); };
    const tone = (at, freq, dur, type, peak, lp) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = freq; let n = o; if (lp) { const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); n = f; } env(n, at, peak, dur); o.start(at); o.stop(at + dur + 0.05); };
    const roots = [220, 174.61, 261.63, 196];                  // A, F, C, G
    for (let m = 0; m < MEASURES + 1; m++) {
      for (let s = 0; s < 8; s++) {
        const at = t0 + (m * 4 + s / 2) * BEAT, beat = s / 2;
        noise(at, s % 2 ? 0.1 : 0.16, 0.05, 7000);
        if (s % 2 === 0 && (beat === 0 || beat === 2)) { const o = ac.createOscillator(); o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.14); env(o, at, 0.9, 0.2); o.start(at); o.stop(at + 0.25); }
        if (beat === 1 || beat === 3) if (s % 2 === 0) noise(at, 0.5, 0.16, 1800);
        const r = roots[Math.floor(m / 2) % 4] / 2;
        tone(at, s % 4 === 3 ? r * 2 : r, BEAT / 2.2, 'sawtooth', 0.22, 700);
        if (m >= 4 && s % 2 === 0) tone(at, roots[Math.floor(m / 2) % 4] * (s % 4 === 0 ? 2 : 3), BEAT / 2, 'square', 0.05, 2400);
      }
    }
    return out;
  }
  function tick(freq, vol = 0.16) {
    if (!ac) return;
    const o = ac.createOscillator(), v = ac.createGain();
    o.type = 'triangle'; o.frequency.value = freq;
    v.gain.setValueAtTime(vol, ac.currentTime); v.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.09);
    o.connect(v); v.connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.1);
  }

  function start() {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    ac.resume?.(); frozen = null;
    notes = makeChart(); score = 0; combo = 0; maxCombo = 0; gauge = 50; counts = { KOOL: 0, COOL: 0, GOOD: 0, MISS: 0 };
    t0 = ac.currentTime + LEAD;
    schedule();
    mode = 'play';
  }
  function stopAudio() { if (ac) frozen = ac.currentTime - t0; try { ac?.close(); } catch { /* already closed */ } ac = null; }

  // ---- input ----
  const laneOfCode = (code) => KEYS.findIndex((k) => k.split('|').includes(code));
  function judge(lane) {
    flash[lane] = now();
    const t = now();
    let best = null;
    for (const n of notes) if (n.lane === lane && n.state === 0 && Math.abs(n.t - t) <= WIN.good && (!best || Math.abs(n.t - t) < Math.abs(best.t - t))) best = n;
    if (!best) { tick(200, 0.05); return; }
    const d = Math.abs(best.t - t), name = d <= WIN.kool ? 'KOOL' : d <= WIN.cool ? 'COOL' : 'GOOD';
    best.state = 1; counts[name]++; combo++; maxCombo = Math.max(maxCombo, combo);
    score += Math.round(POINTS[name] * (1 + Math.min(combo, 60) / 60));
    gauge = Math.min(100, gauge + (name === 'GOOD' ? 0.4 : 1.2));
    pop.text = name; pop.at = t; pop.lane = lane;
    tick(lane === 0 ? 330 : 660 + lane * 70);
  }
  const keydown = (e) => {
    if (e.code === 'Escape') { e.preventDefault(); e.stopPropagation(); shut(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (mode === 'title' || mode === 'results') {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); e.stopPropagation(); if (mode === 'results') stopAudio(); start(); }
      return;
    }
    const lane = laneOfCode(e.code);
    if (lane < 0) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat || held.has(e.code)) return;
    held.add(e.code); judge(lane);
  };
  const keyup = (e) => held.delete(e.code);
  const layout = () => {
    const tw = Math.min(W * 0.94, 700), unit = tw / 6.5, x0 = (W - tw) / 2;
    const xs = [x0, x0 + unit * 1.5]; for (let i = 2; i <= 5; i++) xs.push(xs[i - 1] + unit);
    return { unit, x0, tw, xs, w: [unit * 1.5, unit, unit, unit, unit, unit], line: H * 0.8 };
  };
  const pointer = (e) => {
    if (e.target === close) return;
    if (mode === 'title' || mode === 'results') { if (mode === 'results') stopAudio(); start(); return; }
    const L = layout(), r = cv.getBoundingClientRect(), x = e.clientX - r.left;
    for (let i = 0; i < 6; i++) if (x >= L.xs[i] && x < L.xs[i] + L.w[i]) { judge(i); break; }
  };
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('keyup', keyup, true);
  cv.addEventListener('pointerdown', pointer);
  close.addEventListener('click', () => shut());

  function shut() {
    cancelAnimationFrame(raf); stopAudio();
    window.removeEventListener('keydown', keydown, true); window.removeEventListener('keyup', keyup, true); window.removeEventListener('resize', fit);
    root.remove(); delete window.__ez2;
    try { lastFocus?.focus?.(); } catch { /* element gone */ }
  }

  // ---- drawing ----
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };
  function frame() {
    raf = requestAnimationFrame(frame);
    const t = now(), L = layout();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#05060f'); bg.addColorStop(1, '#1a0b2e');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    if (mode === 'title') {
      g.fillStyle = '#ff4d8d'; g.font = `800 ${Math.min(64, W / 8)}px system-ui, sans-serif`; g.fillText('EZ2CATCH', W / 2, H * 0.34);
      g.fillStyle = '#9fb0d9'; g.font = `500 ${Math.min(18, W / 22)}px system-ui, sans-serif`;
      g.fillText('catch started on the arcade. Now it goes back.', W / 2, H * 0.34 + 54);
      g.fillText('Turntable: Space or Shift     Keys: S  D  F  J  K     (or tap the lanes)', W / 2, H * 0.34 + 96);
      g.fillStyle = '#fff'; g.font = `700 ${Math.min(22, W / 18)}px system-ui, sans-serif`; g.fillText(Math.floor(performance.now() / 500) % 2 ? 'Press Space or tap to start' : '', W / 2, H * 0.34 + 150);
      return;
    }
    // lanes
    for (let i = 0; i < 6; i++) {
      g.fillStyle = i % 2 ? 'rgba(88,200,255,.06)' : 'rgba(157,123,255,.09)'; g.fillRect(L.xs[i], 0, L.w[i], L.line + 70);
      g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1; g.strokeRect(L.xs[i] + 0.5, 0, L.w[i], L.line + 70);
      const f = Math.max(0, 1 - (t - flash[i]) / 0.18);
      if (f > 0) { const gr = g.createLinearGradient(0, L.line - 260, 0, L.line); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(1, `rgba(255,255,255,${0.35 * f})`); g.fillStyle = gr; g.fillRect(L.xs[i], L.line - 260, L.w[i], 260); }
      g.fillStyle = f > 0 ? '#fff' : '#7f8bb0'; g.font = `700 ${Math.min(18, L.unit * 0.3)}px system-ui, sans-serif`; g.fillText(LABELS[i], L.xs[i] + L.w[i] / 2, L.line + 38);
    }
    g.fillStyle = '#ffffffcc'; g.fillRect(L.x0, L.line - 2, L.tw, 4);
    // notes
    for (const n of notes) {
      if (n.state === 1) continue;
      const y = L.line - ((n.t - t) / FALL) * L.line;
      if (y < -30 || y > H + 30) continue;
      if (n.state === 0 && t - n.t > WIN.good) { n.state = 2; counts.MISS++; combo = 0; gauge = Math.max(0, gauge - 3); pop.text = 'MISS'; pop.at = t; pop.lane = n.lane; }
      const nh = n.lane === 0 ? 16 : 20;
      g.globalAlpha = n.state === 2 ? 0.3 : 1;
      g.fillStyle = COLORS[n.lane]; g.shadowColor = COLORS[n.lane]; g.shadowBlur = 14;
      rr(L.xs[n.lane] + 5, y - nh / 2, L.w[n.lane] - 10, nh, 6); g.fill();
      g.shadowBlur = 0; g.globalAlpha = 1;
    }
    // judgement + combo + score + gauge
    const age = t - pop.at;
    if (age < 0.5 && pop.text) {
      g.fillStyle = { KOOL: '#58c8ff', COOL: '#7ee0a0', GOOD: '#ffcf66', MISS: '#ff7b8f' }[pop.text]; g.font = `800 ${Math.min(36, W / 14) * (1 + (0.5 - age) * 0.4)}px system-ui, sans-serif`;
      g.globalAlpha = Math.min(1, (0.5 - age) * 3); g.fillText(pop.text, W / 2, L.line - 130); g.globalAlpha = 1;
    }
    if (combo > 1) { g.fillStyle = '#fff'; g.font = `800 ${Math.min(54, W / 9)}px ui-monospace, monospace`; g.fillText(String(combo), W / 2, L.line - 200); g.fillStyle = '#9fb0d9'; g.font = `600 ${Math.min(14, W / 26)}px system-ui, sans-serif`; g.fillText('COMBO', W / 2, L.line - 168); }
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `700 ${Math.min(22, W / 18)}px ui-monospace, monospace`; g.fillText(String(score).padStart(8, '0'), 16, 28);
    g.fillStyle = '#ffffff22'; g.fillRect(16, 48, 150, 8); g.fillStyle = gauge < 25 ? '#ff7b8f' : '#7ee0a0'; g.fillRect(16, 48, 150 * gauge / 100, 8);
    g.textAlign = 'center';
    if (t < 0 && mode === 'play') { g.fillStyle = '#fff'; g.font = `800 ${Math.min(80, W / 6)}px system-ui, sans-serif`; g.fillText(String(Math.ceil(-t)), W / 2, H * 0.4); }
    if (mode === 'play' && t > endAt()) { mode = 'results'; stopAudio(); }
    if (mode === 'results') {
      g.fillStyle = 'rgba(5,6,15,.82)'; g.fillRect(0, 0, W, H);
      const acc = (counts.KOOL + counts.COOL * 0.8 + counts.GOOD * 0.45) / total, rank = acc > 0.95 ? 'S' : acc > 0.88 ? 'A' : acc > 0.75 ? 'B' : acc > 0.6 ? 'C' : 'D';
      g.fillStyle = '#ff4d8d'; g.font = `800 ${Math.min(30, W / 14)}px system-ui, sans-serif`; g.fillText(gauge > 0 ? 'STAGE CLEAR' : 'STAGE FAILED', W / 2, H * 0.18);
      g.fillStyle = '#fff'; g.font = `800 ${Math.min(120, W / 4)}px system-ui, sans-serif`; g.fillText(rank, W / 2, H * 0.34);
      g.fillStyle = '#cfd8f5'; g.font = `600 ${Math.min(20, W / 20)}px ui-monospace, monospace`;
      const lines = [`SCORE ${score}`, `KOOL ${counts.KOOL}   COOL ${counts.COOL}   GOOD ${counts.GOOD}   MISS ${counts.MISS}`, `MAX COMBO ${maxCombo}`, `ACCURACY ${(acc * 100).toFixed(1)}%`];
      lines.forEach((s, i) => g.fillText(s, W / 2, H * 0.5 + i * 34));
      g.fillStyle = '#9fb0d9'; g.font = `500 ${Math.min(17, W / 24)}px system-ui, sans-serif`; g.fillText('Space or tap: play again     Esc: close', W / 2, H * 0.5 + 190);
    }
  }
  frame();
  window.__ez2 = { get notes() { return notes; }, now, judge, start, get mode() { return mode; }, get counts() { return counts; }, get score() { return score; } };
}

/** Typing the word anywhere (outside a text box) opens the game. */
export function watchForEz2() {
  const word = 'EZ2CATCH';
  let at = 0;
  document.addEventListener('keydown', (e) => {
    if (document.getElementById('ez2') || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) { at = 0; return; }
    if (e.key.length !== 1) return;
    const k = e.key.toUpperCase();
    at = k === word[at] ? at + 1 : (k === word[0] ? 1 : 0);
    if (at === word.length) { at = 0; openEz2(); }
  });
}
