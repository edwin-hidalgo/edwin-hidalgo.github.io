// The queue's storage, on Vercel Blob.
//
// ONE blob, read by its public URL. That shape is not an aesthetic choice, it
// is forced by the pricing: list() counts as an Advanced Operation, Hobby
// includes 2,000 of those a month, and a listing on every request behind a
// 30-second cache would spend the month's allowance in well under a day.
// Reading a public blob by URL is a Simple Operation, and a cache HIT is not
// billed at all -- so reads are effectively free and writes happen only when
// somebody actually leaves a song.
//
// The cost of one shared file is that two submissions landing together could
// clobber each other, so every write is conditional on the ETag that was read.
// A losing write retries against fresh content rather than overwriting it.
//
// Underscore-prefixed so Vercel treats it as a module rather than a route.

import { put, head } from '@vercel/blob';

const KEY = 'queue.json';
const EMPTY = { songs: [], throttle: {} };

// Vercel's CDN holds a blob for up to a month by default, which would mean a
// song left now showing up some time next week. The queue is small and changes,
// so it gets the same 30 seconds the rest of the site uses.
const CACHE_SECONDS = 30;

// Writes are rare and conflicts rarer, but a retry loop costs nothing and the
// alternative is silently losing somebody's submission.
const MAX_ATTEMPTS = 4;

export function blobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

// Returns { data, etag, url }. A store that has never been written to is not an
// error -- it is an empty queue, which is the correct answer on day one.
export async function readQueue() {
  try {
    const meta = await head(KEY);
    // useCache is not available for public blobs, so a just-written queue can
    // be up to CACHE_SECONDS stale on read. That is the same staleness the rest
    // of the site already accepts, and the ETag still makes writes safe.
    const res = await fetch(`${meta.url}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return { data: { ...EMPTY }, etag: meta.etag, url: meta.url };
    const data = await res.json();
    return {
      data: {
        songs: Array.isArray(data?.songs) ? data.songs : [],
        throttle: data?.throttle && typeof data.throttle === 'object' ? data.throttle : {},
      },
      etag: meta.etag,
      url: meta.url,
    };
  } catch {
    // head() throws BlobNotFoundError before the first write. Everything else
    // -- a network blip, a malformed body -- also lands here, and an empty
    // queue is a safer answer than a 500 on a page that is otherwise fine.
    return { data: { ...EMPTY }, etag: null, url: null };
  }
}

// Conditional on the ETag that came back from readQueue. Returns true if the
// write landed, false if someone else got there first.
export async function writeQueue(data, etag) {
  const body = JSON.stringify(data);
  try {
    await put(KEY, body, {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true,
      cacheControlMaxAge: CACHE_SECONDS,
      // Absent on the very first write, when there is nothing to conflict with.
      ...(etag ? { ifMatch: etag } : {}),
    });
    return true;
  } catch (err) {
    // A precondition failure means the blob moved under us. Anything else is a
    // real failure and should not be mistaken for a lost race.
    if (err?.name === 'BlobPreconditionFailedError') return false;
    throw err;
  }
}

// Read, change, write, and try again if the write lost a race. `mutate` is
// handed the current data and returns either the next data or null to abandon
// the write -- which is how "this visitor already submitted today" avoids
// writing anything at all.
export async function updateQueue(mutate) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { data, etag } = await readQueue();
    const next = await mutate(data);
    if (next === null) return { ok: false, conflict: false, data };
    if (await writeQueue(next, etag)) return { ok: true, conflict: false, data: next };
  }
  return { ok: false, conflict: true, data: null };
}
