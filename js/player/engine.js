// The playback engine, ported from Onus (app/src/lib/previewPlayer.ts).
//
// A module singleton: the audio element lives outside any component or page
// section, so js/nav.js can swap the document's contents underneath it and the
// music keeps going.
//
// The semantics below are Onus's, carried over deliberately. Each one exists
// because something broke without it, and its own comments record what:
//
//   "Clicking one song now means 'start here and keep going', everywhere -- a
//    single preview that stops dead after 30 seconds was the odd one out."
//                                          -- previewPlayer.ts, 2026-08-06
//
// That is the bug this file exists to not have. There are two entry points and
// choosing the wrong one reintroduces it:
//
//   togglePreview(url)   one track, queue cleared. Stops after 30 seconds.
//   playFromList(...)    start here and keep going. What a row click uses.
//   playAllLazy(...)     same, for a list whose URLs are not resolved yet.

const AUDIO_OK = typeof Audio !== 'undefined';

let audio = null;
let current = null;
let paused = false;
let progress = 0;
let volume = 1;

let queue = [];        // urls still to play
let history = [];      // urls already passed, for stepping back
let lastQueue = [];    // the whole of the last run, for replay
let runningAll = false; // a list run owns playback, as opposed to one row
let label = '';

// Bumped per lazy run so an older pump abandons quietly when a newer one starts.
let runId = 0;
let pumping = false;
// Set when the playhead drains the queue while a pump is still resolving. Onus
// stops the run here, which kills the pump mid-list with resolvers unused; we
// wait for the pump to hand us the next URL instead.
let starved = false;

const meta = new Map();
const subs = new Set();
// -Infinity, not 0: with 0 the very first press reads as a double-press for
// any clock whose epoch is under three seconds. Onus only avoids this because
// Date.now() is always large.
let lastBack = -Infinity;

function emit(reason) {
	for (const fn of subs) fn(reason);
}

export function subscribe(fn) {
	subs.add(fn);
	return () => subs.delete(fn);
}

export function setUrlMeta(url, m) {
	if (url) meta.set(url, { ...(meta.get(url) || {}), ...m });
}

export function nowPlaying() {
	if (!current) return null;
	const m = meta.get(current);
	return m ? { ...m, url: current } : { url: current, owner: '', artist: '', track: '' };
}

export const currentOwner = () => (current ? meta.get(current)?.owner ?? null : null);
export const isPaused = () => paused;
export const progressNow = () => progress;
export const queueLabel = () => label;
export const setQueueLabel = v => { label = v || ''; emit(); };
export const hasLastQueue = () => lastQueue.length > 0;
export const isRunningAll = () => runningAll;
export const elapsed = () => (audio ? audio.currentTime : 0);
export const duration = () => (audio && Number.isFinite(audio.duration) ? audio.duration : 0);
export const getVolume = () => volume;
export const isCurrent = url => Boolean(url) && current === url;

// 'playing' | 'paused' | 'idle'. Derived from the audio element, never from
// runningAll -- Onus notes the two disagreed and the bar showed "paused" over
// audible playback.
export function playState() {
	if (!current) return 'idle';
	return paused ? 'paused' : 'playing';
}

function stop() {
	audio?.pause();
	audio = null;
	current = null;
	queue = [];
	runningAll = false;
	starved = false;
	// history, lastQueue, label, progress and paused are deliberately kept: they
	// are what lets the bar outlive a finished run and offer to replay it.
	emit();
}

export const stopAll = stop;

function play(url) {
	if (!AUDIO_OK) return;
	audio?.pause();
	const el = new Audio(url);
	el.volume = volume;
	audio = el;
	current = url;
	paused = false;

	// Recreated per element, closing over this url so a stale element cannot
	// advance the run after it has been superseded.
	const advance = () => {
		if (current !== url) return;
		const next = queue.shift();
		if (next) {
			if (runningAll && current) history.push(current);
			return play(next);
		}
		// Nothing queued. If a lazy pump is still resolving, wait for it rather
		// than ending a run that has tracks left.
		if (runningAll && pumping) {
			starved = true;
			audio?.pause();
			return emit();
		}
		stop();
	};

	el.addEventListener('ended', advance);
	// A dead preview must not end the run -- Apple rotates these URLs.
	el.addEventListener('error', advance);
	el.addEventListener('pause', () => { paused = true; emit(); });
	el.addEventListener('play', () => { paused = false; emit(); });

	// A rejected play() is autoplay policy or a network failure. Treat it like a
	// finished track so the run never sits on a stuck pause.
	el.play().catch(advance);
	emit();
}

