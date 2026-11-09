// The count-up animation the community overlays use for their numbers (CountUp.js, easeOutExpo, about half a second):
// when the target value changes, the shown number rolls from where it is to the new one. A video frame has no memory,
// so the animation is replayed over the last second of beatmap time to find what the overlay would show at time t.

let on = false;                                  // experimental: off until the Settings switch turns it on
export const setSmoothNumbers = (v) => { on = !!v; };
export const smoothNumbers = () => on;

const easeOutExpo = (x) => (x >= 1 ? 1 : ((1 - 2 ** (-10 * x)) * 1024) / 1023);

/**
 * @param {(t:number)=>number} rawAt the value the overlay is told at time t
 * @param {number} t beatmap time (ms)
 * @param {number} [dur] animation length (ms), 500 in the overlays' own CountUp calls
 */
export function countUp(rawAt, t, dur = 500, look = 1000, step = 20) {
  if (!on) return rawAt(t);
  let to = rawAt(t - look), from = to, start = t - look;
  const shown = (at) => from + (to - from) * easeOutExpo((at - start) / dur);
  for (let at = t - look + step; at <= t + 1e-6; at += step) {
    const r = rawAt(at);
    if (r !== to) { from = shown(at); to = r; start = at; }
  }
  return shown(t);
}
