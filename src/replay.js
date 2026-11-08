// Catcher position over time, linearly interpolated between replay frames
// (osu!lazer does the same in CatchFramedReplayInputHandler).

export class ReplayTrack {
  /** @param {{t:number,x:number,dash:boolean}[]} frames sorted by time */
  constructor(frames) {
    // Some replays hold two frames with the same time. The game acts on the first one, so the
    // later duplicate is dropped (otherwise the catcher jumps away from a fruit that was caught).
    frames = frames.filter((f, i) => i === 0 || f.t !== frames[i - 1].t);
    this.frames = frames;
    // which way the catcher faces after reaching each frame (osu!lazer: last direction it moved in)
    this.dir = [];
    let d = 1;
    for (let i = 0; i < frames.length; i++) {
      if (i > 0) {
        const dx = frames[i].x - frames[i - 1].x;
        if (dx > 0) d = 1; else if (dx < 0) d = -1;
      }
      this.dir.push(d);
    }
  }

  /** 1 = facing right, -1 = facing left. */
  facingAt(t) {
    const f = this.frames;
    const i = this.#index(t);
    if (i < 0) return 1;
    if (i < f.length - 1) {
      const dx = f[i + 1].x - f[i].x;
      if (dx > 0) return 1;
      if (dx < 0) return -1;
    }
    return this.dir[i];
  }

  #index(t) {
    // index of the last frame with frame.t <= t (or -1)
    const f = this.frames;
    let lo = -1, hi = f.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) lo = mid; else hi = mid;
    }
    return lo;
  }

  xAt(t) {
    const f = this.frames;
    const n = f.length;
    if (!n) return 256;
    const i = this.#index(t);
    if (i < 0) return f[0].x;
    if (i >= n - 1) return f[n - 1].x;
    const a = f[i], b = f[i + 1];
    const span = b.t - a.t;
    return span > 0 ? a.x + ((b.x - a.x) * (t - a.t)) / span : b.x;
  }

  dashAt(t) {
    const i = this.#index(t);
    return i >= 0 ? this.frames[i].dash : false;
  }
}
