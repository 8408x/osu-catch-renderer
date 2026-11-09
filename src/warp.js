// Slow motion around misses. A warp maps the normal video timeline (u, ms) onto a longer one (v, ms): around each
// miss the video runs at `speed` times normal, everywhere else at 1x. Used by the exporter for frames and audio.

export function buildWarp(missesU, totalU, { speed = 0.35, before = 220, after = 380 } = {}) {
  const wins = [];
  for (const m of [...missesU].sort((a, b) => a - b)) {
    const a = Math.max(0, m - before), b = Math.min(totalU, m + after);
    if (b <= a) continue;
    const last = wins[wins.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b); else wins.push([a, b]);
  }
  if (!wins.length) return null;
  const segs = [];
  let u = 0, v = 0;
  const push = (u0, u1, sp) => { if (u1 > u0) { segs.push({ u0, u1, v0: v, speed: sp }); v += (u1 - u0) / sp; } };
  for (const [a, b] of wins) { push(u, a, 1); push(a, b, speed); u = b; }
  push(u, totalU, 1);
  const totalV = v;
  return {
    segs, totalU, totalV,
    /** Video time (ms) -> normal timeline (ms). */
    vToU(vv) {
      vv = Math.min(Math.max(0, vv), totalV);
      let lo = 0, hi = segs.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segs[mid].v0 <= vv) lo = mid; else hi = mid - 1; }
      const s = segs[lo];
      return Math.min(s.u1, s.u0 + (vv - s.v0) * s.speed);
    },
  };
}
