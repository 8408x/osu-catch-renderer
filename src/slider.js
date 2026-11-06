// Slider path geometry: turns control points into a polyline and answers
// "where is the slider at progress p (0..1) along its length?".
// Curve types follow the .osu format: B(ezier), L(inear), P(erfect circle), C(atmull).

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function bezierAt(pts, t) {
  const n = pts.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) { xs[i] = pts[i].x; ys[i] = pts[i].y; }
  for (let k = n - 1; k > 0; k--) {
    for (let i = 0; i < k; i++) {
      xs[i] += (xs[i + 1] - xs[i]) * t;
      ys[i] += (ys[i + 1] - ys[i]) * t;
    }
  }
  return { x: xs[0], y: ys[0] };
}

function sampleBezier(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  const n = Math.max(4, Math.min(600, Math.ceil(len / 2)));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(bezierAt(pts, i / n));
  return out;
}

// A repeated control point ("red anchor") splits a bezier into independent segments.
function bezierPath(points) {
  const segments = [];
  let start = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x === points[i - 1].x && points[i].y === points[i - 1].y) {
      segments.push(points.slice(start, i));
      start = i;
    }
  }
  segments.push(points.slice(start));

  const out = [];
  for (const seg of segments) {
    if (seg.length < 2) continue;
    const sampled = sampleBezier(seg);
    out.push(...(out.length ? sampled.slice(1) : sampled));
  }
  return out.length ? out : [points[0]];
}

function circlePath(pts) {
  const [a, b, c] = pts;
  const cross = (b.y - a.y) * (c.x - a.x) - (b.x - a.x) * (c.y - a.y);
  if (Math.abs(cross) < 1e-3) return null; // collinear: not a circle

  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  const aSq = a.x * a.x + a.y * a.y, bSq = b.x * b.x + b.y * b.y, cSq = c.x * c.x + c.y * c.y;
  const cx = (aSq * (b.y - c.y) + bSq * (c.y - a.y) + cSq * (a.y - b.y)) / d;
  const cy = (aSq * (c.x - b.x) + bSq * (a.x - c.x) + cSq * (b.x - a.x)) / d;
  const r = Math.hypot(a.x - cx, a.y - cy);

  const thetaStart = Math.atan2(a.y - cy, a.x - cx);
  let thetaEnd = Math.atan2(c.y - cy, c.x - cx);
  if (thetaEnd < thetaStart) thetaEnd += 2 * Math.PI;
  let dir = 1;
  let range = thetaEnd - thetaStart;
  const ortho = { x: c.y - a.y, y: -(c.x - a.x) };
  if (ortho.x * (b.x - a.x) + ortho.y * (b.y - a.y) < 0) { dir = -1; range = 2 * Math.PI - range; }

  const n = Math.max(2, Math.min(1000, Math.ceil((r * range) / 2)));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const theta = thetaStart + dir * (i / n) * range;
    out.push({ x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r });
  }
  return out;
}

function catmullPoint(v1, v2, v3, v4, t) {
  const t2 = t * t, t3 = t * t2;
  const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * (b - c) + d) * t3);
  return { x: f(v1.x, v2.x, v3.x, v4.x), y: f(v1.y, v2.y, v3.y, v4.y) };
}

function catmullPath(pts) {
  const out = [];
  const detail = 50;
  for (let i = 0; i < pts.length - 1; i++) {
    const v1 = i > 0 ? pts[i - 1] : pts[i];
    const v2 = pts[i];
    const v3 = i < pts.length - 1 ? pts[i + 1] : { x: 2 * v2.x - v1.x, y: 2 * v2.y - v1.y };
    const v4 = i < pts.length - 2 ? pts[i + 2] : { x: 2 * v3.x - v2.x, y: 2 * v3.y - v2.y };
    for (let c = 0; c <= detail; c++) out.push(catmullPoint(v1, v2, v3, v4, c / detail));
  }
  return out;
}

function fitPolyline(poly, pixelLength) {
  const pts = [poly[0]];
  for (let i = 1; i < poly.length; i++) if (dist(poly[i], pts[pts.length - 1]) > 1e-9) pts.push(poly[i]);

  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const total = cum[cum.length - 1];
  const target = pixelLength > 0 ? pixelLength : total;
  const n = pts.length;

  if (n < 2) return { distance: target, positionAt: () => ({ x: pts[0].x, y: pts[0].y }) };

  // If the drawn curve is shorter than the declared length, the last segment is extended.
  const lastLen = cum[n - 1] - cum[n - 2];
  const dir = { x: (pts[n - 1].x - pts[n - 2].x) / lastLen, y: (pts[n - 1].y - pts[n - 2].y) / lastLen };

  return {
    distance: target,
    positionAt(progress) {
      const d = Math.min(Math.max(progress, 0), 1) * target;
      if (d >= total) {
        const e = d - total;
        return { x: pts[n - 1].x + dir.x * e, y: pts[n - 1].y + dir.y * e };
      }
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= d) lo = mid; else hi = mid;
      }
      const seg = cum[hi] - cum[lo];
      const f = seg > 0 ? (d - cum[lo]) / seg : 0;
      return { x: pts[lo].x + (pts[hi].x - pts[lo].x) * f, y: pts[lo].y + (pts[hi].y - pts[lo].y) * f };
    },
  };
}

/**
 * @param {string} curveType 'B' | 'L' | 'P' | 'C'
 * @param {{x:number,y:number}[]} points control points relative to the slider start, first one is (0,0)
 * @param {number} pixelLength declared slider length in osu!pixels
 */
export function createPath(curveType, points, pixelLength) {
  let poly;
  switch (curveType) {
    case 'L': poly = points.slice(); break;
    case 'P': poly = (points.length === 3 && circlePath(points)) || bezierPath(points); break;
    case 'C': poly = catmullPath(points); break;
    default: poly = bezierPath(points);
  }
  return fitPolyline(poly, pixelLength);
}
