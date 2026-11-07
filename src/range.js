// The part of a map to render: "m:ss" text boxes -> a time range in beatmap time.

/** "1:05", "1:05.5" or "65" (seconds into the map, like the preview clock) -> ms; null when empty, NaN when invalid. */
export function parseClock(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? ((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])) * 1000 : NaN;
}

/**
 * @param {string} fromText @param {string} toText the two text boxes
 * @param {{startTime:number, endTime:number}} sc the scene
 * @returns {{from:number, to:number, whole:boolean} | {error:string}} in beatmap time, clamped to the map
 */
export function resolveRange(fromText, toText, sc) {
  const a = parseClock(fromText), b = parseClock(toText);
  if (Number.isNaN(a) || Number.isNaN(b)) return { error: 'Write the range as m:ss, for example 1:05 or 1:05.5.' };
  const from = a == null ? sc.startTime : Math.max(sc.startTime, sc.startTime + a);
  const to = b == null ? sc.endTime : Math.min(sc.endTime, sc.startTime + b);
  if (to - from < 500) return { error: 'The range must be at least half a second long and inside the map.' };
  return { from, to, whole: from === sc.startTime && to === sc.endTime };
}
