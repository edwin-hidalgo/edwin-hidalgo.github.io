// Songs visitors have left, and whether Edwin has played them yet.
//
// GET  returns the queue, after reconciling it against Edwin's scrobbles.
// POST leaves a song.
//
// The queue is deliberately NOT merged into /api/lately. That list is ordered
// by playedAt -- a record of what Edwin actually heard. A queued song has never
// been played by anyone; it has a submittedAt, a different axis. Merged, "four
// minutes ago" would mean "Edwin heard this" on one row and "a stranger
// suggested this" on the row above it, and the whole site has been built to
// refuse that kind of overclaim.
//
// Nothing here is moderated. What keeps that safe is that a visitor never
// authors anything: they choose from Apple's catalogue, sign with up to three
// letters and an emoji from a fixed set, and that is the entire surface. The
// one thing the catalogue does not protect against is its own titles, which is
// what the explicit check is for.

import { recentTracks } from './_lastfm.js';
import { fold, sameTrack } from './_fold.js';
import { readQueue, updateQueue, blobConfigured } from './_store.js';
import { fromItunes, searchLinks } from './_itunes.js';
import { createHash, randomUUID } from 'node:crypto';

// How many waiting songs the page shows. Played ones drop out of the queue
// after a day: they have done their job, and they live on in the log with the
// visitor's mark against them.
const SHOWN = 8;
const PLAYED_TTL_MS = 24 * 60 * 60 * 1000;

// One submission per visitor per day. Nothing in this codebase has ever
// throttled anything, and unmoderated plus unthrottled means one person with a
// script owns the room -- which breaks the feature long before anything
// offensive does.
const THROTTLE_DAYS = 1;

const MAX_ARTIST = 200;
const MAX_TRACK = 300;

// A curated set rather than a text field. One emoji is often two UTF-16 code
// units and a ZWJ sequence is eleven, so any length cap on free input either
// rejects valid emoji or admits long sequences; combining marks render outside
// their row and bidi controls reverse the text around them. A fixed list has
// none of those problems and doubles as the data the picker is built from.
export const EMOJI = [
  '🌊', '🌙', '☀️', '🔥', '🌱', '🍊', '🪩', '🎧', '📻', '🎸',
  '🥁', '🎹', '🕊️', '🐝', '🦊', '🐋', '🌵', '🍄', '⛰️', '🛰️',
  '☕', '🚲', '✈️', '🌀', '❄️', '⚡', '🪐', '🫧', '🧊', '🪁',
];

const today = () => new Date().toISOString().slice(0, 10);

// An address is never stored. The salt means the hashes are not a rainbow-table
// lookup back to one, and it rotates with the deploy secret if that ever
// changes.
function visitorHash(req) {
  const fwd = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = fwd || req.socket?.remoteAddress || 'unknown';
  const salt = process.env.LASTFM_API_KEY || 'no-salt';
  return createHash('sha256').update(`${ip}|${salt}`).digest('hex').slice(0, 32);
}

function prune(throttle) {
  const cutoff = Date.now() - THROTTLE_DAYS * 24 * 60 * 60 * 1000;
  const kept = {};
  for (const [hash, day] of Object.entries(throttle || {})) {
    if (Date.parse(`${day}T00:00:00Z`) >= cutoff) kept[hash] = day;
  }
  return kept;
}

// What the page is allowed to see. Never the visitor hashes, and never the
// folded strings -- those are matching machinery, not content.
const publicShape = s => ({
  id: s.id,
  artist: s.artist,
  track: s.track,
  art: s.art ?? null,
  preview: s.preview ?? null,
  links: s.links ?? {},
  initials: s.initials ?? null,
  emoji: s.emoji ?? null,
  submittedAt: s.submittedAt,
  playedAt: s.playedAt ?? null,
});

// Has Edwin played any of the waiting songs? Written ONCE, the first time a
// scrobble matches, and never recomputed -- the scrobble window is a rolling
// hundred, so a play derived from it afresh each time would silently revert to
// "waiting" as soon as he had listened to a hundred more.
function reconcile(songs, scrobbles) {
  if (!scrobbles.length) return { songs, changed: false };
  let changed = false;
  const next = songs.map(s => {
    if (s.playedAt || s.hidden) return s;
    const hit = scrobbles.find(t => sameTrack(s.foldArtist, s.foldTrack, t.artist, t.track));
    if (!hit) return s;
    changed = true;
    // The scrobble's own spelling is recorded alongside the play, so the page
    // can mark the matching row in the log without needing a copy of fold() in
    // the browser -- it compares the strings it is already rendering.
    return {
      ...s,
      playedAt: hit.playedAt ?? Date.now(),
      matchedArtist: hit.artist,
      matchedTrack: hit.track,
    };
  });
  return { songs: next, changed };
}

function visible(songs) {
  const cutoff = Date.now() - PLAYED_TTL_MS;
  return songs
    .filter(s => !s.hidden)
    .filter(s => !s.playedAt || s.playedAt >= cutoff)
    .sort((a, b) => {
      // Waiting songs first, then most recently left.
      if (Boolean(a.playedAt) !== Boolean(b.playedAt)) return a.playedAt ? 1 : -1;
      return (b.submittedAt ?? 0) - (a.submittedAt ?? 0);
    })
    .slice(0, SHOWN);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return null; } }
  // Vercel parses JSON bodies itself; this is the path tools/serve.mjs takes.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

