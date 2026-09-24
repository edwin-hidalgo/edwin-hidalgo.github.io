// What Edwin has been hearing.
//
// The whole list is playable and continuous: clicking any row starts there and
// keeps going through everything below it. Rows carry no preview URL -- that is
// resolved a few ahead of the playhead by the player -- so a hundred tracks
// cost nothing until someone presses play.
//
// Row shape follows the convention every music app has settled on, because it
// answers the questions people actually ask of a list like this: the number
// says where a track sits in the order, the artist and album say what it is,
// and the number turns into a play triangle on hover so the affordance appears
// where the eye already is.
//
// Four answers come back from /api/lately -- paused, private, empty, normal --
// and every one has to read like a finished thought rather than a failure. A
// room with nothing to say is still a room.

import { isLive, timeAgo, esc } from './format.js';
import { playFrom, rowKey, resolveTrack } from './track.js';
import { icon } from '../icons.js';
import * as player from '../player/engine.js';

// Exported because the About corner starts the same run and used to carry its
// own hard-coded copy of this string -- so a rename changed the Lounge's
// player label and left the corner's saying something else.
export const LABEL = 'Recent listens';

function art(url, cls) {
	if (!url) return `<span class="${cls}"></span>`;
	return `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy">`;
}

function row(item, i) {
	return `<li class="trk" data-key="${esc(rowKey(item, i))}" data-i="${i}">
		<button class="trk-btn" type="button">
			<span class="trk-num"><span class="trk-n">${i + 1}</span><span class="trk-play">${icon.play(11)}</span></span>
			${art(item.art, 'trk-art')}
			<span class="trk-main">
				<span class="trk-title">${esc(item.track)}</span>
				<span class="trk-artist">${esc(item.artist)}</span>
			</span>
			<span class="trk-album">${esc(item.album || '')}</span>
			<span class="trk-when">${item.live ? '<span class="live-dot"></span>now' : timeAgo(item.playedAt)}</span>
		</button>
	</li>`;
}

// Last.fm has no image for roughly one track in seven. Rather than fetch a
// hundred covers up front, fill the gaps only as they scroll into view --
// /api/resolve is CDN-cached for a day, so it costs almost nothing after the
// first look.
function fillMissingArt(scope, items) {
	if (typeof IntersectionObserver !== 'function') return;
	const io = new IntersectionObserver((entries, obs) => {
		for (const e of entries) {
			if (!e.isIntersecting) continue;
			obs.unobserve(e.target);
			const item = items[Number(e.target.dataset.i)];
			if (!item) continue;
			resolveTrack(item.artist, item.track).then(d => {
				if (!d?.artwork) return;
				const slot = e.target.querySelector('.trk-art');
				if (!slot) return;
				const img = new Image();
				img.className = 'trk-art';
				img.loading = 'lazy';
				img.alt = '';
				img.src = d.artwork;
				slot.replaceWith(img);
			});
		}
	}, { root: scope.querySelector('.trk-window'), rootMargin: '120px' });

	scope.querySelectorAll('.trk').forEach(el => {
		if (!el.querySelector('img.trk-art')) io.observe(el);
	});
}

export function render(el, payload) {
	if (payload?.paused) {
		el.innerHTML = '<p class="listening-empty">Off the air.</p>';
		return;
	}
	if (payload?.private) {
		el.innerHTML = '<p class="listening-empty">Keeping that one to himself.</p>';
		return;
	}

	const live = isLive(payload);
	const items = [
		payload?.nowPlaying ? { ...payload.nowPlaying, live } : null,
		...(payload?.recent ?? []),
	].filter(Boolean);

	if (!items.length) {
		el.innerHTML = '<p class="listening-empty">Nothing on right now.</p>';
		return;
	}

	el.innerHTML = `<div class="trk-window"><ol class="trk-list">${items.map(row).join('')}</ol></div>`;

	el.querySelectorAll('.trk-btn').forEach(btn => {
		btn.addEventListener('click', () => {
			const li = btn.closest('.trk');
			if (player.currentOwner() === li.dataset.key) return player.togglePlay();
			playFrom(items, Number(li.dataset.i), LABEL);
		});
	});

	// Exactly one row can be current, because only one URL is ever playing and
	// it maps to one owner.
	const marks = () => {
		const owner = player.currentOwner();
		const playing = player.playState() === 'playing';
		el.querySelectorAll('.trk').forEach(li => {
			const mine = owner && li.dataset.key === owner;
			li.classList.toggle('is-playing', Boolean(mine));
			li.querySelector('.trk-play').innerHTML = mine && playing ? icon.pause(11) : icon.play(11);
		});
	};
	player.subscribe(reason => { if (reason !== 'progress') marks(); });
	marks();

	fillMissingArt(el, items);
}

// The obvious control: start the whole list from the top.
export function playAll(payload) {
	const items = [payload?.nowPlaying, ...(payload?.recent ?? [])].filter(Boolean);
	if (items.length) playFrom(items, 0, LABEL);
}

// What the corner's Play should start -- the track the corner names.
export function firstTrack(payload) {
	return payload?.nowPlaying ?? payload?.recent?.[0] ?? null;
}
