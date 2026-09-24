// The pinned song: one track Edwin chose, and why.
//
// This is the authored half of the room and the reason it reads as a room
// rather than a readout -- a feed of scrobbles is data, a sentence about a song
// is a person. It sits in its own card, labelled, because nothing about a track
// sitting above a list says "this one is different and these words are mine".
//
// Edwin edits data/anchor.json by hand. An empty file renders nothing at all,
// so the room is never padded with a placeholder.

import { esc } from './format.js';
import { playFrom, rowKey, resolveTrack } from './track.js';
import { icon } from '../icons.js';
import * as player from '../player/engine.js';

const LABEL = 'Pinned';
let cached = null;

export async function loadAnchor() {
	if (cached !== null) return cached;
	try {
		const res = await fetch('data/anchor.json', { cache: 'no-cache' });
		const a = res.ok ? await res.json() : null;
		cached = a?.artist && a?.track ? a : false;
	} catch {
		cached = false;
	}
	return cached;
}

export async function render(el) {
	const a = await loadAnchor();
	if (!a) {
		el.hidden = true;
		return;
	}
	const key = rowKey(a, 0, 'pin');

	el.hidden = false;
	el.innerHTML = `<div class="pin-head"><p class="pin-label">${LABEL}</p></div>
		${a.note ? `<blockquote class="pin-note"><span class="pin-quote">${esc(a.note)}</span><span class="pin-cite">&mdash; Edwin</span></blockquote>` : ''}
		<button class="pin-track" type="button" data-key="${esc(key)}">
			<span class="pin-art"></span>
			<span class="pin-meta">
				<span class="pin-title">${esc(a.track)}</span>
				<span class="pin-artist">${esc(a.artist)}</span>
				${a.since ? `<span class="pin-since">${esc(a.since)}</span>` : ''}
			</span>
			<span class="pin-state">${icon.play(13)}</span>
		</button>`;

	const btn = el.querySelector('.pin-track');
	btn.addEventListener('click', () => {
		if (player.currentOwner() === key) return player.togglePlay();
		playFrom([a], 0, LABEL, 'pin');
	});

	const mark = () => {
		const mine = player.currentOwner() === key;
		btn.classList.toggle('is-playing', mine);
		btn.querySelector('.pin-state').innerHTML =
			mine && player.playState() === 'playing' ? icon.pause(13) : icon.play(13);
	};
	player.subscribe(reason => { if (reason !== 'progress') mark(); });
	mark();

	// anchor.json carries no artwork -- it is three strings Edwin typed. Resolve
	// it the same way a row does, which is why the pinned song used to be the
	// only thing in the room without a cover.
	const data = await resolveTrack(a.artist, a.track);
	if (data?.artwork) {
		const img = new Image();
		img.className = 'pin-art';
		img.alt = '';
		img.src = data.artwork;
		el.querySelector('.pin-art')?.replaceWith(img);
	}
}