const bad = (res, reason, status = 200) =>
  res.status(status).json({ ok: false, reason });

export default async function handler(req, res) {
  if (process.env.GUEST_SONGS_ENABLED === '0') {
    res.setHeader('cache-control', 'public, s-maxage=30');
    return res.status(200).json({ off: true, songs: [], marks: [], emoji: EMOJI });
  }
  if (!blobConfigured()) {
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({ off: true, songs: [], marks: [], emoji: EMOJI });
  }

  if (req.method === 'POST') return submit(req, res);
  if (req.method && req.method !== 'GET') return bad(res, 'method', 405);

  // Reconciling needs a write, so this cannot be cached as long as the queue is
  // otherwise static. Thirty seconds matches the rest of the site.
  res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=60');

  const [{ data }, lately] = await Promise.all([readQueue(), recentTracks(100)]);
  const scrobbles = [lately.nowPlaying, ...(lately.recent ?? [])].filter(Boolean);
  const { songs, changed } = reconcile(data.songs, scrobbles);

  if (changed) {
    // Best effort. A lost race here just means the next reader marks it.
    updateQueue(current => {
      const merged = reconcile(current.songs, scrobbles);
      return merged.changed ? { ...current, songs: merged.songs } : null;
    }).catch(() => {});
  }

  // Which rows in the recent-listens list came from a visitor. Sent separately
  // from the queue because the log is a different list with a different
  // lifetime: a played song leaves the queue after a day but stays in the log
  // for as long as it is among the last hundred scrobbles.
  const marks = songs
    .filter(s => s.playedAt && s.matchedArtist && !s.hidden)
    .map(s => ({
      artist: s.matchedArtist,
      track: s.matchedTrack,
      initials: s.initials ?? null,
      emoji: s.emoji ?? null,
    }));

  return res.status(200).json({
    songs: visible(songs).map(publicShape),
    marks,
    emoji: EMOJI,
  });
}

async function submit(req, res) {
  res.setHeader('cache-control', 'no-store');

  const body = await readBody(req);
  if (!body) return bad(res, 'no_body');

  const artist = String(body.artist ?? '').trim();
  const track = String(body.track ?? '').trim();
  if (!artist || !track) return bad(res, 'incomplete');
  if (artist.length > MAX_ARTIST || track.length > MAX_TRACK) return bad(res, 'too_long');

  const initials = String(body.initials ?? '').trim();
  if (initials && !/^[A-Za-z]{1,3}$/.test(initials)) return bad(res, 'bad_initials');

  const emoji = String(body.emoji ?? '').trim();
  if (emoji && !EMOJI.includes(emoji)) return bad(res, 'bad_emoji');

  // The submission has to name a real track. This is most of why the feature is
  // safe without moderation: a visitor is choosing from Apple's catalogue, not
  // authoring anything. Looked up server-side rather than trusting what the
  // page sent, so a caller who skips the front end gets the same treatment.
  let apple = null;
  try {
    apple = await fromItunes(artist, track);
  } catch {
    apple = null;
  }
  if (!apple) return bad(res, 'not_found');

  // The one thing Apple's catalogue does not protect against is its own
  // titles. A stranger who wants something ugly on Edwin's site does not have
  // to type it -- they can find a real track already called it.
  if (apple.explicit) return bad(res, 'explicit');

  const links = searchLinks(artist, track);
  if (apple.appleUrl) links.appleMusic = { url: apple.appleUrl, exact: true };

  const hash = visitorHash(req);
  const day = today();
  // Apple's spelling wins over the visitor's. It is the spelling Edwin's
  // scrobbles will carry too, which is what the play-detection compares.
  const finalArtist = apple.appleArtist || artist;
  const finalTrack = apple.appleTrack || track;
  const entry = {
    id: randomUUID(),
    artist: finalArtist,
    track: finalTrack,
    art: apple.artwork ?? null,
    preview: apple.previewUrl
      ? { url: apple.previewUrl, seconds: 30, source: 'Apple Music' }
      : null,
    links,
    initials: initials || null,
    emoji: emoji || null,
    foldArtist: fold(finalArtist),
    foldTrack: fold(finalTrack),
    submittedAt: Date.now(),
    playedAt: null,
    hidden: false,
  };

  let rejected = null;
  const result = await updateQueue(current => {
    const throttle = prune(current.throttle);
    if (throttle[hash] === day) { rejected = 'rate_limited'; return null; }
    // Leaving the same song twice makes the queue a wall rather than a shelf.
    const already = current.songs.some(s =>
      !s.playedAt && sameTrack(s.foldArtist, s.foldTrack, entry.artist, entry.track));
    if (already) { rejected = 'duplicate'; return null; }
    return {
      songs: [entry, ...current.songs].slice(0, 500),
      throttle: { ...throttle, [hash]: day },
    };
  });

  if (rejected) return bad(res, rejected);
  if (!result.ok) return bad(res, 'busy');
  return res.status(200).json({ ok: true, song: publicShape(entry) });
}
