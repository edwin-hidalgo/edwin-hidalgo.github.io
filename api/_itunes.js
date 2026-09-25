// Looking a song up in Apple's catalogue.
//
// Extracted from api/resolve.js when /api/queue needed the same lookup for a
// different reason: the resolver answers "what can a visitor play?", the queue
// asks "is this a real track, and is it one Edwin would want on his site?".
//
// The alternative was one function calling the other over HTTP -- a serverless
// function making a network round-trip to itself, which also broke immediately
// in local development because there is no x-forwarded-proto to tell it whether
// to use http or https.
//
// Underscore-prefixed so Vercel treats it as a module rather than a route.

import { fold } from './_fold.js';

const ITUNES = 'https://itunes.apple.com/search';
const LOOKUP = 'https://itunes.apple.com/lookup';
const TIMEOUT_MS = 8000;

// itunes.apple.com/search sniffs the User-Agent: an iPhone UA gets a 301 to a
// `musics://` deep link, and fetch() rejects a redirect to a non-HTTP scheme.
// Naming a real desktop Safari keeps us in the shape of a request Apple plainly
// expects to serve. Measured in everything-hums (api/song-search.js) on
// 2026-09-19, and the reason this cannot be done from the page.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15';

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

export async function fromItunes(artist, track) {
  const url = `${ITUNES}?term=${encodeURIComponent(`${artist} ${track}`)}`
    // Twenty-five, not five. Searching "Bon Iver Holocene" returned five
    // results that were all covers, instrumentals and string-quartet versions,
    // with the actual Bon Iver recording nowhere among them -- so the resolver
    // correctly rejected every one and reported the song as not found. The
    // page size costs nothing; the depth is what finds the real recording.
    + '&media=music&entity=song&limit=25';
  const upstream = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!upstream.ok) return null;
  const json = await upstream.json();
  const results = json?.results || [];
  // Exact first, containment second. looksLikeMatch accepts a fold that merely
  // CONTAINS the query, which is what lets "Pink Moon" match
  // "Pink Moon (2011 Remaster)" -- but it also let "Nick Drake" match
  // "AURORA & Nick Drake", handing back a collaboration when the original was
  // sitting further down the same five results. Preferring an exact agreement
  // on both halves costs nothing and picks the recording that was asked for.
  const wantA = fold(artist);
  const wantT = fold(track);
  const hit = results.find(r => fold(r.artistName) === wantA && fold(r.trackName) === wantT)
    || results.find(r => looksLikeMatch(r, artist, track));
  if (!hit) return null;
  return {
    // Apple serves any size from the same path; 100x100 is too small to show.
    artwork: (hit.artworkUrl100 || hit.artworkUrl60 || '').replace('100x100', '400x400') || null,
    appleUrl: hit.trackViewUrl || null,
    // Preview audio does not sniff the UA and answers with
    // access-control-allow-origin: *, so the page plays it straight from Apple.
    // Nothing is proxied, cached, or rehosted here.
    previewUrl: hit.previewUrl || null,
    // Apple has always sent this and the resolver has always thrown it away.
    // The guest queue is the first caller that needs it: a submission is a
    // stranger choosing from Apple's catalogue rather than typing, which is
    // most of why the feature is safe -- but the catalogue itself is full of
    // titles Edwin would not want on his own site, so this is the one signal
    // that separates "a real song" from "a real song, and fine to show".
    explicit: hit.trackExplicitness === 'explicit'
      || hit.collectionExplicitness === 'explicit',
    // Apple's own spelling, which the response has also been discarding in
    // favour of echoing the query back.
    appleArtist: hit.artistName || null,
    appleTrack: hit.trackName || null,
  };
}

// Keyless, permanent, and honest about being a search rather than a deep link.
export function searchLinks(artist, track) {
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

// One track's worth of catalogue, in the shape both the picker and the queue
// want. Apple's own spelling throughout -- that is what Edwin's scrobbles will
// carry, and the play-detection compares against it.
function shape(hit) {
  return {
    id: String(hit.trackId ?? ''),
    artist: hit.artistName ?? '',
    track: hit.trackName ?? '',
    album: hit.collectionName ?? null,
    // Apple serves any size from the same path; 100x100 is too small to show.
    artwork: (hit.artworkUrl100 || hit.artworkUrl60 || '').replace('100x100', '200x200') || null,
    appleUrl: hit.trackViewUrl || null,
    previewUrl: hit.previewUrl || null,
    explicit: hit.trackExplicitness === 'explicit'
      || hit.collectionExplicitness === 'explicit',
  };
}

// What the picker shows. A visitor searches, sees real songs with their
// artwork, and taps one -- which is a better question to answer than "type the
// artist and the title exactly as Apple spells them", and it removes the whole
// class of near-miss where the resolver quietly returned a different recording.
//
// Explicit tracks are dropped here rather than refused at submission. Offering
// something and then rejecting it is a worse experience than never offering it.
export async function searchTracks(term, limit = 8) {
  const url = `${ITUNES}?term=${encodeURIComponent(term)}&media=music&entity=song&limit=25`;
  const upstream = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!upstream.ok) return [];
  const json = await upstream.json();
  const seen = new Set();
  const out = [];
  for (const hit of json?.results ?? []) {
    const s = shape(hit);
    if (!s.id || !s.artist || !s.track || s.explicit) continue;
    // Apple lists the same song once per release. One row per recording.
    const key = `${fold(s.artist)}|${fold(s.track)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

// Re-read the chosen track by its id rather than trusting what the page sent.
// The visitor picked a specific recording; looking it up again means what gets
// stored is exactly that, and a caller who skips the picker gets the same
// treatment as one who used it.
export async function lookupTrack(id) {
  if (!/^\d{1,20}$/.test(String(id ?? ''))) return null;
  const upstream = await fetch(`${LOOKUP}?id=${encodeURIComponent(id)}&entity=song`, {
    headers: { 'user-agent': UA, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!upstream.ok) return null;
  const json = await upstream.json();
  const hit = (json?.results ?? []).find(r => r.wrapperType === 'track' || r.kind === 'song');
  if (!hit?.trackId) return null;
  return shape(hit);
}
