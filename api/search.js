// Finding a song to leave.
//
// The picker's endpoint: a query in, a handful of real tracks out, each with
// artwork and a preview. Apple's catalogue is the only source, and explicit
// tracks never appear -- offering something and then refusing it at submission
// is a worse experience than never offering it.
//
// Cached hard at the edge. The same few searches will repeat, Apple rate-limits
// around twenty calls a minute per address, and a search-as-you-type box is
// exactly the thing that would run into that.

import { searchTracks } from './_itunes.js';

const MIN = 2;
const MAX_TERM = 120;

export default async function handler(req, res) {
  const q = String(req.query?.q ?? '').trim().slice(0, MAX_TERM);
  res.setHeader('cache-control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  if (q.length < MIN) return res.status(200).json({ results: [] });

  try {
    return res.status(200).json({ results: await searchTracks(q) });
  } catch {
    // A timeout or a rate limit should read as "nothing found", not an error.
    return res.status(200).json({ results: [] });
  }
}
