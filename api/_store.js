// The queue's storage, on Vercel Blob.
//
// The shape here is the result of a bug that cost a real submission, so it is
// worth stating plainly. The first version kept one queue.json and did
// read-modify-write against it, guarded by the ETag from head(). That does not
// work on a PUBLIC store: head() returns a fresh ETag while the content read
// comes back stale, so the write is guarded by an ETag that does not describe
// the data it was built from. Two submissions seconds apart, and the first one
// vanished. Measured, not theorised -- and get({ useCache: false }) does not
// help either, because consistent reads are a private-storage feature.
//
// So nothing here does read-modify-write:
//
//   throttle/<day>/<hash>   created with allowOverwrite:false, which THROWS if
//                           it already exists. That is an atomic test-and-set
//                           with no read at all, which is exactly what a rate
//                           limit needs.
//   songs/<ts>-<id>.json    one blob per submission. Unique path, so two
//                           visitors can never collide.
//   queue.json              a derived view, rebuilt from a listing after each
//                           write. Reads hit this by public URL, where a cache
//                           HIT is not billed at all.
//
// Correctness lives in the per-submission blobs; queue.json is only a fast way
// to read them. If it is stale or lost, the next write rebuilds it from the
// blobs that actually matter. The cost of that is a new song taking up to a
// minute to appear, which is a fair trade against losing it altogether.
//
// The op budget drove this too: list() is an Advanced Operation and Hobby
// includes 2,000 a month, so listing per REQUEST would spend the month in under
// a day. Listing per WRITE is one call per song anyone leaves.
//
// Underscore-prefixed so Vercel treats it as a module rather than a route.

import { put, head, list, del } from '@vercel/blob';

const VIEW = 'queue.json';
const SONGS = 'songs/';
const THROTTLE = 'throttle/';

// queue.json changes only when somebody leaves a song. Thirty seconds matches
// the rest of the site.
const CACHE_SECONDS = 30;

export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

// The read path. One fetch of one public URL, and an empty queue is the correct
// answer before anyone has left anything.
export async function readView() {
  try {
    const meta = await head(VIEW);
    const res = await fetch(meta.url);
    if (!res.ok) return { songs: [] };
    const data = await res.json();
    return { songs: Array.isArray(data?.songs) ? data.songs : [] };
  } catch {
    // head() throws BlobNotFoundError before the first write.
    return { songs: [] };
  }
}

// The source of truth: every song blob, newest first. Costs one Advanced
// Operation, so it is only ever called on a write path.
export async function listSongs() {
  const songs = [];
  let cursor;
  do {
    const page = await list({ prefix: SONGS, cursor, limit: 1000 });
    cursor = page.cursor;
    // list() returns metadata, not contents, so each blob still has to be read.
    // They are tiny and there are few, and this runs only when someone writes.
    const bodies = await Promise.all(page.blobs.map(async b => {
      try {
        const r = await fetch(b.url);
        return r.ok ? await r.json() : null;
      } catch { return null; }
    }));
    for (const s of bodies) if (s?.id) songs.push(s);
  } while (cursor);
  return songs.sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
}

const songPath = s => `${SONGS}${s.submittedAt}-${s.id}.json`;

export async function writeSong(song) {
  await put(songPath(song), JSON.stringify(song), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
    cacheControlMaxAge: CACHE_SECONDS,
  });
}

// Rebuild the read view from the blobs that actually hold the data.
//
// Always re-lists rather than accepting the caller's array. Handing it the list
// the caller happened to have meant four simultaneous submissions produced four
// rebuilds from four partial snapshots, and the last one to land won -- the
// store held all five songs but the view showed four. Listing here means a
// rebuild always sees every write that finished before it started.
export async function rebuildView() {
  const list = await listSongs();
  await put(VIEW, JSON.stringify({ songs: list, builtAt: Date.now() }), {
    access: 'public',
    contentType: 'application/json',
    allowOverwrite: true,
    cacheControlMaxAge: CACHE_SECONDS,
  });
  return list;
}

// Atomic. allowOverwrite defaults to false, so a second attempt on the same day
// throws rather than quietly overwriting -- no read, so nothing to race.
// Returns true if this visitor had not already been counted today.
export async function claimSubmission(day, hash) {
  try {
    await put(`${THROTTLE}${day}/${hash}`, '1', {
      access: 'public',
      contentType: 'text/plain',
      cacheControlMaxAge: CACHE_SECONDS,
    });
    return true;
  } catch (err) {
    // The SDK reports an existing pathname as a plain error, so match on the
    // message as well as the typed variants rather than swallowing real
    // failures as "already claimed".
    const msg = String(err?.message ?? '');
    if (err?.name === 'BlobPathnameMismatchError' || /already exists/i.test(msg)) return false;
    throw err;
  }
}

// Yesterday's throttle entries are dead weight. Cheap to drop, and del() is
// free.
export async function sweepThrottle(keepDay) {
  try {
    const page = await list({ prefix: THROTTLE, limit: 1000 });
    const stale = page.blobs
      .filter(b => !b.pathname.startsWith(`${THROTTLE}${keepDay}/`))
      .map(b => b.url);
    if (stale.length) await del(stale);
  } catch {
    // Housekeeping. A failure here must never fail a submission.
  }
}
