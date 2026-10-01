// Every state these two functions can reach, exercised without a Last.fm key,
// without a network, and without a deploy. The upstream is stubbed, so what is
// under test is our handling — which is the part that breaks.
//
//   node test/run.mjs

import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import lately from '../api/lately.js';
import resolve from '../api/resolve.js';
import { fold, sameish, sameTrack } from '../api/_fold.js';
import { visible, marksFor, newlyPlayed } from '../api/queue.js';
import { findSong, run as songTool } from '../tools/song.mjs';

let pass = 0;
let fail = 0;

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}  ${detail}`); }
}

// A req/res pair thin enough to see through.
function fakeRes() {
  const r = { headers: {}, code: null, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}

// Swap the global fetch for one canned answer, run the handler, restore.
async function withFetch(impl, run) {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await run(); } finally { globalThis.fetch = real; }
}

const jsonRes = body => ({ ok: true, json: async () => body });
const track = (name, artist, extra = {}) => ({
  name, artist: { '#text': artist }, album: { '#text': 'An Album' },
  url: 'https://last.fm/x',
  image: [{ '#text': 'https://img/s.png' }, { '#text': 'https://img/xl.png' }],
  ...extra,
});

const env = { ...process.env };
function setEnv(o) {
  process.env.LASTFM_API_KEY = o.key ?? '';
  process.env.LASTFM_USER = o.user ?? '';
  if (o.paused) process.env.LISTENING_PAUSED = '1';
  else delete process.env.LISTENING_PAUSED;
}

// ── lately ──────────────────────────────────────────────────────────────────
console.log('\nlately');

setEnv({ key: 'k', user: 'u', paused: true });
let res = fakeRes();
await withFetch(() => { throw new Error('must not call upstream while paused'); },
  () => lately({ query: {} }, res));
ok('paused   short-circuits before any upstream call', res.body?.paused === true && res.code === 200);
ok('paused   still says nothing about listening', !('recent' in res.body) && !('nowPlaying' in res.body));

setEnv({ key: '', user: '' });
res = fakeRes();
await withFetch(() => { throw new Error('must not call upstream without a key'); },
  () => lately({ query: {} }, res));
ok('no key   empty state, not a crash', res.code === 200 && Array.isArray(res.body.recent) && res.body.recent.length === 0);

setEnv({ key: 'k', user: 'u' });
res = fakeRes();
await withFetch(async () => jsonRes({ error: 17, message: 'Login: ...' }),
  () => lately({ query: {} }, res));
ok('error 17 reads as private, not as failure', res.body?.private === true && res.code === 200);

res = fakeRes();
await withFetch(async () => jsonRes({ error: 6, message: 'No user' }),
  () => lately({ query: {} }, res));
ok('error 6  falls to empty state', res.code === 200 && res.body.recent.length === 0 && !res.body.private);

res = fakeRes();
await withFetch(async () => ({ ok: false, status: 503 }), () => lately({ query: {} }, res));
ok('upstream 503 falls to empty state', res.code === 200 && res.body.recent.length === 0);

res = fakeRes();
await withFetch(async () => { throw new Error('timeout'); }, () => lately({ query: {} }, res));
ok('timeout  falls to empty state', res.code === 200 && res.body.recent.length === 0);

res = fakeRes();
await withFetch(async () => jsonRes({ recenttracks: { track: [
  track('Live One', 'A', { '@attr': { nowplaying: 'true' } }),
  track('Older', 'B', { date: { uts: '1750000000' } }),
] } }), () => lately({ query: {} }, res));
ok('nowplaying separated from recent', res.body.nowPlaying?.track === 'Live One' && res.body.recent.length === 1);
ok('nowplaying carries no timestamp', res.body.nowPlaying.playedAt === null);
ok('finished track keeps its timestamp (ms)', res.body.recent[0].playedAt === 1750000000000);
ok('fetchedAt stamped for the freshness check', typeof res.body.fetchedAt === 'number');
ok('largest real artwork chosen', res.body.nowPlaying.art === 'https://img/xl.png');

res = fakeRes();
await withFetch(async () => jsonRes({ recenttracks: { track:
  track('Only One', 'A', { date: { uts: '1750000000' } }) } }), () => lately({ query: {} }, res));
ok('single scrobble returned as object, not array', res.body.recent.length === 1 && res.body.recent[0].track === 'Only One');

res = fakeRes();
await withFetch(async () => jsonRes({ recenttracks: { track: [
  track('Grey Star', 'A', { date: { uts: '1750000000' },
    image: [{ '#text': 'https://img/2a96cbd8b46e442fc41c2b86b821562f.png' }] }),
] } }), () => lately({ query: {} }, res));
ok('placeholder artwork rejected as no artwork', res.body.recent[0].art === null);

res = fakeRes();
await withFetch(async () => jsonRes({ recenttracks: { track: [
  track('', 'A', { date: { uts: '1' } }), track('Real', 'B', { date: { uts: '2' } }),
] } }), () => lately({ query: {} }, res));
ok('nameless rows dropped', res.body.recent.length === 1 && res.body.recent[0].track === 'Real');

ok('cache header set on every answer', /s-maxage=30/.test(res.headers['cache-control']));

// The key must never travel. Nothing in any response body may contain it.
setEnv({ key: 'SECRET_KEY_VALUE', user: 'u' });
res = fakeRes();
await withFetch(async () => jsonRes({ recenttracks: { track: [track('T', 'A', { date: { uts: '1' } })] } }),
  () => lately({ query: {} }, res));
ok('api key absent from the response body', !JSON.stringify(res.body).includes('SECRET_KEY_VALUE'));

// ── resolve ─────────────────────────────────────────────────────────────────
console.log('\nresolve');

res = fakeRes();
await resolve({ query: { artist: '' } }, res);
ok('missing params rejected', res.code === 400);

const appleHit = {
  results: [{
    artistName: 'Nick Drake', trackName: 'Pink Moon',
    artworkUrl100: 'https://is1.mzstatic.com/x/100x100bb.jpg',
    trackViewUrl: 'https://music.apple.com/track/1',
    previewUrl: 'https://audio-ssl.itunes.apple.com/p.m4a',
  }],
};
const q = { artist: 'Nick Drake', track: 'Pink Moon' };

res = fakeRes();
await withFetch(async () => jsonRes(appleHit), () => resolve({ query: q }, res));
ok('preview found', res.body.capability === 'preview' && res.body.preview.seconds === 30);
ok('artwork upscaled past the 100px thumb', res.body.artwork.includes('400x400'));
ok('apple link marked exact', res.body.links.appleMusic.exact === true);
ok('search links always offered', res.body.links.spotify.url.includes('open.spotify.com/search'));
ok('search links marked not exact', res.body.links.spotify.exact === false);

res = fakeRes();
await withFetch(async () => jsonRes({ results: [{
  artistName: 'Somebody Else', trackName: 'A Different Song',
  previewUrl: 'https://audio/p.m4a', trackViewUrl: 'https://music.apple.com/track/9',
}] }), () => resolve({ query: q }, res));
ok('wrong hit refused rather than offered', res.body.found === false && res.body.preview === null);
ok('refusal still leaves somewhere to go', res.body.capability === 'link' && !res.body.links.appleMusic);

res = fakeRes();
await withFetch(async () => jsonRes({ results: [{
  artistName: 'Nick Drake (feat. Nobody)', trackName: 'Pink Moon (2011 Remaster)',
  previewUrl: 'https://audio/p.m4a', trackViewUrl: 'https://music.apple.com/track/2',
}] }), () => resolve({ query: q }, res));
ok('remaster and feat. still match', res.body.found === true);

// Regression: an earlier fold() counted "with" as a featuring marker, so any
// title beginning with it folded to an empty string and was refused. Apple had
// the track the whole time. Measured against pescatios' real scrobbles.
res = fakeRes();
await withFetch(async () => jsonRes({ results: [{
  artistName: 'N\u00f8rus', trackName: 'With Love, Pt.7 (2024 Remaster)',
  previewUrl: 'https://audio/p.m4a', trackViewUrl: 'https://music.apple.com/track/7',
}] }), () => resolve({ query: { artist: 'N\u00f8rus', track: 'With Love, Pt. 7' } }, res));
ok('title starting with "With" still matches', res.body.found === true);

res = fakeRes();
await withFetch(async () => jsonRes({ results: [{
  artistName: 'Billy Idol', trackName: 'Dancing With Myself',
  previewUrl: 'https://audio/p.m4a', trackViewUrl: 'https://music.apple.com/track/8',
}] }), () => resolve({ query: { artist: 'Billy Idol', track: 'Dancing With Myself' } }, res));
ok('"with" mid-title is not a featuring credit', res.body.found === true);

res = fakeRes();
await withFetch(async () => { throw new Error('apple down'); }, () => resolve({ query: q }, res));
ok('apple down still yields search links', res.code === 200 && res.body.capability === 'link');
ok('apple down sets found false', res.body.found === false && res.body.preview === null);
ok('resolve cached for a day', /s-maxage=86400/.test(res.headers['cache-control']));

// Odesli's keyless endpoint answers 401 PUBLIC_API_ACCESS_DEPRECATED as of
// 2026-09-21. Nothing here may call it, or every resolve pays a dead request.
ok('no call to the retired odesli endpoint',
  !(await import('node:fs')).readFileSync(new URL('../api/resolve.js', import.meta.url), 'utf8')
    .includes('api.song.link'));

// ── player engine ───────────────────────────────────────────────────────────
// The engine reads `Audio` at module scope, so it is stubbed before the import.
console.log('\nplayer');

class FakeAudio {
	constructor(src) {
		this.src = src; this.paused = false; this.duration = 30;
		this.currentTime = 0; this.volume = 1; this.h = {};
		FakeAudio.made.push(this);
	}
	addEventListener(t, f) { (this.h[t] ||= []).push(f); }
	play() { this.paused = false; return Promise.resolve(); }
	pause() { this.paused = true; }
	fire(t) { for (const f of this.h[t] || []) f(); }
}
FakeAudio.made = [];
globalThis.Audio = FakeAudio;

const flush = () => new Promise(r => setTimeout(r, 0));
async function freshEngine() {
	FakeAudio.made = [];
	// A cache-busting query gives each test its own module singleton.
	return import(`../js/player/engine.js?t=${Math.random()}`);
}
const last = () => FakeAudio.made[FakeAudio.made.length - 1];

let p = await freshEngine();
p.playFromList(['a.mp3', 'b.mp3', 'c.mp3'], 0);
ok('playFromList starts at the given index', p.nowPlaying().url === 'a.mp3');
last().fire('ended');
ok('a finished track advances to the next', p.nowPlaying().url === 'b.mp3',
   'THIS is the 30-second bug: without it playback stops here');
last().fire('ended');
ok('and keeps going through the list', p.nowPlaying().url === 'c.mp3');
last().fire('ended');
ok('the end of the list stops playback', p.nowPlaying() === null);
ok('but the run is remembered for replay', p.hasLastQueue() === true);
ok('replayLast restarts from the top', p.replayLast() && p.nowPlaying().url === 'a.mp3');

p = await freshEngine();
p.playFromList(['a.mp3', 'b.mp3', 'c.mp3'], 2);
ok('starting mid-list plays from there', p.nowPlaying().url === 'c.mp3');

p = await freshEngine();
p.playFromList(['a.mp3', 'b.mp3', 'c.mp3'], 0);
last().fire('error');
ok('a dead preview skips rather than stalling', p.nowPlaying().url === 'b.mp3');

p = await freshEngine();
p.playFromList(['a.mp3', 'b.mp3'], 1);
p.skipBack(1000);
ok('skipBack restarts the current track', p.nowPlaying().url === 'b.mp3');
p.skipBack(1500);
ok('pressed twice quickly it steps back', p.nowPlaying().url === 'a.mp3');

p = await freshEngine();
p.setUrlMeta('a.mp3', { owner: 'Lately', artist: 'A', track: 'One' });
p.setUrlMeta('b.mp3', { owner: 'Anthem', artist: 'B', track: 'Two' });
p.playFromList(['a.mp3', 'b.mp3'], 0);
ok('metadata reaches the bar', p.nowPlaying().artist === 'A' && p.nowPlaying().track === 'One');
ok('owner follows the current track', p.currentOwner() === 'Lately');
last().fire('ended');
ok('and moves with it', p.currentOwner() === 'Anthem');

p = await freshEngine();
p.togglePreview('solo.mp3');
last().fire('ended');
ok('togglePreview really is one track only', p.nowPlaying() === null);

p = await freshEngine();
const calls = [];
const r = u => () => { calls.push(u); return Promise.resolve(u); };
const run = p.playAllLazy([r('x.mp3'), () => Promise.resolve(null), r('z.mp3')], 3);
await flush(); await flush(); await flush();
ok('lazy run starts as soon as the first url lands', p.nowPlaying()?.url === 'x.mp3');
await run;
ok('a resolver returning null is skipped silently', p.hasLastQueue() && !calls.includes(null));
last().fire('ended');
ok('lazy run advances to the next resolved url', p.nowPlaying()?.url === 'z.mp3');

p = await freshEngine();
const thrown = p.playAllLazy([() => { throw new Error('boom'); }, r('ok.mp3')], 3);
await flush(); await flush(); await flush();
await thrown;
ok('a resolver that throws is treated as a miss', p.nowPlaying()?.url === 'ok.mp3');

p = await freshEngine();
p.playFromList(['a.mp3', 'b.mp3'], 0);
p.stopAll();
ok('stopAll clears playback', p.nowPlaying() === null);
ok('stopAll keeps the last run', p.hasLastQueue() === true);

// ── the queue's matching ────────────────────────────────────────────────────
//
// This is what decides whether the site says Edwin played a song someone left
// for him. A false positive puts words in his mouth, so the loose test is
// deliberately not allowed to run on short strings.
console.log('\nqueue matching');

ok('a remaster still matches the plain title',
  sameish(fold('Pink Moon'), fold('Pink Moon (2011 Remaster)')));

ok('a featuring credit still matches',
  sameish(fold('Nikes'), fold('Nikes (feat. Someone)')));

ok('short titles require exact agreement, not containment',
  sameish(fold('DNA'), fold('DNA')) && !sameish(fold('One'), fold('One More Time')));

ok('both halves have to agree',
  sameTrack(fold('Nick Drake'), fold('Pink Moon'), 'Nick Drake', 'Pink Moon (2011 Remaster)')
  && !sameTrack(fold('Nick Drake'), fold('Pink Moon'), 'Someone Else', 'Pink Moon'));

ok('a cover by another artist is not the same track',
  !sameTrack(fold('Bon Iver'), fold('Holocene'), 'Vitamin String Quartet', 'Holocene'));

ok('empty folds never match',
  !sameish('', '') && !sameTrack('', '', 'a', 'b'));

// The regression the shared fold() exists to protect: an earlier version
// treated "with" as a featuring marker and ate the whole title.
ok('"With Love, Pt. 7" survives folding', fold('With Love, Pt. 7') === 'withlovept7');
ok('"Dancing With Myself" survives folding', fold('Dancing With Myself') === 'dancingwithmyself');

// ── hiding a song ───────────────────────────────────────────────────────────
//
// tools/song.mjs is how a song Edwin does not want comes off the page. These
// pin both halves: the tool flags exactly one song, and every surface the page
// reads leaves a flagged song out.
console.log('\nhiding a song');

const left = (id, extra = {}) => ({
  id, artist: 'lvusm', track: 'Meow', initials: 'CH',
  submittedAt: 1, playedAt: null, hidden: false, ...extra,
});
const heard = { playedAt: Date.now(), matchedArtist: 'lvusm', matchedTrack: 'Meow' };

ok('the queue leaves a hidden song out',
  visible([left('a1'), left('b2', { hidden: true })]).map(s => s.id).join() === 'a1');
ok('the log drops its "from" mark when the song is hidden',
  marksFor([left('a1', { ...heard, hidden: true })]).length === 0
  && marksFor([left('a1', heard)]).length === 1);

ok('a unique id prefix finds its song',
  findSong([left('abcd-1'), left('abce-2')], 'abcd').song?.id === 'abcd-1');
ok('an ambiguous prefix is refused, not guessed',
  Boolean(findSong([left('abcd-1'), left('abcd-2')], 'abcd').error));
ok('a too-short prefix is refused', Boolean(findSong([left('abcd-1')], 'ab').error));
ok('an unknown id is refused', Boolean(findSong([left('abcd-1')], 'zzzz').error));

// Behaves like the real store, including the part that bit before: a blob
// overwritten moments ago can read back stale, so a rebuild may not see it yet.
function fakeStore(songs, { staleRebuilds = 0 } = {}) {
  const before = songs.map(s => ({ ...s }));
  const blobs = new Map(songs.map(s => [s.id, s]));
  const st = { writes: [], rebuilds: 0 };
  st.listSongs = async () => [...blobs.values()];
  st.writeSong = async s => { st.writes.push(s); blobs.set(s.id, s); };
  st.rebuildView = async () => (++st.rebuilds <= staleRebuilds ? before : [...blobs.values()]);
  return st;
}
const quiet = () => {};
const noWait = async () => {};

let store = fakeStore([left('abcd-1'), left('efgh-2')]);
let code = await songTool(['hide', 'abcd'], store, quiet, noWait);
ok('hide writes exactly one song, flagged',
  code === 0 && store.writes.length === 1
  && store.writes[0].id === 'abcd-1' && store.writes[0].hidden === true);
ok('hide leaves every other song alone',
  (await store.listSongs()).find(s => s.id === 'efgh-2').hidden === false);

code = await songTool(['unhide', 'abcd'], store, quiet, noWait);
ok('unhide reverses it',
  code === 0 && store.writes.at(-1).hidden === false && store.writes.at(-1).hiddenAt === null);

store = fakeStore([left('abcd-1', { hidden: true })]);
code = await songTool(['hide', 'abcd'], store, quiet, noWait);
ok('hiding a hidden song writes nothing', code === 0 && store.writes.length === 0);

store = fakeStore([left('abcd-1')], { staleRebuilds: 2 });
code = await songTool(['hide', 'abcd'], store, quiet, noWait);
ok('a stale rebuild is retried until it has seen the change', code === 0 && store.rebuilds === 3);

store = fakeStore([left('abcd-1')], { staleRebuilds: 99 });
code = await songTool(['hide', 'abcd'], store, quiet, noWait);
ok('a view that never catches up is reported, not claimed as done', code === 1);

store = fakeStore([left('abcd-1'), left('abcd-2')]);
code = await songTool(['hide', 'abcd'], store, quiet, noWait);
ok('an ambiguous id writes nothing', code === 1 && store.writes.length === 0);

// When a play is detected, only the song it changed is saved. Re-saving every
// played song wrote back copies that could be a minute stale -- un-hiding a
// song hidden in that minute.
const waiting = { ...left('w1'), artist: 'Nick Drake', track: 'Pink Moon',
  foldArtist: fold('Nick Drake'), foldTrack: fold('Pink Moon') };
const playedBefore = { ...left('p1', heard), foldArtist: fold('lvusm'), foldTrack: fold('Meow') };
const hiddenSong = { ...left('h1', { hidden: true }), artist: 'Bon Iver', track: 'Holocene',
  foldArtist: fold('Bon Iver'), foldTrack: fold('Holocene') };
const scrobbles = [
  { artist: 'Nick Drake', track: 'Pink Moon (2011 Remaster)', playedAt: 5 },
  { artist: 'lvusm', track: 'Meow', playedAt: 6 },
  { artist: 'Bon Iver', track: 'Holocene', playedAt: 7 },
];
const toWrite = newlyPlayed([waiting, playedBefore, hiddenSong], scrobbles);
ok('a new play saves only the song it matched',
  toWrite.length === 1 && toWrite[0].id === 'w1' && toWrite[0].playedAt === 5);
ok('a song already marked played is not saved again', !toWrite.some(s => s.id === 'p1'));
ok('a hidden song is never marked played', !toWrite.some(s => s.id === 'h1'));
ok('no new play saves nothing', newlyPlayed([playedBefore, hiddenSong], scrobbles).length === 0);

// ── what a shared link shows, and what a photo gives away ───────────────────
//
// Every page carries a complete preview card. And no photograph in the repo
// carries a location: one did, a 2019 portrait still served from the domain
// with its GPS block intact, long after nothing on the site used it.
console.log('\nlink previews and photos');

const SITE = 'https://www.edwinhidalgo.com/';
const repoFile = rel => new URL(`../${rel}`, import.meta.url);

for (const page of ['index.html', 'portfolio.html', 'lounge.html']) {
  const html = readFileSync(repoFile(page), 'utf8');
  const meta = key => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];
  const image = meta('og:image') ?? '';
  ok(`${page} carries a complete preview card`,
    Boolean(meta('og:title') && meta('og:description') && meta('og:url'))
    && image.startsWith(SITE) && existsSync(repoFile(image.slice(SITE.length)))
    && meta('twitter:card') === 'summary_large_image');
}
// WhatsApp silently drops preview images much over 300 KB.
ok('the preview image is small enough for every app', statSync(repoFile('img/og.jpg')).size < 300_000);

// Walks a JPEG's markers to the Exif segment and looks for the GPSInfo pointer
// (tag 0x8825) in its first directory.
function jpegHasGps(buf) {
  let i = 2;
  while (i + 4 <= buf.length && buf[i] === 0xFF) {
    const marker = buf[i + 1];
    if (marker === 0xDA) break; // image data starts; no metadata after this
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xE1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') {
      const t = i + 10;
      const le = buf.toString('latin1', t, t + 2) === 'II';
      const u16 = o => (le ? buf.readUInt16LE(t + o) : buf.readUInt16BE(t + o));
      const u32 = o => (le ? buf.readUInt32LE(t + o) : buf.readUInt32BE(t + o));
      const ifd = u32(4);
      for (let k = 0; k < u16(ifd); k++) if (u16(ifd + 2 + k * 12) === 0x8825) return true;
      return false;
    }
    i += 2 + len;
  }
  return false;
}
const jpegsUnder = dir => readdirSync(repoFile(dir), { recursive: true })
  .filter(f => /\.jpe?g$/i.test(f)).map(f => `${dir}/${f}`);
const located = [...jpegsUnder('img'), ...jpegsUnder('tools')]
  .filter(f => jpegHasGps(readFileSync(repoFile(f))));
ok('no photograph in the repo carries a GPS location', located.length === 0, located.join(', '));

Object.assign(process.env, env);
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
