// Reading Edwin's scrobbles, once.
//
// Lifted out of api/lately.js when the queue needed the same data for a
// different reason: /api/lately serves it to the page, and /api/queue matches
// it against songs visitors have left to see whether Edwin has since played
// one. Two callers, one normaliser -- a second copy would drift, and the
// nowPlaying/playedAt handling below is subtle enough that drift would show.
//
// Underscore-prefixed so Vercel treats it as a module rather than a route.

const API_ROOT = 'https://ws.audioscrobbler.com/2.0/';
const TIMEOUT_MS = 8000;

// Last.fm calls 17 "login: user required to be logged in". In practice it is
// what a profile with recent listening set to private returns, and treating it
// as an auth failure sends you debugging the wrong thing for an hour.
export const ERROR_PRIVATE = 17;

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

// Four outcomes, and the caller decides how to present each:
//   { paused: true }    the kill switch is on
//   { private: true }   the profile is not public
//   { recent: [] }      no key, upstream down, or nothing yet
//   { nowPlaying, recent, fetchedAt }
export async function recentTracks(limit = 100) {
  // The kill switch from the brief's privacy section. One env var, and the site
  // stops saying anything at all about what Edwin is hearing.
  if (process.env.LISTENING_PAUSED === '1') return { paused: true };

  const key = process.env.LASTFM_API_KEY;
  const user = process.env.LASTFM_USER;
  // A missing key is a deploy mistake, not a visitor's problem. The room simply
  // has nothing to say today.
  if (!key || !user) return { recent: [] };

  const url = `${API_ROOT}?method=user.getrecenttracks`
    + `&user=${encodeURIComponent(user)}`
    + `&api_key=${encodeURIComponent(key)}`
    + `&limit=${limit}&format=json`;

  try {
    const upstream = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!upstream.ok) return { recent: [] };

    const json = await upstream.json();
    if (json?.error === ERROR_PRIVATE) return { private: true };
    if (json?.error) return { recent: [] };

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

    return { nowPlaying, recent, fetchedAt: Date.now() };
  } catch {
    // A timeout or a DNS blip should read as a quiet room, not an error page.
    return { recent: [] };
  }
}

// Last.fm's native period buckets. These are the only windows the API supports
// -- there is no arbitrary date range -- so the page offers exactly these
// rather than inventing a control the upstream cannot honour. Same set Onus
// uses in app/src/adapters/lastfm.ts.
export const PERIODS = {
  '7day': 'last 7 days',
  '1month': 'last 30 days',
  'overall': 'all time',
};

// Top artists or top tracks for a window.
//
// A different question from recentTracks(): that one is a chronology, this is a
// tally. Neither can be derived from the other -- a hundred recent scrobbles
// say nothing about a year -- which is why this is its own call rather than
// something counted client-side from the log.
export async function topFor(kind, period, limit = 5) {
  const method = kind === 'tracks' ? 'user.gettoptracks' : 'user.gettopartists';
  if (process.env.LISTENING_PAUSED === '1') return { paused: true };

  const key = process.env.LASTFM_API_KEY;
  const user = process.env.LASTFM_USER;
  if (!key || !user) return { items: [] };

  const url = `${API_ROOT}?method=${method}`
    + `&user=${encodeURIComponent(user)}`
    + `&api_key=${encodeURIComponent(key)}`
    + `&period=${encodeURIComponent(period)}`
    + `&limit=${limit}&format=json`;

  try {
    const upstream = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!upstream.ok) return { items: [] };
    const json = await upstream.json();
    if (json?.error === ERROR_PRIVATE) return { private: true };
    if (json?.error) return { items: [] };

    const raw = kind === 'tracks' ? json?.toptracks?.track : json?.topartists?.artist;
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];

    const items = rows.map(r => ({
      name: r?.name ?? '',
      // Tracks carry their artist; artists do not.
      artist: kind === 'tracks' ? (r?.artist?.name ?? r?.artist?.['#text'] ?? '') : null,
      plays: Number(r?.playcount) || 0,
      url: r?.url ?? null,
      // Last.fm's top-chart images are almost always the grey placeholder, so
      // they are deliberately not read here -- the Lounge would rather show no
      // artwork than a wall of identical grey stars.
    })).filter(i => i.name);

    return { items, fetchedAt: Date.now() };
  } catch {
    return { items: [] };
  }
}
