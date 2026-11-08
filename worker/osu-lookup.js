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
      return json({ ok: true, routes: ['/user?name=NAME', '/avatar/ID', '/flag/CC', '/cover?u=URL'] });
    } catch (err) {
      return json({ error: String(err.message || err) }, 500);
    }
  },
};
