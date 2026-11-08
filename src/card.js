// The title cards that can open and close an exported video: who played what, and how it went.
// Pure drawing; encode.js asks for one frame at a time and main.js hands it the scene.

import { getAvatar, getProfile } from './avatar.js?v=20261109n';
import { styleData } from './styles.js?v=20261109n';

const SANS = '"Exo 2", "Torus", system-ui, "Segoe UI", sans-serif';
const FONT = (w, px) => `${w} ${px}px ${SANS}`;

const accuracy = (p) => { const n = (p?.n300 ?? 0) + (p?.n100 ?? 0) + (p?.n50 ?? 0), tot = n + (p?.nKatu ?? 0) + (p?.nMiss ?? 0); return tot ? (n / tot) * 100 : 0; };
const commas = (n) => Math.round(n).toLocaleString('en-US');
const finalPpCache = new WeakMap();
const finalPp = (scene) => {
  if (!finalPpCache.has(scene)) { let v = 0; try { v = styleData(scene, scene.endTime, null, null).pp || 0; } catch { /* no pp for this map */ } finalPpCache.set(scene, v); }
  return finalPpCache.get(scene);
};

/** A fade in over the first 15% and a fade out over the last 15% of the card. */
export const cardFade = (p) => Math.min(1, p / 0.15, (1 - p) / 0.15);

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{kind: 'intro'|'outro', scene: object, bg: ImageBitmap|HTMLImageElement|null, progress: number}} o progress 0..1 through the card
 */
export function drawCard(ctx, W, H, { kind, scene, bg, progress }) {
  const u = H / 1080, cx = W / 2, m = scene.meta ?? {}, pl = scene.play ?? {}, pr = getProfile() ?? {}, img = getAvatar();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = Math.max(0, Math.min(1, cardFade(progress)));

  if (bg) {                                                       // the map's background, dimmed
    const bw = bg.width || bg.naturalWidth, bh = bg.height || bg.naturalHeight, k = Math.max(W / bw, H / bh);
    ctx.drawImage(bg, cx - (bw * k) / 2, H / 2 - (bh * k) / 2, bw * k, bh * k);
  }
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(5,6,10,0.72)'); g.addColorStop(1, 'rgba(5,6,10,0.9)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  const text = (s, y, px, weight, fill, maxW = W * 0.86) => {
    ctx.font = FONT(weight, px * u); ctx.textAlign = 'center'; ctx.fillStyle = fill;
    let t = String(s); while (t.length > 1 && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
    ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 8 * u;
    ctx.fillText(t === String(s) ? t : `${t}…`, cx, y * u); ctx.shadowBlur = 0;
  };

  const r = (kind === 'intro' ? 120 : 84) * u, ay = (kind === 'intro' ? 330 : 230) * u;   // the player's picture
  ctx.save(); ctx.beginPath(); ctx.arc(cx, ay, r, 0, Math.PI * 2); ctx.clip();
  if (img) { const k = Math.max((2 * r) / img.naturalWidth, (2 * r) / img.naturalHeight); ctx.drawImage(img, cx - (img.naturalWidth * k) / 2, ay - (img.naturalHeight * k) / 2, img.naturalWidth * k, img.naturalHeight * k); }
  else { ctx.fillStyle = '#ff6b8a'; ctx.fillRect(cx - r, ay - r, 2 * r, 2 * r); ctx.font = FONT(800, r); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText((scene.player || '?').slice(0, 1).toUpperCase(), cx, ay + r * 0.35); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 4 * u; ctx.beginPath(); ctx.arc(cx, ay, r, 0, Math.PI * 2); ctx.stroke();

  const ny = ay / u + (kind === 'intro' ? 215 : 160);
  text(scene.player || 'Player', ny, kind === 'intro' ? 92 : 70, 800, '#fff');
  const sub = [pr.country_code, pr.rank ? `#${commas(pr.rank)}` : ''].filter(Boolean).join('  ·  ');
  if (sub) text(sub, ny + 52, 38, 600, 'rgba(255,255,255,0.7)');

  if (kind === 'intro') {
    text(m.title || '', ny + 190, 62, 700, '#fff');
    text(m.artistUnicode || m.artist || '', ny + 245, 38, 500, 'rgba(255,255,255,0.75)');
    text(`[${m.version || ''}]  ·  mapped by ${m.creator || ''}`, ny + 300, 34, 500, 'rgba(255,255,255,0.6)');
  } else {
    text(`${m.artistUnicode || m.artist || ''} - ${m.title || ''} [${m.version || ''}]`, ny + 110, 34, 600, 'rgba(255,255,255,0.75)');
    const stats = [['Accuracy', `${accuracy(pl).toFixed(2)}%`], ['Max combo', `${commas(pl.maxCombo ?? 0)}x`], ['Score', commas(pl.score ?? 0)]];
    const pp = finalPp(scene); if (pp) stats.push(['pp', commas(pp)]);
    const bw = 300 * u, gap = 24 * u, total = stats.length * bw + (stats.length - 1) * gap, x0 = cx - total / 2, by = (ny + 175) * u;
    stats.forEach(([label, val], i) => {
      const x = x0 + i * (bw + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.roundRect(x, by, bw, 170 * u, 22 * u); ctx.fill();
      ctx.textAlign = 'center'; ctx.shadowBlur = 0;
      ctx.font = FONT(500, 30 * u); ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillText(label, x + bw / 2, by + 52 * u);
      ctx.font = FONT(800, 62 * u); ctx.fillStyle = '#fff'; ctx.fillText(val, x + bw / 2, by + 125 * u);
    });
    text(`${commas(pl.n100 ?? 0)} droplets (x100)   ·   ${commas(pl.n50 ?? 0)} small (x50)   ·   ${commas(pl.nMiss ?? 0)} misses`, ny + 400, 34, 500, 'rgba(255,255,255,0.7)');
  }
  ctx.globalAlpha = 1;
}
