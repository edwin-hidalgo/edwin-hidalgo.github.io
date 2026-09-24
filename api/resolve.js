// Turn "artist + title" into something a visitor can actually hear or open.
//
// Last.fm gives names, not a playable id, so this is the resolution step the
// brief calls for. The ladder it proposed was Spotify → Odesli → metadata.
// Both of the first two turned out not to be available:
//
//   Spotify  needs a developer app, and since February 2026 a Development Mode
//            app requires the owner to hold Spotify Premium, allows one client
//            id, and caps /v1/search at 10 results.
//   Odesli   answers its keyless public endpoint with
//            401 {"code":"PUBLIC_API_ACCESS_DEPRECATED"} — measured 2026-09-21.
//            It is retired, not rate-limited, so retrying does not help.
//
// What is left is keyless, free, and actually works:
//
//   1. iTunes Search  → a 30-second preview, artwork, and an exact Apple link
//   2. search links   → find-it-on-yours for Spotify, YouTube Music, Last.fm
//   3. nothing        → metadata only, and the page says so
//
// Step 2 is honest about itself: those are searches, not deep links, and each
// link carries `exact: false` so the page can say "find on" rather than "open
// in". Promising a deep link and delivering a search page is the kind of small
// lie this site is supposed to avoid.
//
// Called lazily — only when a visitor taps a track. The strip renders from
// Last.fm's own artwork, so loading the page resolves nothing.

const ITUNES = 'https://itunes.apple.com/search';
const TIMEOUT_MS = 8000;

// itunes.apple.com/search sniffs the User-Agent: an iPhone UA gets a 301 to a
// `musics://` deep link, and fetch() rejects a redirect to a non-HTTP scheme.
// Naming a real desktop Safari keeps us in the shape of a request Apple plainly
// expects to serve. Measured in everything-hums (api/song-search.js) on
// 2026-09-19, and the reason this cannot be done from the page.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';

// "Song (feat. X) - 2011 Remaster" and "Song" are the same song for our
// purposes. Strip the furniture before comparing so a good match is not thrown
// away over a parenthetical.
function fold(s) {
  const raw = String(s || '').toLowerCase();
  const stripped = raw
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    // A featuring credit only counts mid-title, and "with" is not one of its
    // markers. "With Love, Pt. 7" and "Dancing With Myself" are titles; an
    // earlier version of this ate them to an empty string and then refused a
    // match Apple was happily returning.
    .replace(/\s+\b(feat|ft|featuring)\b\.?.*$/, ' ')
    .replace(/[^a-z0-9]+/g, '');
  // Tidying must never erase the whole title. If it did, compare the letters.
  return stripped || raw.replace(/[^a-z0-9]+/g, '');
}

// Apple's top hit for a two-word query is not always the right song. Require
// that both halves agree after folding, so a miss falls through to search links
// rather than confidently offering the wrong track.
function looksLikeMatch(result, artist, track) {
  const a = fold(result.artistName);
  const t = fold(result.trackName);
  const wantA = fold(artist);
  const wantT = fold(track);
  if (!a || !t || !wantA || !wantT) return false;
  return (a.includes(wantA) || wantA.includes(a)) && (t.includes(wantT) || wantT.includes(t));
}

async function fromItunes(artist, track) {
  const url = `${ITUNES}?term=${encodeURIComponent(`${artist} ${track}`)}`
    + '&media=music&entity=song&limit=5';
  const upstream = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!upstream.ok) return null;
  const json = await upstream.json();
  const hit = (json?.results || []).find(r => looksLikeMatch(r, artist, track));
  if (!hit) return null;
  return {
    // Apple serves any size from the same path; 100x100 is too small to show.
    artwork: (hit.artworkUrl100 || hit.artworkUrl60 || '').replace('100x100', '400x400') || null,
    appleUrl: hit.trackViewUrl || null,
    // Preview audio does not sniff the UA and answers with
    // access-control-allow-origin: *, so the page plays it straight from Apple.
    // Nothing is proxied, cached, or rehosted here.
    previewUrl: hit.previewUrl || null,
  };
}

// Keyless, permanent, and honest about being a search rather than a deep link.
function searchLinks(artist, track) {
  const q = encodeURIComponent(`${artist} ${track}`);
  return {
    spotify: { url: `https://open.spotify.com/search/${q}`, exact: false },
    youtube: { url: `https://music.youtube.com/search?q=${q}`, exact: false },
    lastfm: {
      url: `https://www.last.fm/music/${encodeURIComponent(artist)}/_/${encodeURIComponent(track)}`,
      exact: false,
    },
  };
}

export default async function handler(req, res) {
  const artist = String(req.query?.artist ?? '').trim();
  const track = String(req.query?.track ?? '').trim();
  if (!artist || !track) return res.status(400).json({ error: 'artist and track required' });

  // A song's preview and links do not change. Holding this at the edge for a
  // day keeps Apple's rate limit (~20/min) well clear and means each track is
  // really resolved once, the way the brief asks.
  res.setHeader('cache-control', 'public, s-maxage=86400, stale-while-revalidate=604800');

  let apple = null;
  try {
    apple = await fromItunes(artist, track);
  } catch {
    apple = null;
  }

  const links = searchLinks(artist, track);
  if (apple?.appleUrl) links.appleMusic = { url: apple.appleUrl, exact: true };

  return res.status(200).json({
    found: Boolean(apple),
    artist,
    track,
    artwork: apple?.artwork ?? null,
    preview: apple?.previewUrl
      ? { url: apple.previewUrl, seconds: 30, source: 'Apple Music' }
      : null,
    links,
    capability: apple?.previewUrl ? 'preview' : 'link',
  });
}
