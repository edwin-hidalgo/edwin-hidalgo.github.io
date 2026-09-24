// What Edwin has been hearing.
//
// The whole list is playable and continuous: clicking any row starts there and
// keeps going through everything below it. The rows carry no preview URL --
// that is resolved a few ahead of the playhead by the player -- so a hundred
// tracks cost nothing until someone presses play.
//
// Four answers come back from /api/lately -- paused, private, empty, normal --
// and every one has to read like a finished thought rather than a failure. A
// room with nothing to say is still a room.

import { isLive, timeAgo, esc } from './format.js';
import { playFrom, rowKey } from './track.js';
import * as player from '../player/engine.js';

const LABEL = 'Lately';

function artwork(url, cls) {
	if (!url) return `<span class="${cls}"></span>`;
	return `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">`;
}

function heroMarkup(payload, item) {
	const live = isLive(payload);
	let when;
	// The nowplaying flag can outlive the response it arrived in: /api/lately is
	// cached for 30s and served stale for 60 more. Rather than drop the track or
	// overclaim it, say something true but vaguer.
	if (live) when = '<span class="live-dot"></span>listening now';
	else if (payload.nowPlaying) when = 'a moment ago';
	else when = timeAgo(item.playedAt);

	return `<button class="now" type="button" data-i="0" data-key="${esc(rowKey(item, 0))}">
			${artwork(item.art, 'now-art')}
			<span class="now-body">
				<span class="now-title">${esc(item.artist)} &mdash; ${esc(item.track)}</span>
				<span class="meta">${when}</span>
			</span>
			<span class="row-state" aria-hidden="true"></span>
		</button>`;
}

function rowMarkup(item, i) {
	return `<li class="row">
		<button class="row-open" type="button" data-i="${i}" data-key="${esc(rowKey(item, i))}">
			${artwork(item.art, 'row-art')}
			<span class="row-body"><span class="row-title">${esc(item.artist)} &mdash; ${esc(item.track)}</span></span>
			<span class="row-when">${timeAgo(item.playedAt)}</span>
			<span class="row-state" aria-hidden="true"></span>
		</button>
	</li>`;
}

export function render(el, payload, getQuiet) {
	if (payload?.paused) {
		el.innerHTML = '<p class="listening-empty">Off the air.</p>';
		return;
	}
	if (payload?.private) {
		el.innerHTML = '<p class="listening-empty">Keeping that one to himself.</p>';
		return;
	}

	// One ordered list: the live or most recent track first, everything after it
	// in order. Index 0 is the hero, so "start here" works from the top.
	const items = [payload?.nowPlaying, ...(payload?.recent ?? [])].filter(Boolean);
	if (!items.length) {
		el.innerHTML = '<p class="listening-empty">Nothing on right now.</p>';
		return;
	}

	el.innerHTML = heroMarkup(payload, items[0])
		+ `<div class="recent-window"><ul class="recent">`
		+ items.slice(1).map((it, n) => rowMarkup(it, n + 1)).join('')
		+ `</ul></div>`
		+ `<p class="recent-count">${items.length} most recent</p>`;

	el.querySelectorAll('[data-i]').forEach(btn => {
		btn.addEventListener('click', () => {
			if (getQuiet()) return;
			const i = Number(btn.dataset.i);
			// Already the playing row: treat the press as pause/resume rather
			// than restarting the run from here.
			if (player.currentOwner() === btn.dataset.key) return player.togglePlay();
			playFrom(items, i, LABEL);
		});
	});

	// Exactly one row can be current, so this marks one and clears the rest.
	const marks = () => {
		const owner = player.currentOwner();
		const playing = player.playState() === 'playing';
		el.querySelectorAll('[data-key]').forEach(btn => {
			const mine = owner && btn.dataset.key === owner;
			btn.classList.toggle('is-playing', Boolean(mine));
			btn.querySelector('.row-state').textContent = mine ? (playing ? '❙❙' : '▶') : '';
		});
	};
	player.subscribe(reason => { if (reason !== 'progress') marks(); });
	marks();
}

// The obvious control: start the whole list from the top.
export function playAll(payload) {
	const items = [payload?.nowPlaying, ...(payload?.recent ?? [])].filter(Boolean);
	if (items.length) playFrom(items, 0, LABEL);
}
