// A tiny Cloudflare Worker that looks players up on the osu! API v2 for the Catch Renderer site.
// It keeps your osu! OAuth client id and secret to itself; the website only ever talks to this Worker.
//
// Secrets to set on the Worker (Settings -> Variables and Secrets):
//   OSU_CLIENT_ID      the client id of your osu! OAuth application
//   OSU_CLIENT_SECRET  its client secret (add it as a Secret, not as plain text)
// Optional:
//   ALLOW_ORIGIN       the site allowed to call this Worker, e.g. https://8408x.github.io (default: any site)
//
// Routes:
//   GET /user?name=NAME    ->  { id, username, country_code, country_name, rank, country_rank, pp, avatar_url }
//   GET /scores?checksum=MD5[&id=BEATMAPID]  ->  { beatmap_id, scores: [{ rank, user_id, username, country_code, score, accuracy, max_combo, mods, pp, n300, n100, n50, nkatu, nmiss, date }] }  (osu!catch top 50)
//   GET /avatar/ID         ->  the player's picture, with the headers a canvas needs

let token = null;                                  // { value, expires } kept between requests while the Worker stays warm

async function getToken(env) {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const id = String(env.OSU_CLIENT_ID ?? '').trim();
  const secret = String(env.OSU_CLIENT_SECRET ?? '').trim();
  if (!/^\d+$/.test(id)) throw new Error(`OSU_CLIENT_ID must be the numeric Client ID from osu! (got ${id ? id.length + ' characters, not all digits' : 'nothing'}). Is the ID and secret in the right boxes?`);
  if (!secret) throw new Error('OSU_CLIENT_SECRET is empty.');
  const res = await fetch('https://osu.ppy.sh/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: Number(id), client_secret: secret, grant_type: 'client_credentials', scope: 'public' }),
  });
  if (!res.ok) {
    let why = '';
    try { const e = await res.json(); why = ` ${e.error ?? ''} ${e.error_description ?? e.hint ?? e.message ?? ''}`.trimEnd(); } catch {}
    throw new Error(`osu! refused the login (${res.status}).${why} Client ID length ${id.length}, secret length ${secret.length}.`);
  }
  const j = await res.json();
  token = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return token.value;
}

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOW_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    };
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': status === 200 ? 'public, max-age=600' : 'no-store' } });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      if (url.pathname === '/user') {
        const name = (url.searchParams.get('name') || '').trim();
        if (!name) return json({ error: 'name is missing' }, 400);
        const res = await fetch(`https://osu.ppy.sh/api/v2/users/${encodeURIComponent(name)}/fruits?key=username`, {
          headers: { Authorization: `Bearer ${await getToken(env)}`, Accept: 'application/json' },
        });
        if (res.status === 404) return json({ error: 'no such player' }, 404);
        if (!res.ok) return json({ error: `osu! answered ${res.status}` }, 502);
        const u = await res.json();
        const s = u.statistics ?? {};
        return json({
          id: u.id, username: u.username, country_code: u.country_code ?? u.country?.code ?? '', country_name: u.country?.name ?? '',
          rank: s.global_rank ?? null, country_rank: s.country_rank ?? null, pp: s.pp ?? null, avatar_url: u.avatar_url,
          hit_accuracy: s.hit_accuracy ?? null, play_count: s.play_count ?? null, level: s.level?.current ?? null,
          title: u.title ?? '', cover_url: u.cover?.url ?? u.cover_url ?? '', is_supporter: !!u.is_supporter, profile_colour: u.profile_colour ?? '',
          groups: (u.groups ?? []).slice(0, 3).map((g) => ({ name: g.name, identifier: g.short_name, colour: g.colour, playmodes: g.playmodes ?? null })),
        });
      }
      if (url.pathname === '/scores') {
        const sum = (url.searchParams.get('checksum') || '').toLowerCase();
        if (!/^[0-9a-f]{32}$/.test(sum)) return json({ error: 'checksum must be the beatmap md5' }, 400);
        const auth = { headers: { Authorization: `Bearer ${await getToken(env)}`, Accept: 'application/json' } };
        let bm = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/lookup?checksum=${sum}`, auth);
        const wanted = (url.searchParams.get('id') || '').replace(/\D/g, '');          // the difficulty's id from the .osu file: works when the map was updated after the replay was set
        if (bm.status === 404 && wanted) bm = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/${wanted}`, auth);
        if (bm.status === 404) return json({ error: 'this exact version of the map is not on osu! (it may be unsubmitted or updated since the replay)' }, 404);
        if (!bm.ok) return json({ error: `osu! answered ${bm.status}` }, 502);
        const b = await bm.json();
        const res = await fetch(`https://osu.ppy.sh/api/v2/beatmaps/${b.id}/scores?mode=fruits&type=global`, auth);
        if (!res.ok) return json({ error: `osu! answered ${res.status}` }, 502);
        const j = await res.json();
        return json({
          beatmap_id: b.id, status: b.status, same_version: !b.checksum || b.checksum === sum,
          scores: (j.scores ?? []).slice(0, 50).map((x, i) => ({
            rank: i + 1, user_id: x.user_id ?? x.user?.id, username: x.user?.username ?? '', country_code: x.user?.country_code ?? '',
            score: [x.classic_total_score, x.legacy_total_score, x.total_score, x.score].find((v) => v > 0) ?? 0,   // some scores carry a 0 in one field and the real value in another accuracy: x.accuracy ?? 0, max_combo: x.max_combo ?? 0,
            mods: (x.mods ?? []).map((m) => (typeof m === 'string' ? m : m.acronym)), pp: x.pp ?? null,
            n300: x.statistics?.great ?? x.statistics?.count_300 ?? 0, n100: x.statistics?.large_tick_hit ?? x.statistics?.count_100 ?? 0,
            n50: x.statistics?.small_tick_hit ?? x.statistics?.count_50 ?? 0, nkatu: x.statistics?.small_tick_miss ?? x.statistics?.count_katu ?? 0, nmiss: x.statistics?.miss ?? x.statistics?.count_miss ?? 0,
            date: x.ended_at ?? x.created_at ?? '',
          })),
        });
      }
      const m = url.pathname.match(/^\/avatar\/(\d{1,10})$/);
      if (m) {
        const res = await fetch(`https://a.ppy.sh/${m[1]}`);
        if (!res.ok) return json({ error: 'no picture' }, 404);
        return new Response(res.body, { headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'image/png', 'Cache-Control': 'public, max-age=86400' } });
      }
      const f = url.pathname.match(/^\/flag\/([a-zA-Z]{2})$/);
      if (f) {
        const res = await fetch(`https://flagcdn.com/w160/${f[1].toLowerCase()}.png`);
        if (!res.ok) return json({ error: 'no flag' }, 404);
        return new Response(res.body, { headers: { ...cors, 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' } });
      }
      if (url.pathname === '/cover') {
        const target = url.searchParams.get('u') || '';
        if (!/^https:\/\/assets\.ppy\.sh\/[\w\-./]+$/.test(target)) return json({ error: 'not an osu! cover' }, 400);
        const res = await fetch(target);
        if (!res.ok) return json({ error: 'no cover' }, 404);
        return new Response(res.body, { headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'image/jpeg', 'Cache-Control': 'public, max-age=86400' } });
      }
      return json({ ok: true, routes: ['/user?name=NAME', '/scores?checksum=MD5', '/avatar/ID', '/flag/CC', '/cover?u=URL'] });
    } catch (err) {
      return json({ error: String(err.message || err) }, 500);
    }
  },
};
