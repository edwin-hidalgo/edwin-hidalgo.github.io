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
// authors anything: they search Apple's catalogue, tap a real recording, and
// may sign with up to three letters. That is the entire surface. The one thing
// the catalogue does not protect against is its own titles, which is why
// explicit tracks are dropped from the search results AND refused here.

import { recentTracks } from './_lastfm.js';
import { fold, sameTrack } from './_fold.js';
import { readView, listSongs, writeSong, rebuildView, claimSubmission, sweepThrottle, blobConfigured } from './_store.js';
import { lookupTrack, searchLinks } from './_itunes.js';
import { createHash, randomUUID } from 'node:crypto';

// How many waiting songs the page shows. Played ones drop out of the queue
// after a day: they have done their job, and they live on in the log with the
// visitor's mark against them.
const SHOWN = 8;
const PLAYED_TTL_MS = 24 * 60 * 60 * 1000;

// One submission per visitor per day, enforced by an atomic blob create rather
// than a counter someone could race. Nothing in this codebase had ever
// throttled anything, and unmoderated plus unthrottled means one person with a
// script owns the room -- which breaks the feature long before anything
// offensive does.

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
    return res.status(200).json({ off: true, songs: [], marks: [] });
  }
  if (!blobConfigured()) {
    res.setHeader('cache-control', 'no-store');
    return res.status(200).json({ off: true, songs: [], marks: [] });
  }

  if (req.method === 'POST') return submit(req, res);
  if (req.method && req.method !== 'GET') return bad(res, 'method', 405);

  // Reconciling needs a write, so this cannot be cached as long as the queue is
  // otherwise static. Thirty seconds matches the rest of the site.
  res.setHeader('cache-control', 'public, s-maxage=30, stale-while-revalidate=60');

  const [view, lately] = await Promise.all([readView(), recentTracks(100)]);
  const scrobbles = [lately.nowPlaying, ...(lately.recent ?? [])].filter(Boolean);
  const { songs, changed } = reconcile(view.songs, scrobbles);

  if (changed) {
    // Persist the play against the song's own blob, then refresh the view.
    // Best effort: the response already reflects it, and a failure here just
    // means the next reader does the same work.
    (async () => {
      const fresh = reconcile(await listSongs(), scrobbles);
      if (!fresh.changed) return;
      await Promise.all(fresh.songs.filter(s => s.playedAt).map(writeSong));
      await rebuildView();
    })().catch(() => {});
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
    }));

  return res.status(200).json({
    songs: visible(songs).map(publicShape),
    marks,
  });
}

async function submit(req, res) {
  res.setHeader('cache-control', 'no-store');

  const body = await readBody(req);
  if (!body) return bad(res, 'no_body');

  // The visitor picked a specific recording in the picker, so the id is what
  // arrives -- not a spelling to be searched for again. Looked up server-side
  // rather than trusted, so what gets stored is exactly the track they chose
  // and a caller who skips the picker is held to the same rule.
  const apple = await lookupTrack(body.trackId).catch(() => null);
  if (!apple) return bad(res, 'not_found');

  // The picker never offers these, so reaching here means the request did not
  // come from it. The catalogue is full of titles Edwin would not want on his
  // own site, and a stranger does not have to type one -- only find one.
  if (apple.explicit) return bad(res, 'explicit');

  const initials = String(body.initials ?? '').trim();
  if (initials && !/^[A-Za-z]{1,3}$/.test(initials)) return bad(res, 'bad_initials');

  const artist = apple.artist;
  const track = apple.track;
  if (!artist || !track) return bad(res, 'incomplete');


  const links = searchLinks(artist, track);
  if (apple.appleUrl) links.appleMusic = { url: apple.appleUrl, exact: true };

  const hash = visitorHash(req);
  const day = today();
  const entry = {
    id: randomUUID(),
    trackId: apple.id,
    artist,
    track,
    art: apple.artwork ?? null,
    preview: apple.previewUrl
      ? { url: apple.previewUrl, seconds: 30, source: 'Apple Music' }
      : null,
    links,
    initials: initials || null,
    foldArtist: fold(artist),
    foldTrack: fold(track),
    submittedAt: Date.now(),
    playedAt: null,
    hidden: false,
  };

  // Nothing below reads-then-writes. The throttle is an atomic create, and the
  // song is its own blob at a unique path, so two visitors submitting in the
  // same instant cannot overwrite each other -- which is exactly what the
  // single-file version did.
  let songs;
  try {
    songs = await listSongs();
  } catch {
    return bad(res, 'busy');
  }

  // Leaving the same song twice makes the queue a wall rather than a shelf.
  const already = songs.some(s =>
    !s.playedAt && !s.hidden && sameTrack(s.foldArtist, s.foldTrack, entry.artist, entry.track));
  if (already) return bad(res, 'duplicate');

  let claimed = false;
  try {
    claimed = await claimSubmission(day, hash);
  } catch {
    return bad(res, 'busy');
  }
  if (!claimed) return bad(res, 'rate_limited');

  try {
    await writeSong(entry);
    await rebuildView();
  } catch {
    return bad(res, 'busy');
  }

  sweepThrottle(day).catch(() => {});
  return res.status(200).json({ ok: true, song: publicShape(entry) });
}
