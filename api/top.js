// What Edwin listens to most, over a window.
//
// The recent list is a chronology; this is a tally, and neither can be derived
// from the other -- a hundred scrobbles say nothing about a year. So it is its
// own call rather than something counted in the browser from the log.
//
// The windows are Last.fm's own period buckets. The API supports no arbitrary
// date range, so the page offers exactly what the upstream can honour instead
// of a control that would have to lie.

import { topFor, PERIODS } from './_lastfm.js';

const KINDS = new Set(['artists', 'tracks']);

export default async function handler(req, res) {
  const kind = KINDS.has(req.query?.kind) ? req.query.kind : 'artists';
  const period = Object.hasOwn(PERIODS, req.query?.period ?? '') ? req.query.period : '7day';

  // A tally over days or years does not move minute to minute. An hour at the
  // edge keeps this off Last.fm entirely for all but the first visitor.
  res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  const data = await topFor(kind, period);
  return res.status(200).json({ kind, period, periods: PERIODS, ...data });
}
