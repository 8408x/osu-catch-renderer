// Mod display for the in-game HUDs: the mods of a replay as short codes, drawn as the skin's own `selection-mod-*`
// icons (osu!stable) or as small rounded badges (osu!lazer HUD, and stable when the skin has no icons).

const LIST = [
  [1, 'NF', 'nofail', 'r'], [2, 'EZ', 'easy', 'r'], [8, 'HD', 'hidden', 'i'], [16, 'HR', 'hardrock', 'i'], [32, 'SD', 'suddendeath', 'i'],
  [64, 'DT', 'doubletime', 'i'], [128, 'RX', 'relax', 'a'], [256, 'HT', 'halftime', 'r'], [1024, 'FL', 'flashlight', 'i'],
  [4096, 'SO', 'spunout', 'a'], [8192, 'AP', 'relax2', 'a'], [16384, 'PF', 'perfect', 'i'],
];
const COLOUR = { i: '#ff6666', r: '#b2ff66', a: '#66ccff' };   // lazer: difficulty increase / reduction / automation

/** @returns {{code:string, skinName:string, kind:string}[]} NC replaces DT, PF replaces SD, like the game's own display */
export function modEntries(mods) {
  let out = LIST.filter(([bit]) => mods & bit).map(([, code, skinName, kind]) => ({ code, skinName: `selection-mod-${skinName}`, kind }));
  if (mods & 512) out = out.filter((e) => e.code !== 'DT').concat([{ code: 'NC', skinName: 'selection-mod-nightcore', kind: 'i' }]);
  if (mods & 16384) out = out.filter((e) => e.code !== 'SD');
  return out;
}

/** Names of the skin images the mods may use (for preloading). */
export const MOD_SKIN_NAMES = [...LIST.map(([, , n]) => `selection-mod-${n}`), 'selection-mod-nightcore'];

/** Rounded text badges, right-aligned at `right`, top at `top`, `h` tall; returns nothing. */
export function drawModBadges(ctx, mods, right, top, h, font = '700 {px}px "Segoe UI", system-ui, sans-serif') {
  const list = modEntries(mods);
  if (!list.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = font.replace('{px}', String(Math.round(h * 0.52)));
  let x = right;
  for (let i = list.length - 1; i >= 0; i--) {
    const w = h * 1.45;
    x -= w;
    ctx.fillStyle = 'rgba(14,16,24,0.82)';
    ctx.beginPath(); ctx.roundRect?.(x, top, w, h, h * 0.28); if (!ctx.roundRect) ctx.rect(x, top, w, h); ctx.fill();
    ctx.lineWidth = Math.max(1, h * 0.07);
    ctx.strokeStyle = COLOUR[list[i].kind];
    ctx.stroke();
    ctx.fillStyle = COLOUR[list[i].kind];
    ctx.fillText(list[i].code, x + w / 2, top + h / 2 + h * 0.03);
    x -= h * 0.18;
  }
  ctx.restore();
}

/** The skin's own mod icons, overlapping leftwards from `right` like stable. Returns false when the skin has none of them. */
export function drawModIcons(ctx, skin, mods, right, top, h) {
  const list = modEntries(mods);
  const tex = list.map((e) => skin.get(e.skinName));
  if (!list.length || tex.some((t) => !t)) return false;
  let x = right;
  for (let i = list.length - 1; i >= 0; i--) {
    const k = h / tex[i].h, w = tex[i].w * k;
    x -= w;
    ctx.drawImage(tex[i].img, x, top, w, h);
    x += w * 0.38;                                         // icons overlap each other, the nearest on top
  }
  return true;
}
