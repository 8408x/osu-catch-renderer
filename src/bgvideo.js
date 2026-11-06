// Beatmap background video: a muted <video> element that the renderer paints behind the playfield instead of the still picture.
// The preview lets it play along with the music clock; the exporter seeks it to the exact time of every frame.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class BackgroundVideo {
  /** @param {HTMLVideoElement} el @param {number} offsetMs beatmap time at which the video starts */
  constructor(el, url, offsetMs) {
    this.el = el;
    this.url = url;
    this.offset = offsetMs;
    this.duration = el.duration;
    this.want = 0;                                       // the time (s) the element was last asked to show, so a frame that lands slightly earlier is not re-requested
    this.onFrame = null;                                 // called after a seek finished, so the preview can redraw
    el.addEventListener('seeked', () => this.onFrame?.());
  }

  /** Load a video file; resolves null when this browser cannot play it (old avi / flv sets, missing codec). */
  static async create(bytes, name, offsetMs = 0, { timeoutMs = 15000 } = {}) {
    if (typeof document === 'undefined') return null;
    const type = /\.webm$/i.test(name) ? 'video/webm' : /\.ogv$/i.test(name) ? 'video/ogg' : /\.(mp4|m4v|mov)$/i.test(name) ? 'video/mp4' : '';
    const url = URL.createObjectURL(new Blob([bytes], type ? { type } : {}));
    const el = document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';
    el.src = url;
    const ok = await new Promise((resolve) => {
      const to = setTimeout(() => resolve(false), timeoutMs);
      el.addEventListener('loadeddata', () => { clearTimeout(to); resolve(el.videoWidth > 0 && Number.isFinite(el.duration)); }, { once: true });
      el.addEventListener('error', () => { clearTimeout(to); resolve(false); }, { once: true });
    });
    if (!ok) { URL.revokeObjectURL(url); return null; }
    return new BackgroundVideo(el, url, offsetMs);
  }

  /** Is the video on screen at beatmap time t? (It does not show before it starts or after it ends.) */
  active(t) { return t >= this.offset && t < this.offset + this.duration * 1000; }

  /** Seek to the frame for beatmap time t and wait until it is decoded. Used by the exporter. */
  seek(t) {
    const { el } = this;
    const target = clamp((t - this.offset) / 1000, 0, Math.max(0, this.duration - 0.001));
    if (Math.abs(this.want - target) < 0.001 && !el.seeking && el.readyState >= 2) return Promise.resolve();
    this.want = target;
    return new Promise((resolve) => {
      const done = () => { clearTimeout(to); el.removeEventListener('seeked', done); resolve(); };
      const to = setTimeout(done, 5000);
      el.addEventListener('seeked', done);
      el.currentTime = target;
    });
  }

  /**
   * Keep the element in step with the preview. While playing it runs at the map's rate and is only re-synced when it
   * drifts; while paused or scrubbing it sits on the exact frame. Returns whether a frame can be drawn right now.
   */
  sync(t, playing, rate = 1) {
    const { el } = this;
    if (!this.active(t)) { if (!el.paused) el.pause(); return false; }
    const target = clamp((t - this.offset) / 1000, 0, Math.max(0, this.duration - 0.001));
    if (playing) {
      el.playbackRate = clamp(rate, 0.0625, 16);
      if (el.paused || Math.abs(el.currentTime - target) > 0.3) {
        this.want = target;
        el.currentTime = target;
        if (el.paused) el.play().catch(() => {});
      }
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(this.want - target) > 0.001) { this.want = target; el.currentTime = target; }
    }
    return el.readyState >= 2 && !el.seeking;
  }

  dispose() {
    this.onFrame = null;
    try { this.el.pause(); } catch { /* ignore */ }
    this.el.removeAttribute('src');
    this.el.load?.();
    URL.revokeObjectURL(this.url);
  }
}
