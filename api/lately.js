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
// The fetching and normalising moved to api/_lastfm.js when /api/queue needed
// the same scrobbles for a different question -- whether Edwin has since played
// a song a visitor left. One normaliser, two callers.
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
// "listening now" — the page checks the age too. See js/listening/format.js.

import { recentTracks } from './_lastfm.js';

// Deep enough that a quiet week still fills the room. Never a time window:
// "the last 24 hours" shows nothing on a day with no listening, whereas
// "the last 100 tracks" is always 100 tracks. Last.fm allows 200 per call
// and pages back through the whole history beyond that.
const LIMIT = 100;

export default async function handler(req, res) {
  // Thirty seconds keeps "listening now" true while making a burst of visitors
  // one upstream call. A redeploy mints a new cache, so flipping
  // LISTENING_PAUSED takes effect immediately rather than waiting out a stale
  // entry.
  res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=60');
  return res.status(200).json(await recentTracks(LIMIT));
}
