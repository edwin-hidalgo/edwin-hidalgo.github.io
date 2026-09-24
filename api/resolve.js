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

import { fromItunes, searchLinks } from './_itunes.js';

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
    explicit: apple?.explicit ?? false,
    capability: apple?.previewUrl ? 'preview' : 'link',
  });
}