export function togglePreview(url, info) {
	if (info) setUrlMeta(url, info);
	if (current === url && audio) {
		if (audio.paused) audio.play().catch(() => stop());
		else audio.pause();
		return emit();
	}
	queue = [];
	runningAll = false;
	play(url);
}

// Start here and keep going. queue is the tail, history the head -- so stepping
// back works into tracks that were never heard -- and lastQueue is the whole
// list, so a replay restarts from the top rather than from where you clicked.
export function playFromList(urls, startIndex = 0) {
	const list = urls.filter(Boolean);
	if (!list.length) return;
	const i = Math.max(0, Math.min(startIndex, list.length - 1));
	queue = list.slice(i + 1);
	history = list.slice(0, i);
	lastQueue = list;
	runningAll = true;
	starved = false;
	play(list[i]);
}

// Play a list whose URLs do not exist yet.
//
// Our rows carry artist and title; a preview URL needs a call to /api/resolve.
// Resolving a hundred of them before a single note plays would be absurd, so
// this resolves a short way ahead of the playhead: start the first track the
// moment it lands, keep a small buffer filling behind it, and skip silently
// past anything that will not resolve.
export async function playAllLazy(resolvers, lookahead = 3, replace = false) {
	if (runningAll && !replace) {
		stop();
		return;
	}
	runId++;
	const myRun = runId;
	audio?.pause();
	runningAll = true;
	queue = [];
	history = [];
	lastQueue = [];
	starved = false;
	pumping = true;

	let started = false;
	let i = 0;

	try {
		while (i < resolvers.length && runningAll && runId === myRun) {
			// No point resolving track forty while track two is playing.
			if (started && !starved && queue.length >= lookahead) {
				await new Promise(r => setTimeout(r, 400));
				continue;
			}
			let url = null;
			try {
				url = await resolvers[i++]();
			} catch {
				url = null;
			}
			// Re-check after the await: the run may have been stopped or
			// superseded while the request was in flight.
			if (!url || !runningAll || runId !== myRun) continue;

			lastQueue.push(url);
			if (!started) {
				started = true;
				play(url);
			} else if (starved) {
				// The playhead caught up with us while we were resolving.
				starved = false;
				if (current) history.push(current);
				play(url);
			} else {
				queue.push(url);
			}
		}
	} finally {
		if (runId === myRun) {
			pumping = false;
			// Ran out of resolvers with the playhead waiting: that is the end.
			if (starved) stop();
		}
	}
}

export function skipNext() {
	if (!runningAll) return;
	const next = queue.shift();
	if (next) {
		if (current) history.push(current);
		return play(next);
	}
	if (pumping) { starved = true; return emit(); }
	stop();
}

// Restart the current preview; pressed again within three seconds, step back a
// track. The behaviour every player has, so it needs no label.
export function skipBack(now = Date.now()) {
	if (!current) return;
	const doublePress = now - lastBack < 3000;
	lastBack = now;
	if (doublePress && history.length) {
		const prev = history.pop();
		queue.unshift(current);
		return play(prev);
	}
	play(current);
}

export function togglePlay() {
	if (!audio) return replayLast();
	if (audio.paused) audio.play().catch(() => stop());
	else audio.pause();
	emit();
	return true;
}

// Pressing play on the bar after everything has stopped restarts the last run;
// otherwise the bar's most obvious control would do nothing.
export function replayLast() {
	if (!lastQueue.length) return false;
	playFromList(lastQueue, 0);
	return true;
}

export function seek(fraction) {
	if (!audio || !Number.isFinite(audio.duration) || !audio.duration) return;
	audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
	emit();
}

export function setVolume(v) {
	volume = Math.max(0, Math.min(1, v));
	if (audio) audio.volume = volume;
	emit();
}

// Progress is sampled per frame rather than from 'timeupdate', which fires
// about four times a second and stepped in visible jumps across a 30-second bar.
if (AUDIO_OK && typeof requestAnimationFrame === 'function') {
	const tick = () => {
		if (audio && audio.duration) {
			const p = audio.currentTime / audio.duration;
			if (Math.abs(p - progress) > 0.0005) {
				progress = p;
				emit('progress');
			}
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}
