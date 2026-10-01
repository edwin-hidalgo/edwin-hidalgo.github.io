// Hiding a song a visitor left, without the Vercel dashboard.
//
// The dashboard cannot do this cleanly. The page reads queue.json, a view that
// is rebuilt only when a song is left or a play is recorded. Deleting one
// song's blob therefore leaves it on the page, and deleting queue.json as well
// empties the whole list until the next visitor leaves something.
// api/queue.js already honours a `hidden` flag everywhere a song can surface:
// the queue, the "from" mark in the log, and the duplicate check. This is the
// thing that sets it.
//
//   node tools/song.mjs list
//   node tools/song.mjs hide <id>      the first few characters are enough
//   node tools/song.mjs unhide <id>
//
// Hiding keeps the song's blob, so it can always be undone. The page catches up
// within a minute or two: queue.json and /api/queue are each CDN-cached.
//
// Local only. tools/ is in .vercelignore, so none of this is ever deployed.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// An id prefix this short could match more than one song by accident.
const MIN_REF = 4;

// A blob overwritten moments ago can still read back stale from the CDN, which
// is the same trap that once cost this queue a submission. So the rebuild is
// checked rather than trusted, and retried until it has seen the change.
const REBUILD_TRIES = 8;
const REBUILD_WAIT_MS = 15_000;

export function findSong(songs, ref) {
	const r = String(ref ?? '').trim().toLowerCase();
	if (r.length < MIN_REF) return { error: `give at least ${MIN_REF} characters of the id` };
	const hits = songs.filter(s => String(s.id).toLowerCase().startsWith(r));
	if (hits.length === 0) return { error: `no song id starts with "${r}"` };
	if (hits.length > 1) return { error: `"${r}" matches ${hits.length} songs; give more of the id` };
	return { song: hits[0] };
}

export function withHidden(song, hidden, now = Date.now()) {
	return { ...song, hidden, hiddenAt: hidden ? now : null };
}

const day = ms => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');

export function describe(s) {
	const parts = [
		String(s.id).slice(0, 8),
		`${s.artist} — ${s.track}`,
		s.initials ? `· ${s.initials}` : '· unsigned',
		`· left ${day(s.submittedAt)}`,
		s.playedAt ? `· played ${day(s.playedAt)}` : '· waiting',
	];
	if (s.hidden) parts.push('· HIDDEN');
	return parts.join('  ');
}

// store is { listSongs, writeSong, rebuildView }: api/_store.js in real use,
// a fake in the tests. Returns the process exit code.
export async function run(argv, store, log = console.log, wait = ms => new Promise(r => setTimeout(r, ms))) {
	const [cmd, ref] = argv;

	if (cmd === 'list') {
		const songs = await store.listSongs();
		if (!songs.length) log('No songs have been left.');
		for (const s of songs) log(describe(s));
		return 0;
	}

	if (cmd !== 'hide' && cmd !== 'unhide') {
		log('usage: node tools/song.mjs list | hide <id> | unhide <id>');
		return 2;
	}

	const hidden = cmd === 'hide';
	const found = findSong(await store.listSongs(), ref);
	if (found.error) { log(found.error); return 1; }

	if (Boolean(found.song.hidden) === hidden) {
		log(`Already ${hidden ? 'hidden' : 'showing'}: ${describe(found.song)}`);
		return 0;
	}

	const next = withHidden(found.song, hidden);
	await store.writeSong(next);

	for (let i = 1; i <= REBUILD_TRIES; i++) {
		const view = await store.rebuildView();
		const seen = view.find(s => s.id === next.id);
		if (seen && Boolean(seen.hidden) === hidden) {
			log(`${hidden ? 'Hidden' : 'Showing again'}: ${describe(next)}`);
			log('The Lounge reflects it within a minute or two.');
			return 0;
		}
		if (i < REBUILD_TRIES) await wait(REBUILD_WAIT_MS);
	}

	// The song's own blob is already right, and the next write anywhere
	// rebuilds the view from it. Say so rather than claiming success.
	log(`Saved, but the view has not caught up yet: ${describe(next)}`);
	log('Run the same command again in a minute to rebuild it.');
	return 1;
}

// Same parsing as tools/serve.mjs: .env first, then .env.local, which holds the
// Blob token written by the Vercel CLI.
function loadEnv() {
	for (const name of ['.env', '.env.local']) {
		if (!existsSync(join(ROOT, name))) continue;
		for (const line of readFileSync(join(ROOT, name), 'utf8').split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	loadEnv();
	if (!process.env.BLOB_READ_WRITE_TOKEN) {
		console.log('No BLOB_READ_WRITE_TOKEN. Run `vercel env pull .env.local` in the repo first.');
		process.exit(1);
	}
	const store = await import('../api/_store.js');
	process.exit(await run(process.argv.slice(2), store));
}
