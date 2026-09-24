// Recent listening, read from Last.fm. The API key lives here and is never sent
// to the browser — that is the whole reason this file exists rather than a
// fetch() in the page.
//
// `user.getRecentTracks` needs only an api_key: no OAuth, no session key, no
// user login. The docs say so plainly ("This service does not require
// authentication"), which is why Last.fm and not Spotify is the spine of this
// site. A track currently playing carries `@attr.nowplaying === 'true'` and has
// no `date`; everything else has `date.uts` in seconds.
//
// Four answers, all HTTP 200, all the same shape, so the page never has to
// branch on a status code:
//
//   { paused: true }                     Edwin has gone dark on purpose
//   { private: true }                    Last.fm error 17 — listening is hidden
//   { recent: [] }                       key missing, upstream down, or nothing yet
//   { nowPlaying, recent, fetchedAt }     the normal case
//
// `fetchedAt` is the honesty mechanism. This response sits on a CDN for up to
// 30 seconds, so a `nowplaying` flag alone does not license the page to claim
// "listening now" — the page checks the age too. See js/lately.js.

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
// Deep enough that a quiet week still fills the room. Never a time window:
// "the last 24 hours" shows nothing on a day with no listening, whereas
// "the last 100 tracks" is always 100 tracks. Last.fm allows 200 per call
// and pages back through the whole history beyond that.
const LIMIT = 100;
const TIMEOUT_MS = 8000;

// Last.fm calls 17 "login: user required to be logged in". In practice it is
// what a profile with recent listening set to private returns, and treating it
// as an auth failure sends you debugging the wrong thing for an hour.
// wax-radio/waxlog/lastfm.py reaches the same conclusion and names it
// PrivateProfileError.
const ERROR_PRIVATE = 17;

// Last.fm hands back this md5 as the "no artwork" placeholder. It is a grey
// star, and showing it is worse than showing nothing.
const PLACEHOLDER = '2a96cbd8b46e442fc41c2b86b821562f';

// The image array runs small → extralarge. Take the biggest one that is real.
function pickArt(images) {
  if (!Array.isArray(images)) return null;
  for (let i = images.length - 1; i >= 0; i--) {
    const url = images[i]?.['#text'];
    if (url && !url.includes(PLACEHOLDER)) return url;
  }
  return null;
}

function normalise(t) {
  const nowPlaying = t?.['@attr']?.nowplaying === 'true';
  const uts = Number(t?.date?.uts);
  return {
    artist: t?.artist?.['#text'] ?? '',
    track: t?.name ?? '',
    album: t?.album?.['#text'] || null,
    art: pickArt(t?.image),
    url: t?.url ?? null,
    // A now-playing track has no timestamp — it has not finished, so Last.fm
    // has nothing to record yet. null is the truthful value, not Date.now().
    playedAt: nowPlaying || !Number.isFinite(uts) ? null : uts * 1000,
  };
}

// Every response is cached the same way. A Vercel redeploy mints a new
// deployment and its own cache, so flipping LISTENING_PAUSED takes effect as
// soon as the redeploy lands rather than waiting out a stale entry.
function send(res, body) {
  res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=60');
  return res.status(200).json(body);
}

export default async function handler(req, res) {
  // The kill switch from the brief's privacy section. One env var, and the site
  // stops saying anything at all about what Edwin is hearing.
  if (process.env.LISTENING_PAUSED === '1') return send(res, { paused: true });

  const key = process.env.LASTFM_API_KEY;
  const user = process.env.LASTFM_USER;
  // A missing key is a deploy mistake, not a visitor's problem. The room simply
  // has nothing to say today.
  if (!key || !user) return send(res, { recent: [] });

  const url = `${API_ROOT}?method=user.getrecenttracks`
    + `&user=${encodeURIComponent(user)}`
    + `&api_key=${encodeURIComponent(key)}`
    + `&limit=${LIMIT}&format=json`;

  try {
    const upstream = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!upstream.ok) return send(res, { recent: [] });

    const json = await upstream.json();
    if (json?.error === ERROR_PRIVATE) return send(res, { private: true });
    if (json?.error) return send(res, { recent: [] });

    // With limit=1, or an account holding a single scrobble, Last.fm returns an
    // object where it otherwise returns an array. Normalise before touching it.
    const raw = json?.recenttracks?.track;
    const tracks = Array.isArray(raw) ? raw : raw ? [raw] : [];

    let nowPlaying = null;
    const recent = [];
    for (const t of tracks) {
      const item = normalise(t);
      if (!item.artist || !item.track) continue;
      if (t?.['@attr']?.nowplaying === 'true' && !nowPlaying) nowPlaying = item;
      else recent.push(item);
    }

    return send(res, { nowPlaying, recent, fetchedAt: Date.now() });
  } catch {
    // A timeout or a DNS blip should read as a quiet room, not an error page.
    return send(res, { recent: [] });
  }
}
