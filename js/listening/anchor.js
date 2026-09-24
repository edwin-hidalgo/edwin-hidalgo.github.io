// One track Edwin chose, and why.
//
// This is the authored half of the section and the reason it reads as a room
// rather than a readout: a feed of scrobbles is data, a sentence about a song
// is a person. Edwin edits data/anchor.json by hand; an empty file renders
// nothing at all, so the section is never padded with a placeholder.

import { esc } from './format.js';
import { playFrom, rowKey } from './track.js';
import * as player from '../player/engine.js';

const LABEL = 'Anthem';
let cached = null;

// Shared with the home page's Play button, which opens with the anthem before
// rolling into recent listens.
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

export async function render(el, getQuiet) {
	const a = await loadAnchor();
	if (!a) {
		el.hidden = true;
		return;
	}

	el.hidden = false;
	el.innerHTML = `${a.note ? `<p class="anchor-note">${esc(a.note)}</p>` : ''}
		<div class="row">
			<button class="row-open" type="button" data-key="${esc(rowKey(a, 0))}">
				<span class="row-body"><span class="row-title">${esc(a.artist)} &mdash; ${esc(a.track)}</span></span>
				<span class="row-when">${esc(a.since || 'on repeat')}</span>
				<span class="row-state" aria-hidden="true"></span>
			</button>
		</div>`;

	const btn = el.querySelector('.row-open');
	btn.addEventListener('click', () => {
		if (getQuiet()) return;
		if (player.currentOwner() === btn.dataset.key) return player.togglePlay();
		playFrom([a], 0, LABEL);
	});

	const mark = () => {
		const mine = player.currentOwner() === btn.dataset.key;
		btn.classList.toggle('is-playing', mine);
		btn.querySelector('.row-state').textContent =
			mine ? (player.playState() === 'playing' ? '❙❙' : '▶') : '';
	};
	player.subscribe(reason => { if (reason !== 'progress') mark(); });
	mark();
}
